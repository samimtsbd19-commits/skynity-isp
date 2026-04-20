// ============================================================
// /api/updates — RouterOS check/download/install, packages, reboot
// ============================================================

import { Router } from 'express';
import { requireAdmin, requireRole } from '../middleware/auth.js';
import * as svc from '../services/updates.js';

const router = Router();

router.post('/check', requireAdmin, async (req, res) => {
  try {
    res.json(await svc.checkForUpdates({
      routerId: Number(req.body?.router_id),
      channel: req.body?.channel,
      requestedBy: req.admin.id,
    }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/download', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  try {
    res.json(await svc.downloadUpdate({
      routerId: Number(req.body?.router_id),
      requestedBy: req.admin.id,
    }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/install', requireAdmin, requireRole('superadmin'), async (req, res) => {
  try {
    res.json(await svc.installUpdate({
      routerId: Number(req.body?.router_id),
      requestedBy: req.admin.id,
    }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/reboot', requireAdmin, requireRole('superadmin'), async (req, res) => {
  try {
    res.json(await svc.rebootRouter({
      routerId: Number(req.body?.router_id),
      requestedBy: req.admin.id,
    }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/packages', requireAdmin, async (req, res) => {
  try { res.json({ packages: await svc.listPackages(Number(req.query.router_id)) }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/packages/toggle', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  try {
    res.json(await svc.togglePackage({
      routerId: Number(req.body?.router_id),
      packageId: req.body?.package_id,
      enabled: !!req.body?.enabled,
      requestedBy: req.admin.id,
    }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/tasks', requireAdmin, async (req, res) => {
  const rows = await svc.listTasks({
    routerId: req.query.router_id ? Number(req.query.router_id) : undefined,
    limit: Number(req.query.limit) || 50,
    offset: Number(req.query.offset) || 0,
  });
  res.json({ tasks: rows });
});

export default router;
