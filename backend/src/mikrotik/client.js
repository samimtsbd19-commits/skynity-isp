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

/**
 * MikroTik formats time values with mixed units like "34ms494us" or "1s200ms".
 * Naively stripping non-digits gives "34494" which gets read as 34494 ms —
 * turning a 34 ms ping into an apparent 34-second latency. Parse each unit
 * segment and sum them in milliseconds instead.
 */
export function parseMikrotikTimeMs(s) {
  if (s == null) return null;
  const str = String(s).trim();
  if (!str) return null;
  // Plain number → already ms
  if (/^-?\d+(\.\d+)?$/.test(str)) return Number(str);

  let total = 0;
  let matched = false;
  const re = /(\d+(?:\.\d+)?)(us|ms|s|m|h|d)/g;
  let m;
  while ((m = re.exec(str)) !== null) {
    matched = true;
    const n = Number(m[1]);
    switch (m[2]) {
      case 'us': total += n / 1000;        break;
      case 'ms': total += n;               break;
      case 's':  total += n * 1000;        break;
      case 'm':  total += n * 60_000;      break;
      case 'h':  total += n * 3_600_000;   break;
      case 'd':  total += n * 86_400_000;  break;
    }
  }
  return matched ? total : null;
}

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

  async systemResource()   { return this.get('/system/resource'); }
  async systemIdentity()   { return this.get('/system/identity'); }
  async systemHealth()     { return this.get('/system/health').catch(() => []); }
  async systemRouterboard(){ return this.get('/system/routerboard').catch(() => ({})); }
  async systemLicense()    { return this.get('/system/license').catch(() => ({})); }
  async interfaces()       { return this.get('/interface'); }

  /**
   * Runs `/interface/ethernet/monitor once=yes name=<iface>` on the
   * router. On SFP+ / SFP ports this returns the optical module
   * diagnostics (Rx power, Tx power, temperature, wavelength, …).
   * RouterOS exposes this as a POST on the REST API.
   */
  async ethernetMonitor(name) {
    try {
      const r = await this._request('POST', '/interface/ethernet/monitor', {
        numbers: name, once: 'true',
      });
      return Array.isArray(r) ? r[0] : r;
    } catch { return null; }
  }

  /**
   * Runs `/tool/ping count=N address=<host>`. Because the REST
   * endpoint streams results we ask for a fixed count and average
   * them client-side.
   */
  async pingHost(host, count = 4) {
    try {
      const r = await this._request('POST', '/ping', {
        address: host,
        count: String(count),
      });
      const arr = Array.isArray(r) ? r : [r];
      const hits = arr.filter((x) => x && x.status !== 'timeout' && x['time'] != null);
      const times = hits
        .map((x) => parseMikrotikTimeMs(x.time))
        .filter((n) => n != null && !Number.isNaN(n));
      const lost = Number(arr[arr.length - 1]?.['packet-loss']);
      return {
        sent: count,
        received: hits.length,
        loss_pct: Number.isFinite(lost) ? lost : Math.round(((count - hits.length) / count) * 100),
        rtt_min: times.length ? Math.min(...times) : null,
        rtt_avg: times.length ? times.reduce((a, b) => a + b, 0) / times.length : null,
        rtt_max: times.length ? Math.max(...times) : null,
      };
    } catch (err) {
      return { sent: count, received: 0, loss_pct: 100, rtt_min: null, rtt_avg: null, rtt_max: null, error: err.message };
    }
  }

  // ---------- PPP / PPPoE ----------
  async listPppSecrets() { return this.get('/ppp/secret'); }

  async findPppSecretByName(name) {
    const all = await this.listPppSecrets();
    return all.find((s) => s.name === name) || null;
  }

  async createPppSecret({ name, password, profile, service = 'pppoe', comment, callerId, remoteAddress }) {
    const body = { name, password, profile, service, comment };
    // RouterOS PPP MAC-binding: `caller-id` is checked against the
    // pppoe session's source MAC. Setting this denies any other device.
    if (callerId) body['caller-id'] = callerId;
    // Static IP binding: RouterOS hands exactly this address to the
    // PPPoE session instead of pulling one from the profile's pool.
    if (remoteAddress) body['remote-address'] = remoteAddress;
    return this.put('/ppp/secret', body);
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

  async createHotspotUser({ name, password, profile = 'default', comment, server, macAddress }) {
    const body = { name, password, profile };
    if (comment) body.comment = comment;
    if (server) body.server = server;
    // Hotspot MAC-binding: once set, RouterOS will reject logins
    // from any other MAC with these credentials.
    if (macAddress) body['mac-address'] = macAddress;
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
  async listQueueTree()    { return this.get('/queue/tree'); }

  /**
   * Update the max-limit of a /queue/tree item by comment tag.
   * Used for dynamic PCQ — called by the monitoring service when
   * measured Starlink throughput changes significantly.
   *
   * @param {string} commentTag  e.g. "skynity:pcq:root-dn"
   * @param {number} maxLimitMbps  new max-limit in Mbit/s
   * @returns {{ updated: number }} count of updated rows
   */
  async updateQueueTreeMaxLimit(commentTag, maxLimitMbps) {
    const items = await this.get('/queue/tree');
    const matches = items.filter((q) =>
      String(q.comment || '').includes(commentTag)
    );
    let updated = 0;
    for (const q of matches) {
      try {
        await this.patch(
          `/queue/tree/${encodeURIComponent(q['.id'])}`,
          { 'max-limit': `${Math.round(maxLimitMbps)}M` }
        );
        updated++;
      } catch { /* best-effort */ }
    }
    return { updated };
  }

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
import config, { hasEnvMikrotik } from '../config/index.js';
import { decrypt } from '../utils/crypto.js';

/**
 * Get a MikroTik client for a given router id. Resolution order:
 *   1. If `routerId` provided: look it up in `mikrotik_routers`.
 *   2. Else: use env-configured credentials if present.
 *   3. Else: fall back to the default active router in the DB.
 *   4. Else: throw a helpful error telling the admin to configure one.
 */
export async function getMikrotikClient(routerId = null) {
  if (routerId) {
    const router = await db.queryOne(
      'SELECT * FROM mikrotik_routers WHERE id = ? AND is_active = 1',
      [routerId]
    );
    if (!router) throw new Error(`Router ${routerId} not found or inactive`);
    if (!router.password_enc || router.password_enc === 'placeholder') {
      throw new Error(`Router ${routerId} has no credentials configured yet — open the Routers page and click Edit.`);
    }
    return new MikrotikClient({
      host: router.host,
      port: router.port,
      username: router.username,
      password: decrypt(router.password_enc),
      useSsl: !!router.use_ssl,
      rejectUnauthorized: false,
    });
  }

  if (hasEnvMikrotik) {
    return new MikrotikClient({
      host: config.MIKROTIK_HOST,
      port: config.MIKROTIK_PORT,
      username: config.MIKROTIK_USERNAME,
      password: config.MIKROTIK_PASSWORD,
      useSsl: config.MIKROTIK_USE_SSL,
      rejectUnauthorized: config.MIKROTIK_REJECT_UNAUTHORIZED,
    });
  }

  const def = await db.queryOne(
    'SELECT * FROM mikrotik_routers WHERE is_default = 1 AND is_active = 1 LIMIT 1'
  );
  if (def && def.password_enc && def.password_enc !== 'placeholder') {
    return new MikrotikClient({
      host: def.host,
      port: def.port,
      username: def.username,
      password: decrypt(def.password_enc),
      useSsl: !!def.use_ssl,
      rejectUnauthorized: false,
    });
  }

  throw new Error(
    'No MikroTik router configured. Add one from the web UI (Routers → Add) or set MIKROTIK_HOST/USERNAME/PASSWORD in the environment.'
  );
}

export default MikrotikClient;
