const { Resend } = require('resend');

let resendClient = null;

function getClient() {
  if (resendClient) return resendClient;
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log('[mail] RESEND_API_KEY not set - email disabled');
    return null;
  }
  resendClient = new Resend(apiKey);
  console.log('[mail] Resend client initialised');
  return resendClient;
}

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
  if (email && email.includes('@')) return email;
  return 'onboarding@resend.dev';
}

function getRecipients(requesterEmail) {
  const hrEmails = (process.env.HR_EMAIL || '').split(',').map(e => e.trim()).filter(Boolean);
  return [...new Set([requesterEmail, ...hrEmails])];
}

async function sendTicketNotification(ticket) {
  const client = getClient();
  if (!client) {
    console.log('[mail:skip] Resend not configured - would notify for ticket', ticket.ticketRef);
    return { skipped: true };
  }
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

  const { data, error } = await client.emails.send({
    from,
    to: recipients,
    subject: `[AskHR] New Ticket ${ticket.ticketRef} - ${ticket.subject}`,
    html
  });
  if (error) {
    console.error('[mail] Submission FAILED:', error.message);
    throw new Error(error.message);
  }
  console.log('[mail] Submission sent to:', recipients.join(', '), '| id:', data && data.id);
  return data;
}

async function sendResolutionNotification(ticket, oldStatus) {
  const client = getClient();
  if (!client) {
    console.log('[mail:skip] Resend not configured - would notify resolution for ticket', ticket.ticketRef);
    return { skipped: true };
  }
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

  const { data, error } = await client.emails.send({
    from,
    to: recipients,
    subject: `[AskHR] ${ticket.ticketRef} is now "${ticket.status}"`,
    html
  });
  if (error) {
    console.error('[mail] Resolution FAILED:', error.message);
    throw new Error(error.message);
  }
  console.log('[mail] Resolution sent to:', recipients.join(', '), '| id:', data && data.id);
  return data;
}

async function testSMTP() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: 'RESEND_API_KEY not set' };
  try {
    const client = new Resend(apiKey);
    const { data, error } = await client.emails.send({
      from: getFrom(),
      to: [process.env.HR_EMAIL || 'sir.michaelawukugh@gmail.com'],
      subject: '[AskHR] SMTP Test',
      html: '<p>This is a test email from the Telecel AskHR platform. If you received this, email notifications are working.</p>'
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: data && data.id, from: getFrom() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { sendTicketNotification, sendResolutionNotification, testSMTP };
