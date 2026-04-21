# Skynity ISP — Complete Project Guide

> **🤖 For AI assistants**: This file is the **single source of truth** for project state.
> **Read this completely first** before making any changes.
> **Update the status markers** (✅ / 🚧 / ⬜) when you complete or start features.
> **Commit this file with your code changes** so the next AI picks up where you left off.

---

## 🎯 Quick Facts

| Item | Value |
|------|-------|
| **Project** | Skynity ISP — MikroTik-based ISP management for Bangladesh |
| **Live URL** | https://wifi.skynity.org |
| **VPS** | 46.202.166.89 (Ubuntu 24.04, Docker Compose) |
| **MikroTik** | hEX RB750Gr3, RouterOS 7.22.1, via WireGuard 10.88.0.2 |
| **GitHub** | https://github.com/samimtsbd19-commits/skynity-isp |
| **Owner** | samimtsbd19@gmail.com |
| **Language** | UI: Bengali + English (i18n) · Code comments: English |

---

## 🗺️ Architecture Diagram

### Network Flow

```
┌─────────────────────────────────────────────────────────┐
│                      INTERNET                           │
└────────────┬───────────────────────┬────────────────────┘
             │                       │
      ┌──────▼──────┐         ┌──────▼──────┐
      │  Starlink   │         │   Domain    │
      │  400/50 Mbps│         │wifi.skynity │
      └──────┬──────┘         │    .org     │
             │                └──────┬──────┘
      ┌──────▼──────┐                │
      │  MikroTik   │◄─── WG ───┐    │
      │  RB750Gr3   │  Tunnel   │    │
      │  RouterOS 7 │ 10.88.0.x │    │
      └──────┬──────┘           │    │
             │                  │    │
      ┌──────▼──────┐    ┌──────▼────▼──────┐
      │  Access     │    │       VPS        │
      │  Points     │    │  46.202.166.89   │
      └──────┬──────┘    │ ┌──────────────┐ │
             │           │ │    Caddy     │ │◄── HTTPS (Let's Encrypt)
      ┌──────▼──────┐    │ │ ReverseProxy │ │
      │ End Users   │    │ └──┬────────┬──┘ │
      │ WiFi/PPPoE  │◄───┤    │        │    │
      │ Hotspot     │    │┌───▼──┐ ┌───▼──┐│
      └─────────────┘    ││React │ │ Node │ │
                         ││ Vite │ │ API  │ │
                         │└──────┘ └──┬───┘ │
                         │            │     │
                         │      ┌─────▼──┐  │
                         │      │ MySQL  │  │
                         │      │ Redis  │  │
                         │      └────────┘  │
                         └──────────────────┘
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 · Vite 5 · TanStack Query · Tailwind 3 · lucide-react |
| Backend | Node.js 20 · Express · mysql2 · ioredis · multer · bcrypt · JWT |
| Database | MySQL 8 · Redis 7 |
| Reverse Proxy | Caddy 2 (auto-HTTPS via Let's Encrypt) |
| Router | MikroTik RouterOS 7.22 REST API (HTTP over WG tunnel) |
| Tunnel | WireGuard (VPS `10.88.0.1` ↔ MikroTik `10.88.0.2`, UDP 51820) |
| Deployment | Docker Compose (5 services: caddy, frontend, backend, mysql, redis) |
| AI | Anthropic Claude + OpenRouter (Telegram `/ai` command) |
| Mobile | Capacitor (Android/iOS native wrapper) |

---

## 📁 File Structure Map

### Backend (`backend/src/`)

```
src/
├── index.js                      ← Express app entry point
├── config/
│   └── index.js                  ← env vars + zod validation
├── database/
│   └── pool.js                   ← MySQL connection pool
├── middleware/
│   └── auth.js                   ← JWT verify + requireAdmin/requireRole
├── mikrotik/
│   └── client.js                 ← MikroTik REST API client (get/post/patch/put/del)
├── routes/
│   ├── api.js                    ← main router, mounts all sub-routers
│   ├── auth.js                   ← login/logout/me
│   ├── customers.js              ← customer CRUD
│   ├── subscriptions.js          ← subscription CRUD + extend
│   ├── packages.js               ← package CRUD
│   ├── orders.js                 ← order pipeline (pending → approved → active)
│   ├── vouchers.js               ← voucher batch + redeem
│   ├── hotspot.js                ← hotspot management (users/profiles/active/hosts/log/template)
│   ├── vpn.js                    ← WireGuard tunnel CRUD
│   ├── routers.js                ← MikroTik router CRUD
│   ├── monitoring.js             ← live stats
│   ├── bandwidth.js              ← PCQ + queue tree
│   ├── suspensions.js            ← suspend/unsuspend + static-ip
│   ├── security.js               ← audit log + emergency stop
│   ├── admins.js                 ← admin user CRUD
│   ├── settings.js               ← system settings key-value
│   ├── stats.js                  ← dashboard counts
│   ├── health.js                 ← service health events
│   ├── events.js                 ← event summary
│   ├── portal.js                 ← public portal (no auth)
│   └── configs.js                ← MikroTik config generator
├── services/
│   ├── provisioning.js           ← create PPPoE/hotspot user on MikroTik
│   ├── monitoring.js             ← live session polling + dynamic PCQ update
│   ├── configGenerator.js        ← generate login.html, wg confs, radius conf
│   ├── quota.js                  ← usage tracking (NOT YET ACTIVE)
│   ├── settings.js               ← getSetting/setSetting helpers
│   ├── claude.js                 ← Anthropic + OpenRouter client
│   ├── ops.js                    ← emergency stop flag
│   ├── vpnTunnels.js             ← WireGuard key gen
│   ├── tunnelRouting.js          ← assign tunnel to subscription
│   ├── staticIp.js               ← static IP assignment
│   └── audit.js                  ← write audit log
├── telegram/
│   ├── bot.js                    ← bot init, polling
│   ├── admin-commands.js         ← /customers /subs /health commands
│   ├── claude-commands.js        ← /ai /models /emergency_on commands
│   └── poll-control.js           ← pause/resume polling
├── jobs/
│   └── scheduler.js              ← cron: sync, PCQ update, expiry reminders, quota
├── utils/
│   └── logger.js                 ← pino logger
└── ws/
    └── monitor.js                ← WebSocket live monitor
```

### Backend migrations (`backend/migrations/`)
SQL files `001_initial.sql` through `016_monthly_quota.sql` — run once via `schema_migrations` table.

### Frontend (`frontend/src/`)

```
src/
├── App.jsx                       ← routes
├── main.jsx                      ← React root
├── index.css                     ← Tailwind imports
├── api/
│   └── client.js                 ← ALL API calls (axios)
├── components/
│   ├── Layout.jsx                ← sidebar + outlet
│   ├── PageHeader.jsx
│   └── primitives.jsx            ← ErrorBoundary, modals, tables
├── contexts/
│   └── RouterContext.jsx         ← selected MikroTik router state
├── hooks/
│   └── useAuth.js                ← admin session
├── i18n/
│   ├── index.js                  ← useT/useLang + catalogue
│   ├── en.js                     ← English strings
│   └── bn.js                     ← Bengali strings
└── pages/
    ├── Dashboard.jsx             ← overview
    ├── Login.jsx                 ← admin login
    ├── Orders.jsx                ← pending orders
    ├── Customers.jsx             ← customer list
    ├── CustomerDetail.jsx        ← single customer
    ├── CustomerAccounts.jsx      ← customer portal accounts
    ├── Subscriptions.jsx         ← subscription list
    ├── Monitoring.jsx            ← live hotspot sessions
    ├── RouterMonitor.jsx         ← MikroTik live stats
    ├── Health.jsx                ← service health
    ├── Security.jsx              ← audit log
    ├── Packages.jsx              ← package CRUD
    ├── Vouchers.jsx              ← voucher batches
    ├── Offers.jsx                ← promotional offers
    ├── Suspensions.jsx           ← suspended customers
    ├── Bandwidth.jsx             ← PCQ + queue tree
    ├── Routers.jsx               ← MikroTik router config
    ├── Configs.jsx               ← generate MikroTik configs
    ├── Hotspot.jsx               ← hotspot mgmt (5 tabs)
    ├── HotspotTemplate.jsx       ← portal template visual editor
    ├── Vpn.jsx                   ← WireGuard tunnels
    ├── Scripts.jsx               ← MikroTik scripts
    ├── Updates.jsx               ← RouterOS updates
    ├── SystemSettings.jsx        ← key-value settings
    ├── Admins.jsx                ← admin user mgmt
    ├── Activity.jsx              ← audit log view
    ├── Settings.jsx              ← admin profile
    ├── ProjectGuide.jsx          ← THIS PAGE (/guide)
    └── PublicPortal.jsx          ← customer-facing (no auth)
```

### Root
```
skynity-isp/
├── backend/                      ← Node API
├── frontend/                     ← React app
├── docker/
│   └── Caddyfile                 ← reverse proxy config
├── docs/
│   └── PROJECT_GUIDE.md          ← ← THIS FILE
├── docker-compose.yml            ← service definitions
├── .env                          ← secrets (not in git)
└── .gitignore
```

---

## ✅ Completed Features

### Core
- [x] Admin authentication (JWT + bcrypt)
- [x] Multi-admin roles: superadmin / admin / viewer
- [x] MySQL migrations with `schema_migrations` tracking
- [x] Redis for session/cache
- [x] Audit log (`security_audit` table)

### Customer & Billing
- [x] Customer CRUD (name, phone, address, notes)
- [x] Customer portal accounts (self-service)
- [x] Subscription CRUD (PPPoE + Hotspot)
- [x] Admin extend subscription (+7/10/15/30/60 days or custom)
- [x] Package CRUD (price, speed, duration, service type)
- [x] Order pipeline (pending → approve → provision → active)
- [x] Voucher system (batch generate, print, redeem)
- [x] Offer / promo codes
- [x] Suspension with auto-lift date

### MikroTik Integration
- [x] REST API client (GET/POST/PATCH/PUT/DEL)
- [x] PPPoE secret provisioning (create/update/disable)
- [x] Hotspot user provisioning
- [x] Dynamic PCQ queue updates (every 30 min based on active users)
- [x] Queue tree management
- [x] Live session polling
- [x] Interface stats + traffic graphs
- [x] Static IP assignment per subscription
- [x] WireGuard tunnel per-user routing

### Hotspot Module
- [x] Active sessions tab (kick, view MAC/IP/uptime/bytes)
- [x] Users tab (CRUD, enable/disable)
- [x] Profiles tab (rate-limit, timeout, shared-users)
- [x] Hosts tab (DHCP leases)
- [x] Log tab (hotspot + system log)
- [x] Server lock/unlock
- [x] **Portal Template Visual Editor**:
  - Logo upload (PNG/JPG/SVG, 2MB max)
  - Color pickers (primary, background, card, text)
  - Dark / Light mode toggle
  - Typography (font family, size, border radius)
  - Logo position (left/center/right)
  - Live mobile + desktop preview
  - Generate + Save in one click

### Network & Security
- [x] HTTPS via Let's Encrypt (Caddy auto-issue)
- [x] WireGuard tunnel (VPS 10.88.0.1 ↔ MikroTik 10.88.0.2)
- [x] MikroTik WebFig proxied at `/router/*` with basicauth
- [x] Emergency stop (pauses all cron jobs)
- [x] Service health monitoring
- [x] Security audit log

### Communication
- [x] Telegram bot (admin commands)
- [x] Telegram AI assistant (`/ai` with Anthropic + OpenRouter)
- [x] AI knows full project context (this file is injected)
- [x] Multi-language UI (Bengali 🇧🇩 + English 🇺🇸)

### Deployment
- [x] Docker Compose stack (5 services)
- [x] Caddy reverse proxy with `{$DOMAIN}` variable
- [x] Git-based deployment (push → SSH → pull → build)
- [x] Persistent volumes (MySQL, Redis, uploads)
- [x] Capacitor mobile wrapper (Android/iOS config ready)

---

## 🚧 In Progress

*(nothing currently — pick next from Pending)*

---

## ⬜ Pending Features

### Priority 1 — Admin 2FA (TOTP)
- **Why**: Protect admin accounts from password leaks
- **Files to create/edit**:
  - `backend/src/services/totp.js` (new — use `speakeasy` lib)
  - `backend/src/routes/auth.js` (add `/2fa/enable`, `/2fa/verify`)
  - `backend/migrations/017_admin_2fa.sql` (add `totp_secret`, `totp_enabled` columns)
  - `frontend/src/pages/Settings.jsx` (QR code setup + verify flow)
  - `frontend/src/pages/Login.jsx` (second step for TOTP code)
- **Library**: `npm install speakeasy qrcode` (backend)
- **Estimated**: 3-4 hours

### Priority 2 — Reseller Portal
- **Why**: Let resellers sell Skynity packages under their own brand
- **Files to create**:
  - `backend/migrations/018_resellers.sql` (resellers table + commission %)
  - `backend/src/routes/resellers.js`
  - `backend/src/services/resellerCommission.js`
  - `frontend/src/pages/Resellers.jsx` (admin view)
  - `frontend/src/pages/ResellerPortal.jsx` (reseller view)
- **Features**: own login, own customer list, commission tracking, withdrawal requests
- **Estimated**: 1-2 days

### Priority 3 — SNMP Monitoring
- **Why**: More detailed MikroTik metrics (CPU, memory, temperature) beyond REST
- **Files to create**:
  - `backend/src/services/snmp.js` (poll OIDs)
  - `backend/migrations/019_snmp_history.sql` (time-series data)
  - `frontend/src/pages/SnmpDashboard.jsx`
- **Library**: `npm install net-snmp`
- **OIDs needed**: CPU `1.3.6.1.2.1.25.3.3.1.2`, Memory `1.3.6.1.2.1.25.2.3.1.6`, Interface stats
- **Estimated**: 1 day

### Priority 4 — Usage-Based Billing (Quota)
- **Why**: Packages like "10 GB/month, then throttle"
- **Files to edit/create**:
  - `backend/src/services/quota.js` (already exists — needs implementation)
  - `backend/migrations/020_quota.sql` (add `monthly_quota_gb` to packages, `quota_used_bytes` to subscriptions)
  - `backend/src/jobs/scheduler.js` (add cron: every 5 min check + monthly reset)
- **Logic**: snapshot traffic counter → track delta → throttle at quota → restore on reset
- **Estimated**: 1 day

### Priority 5 — RADIUS Integration (BIG)
- **Why**: Scale beyond ~1000 users, central auth, session accounting
- **Steps**:
  1. Install FreeRADIUS on VPS: `apt install freeradius freeradius-mysql`
  2. Create tables: `radcheck`, `radreply`, `radacct` (FreeRADIUS schema)
  3. Sync Skynity subscriptions → radcheck
  4. Configure MikroTik to use RADIUS
  5. Remove manual PPP secret creation
- **Files**: new `backend/src/services/radius.js`, update `provisioning.js`
- **Estimated**: 2-3 days

### Priority 6 — Webhook / ERP API
- **Why**: Integration with 3rd-party ERP, accounting, CRM
- **Files to create**:
  - `backend/src/services/webhooks.js` (fire on events)
  - `backend/src/routes/webhooks.js` (CRUD webhook subscribers)
  - `backend/src/routes/public-api.js` (API-key-auth for external)
- **Events**: customer.created, subscription.expired, payment.received
- **Estimated**: 1 day

---

## 🚀 Deployment Process

### Local Dev (Windows / your PC)
```bash
cd c:\Users\sk\Desktop\skynity_isp_sk\skynity-isp
docker compose up -d --build backend frontend
# Visit http://localhost
```

### Push to Production
```bash
# 1. Commit locally
git add -A
git commit -m "feat: <description>"

# 2. Push to GitHub
git push origin main

# 3. Deploy on VPS
ssh root@46.202.166.89
cd /root/skynity
git pull
docker compose up -d --build backend frontend

# 4. Check logs
docker compose logs backend --tail=30
```

### Rollback (if broken)
```bash
# On VPS
cd /root/skynity
git log --oneline -5          # find last good commit
git reset --hard <commit-sha>
docker compose up -d --build backend frontend
```

---

## 🤖 AI Handoff Rules

**When you (AI) are brought in to continue this project:**

### ✅ Always Do
1. **Read this entire file first** (PROJECT_GUIDE.md)
2. **Check memory file** at `.claude/memory/` (if present)
3. **Start from the top of "Pending"** unless user specifies otherwise
4. **Update this file** when you complete a feature:
   - Move item from ⬜ to ✅
   - Add new file paths if you created any
   - Commit this file with your changes
5. **Test locally** before pushing (`docker compose up -d --build`)
6. **Use existing patterns** — read similar files before creating new ones
7. **Follow i18n conventions** — add keys to `en.js` and `bn.js` both

### ❌ Never Do
- Skip git hooks (`--no-verify`)
- Force push to `main`
- Delete user data without explicit permission
- Commit `.env` or credentials
- Set `TELEGRAM_BOT_TOKEN` in local `.env` (causes 409 conflict with VPS)
- Change the MikroTik password without updating `.env`

### 📝 Git Commit Style
```
feat: <new feature>
fix: <bug fix>
refactor: <code reorg without behavior change>
docs: <doc-only changes>
```

### 🔑 Credentials & Endpoints

| Resource | Value |
|----------|-------|
| VPS SSH | `ssh root@46.202.166.89` |
| Admin Login | `admin / admin123` *(change in prod!)* |
| MikroTik | `admin / YourStrongPassword2026` *(change in prod!)* |
| DB Root | `Skynity2024` |
| MikroTik REST | `http://10.88.0.2/rest/` *(via WireGuard)* |
| MikroTik WebFig | `https://wifi.skynity.org/router/` |
| Public Portal | `https://wifi.skynity.org/portal` |
| WireGuard | `systemctl status wg-quick@wg0` on VPS |

---

## 🆘 Troubleshooting Quick Reference

| Symptom | Check |
|---------|-------|
| Backend crashes | `docker compose logs backend --tail=100` |
| MikroTik unreachable | `systemctl status wg-quick@wg0` on VPS |
| Website down | `docker compose ps` — all should be Up |
| HTTPS broken | Check Caddyfile has `{$DOMAIN}` block (not `:80`) |
| Migration stuck | Check `schema_migrations` table, run SQL manually |
| Telegram 409 | Two instances running — remove local `TELEGRAM_BOT_TOKEN` |
| Portal shows no packages | Add packages at `/packages` page, they auto-load |
| Logo won't upload | Check `/app/uploads` dir exists + writable in container |

---

## 📊 Database Schema Highlights

### Core tables
- `admins` — admin users (JWT login)
- `customers` — ISP customers
- `customer_accounts` — customer portal login
- `packages` — service plans
- `subscriptions` — active services (PPPoE/hotspot)
- `orders` — pending → approved → provisioned pipeline
- `vouchers` — prepaid codes
- `payments` — payment records
- `mikrotik_routers` — multi-router support
- `settings` — key-value config (ai.*, branding.*, portal.*, feature.*)
- `security_audit` — immutable audit log
- `service_health_events` — monitoring alerts
- `suspensions` — suspended customers with auto-lift
- `vpn_tunnels` — WireGuard peer configs
- `schema_migrations` — ran SQL files

---

## 📌 Recent Major Changes (changelog)

- **2026-04-21** — Added Portal Template Visual Editor (logo upload, colors, typography, mobile preview)
- **2026-04-21** — Added Hotspot Management module (5 tabs)
- **2026-04-21** — Wired Telegram AI with full project context
- **2026-04-21** — VPS fresh deploy (no Coolify) with HTTPS via Let's Encrypt
- **2026-04-20** — WireGuard tunnel (VPS ↔ MikroTik) auto-start
- **2026-04-20** — Dynamic PCQ bandwidth sharing
- **2026-04-20** — Admin extend subscription feature

---

*Last updated: 2026-04-21 · Edit this file as the project evolves.*
