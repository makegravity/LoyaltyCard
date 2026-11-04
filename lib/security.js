'use strict';
const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);

let secret = null;
let cookieName = 'bm_session';
let cookieSecure = false;

// `mediaSecret` signs short-lived photo links. With `secure`, the session cookie is
// Secure and uses the __Host- prefix, so it is only ever sent over https to this host.
function init({ mediaSecret, secure }) {
  secret = Buffer.from(mediaSecret, 'hex');
  cookieSecure = !!secure;
  cookieName = cookieSecure ? '__Host-bm_session' : 'bm_session';
}

function hmac(key, value) {
  return crypto.createHmac('sha256', key).update(value).digest('base64url');
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function randomId(bytes = 12) {
  return crypto.randomBytes(bytes).toString('base64url');
}

// ---------- passwords ----------

// scrypt N=2^14, r=8, p=5: one of OWASP's recommended scrypt settings.
const SCRYPT = { N: 16384, r: 8, p: 5 };
const KEY_LENGTH = 64;

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LENGTH, { ...SCRYPT, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

// Reads both formats: scrypt$N$r$p$salt$hash, and the prototype's scrypt$salt$hash (N=2^14, r=8, p=1).
function parseHash(stored) {
  const parts = String(stored || '').split('$');
  if (parts[0] !== 'scrypt') return null;
  if (parts.length === 3) return { N: 16384, r: 8, p: 1, salt: parts[1], hash: parts[2] };
  if (parts.length === 6) return { N: Number(parts[1]), r: Number(parts[2]), p: Number(parts[3]), salt: parts[4], hash: parts[5] };
  return null;
}

async function verifyPassword(password, stored) {
  const h = parseHash(stored);
  if (!h) return false;
  const actual = await scrypt(password, Buffer.from(h.salt, 'base64url'), KEY_LENGTH, {
    N: h.N,
    r: h.r,
    p: h.p,
    maxmem: 64 * 1024 * 1024,
  });
  return safeEqual(actual.toString('base64url'), h.hash);
}

// True when a stored hash uses weaker settings than today's, so it is redone at sign-in.
function needsRehash(stored) {
  const h = parseHash(stored);
  return !h || h.N !== SCRYPT.N || h.r !== SCRYPT.r || h.p !== SCRYPT.p;
}

// Passwords an admin hands to staff: easy to read out and type on a phone, ~59 bits.
function readablePassword() {
  const letters = 'abcdefghjkmnpqrstuvwxyz23456789';
  const group = () => Array.from({ length: 4 }, () => letters[crypto.randomInt(letters.length)]).join('');
  return `${group()}-${group()}-${group()}`;
}

// ---------- sessions ----------

// The cookie holds a random token; the database keeps only its hash, so a leaked
// database copy can't be used to sign in.
function newToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function sessionCookie(token, maxAgeSeconds) {
  return `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${cookieSecure ? '; Secure' : ''}`;
}

function clearedCookie() {
  return `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${cookieSecure ? '; Secure' : ''}`;
}

function readSessionToken(cookieHeader) {
  const match = new RegExp(`(?:^|;\\s*)${cookieName}=([A-Za-z0-9_-]{43})(?:;|$)`).exec(cookieHeader || '');
  return match ? match[1] : null;
}

// ---------- signed photo links ----------

// Short-lived signed links, so a POS can show a member's selfie without a login.
function signMedia(kind, id, ttlSeconds = 300) {
  const exp = Date.now() + ttlSeconds * 1000;
  return `exp=${exp}&sig=${hmac(secret, `${kind}:${id}:${exp}`)}`;
}

function verifyMedia(kind, id, exp, sig) {
  if (!exp || !sig || Date.now() > Number(exp)) return false;
  return safeEqual(sig, hmac(secret, `${kind}:${id}:${exp}`));
}

module.exports = {
  init,
  hmac,
  sha256,
  safeEqual,
  randomId,
  hashPassword,
  verifyPassword,
  needsRehash,
  readablePassword,
  newToken,
  sessionCookie,
  clearedCookie,
  readSessionToken,
  signMedia,
  verifyMedia,
};
