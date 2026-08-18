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

function requireAuth() {
  if (!getToken()) { window.location.href = '/login.html'; return false; }
  state.user = getUser();
  applyRoleUI();
  return true;
}

function applyRoleUI() {
  const adminOnly = document.querySelectorAll('[data-admin]');
  adminOnly.forEach(el => { el.style.display = isAdmin() ? '' : 'none'; });
  const userLabel = $('#userLabel');
  if (userLabel) userLabel.textContent = state.user ? state.user.name + ' (' + state.user.role + ')' : '';
}

function logout() {
  localStorage.removeItem('askhr-token');
  localStorage.removeItem('askhr-user');
  window.location.href = '/login.html';
}

/* ---------- Theme (day / night) ---------- */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const btn = $('#themeToggle');
  if (btn) btn.textContent = theme === 'dark' ? '\u2600' : '\u263E';
  localStorage.setItem('askhr-theme', theme);
  refreshChartColors();
}

function initTheme() {
  const saved = localStorage.getItem('askhr-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved || (prefersDark ? 'dark' : 'light'));
}

/* ---------- Navigation ---------- */
function switchView(view) {
  state.currentView = view;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const target = document.getElementById(view === 'new' ? 'new-ticket' : view);
  if (target) target.classList.add('active');
  document.querySelectorAll('.nav-link').forEach(l =>
    l.classList.toggle('active', l.dataset.view === view)
  );
  if (view === 'dashboard') loadStats();
  if (view === 'tickets') loadTickets();
  if (view === 'reports') loadAnalytics();
}

function toast(msg, type = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast ' + type;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 3200);
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

function reportParams() {
  const params = new URLSearchParams();
  const s = $('#reportStatus').value;
  const p = $('#reportPriority').value;
  const d = $('#reportDepartment').value;
  if (s) params.set('status', s);
  if (p) params.set('priority', p);
  if (d) params.set('department', d);
  return params;
}

/* ---------- Dashboard ---------- */
async function loadStats() {
  if (!isAdmin()) {
    $('#statTotal').textContent = '-';
    $('#statOpen').textContent = '-';
    $('#statProgress').textContent = '-';
    $('#statResolved').textContent = '-';
    $('#statClosed').textContent = '-';
    return;
  }
  try {
    const s = await api('/api/stats');
    $('#statTotal').textContent = s.total;
    $('#statOpen').textContent = s.open;
    $('#statProgress').textContent = s.inProgress;
    $('#statResolved').textContent = s.resolved;
    $('#statClosed').textContent = s.closed;
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

function esc(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

const IMG_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico'];

function renderAttachments(atts) {
  if (!Array.isArray(atts) || !atts.length) return '';
  return `
    <div class="attachment-list">
      ${atts.map(a => {
        const isImg = IMG_EXTS.includes((a.ext || '').toLowerCase());
        return `
          <a class="attachment-chip" href="${esc(a.path)}" target="_blank" rel="noopener" title="Open ${esc(a.name)}">
            ${isImg
              ? `<img class="attachment-thumb" src="${esc(a.path)}" alt="" />`
              : `<span class="attachment-icon">${esc(a.ext || 'file')}</span>`}
            <span class="attachment-name">${esc(a.name)}</span>
            <span class="attachment-size">${formatSize(a.size)}</span>
          </a>`;
      }).join('')}
    </div>`;
}

function renderTickets() {
  const list = $('#ticketList');
  if (!state.tickets.length) {
    list.innerHTML = `<div class="empty-state"><strong>No tickets found</strong>Submit a new request to get started.</div>`;
    return;
  }
  list.innerHTML = state.tickets.map(t => {
    const statusClass = 'status-' + t.status.replace(/\s+/g, '');
    const statusActions = t.status === 'Open'
      ? `<button class="btn btn-sm btn-primary" data-act="start" data-id="${t.id}">Start Work</button>`
      : t.status === 'In Progress'
        ? `<button class="btn btn-sm btn-success" data-act="resolve" data-id="${t.id}">Mark Resolved</button>`
        : t.status === 'Resolved'
          ? `<button class="btn btn-sm btn-outline" data-act="close" data-id="${t.id}">Close</button>`
          : '';
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
          <button class="btn btn-sm btn-danger" data-act="delete" data-id="${t.id}">Delete</button>
        </div>
      </div>`;
  }).join('');
}

async function submitTicket(e) {
  e.preventDefault();
  const fd = new FormData();
  fd.append('name', $('#name').value.trim());
  fd.append('email', $('#email').value.trim());
  fd.append('department', $('#department').value);
  fd.append('category', $('#category').value);
  fd.append('subject', $('#subject').value.trim());
  fd.append('description', $('#description').value.trim());
  fd.append('priority', $('#priority').value);
  for (const file of $('#attachments').files) {
    fd.append('attachments', file);
  }
  const btn = $('#ticketForm button[type="submit"]');
  btn.disabled = true;
  try {
    const res = await fetch('/api/tickets', { method: 'POST', body: fd, headers: { 'Authorization': 'Bearer ' + getToken() } });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Request failed');
    }
    const ticket = await res.json();
    const msg = `Ticket ${ticket.ticketRef} submitted. Confirmation email sent to ${ticket.email}` +
      (ticket.attachments && ticket.attachments.length ? ` (${ticket.attachments.length} attachment${ticket.attachments.length > 1 ? 's' : ''})` : '');
    toast(msg, 'success');
    $('#ticketForm').reset();
    clearFileList();
    switchView('tickets');
    loadStats();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

async function updateTicket(id, patch) {
  try {
    await api(`/api/tickets/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch)
    });
    toast('Ticket updated', 'success');
    loadTickets();
    loadStats();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function deleteTicket(id) {
  const t = state.tickets.find(x => x.id === Number(id));
  if (!confirm(`Delete ticket ${t ? t.ticketRef : ''}? This cannot be undone.`)) return;
  try {
    await api(`/api/tickets/${id}`, { method: 'DELETE' });
    toast('Ticket deleted', 'success');
    loadTickets();
    loadStats();
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ---------- Analytics & Reports ---------- */
const RED = { light: '#e02d2d', dark: '#ff4444' };
const palette = ['#e02d2d', '#c11d1d', '#7f0d0d', '#ff7a7a', '#f4a0a0', '#a94444'];

function chartTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark';
}

function baseColors() {
  const dark = chartTheme();
  return {
    grid: dark ? '#4a4242' : '#ece4e4',
    label: dark ? '#b3a5a5' : '#5c5252',
    bar: dark ? '#ff4444' : '#d92525',
    barAlt: dark ? '#7f0d0d' : '#7f0d0d'
  };
}

function refreshChartColors() {
  Object.values(state.charts).forEach(c => {
    if (!c) return;
    const colors = baseColors();
    c.options.scales.x.ticks.color = colors.label;
    c.options.scales.x.grid.color = colors.grid;
    c.options.scales.y.ticks.color = colors.label;
    c.options.scales.y.grid.color = colors.grid;
    c.options.plugins.legend.labels.color = colors.label;
    c.update();
  });
}

function makeChart(key, canvasId, config) {
  if (state.charts[key]) {
    state.charts[key].data = config.data;
    state.charts[key].options = Object.assign(state.charts[key].options, config.options);
    state.charts[key].update();
    return state.charts[key];
  }
  state.charts[key] = new Chart($(canvasId), config);
  return state.charts[key];
}

async function loadAnalytics() {
  try {
    const a = await api('/api/analytics?' + reportParams().toString());
    const colors = baseColors();
    const dark = chartTheme();

    $('#rptTotal').textContent = a.total;
    $('#rptOpen').textContent = a.byStatus['Open'] || 0;
    $('#rptClosed').textContent = a.byStatus['Closed'] || 0;
    $('#rptHigh').textContent = (a.byPriority['High'] || 0) + (a.byPriority['Urgent'] || 0);
    $('#rptAvg').textContent = a.avgResolutionDays === null ? '-' : a.avgResolutionDays;

    const statusData = { Open: 0, 'In Progress': 0, Resolved: 0, Closed: 0 };
    Object.keys(statusData).forEach(k => { if (a.byStatus[k]) statusData[k] = a.byStatus[k]; });

    makeChart('status', '#chartStatus', {
      type: 'doughnut',
      data: {
        labels: Object.keys(statusData),
        datasets: [{
          data: Object.values(statusData),
          backgroundColor: [RED.light, '#e0821c', '#2e9e56', '#9d9292']
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: colors.label, boxWidth: 14 } } }
      }
    });

    makeChart('dept', '#chartFunction', {
      type: 'bar',
      data: {
        labels: Object.keys(a.byDepartment),
        datasets: [{ label: 'Tickets', data: Object.values(a.byDepartment), backgroundColor: colors.bar, borderRadius: 6 }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: colors.label }, grid: { color: colors.grid } },
          y: { ticks: { color: colors.label, autoSkip: false }, grid: { display: false } }
        }
      }
    });

    makeChart('priority', '#chartPriority', {
      type: 'pie',
      data: {
        labels: Object.keys(a.byPriority),
        datasets: [{
          data: Object.values(a.byPriority),
          backgroundColor: ['#2e9e56', '#e0821c', RED.light, '#7f0d0d']
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: colors.label, boxWidth: 14 } } }
      }
    });

    makeChart('category', '#chartCategory', {
      type: 'bar',
      data: {
        labels: Object.keys(a.byCategory),
        datasets: [{ label: 'Tickets', data: Object.values(a.byCategory), backgroundColor: palette.slice(0, Math.max(Object.keys(a.byCategory).length, 1)), borderRadius: 6 }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: colors.label }, grid: { color: colors.grid } },
          y: { ticks: { color: colors.label, autoSkip: false }, grid: { display: false } }
        }
      }
    });

    makeChart('trend', '#chartTrend', {
      type: 'line',
      data: {
        labels: a.byDay.map(d => d.date),
        datasets: [{
          label: 'Requests per day',
          data: a.byDay.map(d => d.count),
          borderColor: RED.light,
          backgroundColor: 'rgba(224,45,45,0.12)',
          fill: true,
          tension: 0.35,
          pointRadius: 3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: colors.label } } },
        scales: {
          x: { ticks: { color: colors.label }, grid: { color: colors.grid } },
          y: { ticks: { color: colors.label }, grid: { color: colors.grid } }
        }
      }
    });
  } catch (e) {
    toast(e.message, 'error');
  }
}

function exportExcel() {
  const url = '/api/report/excel?' + reportParams().toString();
  const a = document.createElement('a');
  a.href = url;
  a.download = 'AskHR_ticket_report.xlsx';
  a.setAttribute('data-auth-download', 'true');
  document.body.appendChild(a);
  a.click();
  a.remove();
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

/* ---------- Events ---------- */
document.addEventListener('click', e => {
  const navLink = e.target.closest('.nav-link[data-view]');
  if (navLink) {
    e.preventDefault();
    return switchView(navLink.dataset.view);
  }

  const viewBtn = e.target.closest('[data-view-btn]');
  if (viewBtn) return switchView(viewBtn.dataset.viewBtn);

  const act = e.target.closest('[data-act]');
  if (!act) return;
  const id = act.dataset.id;
  if (act.dataset.act === 'start') updateTicket(id, { status: 'In Progress' });
  if (act.dataset.act === 'resolve') updateTicket(id, { status: 'Resolved' });
  if (act.dataset.act === 'close') updateTicket(id, { status: 'Closed' });
  if (act.dataset.act === 'delete') deleteTicket(id);
});

document.addEventListener('click', e => {
  if (e.target.closest('[data-open-help]')) {
    alert('The Telecel AskHR Support Desk can help with:\n\n• Leave and absence requests\n• Payroll and compensation questions\n• Benefits enrollment and changes\n• Onboarding and offboarding\n• Company policy clarification\n• IT and equipment requests\n\nSubmit a ticket and our HR team responds within 1 business day. You will receive a confirmation email with your ticket number.');
  }
});

$('#themeToggle').addEventListener('click', () => {
  const next = chartTheme() ? 'light' : 'dark';
  applyTheme(next);
});

$('#brandHome').addEventListener('click', e => {
  e.preventDefault();
  switchView('dashboard');
});

$('#ticketForm').addEventListener('submit', submitTicket);
$('#exportBtn').addEventListener('click', exportExcel);
$('#refreshReportBtn').addEventListener('click', loadAnalytics);
$('#reportStatus').addEventListener('change', loadAnalytics);
$('#reportPriority').addEventListener('change', loadAnalytics);
$('#reportDepartment').addEventListener('change', loadAnalytics);

/* ---------- Attachments ---------- */
function updateFileList() {
  const list = $('#fileList');
  const files = Array.from($('#attachments').files || []);
  if (!files.length) { list.innerHTML = ''; return; }
  list.innerHTML = files.map((f, i) => `
    <li>
      <span class="file-name">${esc(f.name)}</span>
      <span class="file-size">${formatSize(f.size)}</span>
      <button type="button" class="file-remove" data-file-index="${i}" aria-label="Remove file">&times;</button>
    </li>`).join('');
}

function clearFileList() {
  $('#attachments').value = '';
  updateFileList();
}

document.addEventListener('click', e => {
  const removeBtn = e.target.closest('.file-remove');
  if (!removeBtn) return;
  const dt = new DataTransfer();
  Array.from($('#attachments').files).forEach((f, i) => {
    if (i !== Number(removeBtn.dataset.fileIndex)) dt.items.add(f);
  });
  $('#attachments').files = dt.files;
  updateFileList();
});

$('#attachments').addEventListener('change', updateFileList);

const dropZone = $('#dropZone');
dropZone.addEventListener('click', e => {
  if (e.target.closest('.file-list') || e.target.closest('.file-remove')) return;
  $('#attachments').click();
});
['dragenter', 'dragover'].forEach(ev => dropZone.addEventListener(ev, e => {
  e.preventDefault();
  dropZone.classList.add('dragging');
}));
['dragleave', 'drop'].forEach(ev => dropZone.addEventListener(ev, e => {
  e.preventDefault();
  dropZone.classList.remove('dragging');
}));
dropZone.addEventListener('drop', e => {
  const dt = e.dataTransfer;
  if (!dt || !dt.files || !dt.files.length) return;
  const merged = new DataTransfer();
  Array.from($('#attachments').files).forEach(f => merged.items.add(f));
  Array.from(dt.files).forEach(f => merged.items.add(f));
  $('#attachments').files = merged.files;
  updateFileList();
});

let searchTimer;
$('#searchBox').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadTickets, 300);
});
$('#filterStatus').addEventListener('change', loadTickets);
$('#filterPriority').addEventListener('change', loadTickets);

$('#logoutBtn').addEventListener('click', logout);

if (!requireAuth()) { throw new Error('Not authenticated'); }

initTheme();
loadStats();
