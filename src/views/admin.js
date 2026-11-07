'use strict';
const config = require('../config');
const { esc } = require('../util');

const CSS = `
:root{--bg:#f6f3ee;--panel:#fffdf9;--ink:#1d1b18;--muted:#736c61;--line:#e5dfd4;--soft:#efe9df;--accent:#1d1b18;
--waiting:#8a6a12;--waiting-bg:#f6edd2;--queued:#2b55a8;--queued-bg:#e2eafa;--ok:#1e5b3b;--ok-bg:#e0eee4;--bad:#a8321f;--bad-bg:#f6e2dc;--off:#6f685d;--off-bg:#ece7de}
@media (prefers-color-scheme:dark){:root{--bg:#141311;--panel:#1c1a17;--ink:#eee9df;--muted:#a39b8e;--line:#34302a;--soft:#25221e;--accent:#eee9df;
--waiting:#e6c46a;--waiting-bg:#3a3018;--queued:#9db8f2;--queued-bg:#1f2a40;--ok:#8fd1a8;--ok-bg:#1d3326;--bad:#f2a08e;--bad-bg:#3d221c;--off:#a39b8e;--off-bg:#2a2723}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
a{color:inherit}
.serif{font-family:Georgia,"Iowan Old Style",serif;font-weight:500}
header.top{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 24px;border-bottom:1px solid var(--line);background:var(--panel)}
.brand{display:flex;align-items:baseline;gap:10px}.brand b{font-size:17px}.brand span{color:var(--muted);font-size:13px}
main{max-width:1180px;margin:0 auto;padding:24px 24px 64px}
h2{font-size:20px;margin:32px 0 12px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:24px}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px 16px;text-decoration:none;display:block}
.stat:hover{border-color:var(--muted)}
.stat .n{font-size:28px;line-height:1.1;font-family:Georgia,serif}
.stat .l{color:var(--muted);font-size:12.5px;display:flex;align-items:center;gap:6px;margin-top:4px}
.bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;margin-bottom:12px}
.tabs{display:flex;gap:4px;background:var(--soft);padding:4px;border-radius:10px;flex-wrap:wrap}
.tabs a{padding:6px 12px;border-radius:7px;text-decoration:none;color:var(--muted);font-weight:500}
.tabs a[aria-current=page]{background:var(--panel);color:var(--ink);box-shadow:0 1px 2px rgba(0,0,0,.06)}
input[type=search],input[type=password]{font:inherit;color:var(--ink);background:var(--panel);border:1px solid var(--line);border-radius:9px;padding:8px 12px;min-width:240px}
input:focus{outline:none;border-color:var(--ink)}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
.scroll{overflow-x:auto}
table{width:100%;border-collapse:collapse;min-width:820px}
th{font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:600;text-align:left;padding:10px 14px;border-bottom:1px solid var(--line);background:var(--soft)}
td{padding:11px 14px;border-bottom:1px solid var(--line);vertical-align:top}
tr:last-child td{border-bottom:0}
.sub{color:var(--muted);font-size:12.5px}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px}
.pill{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;padding:3px 9px;border-radius:999px;white-space:nowrap}
.pill:before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.waiting{color:var(--waiting);background:var(--waiting-bg)}.queued,.sending{color:var(--queued);background:var(--queued-bg)}
.notified{color:var(--ok);background:var(--ok-bg)}.failed{color:var(--bad);background:var(--bad-bg)}.cancelled{color:var(--off);background:var(--off-bg)}
.note{color:var(--bad);font-size:12.5px;margin-top:4px;max-width:280px}
.empty{padding:40px;text-align:center;color:var(--muted)}
button,.btn{font:inherit;font-weight:600;font-size:13px;border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:8px;padding:5px 10px;cursor:pointer;text-decoration:none}
button.primary{background:var(--accent);color:var(--panel);border-color:var(--accent);padding:10px 16px;font-size:14px;width:100%}
button:hover{border-color:var(--muted)}
form.inline{display:inline}
.flash{background:var(--ok-bg);color:var(--ok);padding:10px 14px;border-radius:10px;margin-bottom:16px}
.flash.bad{background:var(--bad-bg);color:var(--bad)}
.login{min-height:100vh;display:grid;place-items:center;padding:24px}
.login .panel{padding:28px;width:100%;max-width:380px}
.login h1{margin:0 0 4px;font-size:24px}.login p{margin:0 0 18px;color:var(--muted)}
.login input{width:100%;min-width:0;margin:6px 0 14px;padding:11px 12px;font-size:15px}
label{font-weight:600;font-size:13px}
.foot{color:var(--muted);font-size:12.5px;margin-top:10px}
@media (max-width:640px){main{padding:16px 16px 48px}header.top{padding:14px 16px}input[type=search]{min-width:0;width:100%}.bar form{width:100%}}
`;

const page = (title, body, nonce) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)}</title><style>${CSS}</style></head><body>${body}
<script nonce="${nonce}">
(function(){var rtf=new Intl.RelativeTimeFormat(undefined,{numeric:'auto'});
function rel(d){var s=(d-Date.now())/1000,a=Math.abs(s);if(a<45)return'just now';if(a<3600)return rtf.format(Math.round(s/60),'minute');if(a<86400)return rtf.format(Math.round(s/3600),'hour');return rtf.format(Math.round(s/86400),'day')}
function run(){document.querySelectorAll('time[datetime]').forEach(function(t){var d=new Date(t.getAttribute('datetime'));t.textContent=rel(d);t.title=d.toLocaleString()})}
run();setInterval(run,30000);
var auto=document.getElementById('auto');if(auto)setTimeout(function(){if(!document.activeElement||document.activeElement.tagName!=='INPUT')location.reload()},20000);})();
</script></body></html>`;

function loginPage({ error, nonce }) {
  return page(`Sign in · ${config.storeName} alerts`, `<div class="login"><div class="panel">
  <h1 class="serif">Back-in-stock alerts</h1><p>${esc(config.storeName)} admin</p>
  ${error ? `<div class="flash bad">${esc(error)}</div>` : ''}
  <form method="post" action="/admin/login"><label for="pw">Password</label>
  <input id="pw" name="password" type="password" autocomplete="current-password" required autofocus>
  <button class="primary">Sign in</button></form></div></div>`, nonce);
}

const STATUS_LABEL = { waiting: 'Waiting', queued: 'Queued', sending: 'Sending', notified: 'Notified', failed: 'Failed', cancelled: 'Cancelled' };
const ts = (iso) => (iso ? `<time datetime="${esc(iso)}">${esc(iso.replace('T', ' ').slice(0, 16))}</time>` : '<span class="sub">—</span>');

function adminPage({ stats, rows, events, filter, q, flash, nonce }) {
  const tabs = [['all', 'All'], ['waiting', 'Waiting'], ['active', 'Sending'], ['notified', 'Notified'], ['failed', 'Failed'], ['cancelled', 'Cancelled']];
  const qs = (f) => `/admin?${new URLSearchParams({ ...(f !== 'all' ? { status: f } : {}), ...(q ? { q } : {}) })}`;
  const statCard = (f, label, n) => `<a class="stat" href="${qs(f)}"><div class="n">${n}</div><div class="l">${label}</div></a>`;

  const body = `<header class="top"><div class="brand"><b class="serif">Back-in-stock alerts</b><span>${esc(config.storeName)}</span></div>
<form method="post" action="/admin/logout"><button>Sign out</button></form></header>
<main>
${flash ? `<div class="flash${flash.bad ? ' bad' : ''}">${esc(flash.text)}</div>` : ''}
<div class="stats">
  ${statCard('waiting', '<span class="pill waiting">Waiting</span>', stats.waiting)}
  ${statCard('active', '<span class="pill queued">Queued or sending</span>', stats.queued + stats.sending)}
  ${statCard('notified', '<span class="pill notified">Notified</span>', stats.notified)}
  ${statCard('failed', '<span class="pill failed">Failed</span>', stats.failed)}
</div>
<div class="bar">
  <nav class="tabs" aria-label="Filter by status">${tabs.map(([f, l]) => `<a href="${qs(f)}"${filter === f ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav>
  <form method="get" action="/admin" role="search">${filter !== 'all' ? `<input type="hidden" name="status" value="${esc(filter)}">` : ''}
  <input type="search" name="q" value="${esc(q)}" placeholder="Search email or SKU" aria-label="Search email or SKU"></form>
</div>
<div class="panel"><div class="scroll"><table>
<thead><tr><th>Customer</th><th>Product</th><th>Status</th><th>Requested</th><th>Notified</th><th>Attempts</th><th></th></tr></thead>
<tbody>${rows.length ? rows.map((r) => `<tr>
  <td>${esc(r.email)}</td>
  <td>${r.product_name ? `${esc(r.product_name)}<div class="sub mono">${esc(r.sku)}</div>` : `<span class="mono">${esc(r.sku)}</span>`}</td>
  <td><span class="pill ${esc(r.status)}">${STATUS_LABEL[r.status] || esc(r.status)}</span>${r.last_error ? `<div class="note">${esc(r.last_error)}</div>` : ''}</td>
  <td>${ts(r.created_at)}</td>
  <td>${ts(r.notified_at)}</td>
  <td>${Number(r.attempts) || '<span class="sub">0</span>'}</td>
  <td style="white-space:nowrap">${r.status === 'failed' ? `<form class="inline" method="post" action="/admin/requests/${esc(r.id)}/retry"><button>Retry</button></form> ` : ''}${['waiting', 'queued', 'failed'].includes(r.status) ? `<form class="inline" method="post" action="/admin/requests/${esc(r.id)}/cancel"><button>Cancel</button></form>` : ''}${r.status === 'notified' || r.status === 'queued' ? ` <a class="btn" href="/admin/requests/${esc(r.id)}/email" target="_blank" rel="noopener">View email</a>` : ''}</td>
</tr>`).join('') : `<tr><td colspan="7" class="empty">No requests${q || filter !== 'all' ? ' match this filter' : ' yet. They will appear here as customers sign up'}.</td></tr>`}</tbody>
</table></div></div>
<p class="foot">Showing the latest ${rows.length} of ${stats.total} requests. Times are shown in your timezone; hover for the exact time.${!q ? ' <span id="auto">This page refreshes every 20 seconds.</span>' : ''}</p>

<h2 class="serif">Stock webhooks</h2>
<p class="sub" style="margin:-6px 0 12px">Every restock claim is checked against the stock API before anyone is emailed.</p>
<div class="panel"><div class="scroll"><table>
<thead><tr><th>Received</th><th>Event</th><th>SKU</th><th>Claimed qty</th><th>Verified qty</th><th>Deliveries</th><th>Outcome</th></tr></thead>
<tbody>${events.length ? events.map((e) => `<tr>
  <td>${ts(e.received_at)}</td><td class="mono">${esc(e.event_id)}</td><td class="mono">${esc(e.sku)}</td>
  <td>${esc(e.quantity)}</td><td>${e.verified_quantity === null || e.verified_quantity === undefined ? '<span class="sub">—</span>' : esc(e.verified_quantity)}</td>
  <td>${Number(e.deliveries) > 1 ? `<span class="pill waiting">${esc(e.deliveries)}×</span>` : '1'}</td><td>${esc(e.outcome || '')}</td>
</tr>`).join('') : '<tr><td colspan="7" class="empty">No webhooks received yet.</td></tr>'}</tbody>
</table></div></div>
</main>`;
  return page(`Requests · ${config.storeName} alerts`, body, nonce);
}

module.exports = { loginPage, adminPage };
