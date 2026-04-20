// ============================================================
// Scheduled jobs
// ------------------------------------------------------------
// - Every 5 min: retry unsynced subscriptions on MikroTik
// - Every 15 min: expire subscriptions past their date
// - Every hour: refresh last-seen/usage from MikroTik
// ============================================================

import cron from 'node-cron';
import db from '../database/pool.js';
import { expireSubscription } from '../services/provisioning.js';
import { getMikrotikClient } from '../mikrotik/client.js';
import logger from '../utils/logger.js';

async function retryUnsyncedSubs() {
  const subs = await db.query(
    `SELECT * FROM subscriptions WHERE mt_synced = 0 AND status = 'active' LIMIT 50`
  );
  for (const s of subs) {
    try {
      const mt = await getMikrotikClient(s.router_id);
      const pkg = await db.queryOne('SELECT * FROM packages WHERE id = ?', [s.package_id]);
      const customer = await db.queryOne('SELECT * FROM customers WHERE id = ?', [s.customer_id]);
      const comment = `SKYNITY: ${customer.customer_code} / ${customer.full_name} / pkg=${pkg.code}`;

      if (s.service_type === 'pppoe') {
        const existing = await mt.findPppSecretByName(s.login_username);
        if (!existing) {
          await mt.createPppSecret({
            name: s.login_username,
            password: s.login_password,
            profile: pkg.mikrotik_profile,
            service: 'pppoe',
            comment,
          });
        }
      } else {
        const existing = await mt.findHotspotUserByName(s.login_username);
        if (!existing) {
          await mt.createHotspotUser({
            name: s.login_username,
            password: s.login_password,
            profile: pkg.mikrotik_profile,
            comment,
          });
        }
      }
      await db.query(
        `UPDATE subscriptions SET mt_synced = 1, mt_last_sync_at = NOW(), mt_error = NULL WHERE id = ?`,
        [s.id]
      );
      logger.info({ subscriptionId: s.id }, 'retry sync ok');
    } catch (err) {
      logger.warn({ err: err.message, subscriptionId: s.id }, 'retry sync failed');
      await db.query(`UPDATE subscriptions SET mt_error = ? WHERE id = ?`, [err.message, s.id]);
    }
  }
}

async function expireDueSubs() {
  const due = await db.query(
    `SELECT id FROM subscriptions WHERE status = 'active' AND expires_at <= NOW() LIMIT 100`
  );
  for (const { id } of due) {
    try {
      await expireSubscription(id);
      logger.info({ subscriptionId: id }, 'expired');
    } catch (err) {
      logger.error({ err, subscriptionId: id }, 'expire failed');
    }
  }
}

async function refreshLastSeen() {
  // Try each distinct router
  const routers = await db.query(
    `SELECT DISTINCT router_id FROM subscriptions WHERE status = 'active'`
  );
  for (const { router_id } of routers) {
    try {
      const mt = await getMikrotikClient(router_id);
      const [pppActive, hsActive, leases] = await Promise.all([
        mt.listPppActive().catch(() => []),
        mt.listHotspotActive().catch(() => []),
        mt.listDhcpLeases().catch(() => []),
      ]);

      for (const a of pppActive) {
        await db.query(
          `UPDATE subscriptions
           SET last_seen_at = NOW(), last_ip = ?
           WHERE login_username = ? AND service_type = 'pppoe' AND router_id = ?`,
          [a.address || null, a.name, router_id]
        );
      }
      for (const a of hsActive) {
        await db.query(
          `UPDATE subscriptions
           SET last_seen_at = NOW(), last_ip = ?, last_mac = ?
           WHERE login_username = ? AND service_type = 'hotspot' AND router_id = ?`,
          [a.address || null, a['mac-address'] || null, a.user, router_id]
        );
      }
      logger.info({ router_id, ppp: pppActive.length, hs: hsActive.length }, 'monitoring refreshed');
    } catch (err) {
      logger.error({ err: err.message, router_id }, 'monitoring refresh failed');
    }
  }
}

export function startJobs() {
  cron.schedule('*/5 * * * *', () => retryUnsyncedSubs().catch((e) => logger.error({ e }, 'retry job')));
  cron.schedule('*/15 * * * *', () => expireDueSubs().catch((e) => logger.error({ e }, 'expire job')));
  cron.schedule('0 * * * *', () => refreshLastSeen().catch((e) => logger.error({ e }, 'monitor job')));
  logger.info('cron jobs scheduled');
}

export default { startJobs };
