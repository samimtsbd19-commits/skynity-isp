// ============================================================
// /api/admins — admin user CRUD (superadmin-gated)
// ============================================================

import { Router } from 'express';
import bcrypt from 'bcrypt';
import db from '../database/pool.js';
import { requireAdmin, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAdmin, requireRole('superadmin', 'admin'), async (_req, res) => {
  const rows = await db.query(
    `SELECT id, username, full_name, telegram_id, role, is_active, last_login_at, created_at
     FROM admins ORDER BY id ASC`
  );
  res.json({ admins: rows });
});

router.post('/', requireAdmin, requireRole('superadmin'), async (req, res) => {
  const b = req.body || {};
  const required = ['username', 'password', 'full_name', 'role'];
  for (const k of required) if (!b[k]) return res.status(400).json({ error: `missing ${k}` });
  if (String(b.password).length < 8) return res.status(400).json({ error: 'password must be 8+ chars' });
  if (!['superadmin', 'admin', 'reseller', 'viewer'].includes(b.role)) {
    return res.status(400).json({ error: 'invalid role' });
  }
  const hash = await bcrypt.hash(b.password, 10);
  try {
    const r = await db.query(
      `INSERT INTO admins (username, password_hash, full_name, telegram_id, role, is_active)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [b.username, hash, b.full_name, b.telegram_id || null, b.role, b.is_active === false ? 0 : 1]
    );
    res.json({ id: r.insertId });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.patch('/:id', requireAdmin, requireRole('superadmin'), async (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  const allowed = ['full_name', 'telegram_id', 'role', 'is_active'];
  const entries = Object.entries(b).filter(([k]) => allowed.includes(k));
  if (b.password) {
    if (String(b.password).length < 8) return res.status(400).json({ error: 'password must be 8+ chars' });
    entries.push(['password_hash', await bcrypt.hash(b.password, 10)]);
  }
  if (!entries.length) return res.status(400).json({ error: 'nothing to update' });
  const set = entries.map(([k]) => `${k} = ?`).join(', ');
  await db.query(`UPDATE admins SET ${set} WHERE id = ?`, [...entries.map(([, v]) => v), id]);
  res.json({ ok: true });
});

router.delete('/:id', requireAdmin, requireRole('superadmin'), async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.admin.id) return res.status(400).json({ error: 'cannot delete self' });
  await db.query('DELETE FROM admins WHERE id = ?', [id]);
  res.json({ ok: true });
});

export default router;
