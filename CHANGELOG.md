# 📋 Skynity ISP — Changelog & Roadmap

## ✅ Phase 1, 2, 3 — Complete (Current: v0.3)

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
