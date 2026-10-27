'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const COOKIE = 'bm_session';
const SESSION_DAYS = 30;
let secret;

// The signing secret comes from SESSION_SECRET, or is made once and kept in the data folder.
function init(dataDir) {
  if (process.env.SESSION_SECRET) {
    secret = Buffer.from(process.env.SESSION_SECRET);
    return;
  }
  const file = path.join(dataDir, 'secret.key');
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'));
  secret = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
}

function hmac(key, value) {
  return crypto.createHmac('sha256', key).update(value).digest('base64url');
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64url'), 64);
  return safeEqual(actual.toString('base64url'), hash);
}

function sessionCookie(userId) {
  const expires = Date.now() + SESSION_DAYS * 86400e3;
  const value = `${userId}.${expires}`;
  const token = `${value}.${hmac(secret, 'session:' + value)}`;
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

function clearedCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

// Returns the signed-in user's id, or null.
function readSession(cookieHeader) {
  const match = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(cookieHeader || '');
  if (!match) return null;
  const [userId, expires, sig] = match[1].split('.');
  if (!userId || !expires || !sig) return null;
  if (!safeEqual(sig, hmac(secret, `session:${userId}.${expires}`))) return null;
  if (Date.now() > Number(expires)) return null;
  return userId;
}

// Short-lived signed links, so a POS can show a member's selfie without a login.
function signMedia(kind, id, ttlSeconds = 300) {
  const exp = Date.now() + ttlSeconds * 1000;
  return `exp=${exp}&sig=${hmac(secret, `${kind}:${id}:${exp}`)}`;
}

function verifyMedia(kind, id, exp, sig) {
  if (!exp || !sig || Date.now() > Number(exp)) return false;
  return safeEqual(sig, hmac(secret, `${kind}:${id}:${exp}`));
}

function randomId(bytes = 12) {
  return crypto.randomBytes(bytes).toString('base64url');
}

module.exports = {
  init,
  hmac,
  safeEqual,
  hashPassword,
  verifyPassword,
  sessionCookie,
  clearedCookie,
  readSession,
  signMedia,
  verifyMedia,
  randomId,
};
