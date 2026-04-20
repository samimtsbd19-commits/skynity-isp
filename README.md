# 🛰️ Skynity ISP Management System

A complete ISP management platform for **MikroTik**-based networks in Bangladesh. Covers the full customer lifecycle — from Telegram signup to payment verification to auto-provisioning — plus a distinctive admin dashboard.

## ✨ What's in the box

- 🤖 **Telegram Bot** — customers browse packages, pay via bKash/Nagad, get credentials instantly
- 👑 **Admin Bot** — 15+ commands for daily ops (`/pending`, `/customer`, `/suspend`, `/renew`, `/addpkg`, `/addrouter`, …)
- 🖥 **Web Dashboard** — "Operations Terminal" aesthetic, dark editorial UI with live data
- 🔄 **Auto-Provisioning** — approved orders instantly create PPPoE/Hotspot users on MikroTik
- ⏰ **Auto-Expiry** — subscriptions auto-disable on the router when validity ends
- 🔁 **Failure-Tolerant** — router offline? Approve anyway, cron retries until synced
- 🔐 **WireGuard Guide** — production-grade MikroTik ↔ VPS tunnel setup
- 📊 **Activity Log** — full audit trail
- 🔒 **Automatic HTTPS** — Caddy fetches Let's Encrypt certs for your domain, zero manual work
- 🐳 **One-Command Deploy** — Docker Compose, fits on any 2GB VPS

## 🚀 Deploy on Hostinger VPS in ~5 minutes

**Docker Manager + GitHub → automatic HTTPS at `https://wifi.skynity.org`**

1. Push this repo to your GitHub (public or private).
2. Hostinger hPanel → **VPS → Docker Manager → Add app**
3. Select **GitHub** source, paste your repo URL, choose branch `main`.
4. Compose file: **`docker-compose.yml`** (root — default).
5. Add the required environment variables (see [`.env.example`](.env.example) — at minimum `DOMAIN`, `DB_PASSWORD`, `DB_ROOT_PASSWORD`, `TELEGRAM_BOT_TOKEN`, `JWT_SECRET`, `SESSION_SECRET`).
6. Click **Deploy**. 3–5 minutes later visit `https://wifi.skynity.org` and log in with `admin` / `admin123`.

Full walkthrough with screenshots-worth of detail: **[`docs/HOSTINGER_DEPLOY.md`](docs/HOSTINGER_DEPLOY.md)**.

## 🚀 Manual Deploy (any Ubuntu/Debian VPS)

```bash
git clone https://github.com/<you>/skynity-isp.git
cd skynity-isp
cp .env.example .env
# edit .env — set DOMAIN, passwords, TELEGRAM_BOT_TOKEN, secrets
docker compose up -d --build
```

After startup visit **`https://YOUR_DOMAIN/`** (first login: `admin` / `admin123` — change immediately).

Full guide: [`docs/DEPLOY.md`](docs/DEPLOY.md) · WireGuard: [`docs/WIREGUARD.md`](docs/WIREGUARD.md) · Bot reference: [`docs/ADMIN_COMMANDS.md`](docs/ADMIN_COMMANDS.md)

## 🏗️ Stack

| Layer | Tech |
|-------|------|
| Frontend | React 18 · Vite · Tailwind · React Query · Recharts · Lucide |
| Backend | Node 20 · Express · Zod · Pino |
| Bot | node-telegram-bot-api |
| DB | MySQL 8.4 + Redis 7 |
| Router | RouterOS 7 REST API (HTTPS) |
| Deploy | Docker Compose + Caddy (auto-HTTPS) + Nginx |

## 📁 Structure

```
skynity-isp/
├── docker-compose.yml   # ← root: deploy this
├── .env.example         # ← copy to .env and fill in
├── backend/             # Node.js: bot + API + jobs + MikroTik client
├── frontend/            # React dashboard
├── docker/
│   └── Caddyfile        # Auto-HTTPS config
└── docs/
    ├── HOSTINGER_DEPLOY.md   # ← start here for Hostinger VPS
    ├── DEPLOY.md
    ├── WIREGUARD.md
    └── ADMIN_COMMANDS.md
```

## 🗺️ Roadmap

| Phase | Scope | Status |
|-------|-------|--------|
| 1 | Telegram bot + core provisioning | ✅ Complete |
| 2 | Admin commands, WireGuard, HTTP API, multi-router | ✅ Complete |
| 3 | Web dashboard (React + Tailwind) | ✅ Complete |
| 4 | Config/VPN/Scripts/Updates + multi-admin + system settings | ✅ Complete |
| 5 | Real-time graphs (bandwidth, ping, SFP, neighbors) | 🔜 Next |
| 6 | bKash Checkout API, SMS alerts, resellers, invoice PDF | Planned |

## 📜 License

Proprietary — © 2026 Skynity.
