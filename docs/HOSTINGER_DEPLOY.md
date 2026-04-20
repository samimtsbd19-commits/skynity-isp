# 🚀 Hostinger VPS + Docker Manager — One-Click Deploy Guide

এই guide তে Hostinger VPS এর **Docker Manager** ব্যবহার করে GitHub থেকে Skynity ISP পুরোটা auto-deploy করার পুরো step-by-step দেওয়া আছে। Domain `wifi.skynity.org` already VPS এর সাথে pointed আছে ধরে নিচ্ছি।

---

## 📋 Prerequisites (আগে থেকে ready থাকতে হবে)

1. **Hostinger VPS** — KVM 2 (2 vCPU / 8 GB RAM / Ubuntu 24.04 LTS) যথেষ্ট
2. **Domain DNS** — `wifi.skynity.org` এর **A record** VPS IP এ pointed (✅ already done)
3. **GitHub repository** — Skynity ISP code push করা আছে এমন একটা repo
4. **Telegram Bot Token** — @BotFather থেকে তৈরি ([জানতে ক্লিক](https://t.me/BotFather))
5. **Telegram Admin ID** — আপনার numeric ID ([@userinfobot](https://t.me/userinfobot))

---

## 🛠️ Step 1: GitHub এ Code Push করুন

আপনার local machine এ Skynity ISP folder থেকে:

```bash
cd skynity-isp
git init
git add .
git commit -m "initial deploy"
git branch -M main
git remote add origin https://github.com/<your-username>/skynity-isp.git
git push -u origin main
```

> 🔐 **Repo private করতে ভুলবেন না** — `.env.example` তে কোন secret নেই, কিন্তু production `.env` কখনই commit করবেন না (`.gitignore` এ আছেই)।

---

## 🛠️ Step 2: Hostinger Docker Manager এ যান

1. [hpanel.hostinger.com](https://hpanel.hostinger.com) এ login করুন
2. **VPS** মেনু → আপনার VPS select করুন
3. বাম দিকের sidebar থেকে **Docker Manager** ক্লিক করুন
4. উপরে ডান পাশে **"Add app"** / **"Create project"** বাটন ক্লিক করুন

---

## 🛠️ Step 3: GitHub Repository Connect করুন

Docker Manager এ "New project" dialog এ:

| Field | Value |
|-------|-------|
| **Source** | **GitHub** |
| **Repository URL** | `https://github.com/<your-username>/skynity-isp` |
| **Branch** | `main` |
| **Compose file path** | `docker-compose.yml` (root এর file — default) |
| **Project name** | `skynity-isp` |

> Hostinger প্রথমবার GitHub access চাইবে — authorize করলে public/private সব repo list এ আসবে।

---

## 🛠️ Step 4: Environment Variables Set করুন

Hostinger এর UI তে **"Environment variables"** section এ নিচের values add করুন। এইগুলোই `.env` file হিসেবে container এ inject হবে:

### 🔴 REQUIRED (অবশ্যই fill করতে হবে)

```env
DOMAIN=wifi.skynity.org
ACME_EMAIL=you@yourdomain.com

DB_PASSWORD=<run: openssl rand -base64 24>
DB_ROOT_PASSWORD=<run: openssl rand -base64 24>

TELEGRAM_BOT_TOKEN=1234567890:AAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TELEGRAM_ADMIN_IDS=123456789

JWT_SECRET=<run: openssl rand -hex 32>
SESSION_SECRET=<run: openssl rand -hex 32>
```

### 🟢 Recommended

```env
BKASH_NUMBER=01XXXXXXXXX
NAGAD_NUMBER=01XXXXXXXXX
PUBLIC_BASE_URL=https://wifi.skynity.org
```

### 🔵 Optional (পরে admin panel থেকে add করতে পারবেন)

```env
MIKROTIK_HOST=
MIKROTIK_USERNAME=
MIKROTIK_PASSWORD=
```

> 🔐 **Secrets generate করার easy way** — VPS এর SSH terminal এ নিচের command run করুন:
>
> ```bash
> echo "DB_PASSWORD=$(openssl rand -base64 24)"
> echo "DB_ROOT_PASSWORD=$(openssl rand -base64 24)"
> echo "JWT_SECRET=$(openssl rand -hex 32)"
> echo "SESSION_SECRET=$(openssl rand -hex 32)"
> ```

---

## 🛠️ Step 5: Deploy Click করুন

**"Deploy"** / **"Create"** button ক্লিক করুন। Hostinger এখন নিজে থেকে যা যা করবে:

1. ✅ GitHub থেকে code clone করবে
2. ✅ `docker-compose.yml` read করবে
3. ✅ Backend + Frontend images build করবে (~3–5 min প্রথমবার)
4. ✅ MySQL + Redis containers pull করবে
5. ✅ `migrate` container চালিয়ে database schema তৈরি করবে
6. ✅ Backend + Frontend + Caddy start করবে
7. ✅ Caddy Let's Encrypt থেকে HTTPS certificate নেবে (auto)

Progress log Docker Manager এর **Logs** tab এ দেখা যাবে।

---

## 🛠️ Step 6: Verify Deployment

কিছুক্ষণ পর browser এ যান:

```
https://wifi.skynity.org
```

**First-run login:**
- Username: `admin`
- Password: `admin123`

> ⚠️ **First login এর পর অবশ্যই** top-right user menu → **Change password** থেকে strong password set করুন।

### Docker Manager এ container status

সব container **"Running"** দেখাবে:

| Container | Status | Port |
|-----------|--------|------|
| `caddy` | 🟢 Running | 80, 443 |
| `frontend` | 🟢 Running | (internal) |
| `backend` | 🟢 Running | (internal) |
| `mysql` | 🟢 Healthy | (internal) |
| `redis` | 🟢 Healthy | (internal) |
| `migrate` | ⚪ Exited (0) | — (one-shot) |

`migrate` এর **"Exited (0)"** normal — এটা একবার run হয়ে migration apply করে বেরিয়ে যায়।

---

## 🛠️ Step 7: MikroTik Router Add করুন

Admin panel এ login করে:

1. **Routers** (sidebar) → **Add router** ক্লিক করুন
2. Form fill করুন:
   - **Name:** `Main Router`
   - **Host:** router এর IP (or WireGuard tunnel IP)
   - **Port:** `443`
   - **Username:** router এর dedicated API user
   - **Password:** সেই user এর password
   - **Use SSL:** ✅ on
   - **Is default:** ✅ on
3. **Test connection** ক্লিক — "Connected" দেখালে Save করুন।

MikroTik side এ REST API enable করার step [`DEPLOY.md`](DEPLOY.md#step-6-mikrotik-এ-rest-api-enable-করুন) এ বিস্তারিত আছে।

---

## 🔄 Update / Redeploy (GitHub push এর পর)

যখন আপনি code change করে GitHub এ push করেন:

**Option A — Auto-deploy (recommended)**:
Hostinger Docker Manager এর project settings এ **"Auto-deploy on push"** enable করুন। তাহলে প্রতিবার push এর পর auto rebuild হবে।

**Option B — Manual**:
1. Docker Manager → আপনার project → **"Pull & rebuild"** button ক্লিক করুন
2. 2–3 min অপেক্ষা করুন

Data (MySQL, uploads, Caddy certs) সব **volumes** এ থাকে — rebuild হলেও data হারায় না।

---

## 📊 Monitoring & Logs

### Real-time logs দেখতে

Docker Manager এ project → **Logs** tab → container select করুন।

CLI দিয়ে:

```bash
ssh root@<your-vps-ip>
cd /root/docker_compose_projects/skynity-isp   # Hostinger এর default path
docker compose logs -f backend
docker compose logs -f caddy
```

### Database backup

```bash
docker compose exec mysql mysqldump -u root -p${DB_ROOT_PASSWORD} --databases skynity \
  > ~/skynity-backup-$(date +%F).sql
```

---

## 🐞 Troubleshooting

### ❌ "502 Bad Gateway" browser এ

- Backend container healthy কিনা check: Docker Manager → backend → Logs
- সাধারণত DB password mismatch — `.env` এর `DB_PASSWORD` এবং `DB_ROOT_PASSWORD` যা দিয়েছেন সেটাই MySQL এ সেট হয়েছে কিনা verify করুন
- First-time rebuild যদি না হয়, mysql_data volume delete করে আবার try করুন

### ❌ HTTPS certificate আসছে না

- DNS propagate হতে কিছু সময় লাগে। `dig wifi.skynity.org` দিয়ে VPS IP ঠিক আছে কিনা check করুন।
- Hostinger এর firewall এ port **80 AND 443** দুটোই open কিনা নিশ্চিত হন (Let's Encrypt validation এর জন্য 80 দরকার)।
- Caddy log check করুন: `docker compose logs -f caddy`

### ❌ Telegram bot reply করছে না

- `.env` এ `TELEGRAM_BOT_TOKEN` সঠিক কিনা (BotFather থেকে আবার copy করুন)
- Backend log এ "Telegram bot started" আসছে কিনা: `docker compose logs backend | grep -i telegram`

### ❌ Admin panel এ login হচ্ছে না

- `username=admin password=admin123` use করুন
- যদি password ভুলে গেছেন reset:

  ```bash
  docker compose exec backend node -e "import('bcrypt').then(b=>b.default.hash('NEW_PASSWORD', 10).then(console.log))"
  # উপরের hash copy করে:
  docker compose exec mysql mysql -u root -p${DB_ROOT_PASSWORD} \
    skynity -e "UPDATE admins SET password_hash='<PASTE_HASH>' WHERE username='admin';"
  ```

---

## 🔒 Post-deploy Security Checklist

- [ ] `admin / admin123` default password change করা হয়েছে
- [ ] Hostinger Firewall: port 22 (SSH), 80 (HTTP), 443 (HTTPS) only allowed
- [ ] SSH key-based login enable (password-auth disable)
- [ ] GitHub repo **private** করা আছে
- [ ] `.env` কখনই commit করা হয়নি (`git log --all -- .env` empty হতে হবে)
- [ ] MikroTik router এ dedicated API user বানানো, `admin` নয়
- [ ] Automatic daily database backup setup

---

## ✨ Everything Up — Welcome to Skynity!

আপনার full ISP management system এখন live — `https://wifi.skynity.org`

পরবর্তী reference:
- Admin bot commands → [`ADMIN_COMMANDS.md`](ADMIN_COMMANDS.md)
- WireGuard VPN (MikroTik ↔ VPS secure tunnel) → [`WIREGUARD.md`](WIREGUARD.md)
- Full deploy details / troubleshooting → [`DEPLOY.md`](DEPLOY.md)
