// ============================================================
// Customer suspensions
// ------------------------------------------------------------
// Apply / lift temporary or permanent suspensions on a
// customer and all of their active subscriptions.
//
// On apply:
//   1. Write `customer_suspensions` row.
//   2. Set `customers.status = 'suspended' | 'banned'`.
//   3. For every active subscription:
//        * Remember its current status in `status_before_suspension`
//        * Set status to 'suspended' + link to the suspension row
//        * Disable the PPP / Hotspot user on MikroTik
//   4. Optionally notify the customer.
//
// On lift:
//   1. Set `lifted_at` + `lifted_by` on the suspension row.
//   2. Restore each affected subscription to its previous status.
//   3. Re-enable the MikroTik user (only if the sub is still
//      supposed to be active — if it has expired in the meantime
//      we leave it disabled).
//   4. Optionally notify the customer.
//
// Scheduler calls `liftExpired()` every minute so "disable for
// 1 hour" actually lifts on its own.
// ============================================================

import db from '../database/pool.js';
import logger from '../utils/logger.js';
import { getMikrotikClient } from '../mikrotik/client.js';
import { getSetting } from './settings.js';
import notifier from './notifier.js';
import radius from './radius.js';

/** Convert a UI preset (string) to a concrete Date or null (=permanent). */
export function durationToEndsAt(preset, customHours) {
  const now = new Date();
  switch (preset) {
    case '30m':       return new Date(now.getTime() + 30  * 60_000);
    case '1h':        return new Date(now.getTime() + 60  * 60_000);
    case '6h':        return new Date(now.getTime() + 6   * 3600_000);
    case '12h':       return new Date(now.getTime() + 12  * 3600_000);
    case '24h':
    case '1d':        return new Date(now.getTime() + 86400_000);
    case '3d':        return new Date(now.getTime() + 3   * 86400_000);
    case '7d':        return new Date(now.getTime() + 7   * 86400_000);
    case '30d':       return new Date(now.getTime() + 30  * 86400_000);
    case 'permanent': return null;
    case 'custom': {
      const h = Math.max(0.1, Math.min(24 * 365, Number(customHours) || 1));
      return new Date(now.getTime() + h * 3600_000);
    }
    default:          return new Date(now.getTime() + 3600_000); // default 1h
  }
}

// ------------------------------------------------------------
// Apply a suspension
// ------------------------------------------------------------
export async function applySuspension({
  customerId, reason, notes, duration, customHours, adminId,
}) {
  const customer = await db.queryOne('SELECT * FROM customers WHERE id = ?', [customerId]);
  if (!customer) throw new Error('customer not found');

  const endsAt = durationToEndsAt(duration, customHours);
  const isPermanent = endsAt === null ? 1 : 0;

  const ins = await db.query(
    `INSERT INTO customer_suspensions
       (customer_id, reason, notes, ends_at, is_permanent, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [customerId, String(reason || 'Unspecified').slice(0, 100),
     notes || null,
     endsAt ? endsAt.toISOString().slice(0, 19).replace('T', ' ') : null,
     isPermanent, adminId || null]
  );
  const suspensionId = ins.insertId;

  // Flip the customer status. Banned for permanent, suspended otherwise.
  await db.query(
    'UPDATE customers SET status = ? WHERE id = ?',
    [isPermanent ? 'banned' : 'suspended', customerId]
  );

  // Disable every currently-active subscription.
  const subs = await db.query(
    `SELECT * FROM subscriptions
      WHERE customer_id = ? AND status IN ('active')`,
    [customerId]
  );

  let mtOk = true;
  let mtErr = null;
  for (const s of subs) {
    try {
      const mt = await getMikrotikClient(s.router_id);
      if (s.service_type === 'pppoe') {
        const existing = await mt.findPppSecretByName(s.login_username);
        if (existing) await mt.disablePppSecret(existing['.id']);
      } else {
        const existing = await mt.findHotspotUserByName(s.login_username);
        if (existing) await mt.disableHotspotUser(existing['.id']);
      }
      await db.query(
        `UPDATE subscriptions
            SET status_before_suspension = status,
                status = 'suspended',
                suspension_id = ?
          WHERE id = ?`,
        [suspensionId, s.id]
      );
    } catch (err) {
      mtOk = false;
      mtErr = err.message;
      logger.warn({ err: err.message, subscriptionId: s.id }, 'suspension: mikrotik disable failed');
    }

    // RADIUS: block future auth + queue a CoA so any live
    // session is dropped immediately. Non-fatal — RADIUS drift
    // is surfaced via radius_sync_log, not here.
    try {
      if (await radius.isEnabled()) {
        await radius.disableUser(s.login_username, `suspension:${reason || 'n/a'}`);
        await radius.queueDisconnect({
          subscriptionId: s.id,
          username: s.login_username,
          routerId: s.router_id,
          reason: `suspension:${reason || ''}`.slice(0, 100),
        });
      }
    } catch (err) {
      logger.warn({ err: err.message, subscriptionId: s.id }, 'suspension: radius disable failed');
    }
  }

  await db.query(
    `UPDATE customer_suspensions
        SET mt_applied = ?, mt_error = ?
      WHERE id = ?`,
    [mtOk ? 1 : 0, mtErr, suspensionId]
  );

  // Best-effort notification.
  if ((await getSetting('suspension.notify_customer')) !== false
   && (await getSetting('suspension.notify_customer')) !== 'false') {
    try {
      const siteName = (await getSetting('site.name')) || 'Skynity';
      const when = isPermanent
        ? 'permanently'
        : `until ${endsAt.toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' })}`;
      const message = [
        `Hi ${customer.full_name || 'there'},`,
        '',
        `Your ${siteName} account has been ${isPermanent ? 'banned' : 'suspended'} ${when}.`,
        `Reason: ${reason || '—'}`,
        '',
        `If you believe this is a mistake, please contact support.`,
      ].join('\n');
      await notifier.notifyCustomer({
        customerId,
        phone: customer.phone,
        telegramId: customer.telegram_id,
        message,
        purpose: 'suspension',
        triggeredBy: adminId ? String(adminId) : null,
      });
    } catch (err) {
      logger.debug({ err: err.message }, 'suspension notify failed');
    }
  }

  return { ok: true, suspensionId, mtApplied: mtOk, mtError: mtErr, subsAffected: subs.length };
}

// ------------------------------------------------------------
// Lift a specific suspension
// ------------------------------------------------------------
export async function liftSuspension(suspensionId, { adminId, reason } = {}) {
  const sus = await db.queryOne(
    'SELECT * FROM customer_suspensions WHERE id = ?', [suspensionId]
  );
  if (!sus) throw new Error('suspension not found');
  if (sus.lifted_at) return { ok: true, alreadyLifted: true };

  // Re-enable only the subs we actually touched, and only if they
  // would still be "active" today (expires_at in the future).
  const subs = await db.query(
    `SELECT * FROM subscriptions WHERE suspension_id = ?`,
    [suspensionId]
  );
  for (const s of subs) {
    const shouldBeActive = (s.status_before_suspension === 'active') && new Date(s.expires_at) > new Date();
    try {
      const mt = await getMikrotikClient(s.router_id);
      if (s.service_type === 'pppoe') {
        const existing = await mt.findPppSecretByName(s.login_username);
        if (existing && shouldBeActive) await mt.enablePppSecret(existing['.id']);
      } else {
        const existing = await mt.findHotspotUserByName(s.login_username);
        if (existing && shouldBeActive) await mt.enableHotspotUser(existing['.id']);
      }
    } catch (err) {
      logger.warn({ err: err.message, subscriptionId: s.id }, 'lift: mikrotik enable failed');
    }

    // RADIUS: clear the Auth-Type := Reject attr iff the sub
    // is moving back to 'active'. Leave expired subs blocked.
    try {
      if (shouldBeActive && await radius.isEnabled()) {
        await radius.enableUser(s.login_username);
      }
    } catch (err) {
      logger.warn({ err: err.message, subscriptionId: s.id }, 'lift: radius enable failed');
    }

    await db.query(
      `UPDATE subscriptions
          SET status = COALESCE(status_before_suspension, status),
              suspension_id = NULL,
              status_before_suspension = NULL
        WHERE id = ?`,
      [s.id]
    );
  }

  await db.query(
    `UPDATE customer_suspensions
        SET lifted_at = NOW(), lifted_by = ?, lift_reason = ?
      WHERE id = ?`,
    [adminId || null, reason || null, suspensionId]
  );

  // If the customer has no other open suspensions, restore them.
  const other = await db.queryOne(
    `SELECT COUNT(*) AS c FROM customer_suspensions
      WHERE customer_id = ? AND lifted_at IS NULL
        AND (is_permanent = 1 OR ends_at IS NULL OR ends_at > NOW())`,
    [sus.customer_id]
  );
  if (!Number(other?.c)) {
    await db.query(
      `UPDATE customers SET status = 'active' WHERE id = ? AND status IN ('suspended','banned')`,
      [sus.customer_id]
    );
    if ((await getSetting('suspension.notify_customer')) !== false
     && (await getSetting('suspension.notify_customer')) !== 'false') {
      try {
        const customer = await db.queryOne('SELECT * FROM customers WHERE id = ?', [sus.customer_id]);
        const siteName = (await getSetting('site.name')) || 'Skynity';
        await notifier.notifyCustomer({
          customerId: sus.customer_id,
          phone: customer?.phone,
          telegramId: customer?.telegram_id,
          message: `Hi ${customer?.full_name || 'there'},\n\nYour ${siteName} account has been restored. Please reconnect your device.`,
          purpose: 'suspension_lift',
          triggeredBy: adminId ? String(adminId) : null,
        });
      } catch { /* best-effort */ }
    }
  }

  return { ok: true, subsRestored: subs.length };
}

// ------------------------------------------------------------
// Auto-lift every suspension whose `ends_at` has passed.
// Called by the scheduler every minute.
// ------------------------------------------------------------
export async function liftExpired() {
  const due = await db.query(
    `SELECT id FROM customer_suspensions
      WHERE lifted_at IS NULL
        AND is_permanent = 0
        AND ends_at IS NOT NULL
        AND ends_at <= NOW()
      LIMIT 50`
  );
  for (const { id } of due) {
    try {
      await liftSuspension(id, { reason: 'auto: timer expired' });
      logger.info({ suspensionId: id }, 'suspension auto-lifted');
    } catch (err) {
      logger.warn({ err: err.message, suspensionId: id }, 'auto-lift failed');
    }
  }
  return { lifted: due.length };
}

// ------------------------------------------------------------
// Listing / read helpers
// ------------------------------------------------------------
export async function listActiveSuspensions() {
  return db.query(
    `SELECT s.*, c.customer_code, c.full_name, c.phone,
            a.username AS created_by_username
       FROM customer_suspensions s
       JOIN customers c ON c.id = s.customer_id
       LEFT JOIN admins a ON a.id = s.created_by
      WHERE s.lifted_at IS NULL
      ORDER BY s.created_at DESC
      LIMIT 200`
  );
}

export async function listCustomerSuspensions(customerId) {
  return db.query(
    `SELECT s.*, a1.username AS created_by_username, a2.username AS lifted_by_username
       FROM customer_suspensions s
       LEFT JOIN admins a1 ON a1.id = s.created_by
       LEFT JOIN admins a2 ON a2.id = s.lifted_by
      WHERE s.customer_id = ?
      ORDER BY s.created_at DESC`,
    [customerId]
  );
}

export default {
  durationToEndsAt, applySuspension, liftSuspension, liftExpired,
  listActiveSuspensions, listCustomerSuspensions,
};
