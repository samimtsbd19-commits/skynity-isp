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

  // ============================================================
  // Files (uploaded configs / backups on the router itself)
  // ------------------------------------------------------------
  // RouterOS REST doesn't expose raw upload over /rest/file.
  // Instead we use /file/print to list and /file/<id> to read
  // contents. Upload is done indirectly via the /tool/fetch
  // command which instructs the router to pull the file from
  // our VPS over HTTP(S).
  // ============================================================
  async listFiles() { return this.get('/file'); }
  async getFile(id) { return this.get(`/file/${encodeURIComponent(id)}`); }
  async deleteFile(id) { return this.del(`/file/${encodeURIComponent(id)}`); }

  /**
   * Ask the router to fetch a URL into its local filesystem.
   * Returns the tool/fetch result (status/downloaded).
   */
  async fetchFromUrl({ url, dstPath, httpMethod = 'get', keepResult = 'yes' }) {
    return this.post('/tool/fetch', {
      url,
      'dst-path': dstPath,
      'http-method': httpMethod,
      'keep-result': keepResult,
      'check-certificate': 'no',
    });
  }

  /** Run arbitrary RouterOS CLI via /execute endpoint (RouterOS 7.4+). */
  async runCommand(command) {
    return this.post('/execute', { script: command });
  }

  // ============================================================
  // Scripts
  // ============================================================
  async listScripts() { return this.get('/system/script'); }
  async findScriptByName(name) {
    const all = await this.listScripts();
    return all.find((s) => s.name === name) || null;
  }
  async createScript({ name, source, policy = 'read,write,policy,test', dontRequirePermissions = 'no' }) {
    return this.put('/system/script', {
      name,
      source,
      policy,
      'dont-require-permissions': dontRequirePermissions,
    });
  }
  async updateScript(id, patch) { return this.patch(`/system/script/${encodeURIComponent(id)}`, patch); }
  async deleteScript(id) { return this.del(`/system/script/${encodeURIComponent(id)}`); }
  async runScriptByName(name) {
    return this.post('/system/script/run', { '.id': name });
  }
  async runScriptById(id) {
    return this.post('/system/script/run', { '.id': id });
  }

  // ============================================================
  // Import .rsc (after the file has been uploaded/fetched)
  // ============================================================
  async importRscFile(filename) {
    // /import is a CLI-only command; we wrap it via /execute
    return this.runCommand(`/import file-name=${filename}`);
  }

  // ============================================================
  // WireGuard
  // ============================================================
  async listWireguard() { return this.get('/interface/wireguard'); }
  async findWireguardByName(name) {
    const all = await this.listWireguard();
    return all.find((w) => w.name === name) || null;
  }
  async createWireguard({ name, listenPort, privateKey, mtu, comment }) {
    const body = { name };
    if (listenPort != null) body['listen-port'] = String(listenPort);
    if (privateKey) body['private-key'] = privateKey;
    if (mtu != null) body.mtu = String(mtu);
    if (comment) body.comment = comment;
    return this.put('/interface/wireguard', body);
  }
  async updateWireguard(id, patch) { return this.patch(`/interface/wireguard/${encodeURIComponent(id)}`, patch); }
  async deleteWireguard(id) { return this.del(`/interface/wireguard/${encodeURIComponent(id)}`); }
  async enableWireguard(id) { return this.patch(`/interface/wireguard/${encodeURIComponent(id)}`, { disabled: 'false' }); }
  async disableWireguard(id) { return this.patch(`/interface/wireguard/${encodeURIComponent(id)}`, { disabled: 'true' }); }

  async listWireguardPeers() { return this.get('/interface/wireguard/peers'); }
  async createWireguardPeer({ interfaceName, publicKey, presharedKey, allowedAddress, endpointAddress, endpointPort, persistentKeepalive, comment }) {
    const body = { interface: interfaceName, 'public-key': publicKey };
    if (presharedKey) body['preshared-key'] = presharedKey;
    if (allowedAddress) body['allowed-address'] = allowedAddress;
    if (endpointAddress) body['endpoint-address'] = endpointAddress;
    if (endpointPort != null) body['endpoint-port'] = String(endpointPort);
    if (persistentKeepalive != null) body['persistent-keepalive'] = String(persistentKeepalive);
    if (comment) body.comment = comment;
    return this.put('/interface/wireguard/peers', body);
  }
  async updateWireguardPeer(id, patch) { return this.patch(`/interface/wireguard/peers/${encodeURIComponent(id)}`, patch); }
  async deleteWireguardPeer(id) { return this.del(`/interface/wireguard/peers/${encodeURIComponent(id)}`); }

  // ============================================================
  // IPsec
  // ============================================================
  async listIpsecPeers() { return this.get('/ip/ipsec/peer'); }
  async listIpsecIdentities() { return this.get('/ip/ipsec/identity'); }
  async listIpsecPolicies() { return this.get('/ip/ipsec/policy'); }
  async listIpsecActivePeers() { return this.get('/ip/ipsec/active-peers'); }
  async createIpsecPeer({ name, address, exchangeMode = 'ike2', profile = 'default' }) {
    return this.put('/ip/ipsec/peer', { name, address, 'exchange-mode': exchangeMode, profile });
  }
  async createIpsecIdentity({ peer, authMethod, secret }) {
    return this.put('/ip/ipsec/identity', { peer, 'auth-method': authMethod, secret });
  }
  async deleteIpsecPeer(id) { return this.del(`/ip/ipsec/peer/${encodeURIComponent(id)}`); }

  // ============================================================
  // PPTP / L2TP / OpenVPN / SSTP servers
  // ============================================================
  async getPptpServer() { return this.get('/interface/pptp-server/server'); }
  async setPptpServer(patch) { return this.patch('/interface/pptp-server/server', patch); }
  async getL2tpServer() { return this.get('/interface/l2tp-server/server'); }
  async setL2tpServer(patch) { return this.patch('/interface/l2tp-server/server', patch); }
  async getOvpnServer() { return this.get('/interface/ovpn-server/server'); }
  async setOvpnServer(patch) { return this.patch('/interface/ovpn-server/server', patch); }
  async getSstpServer() { return this.get('/interface/sstp-server/server'); }
  async setSstpServer(patch) { return this.patch('/interface/sstp-server/server', patch); }
  async listActiveTunnels() { return this.get('/interface'); }

  // ============================================================
  // RouterOS updates / packages
  // ============================================================
  async checkForUpdates(channel) {
    const body = {};
    if (channel) body.channel = channel;
    return this.post('/system/package/update/check-for-updates', body);
  }
  async getUpdateStatus() { return this.get('/system/package/update'); }
  async downloadUpdate() { return this.post('/system/package/update/download', {}); }
  async installUpdate() { return this.post('/system/package/update/install', {}); }

  async listPackages() { return this.get('/system/package'); }
  async enablePackage(id) { return this.patch(`/system/package/${encodeURIComponent(id)}`, { disabled: 'false' }); }
  async disablePackage(id) { return this.patch(`/system/package/${encodeURIComponent(id)}`, { disabled: 'true' }); }
  async reboot() { return this.post('/system/reboot', {}); }

  // ============================================================
  // Backup / export
  // ============================================================
  async createBackup({ name, password, dontEncrypt = 'no' }) {
    const body = { name };
    if (password) body.password = password;
    if (dontEncrypt === 'yes') body['dont-encrypt'] = 'yes';
    return this.post('/system/backup/save', body);
  }
  async loadBackup({ name, password }) {
    const body = { name };
    if (password) body.password = password;
    return this.post('/system/backup/load', body);
  }
  async exportRsc() {
    // CLI-only, wrap via /execute
    return this.runCommand('/export file=skynity-export');
  }
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
