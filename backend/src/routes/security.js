import { Router } from 'express';
import { requireAdmin, requireRole } from '../middleware/auth.js';
import security from '../services/security.js';
import ops from '../services/ops.js';

const router = Router();
router.use(requireAdmin);

router.get('/summary', async (req, res) => {
  const hours = Math.min(720, Math.max(1, Number(req.query.hours) || 168));
  res.json(await security.summary({ hours }));
});

router.get('/events', async (req, res) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const eventType = req.query.type || null;
  const hours = req.query.hours ? Number(req.query.hours) : null;
  const rows = await security.listEvents({ limit, offset, eventType, hours });
  res.json({ events: rows });
});

router.post('/emergency-stop', requireRole('superadmin', 'admin', 'reseller'), async (req, res) => {
  const enabled = !!req.body?.enabled;
  const out = await ops.setEmergencyStop(enabled, { updatedBy: String(req.admin.id) });
  res.json(out);
});

router.get('/emergency-stop', async (_req, res) => {
  res.json({ emergency_stop: await ops.getEmergencyStop() });
});

export default router;
