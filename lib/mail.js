'use strict';
// Sends the site's emails (password reset links) from one mailbox: by default a Gmail address
// (FORGOT_EMAIL) signing in with a Google app password (FORGOT_EMAIL_APP_PASSWORD). SMTP_HOST
// and SMTP_PORT point it at another provider.
const nodemailer = require('nodemailer');

const PROD = process.env.NODE_ENV === 'production';
const FROM = (process.env.FORGOT_EMAIL || '').trim();
// Google shows app passwords in groups of four ("abcd efgh ijkl mnop"); the spaces aren't part of it.
const PASSWORD = (process.env.FORGOT_EMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
const HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const PORT = Number(process.env.SMTP_PORT || 465);

let transport = null;
function mailer() {
  transport ??= nodemailer.createTransport({
    host: HOST,
    port: PORT,
    // 465 is TLS from the start; other ports upgrade with STARTTLS, which production insists on.
    secure: PORT === 465,
    requireTLS: PROD && PORT !== 465,
    auth: { user: FROM, pass: PASSWORD },
    connectionTimeout: 15e3,
    greetingTimeout: 15e3,
    socketTimeout: 30e3,
  });
  return transport;
}

function enabled() {
  return !!(FROM && PASSWORD);
}

// Signs in to the mail server without sending anything, so the log shows at start whether email works.
async function check() {
  await mailer().verify();
  return `${FROM} through ${HOST}:${PORT}`;
}

async function send({ to, fromName, subject, text, html }) {
  await mailer().sendMail({ from: { name: fromName, address: FROM }, to, subject, text, html });
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function passwordResetMessage({ programName, name, email, link, minutes }) {
  const first = name.split(' ')[0];
  const lasts = minutes === 60 ? 'hour' : minutes % 60 ? `${minutes} minutes` : `${minutes / 60} hours`;
  const text = [
    `Hi ${first},`,
    '',
    `Someone (hopefully you) asked to reset the password for ${email} on ${programName}.`,
    '',
    'Choose a new password here:',
    link,
    '',
    `The link works once, for the next ${lasts}. If you didn't ask, ignore this email: your password stays the same.`,
  ].join('\n');
  const html = `<!doctype html>
<html><body style="margin:0;padding:24px 12px;background:#f3f6f9;font-family:Arial,Helvetica,sans-serif;color:#1d252d">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px">
      <tr><td style="padding:28px 28px 8px;font-size:20px;font-weight:bold;color:#005795">${esc(programName)}</td></tr>
      <tr><td style="padding:8px 28px;font-size:16px;line-height:1.5">
        <p style="margin:0 0 14px">Hi ${esc(first)},</p>
        <p style="margin:0 0 20px">Someone (hopefully you) asked to reset the password for <b>${esc(email)}</b>.</p>
        <p style="margin:0 0 20px"><a href="${esc(link)}" style="display:inline-block;background:#0074c8;color:#ffffff;text-decoration:none;font-weight:bold;padding:13px 22px;border-radius:12px">Choose a new password</a></p>
        <p style="margin:0 0 14px;color:#56606b;font-size:14px">The link works once, for the next ${lasts}. If you didn't ask, ignore this email: your password stays the same.</p>
      </td></tr>
      <tr><td style="padding:8px 28px 26px;font-size:12px;line-height:1.5;color:#7a838c">If the button doesn't work, open this address:<br><a href="${esc(link)}" style="color:#0074c8;word-break:break-all">${esc(link)}</a></td></tr>
    </table>
  </td></tr></table>
</body></html>`;
  return { fromName: programName, subject: `Reset your ${programName} password`, text, html };
}

module.exports = { enabled, check, send, passwordResetMessage };
