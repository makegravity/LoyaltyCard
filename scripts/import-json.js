'use strict';
// Copies the prototype's JSON data (db.json and the uploads folder) into MySQL.
// Usage: node scripts/import-json.js <data folder> [--replace]
//
// Uses the same database settings as the app. Stop the app first. The database must
// have no users yet, or pass --replace to delete everything in it before importing.
// Members keep their ids, member numbers, passwords, photos and billing; everyone
// signs in again afterwards. The old POS key keeps working. With NODE_ENV=production,
// imported admins must choose a new password at their next sign-in.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../lib/db');
const data = require('../lib/data');
const security = require('../lib/security');

const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

function readImage(dir, file) {
  const full = path.join(dir, file);
  if (!fs.existsSync(full)) return null;
  const mime = MIME[path.extname(file).slice(1).toLowerCase()];
  return mime ? { mime, bytes: fs.readFileSync(full) } : null;
}

async function main() {
  const dataDir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'data'));
  const replace = process.argv.includes('--replace');
  const json = JSON.parse(fs.readFileSync(path.join(dataDir, 'db.json'), 'utf8'));
  const selfieDir = path.join(dataDir, 'uploads', 'selfies');
  const offerDir = path.join(dataDir, 'uploads', 'offers');

  await db.migrate();
  const existing = await db.one('SELECT COUNT(*) AS n FROM users');
  if (Number(existing.n) > 0 && !replace) {
    throw new Error(`The database already has ${existing.n} user(s). Pass --replace to delete everything in it first.`);
  }

  const s = json.settings || {};
  const counts = { members: 0, staff: 0, selfies: 0, offers: 0, invoices: 0 };

  await db.tx(async (conn) => {
    if (replace) {
      for (const table of ['audit_log', 'claim_links', 'sessions', 'invoices', 'offers', 'users', 'images', 'settings', 'stripe_accounts']) {
        await db.query(`DELETE FROM ${table}`, [], conn);
      }
    }
    await db.query('DELETE FROM settings', [], conn);
    await db.query(
      `INSERT INTO settings (id, program_name, monthly_price_cents, payment_mode, qr_period_seconds, perks,
        pos_key_hash, pos_key_hint, pos_key_created_at, media_secret, next_member_number, updated_at)
        VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        s.programName || 'Bin Mania VIP',
        s.monthlyPriceCents || 999,
        s.demoMode ? 'demo' : 'off',
        s.qrPeriodSeconds || 20,
        s.perks || '',
        s.posApiKey ? security.sha256(s.posApiKey) : null,
        s.posApiKey ? s.posApiKey.slice(-4) : null,
        s.posApiKey ? new Date() : null,
        crypto.randomBytes(32).toString('hex'),
        json.nextMemberNumber || 100001,
        new Date(),
      ],
      conn
    );

    for (const u of json.users || []) {
      let selfieImageId = null;
      if (u.selfie && u.selfie.file) {
        const img = readImage(selfieDir, u.selfie.file);
        if (img) {
          selfieImageId = security.randomId();
          await data.insertImage({ id: selfieImageId, kind: 'selfie', ...img, createdAt: u.selfie.uploadedAt }, conn);
          counts.selfies++;
        } else {
          console.warn(`Photo missing for #${u.memberNumber} (${u.selfie.file}); they will be asked for a new selfie.`);
        }
      }
      await data.insertUser(
        {
          id: u.id,
          role: u.role,
          name: u.name,
          email: u.email,
          phone: u.phone || '',
          passwordHash: u.passwordHash,
          mustChangePassword: u.role !== 'member' && process.env.NODE_ENV === 'production',
          createdAt: u.createdAt,
          memberNumber: u.memberNumber || null,
          qrSecret: u.qrSecret || null,
          selfieImageId,
          selfieUploadedAt: selfieImageId ? u.selfie.uploadedAt : null,
          subscription: u.subscription || null,
          paymentMethod: u.paymentMethod || null,
          lastScannedCodeStart: u.lastScannedCodeStart ?? null,
          lastScanAt: u.lastScanAt || null,
        },
        conn
      );
      if (u.role === 'member') counts.members++;
      else counts.staff++;
    }

    for (const o of json.offers || []) {
      let imageId = null;
      const img = o.image ? readImage(offerDir, o.image) : null;
      if (img) {
        imageId = security.randomId();
        await data.insertImage({ id: imageId, kind: 'offer', ...img, createdAt: o.createdAt }, conn);
      }
      await data.insertOffer({ id: o.id, title: o.title || '', body: o.body, imageId, createdAt: o.createdAt }, conn);
      counts.offers++;
    }

    // Oldest first, so invoice numbers (BM-00001, …) come out as they were.
    const invoices = (json.invoices || []).slice().sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    for (const inv of invoices) {
      await data.insertInvoice(inv, conn);
      counts.invoices++;
    }
  });

  console.log('Imported:', counts);
}

main()
  .catch((err) => {
    console.error(`Import failed: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => db.close());
