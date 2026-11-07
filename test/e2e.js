'use strict';
// End-to-end test against the real test harness (zero-dependency Node server from the challenge repo).
//   HARNESS=/path/to/back-in-stock-challenge/harness/server.js npm test
// Starts the harness and this app on free ports, then checks the behaviours the brief cares about.
// Uses SQLite by default; set TEST_DATABASE_URL=postgres://… to run the same suite on Postgres
// (use an empty database: the admin assertions expect only this run's data).
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

const HARNESS = process.env.HARNESS || path.join(__dirname, '../../back-in-stock-challenge/harness/server.js');
const H_PORT = 4600 + Math.floor(Math.random() * 200), A_PORT = H_PORT + 300;
const H = `http://127.0.0.1:${H_PORT}`, A = `http://127.0.0.1:${A_PORT}`;
const hDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-'));
const aDir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let env, token, app, harness;
const procs = [];

function start(cmd, args, extraEnv, name) {
  const p = spawn(cmd, args, { env: { ...process.env, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.logs = '';
  p.stdout.on('data', (d) => { p.logs += d; });
  p.stderr.on('data', (d) => { p.logs += d; });
  p.name = name; procs.push(p);
  return p;
}
async function waitUp(url) {
  for (let i = 0; i < 100; i++) { try { const r = await fetch(url); if (r.status < 500) return; } catch { /* not yet */ } await sleep(100); }
  throw new Error(`${url} did not come up`);
}
// The app reaches the stock API through this proxy so tests can simulate an outage.
const P_PORT = A_PORT + 1;
const proxy = require('node:http').createServer(async (req, res) => {
  if (proxy.down) { res.writeHead(503); return res.end('down'); }
  const r = await fetch(`${H}${req.url}`, { headers: { authorization: req.headers.authorization || '' } });
  res.writeHead(r.status, { 'content-type': 'application/json' }); res.end(await r.text());
}).listen(P_PORT);
const startApp = async () => {
  app = start(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(__dirname, '../src/server.js')],
    { ...env, STOCK_API_URL: `http://127.0.0.1:${P_PORT}/api/stock`, PORT: String(A_PORT), DATA_DIR: aDir, ADMIN_PASSWORD: 'test-pass', DATABASE_URL: process.env.TEST_DATABASE_URL || '' }, 'app');
  await waitUp(`${A}/healthz`);
};
const form = (url, data) => fetch(url, { method: 'POST', body: new URLSearchParams(data), redirect: 'manual' });
const postJson = (url, body, headers = {}) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const testApi = (action, body) => postJson(`${H}/api/test/${action}`, body, { authorization: `Bearer ${env.STOCK_API_KEY}` }).then((r) => r.json());
const setStock = (sku, quantity) => form(`${H}/c/${token}/stock`, { sku, quantity });
const hook = (body, secret = env.WEBHOOK_SECRET) => postJson(`${A}/webhooks/stock`, { type: 'stock.updated', occurred_at: new Date().toISOString(), ...body }, { 'x-webhook-secret': secret });
const request = (email, sku) => postJson(`${A}/api/requests`, { email, sku });
function inbox() {
  const db = JSON.parse(fs.readFileSync(path.join(hDir, 'db.json'), 'utf8'));
  return Object.values(db.candidates)[0].emails;
}
const delivered = (email) => inbox().filter((e) => e.to.includes(email) && e.status === 'accepted');
async function eventually(fn, ms = 8000) {
  const end = Date.now() + ms; let last;
  while (Date.now() < end) { try { return await fn(); } catch (e) { last = e; } await sleep(200); }
  throw last;
}
let n = 0, restartSku;
const uniq = (p) => `${p}-${Date.now().toString(36).toUpperCase()}${(n++).toString(36).toUpperCase()}`;

const results = [];
async function test(name, fn) {
  try { await fn(); results.push(['PASS', name]); console.log(`  ✓ ${name}`); }
  catch (e) { results.push(['FAIL', name]); console.log(`  ✗ ${name}\n    ${e.stack.split('\n').slice(0, 3).join('\n    ')}`); }
}

(async () => {
  harness = start(process.execPath, [HARNESS], { PORT: String(H_PORT), DATA_DIR: hDir, SIM_INTERVAL_SECONDS: '100000', PUBLIC_URL: H, INVITE_CODE: '' }, 'harness');
  await waitUp(H);
  const signup = await form(`${H}/signup`, { name: 'e2e', profile: '' });
  token = signup.headers.get('location').split('/').pop();
  const dash = await (await fetch(`${H}/c/${token}`)).text();
  env = Object.fromEntries([...dash.matchAll(/\b(STOCK_API_URL|STOCK_API_KEY|RESEND_API_KEY|RESEND_BASE_URL|WEBHOOK_SECRET)=([^\s<]+)/g)].map((m) => [m[1], m[2]]));
  assert.equal(Object.keys(env).length, 5);
  await form(`${H}/c/${token}/sim`, { action: 'stop' });
  await form(`${H}/c/${token}/baseurl`, { baseUrl: A });
  await startApp();
  console.log(`harness ${H}  app ${A}\n`);

  await test('embed renders, is frameable, and shows product info', async () => {
    const r = await fetch(`${A}/embed?sku=CAP-WAX-OLV`);
    assert.equal(r.status, 200);
    assert.ok(!r.headers.get('x-frame-options'));
    assert.match(r.headers.get('content-security-policy'), /frame-ancestors \*/);
    assert.match(await r.text(), /Waxed Canvas Cap/);
  });

  await test('rejects bad input', async () => {
    assert.equal((await request('not-an-email', 'ABC-1')).status, 400);
    assert.equal((await request('a@b.co', '')).status, 400);
    assert.equal((await fetch(`${A}/api/requests`, { method: 'POST', body: '{nope' })).status, 400);
  });

  await test('no duplicate open requests, even with 15 concurrent submissions', async () => {
    const sku = uniq('DUP'); const email = 'Dupe.Person@Example.com';
    const rs = await Promise.all(Array.from({ length: 15 }, () => request(email, sku.toLowerCase())));
    const bodies = await Promise.all(rs.map((r) => r.json()));
    assert.equal(rs.filter((r) => r.status === 201).length, 1);
    assert.equal(rs.filter((r) => r.status === 200).length, 14);
    assert.equal(new Set(bodies.map((b) => b.id)).size, 1);
    assert.equal(bodies[0].email, 'dupe.person@example.com');
  });

  await test('webhook with wrong or missing secret is rejected', async () => {
    assert.equal((await hook({ event_id: 'evt_x', sku: 'ABC', quantity: 3 }, 'whsec_wrong')).status, 401);
    assert.equal((await postJson(`${A}/webhooks/stock`, { event_id: 'evt_y', sku: 'ABC', quantity: 3 })).status, 401);
  });

  await test('phantom restock (stock API says 0) sends nothing', async () => {
    const sku = uniq('PHAN'); const email = 'phantom@example.com';
    await request(email, sku);
    assert.equal((await hook({ event_id: uniq('evt'), sku, quantity: 12 })).status, 200);
    await sleep(1500);
    assert.equal(delivered(email).length, 0);
  });

  await test('confirmed restock delivered twice at once → exactly one email per customer', async () => {
    const sku = uniq('TWICE');
    const emails = ['ann@example.com', 'bob@example.com', 'cat@example.com'];
    for (const e of emails) await request(e, sku);
    await setStock(sku, 7);
    const ev = uniq('evt');
    const rs = await Promise.all(Array.from({ length: 4 }, () => hook({ event_id: ev, sku, quantity: 7 })));
    assert.ok(rs.every((r) => r.status === 200));
    await eventually(() => emails.forEach((e) => assert.ok(delivered(e).length >= 1, e)));
    await sleep(1500);
    // replay later with a new event id: still no second email
    await hook({ event_id: uniq('evt'), sku, quantity: 7 });
    await sleep(1500);
    for (const e of emails) assert.equal(inbox().filter((m) => m.to.includes(e) && m.status === 'accepted').length, 1, e);
  });

  await test('the email is HTML, mobile-friendly, in Resend format', async () => {
    const m = delivered('ann@example.com')[0];
    assert.ok(m.html.includes('name="viewport"') && m.html.includes('@media'));
    assert.ok(m.text.length > 20 && m.subject.startsWith('Back in stock:') && m.from);
  });

  await test('email API failures are retried until delivered once', async () => {
    const sku = uniq('FAIL'); const email = 'retry@example.com';
    await request(email, sku);
    await setStock(sku, 3);
    await form(`${H}/c/${token}/fail`, { n: '3' });
    await hook({ event_id: uniq('evt'), sku, quantity: 3 });
    await eventually(() => assert.equal(delivered(email).length, 1), 30_000);
    assert.ok(inbox().filter((m) => m.to.includes(email) && m.status.startsWith('failed')).length >= 1);
    await sleep(2000);
    assert.equal(delivered(email).length, 1);
  });

  await test('harness simulation: restock with duplicate delivery via test API', async () => {
    const sku = 'BEAN-ETH-250'; const email = uniq('sim').toLowerCase() + '@example.com';
    await testApi('sellout', { sku });
    await request(email, sku);
    await testApi('restock', { sku, quantity: 9, twice: true });
    await eventually(() => assert.equal(delivered(email).length, 1));
    await sleep(1500);
    assert.equal(delivered(email).length, 1);
  });

  await test('stock API outage: restock is verified once it recovers, then emailed once', async () => {
    const sku = uniq('OUT'); const email = 'outage@example.com';
    await request(email, sku);
    await setStock(sku, 6);
    proxy.down = true;
    await hook({ event_id: uniq('evt'), sku, quantity: 6 });
    await sleep(3000);
    assert.equal(delivered(email).length, 0, 'must not email without confirmation');
    proxy.down = false;
    await eventually(() => assert.equal(delivered(email).length, 1), 20_000);
  });

  await test('sold-out webhook (quantity 0) sends nothing', async () => {
    const sku = uniq('ZERO'); const email = 'zero@example.com';
    await request(email, sku);
    await hook({ event_id: uniq('evt'), sku, quantity: 0 });
    await sleep(1000);
    assert.equal(delivered(email).length, 0);
  });

  await test('survives a hard restart (SIGKILL): pending requests still get notified', async () => {
    const sku = restartSku = uniq('RST'); const email = 'restart@example.com';
    assert.equal((await request(email, sku)).status, 201);
    app.kill('SIGKILL'); await sleep(300);
    await startApp();
    assert.equal((await request(email, sku)).status, 200, 'still on the list after restart');
    await setStock(sku, 4);
    await hook({ event_id: uniq('evt'), sku, quantity: 4 });
    await eventually(() => assert.equal(delivered(email).length, 1));
  });

  await test('after notification, the customer can sign up again', async () => {
    const r = await request('restart@example.com', restartSku);
    assert.equal(r.status, 201);
  });

  await test('admin is behind a password and shows status + notified time', async () => {
    assert.equal((await fetch(`${A}/admin`)).status, 401);
    const bad = await fetch(`${A}/admin`, { headers: { authorization: 'Basic ' + Buffer.from('admin:nope').toString('base64') } });
    assert.equal(bad.status, 401);
    const ok = await fetch(`${A}/admin`, { headers: { authorization: 'Basic ' + Buffer.from('admin:test-pass').toString('base64') } });
    const body = await ok.text();
    assert.equal(ok.status, 200);
    assert.match(body, /ann@example\.com/);
    assert.match(body, /Notified/);
    const login = await form(`${A}/admin/login`, { password: 'test-pass' });
    assert.equal(login.status, 303);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(`${A}/admin`, { headers: { cookie } })).status, 200);
  });

  const failed = results.filter((r) => r[0] === 'FAIL');
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log('\n--- app log (tail) ---\n' + app.logs.split('\n').slice(-30).join('\n'));
  for (const p of procs) p.kill('SIGKILL');
  proxy.close();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); for (const p of procs) p.kill('SIGKILL'); process.exit(1); });
