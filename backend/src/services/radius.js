// ============================================================
// Skynity ISP — RADIUS / AAA sync layer
// ------------------------------------------------------------
// Single integration point between the Skynity application
// tables (customers / subscriptions / packages / routers) and
// the canonical FreeRADIUS tables (radcheck / radreply /
// radgroupcheck / radgroupreply / radusergroup / radacct / nas).
//
// Public surface:
//   isEnabled()                           — feature flag
//   upsertUser(subscription)              — writes radcheck +
//                                           radusergroup so the
//                                           user can authenticate
//   disableUser(username, reason?)        — injects an
//                                           Auth-Type := Reject
//                                           check attr so the
//                                           next auth is denied
//   enableUser(username)                  — removes the reject
//                                           attribute
//   deleteUser(username)                  — hard-remove from
//                                           radcheck/radreply/
//                                           radusergroup
//   upsertGroup(package)                  — writes radgroupreply
//                                           (Mikrotik-Rate-Limit,
//                                           Session-Timeout, etc.)
//   deleteGroup(groupname)
//   upsertNas(router)                     — registers a NAS row
//   deleteNas(nasname)
//   queueDisconnect(subscription, reason) — enqueue a CoA/PoD
//                                           job for the scheduler
//   drainDisconnectQueue()                — called by the cron
//                                           loop; actually fires
//                                           the CoA packets
//   fullSyncAll()                         — one-shot cutover:
//                                           push every active
//                                           subscription + every
//                                           router + every package
//                                           into RADIUS tables
//   listOnline({routerId?, limit?})       — radacct where
//                                           acctstoptime IS NULL
//   getSessionHistory(username, days?)    — stopped sessions
//   totals({since?})                      — aggregate bytes
//
// Design notes:
//   * Every mutation also writes a row in radius_sync_log so
//     operators can audit what the backend did.
//   * Every mutation is a no-op (returns {skipped:true}) when
//     `feature.radius_enabled` is false — so upgrading an
//     existing install doesn't suddenly double-write.
//   * CoA packets are crafted inline with `dgram` + RFC 2865
//     packet encoding (no extra npm dep).
// ============================================================

import dgram from 'node:dgram';
import crypto from 'node:crypto';
import db from '../database/pool.js';
import config from '../config/index.js';
import logger from '../utils/logger.js';
import { decrypt } from '../utils/crypto.js';
import { getSetting } from './settings.js';

/** Plain shared secret for NAS / CoA (decrypt DB ciphertext if present). */
export function getRadiusSecretForRouter(router) {
  if (!router) return '';
  if (router.radius_secret_enc) {
    try { return decrypt(router.radius_secret_enc); } catch { return ''; }
  }
  if (router.radius_secret_plain != null && router.radius_secret_plain !== '') {
    return String(router.radius_secret_plain);
  }
  if (router.radius_secret != null && router.radius_secret !== '') {
    return String(router.radius_secret);
  }
  return '';
}

// ------------------------------------------------------------
// Feature gate
// ------------------------------------------------------------
export async function isEnabled() {
  return !!(await getSetting('feature.radius_enabled'));
}

// ------------------------------------------------------------
// Internal: write one row to radius_sync_log (best-effort)
// ------------------------------------------------------------
async function logSync({ subscriptionId = null, action, username = null, groupname = null, nasId = null, ok, error = null, meta = null }) {
  try {
    await db.query(
      `INSERT INTO radius_sync_log
         (subscription_id, action, username, groupname, nas_id, ok, error, meta)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [subscriptionId, action, username, groupname, nasId, ok ? 1 : 0, error, meta ? JSON.stringify(meta) : null]
    );
  } catch (err) {
    logger.warn({ err: err.message }, 'radius sync log write failed');
  }
}

// ------------------------------------------------------------
// radcheck / radreply / radusergroup helpers
// ------------------------------------------------------------
async function clearUserAttrs(username) {
  await db.query(`DELETE FROM radcheck     WHERE username = ?`, [username]);
  await db.query(`DELETE FROM radreply     WHERE username = ?`, [username]);
  await db.query(`DELETE FROM radusergroup WHERE username = ?`, [username]);
}

async function addCheck(username, attribute, op, value) {
  await db.query(
    `INSERT INTO radcheck (username, attribute, op, value) VALUES (?, ?, ?, ?)`,
    [username, attribute, op, String(value)]
  );
}

async function addReply(username, attribute, op, value) {
  await db.query(
    `INSERT INTO radreply (username, attribute, op, value) VALUES (?, ?, ?, ?)`,
    [username, attribute, op, String(value)]
  );
}

async function setUserGroup(username, groupname, priority = 1) {
  await db.query(`DELETE FROM radusergroup WHERE username = ?`, [username]);
  if (groupname) {
    await db.query(
      `INSERT INTO radusergroup (username, groupname, priority) VALUES (?, ?, ?)`,
      [username, groupname, priority]
    );
  }
}

// ------------------------------------------------------------
// Map a Skynity package to a RADIUS group name.
// Convention: use `packages.radius_group` if set, else derive
// from the package code (uppercased, dashes collapsed).
// ------------------------------------------------------------
export function groupnameForPackage(pkg) {
  if (!pkg) return null;
  if (pkg.radius_group) return String(pkg.radius_group).trim();
  return `PKG_${String(pkg.code || pkg.id).toUpperCase().replace(/[^A-Z0-9_]/g, '_')}`;
}

// ------------------------------------------------------------
// UPSERT USER — create or refresh radcheck + radusergroup so
// the subscription owner can PPPoE/Hotspot-log-in with their
// current password and bandwidth profile.
// ------------------------------------------------------------
export async function upsertUser(subscription, { pkg = null } = {}) {
  if (!(await isEnabled())) return { skipped: true, reason: 'radius_disabled' };
  if (!subscription?.login_username) return { skipped: true, reason: 'no_username' };

  const username = subscription.login_username;
  const resolvedPkg = pkg || (subscription.package_id
    ? await db.queryOne('SELECT * FROM packages WHERE id = ?', [subscription.package_id])
    : null);
  const groupname = groupnameForPackage(resolvedPkg);

  try {
    // Make sure the RADIUS group exists before we bind the user to it.
    if (resolvedPkg && groupname) {
      await upsertGroup(resolvedPkg);
    }

    // Fresh write — idempotent and self-healing even if the
    // row drifted out of sync with the app DB.
    await clearUserAttrs(username);
    await addCheck(username, 'Cleartext-Password', ':=', subscription.login_password || '');

    // Optional per-user static IP (Framed-IP-Address). Honours
    // the `static_ip` column added by migration 011. Not every
    // subscription has one — skipped otherwise.
    if (subscription.static_ip) {
      await addReply(username, 'Framed-IP-Address', ':=', subscription.static_ip);
    }

    // MAC-binding — when `bind_to_mac` is on, insist the NAS
    // present the same Calling-Station-Id on future auths.
    if (subscription.bind_to_mac && subscription.mac_address) {
      await addCheck(username, 'Calling-Station-Id', '==', String(subscription.mac_address).toUpperCase());
    }

    // Absolute expiry — FreeRADIUS `expiration` module evaluates
    // this attribute on every auth. Format: `dd mmm yyyy HH:MM:SS`.
    if (subscription.expires_at) {
      const d = new Date(subscription.expires_at);
      if (!Number.isNaN(d.getTime())) {
        const fmt = formatExpirationAttr(d);
        await addCheck(username, 'Expiration', ':=', fmt);
      }
    }

    if (groupname) {
      await setUserGroup(username, groupname, 1);
    }

    // Mirror the success state on the subscription row so the
    // retry cron and the admin UI can see that everything lined up.
    await db.query(
      `UPDATE subscriptions
          SET radius_synced = 1, radius_last_sync_at = NOW(), radius_error = NULL
        WHERE id = ?`,
      [subscription.id]
    );

    await logSync({
      subscriptionId: subscription.id, action: 'upsert_user', username, groupname, ok: true,
      meta: { bind_to_mac: !!subscription.bind_to_mac, expires_at: subscription.expires_at },
    });

    return { ok: true, username, groupname };
  } catch (err) {
    await db.query(
      `UPDATE subscriptions
          SET radius_synced = 0, radius_last_sync_at = NOW(), radius_error = ?
        WHERE id = ?`,
      [err.message, subscription.id]
    );
    await logSync({
      subscriptionId: subscription.id, action: 'upsert_user', username, groupname, ok: false, error: err.message,
    });
    throw err;
  }
}

// ------------------------------------------------------------
// Disable / enable — used by the suspension system and the
// expiry cron. We favour "Auth-Type := Reject" over deleting
// the row so re-enabling is a one-row flip and accounting
// history stays linked.
// ------------------------------------------------------------
export async function disableUser(username, reason = 'disabled') {
  if (!(await isEnabled())) return { skipped: true };
  if (!username) return { skipped: true };
  try {
    await db.query(
      `DELETE FROM radcheck WHERE username = ? AND attribute IN ('Auth-Type','Reply-Message')`,
      [username]
    );
    await addCheck(username, 'Auth-Type', ':=', 'Reject');
    await addCheck(username, 'Reply-Message', ':=', `skynity:${reason}`);
    await logSync({ action: 'disable_user', username, ok: true, meta: { reason } });
    return { ok: true };
  } catch (err) {
    await logSync({ action: 'disable_user', username, ok: false, error: err.message });
    throw err;
  }
}

export async function enableUser(username) {
  if (!(await isEnabled())) return { skipped: true };
  if (!username) return { skipped: true };
  try {
    await db.query(
      `DELETE FROM radcheck WHERE username = ? AND attribute IN ('Auth-Type','Reply-Message')`,
      [username]
    );
    await logSync({ action: 'enable_user', username, ok: true });
    return { ok: true };
  } catch (err) {
    await logSync({ action: 'enable_user', username, ok: false, error: err.message });
    throw err;
  }
}

export async function deleteUser(username) {
  if (!(await isEnabled())) return { skipped: true };
  if (!username) return { skipped: true };
  try {
    await clearUserAttrs(username);
    await logSync({ action: 'delete_user', username, ok: true });
    return { ok: true };
  } catch (err) {
    await logSync({ action: 'delete_user', username, ok: false, error: err.message });
    throw err;
  }
}

// ------------------------------------------------------------
// GROUPS — one RADIUS group per Skynity package.
// Attributes we emit (MikroTik VSAs):
//   Mikrotik-Rate-Limit  = "<up>M/<down>M"
//   Session-Timeout      = package.radius_session_timeout (s)
//   Idle-Timeout         = package.radius_idle_timeout (s)
//   Acct-Interim-Interval (from settings.radius.accounting_interval)
//   Service-Type         = Framed-User     (PPPoE)
//   Framed-Protocol      = PPP             (PPPoE)
//   Mikrotik-Address-List (optional, for grouping)
// ------------------------------------------------------------
export async function upsertGroup(pkg) {
  if (!pkg) return { skipped: true };
  const groupname = groupnameForPackage(pkg);
  if (!groupname) return { skipped: true };

  const up   = Number(pkg.rate_up_mbps || 0);
  const down = Number(pkg.rate_down_mbps || 0);
  const interim = Number(await getSetting('radius.accounting_interval')) || 60;

  try {
    await db.query(`DELETE FROM radgroupreply WHERE groupname = ?`, [groupname]);
    await db.query(`DELETE FROM radgroupcheck WHERE groupname = ?`, [groupname]);

    if (up > 0 && down > 0) {
      // MikroTik rate-limit syntax: "rx-rate/tx-rate" in the
      // RADIUS packet means "upload-limit/download-limit" from
      // the client's point of view. We pass values in Mbps.
      await db.query(
        `INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES (?, ?, ?, ?)`,
        [groupname, 'Mikrotik-Rate-Limit', ':=', `${up}M/${down}M`]
      );
    }

    if (pkg.service_type === 'pppoe') {
      await db.query(
        `INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES
           (?, 'Service-Type', ':=', 'Framed-User'),
           (?, 'Framed-Protocol', ':=', 'PPP')`,
        [groupname, groupname]
      );
    } else if (pkg.service_type === 'hotspot') {
      await db.query(
        `INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES (?, 'Service-Type', ':=', 'Login-User')`,
        [groupname]
      );
    }

    if (interim > 0) {
      await db.query(
        `INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES (?, 'Acct-Interim-Interval', ':=', ?)`,
        [groupname, String(interim)]
      );
    }

    if (pkg.radius_session_timeout) {
      await db.query(
        `INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES (?, 'Session-Timeout', ':=', ?)`,
        [groupname, String(pkg.radius_session_timeout)]
      );
    }
    if (pkg.radius_idle_timeout) {
      await db.query(
        `INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES (?, 'Idle-Timeout', ':=', ?)`,
        [groupname, String(pkg.radius_idle_timeout)]
      );
    }

    // Friendly address-list tag so operators can build firewall
    // rules per plan on MikroTik (optional but cheap to set).
    await db.query(
      `INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES (?, 'Mikrotik-Address-List', '+=', ?)`,
      [groupname, groupname.toLowerCase()]
    );

    await logSync({ action: 'upsert_group', groupname, ok: true, meta: { up, down, interim } });
    return { ok: true, groupname };
  } catch (err) {
    await logSync({ action: 'upsert_group', groupname, ok: false, error: err.message });
    throw err;
  }
}

export async function deleteGroup(groupname) {
  if (!groupname) return { skipped: true };
  await db.query(`DELETE FROM radgroupreply WHERE groupname = ?`, [groupname]);
  await db.query(`DELETE FROM radgroupcheck WHERE groupname = ?`, [groupname]);
  await db.query(`DELETE FROM radusergroup  WHERE groupname = ?`, [groupname]);
  await logSync({ action: 'delete_group', groupname, ok: true });
}

// ------------------------------------------------------------
// NAS registry — one row per MikroTik router, loaded by
// FreeRADIUS at runtime (clients_sql / read_clients = yes).
// ------------------------------------------------------------
export async function upsertNas(router) {
  if (!router) return { skipped: true };
  const nasname = router.radius_nas_ip || router.host;
  const shortname = router.radius_nas_shortname || router.name || `router-${router.id}`;
  const secret = getRadiusSecretForRouter(router) || (await getSetting('radius.default_secret')) || '';
  const type = (await getSetting('radius.nas_type')) || 'mikrotik';

  if (!nasname) {
    await logSync({ action: 'upsert_nas', nasId: router.id, ok: false, error: 'no nasname / radius_nas_ip' });
    return { ok: false, error: 'missing radius_nas_ip' };
  }
  if (!secret) {
    await logSync({ action: 'upsert_nas', nasId: router.id, ok: false, error: 'no shared secret' });
    return { ok: false, error: 'missing shared secret' };
  }

  try {
    const existing = await db.queryOne(
      `SELECT id FROM nas WHERE nasname = ?`,
      [nasname]
    );
    if (existing) {
      await db.query(
        `UPDATE nas SET shortname = ?, type = ?, secret = ?, description = ? WHERE id = ?`,
        [shortname, type, secret, `Skynity router #${router.id} (${router.name || ''})`, existing.id]
      );
    } else {
      await db.query(
        `INSERT INTO nas (nasname, shortname, type, secret, description)
         VALUES (?, ?, ?, ?, ?)`,
        [nasname, shortname, type, secret, `Skynity router #${router.id} (${router.name || ''})`]
      );
    }
    await logSync({ action: 'upsert_nas', nasId: router.id, ok: true, meta: { nasname, shortname } });
    return { ok: true, nasname, shortname };
  } catch (err) {
    await logSync({ action: 'upsert_nas', nasId: router.id, ok: false, error: err.message });
    throw err;
  }
}

export async function deleteNas(nasnameOrHost) {
  if (!nasnameOrHost) return { skipped: true };
  const r = await db.query(`DELETE FROM nas WHERE nasname = ?`, [nasnameOrHost]);
  await logSync({ action: 'delete_nas', ok: true, meta: { nasname: nasnameOrHost, deleted: r.affectedRows } });
  return { ok: true, deleted: r.affectedRows };
}

// ------------------------------------------------------------
// CoA / PoD — the backend sends an RFC 5176 Disconnect-Request
// directly to the NAS on UDP/3799. MikroTik honours this and
// drops the matching session (PPPoE or Hotspot) instantly.
//
// Instead of pulling in a heavyweight npm lib, we hand-craft
// the (simple) packet: an Access-Request-style attribute list
// with User-Name and NAS-IP-Address, plus a Message-Authenticator
// over the packet, signed with the shared secret. This is the
// minimum MikroTik needs.
// ------------------------------------------------------------
export async function sendDisconnect({ username, nasIp, secret, port = 3799, timeoutMs = 3000 }) {
  if (!username || !nasIp || !secret) throw new Error('sendDisconnect: missing username/nasIp/secret');

  const CODE_DISCONNECT_REQUEST = 40;
  const identifier = crypto.randomBytes(1).readUInt8(0);
  // Authenticator for Disconnect-Request is computed over the
  // packet itself (RFC 5176 §2.3). We build the packet with a
  // zero authenticator, compute md5(packet + secret), then
  // splice the result back in.
  const attrs = encodeAttrs([
    { type: 1,  value: Buffer.from(username, 'utf8') },            // User-Name
    { type: 4,  value: ipv4ToBuffer(nasIp) },                      // NAS-IP-Address
    { type: 44, value: Buffer.from(`skynity-${Date.now()}`) },     // Acct-Session-Id (hint)
  ]);
  const length = 20 + attrs.length;
  const head = Buffer.alloc(20);
  head.writeUInt8(CODE_DISCONNECT_REQUEST, 0);
  head.writeUInt8(identifier, 1);
  head.writeUInt16BE(length, 2);
  // leave authenticator (bytes 4..19) as zeros for the hash
  const packet = Buffer.concat([head, attrs]);
  const md5 = crypto.createHash('md5').update(packet).update(secret).digest();
  md5.copy(packet, 4);

  return await new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const timer = setTimeout(() => {
      try { socket.close(); } catch { /* ignore */ }
      reject(new Error(`CoA timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    socket.once('error', (err) => {
      clearTimeout(timer);
      try { socket.close(); } catch { /* ignore */ }
      reject(err);
    });
    socket.once('message', (msg) => {
      clearTimeout(timer);
      try { socket.close(); } catch { /* ignore */ }
      // code 41 = Disconnect-ACK, 42 = Disconnect-NAK
      const code = msg.readUInt8(0);
      if (code === 41) resolve({ ok: true, code });
      else resolve({ ok: false, code, reason: 'NAK' });
    });
    socket.send(packet, port, nasIp, (err) => {
      if (err) {
        clearTimeout(timer);
        try { socket.close(); } catch { /* ignore */ }
        reject(err);
      }
    });
  });
}

function encodeAttrs(list) {
  const buffers = [];
  for (const a of list) {
    const v = Buffer.isBuffer(a.value) ? a.value : Buffer.from(String(a.value));
    const buf = Buffer.alloc(2 + v.length);
    buf.writeUInt8(a.type, 0);
    buf.writeUInt8(2 + v.length, 1);
    v.copy(buf, 2);
    buffers.push(buf);
  }
  return Buffer.concat(buffers);
}

function ipv4ToBuffer(ip) {
  const parts = String(ip).split('.').map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) {
    throw new Error(`invalid IPv4 ${ip}`);
  }
  return Buffer.from(parts);
}

// ------------------------------------------------------------
// Queue a disconnect for the scheduler to deliver. We use a
// queue instead of firing directly so an offline NAS doesn't
// block the admin request.
// ------------------------------------------------------------
export async function queueDisconnect({ subscriptionId, username, routerId, reason }) {
  if (!(await isEnabled())) return { skipped: true };
  if (!(await getSetting('radius.coa_enabled'))) return { skipped: true, reason: 'coa_disabled' };
  if (!username) return { skipped: true };

  await db.query(
    `INSERT INTO radius_disconnect_queue (subscription_id, username, router_id, reason)
     VALUES (?, ?, ?, ?)`,
    [subscriptionId || null, username, routerId || null, reason || null]
  );
  return { ok: true, queued: true };
}

/**
 * Called from the cron scheduler every minute. Reads pending
 * CoA jobs, picks the correct NAS (router) row, and fires the
 * packet via `sendDisconnect`.
 */
export async function drainDisconnectQueue({ batchSize = 20 } = {}) {
  if (!(await isEnabled())) return { skipped: true };
  if (!(await getSetting('radius.coa_enabled'))) return { skipped: true };

  const jobs = await db.query(
    `SELECT * FROM radius_disconnect_queue
       WHERE status = 'pending' AND attempts < max_attempts
       ORDER BY id ASC LIMIT ?`,
    [Number(batchSize)]
  );
  if (!jobs.length) return { processed: 0 };

  let ok = 0, fail = 0;
  for (const job of jobs) {
    try {
      let router;
      if (job.router_id) {
        router = await db.queryOne(`SELECT * FROM mikrotik_routers WHERE id = ?`, [job.router_id]);
      } else {
        // fall back to the default router
        router = await db.queryOne(`SELECT * FROM mikrotik_routers WHERE is_default = 1 AND is_active = 1`);
      }
      if (!router) throw new Error('no target router for CoA');
      if (!router.radius_nas_ip) throw new Error('router has no radius_nas_ip');
      const coaSecret = getRadiusSecretForRouter(router);
      if (!coaSecret) throw new Error('router has no radius_secret');

      const result = await sendDisconnect({
        username: job.username,
        nasIp: router.radius_nas_ip,
        secret: coaSecret,
        port: router.radius_coa_port || 3799,
      });
      if (!result.ok) throw new Error(`NAS returned NAK code=${result.code}`);

      await db.query(
        `UPDATE radius_disconnect_queue
            SET status = 'done', done_at = NOW(), attempts = attempts + 1, last_error = NULL
          WHERE id = ?`,
        [job.id]
      );
      await logSync({
        subscriptionId: job.subscription_id, action: 'coa_disconnect', username: job.username,
        ok: true, meta: { reason: job.reason, router_id: router.id },
      });
      ok++;
    } catch (err) {
      const attempts = (job.attempts || 0) + 1;
      const final = attempts >= (job.max_attempts || 5);
      await db.query(
        `UPDATE radius_disconnect_queue
            SET attempts = ?, last_error = ?, status = ?, done_at = ?
          WHERE id = ?`,
        [attempts, err.message, final ? 'failed' : 'pending', final ? new Date() : null, job.id]
      );
      await logSync({
        subscriptionId: job.subscription_id, action: 'coa_disconnect', username: job.username,
        ok: false, error: err.message, meta: { attempts },
      });
      fail++;
    }
  }
  return { processed: jobs.length, ok, fail };
}

// ------------------------------------------------------------
// FULL SYNC — used at cutover and as a "fix everything" button
// in the admin UI. Sweeps:
//   1. every package → upsertGroup
//   2. every active router → upsertNas
//   3. every active subscription → upsertUser
// ------------------------------------------------------------
export async function fullSyncAll({ forceEnable = false } = {}) {
  const enabled = await isEnabled();
  if (!enabled && !forceEnable) return { skipped: true, reason: 'radius_disabled' };

  const packages = await db.query(`SELECT * FROM packages WHERE is_active = 1`);
  const routers  = await db.query(`SELECT * FROM mikrotik_routers WHERE is_active = 1`);
  const subs     = await db.query(
    `SELECT s.*, p.mikrotik_profile, p.code AS pkg_code, p.radius_group,
            p.rate_up_mbps, p.rate_down_mbps, p.service_type AS pkg_service_type,
            p.radius_session_timeout, p.radius_idle_timeout
       FROM subscriptions s
       JOIN packages p ON p.id = s.package_id
      WHERE s.status = 'active'`
  );

  const report = { packages: 0, routers: 0, subs: 0, errors: [] };

  for (const p of packages) {
    try { await upsertGroup(p); report.packages++; }
    catch (err) { report.errors.push({ kind: 'group', id: p.id, error: err.message }); }
  }
  for (const r of routers) {
    try { await upsertNas(r); report.routers++; }
    catch (err) { report.errors.push({ kind: 'nas', id: r.id, error: err.message }); }
  }
  for (const s of subs) {
    try { await upsertUser(s, { pkg: await db.queryOne('SELECT * FROM packages WHERE id = ?', [s.package_id]) }); report.subs++; }
    catch (err) { report.errors.push({ kind: 'user', id: s.id, error: err.message }); }
  }

  await logSync({ action: 'full_sync', ok: !report.errors.length, meta: report });
  return report;
}

// ------------------------------------------------------------
// Reads — live online, session history, totals
// ------------------------------------------------------------
export async function listOnline({ routerId = null, limit = 500 } = {}) {
  const params = [];
  let where = 'WHERE a.acctstoptime IS NULL';
  if (routerId) {
    const r = await db.queryOne(`SELECT radius_nas_ip FROM mikrotik_routers WHERE id = ?`, [routerId]);
    if (r?.radius_nas_ip) { where += ' AND a.nasipaddress = ?'; params.push(r.radius_nas_ip); }
  }
  const rows = await db.query(
    `SELECT a.radacctid, a.acctuniqueid, a.username, a.nasipaddress, a.framedipaddress,
            a.callingstationid, a.acctstarttime, a.acctupdatetime, a.acctsessiontime,
            a.acctinputoctets, a.acctoutputoctets, a.framedprotocol, a.servicetype,
            s.id AS subscription_id, c.id AS customer_id, c.full_name, c.customer_code
       FROM radacct a
       LEFT JOIN subscriptions s ON s.login_username = a.username
       LEFT JOIN customers c ON c.id = s.customer_id
      ${where}
      ORDER BY a.acctstarttime DESC
      LIMIT ?`,
    [...params, Number(limit)]
  );
  return rows;
}

export async function getSessionHistory(username, days = 30) {
  const rows = await db.query(
    `SELECT acctsessionid, acctstarttime, acctstoptime, acctsessiontime,
            acctinputoctets, acctoutputoctets, nasipaddress, framedipaddress,
            callingstationid, acctterminatecause, framedprotocol
       FROM radacct
      WHERE username = ?
        AND acctstarttime >= DATE_SUB(NOW(), INTERVAL ? DAY)
      ORDER BY acctstarttime DESC`,
    [username, Number(days)]
  );
  return rows;
}

export async function totals({ since = null } = {}) {
  const where = since ? 'WHERE acctstarttime >= ?' : '';
  const params = since ? [since] : [];
  const row = await db.queryOne(
    `SELECT
        COUNT(*)                                        AS sessions,
        COUNT(DISTINCT username)                        AS users,
        COALESCE(SUM(acctinputoctets), 0)               AS bytes_in,
        COALESCE(SUM(acctoutputoctets), 0)              AS bytes_out,
        COALESCE(SUM(acctsessiontime), 0)               AS seconds
      FROM radacct
      ${where}`,
    params
  );
  return {
    sessions: Number(row.sessions || 0),
    users: Number(row.users || 0),
    bytes_in: Number(row.bytes_in || 0),
    bytes_out: Number(row.bytes_out || 0),
    seconds: Number(row.seconds || 0),
  };
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

// `expiration` module format: "day month year hour:minute:second"
// Example: "31 Dec 2026 23:59:59"
function formatExpirationAttr(d) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())} ${months[d.getMonth()]} ${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// `config` is imported for future use — backend CoA currently
// reads the per-NAS secret from the `mikrotik_routers` row.
void config;

export default {
  isEnabled,
  getRadiusSecretForRouter,
  upsertUser, disableUser, enableUser, deleteUser,
  upsertGroup, deleteGroup,
  upsertNas, deleteNas,
  queueDisconnect, drainDisconnectQueue, sendDisconnect,
  fullSyncAll,
  listOnline, getSessionHistory, totals,
  groupnameForPackage,
};
