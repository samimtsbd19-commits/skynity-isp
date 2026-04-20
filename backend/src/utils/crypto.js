import crypto from 'node:crypto';
import config from '../config/index.js';

// Derive a stable 32-byte key from JWT_SECRET (we piggy-back the secret)
const KEY = crypto.createHash('sha256').update(config.JWT_SECRET).digest();
const ALGO = 'aes-256-gcm';

export function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decrypt(b64) {
  if (!b64) return '';
  const buf = Buffer.from(b64, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv(ALGO, KEY, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString('utf8');
}

export function randomPassword(len = 10) {
  // readable password: avoid 0/O/1/l/I
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  const bytes = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length];
  return out;
}

export function randomUsername(prefix = 'u') {
  return prefix + crypto.randomBytes(3).toString('hex');
}
