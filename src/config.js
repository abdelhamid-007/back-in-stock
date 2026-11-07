'use strict';
const path = require('node:path');

const trimSlash = (s) => String(s || '').trim().replace(/\/+$/, '');

const config = {
  port: Number(process.env.PORT) || 3000,
  dataDir: process.env.DATA_DIR || path.join(process.cwd(), 'data'),
  // Optional. When set, Postgres is used instead of the bundled SQLite file.
  databaseUrl: process.env.DATABASE_URL || '',

  stockApiUrl: trimSlash(process.env.STOCK_API_URL),
  stockApiKey: process.env.STOCK_API_KEY || '',
  resendApiKey: process.env.RESEND_API_KEY || '',
  resendBaseUrl: trimSlash(process.env.RESEND_BASE_URL) || 'https://api.resend.com',
  webhookSecret: process.env.WEBHOOK_SECRET || '',

  // Optional extras (sensible defaults so `docker run` with the brief's env vars is enough).
  adminPassword: process.env.ADMIN_PASSWORD || '',
  emailFrom: process.env.EMAIL_FROM || 'Hearth & Field <alerts@resend.dev>',
  storeName: process.env.STORE_NAME || 'Hearth & Field',
  storeUrl: trimSlash(process.env.STORE_URL) || 'https://example.com',

  // Tuning
  stockTimeoutMs: 5_000,
  emailTimeoutMs: 10_000,
  maxEmailAttempts: Number(process.env.MAX_EMAIL_ATTEMPTS) || 12,
  maxStockCheckAttempts: 20,
};

config.productUrl = (sku) => `${config.storeUrl}/products/${encodeURIComponent(sku)}`;

module.exports = config;
