'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const config = require('./config');
const db = require('./db');
const core = require('./core');
const { getProductCached } = require('./clients');
const { renderEmbed } = require('./views/embed');
const { renderEmail } = require('./views/email');
const { loginPage, adminPage } = require('./views/admin');
const { homePage } = require('./views/home');
const { safeEqual, EMAIL_RE, SKU_RE, normEmail, normSku, log } = require('./util');

// ---------- small http helpers ----------
const BASE_HEADERS = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin' };
function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...BASE_HEADERS, 'content-type': 'text/plain; charset=utf-8', ...headers });
  res.end(body);
}
const json = (res, status, obj, headers = {}) => send(res, status, JSON.stringify(obj), { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
const csp = (nonce, extra = '') => `default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; frame-src 'self'; form-action 'self'; base-uri 'none'${extra}`;
function html(res, status, body, nonce, { framable = false, headers = {} } = {}) {
  send(res, status, body, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-security-policy': csp(nonce, framable ? '; frame-ancestors *' : "; frame-ancestors 'none'"),
    ...(framable ? {} : { 'x-frame-options': 'DENY' }),
    ...headers,
  });
}
const redirect = (res, to, headers = {}) => send(res, 303, '', { location: to, ...headers });

function readBody(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(Object.assign(new Error('Body too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
async function readJson(req) {
  const raw = await readBody(req);
  try { const v = JSON.parse(raw); return { raw, body: v && typeof v === 'object' && !Array.isArray(v) ? v : null }; } catch { return { raw, body: null }; }
}
const clientIp = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
const parseCookies = (req) => Object.fromEntries(String(req.headers.cookie || '').split(';').map((p) => p.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));

// Fixed-window limiter, per key. Generous: it only exists to blunt abuse.
const buckets = new Map();
function limited(key, max, windowMs) {
  const t = Date.now(); let b = buckets.get(key);
  if (!b || b.reset < t) { b = { n: 0, reset: t + windowMs }; buckets.set(key, b); }
  b.n += 1;
  if (buckets.size > 10_000) for (const [k, v] of buckets) if (v.reset < t) buckets.delete(k);
  return b.n > max;
}

// ---------- admin auth (password via login form → signed cookie, or HTTP Basic for scripts) ----------
let adminPassword = '', sessionSecret = '';
const SESSION_MS = 12 * 3600_000;
const sign = (exp) => crypto.createHmac('sha256', sessionSecret).update(`${exp}:${crypto.createHash('sha256').update(adminPassword).digest('hex')}`).digest('base64url');
function isAdmin(req) {
  const auth = String(req.headers.authorization || '');
  if (auth.startsWith('Basic ')) {
    const decoded = Buffer.from(auth.slice(6), 'base64').toString();
    return safeEqual(decoded.slice(decoded.indexOf(':') + 1), adminPassword);
  }
  const c = parseCookies(req).bis_admin;
  if (!c) return false;
  const [exp, mac] = c.split('.');
  return Number(exp) > Date.now() && !!mac && safeEqual(mac, sign(exp));
}
const secureCookie = (req) => (String(req.headers['x-forwarded-proto'] || '').startsWith('https') ? '; Secure' : '');

// Admin sign-ins are written to the server log (never shown in the admin page).
function browserOf(req) {
  const ua = String(req.headers['user-agent'] || '');
  const b = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : ua ? ua.slice(0, 40) : 'unknown';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${b} on ${os}` : b;
}
const logAdmin = (req, msg) => log('info', msg, { ip: clientIp(req), browser: browserOf(req) });

// ---------- routes ----------
async function route(req, res) {
  const url = new URL(req.url, 'http://local');
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const m = req.method;
  const nonce = crypto.randomBytes(16).toString('base64');
  let mm;

  if (p === '/healthz') {
    try { await db.one('SELECT 1 AS ok'); return json(res, 200, { ok: true, db: db.kind }); } catch { return json(res, 503, { ok: false }); }
  }

  if (m === 'GET' && p === '/') {
    const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0];
    const origin = `${proto}://${req.headers.host}`;
    return html(res, 200, homePage({ origin, demoSku: url.searchParams.get('sku') || 'CAP-WAX-OLV', nonce }), nonce);
  }

  // ----- embed form -----
  if (m === 'GET' && p === '/embed') {
    const sku = normSku(url.searchParams.get('sku'));
    const validSku = SKU_RE.test(sku) ? sku : '';
    let product = null, catalog = null;
    if (validSku) {
      product = await Promise.race([getProductCached(validSku).catch(() => null), new Promise((r) => setTimeout(() => r(null), 2500))]);
    } else {
      catalog = await loadCatalog();
    }
    return html(res, 200, renderEmbed({ sku: validSku, product, catalog, accent: url.searchParams.get('accent'), theme: url.searchParams.get('theme'), nonce }), nonce, { framable: true });
  }

  // ----- customer requests -----
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' };
  if (p === '/api/requests' && m === 'OPTIONS') return send(res, 204, '', cors);
  if (p === '/api/requests' && m === 'POST') {
    if (limited(`req:${clientIp(req)}`, 120, 60_000)) return json(res, 429, { error: 'Too many requests. Please try again in a minute.' }, cors);
    const { body } = await readJson(req);
    if (!body) return json(res, 400, { error: 'Send a JSON body like {"email": "...", "sku": "..."}.' }, cors);
    const email = normEmail(body.email);
    const sku = normSku(body.sku);
    if (typeof body.website === 'string' && body.website.trim()) return json(res, 201, { status: 'waiting', email, sku }, cors); // honeypot
    if (!email || email.length > 254 || !EMAIL_RE.test(email)) return json(res, 400, { error: 'Enter a valid email address, like name@example.com.', field: 'email' }, cors);
    if (!SKU_RE.test(sku)) return json(res, 400, { error: 'That product code doesn’t look right.', field: 'sku' }, cors);
    const { created, request } = await core.createRequest(email, sku);
    return json(res, created ? 201 : 200, {
      id: request.id, email: request.email, sku: request.sku, status: request.status,
      created_at: request.created_at, already_subscribed: !created,
    }, cors);
  }

  // ----- stock webhooks -----
  if (p === '/webhooks/stock' && m === 'POST') {
    const given = req.headers['x-webhook-secret'];
    if (!config.webhookSecret || typeof given !== 'string' || !safeEqual(given, config.webhookSecret)) {
      req.resume();
      log('warn', 'webhook rejected: bad secret', { ip: clientIp(req) });
      return json(res, 401, { error: 'Invalid webhook secret.' });
    }
    const { raw, body } = await readJson(req);
    if (!body) return json(res, 400, { error: 'Body must be a JSON object.' });
    const sku = normSku(body.sku);
    const quantity = Number(body.quantity);
    if (!SKU_RE.test(sku) || !Number.isFinite(quantity)) return json(res, 400, { error: 'sku and numeric quantity are required.' });
    const eventId = typeof body.event_id === 'string' && body.event_id.trim()
      ? body.event_id.trim().slice(0, 128)
      : `anon_${crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24)}`;
    const { duplicate } = await core.recordWebhook({ eventId, sku, quantity: Math.trunc(quantity) });
    core.kick(); // verify + notify right away, outside the request
    return json(res, 200, { received: true, event_id: eventId, duplicate });
  }

  // ----- admin -----
  if (p === '/admin/login' && m === 'POST') {
    const ip = clientIp(req);
    const form = new URLSearchParams(await readBody(req));
    if (limited(`login:${ip}`, 10, 15 * 60_000)) {
      logAdmin(req, 'admin sign-in blocked: too many attempts');
      return html(res, 429, loginPage({ error: 'Too many attempts. Try again in 15 minutes.', nonce }), nonce);
    }
    if (!safeEqual(form.get('password') || '', adminPassword)) {
      logAdmin(req, 'admin sign-in failed: wrong password');
      return html(res, 401, loginPage({ error: 'That password isn’t right.', nonce }), nonce);
    }
    logAdmin(req, 'admin sign-in');
    const exp = String(Date.now() + SESSION_MS);
    return redirect(res, '/admin', { 'set-cookie': `bis_admin=${exp}.${sign(exp)}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1000}${secureCookie(req)}` });
  }
  if (p === '/admin/logout' && m === 'POST') {
    return redirect(res, '/admin', { 'set-cookie': `bis_admin=; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=0${secureCookie(req)}` });
  }
  if (p === '/admin' || p.startsWith('/admin/')) {
    if (!isAdmin(req)) {
      req.resume();
      return m === 'GET' ? html(res, 401, loginPage({ nonce }), nonce) : json(res, 401, { error: 'Sign in first.' });
    }
    if (m === 'GET' && p === '/admin') {
      if (String(req.headers.authorization || '').startsWith('Basic ')) logAdmin(req, 'admin sign-in (HTTP Basic)');
      return html(res, 200, await renderAdmin(url, nonce), nonce);
    }
    if (m === 'GET' && (mm = p.match(/^\/admin\/requests\/([\w-]{1,64})\/email$/))) {
      const r = await db.one('SELECT * FROM requests WHERE id = $1', [mm[1]]);
      if (!r) return send(res, 404, 'Not found');
      return send(res, 200, renderEmail(r).html, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "sandbox; default-src 'none'; img-src https: data:; style-src 'unsafe-inline'" });
    }
    if (m === 'POST' && (mm = p.match(/^\/admin\/requests\/([\w-]{1,64})\/(retry|cancel)$/))) {
      req.resume();
      let ok = false, text;
      try {
        ok = mm[2] === 'retry' ? await core.retryRequest(mm[1]) : await core.cancelRequest(mm[1]);
        text = ok ? (mm[2] === 'retry' ? 'Queued for another try.' : 'Request cancelled.') : 'That request has already moved on.';
      } catch { text = 'This customer already has a newer open request for that product.'; }
      const back = new URL(String(req.headers.referer || '/admin'), 'http://local');
      const qs = new URLSearchParams(back.pathname === '/admin' ? back.search : '');
      qs.set('flash', text); if (!ok) qs.set('bad', '1');
      return redirect(res, `/admin?${qs}`);
    }
    return send(res, 404, 'Not found');
  }

  return send(res, 404, 'Not found');
}

let catalogCache = { at: 0, value: null };
async function loadCatalog() {
  if (catalogCache.value && Date.now() - catalogCache.at < 5 * 60_000) return catalogCache.value;
  try {
    const r = await fetch(config.stockApiUrl, { headers: { authorization: `Bearer ${config.stockApiKey}` }, signal: AbortSignal.timeout(2500) });
    const j = await r.json();
    const list = Array.isArray(j) ? j : Array.isArray(j.products) ? j.products : [];
    catalogCache = { at: Date.now(), value: list.filter((x) => x && typeof x.sku === 'string').slice(0, 500).map((x) => ({ sku: x.sku, name: typeof x.name === 'string' ? x.name : '' })) };
    return catalogCache.value;
  } catch { return catalogCache.value || []; }
}

async function renderAdmin(url, nonce) {
  const FILTERS = { waiting: ['waiting'], active: ['queued', 'sending'], notified: ['notified'], failed: ['failed'], cancelled: ['cancelled'] };
  const filter = FILTERS[url.searchParams.get('status')] ? url.searchParams.get('status') : 'all';
  const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
  const counts = await db.query('SELECT status, COUNT(*) AS n FROM requests GROUP BY status');
  const stats = { waiting: 0, queued: 0, sending: 0, notified: 0, failed: 0, cancelled: 0, total: 0 };
  for (const c of counts) { stats[c.status] = Number(c.n); stats.total += Number(c.n); }

  const where = []; const params = [];
  if (filter !== 'all') where.push(`status IN (${FILTERS[filter].map((s) => `'${s}'`).join(', ')})`);
  if (q) { params.push(`%${q.toLowerCase()}%`); where.push(`(LOWER(email) LIKE $${params.length} OR LOWER(sku) LIKE $${params.length})`); }
  const rows = await db.query(`SELECT * FROM requests ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT 300`, params);
  const events = await db.query('SELECT * FROM webhook_events ORDER BY received_at DESC LIMIT 40');
  // Product names for rows that haven't been restocked yet come from the (cached) catalogue.
  const names = Object.fromEntries((await loadCatalog()).map((x) => [x.sku.toUpperCase(), x.name]));
  for (const r of rows) if (!r.product_name && names[r.sku]) r.product_name = names[r.sku];
  const flashText = url.searchParams.get('flash');
  return adminPage({ stats, rows, events, filter, q, nonce, flash: flashText ? { text: flashText.slice(0, 200), bad: url.searchParams.get('bad') === '1' } : null });
}

// ---------- boot ----------
async function main() {
  await db.open();
  adminPassword = config.adminPassword || await db.ensureSetting('admin_password', () => crypto.randomBytes(9).toString('base64url'));
  sessionSecret = await db.ensureSetting('session_secret', () => crypto.randomBytes(32).toString('hex'));
  if (!config.adminPassword) log('warn', `ADMIN_PASSWORD is not set. Admin password (generated, stored in the database): ${adminPassword}`);
  for (const k of ['STOCK_API_URL', 'STOCK_API_KEY', 'RESEND_API_KEY', 'WEBHOOK_SECRET']) if (!process.env[k]) log('warn', `${k} is not set`);

  const server = http.createServer((req, res) => {
    route(req, res).catch((e) => {
      log('error', 'request failed', { path: req.url, error: e.message });
      if (!res.headersSent) json(res, e.status || 500, { error: e.status === 413 ? 'Request body too large.' : 'Something went wrong. Please try again.' });
    });
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.listen(config.port, () => log('info', 'listening', { port: config.port, db: db.kind }));
  core.start();

  let closing = false;
  const shutdown = async (sig) => {
    if (closing) return; closing = true;
    log('info', 'shutting down', { sig });
    server.close();
    await core.stop();       // let an in-flight send finish and record its result
    await db.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => { log('error', 'failed to start', { error: e.message }); process.exit(1); });
