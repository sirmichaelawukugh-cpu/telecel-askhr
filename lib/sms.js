const https = require('https');
const http = require('http');

const MNOTIFY_API = 'https://api.mnotify.com/api/sms/quick';

function formatPhone(phone) {
  let p = phone.replace(/[\s\-()]/g, '');
  if (p.startsWith('0')) p = '233' + p.slice(1);
  if (p.startsWith('+233')) p = p.slice(1);
  if (!p.startsWith('233')) p = '233' + p;
  return p;
}

async function sendSMS(phone, message) {
  const apiKey = process.env.MNOTIFY_API_KEY;
  const sender = process.env.MNOTIFY_SENDER_ID || 'AskHR';
  if (!apiKey) {
    console.log('[sms:skip] MNOTIFY_API_KEY not set - would send to', phone);
    return { skipped: true };
  }
  const to = formatPhone(phone);
  const payload = JSON.stringify({
    sender,
    message,
    recipients: [to]
  });
  const url = new URL(MNOTIFY_API + '?key=' + encodeURIComponent(apiKey));
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.status === 'success' || data.code === '2000') {
            resolve(data);
          } else {
            reject(new Error(data.message || 'SMS failed'));
          }
        } catch (e) {
          reject(new Error('SMS response parse error'));
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function sendTicketCreatedSMS(ticket) {
  const msg = `Hi ${ticket.name}, your HR request ${ticket.ticketRef} has been received. Subject: ${ticket.subject}. You'll be notified when it's resolved.`;
  return sendSMS(ticket.phone, msg).catch(err => console.error('[sms:create]', err.message));
}

async function sendTicketResolvedSMS(ticket) {
  const msg = `Hi ${ticket.name}, your HR request ${ticket.ticketRef} has been ${ticket.status.toLowerCase()}. ${ticket.resolution ? 'Note: ' + ticket.resolution : ''} - Telecel AskHR`;
  return sendSMS(ticket.phone, msg).catch(err => console.error('[sms:status]', err.message));
}

async function sendStatusUpdateToHRSMS(ticket, oldStatus) {
  const hrPhone = process.env.HR_PHONE || '';
  if (!hrPhone) return { skipped: true };
  const msg = `[AskHR] Ticket ${ticket.ticketRef} status changed from ${oldStatus} to ${ticket.status}. Requester: ${ticket.name}. Subject: ${ticket.subject}`;
  return sendSMS(hrPhone, msg).catch(err => console.error('[sms:hr]', err.message));
}

module.exports = { sendSMS, sendTicketCreatedSMS, sendTicketResolvedSMS, sendStatusUpdateToHRSMS };
