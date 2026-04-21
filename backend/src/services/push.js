// ============================================================
// Push notification service
// ------------------------------------------------------------
// Uses Firebase Cloud Messaging (FCM) legacy HTTP API. This is
// the simplest integration:
//   * One server key (system_settings.push.fcm_server_key)
//   * POST https://fcm.googleapis.com/fcm/send
//   * Works for Android, iOS (via APNs bridge), and web push.
//
// If push is disabled or no server key is configured, send()
// becomes a no-op and returns { ok: false, reason: 'disabled' }.
// ============================================================

import axios from 'axios';
import db from '../database/pool.js';
import logger from '../utils/logger.js';
import * as settings from './settings.js';

const FCM_URL = 'https://fcm.googleapis.com/fcm/send';

async function pushEnabled() {
  const enabled = await settings.getSetting('push.enabled');
  const key     = await settings.getSetting('push.fcm_server_key');
  return { enabled: String(enabled) === 'true' && !!key, key };
}

// ------------------------------------------------------------
// Register a device token. Called by the mobile app or web PWA
// after it obtains an FCM token.
// ------------------------------------------------------------
export async function registerToken({
  token, platform, accountId, customerId,
  appVersion, deviceModel, locale,
}) {
  if (!token || typeof token !== 'string' || token.length < 10) {
    throw new Error('invalid token');
  }
  if (!['android', 'ios', 'web'].includes(platform)) {
    throw new Error('invalid platform');
  }

  // Upsert (token is unique). If the same token registers again
  // with a newer customer/account link, we update it.
  await db.query(
    `INSERT INTO push_tokens
       (customer_id, account_id, platform, token, app_version, device_model, locale, last_seen_at, disabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), 0)
     ON DUPLICATE KEY UPDATE
       customer_id  = COALESCE(VALUES(customer_id),  customer_id),
       account_id   = COALESCE(VALUES(account_id),   account_id),
       platform     = VALUES(platform),
       app_version  = VALUES(app_version),
       device_model = VALUES(device_model),
       locale       = VALUES(locale),
       last_seen_at = NOW(),
       disabled     = 0,
       disabled_reason = NULL`,
    [
      customerId || null, accountId || null, platform, token,
      appVersion || null, deviceModel || null, locale || null,
    ]
  );
  return { ok: true };
}

export async function unregisterToken(token) {
  if (!token) return { ok: true };
  await db.query('DELETE FROM push_tokens WHERE token = ?', [token]);
  return { ok: true };
}

// ------------------------------------------------------------
// Fire an FCM send. Accepts either a single token or an array.
// The payload follows the FCM legacy shape:
//   { notification: { title, body, click_action }, data: {...} }
// ------------------------------------------------------------
export async function sendToTokens(tokens, { title, body, data = {}, clickAction } = {}) {
  const list = Array.isArray(tokens) ? tokens.filter(Boolean) : [tokens].filter(Boolean);
  if (!list.length) return { ok: false, reason: 'no tokens' };

  const { enabled, key } = await pushEnabled();
  if (!enabled) return { ok: false, reason: 'disabled' };

  const notification = { title, body };
  if (clickAction) notification.click_action = clickAction;

  // FCM legacy accepts up to 1000 registration_ids per request.
  const chunks = [];
  for (let i = 0; i < list.length; i += 900) chunks.push(list.slice(i, i + 900));

  const results = [];
  for (const chunk of chunks) {
    try {
      const { data: resp } = await axios.post(
        FCM_URL,
        { registration_ids: chunk, notification, data, priority: 'high' },
        {
          headers: {
            Authorization: `key=${key}`,
            'Content-Type': 'application/json',
          },
          timeout: 8000,
        }
      );
      results.push(resp);

      // FCM returns per-token results; prune tokens that came
      // back as `NotRegistered` / `InvalidRegistration` so we
      // don't keep retrying dead installs.
      if (Array.isArray(resp.results)) {
        const bad = [];
        resp.results.forEach((r, idx) => {
          if (r.error === 'NotRegistered' || r.error === 'InvalidRegistration') {
            bad.push(chunk[idx]);
          }
        });
        if (bad.length) {
          await db.query(
            `UPDATE push_tokens SET disabled = 1, disabled_reason = ? WHERE token IN (${bad.map(() => '?').join(',')})`,
            ['fcm-rejected', ...bad]
          );
        }
      }
    } catch (err) {
      logger.warn({ err: err.message }, 'FCM send failed');
      results.push({ error: err.message });
    }
  }
  return { ok: true, results };
}

// ------------------------------------------------------------
// Helpers that look up tokens for you.
// ------------------------------------------------------------
export async function sendToCustomer(customerId, payload) {
  const rows = await db.query(
    'SELECT token FROM push_tokens WHERE customer_id = ? AND disabled = 0',
    [customerId]
  );
  return sendToTokens(rows.map((r) => r.token), payload);
}

export async function sendToAll(payload, audienceSql = '') {
  const rows = await db.query(
    `SELECT token FROM push_tokens WHERE disabled = 0 ${audienceSql ? `AND ${audienceSql}` : ''}`
  );
  return sendToTokens(rows.map((r) => r.token), payload);
}

export async function listTokens({ customerId } = {}) {
  const params = [];
  let where = 'WHERE 1=1';
  if (customerId) { where += ' AND customer_id = ?'; params.push(customerId); }
  return db.query(
    `SELECT id, customer_id, account_id, platform, app_version, device_model,
            locale, last_seen_at, disabled, disabled_reason, created_at
     FROM push_tokens ${where} ORDER BY last_seen_at DESC`,
    params
  );
}

export default {
  registerToken, unregisterToken, sendToTokens, sendToCustomer, sendToAll, listTokens, pushEnabled,
};
