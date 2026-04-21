// ============================================================
// Bandwidth capacity & load-balance dashboard service
// ------------------------------------------------------------
// The key numbers an ISP operator needs to answer
// "am I oversold / am I squeezed right now?":
//
//   * CAPACITY        uplink_down_mbps / uplink_up_mbps on the router
//                     (what Starlink / fiber actually delivers)
//
//   * COMMITTED       SUM(package.rate_down_mbps) over every
//                     currently-active subscription.
//                     e.g. 150 subs × 5 Mbps = 750 Mbps.
//
//   * LIVE            Latest rx_bps / tx_bps on the uplink interface
//                     → actual traffic going through right now.
//
//   * UTILISATION     LIVE / CAPACITY  (≤100% good)
//   * OVERSUB RATIO   COMMITTED / CAPACITY  (>1 = oversold)
//
//   * FAIR SHARE      If N users are online right now and the
//                     capacity is C Mbps, each one can at minimum
//                     get C/N Mbps with PCQ. The "idle-share bonus"
//                     is (C/N - package_speed) when positive.
// ============================================================

import db from '../database/pool.js';
import { getMikrotikClient } from '../mikrotik/client.js';
import { getSetting } from './settings.js';

// ============================================================
// Per-subscription daily totals (used by customer bandwidth chart)
// ============================================================
export async function bandwidthDaily(subscriptionId, days) {
  const d = Math.max(1, Math.min(90, Number(days) || 14));
  const rows = await db.query(
    `SELECT DATE(taken_at) AS day,
            CAST(SUM(delta_in)  AS UNSIGNED) AS bytes_in,
            CAST(SUM(delta_out) AS UNSIGNED) AS bytes_out
       FROM usage_snapshots
      WHERE subscription_id = ?
        AND taken_at >= CURDATE() - INTERVAL ? DAY
      GROUP BY DATE(taken_at)
      ORDER BY day ASC`,
    [subscriptionId, d - 1]
  );
  const byDay = new Map(rows.map((r) => [String(r.day).slice(0, 10), r]));
  const out = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = d - 1; i >= 0; i--) {
    const dt = new Date(today.getTime() - i * 86400000);
    const key = dt.toISOString().slice(0, 10);
    const r = byDay.get(key);
    out.push({
      day: key,
      bytes_in:  Number(r?.bytes_in  || 0),
      bytes_out: Number(r?.bytes_out || 0),
    });
  }
  return out;
}

/**
 * One snapshot for one router.
 * If `routerId` is omitted we use the first is_default router,
 * falling back to the first active one.
 */
export async function getOverview(routerId) {
  const router = await pickRouter(routerId);
  if (!router) return { ok: false, error: 'no active router configured' };

  // --- Capacity --------------------------------------------------
  const capacity = {
    down_mbps: Number(router.uplink_down_mbps) || 0,
    up_mbps:   Number(router.uplink_up_mbps)   || 0,
    interface: router.uplink_interface || null,
  };

  // --- Committed bandwidth: sum of active package speeds ---------
  const commit = await db.queryOne(
    `SELECT
        COUNT(*)                       AS active_subs,
        COALESCE(SUM(p.rate_down_mbps),0) AS down_commit,
        COALESCE(SUM(p.rate_up_mbps),0)   AS up_commit
       FROM subscriptions s
       JOIN packages p ON p.id = s.package_id
      WHERE s.router_id = ?
        AND s.status = 'active'
        AND s.expires_at > NOW()`,
    [router.id]
  );

  // --- Users online right now -----------------------------------
  // "online" = last router metrics snapshot reported them as active,
  // OR last_seen_at is within the last 5 minutes.
  const latest = await db.queryOne(
    `SELECT active_ppp, active_hs, taken_at
       FROM router_metrics
      WHERE router_id = ?
      ORDER BY id DESC LIMIT 1`,
    [router.id]
  );
  const activeNow =
    (Number(latest?.active_ppp) || 0) + (Number(latest?.active_hs) || 0);

  // --- Live uplink traffic ---------------------------------------
  let live = { rx_bps: 0, tx_bps: 0, at: null };
  if (capacity.interface) {
    const row = await db.queryOne(
      `SELECT rx_bps, tx_bps, taken_at
         FROM router_interface_metrics
        WHERE router_id = ? AND interface_name = ?
        ORDER BY id DESC LIMIT 1`,
      [router.id, capacity.interface]
    );
    if (row) {
      live = {
        rx_bps: Number(row.rx_bps) || 0,
        tx_bps: Number(row.tx_bps) || 0,
        at:     row.taken_at,
      };
    }
  }

  // --- Derived metrics -------------------------------------------
  const downCommit   = Number(commit?.down_commit) || 0;
  const upCommit     = Number(commit?.up_commit)   || 0;
  const downLiveMbps = live.rx_bps / 1_000_000;
  const upLiveMbps   = live.tx_bps / 1_000_000;

  const oversub = {
    down: capacity.down_mbps ? downCommit / capacity.down_mbps : 0,
    up:   capacity.up_mbps   ? upCommit   / capacity.up_mbps   : 0,
  };
  const util = {
    down: capacity.down_mbps ? downLiveMbps / capacity.down_mbps : 0,
    up:   capacity.up_mbps   ? upLiveMbps   / capacity.up_mbps   : 0,
  };

  // Fair-share per online user — used to show the "right now
  // you're getting X Mbps even though your plan is Y" on the
  // customer side.
  const fairShare = {
    per_user_down_mbps: activeNow ? capacity.down_mbps / activeNow : capacity.down_mbps,
    per_user_up_mbps:   activeNow ? capacity.up_mbps   / activeNow : capacity.up_mbps,
  };

  // --- Thresholds for UI badges ---------------------------------
  const warnRatio = Number(await getSetting('bandwidth.oversub_warn_ratio')) || 2.5;
  const critRatio = Number(await getSetting('bandwidth.oversub_crit_ratio')) || 4.0;
  const oversubBadge =
    oversub.down >= critRatio ? 'critical' :
    oversub.down >= warnRatio ? 'warning' : 'ok';

  return {
    ok: true,
    router: {
      id: router.id, name: router.name, host: router.host,
    },
    capacity,
    committed: {
      subs: Number(commit?.active_subs) || 0,
      down_mbps: downCommit,
      up_mbps:   upCommit,
    },
    active_now: activeNow,
    live: {
      down_mbps: round(downLiveMbps),
      up_mbps:   round(upLiveMbps),
      at:        live.at,
    },
    utilisation: {
      down_pct: round(util.down * 100),
      up_pct:   round(util.up   * 100),
    },
    oversubscription: {
      down_ratio: round(oversub.down, 2),
      up_ratio:   round(oversub.up,   2),
      badge:      oversubBadge,
      warn_ratio: warnRatio,
      crit_ratio: critRatio,
    },
    fair_share: {
      per_user_down_mbps: round(fairShare.per_user_down_mbps, 1),
      per_user_up_mbps:   round(fairShare.per_user_up_mbps,   1),
    },
  };
}

// ------------------------------------------------------------
// Historical utilisation — last N hours of rx/tx on the uplink
// interface, downsampled to at most 180 points. Used by the
// "Last 24h" chart on the bandwidth page.
// ------------------------------------------------------------
export async function getHistory(routerId, hours = 24) {
  const router = await pickRouter(routerId);
  if (!router || !router.uplink_interface) return [];
  const h = Math.max(1, Math.min(168, Number(hours) || 24));
  const rows = await db.query(
    `SELECT taken_at, rx_bps, tx_bps
       FROM router_interface_metrics
      WHERE router_id = ? AND interface_name = ?
        AND taken_at >= NOW() - INTERVAL ? HOUR
      ORDER BY taken_at ASC`,
    [router.id, router.uplink_interface, h]
  );
  // Downsample to ≤180 points for the chart.
  const max = 180;
  if (rows.length <= max) return rows;
  const step = Math.ceil(rows.length / max);
  return rows.filter((_, i) => i % step === 0);
}

// ------------------------------------------------------------
// Per-user "what am I getting now" snapshot for the customer
// portal. Looks up the customer's subscription, gets their
// package speed, and computes the fair-share bonus they are
// currently entitled to.
// ------------------------------------------------------------
export async function getCustomerShareView(customerId) {
  const show = await getSetting('bandwidth.show_customer_share');
  if (show === false) return { ok: true, enabled: false };

  const sub = await db.queryOne(
    `SELECT s.id, s.router_id, s.status,
            p.name AS package_name, p.rate_down_mbps, p.rate_up_mbps
       FROM subscriptions s
       JOIN packages p ON p.id = s.package_id
      WHERE s.customer_id = ?
        AND s.status = 'active'
        AND s.expires_at > NOW()
      ORDER BY s.expires_at DESC
      LIMIT 1`,
    [customerId]
  );
  if (!sub) return { ok: true, enabled: true, hasSub: false };

  const ov = await getOverview(sub.router_id);
  if (!ov.ok) return { ok: true, enabled: true, hasSub: true, package_rate_mbps: Number(sub.rate_down_mbps), share: null };

  const pkgRate = Number(sub.rate_down_mbps) || 0;
  const fair    = ov.fair_share.per_user_down_mbps || 0;
  const bonus   = Math.max(0, round(fair - pkgRate, 1));

  return {
    ok: true,
    enabled: true,
    hasSub: true,
    package_name: sub.package_name,
    package_rate_mbps: pkgRate,
    fair_share_mbps: fair,
    bonus_mbps: bonus,
    users_online: ov.active_now,
    capacity_mbps: ov.capacity.down_mbps,
  };
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
async function pickRouter(routerId) {
  if (routerId) {
    return db.queryOne('SELECT * FROM mikrotik_routers WHERE id = ? AND is_active = 1', [routerId]);
  }
  const def = await db.queryOne(
    'SELECT * FROM mikrotik_routers WHERE is_active = 1 AND is_default = 1 LIMIT 1'
  );
  if (def) return def;
  return db.queryOne(
    'SELECT * FROM mikrotik_routers WHERE is_active = 1 ORDER BY id ASC LIMIT 1'
  );
}

function round(n, d = 1) {
  const p = Math.pow(10, d);
  return Math.round((Number(n) || 0) * p) / p;
}

// ------------------------------------------------------------
// Read the list of interfaces currently visible on the router —
// used by the router-edit form to pick which one is the uplink.
// ------------------------------------------------------------
export async function listInterfaces(routerId) {
  const mt = await getMikrotikClient(Number(routerId));
  const all = await mt.interfaces();
  return all
    .filter((i) => i.type === 'ether' || i.type === 'vlan' || i.type === 'bridge')
    .map((i) => ({
      name: i.name, type: i.type, running: i.running === 'true',
    }));
}

export default { bandwidthDaily, getOverview, getHistory, getCustomerShareView, listInterfaces };
