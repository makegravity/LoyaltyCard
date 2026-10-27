'use strict';
// Rotating membership codes.
//
// A code is   BM1.<member number>.<window>.<signature>
// where <window> counts periods of N seconds since 1970 and <signature> is an
// HMAC of the member number and window, keyed with a secret only the server holds.
// The phone never sees the secret, so it cannot make future codes, and a
// screenshot stops working once its window has passed.
const { hmac, safeEqual } = require('./security');

const PREFIX = 'BM1';
const SIG_LENGTH = 12;

function windowAt(timeMs, periodSeconds) {
  return Math.floor(timeMs / 1000 / periodSeconds);
}

function codeFor(member, window) {
  const sig = hmac(member.qrSecret, `${member.memberNumber}.${window}`).slice(0, SIG_LENGTH);
  return `${PREFIX}.${member.memberNumber}.${window}.${sig}`;
}

function current(member, periodSeconds, now = Date.now()) {
  const window = windowAt(now, periodSeconds);
  return {
    code: codeFor(member, window),
    window,
    expiresAt: (window + 1) * periodSeconds * 1000,
  };
}

function parse(code) {
  const match = /^BM1\.(\d{4,10})\.(\d{1,12})\.([A-Za-z0-9_-]{12})$/.exec(String(code || '').trim());
  if (!match) return null;
  return { memberNumber: Number(match[1]), window: Number(match[2]), sig: match[3] };
}

// 'ok', 'bad_signature' or 'expired'. The window before the current one is still
// accepted, so a code that rotates while the cashier is scanning still works.
function check(member, parsed, periodSeconds, now = Date.now()) {
  const expected = codeFor(member, parsed.window).split('.')[3];
  if (!safeEqual(expected, parsed.sig)) return 'bad_signature';
  const nowWindow = windowAt(now, periodSeconds);
  if (parsed.window > nowWindow || parsed.window < nowWindow - 1) return 'expired';
  return 'ok';
}

module.exports = { current, parse, check, windowAt };
