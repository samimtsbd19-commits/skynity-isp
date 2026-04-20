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
import { getSetting } from '../services/settings.js';
import notifier from '../services/notifier.js';
import monitoring from '../services/monitoring.js';
import health from '../services/health.js';
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
  const routers = await db.query(
    `SELECT DISTINCT router_id FROM subscriptions WHERE status = 'active'`
  );
  for (const { router_id } of routers) {
    try {
      const mt = await getMikrotikClient(router_id);
      const [pppActive, hsActive] = await Promise.all([
        mt.listPppActive().catch(() => []),
        mt.listHotspotActive().catch(() => []),
      ]);

      for (const a of pppActive) {
        const subs = await db.query(
          `SELECT id FROM subscriptions
            WHERE login_username = ? AND service_type = 'pppoe' AND router_id = ?`,
          [a.name, router_id]
        );
        for (const s of subs) {
          await db.query(
            `UPDATE subscriptions SET last_seen_at = NOW(), last_ip = ? WHERE id = ?`,
            [a.address || null, s.id]
          );
          await snapshotUsage(s.id, router_id, 'pppoe', a);
        }
      }
      for (const a of hsActive) {
        const subs = await db.query(
          `SELECT id FROM subscriptions
            WHERE login_username = ? AND service_type = 'hotspot' AND router_id = ?`,
          [a.user, router_id]
        );
        for (const s of subs) {
          await db.query(
            `UPDATE subscriptions SET last_seen_at = NOW(), last_ip = ?, last_mac = ? WHERE id = ?`,
            [a.address || null, a['mac-address'] || null, s.id]
          );
          await snapshotUsage(s.id, router_id, 'hotspot', a);
        }
      }
      logger.info({ router_id, ppp: pppActive.length, hs: hsActive.length }, 'monitoring refreshed');
    } catch (err) {
      logger.error({ err: err.message, router_id }, 'monitoring refresh failed');
    }
  }
}

/**
 * Record one usage snapshot for a subscription and accumulate its
 * lifetime bytes counters. We store both the raw cumulative counter
 * (from RouterOS) and the delta since the previous snapshot — the
 * delta is what the daily chart aggregates by.
 */
async function snapshotUsage(subscriptionId, routerId, serviceType, active) {
  const cumIn  = toBigInt(active['bytes-in']);
  const cumOut = toBigInt(active['bytes-out']);
  if (cumIn === null && cumOut === null) return; // nothing useful

  // Find the most recent snapshot for this subscription within the
  // last 2 hours. Beyond that we treat as a fresh session.
  const prev = await db.queryOne(
    `SELECT cum_in, cum_out, taken_at FROM usage_snapshots
      WHERE subscription_id = ? AND taken_at > NOW() - INTERVAL 2 HOUR
      ORDER BY id DESC LIMIT 1`,
    [subscriptionId]
  );

  let deltaIn = 0n, deltaOut = 0n;
  const cIn  = cumIn  ?? 0n;
  const cOut = cumOut ?? 0n;
  if (prev) {
    const pIn  = BigInt(prev.cum_in  || 0);
    const pOut = BigInt(prev.cum_out || 0);
    deltaIn  = cIn  >= pIn  ? cIn  - pIn  : cIn;   // counter reset → bank the whole new value
    deltaOut = cOut >= pOut ? cOut - pOut : cOut;
  } else {
    // First snapshot of a session — don't bank the cumulative value
    // as "today's usage" (we don't actually know when the session
    // started). Start the odometer here.
    deltaIn  = 0n;
    deltaOut = 0n;
  }

  await db.query(
    `INSERT INTO usage_snapshots (subscription_id, router_id, service_type, cum_in, cum_out, delta_in, delta_out)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [subscriptionId, routerId, serviceType, cIn.toString(), cOut.toString(), deltaIn.toString(), deltaOut.toString()]
  );

  // Maintain the running counters on the subscription row itself
  // so the old /stats endpoints keep working without a join.
  if (deltaIn > 0n || deltaOut > 0n) {
    await db.query(
      `UPDATE subscriptions
          SET bytes_in  = bytes_in  + ?,
              bytes_out = bytes_out + ?
        WHERE id = ?`,
      [deltaIn.toString(), deltaOut.toString(), subscriptionId]
    );
  }
}

function toBigInt(v) {
  if (v == null) return null;
  try { return BigInt(String(v)); } catch { return null; }
}

/** Prune snapshots older than 180 days to keep the table small. */
async function pruneUsageSnapshots() {
  try {
    const r = await db.query(
      `DELETE FROM usage_snapshots WHERE taken_at < NOW() - INTERVAL 180 DAY LIMIT 10000`
    );
    if (r.affectedRows) logger.info({ pruned: r.affectedRows }, 'usage_snapshots pruned');
  } catch (err) {
    logger.warn({ err: err.message }, 'usage prune failed');
  }
}

// ============================================================
// Auto-expiry reminders
// ------------------------------------------------------------
// Runs once a day (08:00 Asia/Dhaka by default) and walks every
// active subscription that will expire within the next N days.
// "N days" comes from the `notify.expiry.days_before` setting —
// a comma list like "3,1,0". For each matching step we deliver
// one reminder via the notifier (respecting all channel toggles
// and the customer's preferred channel) and record the step in
// `last_expiry_notified_days` so we never re-send the same one.
// ============================================================
async function sendExpiryReminders() {
  const enabledFeature = !!(await getSetting('feature.expiry_reminders'));
  const enabledNotify  = !!(await getSetting('notify.expiry.enabled'));
  if (!enabledFeature || !enabledNotify) return;

  const daysRaw = String((await getSetting('notify.expiry.days_before')) || '3,1,0');
  const stepList = [...new Set(
    daysRaw.split(',')
      .map((s) => Number(String(s).trim()))
      .filter((n) => Number.isFinite(n) && n >= 0 && n <= 30)
  )].sort((a, b) => b - a); // largest step first (3, 1, 0)
  if (!stepList.length) return;

  const maxStep = stepList[0];
  const siteName = (await getSetting('site.name')) || 'Skynity';
  const publicBase = (await getSetting('site.public_base_url')) || '';

  // All active subs expiring within the window.
  const candidates = await db.query(
    `SELECT s.id, s.expires_at, s.last_expiry_notified_days,
            s.login_username, s.login_password,
            c.id AS customer_id, c.full_name, c.phone, c.telegram_id,
            p.name AS package_name, p.code AS package_code, p.price
       FROM subscriptions s
       JOIN customers c ON c.id = s.customer_id
       JOIN packages  p ON p.id = s.package_id
      WHERE s.status = 'active'
        AND s.expires_at > NOW()
        AND s.expires_at <= NOW() + INTERVAL ? DAY`,
    [maxStep]
  );

  const now = Date.now();
  for (const sub of candidates) {
    const expires = new Date(sub.expires_at).getTime();
    const daysLeft = Math.max(0, Math.floor((expires - now) / 86400000));

    // Find the largest step that still applies (daysLeft <= step)
    // and that we haven't already sent.
    const step = stepList.find((s) => daysLeft <= s);
    if (step === undefined) continue;
    if (sub.last_expiry_notified_days !== null && sub.last_expiry_notified_days <= step) {
      // already sent this step (or a smaller/more urgent one).
      continue;
    }

    const renewUrl = publicBase
      ? `${publicBase.replace(/\/$/, '')}/portal/renew?sub=${sub.id}&phone=${encodeURIComponent(sub.phone)}`
      : `/portal/renew?sub=${sub.id}&phone=${encodeURIComponent(sub.phone)}`;

    const urgency = step === 0 ? 'TODAY' : `in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
    const lines = [
      `Hi ${sub.full_name || 'there'},`,
      ``,
      `Your ${siteName} *${sub.package_name}* package expires *${urgency}* (${new Date(sub.expires_at).toLocaleString()}).`,
      ``,
      `Renew in one tap:`,
      renewUrl,
      ``,
      `Username: ${sub.login_username}`,
    ];
    const message = lines.join('\n');

    try {
      const out = await notifier.notifyCustomer({
        customerId: sub.customer_id,
        phone: sub.phone,
        telegramId: sub.telegram_id,
        message,
        purpose: 'expiry',
        relatedSubscriptionId: sub.id,
      });
      await db.query(
        `UPDATE subscriptions
            SET last_expiry_notified_days = ?, last_expiry_notified_at = NOW()
          WHERE id = ?`,
        [daysLeft, sub.id]
      );
      logger.info({ subscriptionId: sub.id, daysLeft, channel: out.channel, ok: out.ok }, 'expiry reminder');
    } catch (err) {
      logger.warn({ err: err.message, subscriptionId: sub.id }, 'expiry reminder failed');
    }
  }
}

export function startJobs() {
  cron.schedule('*/5 * * * *',  () => retryUnsyncedSubs().catch((e) => logger.error({ e }, 'retry job')));
  cron.schedule('*/15 * * * *', () => expireDueSubs().catch((e) => logger.error({ e }, 'expire job')));
  // Every 10 min: refresh last-seen AND snapshot bandwidth usage
  // for every active PPPoE/Hotspot session. Tighter than the old
  // hourly tick so daily usage charts have enough resolution.
  cron.schedule('*/10 * * * *', () => refreshLastSeen().catch((e) => logger.error({ e }, 'monitor job')));
  // Once a day — 08:00 local (TZ comes from the container / env).
  cron.schedule('0 8 * * *',    () => sendExpiryReminders().catch((e) => logger.error({ e }, 'expiry reminder job')));
  // Overnight: drop snapshots older than the retention window.
  cron.schedule('30 3 * * *',   () => pruneUsageSnapshots());

  // -------- Monitoring + health --------
  // Every 5 min: poll all routers for CPU/RAM/iface/ping/neighbors.
  cron.schedule('*/5 * * * *',  () => monitoring.pollAllRouters().catch((e) => logger.error({ e }, 'monitoring poll')));
  // Every 5 min: run issue-detector rules against the fresh data.
  cron.schedule('*/5 * * * *',  () => health.runHealthChecks().catch((e) => logger.error({ e }, 'health checks')));
  // Once a day at 04:00: refresh static device info (firmware / license).
  cron.schedule('0 4 * * *',    async () => {
    try {
      const routers = await db.query('SELECT id, name FROM mikrotik_routers WHERE is_active = 1');
      for (const r of routers) await monitoring.refreshDeviceInfo(r);
    } catch (e) { logger.error({ e }, 'device info refresh'); }
  });
  // Overnight: drop metrics older than the retention window.
  cron.schedule('45 3 * * *',   () => monitoring.pruneMetrics());

  logger.info('cron jobs scheduled');
}

// Exposed so an admin can trigger a run manually from the UI
// (e.g. after configuring settings the first time).
export { sendExpiryReminders };

export default { startJobs, sendExpiryReminders };
