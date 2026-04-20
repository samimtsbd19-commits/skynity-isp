// ============================================================
// Admin API — customer suspensions + static IP assignment.
// ============================================================
import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import suspensions from '../services/suspensions.js';
import staticIpService from '../services/staticIp.js';
import db from '../database/pool.js';

const router = Router();
router.use(requireAdmin);

// ---- list all currently-active suspensions ----------------------
router.get('/', async (_req, res) => {
  try {
    const rows = await suspensions.listActiveSuspensions();
    res.json({ suspensions: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---- list the history of one customer's suspensions -------------
router.get('/by-customer/:id', async (req, res) => {
  try {
    const rows = await suspensions.listCustomerSuspensions(Number(req.params.id));
    res.json({ suspensions: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---- apply a new suspension to a customer ----------------------
// Body:
//   { customerId, reason, notes?, duration (preset key), customHours? }
router.post('/', async (req, res) => {
  try {
    const { customerId, reason, notes, duration, customHours } = req.body || {};
    if (!customerId || !reason) {
      return res.status(400).json({ error: 'customerId and reason are required' });
    }
    const out = await suspensions.applySuspension({
      customerId: Number(customerId),
      reason, notes, duration, customHours,
      adminId: req.admin.id,
    });
    res.json(out);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ---- lift a specific suspension --------------------------------
router.post('/:id/lift', async (req, res) => {
  try {
    const out = await suspensions.liftSuspension(Number(req.params.id), {
      adminId: req.admin.id,
      reason: req.body?.reason,
    });
    res.json(out);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ---- quick-action: lift *all* active suspensions for one customer
router.post('/by-customer/:id/lift-all', async (req, res) => {
  try {
    const open = await db.query(
      `SELECT id FROM customer_suspensions
        WHERE customer_id = ? AND lifted_at IS NULL`,
      [Number(req.params.id)]
    );
    const results = [];
    for (const { id } of open) {
      results.push(await suspensions.liftSuspension(id, {
        adminId: req.admin.id,
        reason: req.body?.reason || 'lifted via customer panel',
      }));
    }
    res.json({ ok: true, lifted: results.length });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ---- static IP ---------------------------------------------------
// POST /suspensions/subscriptions/:id/static-ip  { ip }
// DELETE /suspensions/subscriptions/:id/static-ip   (clear)
router.post('/subscriptions/:id/static-ip', async (req, res) => {
  try {
    const out = await staticIpService.assignStaticIp(Number(req.params.id), req.body?.ip);
    res.json(out);
  } catch (err) { res.status(400).json({ error: err.message }); }
});
router.delete('/subscriptions/:id/static-ip', async (req, res) => {
  try {
    const out = await staticIpService.clearStaticIp(Number(req.params.id));
    res.json(out);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

export default router;
