// ============================================================
// /api/offers — admin CRUD + broadcast for marketing offers
// ============================================================

import { Router } from 'express';
import { requireAdmin, requireRole } from '../middleware/auth.js';
import offers from '../services/offers.js';

const router = Router();

// ---------- list ----------
router.get('/', requireAdmin, async (req, res) => {
  try {
    const list = await offers.listOffers({
      includeInactive: req.query.all === '1' || req.query.all === 'true',
    });
    res.json({ offers: list });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------- detail ----------
router.get('/:id', requireAdmin, async (req, res) => {
  try {
    const o = await offers.getOffer(req.params.id);
    if (!o) return res.status(404).json({ error: 'not found' });
    res.json(o);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------- create ----------
router.post('/', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  try {
    const r = await offers.createOffer(req.body || {}, req.admin.id);
    res.json(r);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ---------- update ----------
router.patch('/:id', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  try {
    const r = await offers.updateOffer(req.params.id, req.body || {});
    res.json(r);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ---------- delete ----------
router.delete('/:id', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  try {
    const r = await offers.deleteOffer(req.params.id);
    res.json(r);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ---------- broadcast ----------
// Body: { channels?: string[], includeInactive?: boolean }
router.post('/:id/broadcast', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  try {
    const r = await offers.broadcastOffer(req.params.id, {
      adminId: req.admin.id,
      channels: Array.isArray(req.body?.channels) ? req.body.channels : undefined,
      includeInactive: !!req.body?.includeInactive,
    });
    res.json(r);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

export default router;
