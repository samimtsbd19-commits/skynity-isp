---
name: Skynity ISP Project Context
description: Full project stack, file structure, Docker setup, credentials, and current working state
type: project
originSessionId: b538d755-9caa-44c5-95b4-160c34872bc9
---
## Project: Skynity ISP

**Path:** `c:\Users\sk\Desktop\skynity_isp_sk\skynity-isp`
**Git branch:** main
**Status:** Running locally on Docker, all containers healthy

## Stack
- **Frontend:** React + Vite + Tailwind, served by Nginx in Docker
- **Backend:** Node.js (ESM) + Express, port 3000 internal
- **DB:** MySQL 8.4 (mysql:8.4 image)
- **Cache:** Redis 7
- **Proxy:** Caddy 2 (HTTP :80, auto_https off for local dev)
- **Telegram Bot:** node-telegram-bot-api (polling mode)

## Docker Compose
- `docker-compose.yml` — main file
- Services: caddy, frontend, backend, mysql, redis, migrate (one-shot)
- All containers connect via internal Docker network

## Access
- **URL:** http://localhost (plain HTTP, no SSL in local dev)
- **Admin login:** username=`admin`, password=`admin123`
- **API base:** `/api/`
- **Public portal:** `/api/portal/`

## Key File Paths
- Caddyfile: `docker/Caddyfile`
- Backend routes: `backend/src/routes/`
- Backend services: `backend/src/services/`
- Scheduler/cron: `backend/src/jobs/scheduler.js`
- DB pool: `backend/src/database/pool.js` — uses `pool.execute()` (prepared statements)
- Frontend API client: `frontend/src/api/client.js`
- Frontend pages: `frontend/src/pages/`

## Environment
- `.env` file exists at project root (copy of `.env.example` with local values)
- `NODE_ENV=production` (runs in prod mode even locally)
- Telegram Bot: same token as production → causes 409 Conflict error in logs (non-critical, app still works)
- Fix for Telegram 409: set `TELEGRAM_BOT_TOKEN=0:placeholder` in `.env` for local dev

## How to restart after changes
```bash
cd c:/Users/sk/Desktop/skynity_isp_sk/skynity-isp
docker compose up -d --build backend   # after backend changes
docker compose restart caddy           # after Caddyfile changes
docker compose up -d --build frontend  # after frontend changes
docker compose logs backend --tail=20  # check for errors
```

## Test login (get JWT token)
```bash
TOKEN=$(curl -s http://localhost/api/auth/login -X POST \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' \
  | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
```

## Why: Current tasks being done
User (Samim, samimtsbd19@gmail.com) runs a Starlink ISP in Bangladesh.
Setup: Starlink → MikroTik → 2× Cudy AX3000 Wi-Fi 6 AP → 150 users @ 5 Mbps each.
Goal: make Skynity ISP the professional management backend for this network.
