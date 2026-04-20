import { Router } from 'express';
import bcrypt from 'bcrypt';
import db from '../database/pool.js';
import { signAdminToken, requireAdmin, requireRole } from '../middleware/auth.js';
import { approveOrderAndProvision, rejectOrder } from '../services/provisioning.js';
import { getMikrotikClient } from '../mikrotik/client.js';
import configsRouter from './configs.js';
import vpnRouter from './vpn.js';
import scriptsRouter from './scripts.js';
import updatesRouter from './updates.js';
import settingsRouter from './settings.js';
import adminsRouter from './admins.js';
import routersRouter from './routers.js';
import portalRouter from './portal.js';

const router = Router();

// ---------- sub-routers (Phase 4 modules) ----------
router.use('/configs',  configsRouter);
router.use('/vpn',      vpnRouter);
router.use('/scripts',  scriptsRouter);
router.use('/updates',  updatesRouter);
router.use('/settings', settingsRouter);
router.use('/admins',   adminsRouter);
router.use('/routers-admin', routersRouter);

// PUBLIC (no auth) — self-service customer portal
router.use('/portal',   portalRouter);

/** `?routerId=1` selects DB router; omit or invalid → env default (primary). */
function routerIdFromQuery(q) {
  const raw = q?.routerId;
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

// ===================== AUTH =====================
router.post('/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username/password required' });

  const admin = await db.queryOne(
    'SELECT * FROM admins WHERE username = ? AND is_active = 1',
    [username]
  );
  if (!admin) return res.status(401).json({ error: 'invalid credentials' });

  const ok = await bcrypt.compare(password, admin.password_hash);
  if (!ok) return res.status(401).json({ error: 'invalid credentials' });

  await db.query('UPDATE admins SET last_login_at = NOW() WHERE id = ?', [admin.id]);
  const token = signAdminToken(admin);
  res.json({
    token,
    admin: { id: admin.id, username: admin.username, full_name: admin.full_name, role: admin.role },
  });
});

router.get('/auth/me', requireAdmin, (req, res) => res.json(req.admin));

router.post('/auth/change-password', requireAdmin, async (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'current_password and new_password required' });
  }
  if (String(new_password).length < 8) {
    return res.status(400).json({ error: 'new password must be at least 8 characters' });
  }
  const row = await db.queryOne('SELECT password_hash FROM admins WHERE id = ?', [req.admin.id]);
  const ok = await bcrypt.compare(current_password, row.password_hash);
  if (!ok) return res.status(401).json({ error: 'invalid current password' });
  const hash = await bcrypt.hash(new_password, 10);
  await db.query('UPDATE admins SET password_hash = ? WHERE id = ?', [hash, req.admin.id]);
  await db.query(
    `INSERT INTO activity_log (actor_type, actor_id, action, entity_type, entity_id, meta)
     VALUES ('admin', ?, 'password_changed', 'admin', ?, NULL)`,
    [String(req.admin.id), String(req.admin.id)]
  );
  res.json({ ok: true });
});

router.get('/activity-log', requireAdmin, async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const rows = await db.query(
    `SELECT id, actor_type, actor_id, action, entity_type, entity_id, meta, ip_address, created_at
     FROM activity_log ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [limit, offset]
  );
  const cnt = await db.queryOne('SELECT COUNT(*) AS c FROM activity_log');
  res.json({ entries: rows, total: Number(cnt.c) });
});

router.get('/routers', requireAdmin, async (_req, res) => {
  const rows = await db.query(
    `SELECT id, name, host, port, username, use_ssl, is_default, is_active, last_seen_at, created_at, note
     FROM mikrotik_routers ORDER BY is_default DESC, id ASC`
  );
  res.json({ routers: rows });
});

// ===================== DASHBOARD =====================
router.get('/stats', requireAdmin, async (req, res) => {
  const rid = routerIdFromQuery(req.query);
  const [
    customers, activeSubs, pendingOrders, todayRevenue, totalRevenue,
    expiringSoon, onlinePpp, onlineHs,
  ] = await Promise.all([
    db.queryOne(`SELECT COUNT(*) AS c FROM customers`),
    db.queryOne(`SELECT COUNT(*) AS c FROM subscriptions WHERE status = 'active' AND expires_at > NOW()`),
    db.queryOne(`SELECT COUNT(*) AS c FROM orders WHERE status = 'payment_submitted'`),
    db.queryOne(`SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE status = 'verified' AND DATE(verified_at) = CURDATE()`),
    db.queryOne(`SELECT COALESCE(SUM(amount),0) AS s FROM payments WHERE status = 'verified'`),
    db.queryOne(`SELECT COUNT(*) AS c FROM subscriptions WHERE status = 'active' AND expires_at BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 3 DAY)`),
    (async () => { try { const mt = await getMikrotikClient(rid); const a = await mt.listPppActive(); return a.length; } catch { return null; } })(),
    (async () => { try { const mt = await getMikrotikClient(rid); const a = await mt.listHotspotActive(); return a.length; } catch { return null; } })(),
  ]);
  res.json({
    customers: customers.c,
    activeSubscriptions: activeSubs.c,
    pendingOrders: pendingOrders.c,
    todayRevenue: Number(todayRevenue.s),
    totalRevenue: Number(totalRevenue.s),
    expiringSoon: expiringSoon.c,
    onlinePppoe: onlinePpp,
    onlineHotspot: onlineHs,
    routerId: rid,
  });
});

// ===================== CUSTOMERS =====================
router.get('/customers', requireAdmin, async (req, res) => {
  const { q, limit = 50, offset = 0 } = req.query;
  const params = [];
  let where = '';
  if (q) {
    where = `WHERE c.full_name LIKE ? OR c.phone LIKE ? OR c.customer_code LIKE ?`;
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  params.push(Number(limit), Number(offset));
  const rows = await db.query(
    `SELECT c.*,
            COUNT(s.id) AS subscription_count,
            MAX(s.expires_at) AS latest_expiry
     FROM customers c
     LEFT JOIN subscriptions s ON s.customer_id = c.id
     ${where}
     GROUP BY c.id
     ORDER BY c.created_at DESC
     LIMIT ? OFFSET ?`,
    params
  );
  res.json({ customers: rows });
});

router.get('/customers/:id', requireAdmin, async (req, res) => {
  const customer = await db.queryOne('SELECT * FROM customers WHERE id = ?', [req.params.id]);
  if (!customer) return res.status(404).json({ error: 'not found' });
  const subs = await db.query(
    `SELECT s.*, p.name AS package_name, p.code AS package_code
     FROM subscriptions s JOIN packages p ON p.id = s.package_id
     WHERE s.customer_id = ? ORDER BY s.created_at DESC`,
    [req.params.id]
  );
  const orders = await db.query(
    `SELECT o.*, p.name AS package_name FROM orders o JOIN packages p ON p.id = o.package_id
     WHERE o.customer_id = ? ORDER BY o.created_at DESC LIMIT 20`,
    [req.params.id]
  );
  res.json({ customer, subscriptions: subs, orders });
});

// ===================== ORDERS =====================
router.get('/orders', requireAdmin, async (req, res) => {
  const { status, limit = 50, offset = 0 } = req.query;
  const params = [];
  let where = '';
  if (status) { where = 'WHERE o.status = ?'; params.push(status); }
  params.push(Number(limit), Number(offset));
  const rows = await db.query(
    `SELECT o.*, p.name AS package_name, p.code AS package_code, c.full_name AS customer_name
     FROM orders o
     JOIN packages p ON p.id = o.package_id
     LEFT JOIN customers c ON c.id = o.customer_id
     ${where}
     ORDER BY o.created_at DESC
     LIMIT ? OFFSET ?`,
    params
  );
  res.json({ orders: rows });
});

router.post('/orders/:id/approve', requireAdmin, async (req, res) => {
  try {
    const result = await approveOrderAndProvision({
      orderId: Number(req.params.id),
      adminId: req.admin.id,
    });
    res.json(result);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/orders/:id/reject', requireAdmin, async (req, res) => {
  try {
    const result = await rejectOrder({
      orderId: Number(req.params.id),
      adminId: req.admin.id,
      reason: req.body?.reason,
    });
    res.json(result);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ===================== PACKAGES =====================
router.get('/packages', requireAdmin, async (_req, res) => {
  const rows = await db.query('SELECT * FROM packages ORDER BY service_type, sort_order, price');
  res.json({ packages: rows });
});

router.post('/packages', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  const b = req.body || {};
  const required = ['code', 'name', 'service_type', 'rate_up_mbps', 'rate_down_mbps', 'duration_days', 'price', 'mikrotik_profile'];
  for (const k of required) if (b[k] === undefined) return res.status(400).json({ error: `missing ${k}` });

  const r = await db.query(
    `INSERT INTO packages (code, name, service_type, rate_up_mbps, rate_down_mbps, duration_days, price, mikrotik_profile, description, sort_order, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [b.code, b.name, b.service_type, b.rate_up_mbps, b.rate_down_mbps, b.duration_days, b.price, b.mikrotik_profile, b.description || null, b.sort_order || 100]
  );
  res.json({ id: r.insertId });
});

router.patch('/packages/:id', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'invalid id' });
  const allowed = ['name', 'rate_up_mbps', 'rate_down_mbps', 'duration_days', 'price', 'mikrotik_profile', 'description', 'sort_order', 'is_active'];
  const updates = Object.entries(req.body || {}).filter(([k]) => allowed.includes(k));
  if (!updates.length) return res.status(400).json({ error: 'nothing to update' });
  const set = updates.map(([k]) => `${k} = ?`).join(', ');
  await db.query(`UPDATE packages SET ${set} WHERE id = ?`, [...updates.map(([, v]) => v), id]);
  res.json({ ok: true });
});

// ===================== SUBSCRIPTIONS =====================
router.get('/subscriptions', requireAdmin, async (req, res) => {
  const { status, limit = 50, offset = 0 } = req.query;
  const params = [];
  let where = '';
  if (status) { where = 'WHERE s.status = ?'; params.push(status); }
  params.push(Number(limit), Number(offset));
  const rows = await db.query(
    `SELECT s.*, c.full_name, c.phone, c.customer_code, p.name AS package_name, p.code AS package_code
     FROM subscriptions s
     JOIN customers c ON c.id = s.customer_id
     JOIN packages p ON p.id = s.package_id
     ${where}
     ORDER BY s.created_at DESC
     LIMIT ? OFFSET ?`,
    params
  );
  res.json({ subscriptions: rows });
});

// ===================== MIKROTIK LIVE =====================
router.get('/mikrotik/info', requireAdmin, async (req, res) => {
  const rid = routerIdFromQuery(req.query);
  try { const mt = await getMikrotikClient(rid); res.json(await mt.ping()); }
  catch (err) { res.status(503).json({ error: err.message }); }
});

router.get('/mikrotik/active', requireAdmin, async (req, res) => {
  const rid = routerIdFromQuery(req.query);
  try {
    const mt = await getMikrotikClient(rid);
    const [ppp, hs] = await Promise.all([
      mt.listPppActive().catch(() => []),
      mt.listHotspotActive().catch(() => []),
    ]);
    res.json({ pppoe: ppp, hotspot: hs });
  } catch (err) { res.status(503).json({ error: err.message }); }
});

router.get('/mikrotik/interfaces', requireAdmin, async (req, res) => {
  const rid = routerIdFromQuery(req.query);
  try { const mt = await getMikrotikClient(rid); res.json(await mt.interfaces()); }
  catch (err) { res.status(503).json({ error: err.message }); }
});

router.get('/mikrotik/queues', requireAdmin, async (req, res) => {
  const rid = routerIdFromQuery(req.query);
  try {
    const mt = await getMikrotikClient(rid);
    const [simple, tree] = await Promise.all([
      mt.listSimpleQueues().catch(() => []),
      mt.listQueueTree().catch(() => []),
    ]);
    res.json({ simple, tree });
  } catch (err) { res.status(503).json({ error: err.message }); }
});

router.get('/mikrotik/neighbors', requireAdmin, async (req, res) => {
  const rid = routerIdFromQuery(req.query);
  try { const mt = await getMikrotikClient(rid); res.json(await mt.listNeighbors()); }
  catch (err) { res.status(503).json({ error: err.message }); }
});

export default router;
