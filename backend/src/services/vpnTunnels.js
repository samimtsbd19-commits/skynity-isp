// ============================================================
// VPN Tunnel service
// ------------------------------------------------------------
// Provides CRUD for vpn_tunnels + vpn_peers and syncs them to
// MikroTik. For WireGuard we auto-generate keys if none given,
// store them encrypted, and keep the MikroTik .id alongside so
// later edits map cleanly.
// ============================================================

import db from '../database/pool.js';
import { getMikrotikClient } from '../mikrotik/client.js';
import { encrypt, decrypt } from '../utils/crypto.js';
import { generateWireguardKeypair, buildClientConfig } from '../utils/wireguard.js';
import logger from '../utils/logger.js';

// ---------- tunnels ----------
export async function listTunnels({ routerId, kind } = {}) {
  const params = [];
  const where = [];
  if (routerId) { where.push('router_id = ?'); params.push(routerId); }
  if (kind) { where.push('kind = ?'); params.push(kind); }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  return db.query(
    `SELECT id, router_id, kind, name, is_enabled, listen_port, local_address,
            remote_address, public_key, allowed_ips, persistent_keepalive, mtu,
            auth_method, dh_group, encryption, mt_id, mt_synced, mt_last_sync_at,
            mt_error, last_handshake_at, rx_bytes, tx_bytes, note, created_at, updated_at
     FROM vpn_tunnels ${clause}
     ORDER BY kind, name`,
    params
  );
}

export async function getTunnel(id) {
  return db.queryOne('SELECT * FROM vpn_tunnels WHERE id = ?', [id]);
}

export async function createTunnel({
  routerId, kind, name, listenPort, localAddress, remoteAddress,
  publicKey, privateKey, presharedKey, allowedIps, persistentKeepalive, mtu,
  secret, authMethod, dhGroup, encryption, note,
}) {
  if (!routerId || !kind || !name) throw new Error('routerId, kind, name required');

  // WireGuard: auto-generate keys if not provided
  if (kind === 'wireguard' && !privateKey) {
    const kp = generateWireguardKeypair();
    privateKey = kp.privateKey;
    publicKey = kp.publicKey;
  }

  const r = await db.query(
    `INSERT INTO vpn_tunnels
       (router_id, kind, name, is_enabled, listen_port, local_address, remote_address,
        public_key, private_key_enc, preshared_key_enc, allowed_ips, persistent_keepalive, mtu,
        secret_enc, auth_method, dh_group, encryption, note, mt_synced)
     VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      routerId, kind, name,
      listenPort ?? null, localAddress ?? null, remoteAddress ?? null,
      publicKey ?? null,
      privateKey ? encrypt(privateKey) : null,
      presharedKey ? encrypt(presharedKey) : null,
      allowedIps ?? null, persistentKeepalive ?? null, mtu ?? null,
      secret ? encrypt(secret) : null,
      authMethod ?? null, dhGroup ?? null, encryption ?? null, note ?? null,
    ]
  );
  return r.insertId;
}

export async function syncTunnelToRouter(id) {
  const t = await getTunnel(id);
  if (!t) throw new Error('tunnel not found');
  const mt = await getMikrotikClient(t.router_id);

  try {
    if (t.kind === 'wireguard') {
      const priv = t.private_key_enc ? decrypt(t.private_key_enc) : null;
      const existing = await mt.findWireguardByName(t.name);
      if (existing) {
        const patch = {
          'listen-port': t.listen_port != null ? String(t.listen_port) : existing['listen-port'],
          disabled: t.is_enabled ? 'false' : 'true',
        };
        if (priv) patch['private-key'] = priv;
        if (t.mtu != null) patch.mtu = String(t.mtu);
        await mt.updateWireguard(existing['.id'], patch);
        await db.query(
          `UPDATE vpn_tunnels SET mt_id = ?, mt_synced = 1, mt_last_sync_at = NOW(), mt_error = NULL WHERE id = ?`,
          [existing['.id'], id]
        );
      } else {
        const result = await mt.createWireguard({
          name: t.name,
          listenPort: t.listen_port,
          privateKey: priv,
          mtu: t.mtu,
          comment: `Skynity:${t.name}`,
        });
        const created = await mt.findWireguardByName(t.name);
        await db.query(
          `UPDATE vpn_tunnels SET mt_id = ?, mt_synced = 1, mt_last_sync_at = NOW(), mt_error = NULL WHERE id = ?`,
          [created?.['.id'] || result?.ret || null, id]
        );
      }
    } else if (t.kind === 'pptp') {
      await mt.setPptpServer({
        enabled: t.is_enabled ? 'true' : 'false',
        authentication: 'mschap2',
        'default-profile': 'default-encryption',
      });
      await db.query(`UPDATE vpn_tunnels SET mt_synced = 1, mt_last_sync_at = NOW(), mt_error = NULL WHERE id = ?`, [id]);
    } else if (t.kind === 'l2tp') {
      await mt.setL2tpServer({
        enabled: t.is_enabled ? 'true' : 'false',
        authentication: 'mschap2',
        'ipsec-secret': t.secret_enc ? decrypt(t.secret_enc) : '',
        'use-ipsec': t.secret_enc ? 'yes' : 'no',
      });
      await db.query(`UPDATE vpn_tunnels SET mt_synced = 1, mt_last_sync_at = NOW(), mt_error = NULL WHERE id = ?`, [id]);
    } else if (t.kind === 'ovpn') {
      await mt.setOvpnServer({
        enabled: t.is_enabled ? 'true' : 'false',
        port: t.listen_port != null ? String(t.listen_port) : '1194',
      });
      await db.query(`UPDATE vpn_tunnels SET mt_synced = 1, mt_last_sync_at = NOW(), mt_error = NULL WHERE id = ?`, [id]);
    } else if (t.kind === 'sstp') {
      await mt.setSstpServer({
        enabled: t.is_enabled ? 'true' : 'false',
        port: t.listen_port != null ? String(t.listen_port) : '443',
      });
      await db.query(`UPDATE vpn_tunnels SET mt_synced = 1, mt_last_sync_at = NOW(), mt_error = NULL WHERE id = ?`, [id]);
    } else if (t.kind === 'ipsec') {
      if (t.remote_address) {
        await mt.createIpsecPeer({ name: t.name, address: t.remote_address });
        if (t.secret_enc) {
          await mt.createIpsecIdentity({
            peer: t.name,
            authMethod: t.auth_method || 'pre-shared-key',
            secret: decrypt(t.secret_enc),
          });
        }
      }
      await db.query(`UPDATE vpn_tunnels SET mt_synced = 1, mt_last_sync_at = NOW(), mt_error = NULL WHERE id = ?`, [id]);
    } else {
      throw new Error(`unsupported tunnel kind: ${t.kind}`);
    }
    return { ok: true };
  } catch (err) {
    logger.error({ err: err.message, id }, 'tunnel sync failed');
    await db.query(
      `UPDATE vpn_tunnels SET mt_synced = 0, mt_error = ? WHERE id = ?`,
      [err.message, id]
    );
    throw err;
  }
}

export async function toggleTunnel(id, enabled) {
  const t = await getTunnel(id);
  if (!t) throw new Error('tunnel not found');
  await db.query('UPDATE vpn_tunnels SET is_enabled = ? WHERE id = ?', [enabled ? 1 : 0, id]);
  if (t.kind === 'wireguard' && t.mt_id) {
    const mt = await getMikrotikClient(t.router_id);
    if (enabled) await mt.enableWireguard(t.mt_id); else await mt.disableWireguard(t.mt_id);
  } else {
    try { await syncTunnelToRouter(id); } catch (err) { /* already logged */ }
  }
}

export async function deleteTunnel(id) {
  const t = await getTunnel(id);
  if (!t) return false;
  if (t.kind === 'wireguard' && t.mt_id) {
    try {
      const mt = await getMikrotikClient(t.router_id);
      await mt.deleteWireguard(t.mt_id);
    } catch (err) { logger.warn({ err: err.message }, 'mikrotik delete failed'); }
  }
  await db.query('DELETE FROM vpn_tunnels WHERE id = ?', [id]);
  return true;
}

// ---------- peers (WireGuard) ----------
export async function listPeers(tunnelId) {
  return db.query(
    `SELECT id, tunnel_id, name, customer_id, public_key, endpoint, allowed_address,
            persistent_keepalive, is_enabled, mt_id, mt_synced, mt_error,
            last_handshake_at, rx_bytes, tx_bytes, created_at, updated_at
     FROM vpn_peers WHERE tunnel_id = ? ORDER BY name`,
    [tunnelId]
  );
}

export async function createPeer({ tunnelId, name, customerId, allowedAddress, endpoint, persistentKeepalive }) {
  const tunnel = await getTunnel(tunnelId);
  if (!tunnel || tunnel.kind !== 'wireguard') throw new Error('peer requires a wireguard tunnel');
  const { privateKey, publicKey, presharedKey } = generateWireguardKeypair();
  const r = await db.query(
    `INSERT INTO vpn_peers
       (tunnel_id, name, customer_id, public_key, private_key_enc, preshared_key_enc,
        endpoint, allowed_address, persistent_keepalive, is_enabled, mt_synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0)`,
    [
      tunnelId, name, customerId ?? null,
      publicKey, encrypt(privateKey), encrypt(presharedKey),
      endpoint ?? null, allowedAddress ?? null,
      persistentKeepalive ?? 25,
    ]
  );
  return r.insertId;
}

export async function syncPeerToRouter(id) {
  const peer = await db.queryOne('SELECT * FROM vpn_peers WHERE id = ?', [id]);
  if (!peer) throw new Error('peer not found');
  const tunnel = await getTunnel(peer.tunnel_id);
  if (!tunnel) throw new Error('tunnel missing');
  try {
    const mt = await getMikrotikClient(tunnel.router_id);
    const psk = peer.preshared_key_enc ? decrypt(peer.preshared_key_enc) : null;
    const result = await mt.createWireguardPeer({
      interfaceName: tunnel.name,
      publicKey: peer.public_key,
      presharedKey: psk,
      allowedAddress: peer.allowed_address,
      endpointAddress: peer.endpoint ? peer.endpoint.split(':')[0] : undefined,
      endpointPort: peer.endpoint && peer.endpoint.includes(':') ? Number(peer.endpoint.split(':')[1]) : undefined,
      persistentKeepalive: peer.persistent_keepalive,
      comment: `Skynity:${peer.name}`,
    });
    await db.query(
      `UPDATE vpn_peers SET mt_id = ?, mt_synced = 1, mt_error = NULL WHERE id = ?`,
      [result?.ret || null, id]
    );
    return result;
  } catch (err) {
    await db.query(`UPDATE vpn_peers SET mt_synced = 0, mt_error = ? WHERE id = ?`, [err.message, id]);
    throw err;
  }
}

export async function deletePeer(id) {
  const peer = await db.queryOne('SELECT * FROM vpn_peers WHERE id = ?', [id]);
  if (!peer) return false;
  if (peer.mt_id) {
    const tunnel = await getTunnel(peer.tunnel_id);
    try {
      const mt = await getMikrotikClient(tunnel.router_id);
      await mt.deleteWireguardPeer(peer.mt_id);
    } catch (err) { logger.warn({ err: err.message }, 'peer delete on router failed'); }
  }
  await db.query('DELETE FROM vpn_peers WHERE id = ?', [id]);
  return true;
}

/**
 * Produce a wg-quick client config for a given peer.
 * Assumes the tunnel holds the server-side keys and endpoint.
 */
export async function exportPeerConfig(peerId, { endpointOverride, dns } = {}) {
  const peer = await db.queryOne('SELECT * FROM vpn_peers WHERE id = ?', [peerId]);
  if (!peer) throw new Error('peer not found');
  const tunnel = await getTunnel(peer.tunnel_id);
  if (!tunnel) throw new Error('tunnel missing');
  if (tunnel.kind !== 'wireguard') throw new Error('only wireguard supported');

  const peerPrivateKey = peer.private_key_enc ? decrypt(peer.private_key_enc) : '';
  const psk = peer.preshared_key_enc ? decrypt(peer.preshared_key_enc) : null;
  const endpoint = endpointOverride
    || (tunnel.remote_address
        ? tunnel.remote_address
        : `router:${tunnel.listen_port || 51820}`);

  return buildClientConfig({
    peerPrivateKey,
    peerAddress: peer.allowed_address || '10.88.0.2/32',
    dns: dns || '1.1.1.1',
    serverPublicKey: tunnel.public_key || '',
    presharedKey: psk,
    endpoint,
    allowedIps: '0.0.0.0/0, ::/0',
    keepalive: peer.persistent_keepalive || 25,
  });
}

export default {
  listTunnels, getTunnel, createTunnel, syncTunnelToRouter, toggleTunnel, deleteTunnel,
  listPeers, createPeer, syncPeerToRouter, deletePeer, exportPeerConfig,
};
