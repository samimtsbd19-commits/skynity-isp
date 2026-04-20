// ============================================================
// /api/notify — admin-only notification controls
// ------------------------------------------------------------
//   GET  /api/notify/channels              → which channels are on?
//   POST /api/notify/test                  → send a one-off test
//   GET  /api/notify/log?limit=..          → recent send history
//   POST /api/notify/send-credentials      → deliver subscription
//                                             creds to a customer
//   POST /api/notify/send-order-code       → deliver an order code
//
// Every "send" endpoint accepts a `channels[]` array to force a
// specific channel, otherwise the notifier picks the best one
// that's configured.
// ============================================================

import { Router } from 'express';
import db from '../database/pool.js';
import { requireAdmin } from '../middleware/auth.js';
import notifier from '../services/notifier.js';

const router = Router();

router.use(requireAdmin);

router.get('/channels', async (_req, res) => {
  res.json({ channels: await notifier.channelStatuses() });
});

router.get('/log', async (req, res) => {
  const limit  = Math.min(200, Number(req.query.limit)  || 50);
  const offset = Math.max(0,   Number(req.query.offset) || 0);
  const rows = await db.query(
    `SELECT id, channel, provider, target, purpose, status, error,
            triggered_by, related_order_id, related_subscription_id, created_at
       FROM notification_log
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
    [limit, offset]
  );
  res.json({ log: rows });
});

/**
 * POST /api/notify/test
 * body: { channel: 'telegram'|'whatsapp'|'sms', target, message? }
 *
 * `target` is a phone number for sms/whatsapp and a telegram id
 * for telegram. Used by the Settings page to verify credentials
 * work without having to create a real notification.
 */
router.post('/test', async (req, res) => {
  try {
    const { channel, target, message } = req.body || {};
    if (!channel || !target) return res.status(400).json({ error: 'channel and target are required' });

    const msg = message || `Skynity test message · ${new Date().toLocaleString()}`;
    let out;
    if (channel === 'telegram') out = await notifier.sendTelegram({ telegramId: target, message: msg, purpose: 'custom', triggeredBy: req.admin.id });
    else if (channel === 'whatsapp') out = await notifier.sendWhatsapp({ phone: target, message: msg, purpose: 'custom', triggeredBy: req.admin.id });
    else if (channel === 'sms') out = await notifier.sendSms({ phone: target, message: msg, purpose: 'custom', triggeredBy: req.admin.id });
    else return res.status(400).json({ error: `unknown channel: ${channel}` });

    if (!out.ok) return res.status(502).json(out);
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/notify/send-credentials
 * body: { subscription_id, channel?, message? }
 *
 * Builds a canonical "here are your WiFi creds" message and
 * sends to the subscription's customer via the best available
 * channel (or one forced by the admin).
 */
router.post('/send-credentials', async (req, res) => {
  try {
    const { subscription_id, channel, message } = req.body || {};
    if (!subscription_id) return res.status(400).json({ error: 'subscription_id required' });

    const sub = await db.queryOne(
      `SELECT s.*, c.full_name, c.phone, c.telegram_id, c.customer_code,
              p.name AS package_name, p.code AS package_code,
              p.rate_down_mbps, p.duration_days
         FROM subscriptions s
         JOIN customers c ON c.id = s.customer_id
         JOIN packages  p ON p.id = s.package_id
        WHERE s.id = ?`,
      [subscription_id]
    );
    if (!sub) return res.status(404).json({ error: 'subscription not found' });

    const body = message || [
      `Hello ${sub.full_name || ''},`,
      ``,
      `Your ${sub.package_name} WiFi access is active:`,
      `• Username: *${sub.login_username}*`,
      `• Password: *${sub.login_password}*`,
      `• Expires: ${new Date(sub.expires_at).toLocaleString()}`,
      ``,
      `Keep these safe — do not share with anyone.`,
    ].join('\n');

    const out = await notifier.notifyCustomer({
      customerId: sub.customer_id,
      phone: sub.phone,
      telegramId: sub.telegram_id,
      message: body,
      purpose: 'credentials',
      prefer: channel || null,
      triggeredBy: req.admin.id,
      relatedSubscriptionId: sub.id,
    });
    if (!out.ok) return res.status(502).json(out);
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/notify/send-order-code
 * body: { order_id, channel?, message? }
 */
router.post('/send-order-code', async (req, res) => {
  try {
    const { order_id, channel, message } = req.body || {};
    if (!order_id) return res.status(400).json({ error: 'order_id required' });

    const order = await db.queryOne(
      `SELECT o.*, p.name AS package_name
         FROM orders o JOIN packages p ON p.id = o.package_id
        WHERE o.id = ?`,
      [order_id]
    );
    if (!order) return res.status(404).json({ error: 'order not found' });

    const body = message || [
      `Hello,`,
      ``,
      `Your order code is *${order.order_code}* for package "${order.package_name}".`,
      `Use this code on our portal to track status or log in.`,
    ].join('\n');

    const out = await notifier.notifyCustomer({
      customerId: order.customer_id,
      phone: order.phone,
      telegramId: order.telegram_id,
      message: body,
      purpose: 'order_code',
      prefer: channel || null,
      triggeredBy: req.admin.id,
      relatedOrderId: order.id,
    });
    if (!out.ok) return res.status(502).json(out);
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/notify/send
 * body: { customer_id?, phone?, telegram_id?, channel?, message }
 *
 * Fully-custom free-form message. Either `customer_id` or one of
 * `phone`/`telegram_id` must be provided.
 */
router.post('/send', async (req, res) => {
  try {
    const { customer_id, phone, telegram_id, channel, message } = req.body || {};
    if (!message) return res.status(400).json({ error: 'message required' });
    if (!customer_id && !phone && !telegram_id) {
      return res.status(400).json({ error: 'customer_id OR phone/telegram_id required' });
    }
    const out = await notifier.notifyCustomer({
      customerId: customer_id || null,
      phone: phone || null,
      telegramId: telegram_id || null,
      message,
      purpose: 'custom',
      prefer: channel || null,
      triggeredBy: req.admin.id,
    });
    if (!out.ok) return res.status(502).json(out);
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
