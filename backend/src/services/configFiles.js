// ============================================================
// Config File service
// ------------------------------------------------------------
// Handles:
//   - Upload to VPS (multer target: UPLOAD_DIR/configs/)
//   - Download (with signed token or auth)
//   - Push to MikroTik: tool/fetch pulls the file over HTTP,
//     then /import runs it (for .rsc) or reports success
// ============================================================

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import db from '../database/pool.js';
import config from '../config/index.js';
import { getMikrotikClient } from '../mikrotik/client.js';
import logger from '../utils/logger.js';

export const CONFIG_DIR = path.join(config.UPLOAD_DIR, 'configs');

export async function ensureConfigDir() {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
}

export function sha256File(p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.readFile(p)
      .then((buf) => { h.update(buf); resolve(h.digest('hex')); })
      .catch(reject);
  });
}

export async function registerUploadedFile({ originalName, storedPath, size, fileType, description, uploadedBy, tags, isPublic }) {
  const checksum = await sha256File(storedPath);
  const token = crypto.randomBytes(24).toString('hex');
  const r = await db.query(
    `INSERT INTO config_files
       (name, description, file_type, file_path, file_size, checksum_sha256, uploaded_by, tags, is_public, download_token)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [originalName, description || null, fileType || 'rsc', storedPath, size, checksum,
     uploadedBy || null, tags || null, isPublic ? 1 : 0, token]
  );
  return r.insertId;
}

export async function getConfigFile(id) {
  return db.queryOne('SELECT * FROM config_files WHERE id = ?', [id]);
}

export async function listConfigFiles({ limit = 100, offset = 0 } = {}) {
  return db.query(
    `SELECT id, name, description, file_type, file_size, checksum_sha256, uploaded_by,
            tags, is_public, download_count, created_at
     FROM config_files ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [Number(limit), Number(offset)]
  );
}

export async function deleteConfigFile(id) {
  const row = await getConfigFile(id);
  if (!row) return false;
  try { await fs.unlink(row.file_path); } catch (err) {
    logger.warn({ err: err.message, path: row.file_path }, 'config file unlink failed');
  }
  await db.query('DELETE FROM config_files WHERE id = ?', [id]);
  return true;
}

export async function incrementDownloadCount(id) {
  await db.query('UPDATE config_files SET download_count = download_count + 1 WHERE id = ?', [id]);
}

/**
 * Build a signed URL that the router can hit without auth.
 * We use the download_token stored against the config file.
 */
export function buildDownloadUrl({ baseUrl, id, token }) {
  return `${baseUrl.replace(/\/$/, '')}/api/configs/${id}/raw?token=${encodeURIComponent(token)}`;
}

/**
 * Push a config file to a router.
 *
 * Strategy:
 *   1. Insert config_pushes row (status=pending)
 *   2. Call /tool/fetch on the router with our download URL so
 *      the router grabs the file into its own /file/ system
 *   3. If file_type === 'rsc', also run /import file-name=...
 *   4. Update history row
 */
export async function pushConfigToRouter({ configId, routerId, pushedBy, publicBaseUrl, runImport = true }) {
  const cfg = await getConfigFile(configId);
  if (!cfg) throw new Error('config not found');
  const router = await db.queryOne('SELECT * FROM mikrotik_routers WHERE id = ?', [routerId]);
  if (!router) throw new Error('router not found');

  const pushIns = await db.query(
    `INSERT INTO config_pushes (config_id, router_id, pushed_by, status, remote_path)
     VALUES (?, ?, ?, 'pending', ?)`,
    [configId, routerId, pushedBy || null, `skynity/${cfg.name}`]
  );
  const pushId = pushIns.insertId;

  const downloadUrl = buildDownloadUrl({
    baseUrl: publicBaseUrl,
    id: cfg.id,
    token: cfg.download_token,
  });

  const dstPath = `skynity/${cfg.name}`;

  try {
    await db.query(`UPDATE config_pushes SET status = 'uploading' WHERE id = ?`, [pushId]);
    const mt = await getMikrotikClient(routerId);
    const fetchResult = await mt.fetchFromUrl({ url: downloadUrl, dstPath });

    let importOutput = null;
    if (runImport && (cfg.file_type === 'rsc' || cfg.file_type === 'script')) {
      await db.query(`UPDATE config_pushes SET status = 'importing' WHERE id = ?`, [pushId]);
      importOutput = await mt.importRscFile(dstPath);
    }

    await db.query(
      `UPDATE config_pushes
       SET status = 'success', finished_at = NOW(),
           log_output = ?
       WHERE id = ?`,
      [JSON.stringify({ fetch: fetchResult, import: importOutput }).slice(0, 60000), pushId]
    );
    await incrementDownloadCount(cfg.id);
    return { pushId, status: 'success', fetch: fetchResult, import: importOutput };
  } catch (err) {
    logger.error({ err: err.message, configId, routerId }, 'push to router failed');
    await db.query(
      `UPDATE config_pushes
       SET status = 'failed', finished_at = NOW(), error_message = ?
       WHERE id = ?`,
      [err.message, pushId]
    );
    throw err;
  }
}

export default {
  CONFIG_DIR,
  ensureConfigDir,
  registerUploadedFile,
  getConfigFile,
  listConfigFiles,
  deleteConfigFile,
  pushConfigToRouter,
  buildDownloadUrl,
};
