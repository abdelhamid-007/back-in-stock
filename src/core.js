'use strict';
// The notification pipeline.
//
//  customer ──POST /api/requests──▶ requests(status=waiting)        unique (email, sku) while open
//  webhook  ──POST /webhooks/stock─▶ webhook_events + stock_checks   durable "go check this SKU"
//  worker   ──GET stock API────────▶ waiting → queued                only if the stock API confirms
//  worker   ──POST /emails─────────▶ queued → sending → notified     atomic claim + Idempotency-Key
//
// Every transition is one conditional UPDATE (… WHERE status = X … RETURNING), so two webhooks
// arriving at once, a retry, or a second instance can never move the same request twice.
const crypto = require('node:crypto');
const db = require('./db');
const config = require('./config');
const { getStock, sendEmail, PermanentError } = require('./clients');
const { renderEmail } = require('./views/email');
const { now, inMs, backoff, log } = require('./util');

const OPEN = `('waiting', 'queued', 'sending')`;
const SEND_LEASE_MS = 60_000;      // longer than the email timeout
const CHECK_LEASE_MS = 30_000;     // longer than the stock API timeout
const REVERIFY_AFTER_MS = 15 * 60_000;

// ---------- customer requests ----------
async function createRequest(email, sku) {
  for (let i = 0; i < 3; i++) {
    const t = now();
    const inserted = await db.one(
      `INSERT INTO requests (id, email, sku, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'waiting', $4, $4)
       ON CONFLICT DO NOTHING RETURNING *`,
      [crypto.randomUUID(), email, sku, t],
    );
    if (inserted) return { created: true, request: inserted };
    const existing = await db.one(`SELECT * FROM requests WHERE email = $1 AND sku = $2 AND status IN ${OPEN}`, [email, sku]);
    if (existing) return { created: false, request: existing };
    // The open request was closed between our two statements; try again.
  }
  throw new Error('Could not create request');
}

// ---------- webhooks ----------
async function recordWebhook({ eventId, sku, quantity }) {
  const restockClaim = quantity > 0;
  const row = await db.one(
    `INSERT INTO webhook_events (event_id, sku, quantity, received_at, outcome)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (event_id) DO UPDATE SET deliveries = webhook_events.deliveries + 1
     RETURNING deliveries`,
    [eventId, sku, quantity, now(), restockClaim ? 'pending' : 'sold out'],
  );
  const duplicate = Number(row.deliveries) > 1;
  // A restock claim is only a hint. Record that the SKU needs checking; the worker asks the
  // stock API. Duplicates also (re)schedule a check: harmless, and it recovers if the first
  // attempt hit a stock-API outage.
  if (restockClaim) await scheduleCheck(sku);
  return { duplicate };
}

async function scheduleCheck(sku) {
  await db.query(
    `INSERT INTO stock_checks (sku, due_at, attempts) VALUES ($1, $2, 0)
     ON CONFLICT (sku) DO UPDATE SET due_at = excluded.due_at, attempts = 0, last_error = NULL`,
    [sku, now()],
  );
}

async function processStockCheck(sku) {
  const lease = inMs(CHECK_LEASE_MS);
  const claimed = await db.one(
    `UPDATE stock_checks SET due_at = $2 WHERE sku = $1 AND due_at <= $3 RETURNING attempts`,
    [sku, lease, now()],
  );
  if (!claimed) return;
  const finish = () => db.query('DELETE FROM stock_checks WHERE sku = $1 AND due_at = $2', [sku, lease]);
  const markEvents = (verified, outcome) => db.query(
    `UPDATE webhook_events SET verified_quantity = $2, outcome = $3 WHERE sku = $1 AND outcome = 'pending'`,
    [sku, verified, outcome],
  );

  const waiting = await db.one(`SELECT COUNT(*) AS n FROM requests WHERE sku = $1 AND status = 'waiting'`, [sku]);
  if (Number(waiting.n) === 0) {
    await markEvents(null, 'No one waiting');
    return finish();
  }

  let stock;
  try {
    stock = await getStock(sku);
  } catch (e) {
    const attempts = Number(claimed.attempts) + 1;
    if (attempts >= config.maxStockCheckAttempts) {
      log('error', 'stock check gave up', { sku, error: e.message });
      await markEvents(null, `Stock API unavailable, gave up: ${e.message}`);
      return finish();
    }
    log('warn', 'stock check failed, will retry', { sku, attempts, error: e.message });
    await db.query(
      `UPDATE stock_checks SET attempts = $3, last_error = $4, due_at = $5 WHERE sku = $1 AND due_at = $2`,
      [sku, lease, attempts, e.message, inMs(backoff(attempts))],
    );
    return;
  }

  if (!stock.inStock) {
    log('info', 'restock not confirmed by stock API', { sku, quantity: stock.quantity });
    await markEvents(stock.quantity, `Ignored: stock API says ${stock.quantity}`);
    return finish();
  }

  const t = now();
  const queued = await db.query(
    `UPDATE requests SET status = 'queued', queued_at = $2, next_attempt_at = $2, updated_at = $2,
       product_name = $3, product_price = $4, product_currency = $5, product_image = $6
     WHERE sku = $1 AND status = 'waiting' RETURNING id`,
    [sku, t, stock.name, stock.price, stock.currency, stock.image],
  );
  log('info', 'restock confirmed', { sku, quantity: stock.quantity, queued: queued.length });
  await markEvents(stock.quantity, `Confirmed (qty ${stock.quantity}) · ${queued.length} queued`);
  await finish();
}

// ---------- sending ----------
async function processSend(id) {
  const t = now();
  const r = await db.one(
    `UPDATE requests SET status = 'sending', locked_until = $2, attempts = attempts + 1, updated_at = $3
     WHERE id = $1 AND ((status = 'queued' AND next_attempt_at <= $3) OR (status = 'sending' AND locked_until < $3))
     RETURNING *`,
    [id, inMs(SEND_LEASE_MS), t],
  );
  if (!r) return; // someone else has it

  // A send that has been retrying for a while: make sure the product hasn't sold out again
  // before telling someone it's available.
  if (Number(r.attempts) > 1 && Date.parse(r.queued_at) < Date.now() - REVERIFY_AFTER_MS) {
    try {
      const stock = await getStock(r.sku);
      if (!stock.inStock) {
        await db.query(
          `UPDATE requests SET status = 'waiting', queued_at = NULL, next_attempt_at = NULL, locked_until = NULL,
             attempts = 0, last_error = $2, updated_at = $3 WHERE id = $1 AND status = 'sending'`,
          [r.id, 'Sold out again before the email went out; waiting for the next restock', now()],
        );
        return;
      }
    } catch { /* can't tell: carry on with the send */ }
  }

  const msg = renderEmail(r);
  try {
    const { id: emailId } = await sendEmail({ to: r.email, ...msg, idempotencyKey: `bis-notify-${r.id}` });
    await db.query(
      `UPDATE requests SET status = 'notified', notified_at = $2, email_id = $3, locked_until = NULL,
         last_error = NULL, updated_at = $2 WHERE id = $1 AND status = 'sending'`,
      [r.id, now(), emailId],
    );
    log('info', 'notified', { id: r.id, sku: r.sku, attempts: r.attempts });
  } catch (e) {
    const permanent = e instanceof PermanentError || Number(r.attempts) >= config.maxEmailAttempts;
    await db.query(
      `UPDATE requests SET status = $2, next_attempt_at = $3, locked_until = NULL, last_error = $4, updated_at = $5
       WHERE id = $1 AND status = 'sending'`,
      [r.id, permanent ? 'failed' : 'queued', permanent ? null : inMs(backoff(Number(r.attempts))), e.message, now()],
    );
    log(permanent ? 'error' : 'warn', permanent ? 'email failed permanently' : 'email failed, will retry', { id: r.id, attempts: r.attempts, error: e.message });
  }
}

// ---------- worker loop ----------
let busy = false, again = false, stopping = false, timer = null, current = Promise.resolve();

async function tick() {
  const t = now();
  const checks = await db.query('SELECT sku FROM stock_checks WHERE due_at <= $1 ORDER BY due_at LIMIT 20', [t]);
  for (const c of checks) await processStockCheck(c.sku);

  const sends = await db.query(
    `SELECT id FROM requests
     WHERE (status = 'queued' AND next_attempt_at <= $1) OR (status = 'sending' AND locked_until < $1)
     ORDER BY queued_at LIMIT 50`,
    [now()],
  );
  for (let i = 0; i < sends.length; i += 5) await Promise.all(sends.slice(i, i + 5).map((s) => processSend(s.id)));
  return checks.length === 20 || sends.length === 50;
}

function kick() {
  if (stopping) return;
  if (busy) { again = true; return; }
  busy = true;
  current = (async () => {
    try {
      do { again = false; if (await tick()) again = true; } while (again && !stopping);
    } catch (e) {
      log('error', 'worker tick failed', { error: e.message });
    } finally { busy = false; }
  })();
}

function start() { timer = setInterval(kick, 1_000); kick(); }
async function stop() { stopping = true; clearInterval(timer); await current; }

// ---------- admin actions ----------
async function retryRequest(id) {
  const r = await db.one(
    `UPDATE requests SET status = 'queued', next_attempt_at = $2, attempts = 0, updated_at = $2
     WHERE id = $1 AND status = 'failed' RETURNING id`, [id, now()]);
  if (r) kick();
  return !!r;
}
async function cancelRequest(id) {
  return !!(await db.one(
    `UPDATE requests SET status = 'cancelled', updated_at = $2 WHERE id = $1 AND status IN ('waiting', 'queued', 'failed') RETURNING id`,
    [id, now()]));
}

module.exports = { createRequest, recordWebhook, kick, start, stop, retryRequest, cancelRequest };
