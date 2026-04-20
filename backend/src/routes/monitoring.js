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

    const [device, latest, neighbors, interfaces, pingTargets] = await Promise.all([
      db.queryOne('SELECT * FROM router_device_info WHERE router_id = ?', [id]),
      db.queryOne('SELECT * FROM router_metrics WHERE router_id = ? ORDER BY id DESC LIMIT 1', [id]),
      db.query(`SELECT * FROM router_neighbors WHERE router_id = ? ORDER BY last_seen_at DESC`, [id]),
      latestInterfaceRow(id),
      db.query(`SELECT * FROM router_ping_targets WHERE router_id = ? ORDER BY id ASC`, [id]),
    ]);

    const pings = [];
    for (const t of pingTargets) {
      const last = await db.queryOne(
        `SELECT * FROM router_ping_metrics WHERE target_id = ? ORDER BY id DESC LIMIT 1`,
        [t.id]
      );
      pings.push({ target: t, latest: last });
    }

    res.json({ router: router_, device, latest, neighbors, interfaces, pings });
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
