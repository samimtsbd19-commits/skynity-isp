# Skynity ISP — Full project review (snapshot)

This document summarises what the codebase **is**, how it **deploys**, and what **operators** should configure for production. It is a orientation guide, not a substitute for reading `docs/DEPLOY.md` and `docs/COOLIFY_DEPLOY.md`.

---

## 1. Architecture at a glance

| Layer | Role |
|-------|------|
| **VPS (Docker)** | Control plane: Node API, MySQL, Redis, React static build, optional Caddy/Traefik. **User traffic (internet) does not flow through the VPS** — customer packets go ISP → MikroTik → internet. |
| **MikroTik** | Data plane: PPPoE/Hotspot, queues, NAT, VPN tunnels. RouterOS 7 **REST API** is called from the backend for provisioning and monitoring. |
| **Telegram** | Customer ordering + payment flow; admin commands + optional **AI** (`/ai`) via Anthropic **or** **OpenRouter**. |

---

## 2. Main feature areas (implemented)

- **Admin dashboard (React)** — Orders, customers, subscriptions, packages, routers, configs (`.rsc`, captive HTML, PCQ), VPN tunnels, scripts, system settings, admins, audit log, health/monitoring, router monitor (PRTG-lite), bandwidth capacity, suspensions, static IP, offers, vouchers, customer portal accounts, **Security** (auth audit + emergency stop).
- **Public portal (`/portal`)** — Package selection, payments (bKash/Nagad + TrxID), OTP login, renewal, trial, vouchers, branding, i18n (BN/EN), PWA, optional app download links, push registration, bandwidth share banner.
- **Notifications** — Telegram, WhatsApp, SMS providers, OTP, expiry reminders, offer broadcast, FCM push (when configured).
- **MikroTik** — Provision users, MAC binding, multi-router pick by load, monitoring (CPU guard, queues, SFP, ping, neighbors), optional per-subscription VPN routing (policy routing + static IP).
- **Ops** — `ops.emergency_stop` pauses **cron** jobs (sync, monitoring, reminders, etc.); HTTP API stays up. Telegram `/emergency_on` / `/emergency_off`.
- **AI (admin Telegram)** — `ai.claude.enabled` + either **OpenRouter** (`ai.openrouter.enabled` + `ai.openrouter.api_key`) **or** Anthropic direct (`ai.claude.api_key`). Models listed in `/models` depend on provider.

---

## 3. Technology stack

- **Backend:** Node 20, Express, `mysql2`, Redis (sessions/cache where used), `node-cron`, `node-telegram-bot-api`, `axios`, `zod`, JWT (admin + customer).
- **Frontend:** React 18, Vite, Tailwind, React Query v5, Recharts, Lucide, Capacitor hooks (optional native shell).
- **DB:** MySQL 8.x, migrations in `backend/migrations/`.
- **Deploy:** `docker-compose.yml` (Caddy), `docker-compose.coolify.yml` (Coolify/Traefik).

---

## 4. Configuration surfaces

1. **Environment variables** (`.env` / Coolify) — DB, Redis, `JWT_SECRET`, `TELEGRAM_BOT_TOKEN`, optional env MikroTik fallback, `PUBLIC_BASE_URL`, etc. See `backend/.env.example`.
2. **System settings (DB)** — Almost all product behaviour: branding, features, notify channels, monitoring intervals, AI keys (Anthropic / OpenRouter), bandwidth thresholds, etc. Editable in admin **System** UI.
3. **MikroTik** — Routers and credentials stored in DB; generated `.rsc` and hotspot HTML pulled from the app.

---

## 5. Security notes (high level)

- Admin API uses JWT; portal uses separate customer tokens.
- **Security** page logs admin login success/failure, portal login attempts, OTP verify outcomes (with IP/UA where available).
- Rate limits on sensitive portal routes; secrets stored with `is_secret` in settings.
- **Rotate** default `admin` password immediately after first deploy; use strong `JWT_SECRET` / `SESSION_SECRET`.
- AI and Telegram admin commands are powerful: treat `TELEGRAM_ADMIN_IDS` and API keys as production secrets.

---

## 6. Gaps / optional next steps (not exhaustive)

- **SSH / VPS intrusion detection** — Not built into the app; use fail2ban, SSH keys, and host firewall on the VPS.
- **Native mobile app** — Capacitor scaffolding exists; Play/App Store signing is a manual step (see `docs/MOBILE_APP.md`).
- **Payment gateways** — bKash/Nagad manual TrxID flow is implemented; deep API checkout integrations are optional future work.
- **OpenRouter model list** — Telegram shows a **fixed** preset list; arbitrary long model IDs use `ai.openrouter.default_model` + one-shot `/ai text` or extend `OPENROUTER_MODEL_CHOICES` in `backend/src/services/claude.js`.

---

## 7. Deploy checklist (short)

1. Run DB migrations (Coolify migrate service or `node backend/src/database/migrate.js` in container).
2. Set env vars; point domain to VPS; HTTPS via Caddy or Traefik.
3. Add MikroTik router(s) in admin UI; add packages; test provision on a lab router.
4. Configure notification channels; set `site.public_base_url`.
5. Enable AI only after setting keys; test `/ai` on Telegram as admin.

---

## 8. Documentation index

| Doc | Topic |
|-----|--------|
| `README.md` | Overview, deploy pointers |
| `docs/DEPLOY.md` | Manual Docker deploy |
| `docs/COOLIFY_DEPLOY.md` | Coolify |
| `docs/CLAUDE_TELEGRAM.md` | AI: Anthropic + OpenRouter |
| `docs/MOBILE_APP.md` | Capacitor / push |
| `docs/ADMIN_COMMANDS.md` | Telegram admin commands |

---

*Generated as a project snapshot for operators and auditors. Update this file when major modules change.*
