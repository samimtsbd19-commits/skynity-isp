// ============================================================
// RouterOS Script service
// ------------------------------------------------------------
// Stores reusable scripts in DB, pushes them to a router, and
// records every execution with full output for auditing.
// ============================================================

import db from '../database/pool.js';
import { getMikrotikClient } from '../mikrotik/client.js';
import logger from '../utils/logger.js';

export async function listScripts() {
  return db.query(
    `SELECT id, name, description, policy, tags, is_active, created_by, created_at, updated_at,
            LEFT(source, 240) AS source_preview
     FROM router_scripts ORDER BY updated_at DESC`
  );
}

export async function getScript(id) {
  return db.queryOne('SELECT * FROM router_scripts WHERE id = ?', [id]);
}

export async function createScript({ name, description, source, policy, tags, createdBy }) {
  if (!name || !source) throw new Error('name and source required');
  const r = await db.query(
    `INSERT INTO router_scripts (name, description, source, policy, tags, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [name, description || null, source, policy || 'read,write,policy,test', tags || null, createdBy || null]
  );
  return r.insertId;
}

export async function updateScript(id, patch) {
  const allowed = ['name', 'description', 'source', 'policy', 'tags', 'is_active'];
  const entries = Object.entries(patch || {}).filter(([k]) => allowed.includes(k));
  if (!entries.length) throw new Error('nothing to update');
  const set = entries.map(([k]) => `${k} = ?`).join(', ');
  await db.query(`UPDATE router_scripts SET ${set} WHERE id = ?`, [...entries.map(([, v]) => v), id]);
}

export async function deleteScript(id) {
  await db.query('DELETE FROM router_scripts WHERE id = ?', [id]);
}

/**
 * Execute a script against a router.
 * Two modes:
 *   - scriptId given: fetch from DB
 *   - inline source given: run once without storing
 *
 * Strategy:
 *   1. Upsert named script on the router (/system/script)
 *   2. Call /system/script/run
 *   3. Capture output (best effort — RouterOS does not always
 *      return run output; admins can inspect /log for detail)
 */
export async function executeScript({ scriptId, routerId, executedBy, inlineSource, inlineName }) {
  if (!routerId) throw new Error('routerId required');
  let source, name, policy;
  if (scriptId) {
    const s = await getScript(scriptId);
    if (!s) throw new Error('script not found');
    source = s.source;
    name = `skynity-${s.id}-${s.name}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60);
    policy = s.policy;
  } else if (inlineSource) {
    source = inlineSource;
    name = inlineName || `skynity-inline-${Date.now()}`;
    policy = 'read,write,policy,test';
  } else {
    throw new Error('scriptId or inlineSource required');
  }

  const execIns = await db.query(
    `INSERT INTO script_executions (script_id, router_id, executed_by, status, source_preview)
     VALUES (?, ?, ?, 'running', ?)`,
    [scriptId || null, routerId, executedBy || null, String(source).slice(0, 500)]
  );
  const execId = execIns.insertId;

  try {
    const mt = await getMikrotikClient(routerId);
    const existing = await mt.findScriptByName(name);
    if (existing) {
      await mt.updateScript(existing['.id'], { source, policy });
    } else {
      await mt.createScript({ name, source, policy });
    }
    const output = await mt.runScriptByName(name).catch(() => ({ ok: true, note: 'run queued' }));

    await db.query(
      `UPDATE script_executions
       SET status = 'success', finished_at = NOW(), output = ?
       WHERE id = ?`,
      [JSON.stringify(output).slice(0, 60000), execId]
    );
    return { execId, status: 'success', output };
  } catch (err) {
    logger.error({ err: err.message, routerId, scriptId }, 'script execution failed');
    await db.query(
      `UPDATE script_executions
       SET status = 'failed', finished_at = NOW(), error_message = ?
       WHERE id = ?`,
      [err.message, execId]
    );
    throw err;
  }
}

export async function listExecutions({ routerId, scriptId, limit = 50, offset = 0 } = {}) {
  const where = [];
  const params = [];
  if (routerId) { where.push('router_id = ?'); params.push(routerId); }
  if (scriptId) { where.push('script_id = ?'); params.push(scriptId); }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const limitN = parseInt(limit, 10) || 50;
  const offsetN = parseInt(offset, 10) || 0;
  return db.query(
    `SELECT id, script_id, router_id, executed_by, status, source_preview,
            LEFT(output, 500) AS output_preview, error_message, started_at, finished_at
     FROM script_executions ${clause} ORDER BY started_at DESC LIMIT ${limitN} OFFSET ${offsetN}`,
    params
  );
}

export async function getExecution(id) {
  return db.queryOne('SELECT * FROM script_executions WHERE id = ?', [id]);
}

export default {
  listScripts, getScript, createScript, updateScript, deleteScript,
  executeScript, listExecutions, getExecution,
};
