// ============================================================
// Offers service
// ------------------------------------------------------------
// Create / list / broadcast marketing offers.
//
// An "offer" is a piece of admin-authored copy (title + body +
// optional discount label) that:
//
//   - may highlight a particular package on the public portal;
//   - may be broadcast to customers via any of the configured
//     notification channels (Telegram / WhatsApp / SMS);
//   - respects a start/end window, so offers can be pre-scheduled
//     and quietly disappear when they expire.
//
// `broadcast` picks EVERY customer that matches the audience and
// calls `notifier.notifyCustomer` for each. It is throttled so a
// single call cannot accidentally queue thousands of SMS at once.
// ============================================================

import db from '../database/pool.js';
import logger from '../utils/logger.js';
import { getSetting } from './settings.js';
import notifier from './notifier.js';
import push from './push.js';

/* ------------------------------------------------------------
   CRUD
   ------------------------------------------------------------ */

function toMysqlDatetime(v) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function generateOfferCode() {
  const d = new Date();
  const y = String(d.getFullYear()).slice(-2);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `OFR${y}${m}-${rand}`;
}

export async function createOffer(data, adminId) {
  const code = String(data.code || generateOfferCode()).toUpperCase().slice(0, 40);
  const title = String(data.title || '').trim();
  if (!title) throw new Error('title is required');

  const r = await db.query(
    `INSERT INTO offers
       (code, title, description, discount_label, featured_package_id,
        starts_at, ends_at, is_active, audience, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      code, title,
      data.description || null,
      data.discount_label || null,
      data.featured_package_id ? Number(data.featured_package_id) : null,
      toMysqlDatetime(data.starts_at),
      toMysqlDatetime(data.ends_at),
      data.is_active == null ? 1 : (data.is_active ? 1 : 0),
      data.audience || 'all',
      adminId || null,
    ]
  );
  return { id: r.insertId, code };
}

export async function updateOffer(id, patch) {
  const allowed = [
    'title', 'description', 'discount_label', 'featured_package_id',
    'starts_at', 'ends_at', 'is_active', 'audience',
  ];
  const entries = Object.entries(patch || {}).filter(([k]) => allowed.includes(k));
  if (!entries.length) return { ok: true, changed: 0 };
  const set = entries.map(([k]) => `${k} = ?`).join(', ');
  const vals = entries.map(([k, v]) =>
    (k === 'starts_at' || k === 'ends_at') ? toMysqlDatetime(v) : v
  );
  await db.query(`UPDATE offers SET ${set} WHERE id = ?`, [...vals, Number(id)]);
  return { ok: true, changed: entries.length };
}

export async function deleteOffer(id) {
  await db.query('DELETE FROM offers WHERE id = ?', [Number(id)]);
  return { ok: true };
}

export async function listOffers({ includeInactive = false } = {}) {
  const where = includeInactive ? '' : 'WHERE o.is_active = 1';
  return db.query(
    `SELECT o.*, p.code AS package_code, p.name AS package_name,
            a.username AS created_by_username
       FROM offers o
       LEFT JOIN packages p ON p.id = o.featured_package_id
       LEFT JOIN admins a   ON a.id = o.created_by
       ${where}
       ORDER BY o.is_active DESC, o.created_at DESC`
  );
}

export async function getOffer(id) {
  return db.queryOne(
    `SELECT o.*, p.code AS package_code, p.name AS package_name
       FROM offers o
       LEFT JOIN packages p ON p.id = o.featured_package_id
      WHERE o.id = ?`,
    [Number(id)]
  );
}

/* ------------------------------------------------------------
   Public portal — the currently-running offers
   ------------------------------------------------------------ */

/**
 * Offers that should be shown on the public landing page right
 * now. Filters out inactive / scheduled / expired rows so the
 * frontend can just render whatever we return.
 */
export async function listActiveOffers() {
  return db.query(
    `SELECT o.id, o.code, o.title, o.description, o.discount_label,
            o.starts_at, o.ends_at, o.audience,
            p.code AS package_code, p.name AS package_name,
            p.price AS package_price, p.rate_down_mbps, p.duration_days
       FROM offers o
       LEFT JOIN packages p ON p.id = o.featured_package_id
      WHERE o.is_active = 1
        AND (o.starts_at IS NULL OR o.starts_at <= NOW())
        AND (o.ends_at   IS NULL OR o.ends_at   >= NOW())
      ORDER BY o.created_at DESC
      LIMIT 5`
  );
}

/* ------------------------------------------------------------
   Broadcast
   ------------------------------------------------------------ */

/** Build the message text we send to customers. */
function composeOfferMessage(offer, siteName, portalUrl) {
  const parts = [];
  parts.push(`📣 ${siteName}`);
  parts.push('');
  if (offer.discount_label) parts.push(`🔥 ${offer.discount_label}`);
  parts.push(`*${offer.title}*`);
  if (offer.description) parts.push(String(offer.description).slice(0, 400));
  if (offer.package_name) {
    parts.push('');
    parts.push(`📦 ${offer.package_name}${offer.package_price ? ` — ${Number(offer.package_price).toFixed(0)}` : ''}`);
  }
  if (portalUrl) {
    parts.push('');
    parts.push(`👉 ${portalUrl}${offer.code ? `?offer=${offer.code}` : ''}`);
  }
  return parts.join('\n');
}

/**
 * Pick the customers the offer should go to based on the
 * offer's `audience` field.
 */
async function audienceQuery(audience) {
  const base = 'SELECT id, full_name, phone, telegram_id FROM customers';
  switch (audience) {
    case 'new':
      // joined in the last 30 days
      return db.query(`${base} WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)`);
    case 'customers':
      // anyone who has ever been provisioned
      return db.query(`${base} WHERE id IN (SELECT DISTINCT customer_id FROM subscriptions)`);
    case 'all':
    default:
      return db.query(base);
  }
}

/**
 * Send the offer out to every customer in the audience. Each
 * message goes through `notifyCustomer` so the best available
 * channel (based on settings + customer data) is picked.
 *
 * Throttled at ~8 messages/second so an SMS gateway can keep up
 * and we don't flood Telegram.
 */
export async function broadcastOffer(offerId, { adminId, channels, includeInactive = false } = {}) {
  const offer = await getOffer(offerId);
  if (!offer) throw new Error('offer not found');
  if (!includeInactive && !offer.is_active) throw new Error('offer is inactive');

  const [siteName, publicBase] = await Promise.all([
    getSetting('site.name'),
    getSetting('site.public_base_url'),
  ]);
  const portalUrl = publicBase ? `${String(publicBase).replace(/\/$/, '')}/portal` : null;

  const message = composeOfferMessage(offer, siteName || 'Skynity', portalUrl);
  const audience = await audienceQuery(offer.audience);

  const results = { queued: 0, sent: 0, failed: 0, skipped: 0, errors: [] };
  for (const c of audience) {
    if (!c.phone && !c.telegram_id) { results.skipped++; continue; }
    try {
      const r = await notifier.notifyCustomer({
        customerId: c.id,
        phone: c.phone,
        telegramId: c.telegram_id,
        message,
        purpose: 'offer',
        prefer: Array.isArray(channels) && channels.length ? channels[0] : undefined,
        triggeredBy: adminId ? String(adminId) : null,
      });
      results.queued++;
      if (r.ok) results.sent++;
      else { results.failed++; if (results.errors.length < 10) results.errors.push(r.error); }
    } catch (err) {
      results.failed++;
      if (results.errors.length < 10) results.errors.push(err.message);
    }
    // gentle pacing
    await new Promise((r) => setTimeout(r, 120));
  }

  await db.query(
    `UPDATE offers
        SET broadcast_at = NOW(),
            broadcast_channels = ?,
            broadcast_count = broadcast_count + ?
      WHERE id = ?`,
    [Array.isArray(channels) ? channels.join(',') : (channels || 'auto'), results.sent, offer.id]
  );

  // Fan out to mobile / web push as well. Silent no-op when push
  // is disabled or no tokens are registered.
  try {
    const pushResult = await push.sendToAll(
      {
        title: offer.title,
        body: (offer.description || '').slice(0, 120) || 'New offer available',
        data: {
          kind: 'offer',
          offer_id: String(offer.id),
          package_id: offer.featured_package_id ? String(offer.featured_package_id) : '',
          portal_url: portalUrl || '',
        },
      },
      // Limit push to customers in the same audience
      offer.audience === 'active'
        ? 'customer_id IN (SELECT DISTINCT customer_id FROM subscriptions WHERE status = \'active\')'
        : offer.audience === 'expired'
          ? 'customer_id IN (SELECT DISTINCT customer_id FROM subscriptions WHERE status IN (\'expired\',\'suspended\'))'
          : ''
    );
    results.push = pushResult;
  } catch (err) {
    logger.warn({ err: err.message, offerId: offer.id }, 'offer push broadcast failed');
  }

  logger.info({ offerId: offer.id, ...results }, 'offer broadcast complete');
  return results;
}

/** Record a portal visitor seeing a specific offer (best-effort). */
export async function recordOfferView(offerId, { customerId, phone, ip } = {}) {
  try {
    await db.query(
      `INSERT INTO offer_views (offer_id, customer_id, phone, ip_address)
       VALUES (?, ?, ?, ?)`,
      [Number(offerId), customerId || null, phone || null, ip || null]
    );
  } catch (err) {
    logger.debug({ err }, 'recordOfferView failed');
  }
}

export default {
  createOffer,
  updateOffer,
  deleteOffer,
  listOffers,
  getOffer,
  listActiveOffers,
  broadcastOffer,
  recordOfferView,
};
