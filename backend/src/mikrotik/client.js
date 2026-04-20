// ============================================================
// MikroTik RouterOS REST API Client
// ------------------------------------------------------------
// RouterOS 7+ exposes a REST API at  https://<router>/rest/...
// We wrap it in a small class so the rest of the app doesn't
// need to know the URL shape.
//
// Security notes:
//   - Use a dedicated low-privilege user, NOT "admin"
//   - On the router, allow www-ssl only from trusted sources
//   - In production, put the router behind WireGuard and only
//     let the VPS reach it through the tunnel.
// ============================================================

import axios from 'axios';
import https from 'node:https';
import logger from '../utils/logger.js';

export class MikrotikClient {
  constructor({ host, port = 443, username, password, useSsl = true, rejectUnauthorized = false }) {
    this.host = host;
    this.port = port;
    this.username = username;
    this.password = password;
    this.useSsl = useSsl;

    const protocol = useSsl ? 'https' : 'http';
    this.baseURL = `${protocol}://${host}:${port}/rest`;

    this.http = axios.create({
      baseURL: this.baseURL,
      auth: { username, password },
      timeout: 15000,
      httpsAgent: useSsl
        ? new https.Agent({ rejectUnauthorized })
        : undefined,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ---------- low level ----------
  async _request(method, path, data) {
    try {
      const res = await this.http.request({ method, url: path, data });
      return res.data;
    } catch (err) {
      const msg = err.response?.data?.message || err.response?.data?.detail || err.message;
      const status = err.response?.status;
      logger.error({ method, path, status, msg }, 'mikrotik api error');
      const e = new Error(`MikroTik API: ${msg}`);
      e.status = status;
      e.original = err;
      throw e;
    }
  }

  get(path) { return this._request('GET', path); }
  post(path, data) { return this._request('POST', path, data); }
  patch(path, data) { return this._request('PATCH', path, data); }
  put(path, data) { return this._request('PUT', path, data); }
  del(path) { return this._request('DELETE', path); }

  // ---------- health / info ----------
  async ping() {
    // /system/resource is a cheap read that everyone can do
    const r = await this.get('/system/resource');
    return { ok: true, uptime: r.uptime, version: r.version, boardName: r['board-name'] };
  }

  async systemResource() { return this.get('/system/resource'); }
  async systemIdentity() { return this.get('/system/identity'); }
  async interfaces() { return this.get('/interface'); }

  // ---------- PPP / PPPoE ----------
  async listPppSecrets() { return this.get('/ppp/secret'); }

  async findPppSecretByName(name) {
    const all = await this.listPppSecrets();
    return all.find((s) => s.name === name) || null;
  }

  async createPppSecret({ name, password, profile, service = 'pppoe', comment }) {
    return this.put('/ppp/secret', { name, password, profile, service, comment });
  }

  async updatePppSecret(id, patch) {
    return this.patch(`/ppp/secret/${encodeURIComponent(id)}`, patch);
  }

  async deletePppSecret(id) {
    return this.del(`/ppp/secret/${encodeURIComponent(id)}`);
  }

  async disablePppSecret(id) {
    return this.patch(`/ppp/secret/${encodeURIComponent(id)}`, { disabled: 'true' });
  }

  async enablePppSecret(id) {
    return this.patch(`/ppp/secret/${encodeURIComponent(id)}`, { disabled: 'false' });
  }

  async listPppActive() { return this.get('/ppp/active'); }
  async disconnectPppActive(id) { return this.del(`/ppp/active/${encodeURIComponent(id)}`); }

  async listPppProfiles() { return this.get('/ppp/profile'); }

  // ---------- Hotspot ----------
  async listHotspotUsers() { return this.get('/ip/hotspot/user'); }

  async findHotspotUserByName(name) {
    const all = await this.listHotspotUsers();
    return all.find((u) => u.name === name) || null;
  }

  async createHotspotUser({ name, password, profile = 'default', comment, server }) {
    const body = { name, password, profile };
    if (comment) body.comment = comment;
    if (server) body.server = server;
    return this.put('/ip/hotspot/user', body);
  }

  async deleteHotspotUser(id) { return this.del(`/ip/hotspot/user/${encodeURIComponent(id)}`); }
  async disableHotspotUser(id) { return this.patch(`/ip/hotspot/user/${encodeURIComponent(id)}`, { disabled: 'true' }); }
  async enableHotspotUser(id) { return this.patch(`/ip/hotspot/user/${encodeURIComponent(id)}`, { disabled: 'false' }); }

  async listHotspotActive() { return this.get('/ip/hotspot/active'); }
  async kickHotspotActive(id) { return this.del(`/ip/hotspot/active/${encodeURIComponent(id)}`); }

  async listHotspotUserProfiles() { return this.get('/ip/hotspot/user/profile'); }

  // ---------- DHCP ----------
  async listDhcpLeases() { return this.get('/ip/dhcp-server/lease'); }

  // ---------- Queues ----------
  async listSimpleQueues() { return this.get('/queue/simple'); }
  async listQueueTree() { return this.get('/queue/tree'); }

  // ---------- Neighbors ----------
  async listNeighbors() { return this.get('/ip/neighbor'); }
}

// ---------- factory that reads credentials from DB ----------
import db from '../database/pool.js';
import config from '../config/index.js';
import { decrypt } from '../utils/crypto.js';

/**
 * Get a MikroTik client for a given router id (defaults to env config).
 * In Phase 1 we read from env so admins can bootstrap without DB entry.
 */
export async function getMikrotikClient(routerId = null) {
  if (!routerId) {
    // bootstrap: use env
    return new MikrotikClient({
      host: config.MIKROTIK_HOST,
      port: config.MIKROTIK_PORT,
      username: config.MIKROTIK_USERNAME,
      password: config.MIKROTIK_PASSWORD,
      useSsl: config.MIKROTIK_USE_SSL,
      rejectUnauthorized: config.MIKROTIK_REJECT_UNAUTHORIZED,
    });
  }

  const router = await db.queryOne('SELECT * FROM mikrotik_routers WHERE id = ? AND is_active = 1', [routerId]);
  if (!router) throw new Error(`Router ${routerId} not found or inactive`);

  return new MikrotikClient({
    host: router.host,
    port: router.port,
    username: router.username,
    password: decrypt(router.password_enc),
    useSsl: !!router.use_ssl,
    rejectUnauthorized: false,
  });
}

export default MikrotikClient;
