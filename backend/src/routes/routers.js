// ============================================================
// /api/routers — full MikroTik router CRUD (add/edit/test/delete)
// ============================================================

import { Router } from 'express';
import db from '../database/pool.js';
import { requireAdmin, requireRole } from '../middleware/auth.js';
import { encrypt } from '../utils/crypto.js';
import { MikrotikClient, getMikrotikClient } from '../mikrotik/client.js';
import radius from '../services/radius.js';
import { getSetting } from '../services/settings.js';

const router = Router();

router.post('/', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  const b = req.body || {};
  const required = ['name', 'host', 'username', 'password'];
  for (const k of required) if (!b[k]) return res.status(400).json({ error: `missing ${k}` });
  try {
    const radiusEnc = b.radius_secret ? encrypt(b.radius_secret) : null;
    const r = await db.query(
      `INSERT INTO mikrotik_routers
         (name, host, port, username, password_enc, use_ssl, is_default, is_active, note,
          radius_enabled, radius_secret_plain, radius_secret_enc, radius_nas_ip, radius_nas_shortname, radius_coa_port)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, NULL, ?, ?, ?, ?)`,
      [
        b.name, b.host, b.port || 443, b.username,
        encrypt(b.password), b.use_ssl === false ? 0 : 1,
        b.is_default ? 1 : 0, b.note || null,
        b.radius_enabled ? 1 : 0,
        radiusEnc,
        b.radius_nas_ip || null,
        b.radius_nas_shortname || b.name,
        Number(b.radius_coa_port) || 3799,
      ]
    );
    if (b.is_default) {
      await db.query('UPDATE mikrotik_routers SET is_default = 0 WHERE id != ?', [r.insertId]);
    }

    // Auto-register a NAS row if the feature is on and we have
    // everything we need (nas_ip + secret). Silently skipped
    // otherwise — operator can do it later from the RADIUS UI.
    try {
      const autoReg = await getSetting('radius.auto_register_nas');
      if (autoReg && b.radius_nas_ip && b.radius_secret) {
        const fresh = await db.queryOne('SELECT * FROM mikrotik_routers WHERE id = ?', [r.insertId]);
        await radius.upsertNas(fresh);
      }
    } catch { /* non-fatal */ }

    res.json({ id: r.insertId });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.patch('/:id', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  const allowed = [
    'name', 'host', 'port', 'username', 'use_ssl', 'is_default', 'is_active', 'note',
    'radius_enabled', 'radius_nas_ip', 'radius_nas_shortname', 'radius_coa_port',
  ];
  const entries = Object.entries(b).filter(([k]) => allowed.includes(k));
  if (b.password) entries.push(['password_enc', encrypt(b.password)]);
  if (Object.prototype.hasOwnProperty.call(b, 'radius_secret')) {
    if (b.radius_secret) {
      entries.push(['radius_secret_enc', encrypt(b.radius_secret)], ['radius_secret_plain', null]);
    } else {
      entries.push(['radius_secret_enc', null], ['radius_secret_plain', null]);
    }
  }
  if (!entries.length) return res.status(400).json({ error: 'nothing to update' });
  const set = entries.map(([k]) => `${k} = ?`).join(', ');
  await db.query(`UPDATE mikrotik_routers SET ${set} WHERE id = ?`, [...entries.map(([, v]) => v), id]);
  if (b.is_default) await db.query('UPDATE mikrotik_routers SET is_default = 0 WHERE id != ?', [id]);

  // Keep the NAS row in lock-step with the router row whenever
  // anything RADIUS-relevant changed.
  const touchedRadius = ['radius_enabled', 'radius_secret', 'radius_nas_ip', 'radius_nas_shortname', 'radius_coa_port']
    .some((k) => Object.prototype.hasOwnProperty.call(b, k));
  if (touchedRadius) {
    try {
      const fresh = await db.queryOne('SELECT * FROM mikrotik_routers WHERE id = ?', [id]);
      if (fresh?.radius_nas_ip && radius.getRadiusSecretForRouter(fresh)) await radius.upsertNas(fresh);
    } catch { /* non-fatal */ }
  }

  res.json({ ok: true });
});

router.delete('/:id', requireAdmin, requireRole('superadmin'), async (req, res) => {
  await db.query('DELETE FROM mikrotik_routers WHERE id = ?', [Number(req.params.id)]);
  res.json({ ok: true });
});

router.post('/:id/test', requireAdmin, async (req, res) => {
  try {
    const mt = await getMikrotikClient(Number(req.params.id));
    const info = await mt.ping();
    await db.query('UPDATE mikrotik_routers SET last_seen_at = NOW() WHERE id = ?', [Number(req.params.id)]);
    res.json({ ok: true, ...info });
  } catch (err) { res.status(503).json({ ok: false, error: err.message }); }
});

router.post('/test-connection', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  const b = req.body || {};
  try {
    const mt = new MikrotikClient({
      host: b.host,
      port: b.port || 443,
      username: b.username,
      password: b.password,
      useSsl: b.use_ssl !== false,
      rejectUnauthorized: false,
    });
    const info = await mt.ping();
    res.json({ ok: true, ...info });
  } catch (err) { res.status(503).json({ ok: false, error: err.message }); }
});

export default router;
