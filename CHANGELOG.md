# 📋 Skynity ISP — Changelog & Roadmap

## ✅ v0.4.1 — Deploy hardening (current)

### Hostinger-ready one-click deploy
- **Root `docker-compose.yml`** with a single source of truth for all services
- **Single `.env` at repo root** — no more split between `backend/.env` and
  compose-level env, both read from the same file
- **Caddy reverse proxy** added: automatic HTTPS via Let's Encrypt for any
  configured `DOMAIN` (e.g. `wifi.skynity.org`) — no manual cert renewal
- New **[`docs/HOSTINGER_DEPLOY.md`](docs/HOSTINGER_DEPLOY.md)** walkthrough
  for Hostinger VPS → Docker Manager → GitHub one-click deploy
- Backend container gets a proper `healthcheck`, MySQL + Redis too

### Bug fixes
- `MIKROTIK_*` env vars are now **optional** at boot — operators can add
  routers entirely from the web UI (Routers → Add), no redeploy required
- `TELEGRAM_ADMIN_IDS` optional — bootstrap admin user still created when
  no Telegram IDs are set (previously the first admin was skipped)
- Telegram bot no longer crashes the process at startup when the token is
  missing or invalid — it now logs a warning and the rest of the system
  (web dashboard, API, cron jobs) keeps running
- `provisioning` falls back to any active router instead of hard-coded
  `router_id = 1` when no default is configured
- `/health` endpoint returns a proper 503 when DB is down but stays 200
  when only MikroTik is unreachable (was previously always 200 — broke
  container-level health checks)
- Nginx now forwards the correct `X-Forwarded-Proto` from Caddy

---

## ✅ Phase 4 — Complete (v0.4)

### Config Files (VPS → MikroTik)
- Upload `.rsc`, `.backup`, `.conf`, and script files to the VPS via admin panel
- Every file gets a SHA-256 checksum + signed download token
- **Push to any router** — the VPS serves the file over HTTP, and the router
  pulls it via `/tool/fetch` then runs `/import` (for `.rsc`) — all in one click
- Full push history with status (uploading / importing / success / failed) per router

### VPN Tunnels
- Unified registry for **WireGuard, IPsec, PPTP, L2TP, OpenVPN, SSTP**
- WireGuard: auto-generated X25519 keypairs, peer management, wg-quick client
  config export with one click (download `.conf` and plug into phone)
- IPsec / L2TP: pre-shared key stored encrypted (AES-GCM)
- All secrets encrypted at rest, synced to MikroTik via REST

### RouterOS Scripts
- Save reusable scripts in DB with tags and policy
- Execute against any router with full audit trail (output captured)
- Inline one-shot runner — paste a command and run it without saving
- Every execution logged to `script_executions`

### RouterOS Updates & Packages
- Check / download / install RouterOS per router (queued with status)
- Per-package enable / disable
- Reboot router from UI
- Full task history

### System Settings
- 16+ runtime tunables (brand, provisioning, telegram, security, vpn,
  updates, branding) editable from the admin panel — no redeploys
- Typed values (string / number / boolean / json) with validation
- Secret fields (passwords, API keys) masked in the list view

### Admin Users
- Superadmin-gated CRUD for dashboard users
- Role switcher (superadmin · admin · reseller · viewer)
- Enable / disable toggle, Telegram linkage, bcrypt password hashing

### Router CRUD
- Add / edit / test / delete MikroTik routers directly from the web UI
- Test connection before saving (calls `/system/resource`)
- Default-router flag with atomic swap

### Extended MikroTik client
- `/file`, `/system/script`, `/tool/fetch`, `/import`, `/execute`
- `/interface/wireguard` + `/interface/wireguard/peers`
- `/ip/ipsec/*`, `/interface/pptp-server|l2tp-server|ovpn-server|sstp-server`
- `/system/package/update/*`, `/system/backup/*`

---

## ✅ Phase 1, 2, 3 — Complete (v0.3)

### Core Platform
- Full database schema (9 tables, FK-constrained, indexed)
- MySQL 8.4 + Redis 7 in Docker Compose
- Auto-migration runner · structured logging (pino) · zod env validation
- AES-GCM encryption for router passwords in DB

### MikroTik Integration
- RouterOS 7 REST API client: PPPoE, Hotspot, DHCP, Queues, Neighbors, System
- Multi-router support (DB-stored, encrypted credentials)
- WireGuard VPN setup guide (MikroTik ↔ VPS secure tunnel)

### Telegram Bot — Customer
- `/start`, `/buy`, `/mysubs`, `/help`, `/support`
- Multi-step signup: package → name → phone → TrxID → screenshot
- Inline-keyboard approvals notify admin in real time

### Telegram Bot — Admin
- Order inbox + inline approve/reject: `/pending`
- Customers: `/customers [search]`, `/customer <code>`
- Session control: `/suspend`, `/resume`, `/active`, `/renew`
- Packages: `/packages`, `/addpkg` (8-step wizard)
- Routers: `/routers`, `/addrouter` (5-step wizard, password encrypted, chat msg auto-deleted)
- Stats: `/stats`, `/today`, `/admin`

### Automation
- **Retry job** (every 5 min) — pushes pending DB records to MikroTik when router reappears
- **Expire job** (every 15 min) — disables expired users on router
- **Monitoring job** (hourly) — refreshes last-seen/IP/MAC from active sessions

### HTTP API (Phase 2)
- JWT auth with bcrypt hash + role-based access (superadmin/admin/reseller/viewer)
- Endpoints: `/auth/*`, `/stats`, `/customers`, `/orders`, `/packages`, `/subscriptions`, `/mikrotik/*`
- Auto-bootstrap first admin from env on fresh install

### Web Dashboard (Phase 3) — "Operations Terminal"
- **Aesthetic**: obsidian dark base, amber accents, Instrument Serif display + JetBrains Mono + Geist Sans — not a generic dashboard
- **Pages**: Login · Overview · Orders inbox · Customers · Customer detail · Subscriptions · Live Sessions · Packages · Routers
- **Features**: JWT auth, live auto-refresh, revenue area chart, inbox-style approval workflow, inline credentials copy, search-as-you-type customer directory, new-package creation form, queue/interface/active-session real-time views
- **Build**: React 18 + Vite + Tailwind + React Query + Recharts · served by Nginx in production
- **Network**: Nginx reverse-proxies `/api` to backend container — same origin, no CORS headaches

### Ops & Security
- Docker Compose one-command deploy (5 containers)
- MikroTik REST hardening + WireGuard guide
- Activity log (every admin action audited)
- Failure-tolerant approvals (router offline = sync later)

---

## 🔜 Phase 4 — Real-Time Monitoring

- SNMP polling (5-sec granularity bandwidth)
- Per-interface Rx/Tx live charts (websocket push)
- Ping/latency to uplink & peers
- SFP module health (optical power, temp)
- Queue tree analytics (burst tracking)
- Neighbor discovery map (topology visualization)
- Historical retention (rrd-style downsampling)
- Threshold alerts → Telegram push

## 📡 Phase 5 — Growth Features

- bKash Checkout API (auto payment verification)
- Nagad merchant API
- SMS gateway (Alpha SMS / SSL SMS)
- Customer self-service portal
- Invoice PDF generation + email/SMS delivery
- Recurring billing (auto-renewal)
- Referral / coupon system
- Multi-tenant reseller panel
- Bangla / English toggle
