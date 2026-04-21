// ============================================================
// Bandwidth / load-balance API
// ============================================================
import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import bandwidth from '../services/bandwidth.js';
import db from '../database/pool.js';

const router = Router();
router.use(requireAdmin);

// Snapshot for the dashboard.
router.get('/overview', async (req, res) => {
  try {
    const out = await bandwidth.getOverview(
      req.query.router_id ? Number(req.query.router_id) : null
    );
    res.json(out);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Historical chart data.
router.get('/history', async (req, res) => {
  try {
    const rows = await bandwidth.getHistory(
      req.query.router_id ? Number(req.query.router_id) : null,
      Number(req.query.hours) || 24
    );
    res.json({ rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Interface options for the router-edit form.
router.get('/router/:id/interfaces', async (req, res) => {
  try {
    const ifaces = await bandwidth.listInterfaces(req.params.id);
    res.json({ interfaces: ifaces });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// Save uplink interface + capacity on the router.
router.put('/router/:id/uplink', async (req, res) => {
  try {
    const { uplink_interface, uplink_down_mbps, uplink_up_mbps } = req.body || {};
    await db.query(
      `UPDATE mikrotik_routers
          SET uplink_interface = ?,
              uplink_down_mbps = ?,
              uplink_up_mbps   = ?
        WHERE id = ?`,
      [
        uplink_interface || null,
        Math.max(0, Math.floor(Number(uplink_down_mbps) || 0)),
        Math.max(0, Math.floor(Number(uplink_up_mbps)   || 0)),
        Number(req.params.id),
      ]
    );
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

export default router;
