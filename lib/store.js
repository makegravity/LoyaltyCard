'use strict';
// A JSON file store. Enough for a prototype with a few hundred members;
// everything goes through this module so it can be swapped for a real database.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SELFIE_DIR = path.join(DATA_DIR, 'uploads', 'selfies');
const OFFER_DIR = path.join(DATA_DIR, 'uploads', 'offers');

const store = {
  DATA_DIR,
  SELFIE_DIR,
  OFFER_DIR,
  db: null,
  load,
  save,
};

function load() {
  fs.mkdirSync(SELFIE_DIR, { recursive: true });
  fs.mkdirSync(OFFER_DIR, { recursive: true });
  const empty = { settings: {}, users: [], offers: [], invoices: [], nextMemberNumber: 100001 };
  store.db = fs.existsSync(DB_FILE)
    ? { ...empty, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) }
    : empty;
  return store.db;
}

// Write to a temp file and rename it over db.json, so a crash mid-write never leaves half a file.
// OneDrive can hold db.json for a moment while it syncs, so the rename is retried briefly.
function save() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store.db, null, 2));
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmp, DB_FILE);
      return;
    } catch (err) {
      if (attempt >= 40 || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
}

module.exports = store;
