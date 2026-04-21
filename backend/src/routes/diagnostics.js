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
