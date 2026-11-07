'use strict';
// GET /embed — the email + SKU form that a store drops into an <iframe> on a sold-out product page.
//   /embed?sku=CAP-WAX-OLV            product-aware: shows name, photo, price, availability
//   /embed                             generic: shopper types or picks a SKU
//   &accent=2d5a43  &theme=dark        optional styling to match the host store
const config = require('../config');
const { esc, money, safeImage } = require('../util');

function renderEmbed({ sku, product, catalog, accent, theme, nonce }) {
  const name = product && product.name;
  const image = product && safeImage(product.image);
  const price = product ? money(product.price, product.currency) : '';
  const inStock = product && product.inStock;
  const acc = /^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(accent || '') ? `#${accent}` : '#1d1b18';

  const productBlock = sku && product ? `
    <div class="product">
      ${image ? `<img class="thumb" src="${esc(image)}" alt="" width="64" height="64">` : '<div class="thumb ph" aria-hidden="true"></div>'}
      <div class="pinfo">
        <div class="pname">${esc(name || sku)}</div>
        <div class="pmeta">${price ? `<span>${esc(price)}</span><span class="dot">·</span>` : ''}<span class="chip ${inStock ? 'in' : 'out'}">${inStock ? 'In stock' : 'Sold out'}</span></div>
      </div>
    </div>` : '';

  const skuField = sku
    ? `<input type="hidden" name="sku" value="${esc(sku)}">`
    : `<label class="lbl" for="sku">Product SKU</label>
       <input id="sku" name="sku" class="field" required autocomplete="off" spellcheck="false" placeholder="e.g. CAP-WAX-OLV" list="catalog" maxlength="64">
       ${catalog && catalog.length ? `<datalist id="catalog">${catalog.map((p) => `<option value="${esc(p.sku)}">${esc(p.name || '')}</option>`).join('')}</datalist>` : ''}`;

  return `<!doctype html>
<html lang="en" data-theme="${theme === 'dark' ? 'dark' : 'light'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Notify me when it's back · ${esc(config.storeName)}</title>
<style>
:root{--ink:#1d1b18;--muted:#6f685d;--line:#e3dccf;--paper:#fffdf8;--field:#fff;--accent:${acc};--on-accent:#fffdf8;--ok:#1e5b3b;--ok-bg:#e2eee5;--err:#a8321f;--out-bg:#f4e6e1;--out:#8a3a26;--ring:color-mix(in srgb,var(--accent) 28%,transparent)}
[data-theme=dark]{--ink:#f1ece3;--muted:#a9a194;--line:#3a352e;--paper:#1b1916;--field:#24211d;--on-accent:#1b1916;--ok:#8fd1a8;--ok-bg:#1f3328;--err:#f08f7c;--out-bg:#3a2520;--out:#f0a58f}
[data-theme=dark]{--accent:${acc === '#1d1b18' ? '#f1ece3' : acc}}
*{box-sizing:border-box}
html,body{margin:0;background:transparent}
body{font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink);-webkit-font-smoothing:antialiased}
.card{background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:20px;max-width:520px}
.product{display:flex;gap:14px;align-items:center;padding-bottom:16px;margin-bottom:16px;border-bottom:1px solid var(--line)}
.thumb{width:64px;height:64px;border-radius:10px;object-fit:cover;flex:none;background:var(--line)}
.pname{font:500 17px/1.3 Georgia,"Iowan Old Style",serif}
.pmeta{display:flex;align-items:center;gap:6px;margin-top:4px;color:var(--muted);font-size:14px}
.dot{opacity:.6}
.chip{font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;padding:3px 8px;border-radius:999px}
.chip.out{background:var(--out-bg);color:var(--out)}.chip.in{background:var(--ok-bg);color:var(--ok)}
h1{font:500 19px/1.3 Georgia,"Iowan Old Style",serif;margin:0 0 4px}
.sub{margin:0 0 16px;color:var(--muted)}
.lbl{display:block;font-size:13px;font-weight:600;margin:0 0 6px}
.field{width:100%;font:inherit;font-size:16px;color:var(--ink);background:var(--field);border:1px solid var(--line);border-radius:10px;padding:11px 13px;outline:none;transition:border-color .15s,box-shadow .15s}
.field:focus{border-color:var(--accent);box-shadow:0 0 0 4px var(--ring)}
.field[aria-invalid=true]{border-color:var(--err)}
#sku{margin-bottom:12px}#sku:not(:placeholder-shown){text-transform:uppercase}
.row{display:flex;gap:8px}
.row .field{flex:1;min-width:0}
button{font:inherit;font-weight:600;font-size:15px;color:var(--on-accent);background:var(--accent);border:0;border-radius:10px;padding:0 20px;min-height:46px;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:8px;transition:transform .06s,opacity .15s}
button:hover{opacity:.92}button:active{transform:translateY(1px)}
button:focus-visible{outline:none;box-shadow:0 0 0 4px var(--ring)}
button[disabled]{opacity:.65;cursor:progress}
.spin{width:15px;height:15px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:s .7s linear infinite;display:none}
button[disabled] .spin{display:inline-block}
@keyframes s{to{transform:rotate(1turn)}}
.err{color:var(--err);font-size:13px;margin:8px 0 0;min-height:0}
.fine{color:var(--muted);font-size:12.5px;margin:12px 0 0}
.instock{background:var(--ok-bg);color:var(--ok);border-radius:10px;padding:10px 12px;font-size:14px;margin:0 0 14px}
.done{display:flex;gap:14px;align-items:flex-start}
.tick{flex:none;width:40px;height:40px;border-radius:50%;background:var(--ok-bg);color:var(--ok);display:grid;place-items:center}
.done h2{font:500 19px/1.3 Georgia,"Iowan Old Style",serif;margin:0 0 4px}
.done p{margin:0;color:var(--muted)}
.link{background:none;border:0;padding:0;min-height:0;color:var(--ink);text-decoration:underline;text-underline-offset:3px;font-weight:500;font-size:13.5px;margin-top:10px}
[hidden]{display:none!important}
@media (max-width:400px){.row{flex-direction:column}button{justify-content:center}.card{padding:16px}}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation-duration:1.5s!important}}
</style>
</head>
<body>
<main class="card">
  ${productBlock}
  <section id="ask">
    ${inStock ? `<p class="instock">Good news: this is in stock right now. You can still sign up to hear about future restocks.</p>` : ''}
    <h1>Email me when it&rsquo;s back</h1>
    <p class="sub">We&rsquo;ll send one email the moment it&rsquo;s back in stock. Nothing else.</p>
    <form id="f" novalidate>
      ${skuField}
      <label class="lbl" for="email">Email address</label>
      <div class="row">
        <input id="email" name="email" type="email" class="field" required autocomplete="email" inputmode="email" placeholder="you@example.com" maxlength="254" aria-describedby="err">
        <button type="submit" id="go"><span class="spin" aria-hidden="true"></span><span>Notify me</span></button>
      </div>
      <input type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0">
      <p class="err" id="err" role="alert" aria-live="assertive"></p>
    </form>
  </section>
  <section id="ok" class="done" hidden aria-live="polite">
    <div class="tick" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M4.5 10.5l3.5 3.5 7.5-8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
    <div>
      <h2 id="okTitle">You&rsquo;re on the list</h2>
      <p id="okText"></p>
      <button type="button" class="link" id="again">Use a different email</button>
    </div>
  </section>
</main>
<script nonce="${nonce}">
(function(){
  var f=document.getElementById('f'),email=document.getElementById('email'),err=document.getElementById('err'),go=document.getElementById('go');
  var ask=document.getElementById('ask'),ok=document.getElementById('ok');
  var productName=${JSON.stringify(name || sku || '')};
  var re=/^[^\\s@<>()[\\]\\\\,;:"]+@[^\\s@<>()[\\]\\\\,;:"]+\\.[a-z]{2,}$/i;
  function resize(){try{parent.postMessage({type:'back-in-stock:resize',height:document.documentElement.scrollHeight},'*')}catch(e){}}
  function fail(msg,el){err.textContent=msg;if(el){el.setAttribute('aria-invalid','true');el.focus();}resize();}
  function clear(){err.textContent='';f.querySelectorAll('[aria-invalid]').forEach(function(x){x.removeAttribute('aria-invalid')});}
  f.addEventListener('submit',function(e){
    e.preventDefault();clear();
    var skuEl=f.elements.sku,sku=(skuEl.value||'').trim(),em=(email.value||'').trim();
    if(!sku)return fail('Enter the product SKU.',skuEl.type==='hidden'?null:skuEl);
    if(!re.test(em))return fail('Enter a valid email address, like name@example.com.',email);
    go.disabled=true;
    fetch('/api/requests',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:em,sku:sku,website:f.elements.website.value})})
      .then(function(r){return r.json().catch(function(){return {}}).then(function(b){return {s:r.status,b:b}})})
      .then(function(x){
        go.disabled=false;
        if(x.s===201||x.s===200){
          var what=productName||sku.toUpperCase();
          document.getElementById('okTitle').textContent=x.b.already_subscribed?'You\\u2019re already on the list':'You\\u2019re on the list';
          document.getElementById('okText').textContent='We\\u2019ll email '+em+' as soon as '+what+' is back in stock.';
          ask.hidden=true;ok.hidden=false;resize();return;
        }
        if(x.s===429)return fail('Too many attempts. Please wait a minute and try again.');
        if(x.s===400&&x.b&&x.b.error)return fail(x.b.error,x.b.field==='sku'&&skuEl.type!=='hidden'?skuEl:(x.b.field==='email'?email:null));
        fail('Something went wrong on our side. Please try again.');
      })
      .catch(function(){go.disabled=false;fail('We couldn\\u2019t reach the server. Check your connection and try again.');});
  });
  document.getElementById('again').addEventListener('click',function(){ok.hidden=true;ask.hidden=false;email.value='';email.focus();resize();});
  if(window.ResizeObserver)new ResizeObserver(resize).observe(document.body);
  window.addEventListener('load',resize);resize();
})();
</script>
</body>
</html>`;
}

module.exports = { renderEmbed };
