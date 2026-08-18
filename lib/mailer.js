const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  if (!host) return null;
  transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: user
      ? { user, pass: process.env.SMTP_PASS || '' }
      : undefined
  });
  return transporter;
}

function fmtDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
}

async function sendTicketToHR(ticket) {
  const transporter = getTransporter();
  if (!transporter) {
    console.log('[mail:skip] SMTP not configured - would email HR for ticket', ticket.ticketRef);
    return { skipped: true };
  }
  const from = process.env.MAIL_FROM || process.env.SMTP_USER || 'noreply@telecelgh.com';
  const hrTo = (process.env.HR_EMAIL || 'hrsupport@telecelgh.com').split(',');
  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:600px;margin:auto;border:1px solid #e6e0e0;border-radius:10px;overflow:hidden">
      <div style="background:#d92525;color:#fff;padding:18px 24px">
        <strong style="font-size:18px">Telecel AskHR - New Ticket</strong>
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
        <p style="margin-top:20px;font-size:13px;color:#9d9292">This is an automated notification from the Telecel AskHR platform.</p>
      </div>
    </div>`;

  return transporter.sendMail({
    from,
    to: hrTo.join(','),
    subject: `[AskHR] New Ticket ${ticket.ticketRef} - ${ticket.subject}`,
    html
  });
}

async function sendConfirmationToRequester(ticket) {
  const transporter = getTransporter();
  if (!transporter) {
    console.log('[mail:skip] SMTP not configured - would email requester for ticket', ticket.ticketRef);
    return { skipped: true };
  }
  const from = process.env.MAIL_FROM || process.env.SMTP_USER || 'noreply@telecelgh.com';
  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:600px;margin:auto;border:1px solid #e6e0e0;border-radius:10px;overflow:hidden">
      <div style="background:#d92525;color:#fff;padding:18px 24px">
        <strong style="font-size:18px">Telecel AskHR - Request Received</strong>
      </div>
      <div style="padding:24px">
        <p>Hello <strong>${escapeHtml(ticket.name)}</strong>,</p>
        <p>We have received your HR request and our support team will respond shortly.</p>
        <table style="border-collapse:collapse;width:100%">
          ${row('Ticket Number', ticket.ticketRef)}
          ${row('Date Submitted', new Date(ticket.createdAt).toLocaleDateString('en-GB'))}
          ${row('Time Submitted', new Date(ticket.createdAt).toLocaleTimeString('en-GB'))}
          ${row('Subject', ticket.subject)}
          ${row('Category', ticket.category)}
          ${row('Priority', ticket.priority)}
          ${row('Status', ticket.status)}
        </table>
        <p style="margin:14px 0 4px;font-weight:700;color:#7f0d0d">Your request details</p>
        <p style="color:#3a3232;background:#faf6f6;padding:12px;border-radius:8px">${escapeHtml(ticket.description)}</p>
        <p style="color:#5c5252">Please quote your ticket number <strong>${ticket.ticketRef}</strong> in any follow-up correspondence.</p>
        <p style="margin-top:20px;font-size:13px;color:#9d9292">This is an automated notification from the Telecel AskHR platform.</p>
      </div>
    </div>`;

  return transporter.sendMail({
    from,
    to: ticket.email,
    subject: `[AskHR] We received your request ${ticket.ticketRef}`,
    html
  });
}

async function sendStatusUpdate(ticket, oldStatus) {
  const transporter = getTransporter();
  if (!transporter) {
    console.log('[mail:skip] SMTP not configured - would email status update for ticket', ticket.ticketRef);
    return { skipped: true };
  }
  const from = process.env.MAIL_FROM || process.env.SMTP_USER || 'noreply@telecelgh.com';
  const statusTone = ticket.status === 'Resolved' || ticket.status === 'Closed'
    ? `<p style="color:#1c7c3c;font-weight:700">Great news! Your request has been ${ticket.status.toLowerCase()}.</p>`
    : `<p style="color:#5c5252">There has been an update on your request.</p>`;
  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:600px;margin:auto;border:1px solid #e6e0e0;border-radius:10px;overflow:hidden">
      <div style="background:#d92525;color:#fff;padding:18px 24px">
        <strong style="font-size:18px">Telecel AskHR - Status Update</strong>
      </div>
      <div style="padding:24px">
        <p>Hello <strong>${escapeHtml(ticket.name)}</strong>,</p>
        ${statusTone}
        <table style="border-collapse:collapse;width:100%">
          ${row('Ticket Number', ticket.ticketRef)}
          ${row('Subject', ticket.subject)}
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

  return transporter.sendMail({
    from,
    to: ticket.email,
    subject: `[AskHR] ${ticket.ticketRef} is now "${ticket.status}"`,
    html
  });
}

async function sendStatusUpdateToHR(ticket, oldStatus) {
  const transporter = getTransporter();
  if (!transporter) return { skipped: true };
  const from = process.env.MAIL_FROM || process.env.SMTP_USER || 'noreply@telecelgh.com';
  const hrTo = (process.env.HR_EMAIL || 'hrsupport@telecelgh.com').split(',');
  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:600px;margin:auto;border:1px solid #e6e0e0;border-radius:10px;overflow:hidden">
      <div style="background:#d92525;color:#fff;padding:18px 24px">
        <strong style="font-size:18px">Telecel AskHR - Ticket Status Update</strong>
      </div>
      <div style="padding:24px">
        <p>A ticket status has been updated:</p>
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
        <p style="margin-top:20px;font-size:13px;color:#9d9292">This is an automated notification from the Telecel AskHR platform.</p>
      </div>
    </div>`;

  return transporter.sendMail({
    from,
    to: hrTo.join(','),
    subject: `[AskHR] ${ticket.ticketRef} status changed to "${ticket.status}"`,
    html
  });
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

module.exports = { sendTicketToHR, sendConfirmationToRequester, sendStatusUpdate, sendStatusUpdateToHR };
