require('dotenv').config();
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { tickets } = require('./lib/store');
const { sendTicketToHR, sendConfirmationToRequester, sendStatusUpdate, sendStatusUpdateToHR } = require('./lib/mailer');
const { buildTicketsWorkbook } = require('./lib/reports');
const auth = require('./lib/auth');

const app = express();
const PORT = process.env.PORT || 3000;
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

function buildFilter(req) {
  const { status, priority, department, category, q } = req.query;
  const filter = {};
  if (status) filter.status = status;
  if (priority) filter.priority = priority;
  if (department) filter.department = department;
  if (category) filter.category = category;
  if (q) {
    const needle = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [
      { subject: needle },
      { name: needle },
      { description: needle },
      { ticketRef: needle }
    ];
  }
  return filter;
}

function queryTickets(req) {
  let items = tickets.find(buildFilter(req));
  tickets.sort(items, 'createdAt', -1);
  return items;
}

// ====== Auth routes ======

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
  try {
    const user = auth.findUser(username);
    if (!user || !auth.verifyPassword(password, user.salt, user.password)) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Access restricted to administrators only' });
    }
    const token = auth.generateToken(user);
    res.json({ token, user: { id: user._id, username: user.username, name: user.name, role: user.role, email: user.email } });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/auth/me', auth.authenticate, (req, res) => {
  try {
    const user = auth.findUserById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { password, salt, ...safe } = user;
    res.json(safe);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ====== Admin user management ======

app.get('/api/users', auth.authenticate, auth.requireAdmin, (req, res) => {
  res.json(auth.getAllUsers());
});

app.post('/api/users', auth.authenticate, auth.requireAdmin, (req, res) => {
  const { username, password, name, email, role } = req.body;
  if (!username || !password || !name) {
    return res.status(400).json({ error: 'username, password and name are required' });
  }
  const user = auth.createUser({ username, password, name, email, role });
  if (!user) return res.status(409).json({ error: 'Username already exists' });
  const { password: p, salt: s, ...safe } = user;
  res.status(201).json(safe);
});

// ====== Tickets ======

app.get('/api/tickets', auth.authenticate, auth.requireAdmin, (req, res) => {
  res.json(queryTickets(req));
});

app.get('/api/tickets/:id', auth.authenticate, auth.requireAdmin, (req, res) => {
  const ticket = tickets.findById(req.params.id);
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
  const { name, email, phone, department, category, subject, description, priority } = req.body;
  if (!name || !email || !phone || !department || !subject || !description) {
    if (files.length) cleanupFiles(files);
    return res.status(400).json({ error: 'name, email, phone, function, subject and description are required' });
  }
  try {
    const ticket = tickets.create({
      ticketRef: 'TGH-' + Date.now().toString(36).toUpperCase().slice(-8),
      name,
      email,
      phone,
      department,
      category: category || 'General',
      subject,
      description,
      priority: priority || 'Medium',
      status: 'Open',
      assignedTo: '',
      resolution: '',
      attachments: files
    });

    sendTicketToHR(ticket).then(() => console.log('[mail:hr] Notification sent for', ticket.ticketRef)).catch(err => console.error('[mail:hr] FAILED:', err.message));
    sendConfirmationToRequester(ticket).then(() => console.log('[mail:req] Confirmation sent to', ticket.email)).catch(err => console.error('[mail:req] FAILED:', err.message));

    res.status(201).json(ticket);
  } catch (err) {
    if (files.length) cleanupFiles(files);
    res.status(500).json({ error: 'Failed to create ticket' });
  }
}

function cleanupFiles(files) {
  for (const f of files) {
    fs.unlink(path.join(UPLOAD_DIR, path.basename(f.path)), () => {});
  }
}

app.patch('/api/tickets/:id', auth.authenticate, auth.requireAdmin, (req, res) => {
  try {
    const ticket = tickets.findById(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    const oldStatus = ticket.status;
    const allowed = ['status', 'priority', 'assignedTo', 'resolution', 'category', 'subject', 'description'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    const updated = tickets.findByIdAndUpdate(req.params.id, updates);

    if (oldStatus !== updated.status) {
      if (updated.status === 'Resolved' || updated.status === 'Closed') {
        sendStatusUpdate(updated, oldStatus).catch(err => console.error('[mail:status]', err.message));
      }
      sendStatusUpdateToHR(updated, oldStatus).catch(err => console.error('[mail:status-hr]', err.message));
    }

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/tickets/:id', auth.authenticate, auth.requireAdmin, (req, res) => {
  try {
    const ticket = tickets.findByIdAndDelete(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    if (Array.isArray(ticket.attachments)) cleanupFiles(ticket.attachments);
    res.json(ticket);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ====== Stats & Analytics (admin only) ======

app.get('/api/stats', auth.authenticate, auth.requireAdmin, (req, res) => {
  const all = tickets.find();
  const total = all.length;
  const open = all.filter(t => t.status === 'Open').length;
  const inProgress = all.filter(t => t.status === 'In Progress').length;
  const resolved = all.filter(t => t.status === 'Resolved').length;
  const closed = all.filter(t => t.status === 'Closed').length;
  const high = all.filter(t => t.priority === 'High' || t.priority === 'Urgent').length;
  res.json({ total, open, inProgress, resolved, closed, highPriority: high });
});

app.get('/api/analytics', auth.authenticate, auth.requireAdmin, (req, res) => {
  const all = queryTickets(req);
  const byStatus = {}, byDepartment = {}, byPriority = {}, byCategory = {}, byDay = {};
  all.forEach(t => {
    byStatus[t.status] = (byStatus[t.status] || 0) + 1;
    byDepartment[t.department] = (byDepartment[t.department] || 0) + 1;
    byPriority[t.priority] = (byPriority[t.priority] || 0) + 1;
    byCategory[t.category] = (byCategory[t.category] || 0) + 1;
    const day = new Date(t.createdAt).toISOString().slice(0, 10);
    byDay[day] = (byDay[day] || 0) + 1;
  });
  const resolved = all.filter(t => t.status === 'Resolved' || t.status === 'Closed');
  const avgDays = resolved.length
    ? Math.round((resolved.reduce((s, t) => s + (new Date(t.updatedAt) - new Date(t.createdAt)) / 86400000, 0) / resolved.length) * 10) / 10
    : null;
  res.json({
    total: all.length, byStatus, byDepartment, byPriority, byCategory,
    byDay: Object.keys(byDay).sort().map(d => ({ date: d, count: byDay[d] })),
    avgResolutionDays: avgDays
  });
});

app.get('/api/report/excel', auth.authenticate, auth.requireAdmin, async (req, res) => {
  try {
    const filterTickets = queryTickets(req);
    const filters = { status: req.query.status, priority: req.query.priority, department: req.query.department };
    const wb = await buildTicketsWorkbook(filterTickets, filters);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="AskHR_ticket_report.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('[report:excel]', err);
    res.status(500).json({ error: 'Failed to generate Excel report' });
  }
});

// ====== Start ======

console.log('[env] Checking environment variables...');
['JWT_SECRET', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM', 'HR_EMAIL'].forEach(k => {
  const v = process.env[k];
  console.log(`[env] ${k} = ${v ? (k.includes('PASS') ? v.slice(0, 8) + '...' : v) : 'NOT SET'}`);
});

auth.seedDefaultUsers();

app.listen(PORT, () => {
  console.log(`Telecel AskHR running at http://localhost:${PORT}`);
  console.log('[db] Using file-based storage (data/)');
  if (!process.env.SMTP_HOST) {
    console.log('  [mail] SMTP not configured - email notifications are DISABLED.');
  }
});
