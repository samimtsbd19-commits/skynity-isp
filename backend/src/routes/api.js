import { Router } from 'express';
import bcrypt from 'bcrypt';
import db from '../database/pool.js';
import { signAdminToken, requireAdmin, requireRole } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { approveOrderAndProvision, rejectOrder, extendSubscription } from '../services/provisioning.js';
import { getMikrotikClient } from '../mikrotik/client.js';
import configsRouter from './configs.js';
import vpnRouter from './vpn.js';
import scriptsRouter from './scripts.js';
import updatesRouter from './updates.js';
import settingsRouter from './settings.js';
import adminsRouter from './admins.js';
import routersRouter from './routers.js';
import portalRouter from './portal.js';
import vouchersRouter from './vouchers.js';
import notifyRouter from './notify.js';
import customerAccountsRouter from './customerAccounts.js';
import monitoringRouter from './monitoring.js';
import offersRouter from './offers.js';
import suspensionsRouter from './suspensions.js';
import bandwidthRouter from './bandwidth.js';
import pushRouter from './push.js';
import securityRouter from './security.js';
import hotspotRouter from './hotspot.js';
import guideRouter from './guide.js';
import diagnosticsRouter from './diagnostics.js';
import { sendExpiryReminders } from '../jobs/scheduler.js';
import { bandwidthDaily } from '../services/bandwidth.js';
import { renderInvoiceForOrder } from '../services/invoice.js';
import security from '../services/security.js';

const router = Router();

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim().slice(0, 45);
  return String(req.ip || req.socket?.remoteAddress || '').slice(0, 45) || null;
}

// ---------- sub-routers (Phase 4 modules) ----------
router.use('/configs',  configsRouter);
router.use('/vpn',      vpnRouter);
router.use('/scripts',  scriptsRouter);
router.use('/updates',  updatesRouter);
router.use('/settings', settingsRouter);
router.use('/admins',   adminsRouter);
router.use('/routers-admin', routersRouter);
router.use('/vouchers',  vouchersRouter);
router.use('/notify',    notifyRouter);
router.use('/customer-accounts', customerAccountsRouter);
router.use('/monitoring',        monitoringRouter);
router.use('/offers',            offersRouter);
router.use('/suspensions',       suspensionsRouter);
router.use('/bandwidth',         bandwidthRouter);
router.use('/push',              pushRouter);
router.use('/security',          securityRouter);
router.use('/hotspot',           hotspotRouter);
router.use('/guide',             guideRouter);
router.use('/diagnostics',       diagnosticsRouter);

// ------------------------------------------------------------
// Manual "run now" for the expiry-reminder job. Handy right
// after configuring the notification channels for the first time.
// ------------------------------------------------------------
router.post('/jobs/expiry-reminders/run', requireAdmin, async (_req, res) => {
  try { await sendExpiryReminders(); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// PUBLIC (no auth) — self-service customer portal
router.use('/portal',   portalRouter);

// ------------------------------------------------------------
// Invoice (admin side — for any order)
// ------------------------------------------------------------
router.get('/orders/:codeOrId/invoice', requireAdmin, async (req, res) => {
  const html = await renderInvoiceForOrder(req.params.codeOrId);
  if (!html) return res.status(404).send('order not found');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

/** `?routerId=1` selects DB router; omit or invalid → env default (primary). */
function routerIdFromQuery(q) {
  const raw = q?.routerId;
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

// ===================== AUTH =====================
const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many login attempts. Please wait 15 minutes.',
  keyFn: (req) => `login:${req.ip}`,
});

router.post('/auth/login', loginRateLimit, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username/password required' });
  const ip = clientIp(req);
  const ua = String(req.headers['user-agent'] || '').slice(0, 512);

  const admin = await db.queryOne(
    'SELECT * FROM admins WHERE username = ? AND is_active = 1',
    [username]
  );
  if (!admin) {
    await security.logSecurityEvent({
      eventType: 'admin_login_fail',
      severity: 'warning',
      ip, userAgent: ua,
      subject: String(username).slice(0, 255),
      meta: { reason: 'no_such_user' },
    });
    return res.status(401).json({ error: 'invalid credentials' });
  }

  const ok = await bcrypt.compare(password, admin.password_hash);
  if (!ok) {
    await security.logSecurityEvent({
      eventType: 'admin_login_fail',
      severity: 'warning',
      ip, userAgent: ua,
      adminId: admin.id,
      subject: username,
      meta: { reason: 'bad_password' },
    });
    return res.status(401).json({ error: 'invalid credentials' });
  }

  await db.query('UPDATE admins SET last_login_at = NOW() WHERE id = ?', [admin.id]);
  await security.logSecurityEvent({
    eventType: 'admin_login_ok',
    severity: 'info',
    ip, userAgent: ua,
    adminId: admin.id,
    subject: username,
  });
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
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const rows = await db.query(
    `SELECT id, actor_type, actor_id, action, entity_type, entity_id, meta, ip_address, created_at
     FROM activity_log ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`
  );
  const cnt = await db.queryOne('SELECT COUNT(*) AS c FROM activity_log');
  res.json({ entries: rows, total: Number(cnt.c) });
});

router.get('/routers', requireAdmin, async (_req, res) => {
  const rows = await db.query(
    `SELECT id, name, host, port, username, use_ssl, is_default, is_active,
            last_seen_at, created_at, note,
            uplink_interface, uplink_down_mbps, uplink_up_mbps
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

// ============================================================
//  GET /api/stats/revenue?days=30
//
//  Returns:
//    {
//      series:     [{ d: '2026-04-21', revenue: 1234, orders: 3 }, ...],
//      by_package: [{ code, name, revenue, orders }, ...],
//      by_method:  [{ method, revenue, orders }, ...],
//      totals:     { revenue, orders, customers_new }
//    }
//
//  All figures are taken from `payments` rows with status = 'verified'
//  in the last N days (default 30, max 365). The series is densified
//  so every day in the range has a row even when revenue is zero —
//  much nicer for charting than sparse output.
// ============================================================
router.get('/stats/revenue', requireAdmin, async (req, res) => {
  const days = Math.max(1, Math.min(365, Number(req.query.days) || 30));

  const [series, byPackage, byMethod, totals, newCustomers] = await Promise.all([
    db.query(
      `SELECT DATE(verified_at) AS d,
              COALESCE(SUM(amount), 0) AS revenue,
              COUNT(*) AS orders
         FROM payments
        WHERE status = 'verified'
          AND verified_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
        GROUP BY DATE(verified_at)
        ORDER BY d ASC`,
      [days - 1]
    ),
    db.query(
      `SELECT pk.code, pk.name,
              COALESCE(SUM(pm.amount), 0) AS revenue,
              COUNT(pm.id) AS orders
         FROM payments pm
         JOIN orders o  ON o.id  = pm.order_id
         JOIN packages pk ON pk.id = o.package_id
        WHERE pm.status = 'verified'
          AND pm.verified_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
        GROUP BY pk.id
        ORDER BY revenue DESC`,
      [days - 1]
    ),
    db.query(
      `SELECT method,
              COALESCE(SUM(amount), 0) AS revenue,
              COUNT(*) AS orders
         FROM payments
        WHERE status = 'verified'
          AND verified_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
        GROUP BY method
        ORDER BY revenue DESC`,
      [days - 1]
    ),
    db.queryOne(
      `SELECT COALESCE(SUM(amount), 0) AS revenue, COUNT(*) AS orders
         FROM payments
        WHERE status = 'verified'
          AND verified_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)`,
      [days - 1]
    ),
    db.queryOne(
      `SELECT COUNT(*) AS c FROM customers
        WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)`,
      [days - 1]
    ),
  ]);

  // densify: turn the sparse series into one row per calendar day
  const byDate = new Map(
    series.map((r) => [
      new Date(r.d).toISOString().slice(0, 10),
      { revenue: Number(r.revenue), orders: Number(r.orders) },
    ])
  );
  const dense = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
    const key = day.toISOString().slice(0, 10);
    const hit = byDate.get(key);
    dense.push({
      d: key,
      label: day.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
      revenue: hit ? hit.revenue : 0,
      orders:  hit ? hit.orders  : 0,
    });
  }

  res.json({
    days,
    series: dense,
    by_package: byPackage.map((r) => ({ ...r, revenue: Number(r.revenue), orders: Number(r.orders) })),
    by_method:  byMethod.map((r)  => ({ ...r, revenue: Number(r.revenue), orders: Number(r.orders) })),
    totals: {
      revenue: Number(totals.revenue),
      orders:  Number(totals.orders),
      customers_new: Number(newCustomers.c),
    },
  });
});

// ===================== CUSTOMERS =====================
router.get('/customers', requireAdmin, async (req, res) => {
  const { q } = req.query;
  const limitN = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
  const offsetN = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const params = [];
  let where = '';
  if (q) {
    where = `WHERE c.full_name LIKE ? OR c.phone LIKE ? OR c.customer_code LIKE ?`;
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  const rows = await db.query(
    `SELECT c.*,
            COUNT(s.id) AS subscription_count,
            MAX(s.expires_at) AS latest_expiry
     FROM customers c
     LEFT JOIN subscriptions s ON s.customer_id = c.id
     ${where}
     GROUP BY c.id
     ORDER BY c.created_at DESC
     LIMIT ${limitN} OFFSET ${offsetN}`,
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
  const { status } = req.query;
  const limitN = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
  const offsetN = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const params = [];
  let where = '';
  if (status) { where = 'WHERE o.status = ?'; params.push(status); }
  const rows = await db.query(
    `SELECT o.*, p.name AS package_name, p.code AS package_code, c.full_name AS customer_name
     FROM orders o
     JOIN packages p ON p.id = o.package_id
     LEFT JOIN customers c ON c.id = o.customer_id
     ${where}
     ORDER BY o.created_at DESC
     LIMIT ${limitN} OFFSET ${offsetN}`,
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
  const { status } = req.query;
  const limitN = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 500);
  const offsetN = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const params = [];
  let where = '';
  if (status) { where = 'WHERE s.status = ?'; params.push(status); }
  const rows = await db.query(
    `SELECT s.*, c.full_name, c.phone, c.customer_code, p.name AS package_name, p.code AS package_code
     FROM subscriptions s
     JOIN customers c ON c.id = s.customer_id
     JOIN packages p ON p.id = s.package_id
     ${where}
     ORDER BY s.created_at DESC
     LIMIT ${limitN} OFFSET ${offsetN}`,
    params
  );
  res.json({ subscriptions: rows });
});

// POST /subscriptions/:id/extend — admin manually adds N days
router.post('/subscriptions/:id/extend', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'invalid id' });
    const days = parseInt(req.body.days, 10);
    if (!days || days < 1 || days > 3650) return res.status(400).json({ error: 'days must be 1–3650' });
    const note = String(req.body.note || '').slice(0, 200);
    const result = await extendSubscription(id, days, note);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ===================== BANDWIDTH =========================
// Returns a daily aggregate of bytes_in / bytes_out for a
// subscription. The UI renders this as a stacked-bar chart.
router.get('/subscriptions/:id/bandwidth', requireAdmin, async (req, res) => {
  try {
    const rows = await bandwidthDaily(Number(req.params.id), Number(req.query.days) || 14);
    res.json({ days: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
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
