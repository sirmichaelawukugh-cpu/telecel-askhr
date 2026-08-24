require('dotenv').config();
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const express = require('express');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const Ticket = require('./models/Ticket');
const { sendTicketToHR, sendConfirmationToRequester, sendStatusUpdate, sendStatusUpdateToHR } = require('./lib/mailer');
const { buildTicketsWorkbook } = require('./lib/reports');
const auth = require('./lib/auth');

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const MONGODB_URI = process.env.MONGODB_URI;

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

function buildQuery(req) {
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

// ====== Auth routes ======

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
  auth.findUser(username).then(user => {
    if (!user || !auth.verifyPassword(password, user.salt, user.password)) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Access restricted to administrators only' });
    }
    const token = auth.generateToken(user);
    res.json({ token, user: { id: user._id, username: user.username, name: user.name, role: user.role, email: user.email } });
  }).catch(err => res.status(500).json({ error: 'Server error' }));
});

app.get('/api/auth/me', auth.authenticate, (req, res) => {
  auth.findUserById(req.user.id).then(user => {
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { password, salt, ...safe } = user.toObject();
    res.json(safe);
  }).catch(err => res.status(500).json({ error: 'Server error' }));
});

// ====== Admin user management ======

app.get('/api/users', auth.authenticate, auth.requireAdmin, async (req, res) => {
  try { res.json(await auth.getAllUsers()); }
  catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.post('/api/users', auth.authenticate, auth.requireAdmin, async (req, res) => {
  const { username, password, name, email, role } = req.body;
  if (!username || !password || !name) {
    return res.status(400).json({ error: 'username, password and name are required' });
  }
  try {
    const user = await auth.createUser({ username, password, name, email, role });
    if (!user) return res.status(409).json({ error: 'Username already exists' });
    const { password: p, salt: s, ...safe } = user.toObject();
    res.status(201).json(safe);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ====== Tickets ======

app.get('/api/tickets', auth.authenticate, auth.requireAdmin, async (req, res) => {
  try {
    const tickets = await Ticket.find(buildQuery(req)).sort({ createdAt: -1 }).lean();
    res.json(tickets);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/tickets/:id', auth.authenticate, auth.requireAdmin, async (req, res) => {
  try {
    const ticket = await Ticket.findById(req.params.id).lean();
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    res.json(ticket);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
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

async function handleCreateTicket(req, res, files) {
  const { name, email, phone, department, category, subject, description, priority } = req.body;
  if (!name || !email || !phone || !department || !subject || !description) {
    if (files.length) cleanupFiles(files);
    return res.status(400).json({ error: 'name, email, phone, function, subject and description are required' });
  }
  try {
    const ticket = await Ticket.create({
      ticketRef: 'TGH-' + Date.now().toString(36).toUpperCase().slice(-8),
      name, email, phone, department,
      category: category || 'General',
      subject, description,
      priority: priority || 'Medium',
      status: 'Open',
      assignedTo: '',
      resolution: '',
      attachments: files
    });

    sendTicketToHR(ticket.toObject()).then(() => console.log('[mail:hr] Notification sent for', ticket.ticketRef)).catch(err => console.error('[mail:hr] FAILED:', err.message));
    sendConfirmationToRequester(ticket.toObject()).then(() => console.log('[mail:req] Confirmation sent to', ticket.email)).catch(err => console.error('[mail:req] FAILED:', err.message));

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

app.patch('/api/tickets/:id', auth.authenticate, auth.requireAdmin, async (req, res) => {
  try {
    const ticket = await Ticket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

    const oldStatus = ticket.status;
    const allowed = ['status', 'priority', 'assignedTo', 'resolution', 'category', 'subject', 'description'];
    for (const key of allowed) {
      if (req.body[key] !== undefined) ticket[key] = req.body[key];
    }
    await ticket.save();

    if (oldStatus !== ticket.status) {
      const tObj = ticket.toObject();
      if (ticket.status === 'Resolved' || ticket.status === 'Closed') {
        sendStatusUpdate(tObj, oldStatus).catch(err => console.error('[mail:status]', err.message));
      }
      sendStatusUpdateToHR(tObj, oldStatus).catch(err => console.error('[mail:status-hr]', err.message));
    }

    res.json(ticket);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.delete('/api/tickets/:id', auth.authenticate, auth.requireAdmin, async (req, res) => {
  try {
    const ticket = await Ticket.findByIdAndDelete(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    if (Array.isArray(ticket.attachments)) cleanupFiles(ticket.attachments);
    res.json(ticket);
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ====== Stats & Analytics ======

app.get('/api/stats', auth.authenticate, auth.requireAdmin, async (req, res) => {
  try {
    const [total, open, inProgress, resolved, closed, high] = await Promise.all([
      Ticket.countDocuments(),
      Ticket.countDocuments({ status: 'Open' }),
      Ticket.countDocuments({ status: 'In Progress' }),
      Ticket.countDocuments({ status: 'Resolved' }),
      Ticket.countDocuments({ status: 'Closed' }),
      Ticket.countDocuments({ priority: { $in: ['High', 'Urgent'] } })
    ]);
    res.json({ total, open, inProgress, resolved, closed, highPriority: high });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/analytics', auth.authenticate, auth.requireAdmin, async (req, res) => {
  try {
    const tickets = await Ticket.find(buildQuery(req)).lean();
    const byStatus = {}, byDepartment = {}, byPriority = {}, byCategory = {}, byDay = {}, byMonth = {}, byFunctionCategory = {};
    tickets.forEach(t => {
      byStatus[t.status] = (byStatus[t.status] || 0) + 1;
      byDepartment[t.department] = (byDepartment[t.department] || 0) + 1;
      byPriority[t.priority] = (byPriority[t.priority] || 0) + 1;
      byCategory[t.category] = (byCategory[t.category] || 0) + 1;
      const day = new Date(t.createdAt).toISOString().slice(0, 10);
      byDay[day] = (byDay[day] || 0) + 1;
      const month = new Date(t.createdAt).toISOString().slice(0, 7);
      byMonth[month] = (byMonth[month] || 0) + 1;
      const key = t.department + '||' + t.category;
      byFunctionCategory[key] = (byFunctionCategory[key] || 0) + 1;
    });
    const resolved = tickets.filter(t => t.status === 'Resolved' || t.status === 'Closed');
    const open = tickets.filter(t => t.status === 'Open');
    const inProgress = tickets.filter(t => t.status === 'In Progress');
    const avgDays = resolved.length
      ? Math.round((resolved.reduce((s, t) => s + (new Date(t.updatedAt) - new Date(t.createdAt)) / 86400000, 0) / resolved.length) * 10) / 10
      : null;

    const topCategory = Object.entries(byCategory).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const topDepartment = Object.entries(byDepartment).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const topFunctionCategory = Object.entries(byFunctionCategory).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => {
      const [fn, cat] = k.split('||');
      return { function: fn, category: cat, count: v };
    });
    const resolutionRate = tickets.length ? Math.round((resolved.length / tickets.length) * 100) : 0;
    const daysArr = Object.keys(byDay).sort();
    const busiestDay = daysArr.length ? daysArr.reduce((a, b) => byDay[a] > byDay[b] ? a : b) : null;
    const busiestDayCount = busiestDay ? byDay[busiestDay] : 0;
    const trendArr = Object.keys(byDay).sort().map(d => ({ date: d, count: byDay[d] }));
    const prevMonth = tickets.filter(t => {
      const d = new Date(t.createdAt);
      const now = new Date();
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return d >= prev && d < new Date(now.getFullYear(), now.getMonth(), 1);
    });
    const thisMonth = tickets.filter(t => {
      const d = new Date(t.createdAt);
      const now = new Date();
      return d >= new Date(now.getFullYear(), now.getMonth(), 1);
    });
    const monthOverMonth = prevMonth.length ? Math.round(((thisMonth.length - prevMonth.length) / prevMonth.length) * 100) : null;

    const insights = [];
    if (resolutionRate < 50 && tickets.length > 5) {
      insights.push({ type: 'warning', text: `Resolution rate is ${resolutionRate}%. More than half of all tickets remain unresolved. Consider increasing HR team capacity or streamlining workflows.` });
    } else if (resolutionRate >= 80) {
      insights.push({ type: 'success', text: `Strong resolution rate of ${resolutionRate}%. The HR team is effectively handling requests.` });
    }
    if (avgDays != null && avgDays > 7) {
      insights.push({ type: 'warning', text: `Average resolution time is ${avgDays} days. Consider prioritising overdue tickets to reduce wait times.` });
    } else if (avgDays != null && avgDays <= 2) {
      insights.push({ type: 'success', text: `Excellent average resolution time of ${avgDays} days. Tickets are being resolved quickly.` });
    }
    if (open.length > inProgress.length * 2 && open.length > 5) {
      insights.push({ type: 'warning', text: `${open.length} tickets are still open. Many requests may be waiting too long for initial response.` });
    }
    if (topCategory.length) {
      insights.push({ type: 'info', text: `Most common request: "${topCategory[0][0]}" with ${topCategory[0][1]} ticket${topCategory[0][1] > 1 ? 's' : ''}. Consider creating self-service resources for this category.` });
    }
    if (topDepartment.length && topDepartment[0][1] > tickets.length * 0.3) {
      insights.push({ type: 'info', text: `"${topDepartment[0][0]}" accounts for ${topDepartment[0][1]} of ${tickets.length} tickets (${Math.round(topDepartment[0][1] / tickets.length * 100)}%). Consider targeted HR support for this function.` });
    }
    if (monthOverMonth !== null) {
      if (monthOverMonth > 25) {
        insights.push({ type: 'warning', text: `Ticket volume increased ${monthOverMonth}% from last month. Monitor workload to prevent backlogs.` });
      } else if (monthOverMonth < -25) {
        insights.push({ type: 'success', text: `Ticket volume decreased ${Math.abs(monthOverMonth)}% from last month.` });
      }
    }
    if (!insights.length) {
      insights.push({ type: 'info', text: 'Submit more tickets to generate actionable insights and recommendations.' });
    }

    res.json({
      total: tickets.length, openCount: open.length, inProgressCount: inProgress.length,
      resolvedCount: resolved.length, closedCount: (byStatus.Closed || 0),
      byStatus, byDepartment, byPriority, byCategory,
      byDay: trendArr, byMonth: Object.keys(byMonth).sort().map(m => ({ month: m, count: byMonth[m] })),
      avgResolutionDays: avgDays, resolutionRate, busiestDay, busiestDayCount,
      topCategory, topDepartment, topFunctionCategory, monthOverMonth, insights
    });
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/report/excel', auth.authenticate, auth.requireAdmin, async (req, res) => {
  try {
    const tickets = await Ticket.find(buildQuery(req)).sort({ createdAt: -1 }).lean();
    const filters = { status: req.query.status, priority: req.query.priority, department: req.query.department };
    const wb = await buildTicketsWorkbook(tickets, filters);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="AskHR_ticket_report.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('[report:excel]', err);
    res.status(500).json({ error: 'Failed to generate Excel report' });
  }
});

// ====== Connect to MongoDB and start ======

async function start() {
  if (!MONGODB_URI) {
    console.error('MONGODB_URI is not set. Please configure it in your environment.');
    process.exit(1);
  }
  console.log('[env] Checking environment variables...');
  ['JWT_SECRET', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM', 'HR_EMAIL'].forEach(k => {
    const v = process.env[k];
    console.log(`[env] ${k} = ${v ? (k.includes('PASS') ? v.slice(0, 8) + '...' : v) : 'NOT SET'}`);
  });
  console.log('[db] Connecting to MongoDB Atlas...');
  await mongoose.connect(MONGODB_URI, { dbName: 'askhr' });
  console.log('[db] Connected to MongoDB Atlas (askhr database)');
  await auth.seedDefaultUsers();
  app.listen(PORT, () => {
    console.log(`Telecel AskHR running at http://localhost:${PORT}`);
    if (!process.env.SMTP_HOST) {
      console.log('  [mail] SMTP not configured - email notifications are DISABLED.');
    }
  });
}

start().catch(err => {
  console.error('[db] Failed to connect:', err.message);
  process.exit(1);
});
