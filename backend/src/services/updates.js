// ============================================================
// RouterOS update service
// ------------------------------------------------------------
// Check / download / install RouterOS updates per router.
// Each task is recorded in update_tasks for history and audit.
// ============================================================

import db from '../database/pool.js';
import { getMikrotikClient } from '../mikrotik/client.js';
import logger from '../utils/logger.js';

async function recordTask({ routerId, action, channel, packageName, requestedBy }) {
  const r = await db.query(
    `INSERT INTO update_tasks (router_id, action, channel, package_name, status, requested_by)
     VALUES (?, ?, ?, ?, 'running', ?)`,
    [routerId, action, channel || null, packageName || null, requestedBy || null]
  );
  return r.insertId;
}

async function finishTask(id, { output, installed, latest, error } = {}) {
  if (error) {
    await db.query(
      `UPDATE update_tasks SET status = 'failed', finished_at = NOW(), error_message = ?, output = ? WHERE id = ?`,
      [error, output ? String(output).slice(0, 60000) : null, id]
    );
  } else {
    await db.query(
      `UPDATE update_tasks
       SET status = 'success', finished_at = NOW(),
           output = ?, installed_version = ?, latest_version = ?
       WHERE id = ?`,
      [output ? String(output).slice(0, 60000) : null, installed || null, latest || null, id]
    );
  }
}

export async function checkForUpdates({ routerId, channel, requestedBy }) {
  const taskId = await recordTask({ routerId, action: 'check', channel, requestedBy });
  try {
    const mt = await getMikrotikClient(routerId);
    const r = await mt.checkForUpdates(channel);
    const status = await mt.getUpdateStatus().catch(() => null);
    const installed = status?.['installed-version'] || status?.[0]?.['installed-version'];
    const latest = status?.['latest-version'] || status?.[0]?.['latest-version'] || r?.['latest-version'];
    await finishTask(taskId, { output: JSON.stringify({ r, status }), installed, latest });
    return { taskId, installed, latest, raw: { r, status } };
  } catch (err) {
    logger.error({ err: err.message, routerId }, 'update check failed');
    await finishTask(taskId, { error: err.message });
    throw err;
  }
}

export async function downloadUpdate({ routerId, requestedBy }) {
  const taskId = await recordTask({ routerId, action: 'download', requestedBy });
  try {
    const mt = await getMikrotikClient(routerId);
    const r = await mt.downloadUpdate();
    await finishTask(taskId, { output: JSON.stringify(r) });
    return { taskId, output: r };
  } catch (err) {
    await finishTask(taskId, { error: err.message });
    throw err;
  }
}

export async function installUpdate({ routerId, requestedBy }) {
  const taskId = await recordTask({ routerId, action: 'install', requestedBy });
  try {
    const mt = await getMikrotikClient(routerId);
    const r = await mt.installUpdate();
    await finishTask(taskId, { output: JSON.stringify(r) });
    return { taskId, output: r };
  } catch (err) {
    await finishTask(taskId, { error: err.message });
    throw err;
  }
}

export async function rebootRouter({ routerId, requestedBy }) {
  const taskId = await recordTask({ routerId, action: 'reboot', requestedBy });
  try {
    const mt = await getMikrotikClient(routerId);
    const r = await mt.reboot();
    await finishTask(taskId, { output: JSON.stringify(r) });
    return { taskId };
  } catch (err) {
    await finishTask(taskId, { error: err.message });
    throw err;
  }
}

export async function listPackages(routerId) {
  const mt = await getMikrotikClient(routerId);
  return mt.listPackages();
}

export async function togglePackage({ routerId, packageId, enabled, requestedBy }) {
  const taskId = await recordTask({
    routerId,
    action: enabled ? 'package_install' : 'package_uninstall',
    packageName: packageId,
    requestedBy,
  });
  try {
    const mt = await getMikrotikClient(routerId);
    const r = enabled ? await mt.enablePackage(packageId) : await mt.disablePackage(packageId);
    await finishTask(taskId, { output: JSON.stringify(r) });
    return { taskId };
  } catch (err) {
    await finishTask(taskId, { error: err.message });
    throw err;
  }
}

export async function listTasks({ routerId, limit = 50, offset = 0 } = {}) {
  const params = [];
  let where = '';
  if (routerId) { where = 'WHERE router_id = ?'; params.push(routerId); }
  const limitN = parseInt(limit, 10) || 50;
  const offsetN = parseInt(offset, 10) || 0;
  return db.query(
    `SELECT id, router_id, action, channel, package_name, installed_version, latest_version,
            status, output, error_message, requested_by, started_at, finished_at
     FROM update_tasks ${where} ORDER BY started_at DESC LIMIT ${limitN} OFFSET ${offsetN}`,
    params
  );
}

export default {
  checkForUpdates, downloadUpdate, installUpdate, rebootRouter,
  listPackages, togglePackage, listTasks,
};
