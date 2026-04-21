// ============================================================
// /api/hotspot — Hotspot management (users, profiles, active, hosts, log, template, server lock)
// ============================================================
import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { requireAdmin, requireRole } from '../middleware/auth.js';
import { getMikrotikClient } from '../mikrotik/client.js';
import * as settings from '../services/settings.js';
import * as gen from '../services/configGenerator.js';

const router = Router();

// ── Logo upload (multer) ──────────────────────────────────────
const UPLOAD_DIR = path.resolve('/app/uploads');
const logoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    cb(null, `portal-logo-${Date.now()}${ext}`);
  },
});
const logoUpload = multer({
  storage: logoStorage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(png|jpeg|jpg|gif|svg\+xml|webp)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files allowed'));
  },
});

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

// ── Visual settings: GET/PUT ──────────────────────────────────
const VISUAL_KEYS = [
  'site.name', 'portal.tagline', 'branding.primary_color', 'portal.bg_color',
  'portal.card_bg', 'portal.text_color', 'portal.font_size', 'portal.font_family',
  'branding.logo_url', 'portal.logo_position', 'portal.login_title',
  'site.support_phone', 'site.currency_symbol', 'portal.border_radius', 'portal.dark_mode',
];

router.get('/template/visual', requireAdmin, async (req, res) => {
  try {
    const out = {};
    for (const k of VISUAL_KEYS) out[k] = await settings.getSetting(k);
    res.json({ settings: out });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/template/visual', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  try {
    const body = req.body || {};
    for (const k of VISUAL_KEYS) {
      if (k in body) await settings.setSetting(k, body[k]);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Generate preview HTML from visual opts (no save) ─────────
router.post('/template/generate', requireAdmin, async (req, res) => {
  try {
    const html = await gen.generatePortalHtml(req.body || {});
    res.json({ html });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Logo upload ───────────────────────────────────────────────
router.post('/template/logo', requireAdmin, requireRole('superadmin', 'admin'),
  logoUpload.single('logo'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      const publicBase = (await settings.getSetting('site.public_base_url')) || '';
      const url = `${publicBase.replace(/\/$/, '')}/uploads/${req.file.filename}`;
      await settings.setSetting('branding.logo_url', url);
      res.json({ ok: true, url, filename: req.file.filename });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

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
