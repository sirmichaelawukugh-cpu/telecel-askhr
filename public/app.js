const state = {
  tickets: [],
  currentView: 'dashboard',
  charts: {},
  user: null
};

const $ = sel => document.querySelector(sel);

/* ---------- Auth ---------- */
function getToken() { return localStorage.getItem('askhr-token'); }
function getUser() {
  try { return JSON.parse(localStorage.getItem('askhr-user')); } catch (e) { return null; }
}
function isAdmin() { return state.user && state.user.role === 'admin'; }
function authHeaders() { return { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' }; }

function checkAuth() {
  if (getToken()) {
    state.user = getUser();
    if (state.user && state.user.role === 'admin') {
      showAdminView();
    } else {
      localStorage.removeItem('askhr-token');
      localStorage.removeItem('askhr-user');
      state.user = null;
      showPublicView();
    }
  } else {
    showPublicView();
  }
}

function showAdminView() {
  $('#publicView').style.display = 'none';
  document.querySelectorAll('.admin-view').forEach(el => el.style.display = '');
  $('#adminNav').style.display = '';
  $('#logoutBtn').style.display = '';
  $('#adminLoginLink').style.display = 'none';
  $('#userLabel').textContent = state.user.name + ' (admin)';
  switchView('dashboard');
}

function showPublicView() {
  $('#publicView').style.display = '';
  document.querySelectorAll('.admin-view').forEach(el => el.style.display = 'none');
  $('#adminNav').style.display = 'none';
  $('#logoutBtn').style.display = 'none';
  $('#adminLoginLink').style.display = '';
  $('#userLabel').textContent = '';
}

function logout() {
  localStorage.removeItem('askhr-token');
  localStorage.removeItem('askhr-user');
  state.user = null;
  showPublicView();
  toast('Logged out', 'success');
}

/* ---------- API helpers ---------- */
async function api(url, options = {}) {
  const headers = Object.assign({}, authHeaders(), options.headers || {});
  if (headers['Content-Type'] === undefined && options.body && typeof options.body === 'string') {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) { logout(); throw new Error('Session expired'); }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Request failed');
  }
  return res.json();
}

/* ---------- Navigation ---------- */
function switchView(view) {
  state.currentView = view;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const target = document.getElementById(view);
  if (target) target.classList.add('active');

  document.querySelectorAll('.nav-link').forEach(l => {
    l.classList.toggle('active', l.dataset.view === view);
  });

  if (view === 'dashboard') loadStats();
  if (view === 'tickets') loadTickets();
  if (view === 'reports') loadAnalytics();
}

/* ---------- Dashboard ---------- */
async function loadStats() {
  try {
    const stats = await api('/api/stats');
    $('#statTotal').textContent = stats.total;
    $('#statOpen').textContent = stats.open;
    $('#statProgress').textContent = stats.inProgress;
    $('#statResolved').textContent = stats.resolved;
    $('#statClosed').textContent = stats.closed;
  } catch (e) {
    toast(e.message, 'error');
  }
}

/* ---------- Tickets ---------- */
async function loadTickets() {
  const q = $('#searchBox').value.trim();
  const status = $('#filterStatus').value;
  const priority = $('#filterPriority').value;
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  if (priority) params.set('priority', priority);
  try {
    state.tickets = await api('/api/tickets?' + params.toString());
    renderTickets();
  } catch (e) {
    toast(e.message, 'error');
  }
}

function renderTickets() {
  const list = $('#ticketList');
  if (!state.tickets.length) {
    list.innerHTML = `<div class="empty-state"><strong>No tickets found</strong>Submit a new request to get started.</div>`;
    return;
  }
  list.innerHTML = state.tickets.map(t => {
    const statusClass = 'status-' + t.status.replace(/\s+/g, '');
    const tid = t._id;
    let statusActions = '';
    if (t.status === 'Open') {
      statusActions = `<button class="btn btn-sm btn-primary" data-act="start" data-id="${tid}">Start Work</button>`;
    } else if (t.status === 'In Progress') {
      statusActions = `<button class="btn btn-sm btn-success" data-act="resolve" data-id="${tid}">Mark Resolved</button>`;
    } else if (t.status === 'Resolved') {
      statusActions = `<button class="btn btn-sm btn-outline" data-act="close" data-id="${tid}">Close</button>`;
    }
    return `
      <div class="ticket-card ${statusClass}">
        <div>
          <div class="ticket-meta">
            <span class="ticket-ref">${esc(t.ticketRef)}</span>
            <span class="ticket-date">${new Date(t.createdAt).toLocaleString('en-GB')} · by ${esc(t.name)}</span>
            ${t.assignedTo ? `<span class="tag">Assigned: ${esc(t.assignedTo)}</span>` : ''}
          </div>
          <div class="ticket-subject">${esc(t.subject)}</div>
          <div class="ticket-desc">${esc(t.description)}</div>
          <div class="ticket-tags">
            <span class="tag">${esc(t.department)}</span>
            <span class="tag">${esc(t.category)}</span>
            <span class="tag tag-priority-${esc(t.priority)}">${esc(t.priority)}</span>
            <span class="tag">${esc(t.status)}</span>
          </div>
          ${renderAttachments(t.attachments)}
        </div>
        <div class="ticket-actions">
          ${statusActions}
          <button class="btn btn-sm btn-outline" data-act="retrigger" data-id="${tid}" title="Resend submission notification email">Resend Notification</button>
          <button class="btn btn-sm btn-danger" data-act="delete" data-id="${tid}">Delete</button>
        </div>
      </div>`;
  }).join('');
}

/* ---------- Submit Ticket ---------- */
async function submitTicket(e) {
  e.preventDefault();
  const form = e.target;
  const isPublic = form.id === 'ticketForm';
  const prefix = isPublic ? 'pub-' : '';
  const fd = new FormData();
  fd.append('name', form.querySelector('#' + prefix + 'name').value.trim());
  fd.append('email', form.querySelector('#' + prefix + 'email').value.trim());
  fd.append('phone', form.querySelector('#' + prefix + 'phone').value.trim());
  fd.append('department', form.querySelector('#' + prefix + 'department').value);
  fd.append('category', form.querySelector('#' + prefix + 'category').value);
  fd.append('subject', form.querySelector('#' + prefix + 'subject').value.trim());
  fd.append('description', form.querySelector('#' + prefix + 'description').value.trim());
  fd.append('priority', isPublic ? 'Medium' : form.querySelector('#priority').value);
  const fileInput = form.querySelector('#' + prefix + 'attachments');
  for (const file of fileInput.files) {
    fd.append('attachments', file);
  }
  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true;
  btn.textContent = 'Submitting...';
  try {
    const res = await fetch('/api/tickets', { method: 'POST', body: fd });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Request failed');
    }
    const ticket = await res.json();
    const msg = `Ticket ${ticket.ticketRef} submitted! Confirmation email sent to ${ticket.email}` +
      (ticket.attachments && ticket.attachments.length ? ` (${ticket.attachments.length} attachment${ticket.attachments.length > 1 ? 's' : ''})` : '');
    toast(msg, 'success');
    form.reset();
    updateFileList(prefix);
    if (isAdmin()) {
      setTimeout(() => switchView('tickets'), 1500);
    }
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Submit Ticket';
  }
}

/* ---------- Ticket Actions ---------- */
$('#ticketList').addEventListener('click', async e => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const id = btn.dataset.id;
  const act = btn.dataset.act;

  if (act === 'delete') {
    if (!confirm('Delete this ticket permanently?')) return;
    try {
      await api(`/api/tickets/${id}`, { method: 'DELETE' });
      toast('Ticket deleted', 'success');
      loadTickets();
    } catch (err) { toast(err.message, 'error'); }
    return;
  }

  if (act === 'retrigger') {
    if (!confirm('Resend the submission notification email to admin and requester?')) return;
    try {
      const res = await api(`/api/tickets/${id}/retrigger`);
      toast(res.message || 'Notification re-sent', 'success');
    } catch (err) { toast(err.message, 'error'); }
    return;
  }

  const statusMap = { start: 'In Progress', resolve: 'Resolved', close: 'Closed' };
  const resolution = act === 'resolve' ? prompt('Resolution note (optional):') : '';
  if (act === 'resolve' && resolution === null) return;
  try {
    await api(`/api/tickets/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: statusMap[act], resolution: resolution || '' })
    });
    toast(`Ticket updated to "${statusMap[act]}"`, 'success');
    loadTickets();
    loadStats();
  } catch (err) { toast(err.message, 'error'); }
});

/* ---------- Reports & Analytics ---------- */
function reportParams() {
  const p = new URLSearchParams();
  const s = $('#reportStatus') ? $('#reportStatus').value : '';
  const d = $('#reportDepartment') ? $('#reportDepartment').value : '';
  if (s) p.set('status', s);
  if (d) p.set('department', d);
  return p;
}

async function loadAnalytics() {
  try {
    const a = await api('/api/analytics?' + reportParams().toString());
    $('#rptTotal').textContent = a.total;
    $('#rptOpen').textContent = a.openCount;
    $('#rptClosed').textContent = a.closedCount;
    $('#rptAvg').textContent = a.avgResolutionDays != null ? a.avgResolutionDays + 'd' : '-';
    $('#rptResolutionRate').textContent = a.resolutionRate + '%';
    if (a.monthOverMonth !== null && a.monthOverMonth !== undefined) {
      const arrow = a.monthOverMonth > 0 ? '\u25B2' : a.monthOverMonth < 0 ? '\u25BC' : '';
      $('#rptTrend').textContent = (a.monthOverMonth > 0 ? '+' : '') + a.monthOverMonth + '% ' + arrow;
      $('#rptTrend').className = 'kpi-value ' + (a.monthOverMonth > 0 ? 'trend-up' : a.monthOverMonth < 0 ? 'trend-down' : '');
    } else {
      $('#rptTrend').textContent = '-';
    }
    renderExecutiveSummary(a);
    renderInsights(a.insights || []);
    renderCharts(a);
  } catch (e) { toast(e.message, 'error'); }
}

function renderExecutiveSummary(a) {
  const statusLine = `<p><strong>${a.total}</strong> total ticket${a.total !== 1 ? 's' : ''} submitted. <strong>${a.resolvedCount + a.closedCount}</strong> resolved/closed, <strong>${a.openCount}</strong> open, <strong>${a.inProgressCount}</strong> in progress.</p>`;
  const avgLine = a.avgResolutionDays != null
    ? `<p>Average resolution time: <strong>${a.avgResolutionDays} day${a.avgResolutionDays !== 1 ? 's' : ''}</strong>. Resolution rate: <strong>${a.resolutionRate}%</strong>.</p>`
    : '<p>No resolved tickets yet to calculate average resolution time.</p>';
  const busiestLine = a.busiestDay ? `<p>Busiest submission day: <strong>${a.busiestDay}</strong> (${a.busiestDayCount} ticket${a.busiestDayCount !== 1 ? 's' : ''}).</p>` : '';
  $('#summaryOverview').innerHTML = statusLine + avgLine + busiestLine;

  if (a.topDepartment && a.topDepartment.length) {
    $('#summaryTopFunctions').innerHTML = '<ol class="summary-list">' +
      a.topDepartment.map(([fn, count]) => `<li><strong>${esc(fn)}</strong> &mdash; ${count} ticket${count !== 1 ? 's' : ''} <span class="bar-inline">${'<span class="bar-fill" style="width:' + Math.round(count / a.topDepartment[0][1] * 100) + '%"></span>'}</span></li>`).join('') +
      '</ol>';
  } else {
    $('#summaryTopFunctions').innerHTML = '<p>No data available.</p>';
  }

  if (a.topCategory && a.topCategory.length) {
    $('#summaryTopCategories').innerHTML = '<ol class="summary-list">' +
      a.topCategory.map(([cat, count]) => `<li><strong>${esc(cat)}</strong> &mdash; ${count} ticket${count !== 1 ? 's' : ''} <span class="bar-inline">${'<span class="bar-fill" style="width:' + Math.round(count / a.topCategory[0][1] * 100) + '%"></span>'}</span></li>`).join('') +
      '</ol>';
  } else {
    $('#summaryTopCategories').innerHTML = '<p>No data available.</p>';
  }
}

function renderInsights(insights) {
  const el = $('#insightsList');
  if (!insights.length) { el.innerHTML = ''; return; }
  el.innerHTML = insights.map(i => {
    const icon = i.type === 'success' ? '&#10003;' : i.type === 'warning' ? '&#9888;' : '&#8505;';
    return `<div class="insight-item insight-${i.type}"><span class="insight-icon">${icon}</span><span class="insight-text">${esc(i.text)}</span></div>`;
  }).join('');
}

function chartTheme() {
  return document.body.classList.contains('theme-light') || !document.body.classList.contains('theme-dark');
}

function renderCharts(a) {
  Object.values(state.charts).forEach(c => c.destroy());
  state.charts = {};
  const textColor = document.body.classList.contains('theme-dark') ? '#e0d7d7' : '#4a3f3f';
  const gridColor = document.body.classList.contains('theme-dark') ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
  const colors = { red: '#d92525', primary: '#7f0d0d', success: '#1c7c3c', warning: '#e88a1a', info: '#3b82f6', bar: ['#d92525', '#7f0d0d', '#e88a1a', '#3b82f6', '#1c7c3c'] };
  const defaults = { color: textColor, font: { family: 'inherit' } };
  Chart.defaults.color = textColor;
  Chart.defaults.font.family = 'inherit';

  const pieColors = [colors.red, colors.success, colors.warning, colors.info, colors.primary];
  state.charts.status = new Chart($('#chartStatus'), {
    type: 'doughnut', data: { labels: Object.keys(a.byStatus), datasets: [{ data: Object.values(a.byStatus), backgroundColor: pieColors, borderWidth: 0 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { padding: 14 } } } }
  });

  state.charts.function = new Chart($('#chartFunction'), {
    type: 'bar', data: { labels: Object.keys(a.byDepartment), datasets: [{ label: 'Tickets', data: Object.values(a.byDepartment), backgroundColor: colors.bar, borderRadius: 6 }] },
    options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { grid: { color: gridColor }, ticks: { stepSize: 1 } }, y: { grid: { display: false } } } }
  });

  const palette = ['#d92525', '#3b82f6', '#1c7c3c', '#e88a1a', '#7f0d0d', '#60a5fa', '#a855f7', '#ec4899', '#14b8a6'];
  state.charts.category = new Chart($('#chartCategory'), {
    type: 'bar', data: { labels: Object.keys(a.byCategory), datasets: [{ label: 'Tickets', data: Object.values(a.byCategory), backgroundColor: palette.slice(0, Math.max(Object.keys(a.byCategory).length, 1)), borderRadius: 6 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { color: gridColor }, ticks: { maxRotation: 45 } }, y: { grid: { color: gridColor }, ticks: { stepSize: 1 } } } }
  });

  const trend = a.trend || a.byDay || [];
  state.charts.trend = new Chart($('#chartTrend'), {
    type: 'line', data: { labels: trend.map(t => t.date), datasets: [{ label: 'Tickets', data: trend.map(t => t.count), borderColor: colors.red, backgroundColor: 'rgba(217,37,37,0.08)', fill: true, tension: 0.35, pointRadius: 4, pointBackgroundColor: colors.red }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { color: gridColor } }, y: { grid: { color: gridColor }, beginAtZero: true, ticks: { stepSize: 1 } } } }
  });
}

function exportExcel() {
  const url = '/api/report/excel?' + reportParams().toString();
  downloadWithAuth(url, 'AskHR_ticket_report.xlsx');
  toast('Excel report downloading...', 'success');
}

function downloadWithAuth(url, filename) {
  fetch(url, { headers: { 'Authorization': 'Bearer ' + getToken() } })
    .then(r => r.blob())
    .then(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    })
    .catch(err => toast(err.message, 'error'));
}

/* ---------- Theme ---------- */
function initTheme() {
  const saved = localStorage.getItem('askhr-theme');
  if (saved === 'dark') {
    document.body.classList.remove('theme-light');
    document.body.classList.add('theme-dark');
  } else {
    document.body.classList.remove('theme-dark');
    document.body.classList.add('theme-light');
  }
  updateThemeIcon();
}

function applyTheme(mode) {
  document.body.classList.remove('theme-light', 'theme-dark');
  document.body.classList.add('theme-' + mode);
  localStorage.setItem('askhr-theme', mode);
  updateThemeIcon();
}

function updateThemeIcon() {
  const btn = $('#themeToggle');
  if (!btn) return;
  btn.textContent = document.body.classList.contains('theme-dark') ? '\u{1F319}' : '\u{1F324}';
}

/* ---------- Toast ---------- */
function toast(msg, type = 'success') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast show ' + type;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.className = 'toast'; }, 5000);
}

/* ---------- Escape ---------- */
function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

/* ---------- Attachments ---------- */
function renderAttachments(files) {
  if (!files || !files.length) return '';
  return `<div class="attachments-row">${files.map(f => `<a href="${esc(f.path)}" target="_blank" class="attachment-chip" title="${esc(f.name)} (${(f.size/1024).toFixed(1)} KB)"><span class="att-icon">${attIcon(f.ext)}</span> ${esc(f.name)}</a>`).join('')}</div>`;
}

function attIcon(ext) {
  const map = { pdf: '📄', doc: '📝', docx: '📝', xls: '📊', xlsx: '📊', ppt: '📽', pptx: '📽', png: '🖼', jpg: '🖼', jpeg: '🖼', gif: '🖼', zip: '🗜', rar: '🗜', txt: '📃', csv: '📊' };
  return map[ext] || '📎';
}

function updateFileList(prefix) {
  prefix = prefix || '';
  const list = $(prefix ? '#' + prefix + 'fileList' : '#fileList');
  const input = $(prefix ? '#' + prefix + 'attachments' : '#attachments');
  const files = Array.from(input.files || []);
  if (!files.length) { list.innerHTML = ''; return; }
  list.innerHTML = files.map((f, i) => `
    <li>
      <span>${attIcon(f.name.split('.').pop().toLowerCase())} ${esc(f.name)} (${(f.size / 1024).toFixed(1)} KB)</span>
      <button type="button" data-file-idx="${i}" data-prefix="${prefix}" class="file-remove">&times;</button>
    </li>`).join('');
}

document.addEventListener('click', e => {
  if (e.target.dataset.fileIdx !== undefined) {
    const prefix = e.target.dataset.prefix || '';
    const input = e.target.closest('.drop-zone').querySelector('input[type=file]');
    const dt = new DataTransfer();
    Array.from(input.files).forEach((f, i) => { if (i !== Number(e.target.dataset.fileIdx)) dt.items.add(f); });
    input.files = dt.files;
    updateFileList(prefix);
  }
});

/* ---------- Drop Zone ---------- */
document.querySelectorAll('.drop-zone').forEach(zone => {
  const prefix = zone.id === 'pub-dropZone' ? 'pub-' : '';
  const fileInput = zone.querySelector('input[type=file]');
  const fileList = zone.querySelector('.file-list');

  zone.addEventListener('click', e => {
    if (e.target.tagName !== 'BUTTON') fileInput.click();
  });
  fileInput.addEventListener('change', () => updateFileList(prefix));

  ['dragenter', 'dragover'].forEach(evt => {
    zone.addEventListener(evt, e => { e.preventDefault(); zone.classList.add('drag-over'); });
  });
  ['dragleave', 'drop'].forEach(evt => {
    zone.addEventListener(evt, e => { e.preventDefault(); zone.classList.remove('drag-over'); });
  });
  zone.addEventListener('drop', e => {
    const dt = e.dataTransfer;
    if (!dt || !dt.files || !dt.files.length) return;
    const merged = new DataTransfer();
    Array.from(fileInput.files).forEach(f => merged.items.add(f));
    Array.from(dt.files).forEach(f => merged.items.add(f));
    fileInput.files = merged.files;
    updateFileList(prefix);
  });
});

/* ---------- Event Listeners ---------- */
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  checkAuth();
});

$('#brandHome').addEventListener('click', e => {
  e.preventDefault();
  if (isAdmin()) switchView('dashboard');
  else window.location.href = '/';
});

$('#themeToggle').addEventListener('click', () => {
  const next = document.body.classList.contains('theme-dark') ? 'light' : 'dark';
  applyTheme(next);
});

$('#logoutBtn').addEventListener('click', logout);

document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    switchView(link.dataset.view);
  });
});

document.querySelectorAll('[data-view-btn]').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.viewBtn));
});

$('#ticketForm').addEventListener('submit', submitTicket);
$('#ticketFormAdmin').addEventListener('submit', submitTicket);

$('#exportBtn').addEventListener('click', exportExcel);
$('#refreshReportBtn').addEventListener('click', loadAnalytics);
$('#reportStatus') && $('#reportStatus').addEventListener('change', loadAnalytics);
$('#reportDepartment') && $('#reportDepartment').addEventListener('change', loadAnalytics);

let searchTimer;
$('#searchBox') && $('#searchBox').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadTickets, 300);
});
$('#filterStatus') && $('#filterStatus').addEventListener('change', loadTickets);
$('#filterPriority') && $('#filterPriority').addEventListener('change', loadTickets);
