// ============================================================
// Router monitoring service
// ------------------------------------------------------------
// Gathers CPU / RAM / temperature / interface / SFP / neighbor
// data from every active MikroTik router and stores it in the
// `router_metrics` / `router_interface_metrics` / ... tables.
//
// All functions are *best-effort*: if a router is unreachable
// or one of its endpoints is missing we log and move on.
// ============================================================
import db from '../database/pool.js';
import { getMikrotikClient } from '../mikrotik/client.js';
import { getSetting } from './settings.js';
import logger from '../utils/logger.js';

// ---- helpers ------------------------------------------------
const num = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const int = (v) => {
  const n = num(v);
  return n == null ? null : Math.round(n);
};

/** Safely turn "1w2d3h4m5s" (RouterOS format) into seconds. */
function parseUptime(str) {
  if (!str) return null;
  const re = /(\d+)(w|d|h|m|s)/g;
  let s = 0, m;
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(String(str)))) {
    const n = Number(m[1]);
    switch (m[2]) {
      case 'w': s += n * 604800; break;
      case 'd': s += n * 86400;  break;
      case 'h': s += n * 3600;   break;
      case 'm': s += n * 60;     break;
      default:  s += n;
    }
  }
  return s || null;
}

/** Pick a temperature from the /system/health rows — format and
 *  key-names differ by RouterOS version. */
function pickTemperature(health) {
  if (!Array.isArray(health)) return null;
  const row = health.find((h) => /temperature|^temp$/i.test(h.name || '')) ||
              health.find((h) => h.value && h.type === 'C');
  return row ? num(row.value) : null;
}
function pickVoltage(health) {
  if (!Array.isArray(health)) return null;
  const row = health.find((h) => /voltage/i.test(h.name || ''));
  return row ? num(row.value) : null;
}

// ============================================================
// Sample resource + health for a single router.
// ============================================================
export async function sampleRouter(router) {
  const mt = await getMikrotikClient(router.id);
  try {
    const [res, health, pppActive, hsActive] = await Promise.all([
      mt.systemResource().catch(() => null),
      mt.systemHealth().catch(() => []),
      mt.listPppActive().catch(() => []),
      mt.listHotspotActive().catch(() => []),
    ]);
    if (!res) throw new Error('router returned no /system/resource');

    const memTotal = num(res['total-memory']);
    const memFree  = num(res['free-memory']);
    const memUsed  = memTotal != null && memFree != null ? memTotal - memFree : null;

    const hddTotal = num(res['total-hdd-space']);
    const hddFree  = num(res['free-hdd-space']);
    const hddUsed  = hddTotal != null && hddFree != null ? hddTotal - hddFree : null;

    await db.query(
      `INSERT INTO router_metrics
         (router_id, cpu_load, mem_used, mem_total, hdd_used, hdd_total,
          temperature, voltage, uptime_sec, active_ppp, active_hs)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        router.id,
        int(res['cpu-load']),
        memUsed, memTotal, hddUsed, hddTotal,
        pickTemperature(health),
        pickVoltage(health),
        parseUptime(res.uptime),
        pppActive.length,
        hsActive.length,
      ]
    );

    return { ok: true, cpu: int(res['cpu-load']), activePpp: pppActive.length };
  } catch (err) {
    logger.warn({ err: err.message, router_id: router.id }, 'sampleRouter failed');
    return { ok: false, error: err.message };
  }
}

// ============================================================
// Sample every interface — bytes / link / SFP diagnostics.
// ============================================================
export async function sampleInterfaces(router) {
  const mt = await getMikrotikClient(router.id);
  try {
    const ifaces = await mt.interfaces().catch(() => []);
    for (const i of ifaces) {
      const isEther   = i.type === 'ether';
      const linkOk    = i.running === 'true' ? 1 : i.running === 'false' ? 0 : null;

      let sfp = null;
      if (isEther && linkOk) {
        sfp = await mt.ethernetMonitor(i.name).catch(() => null);
      }

      await db.query(
        `INSERT INTO router_interface_metrics
           (router_id, interface_name, rx_bps, tx_bps, rx_total, tx_total, link_ok,
            sfp_rx_power, sfp_tx_power, sfp_temp, sfp_wavelength)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          router.id,
          i.name,
          num(i['rx-bits-per-second'] || i['rx-byte-rate']),
          num(i['tx-bits-per-second'] || i['tx-byte-rate']),
          num(i['rx-byte']),
          num(i['tx-byte']),
          linkOk,
          sfp ? num(sfp['sfp-rx-power']) : null,
          sfp ? num(sfp['sfp-tx-power']) : null,
          sfp ? num(sfp['sfp-temperature']) : null,
          sfp ? int(sfp['sfp-wavelength']) : null,
        ]
      );
    }
    return { ok: true, count: ifaces.length };
  } catch (err) {
    logger.warn({ err: err.message, router_id: router.id }, 'sampleInterfaces failed');
    return { ok: false, error: err.message };
  }
}

// ============================================================
// Ping admin-configured targets (falls back to default list).
// ============================================================
export async function samplePing(router) {
  const mt = await getMikrotikClient(router.id);
  try {
    let targets = await db.query(
      'SELECT id, host FROM router_ping_targets WHERE router_id = ? AND is_active = 1',
      [router.id]
    );
    if (!targets.length) {
      const def = ((await getSetting('monitoring.ping_default_targets')) || '')
        .split(',').map((s) => s.trim()).filter(Boolean);
      // Auto-create target rows so the UI has something to show.
      for (const host of def) {
        try {
          await db.query(
            'INSERT IGNORE INTO router_ping_targets (router_id, host, label) VALUES (?, ?, ?)',
            [router.id, host, host]
          );
        } catch { /* ignore dupes */ }
      }
      targets = await db.query(
        'SELECT id, host FROM router_ping_targets WHERE router_id = ? AND is_active = 1',
        [router.id]
      );
    }

    for (const t of targets) {
      const r = await mt.pingHost(t.host, 4);
      await db.query(
        `INSERT INTO router_ping_metrics
           (router_id, target_id, rtt_avg_ms, rtt_min_ms, rtt_max_ms, packet_loss)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [router.id, t.id, r.rtt_avg, r.rtt_min, r.rtt_max, r.loss_pct]
      );
    }
    return { ok: true, count: targets.length };
  } catch (err) {
    logger.warn({ err: err.message, router_id: router.id }, 'samplePing failed');
    return { ok: false, error: err.message };
  }
}

// ============================================================
// Refresh the neighbor table (LLDP/CDP discovery).
// ============================================================
export async function sampleNeighbors(router) {
  const mt = await getMikrotikClient(router.id);
  try {
    const neighbors = await mt.listNeighbors().catch(() => []);
    for (const n of neighbors) {
      const mac = n['mac-address'] || null;
      if (!mac) continue;
      await db.query(
        `INSERT INTO router_neighbors
           (router_id, mac_address, identity, platform, board, version, interface_name, address, age_seconds, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
           identity       = VALUES(identity),
           platform       = VALUES(platform),
           board          = VALUES(board),
           version        = VALUES(version),
           interface_name = VALUES(interface_name),
           address        = VALUES(address),
           age_seconds    = VALUES(age_seconds),
           last_seen_at   = NOW()`,
        [
          router.id, mac,
          n.identity || null, n.platform || null, n.board || null,
          n.version || null, n.interface || null, n.address || null,
          int(n.age),
        ]
      );
    }
    return { ok: true, count: neighbors.length };
  } catch (err) {
    logger.warn({ err: err.message, router_id: router.id }, 'sampleNeighbors failed');
    return { ok: false, error: err.message };
  }
}

// ============================================================
// Sample every queue (simple + tree) for bandwidth & drops.
// ------------------------------------------------------------
// RouterOS returns cumulative byte counters for each queue;
// admins care about "how fast is this queue going right now"
// and "how much has it moved today". We keep both by computing
// per-tick deltas and also writing the raw cumulative bytes.
// ============================================================
export async function sampleQueues(router) {
  const enabled = await getSetting('monitoring.queue_poll_enabled');
  if (enabled === false || enabled === 'false') return { ok: true, skipped: 'disabled' };

  const mt = await getMikrotikClient(router.id);
  const limit = Math.max(1, Number(await getSetting('monitoring.queue_poll_limit')) || 50);
  try {
    const [simple, tree] = await Promise.all([
      mt.listSimpleQueues().catch(() => []),
      mt.listQueueTree().catch(() => []),
    ]);

    // RouterOS returns "X/Y" pairs for counters on simple queues
    // (rx / tx). Split once and keep them numeric.
    const splitPair = (v) => {
      if (!v) return [null, null];
      const parts = String(v).split('/');
      return [num(parts[0]), num(parts[1])];
    };

    const rows = [];
    for (const q of simple) {
      const [rxByte, txByte] = splitPair(q.bytes);
      const [pIn, pOut]      = splitPair(q.packets);
      const [dIn, dOut]      = splitPair(q.dropped);
      const [rxBps, txBps]   = splitPair(q.rate);
      rows.push({
        kind: 'simple',
        name: q.name, target: q.target || null, parent: null,
        rxByte, txByte, pIn, pOut, dIn, dOut, rxBps, txBps,
        disabled: q.disabled === 'true' ? 1 : 0,
      });
    }
    for (const q of tree) {
      rows.push({
        kind: 'tree',
        name: q.name, target: null, parent: q.parent || null,
        rxByte: num(q.bytes), txByte: null,
        pIn: num(q.packets), pOut: null,
        dIn: num(q.dropped), dOut: null,
        rxBps: num(q.rate), txBps: null,
        disabled: q.disabled === 'true' ? 1 : 0,
      });
    }

    // Rank by current rate so busy routers don't explode the table.
    rows.sort((a, b) => (Number(b.rxBps || 0) + Number(b.txBps || 0))
                     - (Number(a.rxBps || 0) + Number(a.txBps || 0)));
    const keep = rows.slice(0, limit);

    for (const r of keep) {
      await db.query(
        `INSERT INTO router_queue_metrics
           (router_id, kind, queue_name, target, parent,
            rx_bps, tx_bps, rx_bytes, tx_bytes,
            packets_in, packets_out, dropped_in, dropped_out, disabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          router.id, r.kind, r.name, r.target, r.parent,
          r.rxBps, r.txBps, r.rxByte, r.txByte,
          r.pIn, r.pOut, r.dIn, r.dOut, r.disabled,
        ]
      );
    }
    return { ok: true, count: keep.length };
  } catch (err) {
    logger.warn({ err: err.message, router_id: router.id }, 'sampleQueues failed');
    return { ok: false, error: err.message };
  }
}

// ============================================================
// Refresh static info (board, RouterOS version, license, …).
// Runs once a day — not every tick.
// ============================================================
export async function refreshDeviceInfo(router) {
  const mt = await getMikrotikClient(router.id);
  try {
    const [res, ident, rb, lic] = await Promise.all([
      mt.systemResource().catch(() => ({})),
      mt.systemIdentity().catch(() => ({})),
      mt.systemRouterboard().catch(() => ({})),
      mt.systemLicense().catch(() => ({})),
    ]);
    await db.query(
      `INSERT INTO router_device_info
         (router_id, identity, board_name, model, serial_number,
          routeros_version, firmware_current, firmware_upgrade,
          license_level, architecture, last_checked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         identity         = VALUES(identity),
         board_name       = VALUES(board_name),
         model            = VALUES(model),
         serial_number    = VALUES(serial_number),
         routeros_version = VALUES(routeros_version),
         firmware_current = VALUES(firmware_current),
         firmware_upgrade = VALUES(firmware_upgrade),
         license_level    = VALUES(license_level),
         architecture     = VALUES(architecture),
         last_checked_at  = NOW()`,
      [
        router.id,
        ident.name || null,
        res['board-name'] || null,
        rb.model || res['board-name'] || null,
        rb['serial-number'] || lic['system-id'] || null,
        res.version || null,
        rb['current-firmware'] || null,
        rb['upgrade-firmware'] || null,
        lic.level || lic['nlevel'] || null,
        res.architecture || res['architecture-name'] || null,
      ]
    );
    return { ok: true };
  } catch (err) {
    logger.warn({ err: err.message, router_id: router.id }, 'refreshDeviceInfo failed');
    return { ok: false, error: err.message };
  }
}

// ============================================================
// Top-level orchestrator — runs every few minutes.
// ============================================================
export async function pollAllRouters() {
  if (!(await getSetting('monitoring.enabled'))) return { ok: true, skipped: 'disabled' };
  const routers = await db.query(
    `SELECT id, name, host FROM mikrotik_routers WHERE is_active = 1`
  );
  const results = [];
  for (const r of routers) {
    results.push({
      router: r,
      resource:   await sampleRouter(r),
      interfaces: await sampleInterfaces(r),
      ping:       await samplePing(r),
      neighbors:  await sampleNeighbors(r),
      queues:     await sampleQueues(r),
    });
  }
  return { ok: true, routers: results.length };
}

// ============================================================
// Housekeeping — drop metrics older than the retention window.
// ============================================================
export async function pruneMetrics() {
  const days = Math.max(1, Number(await getSetting('monitoring.retention_days')) || 30);
  const qDays = Math.max(1, Number(await getSetting('monitoring.queue_retention_days')) || 14);
  const schedule = [
    ['router_metrics', days],
    ['router_interface_metrics', days],
    ['router_ping_metrics', days],
    ['router_queue_metrics', qDays],
  ];
  for (const [t, d] of schedule) {
    try {
      await db.query(`DELETE FROM ${t} WHERE taken_at < NOW() - INTERVAL ? DAY LIMIT 10000`, [d]);
    } catch (err) {
      logger.warn({ err: err.message, table: t }, 'prune failed');
    }
  }
}

export default {
  sampleRouter, sampleInterfaces, samplePing, sampleNeighbors, sampleQueues,
  refreshDeviceInfo, pollAllRouters, pruneMetrics,
};
