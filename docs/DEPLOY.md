# 🛰️ Skynity ISP — Deployment Guide (Phase 1)

Full ISP management system with **Telegram bot → Admin approval → Auto-provisioning** on MikroTik. VPS এ one-command deploy। পরবর্তী phases এ Web dashboard, Monitoring, Billing reports যুক্ত হবে।

---

## 📦 এই Phase এ যা আছে

- ✅ Telegram bot (customer signup + payment + admin approval)
- ✅ MySQL database (customers, orders, payments, subscriptions, routers, audit log)
- ✅ MikroTik REST API integration (auto PPPoE/Hotspot user create)
- ✅ Auto-expire cron (expired subscriptions disable হবে)
- ✅ Retry cron (router offline থাকলেও order approve হবে, পরে sync হবে)
- ✅ Activity monitoring (last-seen IP/MAC, bandwidth usage tracking)
- ✅ Docker Compose deployment

---

## 🖥️ VPS Prerequisites

- **OS:** Ubuntu 22.04 / 24.04 (Debian 12 ও চলবে)
- **RAM:** 2GB+
- **CPU:** 2 core+
- **Disk:** 20GB+
- **Public IP** (Telegram bot polling এর জন্য লাগবে না webhook, কিন্তু VPS থেকে internet access লাগবে)
- **Domain:** Optional (phase 3 এ SSL এর সময় লাগবে)

---

## 🚀 Quick Setup (প্রায় ১৫ মিনিট)

### Step 1: VPS এ Docker install

```bash
# Ubuntu/Debian
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker  # relogin group

docker --version
docker compose version
```

### Step 2: Project clone / copy

```bash
mkdir -p ~/skynity && cd ~/skynity
# Copy the skynity-isp folder here (from this artifact)
# OR git clone when repo is ready
```

### Step 3: Telegram Bot Token তৈরি

1. Telegram এ [@BotFather](https://t.me/BotFather) এ যান
2. `/newbot` পাঠান
3. Bot name দিন: `Skynity ISP`
4. Username দিন: `skynity_isp_bot` (unique হতে হবে)
5. যে token পাবেন (`1234567890:AAxx...`) সেটা save করুন

### Step 4: Admin Telegram ID বের করুন

1. Telegram এ [@userinfobot](https://t.me/userinfobot) এ যান
2. `/start` পাঠান
3. আপনার numeric ID (যেমন `123456789`) পাবেন

### Step 5: `.env` file তৈরি

```bash
cd ~/skynity/skynity-isp/backend
cp .env.example .env
nano .env
```

**গুরুত্বপূর্ণ fields fill করুন:**

```env
DB_PASSWORD=এখানে-strong-password
DB_ROOT_PASSWORD=আরেকটা-strong-password

TELEGRAM_BOT_TOKEN=1234567890:AAxxxxxxxxxxxxxxxxx
TELEGRAM_ADMIN_IDS=123456789

# MikroTik - phase 2 এ VPN এর মাধ্যমে connect করব
# এখনের জন্য placeholder দিলেও চলবে
MIKROTIK_HOST=192.168.50.1
MIKROTIK_USERNAME=api-user
MIKROTIK_PASSWORD=strong-api-password

BKASH_NUMBER=01XXXXXXXXX
NAGAD_NUMBER=01XXXXXXXXX

JWT_SECRET=$(openssl rand -hex 32)  # একটা random string generate করুন
SESSION_SECRET=$(openssl rand -hex 32)
```

`Ctrl+O` → `Enter` → `Ctrl+X` দিয়ে save।

### Step 6: MikroTik এ REST API enable করুন

Router এর terminal (Winbox → New Terminal) এ:

```mikrotik
# একটা dedicated API user তৈরি করুন (admin না)
/user group add name=api-group policy=read,write,api,rest-api

/user add name=api-user group=api-group password="strong-api-password" address=VPS-এর-IP/32

# www-ssl enable
/ip service set www-ssl disabled=no
/ip service set www-ssl address=VPS-এর-IP/32

# self-signed certificate (phase 2 এ Let's Encrypt করব)
/certificate add name=mikrotik-api common-name=mikrotik-api days-valid=3650
/certificate sign mikrotik-api
:delay 5
/ip service set www-ssl certificate=mikrotik-api
```

> **Note:** Production এ MikroTik কে direct public internet এ expose করবেন না। সবচেয়ে secure option হলো **WireGuard VPN** MikroTik ↔ VPS এর মধ্যে। পুরো setup guide: [`WIREGUARD.md`](WIREGUARD.md)

### Step 7: MikroTik এ PPPoE/Hotspot Profile সঠিক নামে আছে কিনা check

আমাদের seeded packages এর profile names:
- `hs-2m`, `hs-5m` (Hotspot)
- `pppoe-5mb`, `pppoe-10mb`, `pppoe-20mb` (PPPoE)

PPPoE profiles তো আমরা আগের session এ তৈরি করেছি। Hotspot profiles তৈরি করুন:

```mikrotik
/ip hotspot user profile
add name=hs-2m rate-limit=2M/2M shared-users=1
add name=hs-5m rate-limit=5M/5M shared-users=1
```

### Step 8: Deploy

```bash
cd ~/skynity/skynity-isp/docker
docker compose up -d --build
```

প্রথমবার কিছুক্ষণ সময় লাগবে (image build + migrate)। 5 টা container start হবে: **mysql, redis, migrate, backend, frontend**।

### Step 9: Verify

```bash
docker compose ps         # সব container "Up" দেখাবে
docker compose logs -f backend
```

Backend log এ দেখবেন:
```
database connection ok
Telegram bot started
cron jobs scheduled
Skynity ISP backend listening
```

Health check (backend internal):
```bash
docker compose exec backend wget -qO- http://localhost:3000/health
```

### Step 10: ওয়েব Dashboard এ Login করুন

Browser এ যান: **`http://YOUR_VPS_IP/`**

First-run credentials:
- **Username:** `admin`
- **Password:** `admin123`

> ⚠️ **Login এর পর অবশ্যই password change করুন।** Phase 4 এ UI থেকে করার option আসবে, এই মুহূর্তে database এ direct update করতে হবে:
>
> ```bash
> docker compose exec backend node -e "import('bcrypt').then(b => b.default.hash('NEW_STRONG_PW', 10).then(h => console.log(h)))"
> # copy the hash, then:
> docker compose exec mysql mysql -u skynity -p skynity -e "UPDATE admins SET password_hash='<PASTE_HASH>' WHERE username='admin';"
> ```

---

## 🧪 Testing Flow

### Customer (আপনি নিজে test করুন):
1. Telegram এ আপনার bot খুঁজুন (`@skynity_isp_bot`)
2. `/start` পাঠান
3. "🛒 Buy Package" চাপুন
4. একটা package choose করুন
5. Name, Phone enter করুন
6. একটা dummy TrxID দিন (যেমন: `TEST123ABC`)
7. যেকোনো screenshot পাঠান

### Admin (আপনার same Telegram account):
1. Notification আসবে "New Order" আকারে
2. "✅ Approve" button চাপুন
3. Instantly user credentials তৈরি হবে এবং customer কে পাঠানো হবে
4. MikroTik এ `/ppp secret print` অথবা `/ip hotspot user print` দিয়ে verify করুন

### Admin Commands:
পুরো admin command reference দেখতে [`ADMIN_COMMANDS.md`](ADMIN_COMMANDS.md) দেখুন। Quick reference:
- `/admin` — all admin commands
- `/pending` — all pending orders
- `/stats`, `/today` — quick statistics
- `/customer <code>`, `/customers [search]`
- `/suspend <login>`, `/resume <login>`, `/active`
- `/packages`, `/addpkg`, `/routers`, `/addrouter`

---

## 🛠️ Common Operations

### Backend restart:
```bash
cd ~/skynity/skynity-isp/docker
docker compose restart backend
```

### Logs দেখা:
```bash
docker compose logs -f backend        # real-time
docker compose logs --tail 200 backend # last 200 lines
```

### Database backup:
```bash
docker compose exec mysql \
  mysqldump -u root -p${DB_ROOT_PASSWORD} --databases skynity \
  > ~/backup-$(date +%F).sql
```

### DB তে shell access:
```bash
docker compose exec mysql mysql -u skynity -p skynity
```

### Package/pricing change:
```sql
UPDATE packages SET price = 600 WHERE code = 'PPPOE-10M-30D';
INSERT INTO packages (code, name, service_type, rate_up_mbps, rate_down_mbps, duration_days, price, mikrotik_profile, sort_order)
VALUES ('PPPOE-50M-30D', 'PPPoE 50Mbps — 30 Days', 'pppoe', 50, 50, 30, 3000, 'pppoe-50mb', 60);
```

তারপর MikroTik এ corresponding profile add করতে ভুলবেন না!

### একজন admin কে web-dashboard এর জন্য তৈরি করা (Phase 3 এ লাগবে):

Phase 1 এ শুধু Telegram ID দিয়ে admin check হয়। Phase 3 এ আসলে web login দরকার হবে।

---

## 🔐 Security Recommendations

1. **VPS Firewall:** Port 22 (SSH), 80 (web dashboard), 443 (future HTTPS) public রাখুন। 3000 (backend) এবং 3306 (MySQL) internal রাখুন (default এ compose এ expose করা নেই)।
   ```bash
   sudo ufw allow 22
   sudo ufw allow 80
   sudo ufw allow 443
   sudo ufw enable
   ```

2. **SSH:** password-auth disable করে শুধু key-based login রাখুন।

3. **MikroTik API user:** শুধু VPS এর IP থেকে allow করুন (`address=VPS-IP/32`)।

4. **Backup:** রোজকার automatic database backup set করুন (Phase 2 এ cron দিয়ে করব)।

5. **`.env` file এর permissions:**
   ```bash
   chmod 600 ~/skynity/skynity-isp/backend/.env
   ```

---

## 📂 Project Structure

```
skynity-isp/
├── backend/
│   ├── src/
│   │   ├── config/        # env validation
│   │   ├── database/      # MySQL pool + migrations
│   │   ├── mikrotik/      # RouterOS REST API client
│   │   ├── telegram/      # bot logic
│   │   ├── services/      # provisioning, billing (core business logic)
│   │   ├── jobs/          # cron jobs
│   │   ├── routes/        # HTTP API routes (phase 3 এ বাড়বে)
│   │   ├── middleware/    # auth, validation
│   │   ├── utils/         # logger, crypto helpers
│   │   └── index.js       # entry point
│   ├── migrations/        # SQL migration files
│   ├── Dockerfile
│   ├── package.json
│   └── .env.example
├── docker/
│   └── docker-compose.yml
└── docs/
    └── DEPLOY.md          # ← you are here
```

---

## 🐞 Troubleshooting

### Bot "Unauthorized" দেখাচ্ছে
- `.env` এর `TELEGRAM_BOT_TOKEN` সঠিক কিনা check করুন
- BotFather থেকে আবার copy করুন (space নেই নিশ্চিত হন)

### Admin notification আসছে না
- `.env` এর `TELEGRAM_ADMIN_IDS` এ আপনার numeric ID আছে কিনা
- আপনি নিজে bot এর সাথে `/start` দিয়ে conversation শুরু করেছেন কিনা (Telegram rule)

### MikroTik "connect ETIMEDOUT"
- VPS থেকে MikroTik IP ping হয় কিনা test করুন
- Firewall rule এ VPS IP allowed কিনা
- `/ip service print` → www-ssl enabled কিনা
- Phase 2 এ WireGuard দিয়ে সহজ হবে

### "MikroTik push failed" কিন্তু order approved
- This is by design: order approve হবে এবং ৫ মিনিট পর cron retry করবে
- `docker compose logs backend | grep mikrotik` দিয়ে error দেখুন

### Photo screenshot save হচ্ছে না
- Uploads volume mount ঠিক আছে কিনা check করুন: `docker compose exec backend ls /app/uploads`

---

## 🗺️ আগামী Phases (Roadmap)

- **Phase 2:** WireGuard MikroTik↔VPS, MikroTik password encryption, package management via admin commands
- **Phase 3:** Web Dashboard (React) — customer CRUD, invoice PDF, reports
- **Phase 4:** Real-time MikroTik monitoring — bandwidth graphs, ping/latency, SFP, neighbors
- **Phase 5:** Multi-router support, resellers, SMS alerts, bKash payment gateway API integration

---

**Skynity ISP — Built with ❤️**
