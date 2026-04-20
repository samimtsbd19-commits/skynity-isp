import jwt from 'jsonwebtoken';
import config from '../config/index.js';
import db from '../database/pool.js';

export function signAdminToken(admin) {
  return jwt.sign(
    { id: admin.id, username: admin.username, role: admin.role },
    config.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

export async function requireAdmin(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'missing token' });

    const payload = jwt.verify(token, config.JWT_SECRET);
    const admin = await db.queryOne(
      'SELECT id, username, full_name, role, is_active FROM admins WHERE id = ?',
      [payload.id]
    );
    if (!admin || !admin.is_active) return res.status(401).json({ error: 'invalid admin' });
    req.admin = admin;
    next();
  } catch (err) {
    res.status(401).json({ error: 'invalid token' });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.admin) return res.status(401).json({ error: 'not authenticated' });
    if (!roles.includes(req.admin.role)) return res.status(403).json({ error: 'forbidden' });
    next();
  };
}

// ============================================================
// Customer-account (portal) auth
// ------------------------------------------------------------
// Separate from admin auth. Tokens carry `kind: 'customer'` so
// a leaked token can't be misused against admin endpoints.
// ============================================================
export function signCustomerToken(account) {
  return jwt.sign(
    { id: account.id, customer_id: account.customer_id, kind: 'customer' },
    config.JWT_SECRET,
    { expiresIn: '30d' }
  );
}

export async function requireCustomer(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'missing token' });
    const payload = jwt.verify(token, config.JWT_SECRET);
    if (payload.kind !== 'customer') return res.status(401).json({ error: 'wrong token type' });
    const acc = await db.queryOne(
      `SELECT id, customer_id, full_name, phone, email, status
         FROM customer_accounts WHERE id = ?`,
      [payload.id]
    );
    if (!acc) return res.status(401).json({ error: 'account not found' });
    if (acc.status !== 'approved') {
      return res.status(403).json({ error: `account is ${acc.status}` });
    }
    req.account = acc;
    next();
  } catch (err) {
    res.status(401).json({ error: 'invalid token' });
  }
}

/** For WebSocket: validate JWT string and load admin (or null). */
export async function getAdminFromToken(token) {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.JWT_SECRET);
    const admin = await db.queryOne(
      'SELECT id, username, full_name, role, is_active FROM admins WHERE id = ?',
      [payload.id]
    );
    if (!admin || !admin.is_active) return null;
    return admin;
  } catch {
    return null;
  }
}
