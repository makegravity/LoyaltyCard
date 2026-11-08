'use strict';
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const QRCode = require('qrcode');
const db = require('./lib/db');
const data = require('./lib/data');
const security = require('./lib/security');
const pass = require('./lib/pass');
const billing = require('./lib/billing');
const payments = require('./lib/payments');

const PROD = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT || 4090);
const HOST = process.env.HOST || '0.0.0.0';
// The address people use, e.g. https://maniacrewards.com. Writes must come from it, and
// links the server hands out (photo links for the POS, Stripe webhooks) are built on it.
const PUBLIC_ORIGIN = (process.env.PUBLIC_ORIGIN || '').replace(/\/+$/, '');
const COOKIE_SECURE = process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : PROD;
const QR_PERIODS = [10, 15, 20, 30, 60];
const WEBHOOK_PATH = /^\/api\/stripe\/webhook\/(sandbox|live)$/;
const CARD_BRANDS = ['Visa', 'Mastercard', 'Amex', 'Discover', 'Card'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Cashiers scan cards and sign up members at the counter. Admins also run offers, members,
// staff and settings. Super admins also hold the Stripe keys and choose the plan.
const STAFF_ROLES = ['superadmin', 'admin', 'cashier'];
const ADMIN_ROLES = ['superadmin', 'admin'];
// Staff often share a register device, so their sessions are short.
const SESSION_SECONDS = { member: 30 * 86400, cashier: 12 * 3600, admin: 12 * 3600, superadmin: 12 * 3600 };
const MIN_PASSWORD = { member: 8, cashier: 8, admin: 8, superadmin: 8 };
const MAX_PASSWORD = 200;
const PAYMENT_MODES = ['off', 'demo', 'sandbox', 'live'];
const STRIPE_MODES = ['sandbox', 'live'];
// After confirming their password, a super admin can change payments for this long.
const ELEVATED_MS = 10 * 60e3;
// How long a counter sign-up's link to open the card on the member's phone works.
const CLAIM_LINK_HOURS = 24;
// Encrypts the Stripe keys in the database: 64 hex characters (openssl rand -hex 32).
const SECRETS_KEY = process.env.SECRETS_KEY || '';

let DUMMY_HASH = '';

const app = express();
app.disable('x-powered-by');
app.set('json escape', true);
// Behind a reverse proxy, trust its X-Forwarded-* headers so req.ip is the visitor's
// address (for the sign-in limits) and req.protocol is https.
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);
app.use(securityHeaders);

app.get('/healthz', async (req, res) => {
  try {
    await db.ping();
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
app.use(sameOriginWrites);
// Photos are sent as data: URLs, so only the upload routes accept large bodies. Stripe
// webhooks are read raw, because their signature covers the exact bytes.
const LARGE_BODY_PATHS = new Set(['/api/me/selfie', '/api/admin/offers', '/api/staff/members']);
const jsonSmall = express.json({ limit: '64kb' });
const jsonLarge = express.json({ limit: '6mb' });
const rawWebhook = express.raw({ type: '*/*', limit: '1mb' });
app.use((req, res, next) => {
  if (WEBHOOK_PATH.test(req.path)) return rawWebhook(req, res, next);
  return (LARGE_BODY_PATHS.has(req.path) ? jsonLarge : jsonSmall)(req, res, next);
});
app.use('/api', h(loadSession));

// ---------- setup ----------

function configProblems() {
  const problems = [];
  if (!PROD) return problems;
  if (!/^https:\/\/[^/]+$/.test(PUBLIC_ORIGIN)) {
    problems.push('PUBLIC_ORIGIN must be the https address of the site, e.g. https://maniacrewards.com');
  }
  if (!COOKIE_SECURE) problems.push('COOKIE_SECURE cannot be false in production.');
  if (!process.env.DATABASE_URL && !process.env.DB_PASSWORD) problems.push('Set DATABASE_URL, or DB_HOST, DB_USER, DB_PASSWORD and DB_NAME.');
  if (!/^[0-9a-f]{64}$/i.test(SECRETS_KEY)) problems.push('Set SECRETS_KEY to 64 hex characters (openssl rand -hex 32). It encrypts the Stripe keys.');
  return problems;
}

function defaultSettings() {
  return {
    programName: 'Bin Mania VIP',
    monthlyPriceCents: 999,
    // Demo payments for local tries; production starts with payments off until a super
    // admin adds Stripe keys.
    paymentMode: PROD ? 'off' : 'demo',
    qrPeriodSeconds: 20,
    perks: [
      'Members-only deals posted every week',
      'First word on Friday tag colors and new drops',
      'Your digital card, always on your phone',
    ].join('\n'),
    mediaSecret: crypto.randomBytes(32).toString('hex'),
    nextMemberNumber: 100001,
  };
}

// There is always a super admin. When there is none, the longest-serving admin becomes one;
// on an empty database the first start makes one from ADMIN_EMAIL and ADMIN_PASSWORD. In
// production both are required and they must choose a new password at first sign-in.
// Elsewhere a password is generated when none is set and saved to data/admin-login.txt.
async function ensureSuperAdmin() {
  if ((await data.countUsers('superadmin')) > 0) return;
  const oldest = await data.oldestUser('admin');
  if (oldest) {
    await data.updateUser(oldest.id, { role: 'superadmin' });
    console.log(`${oldest.email} is now the super admin.`);
    return;
  }
  const email = (process.env.ADMIN_EMAIL || (PROD ? '' : 'admin@binmania.local')).toLowerCase();
  let password = process.env.ADMIN_PASSWORD || '';
  if (PROD && (!EMAIL_RE.test(email) || password.length < MIN_PASSWORD.admin)) {
    throw new Error(
      `There is no admin yet. Set ADMIN_EMAIL and ADMIN_PASSWORD (at least ${MIN_PASSWORD.admin} characters) for the first start.`
    );
  }
  if (!password) password = security.readablePassword();
  await data.insertUser({
    id: security.randomId(),
    role: 'superadmin',
    name: 'Bin Mania Admin',
    email,
    phone: '',
    passwordHash: await security.hashPassword(password),
    mustChangePassword: PROD,
    createdAt: new Date().toISOString(),
  });
  if (PROD) {
    console.log(`Super admin created: ${email}. Sign in with ADMIN_PASSWORD and choose a new password; then remove ADMIN_PASSWORD from the environment.`);
    return;
  }
  const dir = path.join(__dirname, 'data');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'admin-login.txt'), `Email: ${email}\nPassword: ${password}\n`);
  console.log(`Admin login created: ${email} / ${password} (also saved in data/admin-login.txt)`);
}

// ---------- middleware ----------

// Wraps an async handler so a rejected promise reaches the error handler.
function h(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function securityHeaders(req, res, next) {
  res.set({
    'Content-Security-Policy': [
      "default-src 'self'",
      "img-src 'self' data: blob:",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      // Stripe.js and its card fields (iframes), for payments.
      "script-src 'self' https://js.stripe.com https://*.js.stripe.com",
      "frame-src https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com",
      // Stripe.js fetches the card form's font CSS from the page.
      "connect-src 'self' https://api.stripe.com https://fonts.googleapis.com",
      "media-src 'self' blob:",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), payment=(self "https://js.stripe.com")',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
  });
  next();
}

function expectedOrigin(req) {
  return PUBLIC_ORIGIN || `${req.protocol}://${req.get('host')}`;
}

// Every write must come from this site's own pages (browsers send Origin with each one),
// on top of SameSite session cookies. The POS endpoint and Stripe webhooks are exempt: they
// are called server to server, with an API key or a signature.
function sameOriginWrites(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.path.startsWith('/api/pos/') || WEBHOOK_PATH.test(req.path)) {
    return next();
  }
  if (req.get('origin') !== expectedOrigin(req)) return fail(res, 403, 'Cross-site request blocked.');
  next();
}

// Also loads the settings, which most answers depend on (the payment mode decides which
// memberships count).
async function loadSession(req, res, next) {
  req.user = null;
  req.sessionHash = null;
  req.settings = await data.getSettings();
  const token = security.readSessionToken(req.headers.cookie);
  if (token) {
    req.sessionHash = security.sha256(token);
    req.user = await data.sessionUser(req.sessionHash);
  }
  next();
}

function requireRole(roles, message) {
  return (req, res, next) => {
    if (!req.user) return fail(res, 401, 'Please sign in.');
    if (!roles.includes(req.user.role)) return fail(res, 403, message);
    // Staff given a password by an admin choose their own before anything else.
    if (req.user.mustChangePassword) return fail(res, 403, 'Choose a new password first.', { reason: 'password' });
    next();
  };
}

const requireSuperAdmin = requireRole(['superadmin'], 'Only a super admin can do this.');
const requireAdmin = requireRole(ADMIN_ROLES, 'Admins only.');
const requireStaff = requireRole(STAFF_ROLES, 'Staff only.');
const requireOfferReader = requireRole(['member', ...ADMIN_ROLES], 'Offers are for members.');

// Payment changes need a fresh password confirmation (POST /api/admin/payments/unlock).
function requireElevated(req, res, next) {
  if (!(Date.parse(req.user.elevatedUntil || 0) > Date.now())) {
    return fail(res, 403, 'Confirm your password to change payments.', { reason: 'elevate' });
  }
  next();
}
const requireMember = [
  requireRole(['member'], 'This page is for members.'),
  h(async (req, res, next) => {
    req.user = await settleUser(req.user);
    next();
  }),
];

// A small in-memory limiter: at most `max` hits per key in each window. Counts are per
// app instance, which is enough for one container.
function limiter(max, windowMs) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) if (entry.resetAt < now) hits.delete(key);
  }, windowMs).unref();
  const entryFor = (key) => {
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.resetAt < now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    return entry;
  };
  return {
    // Counts one hit; true once the key is over the limit.
    hit: (key) => ++entryFor(key).count > max,
    blocked: (key) => entryFor(key).count >= max,
    reset: (key) => hits.delete(key),
  };
}

const loginByIpAndEmail = limiter(10, 15 * 60e3);
const loginByIp = limiter(50, 15 * 60e3);
const signupByIp = limiter(20, 60 * 60e3);
const claimsByIp = limiter(30, 15 * 60e3);
const counterSignupsByUser = limiter(60, 60 * 60e3);
const passwordChecksByUser = limiter(10, 15 * 60e3);
const posKeyFailuresByIp = limiter(20, 15 * 60e3);

// ---------- helpers ----------

function fail(res, status, error, extra = {}) {
  return res.status(status).json({ error, ...extra });
}

function cleanText(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function baseUrl(req) {
  return expectedOrigin(req);
}

function passwordProblem(password, role) {
  const min = MIN_PASSWORD[role];
  if (password.length < min) return `Use at least ${min} characters for your password.`;
  if (password.length > MAX_PASSWORD) return 'That password is too long.';
  return null;
}

async function audit(req, action, { actor = req.user, actorRole, target = null, detail = null } = {}) {
  try {
    await data.audit({
      actorId: actor ? actor.id : null,
      actorRole: actorRole || (actor ? actor.role : null),
      action,
      target,
      detail,
      ip: req.ip,
    });
  } catch (err) {
    console.error(`Audit log write failed (${action}):`, err.message);
  }
}

// A new session for `user`; any session the browser already had is ended first.
async function startSession(req, res, user) {
  if (req.sessionHash) await data.deleteSession(req.sessionHash);
  const token = security.newToken();
  const maxAge = SESSION_SECONDS[user.role];
  await data.createSession({
    tokenHash: security.sha256(token),
    userId: user.id,
    expiresAt: new Date(Date.now() + maxAge * 1000),
    ip: req.ip,
    userAgent: req.get('user-agent'),
  });
  res.set('Set-Cookie', security.sessionCookie(token, maxAge));
}

// Runs fn(user, conn) with the member's row locked, after bringing their subscription up
// to date, so two requests at once can't both renew a period or both take a code.
async function withUserLock(userId, fn) {
  return db.tx(async (conn) => {
    const user = await data.userById(userId, { conn, lock: true });
    if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
    if (billing.isDue(user)) {
      for (const invoice of billing.settle(user)) await data.insertInvoice(invoice, conn);
      await data.updateUser(user.id, { subscription: user.subscription }, conn);
    }
    return fn(user, conn);
  });
}

// Brings a membership up to date: renews a demo one whose period has passed, and checks
// with Stripe on one whose period ended without word of the renewal.
async function settleUser(user) {
  if (payments.needsSync(user)) {
    try {
      return await payments.sync(user);
    } catch (err) {
      console.error(`Stripe sync for #${user.memberNumber} failed: ${err.message}`);
      return user;
    }
  }
  if (!billing.isDue(user)) return user;
  return withUserLock(user.id, async (fresh) => fresh);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Accepts a data: URL from the browser and checks the bytes really are an image.
function decodeImage(dataUrl) {
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!match) return null;
  const buf = Buffer.from(match[2], 'base64');
  if (buf.length < 100 || buf.length > 4 * 1024 * 1024) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { buf, mime: 'image/jpeg' };
  if (buf.subarray(0, 8).equals(PNG_SIGNATURE)) return { buf, mime: 'image/png' };
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return { buf, mime: 'image/webp' };
  return null;
}

function sendImage(res, image, { maxAge, crossOrigin = false }) {
  res.set({
    'Content-Type': image.mime,
    'Cache-Control': `private, max-age=${maxAge}`,
    'Content-Disposition': 'inline',
  });
  // Signed selfie links are for the POS, which may show them on its own pages.
  if (crossOrigin) res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  res.end(image.bytes);
}

// The demo card form sends only the brand, last four digits and expiry; the full
// number never leaves the phone.
function readCard(body) {
  const last4 = String(body.last4 || '');
  if (!/^\d{4}$/.test(last4)) return { error: 'Please check the card number.' };
  const expMonth = Number(body.expMonth);
  const expYear = Number(body.expYear);
  if (!(expMonth >= 1 && expMonth <= 12) || !(expYear >= 2000 && expYear <= 2100)) {
    return { error: 'Please check the expiry date.' };
  }
  const now = new Date();
  if (expYear < now.getFullYear() || (expYear === now.getFullYear() && expMonth < now.getMonth() + 1)) {
    return { error: 'That card has expired.' };
  }
  return {
    card: {
      brand: CARD_BRANDS.includes(body.brand) ? body.brand : 'Card',
      last4,
      expMonth,
      expYear,
      name: cleanText(body.name, 60),
      addedAt: now.toISOString(),
      demo: true,
    },
  };
}

// What new members join on: the chosen Stripe plan in sandbox and live mode, otherwise the
// program name, fee and perks from Settings.
async function offering(s) {
  const perks = s.perks.split('\n').filter(Boolean);
  const fromSettings = { name: s.programName, amountCents: s.monthlyPriceCents, currency: 'usd', interval: 'month', intervalCount: 1, perks };
  if (!STRIPE_MODES.includes(s.paymentMode)) return { ...fromSettings, open: s.paymentMode === 'demo', source: 'settings' };
  const plan = await payments.currentPlan(s.paymentMode);
  if (!plan) return { ...fromSettings, open: false, source: 'stripe' };
  return {
    name: plan.name,
    amountCents: plan.amountCents,
    currency: plan.currency,
    interval: plan.interval,
    intervalCount: plan.intervalCount,
    // The product's feature list in Stripe, when it has one.
    perks: plan.features.length ? plan.features : perks,
    open: plan.active,
    source: 'stripe',
  };
}

async function publicConfig(s) {
  const plan = await offering(s);
  return {
    programName: plan.name,
    price: { amountCents: plan.amountCents, currency: plan.currency, interval: plan.interval, intervalCount: plan.intervalCount },
    perks: plan.perks,
    signupOpen: plan.open,
    paymentMode: s.paymentMode,
    stripePublishableKey: STRIPE_MODES.includes(s.paymentMode) ? await payments.publishableKey(s.paymentMode) : null,
    qrPeriodSeconds: s.qrPeriodSeconds,
  };
}

function selfiePath(user) {
  return `/api/selfie/${user.id}?v=${Date.parse(user.selfie.uploadedAt)}`;
}

function signedSelfieUrl(req, user) {
  return `${baseUrl(req)}/api/selfie/${user.id}?${security.signMedia('selfie', user.id)}`;
}

function meView(user, paymentMode) {
  return {
    id: user.id,
    role: user.role,
    name: user.name,
    email: user.email,
    phone: user.phone || '',
    mustChangePassword: user.mustChangePassword,
    passwordMinLength: MIN_PASSWORD[user.role],
    memberNumber: user.memberNumber || null,
    memberSince: user.createdAt,
    selfieUrl: user.selfie ? selfiePath(user) : null,
    status: user.role === 'member' ? billing.status(user, paymentMode) : null,
    billedBy: user.subscription ? billing.subMode(user.subscription) : null,
    subscription: user.subscription || null,
    paymentMethod: user.paymentMethod || null,
  };
}

function staffView(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt || null,
    mustChangePassword: user.mustChangePassword,
  };
}

function offerView(offer) {
  return {
    id: offer.id,
    title: offer.title,
    body: offer.body,
    createdAt: offer.createdAt,
    imageUrl: offer.imageId ? `/api/offers/${offer.id}/image` : null,
  };
}

function adminSettingsView(s, plan) {
  return {
    programName: s.programName,
    monthlyPriceCents: s.monthlyPriceCents,
    qrPeriodSeconds: s.qrPeriodSeconds,
    perks: s.perks,
    posKeyHint: s.posKeyHint,
    posKeyCreatedAt: s.posKeyCreatedAt,
    qrPeriodOptions: QR_PERIODS,
    paymentMode: s.paymentMode,
    plan,
  };
}

// ---------- public + auth ----------

app.get('/api/config', h(async (req, res) => res.json(await publicConfig(req.settings))));

app.post('/api/auth/signup', h(async (req, res) => {
  if (signupByIp.hit(req.ip)) return fail(res, 429, 'Too many sign-ups from here. Try again later.');
  const name = cleanText(req.body.name, 60);
  const email = cleanText(req.body.email, 120).toLowerCase();
  const phone = cleanText(req.body.phone, 30);
  const password = String(req.body.password || '');
  if (name.length < 2) return fail(res, 400, 'Please enter your name.');
  if (!EMAIL_RE.test(email)) return fail(res, 400, 'Please enter a valid email address.');
  const problem = passwordProblem(password, 'member');
  if (problem) return fail(res, 400, problem);
  const taken = 'That email already has an account. Sign in instead.';
  if (await data.userByEmail(email)) return fail(res, 409, taken);
  const user = {
    id: security.randomId(),
    role: 'member',
    name,
    email,
    phone,
    passwordHash: await security.hashPassword(password),
    createdAt: new Date().toISOString(),
    qrSecret: security.randomId(32),
  };
  try {
    await db.tx(async (conn) => {
      user.memberNumber = await data.takeMemberNumber(conn);
      await data.insertUser(user, conn);
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return fail(res, 409, taken);
    throw err;
  }
  const saved = await data.userById(user.id);
  await startSession(req, res, saved);
  await audit(req, 'signup', { actor: saved, target: `#${saved.memberNumber}` });
  res.status(201).json({ me: meView(saved, req.settings.paymentMode) });
}));

app.post('/api/auth/login', h(async (req, res) => {
  const email = cleanText(req.body.email, 120).toLowerCase();
  const password = String(req.body.password || '').slice(0, MAX_PASSWORD + 1);
  const overIp = loginByIp.hit(req.ip);
  if (loginByIpAndEmail.hit(`${req.ip}|${email}`) || overIp) {
    return fail(res, 429, 'Too many tries. Wait 15 minutes and try again.');
  }
  let user = await data.userByEmail(email);
  // Check a password even for an unknown email, so the time taken doesn't reveal who has an account.
  const ok = await security.verifyPassword(password, user ? user.passwordHash : DUMMY_HASH);
  if (!user || !ok) {
    await audit(req, 'login_failed', { target: email });
    return fail(res, 401, "That email and password don't match.");
  }
  loginByIpAndEmail.reset(`${req.ip}|${email}`);
  const fields = { lastLoginAt: new Date().toISOString() };
  if (security.needsRehash(user.passwordHash)) fields.passwordHash = await security.hashPassword(password);
  await data.updateUser(user.id, fields);
  if (user.role === 'member') user = await settleUser(user);
  await startSession(req, res, user);
  await audit(req, 'login', { actor: user });
  res.json({ me: meView(user, req.settings.paymentMode) });
}));

app.post('/api/auth/logout', h(async (req, res) => {
  if (req.sessionHash) await data.deleteSession(req.sessionHash);
  if (req.user) await audit(req, 'logout');
  res.set('Set-Cookie', security.clearedCookie());
  res.json({ ok: true });
}));

// A member signed up at the counter opens their card on their own phone with a one-time
// link, and chooses a password there.
async function claimUser(req, res) {
  if (claimsByIp.hit(req.ip)) {
    fail(res, 429, 'Too many tries. Wait 15 minutes and try again.');
    return null;
  }
  const token = String(req.body.token || '');
  const user = /^[A-Za-z0-9_-]{43}$/.test(token) ? await data.claimLinkUser(security.sha256(token)) : null;
  if (!user || user.role !== 'member') {
    fail(res, 410, 'This link has expired or was already used. Ask at the register for a new one.');
    return null;
  }
  return user;
}

app.post('/api/auth/claim/check', h(async (req, res) => {
  const user = await claimUser(req, res);
  if (user) res.json({ name: user.name, email: user.email });
}));

app.post('/api/auth/claim', h(async (req, res) => {
  const user = await claimUser(req, res);
  if (!user) return;
  const password = String(req.body.password || '');
  const problem = passwordProblem(password, 'member');
  if (problem) return fail(res, 400, problem);
  const now = new Date().toISOString();
  await data.updateUser(user.id, { passwordHash: await security.hashPassword(password), passwordChangedAt: now, lastLoginAt: now });
  await data.deleteClaimLinks(user.id);
  const fresh = await settleUser(await data.userById(user.id));
  await startSession(req, res, fresh);
  await audit(req, 'card_claimed', { actor: fresh, target: `#${fresh.memberNumber}` });
  res.json({ me: meView(fresh, req.settings.paymentMode) });
}));

app.get('/api/me', h(async (req, res) => {
  if (!req.user) return res.json({ me: null });
  const user = req.user.role === 'member' ? await settleUser(req.user) : req.user;
  res.json({ me: meView(user, req.settings.paymentMode) });
}));

// Changing a password signs the person out on every other device.
app.post('/api/me/password', h(async (req, res) => {
  const user = req.user;
  if (!user) return fail(res, 401, 'Please sign in.');
  if (passwordChecksByUser.hit(user.id)) return fail(res, 429, 'Too many tries. Wait 15 minutes and try again.');
  const current = String(req.body.currentPassword || '').slice(0, MAX_PASSWORD + 1);
  const next = String(req.body.newPassword || '');
  if (!(await security.verifyPassword(current, user.passwordHash))) {
    return fail(res, 400, "Your current password isn't right.");
  }
  const problem = passwordProblem(next, user.role);
  if (problem) return fail(res, 400, problem);
  if (next === current) return fail(res, 400, 'Choose a password different from the one you have now.');
  await data.updateUser(user.id, {
    passwordHash: await security.hashPassword(next),
    mustChangePassword: false,
    passwordChangedAt: new Date().toISOString(),
  });
  await data.deleteUserSessions(user.id, req.sessionHash);
  passwordChecksByUser.reset(user.id);
  await audit(req, 'password_changed');
  res.json({ me: meView(await data.userById(user.id), req.settings.paymentMode) });
}));

// ---------- member: join, selfie, card ----------

// Starts a demo membership on the card in `body` (or the saved one). Returns null when
// the membership is already active.
async function startDemo(userId, priceCents, body) {
  return withUserLock(userId, async (u, conn) => {
    if (billing.isActive(u, 'demo')) return null;
    if (!(body.useSavedCard && u.paymentMethod)) {
      const read = readCard(body);
      if (read.error) throw Object.assign(new Error(read.error), { status: 400, expose: true });
      u.paymentMethod = read.card;
    }
    const invoice = billing.start(u, priceCents);
    await data.updateUser(u.id, { subscription: u.subscription, paymentMethod: u.paymentMethod }, conn);
    await data.insertInvoice(invoice, conn);
    return u;
  });
}

function subscribedAudit(req, user, plan, mode) {
  return audit(req, 'subscribed', { target: `#${user.memberNumber}`, detail: `${plan.amountCents} ${plan.currency} / ${plan.interval} (${mode})` });
}

// In sandbox and live mode this starts a Stripe subscription and returns the client
// secret the page's Payment Element confirms; /api/me/subscribe/confirm then picks up
// the result. In demo mode the membership starts at once.
app.post('/api/me/subscribe', requireMember, h(async (req, res) => {
  const mode = req.settings.paymentMode;
  const plan = await offering(req.settings);
  if (!plan.open) return fail(res, 503, 'Online sign-up is not open yet. Please ask at the register.');
  if (billing.isActive(req.user, mode)) return fail(res, 409, 'Your membership is already active.');
  if (STRIPE_MODES.includes(mode)) {
    const r = await payments.startSubscription(req.user, mode);
    if (r.clientSecret) return res.json({ clientSecret: r.clientSecret, publishableKey: r.publishableKey, me: meView(r.user, mode) });
    const user = await payments.sync(r.user); // nothing to pay
    await subscribedAudit(req, user, plan, mode);
    return res.json({ me: meView(user, mode) });
  }
  const user = await startDemo(req.user.id, plan.amountCents, req.body);
  if (!user) return fail(res, 409, 'Your membership is already active.');
  await subscribedAudit(req, user, plan, mode);
  res.json({ me: meView(user, mode) });
}));

// After the Payment Element confirms, the page asks for the result. Stripe's webhook says
// the same a moment later; this way the member doesn't wait for it.
app.post('/api/me/subscribe/confirm', requireMember, h(async (req, res) => {
  const mode = req.settings.paymentMode;
  const before = billing.isActive(req.user, mode);
  const user = await payments.sync(req.user);
  if (!before && billing.isActive(user, mode)) await subscribedAudit(req, user, await offering(req.settings), mode);
  res.json({ me: meView(user, mode) });
}));

// A member sets their photo once. An admin can clear it from Members to ask for a new one,
// so a card can't be handed to someone else by swapping the photo.
app.post('/api/me/selfie', requireMember, h(async (req, res) => {
  const img = decodeImage(req.body.image);
  if (!img) return fail(res, 400, 'Please take a photo (JPEG or PNG, under 4 MB).');
  const user = await withUserLock(req.user.id, async (u, conn) => {
    if (u.selfie) return null;
    await saveSelfie(u, img, conn);
    return u;
  });
  if (!user) return fail(res, 409, 'Your card already has a photo. Ask a team member to reset it.');
  res.json({ me: meView(user, req.settings.paymentMode) });
}));

// Stores `img` as the user's photo, replacing any they had.
async function saveSelfie(user, img, conn) {
  const imageId = security.randomId();
  await data.insertImage({ id: imageId, kind: 'selfie', mime: img.mime, bytes: img.buf }, conn);
  const old = user.selfie;
  user.selfie = { imageId, uploadedAt: new Date().toISOString() };
  await data.updateUser(user.id, { selfieImageId: imageId, selfieUploadedAt: user.selfie.uploadedAt }, conn);
  if (old) await data.deleteImage(old.imageId, conn);
}

app.get('/api/selfie/:id', h(async (req, res) => {
  const user = await data.userById(req.params.id);
  if (!user || !user.selfie) return res.status(404).end();
  const viaSession = !!req.user && (req.user.id === user.id || ADMIN_ROLES.includes(req.user.role));
  const viaLink = !viaSession && security.verifyMedia('selfie', user.id, req.query.exp, req.query.sig);
  if (!viaSession && !viaLink) return res.status(403).end();
  const image = await data.getImage(user.selfie.imageId);
  if (!image) return res.status(404).end();
  sendImage(res, image, { maxAge: viaLink ? 300 : 3600, crossOrigin: viaLink });
}));

app.get('/api/me/pass', requireMember, h(async (req, res) => {
  const user = req.user;
  if (!billing.isActive(user, req.settings.paymentMode)) return fail(res, 403, 'Your membership is not active.', { reason: 'inactive' });
  if (!user.selfie) return fail(res, 409, 'Add your selfie to get your card.', { reason: 'selfie' });
  const period = req.settings.qrPeriodSeconds;
  const now = Date.now();
  const cur = pass.current(user, period, now);
  const svg = await QRCode.toString(cur.code, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 0,
    color: { dark: '#1d252dff', light: '#ffffffff' },
  });
  res.json({
    window: cur.window,
    svg,
    expiresAt: cur.expiresAt,
    periodSeconds: period,
    serverTime: now,
    used: user.lastScannedCodeStart != null && cur.window * period * 1000 <= user.lastScannedCodeStart,
    lastScanAt: user.lastScanAt,
  });
}));

app.get('/api/offers', requireOfferReader, h(async (req, res) => {
  res.json({ offers: (await data.listOffers()).map(offerView) });
}));

app.get('/api/offers/:id/image', requireOfferReader, h(async (req, res) => {
  const offer = await data.getOffer(req.params.id);
  const image = offer && offer.imageId ? await data.getImage(offer.imageId) : null;
  if (!image) return res.status(404).end();
  sendImage(res, image, { maxAge: 86400 });
}));

// ---------- member: billing ----------

const isStripe = (user) => !!user.subscription && user.subscription.provider === 'stripe';

app.get('/api/me/billing', requireMember, h(async (req, res) => {
  res.json({ me: meView(req.user, req.settings.paymentMode), invoices: await data.invoicesFor(req.user.id) });
}));

// For a Stripe membership: a SetupIntent for the Payment Element that takes the new card.
app.post('/api/me/billing/card-setup', requireMember, h(async (req, res) => {
  res.json(await payments.cardSetup(req.user));
}));

app.post('/api/me/billing/payment-method', requireMember, h(async (req, res) => {
  const mode = req.settings.paymentMode;
  if (isStripe(req.user)) {
    const user = await payments.useCard(req.user, req.body.setupIntentId);
    await audit(req, 'card_changed', { target: `#${user.memberNumber}` });
    return res.json({ me: meView(user, mode) });
  }
  if (mode !== 'demo') return fail(res, 503, 'Online payments are not open yet.');
  const { card, error } = readCard(req.body);
  if (error) return fail(res, 400, error);
  await data.updateUser(req.user.id, { paymentMethod: card });
  res.json({ me: meView({ ...req.user, paymentMethod: card }, mode) });
}));

app.post('/api/me/billing/cancel', requireMember, h(async (req, res) => {
  const mode = req.settings.paymentMode;
  let user;
  if (isStripe(req.user)) {
    if (!['active', 'past_due'].includes(billing.status(req.user, mode))) return fail(res, 409, 'There is no active membership to cancel.');
    user = await payments.setCancel(req.user, true);
  } else {
    user = await withUserLock(req.user.id, async (u, conn) => {
      if (billing.status(u, mode) !== 'active') return null;
      u.subscription.cancelAtPeriodEnd = true;
      u.subscription.canceledAt = new Date().toISOString();
      await data.updateUser(u.id, { subscription: u.subscription }, conn);
      return u;
    });
    if (!user) return fail(res, 409, 'There is no active membership to cancel.');
  }
  await audit(req, 'membership_canceled', { target: `#${user.memberNumber}` });
  res.json({ me: meView(user, mode) });
}));

app.post('/api/me/billing/resume', requireMember, h(async (req, res) => {
  const mode = req.settings.paymentMode;
  let user;
  if (isStripe(req.user)) {
    if (billing.status(req.user, mode) !== 'canceling') return fail(res, 409, 'Your membership is not set to cancel.');
    user = await payments.setCancel(req.user, false);
  } else {
    user = await withUserLock(req.user.id, async (u, conn) => {
      if (billing.status(u, mode) !== 'canceling') return null;
      u.subscription.cancelAtPeriodEnd = false;
      u.subscription.canceledAt = null;
      await data.updateUser(u.id, { subscription: u.subscription }, conn);
      return u;
    });
    if (!user) return fail(res, 409, 'Your membership is not set to cancel.');
  }
  await audit(req, 'membership_resumed', { target: `#${user.memberNumber}` });
  res.json({ me: meView(user, mode) });
}));

// ---------- Stripe webhooks ----------

// Stripe signs each call; payments.handleWebhook checks the signature against the bytes.
app.post('/api/stripe/webhook/:mode', h(async (req, res) => {
  if (!Buffer.isBuffer(req.body)) return fail(res, 400, 'Expected the raw event.');
  const result = await payments.handleWebhook(req.params.mode, req.body, req.get('stripe-signature'));
  res.json({ received: true, result });
}));

// ---------- code checks (cashiers, admins and the POS) ----------

function memberSummary(req, user) {
  return {
    memberNumber: user.memberNumber,
    name: user.name,
    status: billing.status(user, req.settings.paymentMode),
    memberSince: user.createdAt,
    selfieUrl: user.selfie ? signedSelfieUrl(req, user) : null,
  };
}

async function verifyCode(req, rawCode, scannedBy) {
  const parsed = pass.parse(rawCode);
  if (!parsed) return { valid: false, reason: 'unreadable', message: 'This is not a Bin Mania membership code.' };
  const found = await data.memberByNumber(parsed.memberNumber);
  if (!found) return { valid: false, reason: 'unknown_member', message: 'No member has this code.' };
  const period = req.settings.qrPeriodSeconds;
  const result = pass.check(found, parsed, period);
  if (result === 'bad_signature') return { valid: false, reason: 'invalid', message: 'This code is not genuine.' };
  if (result === 'expired') {
    return { valid: false, reason: 'expired', message: 'This code has expired. Ask the member to open their live card.' };
  }
  const user = await settleUser(found);
  if (!billing.isActive(user, req.settings.paymentMode)) {
    return { valid: false, reason: 'inactive', message: 'This membership is not active.', member: memberSummary(req, user) };
  }
  // Each code scans once, so a forwarded screenshot fails even inside its time window.
  if (!(await data.markScanned(user.id, parsed.window * period * 1000, scannedBy))) {
    return {
      valid: false,
      reason: 'already_used',
      message: 'This code was already scanned. Ask the member for the new code on their screen.',
    };
  }
  return { valid: true, reason: 'ok', message: 'Active member', member: memberSummary(req, user) };
}

function auditCheck(req, result, extra = {}) {
  const memberNumber = result.member ? result.member.memberNumber : pass.parse(req.body.code)?.memberNumber;
  return audit(req, 'code_checked', { target: memberNumber ? `#${memberNumber}` : null, detail: result.reason, ...extra });
}

app.post('/api/pos/verify', h(async (req, res) => {
  const settings = req.settings;
  if (!settings.posKeyHash) return fail(res, 503, 'The POS connection is not set up yet. Make a key in Admin → Settings.');
  if (posKeyFailuresByIp.blocked(req.ip)) return fail(res, 429, 'Too many wrong keys. Try again in 15 minutes.');
  if (!security.safeEqual(security.sha256(req.get('x-pos-key') || ''), settings.posKeyHash)) {
    posKeyFailuresByIp.hit(req.ip);
    return fail(res, 401, 'Missing or wrong X-POS-Key header.');
  }
  const result = await verifyCode(req, req.body.code, 'POS');
  await auditCheck(req, result, { actor: null, actorRole: 'pos' });
  res.json(result);
}));

app.post('/api/staff/verify', requireStaff, h(async (req, res) => {
  const result = await verifyCode(req, req.body.code, req.user.name);
  await auditCheck(req, result);
  res.json(result);
}));

// ---------- staff: sign up a member at the counter ----------

// A counter sign-up nobody has signed in to yet. Staff can pick it up again, to retry a
// card or make a new link for the member's phone.
function isPendingCounterMember(user) {
  return !!user && user.role === 'member' && !!user.joinedByName && !user.lastLoginAt && !user.passwordChangedAt;
}

function counterView(user, mode) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    memberNumber: user.memberNumber,
    status: billing.status(user, mode),
    hasPhoto: !!user.selfie,
  };
}

// Makes (or picks up) the member and starts their membership. In demo mode the card comes
// in the same request; in sandbox and live mode the answer carries the client secret for
// the Payment Element on the counter's screen, then /confirm picks up the result.
app.post('/api/staff/members', requireStaff, h(async (req, res) => {
  if (counterSignupsByUser.hit(req.user.id)) return fail(res, 429, 'Too many sign-ups in an hour. Try again later.');
  const mode = req.settings.paymentMode;
  const plan = await offering(req.settings);
  if (!plan.open) {
    return fail(res, 503, mode === 'off' ? 'Payments are off. A super admin can turn them on in Payments.' : 'Sign-up is closed: no plan is set up in Payments.');
  }
  const name = cleanText(req.body.name, 60);
  const email = cleanText(req.body.email, 120).toLowerCase();
  const phone = cleanText(req.body.phone, 30);
  if (name.length < 2) return fail(res, 400, 'Enter their name.');
  if (!EMAIL_RE.test(email)) return fail(res, 400, 'Enter a valid email address.');
  let img = null;
  if (req.body.photo) {
    img = decodeImage(req.body.photo);
    if (!img) return fail(res, 400, 'That photo could not be used. Take it again.');
  }
  const taken = 'That email already has an account. They can sign in on their phone to see their card, or rejoin from Billing.';
  let user = await data.userByEmail(email);
  if (user && !isPendingCounterMember(user)) return fail(res, 409, taken);
  if (!user) {
    user = {
      id: security.randomId(),
      role: 'member',
      name,
      email,
      phone,
      // Nobody knows this password; the member sets their own from the link.
      passwordHash: await security.hashPassword(security.randomId(24)),
      createdAt: new Date().toISOString(),
      qrSecret: security.randomId(32),
      joinedByName: req.user.name,
    };
    try {
      await db.tx(async (conn) => {
        user.memberNumber = await data.takeMemberNumber(conn);
        await data.insertUser(user, conn);
      });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return fail(res, 409, taken);
      throw err;
    }
    await audit(req, 'counter_signup', { target: `#${user.memberNumber}`, detail: email });
  } else {
    await data.updateUser(user.id, { name, phone, joinedByName: req.user.name });
  }
  if (img) await withUserLock(user.id, (u, conn) => saveSelfie(u, img, conn));
  user = await data.userById(user.id);
  if (billing.isActive(user, mode)) return res.json({ member: counterView(user, mode) });

  if (mode === 'demo') {
    const started = await startDemo(user.id, plan.amountCents, req.body.card || {});
    await subscribedAudit(req, started, plan, mode);
    return res.json({ member: counterView(started, mode) });
  }
  const r = await payments.startSubscription(user, mode);
  if (r.clientSecret) {
    return res.json({ member: counterView(r.user, mode), clientSecret: r.clientSecret, publishableKey: r.publishableKey });
  }
  const synced = await payments.sync(r.user);
  await subscribedAudit(req, synced, plan, mode);
  res.json({ member: counterView(synced, mode) });
}));

async function pendingMember(req, res) {
  const user = await data.userById(req.params.id);
  if (!isPendingCounterMember(user)) {
    fail(res, 409, 'They have already opened their card on their phone. They sign in with their own password.');
    return null;
  }
  return user;
}

app.post('/api/staff/members/:id/confirm', requireStaff, h(async (req, res) => {
  const user = await pendingMember(req, res);
  if (!user) return;
  const mode = req.settings.paymentMode;
  const before = billing.isActive(user, mode);
  const synced = await payments.sync(user);
  if (!before && billing.isActive(synced, mode)) await subscribedAudit(req, synced, await offering(req.settings), mode);
  res.json({ member: counterView(synced, mode) });
}));

// A one-time link (and its QR code) that opens the card on the member's phone. Making a
// new one ends the old.
app.post('/api/staff/members/:id/link', requireStaff, h(async (req, res) => {
  const user = await pendingMember(req, res);
  if (!user) return;
  if (!billing.isActive(user, req.settings.paymentMode)) return fail(res, 409, 'Their membership is not paid yet.');
  const token = security.newToken();
  const expiresAt = new Date(Date.now() + CLAIM_LINK_HOURS * 3600e3);
  await data.createClaimLink({ tokenHash: security.sha256(token), userId: user.id, expiresAt });
  const url = `${baseUrl(req)}/#/claim?t=${token}`;
  const svg = await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 0, color: { dark: '#1d252dff', light: '#ffffffff' } });
  await audit(req, 'claim_link_made', { target: `#${user.memberNumber}` });
  res.json({ url, svg, expiresAt: expiresAt.toISOString() });
}));

// ---------- admin: settings ----------

app.get('/api/admin/settings', requireAdmin, h(async (req, res) => {
  res.json({ settings: adminSettingsView(req.settings, await offering(req.settings)) });
}));

app.put('/api/admin/settings', requireAdmin, h(async (req, res) => {
  const body = req.body;
  const next = {};
  if ('programName' in body) {
    next.programName = cleanText(body.programName, 40);
    if (next.programName.length < 2) return fail(res, 400, 'Give the program a name.');
  }
  if ('monthlyPrice' in body) {
    next.monthlyPriceCents = Math.round(Number(body.monthlyPrice) * 100);
    if (!(next.monthlyPriceCents >= 50 && next.monthlyPriceCents <= 99900)) {
      return fail(res, 400, 'The monthly fee must be between $0.50 and $999.');
    }
  }
  if ('qrPeriodSeconds' in body) {
    next.qrPeriodSeconds = Number(body.qrPeriodSeconds);
    if (!QR_PERIODS.includes(next.qrPeriodSeconds)) return fail(res, 400, 'Pick one of the code rotation times.');
  }
  if ('perks' in body) {
    next.perks = String(body.perks)
      .split('\n')
      .map((line) => cleanText(line, 90))
      .filter(Boolean)
      .slice(0, 6)
      .join('\n');
  }
  await data.updateSettings(next);
  if (Object.keys(next).length) {
    await audit(req, 'settings_changed', { detail: JSON.stringify(next).slice(0, 500) });
  }
  const s = await data.getSettings();
  res.json({ settings: adminSettingsView(s, await offering(s)) });
}));

// The POS key is shown once, here; only its hash is stored.
app.post('/api/admin/settings/pos-key', requireAdmin, h(async (req, res) => {
  const posKey = 'pos_' + security.randomId(24);
  await data.updateSettings({
    posKeyHash: security.sha256(posKey),
    posKeyHint: posKey.slice(-4),
    posKeyCreatedAt: new Date().toISOString(),
  });
  await audit(req, 'pos_key_created');
  const s = await data.getSettings();
  res.json({ settings: adminSettingsView(s, await offering(s)), posKey });
}));

// ---------- super admin: payments ----------

async function paymentsView(req) {
  const s = await data.getSettings();
  const accounts = {};
  for (const mode of STRIPE_MODES) accounts[mode] = payments.accountView(await data.getStripeAccount(mode));
  const members = await data.listUsers(['member']);
  const current = (u, live) => !!u.subscription && (billing.subMode(u.subscription) === 'live') === live && billing.isActive(u, 'sandbox');
  const unlockedUntil = Date.parse(req.user.elevatedUntil || 0) > Date.now() ? req.user.elevatedUntil : null;
  return {
    mode: s.paymentMode,
    accounts,
    webhookUrls: Object.fromEntries(STRIPE_MODES.map((m) => [m, `${baseUrl(req)}/api/stripe/webhook/${m}`])),
    httpsSite: baseUrl(req).startsWith('https://'),
    unlockedUntil,
    // Going live ends the test (demo and sandbox) memberships.
    counts: { testMembers: members.filter((u) => current(u, false)).length, liveMembers: members.filter((u) => current(u, true)).length },
    defaults: { name: s.programName, amountCents: s.monthlyPriceCents },
  };
}

function stripeModeParam(req, res) {
  if (STRIPE_MODES.includes(req.params.mode)) return req.params.mode;
  fail(res, 404, 'Not found.');
  return null;
}

const cleanKey = (value) => String(value || '').trim().slice(0, 255);

app.get('/api/admin/payments', requireSuperAdmin, h(async (req, res) => res.json(await paymentsView(req))));

app.post('/api/admin/payments/unlock', requireSuperAdmin, h(async (req, res) => {
  if (passwordChecksByUser.hit(req.user.id)) return fail(res, 429, 'Too many tries. Wait 15 minutes and try again.');
  const password = String(req.body.password || '').slice(0, MAX_PASSWORD + 1);
  if (!(await security.verifyPassword(password, req.user.passwordHash))) {
    await audit(req, 'payments_unlock_failed');
    return fail(res, 400, "That password isn't right.");
  }
  passwordChecksByUser.reset(req.user.id);
  const until = new Date(Date.now() + ELEVATED_MS);
  await data.elevateSession(req.sessionHash, until);
  req.user.elevatedUntil = until.toISOString();
  res.json(await paymentsView(req));
}));

app.put('/api/admin/payments/mode', requireSuperAdmin, requireElevated, h(async (req, res) => {
  const mode = req.body.mode;
  if (!PAYMENT_MODES.includes(mode)) return fail(res, 400, 'Pick Off, Demo, Sandbox or Live.');
  if (STRIPE_MODES.includes(mode)) {
    const a = await data.getStripeAccount(mode);
    if (!a) return fail(res, 409, `Add the ${payments.LABEL[mode]} keys first.`);
    if (!a.plan || !a.plan.active) return fail(res, 409, `Choose the ${payments.LABEL[mode]} plan new members join on first.`);
  }
  await data.updateSettings({ paymentMode: mode });
  await audit(req, 'payment_mode_changed', { detail: `${req.settings.paymentMode} to ${mode}` });
  res.json(await paymentsView(req));
}));

app.put('/api/admin/payments/:mode/keys', requireSuperAdmin, requireElevated, h(async (req, res) => {
  const mode = stripeModeParam(req, res);
  if (!mode) return;
  const keys = {
    publishableKey: cleanKey(req.body.publishableKey),
    secretKey: cleanKey(req.body.secretKey),
    webhookSecret: cleanKey(req.body.webhookSecret) || null,
  };
  if (!keys.publishableKey || !keys.secretKey) return fail(res, 400, 'Enter the publishable key and the secret key.');
  await payments.saveKeys(mode, keys, { origin: baseUrl(req), byName: req.user.name });
  await audit(req, 'stripe_keys_saved', { target: mode, detail: `sk …${keys.secretKey.slice(-4)}` });
  res.json(await paymentsView(req));
}));

app.post('/api/admin/payments/:mode/remove', requireSuperAdmin, requireElevated, h(async (req, res) => {
  const mode = stripeModeParam(req, res);
  if (!mode) return;
  if (req.settings.paymentMode === mode) return fail(res, 409, `Switch payments away from ${payments.LABEL[mode]} before removing its keys.`);
  await payments.removeKeys(mode);
  await audit(req, 'stripe_keys_removed', { target: mode });
  res.json(await paymentsView(req));
}));

app.get('/api/admin/payments/:mode/plans', requireSuperAdmin, h(async (req, res) => {
  const mode = stripeModeParam(req, res);
  if (mode) res.json({ plans: await payments.listPlans(mode) });
}));

app.post('/api/admin/payments/:mode/plans', requireSuperAdmin, requireElevated, h(async (req, res) => {
  const mode = stripeModeParam(req, res);
  if (!mode) return;
  const name = cleanText(req.body.name, 60);
  const amountCents = Math.round(Number(req.body.amount) * 100);
  const interval = req.body.interval;
  if (name.length < 2) return fail(res, 400, 'Give the plan a name.');
  if (!(amountCents >= 50 && amountCents <= 99900)) return fail(res, 400, 'The price must be between $0.50 and $999.');
  if (!['month', 'year'].includes(interval)) return fail(res, 400, 'Pick monthly or yearly.');
  const plan = await payments.createPlan(mode, { name, amountCents, interval });
  await audit(req, 'stripe_plan_created', { target: mode, detail: `${plan.name}: ${plan.amountCents} ${plan.currency} / ${plan.interval}` });
  res.json(await paymentsView(req));
}));

app.put('/api/admin/payments/:mode/plan', requireSuperAdmin, requireElevated, h(async (req, res) => {
  const mode = stripeModeParam(req, res);
  if (!mode) return;
  const plan = await payments.choosePlan(mode, req.body.priceId);
  await audit(req, 'stripe_plan_chosen', { target: mode, detail: `${plan.name}: ${plan.amountCents} ${plan.currency} / ${plan.interval}` });
  res.json(await paymentsView(req));
}));

app.post('/api/admin/payments/:mode/refresh', requireSuperAdmin, h(async (req, res) => {
  const mode = stripeModeParam(req, res);
  if (!mode) return;
  await payments.refreshPlan(mode);
  res.json(await paymentsView(req));
}));

// ---------- admin: members ----------

app.get('/api/admin/members', requireAdmin, h(async (req, res) => {
  const mode = req.settings.paymentMode;
  const members = [];
  for (const u of await data.listUsers(['member'])) members.push(await settleUser(u));
  res.json({
    members: members.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      memberNumber: u.memberNumber,
      joinedAt: u.createdAt,
      joinedByName: u.joinedByName,
      // Signed up at the counter and hasn't opened the card on their phone yet.
      pending: isPendingCounterMember(u),
      status: billing.status(u, mode),
      billedBy: u.subscription ? billing.subMode(u.subscription) : null,
      selfieUrl: u.selfie ? selfiePath(u) : null,
      priceCents: u.subscription ? u.subscription.priceCents : null,
      interval: u.subscription ? u.subscription.interval || 'month' : null,
      currentPeriodEnd: u.subscription ? u.subscription.currentPeriodEnd : null,
      card: u.paymentMethod ? `${u.paymentMethod.brand} •••• ${u.paymentMethod.last4}` : null,
      lastScanAt: u.lastScanAt,
      lastScannedBy: u.lastScannedByName,
    })),
  });
}));

app.post('/api/admin/members/:id/reset-selfie', requireAdmin, h(async (req, res) => {
  const user = await data.userById(req.params.id);
  if (!user || user.role !== 'member') return fail(res, 404, 'Member not found.');
  await db.tx(async (conn) => {
    await data.updateUser(user.id, { selfieImageId: null, selfieUploadedAt: null }, conn);
    if (user.selfie) await data.deleteImage(user.selfie.imageId, conn);
  });
  await audit(req, 'selfie_reset', { target: `#${user.memberNumber}` });
  res.json({ ok: true });
}));

// ---------- admin: offers ----------

app.post('/api/admin/offers', requireAdmin, h(async (req, res) => {
  const title = cleanText(req.body.title, 80);
  const body = String(req.body.body || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 1000);
  if (!body) return fail(res, 400, 'Write a message for the offer.');
  let img = null;
  if (req.body.image) {
    img = decodeImage(req.body.image);
    if (!img) return fail(res, 400, 'That picture could not be used. Try a JPEG or PNG under 4 MB.');
  }
  const offer = { id: security.randomId(9), title, body, createdAt: new Date().toISOString(), imageId: null, createdBy: req.user.id };
  await db.tx(async (conn) => {
    if (img) {
      offer.imageId = security.randomId();
      await data.insertImage({ id: offer.imageId, kind: 'offer', mime: img.mime, bytes: img.buf }, conn);
    }
    await data.insertOffer(offer, conn);
  });
  await audit(req, 'offer_posted', { target: offer.id, detail: title || body.slice(0, 80) });
  res.status(201).json({ offer: offerView(offer) });
}));

app.delete('/api/admin/offers/:id', requireAdmin, h(async (req, res) => {
  const offer = await data.getOffer(req.params.id);
  if (!offer) return fail(res, 404, 'Offer not found.');
  await db.tx(async (conn) => {
    await data.deleteOffer(offer.id, conn);
    await data.deleteImage(offer.imageId, conn);
  });
  await audit(req, 'offer_deleted', { target: offer.id, detail: offer.title || offer.body.slice(0, 80) });
  res.json({ ok: true });
}));

// ---------- admin: staff ----------

// Only a super admin can add a super admin or change one's login.
function canManage(actor, role) {
  return role !== 'superadmin' || actor.role === 'superadmin';
}

app.get('/api/admin/staff', requireAdmin, h(async (req, res) => {
  res.json({ staff: (await data.listUsers(STAFF_ROLES)).map(staffView) });
}));

// New staff get a generated password to pass on, and choose their own at first sign-in.
app.post('/api/admin/staff', requireAdmin, h(async (req, res) => {
  const name = cleanText(req.body.name, 60);
  const email = cleanText(req.body.email, 120).toLowerCase();
  const role = req.body.role;
  if (name.length < 2) return fail(res, 400, 'Enter their name.');
  if (!EMAIL_RE.test(email)) return fail(res, 400, 'Enter a valid email address.');
  if (!STAFF_ROLES.includes(role)) return fail(res, 400, 'Pick Cashier, Admin or Super admin.');
  if (!canManage(req.user, role)) return fail(res, 403, 'Only a super admin can add a super admin.');
  const taken = 'That email already has an account.';
  if (await data.userByEmail(email)) return fail(res, 409, taken);
  const password = security.readablePassword();
  const user = {
    id: security.randomId(),
    role,
    name,
    email,
    phone: '',
    passwordHash: await security.hashPassword(password),
    mustChangePassword: true,
    createdAt: new Date().toISOString(),
  };
  try {
    await data.insertUser(user);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return fail(res, 409, taken);
    throw err;
  }
  await audit(req, 'staff_added', { target: email, detail: role });
  res.status(201).json({ staff: staffView(user), password });
}));

app.post('/api/admin/staff/:id/password', requireAdmin, h(async (req, res) => {
  const user = await data.userById(req.params.id);
  if (!user || !STAFF_ROLES.includes(user.role)) return fail(res, 404, 'Staff member not found.');
  if (user.id === req.user.id) return fail(res, 400, 'Change your own password from the menu.');
  if (!canManage(req.user, user.role)) return fail(res, 403, "Only a super admin can change a super admin's login.");
  const password = security.readablePassword();
  await data.updateUser(user.id, { passwordHash: await security.hashPassword(password), mustChangePassword: true });
  await data.deleteUserSessions(user.id);
  await audit(req, 'staff_password_reset', { target: user.email });
  res.json({ staff: staffView({ ...user, mustChangePassword: true }), password });
}));

// Removing someone signs them out at once. Nobody can remove themselves, so there is
// always at least one super admin.
app.delete('/api/admin/staff/:id', requireAdmin, h(async (req, res) => {
  const user = await data.userById(req.params.id);
  if (!user || !STAFF_ROLES.includes(user.role)) return fail(res, 404, 'Staff member not found.');
  if (user.id === req.user.id) return fail(res, 400, "You can't remove yourself. Ask another admin.");
  if (!canManage(req.user, user.role)) return fail(res, 403, 'Only a super admin can remove a super admin.');
  await data.deleteUser(user.id);
  await audit(req, 'staff_removed', { target: user.email, detail: user.role });
  res.json({ ok: true });
}));

// ---------- static app ----------

app.use('/api', (req, res) => fail(res, 404, 'Not found.'));
app.get('/admin', (req, res) => res.redirect('/#/admin/offers'));
// no-cache: browsers check for a newer file each time, so a deploy reaches everyone at once.
app.use(express.static(path.join(__dirname, 'public'), { dotfiles: 'ignore', setHeaders: (res) => res.set('Cache-Control', 'no-cache') }));

app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return fail(res, 413, 'That photo is too big. Try again with a smaller one.');
  if (err.type === 'entity.parse.failed') return fail(res, 400, 'The request could not be read.');
  if (err.expose) return fail(res, err.status || 400, err.message);
  if (err.status === 404) return fail(res, 404, 'Not found.');
  if (err.type === 'StripeCardError') return fail(res, 402, err.message);
  if (typeof err.type === 'string' && err.type.startsWith('Stripe')) {
    console.error(`${req.method} ${req.path}: ${err.type}: ${err.message}`);
    return fail(res, 502, `Stripe: ${err.message}`);
  }
  console.error(`${req.method} ${req.path}:`, err);
  if (res.headersSent) return next(err);
  fail(res, 500, 'Something went wrong. Please try again.');
});

// ---------- start ----------

// After a server reboot the app can start before MySQL is ready, so it waits up to a
// couple of minutes for the database before giving up (Docker then starts it again).
async function waitForDatabase() {
  for (let attempt = 1; ; attempt++) {
    try {
      await db.ping();
      return;
    } catch (err) {
      if (attempt >= 60) throw err;
      if (attempt === 1 || attempt % 10 === 0) console.log(`Waiting for the database (${err.code || err.message})…`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

// If the database stays unreachable while running, exit so Docker restarts the app,
// rather than answering every request with an error.
function watchDatabase() {
  let failures = 0;
  setInterval(async () => {
    try {
      await db.ping();
      failures = 0;
    } catch (err) {
      failures++;
      console.error(`Database check failed (${failures} in a row): ${err.code || err.message}`);
      if (failures >= 8) {
        console.error('The database has been unreachable for 2 minutes. Exiting so the app is restarted.');
        process.exit(1);
      }
    }
  }, 15e3).unref();
}

async function main() {
  const problems = configProblems();
  if (problems.length) {
    console.error('Not starting, because of these production settings:');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  await waitForDatabase();
  await db.migrate();
  const settings = await data.ensureSettings(defaultSettings());
  let secretsKey = SECRETS_KEY;
  if (!secretsKey) {
    // Production refuses to start without SECRETS_KEY (see configProblems).
    secretsKey = crypto.createHash('sha256').update(`secrets:${settings.mediaSecret}`).digest('hex');
    console.log('SECRETS_KEY is not set: Stripe keys are encrypted with a key kept in the database (fine for local use only).');
  }
  security.init({ mediaSecret: settings.mediaSecret, secretsKey, secure: COOKIE_SECURE });
  DUMMY_HASH = await security.hashPassword(security.randomId());
  await ensureSuperAdmin();

  const server = app.listen(PORT, HOST, () => {
    console.log(`Bin Mania membership${PROD ? '' : ' (development)'}: http://localhost:${PORT}`);
    if (!PROD && HOST === '0.0.0.0') {
      for (const addrs of Object.values(os.networkInterfaces())) {
        for (const a of addrs || []) {
          if (a.family === 'IPv4' && !a.internal) console.log(`  on your network: http://${a.address}:${PORT}`);
        }
      }
    }
  });
  setInterval(() => data.purgeSessions().catch((err) => console.error('Session cleanup failed:', err.message)), 3600e3).unref();
  watchDatabase();

  const stop = () => {
    server.close(() => db.close().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 10e3).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch((err) => {
  console.error(`Could not start: ${err.message}`);
  if (['ECONNREFUSED', 'ER_ACCESS_DENIED_ERROR', 'ER_BAD_DB_ERROR', 'ENOTFOUND'].includes(err.code)) {
    console.error('Check the database settings: DATABASE_URL, or DB_HOST, DB_PORT, DB_USER, DB_PASSWORD and DB_NAME.');
  }
  process.exit(1);
});
