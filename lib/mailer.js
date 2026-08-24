const https = require('https');

function fmtDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

function row(label, value) {
  return `
    <tr>
      <td style="padding:8px 10px;border:1px solid #ece4e4;background:#faf6f6;color:#7f0d0d;font-weight:600;width:45%">${escapeHtml(label)}</td>
      <td style="padding:8px 10px;border:1px solid #ece4e4;color:#3a3232">${escapeHtml(String(value))}</td>
    </tr>`;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getFrom() {
  const raw = process.env.MAIL_FROM || '';
  const match = raw.match(/<([^>]+)>/);
  const email = match ? match[1] : raw;
  if (email && email.includes('@')) return { email, name: 'Telecel AskHR' };
  const fallback = process.env.SMTP_USER || 'askhr@telecelgh.com';
  return { email: fallback, name: 'Telecel AskHR' };
}

function getRecipients(requesterEmail) {
  const hrEmails = (process.env.HR_EMAIL || '').split(',').map(e => e.trim()).filter(Boolean);
  return [...new Set([requesterEmail, ...hrEmails])];
}

async function sendEmail(to, subject, html) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.log('[mail] BREVO_API_KEY not set');
    return { skipped: true };
  }
  const from = getFrom();
  const toList = (Array.isArray(to) ? to : [to]).map(addr => {
    const email = addr.match(/<([^>]+)>/) ? addr.match(/<([^>]+)>/)[1] : addr;
    return { email };
  });
  const body = JSON.stringify({
    sender: { email: from.email, name: from.name },
    to: toList,
    subject,
    htmlContent: html
  });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.brevo.com',
      port: 443,
      path: '/v3/smtp/email',
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const parsed = JSON.parse(data || '{}');
          console.log('[mail] Sent to:', toList.map(t => t.email).join(', '), '| status:', res.statusCode);
          resolve(parsed);
        } else {
          const err = JSON.parse(data || '{}');
          console.error('[mail] FAILED | status:', res.statusCode, '| error:', data);
          reject(new Error(err.message || `HTTP ${res.statusCode}`));
        }
      });
    });
    req.on('error', err => {
      console.error('[mail] Request error:', err.message);
      reject(err);
    });
    req.write(body);
    req.end();
  });
}

async function sendTicketNotification(ticket) {
  const from = getFrom();
  const recipients = getRecipients(ticket.email);
  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:600px;margin:auto;border:1px solid #e6e0e0;border-radius:10px;overflow:hidden">
      <div style="background:#d92525;color:#fff;padding:18px 24px">
        <strong style="font-size:18px">Telecel AskHR - New Ticket Submitted</strong>
      </div>
      <div style="padding:24px">
        <h2 style="color:#7f0d0d;margin:0 0 6px">${escapeHtml(ticket.subject)}</h2>
        <p style="color:#5c5252">A new HR request has been submitted and requires attention.</p>
        <table style="border-collapse:collapse;width:100%">
          ${row('Ticket Number', ticket.ticketRef)}
          ${row('Date', new Date(ticket.createdAt).toLocaleDateString('en-GB'))}
          ${row('Time', new Date(ticket.createdAt).toLocaleTimeString('en-GB'))}
          ${row('Requester', ticket.name)}
          ${row('Email', ticket.email)}
          ${row('Phone', ticket.phone)}
          ${row('Function', ticket.department)}
          ${row('Category', ticket.category)}
          ${row('Priority', ticket.priority)}
          ${row('Status', ticket.status)}
        </table>
        <p style="margin:14px 0 4px;font-weight:700;color:#7f0d0d">Details</p>
        <p style="color:#3a3232;background:#faf6f6;padding:12px;border-radius:8px">${escapeHtml(ticket.description)}</p>
        <p style="color:#5c5252">Please quote ticket number <strong>${ticket.ticketRef}</strong> in any follow-up correspondence.</p>
        <p style="margin-top:20px;font-size:13px;color:#9d9292">This is an automated notification from the Telecel AskHR platform.</p>
      </div>
    </div>`;

  return sendEmail(recipients, `[AskHR] New Ticket ${ticket.ticketRef} - ${ticket.subject}`, html);
}

async function sendResolutionNotification(ticket, oldStatus) {
  const from = getFrom();
  const recipients = getRecipients(ticket.email);
  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:600px;margin:auto;border:1px solid #e6e0e0;border-radius:10px;overflow:hidden">
      <div style="background:#d92525;color:#fff;padding:18px 24px">
        <strong style="font-size:18px">Telecel AskHR - Ticket ${ticket.status}</strong>
      </div>
      <div style="padding:24px">
        <p style="color:#1c7c3c;font-weight:700">The HR request has been ${ticket.status.toLowerCase()}.</p>
        <table style="border-collapse:collapse;width:100%">
          ${row('Ticket Number', ticket.ticketRef)}
          ${row('Subject', ticket.subject)}
          ${row('Requester', ticket.name)}
          ${row('Email', ticket.email)}
          ${row('Phone', ticket.phone)}
          ${row('Function', ticket.department)}
          ${row('Previous Status', oldStatus)}
          ${row('Current Status', ticket.status)}
          ${row('Last Updated', fmtDateTime(ticket.updatedAt))}
        </table>
        ${ticket.resolution ? `<p style="margin:14px 0 4px;font-weight:700;color:#7f0d0d">Resolution note</p>
        <p style="color:#3a3232;background:#faf6f6;padding:12px;border-radius:8px">${escapeHtml(ticket.resolution)}</p>` : ''}
        <p style="color:#5c5252">You can follow up by replying to this email and quoting your ticket number.</p>
        <p style="margin-top:20px;font-size:13px;color:#9d9292">This is an automated notification from the Telecel AskHR platform.</p>
      </div>
    </div>`;

  return sendEmail(recipients, `[AskHR] ${ticket.ticketRef} is now "${ticket.status}"`, html);
}

async function testSMTP() {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return { ok: false, error: 'BREVO_API_KEY not set' };
  try {
    const from = getFrom();
    const result = await sendEmail(
      [process.env.HR_EMAIL || from.email],
      '[AskHR] Email test',
      '<div style="font-family:Arial,sans-serif;padding:20px"><h2 style="color:#d92525">Telecel AskHR</h2><p>Email notifications are working. If you received this, the system is configured correctly.</p></div>'
    );
    return { ok: true, from: from.email, messageId: result.messageId };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { sendTicketNotification, sendResolutionNotification, testSMTP };
