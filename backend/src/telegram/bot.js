// ============================================================
// Skynity Telegram Bot
// ------------------------------------------------------------
// Two audiences in one bot:
//   - Customers: /start → pick package → submit details → pay
//   - Admins: receive notifications, approve / reject orders
// Admin is identified by TELEGRAM_ADMIN_IDS from .env
// ============================================================

import TelegramBot from 'node-telegram-bot-api';
import fs from 'node:fs/promises';
import path from 'node:path';
import config from '../config/index.js';
import db from '../database/pool.js';
import logger from '../utils/logger.js';
import {
  approveOrderAndProvision,
  rejectOrder,
} from '../services/provisioning.js';
import { registerAdminCommands, handleAdminGuidedFlow } from './admin-commands.js';

const { TELEGRAM_BOT_TOKEN, TELEGRAM_ADMIN_IDS, BKASH_NUMBER, NAGAD_NUMBER, CURRENCY_SYMBOL, UPLOAD_DIR } = config;

// If TELEGRAM_BOT_TOKEN is missing, return a no-op proxy so module-level
// handler registrations (bot.onText / bot.on / ...) don't crash the process.
// Polling only actually starts in startBot() below.
function createNullBot() {
  const noop = async () => null;
  return new Proxy({}, {
    get() { return noop; },
  });
}

const bot = TELEGRAM_BOT_TOKEN
  ? new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false })
  : createNullBot();

const isAdmin = (tgId) => TELEGRAM_ADMIN_IDS.includes(String(tgId));

// ---------- session helpers ----------
async function getSession(tgId) {
  const row = await db.queryOne('SELECT * FROM bot_sessions WHERE telegram_id = ?', [String(tgId)]);
  return row ? { state: row.state, data: row.data || {} } : { state: 'idle', data: {} };
}
async function setSession(tgId, state, data = {}) {
  await db.query(
    `INSERT INTO bot_sessions (telegram_id, state, data) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE state = VALUES(state), data = VALUES(data)`,
    [String(tgId), state, JSON.stringify(data)]
  );
}
async function clearSession(tgId) {
  await db.query('DELETE FROM bot_sessions WHERE telegram_id = ?', [String(tgId)]);
}

// ---------- order code ----------
async function generateOrderCode() {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const row = await db.queryOne(
    `SELECT COUNT(*) AS c FROM orders WHERE DATE(created_at) = CURDATE()`
  );
  const n = (row?.c || 0) + 1;
  return `ORD-${ymd}-${String(n).padStart(4, '0')}`;
}

// ---------- shared UI ----------
const MAIN_MENU = {
  reply_markup: {
    keyboard: [
      [{ text: '🛒 Buy Package' }, { text: '📦 My Subscriptions' }],
      [{ text: '💬 Support' }, { text: 'ℹ️ Help' }],
    ],
    resize_keyboard: true,
  },
};

// ============================================================
// /start
// ============================================================
bot.onText(/^\/start$/, async (msg) => {
  const chatId = msg.chat.id;
  const name = msg.from.first_name || 'there';
  await clearSession(msg.from.id);

  const adminBadge = isAdmin(msg.from.id) ? '\n\n👑 *Admin access enabled*' : '';

  await bot.sendMessage(
    chatId,
    `👋 *Welcome to Skynity ISP*, ${name}!\n\n` +
      `We provide fast, reliable internet in Bangladesh. 🇧🇩\n\n` +
      `• 🛒 *Buy Package* — see available internet plans\n` +
      `• 📦 *My Subscriptions* — check your active service\n` +
      `• 💬 *Support* — contact us for help${adminBadge}`,
    { parse_mode: 'Markdown', ...MAIN_MENU }
  );

  if (isAdmin(msg.from.id)) {
    await bot.sendMessage(
      chatId,
      '👑 Admin commands:\n/pending — view pending orders\n/stats — quick stats\n/customers — recent customers',
      { parse_mode: 'Markdown' }
    );
  }
});

// ============================================================
// /help
// ============================================================
bot.onText(/^(\/help|ℹ️ Help)$/, async (msg) => {
  await bot.sendMessage(
    msg.chat.id,
    `*How it works:*\n\n` +
      `1️⃣ Tap *Buy Package* and pick a plan\n` +
      `2️⃣ Enter your name and phone\n` +
      `3️⃣ Pay via bKash / Nagad to the given number\n` +
      `4️⃣ Send us the *Transaction ID* and a screenshot\n` +
      `5️⃣ Admin verifies — your login details arrive here ✅\n\n` +
      `Need a human? Tap *Support*.`,
    { parse_mode: 'Markdown' }
  );
});

// ============================================================
// /support
// ============================================================
bot.onText(/^(💬 Support)$/, async (msg) => {
  await bot.sendMessage(
    msg.chat.id,
    `💬 Contact support:\n\n• Phone: +880 1XXX-XXXXXX\n• Hours: 9am – 11pm daily\n\nLeave a message here and an admin will reply.`
  );
});

// ============================================================
// Buy Package flow
// ============================================================
bot.onText(/^(🛒 Buy Package|\/buy)$/, async (msg) => {
  const chatId = msg.chat.id;
  const pkgs = await db.query(
    `SELECT * FROM packages WHERE is_active = 1 ORDER BY service_type, sort_order, price`
  );

  if (!pkgs.length) {
    return bot.sendMessage(chatId, '⚠️ No packages available right now. Please try later.');
  }

  // group by service_type
  const grouped = { hotspot: [], pppoe: [] };
  for (const p of pkgs) grouped[p.service_type].push(p);

  await bot.sendMessage(chatId, '📶 *Choose a service type:*', { parse_mode: 'Markdown' });

  for (const type of ['pppoe', 'hotspot']) {
    if (!grouped[type].length) continue;
    const header = type === 'pppoe' ? '🔐 *PPPoE (Dedicated)*' : '📡 *Hotspot (WiFi)*';
    const keyboard = grouped[type].map((p) => [
      {
        text: `${p.name} — ${CURRENCY_SYMBOL}${Number(p.price).toFixed(0)}`,
        callback_data: `pkg:${p.id}`,
      },
    ]);
    await bot.sendMessage(chatId, header, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });
  }
});

// ============================================================
// Package selection → collect name
// ============================================================
bot.on('callback_query', async (cq) => {
  const data = cq.data;
  const chatId = cq.message.chat.id;
  const tgId = cq.from.id;

  try {
    // --- package selection ---
    if (data.startsWith('pkg:')) {
      const pkgId = Number(data.split(':')[1]);
      const pkg = await db.queryOne('SELECT * FROM packages WHERE id = ?', [pkgId]);
      if (!pkg) return bot.answerCallbackQuery(cq.id, { text: 'Package not found' });

      await setSession(tgId, 'awaiting_name', { packageId: pkgId });

      await bot.answerCallbackQuery(cq.id, { text: `Selected: ${pkg.name}` });
      await bot.sendMessage(
        chatId,
        `✅ *${pkg.name}*\n` +
          `💰 Price: ${CURRENCY_SYMBOL}${Number(pkg.price).toFixed(2)}\n` +
          `⏱ Duration: ${pkg.duration_days} days\n` +
          `🚀 Speed: ${pkg.rate_down_mbps} Mbps\n\n` +
          `Please enter your *full name*:`,
        { parse_mode: 'Markdown', reply_markup: { force_reply: true } }
      );
      return;
    }

    // --- admin approve / reject ---
    if (data.startsWith('approve:') || data.startsWith('reject:')) {
      if (!isAdmin(tgId)) {
        return bot.answerCallbackQuery(cq.id, { text: 'Admin only', show_alert: true });
      }
      const [action, orderIdStr] = data.split(':');
      const orderId = Number(orderIdStr);
      const adminRow = await db.queryOne('SELECT id FROM admins WHERE telegram_id = ?', [String(tgId)]);
      const adminDbId = adminRow?.id || null;

      if (action === 'approve') {
        await bot.answerCallbackQuery(cq.id, { text: 'Processing…' });
        try {
          const result = await approveOrderAndProvision({ orderId, adminId: adminDbId });
          await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
            chat_id: chatId, message_id: cq.message.message_id,
          });
          await bot.sendMessage(
            chatId,
            `✅ *Order approved*\nCustomer: ${result.customer.full_name}\n` +
              `Login: \`${result.subscription.login_username}\`\n` +
              `Password: \`${result.subscription.login_password}\`\n` +
              `Expires: ${new Date(result.subscription.expires_at).toLocaleString()}\n` +
              (result.subscription.mtSynced ? '📡 Pushed to MikroTik ✓' : '⚠️ MikroTik push failed — will retry'),
            { parse_mode: 'Markdown' }
          );
          // notify customer
          if (result.order.telegram_id) {
            await bot.sendMessage(
              result.order.telegram_id,
              `🎉 *Your order is approved!*\n\n` +
                `🆔 *Username:* \`${result.subscription.login_username}\`\n` +
                `🔑 *Password:* \`${result.subscription.login_password}\`\n` +
                `📅 *Valid until:* ${new Date(result.subscription.expires_at).toLocaleString()}\n\n` +
                `Service: ${result.subscription.service_type.toUpperCase()} — ${result.subscription.package}\n\n` +
                `Enjoy! 🚀`,
              { parse_mode: 'Markdown' }
            ).catch(() => {});
          }
        } catch (err) {
          logger.error({ err, orderId }, 'approve failed');
          await bot.sendMessage(chatId, `❌ Approval failed: ${err.message}`);
        }
      } else {
        // reject
        await setSession(tgId, 'awaiting_reject_reason', { orderId });
        await bot.answerCallbackQuery(cq.id);
        await bot.sendMessage(chatId, `Enter a rejection reason for order #${orderId}:`, {
          reply_markup: { force_reply: true },
        });
      }
      return;
    }
  } catch (err) {
    logger.error({ err }, 'callback error');
    bot.answerCallbackQuery(cq.id, { text: 'Error', show_alert: true });
  }
});

// ============================================================
// Text message handler — drives the multi-step customer form
// ============================================================
bot.on('message', async (msg) => {
  if (!msg.text) return;
  if (msg.text.startsWith('/')) return;                    // commands handled above
  if (['🛒 Buy Package', '📦 My Subscriptions', '💬 Support', 'ℹ️ Help'].includes(msg.text)) return;

  const tgId = msg.from.id;
  const chatId = msg.chat.id;
  const session = await getSession(tgId);

  // Admin-guided multi-step flows (addrouter, addpkg) — handled first
  if (await handleAdminGuidedFlow(bot, msg, session, { isAdmin, setSession, clearSession, CURRENCY_SYMBOL })) {
    return;
  }

  try {
    if (session.state === 'awaiting_name') {
      const name = msg.text.trim();
      if (name.length < 2) return bot.sendMessage(chatId, 'Please enter a valid name.');
      session.data.full_name = name;
      await setSession(tgId, 'awaiting_phone', session.data);
      return bot.sendMessage(chatId, '📱 Please enter your *phone number* (e.g. 017XXXXXXXX):', {
        parse_mode: 'Markdown', reply_markup: { force_reply: true },
      });
    }

    if (session.state === 'awaiting_phone') {
      const phone = msg.text.trim().replace(/\s+/g, '');
      if (!/^(\+?88)?01[3-9]\d{8}$/.test(phone)) {
        return bot.sendMessage(chatId, '❌ Invalid phone. Please enter a valid BD number (017XXXXXXXX).');
      }
      session.data.phone = phone;

      // Create order in DB now, in 'pending_payment' state
      const pkg = await db.queryOne('SELECT * FROM packages WHERE id = ?', [session.data.packageId]);
      const orderCode = await generateOrderCode();
      const result = await db.query(
        `INSERT INTO orders (order_code, package_id, full_name, phone, telegram_id, amount, status)
         VALUES (?, ?, ?, ?, ?, ?, 'pending_payment')`,
        [orderCode, pkg.id, session.data.full_name, phone, String(tgId), pkg.price]
      );
      session.data.orderId = result.insertId;
      session.data.orderCode = orderCode;
      await setSession(tgId, 'awaiting_trx', session.data);

      await bot.sendMessage(
        chatId,
        `🧾 *Order created:* \`${orderCode}\`\n\n` +
          `💵 *Amount to pay:* ${CURRENCY_SYMBOL}${Number(pkg.price).toFixed(2)}\n\n` +
          `📱 *Send to one of:*\n` +
          (BKASH_NUMBER ? `• bKash (Personal): \`${BKASH_NUMBER}\`\n` : '') +
          (NAGAD_NUMBER ? `• Nagad (Personal): \`${NAGAD_NUMBER}\`\n` : '') +
          `\nAfter sending, reply with the *Transaction ID* (TrxID).`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (session.state === 'awaiting_trx') {
      const trx = msg.text.trim();
      if (trx.length < 6) return bot.sendMessage(chatId, 'TrxID looks too short. Please check and resend.');
      session.data.trxId = trx;

      // insert payment row
      const order = await db.queryOne('SELECT * FROM orders WHERE id = ?', [session.data.orderId]);
      await db.query(
        `INSERT INTO payments (order_id, method, trx_id, amount, status)
         VALUES (?, 'bkash', ?, ?, 'pending')`,
        [order.id, trx, order.amount]
      );
      await db.query(`UPDATE orders SET status = 'payment_submitted' WHERE id = ?`, [order.id]);

      await setSession(tgId, 'awaiting_screenshot', session.data);
      return bot.sendMessage(
        chatId,
        `🧾 Got TrxID: \`${trx}\`\n\nNow please *send a screenshot* of the payment confirmation.`,
        { parse_mode: 'Markdown' }
      );
    }

    if (session.state === 'awaiting_reject_reason') {
      const reason = msg.text.trim();
      const adminRow = await db.queryOne('SELECT id FROM admins WHERE telegram_id = ?', [String(tgId)]);
      await rejectOrder({ orderId: session.data.orderId, adminId: adminRow?.id || null, reason });
      await clearSession(tgId);
      await bot.sendMessage(chatId, `❌ Order rejected. Customer has been notified.`);
      // notify customer
      const order = await db.queryOne('SELECT * FROM orders WHERE id = ?', [session.data.orderId]);
      if (order?.telegram_id) {
        bot.sendMessage(
          order.telegram_id,
          `❌ *Sorry, your order could not be approved.*\nReason: ${reason}\n\nIf you believe this is a mistake, contact support.`,
          { parse_mode: 'Markdown' }
        ).catch(() => {});
      }
      return;
    }
  } catch (err) {
    logger.error({ err, tgId }, 'message handler error');
    bot.sendMessage(chatId, '❌ Something went wrong. Please try /start again.');
  }
});

// ============================================================
// Photo (screenshot) handler
// ============================================================
bot.on('photo', async (msg) => {
  const tgId = msg.from.id;
  const chatId = msg.chat.id;
  const session = await getSession(tgId);
  if (session.state !== 'awaiting_screenshot') return;

  try {
    const photo = msg.photo[msg.photo.length - 1]; // highest res
    const fileLink = await bot.getFileLink(photo.file_id);
    const buf = await (await fetch(fileLink)).arrayBuffer();

    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    const filename = `order-${session.data.orderId}-${Date.now()}.jpg`;
    const filepath = path.join(UPLOAD_DIR, filename);
    await fs.writeFile(filepath, Buffer.from(buf));

    await db.query(
      `UPDATE payments SET screenshot_path = ? WHERE order_id = ? ORDER BY id DESC LIMIT 1`,
      [filepath, session.data.orderId]
    );

    await clearSession(tgId);
    await bot.sendMessage(
      chatId,
      `✅ *Received!* We'll verify your payment shortly.\n\n` +
        `Order: \`${session.data.orderCode}\`\n` +
        `You'll get your login details here once approved. Typically within 15 minutes during business hours.`,
      { parse_mode: 'Markdown' }
    );

    // notify admins
    const order = await db.queryOne('SELECT * FROM orders WHERE id = ?', [session.data.orderId]);
    const pkg = await db.queryOne('SELECT * FROM packages WHERE id = ?', [order.package_id]);
    const payment = await db.queryOne(
      'SELECT * FROM payments WHERE order_id = ? ORDER BY id DESC LIMIT 1',
      [order.id]
    );

    for (const adminTgId of TELEGRAM_ADMIN_IDS) {
      try {
        await bot.sendPhoto(adminTgId, filepath, {
          caption:
            `🆕 *New Order:* \`${order.order_code}\`\n\n` +
            `👤 Name: ${order.full_name}\n` +
            `📱 Phone: ${order.phone}\n` +
            `📦 Package: ${pkg.name}\n` +
            `💰 Amount: ${CURRENCY_SYMBOL}${Number(order.amount).toFixed(2)}\n` +
            `🧾 TrxID: \`${payment.trx_id}\`\n` +
            `🕒 ${new Date(order.created_at).toLocaleString()}`,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Approve', callback_data: `approve:${order.id}` },
                { text: '❌ Reject', callback_data: `reject:${order.id}` },
              ],
            ],
          },
        });
      } catch (err) {
        logger.error({ err, adminTgId }, 'notify admin failed');
      }
    }
  } catch (err) {
    logger.error({ err }, 'photo handler error');
    bot.sendMessage(chatId, '❌ Could not save screenshot. Please try again.');
  }
});

// ============================================================
// My Subscriptions
// ============================================================
bot.onText(/^(📦 My Subscriptions|\/mysubs)$/, async (msg) => {
  const tgId = String(msg.from.id);
  const subs = await db.query(
    `SELECT s.*, p.name AS package_name, c.full_name
     FROM subscriptions s
     JOIN customers c ON c.id = s.customer_id
     JOIN packages p ON p.id = s.package_id
     WHERE c.telegram_id = ?
     ORDER BY s.created_at DESC LIMIT 10`,
    [tgId]
  );

  if (!subs.length) {
    return bot.sendMessage(msg.chat.id, 'You have no active subscriptions yet. Tap *Buy Package* to get started.', {
      parse_mode: 'Markdown',
    });
  }

  for (const s of subs) {
    const expires = new Date(s.expires_at);
    const expired = expires < new Date();
    await bot.sendMessage(
      msg.chat.id,
      `${expired ? '⏰' : '✅'} *${s.package_name}*\n` +
        `🆔 Login: \`${s.login_username}\`\n` +
        `🔑 Password: \`${s.login_password}\`\n` +
        `📅 Expires: ${expires.toLocaleString()}\n` +
        `📊 Status: *${s.status}*`,
      { parse_mode: 'Markdown' }
    );
  }
});

// ============================================================
// Admin: /pending
// ============================================================
bot.onText(/^\/pending$/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  const rows = await db.query(
    `SELECT o.*, p.name AS pkg_name, py.trx_id, py.screenshot_path
     FROM orders o
     JOIN packages p ON p.id = o.package_id
     LEFT JOIN payments py ON py.order_id = o.id AND py.status = 'pending'
     WHERE o.status = 'payment_submitted'
     ORDER BY o.created_at ASC`
  );

  if (!rows.length) return bot.sendMessage(msg.chat.id, '✨ No pending orders.');

  for (const o of rows) {
    const caption =
      `📋 *${o.order_code}*\n` +
      `👤 ${o.full_name} — ${o.phone}\n` +
      `📦 ${o.pkg_name}\n` +
      `💰 ${CURRENCY_SYMBOL}${Number(o.amount).toFixed(2)}\n` +
      `🧾 TrxID: \`${o.trx_id || '-'}\``;
    const kb = {
      inline_keyboard: [[
        { text: '✅ Approve', callback_data: `approve:${o.id}` },
        { text: '❌ Reject', callback_data: `reject:${o.id}` },
      ]],
    };
    if (o.screenshot_path) {
      await bot.sendPhoto(msg.chat.id, o.screenshot_path, { caption, parse_mode: 'Markdown', reply_markup: kb });
    } else {
      await bot.sendMessage(msg.chat.id, caption, { parse_mode: 'Markdown', reply_markup: kb });
    }
  }
});

// ============================================================
// Admin: /stats
// ============================================================
bot.onText(/^\/stats$/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  const [pending] = await db.query(`SELECT COUNT(*) AS c FROM orders WHERE status = 'payment_submitted'`);
  const [approved] = await db.query(`SELECT COUNT(*) AS c FROM orders WHERE status = 'approved'`);
  const [active] = await db.query(`SELECT COUNT(*) AS c FROM subscriptions WHERE status = 'active' AND expires_at > NOW()`);
  const [revenue] = await db.query(`SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE status = 'verified' AND DATE(verified_at) = CURDATE()`);
  await bot.sendMessage(
    msg.chat.id,
    `📊 *Stats*\n\n` +
      `🔔 Pending orders: *${pending.c}*\n` +
      `✅ Approved (all time): *${approved.c}*\n` +
      `🟢 Active subs: *${active.c}*\n` +
      `💰 Today's revenue: *${CURRENCY_SYMBOL}${Number(revenue.s).toFixed(2)}*`,
    { parse_mode: 'Markdown' }
  );
});

// ============================================================
// Startup
// ============================================================
export function startBot() {
  if (!TELEGRAM_BOT_TOKEN) {
    logger.warn('TELEGRAM_BOT_TOKEN not set — Telegram bot disabled. Set it and restart to enable.');
    return null;
  }

  // Register all admin commands
  registerAdminCommands(bot, { isAdmin, setSession, getSession, clearSession, CURRENCY_SYMBOL });

  bot.on('polling_error', (err) => logger.error({ err: err.message }, 'polling error'));

  // Start polling now that all handlers are registered.
  bot.startPolling().then(
    () => logger.info({ admins: TELEGRAM_ADMIN_IDS.length }, 'Telegram bot started'),
    (err) => logger.error({ err: err.message }, 'failed to start telegram polling')
  );

  return bot;
}

/**
 * Fire-and-forget broadcast to every TELEGRAM_ADMIN_IDS chat.
 * Safe to call even when the bot is disabled — the stubbed
 * `bot.sendMessage` in that case is a no-op.
 */
/**
 * Send a message to a specific Telegram chat id (customer).
 * Returns { ok, error }.
 */
export async function sendTelegramTo(chatId, text, opts = {}) {
  if (!TELEGRAM_BOT_TOKEN) return { ok: false, error: 'telegram bot not configured' };
  if (!chatId) return { ok: false, error: 'no telegram_id for this customer' };
  try {
    await bot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      ...opts,
    });
    return { ok: true };
  } catch (err) {
    logger.warn({ err: err.message, chatId }, 'sendTelegramTo failed');
    return { ok: false, error: err.message };
  }
}

/** Expose the boolean for settings/status endpoints. */
export function telegramConfigured() {
  return !!TELEGRAM_BOT_TOKEN;
}

export async function notifyAdmins(text, opts = {}) {
  if (!TELEGRAM_ADMIN_IDS || !TELEGRAM_ADMIN_IDS.length) return;
  const payload = { parse_mode: 'Markdown', disable_web_page_preview: true, ...opts };
  for (const id of TELEGRAM_ADMIN_IDS) {
    try {
      await bot.sendMessage(id, text, payload);
    } catch (err) {
      logger.warn({ err: err.message, id }, 'notifyAdmins send failed');
    }
  }
}

export default bot;
