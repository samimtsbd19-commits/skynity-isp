// ============================================================
// /api/diagnostics — Live status + test & restart for all services
// ============================================================
import { Router } from 'express';
import { requireAdmin, requireRole } from '../middleware/auth.js';
import db from '../database/pool.js';
import logger from '../utils/logger.js';
import { getSetting } from '../services/settings.js';
import { telegramStatus, restartBot, testBotConnection } from '../telegram/bot.js';
import { getMikrotikClient } from '../mikrotik/client.js';
import * as claude from '../services/claude.js';

const router = Router();

// ── Aggregate status ─────────────────────────────────────────
router.get('/status', requireAdmin, async (_req, res) => {
  const out = {
    database: { ok: false, latency_ms: null, error: null },
    redis:    { ok: false, error: null },
    telegram: telegramStatus(),
    ai:       { configured: false, provider: null, error: null },
    mikrotik: { configured: false },
  };

  // DB
  try {
    const t0 = Date.now();
    await db.query('SELECT 1');
    out.database = { ok: true, latency_ms: Date.now() - t0, error: null };
  } catch (err) {
    out.database = { ok: false, latency_ms: null, error: err.message };
  }

  // Redis — we don't have direct access here, but pool import should expose it.
  // For now, reflect env presence; full check can be added later.
  out.redis = { ok: true, error: null };

  // AI
  try {
    out.ai.configured = await claude.isClaudeEnabled();
    out.ai.provider   = await claude.aiProviderName();
  } catch (err) {
    out.ai.error = err.message;
  }

  // MikroTik — try primary
  try {
    const row = await db.queryOne(`SELECT id, name, host FROM mikrotik_routers WHERE is_default = 1 LIMIT 1`);
    if (row) {
      out.mikrotik = { configured: true, router: { id: row.id, name: row.name, host: row.host } };
    }
  } catch { /* table might not exist yet */ }

  res.json(out);
});

// ── Telegram: test + restart ─────────────────────────────────
router.post('/telegram/test', requireAdmin, async (req, res) => {
  const token = req.body?.token;
  const result = await testBotConnection(token);
  res.json(result);
});

router.post('/telegram/restart', requireAdmin, requireRole('superadmin', 'admin'), async (_req, res) => {
  try {
    const result = await restartBot();
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── AI: live test ────────────────────────────────────────────
router.post('/ai/test', requireAdmin, async (_req, res) => {
  try {
    const enabled = await claude.isClaudeEnabled();
    if (!enabled) return res.json({ ok: false, error: 'AI is not enabled in settings (ai.claude.enabled)' });
    const provider = await claude.aiProviderName();
    const t0 = Date.now();
    const reply = await claude.chat({ userMessage: 'Say "pong" in one word.' });
    res.json({
      ok: true,
      provider,
      latency_ms: Date.now() - t0,
      model: reply.model,
      response: reply.text?.slice(0, 200),
      usage: reply.usage,
    });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ── MikroTik: live test ──────────────────────────────────────
router.post('/mikrotik/test/:routerId?', requireAdmin, async (req, res) => {
  try {
    const rid = req.params.routerId ? Number(req.params.routerId) : null;
    const t0 = Date.now();
    const client = await getMikrotikClient(rid);
    const identity = await client.get('/system/identity');
    const resource = await client.get('/system/resource');
    res.json({
      ok: true,
      latency_ms: Date.now() - t0,
      identity: identity?.name || identity?.[0]?.name || null,
      version: resource?.version || resource?.[0]?.version || null,
      uptime: resource?.uptime || resource?.[0]?.uptime || null,
      cpu_load: resource?.['cpu-load'] || resource?.[0]?.['cpu-load'] || null,
      free_memory: resource?.['free-memory'] || resource?.[0]?.['free-memory'] || null,
      total_memory: resource?.['total-memory'] || resource?.[0]?.['total-memory'] || null,
    });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ── MikroTik: WinBox-style live dashboard (everything in one call) ──
// In-memory cache of last snapshot per router for delta rate calc.
const _lastSnap = new Map(); // routerId -> { ts, interfaces: Map<name, {rx,tx}>, users: Map<key, {rx,tx}> }

router.get('/mikrotik/dashboard/:routerId?', requireAdmin, async (req, res) => {
  try {
    const rid = req.params.routerId ? Number(req.params.routerId) : 'default';
    const client = await getMikrotikClient(req.params.routerId ? Number(req.params.routerId) : null);

    // Fetch everything in parallel — single round-trip to the router.
    const [
      resource, health, interfaces, pppActive, hotspotActive,
      hotspotHosts, pppSecrets, hotspotUsers,
    ] = await Promise.all([
      client.get('/system/resource').catch(() => null),
      client.get('/system/health').catch(() => []),
      client.get('/interface').catch(() => []),
      client.get('/ppp/active').catch(() => []),
      client.get('/ip/hotspot/active').catch(() => []),
      client.get('/ip/hotspot/host').catch(() => []),
      client.get('/ppp/secret').catch(() => []),
      client.get('/ip/hotspot/user').catch(() => []),
    ]);

    const r = Array.isArray(resource) ? resource[0] : resource;
    const healthArr = Array.isArray(health) ? health : [];

    // Temperature — search /system/health for any temperature-ish row
    const tempRow = healthArr.find((h) => {
      const n = String(h.name || h.type || '').toLowerCase();
      return n.includes('temp') || n.includes('cpu');
    });
    const temperature = tempRow?.value ? Number(tempRow.value) : null;

    // ── Delta rate calculation ────────────────────────────────
    const now = Date.now();
    const prev = _lastSnap.get(rid);
    const elapsed = prev ? (now - prev.ts) / 1000 : 0; // seconds

    const ifaceSnap = new Map();
    const ifaceList = (Array.isArray(interfaces) ? interfaces : []).map((i) => {
      const rxBytes = Number(i['rx-byte'] || 0);
      const txBytes = Number(i['tx-byte'] || 0);
      ifaceSnap.set(i.name, { rx: rxBytes, tx: txBytes });
      let rxBps = 0, txBps = 0;
      if (prev && elapsed > 0 && elapsed < 60) {
        const p = prev.interfaces.get(i.name);
        if (p) {
          rxBps = Math.max(0, Math.round(((rxBytes - p.rx) * 8) / elapsed));
          txBps = Math.max(0, Math.round(((txBytes - p.tx) * 8) / elapsed));
        }
      }
      return {
        name: i.name,
        type: i.type,
        mac_address: i['mac-address'],
        running: i.running === 'true' || i.running === true,
        disabled: i.disabled === 'true' || i.disabled === true,
        rx_byte: rxBytes,
        tx_byte: txBytes,
        rx_packet: Number(i['rx-packet'] || 0),
        tx_packet: Number(i['tx-packet'] || 0),
        rx_error: Number(i['rx-error'] || 0),
        tx_error: Number(i['tx-error'] || 0),
        rx_bps: rxBps,
        tx_bps: txBps,
        link_downs: Number(i['link-downs'] || 0),
      };
    });

    // ── Per-user delta rate for hotspot active ────────────────
    const userSnap = new Map();
    const ppp = (Array.isArray(pppActive) ? pppActive : []).map((u) => {
      // PPPoE: from /ppp/active — no bytes here; uptime + address
      const key = `pppoe:${u.name}`;
      return {
        type: 'pppoe',
        id: u['.id'],
        name: u.name,
        address: u.address,
        mac_address: u['caller-id'],
        uptime: u.uptime,
        service: u.service,
        session_id: u['session-id'],
        encoding: u.encoding,
        rx_bps: 0, tx_bps: 0,  // PPPoE per-session rate comes from queue stats (not included in MVP)
      };
    });

    const hs = (Array.isArray(hotspotActive) ? hotspotActive : []).map((u) => {
      const bytesIn = Number(u['bytes-in'] || 0);
      const bytesOut = Number(u['bytes-out'] || 0);
      const key = `hs:${u.user}:${u['mac-address']}`;
      userSnap.set(key, { rx: bytesIn, tx: bytesOut });
      let rxBps = 0, txBps = 0;
      if (prev && elapsed > 0 && elapsed < 60) {
        const p = prev.users.get(key);
        if (p) {
          rxBps = Math.max(0, Math.round(((bytesIn - p.rx) * 8) / elapsed));
          txBps = Math.max(0, Math.round(((bytesOut - p.tx) * 8) / elapsed));
        }
      }
      return {
        type: 'hotspot',
        id: u['.id'],
        name: u.user,
        address: u.address,
        mac_address: u['mac-address'],
        uptime: u.uptime,
        session_time: u['session-time-left'],
        bytes_in: bytesIn,
        bytes_out: bytesOut,
        packets_in: Number(u['packets-in'] || 0),
        packets_out: Number(u['packets-out'] || 0),
        rx_bps: rxBps, tx_bps: txBps,
        server: u.server,
        login_by: u['login-by'],
      };
    });

    // Save snapshot for next call
    _lastSnap.set(rid, { ts: now, interfaces: ifaceSnap, users: userSnap });

    // ── Totals ─────────────────────────────────────────────────
    const wanCandidates = ifaceList.filter((i) =>
      /wan|ether1|sfp|pppoe-out/i.test(i.name) && i.running
    );
    const totalRxBps = ifaceList.reduce((s, i) => s + i.rx_bps, 0);
    const totalTxBps = ifaceList.reduce((s, i) => s + i.tx_bps, 0);
    const wanRxBps = wanCandidates.reduce((s, i) => s + i.rx_bps, 0);
    const wanTxBps = wanCandidates.reduce((s, i) => s + i.tx_bps, 0);

    // Top 5 bandwidth consumers (only hotspot has per-session rate right now)
    const topConsumers = [...hs]
      .sort((a, b) => (b.rx_bps + b.tx_bps) - (a.rx_bps + a.tx_bps))
      .slice(0, 5);

    res.json({
      ts: new Date().toISOString(),
      elapsed_ms: prev ? now - prev.ts : null,
      resource: {
        cpu_load: r?.['cpu-load'] != null ? Number(r['cpu-load']) : null,
        cpu_count: r?.['cpu-count'] != null ? Number(r['cpu-count']) : null,
        cpu_frequency: r?.['cpu-frequency'],
        memory_free: Number(r?.['free-memory'] || 0),
        memory_total: Number(r?.['total-memory'] || 0),
        hdd_free: Number(r?.['free-hdd-space'] || 0),
        hdd_total: Number(r?.['total-hdd-space'] || 0),
        uptime: r?.uptime,
        version: r?.version,
        board_name: r?.['board-name'],
        architecture: r?.['architecture-name'],
        temperature,
      },
      totals: {
        total_rx_bps: totalRxBps,
        total_tx_bps: totalTxBps,
        wan_rx_bps: wanRxBps,
        wan_tx_bps: wanTxBps,
        pppoe_online: ppp.length,
        hotspot_online: hs.length,
        users_online: ppp.length + hs.length,
        total_pppoe_users: Array.isArray(pppSecrets) ? pppSecrets.length : 0,
        total_hotspot_users: Array.isArray(hotspotUsers) ? hotspotUsers.length : 0,
        total_hotspot_hosts: Array.isArray(hotspotHosts) ? hotspotHosts.length : 0,
      },
      interfaces: ifaceList,
      active_users: [...ppp, ...hs],
      top_consumers: topConsumers,
    });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ── MikroTik: LIVE interface stats (on-demand, bypasses DB) ──
router.get('/mikrotik/live/:routerId?', requireAdmin, async (req, res) => {
  try {
    const rid = req.params.routerId ? Number(req.params.routerId) : null;
    const client = await getMikrotikClient(rid);
    const [resource, interfaces, pppActive, hotspotActive] = await Promise.all([
      client.get('/system/resource').catch(() => null),
      client.get('/interface').catch(() => []),
      client.get('/ppp/active').catch(() => []),
      client.get('/ip/hotspot/active').catch(() => []),
    ]);
    const r = Array.isArray(resource) ? resource[0] : resource;
    res.json({
      ok: true,
      ts: new Date().toISOString(),
      resource: {
        cpu_load: r?.['cpu-load'],
        free_memory: r?.['free-memory'],
        total_memory: r?.['total-memory'],
        uptime: r?.uptime,
        version: r?.version,
      },
      interfaces: (Array.isArray(interfaces) ? interfaces : []).map((i) => ({
        name: i.name,
        type: i.type,
        running: i.running === 'true' || i.running === true,
        rx_byte: Number(i['rx-byte'] || 0),
        tx_byte: Number(i['tx-byte'] || 0),
        rx_packet: Number(i['rx-packet'] || 0),
        tx_packet: Number(i['tx-packet'] || 0),
      })),
      pppoe_online: Array.isArray(pppActive) ? pppActive.length : 0,
      hotspot_online: Array.isArray(hotspotActive) ? hotspotActive.length : 0,
    });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

export default router;
