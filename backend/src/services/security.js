// ============================================================
// Security audit log — failed/successful auth, OTP abuse signals
// ============================================================

import db from '../database/pool.js';
import logger from '../utils/logger.js';

const TYPES = new Set([
  'admin_login_ok', 'admin_login_fail',
  'portal_customer_login_fail', 'portal_customer_login_ok',
  'otp_verify_fail', 'otp_verify_ok',
]);

export async function logSecurityEvent({
  eventType, severity = 'info', ip = null, userAgent = null,
  adminId = null, subject = null, meta = null,
}) {
  if (!TYPES.has(eventType)) {
    logger.warn({ eventType }, 'unknown security event type');
  }
  try {
    await db.query(
      `INSERT INTO security_events
         (event_type, severity, ip, user_agent, admin_id, subject, meta)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        eventType,
        severity,
        ip ? String(ip).slice(0, 45) : null,
        userAgent ? String(userAgent).slice(0, 512) : null,
        adminId || null,
        subject ? String(subject).slice(0, 255) : null,
        meta ? JSON.stringify(meta) : null,
      ]
    );
  } catch (err) {
    logger.warn({ err: err.message }, 'logSecurityEvent failed');
  }
}

export async function listEvents({ limit = 100, offset = 0, eventType = null, hours = null } = {}) {
  const params = [];
  let where = '1=1';
  if (eventType) { where += ' AND event_type = ?'; params.push(eventType); }
  if (hours) { where += ' AND created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)'; params.push(Number(hours)); }
  params.push(Number(limit), Number(offset));
  return db.query(
    `SELECT id, event_type, severity, ip, user_agent, admin_id, subject, meta, created_at
       FROM security_events
      WHERE ${where}
      ORDER BY id DESC
      LIMIT ? OFFSET ?`,
    params
  );
}

export async function summary({ hours = 168 } = {}) {
  const rows = await db.query(
    `SELECT event_type, severity, COUNT(*) AS c
       FROM security_events
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)
      GROUP BY event_type, severity
      ORDER BY c DESC`,
    [Number(hours)]
  );
  const last24 = await db.queryOne(
    `SELECT COUNT(*) AS c FROM security_events
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`
  );
  const failAdmin = await db.queryOne(
    `SELECT COUNT(*) AS c FROM security_events
      WHERE event_type = 'admin_login_fail'
        AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`
  );
  const failOtp = await db.queryOne(
    `SELECT COUNT(*) AS c FROM security_events
      WHERE event_type = 'otp_verify_fail'
        AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`
  );
  const failPortal = await db.queryOne(
    `SELECT COUNT(*) AS c FROM security_events
      WHERE event_type = 'portal_customer_login_fail'
        AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`
  );
  return {
    hours,
    by_type: rows,
    last_24h_total: last24?.c ?? 0,
    brute_force_signals: {
      admin_login_fail_24h: failAdmin?.c ?? 0,
      otp_fail_24h: failOtp?.c ?? 0,
      portal_login_fail_24h: failPortal?.c ?? 0,
    },
  };
}

export async function pruneOld(days = 90) {
  const r = await db.query(
    `DELETE FROM security_events WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
    [Number(days)]
  );
  const n = r && typeof r === 'object' && 'affectedRows' in r ? r.affectedRows : 0;
  return { deleted: n || 0 };
}

export default { logSecurityEvent, listEvents, summary, pruneOld };
