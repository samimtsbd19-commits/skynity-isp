import { getMikrotikClient } from '../mikrotik/client.js';
import radius from './radius.js';
import logger from '../utils/logger.js';

export async function pushSubscriptionPasswordToNetwork(sub, newPassword, pkg) {
  const mt = await getMikrotikClient(sub.router_id);
  if (sub.service_type === 'pppoe') {
    const sec = await mt.findPppSecretByName(sub.login_username);
    if (!sec) throw new Error('PPPoE user not found on router — sync subscription first');
    await mt.updatePppSecret(sec['.id'], { password: newPassword });
  } else {
    const user = await mt.findHotspotUserByName(sub.login_username);
    if (!user) throw new Error('Hotspot user not found on router — sync subscription first');
    await mt.patch(`/ip/hotspot/user/${encodeURIComponent(user['.id'])}`, { password: newPassword });
  }
  try {
    await radius.upsertUser({ ...sub, login_password: newPassword }, { pkg });
  } catch (err) {
    logger.warn({ err: err.message, subId: sub.id }, 'RADIUS sync after password change failed');
  }
}

export default { pushSubscriptionPasswordToNetwork };
