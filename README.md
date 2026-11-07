# Back-in-stock alerts

Shoppers leave their email on a sold-out product. When the product really comes back, each of them gets **one** email.

- `GET /embed`: the email + SKU form, built to sit in an iframe on any store page (`/embed?sku=CAP-WAX-OLV` shows the product's name, photo, price and stock state; `&theme=dark`, `&accent=2d5a43` to match the store).
- `POST /api/requests`: `{ "email", "sku" }`. 201 when created, 200 with `already_subscribed: true` when that email already has an open request for that SKU.
- `POST /webhooks/stock`: stock events, authenticated by `X-Webhook-Secret`.
- `GET /admin`: every request with its status, attempts, last error and notified time, plus a log of webhooks showing what each restock claim was verified as. Password protected.
- `GET /`: a small landing page with a live demo of the form and the embed snippet.

Plain Node 22, one dependency (`pg`). No framework, no build step.

## Run it

```bash
docker build -t back-in-stock .
docker run -p 3000:3000 \
  -e STOCK_API_URL=... -e STOCK_API_KEY=... \
  -e RESEND_API_KEY=... -e RESEND_BASE_URL=... \
  -e WEBHOOK_SECRET=... \
  -v bis-data:/data \
  back-in-stock
```

Those five variables are all it needs. `-v bis-data:/data` keeps data if the container is recreated; restarting the same container keeps it either way.

Without Docker: `npm install && npm start` (Node 22.13+).

| Variable | Required | Notes |
|---|---|---|
| `STOCK_API_URL`, `STOCK_API_KEY` | yes | `GET {url}/{sku}` with `Authorization: Bearer` |
| `RESEND_API_KEY`, `RESEND_BASE_URL` | yes | emails go to `{RESEND_BASE_URL}/emails` in Resend's format |
| `WEBHOOK_SECRET` | yes | if unset, every webhook is rejected |
| `PORT` | no | default 3000 |
| `ADMIN_PASSWORD` | no | if unset, one is generated on first boot, stored in the database and printed in the log |
| `DATABASE_URL` | no | use Postgres instead of the bundled SQLite file (handy on hosts without a persistent disk) |
| `DATA_DIR` | no | where the SQLite file lives; `/data` in the image |
| `STORE_NAME`, `STORE_URL`, `EMAIL_FROM` | no | branding and the "Shop now" link (`{STORE_URL}/products/{sku}`) |

## How customers get exactly one email (not zero, not two)

The whole thing is a small state machine kept in the database. A request is `waiting` → `queued` → `sending` → `notified` (or `failed` / `cancelled`), and **every transition is a single conditional `UPDATE … WHERE status = <expected> … RETURNING`**. Whoever's update returns the row owns that step; anyone racing it gets nothing back and moves on. That one rule handles most of the brief:

**Duplicate sign-ups.** Emails and SKUs are normalised (trimmed, lowercased / uppercased), and a partial unique index on `(email, sku) WHERE status IN ('waiting','queued','sending')` makes a second open request impossible, even for 15 identical requests arriving at once (tested). Once someone has been notified they can sign up again for the next restock.

**Don't trust the webhook.** A webhook never sends an email. It is authenticated (constant-time secret check), recorded, and turned into a durable "check this SKU" row. The worker then asks the stock API. Only a confirmed `quantity > 0` moves that SKU's waiting requests to `queued`. A restock claim the stock API doesn't back up is logged as ignored and nobody is emailed.

**Webhooks retried, or delivered twice at the same moment.** Event IDs are recorded (`deliveries` counts repeats, visible in the admin), but correctness doesn't rely on that: the second delivery finds no `waiting` requests left to move, because the first one already moved them atomically.

**Don't trust the network.**
- Stock API down or slow: 5 s timeout, then the check is retried with exponential backoff. The webhook itself is still acknowledged, because the pending check is already saved.
- Email API errors / timeouts: the request goes back to `queued` with backoff (2 s, 4 s, 8 s … up to 5 min, 12 attempts), then `failed`, which the admin can retry with one click. Validation errors (4xx) fail immediately instead of retrying something that can't succeed.
- The ambiguous case, where the email was accepted but the response never arrived: every send for a request uses the same `Idempotency-Key` (`bis-notify-<request id>`), so the provider recognises the retry instead of delivering a second copy.

**Restarts.** All state lives in the database (SQLite in WAL mode, or Postgres). A request that was mid-send when the process died is held by a 60 s lease; after it expires the worker picks it up again, and the idempotency key covers the case where the first send went through. On `SIGTERM` the server stops taking requests and waits for an in-flight send to record its result. The test suite `SIGKILL`s the app between sign-up and restock and checks the email still arrives.

**One more guard.** If a send has been retrying for over 15 minutes, the stock API is checked again first. If the item has sold out meanwhile, the request goes back to `waiting` rather than telling someone it's available when it isn't.

The worker runs in-process, wakes up immediately on each webhook and polls every second as a backstop. Because the claims are atomic, running several instances against one Postgres database is also safe.

## Design choices

- **Every confirmed waiter is emailed**, regardless of how many units came back. That's the usual behaviour, and nobody is left waiting for a restock that already happened.
- **No confirmation email** after sign-up. The form confirms on screen. "Hear from you once" taken literally, and nothing lands in the inbox that the customer didn't ask for.
- **The form stays fast if inventory is slow.** `POST /api/requests` never calls the stock API, and `/embed` waits at most 2.5 s for product details before showing the plain form.
- **Embed security.** `/embed` allows framing (`frame-ancestors *`), every other page sends `X-Frame-Options: DENY`. All pages have a strict CSP with nonce'd scripts. Admin uses an HMAC-signed, `HttpOnly`, `SameSite=Strict` cookie (or HTTP Basic for scripts), and logins are rate limited. `/api/requests` has CORS so a store can also call it directly, a honeypot field and a generous per-IP rate limit.
- **The email** is table-based with inline styles, a single column and a media query for phones: product photo, name, price, one button, and a line saying it's a one-time alert. A plain-text part is included.

## Tests

`test/e2e.js` starts the challenge's own harness and this app, then checks 14 scenarios: concurrent duplicate sign-ups, bad secrets, phantom restocks, a restock webhook delivered 4× at once to 3 waiting customers, injected email 500s, a stock-API outage, sold-out events, a hard kill mid-flow, re-subscribing, and admin auth.

```bash
HARNESS=../back-in-stock-challenge/harness/server.js npm test
TEST_DATABASE_URL=postgres://localhost/bis_test npm test   # same suite on Postgres
```

## What I'd add next

Unsubscribe / manage links for waiting customers, a periodic reconciliation pass in case a webhook is lost for good, bounce and complaint handling via Resend webhooks, and per-store accounts if this had to serve more than one shop.
