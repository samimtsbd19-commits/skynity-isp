// ============================================================
// Vouchers Service
// ------------------------------------------------------------
// Voucher codes that an admin can print and hand out. When a
// customer types a code on /portal/redeem we:
//   1. verify the code, mark it redeemed
//   2. upsert a customer by phone
//   3. create a subscription (package bound to the voucher)
//   4. provision the MikroTik user (best-effort, same logic as
//      order approval — if it fails we still keep the DB row
//      and the cron retry will sync later).
//
// Voucher codes are intentionally readable (no 0/O/1/I) and
// hyphen-grouped so they're easy to type from a printed slip.
// ============================================================

import crypto from 'node:crypto';
import db from '../database/pool.js';
import { getMikrotikClient } from '../mikrotik/client.js';
import { randomUsername, randomPassword } from '../utils/crypto.js';
import { findOrCreateCustomer } from './provisioning.js';
import logger from '../utils/logger.js';

const CODE_ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // readable only

function randSegment(n) {
  const b = crypto.randomBytes(n);
  let s = '';
  for (let i = 0; i < n; i++) s += CODE_ALPHA[b[i] % CODE_ALPHA.length];
  return s;
}

/** Default format: XXXX-XXXX-XXXX  (~36^12 ≈ 4.7 × 10^18 codes) */
export function generateCode(groups = 3, perGroup = 4) {
  const parts = [];
  for (let i = 0; i < groups; i++) parts.push(randSegment(perGroup));
  return parts.join('-');
}

function randomBatchId() {
  return `B-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randSegment(4)}`;
}

/** Create a batch of vouchers for a package. */
export async function createBatch({ packageId, count, expiresAt, name, adminId, note }) {
  const pkg = await db.queryOne('SELECT id, code, name FROM packages WHERE id = ?', [packageId]);
  if (!pkg) throw new Error('package not found');
  const safeCount = Math.max(1, Math.min(1000, Number(count) || 1));
  const batchId = randomBatchId();
  const batchName = (name && String(name).trim().slice(0, 120)) || `${pkg.code} — ${safeCount} codes`;
  const exp = expiresAt ? new Date(expiresAt) : null;

  await db.query(
    `INSERT INTO voucher_batches (id, name, package_id, count, expires_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [batchId, batchName, pkg.id, safeCount, exp, adminId || null]
  );

  // Insert codes in chunks with retries on collisions.
  const created = [];
  for (let i = 0; i < safeCount; i++) {
    let inserted = false;
    for (let attempt = 0; attempt < 3 && !inserted; attempt++) {
      const code = generateCode();
      try {
        const r = await db.query(
          `INSERT INTO vouchers (code, package_id, batch_id, expires_at, created_by, note)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [code, pkg.id, batchId, exp, adminId || null, note || null]
        );
        created.push({ id: r.insertId, code });
        inserted = true;
      } catch (err) {
        if (err.code !== 'ER_DUP_ENTRY') throw err;
      }
    }
    if (!inserted) throw new Error('could not generate a unique code after 3 tries');
  }

  return { batchId, batchName, packageId: pkg.id, count: created.length, vouchers: created };
}

export async function listBatches() {
  return db.query(
    `SELECT b.*,
            p.name AS package_name, p.code AS package_code,
            (SELECT COUNT(*) FROM vouchers v WHERE v.batch_id = b.id AND v.is_redeemed = 1) AS redeemed_count
     FROM voucher_batches b
     JOIN packages p ON p.id = b.package_id
     ORDER BY b.created_at DESC`
  );
}

export async function listVouchers({ batchId, redeemed, limit = 200, offset = 0 } = {}) {
  const where = [];
  const params = [];
  if (batchId) { where.push('v.batch_id = ?'); params.push(batchId); }
  if (redeemed === true || redeemed === 'true')   { where.push('v.is_redeemed = 1'); }
  if (redeemed === false || redeemed === 'false') { where.push('v.is_redeemed = 0'); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(Number(limit), Number(offset));

  return db.query(
    `SELECT v.*, p.name AS package_name, p.code AS package_code, p.price
     FROM vouchers v JOIN packages p ON p.id = v.package_id
     ${w}
     ORDER BY v.created_at DESC, v.id DESC
     LIMIT ? OFFSET ?`,
    params
  );
}

export async function deleteBatch(batchId) {
  await db.query('DELETE FROM vouchers WHERE batch_id = ? AND is_redeemed = 0', [batchId]);
  const remaining = await db.queryOne('SELECT COUNT(*) AS c FROM vouchers WHERE batch_id = ?', [batchId]);
  if (remaining.c === 0) {
    await db.query('DELETE FROM voucher_batches WHERE id = ?', [batchId]);
    return { ok: true, batch_deleted: true };
  }
  return { ok: true, batch_deleted: false, redeemed_remaining: remaining.c };
}

// ------------------------------------------------------------
// Redeem — public/portal flow
// ------------------------------------------------------------
export async function redeemVoucher({ code, fullName, phone }) {
  const cleanCode = String(code || '').toUpperCase().trim();
  if (!cleanCode) throw new Error('code required');

  const voucher = await db.queryOne(
    `SELECT v.*, p.id AS pkg_id, p.code AS pkg_code, p.name AS pkg_name,
            p.service_type, p.mikrotik_profile, p.duration_days, p.rate_up_mbps, p.rate_down_mbps
     FROM vouchers v JOIN packages p ON p.id = v.package_id
     WHERE v.code = ?`,
    [cleanCode]
  );
  if (!voucher) throw new Error('invalid voucher code');
  if (voucher.is_redeemed)                                                 throw new Error('voucher already used');
  if (voucher.expires_at && new Date(voucher.expires_at) < new Date())     throw new Error('voucher expired');

  const customer = await findOrCreateCustomer({
    full_name: (fullName && String(fullName).trim()) || `Voucher ${cleanCode}`,
    phone: String(phone || '').replace(/[^\d+]/g, '').slice(0, 20) || `V${voucher.id}`,
  });

  const login = await generateUniqueLogin(voucher.service_type);
  const password = randomPassword(10);

  const router = await db.queryOne(
    'SELECT id FROM mikrotik_routers WHERE is_default = 1 AND is_active = 1 LIMIT 1'
  );
  let useRouterId = router?.id;
  if (!useRouterId) {
    const any = await db.queryOne('SELECT id FROM mikrotik_routers WHERE is_active = 1 ORDER BY id ASC LIMIT 1');
    useRouterId = any?.id ?? 1;
  }

  const now = new Date();
  const expires = new Date(now.getTime() + voucher.duration_days * 24 * 60 * 60 * 1000);

  const subRes = await db.query(
    `INSERT INTO subscriptions
       (customer_id, package_id, router_id, service_type, login_username, login_password,
        starts_at, expires_at, status, mt_synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', 0)`,
    [customer.id, voucher.pkg_id, useRouterId, voucher.service_type, login, password, now, expires]
  );
  const subscriptionId = subRes.insertId;

  // Push to MikroTik (best-effort, same pattern as provisioning.js)
  let mtSynced = false;
  let mtError  = null;
  try {
    const mt = await getMikrotikClient(useRouterId);
    const comment = `SKYNITY: voucher=${cleanCode} / pkg=${voucher.pkg_code}`;
    if (voucher.service_type === 'pppoe') {
      await mt.createPppSecret({ name: login, password, profile: voucher.mikrotik_profile, service: 'pppoe', comment });
    } else {
      await mt.createHotspotUser({ name: login, password, profile: voucher.mikrotik_profile, comment });
    }
    mtSynced = true;
  } catch (err) {
    mtError = err.message;
    logger.error({ err, subscriptionId }, 'voucher: mikrotik push failed, will retry');
  }

  await db.query(
    `UPDATE subscriptions SET mt_synced = ?, mt_last_sync_at = NOW(), mt_error = ? WHERE id = ?`,
    [mtSynced ? 1 : 0, mtError, subscriptionId]
  );

  await db.query(
    `UPDATE vouchers
       SET is_redeemed = 1, redeemed_by_customer_id = ?, redeemed_by_subscription_id = ?,
           redeemed_by_phone = ?, redeemed_at = NOW()
     WHERE id = ?`,
    [customer.id, subscriptionId, customer.phone, voucher.id]
  );

  await db.query(
    `INSERT INTO activity_log (actor_type, actor_id, action, entity_type, entity_id, meta)
     VALUES ('customer', ?, 'voucher_redeemed', 'voucher', ?, ?)`,
    [customer.phone, String(voucher.id), JSON.stringify({ code: cleanCode, subscriptionId })]
  );

  return {
    ok: true,
    package: { code: voucher.pkg_code, name: voucher.pkg_name, service_type: voucher.service_type },
    subscription: {
      id: subscriptionId,
      login_username: login,
      login_password: password,
      starts_at: now,
      expires_at: expires,
      service_type: voucher.service_type,
      mt_synced: mtSynced,
      mt_error: mtError,
    },
  };
}

async function generateUniqueLogin(serviceType) {
  for (let i = 0; i < 5; i++) {
    const candidate = randomUsername(serviceType === 'pppoe' ? 'p' : 'h');
    const existing = await db.queryOne(
      'SELECT id FROM subscriptions WHERE login_username = ? AND service_type = ?',
      [candidate, serviceType]
    );
    if (!existing) return candidate;
  }
  throw new Error('could not generate unique login');
}

export default {
  generateCode,
  createBatch,
  listBatches,
  listVouchers,
  deleteBatch,
  redeemVoucher,
};
