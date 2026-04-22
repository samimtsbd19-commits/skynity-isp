import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import db from '../database/pool.js';
import config from '../config/index.js';

authenticator.options = { window: 1 };

export async function beginEnrollment(admin) {
  if (admin.totp_enabled) throw new Error('2FA already enabled; disable first');
  const secret = authenticator.generateSecret();
  const label = encodeURIComponent(`${config.APP_NAME}:${admin.username}`);
  const issuer = encodeURIComponent(config.APP_NAME);
  const otpauth = `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}`;
  const qrDataUrl = await QRCode.toDataURL(otpauth);
  await db.query('UPDATE admins SET totp_secret = ? WHERE id = ?', [secret, admin.id]);
  return { secret, otpauth, qrDataUrl };
}

export async function confirmEnrollment(adminId, code) {
  const row = await db.queryOne('SELECT totp_secret, totp_enabled FROM admins WHERE id = ?', [adminId]);
  if (!row?.totp_secret) throw new Error('no pending enrollment');
  if (row.totp_enabled) throw new Error('2FA already enabled');
  if (!authenticator.check(String(code).replace(/\s/g, ''), row.totp_secret)) {
    throw new Error('invalid code');
  }
  const codes = Array.from({ length: 8 }, () => crypto.randomBytes(5).toString('hex'));
  const hashed = await Promise.all(codes.map((c) => bcrypt.hash(c, 10)));
  await db.query(
    `UPDATE admins SET totp_enabled = 1, totp_enrolled_at = NOW(), totp_backup_codes = ? WHERE id = ?`,
    [JSON.stringify(hashed), adminId]
  );
  return { backupCodes: codes };
}

export async function verify(adminId, code) {
  const row = await db.queryOne(
    'SELECT totp_secret, totp_backup_codes FROM admins WHERE id = ? AND totp_enabled = 1',
    [adminId]
  );
  if (!row) return false;
  const clean = String(code || '').replace(/\s/g, '');

  if (/^\d{6}$/.test(clean) && row.totp_secret) {
    return authenticator.check(clean, row.totp_secret);
  }

  if (row.totp_backup_codes) {
    const list = JSON.parse(row.totp_backup_codes);
    for (let i = 0; i < list.length; i++) {
      if (await bcrypt.compare(clean, list[i])) {
        list.splice(i, 1);
        await db.query('UPDATE admins SET totp_backup_codes = ? WHERE id = ?', [JSON.stringify(list), adminId]);
        return true;
      }
    }
  }
  return false;
}

export async function disable(adminId) {
  await db.query(
    `UPDATE admins SET totp_enabled = 0, totp_secret = NULL, totp_backup_codes = NULL, totp_enrolled_at = NULL WHERE id = ?`,
    [adminId]
  );
}

export default { beginEnrollment, confirmEnrollment, verify, disable };
