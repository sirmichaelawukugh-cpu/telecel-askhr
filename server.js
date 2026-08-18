require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { sendTicketToHR, sendConfirmationToRequester, sendStatusUpdate } = require('./lib/mailer');
const { buildTicketsWorkbook } = require('./lib/reports');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'tickets.json');
const UPLOAD_DIR = path.join(__dirname, 'uploads');

const ALLOWED_EXTS = [
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'csv', 'odt', 'ods',
  'zip', 'rar', '7z', 'msg', 'eml'
];
const MAX_FILE_SIZE = 10 * 1024 * 1024;

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `tgh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
    }
  }),
  limits: { fileSize: MAX_FILE_SIZE, files: 10 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().slice(1);
    if (ALLOWED_EXTS.includes(ext)) return cb(null, true);
    cb(new Error(`Unsupported file type ".${ext}". Allowed: ${ALLOWED_EXTS.join(', ')}`));
  }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '1d' }));

let tickets = [];
if (fs.existsSync(DATA_FILE)) {
  try {
    tickets = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {
    tickets = [];
  }
}

function saveTickets() {
  if (!fs.existsSync(path.dirname(DATA_FILE))) {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify(tickets, null, 2));
}

function nextTicketId() {
  return tickets.reduce((max, t) => Math.max(max, t.id), 0) + 1;
}

function applyFilters(list, req) {
  const { status, priority, department, category, q } = req.query;
  let result = [...list];
  if (status) result = result.filter(t => t.status === status);
  if (priority) result = result.filter(t => t.priority === priority);
  if (department) result = result.filter(t => t.department === department);
  if (category) result = result.filter(t => t.category === category);
  if (q) {
    const needle = q.toLowerCase();
    result = result.filter(t =>
      (t.subject && t.subject.toLowerCase().includes(needle)) ||
      (t.name && t.name.toLowerCase().includes(needle)) ||
      (t.description && t.description.toLowerCase().includes(needle)) ||
      (t.ticketRef && t.ticketRef.toLowerCase().includes(needle))
    );
  }
  return result;
}

app.get('/api/tickets', (req, res) => {
  res.json(applyFilters(tickets, req));
});

app.get('/api/tickets/:id', (req, res) => {
  const ticket = tickets.find(t => t.id === Number(req.params.id));
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  res.json(ticket);
});

app.post('/api/tickets', (req, res) => {
  const contentType = req.headers['content-type'] || '';
  if (contentType.includes('application/json')) {
    return handleCreateTicket(req, res, []);
  }
  upload.array('attachments', 10)(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    const files = (req.files || []).map(f => ({
      name: path.basename(f.originalname),
      size: f.size,
      type: f.mimetype || 'application/octet-stream',
      ext: path.extname(f.originalname).toLowerCase().slice(1),
      path: '/uploads/' + f.filename
    }));
    handleCreateTicket(req, res, files);
  });
});

function handleCreateTicket(req, res, files) {
  const { name, email, department, category, subject, description, priority } = req.body;
  if (!name || !email || !department || !subject || !description) {
    if (files.length) cleanupFiles(files);
    return res.status(400).json({ error: 'name, email, function, subject and description are required' });
  }
  const ticket = {
    id: nextTicketId(),
    ticketRef: 'TGH-' + Date.now().toString(36).toUpperCase().slice(-8),
    name,
    email,
    department,
    category: category || 'General',
    subject,
    description,
    priority: priority || 'Medium',
    status: 'Open',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    assignedTo: '',
    resolution: '',
    attachments: files
  };
  tickets.push(ticket);
  saveTickets();

  sendTicketToHR(ticket).catch(err => console.error('[mail:hr]', err.message));
  sendConfirmationToRequester(ticket).catch(err => console.error('[mail:req]', err.message));

  res.status(201).json(ticket);
}

function cleanupFiles(files) {
  for (const f of files) {
    const diskPath = path.join(UPLOAD_DIR, path.basename(f.path));
    fs.unlink(diskPath, () => {});
  }
}

app.patch('/api/tickets/:id', (req, res) => {
  const ticket = tickets.find(t => t.id === Number(req.params.id));
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

  const oldStatus = ticket.status;
  const allowed = ['status', 'priority', 'assignedTo', 'resolution', 'category', 'subject', 'description'];
  for (const key of allowed) {
    if (req.body[key] !== undefined) ticket[key] = req.body[key];
  }
  ticket.updatedAt = new Date().toISOString();
  saveTickets();

  if (oldStatus !== ticket.status) {
    sendStatusUpdate(ticket, oldStatus).catch(err => console.error('[mail:status]', err.message));
  }

  res.json(ticket);
});

app.delete('/api/tickets/:id', (req, res) => {
  const idx = tickets.findIndex(t => t.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Ticket not found' });
  const [removed] = tickets.splice(idx, 1);
  saveTickets();
  if (Array.isArray(removed.attachments)) cleanupFiles(removed.attachments);
  res.json(removed);
});

app.get('/api/stats', (req, res) => {
  const count = s => tickets.filter(t => t.status === s).length;
  res.json({
    total: tickets.length,
    open: count('Open'),
    inProgress: count('In Progress'),
    resolved: count('Resolved'),
    closed: count('Closed'),
    highPriority: tickets.filter(t => t.priority === 'High' || t.priority === 'Urgent').length
  });
});

app.get('/api/analytics', (req, res) => {
  const filtered = applyFilters(tickets, req);
  const byStatus = {};
  const byDepartment = {};
  const byPriority = {};
  const byCategory = {};
  const byDay = {};
  filtered.forEach(t => {
    byStatus[t.status] = (byStatus[t.status] || 0) + 1;
    byDepartment[t.department] = (byDepartment[t.department] || 0) + 1;
    byPriority[t.priority] = (byPriority[t.priority] || 0) + 1;
    byCategory[t.category] = (byCategory[t.category] || 0) + 1;
    const day = new Date(t.createdAt).toISOString().slice(0, 10);
    byDay[day] = (byDay[day] || 0) + 1;
  });
  res.json({
    total: filtered.length,
    byStatus,
    byDepartment,
    byPriority,
    byCategory,
    byDay: Object.keys(byDay).sort().map(d => ({ date: d, count: byDay[d] })),
    avgResolutionDays: avgResolutionDays(filtered)
  });
});

function avgResolutionDays(list) {
  const resolved = list.filter(t => t.status === 'Resolved' || t.status === 'Closed');
  if (!resolved.length) return null;
  const totalDays = resolved.reduce((sum, t) => {
    return sum + (new Date(t.updatedAt) - new Date(t.createdAt)) / 86400000;
  }, 0);
  return Math.round((totalDays / resolved.length) * 10) / 10;
}

app.get('/api/report/excel', async (req, res) => {
  try {
    const filtered = applyFilters(tickets, req);
    const filters = {
      status: req.query.status,
      priority: req.query.priority,
      department: req.query.department
    };
    const wb = await buildTicketsWorkbook(filtered, filters);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="AskHR_ticket_report.xlsx"'
    );
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('[report:excel]', err);
    res.status(500).json({ error: 'Failed to generate Excel report' });
  }
});

app.listen(PORT, () => {
  console.log(`Telecel AskHR running at http://localhost:${PORT}`);
  if (!process.env.SMTP_HOST) {
    console.log('  [mail] SMTP not configured - email notifications are DISABLED. See .env.example');
  }
});
