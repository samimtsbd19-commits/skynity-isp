// ============================================================
// Admin API — MikroTik monitoring + system events
// ============================================================
import { Router } from 'express';
import db from '../database/pool.js';
import { requireAdmin } from '../middleware/auth.js';
import monitoring from '../services/monitoring.js';
import health from '../services/health.js';
import logger from '../utils/logger.js';

const router = Router();
router.use(requireAdmin);

// -----------------------------------------------------------
// Overview — one row per router with the latest metric.
// -----------------------------------------------------------
router.get('/routers', async (_req, res) => {
  try {
    const routers = await db.query(
      `SELECT r.id, r.name, r.host, r.is_active, di.*
         FROM mikrotik_routers r
         LEFT JOIN router_device_info di ON di.router_id = r.id
        ORDER BY r.id ASC`
    );
    for (const r of routers) {
      r.latest = await db.queryOne(
        `SELECT * FROM router_metrics WHERE router_id = ? ORDER BY id DESC LIMIT 1`,
        [r.id]
      );
      r.active_events = await db.query(
        `SELECT id, code, severity, title, last_seen
           FROM system_events
          WHERE source = 'router' AND source_ref = ? AND resolved_at IS NULL
          ORDER BY FIELD(severity, 'critical','error','warning','info'), last_seen DESC`,
        [String(r.id)]
      );
    }
    res.json({ routers });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// -----------------------------------------------------------
// Per-router detail — latest metrics + device info + neighbors.
// -----------------------------------------------------------
router.get('/routers/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const router_ = await db.queryOne('SELECT * FROM mikrotik_routers WHERE id = ?', [id]);
    if (!router_) return res.status(404).json({ error: 'router not found' });

    const [device, latest, neighbors, interfaces, pingTargets, guard] = await Promise.all([
      db.queryOne('SELECT * FROM router_device_info WHERE router_id = ?', [id]),
      db.queryOne('SELECT * FROM router_metrics WHERE router_id = ? ORDER BY id DESC LIMIT 1', [id]),
      db.query(`SELECT * FROM router_neighbors WHERE router_id = ? ORDER BY last_seen_at DESC`, [id]),
      latestInterfaceRow(id),
      db.query(`SELECT * FROM router_ping_targets WHERE router_id = ? ORDER BY id ASC`, [id]),
      db.queryOne('SELECT * FROM router_guard_state WHERE router_id = ?', [id]),
    ]);

    const pings = [];
    for (const t of pingTargets) {
      const last = await db.queryOne(
        `SELECT * FROM router_ping_metrics WHERE target_id = ? ORDER BY id DESC LIMIT 1`,
        [t.id]
      );
      pings.push({ target: t, latest: last });
    }

    res.json({ router: router_, device, latest, neighbors, interfaces, pings, guard });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Latest row per interface (SFP + link state).
async function latestInterfaceRow(routerId) {
  return db.query(
    `SELECT m.*
       FROM router_interface_metrics m
       JOIN (
         SELECT interface_name, MAX(id) AS mx
           FROM router_interface_metrics
          WHERE router_id = ?
          GROUP BY interface_name
       ) x ON x.mx = m.id
      ORDER BY m.interface_name ASC`,
    [routerId]
  );
}

// -----------------------------------------------------------
// Historical chart data.
// -----------------------------------------------------------
router.get('/routers/:id/history', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const hours = Math.min(168, Math.max(1, Number(req.query.hours) || 24));
    const rows = await db.query(
      `SELECT taken_at, cpu_load, mem_used, mem_total, temperature, active_ppp, active_hs
         FROM router_metrics
        WHERE router_id = ?
          AND taken_at >= NOW() - INTERVAL ? HOUR
        ORDER BY id ASC`,
      [id, hours]
    );
    res.json({ rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ----- Per-interface history (bandwidth + SFP) ------------------
// Returns a time-series for ONE interface on ONE router. Used by
// the monitoring page to draw rx/tx charts AND an SFP Rx/Tx power
// line when the port is an SFP.
router.get('/routers/:id/interface-history', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const iface = String(req.query.iface || '').trim();
    if (!iface) return res.status(400).json({ error: 'iface query-param required' });
    const hours = Math.min(168, Math.max(1, Number(req.query.hours) || 24));
    const rows = await db.query(
      `SELECT taken_at, rx_bps, tx_bps, rx_total, tx_total, link_ok,
              sfp_rx_power, sfp_tx_power, sfp_temp
         FROM router_interface_metrics
        WHERE router_id = ? AND interface_name = ?
          AND taken_at >= NOW() - INTERVAL ? HOUR
        ORDER BY id ASC`,
      [id, iface, hours]
    );
    res.json({ iface, hours, rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ----- Queue history ---------------------------------------------
// Two modes:
//   * Without ?queue= : returns the "top N" queues right now, with
//     a small rx/tx bps series for each. Good for the dashboard.
//   * With ?queue=NAME : returns the full rx/tx history for that one
//     queue. Good for drilldown.
router.get('/routers/:id/queue-history', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const hours = Math.min(168, Math.max(1, Number(req.query.hours) || 24));
    const q = req.query.queue ? String(req.query.queue) : null;

    if (q) {
      const rows = await db.query(
        `SELECT taken_at, rx_bps, tx_bps, rx_bytes, tx_bytes, dropped_in, dropped_out
           FROM router_queue_metrics
          WHERE router_id = ? AND queue_name = ?
            AND taken_at >= NOW() - INTERVAL ? HOUR
          ORDER BY id ASC`,
        [id, q, hours]
      );
      return res.json({ queue: q, rows });
    }

    // Top-N queues by *current* traffic — the most recent row per queue.
    const latest = await db.query(
      `SELECT m.*
         FROM router_queue_metrics m
         JOIN (
           SELECT queue_name, MAX(id) AS mx
             FROM router_queue_metrics
            WHERE router_id = ?
              AND taken_at >= NOW() - INTERVAL 15 MINUTE
            GROUP BY queue_name
         ) x ON x.mx = m.id
        ORDER BY (COALESCE(m.rx_bps,0) + COALESCE(m.tx_bps,0)) DESC
        LIMIT 20`,
      [id]
    );
    res.json({ queues: latest });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ----- Top bandwidth consumers (last 24h) ------------------------
// Aggregates `usage_snapshots` deltas per subscription and joins
// the customer + package so the UI can show "Top 10 users this
// day". Used on the per-router dashboard.
router.get('/routers/:id/top-users', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const hours = Math.min(168, Math.max(1, Number(req.query.hours) || 24));
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
    const rows = await db.query(
      `SELECT s.id AS subscription_id, s.login_username, s.service_type,
              c.full_name, c.phone,
              p.name AS package_name, p.code AS package_code,
              SUM(u.delta_in)  AS bytes_in,
              SUM(u.delta_out) AS bytes_out,
              SUM(u.delta_in + u.delta_out) AS total_bytes
         FROM usage_snapshots u
         JOIN subscriptions s ON s.id = u.subscription_id
         JOIN customers c     ON c.id = s.customer_id
         JOIN packages  p     ON p.id = s.package_id
        WHERE u.router_id = ?
          AND u.taken_at >= NOW() - INTERVAL ? HOUR
        GROUP BY s.id
        ORDER BY total_bytes DESC
        LIMIT ?`,
      [id, hours, limit]
    );
    res.json({ hours, rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ----- Per-subscription daily traffic (for PPPoE user graph) -----
// Buckets `usage_snapshots` into hourly or daily totals. Used when
// an admin clicks a user on the top-N list to drill in.
router.get('/subscriptions/:id/usage-history', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const hours = Math.min(720, Math.max(1, Number(req.query.hours) || 24));
    const bucket = hours <= 48 ? 'hour' : 'day';
    const grp = bucket === 'hour'
      ? "DATE_FORMAT(taken_at, '%Y-%m-%d %H:00:00')"
      : "DATE(taken_at)";
    const rows = await db.query(
      `SELECT ${grp} AS bucket,
              SUM(delta_in)  AS bytes_in,
              SUM(delta_out) AS bytes_out
         FROM usage_snapshots
        WHERE subscription_id = ?
          AND taken_at >= NOW() - INTERVAL ? HOUR
        GROUP BY bucket
        ORDER BY bucket ASC`,
      [id, hours]
    );
    res.json({ bucket, rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/routers/:id/ping-history', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const hours = Math.min(168, Math.max(1, Number(req.query.hours) || 24));
    const rows = await db.query(
      `SELECT pm.taken_at, pm.rtt_avg_ms, pm.packet_loss, t.host, t.label
         FROM router_ping_metrics pm
         JOIN router_ping_targets t ON t.id = pm.target_id
        WHERE pm.router_id = ?
          AND pm.taken_at >= NOW() - INTERVAL ? HOUR
        ORDER BY pm.id ASC`,
      [id, hours]
    );
    res.json({ rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// -----------------------------------------------------------
// Ping targets — admin CRUD
// -----------------------------------------------------------
router.post('/routers/:id/ping-targets', async (req, res) => {
  try {
    const { host, label } = req.body || {};
    if (!host) return res.status(400).json({ error: 'host required' });
    await db.query(
      `INSERT INTO router_ping_targets (router_id, host, label) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE label = VALUES(label), is_active = 1`,
      [Number(req.params.id), host, label || host]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/ping-targets/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM router_ping_targets WHERE id = ?', [Number(req.params.id)]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// -----------------------------------------------------------
// Manual "run now" — useful while tuning thresholds.
// -----------------------------------------------------------
router.post('/poll-now', async (_req, res) => {
  try {
    const r = await monitoring.pollAllRouters();
    await health.runHealthChecks();
    res.json(r);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===========================================================
// Events / alerts
// ===========================================================
router.get('/events', async (req, res) => {
  try {
    const status = req.query.status || 'open';
    const where = status === 'all'
      ? ''
      : status === 'resolved'
        ? 'WHERE resolved_at IS NOT NULL'
        : 'WHERE resolved_at IS NULL';
    const rows = await db.query(
      `SELECT e.*, a.full_name AS resolved_by_name
         FROM system_events e
         LEFT JOIN admins a ON a.id = e.resolved_by
         ${where}
         ORDER BY
           CASE WHEN e.resolved_at IS NULL THEN 0 ELSE 1 END,
           FIELD(severity, 'critical','error','warning','info'),
           last_seen DESC
         LIMIT 200`
    );
    res.json({ events: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/events/summary', async (_req, res) => {
  try {
    const rows = await db.query(
      `SELECT severity, COUNT(*) AS c
         FROM system_events
        WHERE resolved_at IS NULL
        GROUP BY severity`
    );
    const out = { critical: 0, error: 0, warning: 0, info: 0, total: 0 };
    for (const r of rows) { out[r.severity] = Number(r.c); out.total += Number(r.c); }
    res.json(out);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/events/:id/resolve', async (req, res) => {
  try {
    await db.query(
      `UPDATE system_events SET resolved_at = NOW(), resolved_by = ? WHERE id = ?`,
      [req.admin.id, Number(req.params.id)]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/events/run-checks', async (_req, res) => {
  try { await health.runHealthChecks(); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
