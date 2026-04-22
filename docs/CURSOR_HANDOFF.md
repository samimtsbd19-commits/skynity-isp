# 🤖 Cursor AI — Skynity ISP Completion Handoff

**For:** Cursor AI (or any AI coding assistant) continuing this project.
**From:** Claude (session ended at commit `c4442ff` — RADIUS shipped).
**Date:** 2026-04-21

This document is **self-contained**. Cursor has no memory of the prior
work — everything you need is below. Work **task by task, top to bottom**.
After each task: run the verification commands, commit, and move on.

---

## 0. Project orientation (read this first)

### What it is
Skynity ISP is a MikroTik-based ISP management platform for Bangladesh.
The operator runs a Starlink → MikroTik → 2× Cudy AP setup serving ~150
PPPoE/Hotspot users. Skynity is the control plane: customer onboarding
(Telegram bot), order/payment flow, auto-provisioning on MikroTik,
monitoring, suspensions, vouchers, multi-router, WireGuard tunnel, and
(as of commit `c4442ff`) full FreeRADIUS AAA.

### Stack
- **Backend:** Node 20 ESM + Express + MySQL 8.4 + Redis 7 + Zod + Pino
- **Frontend:** React 18 + Vite + Tailwind + React Query + Recharts
- **Bot:** node-telegram-bot-api (polling)
- **Router:** RouterOS 7 REST API via axios
- **RADIUS:** FreeRADIUS 3.2 (docker image)
- **Deploy:** Docker Compose + Caddy (auto-HTTPS)

### Key paths
```
skynity-isp/
├── docker-compose.yml
├── .env.example                  # all env vars documented here
├── backend/
│   ├── migrations/               # 001 → 020, forward-only SQL
│   ├── src/
│   │   ├── index.js              # app entrypoint
│   │   ├── config/index.js       # zod-validated env
│   │   ├── database/pool.js      # mysql2 pool, use db.query() + db.queryOne()
│   │   ├── middleware/auth.js    # requireAdmin, requireRole, signAdminToken
│   │   ├── middleware/rateLimit.js
│   │   ├── mikrotik/client.js    # RouterOS REST client
│   │   ├── routes/               # Express sub-routers per domain
│   │   ├── services/             # business logic, imported by routes
│   │   ├── jobs/scheduler.js     # all cron jobs live here
│   │   ├── utils/crypto.js       # encrypt()/decrypt() helpers
│   │   └── telegram/bot.js       # Telegram bot
├── frontend/
│   └── src/
│       ├── App.jsx               # router
│       ├── api/client.js         # axios wrapper, adds Bearer token
│       ├── components/
│       │   ├── Layout.jsx        # shell with nav
│       │   ├── PageHeader.jsx
│       │   └── primitives.jsx    # Button, Card, Input, Modal, Table
│       ├── pages/                # one .jsx per page
│       └── i18n/
├── docker/
│   ├── Caddyfile
│   └── freeradius/               # FreeRADIUS container
└── docs/
    ├── RADIUS.md                 # AAA runbook — reference for patterns
    └── CURSOR_HANDOFF.md         # (this file)
```

### Code conventions (follow these — the project is consistent)

1. **ESM only** — `import x from './y.js'` with the `.js` extension.
2. **DB access** — `import db from '../database/pool.js'` then
   `await db.query(sql, params)` or `await db.queryOne(sql, params)`.
   Never build SQL with string concatenation except for `LIMIT` /
   `OFFSET` (after parseInt-clamping).
3. **Config** — `import config from '../config/index.js'`. Add new env
   vars to `backend/src/config/index.js` (zod schema) AND `.env.example`.
4. **Auth** — every admin route uses `requireAdmin`; mutating routes
   use `requireRole('superadmin', 'admin')`. Public portal endpoints
   live under `/api/portal/` and have no auth.
5. **Feature flags** — use `system_settings` table via
   `getSetting('feature.xyz')`. Dormant-by-default like RADIUS is.
6. **Logging** — `import logger from '../utils/logger.js'` then
   `logger.info({ ctx }, 'msg')`. Never `console.log`.
7. **Error handling** — routes use `try { ... } catch (err) { res.status(500).json({ error: err.message }) }`.
   Services throw; routes translate to HTTP.
8. **No emojis in code or commits** unless the user explicitly asks.
9. **Migrations** — new file `backend/migrations/NNN_name.sql`. The
   migrate.js runner splits on `;\s*$` so statements must end with
   `;` on its own position. See `020_radius_aaa.sql` for the pattern.
10. **Commit style** — Conventional Commits: `feat(scope): summary`,
    `fix(scope): summary`. Always end with
    `Co-Authored-By: Cursor AI <noreply@cursor.sh>`.

### After every task
```bash
cd /c/Users/sk/Desktop/skynity_isp_sk/skynity-isp
# 1. parse-check all modified backend JS files
node --check backend/src/...modified_files...
# 2. If migration added — dry-run the splitter:
node -e "
  const fs = require('fs');
  const s = fs.readFileSync('backend/migrations/NNN_name.sql', 'utf8');
  const out = s.split(/;\\s*\$/m).map(x => x.trim())
    .map(x => x.replace(/^(?:\\s*--[^\\n]*\\n?)+/, '').trim())
    .filter(Boolean);
  console.log('statements:', out.length);
"
# 3. Commit (specific files only — never git add -A)
git add <file1> <file2> ...
git commit -m "feat(scope): summary

body

Co-Authored-By: Cursor AI <noreply@cursor.sh>"
git push origin main
```

### Deploy command to hand to the user after each sprint
```bash
# VPS: 46.202.166.89 — user ssh's as root and runs:
cd /root/skynity && git pull && docker compose up -d --build backend
# (swap `backend` for `backend frontend freeradius` if those changed)
```

---

## SPRINT 1 — Security Hardening (highest priority)

### Task 1.1 — Admin 2FA (TOTP)

**Why:** The admin panel manages money + customer credentials. One
password = one attacker. TOTP raises the bar enormously for minimal
code.

**Dependencies to add:**
```bash
cd backend && npm install otplib qrcode
```

**Migration:** `backend/migrations/021_admin_2fa.sql`
```sql
-- ============================================================
-- 021: Admin 2FA (TOTP)
-- ============================================================
SET NAMES utf8mb4;

ALTER TABLE admins
  ADD COLUMN totp_secret        VARCHAR(64)  NULL,
  ADD COLUMN totp_enabled       TINYINT(1)   NOT NULL DEFAULT 0,
  ADD COLUMN totp_enrolled_at   DATETIME     NULL,
  ADD COLUMN totp_backup_codes  TEXT         NULL COMMENT 'JSON array of 8 hashed one-time backup codes',
  ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0;

-- Existing superadmin bootstrapped with `admin/admin123` MUST rotate.
UPDATE admins SET must_change_password = 1
  WHERE username = 'admin' AND password_hash IS NOT NULL;
```

**New file:** `backend/src/services/twoFactor.js`
```js
// Centralised 2FA helper: setup flow, verify, backup codes.
// Uses otplib for TOTP (RFC 6238) + qrcode for enrollment QR.
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import db from '../database/pool.js';
import config from '../config/index.js';

authenticator.options = { window: 1 }; // +/- 30s clock drift tolerance

/** Start enrollment — returns { secret, otpauth, qrDataUrl }. Does NOT enable yet. */
export async function beginEnrollment(admin) {
  const secret = authenticator.generateSecret();
  const label = encodeURIComponent(`${config.APP_NAME}:${admin.username}`);
  const issuer = encodeURIComponent(config.APP_NAME);
  const otpauth = `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}`;
  const qrDataUrl = await QRCode.toDataURL(otpauth);
  // Persist secret but keep totp_enabled=0 until confirmVerify succeeds
  await db.query('UPDATE admins SET totp_secret = ? WHERE id = ?', [secret, admin.id]);
  return { secret, otpauth, qrDataUrl };
}

/** Finalize enrollment: verify a TOTP code and generate 8 backup codes. */
export async function confirmEnrollment(adminId, code) {
  const row = await db.queryOne('SELECT totp_secret FROM admins WHERE id = ?', [adminId]);
  if (!row?.totp_secret) throw new Error('no pending enrollment');
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

/** Verify on login — totp or backup. Returns true/false. */
export async function verify(adminId, code) {
  const row = await db.queryOne(
    'SELECT totp_secret, totp_backup_codes FROM admins WHERE id = ? AND totp_enabled = 1',
    [adminId]
  );
  if (!row) return false;
  const clean = String(code || '').replace(/\s/g, '');

  // TOTP path
  if (/^\d{6}$/.test(clean) && row.totp_secret) {
    return authenticator.check(clean, row.totp_secret);
  }

  // Backup code path — consume on use
  if (row.totp_backup_codes) {
    const list = JSON.parse(row.totp_backup_codes);
    for (let i = 0; i < list.length; i++) {
      if (await bcrypt.compare(clean, list[i])) {
        list.splice(i, 1);
        await db.query('UPDATE admins SET totp_backup_codes = ? WHERE id = ?',
          [JSON.stringify(list), adminId]);
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
```

**Edit:** `backend/src/routes/api.js` — modify `/auth/login` flow.
Flow: password correct + TOTP enabled → return `{ needs_2fa: true, session_id }`
instead of a token. Admin POSTs code to `/auth/login/2fa` with that
session_id to finalize.

Store the pending session in Redis (already available):
```js
import redis from 'ioredis';
const r = new redis({ host: config.REDIS_HOST, port: config.REDIS_PORT });
// After password matches but totp_enabled:
const sessionId = crypto.randomBytes(16).toString('hex');
await r.setex(`2fa:${sessionId}`, 300, String(admin.id)); // 5-min window
return res.json({ needs_2fa: true, session_id: sessionId });
```

New route `POST /api/auth/login/2fa`:
```js
router.post('/auth/login/2fa', loginRateLimit, async (req, res) => {
  const { session_id, code } = req.body || {};
  if (!session_id || !code) return res.status(400).json({ error: 'session_id and code required' });
  const adminId = await r.get(`2fa:${session_id}`);
  if (!adminId) return res.status(401).json({ error: 'session expired' });
  const ok = await twoFactor.verify(Number(adminId), code);
  if (!ok) {
    await security.logSecurityEvent({ eventType: 'admin_2fa_fail', severity: 'warning', adminId, ip: clientIp(req) });
    return res.status(401).json({ error: 'invalid 2fa code' });
  }
  await r.del(`2fa:${session_id}`);
  const admin = await db.queryOne('SELECT * FROM admins WHERE id = ?', [Number(adminId)]);
  const token = signAdminToken(admin);
  res.json({ token, admin: { id: admin.id, username: admin.username, full_name: admin.full_name, role: admin.role } });
});
```

Add 2FA setup routes:
```js
router.post('/auth/2fa/setup',  requireAdmin, async (req, res) => {
  res.json(await twoFactor.beginEnrollment(req.admin));
});
router.post('/auth/2fa/verify', requireAdmin, async (req, res) => {
  try { res.json(await twoFactor.confirmEnrollment(req.admin.id, req.body?.code)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.post('/auth/2fa/disable', requireAdmin, async (req, res) => {
  // Require password re-entry for security
  const admin = await db.queryOne('SELECT password_hash FROM admins WHERE id = ?', [req.admin.id]);
  if (!await bcrypt.compare(req.body?.password || '', admin.password_hash)) {
    return res.status(401).json({ error: 'password incorrect' });
  }
  await twoFactor.disable(req.admin.id);
  res.json({ ok: true });
});
```

**Frontend:** `frontend/src/pages/Login.jsx`
- On `/auth/login` response, if `needs_2fa: true`, show a second input
  for the 6-digit code + "use a backup code instead" link.
- Submit to `/auth/login/2fa`.

**Frontend:** `frontend/src/pages/Settings.jsx` (or a new
`SecuritySettings.jsx` section)
- "Enable 2FA" button → calls `/auth/2fa/setup` → shows QR image
  (`qrDataUrl`) + manual secret.
- Input for first TOTP code → POST `/auth/2fa/verify` → shows 8
  one-time backup codes (require download/print confirmation).
- "Disable 2FA" — requires password.

**Verify:**
```bash
# Run locally in dev:
cd backend && node --check src/services/twoFactor.js src/routes/api.js

# After deploy:
# 1. Login as admin, enable 2FA, scan QR in Google Authenticator
# 2. Verify code → get backup codes
# 3. Logout, log back in — should prompt for code
# 4. Try a backup code — should succeed and remove it
```

---

### Task 1.2 — Force password change on first login

**Why:** `index.js` bootstraps `admin/admin123` on empty install. Many
deployments never rotate. Forcing rotation = belt-and-braces.

**Already done in Task 1.1's migration:** `admins.must_change_password`
column + seed flag for existing `admin` user.

**Edit:** `backend/src/middleware/auth.js` — after validating the JWT,
check the flag. If set, block every endpoint except the password-change
one.

```js
// In requireAdmin, after loading the admin:
if (admin.must_change_password && req.path !== '/auth/change-password') {
  return res.status(428).json({
    error: 'password change required',
    code: 'PASSWORD_CHANGE_REQUIRED',
  });
}
```

**Edit:** `backend/src/routes/api.js` — `/auth/change-password` route,
after success, clear the flag:
```js
await db.query('UPDATE admins SET password_hash = ?, must_change_password = 0 WHERE id = ?',
  [hash, req.admin.id]);
```

**Frontend:** in `api/client.js` axios interceptor, if response is
`428 PASSWORD_CHANGE_REQUIRED`, redirect to `/change-password`.

**Verify:**
```bash
# Fresh VPS deploy should force admin to change on first login
curl -X POST https://wifi.skynity.org/api/auth/login \
  -d '{"username":"admin","password":"admin123"}' \
  -H "Content-Type: application/json"
# Get token, then:
curl https://wifi.skynity.org/api/customers -H "Authorization: Bearer $TOKEN"
# Should return 428 PASSWORD_CHANGE_REQUIRED
```

---

### Task 1.3 — Encrypt RADIUS secrets at rest

**Why:** `mikrotik_routers.radius_secret` and `nas.secret` are
plaintext. Router passwords (`password_enc`) already use the
`encrypt()`/`decrypt()` helpers in `backend/src/utils/crypto.js`.
Apply the same to RADIUS secrets on the Skynity side; the FreeRADIUS
side (nas.secret) must remain plaintext because FreeRADIUS reads it
directly.

**Approach:** keep the column but store ciphertext, decrypt on read
path inside `radius.upsertNas()` right before writing to `nas.secret`.

**Migration:** `backend/migrations/022_encrypt_radius_secret.sql`
```sql
-- Rename existing column so code can do a one-time encrypt-and-move
ALTER TABLE mikrotik_routers
  CHANGE COLUMN radius_secret radius_secret_plain VARCHAR(128) NULL,
  ADD COLUMN radius_secret_enc TEXT NULL AFTER radius_secret_plain;
```

**One-shot script:** `backend/src/scripts/encrypt-radius-secrets.js`
```js
// Run once: node src/scripts/encrypt-radius-secrets.js
import db from '../database/pool.js';
import { encrypt } from '../utils/crypto.js';

const rows = await db.query(`SELECT id, radius_secret_plain FROM mikrotik_routers WHERE radius_secret_plain IS NOT NULL`);
for (const r of rows) {
  const enc = encrypt(r.radius_secret_plain);
  await db.query('UPDATE mikrotik_routers SET radius_secret_enc = ?, radius_secret_plain = NULL WHERE id = ?', [enc, r.id]);
  console.log('migrated router', r.id);
}
process.exit(0);
```

**Edit:** `backend/src/services/radius.js` — `upsertNas()`:
```js
// Change the secret-read line to:
const rawSecret = router.radius_secret_enc
  ? decrypt(router.radius_secret_enc)
  : router.radius_secret_plain || (await getSetting('radius.default_secret')) || '';
```

**Edit:** `backend/src/routes/routers.js` — on POST/PATCH, encrypt
before storing:
```js
if (b.radius_secret) {
  updates.push(['radius_secret_enc', encrypt(b.radius_secret)]);
  updates.push(['radius_secret_plain', null]);
}
```

**Edit:** `backend/src/routes/radius.js` — `/nas` POST, same treatment.

**Drop old column (next migration, after confirming all rows migrated):**
`023_drop_radius_secret_plain.sql` — just `ALTER TABLE mikrotik_routers DROP COLUMN radius_secret_plain;`

---

### Task 1.4 — Global + per-endpoint rate limiting

**Why:** only `/auth/login` is limited today. Order submission, portal
endpoints (unauthenticated), RADIUS CoA disconnect can all be abused.

**Already have:** `backend/src/middleware/rateLimit.js` — Redis-backed.

**Edit:** `backend/src/routes/api.js` — apply a generous global limit,
then stricter per-area limits:
```js
const apiRateLimit = rateLimit({
  windowMs: 60_000,
  max: 300,                            // 300 req/min/IP overall
  message: 'Too many requests',
  keyFn: (req) => `api:${req.ip}`,
});
router.use(apiRateLimit);

const portalRateLimit = rateLimit({
  windowMs: 60_000,
  max: 30,                             // much stricter for public
  keyFn: (req) => `portal:${req.ip}`,
});
router.use('/portal', portalRateLimit, portalRouter);

const radiusMutationLimit = rateLimit({
  windowMs: 60_000, max: 10,
  keyFn: (req) => `radius-mut:${req.admin?.id || req.ip}`,
});
// apply to POST /radius/disconnect, /radius/enable, /radius/sync, etc.
```

---

### Task 1.5 — Daily MySQL + uploads backup

**Why:** only persistence is the docker volume. Volume loss = full
data loss.

**New file:** `backend/src/jobs/backup.js`
```js
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import config from '../config/index.js';
import logger from '../utils/logger.js';
const pexec = promisify(exec);

const BACKUP_DIR = process.env.BACKUP_DIR || '/var/backups/skynity';
const RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS || 14);

export async function runDailyBackup() {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const sqlFile = path.join(BACKUP_DIR, `skynity-${ts}.sql.gz`);

  // mysqldump is available inside the mysql container — we exec
  // into it via docker from the host. In production, mount this
  // backup job as a sidecar OR just run from host crontab.
  // Here we use the mysqldump binary (install it in backend image).
  const cmd = [
    'mysqldump',
    `-h ${config.DB_HOST}`,
    `-u ${config.DB_USER}`,
    `--password=${config.DB_PASSWORD}`,
    '--single-transaction --quick --routines --triggers',
    config.DB_NAME,
    `| gzip > ${sqlFile}`,
  ].join(' ');

  try {
    await pexec(cmd, { shell: '/bin/sh' });
    const stat = await fs.stat(sqlFile);
    logger.info({ file: sqlFile, bytes: stat.size }, 'db backup ok');
  } catch (err) {
    logger.error({ err: err.message }, 'db backup failed');
    return;
  }

  // Prune files older than RETENTION_DAYS
  const now = Date.now();
  const files = await fs.readdir(BACKUP_DIR);
  for (const f of files) {
    const p = path.join(BACKUP_DIR, f);
    const st = await fs.stat(p);
    if (now - st.mtimeMs > RETENTION_DAYS * 86400_000) {
      await fs.unlink(p);
      logger.info({ file: f }, 'backup pruned');
    }
  }
}
```

**Edit:** `backend/src/jobs/scheduler.js` — add:
```js
import { runDailyBackup } from './backup.js';
cron.schedule('30 2 * * *', () => guard('dailyBackup', () => runDailyBackup())
  .catch((e) => logger.error({ e }, 'daily backup')));
```

**Edit:** `backend/Dockerfile` — ensure `mysql-client` is installed so
`mysqldump` exists:
```dockerfile
RUN apk add --no-cache mysql-client gzip
```
(Check the base image — if it's `node:20-alpine` use apk; if debian,
`apt-get install -y default-mysql-client gzip`.)

**Edit:** `docker-compose.yml` — mount a host directory for backups:
```yaml
backend:
  volumes:
    - ./backups:/var/backups/skynity
```

Add to `.env.example`:
```
BACKUP_DIR=/var/backups/skynity
BACKUP_RETENTION_DAYS=14
```

**Verify:**
```bash
docker compose exec backend node -e "import('./src/jobs/backup.js').then(m=>m.runDailyBackup())"
ls ./backups/   # should see skynity-YYYY-MM-DD....sql.gz
```

---

## SPRINT 2 — Finish the half-built features

### Task 2.1 — Monthly quota enforcement

**Why:** migration `016_monthly_quota.sql` added quota columns but no
service code exists. With RADIUS now shipped, throttling = group swap.

**New file:** `backend/src/services/quota.js`
```js
// Monthly data quota enforcement.
// * Checks every active subscription's quota_used_gb vs package.monthly_quota_gb.
// * If over → set quota_throttled=1 and swap to PKG_THROTTLED RADIUS group.
// * On the 1st of every month → reset quota_used_gb to 0 and un-throttle.
// * quota_used_gb is incremented by the existing scheduler.snapshotUsage()
//   path (already writes bytes_in/bytes_out into subscriptions).
import db from '../database/pool.js';
import radius from './radius.js';
import logger from '../utils/logger.js';

// RADIUS group that slows everyone down to 1 Mbps. Must be pre-created
// OR upsert it from a fake "throttle" package in DB. We do the latter
// automatically on first run.
const THROTTLE_GROUP = 'PKG_THROTTLED';

async function ensureThrottleGroup() {
  const existing = await db.queryOne(
    `SELECT 1 FROM radgroupreply WHERE groupname = ? LIMIT 1`,
    [THROTTLE_GROUP]
  );
  if (existing) return;
  await db.query(
    `INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES
      (?, 'Mikrotik-Rate-Limit', ':=', '1M/1M'),
      (?, 'Service-Type',       ':=', 'Framed-User'),
      (?, 'Framed-Protocol',    ':=', 'PPP'),
      (?, 'Reply-Message',      ':=', 'skynity:quota-exceeded')`,
    [THROTTLE_GROUP, THROTTLE_GROUP, THROTTLE_GROUP, THROTTLE_GROUP]
  );
  logger.info('created PKG_THROTTLED radius group');
}

/** Check all subs, throttle/unthrottle as needed. */
export async function enforceQuotas() {
  const subs = await db.query(
    `SELECT s.id, s.login_username, s.quota_used_gb, s.quota_throttled,
            s.package_id, p.monthly_quota_gb, p.code AS pkg_code
       FROM subscriptions s
       JOIN packages p ON p.id = s.package_id
      WHERE s.status = 'active' AND p.monthly_quota_gb IS NOT NULL`
  );
  await ensureThrottleGroup();

  let throttled = 0, restored = 0;
  for (const s of subs) {
    const over = Number(s.quota_used_gb) >= Number(s.monthly_quota_gb);
    if (over && !s.quota_throttled) {
      // Throttle: swap radusergroup to PKG_THROTTLED, queue a
      // CoA so the NAS re-reads the group on reauth.
      await db.query(
        `UPDATE radusergroup SET groupname = ? WHERE username = ?`,
        [THROTTLE_GROUP, s.login_username]
      );
      await db.query('UPDATE subscriptions SET quota_throttled = 1 WHERE id = ?', [s.id]);
      await radius.queueDisconnect({
        subscriptionId: s.id, username: s.login_username,
        reason: 'quota-exceeded',
      });
      throttled++;
      logger.info({ subId: s.id, used: s.quota_used_gb }, 'quota throttle applied');
    } else if (!over && s.quota_throttled) {
      // Admin extended the quota or month rolled over — restore.
      await db.query('UPDATE subscriptions SET quota_throttled = 0 WHERE id = ?', [s.id]);
      // Re-push normal group via radius.upsertUser
      const fresh = await db.queryOne('SELECT * FROM subscriptions WHERE id = ?', [s.id]);
      await radius.upsertUser(fresh);
      restored++;
    }
  }
  return { throttled, restored, checked: subs.length };
}

/** 1st of month: reset all quotas + un-throttle. */
export async function resetMonthly() {
  const r = await db.query(
    `UPDATE subscriptions SET quota_used_gb = 0, quota_throttled = 0, quota_reset_at = NOW()`
  );
  logger.info({ rows: r.affectedRows }, 'monthly quota reset');
  // Re-push everyone — puts them back on their normal RADIUS group.
  const subs = await db.query(`SELECT * FROM subscriptions WHERE status = 'active'`);
  for (const s of subs) await radius.upsertUser(s);
  return { reset: r.affectedRows };
}

/** Hook from scheduler.snapshotUsage — convert bytes delta to GB. */
export async function addUsage(subscriptionId, deltaBytesIn, deltaBytesOut) {
  const totalBytes = BigInt(deltaBytesIn || 0) + BigInt(deltaBytesOut || 0);
  if (totalBytes === 0n) return;
  const gb = Number(totalBytes) / (1024 ** 3);
  await db.query(
    `UPDATE subscriptions SET quota_used_gb = quota_used_gb + ? WHERE id = ?`,
    [gb, subscriptionId]
  );
}

export default { enforceQuotas, resetMonthly, addUsage, ensureThrottleGroup };
```

**Edit:** `backend/src/jobs/scheduler.js`:
```js
import quota from '../services/quota.js';
// Every 5 min: evaluate quotas
cron.schedule('*/5 * * * *',  () => guard('quotaEnforce', () => quota.enforceQuotas())
  .catch((e) => logger.error({ e }, 'quota enforce')));
// 00:05 on 1st of month: reset
cron.schedule('5 0 1 * *',    () => guard('quotaReset', () => quota.resetMonthly())
  .catch((e) => logger.error({ e }, 'quota reset')));
```

And in `snapshotUsage` (same file) right after incrementing
`subscriptions.bytes_in`/`bytes_out`, call `quota.addUsage(s.id, deltaIn, deltaOut)`.

**Routes:** add `backend/src/routes/api.js`:
```js
router.get('/subscriptions/:id/quota', requireAdmin, async (req, res) => {
  const row = await db.queryOne(
    `SELECT s.quota_used_gb, s.quota_throttled, s.quota_reset_at,
            p.monthly_quota_gb
       FROM subscriptions s JOIN packages p ON p.id = s.package_id
      WHERE s.id = ?`, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json({
    used_gb: Number(row.quota_used_gb),
    limit_gb: row.monthly_quota_gb,
    throttled: !!row.quota_throttled,
    reset_at: row.quota_reset_at,
    percent: row.monthly_quota_gb ? (Number(row.quota_used_gb) / row.monthly_quota_gb) * 100 : null,
  });
});
```

Allow `monthly_quota_gb` in POST/PATCH `/packages`.

**Frontend:** add quota progress bar to `CustomerDetail.jsx`, quota
input field to `Packages.jsx` form.

---

### Task 2.2 — Access Points inventory UI

**Why:** `access_points` table (migration 019) exists but no routes /
pages. Operator can't view or edit their Cudy AX3000s.

**New route:** `backend/src/routes/accessPoints.js`
```js
import { Router } from 'express';
import db from '../database/pool.js';
import { requireAdmin, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAdmin, async (_req, res) => {
  const rows = await db.query(`SELECT * FROM access_points ORDER BY id`);
  res.json({ access_points: rows });
});

router.post('/', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'name required' });
  const r = await db.query(
    `INSERT INTO access_points (name, model, mac_address, ip_address, location,
       admin_url, admin_username, admin_password, router_id, uplink_iface,
       ssid_24, ssid_5, guest_enabled, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [b.name, b.model || 'Cudy AX3000', b.mac_address || null, b.ip_address || null,
     b.location || null, b.admin_url || null, b.admin_username || null, b.admin_password || null,
     b.router_id || null, b.uplink_iface || null, b.ssid_24 || null, b.ssid_5 || null,
     b.guest_enabled ? 1 : 0, b.notes || null]
  );
  res.json({ id: r.insertId });
});

router.patch('/:id', requireAdmin, requireRole('superadmin', 'admin'), async (req, res) => {
  const allowed = ['name','model','mac_address','ip_address','location','admin_url',
    'admin_username','admin_password','router_id','uplink_iface','ssid_24','ssid_5',
    'guest_enabled','notes','firmware_version'];
  const entries = Object.entries(req.body || {}).filter(([k]) => allowed.includes(k));
  if (!entries.length) return res.status(400).json({ error: 'nothing to update' });
  const set = entries.map(([k]) => `${k} = ?`).join(', ');
  await db.query(`UPDATE access_points SET ${set} WHERE id = ?`,
    [...entries.map(([, v]) => v), Number(req.params.id)]);
  res.json({ ok: true });
});

router.delete('/:id', requireAdmin, requireRole('superadmin'), async (req, res) => {
  await db.query('DELETE FROM access_points WHERE id = ?', [Number(req.params.id)]);
  res.json({ ok: true });
});

// Simple ICMP ping probe — updates last_seen_at + status
router.post('/:id/ping', requireAdmin, async (req, res) => {
  const ap = await db.queryOne('SELECT * FROM access_points WHERE id = ?', [Number(req.params.id)]);
  if (!ap) return res.status(404).json({ error: 'not found' });
  if (!ap.ip_address) return res.status(400).json({ error: 'no ip_address set' });
  // Reuse net-ping or node's dgram; simplest: shell out to `ping`
  // (container must have iputils-ping installed).
  const { exec } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const pexec = promisify(exec);
  try {
    const t0 = Date.now();
    await pexec(`ping -c 1 -W 2 ${ap.ip_address}`);
    const ms = Date.now() - t0;
    await db.query(
      `UPDATE access_points SET status = 'online', last_seen_at = NOW(), last_ping_ms = ? WHERE id = ?`,
      [ms, ap.id]);
    res.json({ ok: true, ms });
  } catch {
    await db.query(
      `UPDATE access_points SET status = 'offline' WHERE id = ?`, [ap.id]);
    res.json({ ok: false, offline: true });
  }
});

export default router;
```

Mount in `api.js`:
```js
import accessPointsRouter from './accessPoints.js';
router.use('/access-points', accessPointsRouter);
```

**Frontend:** `frontend/src/pages/AccessPoints.jsx`
- Table with columns: Name · Model · IP · Status · Last seen · SSIDs · Actions
- "Add AP" modal
- "Ping all" button → parallel POST to each
- Filter by router_id

Add route in `App.jsx` and nav item in `Layout.jsx`.

---

### Task 2.3 — Reseller tenant isolation

**Why:** `admins.role` already has `'reseller'` but nothing enforces
row-level isolation. If you onboard a reseller today, they see
everything.

**Migration:** `backend/migrations/024_reseller_tenant.sql`
```sql
ALTER TABLE admins
  ADD COLUMN reseller_parent_id INT UNSIGNED NULL COMMENT 'If this admin is a reseller, which admin created them',
  ADD COLUMN commission_pct DECIMAL(5,2) NOT NULL DEFAULT 0 COMMENT 'Resellers payout share %';

ALTER TABLE customers
  ADD COLUMN reseller_id INT UNSIGNED NULL,
  ADD KEY idx_customer_reseller (reseller_id),
  ADD CONSTRAINT fk_customer_reseller FOREIGN KEY (reseller_id) REFERENCES admins(id) ON DELETE SET NULL;

ALTER TABLE subscriptions
  ADD COLUMN reseller_id INT UNSIGNED NULL,
  ADD KEY idx_sub_reseller (reseller_id);

ALTER TABLE orders
  ADD COLUMN reseller_id INT UNSIGNED NULL,
  ADD KEY idx_order_reseller (reseller_id);
```

**Edit:** `backend/src/middleware/auth.js` — helper:
```js
// Attach a WHERE-clause fragment to req for resellers.
export function resellerScope(req) {
  if (req.admin?.role === 'reseller') {
    return { sql: ' AND reseller_id = ? ', params: [req.admin.id] };
  }
  return { sql: '', params: [] };
}
```

**Edit** every listing query in `backend/src/routes/api.js` that
returns customers/subscriptions/orders to apply the scope. Example:
```js
router.get('/customers', requireAdmin, async (req, res) => {
  const scope = resellerScope(req);
  const rows = await db.query(
    `SELECT * FROM customers WHERE 1=1 ${scope.sql} ORDER BY created_at DESC LIMIT 100`,
    scope.params);
  res.json({ customers: rows });
});
```

**Edit:** `services/provisioning.js` — when a reseller approves an
order, stamp `reseller_id` on the new `customer`, `subscription`, and
`order` rows.

**Frontend:** new page `Resellers.jsx` for superadmins to create
reseller accounts with commission %.

---

## SPRINT 3 — Payment + Alerting

### Task 3.1 — bKash Merchant API (tokenised) + webhook

**Why:** today every payment requires an admin to eyeball a screenshot
and click Approve. bKash Tokenized Checkout lets you auto-verify.

**Docs:** https://developer.bka.sh/docs (get sandbox creds first).

**Env vars (add to `.env.example` + `config/index.js`):**
```
BKASH_APP_KEY=
BKASH_APP_SECRET=
BKASH_USERNAME=
BKASH_PASSWORD=
BKASH_BASE_URL=https://tokenized.sandbox.bka.sh/v1.2.0-beta
BKASH_MODE=sandbox   # or "live"
```

**New file:** `backend/src/services/bkashApi.js`
- `getToken()` — caches OAuth token in Redis for 50 min
- `createPayment(orderId, amount)` — returns payment URL
- `executePayment(paymentId)` — confirms after customer pays
- `queryPayment(paymentId)` — reconcile

**Route:** `backend/src/routes/bkash.js`
- `POST /api/portal/bkash/create` — customer hits this, gets redirect URL
- `POST /api/portal/bkash/callback` — bKash webhook → `executePayment` → `approveOrderAndProvision`

This one is big — implement behind `feature.bkash_api` flag so screenshot
flow keeps working until tested.

---

### Task 3.2 — Daily Telegram admin digest

**Why:** admins want a morning summary instead of watching the dashboard.

**New function in `backend/src/jobs/scheduler.js`:**
```js
async function dailyDigest() {
  const bot = getBot(); // from telegram/bot.js
  if (!bot) return;
  const [revenue, newCust, expiring, suspended, online] = await Promise.all([
    db.queryOne(`SELECT COALESCE(SUM(amount),0) AS s, COUNT(*) AS c
                   FROM payments WHERE status='verified' AND DATE(verified_at)=CURDATE()`),
    db.queryOne(`SELECT COUNT(*) AS c FROM customers WHERE DATE(created_at)=CURDATE()`),
    db.queryOne(`SELECT COUNT(*) AS c FROM subscriptions WHERE status='active'
                   AND expires_at BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 3 DAY)`),
    db.queryOne(`SELECT COUNT(*) AS c FROM subscriptions WHERE status='suspended'`),
    (async () => {
      try { const mt = await getMikrotikClient(); return (await mt.listPppActive()).length; }
      catch { return '?'; }
    })(),
  ]);
  const msg = [
    '📊 *Daily Digest*',
    `Revenue today: ${config.CURRENCY_SYMBOL}${revenue.s} (${revenue.c} tx)`,
    `New customers: ${newCust.c}`,
    `Expiring in 3 days: ${expiring.c}`,
    `Currently suspended: ${suspended.c}`,
    `Online now: ${online}`,
  ].join('\n');
  for (const id of config.TELEGRAM_ADMIN_IDS) {
    try { await bot.sendMessage(id, msg, { parse_mode: 'Markdown' }); }
    catch (err) { logger.warn({ err: err.message, id }, 'digest send failed'); }
  }
}
cron.schedule('0 9 * * *', () => guard('dailyDigest', () => dailyDigest()));
```

---

### Task 3.3 — Router-offline alerting

**Why:** `services/health.js` evaluates rules but doesn't page anyone.

**Edit:** `services/health.js` — when a rule fires with severity
`critical`, send Telegram + optional email.

Minimum: inside the existing `runHealthChecks()`, on every router that
has been offline > 5 min (last_seen_at or last poll failure), send one
Telegram message to admins. De-dupe by storing last-alerted-at in
`system_settings` so you don't spam.

---

## SPRINT 4 — Polish

### Task 4.1 — Customer self-service password reset

**Route:** `POST /api/portal/account/reset-password`
- Input: phone + new_password
- Send OTP via existing `services/otp.js` → customer confirms
- Update `subscriptions.login_password` for all their active subs
- Push to MikroTik + RADIUS

### Task 4.2 — Backend + frontend integration tests

Add **Vitest** to backend:
```bash
cd backend && npm install -D vitest supertest
```

Example test file `backend/tests/radius.test.js`:
```js
import { describe, it, expect, beforeAll } from 'vitest';
import radius from '../src/services/radius.js';

describe('radius.groupnameForPackage', () => {
  it('returns radius_group if set', () => {
    expect(radius.groupnameForPackage({ radius_group: 'CUSTOM' })).toBe('CUSTOM');
  });
  it('derives from package code otherwise', () => {
    expect(radius.groupnameForPackage({ code: 'pppoe-5m-30d' })).toBe('PKG_PPPOE_5M_30D');
  });
});
```

Add to `backend/package.json`:
```json
"scripts": { "test": "vitest run" }
```

### Task 4.3 — Mobile app build + Play Store

Capacitor scripts already in `frontend/package.json`. Run:
```bash
cd frontend
npm run build && npx cap add android && npx cap sync android
npx cap open android   # opens Android Studio — build signed AAB
```

See `docs/MOBILE_APP.md` for current state.

---

## Reference — existing patterns to copy

### Pattern: new feature with DB + service + route + cron + flag
Use `backend/src/services/radius.js` + `routes/radius.js` +
`migrations/020_radius_aaa.sql` as the canonical template:
1. Migration adds tables + settings rows
2. Service exposes one default-export object with named methods
3. Service respects a `feature.<name>_enabled` flag → no-op if off
4. Routes live in `routes/<name>.js`, mounted in `routes/api.js`
5. Cron loops in `jobs/scheduler.js` with `guard()` wrapper
6. Admin UI page in `frontend/src/pages/<Name>.jsx`

### Pattern: frontend API call
```js
// frontend/src/api/client.js already configured
import api from '../api/client';
const { data } = await api.get('/radius/status');
```

### Pattern: admin page shell
```jsx
// frontend/src/pages/Example.jsx
import { useQuery } from '@tanstack/react-query';
import api from '../api/client';
import PageHeader from '../components/PageHeader';
import { Card, Button, Table } from '../components/primitives';

export default function Example() {
  const { data, isLoading } = useQuery({
    queryKey: ['example'],
    queryFn: () => api.get('/example').then((r) => r.data),
  });
  return (
    <>
      <PageHeader title="Example" subtitle="..." />
      <Card>{isLoading ? 'Loading…' : JSON.stringify(data)}</Card>
    </>
  );
}
```

### Pattern: adding a cron job
```js
// backend/src/jobs/scheduler.js — inside startJobs()
cron.schedule('*/5 * * * *', () =>
  guard('myJob', () => myService.doSomething())
    .catch((e) => logger.error({ e }, 'myJob')));
```

---

## Deployment checklist after each sprint

1. `git push origin main` — CI is not set up, push straight to main
2. On VPS (`ssh root@46.202.166.89`):
   ```bash
   cd /root/skynity
   git pull
   docker compose up -d --build backend frontend  # or just the changed ones
   docker compose logs backend --tail=50          # watch for errors
   ```
3. Smoke test: `curl https://wifi.skynity.org/health` should return
   `{"status":"ok","db":"ok",...}`
4. Admin login: https://admin.skynity.org → username=`admin`,
   password=(whatever the operator set). For first-deploy: `admin123`.

---

## Credentials / URLs reference

| Thing | Value |
|-------|-------|
| VPS IP | `46.202.166.89` |
| Public portal | https://wifi.skynity.org |
| Admin panel | https://admin.skynity.org |
| MikroTik (primary) | `192.168.50.1` (LAN) or `10.88.0.2` (via WireGuard) |
| MikroTik REST port | 80 (HTTP, no SSL) |
| MikroTik user/pass | in `mikrotik_routers` row id=1 |
| Default admin | `admin / admin123` — change on first login |
| DB inside docker | host `mysql`, db `skynity`, user `skynity` |
| FreeRADIUS auth/acct/coa | 1812/1813/3799 UDP |

---

## What's already done (don't redo)

- ✅ Core provisioning (order → payment → MikroTik)
- ✅ Multi-router with load-balancer
- ✅ Suspensions (apply/lift, auto-expire)
- ✅ Expiry cron + expiry-reminder notifications
- ✅ Hotspot management (sessions, users, profiles, template editor)
- ✅ Vouchers + offers
- ✅ Dynamic PCQ (Starlink auto-update)
- ✅ WireGuard tunnel VPS↔MikroTik
- ✅ Telegram bot (15+ commands + AI)
- ✅ Activity log + security audit
- ✅ SNMP bandwidth polling
- ✅ Live monitor (WebSocket)
- ✅ Config generator (.rsc downloads for MikroTik)
- ✅ Invoice HTML rendering
- ✅ **RADIUS / AAA** (commit `c4442ff`) — gated on `feature.radius_enabled`

## What's still to do (this document)

- ⬜ Sprint 1.1: Admin 2FA (TOTP)
- ⬜ Sprint 1.2: Force password change on first login
- ⬜ Sprint 1.3: Encrypt RADIUS secrets at rest
- ⬜ Sprint 1.4: Global + per-endpoint rate limiting
- ⬜ Sprint 1.5: Daily MySQL backup cron
- ⬜ Sprint 2.1: Monthly quota enforcement (with RADIUS group swap)
- ⬜ Sprint 2.2: Access Points inventory UI
- ⬜ Sprint 2.3: Reseller tenant isolation
- ⬜ Sprint 3.1: bKash Merchant API + webhook
- ⬜ Sprint 3.2: Daily Telegram admin digest
- ⬜ Sprint 3.3: Router-offline alerting
- ⬜ Sprint 4.1: Customer self-service password reset
- ⬜ Sprint 4.2: Vitest test suite (backend)
- ⬜ Sprint 4.3: Mobile app build + Play Store submission

## Final notes

- **Work in commit-sized chunks** — one task = one PR / one commit.
- **Never bypass auth or rate limits** in your new code.
- **Every new env var** → add to `.env.example` + `config/index.js` zod.
- **Every new migration** → test splitter, use `;` terminators.
- **Every new feature with a flag** → default OFF, hook is a no-op
  until toggled on.
- **Do not delete** `.claude/` or any files in `C:\Users\sk\.claude\`.
- If you hit a design question Claude didn't answer, **check
  `docs/RADIUS.md`** — it's the freshest end-to-end reference for how
  features are built in this repo.

Good luck. 🛰️
