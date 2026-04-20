// ============================================================
// Free trial service
// ------------------------------------------------------------
// First-time visitors can claim one free subscription per phone
// (and optionally per MAC). Admin wires up the trial by:
//
//   1) creating a package (e.g. "Trial / 1 Mbps / 7 days")
//   2) setting trial.package_code to that package's code
//   3) turning on feature.free_trial in Settings
//
// activateTrial() is what the portal calls. It:
//   - rejects duplicates (phone already used trial)
//   - creates a customer (reusing any existing one)
//   - creates a subscription with the trial package's profile
//   - pushes it to the least-loaded MikroTik router
//   - records the phone in `trial_used_phones` so the same
//     phone can never claim it again
// ============================================================

import db from '../database/pool.js';
import logger from '../utils/logger.js';
import { getSetting } from './settings.js';
import {
  findOrCreateCustomer,
  pickRouterForNewSubscription,
} from './provisioning.js';
import { getMikrotikClient } from '../mikrotik/client.js';
import { randomUsername, randomPassword } from '../utils/crypto.js';
import { normaliseMac } from '../utils/mac.js';

async function genLogin(serviceType) {
  for (let i = 0; i < 5; i++) {
    const candidate = randomUsername(serviceType === 'pppoe' ? 't' : 'h');
    const existing = await db.queryOne(
      'SELECT id FROM subscriptions WHERE login_username = ? AND service_type = ?',
      [candidate, serviceType]
    );
    if (!existing) return candidate;
  }
  throw new Error('Could not generate unique trial login');
}

export async function isTrialConfigured() {
  const [flag, code] = await Promise.all([
    getSetting('feature.free_trial'),
    getSetting('trial.package_code'),
  ]);
  if (!flag || !code) return { ok: false };
  const pkg = await db.queryOne(
    'SELECT * FROM packages WHERE code = ? AND is_active = 1',
    [String(code).trim()]
  );
  if (!pkg) return { ok: false };
  return { ok: true, pkg };
}

export async function hasPhoneUsedTrial(phone) {
  const row = await db.queryOne('SELECT phone FROM trial_used_phones WHERE phone = ?', [phone]);
  return !!row;
}

/**
 * Create a free-trial subscription. Throws on any misconfig or
 * duplicate-phone attempt. On success returns the subscription
 * plus its login credentials so the portal can show them.
 */
export async function activateTrial({ fullName, phone, mac, ip }) {
  const cfg = await isTrialConfigured();
  if (!cfg.ok) throw new Error('Free trial is not configured');
  const pkg = cfg.pkg;

  const cleanMac = normaliseMac(mac);
  const requireMac = !!(await getSetting('trial.require_mac'));
  if (requireMac && !cleanMac) {
    throw new Error('Please open this page from our WiFi to claim the trial');
  }

  if (await hasPhoneUsedTrial(phone)) {
    throw new Error('This phone number has already used the free trial');
  }

  const days = Math.max(1, Math.min(30, Number(await getSetting('trial.duration_days')) || 7));

  const customer = await findOrCreateCustomer({ full_name: fullName, phone });

  // Extra safety: if the customer already has an active subscription
  // on this package, don't hand them a duplicate trial.
  const existing = await db.queryOne(
    `SELECT id FROM subscriptions
      WHERE customer_id = ? AND package_id = ? AND status = 'active'
      LIMIT 1`,
    [customer.id, pkg.id]
  );
  if (existing) throw new Error('You already have an active subscription on this package');

  const login    = await genLogin(pkg.service_type);
  const password = randomPassword(10);
  const now      = new Date();
  const expires  = new Date(now.getTime() + days * 86400000);
  const useRouterId = await pickRouterForNewSubscription();

  const bindDefault = !!(await getSetting('provisioning.bind_to_mac_default'));
  const bindThis = !!(cleanMac && bindDefault);

  const result = await db.query(
    `INSERT INTO subscriptions
       (customer_id, package_id, router_id, service_type,
        login_username, login_password,
        mac_address, bind_to_mac,
        starts_at, expires_at, status, mt_synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0)`,
    [
      customer.id, pkg.id, useRouterId, pkg.service_type,
      login, password,
      cleanMac, bindThis ? 1 : 0,
      now, expires,
    ]
  );
  const subscriptionId = result.insertId;

  // Record the phone immediately so a parallel request can't
  // race past the uniqueness check. If a downstream step fails
  // the admin can reset the row manually.
  await db.query(
    `INSERT INTO trial_used_phones (phone, customer_id, subscription_id, ip_address, mac_address)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE customer_id = VALUES(customer_id), subscription_id = VALUES(subscription_id)`,
    [phone, customer.id, subscriptionId, ip || null, cleanMac]
  );

  // Push to MikroTik — best effort; retry cron will fix if needed.
  try {
    const mt = await getMikrotikClient(useRouterId);
    const comment = `SKYNITY TRIAL: ${customer.customer_code} / ${customer.full_name}${bindThis ? ` / mac=${cleanMac}` : ''}`;
    if (pkg.service_type === 'pppoe') {
      await mt.createPppSecret({
        name: login, password,
        profile: pkg.mikrotik_profile, service: 'pppoe',
        comment, callerId: bindThis ? cleanMac : undefined,
      });
    } else {
      await mt.createHotspotUser({
        name: login, password,
        profile: pkg.mikrotik_profile, comment,
        macAddress: bindThis ? cleanMac : undefined,
      });
    }
    await db.query(
      'UPDATE subscriptions SET mt_synced = 1, mt_last_sync_at = NOW() WHERE id = ?',
      [subscriptionId]
    );
  } catch (err) {
    logger.warn({ err: err.message, subscriptionId }, 'trial mikrotik push failed (will retry)');
    await db.query('UPDATE subscriptions SET mt_error = ? WHERE id = ?', [err.message, subscriptionId]);
  }

  return {
    subscription_id: subscriptionId,
    login_username: login,
    login_password: password,
    expires_at: expires,
    duration_days: days,
    package: {
      name: pkg.name,
      code: pkg.code,
      rate_down_mbps: pkg.rate_down_mbps,
      rate_up_mbps: pkg.rate_up_mbps,
      service_type: pkg.service_type,
    },
  };
}

export default { isTrialConfigured, hasPhoneUsedTrial, activateTrial };
