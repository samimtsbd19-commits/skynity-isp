// ============================================================
// Push notification routes
// ------------------------------------------------------------
// * POST /push/register   — called by the mobile / web client
//     after FCM gives it a token. Auth is optional — unlinked
//     devices are stored anonymously and can be linked later.
// * POST /push/unregister — called on logout / app uninstall.
// * GET  /push/tokens     — admin: list registered devices.
// * POST /push/test       — admin: send a test push to a customer.
// ============================================================

import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { requireAdmin } from '../middleware/auth.js';
import push from '../services/push.js';
import db from '../database/pool.js';
import config from '../config/index.js';

const router = Router();

// ---- public (called by mobile app & PWA) ---------------------
// The caller may be anonymous; if they pass a customer bearer
// token we link the device to that account so we can later push
// to the customer (offers, expiry reminders, etc).
async function peekCustomer(req) {
  try {
    const auth  = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return null;
    const payload = jwt.verify(token, config.JWT_SECRET);
    if (payload.kind !== 'customer') return null;
    return db.queryOne(
      `SELECT id, customer_id, status FROM customer_accounts WHERE id = ?`,
      [payload.id]
    );
  } catch { return null; }
}

router.post('/register', async (req, res) => {
  try {
    const body = req.body || {};
    const acc  = await peekCustomer(req);
    const accountId  = acc?.status === 'approved' ? acc.id : null;
    const customerId = acc?.status === 'approved' ? acc.customer_id : null;

    const out = await push.registerToken({
      token:        body.token,
      platform:     body.platform,
      appVersion:   body.app_version,
      deviceModel:  body.device_model,
      locale:       body.locale,
      accountId, customerId,
    });
    res.json(out);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/unregister', async (req, res) => {
  try {
    await push.unregisterToken((req.body || {}).token);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---- admin --------------------------------------------------
router.get('/tokens', requireAdmin, async (req, res) => {
  const rows = await push.listTokens({ customerId: req.query.customer_id ? Number(req.query.customer_id) : undefined });
  res.json({ tokens: rows });
});

router.post('/test', requireAdmin, async (req, res) => {
  try {
    const { customer_id, title, body, data } = req.body || {};
    const out = customer_id
      ? await push.sendToCustomer(Number(customer_id), { title: title || 'Test', body: body || 'Hello from Skynity', data })
      : await push.sendToAll({ title: title || 'Test', body: body || 'Hello from Skynity', data });
    res.json(out);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
