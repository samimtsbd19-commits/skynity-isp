/**
 * One-shot: copy mikrotik_routers.radius_secret_plain into radius_secret_enc
 * using app encryption, then clear plaintext. Run after migration 022:
 *   node src/scripts/encrypt-radius-secrets.js
 */
import db from '../database/pool.js';
import { encrypt } from '../utils/crypto.js';

const rows = await db.query(
  `SELECT id, radius_secret_plain FROM mikrotik_routers WHERE radius_secret_plain IS NOT NULL AND radius_secret_plain != ''`
);
for (const r of rows) {
  const enc = encrypt(r.radius_secret_plain);
  await db.query(
    'UPDATE mikrotik_routers SET radius_secret_enc = ?, radius_secret_plain = NULL WHERE id = ?',
    [enc, r.id]
  );
  process.stdout.write(`migrated router ${r.id}\n`);
}
process.exit(0);
