'use strict';
// The back-in-stock email: table layout + inline styles so it renders in Gmail, Outlook and
// Apple Mail, single column so it reads well on a phone.
const config = require('../config');
const { esc, money, safeImage } = require('../util');

const SANS = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;
const SERIF = `Georgia,'Iowan Old Style','Times New Roman',serif`;

function renderEmail(r) {
  const name = r.product_name || r.sku;
  const price = money(r.product_price, r.product_currency);
  const image = safeImage(r.product_image);
  const url = config.productUrl(r.sku);
  const store = config.storeName;
  const subject = `Back in stock: ${name}`;
  const preheader = `${name} is available again. Restocks go fast, so here's your heads-up.`;

  const html = `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light only">
<title>${esc(subject)}</title>
<style>
  @media only screen and (max-width:620px){
    .container{width:100%!important;border-radius:0!important;border-left:0!important;border-right:0!important}
    .px{padding-left:22px!important;padding-right:22px!important}
    .h1{font-size:27px!important}
    .btn,.btn a{display:block!important;width:100%!important;box-sizing:border-box}
  }
  a{color:#1d1b18}
</style>
</head>
<body style="margin:0;padding:0;background:#f2ede4;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;">${esc(preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f2ede4;">
<tr><td align="center" style="padding:28px 0;">
  <table role="presentation" class="container" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:560px;background:#fffdf8;border:1px solid #e5ddcf;border-radius:16px;overflow:hidden;">
    <tr><td class="px" style="padding:22px 36px;border-bottom:1px solid #eee7da;">
      <span style="font:600 16px/1.2 ${SERIF};letter-spacing:.04em;color:#1d1b18;">${esc(store)}</span>
    </td></tr>
    ${image ? `<tr><td style="padding:0;background:#ebe5da;">
      <a href="${esc(url)}" style="text-decoration:none;"><img src="${esc(image)}" width="560" alt="${esc(name)}" style="display:block;width:100%;max-width:560px;height:auto;border:0;"></a>
    </td></tr>` : ''}
    <tr><td class="px" style="padding:30px 36px 6px;">
      <span style="display:inline-block;background:#e2eee5;color:#1e5b3b;font:700 11px/1 ${SANS};letter-spacing:.09em;text-transform:uppercase;padding:7px 11px;border-radius:999px;">Back in stock</span>
      <h1 class="h1" style="margin:18px 0 10px;font:400 31px/1.2 ${SERIF};color:#1d1b18;">Good news: it&rsquo;s back.</h1>
      <p style="margin:0;font:16px/1.6 ${SANS};color:#4b463e;">You asked us to tell you when <strong style="color:#1d1b18;">${esc(name)}</strong> was available again. It&rsquo;s in stock right now, and restocks tend to go quickly.</p>
    </td></tr>
    <tr><td class="px" style="padding:22px 36px 4px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid #eee7da;border-bottom:1px solid #eee7da;">
        <tr>
          <td style="padding:16px 0;font:600 16px/1.4 ${SANS};color:#1d1b18;">${esc(name)}<br><span style="font:400 13px/1.6 ${SANS};color:#857e72;">SKU ${esc(r.sku)}</span></td>
          ${price ? `<td align="right" style="padding:16px 0;font:400 20px/1.2 ${SERIF};color:#1d1b18;white-space:nowrap;">${esc(price)}</td>` : ''}
        </tr>
      </table>
    </td></tr>
    <tr><td class="px" style="padding:24px 36px 8px;">
      <table role="presentation" class="btn" cellpadding="0" cellspacing="0" border="0"><tr>
        <td align="center" bgcolor="#1d1b18" style="border-radius:10px;background:#1d1b18;">
          <a href="${esc(url)}" style="display:inline-block;padding:15px 34px;font:600 16px/1 ${SANS};color:#fffdf8;text-decoration:none;border-radius:10px;">Shop now</a>
        </td>
      </tr></table>
    </td></tr>
    <tr><td class="px" style="padding:18px 36px 30px;">
      <p style="margin:0;font:13px/1.6 ${SANS};color:#857e72;">This is a one-time alert. We won&rsquo;t email you about this item again unless you sign up for another alert.</p>
    </td></tr>
  </table>
  <p style="margin:18px 20px 0;font:12px/1.6 ${SANS};color:#968f83;text-align:center;">${esc(store)} &middot; You&rsquo;re receiving this because you requested a back-in-stock alert for this item.</p>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    `Good news: it's back.`,
    '',
    `You asked us to tell you when ${name} was available again. It's in stock right now, and restocks tend to go quickly.`,
    '',
    `${name}${price ? ` · ${price}` : ''} (SKU ${r.sku})`,
    `Shop now: ${url}`,
    '',
    `This is a one-time alert. We won't email you about this item again unless you sign up for another alert.`,
    `— ${store}`,
  ].join('\n');

  return { subject, html, text };
}

module.exports = { renderEmail };
