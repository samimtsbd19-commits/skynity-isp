import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { Router } from 'express';
import db from '../database/pool.js';
import { requireAdmin, requireRole } from '../middleware/auth.js';

const router = Router();
const pexec = promisify(exec);

router.get('/', requireAdmin, async (_req, res) => {
  const rows = await db.query(`SELECT * FROM access_points ORDER BY id`);
  res.json({ access_points: rows });
});

router.post('/', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'name required' });
  const r = await db.query(
    `INSERT INTO access_points (name, model, mac_address, ip_address, location,
       admin_url, admin_username, admin_password, router_id, uplink_iface,
       ssid_24, ssid_5, guest_enabled, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      b.name, b.model || 'Cudy AX3000', b.mac_address || null, b.ip_address || null,
      b.location || null, b.admin_url || null, b.admin_username || null, b.admin_password || null,
      b.router_id || null, b.uplink_iface || null, b.ssid_24 || null, b.ssid_5 || null,
      b.guest_enabled ? 1 : 0, b.notes || null,
    ]
  );
  res.json({ id: r.insertId });
});

router.patch('/:id', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  const allowed = ['name', 'model', 'mac_address', 'ip_address', 'location', 'admin_url',
    'admin_username', 'admin_password', 'router_id', 'uplink_iface', 'ssid_24', 'ssid_5',
    'guest_enabled', 'notes', 'firmware_version', 'status', 'client_count'];
  const entries = Object.entries(req.body || {}).filter(([k]) => allowed.includes(k));
  if (!entries.length) return res.status(400).json({ error: 'nothing to update' });
  const set = entries.map(([k]) => `${k} = ?`).join(', ');
  await db.query(`UPDATE access_points SET ${set} WHERE id = ?`,
    [...entries.map(([, v]) => v), Number(req.params.id)]);
  res.json({ ok: true });
});

router.delete('/:id', requireAdmin, requireRole('superadmin'), async (req, res) => {
  await db.query('DELETE FROM access_points WHERE id = ?', [Number(req.params.id)]);
  res.json({ ok: true });
});

router.post('/:id/ping', requireAdmin, async (req, res) => {
  const ap = await db.queryOne('SELECT * FROM access_points WHERE id = ?', [Number(req.params.id)]);
  if (!ap) return res.status(404).json({ error: 'not found' });
  if (!ap.ip_address) return res.status(400).json({ error: 'no ip_address set' });
  try {
    const t0 = Date.now();
    await pexec(`ping -c 1 -W 2 ${ap.ip_address}`, { shell: '/bin/sh' });
    const ms = Date.now() - t0;
    await db.query(
      `UPDATE access_points SET status = 'online', last_seen_at = NOW(), last_ping_ms = ? WHERE id = ?`,
      [ms, ap.id]);
    res.json({ ok: true, ms });
  } catch {
    await db.query(
      `UPDATE access_points SET status = 'offline' WHERE id = ?`, [ap.id]);
    res.json({ ok: false, offline: true });
  }
});

export default router;
