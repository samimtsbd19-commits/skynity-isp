// ============================================================
// Per-subscription VPN tunnel routing
// ------------------------------------------------------------
// Routes a single customer's traffic through a VPN tunnel on
// MikroTik using the classic PBR (policy-based routing) pattern:
//
//   /ip firewall mangle add chain=prerouting src-address=<IP>
//       action=mark-routing new-routing-mark=<mark> passthrough=no
//       comment=SKYNITY-TUNNEL:<sub_id>
//
//   /ip route add dst-address=0.0.0.0/0 gateway=<iface>
//       routing-mark=<mark>
//       comment=SKYNITY-TUNNEL:<mark>
//
// This means only packets from the subscriber's IP go over the
// tunnel; everyone else keeps their normal default route.
//
// Requirements:
//   * subscription must have static_ip set (PPPoE only) — that
//     guarantees the src-address match is stable.
//   * tunnel must be enabled and synced to MikroTik.
// ============================================================

import db from '../database/pool.js';
import logger from '../utils/logger.js';
import { getMikrotikClient } from '../mikrotik/client.js';
import * as vpnTunnels from './vpnTunnels.js';

const COMMENT_PREFIX = 'SKYNITY-TUNNEL';

function markName(tunnel) {
  if (tunnel.routing_mark && /^[A-Za-z0-9._-]+$/.test(tunnel.routing_mark)) {
    return tunnel.routing_mark;
  }
  return `vpn-${String(tunnel.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 32)}`;
}

async function ensureTunnelRoute(mt, tunnel, mark) {
  const gw = tunnel.client_gateway || tunnel.name;  // wg interface name, or explicit gw
  const existing = await mt.get('/ip/route').catch(() => []);
  const hit = existing.find((r) =>
    r['routing-mark'] === mark &&
    (r['dst-address'] === '0.0.0.0/0' || !r['dst-address'])
  );
  if (hit) return hit['.id'];
  const created = await mt.put('/ip/route', {
    'dst-address': '0.0.0.0/0',
    gateway: gw,
    'routing-mark': mark,
    comment: `${COMMENT_PREFIX}:${mark}`,
  });
  return created?.ret || null;
}

// ------------------------------------------------------------
// Apply: route this subscription through the given tunnel.
// ------------------------------------------------------------
export async function assignTunnel(subscriptionId, tunnelId) {
  const sub = await db.queryOne(
    `SELECT s.*, c.full_name, c.customer_code FROM subscriptions s
       JOIN customers c ON c.id = s.customer_id
      WHERE s.id = ?`,
    [Number(subscriptionId)]
  );
  if (!sub) throw new Error('subscription not found');
  if (!sub.static_ip) {
    throw new Error('Subscription must have a static IP before a VPN tunnel can be assigned. Assign one from the customer page.');
  }

  const tunnel = await vpnTunnels.getTunnel(Number(tunnelId));
  if (!tunnel) throw new Error('tunnel not found');
  if (!tunnel.is_enabled) throw new Error('tunnel is disabled — enable it first');

  // Clean any pre-existing rules before adding new ones.
  if (sub.tunnel_id && sub.tunnel_id !== tunnel.id) {
    await clearTunnel(sub.id, { keepDb: true }).catch(() => null);
  }

  const mt = await getMikrotikClient(sub.router_id);
  const mark = markName(tunnel);

  // Make sure the routing-mark has a route.
  await ensureTunnelRoute(mt, tunnel, mark);

  // Add the mangle rule if we don't already have one for this sub.
  const comment = `${COMMENT_PREFIX}:${sub.id}`;
  let mangleId = sub.tunnel_mt_mangle;
  if (mangleId) {
    // Still exists?
    const existing = await mt.get(`/ip/firewall/mangle/${encodeURIComponent(mangleId)}`).catch(() => null);
    if (!existing) mangleId = null;
  }
  if (!mangleId) {
    const created = await mt.put('/ip/firewall/mangle', {
      chain: 'prerouting',
      'src-address': sub.static_ip,
      action: 'mark-routing',
      'new-routing-mark': mark,
      passthrough: 'no',
      comment,
    });
    mangleId = created?.ret || null;
  } else {
    // Update existing rule in case the IP or mark changed.
    await mt.patch(`/ip/firewall/mangle/${encodeURIComponent(mangleId)}`, {
      'src-address': sub.static_ip,
      'new-routing-mark': mark,
      disabled: 'false',
    });
  }

  await db.query(
    `UPDATE subscriptions
        SET tunnel_id = ?, tunnel_mt_mangle = ?, tunnel_mt_route = ?,
            mt_last_sync_at = NOW(), mt_error = NULL
      WHERE id = ?`,
    [tunnel.id, mangleId, mark, sub.id]
  );

  logger.info({
    subscriptionId: sub.id, tunnelId: tunnel.id, mark, mangleId,
  }, 'tunnel assigned to subscription');

  return { ok: true, routing_mark: mark, mangle_id: mangleId };
}

// ------------------------------------------------------------
// Clear: remove the mangle rule for this subscription.
// We keep the shared /ip/route for the routing-mark because
// other subs may still be using the same tunnel.
// ------------------------------------------------------------
export async function clearTunnel(subscriptionId, { keepDb = false } = {}) {
  const sub = await db.queryOne(
    'SELECT * FROM subscriptions WHERE id = ?',
    [Number(subscriptionId)]
  );
  if (!sub) throw new Error('subscription not found');
  if (!sub.tunnel_id && !keepDb) return { ok: true, alreadyCleared: true };

  if (sub.tunnel_mt_mangle) {
    try {
      const mt = await getMikrotikClient(sub.router_id);
      await mt.del(`/ip/firewall/mangle/${encodeURIComponent(sub.tunnel_mt_mangle)}`);
    } catch (err) {
      logger.warn({ err: err.message, subscriptionId: sub.id }, 'tunnel clear: mangle delete failed');
    }
  }

  if (!keepDb) {
    await db.query(
      `UPDATE subscriptions
          SET tunnel_id = NULL, tunnel_mt_mangle = NULL, tunnel_mt_route = NULL
        WHERE id = ?`,
      [sub.id]
    );
  }
  return { ok: true };
}

export default { assignTunnel, clearTunnel };
