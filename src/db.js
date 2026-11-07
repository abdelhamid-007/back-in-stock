'use strict';
// Tiny storage adapter. SQL is written once (Postgres-style $1 placeholders) and runs on
//  - Postgres, when DATABASE_URL is set (hosted deploys), or
//  - the SQLite built into Node (node:sqlite), stored in DATA_DIR (docker run, local dev).
// Every state change is a single atomic statement, so both behave the same.
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS requests (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    sku TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    queued_at TEXT,
    notified_at TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT,
    locked_until TEXT,
    last_error TEXT,
    email_id TEXT,
    product_name TEXT,
    product_price DOUBLE PRECISION,
    product_currency TEXT,
    product_image TEXT
  )`,
  // The rule "no duplicate open requests" is enforced by the database, so it also holds under races.
  `CREATE UNIQUE INDEX IF NOT EXISTS requests_one_open ON requests (email, sku)
     WHERE status IN ('waiting', 'queued', 'sending')`,
  `CREATE INDEX IF NOT EXISTS requests_sku_status ON requests (sku, status)`,
  `CREATE INDEX IF NOT EXISTS requests_status_next ON requests (status, next_attempt_at)`,
  `CREATE INDEX IF NOT EXISTS requests_created ON requests (created_at)`,
  `CREATE TABLE IF NOT EXISTS stock_checks (
    sku TEXT PRIMARY KEY,
    due_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS webhook_events (
    event_id TEXT PRIMARY KEY,
    sku TEXT NOT NULL,
    quantity INTEGER,
    received_at TEXT NOT NULL,
    deliveries INTEGER NOT NULL DEFAULT 1,
    verified_quantity INTEGER,
    outcome TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS webhook_events_received ON webhook_events (received_at)`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
];

let impl = null;

async function open() {
  if (config.databaseUrl) {
    const { Pool } = require('pg');
    const ssl = /sslmode=(require|verify)/.test(config.databaseUrl) || process.env.PGSSL === '1'
      ? { rejectUnauthorized: false } : undefined;
    const pool = new Pool({ connectionString: config.databaseUrl.replace(/[?&]sslmode=[^&]+/, ''), ssl, max: 5 });
    impl = {
      kind: 'postgres',
      query: async (sql, params = []) => (await pool.query(sql, params)).rows,
      close: () => pool.end(),
    };
  } else {
    const { DatabaseSync } = require('node:sqlite');
    fs.mkdirSync(config.dataDir, { recursive: true });
    const file = path.join(config.dataDir, 'alerts.db');
    const db = new DatabaseSync(file);
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
    const cache = new Map();
    const prep = (sql) => {
      let s = cache.get(sql);
      if (!s) { s = db.prepare(sql.replace(/\$(\d+)/g, '?$1')); cache.set(sql, s); }
      return s;
    };
    impl = {
      kind: 'sqlite',
      file,
      query: async (sql, params = []) => prep(sql).all(...params.map((v) => (v === undefined ? null : v))),
      close: async () => db.close(),
    };
  }
  for (const stmt of SCHEMA) await impl.query(stmt);
  return impl;
}

const query = (sql, params) => impl.query(sql, params);
const one = async (sql, params) => (await impl.query(sql, params))[0] || null;

async function getSetting(key) {
  const row = await one('SELECT value FROM settings WHERE key = $1', [key]);
  return row ? row.value : null;
}
// Insert-if-absent, then read back: concurrent starters all end up with the same value.
async function ensureSetting(key, make) {
  await query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT DO NOTHING', [key, make()]);
  return getSetting(key);
}

module.exports = { open, query, one, ensureSetting, get kind() { return impl && impl.kind; }, close: () => impl && impl.close() };
