---
name: Skynity ISP Feature Roadmap
description: 5-task roadmap with exact implementation steps — resume here after session ends
type: project
originSessionId: b538d755-9caa-44c5-95b4-160c34872bc9
---
## HOW TO RESUME
1. Read this file first
2. Find the first task that is NOT marked ✅ DONE
3. Start from that task — do not redo completed ones
4. After each task: rebuild backend (`docker compose up -d --build backend`), test, then move to next

---

## TASK 1 — PCQ Bandwidth Update (400 Mbps)
**Status:** ⬜ NOT DONE
**Time:** ~5 min
**Why:** Default settings have 100 Mbps total — must match actual Starlink 400 Mbps

### Exact steps:
```bash
TOKEN=$(curl -s http://localhost/api/auth/login -X POST \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' \
  | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

# Update download total
curl -s -X PUT http://localhost/api/settings/provisioning.pcq_total_download \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"value":400}'

# Update upload total
curl -s -X PUT http://localhost/api/settings/provisioning.pcq_total_upload \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"value":50}'

# Confirm PCQ enabled
curl -s -X PUT http://localhost/api/settings/provisioning.pcq_enabled \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"value":true}'
```

### Verify:
```bash
curl -s http://localhost/api/settings/provisioning.pcq_total_download \
  -H "Authorization: Bearer $TOKEN"
# Should return: {"key":"provisioning.pcq_total_download","value":400,...}
```

**No rebuild needed — settings are stored in DB.**

---

## TASK 2 — MikroTik Router Add (from UI / API)
**Status:** ⬜ NOT DONE
**Time:** ~15 min
**Why:** Without a router configured, MikroTik features show "no router" errors

### What to do:
User must provide: MikroTik IP, username, password, port (usually 443 or 8728)
Then call the API to create it:

```bash
curl -s -X POST http://localhost/api/routers-admin \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Main Router",
    "host": "MIKROTIK_IP_HERE",
    "port": 443,
    "username": "admin",
    "password": "MIKROTIK_PASSWORD_HERE",
    "use_ssl": true,
    "is_default": true,
    "note": "Primary MikroTik — Starlink uplink"
  }'
```

### After adding router, test connection:
```bash
ROUTER_ID=1  # from the response above
curl -s -X POST http://localhost/api/routers-admin/$ROUTER_ID/test \
  -H "Authorization: Bearer $TOKEN"
# Should return: {"ok":true, "identity":..., "version":...}
```

### Also update uplink capacity on router:
```bash
curl -s -X PUT http://localhost/api/bandwidth/router/$ROUTER_ID/uplink \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"uplink_interface":"ether1","uplink_down_mbps":400,"uplink_up_mbps":50}'
```

**No code changes needed — this is config only.**

---

## TASK 3 — Monthly Data Quota Feature
**Status:** ⬜ NOT DONE
**Time:** ~1-2 hours
**Why:** User wants packages where customer gets X GB/month; after quota, throttled to 1 Mbps

### Architecture:
- Add `monthly_quota_gb` column to `packages` table (NULL = unlimited)
- Add `quota_used_bytes` + `quota_reset_at` to `subscriptions` table
- Cron job every 5 min: check if any subscription exceeded quota → throttle on MikroTik
- Cron job on 1st of month: reset all quotas
- API: `GET /api/subscriptions/:id/quota` — current usage vs limit
- Frontend: show quota bar on CustomerDetail page

### Migration SQL to add:
```sql
ALTER TABLE packages
  ADD COLUMN monthly_quota_gb INT NULL DEFAULT NULL
  COMMENT 'NULL = unlimited. If set, throttle after this many GB/month.';

ALTER TABLE subscriptions
  ADD COLUMN quota_used_gb DECIMAL(10,3) NOT NULL DEFAULT 0,
  ADD COLUMN quota_reset_at DATETIME NULL,
  ADD COLUMN quota_throttled TINYINT(1) NOT NULL DEFAULT 0;
```

### Files to create/edit:
- **NEW:** `backend/src/services/quota.js` — checkAndThrottle(), resetMonthlyQuotas()
- **EDIT:** `backend/src/jobs/scheduler.js` — add `*/5 * * * *` quota check + `0 0 1 * *` monthly reset
- **EDIT:** `backend/src/routes/api.js` — add `GET /subscriptions/:id/quota`
- **EDIT:** `backend/src/routes/packages` — allow `monthly_quota_gb` in POST/PATCH
- **EDIT:** `backend/src/jobs/scheduler.js` — add snapshotUsage() to also update quota_used_gb
- **EDIT:** `frontend/src/pages/CustomerDetail.jsx` — add quota progress bar
- **EDIT:** `frontend/src/pages/Packages.jsx` or equivalent — show quota in package form

### MikroTik throttle profile:
When quota exceeded → change PPP profile to "throttled" (1 Mbps) via API.
When reset → restore original profile.
MikroTik must have a profile named "throttled" with rate-limit=1M/1M pre-created.

---

## TASK 4 — WireGuard VPN Per-User Public IP
**Status:** ⬜ NOT DONE
**Time:** ~30 min
**Why:** Some users want a dedicated public IP (business users, CCTV, etc.)

### How it works:
```
Normal user: MikroTik NAT → Starlink shared IP
VPN user:    MikroTik → WireGuard tunnel → VPS public IP
```

### Architecture:
- VPS runs WireGuard server (port 51820)
- Each premium user gets a WireGuard peer on the VPS
- MikroTik routes that user's traffic through the tunnel
- User appears with VPS's public IP on the internet

### What already exists in Skynity:
- `backend/src/routes/vpn.js` — CRUD for WireGuard tunnels
- `backend/src/services/vpnTunnels.js` — WireGuard key generation
- `backend/src/services/tunnelRouting.js` — assign tunnel to subscription
- `POST /api/suspensions/subscriptions/:id/tunnel` — assign tunnel to a sub

### What needs to be done:
1. Install WireGuard on VPS: `apt install wireguard`
2. Create WireGuard tunnel via UI: Settings → VPN → Add Tunnel
3. Add peer for each premium user
4. On MikroTik: add WireGuard interface + routing rules (done via script)
5. Test: user connects, check IP at whatismyip.com

### MikroTik side config (run once):
```
/interface wireguard add name=wg-vps listen-port=51820 private-key="..."
/ip address add address=10.88.0.1/24 interface=wg-vps
/interface wireguard peers add interface=wg-vps public-key="VPS_PUBLIC_KEY" \
  allowed-address=10.88.0.0/24 endpoint-address=VPS_IP endpoint-port=51820
```

---

## TASK 5 — RADIUS Server Integration
**Status:** ⬜ NOT DONE
**Time:** Big task (1-2 days)
**Why:** Offload authentication from MikroTik to VPS — better scalability, central control

### Architecture:
```
User connects PPPoE → MikroTik → RADIUS request → VPS FreeRADIUS
                                                      ↓
                                               Check DB (subscriptions)
                                               Return: Accept/Reject + bandwidth attributes
```

### What this enables:
- Login/logout tracked centrally on VPS
- Bandwidth limits enforced via RADIUS attributes (no need to pre-create MikroTik queues)
- Session accounting: real-time usage data in Skynity DB
- Hotspot auth through RADIUS

### Steps:
1. Install FreeRADIUS on VPS: `apt install freeradius freeradius-mysql`
2. Connect FreeRADIUS to Skynity MySQL DB
3. Create `radcheck`, `radreply`, `radacct` tables
4. Configure MikroTik to use VPS as RADIUS server
5. Add RADIUS sync when Skynity provisions a subscription
6. Remove need to manually create PPP secrets on MikroTik

### Note:
This is a large architectural change. Do TASKS 1-4 first.
FreeRADIUS config templates are in standard locations.
Skynity backend needs a new `radius` service to sync users.

---

## RESUME INSTRUCTIONS FOR AI

When starting a new session:
1. Read `project-context.md` to understand the project
2. Read `bugs-fixed.md` to know what NOT to redo
3. Read this file (`roadmap.md`) to find the next task
4. Check task status — find first ⬜ NOT DONE task
5. Mark it ✅ DONE here after completing
6. Run `docker compose up -d --build backend` after any backend code change
7. Test the feature with curl before marking done
8. Move to next task

## TASK STATUS SUMMARY
- Task 1 — Dynamic PCQ (Starlink auto-update):  ✅ DONE — monitoring.js updateDynamicPcq(), client.js updateQueueTreeMaxLimit()
- Task 2 — MikroTik router add:                 ✅ DONE — router_id=1, host=192.168.50.1, port=80, SSL=off, uplink=ether1-WAN, 400/50 Mbps
- Task 3 — Monthly data quota (GB):             ❌ CANCELLED — user doesn't want this. Expiry = disconnect (already works via expireSubscription)
- Task 4 — WireGuard management tunnel:         ✅ DONE — VPS(10.88.0.1) ↔ MikroTik(10.88.0.2), port 51820 UDP, auto-start enabled. VPS can reach MikroTik REST API at http://10.88.0.2/rest/ via tunnel. For production: change router host from 192.168.50.1 → 10.88.0.2
- Task 5 — RADIUS server integration:           ⬜ NOT DONE (big infra task)

## EXTRA COMPLETED (not in original roadmap)
- Admin Extend Subscription:  ✅ DONE
  - Backend: POST /api/subscriptions/:id/extend {days, note} → provisioning.extendSubscription()
  - Frontend: "+ Extend" button in Subscriptions.jsx (modal with presets 7/10/15/30/60/custom)
  - Frontend: "+ Extend" button in CustomerDetail.jsx subscription card (ExtendModal)

- Hotspot Management page (/hotspot):  ✅ DONE (commit 0503487)
  - 5 tabs: Active sessions (kick), Users (CRUD, enable/disable), Profiles (CRUD), Hosts, Log
  - Server lock/unlock control per hotspot server
  - Backend: backend/src/routes/hotspot.js (all REST endpoints via MikroTik client)
  - Frontend: frontend/src/pages/Hotspot.jsx

- Hotspot Portal Template Editor (/hotspot-template):  ✅ DONE (commit 0503487)
  - HTML editor with MikroTik variable insertion (click to insert at cursor)
  - Live preview tab (iframe with variables replaced by sample values)
  - Save to DB (settings key: hotspot.login_template), Reset to default, Download .html
  - Backend: GET/PUT/DELETE /api/hotspot/template
  - Frontend: frontend/src/pages/HotspotTemplate.jsx

- Telegram AI with full project context:  ✅ DONE (commit 0503487)
  - SKYNITY_SYSTEM prompt in claude-commands.js (full project overview, file locations, TODO list)
  - Wired into both claude.chat() and claude.continueChat() via systemExtra parameter
  - claude.js continueChat() updated to accept systemExtra parameter

- VPS fresh deployment (no Coolify):  ✅ DONE
  - Ubuntu VPS 46.202.166.89, Docker Compose stack: caddy, frontend, backend, mysql, redis, migrate
  - HTTPS working via Let's Encrypt (wifi.skynity.org)
  - Caddyfile at /root/skynity/docker/Caddyfile — uses {$DOMAIN} block (not :80)
  - /router/* proxies to MikroTik WebFig at 10.88.0.2 with basicauth

## NEXT TODO (user's spec document — do these step by step via Telegram /ai)
1. Admin 2FA (TOTP) — backend/src/middleware/auth.js + frontend/src/pages/Settings.jsx
2. Reseller portal UI — frontend/src/pages/Reseller.jsx
3. SNMP monitoring — backend/src/services/snmp.js
4. RADIUS integration — big infra task (FreeRADIUS on VPS)
5. Usage-based billing — quota tracking per subscription
