'use strict';
// Outbound calls: the stock API (source of truth for availability) and the Resend-format email API.
const config = require('./config');
const { safeImage } = require('./util');

class RetryableError extends Error {}
class PermanentError extends Error {}

async function getStock(sku) {
  if (!config.stockApiUrl) throw new RetryableError('STOCK_API_URL is not set');
  let res;
  try {
    res = await fetch(`${config.stockApiUrl}/${encodeURIComponent(sku)}`, {
      headers: { authorization: `Bearer ${config.stockApiKey}`, accept: 'application/json' },
      signal: AbortSignal.timeout(config.stockTimeoutMs),
    });
  } catch (e) {
    throw new RetryableError(`Stock API unreachable: ${e.message || e}`);
  }
  if (!res.ok) throw new RetryableError(`Stock API HTTP ${res.status}`);
  let body;
  try { body = await res.json(); } catch { throw new RetryableError('Stock API returned invalid JSON'); }
  const quantity = Number(body && body.quantity);
  if (!Number.isFinite(quantity)) throw new RetryableError('Stock API response has no quantity');
  return {
    sku,
    quantity,
    inStock: quantity > 0 && body.in_stock !== false,
    name: typeof body.name === 'string' ? body.name.slice(0, 200) : null,
    price: Number.isFinite(Number(body.price)) ? Number(body.price) : null,
    currency: typeof body.currency === 'string' ? body.currency.slice(0, 3).toUpperCase() : null,
    image: safeImage(body.image) || null,
  };
}

// Product info for the embed: cached briefly, never blocks the form for long.
const productCache = new Map();
async function getProductCached(sku) {
  const hit = productCache.get(sku);
  if (hit && hit.until > Date.now()) return hit.value;
  const value = await getStock(sku);
  productCache.set(sku, { value, until: Date.now() + 30_000 });
  if (productCache.size > 500) productCache.delete(productCache.keys().next().value);
  return value;
}

async function sendEmail({ to, subject, html, text, idempotencyKey }) {
  const url = /\/emails$/.test(config.resendBaseUrl) ? config.resendBaseUrl : `${config.resendBaseUrl}/emails`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.resendApiKey}`,
        'content-type': 'application/json',
        // Same key on every retry: if a send succeeded but we never saw the response,
        // the provider recognises the retry instead of delivering a second copy.
        'idempotency-key': idempotencyKey,
      },
      body: JSON.stringify({ from: config.emailFrom, to: [to], subject, html, text }),
      signal: AbortSignal.timeout(config.emailTimeoutMs),
    });
  } catch (e) {
    throw new RetryableError(`Email API unreachable: ${e.message || e}`);
  }
  let body = {};
  try { body = await res.json(); } catch { /* keep {} */ }
  if (res.ok && body && body.id) return { id: String(body.id) };
  const detail = `Email API HTTP ${res.status}${body && body.message ? `: ${String(body.message).slice(0, 200)}` : ''}`;
  // 4xx means the request itself is wrong and resending it will not help,
  // except auth/rate-limit/idempotency-in-progress, which can clear up.
  if (res.status >= 400 && res.status < 500 && ![401, 403, 408, 409, 429].includes(res.status)) throw new PermanentError(detail);
  throw new RetryableError(detail);
}

module.exports = { getStock, getProductCached, sendEmail, RetryableError, PermanentError };
