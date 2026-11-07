'use strict';
const crypto = require('node:crypto');

const now = () => new Date().toISOString();
const inMs = (ms) => new Date(Date.now() + ms).toISOString();

// Exponential backoff with jitter: 2s, 4s, 8s ... capped.
function backoff(attempt, baseMs = 2_000, capMs = 5 * 60_000) {
  const ms = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(ms * (0.85 + Math.random() * 0.3));
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Compare secrets without leaking length or content through timing.
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb) && String(a).length === String(b).length;
}

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i;
const SKU_RE = /^[A-Z0-9][A-Z0-9._\-]{0,63}$/;
const normEmail = (e) => String(e ?? '').trim().toLowerCase();
const normSku = (s) => String(s ?? '').trim().toUpperCase();

function money(price, currency) {
  if (price === null || price === undefined || !Number.isFinite(Number(price))) return '';
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency || 'GBP', maximumFractionDigits: Number(price) % 1 ? 2 : 0 }).format(Number(price));
  } catch { return String(price); }
}

const safeImage = (u) => (typeof u === 'string' && /^https:\/\/[^\s"'<>]+$/i.test(u) ? u : '');

function log(level, msg, extra = {}) {
  const line = JSON.stringify({ t: now(), level, msg, ...extra });
  (level === 'error' ? console.error : console.log)(line);
}

module.exports = { now, inMs, backoff, esc, safeEqual, EMAIL_RE, SKU_RE, normEmail, normSku, money, safeImage, log };
