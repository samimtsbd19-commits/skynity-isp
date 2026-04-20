// ============================================================
// /api/scripts — CRUD + execute + history
// ============================================================

import { Router } from 'express';
import db from '../database/pool.js';
import { requireAdmin, requireRole } from '../middleware/auth.js';
import * as svc from '../services/scripts.js';

const router = Router();

router.get('/', requireAdmin, async (_req, res) => {
  res.json({ scripts: await svc.listScripts() });
});

router.get('/:id', requireAdmin, async (req, res) => {
  const s = await svc.getScript(Number(req.params.id));
  if (!s) return res.status(404).json({ error: 'not found' });
  res.json(s);
});

router.post('/', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  try {
    const b = req.body || {};
    const id = await svc.createScript({
      name: b.name, description: b.description, source: b.source,
      policy: b.policy, tags: b.tags, createdBy: req.admin.id,
    });
    await db.query(
      `INSERT INTO activity_log (actor_type, actor_id, action, entity_type, entity_id, meta)
       VALUES ('admin', ?, 'script_created', 'router_script', ?, ?)`,
      [String(req.admin.id), String(id), JSON.stringify({ name: b.name })]
    );
    res.json({ id });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.patch('/:id', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  try { await svc.updateScript(Number(req.params.id), req.body || {}); res.json({ ok: true }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/:id', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  await svc.deleteScript(Number(req.params.id));
  res.json({ ok: true });
});

router.post('/:id/execute', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  const routerId = Number(req.body?.router_id);
  if (!routerId) return res.status(400).json({ error: 'router_id required' });
  try {
    const result = await svc.executeScript({
      scriptId: Number(req.params.id),
      routerId,
      executedBy: req.admin.id,
    });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/inline/execute', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  const { router_id, source, name } = req.body || {};
  if (!router_id || !source) return res.status(400).json({ error: 'router_id and source required' });
  try {
    const result = await svc.executeScript({
      inlineSource: source,
      inlineName: name,
      routerId: Number(router_id),
      executedBy: req.admin.id,
    });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/executions/history', requireAdmin, async (req, res) => {
  const rows = await svc.listExecutions({
    routerId: req.query.router_id ? Number(req.query.router_id) : undefined,
    scriptId: req.query.script_id ? Number(req.query.script_id) : undefined,
    limit: Number(req.query.limit) || 50,
    offset: Number(req.query.offset) || 0,
  });
  res.json({ executions: rows });
});

router.get('/executions/:id', requireAdmin, async (req, res) => {
  const e = await svc.getExecution(Number(req.params.id));
  if (!e) return res.status(404).json({ error: 'not found' });
  res.json(e);
});

export default router;
