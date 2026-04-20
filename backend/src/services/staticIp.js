// ============================================================
// Static IP assignment for a PPPoE subscription
// ------------------------------------------------------------
// When an admin wants to give a specific customer a static
// public IP (e.g. for CCTV, VPN, port-forward customers):
//
//   1. Store `static_ip` on the subscriptions row.
//   2. Patch the MikroTik PPP secret so `remote-address = <IP>`.
//      RouterOS will now hand exactly this IP every time the
//      customer dials in, instead of a pool address.
//
// Only PPPoE subscriptions are supported — Hotspot users get
// their address from DHCP.
// ============================================================

import db from '../database/pool.js';
import logger from '../utils/logger.js';
import { getMikrotikClient } from '../mikrotik/client.js';
import { getSetting } from './settings.js';

const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;

function isValidIpv4(s) {
  if (!IPV4_RE.test(s)) return false;
  return s.split('.').every((o) => {
    const n = Number(o);
    return n >= 0 && n <= 255;
  });
}

export async function assignStaticIp(subscriptionId, ip) {
  if (!(await getSetting('feature.static_ip'))) {
    throw new Error('Static IP feature is disabled in settings');
  }
  if (ip && !isValidIpv4(ip)) throw new Error('Invalid IPv4 address');

  const sub = await db.queryOne(
    `SELECT s.*, c.full_name, c.customer_code
       FROM subscriptions s
       JOIN customers c ON c.id = s.customer_id
      WHERE s.id = ?`,
    [Number(subscriptionId)]
  );
  if (!sub) throw new Error('subscription not found');
  if (sub.service_type !== 'pppoe') {
    throw new Error('Static IPs are only supported on PPPoE subscriptions');
  }

  // Guard against the same IP being used by another live sub.
  if (ip) {
    const dupe = await db.queryOne(
      `SELECT id FROM subscriptions
        WHERE static_ip = ? AND id <> ? AND status != 'cancelled'`,
      [ip, sub.id]
    );
    if (dupe) throw new Error(`IP ${ip} is already assigned to subscription #${dupe.id}`);
  }

  // Push to MikroTik first (so DB only reflects what actually happened).
  const mt = await getMikrotikClient(sub.router_id);
  const sec = await mt.findPppSecretByName(sub.login_username);
  if (!sec) throw new Error('PPP secret not found on MikroTik — sync the subscription first');
  await mt.updatePppSecret(sec['.id'], { 'remote-address': ip || '' });

  await db.query(
    `UPDATE subscriptions
        SET static_ip = ?, mt_last_sync_at = NOW(), mt_error = NULL
      WHERE id = ?`,
    [ip || null, sub.id]
  );

  // Kick the active session so the new address takes effect on the
  // next reconnect. RouterOS keeps the old IP for the current session.
  try {
    const active = await mt.listPppActive().catch(() => []);
    const live = active.find((a) => a.name === sub.login_username);
    if (live) await mt.disconnectPppActive(live['.id']).catch(() => null);
  } catch { /* best-effort */ }

  logger.info({ subscriptionId: sub.id, ip }, ip ? 'static IP assigned' : 'static IP cleared');
  return { ok: true, ip: ip || null };
}

export async function clearStaticIp(subscriptionId) {
  return assignStaticIp(subscriptionId, null);
}

export default { assignStaticIp, clearStaticIp };
