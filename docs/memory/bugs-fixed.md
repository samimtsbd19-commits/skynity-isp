---
name: Bugs Already Fixed
description: All bugs found and fixed during testing session — do NOT re-fix these
type: project
originSessionId: b538d755-9caa-44c5-95b4-160c34872bc9
---
## Bug 1 — CRITICAL: MySQL 8.4 LIMIT crash (FIXED)

**Root cause:** `pool.execute()` (prepared statements) sends JS numbers as DOUBLE to MySQL 8.4.
MySQL 8.4 rejects DOUBLE for `LIMIT ?` and `OFFSET ?` — backend crashes and restarts.

**Fix applied:** Changed `LIMIT ? OFFSET ?` placeholders to template literals with validated integers.
Used `parseInt(x, 10)` instead of `Number(x)` everywhere.

**Files fixed:**
- `backend/src/routes/api.js` — activity-log, customers, orders, subscriptions (4 queries)
- `backend/src/routes/notify.js` — notification log query
- `backend/src/services/security.js` — listEvents()
- `backend/src/services/vouchers.js` — listVouchers()
- `backend/src/services/scripts.js` — listExecutions()
- `backend/src/services/updates.js` — listTasks()
- `backend/src/services/configFiles.js` — listConfigFiles()

**Pattern of fix:**
```js
// BEFORE (crashes MySQL 8.4):
params.push(Number(limit), Number(offset));
db.query(`SELECT ... LIMIT ? OFFSET ?`, params);

// AFTER (works):
const limitN = parseInt(limit, 10) || 50;
const offsetN = parseInt(offset, 10) || 0;
db.query(`SELECT ... LIMIT ${limitN} OFFSET ${offsetN}`, params);
```

---

## Bug 2: Offers datetime ISO Z suffix (FIXED)

**Root cause:** `createOffer()` passed `data.starts_at` directly to MySQL.
If value was ISO8601 with Z suffix (e.g. `2026-04-20T00:00:00Z`), MySQL DATETIME rejected it.

**Fix applied:** Added `toMysqlDatetime()` helper in `backend/src/services/offers.js`:
```js
function toMysqlDatetime(v) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}
```
Applied to both `createOffer()` and `updateOffer()` for `starts_at` and `ends_at`.

---

## Bug 3: Caddyfile double global block + forced HTTPS (FIXED)

**Root cause:** Old Caddyfile had two `{}` global blocks (Caddy allows only one).
Used `{$DOMAIN}` binding → forced SSL → ERR_SSL_PROTOCOL_ERROR on localhost.

**Fix applied:** `docker/Caddyfile` rewritten to:
```caddy
{
  auto_https off
}
:80 {
  encode zstd gzip
  reverse_proxy frontend:80 { ... }
  header { X-Content-Type-Options nosniff ... }
  log { output stdout format console }
}
```

---

## What was verified working after fixes
- Auth login/me ✅
- Dashboard stats + revenue chart ✅
- Activity log ✅
- Customers list/detail ✅
- Packages CRUD ✅
- Orders list + filter ✅
- Subscriptions list ✅
- Offers create/list (with ISO datetime) ✅
- Voucher batch generate/list/print ✅
- Portal: packages, offers, place order, submit payment ✅
- Settings GET + PUT ✅
- Security events + summary ✅
- Admins list ✅
- Notify channels + log ✅
- VPN tunnels list ✅
- Configs/Scripts/Updates list ✅
- Monitoring routers ✅
- Suspensions list ✅
