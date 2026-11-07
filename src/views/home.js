'use strict';
const config = require('../config');
const { esc } = require('../util');

function homePage({ origin, demoSku, nonce }) {
  const snippet = `<iframe src="${origin}/embed?sku=YOUR-SKU"
        title="Back-in-stock alert" loading="lazy"
        style="width:100%;max-width:520px;border:0;height:300px"></iframe>
<script>
  // Optional: let the form size itself
  addEventListener('message', function (e) {
    if (e.origin === '${origin}' && e.data && e.data.type === 'back-in-stock:resize')
      document.querySelector('iframe[src^="${origin}/embed"]').style.height = e.data.height + 'px';
  });
</script>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Back-in-stock alerts · ${esc(config.storeName)}</title>
<style>
:root{--bg:#f6f3ee;--panel:#fffdf9;--ink:#1d1b18;--muted:#736c61;--line:#e5dfd4;--code:#1d1b18;--code-ink:#efe9df}
@media (prefers-color-scheme:dark){:root{--bg:#141311;--panel:#1c1a17;--ink:#eee9df;--muted:#a39b8e;--line:#34302a;--code:#0e0d0c}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
main{max-width:1040px;margin:0 auto;padding:56px 24px 80px}
.eyebrow{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:600}
h1{font:400 clamp(34px,5vw,52px)/1.08 Georgia,"Iowan Old Style",serif;margin:12px 0 16px;max-width:16ch}
.lede{color:var(--muted);max-width:56ch;margin:0 0 40px;font-size:17px}
.grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.15fr);gap:28px;align-items:start}
@media (max-width:820px){.grid{grid-template-columns:1fr}}
.demo{background:repeating-linear-gradient(135deg,transparent 0 12px,color-mix(in srgb,var(--line) 45%,transparent) 12px 13px);border:1px dashed var(--line);border-radius:16px;padding:22px}
.demo iframe{width:100%;border:0;height:330px;display:block}
h2{font:500 20px/1.3 Georgia,serif;margin:0 0 10px}
pre{background:var(--code);color:var(--code-ink);border-radius:12px;padding:16px;overflow-x:auto;font:12.5px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;margin:0 0 20px}
ul{padding-left:18px;margin:0;color:var(--muted)}li{margin:6px 0}code{font:13px ui-monospace,Menlo,monospace;color:var(--ink)}
.links{display:flex;gap:10px;flex-wrap:wrap;margin-top:24px}
.links a{color:var(--ink);border:1px solid var(--line);background:var(--panel);border-radius:10px;padding:9px 14px;text-decoration:none;font-weight:600;font-size:14px}
.links a:hover{border-color:var(--muted)}
</style></head><body><main>
<div class="eyebrow">${esc(config.storeName)} · Back-in-stock alerts</div>
<h1>Tell shoppers the moment it&rsquo;s back.</h1>
<p class="lede">A drop-in form for sold-out product pages. Every restock is verified against live inventory, and each customer gets exactly one email when their item returns.</p>
<div class="grid">
  <div class="demo"><iframe id="demo" src="/embed${demoSku ? `?sku=${encodeURIComponent(demoSku)}` : ''}" title="Back-in-stock alert form (live demo)"></iframe></div>
  <div>
    <h2>Add it to a product page</h2>
    <pre>${esc(snippet)}</pre>
    <h2>API</h2>
    <ul>
      <li><code>POST /api/requests</code> with <code>{ email, sku }</code></li>
      <li><code>POST /webhooks/stock</code> with <code>X-Webhook-Secret</code></li>
      <li><code>GET /embed?sku=…&amp;accent=1d1b18&amp;theme=dark</code></li>
    </ul>
    <div class="links"><a href="/admin">Open admin</a><a href="/embed">Generic form</a></div>
  </div>
</div>
</main>
<script nonce="${nonce}">addEventListener('message',function(e){if(e.origin===location.origin&&e.data&&e.data.type==='back-in-stock:resize')document.getElementById('demo').style.height=e.data.height+'px'});</script>
</body></html>`;
}

module.exports = { homePage };
