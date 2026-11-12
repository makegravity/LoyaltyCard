'use strict';
// Reads and writes for every table. Rows become the plain objects the rest of the app
// uses (camelCase, ISO date strings); `conn` runs a call inside a transaction.
const db = require('./db');

const iso = (v) => (v == null ? null : new Date(v).toISOString());
const date = (v) => (v == null ? null : new Date(v));
const json = (v) => (v == null ? null : typeof v === 'string' ? JSON.parse(v) : v);

// ---------- settings ----------

function toSettings(r) {
  return {
    programName: r.program_name,
    monthlyPriceCents: r.monthly_price_cents,
    paymentMode: r.payment_mode,
    qrPeriodSeconds: r.qr_period_seconds,
    perks: r.perks,
    posKeyHash: r.pos_key_hash,
    posKeyHint: r.pos_key_hint,
    posKeyCreatedAt: iso(r.pos_key_created_at),
    mediaSecret: r.media_secret,
    nextMemberNumber: r.next_member_number,
  };
}

const SETTINGS_COLUMNS = {
  programName: 'program_name',
  monthlyPriceCents: 'monthly_price_cents',
  paymentMode: 'payment_mode',
  qrPeriodSeconds: 'qr_period_seconds',
  perks: 'perks',
  posKeyHash: 'pos_key_hash',
  posKeyHint: 'pos_key_hint',
  posKeyCreatedAt: 'pos_key_created_at',
  mediaSecret: 'media_secret',
  nextMemberNumber: 'next_member_number',
};

async function getSettings(conn) {
  const r = await db.one('SELECT * FROM settings WHERE id = 1', [], conn);
  return r ? toSettings(r) : null;
}

// Creates the settings row on first start; does nothing when it exists.
async function ensureSettings(defaults) {
  const cols = Object.keys(defaults).map((k) => SETTINGS_COLUMNS[k]);
  await db.query(
    `INSERT IGNORE INTO settings (id, ${cols.join(', ')}, updated_at) VALUES (1, ${cols.map(() => '?').join(', ')}, ?)`,
    [...Object.values(defaults).map(dbValue), new Date()]
  );
  return getSettings();
}

async function updateSettings(fields, conn) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  await db.query(
    `UPDATE settings SET ${keys.map((k) => `${SETTINGS_COLUMNS[k]} = ?`).join(', ')}, updated_at = ? WHERE id = 1`,
    [...keys.map((k) => dbValue(fields[k])), new Date()],
    conn
  );
}

// Hands out the next member number atomically, even with several app instances.
async function takeMemberNumber(conn) {
  const r = await db.query('UPDATE settings SET next_member_number = LAST_INSERT_ID(next_member_number + 1) WHERE id = 1', [], conn);
  return Number(r.insertId) - 1;
}

function dbValue(v) {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/.test(v)) return new Date(v);
  return v === undefined ? null : v;
}

// ---------- users ----------

function toUser(r) {
  if (!r) return null;
  return {
    id: r.id,
    role: r.role,
    name: r.name,
    email: r.email,
    phone: r.phone,
    passwordHash: r.password_hash,
    mustChangePassword: !!r.must_change_password,
    createdAt: iso(r.created_at),
    passwordChangedAt: iso(r.password_changed_at),
    lastLoginAt: iso(r.last_login_at),
    memberNumber: r.member_number,
    qrSecret: r.qr_secret,
    selfie: r.selfie_image_id ? { imageId: r.selfie_image_id, uploadedAt: iso(r.selfie_uploaded_at) } : null,
    subscription: json(r.subscription),
    paymentMethod: json(r.payment_method),
    lastScannedCodeStart: r.last_scanned_code_start == null ? null : Number(r.last_scanned_code_start),
    lastScanAt: iso(r.last_scan_at),
    lastScannedByName: r.last_scanned_by_name,
    stripeCustomers: json(r.stripe_customers) || {},
    joinedByName: r.joined_by_name,
  };
}

const USER_COLUMNS = {
  id: 'id',
  role: 'role',
  name: 'name',
  email: 'email',
  phone: 'phone',
  passwordHash: 'password_hash',
  mustChangePassword: 'must_change_password',
  createdAt: 'created_at',
  passwordChangedAt: 'password_changed_at',
  lastLoginAt: 'last_login_at',
  memberNumber: 'member_number',
  qrSecret: 'qr_secret',
  selfieImageId: 'selfie_image_id',
  selfieUploadedAt: 'selfie_uploaded_at',
  subscription: 'subscription',
  paymentMethod: 'payment_method',
  lastScannedCodeStart: 'last_scanned_code_start',
  lastScanAt: 'last_scan_at',
  lastScannedByName: 'last_scanned_by_name',
  stripeCustomers: 'stripe_customers',
  joinedByName: 'joined_by_name',
};
const JSON_FIELDS = new Set(['subscription', 'paymentMethod', 'stripeCustomers']);

function userValue(key, v) {
  if (JSON_FIELDS.has(key)) return v == null ? null : JSON.stringify(v);
  return dbValue(v);
}

async function insertUser(user, conn) {
  const keys = Object.keys(user).filter((k) => USER_COLUMNS[k]);
  await db.query(
    `INSERT INTO users (${keys.map((k) => USER_COLUMNS[k]).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
    keys.map((k) => userValue(k, user[k])),
    conn
  );
}

async function updateUser(id, fields, conn) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  await db.query(
    `UPDATE users SET ${keys.map((k) => `${USER_COLUMNS[k]} = ?`).join(', ')} WHERE id = ?`,
    [...keys.map((k) => userValue(k, fields[k])), id],
    conn
  );
}

// With `lock`, the row stays locked until the transaction on `conn` ends.
async function userById(id, { conn = null, lock = false } = {}) {
  return toUser(await db.one(`SELECT * FROM users WHERE id = ?${lock ? ' FOR UPDATE' : ''}`, [String(id)], conn));
}

async function userByEmail(email) {
  return toUser(await db.one('SELECT * FROM users WHERE email = ?', [email]));
}

async function memberByNumber(memberNumber) {
  return toUser(await db.one("SELECT * FROM users WHERE role = 'member' AND member_number = ?", [memberNumber]));
}

async function listUsers(roles) {
  const rows = await db.query(
    `SELECT * FROM users WHERE role IN (${roles.map(() => '?').join(', ')}) ORDER BY created_at DESC`,
    roles
  );
  return rows.map(toUser);
}

async function countUsers(role) {
  const r = await db.one('SELECT COUNT(*) AS n FROM users WHERE role = ?', [role]);
  return Number(r.n);
}

async function oldestUser(role) {
  return toUser(await db.one('SELECT * FROM users WHERE role = ? ORDER BY created_at LIMIT 1', [role]));
}

async function deleteUser(id) {
  await db.query('DELETE FROM users WHERE id = ?', [id]);
}

// Records a scan only if no later code was scanned first, so a code works once even
// when two registers scan it at the same moment. Returns false if it was already used.
async function markScanned(userId, codeStart, byName) {
  const r = await db.query(
    `UPDATE users SET last_scanned_code_start = ?, last_scan_at = ?, last_scanned_by_name = ?
      WHERE id = ? AND (last_scanned_code_start IS NULL OR last_scanned_code_start < ?)`,
    [codeStart, new Date(), byName, userId, codeStart]
  );
  return r.affectedRows === 1;
}

// ---------- images ----------

async function insertImage(image, conn) {
  await db.query('INSERT INTO images (id, kind, mime, bytes, created_at) VALUES (?, ?, ?, ?, ?)', [
    image.id,
    image.kind,
    image.mime,
    image.bytes,
    date(image.createdAt) || new Date(),
  ], conn);
}

async function getImage(id) {
  const r = await db.one('SELECT id, kind, mime, bytes FROM images WHERE id = ?', [String(id)]);
  return r ? { id: r.id, kind: r.kind, mime: r.mime, bytes: r.bytes } : null;
}

async function deleteImage(id, conn) {
  if (id) await db.query('DELETE FROM images WHERE id = ?', [id], conn);
}

// ---------- offers ----------

function toOffer(r) {
  return { id: r.id, title: r.title, body: r.body, imageId: r.image_id, createdAt: iso(r.created_at) };
}

async function listOffers() {
  return (await db.query('SELECT * FROM offers ORDER BY created_at DESC')).map(toOffer);
}

async function getOffer(id) {
  const r = await db.one('SELECT * FROM offers WHERE id = ?', [String(id)]);
  return r ? toOffer(r) : null;
}

async function insertOffer(offer, conn) {
  await db.query('INSERT INTO offers (id, title, body, image_id, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)', [
    offer.id,
    offer.title,
    offer.body,
    offer.imageId || null,
    date(offer.createdAt),
    offer.createdBy || null,
  ], conn);
}

async function deleteOffer(id, conn) {
  await db.query('DELETE FROM offers WHERE id = ?', [id], conn);
}

// ---------- invoices ----------

function toInvoice(r) {
  return {
    id: r.id,
    number: `BM-${String(r.seq).padStart(5, '0')}`,
    userId: r.user_id,
    amountCents: r.amount_cents,
    periodStart: iso(r.period_start),
    periodEnd: iso(r.period_end),
    createdAt: iso(r.created_at),
    status: r.status,
    demo: !!r.demo,
    mode: r.mode,
    card: r.card,
    receiptUrl: r.receipt_url,
  };
}

// A Stripe invoice is recorded once, however many times its webhook or a sync reports it.
async function insertInvoice(inv, conn) {
  await db.query(
    `INSERT INTO invoices (id, user_id, amount_cents, period_start, period_end, created_at, status, demo, card, mode, stripe_invoice_id, receipt_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE receipt_url = VALUES(receipt_url)`,
    [
      inv.id,
      inv.userId,
      inv.amountCents,
      date(inv.periodStart),
      date(inv.periodEnd),
      date(inv.createdAt),
      inv.status,
      inv.demo ? 1 : 0,
      inv.card,
      inv.mode || 'demo',
      inv.stripeInvoiceId || null,
      inv.receiptUrl || null,
    ],
    conn
  );
}

async function invoicesFor(userId) {
  return (await db.query('SELECT * FROM invoices WHERE user_id = ? ORDER BY created_at DESC, seq DESC', [userId])).map(toInvoice);
}

// ---------- Stripe keys ----------

function toStripeAccount(r) {
  return {
    mode: r.mode,
    publishableKey: r.publishable_key,
    secretKeyEnc: r.secret_key_enc,
    secretKeyHint: r.secret_key_hint,
    webhookSecretEnc: r.webhook_secret_enc,
    webhookEndpointId: r.webhook_endpoint_id,
    accountId: r.account_id,
    accountName: r.account_name,
    priceId: r.price_id,
    plan: json(r.plan),
    planSyncedAt: iso(r.plan_synced_at),
    updatedAt: iso(r.updated_at),
    updatedByName: r.updated_by_name,
  };
}

async function getStripeAccount(mode) {
  const r = await db.one('SELECT * FROM stripe_accounts WHERE mode = ?', [mode]);
  return r ? toStripeAccount(r) : null;
}

async function saveStripeAccount(a) {
  const row = [
    a.mode,
    a.publishableKey,
    a.secretKeyEnc,
    a.secretKeyHint,
    a.webhookSecretEnc || null,
    a.webhookEndpointId || null,
    a.accountId,
    a.accountName || '',
    a.priceId || null,
    a.plan ? JSON.stringify(a.plan) : null,
    date(a.planSyncedAt),
    new Date(),
    a.updatedByName || null,
  ];
  await db.query(
    `REPLACE INTO stripe_accounts (mode, publishable_key, secret_key_enc, secret_key_hint, webhook_secret_enc,
      webhook_endpoint_id, account_id, account_name, price_id, plan, plan_synced_at, updated_at, updated_by_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row
  );
}

// The plan new members join on: a Stripe price id and a copy of what it costs.
async function setStripePlan(mode, priceId, plan) {
  await db.query('UPDATE stripe_accounts SET price_id = ?, plan = ?, plan_synced_at = ? WHERE mode = ?', [
    priceId,
    plan ? JSON.stringify(plan) : null,
    new Date(),
    mode,
  ]);
}

async function deleteStripeAccount(mode) {
  await db.query('DELETE FROM stripe_accounts WHERE mode = ?', [mode]);
}

// ---------- claim links ----------

async function createClaimLink({ tokenHash, userId, expiresAt }) {
  await db.tx(async (conn) => {
    await db.query('DELETE FROM claim_links WHERE user_id = ?', [userId], conn);
    await db.query('INSERT INTO claim_links (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', [
      tokenHash,
      userId,
      new Date(),
      expiresAt,
    ], conn);
  });
}

async function claimLinkUser(tokenHash) {
  return toUser(
    await db.one('SELECT u.* FROM claim_links c JOIN users u ON u.id = c.user_id WHERE c.token_hash = ? AND c.expires_at > ?', [
      tokenHash,
      new Date(),
    ])
  );
}

async function deleteClaimLinks(userId) {
  await db.query('DELETE FROM claim_links WHERE user_id = ?', [userId]);
}

// ---------- password reset links ----------

async function createPasswordReset({ tokenHash, userId, expiresAt }) {
  await db.query('INSERT INTO password_resets (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', [
    tokenHash,
    userId,
    new Date(),
    expiresAt,
  ]);
}

async function passwordResetUser(tokenHash) {
  return toUser(
    await db.one('SELECT u.* FROM password_resets r JOIN users u ON u.id = r.user_id WHERE r.token_hash = ? AND r.expires_at > ?', [
      tokenHash,
      new Date(),
    ])
  );
}

// Uses a link up. True for the one request that gets it, however many arrive at once.
async function takePasswordReset(tokenHash) {
  const result = await db.query('DELETE FROM password_resets WHERE token_hash = ? AND expires_at > ?', [tokenHash, new Date()]);
  return result.affectedRows === 1;
}

async function deletePasswordResets(userId) {
  await db.query('DELETE FROM password_resets WHERE user_id = ?', [userId]);
}

// ---------- sessions ----------

async function createSession(s) {
  await db.query('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)', [
    s.tokenHash,
    s.userId,
    new Date(),
    s.expiresAt,
    s.ip || null,
    s.userAgent ? String(s.userAgent).slice(0, 200) : null,
  ]);
}

// The signed-in user, with `elevatedUntil` set while a password confirmation holds.
async function sessionUser(tokenHash) {
  const r = await db.one(
    'SELECT u.*, s.elevated_until AS session_elevated_until FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?',
    [tokenHash, new Date()]
  );
  const user = toUser(r);
  if (user) user.elevatedUntil = iso(r.session_elevated_until);
  return user;
}

async function elevateSession(tokenHash, until) {
  await db.query('UPDATE sessions SET elevated_until = ? WHERE token_hash = ?', [until, tokenHash]);
}

async function deleteSession(tokenHash) {
  await db.query('DELETE FROM sessions WHERE token_hash = ?', [tokenHash]);
}

// Signs a person out everywhere, except (optionally) the session they are using.
async function deleteUserSessions(userId, exceptTokenHash = null) {
  await db.query('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?', [userId, exceptTokenHash || '']);
}

async function purgeSessions() {
  await db.query('DELETE FROM sessions WHERE expires_at <= ?', [new Date()]);
  await db.query('DELETE FROM claim_links WHERE expires_at <= ?', [new Date()]);
  await db.query('DELETE FROM password_resets WHERE expires_at <= ?', [new Date()]);
}

// ---------- audit log ----------

async function audit(entry) {
  await db.query('INSERT INTO audit_log (at, actor_id, actor_role, action, target, detail, ip) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    new Date(),
    entry.actorId || null,
    entry.actorRole || null,
    entry.action,
    entry.target == null ? null : String(entry.target).slice(0, 120),
    entry.detail == null ? null : String(entry.detail).slice(0, 500),
    entry.ip || null,
  ]);
}

module.exports = {
  getSettings,
  ensureSettings,
  updateSettings,
  takeMemberNumber,
  insertUser,
  updateUser,
  userById,
  userByEmail,
  memberByNumber,
  listUsers,
  countUsers,
  oldestUser,
  deleteUser,
  markScanned,
  insertImage,
  getImage,
  deleteImage,
  listOffers,
  getOffer,
  insertOffer,
  deleteOffer,
  insertInvoice,
  invoicesFor,
  getStripeAccount,
  saveStripeAccount,
  setStripePlan,
  deleteStripeAccount,
  createClaimLink,
  claimLinkUser,
  deleteClaimLinks,
  createPasswordReset,
  passwordResetUser,
  takePasswordReset,
  deletePasswordResets,
  createSession,
  sessionUser,
  elevateSession,
  deleteSession,
  deleteUserSessions,
  purgeSessions,
  audit,
};
