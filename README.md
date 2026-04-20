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
- 🐳 **One-Command Deploy** — Docker Compose, fits on any 2GB VPS

## 🗺️ Roadmap

| Phase | Scope | Status |
|-------|-------|--------|
| 1 | Telegram bot + core provisioning | ✅ Complete |
| 2 | Admin commands, WireGuard, HTTP API, multi-router | ✅ Complete |
| 3 | **Web dashboard** (React + Tailwind) | ✅ Complete |
| 4 | Real-time graphs (bandwidth, ping, SFP, neighbors) | 🔜 Next |
| 5 | bKash Checkout API, SMS alerts, resellers, invoice PDF | Planned |

## 🚀 Quick Start

```bash
cd skynity-isp/docker
cp ../backend/.env.example ../backend/.env
# edit .env: bot token, admin ID, MikroTik creds, passwords
docker compose up -d --build
```

Then visit **`http://YOUR_VPS_IP/`** (first login: `admin` / `admin123` — change immediately).

Full guide: [`docs/DEPLOY.md`](docs/DEPLOY.md) · WireGuard: [`docs/WIREGUARD.md`](docs/WIREGUARD.md) · Bot reference: [`docs/ADMIN_COMMANDS.md`](docs/ADMIN_COMMANDS.md)

## 🏗️ Stack

| Layer | Tech |
|-------|------|
| Frontend | React 18 · Vite · Tailwind · React Query · Recharts · Lucide |
| Backend | Node 20 · Express · Zod · Pino |
| Bot | node-telegram-bot-api |
| DB | MySQL 8.4 + Redis 7 |
| Router | RouterOS 7 REST API (HTTPS) |
| Deploy | Docker Compose + Nginx |

## 📁 Structure

```
skynity-isp/
├── backend/           # Node.js: bot + API + jobs + MikroTik client
├── frontend/          # React dashboard
├── docker/            # Docker Compose stack
└── docs/              # Deployment, WireGuard, admin cheatsheet
```

## 📜 License

Proprietary — © 2026 Skynity.
