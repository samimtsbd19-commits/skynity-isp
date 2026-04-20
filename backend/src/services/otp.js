// ============================================================
// OTP service — short-lived numeric codes for portal login
// ------------------------------------------------------------
// Keep the surface tiny. Everything the portal needs is:
//
//   issueOtp({ phone, purpose, ip })  → { ok, channel, ttlSeconds }
//   verifyOtp({ phone, code, purpose }) → { ok, customer, subscriptions }
//
// Security notes:
//   - Rate-limit: max 3 new OTPs per phone per 10 min window
//     (prevents SMS / Telegram bombs).
//   - Max `notify.otp.max_attempts` failed verify attempts per
//     code, after which the row is burned.
//   - Codes are purpose-scoped so an OTP for "login" can't be
//     reused for something else we add later.
//   - We never reveal "phone not registered" — the flow still
//     succeeds silently to avoid phone-number enumeration.
// ============================================================

import db from '../database/pool.js';
import logger from '../utils/logger.js';
import { getSetting } from './settings.js';
import { notifyCustomer, normalisePhoneForSms } from './notifier.js';

function generateCode(length = 6) {
  const min = 10 ** (length - 1);
  const max = 10 ** length;
  return String(Math.floor(min + Math.random() * (max - min)));
}

/** Cleanup expired OTPs — called opportunistically on issue. */
async function cleanup() {
  await db.query('DELETE FROM customer_otps WHERE expires_at < NOW() - INTERVAL 1 HOUR');
}

export async function issueOtp({ phone, purpose = 'login', ip = null }) {
  const enabled = !!(await getSetting('notify.otp.enabled'));
  if (!enabled) return { ok: false, error: 'OTP login is disabled' };

  const clean = normalisePhoneForSms(phone);
  if (!clean) return { ok: false, error: 'invalid phone' };

  // Rate limit: max 3 codes per phone in the last 10 minutes.
  const recent = await db.queryOne(
    `SELECT COUNT(*) AS c FROM customer_otps
      WHERE phone = ? AND purpose = ?
        AND created_at >= NOW() - INTERVAL 10 MINUTE`,
    [clean, purpose]
  );
  if ((recent?.c || 0) >= 3) {
    return { ok: false, error: 'too many OTP requests — please wait 10 minutes' };
  }

  await cleanup();

  const length = Math.max(4, Math.min(8, Number(await getSetting('notify.otp.length')) || 6));
  const ttl = Math.max(60, Math.min(1800, Number(await getSetting('notify.otp.ttl_seconds')) || 300));
  const code = generateCode(length);
  const expiresAt = new Date(Date.now() + ttl * 1000);

  // Identity check is *silent*: if the phone matches no customer,
  // we still issue an OTP to a "ghost" record and let the verify
  // step return nothing. That way we don't leak which phones are
  // registered.
  const customer = await db.queryOne(
    'SELECT id, telegram_id, full_name FROM customers WHERE phone = ?',
    [clean]
  );

  const siteName = (await getSetting('site.name')) || 'Skynity';
  const message =
    `${siteName} OTP: *${code}*\n` +
    `This code expires in ${Math.round(ttl / 60)} minutes. ` +
    `If you did not request this, ignore this message.`;

  const sent = await notifyCustomer({
    customerId: customer?.id,
    phone: clean,
    telegramId: customer?.telegram_id,
    message,
    purpose: 'otp',
  });

  // Even if notifyCustomer failed (e.g. no channel on), we store
  // the code so admins with log access can still hand-deliver it.
  await db.query(
    `INSERT INTO customer_otps (phone, code, channel, purpose, expires_at, ip_address)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [clean, code, sent.channel || 'manual', purpose, expiresAt, ip]
  );

  if (!sent.ok) {
    logger.warn({ phone: clean, purpose, err: sent.error }, 'OTP issued but no channel delivered');
    return {
      ok: false,
      error: 'OTP generated but no notification channel is configured. Ask admin to enable SMS or Telegram.',
    };
  }

  return { ok: true, channel: sent.channel, ttl_seconds: ttl };
}

export async function verifyOtp({ phone, code, purpose = 'login' }) {
  const clean = normalisePhoneForSms(phone);
  if (!clean || !code) return { ok: false, error: 'phone and code required' };

  const maxAttempts = Math.max(3, Math.min(10, Number(await getSetting('notify.otp.max_attempts')) || 5));

  const otp = await db.queryOne(
    `SELECT * FROM customer_otps
       WHERE phone = ? AND purpose = ?
         AND used_at IS NULL
         AND expires_at > NOW()
       ORDER BY id DESC LIMIT 1`,
    [clean, purpose]
  );
  if (!otp) return { ok: false, error: 'no active OTP for this phone — request a new one' };

  if (otp.attempts + 1 > maxAttempts) {
    await db.query('UPDATE customer_otps SET used_at = NOW() WHERE id = ?', [otp.id]);
    return { ok: false, error: 'too many wrong attempts — request a new OTP' };
  }

  if (String(code).trim() !== otp.code) {
    await db.query('UPDATE customer_otps SET attempts = attempts + 1 WHERE id = ?', [otp.id]);
    return { ok: false, error: 'wrong code' };
  }

  await db.query('UPDATE customer_otps SET used_at = NOW() WHERE id = ?', [otp.id]);

  // Look up the customer for this phone.
  const customer = await db.queryOne(
    'SELECT id, full_name, phone, customer_code, telegram_id FROM customers WHERE phone = ?',
    [clean]
  );
  if (!customer) {
    // Verified but not a customer — caller will show "no subs" message.
    return { ok: true, customer: null, subscriptions: [] };
  }

  const subs = await db.query(
    `SELECT s.id, s.login_username, s.login_password, s.starts_at, s.expires_at,
            s.status, s.service_type, s.mt_synced,
            s.mac_address, s.bind_to_mac,
            p.name AS package_name, p.code AS package_code,
            p.rate_down_mbps, p.rate_up_mbps, p.duration_days, p.price
       FROM subscriptions s
       JOIN packages p ON p.id = s.package_id
      WHERE s.customer_id = ?
      ORDER BY s.expires_at DESC`,
    [customer.id]
  );

  return { ok: true, customer, subscriptions: subs };
}

export default { issueOtp, verifyOtp };
