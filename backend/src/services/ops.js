// ============================================================
// Emergency operations — pause background cron work cluster-wide
// ============================================================

import { getSetting, setSetting } from './settings.js';
import logger from '../utils/logger.js';

let cacheVal = null;
let cacheAt = 0;
const TTL_MS = 3000;

export async function getEmergencyStop() {
  const now = Date.now();
  if (cacheVal !== null && now - cacheAt < TTL_MS) return cacheVal;
  const v = String(await getSetting('ops.emergency_stop')).toLowerCase();
  cacheVal = v === 'true' || v === '1';
  cacheAt = now;
  return cacheVal;
}

export function invalidateEmergencyStopCache() {
  cacheVal = null;
  cacheAt = 0;
}

export async function setEmergencyStop(enabled, { updatedBy = null } = {}) {
  await setSetting({
    key: 'ops.emergency_stop',
    value: enabled ? 'true' : 'false',
    type: 'boolean',
    description: 'Pause all cron jobs (monitoring, reminders, sync retries, etc.)',
    isSecret: false,
    updatedBy,
  });
  invalidateEmergencyStopCache();
  logger.warn({ enabled }, 'ops.emergency_stop toggled');
  return { ok: true, emergency_stop: enabled };
}

export default { getEmergencyStop, setEmergencyStop, invalidateEmergencyStopCache };
