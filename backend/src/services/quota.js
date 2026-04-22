import db from '../database/pool.js';
import radius from './radius.js';
import logger from '../utils/logger.js';

const THROTTLE_GROUP = 'PKG_THROTTLED';

async function ensureThrottleGroup() {
  const existing = await db.queryOne(
    `SELECT 1 FROM radgroupreply WHERE groupname = ? LIMIT 1`,
    [THROTTLE_GROUP]
  );
  if (existing) return;
  const rows = [
    ['Mikrotik-Rate-Limit', ':=', '1M/1M'],
    ['Service-Type', ':=', 'Framed-User'],
    ['Framed-Protocol', ':=', 'PPP'],
    ['Reply-Message', ':=', 'skynity:quota-exceeded'],
  ];
  for (const [attr, op, val] of rows) {
    await db.query(
      `INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES (?, ?, ?, ?)`,
      [THROTTLE_GROUP, attr, op, val]
    );
  }
  logger.info('created PKG_THROTTLED radius group');
}

export async function enforceQuotas() {
  if (!(await radius.isEnabled())) return { skipped: true };

  const subs = await db.query(
    `SELECT s.id, s.login_username, s.quota_used_gb, s.quota_throttled,
            s.package_id, p.monthly_quota_gb, p.code AS pkg_code
       FROM subscriptions s
       JOIN packages p ON p.id = s.package_id
      WHERE s.status = 'active' AND p.monthly_quota_gb IS NOT NULL`
  );
  await ensureThrottleGroup();

  let throttled = 0, restored = 0;
  for (const s of subs) {
    const over = Number(s.quota_used_gb) >= Number(s.monthly_quota_gb);
    if (over && !s.quota_throttled) {
      await db.query(
        `UPDATE radusergroup SET groupname = ? WHERE username = ?`,
        [THROTTLE_GROUP, s.login_username]
      );
      await db.query('UPDATE subscriptions SET quota_throttled = 1 WHERE id = ?', [s.id]);
      await radius.queueDisconnect({
        subscriptionId: s.id,
        username: s.login_username,
        reason: 'quota-exceeded',
      });
      throttled++;
      logger.info({ subId: s.id, used: s.quota_used_gb }, 'quota throttle applied');
    } else if (!over && s.quota_throttled) {
      await db.query('UPDATE subscriptions SET quota_throttled = 0 WHERE id = ?', [s.id]);
      const fresh = await db.queryOne('SELECT * FROM subscriptions WHERE id = ?', [s.id]);
      await radius.upsertUser(fresh);
      restored++;
    }
  }
  return { throttled, restored, checked: subs.length };
}

export async function resetMonthly() {
  const r = await db.query(
    `UPDATE subscriptions SET quota_used_gb = 0, quota_throttled = 0, quota_reset_at = NOW()`
  );
  logger.info({ rows: r.affectedRows }, 'monthly quota reset');
  if (!(await radius.isEnabled())) return { reset: r.affectedRows, radius: 'skipped' };

  const subs = await db.query(`SELECT * FROM subscriptions WHERE status = 'active'`);
  for (const s of subs) await radius.upsertUser(s);
  return { reset: r.affectedRows };
}

export async function addUsage(subscriptionId, deltaBytesIn, deltaBytesOut) {
  const totalBytes = BigInt(deltaBytesIn || 0) + BigInt(deltaBytesOut || 0);
  if (totalBytes === 0n) return;
  const gb = Number(totalBytes) / (1024 ** 3);
  await db.query(
    `UPDATE subscriptions SET quota_used_gb = quota_used_gb + ? WHERE id = ?`,
    [gb, subscriptionId]
  );
}

export default { enforceQuotas, resetMonthly, addUsage, ensureThrottleGroup };
