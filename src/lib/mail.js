'use strict';
/**
 * Outbound email over SMTP (cPanel mail on HostyAfrica, Microsoft 365, or any provider).
 * Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and MAIL_FROM. Without them, configured()
 * is false and the app offers the download-and-send-yourself route instead.
 * Every send is written to email_log.
 */
const nodemailer = require('nodemailer');
const db = require('./db');

let transport = null;
function configured() { return !!(process.env.SMTP_HOST && process.env.MAIL_FROM); }
function getTransport() {
  if (!transport) {
    const port = Number(process.env.SMTP_PORT) || 587;
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST, port, secure: port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  return transport;
}

/** msg: {template, to, cc, replyTo, subject, text, attachments, relatedType, relatedId} */
async function send(msg) {
  if (!configured()) { const e = new Error('Email is not set up on this server.'); e.code = 'mail_not_configured'; throw e; }
  try {
    const info = await getTransport().sendMail({
      from: process.env.MAIL_FROM, to: msg.to, cc: msg.cc || undefined, replyTo: msg.replyTo || undefined,
      subject: msg.subject, text: msg.text, attachments: msg.attachments,
    });
    await log(msg, 'sent', info.messageId, null);
    return info;
  } catch (e) {
    await log(msg, 'failed', null, e.message.slice(0, 500)).catch(() => {});
    const err = new Error('The email server refused the message. Check the address and try again.'); err.code = 'mail_failed'; throw err;
  }
}
function log(msg, status, providerId, error) {
  return db.query(
    `INSERT INTO email_log (template, to_address, cc, subject, related_type, related_id, provider_id, status, error) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [msg.template, msg.to, msg.cc || null, msg.subject, msg.relatedType || null, msg.relatedId || null, providerId, status, error]
  );
}

module.exports = { configured, send };
