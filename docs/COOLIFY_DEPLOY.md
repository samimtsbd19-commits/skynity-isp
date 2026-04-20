# Coolify দিয়ে Skynity-ISP + একাধিক প্রজেক্ট ডিপ্লয় (Hostinger VPS)

> একটাই VPS — যত খুশি প্রজেক্ট। প্রতিটার নিজস্ব domain/subdomain, auto-SSL, GitHub auto-deploy।

এই গাইড ধরে নিয়েছে আপনি Hostinger KVM VPS ব্যবহার করছেন এবং কোনো control panel নেই — শুধু bare Ubuntu চান।

---

## কেন Coolify?

| প্রয়োজন | Coolify সমাধান |
|---|---|
| একাধিক প্রজেক্ট একই VPS-এ | ✅ প্রতি প্রজেক্টে আলাদা container + subdomain |
| SSL সার্টিফিকেট | ✅ Let's Encrypt auto-renew |
| GitHub push → auto deploy | ✅ Webhook support |
| সুন্দর UI (CLI ছাড়া) | ✅ React dashboard |
| Logs, metrics, restart | ✅ এক ক্লিকে |
| ডাটাবেস (MySQL/Postgres/Redis) | ✅ One-click provision |
| Backup | ✅ S3/local |
| খরচ | ✅ 100% Free + Open Source |

---

## ধাপ ০ — দরকারি জিনিসপত্র

- ✅ Hostinger VPS (minimum **2 GB RAM, 20 GB disk**; 4 GB recommend)
- ✅ একটা ডোমেইন (আপনার `skynity.org` হলেই হবে)
- ✅ DNS management access (Cloudflare / Hostinger DNS / etc.)

---

## ধাপ ১ — VPS Fresh Install

Hostinger hPanel → **VPS → Operating System → Change OS**

- **Tab:** `Plain OS`
- **Select:** **Ubuntu 24.04 LTS** (64-bit, clean)
- Root password সেট করুন → **Install**

⚠️ "Application" tab থেকে WordPress / Docker+Traefik / কিছুই **নেবেন না**। Coolify সব নিজে সাজিয়ে দেবে।

ইনস্টল ৫-১০ মিনিট। শেষ হলে VPS IP + root password পাবেন।

---

## ধাপ ২ — DNS সেটআপ (Coolify install-এর আগে)

আপনার DNS provider-এ (Cloudflare recommend) এগুলো A record হিসেবে বসান, সবই VPS IP-তে point করবে:

```
wifi.skynity.org       A    YOUR_VPS_IP    (skynity-isp প্রজেক্ট)
coolify.skynity.org    A    YOUR_VPS_IP    (Coolify admin panel)
*.skynity.org          A    YOUR_VPS_IP    (ভবিষ্যতের সব প্রজেক্ট, wildcard)
```

> Cloudflare ব্যবহার করলে: **প্রক্সি (কমলা মেঘ) OFF রাখুন** ("DNS only")। না হলে Let's Encrypt SSL validation fail হবে।

DNS propagate হয়েছে কিনা দেখুন:

```bash
dig +short wifi.skynity.org
# Output আপনার VPS IP হওয়া উচিত
```

---

## ধাপ ৩ — VPS-এ SSH এবং Initial Security

Windows থেকে PowerShell / Terminal-এ:

```bash
ssh root@YOUR_VPS_IP
# Yes লিখে enter, তারপর password
```

### (ঐচ্ছিক কিন্তু Recommended) একটা non-root user বানান

```bash
adduser skynity
usermod -aG sudo skynity
# পরবর্তী login-এ: ssh skynity@YOUR_VPS_IP
```

### Firewall (UFW) সেট

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 8000/tcp     # Coolify UI (পরে বন্ধ করব)
ufw --force enable
ufw status
```

### System update

```bash
apt update && apt upgrade -y
```

---

## ধাপ ৪ — Coolify Install (এক কমান্ড)

```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | sudo bash
```

৫-৮ মিনিট অপেক্ষা করুন। শেষে দেখাবে:

```
Coolify is running!
URL: http://YOUR_VPS_IP:8000
```

---

## ধাপ ৫ — Coolify প্রথম লগইন

1. ব্রাউজারে: `http://YOUR_VPS_IP:8000`
2. **Create the first admin account**:
   - Name, Email, Strong Password
3. Login হয়ে dashboard দেখবেন

---

## ধাপ ৬ — Coolify-কে নিজের SSL দেওয়া

Dashboard → **Settings** (উপরে বাম) → **Instance Settings**

- **Instance's Domain:** `https://coolify.skynity.org`
- **Save**

Coolify নিজের জন্য Let's Encrypt SSL নেবে (১-২ মিনিট)।

এবার `https://coolify.skynity.org` দিয়ে ঢুকতে পারবেন — `:8000` আর লাগবে না।

```bash
ufw delete allow 8000/tcp    # 8000 বন্ধ করে দিন
```

---

## ধাপ ৭ — GitHub Connect

Dashboard → **Sources** (বাম মেনু) → **+ Add**

- **Type:** GitHub App (recommended) অথবা Personal Access Token
- **GitHub App:** "Register new GitHub App" → browser জাম্প করবে GitHub-এ → "Create GitHub App" → Install on your account → আপনার repo গুলো দেখতে পাবে

---

## ধাপ ৮ — Skynity-ISP Deploy 🚀

### 8.1 Project তৈরি

Dashboard → **Projects** → **+ New Project**
- Name: `Skynity ISP`
- **Create**

Project-এ ঢুকুন → **+ New Resource** → **Docker Compose** সিলেক্ট করুন

### 8.2 Source configure

- **Source:** GitHub (ধাপ ৭-এ connect করা)
- **Repository:** `samimtsbd19-commits/skynity-isp`
- **Branch:** `main`
- **Base Directory:** `/` (root)
- **Docker Compose Location:** `/docker-compose.coolify.yml` ⚠️ *(Coolify-র জন্য dedicated file)*
- **Continue**

Coolify compose file পার্স করে services list দেখাবে: `mysql`, `redis`, `migrate`, `backend`, `frontend`

### 8.3 Domain + Port সেট

**`frontend` service**-এ click করুন:

- **Domains:** `https://wifi.skynity.org`
- **Port Exposes:** `80`
- Save

Coolify auto-SSL নেবে এবং Traefik rule generate করবে।

### 8.4 Environment Variables

Project → **Environment Variables** tab → **Edit** → নিচেরগুলো paste করুন (values পরিবর্তন করুন):

```env
# --- Domain ---
DOMAIN=wifi.skynity.org
PUBLIC_BASE_URL=https://wifi.skynity.org

# --- Database ---
DB_NAME=skynity
DB_USER=skynity
DB_PASSWORD=STRONG_PASSWORD_HERE
DB_ROOT_PASSWORD=ANOTHER_STRONG_PASSWORD

# --- Security (MUST change) ---
# Generate each with: openssl rand -hex 32
JWT_SECRET=64_char_random_hex_string_here
SESSION_SECRET=different_64_char_random_hex_string

# --- Telegram (optional, later from UI) ---
TELEGRAM_BOT_TOKEN=
TELEGRAM_ADMIN_IDS=

# --- MikroTik (optional, later from UI) ---
MIKROTIK_HOST=
MIKROTIK_USERNAME=
MIKROTIK_PASSWORD=

# --- Payment display ---
BKASH_NUMBER=01XXXXXXXXX
NAGAD_NUMBER=01XXXXXXXXX

# --- Branding ---
APP_NAME=Skynity ISP
APP_TIMEZONE=Asia/Dhaka
```

**Save**।

> `JWT_SECRET` / `SESSION_SECRET` generate করতে VPS-এ:
> ```bash
> openssl rand -hex 32
> openssl rand -hex 32
> ```
> দুইবার রান করে দুইটা আলাদা মান নিন।

### 8.5 Deploy

Uppder-এ **Deploy** (🚀) চাপুন।

Coolify এখন:
1. GitHub থেকে code clone করবে
2. Docker images build করবে (backend, frontend)
3. MySQL, Redis start করবে
4. `migrate` চালিয়ে database schema বানাবে
5. Backend + Frontend start করবে
6. Traefik SSL নেবে

⏱ প্রথমবার ৫-১০ মিনিট। Logs live দেখতে পাবেন।

### 8.6 Verify

- **Health:** `https://wifi.skynity.org/health` → JSON দেখবেন
- **Dashboard:** `https://wifi.skynity.org` → login page
- **Login:** `admin` / `admin123` → ⚠️ **সাথে সাথে password change করুন**

---

## ধাপ ৯ — GitHub Push করলে Auto Redeploy

Coolify → Project → **Webhooks** tab → **Enable**

এখন `git push origin main` করলে Coolify নিজে থেকেই নতুন version deploy করবে। 🎉

---

## ধাপ ১০ — নতুন প্রজেক্ট যোগ করা (Future-proof)

ভবিষ্যতে যেকোনো প্রজেক্ট একই VPS-এ deploy করতে:

1. Coolify → **New Project** → **New Resource**
2. Type সিলেক্ট:
   - **Docker Compose** → GitHub repo
   - **Dockerfile** → একটা Dockerfile যথেষ্ট
   - **Static Site** → React/Vite/Next build
   - **WordPress / Ghost / Strapi** → One-click template
   - **Database** → PostgreSQL/MySQL/Redis/MongoDB (stand-alone)
3. Domain সেট: যেমন `app2.skynity.org`, `blog.skynity.org` — wildcard DNS থাকায় DNS update লাগবে না
4. Deploy চাপুন

Coolify নিজে থেকেই Traefik-এ route যোগ করবে ও SSL নেবে। **একাধিক প্রজেক্ট কোনো conflict ছাড়াই** একই 80/443 পোর্ট share করবে।

---

## Troubleshooting

### SSL not working / "Unable to get certificate"
- DNS VPS IP-তে point করছে কিনা: `dig +short wifi.skynity.org`
- Cloudflare proxy **OFF** কিনা (DNS only)
- Port 80 ও 443 firewall-এ allow কিনা: `ufw status`
- Let's Encrypt rate limit (domain-এ ৫ বার ব্যর্থ হলে ১ সপ্তাহ ব্লক)

### Container restarting বারবার
- Coolify → service → **Logs** দেখুন
- সাধারণত DB password বা JWT_SECRET মিসিং/ভুল

### Backend can't connect to DB
- `DB_HOST=mysql` (service name, হোস্টনেম নয়) ঠিক আছে কিনা
- MySQL container `healthy` হয়েছে কিনা: service status page

### ডিস্ক ভরে গেছে
- পুরনো image clean: `docker system prune -a -f`
- Coolify dashboard → Server → Cleanup

---

## Backup Strategy

Coolify → Project → `mysql` service → **Backup** tab:
- Schedule: Daily 03:00
- Destination: Local / S3 / Backblaze B2

`uploads` volume-এর জন্য:
```bash
# VPS-এ cron:
0 4 * * * docker run --rm -v skynity-isp_uploads:/data -v /root/backups:/backup alpine tar czf /backup/uploads-$(date +\%F).tgz -C /data .
```

---

## দরকারি Links

- Coolify docs: https://coolify.io/docs
- Coolify Discord: https://coollabs.io/discord
- Skynity-ISP repo: https://github.com/samimtsbd19-commits/skynity-isp

---

## সংক্ষেপে কমান্ড (cheat sheet)

```bash
# SSH
ssh root@YOUR_VPS_IP

# Coolify install
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | sudo bash

# Secret generate
openssl rand -hex 32

# Docker cleanup
docker system prune -a -f

# Coolify service restart
systemctl restart coolify
```

সব ঠিক থাকলে আপনি এখন:
- ✅ `https://wifi.skynity.org` — skynity-isp live
- ✅ `https://coolify.skynity.org` — management dashboard
- ✅ ভবিষ্যতের প্রজেক্ট এক ক্লিকে deploy
