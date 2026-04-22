// ============================================================
// /api/radius — FreeRADIUS AAA admin surface
// ------------------------------------------------------------
// Endpoints:
//   GET  /api/radius/status           → feature flag + config
//   POST /api/radius/enable           → flip feature on + full sync
//   POST /api/radius/disable          → flip feature off
//   POST /api/radius/sync             → fullSyncAll() (idempotent)
//   GET  /api/radius/online           → live sessions (radacct)
//   GET  /api/radius/sessions/:user   → session history per user
//   GET  /api/radius/totals           → aggregate bytes
//   GET  /api/radius/log              → radius_sync_log audit
//   GET  /api/radius/nas              → list NAS rows
//   POST /api/radius/nas              → create/update NAS row (links to a router)
//   DELETE /api/radius/nas/:id        → delete NAS row
//   GET  /api/radius/groups           → list RADIUS groups (derived from packages)
//   POST /api/radius/groups/:pkgId    → (re)push group attrs for one package
//   POST /api/radius/users/:subId     → (re)push radcheck+usergroup for one subscription
//   POST /api/radius/disconnect       → enqueue CoA disconnect for a username
//   POST /api/radius/queue/drain      → force-drain disconnect queue now
// ============================================================

import { Router } from 'express';
import db from '../database/pool.js';
import { requireAdmin, requireRole } from '../middleware/auth.js';
import radius from '../services/radius.js';
import { getSetting, setSetting } from '../services/settings.js';

const router = Router();

// ---------- status ----------
router.get('/status', requireAdmin, async (_req, res) => {
  const [enabled, host, defaultSecret, interim, autoReg, coa] = await Promise.all([
    getSetting('feature.radius_enabled'),
    getSetting('radius.host'),
    getSetting('radius.default_secret'),
    getSetting('radius.accounting_interval'),
    getSetting('radius.auto_register_nas'),
    getSetting('radius.coa_enabled'),
  ]);
  const nasCount    = Number((await db.queryOne('SELECT COUNT(*) AS c FROM nas'))?.c || 0);
  const userCount   = Number((await db.queryOne('SELECT COUNT(DISTINCT username) AS c FROM radcheck'))?.c || 0);
  const groupCount  = Number((await db.queryOne('SELECT COUNT(DISTINCT groupname) AS c FROM radgroupreply'))?.c || 0);
  const online      = Number((await db.queryOne('SELECT COUNT(*) AS c FROM radacct WHERE acctstoptime IS NULL'))?.c || 0);
  const pendingCoA  = Number((await db.queryOne(`SELECT COUNT(*) AS c FROM radius_disconnect_queue WHERE status = 'pending'`))?.c || 0);
  res.json({
    enabled: !!enabled,
    host: host || '',
    default_secret_set: !!defaultSecret,
    accounting_interval: Number(interim) || 60,
    auto_register_nas: !!autoReg,
    coa_enabled: !!coa,
    counts: { nas: nasCount, users: userCount, groups: groupCount, online, pending_coa: pendingCoA },
  });
});

// ---------- enable / disable (superadmin only) ----------
router.post('/enable', requireAdmin, requireRole('superadmin'), async (req, res) => {
  try {
    await setSetting({ key: 'feature.radius_enabled', value: true, type: 'boolean', updatedBy: req.admin?.id });
    const report = await radius.fullSyncAll({ forceEnable: true });
    res.json({ ok: true, report });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/disable', requireAdmin, requireRole('superadmin'), async (req, res) => {
  try {
    await setSetting({ key: 'feature.radius_enabled', value: false, type: 'boolean', updatedBy: req.admin?.id });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------- settings ----------
router.patch('/settings', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  try {
    const b = req.body || {};
    const upd = [];
    if (b.host !== undefined)                 upd.push(['radius.host', b.host, 'string']);
    if (b.default_secret !== undefined)       upd.push(['radius.default_secret', b.default_secret, 'string']);
    if (b.accounting_interval !== undefined)  upd.push(['radius.accounting_interval', Number(b.accounting_interval), 'number']);
    if (b.auto_register_nas !== undefined)    upd.push(['radius.auto_register_nas', !!b.auto_register_nas, 'boolean']);
    if (b.coa_enabled !== undefined)          upd.push(['radius.coa_enabled', !!b.coa_enabled, 'boolean']);
    if (b.nas_type !== undefined)             upd.push(['radius.nas_type', b.nas_type, 'string']);
    for (const [key, value, type] of upd) {
      await setSetting({ key, value, type, updatedBy: req.admin?.id });
    }
    res.json({ ok: true, updated: upd.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------- full sync ----------
router.post('/sync', requireAdmin, requireRole('superadmin', 'admin'), async (_req, res) => {
  try {
    const report = await radius.fullSyncAll();
    res.json(report);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------- online sessions ----------
router.get('/online', requireAdmin, async (req, res) => {
  const routerId = req.query.routerId ? Number(req.query.routerId) : null;
  const limit = Math.min(Math.max(Number(req.query.limit) || 500, 1), 5000);
  const rows = await radius.listOnline({ routerId, limit });
  res.json({ sessions: rows, count: rows.length });
});

// ---------- session history (per username) ----------
router.get('/sessions/:username', requireAdmin, async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
  const rows = await radius.getSessionHistory(req.params.username, days);
  res.json({ sessions: rows, days });
});

// ---------- totals ----------
router.get('/totals', requireAdmin, async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
  const since = new Date(Date.now() - days * 86400 * 1000);
  res.json(await radius.totals({ since }));
});

// ---------- audit log ----------
router.get('/log', requireAdmin, async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  const rows = await db.query(
    `SELECT * FROM radius_sync_log ORDER BY id DESC LIMIT ?`,
    [limit]
  );
  res.json({ entries: rows });
});

// ---------- NAS (routers registered as RADIUS clients) ----------
router.get('/nas', requireAdmin, async (_req, res) => {
  const rows = await db.query(
    `SELECT n.*, r.id AS router_id, r.name AS router_name, r.host AS router_host
       FROM nas n
       LEFT JOIN mikrotik_routers r ON r.radius_nas_ip = n.nasname
       ORDER BY n.id ASC`
  );
  // Redact secret length only, not value
  res.json({
    nas: rows.map((r) => ({
      ...r,
      secret: r.secret ? '•'.repeat(Math.min(r.secret.length, 16)) : '',
      secret_set: !!r.secret,
    })),
  });
});

router.post('/nas', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  try {
    const b = req.body || {};
    const routerId = Number(b.router_id);
    if (!routerId) return res.status(400).json({ error: 'router_id required' });
    const r = await db.queryOne(`SELECT * FROM mikrotik_routers WHERE id = ?`, [routerId]);
    if (!r) return res.status(404).json({ error: 'router not found' });

    // Let caller override the fields stored on the router row.
    const updates = [];
    if (b.radius_nas_ip !== undefined)        updates.push(['radius_nas_ip', b.radius_nas_ip]);
    if (b.radius_secret !== undefined)        updates.push(['radius_secret', b.radius_secret]);
    if (b.radius_nas_shortname !== undefined) updates.push(['radius_nas_shortname', b.radius_nas_shortname]);
    if (b.radius_coa_port !== undefined)      updates.push(['radius_coa_port', Number(b.radius_coa_port) || 3799]);
    if (b.radius_enabled !== undefined)       updates.push(['radius_enabled', b.radius_enabled ? 1 : 0]);
    if (updates.length) {
      const set = updates.map(([k]) => `${k} = ?`).join(', ');
      await db.query(`UPDATE mikrotik_routers SET ${set} WHERE id = ?`, [...updates.map(([, v]) => v), routerId]);
    }

    const fresh = await db.queryOne(`SELECT * FROM mikrotik_routers WHERE id = ?`, [routerId]);
    const out = await radius.upsertNas(fresh);
    res.json({ ok: out.ok !== false, ...out });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/nas/:id', requireAdmin, requireRole('superadmin'), async (req, res) => {
  const row = await db.queryOne('SELECT nasname FROM nas WHERE id = ?', [Number(req.params.id)]);
  if (!row) return res.status(404).json({ error: 'not found' });
  await radius.deleteNas(row.nasname);
  res.json({ ok: true });
});

// ---------- Groups (one per package) ----------
router.get('/groups', requireAdmin, async (_req, res) => {
  const rows = await db.query(
    `SELECT groupname, attribute, op, value FROM radgroupreply ORDER BY groupname, id`
  );
  const groups = {};
  for (const r of rows) {
    if (!groups[r.groupname]) groups[r.groupname] = [];
    groups[r.groupname].push({ attribute: r.attribute, op: r.op, value: r.value });
  }
  res.json({ groups });
});

router.post('/groups/:pkgId', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  const id = Number(req.params.pkgId);
  const pkg = await db.queryOne('SELECT * FROM packages WHERE id = ?', [id]);
  if (!pkg) return res.status(404).json({ error: 'package not found' });
  try {
    const out = await radius.upsertGroup(pkg);
    res.json(out);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------- User re-push ----------
router.post('/users/:subId', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  const id = Number(req.params.subId);
  const sub = await db.queryOne('SELECT * FROM subscriptions WHERE id = ?', [id]);
  if (!sub) return res.status(404).json({ error: 'subscription not found' });
  try {
    const out = await radius.upsertUser(sub);
    res.json(out);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------- Disconnect (CoA / PoD) ----------
router.post('/disconnect', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  const b = req.body || {};
  if (!b.username) return res.status(400).json({ error: 'username required' });
  try {
    if (b.immediate) {
      // Fire directly (do not queue) — used by the "Kick now" button.
      const routerId = Number(b.router_id) || null;
      const r = routerId
        ? await db.queryOne('SELECT * FROM mikrotik_routers WHERE id = ?', [routerId])
        : await db.queryOne('SELECT * FROM mikrotik_routers WHERE is_default = 1 AND is_active = 1 LIMIT 1');
      if (!r) return res.status(400).json({ error: 'no target router' });
      if (!r.radius_nas_ip || !r.radius_secret) {
        return res.status(400).json({ error: 'router missing radius_nas_ip or radius_secret' });
      }
      const out = await radius.sendDisconnect({
        username: b.username,
        nasIp: r.radius_nas_ip,
        secret: r.radius_secret,
        port: r.radius_coa_port || 3799,
      });
      res.json(out);
    } else {
      const out = await radius.queueDisconnect({
        username: b.username,
        routerId: b.router_id ? Number(b.router_id) : null,
        subscriptionId: b.subscription_id ? Number(b.subscription_id) : null,
        reason: b.reason || null,
      });
      res.json(out);
    }
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/queue/drain', requireAdmin, requireRole('superadmin', 'admin'), async (_req, res) => {
  try {
    const out = await radius.drainDisconnectQueue({ batchSize: 100 });
    res.json(out);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/queue', requireAdmin, async (req, res) => {
  const status = req.query.status || null;
  const where = status ? 'WHERE status = ?' : '';
  const params = status ? [status] : [];
  const rows = await db.query(
    `SELECT * FROM radius_disconnect_queue ${where} ORDER BY id DESC LIMIT 200`,
    params
  );
  res.json({ queue: rows });
});

export default router;
