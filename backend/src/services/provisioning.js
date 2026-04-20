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
import logger from '../utils/logger.js';

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
 * Find-or-create a customer record from order data.
 */
export async function findOrCreateCustomer({ full_name, phone, telegram_id, telegram_username }) {
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
    return customer;
  }

  const code = await generateCustomerCode();
  const result = await db.query(
    `INSERT INTO customers (customer_code, full_name, phone, telegram_id, telegram_username, status)
     VALUES (?, ?, ?, ?, ?, 'active')`,
    [code, full_name, phone, telegram_id || null, telegram_username || null]
  );
  return await db.queryOne('SELECT * FROM customers WHERE id = ?', [result.insertId]);
}

/**
 * Approve an order: create customer (if needed), subscription, and push to MikroTik.
 */
export async function approveOrderAndProvision({ orderId, adminId }) {
  const order = await db.queryOne('SELECT * FROM orders WHERE id = ?', [orderId]);
  if (!order) throw new Error('Order not found');
  if (order.status === 'approved') throw new Error('Order already approved');
  if (order.status === 'rejected') throw new Error('Order already rejected');

  const pkg = await db.queryOne('SELECT * FROM packages WHERE id = ?', [order.package_id]);
  if (!pkg) throw new Error('Package not found');

  const router = await db.queryOne(
    'SELECT * FROM mikrotik_routers WHERE is_default = 1 AND is_active = 1 LIMIT 1'
  );
  const routerId = router?.id ?? null;

  // 1) customer
  const customer = await findOrCreateCustomer({
    full_name: order.full_name,
    phone: order.phone,
    telegram_id: order.telegram_id,
  });

  // 2) subscription
  const login = await generateUniqueLogin(pkg.service_type);
  const password = randomPassword(10);

  const now = new Date();
  const expires = new Date(now.getTime() + pkg.duration_days * 24 * 60 * 60 * 1000);

  // subscriptions.router_id is NOT NULL. If no default router exists yet,
  // fall back to any active router; if there's none at all, fall back to
  // the placeholder router created by the initial migration (id=1).
  let useRouterId = routerId;
  if (!useRouterId) {
    const anyRouter = await db.queryOne(
      'SELECT id FROM mikrotik_routers WHERE is_active = 1 ORDER BY id ASC LIMIT 1'
    );
    useRouterId = anyRouter?.id ?? 1;
  }

  const subResult = await db.query(
    `INSERT INTO subscriptions
       (customer_id, package_id, router_id, service_type, login_username, login_password,
        starts_at, expires_at, status, mt_synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', 0)`,
    [customer.id, pkg.id, useRouterId, pkg.service_type, login, password, now, expires]
  );
  const subscriptionId = subResult.insertId;

  // 3) push to MikroTik (best effort — retry later if fails)
  let mtSynced = false;
  let mtError = null;
  try {
    const mt = await getMikrotikClient(routerId);
    const comment = `SKYNITY: ${customer.customer_code} / ${customer.full_name} / pkg=${pkg.code}`;

    if (pkg.service_type === 'pppoe') {
      await mt.createPppSecret({
        name: login,
        password,
        profile: pkg.mikrotik_profile,
        service: 'pppoe',
        comment,
      });
    } else {
      await mt.createHotspotUser({
        name: login,
        password,
        profile: pkg.mikrotik_profile,
        comment,
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

  // 4) finalize order
  await db.query(
    `UPDATE orders
     SET status = 'approved', approved_by = ?, approved_at = NOW(),
         customer_id = ?, subscription_id = ?
     WHERE id = ?`,
    [adminId, customer.id, subscriptionId, orderId]
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
    [adminId, orderId, JSON.stringify({ subscriptionId, mtSynced, mtError })]
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
      package: pkg.name,
      mtSynced,
      mtError,
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

  await db.query(`UPDATE subscriptions SET status = 'expired' WHERE id = ?`, [subscriptionId]);
  return true;
}

export default {
  findOrCreateCustomer,
  approveOrderAndProvision,
  rejectOrder,
  expireSubscription,
};
