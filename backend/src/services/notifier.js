// ============================================================
// Notifier service
// ------------------------------------------------------------
// A single entry point for sending messages to customers across
// multiple channels (Telegram / WhatsApp / SMS). Admins decide
// which channels are active and how each one is configured from
// the Settings → Notifications page. All sends are recorded
// in `notification_log` so there's an auditable trail.
//
// Public API:
//
//   channelStatuses()     → array of { channel, enabled, configured }
//   sendTelegram()        → one message to one telegram_id
//   sendWhatsapp()        → one message over Meta Cloud API
//   sendSms()             → one message via the configured SMS provider
//   notifyCustomer()      → picks the best channel and falls back
//
// Provider modules live inline — there aren't many of them and
// they're all basic HTTPS calls. Adding a new provider is a
// matter of extending the `SMS_PROVIDERS` object below.
// ============================================================

import axios from 'axios';
import db from '../database/pool.js';
import { getSetting } from './settings.js';
import logger from '../utils/logger.js';
import { sendTelegramTo, telegramConfigured } from '../telegram/bot.js';

// ------------------------------------------------------------
// Logging helper — writes the row and returns its id so the
// caller can update it with the final status.
// ------------------------------------------------------------
async function logAttempt({
  channel, provider, target, purpose, message,
  triggeredBy = null, relatedOrderId = null, relatedSubscriptionId = null,
}) {
  const r = await db.query(
    `INSERT INTO notification_log
       (channel, provider, target, purpose, message, status, triggered_by,
        related_order_id, related_subscription_id)
     VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?)`,
    [channel, provider || null, String(target).slice(0, 120), purpose, message, triggeredBy, relatedOrderId, relatedSubscriptionId]
  );
  return r.insertId;
}

async function finishAttempt(id, ok, err = null, meta = null) {
  await db.query(
    `UPDATE notification_log SET status = ?, error = ?, meta = ? WHERE id = ?`,
    [ok ? 'sent' : 'failed', err ? String(err).slice(0, 2000) : null, meta ? JSON.stringify(meta) : null, id]
  );
}

// ------------------------------------------------------------
// Phone normalisation — most BD gateways want 8801XXXXXXXXX.
// ------------------------------------------------------------
export function normalisePhoneForSms(raw) {
  if (!raw) return '';
  let s = String(raw).replace(/[^\d+]/g, '');
  if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('0') && s.length === 11) s = `880${s.slice(1)}`;        // 017… → 88017…
  else if (s.startsWith('88') && s.length === 13) { /* already good */ }
  else if (s.length === 10) s = `880${s}`;
  return s;
}

// ============================================================
// TELEGRAM
// ============================================================
export async function sendTelegram({ customerId, telegramId, message, purpose = 'custom', triggeredBy, relatedOrderId, relatedSubscriptionId }) {
  const enabled = !!(await getSetting('notify.telegram.enabled'));
  if (!enabled) return { ok: false, error: 'telegram channel disabled' };

  let chatId = telegramId;
  if (!chatId && customerId) {
    const row = await db.queryOne('SELECT telegram_id FROM customers WHERE id = ?', [customerId]);
    chatId = row?.telegram_id || null;
  }
  if (!chatId) return { ok: false, error: 'customer has no telegram_id on file' };

  const logId = await logAttempt({
    channel: 'telegram', provider: 'telegram_bot', target: String(chatId),
    purpose, message, triggeredBy, relatedOrderId, relatedSubscriptionId,
  });
  const r = await sendTelegramTo(chatId, message);
  await finishAttempt(logId, r.ok, r.error || null);
  return r;
}

// ============================================================
// WHATSAPP (Meta Cloud API)
// ============================================================
export async function sendWhatsapp({ phone, message, purpose = 'custom', triggeredBy, relatedOrderId, relatedSubscriptionId }) {
  const [enabled, phoneNumberId, token, templateName, language] = await Promise.all([
    getSetting('notify.whatsapp.enabled'),
    getSetting('notify.whatsapp.phone_number_id'),
    getSetting('notify.whatsapp.token'),
    getSetting('notify.whatsapp.template_name'),
    getSetting('notify.whatsapp.language'),
  ]);
  if (!enabled) return { ok: false, error: 'whatsapp channel disabled' };
  if (!phoneNumberId || !token) return { ok: false, error: 'whatsapp not configured (phone_number_id / token)' };

  const to = normalisePhoneForSms(phone);
  if (!to) return { ok: false, error: 'invalid phone' };

  const logId = await logAttempt({
    channel: 'whatsapp', provider: 'meta_cloud', target: to, purpose, message,
    triggeredBy, relatedOrderId, relatedSubscriptionId,
  });

  // If a template is provided we send a template message (required for
  // 24h+ outside session). Otherwise plain text, which works within a
  // 24-hour customer-initiated window.
  const body = templateName
    ? {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: templateName,
          language: { code: language || 'en' },
          components: [{ type: 'body', parameters: [{ type: 'text', text: message }] }],
        },
      }
    : {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: message },
      };

  try {
    const res = await axios.post(
      `https://graph.facebook.com/v20.0/${encodeURIComponent(phoneNumberId)}/messages`,
      body,
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 15000 }
    );
    await finishAttempt(logId, true, null, { response_id: res.data?.messages?.[0]?.id || null });
    return { ok: true };
  } catch (err) {
    const detail = err.response?.data?.error?.message || err.message;
    await finishAttempt(logId, false, detail);
    return { ok: false, error: detail };
  }
}

// ============================================================
// SMS providers
// ============================================================
const SMS_PROVIDERS = {
  // ---- BulkSMSBD --------------------------------------------
  async bulksmsbd({ phone, message, senderId }) {
    const apiKey = await getSetting('notify.sms.bulksmsbd.api_key');
    if (!apiKey) throw new Error('BulkSMSBD api_key not set');
    const res = await axios.get('http://bulksmsbd.net/api/smsapi', {
      params: { api_key: apiKey, type: 'text', number: phone, senderid: senderId || '', message },
      timeout: 15000,
    });
    // Response code 202 == success per docs
    const ok = typeof res.data === 'object'
      ? res.data?.response_code === 202
      : /202/.test(String(res.data));
    if (!ok) throw new Error(`BulkSMSBD rejected: ${JSON.stringify(res.data)}`);
    return { ok: true, raw: res.data };
  },

  // ---- SSL Wireless -----------------------------------------
  async sslwireless({ phone, message, senderId }) {
    const [token, sid] = await Promise.all([
      getSetting('notify.sms.sslwireless.api_token'),
      getSetting('notify.sms.sslwireless.sid'),
    ]);
    if (!token || !sid) throw new Error('SSL Wireless api_token/sid not set');
    const res = await axios.post(
      'https://smsplus.sslwireless.com/api/v3/send-sms',
      {
        api_token: token,
        sid,
        msisdn: phone,
        sms: message,
        ...(senderId ? { csms_id: senderId } : {}),
      },
      { timeout: 15000 }
    );
    const ok = res.data?.status === 'SUCCESS' || res.data?.status_code === 200;
    if (!ok) throw new Error(`SSL Wireless rejected: ${JSON.stringify(res.data)}`);
    return { ok: true, raw: res.data };
  },

  // ---- AlphaSMS ---------------------------------------------
  async alphasms({ phone, message, senderId }) {
    const apiKey = await getSetting('notify.sms.alphasms.api_key');
    if (!apiKey) throw new Error('AlphaSMS api_key not set');
    const res = await axios.get('https://api.sms.net.bd/sendsms', {
      params: { api_key: apiKey, msg: message, to: phone, sender_id: senderId || '' },
      timeout: 15000,
    });
    const ok = res.data?.error === 0;
    if (!ok) throw new Error(`AlphaSMS rejected: ${JSON.stringify(res.data)}`);
    return { ok: true, raw: res.data };
  },

  // ---- MIM SMS ----------------------------------------------
  async mimsms({ phone, message, senderId }) {
    const apiKey = await getSetting('notify.sms.mimsms.api_key');
    if (!apiKey) throw new Error('MIM SMS api_key not set');
    const res = await axios.get('https://api.mimsms.com/api/SmsSending/SMS', {
      params: { ApiKey: apiKey, ClientId: senderId || '', SenderId: senderId || '', Message: message, MobileNumber: phone },
      timeout: 15000,
    });
    const ok = res.data?.Status === '0' || res.data?.Status === 0;
    if (!ok) throw new Error(`MIM SMS rejected: ${JSON.stringify(res.data)}`);
    return { ok: true, raw: res.data };
  },

  // ---- Fully custom HTTP template ---------------------------
  async custom({ phone, message, senderId }) {
    const [urlTpl, method, successRegex] = await Promise.all([
      getSetting('notify.sms.custom.url_template'),
      getSetting('notify.sms.custom.method'),
      getSetting('notify.sms.custom.success_regex'),
    ]);
    if (!urlTpl) throw new Error('Custom gateway url_template not set');
    const rendered = String(urlTpl)
      .replaceAll('{phone}', encodeURIComponent(phone))
      .replaceAll('{message}', encodeURIComponent(message))
      .replaceAll('{sender}', encodeURIComponent(senderId || ''));

    const res = await axios.request({
      url: rendered,
      method: (method || 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET',
      timeout: 15000,
      validateStatus: () => true,
    });
    const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    const httpOk = res.status >= 200 && res.status < 300;
    const regexOk = successRegex ? new RegExp(successRegex).test(body) : true;
    if (!httpOk || !regexOk) throw new Error(`Custom gateway rejected [${res.status}]: ${body.slice(0, 400)}`);
    return { ok: true, raw: { status: res.status, body: body.slice(0, 400) } };
  },
};

export async function sendSms({ phone, message, purpose = 'custom', triggeredBy, relatedOrderId, relatedSubscriptionId }) {
  const [enabled, provider, senderId] = await Promise.all([
    getSetting('notify.sms.enabled'),
    getSetting('notify.sms.provider'),
    getSetting('notify.sms.sender_id'),
  ]);
  if (!enabled) return { ok: false, error: 'sms channel disabled' };

  const key = String(provider || '').toLowerCase();
  const fn = SMS_PROVIDERS[key];
  if (!fn) return { ok: false, error: `unknown sms provider: ${provider}` };

  const to = normalisePhoneForSms(phone);
  if (!to) return { ok: false, error: 'invalid phone' };

  const logId = await logAttempt({
    channel: 'sms', provider: key, target: to, purpose, message,
    triggeredBy, relatedOrderId, relatedSubscriptionId,
  });

  try {
    const out = await fn({ phone: to, message, senderId });
    await finishAttempt(logId, true, null, out.raw ? { raw: typeof out.raw === 'string' ? out.raw.slice(0, 400) : out.raw } : null);
    return { ok: true };
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data).slice(0, 400) : err.message;
    await finishAttempt(logId, false, detail);
    return { ok: false, error: detail };
  }
}

// ============================================================
// Channel status (for Settings / status endpoints)
// ============================================================
export async function channelStatuses() {
  const keys = await Promise.all([
    getSetting('notify.telegram.enabled'),
    getSetting('notify.whatsapp.enabled'),
    getSetting('notify.whatsapp.phone_number_id'),
    getSetting('notify.whatsapp.token'),
    getSetting('notify.sms.enabled'),
    getSetting('notify.sms.provider'),
    getSetting('notify.sms.bulksmsbd.api_key'),
    getSetting('notify.sms.sslwireless.api_token'),
    getSetting('notify.sms.alphasms.api_key'),
    getSetting('notify.sms.mimsms.api_key'),
    getSetting('notify.sms.custom.url_template'),
  ]);
  const [
    telEnabled, waEnabled, waPhoneId, waToken,
    smsEnabled, smsProvider,
    bulk, ssl, alpha, mim, customTpl,
  ] = keys;

  const smsProviderConfigured = (
    (smsProvider === 'bulksmsbd'   && !!bulk) ||
    (smsProvider === 'sslwireless' && !!ssl) ||
    (smsProvider === 'alphasms'    && !!alpha) ||
    (smsProvider === 'mimsms'      && !!mim) ||
    (smsProvider === 'custom'      && !!customTpl)
  );

  return [
    { channel: 'telegram', enabled: !!telEnabled, configured: telegramConfigured(),            provider: 'telegram_bot' },
    { channel: 'whatsapp', enabled: !!waEnabled,  configured: !!(waPhoneId && waToken),         provider: 'meta_cloud' },
    { channel: 'sms',      enabled: !!smsEnabled, configured: !!smsProviderConfigured,          provider: smsProvider || 'custom' },
  ];
}

// ============================================================
// Smart dispatcher — picks the best available channel for a
// given customer and retries down the fallback list.
//
// Priority:
//   1. `prefer` (if supplied by caller)
//   2. Telegram if the customer has a telegram_id and the
//      setting notify.telegram.prefer_for_otp is true (for OTP).
//   3. SMS
//   4. WhatsApp
// ============================================================
export async function notifyCustomer({
  customerId, phone, telegramId, message, purpose = 'custom', prefer, triggeredBy,
  relatedOrderId, relatedSubscriptionId,
}) {
  const statuses = await channelStatuses();
  const on = (c) => statuses.find((s) => s.channel === c && s.enabled && s.configured);

  // Resolve telegram_id if caller passed a customerId.
  let tgId = telegramId;
  if (!tgId && customerId) {
    const row = await db.queryOne('SELECT telegram_id FROM customers WHERE id = ?', [customerId]);
    tgId = row?.telegram_id || null;
  }

  const preferTgForOtp = purpose === 'otp' && !!(await getSetting('notify.telegram.prefer_for_otp'));
  const order = [];
  if (prefer) order.push(prefer);
  if (preferTgForOtp && tgId) order.push('telegram');
  order.push('sms', 'whatsapp', 'telegram');

  const tried = new Set();
  const errors = [];
  for (const ch of order) {
    if (tried.has(ch)) continue;
    tried.add(ch);
    if (!on(ch)) continue;
    if (ch === 'telegram' && !tgId) { errors.push('telegram: no telegram_id'); continue; }
    if ((ch === 'sms' || ch === 'whatsapp') && !phone) { errors.push(`${ch}: no phone`); continue; }

    let res;
    if (ch === 'telegram')   res = await sendTelegram({ customerId, telegramId: tgId, message, purpose, triggeredBy, relatedOrderId, relatedSubscriptionId });
    else if (ch === 'whatsapp') res = await sendWhatsapp({ phone, message, purpose, triggeredBy, relatedOrderId, relatedSubscriptionId });
    else                        res = await sendSms({ phone, message, purpose, triggeredBy, relatedOrderId, relatedSubscriptionId });

    if (res.ok) return { ok: true, channel: ch };
    errors.push(`${ch}: ${res.error}`);
  }

  logger.warn({ errors, purpose, phone, customerId }, 'notifyCustomer — no channel succeeded');
  return { ok: false, error: errors.join(' | ') || 'no channel configured' };
}

export default {
  sendTelegram, sendWhatsapp, sendSms, notifyCustomer, channelStatuses, normalisePhoneForSms,
};
