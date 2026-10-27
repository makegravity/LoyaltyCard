'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const QRCode = require('qrcode');
const store = require('./lib/store');
const security = require('./lib/security');
const pass = require('./lib/pass');
const billing = require('./lib/billing');

const PORT = Number(process.env.PORT || 4090);
const HOST = process.env.HOST || '0.0.0.0';
const QR_PERIODS = [10, 15, 20, 30, 60];
const CARD_BRANDS = ['Visa', 'Mastercard', 'Amex', 'Discover', 'Card'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

store.load();
security.init(store.DATA_DIR);
const db = store.db;
ensureSettings();
ensureAdmin();

const app = express();
app.disable('x-powered-by');
// Behind a reverse proxy, trust its X-Forwarded-* headers so req.ip is the visitor's
// address (for the login limit) and req.protocol is https (for selfie links).
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);
app.use(securityHeaders);
app.use(sameOriginWrites);
app.use(express.json({ limit: '8mb' }));
app.use((req, res, next) => {
  const id = security.readSession(req.headers.cookie);
  req.user = id ? db.users.find((u) => u.id === id) || null : null;
  next();
});

// ---------- setup ----------

function ensureSettings() {
  db.settings = {
    programName: 'Bin Mania VIP',
    monthlyPriceCents: 999,
    demoMode: true,
    qrPeriodSeconds: 20,
    perks: [
      'Members-only deals posted every week',
      'First word on Friday tag colors and new drops',
      'Your digital card, always on your phone',
    ].join('\n'),
    posApiKey: 'pos_' + security.randomId(18),
    ...db.settings,
  };
  store.save();
}

// The first run makes the admin login: ADMIN_EMAIL / ADMIN_PASSWORD, or a generated
// password written to data/admin-login.txt.
function ensureAdmin() {
  if (db.users.some((u) => u.role === 'admin')) return;
  const email = (process.env.ADMIN_EMAIL || 'admin@binmania.local').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || security.randomId(9);
  db.users.push({
    id: security.randomId(),
    role: 'admin',
    name: 'Bin Mania Admin',
    email,
    passwordHash: security.hashPassword(password),
    createdAt: new Date().toISOString(),
  });
  store.save();
  fs.writeFileSync(path.join(store.DATA_DIR, 'admin-login.txt'), `Email: ${email}\nPassword: ${password}\n`);
  console.log(`Admin login created: ${email} / ${password} (also saved in data/admin-login.txt)`);
}

// ---------- middleware ----------

function securityHeaders(req, res, next) {
  res.set({
    'Content-Security-Policy': [
      "default-src 'self'",
      "img-src 'self' data: blob:",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "script-src 'self'",
      "connect-src 'self'",
      "media-src 'self' blob:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
  });
  next();
}

// Session cookies are SameSite=Lax; this also refuses writes another site's page sends.
// The POS endpoint is exempt: it is called server to server with an API key.
function sameOriginWrites(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.path.startsWith('/api/pos/')) return next();
  const origin = req.get('origin');
  if (origin) {
    let host = null;
    try {
      host = new URL(origin).host;
    } catch {}
    if (host !== req.get('host')) return fail(res, 403, 'Cross-site request blocked.');
  }
  next();
}

function requireUser(req, res, next) {
  if (!req.user) return fail(res, 401, 'Please sign in.');
  next();
}

function requireMember(req, res, next) {
  if (!req.user) return fail(res, 401, 'Please sign in.');
  if (req.user.role !== 'member') return fail(res, 403, 'This page is for members.');
  if (billing.settle(db, req.user)) store.save();
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return fail(res, 401, 'Please sign in.');
  if (req.user.role !== 'admin') return fail(res, 403, 'Admins only.');
  next();
}

// ---------- helpers ----------

function fail(res, status, error, extra = {}) {
  return res.status(status).json({ error, ...extra });
}

function cleanText(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function byNewest(a, b) {
  return Date.parse(b.createdAt) - Date.parse(a.createdAt);
}

function baseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Accepts a data: URL from the browser and checks the bytes really are an image.
function decodeImage(dataUrl) {
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!match) return null;
  const buf = Buffer.from(match[2], 'base64');
  if (buf.length < 100 || buf.length > 4 * 1024 * 1024) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { buf, ext: 'jpg' };
  if (buf.subarray(0, 8).equals(PNG_SIGNATURE)) return { buf, ext: 'png' };
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return { buf, ext: 'webp' };
  return null;
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

function publicConfig() {
  const s = db.settings;
  return {
    programName: s.programName,
    monthlyPriceCents: s.monthlyPriceCents,
    currency: 'usd',
    demoMode: s.demoMode,
    stripeConnected: false,
    qrPeriodSeconds: s.qrPeriodSeconds,
    perks: s.perks.split('\n').filter(Boolean),
  };
}

function selfiePath(user) {
  return `/api/selfie/${user.id}?v=${Date.parse(user.selfie.uploadedAt)}`;
}

function signedSelfieUrl(req, user) {
  return `${baseUrl(req)}/api/selfie/${user.id}?${security.signMedia('selfie', user.id)}`;
}

function meView(user) {
  return {
    id: user.id,
    role: user.role,
    name: user.name,
    email: user.email,
    phone: user.phone || '',
    memberNumber: user.memberNumber || null,
    memberSince: user.createdAt,
    selfieUrl: user.selfie ? selfiePath(user) : null,
    status: user.role === 'member' ? billing.status(user) : null,
    subscription: user.subscription || null,
    paymentMethod: user.paymentMethod || null,
  };
}

function offerView(offer) {
  return {
    id: offer.id,
    title: offer.title,
    body: offer.body,
    createdAt: offer.createdAt,
    imageUrl: offer.image ? `/api/offers/${offer.id}/image` : null,
  };
}

// ---------- public + auth ----------

app.get('/api/config', (req, res) => res.json(publicConfig()));

app.post('/api/auth/signup', (req, res) => {
  const name = cleanText(req.body.name, 60);
  const email = cleanText(req.body.email, 120).toLowerCase();
  const phone = cleanText(req.body.phone, 30);
  const password = String(req.body.password || '');
  if (name.length < 2) return fail(res, 400, 'Please enter your name.');
  if (!EMAIL_RE.test(email)) return fail(res, 400, 'Please enter a valid email address.');
  if (password.length < 8) return fail(res, 400, 'Use at least 8 characters for your password.');
  if (db.users.some((u) => u.email === email)) {
    return fail(res, 409, 'That email already has an account. Sign in instead.');
  }
  const user = {
    id: security.randomId(),
    role: 'member',
    name,
    email,
    phone,
    passwordHash: security.hashPassword(password),
    createdAt: new Date().toISOString(),
    memberNumber: db.nextMemberNumber++,
    qrSecret: security.randomId(32),
    selfie: null,
    subscription: null,
    paymentMethod: null,
    lastScannedCodeStart: null,
    lastScanAt: null,
  };
  db.users.push(user);
  store.save();
  res.set('Set-Cookie', security.sessionCookie(user.id));
  res.status(201).json({ me: meView(user) });
});

const loginAttempts = new Map();

function tooManyAttempts(key) {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || entry.resetAt < now) {
    loginAttempts.set(key, { count: 1, resetAt: now + 15 * 60e3 });
    return false;
  }
  entry.count += 1;
  return entry.count > 10;
}

app.post('/api/auth/login', (req, res) => {
  const email = cleanText(req.body.email, 120).toLowerCase();
  const key = `${req.ip}|${email}`;
  if (tooManyAttempts(key)) return fail(res, 429, 'Too many tries. Wait 15 minutes and try again.');
  const user = db.users.find((u) => u.email === email);
  if (!user || !security.verifyPassword(String(req.body.password || ''), user.passwordHash)) {
    return fail(res, 401, "That email and password don't match.");
  }
  loginAttempts.delete(key);
  if (billing.settle(db, user)) store.save();
  res.set('Set-Cookie', security.sessionCookie(user.id));
  res.json({ me: meView(user) });
});

app.post('/api/auth/logout', (req, res) => {
  res.set('Set-Cookie', security.clearedCookie());
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!req.user) return res.json({ me: null });
  if (billing.settle(db, req.user)) store.save();
  res.json({ me: meView(req.user) });
});

// ---------- member: join, selfie, card ----------

app.post('/api/me/subscribe', requireMember, (req, res) => {
  const user = req.user;
  if (!db.settings.demoMode) return fail(res, 503, 'Online payments are not open yet.');
  if (billing.isActive(user)) return fail(res, 409, 'Your membership is already active.');
  if (!(req.body.useSavedCard && user.paymentMethod)) {
    const { card, error } = readCard(req.body);
    if (error) return fail(res, 400, error);
    user.paymentMethod = card;
  }
  billing.start(db, user, db.settings.monthlyPriceCents);
  store.save();
  res.json({ me: meView(user) });
});

// A member sets their photo once. Staff can clear it from Members to ask for a new one,
// so a card can't be handed to someone else by swapping the photo.
app.post('/api/me/selfie', requireMember, (req, res) => {
  const user = req.user;
  if (user.selfie) return fail(res, 409, 'Your card already has a photo. Ask a team member to reset it.');
  const img = decodeImage(req.body.image);
  if (!img) return fail(res, 400, 'Please take a photo (JPEG or PNG, under 4 MB).');
  const file = `${user.id}-${Date.now()}.${img.ext}`;
  fs.writeFileSync(path.join(store.SELFIE_DIR, file), img.buf);
  user.selfie = { file, uploadedAt: new Date().toISOString() };
  store.save();
  res.json({ me: meView(user) });
});

app.get('/api/selfie/:id', (req, res) => {
  const user = db.users.find((u) => u.id === req.params.id);
  if (!user || !user.selfie) return res.status(404).end();
  const allowed =
    (req.user && (req.user.id === user.id || req.user.role === 'admin')) ||
    security.verifyMedia('selfie', user.id, req.query.exp, req.query.sig);
  if (!allowed) return res.status(403).end();
  res.set('Cache-Control', 'private, max-age=3600');
  res.sendFile(path.join(store.SELFIE_DIR, user.selfie.file));
});

app.get('/api/me/pass', requireMember, async (req, res, next) => {
  const user = req.user;
  res.set('Cache-Control', 'no-store');
  if (!billing.isActive(user)) return fail(res, 403, 'Your membership is not active.', { reason: 'inactive' });
  if (!user.selfie) return fail(res, 409, 'Add your selfie to get your card.', { reason: 'selfie' });
  const period = db.settings.qrPeriodSeconds;
  const now = Date.now();
  const cur = pass.current(user, period, now);
  try {
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
  } catch (err) {
    next(err);
  }
});

app.get('/api/offers', requireUser, (req, res) => {
  res.json({ offers: db.offers.slice().sort(byNewest).map(offerView) });
});

app.get('/api/offers/:id/image', requireUser, (req, res) => {
  const offer = db.offers.find((o) => o.id === req.params.id);
  if (!offer || !offer.image) return res.status(404).end();
  res.set('Cache-Control', 'private, max-age=86400');
  res.sendFile(path.join(store.OFFER_DIR, offer.image));
});

// ---------- member: billing ----------

app.get('/api/me/billing', requireMember, (req, res) => {
  const invoices = db.invoices.filter((i) => i.userId === req.user.id).sort(byNewest);
  res.json({ me: meView(req.user), invoices });
});

app.post('/api/me/billing/payment-method', requireMember, (req, res) => {
  if (!db.settings.demoMode) return fail(res, 503, 'Online payments are not open yet.');
  const { card, error } = readCard(req.body);
  if (error) return fail(res, 400, error);
  req.user.paymentMethod = card;
  store.save();
  res.json({ me: meView(req.user) });
});

app.post('/api/me/billing/cancel', requireMember, (req, res) => {
  const sub = req.user.subscription;
  if (billing.status(req.user) !== 'active') return fail(res, 409, 'There is no active membership to cancel.');
  sub.cancelAtPeriodEnd = true;
  sub.canceledAt = new Date().toISOString();
  store.save();
  res.json({ me: meView(req.user) });
});

app.post('/api/me/billing/resume', requireMember, (req, res) => {
  const sub = req.user.subscription;
  if (billing.status(req.user) !== 'canceling') return fail(res, 409, 'Your membership is not set to cancel.');
  sub.cancelAtPeriodEnd = false;
  sub.canceledAt = null;
  store.save();
  res.json({ me: meView(req.user) });
});

// ---------- code checks (admin page and future POS) ----------

function memberSummary(req, user) {
  return {
    memberNumber: user.memberNumber,
    name: user.name,
    status: billing.status(user),
    memberSince: user.createdAt,
    selfieUrl: user.selfie ? signedSelfieUrl(req, user) : null,
  };
}

function verifyCode(req, rawCode) {
  const parsed = pass.parse(rawCode);
  if (!parsed) return { valid: false, reason: 'unreadable', message: 'This is not a Bin Mania membership code.' };
  const user = db.users.find((u) => u.role === 'member' && u.memberNumber === parsed.memberNumber);
  if (!user) return { valid: false, reason: 'unknown_member', message: 'No member has this code.' };
  const period = db.settings.qrPeriodSeconds;
  const result = pass.check(user, parsed, period);
  if (result === 'bad_signature') return { valid: false, reason: 'invalid', message: 'This code is not genuine.' };
  if (result === 'expired') {
    return { valid: false, reason: 'expired', message: 'This code has expired. Ask the member to open their live card.' };
  }
  // Each code scans once, so a forwarded screenshot fails even inside its time window.
  const codeStart = parsed.window * period * 1000;
  if (user.lastScannedCodeStart != null && codeStart <= user.lastScannedCodeStart) {
    return {
      valid: false,
      reason: 'already_used',
      message: 'This code was already scanned. Ask the member for the new code on their screen.',
    };
  }
  billing.settle(db, user);
  if (!billing.isActive(user)) {
    store.save();
    return { valid: false, reason: 'inactive', message: 'This membership is not active.', member: memberSummary(req, user) };
  }
  user.lastScannedCodeStart = codeStart;
  user.lastScanAt = new Date().toISOString();
  store.save();
  return { valid: true, reason: 'ok', message: 'Active member', member: memberSummary(req, user) };
}

app.post('/api/pos/verify', (req, res) => {
  if (!security.safeEqual(req.get('x-pos-key') || '', db.settings.posApiKey)) {
    return fail(res, 401, 'Missing or wrong X-POS-Key header.');
  }
  res.json(verifyCode(req, req.body.code));
});

app.post('/api/admin/verify', requireAdmin, (req, res) => {
  res.json(verifyCode(req, req.body.code));
});

// ---------- admin ----------

function adminSettingsView() {
  return { ...db.settings, stripeConnected: false, qrPeriodOptions: QR_PERIODS };
}

app.get('/api/admin/settings', requireAdmin, (req, res) => res.json({ settings: adminSettingsView() }));

app.put('/api/admin/settings', requireAdmin, (req, res) => {
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
  if ('demoMode' in body) next.demoMode = body.demoMode === true;
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
  Object.assign(db.settings, next);
  store.save();
  res.json({ settings: adminSettingsView() });
});

app.post('/api/admin/settings/pos-key', requireAdmin, (req, res) => {
  db.settings.posApiKey = 'pos_' + security.randomId(18);
  store.save();
  res.json({ settings: adminSettingsView() });
});

app.get('/api/admin/members', requireAdmin, (req, res) => {
  const members = db.users.filter((u) => u.role === 'member');
  let changed = false;
  for (const user of members) changed = billing.settle(db, user) || changed;
  if (changed) store.save();
  res.json({
    members: members.sort(byNewest).map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      memberNumber: u.memberNumber,
      joinedAt: u.createdAt,
      status: billing.status(u),
      selfieUrl: u.selfie ? selfiePath(u) : null,
      priceCents: u.subscription ? u.subscription.priceCents : null,
      currentPeriodEnd: u.subscription ? u.subscription.currentPeriodEnd : null,
      card: u.paymentMethod ? `${u.paymentMethod.brand} •••• ${u.paymentMethod.last4}` : null,
      lastScanAt: u.lastScanAt,
    })),
  });
});

app.post('/api/admin/members/:id/reset-selfie', requireAdmin, (req, res) => {
  const user = db.users.find((u) => u.id === req.params.id && u.role === 'member');
  if (!user) return fail(res, 404, 'Member not found.');
  if (user.selfie) fs.rm(path.join(store.SELFIE_DIR, user.selfie.file), { force: true }, () => {});
  user.selfie = null;
  store.save();
  res.json({ ok: true });
});

app.post('/api/admin/offers', requireAdmin, (req, res) => {
  const title = cleanText(req.body.title, 80);
  const body = String(req.body.body || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 1000);
  if (!body) return fail(res, 400, 'Write a message for the offer.');
  const offer = { id: security.randomId(9), title, body, createdAt: new Date().toISOString(), image: null };
  if (req.body.image) {
    const img = decodeImage(req.body.image);
    if (!img) return fail(res, 400, 'That picture could not be used. Try a JPEG or PNG under 4 MB.');
    offer.image = `${offer.id}.${img.ext}`;
    fs.writeFileSync(path.join(store.OFFER_DIR, offer.image), img.buf);
  }
  db.offers.push(offer);
  store.save();
  res.status(201).json({ offer: offerView(offer) });
});

app.delete('/api/admin/offers/:id', requireAdmin, (req, res) => {
  const index = db.offers.findIndex((o) => o.id === req.params.id);
  if (index === -1) return fail(res, 404, 'Offer not found.');
  const [offer] = db.offers.splice(index, 1);
  if (offer.image) fs.rm(path.join(store.OFFER_DIR, offer.image), { force: true }, () => {});
  store.save();
  res.json({ ok: true });
});

// ---------- static app ----------

app.use('/api', (req, res) => fail(res, 404, 'Not found.'));
app.get('/admin', (req, res) => res.redirect('/#/admin/offers'));
app.use(express.static(path.join(__dirname, 'public')));

app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return fail(res, 413, 'That photo is too big. Try again with a smaller one.');
  if (err.type === 'entity.parse.failed') return fail(res, 400, 'The request could not be read.');
  console.error(err);
  fail(res, 500, 'Something went wrong. Please try again.');
});

app.listen(PORT, HOST, () => {
  console.log(`Bin Mania membership prototype: http://localhost:${PORT}`);
  if (HOST === '0.0.0.0') {
    for (const addrs of Object.values(os.networkInterfaces())) {
      for (const a of addrs || []) {
        if (a.family === 'IPv4' && !a.internal) console.log(`  on your network: http://${a.address}:${PORT}`);
      }
    }
  }
});
