// ============================================================
// /portal — PUBLIC self-service order flow (no auth)
// ------------------------------------------------------------
// Mounted at the TOP of the app (not under /api) because the
// captive-portal login.html points here. Every handler here is
// reachable without a token.
//
// Flow:
//   1. GET  /portal/packages
//        → public list of active packages (for the portal UI)
//
//   2. POST /portal/orders
//        body: { package_code, full_name, phone, mac? }
//        → creates an order in status='pending_payment'
//        → returns { order_code, amount, payment_info }
//
//   3. POST /portal/orders/:code/payment
//        multipart: { method, sender_number, trx_id, screenshot? }
//        → creates a payment row (status='pending')
//        → flips order to 'payment_submitted'
//        → notifies admins via Telegram (best effort)
//
//   4. GET  /portal/orders/:code
//        → status + credentials once approved
//        (the portal page polls this every few seconds)
//
// Abuse control:
//   - simple in-memory rate-limit keyed by IP
//   - no admin surface here; all values are looked up, never trusted
// ============================================================

import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import db from '../database/pool.js';
import config from '../config/index.js';
import logger from '../utils/logger.js';
import * as settings from '../services/settings.js';
import { notifyAdmins } from '../telegram/bot.js';
import vouchers from '../services/vouchers.js';
import { renderInvoiceForOrder } from '../services/invoice.js';
import { normaliseMac } from '../utils/mac.js';
import otp from '../services/otp.js';

const router = Router();

// ------------------------------------------------------------
// Upload storage — UPLOAD_DIR/portal/<timestamp>-<rand>.<ext>
// ------------------------------------------------------------
const PORTAL_UPLOAD_DIR = path.join(config.UPLOAD_DIR, 'portal');
await fs.mkdir(PORTAL_UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, PORTAL_UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 6);
    const rand = crypto.randomBytes(6).toString('hex');
    cb(null, `${Date.now()}-${rand}${ext || '.bin'}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: (config.MAX_UPLOAD_SIZE_MB || 5) * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(jpe?g|png|webp|gif)$/i.test(file.mimetype);
    cb(ok ? null : new Error('only image files allowed'), ok);
  },
});

// ------------------------------------------------------------
// Very small per-IP rate-limiter (no extra dependency)
// ------------------------------------------------------------
function rateLimit({ windowMs, max }) {
  const hits = new Map(); // ip -> { count, resetAt }
  return (req, res, next) => {
    const ip = (req.headers['x-forwarded-for']?.split(',')[0] || req.ip || 'unknown').trim();
    const now = Date.now();
    const entry = hits.get(ip);
    if (!entry || entry.resetAt < now) {
      hits.set(ip, { count: 1, resetAt: now + windowMs });
      return next();
    }
    entry.count++;
    if (entry.count > max) {
      const retry = Math.ceil((entry.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retry));
      return res.status(429).json({ error: 'too many requests', retry_after_seconds: retry });
    }
    next();
  };
}

// gentler for GET (polling), stricter for POST
const getLimiter  = rateLimit({ windowMs: 60_000, max: 120 });
const postLimiter = rateLimit({ windowMs: 60_000, max: 8 });
// OTP is cheap on our side but expensive on the SMS side — lock it tight.
const otpLimiter  = rateLimit({ windowMs: 60_000, max: 3 });

// ------------------------------------------------------------
// helpers
// ------------------------------------------------------------
function genOrderCode() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `ORD-${y}${m}${day}-${rand}`;
}

function normalisePhone(s) {
  return String(s || '').replace(/[^\d+]/g, '').slice(0, 20);
}

async function publicPackageInfo() {
  return db.query(
    `SELECT code, name, service_type, rate_up_mbps, rate_down_mbps, duration_days, price, description
       FROM packages WHERE is_active = 1 ORDER BY sort_order, id`
  );
}

async function paymentInfo() {
  // prefer system_settings overrides, fall back to env config
  const [
    bkashNumber, bkashType, nagadNumber, nagadType, supportPhone, currency, currencySymbol,
  ] = await Promise.all([
    settings.getSetting('payment.bkash_number'),
    settings.getSetting('payment.bkash_type'),
    settings.getSetting('payment.nagad_number'),
    settings.getSetting('payment.nagad_type'),
    settings.getSetting('site.support_phone'),
    settings.getSetting('site.currency'),
    settings.getSetting('site.currency_symbol'),
  ]);
  return {
    bkash: { number: bkashNumber || config.BKASH_NUMBER || '', type: bkashType || config.BKASH_TYPE || 'personal' },
    nagad: { number: nagadNumber || config.NAGAD_NUMBER || '', type: nagadType || config.NAGAD_TYPE || 'personal' },
    support_phone: supportPhone || '',
    currency: currency || config.CURRENCY || 'BDT',
    currency_symbol: currencySymbol || config.CURRENCY_SYMBOL || '৳',
  };
}

// ============================================================
// 1) GET /portal/packages
// ============================================================
router.get('/packages', getLimiter, async (_req, res) => {
  try {
    const [pkgs, brandName, logoUrl, primaryColor, pay] = await Promise.all([
      publicPackageInfo(),
      settings.getSetting('site.name'),
      settings.getSetting('branding.logo_url'),
      settings.getSetting('branding.primary_color'),
      paymentInfo(),
    ]);
    res.json({
      packages: pkgs,
      branding: {
        name: brandName || config.APP_NAME || 'Skynity ISP',
        logo_url: logoUrl || '',
        primary_color: primaryColor || '#f59e0b',
      },
      payment: { bkash: pay.bkash, nagad: pay.nagad },
      currency_symbol: pay.currency_symbol,
      support_phone: pay.support_phone,
    });
  } catch (err) {
    logger.error({ err }, 'portal packages failed');
    res.status(500).json({ error: 'internal error' });
  }
});

// ============================================================
// 2) POST /portal/orders
// ============================================================
router.post('/orders', postLimiter, async (req, res) => {
  try {
    const { package_code, full_name, phone, mac } = req.body || {};
    if (!package_code) return res.status(400).json({ error: 'package_code required' });
    if (!full_name || String(full_name).trim().length < 2) {
      return res.status(400).json({ error: 'full_name required' });
    }
    const cleanPhone = normalisePhone(phone);
    if (cleanPhone.length < 7) {
      return res.status(400).json({ error: 'valid phone required' });
    }

    const pkg = await db.queryOne(
      'SELECT id, code, name, price, service_type FROM packages WHERE code = ? AND is_active = 1',
      [package_code]
    );
    if (!pkg) return res.status(404).json({ error: 'package not found' });

    const cleanMac = normaliseMac(mac);
    const orderCode = genOrderCode();
    const r = await db.query(
      `INSERT INTO orders
         (order_code, package_id, full_name, phone, mac_address, amount, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending_payment')`,
      [orderCode, pkg.id, String(full_name).trim().slice(0, 100), cleanPhone, cleanMac, pkg.price]
    );

    await db.query(
      `INSERT INTO activity_log (actor_type, actor_id, action, entity_type, entity_id, meta, ip_address)
       VALUES ('customer', ?, 'portal_order_created', 'order', ?, ?, ?)`,
      [cleanPhone, String(r.insertId), JSON.stringify({ package: pkg.code, mac: cleanMac }), clientIp(req)]
    );

    const pay = await paymentInfo();
    res.json({
      ok: true,
      order_code: orderCode,
      order_id: r.insertId,
      amount: Number(pkg.price),
      package: { code: pkg.code, name: pkg.name, service_type: pkg.service_type },
      payment: { bkash: pay.bkash, nagad: pay.nagad },
      currency_symbol: pay.currency_symbol,
    });
  } catch (err) {
    logger.error({ err, body: req.body }, 'portal order create failed');
    res.status(500).json({ error: 'internal error' });
  }
});

// ============================================================
// 3) POST /portal/orders/:code/payment
// ============================================================
router.post('/orders/:code/payment', postLimiter, upload.single('screenshot'), async (req, res) => {
  try {
    const code = String(req.params.code || '').toUpperCase();
    const order = await db.queryOne(
      'SELECT o.*, p.name AS package_name, p.code AS package_code FROM orders o JOIN packages p ON p.id = o.package_id WHERE o.order_code = ?',
      [code]
    );
    if (!order) return res.status(404).json({ error: 'order not found' });
    if (order.status === 'approved') return res.status(400).json({ error: 'order already approved' });
    if (order.status === 'rejected') return res.status(400).json({ error: 'order was rejected' });

    const { method, sender_number, trx_id } = req.body || {};
    if (!method) return res.status(400).json({ error: 'method required' });
    const allowedMethods = ['bkash', 'nagad', 'rocket', 'bank', 'cash', 'other'];
    if (!allowedMethods.includes(method)) return res.status(400).json({ error: 'invalid method' });
    if (!trx_id || String(trx_id).trim().length < 3) {
      return res.status(400).json({ error: 'trx_id required' });
    }

    const screenshotPath = req.file ? req.file.path : null;

    await db.query(
      `INSERT INTO payments (order_id, method, sender_number, trx_id, amount, screenshot_path, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [
        order.id,
        method,
        normalisePhone(sender_number) || null,
        String(trx_id).trim().slice(0, 50),
        order.amount,
        screenshotPath,
      ]
    );

    await db.query(
      `UPDATE orders SET status = 'payment_submitted' WHERE id = ?`,
      [order.id]
    );

    await db.query(
      `INSERT INTO activity_log (actor_type, actor_id, action, entity_type, entity_id, meta, ip_address)
       VALUES ('customer', ?, 'portal_payment_submitted', 'order', ?, ?, ?)`,
      [order.phone, String(order.id), JSON.stringify({ method, trx_id: String(trx_id).slice(0, 50) }), clientIp(req)]
    );

    // fire-and-forget Telegram ping
    notifyAdmins(
      `💳 *New payment* submitted\n` +
      `Order: \`${order.order_code}\`\n` +
      `Package: ${order.package_name}\n` +
      `Customer: ${order.full_name} (${order.phone})\n` +
      `Method: ${method} · TrxID: \`${String(trx_id).slice(0, 50)}\`\n` +
      `Amount: ${order.amount}`
    ).catch(() => {});

    res.json({ ok: true, order_code: order.order_code, status: 'payment_submitted' });
  } catch (err) {
    logger.error({ err }, 'portal payment submit failed');
    res.status(500).json({ error: err.message || 'internal error' });
  }
});

// ============================================================
// 4) GET /portal/orders/:code   (status polling)
// ============================================================
router.get('/orders/:code', getLimiter, async (req, res) => {
  try {
    const code = String(req.params.code || '').toUpperCase();
    const order = await db.queryOne(
      `SELECT o.*, p.name AS package_name, p.code AS package_code, p.service_type
         FROM orders o JOIN packages p ON p.id = o.package_id
         WHERE o.order_code = ?`,
      [code]
    );
    if (!order) return res.status(404).json({ error: 'not found' });

    let subscription = null;
    if (order.subscription_id) {
      const sub = await db.queryOne(
        `SELECT login_username, login_password, starts_at, expires_at, service_type, mt_synced, mt_error
         FROM subscriptions WHERE id = ?`,
        [order.subscription_id]
      );
      if (sub) subscription = sub;
    }

    res.json({
      order_code: order.order_code,
      status: order.status,
      amount: Number(order.amount),
      package: { code: order.package_code, name: order.package_name, service_type: order.service_type },
      rejected_reason: order.rejected_reason || null,
      created_at: order.created_at,
      subscription,
    });
  } catch (err) {
    logger.error({ err }, 'portal order status failed');
    res.status(500).json({ error: 'internal error' });
  }
});

// ============================================================
// 5) POST /portal/vouchers/redeem
//    body: { code, full_name?, phone? }
//    → marks voucher redeemed, provisions subscription, returns creds
// ============================================================
router.post('/vouchers/redeem', postLimiter, async (req, res) => {
  try {
    const { code, full_name, phone, mac } = req.body || {};
    if (!code || String(code).trim().length < 4) {
      return res.status(400).json({ error: 'voucher code required' });
    }
    const result = await vouchers.redeemVoucher({
      code: String(code).trim(),
      fullName: full_name,
      phone: phone,
      mac,
    });

    await db.query(
      `INSERT INTO activity_log (actor_type, actor_id, action, entity_type, entity_id, meta, ip_address)
       VALUES ('customer', ?, 'portal_voucher_redeemed', 'subscription', ?, ?, ?)`,
      [
        String(phone || '').slice(0, 40),
        String(result.subscription.id),
        JSON.stringify({ code: String(code).trim().toUpperCase(), package: result.package.code }),
        clientIp(req),
      ]
    );

    notifyAdmins(
      `🎟 *Voucher redeemed*\n` +
      `Code: \`${String(code).trim().toUpperCase()}\`\n` +
      `Package: ${result.package.name}\n` +
      `Customer: ${full_name || '-'} (${phone || '-'})\n` +
      `Username: \`${result.subscription.login_username}\``
    ).catch(() => {});

    res.json(result);
  } catch (err) {
    const msg = err.message || 'internal error';
    const code = /invalid|used|expired|required|not found/i.test(msg) ? 400 : 500;
    if (code >= 500) logger.error({ err }, 'voucher redeem failed');
    res.status(code).json({ error: msg });
  }
});

// ============================================================
// 6) GET /portal/vouchers/:code/info   (preview only, no redeem)
// ============================================================
router.get('/vouchers/:code/info', getLimiter, async (req, res) => {
  try {
    const code = String(req.params.code || '').toUpperCase().trim();
    const v = await db.queryOne(
      `SELECT v.code, v.is_redeemed, v.expires_at,
              p.name AS package_name, p.code AS package_code,
              p.rate_down_mbps, p.rate_up_mbps, p.duration_days, p.price, p.service_type
         FROM vouchers v JOIN packages p ON p.id = v.package_id
         WHERE v.code = ?`,
      [code]
    );
    if (!v) return res.status(404).json({ error: 'invalid code' });
    res.json({
      code: v.code,
      is_redeemed: !!v.is_redeemed,
      expires_at: v.expires_at,
      package: {
        code: v.package_code,
        name: v.package_name,
        rate_down_mbps: v.rate_down_mbps,
        rate_up_mbps: v.rate_up_mbps,
        duration_days: v.duration_days,
        price: Number(v.price),
        service_type: v.service_type,
      },
    });
  } catch (err) {
    logger.error({ err }, 'voucher info failed');
    res.status(500).json({ error: 'internal error' });
  }
});

// ============================================================
// 7) POST /portal/customer/login
//    body: { phone, order_code }
//    → looks up customer by phone + matches any order_code; returns
//      that customer's active subscriptions (username/password, expiry)
//      so returning customers can view their details without admin auth.
// ============================================================
router.post('/customer/login', postLimiter, async (req, res) => {
  try {
    const phone = normalisePhone(req.body?.phone);
    const orderCode = String(req.body?.order_code || '').toUpperCase().trim();
    if (!phone || !orderCode) {
      return res.status(400).json({ error: 'phone and order_code required' });
    }
    const order = await db.queryOne(
      `SELECT o.* FROM orders o WHERE o.order_code = ? AND o.phone = ?`,
      [orderCode, phone]
    );
    if (!order) return res.status(404).json({ error: 'no match — check phone and order code' });

    const customer = order.customer_id
      ? await db.queryOne('SELECT id, full_name, phone, customer_code FROM customers WHERE id = ?', [order.customer_id])
      : null;

    const subs = customer
      ? await db.query(
          `SELECT s.id, s.login_username, s.login_password, s.starts_at, s.expires_at,
                  s.status, s.service_type, s.mt_synced,
                  s.mac_address, s.bind_to_mac,
                  p.name AS package_name, p.code AS package_code,
                  p.rate_down_mbps, p.rate_up_mbps, p.duration_days, p.price
             FROM subscriptions s JOIN packages p ON p.id = s.package_id
             WHERE s.customer_id = ? ORDER BY s.expires_at DESC`,
          [customer.id]
        )
      : [];

    res.json({
      ok: true,
      customer,
      order: {
        order_code: order.order_code,
        status: order.status,
        amount: Number(order.amount),
      },
      subscriptions: subs,
    });
  } catch (err) {
    logger.error({ err }, 'customer login failed');
    res.status(500).json({ error: 'internal error' });
  }
});

// ============================================================
// 8) POST /portal/renewals
//     body: { phone, order_code, subscription_id, package_code }
//
//     Create a renewal order for an existing subscription. Identity
//     is proved by the pairing of the customer's phone with any
//     order_code that belongs to them. The renewal order re-uses the
//     existing subscription so admin approval just extends expiry.
// ============================================================
router.post('/renewals', postLimiter, async (req, res) => {
  try {
    const phone = normalisePhone(req.body?.phone);
    const orderCode = String(req.body?.order_code || '').toUpperCase().trim();
    const subscriptionId = Number(req.body?.subscription_id);
    const packageCode = String(req.body?.package_code || '').trim();

    if (!phone || !orderCode || !subscriptionId || !packageCode) {
      return res.status(400).json({ error: 'phone, order_code, subscription_id and package_code are required' });
    }

    // identity check: does this phone own an order with that code?
    const proof = await db.queryOne(
      'SELECT customer_id FROM orders WHERE order_code = ? AND phone = ?',
      [orderCode, phone]
    );
    if (!proof) return res.status(404).json({ error: 'cannot verify — phone and order code do not match' });

    // the subscription must belong to the same customer
    const sub = await db.queryOne(
      `SELECT s.id, s.customer_id, s.package_id, s.service_type, s.login_username,
              s.expires_at, s.status, c.phone
         FROM subscriptions s
         JOIN customers c ON c.id = s.customer_id
        WHERE s.id = ?`,
      [subscriptionId]
    );
    if (!sub) return res.status(404).json({ error: 'subscription not found' });
    if (sub.customer_id !== proof.customer_id) {
      return res.status(403).json({ error: 'this subscription does not belong to the provided order' });
    }

    // target package (can be same or an upgrade)
    const pkg = await db.queryOne(
      'SELECT id, code, name, price, service_type FROM packages WHERE code = ? AND is_active = 1',
      [packageCode]
    );
    if (!pkg) return res.status(404).json({ error: 'package not found or inactive' });

    // Bail out if user already has an open renewal order queued.
    const existing = await db.queryOne(
      `SELECT id, order_code FROM orders
        WHERE renewal_of_subscription_id = ?
          AND status IN ('pending_payment', 'payment_submitted')
        ORDER BY id DESC LIMIT 1`,
      [subscriptionId]
    );
    if (existing) {
      return res.status(200).json({
        ok: true,
        already_pending: true,
        order_code: existing.order_code,
      });
    }

    const newCode = genOrderCode();
    const r = await db.query(
      `INSERT INTO orders
         (order_code, package_id, customer_id, full_name, phone, amount,
          renewal_of_subscription_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_payment')`,
      [newCode, pkg.id, proof.customer_id, '(renewal)', phone, pkg.price, subscriptionId]
    );

    await db.query(
      `INSERT INTO activity_log (actor_type, actor_id, action, entity_type, entity_id, meta, ip_address)
       VALUES ('customer', ?, 'portal_renewal_created', 'order', ?, ?, ?)`,
      [phone, String(r.insertId), JSON.stringify({ subscriptionId, package: pkg.code }), clientIp(req)]
    );

    const pay = await paymentInfo();
    res.json({
      ok: true,
      order_code: newCode,
      order_id: r.insertId,
      amount: Number(pkg.price),
      package: { code: pkg.code, name: pkg.name, service_type: pkg.service_type },
      renewal_of: { id: sub.id, login_username: sub.login_username, current_expires_at: sub.expires_at },
      payment: { bkash: pay.bkash, nagad: pay.nagad },
      currency_symbol: pay.currency_symbol,
    });
  } catch (err) {
    logger.error({ err }, 'portal renewal failed');
    res.status(500).json({ error: err.message || 'internal error' });
  }
});

// ============================================================
// 9) GET /portal/orders/:code/invoice?phone=01xx
//    Public invoice — phone must match the one on the order.
// ============================================================
router.get('/orders/:code/invoice', getLimiter, async (req, res) => {
  try {
    const code = String(req.params.code || '').toUpperCase().trim();
    const phone = normalisePhone(req.query.phone);
    if (!phone) return res.status(400).send('phone required');
    const order = await db.queryOne(
      'SELECT id, phone FROM orders WHERE order_code = ?',
      [code]
    );
    if (!order || order.phone !== phone) return res.status(404).send('not found');
    const html = await renderInvoiceForOrder(order.id);
    if (!html) return res.status(404).send('not found');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err) {
    logger.error({ err }, 'portal invoice failed');
    res.status(500).send('error');
  }
});

// ============================================================
// 10) POST /portal/otp/request   { phone }
//     Issue an OTP for the given phone and deliver it through
//     whichever notification channel the admin has configured
//     (Telegram if the customer's telegram_id is on file, else
//     SMS or WhatsApp). On success returns { channel, ttl_seconds }.
// ============================================================
router.post('/otp/request', otpLimiter, async (req, res) => {
  try {
    const phone = normalisePhone(req.body?.phone);
    if (!phone) return res.status(400).json({ error: 'phone required' });
    const out = await otp.issueOtp({ phone, purpose: 'login', ip: clientIp(req) });
    if (!out.ok) return res.status(400).json(out);
    res.json(out);
  } catch (err) {
    logger.error({ err }, 'otp request failed');
    res.status(500).json({ error: err.message || 'internal error' });
  }
});

// ============================================================
// 11) POST /portal/otp/verify    { phone, code }
//     Validates the OTP and returns the customer's subscriptions
//     — exactly the same payload shape as /customer/login, so
//     the frontend can treat either auth path the same way.
// ============================================================
router.post('/otp/verify', postLimiter, async (req, res) => {
  try {
    const phone = normalisePhone(req.body?.phone);
    const code = String(req.body?.code || '').trim();
    if (!phone || !code) return res.status(400).json({ error: 'phone and code required' });
    const out = await otp.verifyOtp({ phone, code, purpose: 'login' });
    if (!out.ok) return res.status(400).json(out);

    // Shape the response the same way as /customer/login so the
    // portal can reuse its "Welcome back" component unchanged.
    res.json({
      ok: true,
      customer: out.customer,
      subscriptions: out.subscriptions || [],
      // Pull the most recent order so the invoice button has a code to hit.
      order: out.customer
        ? await db.queryOne(
            'SELECT order_code, status, amount FROM orders WHERE customer_id = ? ORDER BY id DESC LIMIT 1',
            [out.customer.id]
          )
        : null,
    });
  } catch (err) {
    logger.error({ err }, 'otp verify failed');
    res.status(500).json({ error: err.message || 'internal error' });
  }
});

function clientIp(req) {
  return (req.headers['x-forwarded-for']?.split(',')[0] || req.ip || '').trim().slice(0, 45);
}

export default router;
