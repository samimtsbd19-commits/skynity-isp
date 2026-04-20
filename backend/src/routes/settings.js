// ============================================================
// /api/settings — admin-panel tunables
// ============================================================

import { Router } from 'express';
import { requireAdmin, requireRole } from '../middleware/auth.js';
import * as svc from '../services/settings.js';

const router = Router();

router.get('/', requireAdmin, async (req, res) => {
  const includeSecret = ['superadmin', 'admin'].includes(req.admin.role);
  res.json({ settings: await svc.listSettings({ includeSecret }) });
});

router.get('/:key', requireAdmin, async (req, res) => {
  const value = await svc.getSetting(req.params.key);
  res.json({ key: req.params.key, value });
});

router.put('/:key', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  try {
    await svc.setSetting({
      key: req.params.key,
      value: req.body?.value,
      type: req.body?.type,
      description: req.body?.description,
      isSecret: req.body?.is_secret,
      updatedBy: req.admin.id,
    });
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/bulk', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  try {
    await svc.bulkUpdate(req.body?.settings || [], req.admin.id);
    res.json({ ok: true });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

export default router;
