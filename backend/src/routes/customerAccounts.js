// ============================================================
// /api/customer-accounts — admin moderation of portal signups
// ------------------------------------------------------------
//   GET  /api/customer-accounts?status=pending|approved|all
//   POST /api/customer-accounts/:id/approve
//   POST /api/customer-accounts/:id/reject   { reason }
//   POST /api/customer-accounts/:id/suspend
//   POST /api/customer-accounts/:id/reset-password   { password }
//
// Approving links the portal account to an existing `customers`
// row (by phone) — or creates one if there isn't one yet — so
// that when the customer logs in, they immediately see their
// real orders and subscriptions.
// ============================================================

import { Router } from 'express';
import bcrypt from 'bcrypt';
import db from '../database/pool.js';
import { requireAdmin } from '../middleware/auth.js';
import notifier from '../services/notifier.js';
import * as settings from '../services/settings.js';

const router = Router();
router.use(requireAdmin);

router.get('/', async (req, res) => {
  const status = String(req.query.status || 'pending');
  const where = status === 'all' ? '' : 'WHERE a.status = ?';
  const params = status === 'all' ? [] : [status];
  const rows = await db.query(
    `SELECT a.id, a.full_name, a.phone, a.email, a.status, a.created_at,
            a.approved_at, a.last_login_at, a.reject_reason,
            a.customer_id, c.customer_code
       FROM customer_accounts a
       LEFT JOIN customers c ON c.id = a.customer_id
       ${where}
       ORDER BY a.id DESC
       LIMIT 500`,
    params
  );
  res.json({ accounts: rows });
});

async function generateCustomerCode() {
  const row = await db.queryOne('SELECT COUNT(*) AS c FROM customers');
  const n = (row?.c || 0) + 1;
  return `SKY-${String(n).padStart(5, '0')}`;
}

router.post('/:id/approve', async (req, res) => {
  try {
    const acc = await db.queryOne('SELECT * FROM customer_accounts WHERE id = ?', [req.params.id]);
    if (!acc) return res.status(404).json({ error: 'account not found' });

    // Link or create the matching customer record.
    let customerId = acc.customer_id;
    if (!customerId) {
      const byPhone = await db.queryOne('SELECT id FROM customers WHERE phone = ?', [acc.phone]);
      if (byPhone) {
        customerId = byPhone.id;
      } else {
        const code = await generateCustomerCode();
        const r = await db.query(
          `INSERT INTO customers (customer_code, full_name, phone, email, status)
           VALUES (?, ?, ?, ?, 'active')`,
          [code, acc.full_name, acc.phone, acc.email || null]
        );
        customerId = r.insertId;
      }
    }

    await db.query(
      `UPDATE customer_accounts
          SET status = 'approved', customer_id = ?, approved_at = NOW(), approved_by = ?, reject_reason = NULL
        WHERE id = ?`,
      [customerId, req.admin.id, acc.id]
    );

    // Best effort: tell the customer their account is live.
    const siteName = (await settings.getSetting('site.name')) || 'Skynity';
    notifier.notifyCustomer({
      customerId,
      phone: acc.phone,
      message:
        `✅ Your ${siteName} account is approved.\n` +
        `Log in at the portal to see your subscriptions and manage your package.`,
      purpose: 'custom',
      triggeredBy: req.admin.id,
    }).catch(() => {});

    res.json({ ok: true, customer_id: customerId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/reject', async (req, res) => {
  const reason = String(req.body?.reason || '').trim().slice(0, 255) || null;
  const r = await db.query(
    `UPDATE customer_accounts
        SET status = 'rejected', reject_reason = ?, approved_by = ?
      WHERE id = ?`,
    [reason, req.admin.id, req.params.id]
  );
  if (!r.affectedRows) return res.status(404).json({ error: 'account not found' });
  res.json({ ok: true });
});

router.post('/:id/suspend', async (req, res) => {
  const r = await db.query(
    `UPDATE customer_accounts SET status = 'suspended', approved_by = ? WHERE id = ?`,
    [req.admin.id, req.params.id]
  );
  if (!r.affectedRows) return res.status(404).json({ error: 'account not found' });
  res.json({ ok: true });
});

router.post('/:id/reset-password', async (req, res) => {
  const password = String(req.body?.password || '');
  if (password.length < 6) return res.status(400).json({ error: 'password must be at least 6 chars' });
  const hash = await bcrypt.hash(password, 10);
  const r = await db.query(
    'UPDATE customer_accounts SET password_hash = ? WHERE id = ?',
    [hash, req.params.id]
  );
  if (!r.affectedRows) return res.status(404).json({ error: 'account not found' });
  res.json({ ok: true });
});

export default router;
