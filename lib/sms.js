const https = require('https');

const ARKESEL_API = 'https://sms.arkesel.com/api/v2/sms/send';

function formatPhone(phone) {
  let p = phone.replace(/[\s\-()]/g, '');
  if (p.startsWith('0')) p = '+233' + p.slice(1);
  else if (p.startsWith('233')) p = '+' + p;
  else if (!p.startsWith('+')) p = '+233' + p;
  return p;
}

function post(url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => {
        try {
          const json = JSON.parse(buf);
          resolve(json);
        } catch (e) {
          reject(new Error('SMS parse error: ' + buf.slice(0, 200)));
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function sendSMS(phone, message) {
  const apiKey = process.env.ARKESEL_API_KEY;
  const sender = process.env.ARKESEL_SENDER_ID || 'AskHR';
  if (!apiKey) {
    console.log('[sms:skip] ARKESEL_API_KEY not set - would send to', phone);
    return { skipped: true };
  }
  const to = formatPhone(phone);
  const res = await post(ARKESEL_API, {
    'api-key': apiKey,
    'Content-Type': 'application/json'
  }, {
    sender,
    message,
    recipients: [to]
  });
  if (res.status === 'success') {
    return res;
  }
  throw new Error(res.message || res.error || 'Arkesel SMS failed');
}

async function sendTicketCreatedSMS(ticket) {
  const msg = `Hi ${ticket.name}, your HR request ${ticket.ticketRef} has been received. Subject: ${ticket.subject}. You will be notified when it is resolved. - Telecel AskHR`;
  return sendSMS(ticket.phone, msg).catch(err => console.error('[sms:create]', err.message));
}

async function sendTicketResolvedSMS(ticket) {
  const msg = `Hi ${ticket.name}, your HR request ${ticket.ticketRef} has been ${ticket.status.toLowerCase()}. ${ticket.resolution ? 'Note: ' + ticket.resolution : ''} - Telecel AskHR`;
  return sendSMS(ticket.phone, msg).catch(err => console.error('[sms:status]', err.message));
}

async function sendStatusUpdateToHRSMS(ticket, oldStatus) {
  const hrPhone = process.env.HR_PHONE || '';
  if (!hrPhone) return { skipped: true };
  const msg = `[AskHR] Ticket ${ticket.ticketRef} updated from ${oldStatus} to ${ticket.status}. Requester: ${ticket.name}. Subject: ${ticket.subject}`;
  return sendSMS(hrPhone, msg).catch(err => console.error('[sms:hr]', err.message));
}

module.exports = { sendSMS, sendTicketCreatedSMS, sendTicketResolvedSMS, sendStatusUpdateToHRSMS };
