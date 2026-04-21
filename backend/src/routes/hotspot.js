// ============================================================
// /api/hotspot — Hotspot management (users, profiles, active, hosts, log, template, server lock)
// ============================================================
import { Router } from 'express';
import { requireAdmin, requireRole } from '../middleware/auth.js';
import { getMikrotikClient } from '../mikrotik/client.js';
import * as settings from '../services/settings.js';
import * as gen from '../services/configGenerator.js';

const router = Router();

function routerId(req) {
  const v = req.query.routerId || req.query.router_id;
  return v ? Number(v) : null;
}

// ── Active sessions ──────────────────────────────────────────
router.get('/active', requireAdmin, async (req, res) => {
  try {
    const client = await getMikrotikClient(routerId(req));
    const list = await client.listHotspotActive();
    res.json({ active: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/active/:id', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  try {
    const client = await getMikrotikClient(routerId(req));
    await client.kickHotspotActive(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Users ─────────────────────────────────────────────────────
router.get('/users', requireAdmin, async (req, res) => {
  try {
    const client = await getMikrotikClient(routerId(req));
    const users = await client.listHotspotUsers();
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/users', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  try {
    const { name, password, profile, comment, mac_address, limit_uptime, limit_bytes_total } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const client = await getMikrotikClient(routerId(req));
    const result = await client.createHotspotUser({
      name,
      password: password || '',
      profile: profile || 'default',
      comment: comment || 'skynity:manual',
      ...(mac_address ? { 'mac-address': mac_address } : {}),
      ...(limit_uptime ? { 'limit-uptime': limit_uptime } : {}),
      ...(limit_bytes_total ? { 'limit-bytes-total': limit_bytes_total } : {}),
    });
    res.json({ ok: true, id: result?.['.id'] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/users/:id/enable', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  try {
    const client = await getMikrotikClient(routerId(req));
    await client.enableHotspotUser(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/users/:id/disable', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  try {
    const client = await getMikrotikClient(routerId(req));
    await client.disableHotspotUser(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/users/:id', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  try {
    const client = await getMikrotikClient(routerId(req));
    await client.deleteHotspotUser(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Profiles ──────────────────────────────────────────────────
router.get('/profiles', requireAdmin, async (req, res) => {
  try {
    const client = await getMikrotikClient(routerId(req));
    const profiles = await client.listHotspotUserProfiles();
    res.json({ profiles });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/profiles', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  try {
    const { name, rate_limit, session_timeout, shared_users, comment } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const client = await getMikrotikClient(routerId(req));
    const body = {
      name,
      ...(rate_limit ? { 'rate-limit': rate_limit } : {}),
      ...(session_timeout ? { 'session-timeout': session_timeout } : {}),
      'shared-users': shared_users != null ? String(shared_users) : '1',
      comment: comment || 'skynity:manual',
    };
    const result = await client.put('/ip/hotspot/user/profile', body);
    res.json({ ok: true, id: result?.['.id'] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/profiles/:id', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  try {
    const client = await getMikrotikClient(routerId(req));
    await client.del(`/ip/hotspot/user/profile/${encodeURIComponent(req.params.id)}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Hosts ─────────────────────────────────────────────────────
router.get('/hosts', requireAdmin, async (req, res) => {
  try {
    const client = await getMikrotikClient(routerId(req));
    const hosts = await client.get('/ip/hotspot/host');
    res.json({ hosts: Array.isArray(hosts) ? hosts : [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Log ───────────────────────────────────────────────────────
router.get('/log', requireAdmin, async (req, res) => {
  try {
    const client = await getMikrotikClient(routerId(req));
    const all = await client.get('/log');
    const filtered = (Array.isArray(all) ? all : []).filter(
      (e) => (e.topics || '').includes('hotspot')
    ).slice(0, 200);
    res.json({ log: filtered });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Server info + Lock ────────────────────────────────────────
router.get('/server', requireAdmin, async (req, res) => {
  try {
    const client = await getMikrotikClient(routerId(req));
    const servers = await client.get('/ip/hotspot');
    res.json({ servers: Array.isArray(servers) ? servers : [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/server/:id/lock', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  try {
    const { locked } = req.body;
    const client = await getMikrotikClient(routerId(req));
    await client.patch(`/ip/hotspot/${encodeURIComponent(req.params.id)}`, {
      disabled: locked ? 'true' : 'false',
    });
    res.json({ ok: true, locked: !!locked });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Captive Portal Template ───────────────────────────────────
router.get('/template', requireAdmin, async (req, res) => {
  try {
    const custom = await settings.getSetting('hotspot.login_template');
    if (custom) return res.json({ template: custom, is_custom: true });
    const html = await gen.generatePortalHtml();
    res.json({ template: html, is_custom: false });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/template', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  try {
    const { template } = req.body;
    if (typeof template !== 'string') return res.status(400).json({ error: 'template string required' });
    await settings.setSetting('hotspot.login_template', template);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/template', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  try {
    await settings.setSetting('hotspot.login_template', null);
    res.json({ ok: true, reset: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── App log (MikroTik system log) ────────────────────────────
router.get('/applog', requireAdmin, async (req, res) => {
  try {
    const client = await getMikrotikClient(routerId(req));
    const topics = req.query.topics || 'system,info,error,warning';
    const all = await client.get('/log');
    const filtered = (Array.isArray(all) ? all : [])
      .filter((e) => topics.split(',').some((t) => (e.topics || '').includes(t.trim())))
      .slice(0, 300);
    res.json({ log: filtered });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
