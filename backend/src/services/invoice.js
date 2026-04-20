// ============================================================
// Invoice generator
// ------------------------------------------------------------
// Given an approved order (or a verified payment), renders a
// printable HTML invoice. The browser's "Save as PDF" becomes
// the download flow — no server-side PDF library needed, which
// keeps the container image lean.
// ============================================================

import db from '../database/pool.js';
import * as settings from '../services/settings.js';
import config from '../config/index.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fmtDate(d) {
  if (!d) return '-';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d);
  return dt.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export async function renderInvoiceForOrder(orderIdOrCode) {
  const byId = /^\d+$/.test(String(orderIdOrCode));
  const order = await db.queryOne(
    `SELECT o.*, p.name AS package_name, p.code AS package_code, p.service_type,
            p.rate_down_mbps, p.rate_up_mbps, p.duration_days,
            c.full_name AS customer_name, c.customer_code AS customer_code,
            c.phone AS customer_phone
       FROM orders o
       JOIN packages p ON p.id = o.package_id
       LEFT JOIN customers c ON c.id = o.customer_id
      WHERE ${byId ? 'o.id = ?' : 'o.order_code = ?'}`,
    [orderIdOrCode]
  );
  if (!order) return null;

  const payment = await db.queryOne(
    `SELECT id, method, trx_id, amount, sender_number, status, verified_at, created_at
       FROM payments WHERE order_id = ? ORDER BY id DESC LIMIT 1`,
    [order.id]
  );

  const subscription = order.subscription_id
    ? await db.queryOne(
        `SELECT login_username, starts_at, expires_at FROM subscriptions WHERE id = ?`,
        [order.subscription_id]
      )
    : null;

  const [
    companyName, companyAddress, companyVat, footerNote,
    brandName, logoUrl, primary, currencySymbol, supportPhone,
  ] = await Promise.all([
    settings.getSetting('invoice.company_name'),
    settings.getSetting('invoice.company_address'),
    settings.getSetting('invoice.company_vat'),
    settings.getSetting('invoice.footer_note'),
    settings.getSetting('site.name'),
    settings.getSetting('branding.logo_url'),
    settings.getSetting('branding.primary_color'),
    settings.getSetting('site.currency_symbol'),
    settings.getSetting('site.support_phone'),
  ]);

  const brand   = companyName || brandName || config.APP_NAME || 'Skynity ISP';
  const color   = primary || '#f59e0b';
  const symbol  = currencySymbol || config.CURRENCY_SYMBOL || '৳';
  const invNo   = `INV-${String(order.id).padStart(6, '0')}`;
  const amount  = Number(order.amount);
  const taxRate = 0; // extension point
  const tax     = Math.round(amount * taxRate * 100) / 100;
  const total   = amount + tax;

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Invoice ${esc(invNo)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, sans-serif; color:#222; margin:0; padding:24px; background:#f5f5f5; }
    .page { max-width: 780px; margin: 0 auto; background:#fff; padding: 32px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,.06);}
    .top { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 24px; }
    .brand { display:flex; gap:12px; align-items:center;}
    .brand img { height: 44px; }
    .brand h2 { margin:0; font-size:22px; color:${color}; }
    .meta { text-align:right; font-size:13px; color:#555; }
    .meta .no { font-size:16px; font-weight:700; color:#111; margin-bottom:4px; }
    .addr { display:grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; font-size:13px;}
    .addr h4 { margin:0 0 6px; color:#888; font-size:11px; letter-spacing:.5px; text-transform:uppercase; }
    table { width:100%; border-collapse: collapse; margin-top:8px; font-size:13px; }
    th, td { padding: 10px 8px; text-align:left; border-bottom: 1px solid #eee; }
    th { background: #fafafa; color:#555; font-weight:600; text-transform:uppercase; font-size:11px; letter-spacing:.5px; }
    td.num, th.num { text-align:right; }
    .totals { width: 280px; margin-left:auto; margin-top:12px; font-size:13px;}
    .totals div { display:flex; justify-content:space-between; padding:6px 0; }
    .totals .grand { border-top: 2px solid ${color}; padding-top: 8px; margin-top: 4px; font-weight:700; font-size:15px; color:#111;}
    .tag { display:inline-block; padding:2px 8px; border-radius:999px; font-size:11px; font-weight:600; }
    .tag.paid { background: #dcfce7; color:#166534;}
    .tag.pending { background:#fef3c7; color:#92400e;}
    .tag.reject { background:#fee2e2; color:#991b1b;}
    .creds { background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:12px 14px; margin-top:20px; font-size:13px;}
    .creds code { background:#fff; border:1px solid #e5e7eb; padding:2px 6px; border-radius:4px; font-size:13px;}
    .footer { margin-top: 24px; padding-top:12px; border-top:1px dashed #ddd; font-size:12px; color:#777; text-align:center;}
    .controls { text-align: right; margin-bottom: 12px;}
    .controls button { background:${color}; color:#111; border:0; padding:8px 14px; border-radius:6px; cursor:pointer; font-weight:600;}
    @media print {
      body { background:#fff; padding:0;}
      .page { box-shadow:none; border-radius:0; margin:0; }
      .controls { display:none; }
      @page { margin: 12mm; }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="controls"><button onclick="window.print()">🖨 Print / Save as PDF</button></div>

    <div class="top">
      <div class="brand">
        ${logoUrl ? `<img src="${esc(logoUrl)}" alt="logo">` : ''}
        <div>
          <h2>${esc(brand)}</h2>
          ${companyAddress ? `<div style="font-size:12px;color:#666;">${esc(companyAddress)}</div>` : ''}
          ${companyVat ? `<div style="font-size:12px;color:#666;">VAT/BIN: ${esc(companyVat)}</div>` : ''}
          ${supportPhone ? `<div style="font-size:12px;color:#666;">Support: ${esc(supportPhone)}</div>` : ''}
        </div>
      </div>
      <div class="meta">
        <div class="no">Invoice ${esc(invNo)}</div>
        <div>Order: <b>${esc(order.order_code)}</b></div>
        <div>Date: ${esc(fmtDate(order.created_at))}</div>
        <div>Status: <span class="tag ${order.status === 'approved' ? 'paid' : order.status === 'rejected' ? 'reject' : 'pending'}">${esc(order.status)}</span></div>
      </div>
    </div>

    <div class="addr">
      <div>
        <h4>Bill to</h4>
        <div><b>${esc(order.customer_name || order.full_name)}</b></div>
        <div>${esc(order.customer_phone || order.phone || '')}</div>
        ${order.customer_code ? `<div style="color:#666;font-size:12px;">${esc(order.customer_code)}</div>` : ''}
      </div>
      <div>
        <h4>Payment</h4>
        <div>Method: ${esc(payment?.method || '-')}</div>
        <div>Trx ID: ${esc(payment?.trx_id || '-')}</div>
        ${payment?.sender_number ? `<div>From: ${esc(payment.sender_number)}</div>` : ''}
        <div>Paid at: ${esc(fmtDate(payment?.verified_at || payment?.created_at))}</div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Item</th>
          <th>Details</th>
          <th class="num">Qty</th>
          <th class="num">Unit price</th>
          <th class="num">Amount</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <b>${esc(order.package_name)}</b><br>
            <span style="color:#888;font-size:12px;">${esc(order.package_code)}</span>
          </td>
          <td>
            ${order.rate_down_mbps}↓ / ${order.rate_up_mbps}↑ Mbps<br>
            <span style="color:#888;font-size:12px;">${order.duration_days} day${order.duration_days > 1 ? 's' : ''} · ${esc(order.service_type)}</span>
          </td>
          <td class="num">1</td>
          <td class="num">${symbol}${amount.toFixed(2)}</td>
          <td class="num">${symbol}${amount.toFixed(2)}</td>
        </tr>
      </tbody>
    </table>

    <div class="totals">
      <div><span>Subtotal</span><span>${symbol}${amount.toFixed(2)}</span></div>
      ${tax > 0 ? `<div><span>Tax</span><span>${symbol}${tax.toFixed(2)}</span></div>` : ''}
      <div class="grand"><span>Total</span><span>${symbol}${total.toFixed(2)}</span></div>
    </div>

    ${subscription ? `
      <div class="creds">
        <b>Service credentials</b><br>
        Username: <code>${esc(subscription.login_username)}</code><br>
        Valid: ${esc(fmtDate(subscription.starts_at))} → ${esc(fmtDate(subscription.expires_at))}
      </div>
    ` : ''}

    ${footerNote ? `<div class="footer">${esc(footerNote)}</div>` : ''}
  </div>
</body>
</html>`;
}
