// ============================================================
// Provisioning Service
// ------------------------------------------------------------
// Turns an approved order into:
//   1. A customer record (if new)
//   2. A subscription row in DB
//   3. An actual login user on MikroTik (PPPoE secret or Hotspot user)
//
// If MikroTik push fails, we mark mt_synced=0 and keep the DB
// record so the cron retry job can fix it later. This means
// the admin can confirm payment even if router is offline.
// ============================================================

import db from '../database/pool.js';
import { getMikrotikClient } from '../mikrotik/client.js';
import { randomUsername, randomPassword } from '../utils/crypto.js';
import { normaliseMac } from '../utils/mac.js';
import { getSetting } from './settings.js';
import radius from './radius.js';
import logger from '../utils/logger.js';

// Helper — push a subscription to RADIUS if the feature flag is on.
// Never throws: RADIUS drift is surfaced via radius_sync_log +
// subscriptions.radius_error, not via provisioning failures.
async function syncToRadius(subscription, pkg, action) {
  try {
    if (!(await radius.isEnabled())) return;
    if (action === 'upsert') {
      await radius.upsertUser(subscription, { pkg });
    } else if (action === 'disable') {
      await radius.disableUser(subscription.login_username, 'expired');
      await radius.queueDisconnect({
        subscriptionId: subscription.id,
        username: subscription.login_username,
        routerId: subscription.router_id,
        reason: 'expired',
      });
    } else if (action === 'enable') {
      await radius.enableUser(subscription.login_username);
    } else if (action === 'delete') {
      await radius.deleteUser(subscription.login_username);
    }
  } catch (err) {
    logger.warn({ err: err.message, subId: subscription.id, action }, 'radius sync failed (non-fatal)');
  }
}

async function generateCustomerCode() {
  const row = await db.queryOne('SELECT COUNT(*) AS c FROM customers');
  const n = (row?.c || 0) + 1;
  return `SKY-${String(n).padStart(5, '0')}`;
}

async function generateUniqueLogin(serviceType) {
  // Keep trying until unique across DB
  for (let i = 0; i < 5; i++) {
    const candidate = randomUsername(serviceType === 'pppoe' ? 'p' : 'h');
    const existing = await db.queryOne(
      'SELECT id FROM subscriptions WHERE login_username = ? AND service_type = ?',
      [candidate, serviceType]
    );
    if (!existing) return candidate;
  }
  throw new Error('Could not generate unique login after 5 tries');
}

/**
 * Pick which MikroTik router a brand-new subscription should
 * land on. Behaviour depends on the `provisioning.load_balance`
 * (or legacy `feature.load_balance_routers`) setting:
 *
 *   disabled: use the router flagged `is_default`; fall back to
 *             any active one; fall back to id=1 if the DB is
 *             completely empty (`subscriptions.router_id` is
 *             NOT NULL so we always need *something*).
 *
 *   enabled:  pick the active router with the fewest active
 *             subscriptions right now — a simple "least-loaded"
 *             strategy that works well for small ISPs without
 *             needing live RouterOS polling on every order.
 */
export async function pickRouterForNewSubscription() {
  const lb =
    !!(await getSetting('provisioning.load_balance')) ||
    !!(await getSetting('feature.load_balance_routers'));

  if (lb) {
    const row = await db.queryOne(
      `SELECT r.id
         FROM mikrotik_routers r
         LEFT JOIN (
           SELECT router_id, COUNT(*) AS c
             FROM subscriptions
            WHERE status = 'active'
            GROUP BY router_id
         ) s ON s.router_id = r.id
        WHERE r.is_active = 1
        ORDER BY COALESCE(s.c, 0) ASC, r.id ASC
        LIMIT 1`
    );
    if (row?.id) return row.id;
  }

  const def = await db.queryOne(
    'SELECT id FROM mikrotik_routers WHERE is_default = 1 AND is_active = 1 LIMIT 1'
  );
  if (def?.id) return def.id;

  const any = await db.queryOne(
    'SELECT id FROM mikrotik_routers WHERE is_active = 1 ORDER BY id ASC LIMIT 1'
  );
  return any?.id ?? 1;
}

/**
 * Find-or-create a customer record from order data.
 */
export async function findOrCreateCustomer({ full_name, phone, telegram_id, telegram_username, resellerId = null }) {
  // prefer phone as the unique key
  let customer = await db.queryOne('SELECT * FROM customers WHERE phone = ?', [phone]);
  if (customer) {
    // backfill telegram_id if missing
    if (telegram_id && !customer.telegram_id) {
      await db.query(
        'UPDATE customers SET telegram_id = ?, telegram_username = ? WHERE id = ?',
        [telegram_id, telegram_username || null, customer.id]
      );
    }
    if (resellerId && !customer.reseller_id) {
      await db.query(
        'UPDATE customers SET reseller_id = COALESCE(reseller_id, ?) WHERE id = ?',
        [resellerId, customer.id]
      );
      customer = await db.queryOne('SELECT * FROM customers WHERE id = ?', [customer.id]);
    }
    return customer;
  }

  const code = await generateCustomerCode();
  const result = await db.query(
    `INSERT INTO customers (customer_code, full_name, phone, telegram_id, telegram_username, status, reseller_id)
     VALUES (?, ?, ?, ?, ?, 'active', ?)`,
    [code, full_name, phone, telegram_id || null, telegram_username || null, resellerId]
  );
  return await db.queryOne('SELECT * FROM customers WHERE id = ?', [result.insertId]);
}

/**
 * Approve an order: create customer (if needed), subscription, and push to MikroTik.
 *
 * Handles two flavours:
 *   - NEW:      order.renewal_of_subscription_id is null → creates a
 *               fresh subscription with a new username/password.
 *   - RENEWAL:  order.renewal_of_subscription_id is set  → extends the
 *               existing subscription's `expires_at` and flips status
 *               back to 'active'. Credentials are preserved so the
 *               customer doesn't need to reconfigure anything.
 */
export async function approveOrderAndProvision({ orderId, admin }) {
  const adminId = admin?.id ?? null;
  const resellerStamp = admin?.role === 'reseller' ? adminId : null;

  const order = await db.queryOne('SELECT * FROM orders WHERE id = ?', [orderId]);
  if (!order) throw new Error('Order not found');
  if (order.status === 'approved') throw new Error('Order already approved');
  if (order.status === 'rejected') throw new Error('Order already rejected');

  const pkg = await db.queryOne('SELECT * FROM packages WHERE id = ?', [order.package_id]);
  if (!pkg) throw new Error('Package not found');

  const orderMac = normaliseMac(order.mac_address);
  const bindDefault = !!(await getSetting('provisioning.bind_to_mac_default'));

  // ---- Renewal branch --------------------------------------------------
  if (order.renewal_of_subscription_id) {
    return await approveRenewal({ order, pkg, adminId, orderMac, resellerStamp });
  }

  // ---- Fresh-subscription branch --------------------------------------
  const useRouterId = await pickRouterForNewSubscription();

  const customer = await findOrCreateCustomer({
    full_name: order.full_name,
    phone: order.phone,
    telegram_id: order.telegram_id,
    resellerId: resellerStamp,
  });

  const login = await generateUniqueLogin(pkg.service_type);
  const password = randomPassword(10);

  const now = new Date();
  const expires = new Date(now.getTime() + pkg.duration_days * 24 * 60 * 60 * 1000);

  const bindThis = !!(orderMac && bindDefault);

  const subResult = await db.query(
    `INSERT INTO subscriptions
       (customer_id, package_id, router_id, service_type, login_username, login_password,
        mac_address, bind_to_mac,
        starts_at, expires_at, status, mt_synced, reseller_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, ?)`,
    [
      customer.id, pkg.id, useRouterId, pkg.service_type, login, password,
      orderMac, bindThis ? 1 : 0,
      now, expires,
      resellerStamp,
    ]
  );
  const subscriptionId = subResult.insertId;

  // 3) push to MikroTik (best effort — retry later if fails)
  let mtSynced = false;
  let mtError = null;
  try {
    const mt = await getMikrotikClient(useRouterId);
    const comment = `SKYNITY: ${customer.customer_code} / ${customer.full_name} / pkg=${pkg.code}${bindThis ? ` / mac=${orderMac}` : ''}`;

    if (pkg.service_type === 'pppoe') {
      await mt.createPppSecret({
        name: login,
        password,
        profile: pkg.mikrotik_profile,
        service: 'pppoe',
        comment,
        callerId: bindThis ? orderMac : undefined,
      });
    } else {
      await mt.createHotspotUser({
        name: login,
        password,
        profile: pkg.mikrotik_profile,
        comment,
        macAddress: bindThis ? orderMac : undefined,
      });
    }
    mtSynced = true;
  } catch (err) {
    mtError = err.message;
    logger.error({ err, orderId, subscriptionId }, 'mikrotik provisioning failed, will retry');
  }

  await db.query(
    `UPDATE subscriptions
     SET mt_synced = ?, mt_last_sync_at = NOW(), mt_error = ?
     WHERE id = ?`,
    [mtSynced ? 1 : 0, mtError, subscriptionId]
  );

  // 3b) push to RADIUS (feature-flagged — no-op when disabled)
  const freshSub = await db.queryOne('SELECT * FROM subscriptions WHERE id = ?', [subscriptionId]);
  await syncToRadius(freshSub, pkg, 'upsert');

  // 4) finalize order
  await db.query(
    `UPDATE orders
     SET status = 'approved', approved_by = ?, approved_at = NOW(),
         customer_id = ?, subscription_id = ?,
         reseller_id = COALESCE(reseller_id, ?)
     WHERE id = ?`,
    [adminId, customer.id, subscriptionId, resellerStamp, orderId]
  );

  // also mark payment as verified
  await db.query(
    `UPDATE payments SET status = 'verified', verified_by = ?, verified_at = NOW()
     WHERE order_id = ? AND status = 'pending'`,
    [adminId, orderId]
  );

  await db.query(
    `INSERT INTO activity_log (actor_type, actor_id, action, entity_type, entity_id, meta)
     VALUES ('admin', ?, 'order_approved', 'order', ?, ?)`,
    [adminId, orderId, JSON.stringify({ subscriptionId, mtSynced, mtError, mac: orderMac, bind: bindThis })]
  );

  return {
    order,
    customer,
    subscription: {
      id: subscriptionId,
      login_username: login,
      login_password: password,
      starts_at: now,
      expires_at: expires,
      service_type: pkg.service_type,
      mac_address: orderMac,
      bind_to_mac: bindThis,
      package: pkg.name,
      mtSynced,
      mtError,
    },
  };
}

/**
 * Approve a renewal order: extend an existing subscription and
 * bring it back to 'active'. We reuse the same MikroTik user, just
 * re-enable it in case it was disabled by the expiry cron.
 */
async function approveRenewal({ order, pkg, adminId, orderMac, resellerStamp = null }) {
  const sub = await db.queryOne(
    'SELECT * FROM subscriptions WHERE id = ?',
    [order.renewal_of_subscription_id]
  );
  if (!sub) throw new Error('original subscription not found for renewal');

  const customer = await db.queryOne('SELECT * FROM customers WHERE id = ?', [sub.customer_id]);

  // Extend from max(now, current expiry): if they renew a day before
  // expiry we still give them the full package duration on top.
  const now = new Date();
  const base = sub.expires_at && new Date(sub.expires_at) > now ? new Date(sub.expires_at) : now;
  const newExpires = new Date(base.getTime() + pkg.duration_days * 24 * 60 * 60 * 1000);

  // If the customer bought a different package this time, update the
  // package_id + service_type so reports reflect reality.
  const packageChanged = sub.package_id !== pkg.id;
  const newMac = orderMac || sub.mac_address;

  await db.query(
    `UPDATE subscriptions
       SET expires_at = ?,
           status     = 'active',
           package_id = ?,
           service_type = ?,
           mac_address = COALESCE(?, mac_address)
     WHERE id = ?`,
    [newExpires, pkg.id, pkg.service_type, newMac, sub.id]
  );

  // Flip the MikroTik user back on and update profile if needed.
  let mtSynced = false;
  let mtError  = null;
  try {
    const mt = await getMikrotikClient(sub.router_id);
    if (sub.service_type === 'pppoe') {
      const sec = await mt.findPppSecretByName(sub.login_username);
      if (sec) {
        await mt.patch(`/ppp/secret/${encodeURIComponent(sec['.id'])}`, {
          disabled: 'false',
          profile: pkg.mikrotik_profile,
          ...(newMac && sub.bind_to_mac ? { 'caller-id': newMac } : {}),
        });
      } else {
        // Edge case: secret was deleted on router — recreate.
        await mt.createPppSecret({
          name: sub.login_username,
          password: sub.login_password,
          profile: pkg.mikrotik_profile,
          service: 'pppoe',
          comment: `SKYNITY: ${customer?.customer_code || ''} / renewal pkg=${pkg.code}`,
          callerId: newMac && sub.bind_to_mac ? newMac : undefined,
        });
      }
    } else {
      const user = await mt.findHotspotUserByName(sub.login_username);
      if (user) {
        await mt.patch(`/ip/hotspot/user/${encodeURIComponent(user['.id'])}`, {
          disabled: 'false',
          profile: pkg.mikrotik_profile,
          ...(newMac && sub.bind_to_mac ? { 'mac-address': newMac } : {}),
        });
      } else {
        await mt.createHotspotUser({
          name: sub.login_username,
          password: sub.login_password,
          profile: pkg.mikrotik_profile,
          comment: `SKYNITY: ${customer?.customer_code || ''} / renewal pkg=${pkg.code}`,
          macAddress: newMac && sub.bind_to_mac ? newMac : undefined,
        });
      }
    }
    mtSynced = true;
  } catch (err) {
    mtError = err.message;
    logger.error({ err, subId: sub.id }, 'mikrotik renewal push failed, will retry');
  }

  await db.query(
    'UPDATE subscriptions SET mt_synced = ?, mt_last_sync_at = NOW(), mt_error = ? WHERE id = ?',
    [mtSynced ? 1 : 0, mtError, sub.id]
  );

  // Push refreshed subscription (new expiry, maybe new profile)
  // to FreeRADIUS. Re-enables the user if they'd been marked
  // reject during a previous expiry.
  const refreshed = await db.queryOne('SELECT * FROM subscriptions WHERE id = ?', [sub.id]);
  await syncToRadius(refreshed, pkg, 'upsert');
  await syncToRadius(refreshed, pkg, 'enable');

  if (resellerStamp) {
    await db.query(
      'UPDATE subscriptions SET reseller_id = COALESCE(reseller_id, ?) WHERE id = ?',
      [resellerStamp, sub.id]
    );
    await db.query(
      'UPDATE customers SET reseller_id = COALESCE(reseller_id, ?) WHERE id = ?',
      [resellerStamp, sub.customer_id]
    );
  }

  await db.query(
    `UPDATE orders
       SET status = 'approved', approved_by = ?, approved_at = NOW(),
           customer_id = ?, subscription_id = ?,
           reseller_id = COALESCE(reseller_id, ?)
     WHERE id = ?`,
    [adminId, sub.customer_id, sub.id, resellerStamp, order.id]
  );

  await db.query(
    `UPDATE payments SET status = 'verified', verified_by = ?, verified_at = NOW()
     WHERE order_id = ? AND status = 'pending'`,
    [adminId, order.id]
  );

  await db.query(
    `INSERT INTO activity_log (actor_type, actor_id, action, entity_type, entity_id, meta)
     VALUES ('admin', ?, 'order_renewed', 'subscription', ?, ?)`,
    [adminId, String(sub.id), JSON.stringify({
      order_id: order.id, new_expires: newExpires, package_changed: packageChanged, mtSynced, mtError,
    })]
  );

  return {
    order,
    customer,
    subscription: {
      id: sub.id,
      login_username: sub.login_username,
      login_password: sub.login_password,
      starts_at: sub.starts_at,
      expires_at: newExpires,
      service_type: pkg.service_type,
      package: pkg.name,
      mac_address: newMac,
      bind_to_mac: !!sub.bind_to_mac,
      mtSynced,
      mtError,
      renewed: true,
    },
  };
}

export async function rejectOrder({ orderId, adminId, reason }) {
  const order = await db.queryOne('SELECT * FROM orders WHERE id = ?', [orderId]);
  if (!order) throw new Error('Order not found');
  if (order.status === 'approved') throw new Error('Already approved');

  await db.query(
    `UPDATE orders SET status = 'rejected', approved_by = ?, approved_at = NOW(), rejected_reason = ?
     WHERE id = ?`,
    [adminId, reason || null, orderId]
  );
  await db.query(
    `UPDATE payments SET status = 'rejected', verified_by = ?, verified_at = NOW(), reject_reason = ?
     WHERE order_id = ? AND status = 'pending'`,
    [adminId, reason || null, orderId]
  );
  await db.query(
    `INSERT INTO activity_log (actor_type, actor_id, action, entity_type, entity_id, meta)
     VALUES ('admin', ?, 'order_rejected', 'order', ?, ?)`,
    [adminId, orderId, JSON.stringify({ reason })]
  );

  return order;
}

/**
 * Expire-suspend a subscription: disable on MikroTik and mark expired.
 */
export async function expireSubscription(subscriptionId) {
  const sub = await db.queryOne('SELECT * FROM subscriptions WHERE id = ?', [subscriptionId]);
  if (!sub) return false;

  try {
    const mt = await getMikrotikClient(sub.router_id);
    if (sub.service_type === 'pppoe') {
      const sec = await mt.findPppSecretByName(sub.login_username);
      if (sec) await mt.disablePppSecret(sec['.id']);
      // also kick active session
      const active = await mt.listPppActive();
      const live = active.find((a) => a.name === sub.login_username);
      if (live) await mt.disconnectPppActive(live['.id']);
    } else {
      const user = await mt.findHotspotUserByName(sub.login_username);
      if (user) await mt.disableHotspotUser(user['.id']);
    }
  } catch (err) {
    logger.error({ err, subscriptionId }, 'failed to disable on mikrotik during expiry');
  }

  // RADIUS: block future auth + kick any live session
  await syncToRadius(sub, null, 'disable');

  await db.query(`UPDATE subscriptions SET status = 'expired' WHERE id = ?`, [subscriptionId]);
  return true;
}

/**
 * Admin manually extends a subscription by N days.
 * - If expired: reactivates and sets expiry = now + days
 * - If active:  extends from current expiry + days
 * - Re-enables user on MikroTik if it was disabled.
 */
export async function extendSubscription(subscriptionId, days, note = '') {
  const sub = await db.queryOne(
    `SELECT s.*, p.mikrotik_profile, p.code AS pkg_code,
            c.customer_code, c.full_name
       FROM subscriptions s
       JOIN packages p ON p.id = s.package_id
       JOIN customers c ON c.id = s.customer_id
      WHERE s.id = ?`,
    [subscriptionId]
  );
  if (!sub) throw new Error('Subscription not found');

  const now = new Date();
  const base = sub.status === 'active' && sub.expires_at && new Date(sub.expires_at) > now
    ? new Date(sub.expires_at)
    : now;
  const newExpires = new Date(base.getTime() + days * 24 * 60 * 60 * 1000);

  await db.query(
    `UPDATE subscriptions SET expires_at = ?, status = 'active', mt_synced = 0 WHERE id = ?`,
    [newExpires, subscriptionId]
  );

  // Re-enable on MikroTik (best-effort)
  let mtSynced = false;
  let mtError = null;
  try {
    const mt = await getMikrotikClient(sub.router_id);
    if (sub.service_type === 'pppoe') {
      const sec = await mt.findPppSecretByName(sub.login_username);
      if (sec) {
        await mt.patch(`/ppp/secret/${encodeURIComponent(sec['.id'])}`, {
          disabled: 'false',
          profile: sub.mikrotik_profile,
        });
      } else {
        await mt.createPppSecret({
          name: sub.login_username,
          password: sub.login_password,
          profile: sub.mikrotik_profile,
          service: 'pppoe',
          comment: `SKYNITY: ${sub.customer_code} / ${sub.full_name} / extended`,
        });
      }
    } else {
      const user = await mt.findHotspotUserByName(sub.login_username);
      if (user) {
        await mt.patch(`/ip/hotspot/user/${encodeURIComponent(user['.id'])}`, {
          disabled: 'false',
          profile: sub.mikrotik_profile,
        });
      }
    }
    mtSynced = true;
    await db.query(
      `UPDATE subscriptions SET mt_synced = 1, mt_last_sync_at = NOW(), mt_error = NULL WHERE id = ?`,
      [subscriptionId]
    );
  } catch (err) {
    mtError = err.message;
    logger.warn({ err: err.message, subscriptionId }, 'extend: mikrotik re-enable failed');
  }

  // RADIUS: re-push with new expiry + remove any reject attr.
  {
    const fresh = await db.queryOne('SELECT * FROM subscriptions WHERE id = ?', [subscriptionId]);
    const pkg   = await db.queryOne('SELECT * FROM packages WHERE id = ?', [sub.package_id]);
    await syncToRadius(fresh, pkg, 'upsert');
    await syncToRadius(fresh, pkg, 'enable');
  }

  logger.info(
    { subscriptionId, days, newExpires, mtSynced, note },
    'subscription extended by admin'
  );

  return { ok: true, new_expires_at: newExpires, mt_synced: mtSynced, mt_error: mtError };
}

export default {
  findOrCreateCustomer,
  approveOrderAndProvision,
  rejectOrder,
  expireSubscription,
  extendSubscription,
};
