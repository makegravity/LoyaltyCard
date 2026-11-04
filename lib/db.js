'use strict';
// MySQL connection pool, transactions and schema migrations.
//
// Connection settings come from DATABASE_URL (mysql://user:pass@host:3306/name) or
// DB_HOST, DB_PORT, DB_USER, DB_PASSWORD and DB_NAME. DB_SSL=true requires TLS.
const mysql = require('mysql2/promise');
const migrations = require('./migrations');

let pool = null;

function config() {
  const base = {
    // Dates are stored and read as UTC.
    timezone: 'Z',
    charset: 'utf8mb4',
    connectionLimit: Number(process.env.DB_POOL_SIZE || 10),
    waitForConnections: true,
    supportBigNumbers: true,
    multipleStatements: false,
  };
  if (process.env.DB_SSL === 'true') base.ssl = { rejectUnauthorized: true, minVersion: 'TLSv1.2' };
  if (process.env.DATABASE_URL) {
    const url = new URL(process.env.DATABASE_URL);
    return {
      ...base,
      host: url.hostname,
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.replace(/^\//, ''),
    };
  }
  return {
    ...base,
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'binmania',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'binmania',
  };
}

function connect() {
  if (!pool) pool = mysql.createPool(config());
  return pool;
}

// Runs a statement on the pool, or on `conn` inside a transaction.
async function query(sql, params = [], conn = null) {
  const [rows] = await (conn || connect()).execute(sql, params);
  return rows;
}

async function one(sql, params = [], conn = null) {
  const rows = await query(sql, params, conn);
  return rows[0] || null;
}

// Runs fn(conn) in a transaction; commits when it returns, rolls back when it throws.
async function tx(fn) {
  const conn = await connect().getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

// Applies each migration not yet recorded in schema_migrations, in order. A named lock
// keeps two app instances starting at once from running the same migration twice.
async function migrate(log = console.log) {
  const conn = await connect().getConnection();
  try {
    const [[lock]] = await conn.query("SELECT GET_LOCK('binmania_migrate', 30) AS got");
    if (!lock.got) throw new Error('Timed out waiting for another instance to finish migrating.');
    await conn.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version INT PRIMARY KEY, applied_at DATETIME(3) NOT NULL) ENGINE=InnoDB'
    );
    const [done] = await conn.query('SELECT version FROM schema_migrations');
    const applied = new Set(done.map((r) => r.version));
    for (const m of migrations) {
      if (applied.has(m.version)) continue;
      for (const statement of m.up) await conn.query(statement);
      await conn.query('INSERT INTO schema_migrations (version, applied_at) VALUES (?, UTC_TIMESTAMP(3))', [m.version]);
      log(`Database: applied migration ${m.version} (${m.name})`);
    }
  } finally {
    await conn.query("SELECT RELEASE_LOCK('binmania_migrate')").catch(() => {});
    conn.release();
  }
}

async function ping() {
  await one('SELECT 1 AS ok');
}

async function close() {
  if (pool) await pool.end();
  pool = null;
}

module.exports = { connect, query, one, tx, migrate, ping, close };
