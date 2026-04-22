// ============================================================
// System health / issue detector
// ------------------------------------------------------------
// Runs rule-based checks against the freshest metrics and
// maintains the `system_events` table. Each rule *opens* an
// event when the bad condition is true and *resolves* the same
// event when the condition clears — preventing a storm of
// duplicate alerts.
//
// Every event carries:
//   code         stable machine name used for open/resolve
//   source_ref   e.g. router_id, admin_id (for scoping)
//   severity     info | warning | error | critical
//   suggestion   plain text/markdown guide for the admin
// ============================================================
import db from '../database/pool.js';
import { getSetting, setSetting } from './settings.js';
import logger from '../utils/logger.js';
import { notifyAdmins } from '../telegram/bot.js';

// ------------------------------------------------------------
// Low-level helpers
// ------------------------------------------------------------
async function openEvent({ code, source, sourceRef = '', severity = 'warning', title, message, suggestion, meta }) {
  try {
    // Look for an OPEN event with this (code, source_ref).
    const existing = await db.queryOne(
      `SELECT id FROM system_events
        WHERE code = ? AND source_ref = ? AND resolved_at IS NULL
        LIMIT 1`,
      [code, sourceRef]
    );
    if (existing) {
      await db.query(
        `UPDATE system_events SET last_seen = NOW(), occurrences = occurrences + 1,
                                   message = COALESCE(?, message),
                                   severity = ?
          WHERE id = ?`,
        [message || null, severity, existing.id]
      );
      return existing.id;
    }
    const r = await db.query(
      `INSERT INTO system_events
         (code, severity, source, source_ref, title, message, suggestion, meta)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [code, severity, source, sourceRef, title, message || null, suggestion || null,
       meta ? JSON.stringify(meta) : null]
    );
    return r.insertId;
  } catch (err) {
    // Duplicate-key race is expected under the unique index.
    if (err.code === 'ER_DUP_ENTRY') return null;
    logger.warn({ err: err.message, code }, 'openEvent failed');
  }
}

async function resolveEvent(code, sourceRef = '') {
  try {
    await db.query(
      `UPDATE system_events SET resolved_at = NOW()
        WHERE code = ? AND source_ref = ? AND resolved_at IS NULL`,
      [code, sourceRef]
    );
  } catch (err) {
    logger.warn({ err: err.message, code }, 'resolveEvent failed');
  }
}

async function openOrResolve(condition, params) {
  if (condition) return openEvent(params);
  return resolveEvent(params.code, params.sourceRef || '');
}

// ------------------------------------------------------------
// VPS / database checks
// ------------------------------------------------------------
async function checkDatabase() {
  try {
    const r = await db.queryOne('SELECT 1 AS ok');
    await openOrResolve(!r?.ok, {
      code: 'db.down', source: 'db',
      severity: 'critical', title: 'Database not responding',
      suggestion: 'Check the MySQL container: `docker ps | grep mysql`. Restart it if unhealthy.',
    });
  } catch (err) {
    await openEvent({
      code: 'db.down', source: 'db', severity: 'critical',
      title: 'Database not responding',
      message: err.message,
      suggestion: [
        '1. Check MySQL container logs: `docker logs mysql-<coolify-id>`',
        '2. Restart it from the Coolify dashboard or: `docker restart <id>`',
        '3. Verify DB_PASSWORD in Coolify Environment matches the initial password.',
      ].join('\n'),
    });
  }
}

async function maybeTelegramRouterOffline(router) {
  try {
    if (!(await getSetting('feature.router_offline_telegram'))) return;
    const raw = (await getSetting('health.router_offline_last_alert_json')) || '{}';
    let map = {};
    try { map = JSON.parse(raw); } catch { map = {}; }
    const rid = String(router.id);
    const last = Number(map[rid] || 0);
    const now = Date.now();
    const coolMin = Number(await getSetting('health.router_offline_alert_cooldown_min')) || 30;
    if (now - last < coolMin * 60 * 1000) return;
    map[rid] = now;
    await setSetting({
      key: 'health.router_offline_last_alert_json',
      value: JSON.stringify(map),
      type: 'string',
      updatedBy: null,
    });
    await notifyAdmins(
      `*Router offline*\n"${router.name}" (${router.host})\nNo fresh metrics for 15+ minutes.`,
    );
  } catch (err) {
    logger.warn({ err: err.message }, 'router offline telegram alert failed');
  }
}

// ------------------------------------------------------------
// Router checks — CPU / RAM / temp / reachability
// ------------------------------------------------------------
async function checkRouterThresholds() {
  const routers = await db.query(
    `SELECT id, name, host, is_active FROM mikrotik_routers WHERE is_active = 1`
  );
  if (!routers.length) return;

  const cpuWarn   = Number(await getSetting('health.router_cpu_warn'))  || 75;
  const cpuCrit   = Number(await getSetting('health.router_cpu_crit'))  || 90;
  const memWarn   = Number(await getSetting('health.router_mem_warn'))  || 80;
  const tempWarn  = Number(await getSetting('health.router_temp_warn')) || 60;
  const tempCrit  = Number(await getSetting('health.router_temp_crit')) || 75;

  for (const r of routers) {
    const latest = await db.queryOne(
      `SELECT * FROM router_metrics WHERE router_id = ? ORDER BY id DESC LIMIT 1`,
      [r.id]
    );

    // Offline if no fresh sample in the last 15 minutes.
    const offline = !latest || (Date.now() - new Date(latest.taken_at).getTime() > 15 * 60 * 1000);
    await openOrResolve(offline, {
      code: 'router.offline', source: 'router', sourceRef: String(r.id),
      severity: 'critical',
      title: `Router "${r.name}" is unreachable`,
      message: `No resource sample received in 15+ minutes from ${r.host}.`,
      suggestion: [
        '1. Can you ping the router from the VPS? `ping ' + r.host + '`',
        '2. Is the REST API / API port open in MikroTik firewall?',
        '3. Check MIKROTIK_USERNAME / MIKROTIK_PASSWORD in the router config page.',
        '4. On the router: `/ip service print` — is www-ssl (or www) enabled?',
      ].join('\n'),
    });
    if (offline) {
      await maybeTelegramRouterOffline(r);
      continue;
    }

    // CPU
    const cpu = Number(latest.cpu_load) || 0;
    await openOrResolve(cpu >= cpuCrit, {
      code: 'router.cpu.crit', source: 'router', sourceRef: String(r.id),
      severity: 'critical',
      title: `Router "${r.name}" CPU at ${cpu}%`,
      message: 'Sustained high CPU — packets will start dropping.',
      suggestion: [
        'Run `/tool profile duration=5s` on the router to find the hot process.',
        'Common culprits: aggressive firewall rules, FastTrack disabled, too many PPPoE concurrent sessions for this CPU class.',
      ].join('\n'),
    });
    if (cpu < cpuCrit) {
      await openOrResolve(cpu >= cpuWarn, {
        code: 'router.cpu.warn', source: 'router', sourceRef: String(r.id),
        severity: 'warning',
        title: `Router "${r.name}" CPU at ${cpu}%`,
        suggestion: 'Watch this for the next hour — if it stays high, profile the router.',
      });
    } else {
      await resolveEvent('router.cpu.warn', String(r.id));
    }

    // Memory
    if (latest.mem_used && latest.mem_total) {
      const pct = Math.round((Number(latest.mem_used) / Number(latest.mem_total)) * 100);
      await openOrResolve(pct >= memWarn, {
        code: 'router.mem.warn', source: 'router', sourceRef: String(r.id),
        severity: pct >= 95 ? 'error' : 'warning',
        title: `Router "${r.name}" memory at ${pct}%`,
        suggestion: 'Too many logs / scripts / large address-lists can eat RAM. Reboot the router off-hours if needed.',
      });
    }

    // Temperature
    if (latest.temperature != null) {
      const t = Number(latest.temperature);
      await openOrResolve(t >= tempCrit, {
        code: 'router.temp.crit', source: 'router', sourceRef: String(r.id),
        severity: 'critical',
        title: `Router "${r.name}" temp ${t}°C`,
        suggestion: 'Check fans / air-flow / ambient temperature *now*. Sustained temp above ' + tempCrit + '°C shortens hardware lifespan drastically.',
      });
      if (t < tempCrit) {
        await openOrResolve(t >= tempWarn, {
          code: 'router.temp.warn', source: 'router', sourceRef: String(r.id),
          severity: 'warning',
          title: `Router "${r.name}" temp ${t}°C`,
          suggestion: 'Keep an eye on it — clean fans / improve airflow.',
        });
      } else {
        await resolveEvent('router.temp.warn', String(r.id));
      }
    }
  }
}

// ------------------------------------------------------------
// Ping / latency
// ------------------------------------------------------------
async function checkPingTargets() {
  const lossWarn = Number(await getSetting('health.ping_loss_warn')) || 20;
  const rttWarn  = Number(await getSetting('health.ping_rtt_warn'))  || 200;

  // Latest ping row per (router, target).
  const rows = await db.query(
    `SELECT pm.router_id, pm.target_id, pm.rtt_avg_ms, pm.packet_loss,
            pm.taken_at, t.host, r.name AS router_name
       FROM router_ping_metrics pm
       JOIN (SELECT target_id, MAX(id) AS mx FROM router_ping_metrics GROUP BY target_id) x
         ON x.mx = pm.id
       JOIN router_ping_targets t ON t.id = pm.target_id
       JOIN mikrotik_routers r ON r.id = pm.router_id`
  );
  for (const p of rows) {
    const loss = Number(p.packet_loss) || 0;
    const rtt  = Number(p.rtt_avg_ms)  || 0;
    const ref  = `${p.router_id}:${p.target_id}`;
    await openOrResolve(loss >= 100, {
      code: 'ping.down', source: 'router', sourceRef: ref,
      severity: 'error',
      title: `${p.router_name}: 100% packet loss to ${p.host}`,
      suggestion: 'Upstream link is down. Check the WAN / fibre / Starlink terminal and default route.',
    });
    if (loss < 100) {
      await openOrResolve(loss >= lossWarn, {
        code: 'ping.loss', source: 'router', sourceRef: ref,
        severity: 'warning',
        title: `${p.router_name}: ${loss}% loss to ${p.host}`,
        suggestion: 'Investigate upstream congestion / wireless interference.',
      });
      await openOrResolve(rtt >= rttWarn, {
        code: 'ping.rtt',  source: 'router', sourceRef: ref,
        severity: 'info',
        title: `${p.router_name}: high latency to ${p.host} (${rtt.toFixed(0)} ms)`,
        suggestion: 'Expected for Starlink spikes. If persistent, check queue/CPU/upstream.',
      });
    } else {
      await resolveEvent('ping.loss', ref);
      await resolveEvent('ping.rtt',  ref);
    }
  }
}

// ------------------------------------------------------------
// Security — failed admin logins burst
// ------------------------------------------------------------
async function checkAuthBurst() {
  try {
    const windowMin = Number(await getSetting('health.auth_fail_window'))   || 60;
    const threshold = Number(await getSetting('health.auth_fail_threshold')) || 10;
    // Only check if the audit_log table exists (created in 002+)
    const row = await db.queryOne(
      `SELECT COUNT(*) AS c FROM audit_log
        WHERE action = 'login_failed'
          AND created_at >= NOW() - INTERVAL ? MINUTE`,
      [windowMin]
    ).catch(() => null);
    if (!row) return;
    await openOrResolve(row.c >= threshold, {
      code: 'security.auth_burst', source: 'security',
      severity: 'error',
      title: `${row.c} failed admin logins in the last ${windowMin} min`,
      suggestion: [
        'Possible brute-force attack.',
        '1. Review `audit_log` for the offending IPs.',
        '2. Block the IP at the VPS firewall / Traefik middleware.',
        '3. Rotate admin passwords if there is any chance they were guessed.',
      ].join('\n'),
      meta: { count: row.c, window_min: windowMin },
    });
  } catch (err) {
    logger.warn({ err: err.message }, 'auth burst check failed');
  }
}

// ------------------------------------------------------------
// Subscription / business checks
// ------------------------------------------------------------
async function checkPendingOrders() {
  try {
    const row = await db.queryOne(
      `SELECT COUNT(*) AS c FROM orders
        WHERE status = 'pending'
          AND created_at < NOW() - INTERVAL 24 HOUR`
    ).catch(() => null);
    if (!row) return;
    await openOrResolve(row.c >= 3, {
      code: 'orders.stale', source: 'business',
      severity: 'warning',
      title: `${row.c} orders waiting for approval (>24h)`,
      suggestion: 'Approve or reject pending orders from the Orders page.',
      meta: { count: row.c },
    });
  } catch { /* table missing — ignore */ }
}

async function checkUnsyncedSubs() {
  try {
    const row = await db.queryOne(
      `SELECT COUNT(*) AS c FROM subscriptions
        WHERE status = 'active'
          AND mt_synced = 0
          AND created_at < NOW() - INTERVAL 30 MINUTE`
    ).catch(() => null);
    if (!row) return;
    await openOrResolve(row.c > 0, {
      code: 'subs.unsynced', source: 'router',
      severity: 'error',
      title: `${row.c} subscriptions failed to sync to MikroTik`,
      suggestion: [
        'The subscription exists in the DB but was never pushed to the router.',
        'Open the customer / subscription page and use "Retry sync".',
        'If it keeps failing, check the router host/credentials.',
      ].join('\n'),
    });
  } catch { /* ignore */ }
}

// ------------------------------------------------------------
// Entry point
// ------------------------------------------------------------
export async function runHealthChecks() {
  await checkDatabase();
  await checkRouterThresholds();
  await checkPingTargets();
  await checkAuthBurst();
  await checkPendingOrders();
  await checkUnsyncedSubs();
}

export { openEvent, resolveEvent };
export default { runHealthChecks, openEvent, resolveEvent };
