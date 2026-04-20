// ============================================================
// /api/configs — upload, list, download, push to MikroTik
// ============================================================

import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import db from '../database/pool.js';
import { requireAdmin, requireRole } from '../middleware/auth.js';
import config from '../config/index.js';
import * as svc from '../services/configFiles.js';
import * as settings from '../services/settings.js';
import * as gen from '../services/configGenerator.js';

const router = Router();

// ============================================================
// Auto-generate artefacts from current DB state
// ------------------------------------------------------------
// These two endpoints do NOT store anything — they render the
// file fresh every time, based on the packages / settings /
// brand configured in the dashboard. The admin downloads the
// result and uploads it to MikroTik (WinBox Files tab).
// ============================================================

/** GET /api/configs/generate/setup.rsc?hotspot_interface=...&hotspot_network=... */
router.get('/generate/setup.rsc', requireAdmin, async (req, res) => {
  try {
    const body = await gen.generateSetupRsc({
      hotspotInterface: req.query.hotspot_interface || 'bridge-hotspot',
      hotspotNetwork:   req.query.hotspot_network   || '10.77.0.0/24',
      hotspotGateway:   req.query.hotspot_gateway   || '10.77.0.1',
      dnsName:          req.query.dns_name          || 'wifi.local',
      vpsHost:          req.query.vps_host          || undefined,
      vpsIp:            req.query.vps_ip            || undefined,
    });
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="skynity-setup.rsc"');
    res.send(body);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/configs/generate/login.html  — captive portal page */
router.get('/generate/login.html', requireAdmin, async (req, res) => {
  try {
    const body = await gen.generatePortalHtml({
      vpsHost: req.query.vps_host || undefined,
    });
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="login.html"');
    res.send(body);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/configs/generate/pcq.rsc — shared bandwidth queue tree */
router.get('/generate/pcq.rsc', requireAdmin, async (req, res) => {
  try {
    const body = await gen.generatePcqRsc({
      total_download:  req.query.total_download,
      total_upload:    req.query.total_upload,
      parent_download: req.query.parent_download,
      parent_upload:   req.query.parent_upload,
      mode:            req.query.mode,
    });
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="skynity-pcq.rsc"');
    res.send(body);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/configs/generate/pcq-preview — text preview for the UI */
router.get('/generate/pcq-preview', requireAdmin, async (req, res) => {
  try {
    const body = await gen.generatePcqRsc({
      total_download:  req.query.total_download,
      total_upload:    req.query.total_upload,
      parent_download: req.query.parent_download,
      parent_upload:   req.query.parent_upload,
      mode:            req.query.mode,
    });
    res.json({ rsc: body });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/configs/generate/preview — returns both as JSON (for in-app preview) */
router.get('/generate/preview', requireAdmin, async (req, res) => {
  try {
    const [rsc, html] = await Promise.all([
      gen.generateSetupRsc({
        hotspotInterface: req.query.hotspot_interface || 'bridge-hotspot',
        hotspotNetwork:   req.query.hotspot_network   || '10.77.0.0/24',
        hotspotGateway:   req.query.hotspot_gateway   || '10.77.0.1',
        dnsName:          req.query.dns_name          || 'wifi.local',
        vpsHost:          req.query.vps_host          || undefined,
      }),
      gen.generatePortalHtml({ vpsHost: req.query.vps_host || undefined }),
    ]);
    res.json({ rsc, html });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Multer storage: UPLOAD_DIR/configs/<timestamp>-<sanitized-name>
await svc.ensureConfigDir();
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, svc.CONFIG_DIR),
  filename: (_req, file, cb) => {
    const clean = file.originalname.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
    cb(null, `${Date.now()}-${clean}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: (config.MAX_UPLOAD_SIZE_MB || 5) * 1024 * 1024 * 10 }, // up to 50 MB
});

function detectType(name) {
  const ext = path.extname(name).toLowerCase();
  if (ext === '.rsc') return 'rsc';
  if (ext === '.backup') return 'backup';
  if (ext === '.conf') return 'conf';
  if (ext === '.txt') return 'script';
  return 'other';
}

// ---------- list ----------
router.get('/', requireAdmin, async (_req, res) => {
  const rows = await svc.listConfigFiles();
  res.json({ configs: rows });
});

// ---------- upload ----------
router.post('/', requireAdmin, requireRole('superadmin', 'admin'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file required' });
  const id = await svc.registerUploadedFile({
    originalName: req.body.name || req.file.originalname,
    storedPath: req.file.path,
    size: req.file.size,
    fileType: req.body.file_type || detectType(req.file.originalname),
    description: req.body.description || null,
    tags: req.body.tags || null,
    isPublic: req.body.is_public === 'true' || req.body.is_public === true,
    uploadedBy: req.admin.id,
  });
  await db.query(
    `INSERT INTO activity_log (actor_type, actor_id, action, entity_type, entity_id, meta)
     VALUES ('admin', ?, 'config_uploaded', 'config_file', ?, ?)`,
    [String(req.admin.id), String(id), JSON.stringify({ name: req.file.originalname, size: req.file.size })]
  );
  res.json({ id });
});

// ---------- raw download (with token for router fetch, or auth) ----------
router.get('/:id/raw', async (req, res) => {
  const id = Number(req.params.id);
  const row = await svc.getConfigFile(id);
  if (!row) return res.status(404).json({ error: 'not found' });
  const token = req.query.token;
  const bearer = (req.headers.authorization || '').startsWith('Bearer ');
  if (!bearer && row.download_token !== token && !row.is_public) {
    return res.status(403).json({ error: 'auth required' });
  }
  if (!fs.existsSync(row.file_path)) return res.status(410).json({ error: 'file missing on disk' });
  res.setHeader('Content-Disposition', `attachment; filename="${row.name}"`);
  res.setHeader('Content-Type', 'application/octet-stream');
  fs.createReadStream(row.file_path).pipe(res);
  svc.incrementDownloadCount(id).catch(() => {});
});

// ---------- push to router ----------
router.post('/:id/push', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  const id = Number(req.params.id);
  const routerId = Number(req.body?.router_id);
  const runImport = req.body?.run_import !== false;
  if (!routerId) return res.status(400).json({ error: 'router_id required' });

  let baseUrl = req.body?.public_base_url;
  if (!baseUrl) baseUrl = await settings.getSetting('site.public_base_url');
  if (!baseUrl) baseUrl = `${req.protocol}://${req.get('host')}`;

  try {
    const result = await svc.pushConfigToRouter({
      configId: id,
      routerId,
      pushedBy: req.admin.id,
      publicBaseUrl: baseUrl,
      runImport,
    });
    await db.query(
      `INSERT INTO activity_log (actor_type, actor_id, action, entity_type, entity_id, meta)
       VALUES ('admin', ?, 'config_pushed', 'config_file', ?, ?)`,
      [String(req.admin.id), String(id), JSON.stringify({ routerId, status: result.status })]
    );
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- push history ----------
router.get('/:id/pushes', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const rows = await db.query(
    `SELECT p.*, r.name AS router_name
     FROM config_pushes p JOIN mikrotik_routers r ON r.id = p.router_id
     WHERE p.config_id = ? ORDER BY p.started_at DESC LIMIT 50`,
    [id]
  );
  res.json({ pushes: rows });
});

// ---------- delete ----------
router.delete('/:id', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  await svc.deleteConfigFile(Number(req.params.id));
  res.json({ ok: true });
});

export default router;
