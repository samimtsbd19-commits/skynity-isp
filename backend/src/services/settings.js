// ============================================================
// System Settings service
// ------------------------------------------------------------
// Key/value store with typed values (string/number/boolean/json)
// surfaced via REST so the admin panel can tune every runtime
// behaviour without touching .env.
// ============================================================

import db from '../database/pool.js';

function cast(value, type) {
  if (value == null) return null;
  switch (type) {
    case 'number': return Number(value);
    case 'boolean': return value === 'true' || value === '1' || value === true;
    case 'json': try { return JSON.parse(value); } catch { return null; }
    default: return String(value);
  }
}

function serialize(value, type) {
  if (value == null) return null;
  switch (type) {
    case 'json': return JSON.stringify(value);
    case 'boolean': return value ? 'true' : 'false';
    default: return String(value);
  }
}

export async function listSettings({ includeSecret = false } = {}) {
  const rows = await db.query(
    `SELECT setting_key, setting_value, value_type, description, is_secret, updated_at
     FROM system_settings ORDER BY setting_key`
  );
  return rows.map((r) => ({
    key: r.setting_key,
    value: r.is_secret && !includeSecret ? null : cast(r.setting_value, r.value_type),
    type: r.value_type,
    description: r.description,
    isSecret: !!r.is_secret,
    updatedAt: r.updated_at,
  }));
}

export async function getSetting(key) {
  const row = await db.queryOne(
    `SELECT setting_value, value_type FROM system_settings WHERE setting_key = ?`,
    [key]
  );
  if (!row) return null;
  return cast(row.setting_value, row.value_type);
}

export async function setSetting({ key, value, type, description, isSecret, updatedBy }) {
  const existing = await db.queryOne('SELECT value_type FROM system_settings WHERE setting_key = ?', [key]);
  const useType = type || existing?.value_type || 'string';
  const serialized = serialize(value, useType);
  if (existing) {
    await db.query(
      `UPDATE system_settings SET setting_value = ?, value_type = ?, description = COALESCE(?, description),
                                   is_secret = COALESCE(?, is_secret), updated_by = ?, updated_at = NOW()
       WHERE setting_key = ?`,
      [serialized, useType, description ?? null, isSecret == null ? null : (isSecret ? 1 : 0), updatedBy || null, key]
    );
  } else {
    await db.query(
      `INSERT INTO system_settings (setting_key, setting_value, value_type, description, is_secret, updated_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [key, serialized, useType, description || null, isSecret ? 1 : 0, updatedBy || null]
    );
  }
}

export async function bulkUpdate(entries, updatedBy) {
  for (const e of entries || []) {
    await setSetting({ ...e, updatedBy });
  }
}

export default { listSettings, getSetting, setSetting, bulkUpdate };
