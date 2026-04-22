# Skynity ISP — FreeRADIUS / AAA Runbook

This document is the **production runbook** for the RADIUS subsystem:
design, schema, MikroTik switchover, day-2 operations, scaling, and the
zero-downtime migration from MikroTik-local auth to RADIUS.

> Current state of every deployment that existed **before** migration
> `020_radius_aaa.sql` was applied: PPPoE and Hotspot users live as
> `/ppp secret` and `/ip hotspot user` rows on the MikroTik itself, and
> the Skynity backend keeps them in lock-step via the RouterOS REST API.
> That path still works after this release — RADIUS is **opt-in** behind
> `feature.radius_enabled`.

---

## 1. Architecture

```
                        ┌──────────────────────────────┐
                        │   Skynity VPS (one host)    │
                        │                              │
 Customer PPPoE/Hotspot │  ┌────────────┐   ┌────────┐ │
   ────────────────────▶│  │ FreeRADIUS │──▶│ MySQL  │ │
                        │  │   3.2      │   │        │ │
                        │  └────┬───────┘   └────────┘ │
                        │       │(SQL)     ▲  │        │
                        │       │          │  │        │
  MikroTik NAS  ◀──────▶│  1812 │   ┌──────┴──┴──┐    │
  (Starlink /             │1813 │   │  Skynity   │    │
   Cudy AP / 150 users)   │3799 │   │  backend   │    │
                        │   UDP │   │  (Node.js) │    │
                        │       └──▶│            │    │
                        │           └────────────┘    │
                        └──────────────────────────────┘
```

### Control plane

- **Skynity backend** writes to `radcheck / radreply / radusergroup /
  radgroupreply / nas` whenever a subscription / package / router
  changes. It does **not** speak RADIUS itself during normal auth.
- **FreeRADIUS** reads those tables on demand (no restart, no daemon
  reload — the SQL module hits MySQL for every auth).
- **CoA / Disconnect** (RFC 5176) is originated **by the backend**, not
  by FreeRADIUS. Backend builds the packet, signs it with the per-NAS
  shared secret, and sends it on UDP/3799 to the router. MikroTik is
  expected to reply with Disconnect-ACK (code 41).

### Data plane

- **MikroTik** terminates PPPoE / Hotspot sessions, still does all
  packet forwarding, NAT, PCQ shaping. Same as before RADIUS.
- Authentication now lands in RADIUS; accounting packets (Start /
  Interim / Stop) flow to FreeRADIUS, which writes them into
  `radacct`.
- Radius reply attributes (Mikrotik-Rate-Limit, Session-Timeout,
  Idle-Timeout, Framed-IP-Address) are honoured by RouterOS.

---

## 2. Database schema

Migration `backend/migrations/020_radius_aaa.sql` adds:

| Table                       | Owner             | Purpose |
|-----------------------------|-------------------|---------|
| `radcheck`                  | FreeRADIUS        | Per-user auth attributes (Cleartext-Password, Calling-Station-Id, Expiration, Auth-Type := Reject on suspend) |
| `radreply`                  | FreeRADIUS        | Per-user reply attributes (Framed-IP-Address, etc.) |
| `radgroupcheck`             | FreeRADIUS        | Per-group check attributes |
| `radgroupreply`             | FreeRADIUS        | Per-group reply — one group per **package** (Mikrotik-Rate-Limit, Acct-Interim-Interval, Session-Timeout) |
| `radusergroup`              | FreeRADIUS        | Maps `username → groupname` (= `packages.radius_group` or `PKG_<code>`) |
| `radacct`                   | FreeRADIUS        | Accounting records — the single source of truth for session history |
| `radpostauth`               | FreeRADIUS        | Audit trail of every Access-Accept / Access-Reject |
| `nas`                       | FreeRADIUS (SQL clients) | Authorised NAS list — one row per `mikrotik_routers` |
| `radius_sync_log`           | Skynity backend   | Every mutation the backend performs (upsert_user, disable_user, upsert_group, coa_disconnect) |
| `radius_disconnect_queue`   | Skynity backend   | CoA/PoD jobs waiting to be delivered to a NAS |

Skynity-side columns added:
- `packages.radius_group`, `packages.radius_session_timeout`,
  `packages.radius_idle_timeout`
- `mikrotik_routers.radius_enabled`, `radius_secret`, `radius_nas_ip`,
  `radius_nas_shortname`, `radius_coa_port`
- `subscriptions.radius_synced`, `radius_last_sync_at`, `radius_error`

---

## 3. First-time setup

### 3.1 Prerequisites on the VPS

```bash
# Open the RADIUS ports outbound-from-MikroTik → inbound-to-VPS
ufw allow 1812/udp  # auth
ufw allow 1813/udp  # accounting
ufw allow 3799/udp  # CoA / PoD (optional but recommended)
```

### 3.2 Bring the container up

Edit `.env` (copy from `.env.example`):

```ini
RADIUS_HOST=freeradius
RADIUS_AUTH_PORT=1812
RADIUS_ACCT_PORT=1813
RADIUS_COA_PORT=3799
RADIUS_LOCALHOST_SECRET=<openssl rand -hex 16>
```

Bring up the new service:

```bash
cd /root/skynity
git pull
docker compose up -d --build freeradius backend
docker compose logs -f freeradius     # wait until you see "Ready to process requests"
```

If the SQL module can't reach MySQL you'll see it immediately in
`docker compose logs freeradius` — fix DB credentials in `.env` and
restart.

### 3.3 Seed global RADIUS config (admin panel)

From the web admin:

| Setting                        | Value (example)        |
|--------------------------------|------------------------|
| `radius.host`                  | `46.202.166.89` (the VPS public IP **as seen from MikroTik**) |
| `radius.default_secret`        | 32-char random string, e.g. `openssl rand -hex 16` |
| `radius.accounting_interval`   | `60` |
| `radius.nas_type`              | `mikrotik` |
| `radius.auto_register_nas`     | `true` |
| `radius.coa_enabled`           | `true` |

Or via API:

```bash
TOKEN=...   # from /api/auth/login

curl -X PATCH https://wifi.skynity.org/api/radius/settings \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "host": "46.202.166.89",
    "default_secret": "REPLACE_WITH_RAND_HEX",
    "accounting_interval": 60,
    "auto_register_nas": true,
    "coa_enabled": true
  }'
```

### 3.4 Tell Skynity about the MikroTik's RADIUS-side identity

For every `mikrotik_routers` row:

```bash
ROUTER_ID=1
curl -X POST https://wifi.skynity.org/api/radius/nas \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "router_id": 1,
    "radius_nas_ip": "10.88.0.2",    # IP MikroTik uses to talk to VPS
    "radius_secret": "SAME_AS_default_secret_OR_ROUTER_SPECIFIC",
    "radius_nas_shortname": "Main Router",
    "radius_coa_port": 3799,
    "radius_enabled": true
  }'
```

This INSERTs/UPDATEs both the `mikrotik_routers` row **and** the `nas`
row FreeRADIUS will read on its next auth.

### 3.5 Flip the master feature flag and push everything

```bash
curl -X POST https://wifi.skynity.org/api/radius/enable \
  -H "Authorization: Bearer $TOKEN"
```

This does **one** `fullSyncAll()`:
1. `upsertGroup()` for every active package → writes `radgroupreply`
2. `upsertNas()` for every active router
3. `upsertUser()` for every active subscription → writes `radcheck` +
   `radusergroup`

Check:

```bash
curl -H "Authorization: Bearer $TOKEN" https://wifi.skynity.org/api/radius/status
# {"enabled":true,"host":"46.202.166.89","counts":{"nas":1,"users":150,"groups":3,...}}
```

### 3.6 Configure the MikroTik side

Download the generated script:

```
https://wifi.skynity.org/api/configs/generate/radius.rsc
```

Or preview:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  https://wifi.skynity.org/api/configs/generate/radius-preview
```

Then upload `skynity-radius.rsc` to Files on the MikroTik and run:

```routeros
/import file-name=skynity-radius.rsc
```

### 3.7 Verify

On the MikroTik:

```routeros
/radius monitor 0                       # requests in/out should increase
/ppp aaa print                          # use-radius=yes accounting=yes
/log print where topics~"radius"
/radius incoming print                  # accept=yes, port=3799
```

On the VPS:

```bash
# In the last minute, any auths?
docker compose exec mysql mysql -uroot skynity -N -e \
  "SELECT COUNT(*) FROM radpostauth WHERE authdate > NOW() - INTERVAL 1 MINUTE"

# Currently online:
curl -H "Authorization: Bearer $TOKEN" https://wifi.skynity.org/api/radius/online | jq '.count'
```

---

## 4. Day-2 operations

### Provision a customer (no change for operators)

Existing flow works unchanged: approve an order → subscription created
→ `provisioning.approveOrderAndProvision()` pushes to MikroTik **and**
to RADIUS. If RADIUS is disabled, the RADIUS step is a silent no-op.

### Suspend a customer

`POST /api/suspensions/...` — on top of the existing "disable on
MikroTik" step, the suspension service now:

1. Inserts `Auth-Type := Reject` into `radcheck` (future auths
   instantly rejected).
2. Enqueues a CoA Disconnect job in `radius_disconnect_queue` so any
   currently-live session is kicked within ~1 minute by the scheduler.

Lifting a suspension removes the reject attribute; future auths pass.

### Change a package's bandwidth

Change `packages.rate_up_mbps` / `rate_down_mbps` from the admin panel.
**Re-push that group** so RADIUS reflects the new rate:

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  https://wifi.skynity.org/api/radius/groups/<PACKAGE_ID>
```

Existing sessions keep the old rate until the MikroTik reauths (at
session-timeout, or when the customer reconnects). To force-apply:

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"p-abc123","immediate":true,"router_id":1,"reason":"rate-change"}' \
  https://wifi.skynity.org/api/radius/disconnect
```

### Rotate a shared secret

1. On MikroTik: `/radius set [find] secret="NEW_SECRET"`.
2. In Skynity: `PATCH /api/routers-admin/<id>` with `radius_secret`.
   This auto-syncs the `nas` row.
3. Next auth uses the new secret. No restart needed.

### See what happened

```bash
# Every mutation the backend performed
curl -H "Authorization: Bearer $TOKEN" \
  "https://wifi.skynity.org/api/radius/log?limit=50"

# FreeRADIUS auth log
curl -H "Authorization: Bearer $TOKEN" \
  "https://wifi.skynity.org/api/radius/sessions/p-abc123?days=7"

# Auth failures (live — radpostauth)
docker compose exec mysql mysql -uroot skynity \
  -e "SELECT username, reply, authdate FROM radpostauth WHERE reply='Access-Reject' ORDER BY authdate DESC LIMIT 20"
```

### Force disconnect (kick) a user

Queued (recommended — tolerates router flapping):

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"p-abc123","reason":"admin-kick"}' \
  https://wifi.skynity.org/api/radius/disconnect
```

Immediate (blocks the admin request until the NAS ACKs):

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username":"p-abc123","immediate":true}' \
  https://wifi.skynity.org/api/radius/disconnect
# → {"ok":true,"code":41}
```

---

## 5. Zero-downtime migration (MikroTik-local → RADIUS)

The goal: cut 150 live users over **without anyone being disconnected
twice** and with a working rollback.

### Step 1 — Pre-flight (T–1 day)

- Apply migration `020_radius_aaa.sql` (automatic on `docker compose
  up -d` if the migrate sidecar runs).
- Deploy the new backend code with RADIUS support.
- **Leave `feature.radius_enabled = false`.** Nothing changes on the
  MikroTik yet; nothing new is written to `radcheck`.

### Step 2 — Populate RADIUS (T–0, step A)

```bash
# Push every existing package + router + subscription into RADIUS.
# The feature flag gets flipped on as part of this call.
curl -X POST -H "Authorization: Bearer $TOKEN" \
  https://wifi.skynity.org/api/radius/enable
```

At this point:
- RADIUS has every user's password + bandwidth profile.
- MikroTik still authenticates locally — **nothing has changed for
  customers yet**.

### Step 3 — Dry-run on a single test account

Create a spare PPPoE secret, e.g. `p-radius-test`, both on the MikroTik
**and** via the normal Skynity order flow so it ends up in RADIUS.

On the MikroTik (one specific interface only, not the whole PPP server):

```routeros
/ppp profile add name=radius-test use-radius=yes
/interface pppoe-server server set <server-name> default-profile=radius-test
```

Dial in with that credential. Watch `radpostauth` for the Access-Accept.

### Step 4 — Flip PPPoE for everyone (T–0, step B)

```routeros
/import file-name=skynity-radius.rsc
```

This is **atomic enough** for live sessions: sessions in progress keep
running on their existing auth state. Only **new** auths go to RADIUS.
No session is kicked by this command.

### Step 5 — Verify for 15 minutes

```bash
watch -n 5 '
  curl -s -H "Authorization: Bearer $TOKEN" \
    https://wifi.skynity.org/api/radius/online | jq ".count"
'
```

You should see the count climbing as sessions expire + reauth on their
own (PPPoE keepalives + MikroTik's default PPP session-timeout). If
anything looks wrong, roll back:

```routeros
/ppp aaa set use-radius=no accounting=no
/radius remove [find comment~"skynity:radius"]
```

### Step 6 — (Optional) force a mass reauth

Only after you are **sure** RADIUS is working:

```bash
# Force-drop everyone — MikroTik will reauth through RADIUS on next frame
curl -X POST -H "Authorization: Bearer $TOKEN" \
  https://wifi.skynity.org/api/radius/queue/drain
```

Or straight from RouterOS:

```routeros
/ppp active remove [find]    # DANGEROUS at peak hours
```

### Step 7 — Retire local users (T+7 days)

After a week on RADIUS, you can delete the `/ppp secret` rows from the
MikroTik — RADIUS is the source of truth from here. Skynity's
`provisioning.js` will keep calling `createPppSecret` during the
transition so **don't delete them yet** unless you also set
`feature.skip_local_user_create = true` (future feature).

---

## 6. Security model

- **Shared secrets** are stored plaintext in two places: the
  `mikrotik_routers.radius_secret` column (Skynity's copy) and the
  `nas.secret` column (FreeRADIUS's copy). Both live in the same DB,
  and MySQL credentials are already a critical asset in this system.
  If you want encryption-at-rest, wrap `mikrotik_routers.radius_secret`
  in the existing `encrypt()` helper (`backend/src/utils/crypto.js`);
  the FreeRADIUS side **must** remain plaintext because FreeRADIUS
  reads it directly.
- **NAS ACL** — FreeRADIUS only honours requests from clients listed
  in `nas`. Unknown source IPs are dropped at the RADIUS level. This
  is in addition to the firewall rules at the host.
- **CoA** — only originated by the backend, which authenticates itself
  to the NAS by signing the packet with the router-specific shared
  secret. Disable globally with `radius.coa_enabled = false`.
- **Message-Authenticator** — FreeRADIUS rejects packets without it
  when `require_message_authenticator` is on; we leave it off for
  MikroTik compatibility (MikroTik doesn't always emit it for Hotspot
  service). Re-enable per-client by editing `raddb/clients.conf`
  after you've confirmed your RouterOS version sends it.

---

## 7. Scaling & HA

### Multi-router (multi-NAS)

Already supported: every MikroTik gets its own `nas` row with its own
shared secret. The load-balancer picks the target router for a new
subscription (`provisioning.pickRouterForNewSubscription`) and the
RADIUS side is a single pool — any NAS can auth any user, so the
load-balancer decision is what determines which router the customer's
traffic terminates on.

### Load-balancing RADIUS itself

Put two FreeRADIUS containers behind a UDP load-balancer (haproxy-udp,
Hetzner LB, or DNS round-robin).  They can share the same MySQL and
remain consistent:

```
  mikrotik A ─┐               ┌─ freeradius-1 ─┐
              ├─▶  UDP-LB  ──▶┤                ├──▶  MySQL
  mikrotik B ─┘               └─ freeradius-2 ─┘
```

Both FreeRADIUS instances **must** share the same `nas` table. Shared
secrets are per-NAS, not per-FreeRADIUS, so no change there.

### MySQL HA

FreeRADIUS opens its own connection pool (see `pool { start=2 max=16 }`
in `mods-available/sql`). Point the container at a MySQL replica /
Galera cluster by changing the `DB_HOST` env var — no code change.

---

## 8. Troubleshooting

| Symptom                                                                 | Fix |
|-------------------------------------------------------------------------|-----|
| FreeRADIUS logs: `Client packet from unknown client`                    | `nas` row missing or `radius_nas_ip` doesn't match the source IP MikroTik uses. Check with `tcpdump -n udp port 1812 -i eth0`. |
| FreeRADIUS logs: `rlm_sql_mysql: Couldn't connect`                      | `DB_HOST`, `DB_USER`, `DB_PASSWORD` env vars on the `freeradius` service are wrong — fix in `.env` and `docker compose up -d freeradius`. |
| Auth works but rate-limit isn't applied                                 | The package has no `radius_group`; re-push with `POST /api/radius/groups/<id>`. |
| "reply":"Access-Reject","pass":"skynity:expired"                        | Expected — the subscription has expired and the backend inserted `Auth-Type := Reject`. Extend the subscription to clear it. |
| CoA always times out                                                    | MikroTik `/radius incoming accept=yes` is off; firewall blocks UDP/3799 from VPS to MikroTik. |
| Subscriptions stuck at `radius_synced = 0`                              | Read `subscriptions.radius_error` and `/api/radius/log`. Most common cause: `packages.radius_group` unset and derived name exceeded 64 chars. |
| After a password change, customer can't connect                         | `POST /api/radius/users/<subId>` to force a re-push. |

---

## 9. Roadmap

- [ ] Encrypt `mikrotik_routers.radius_secret` at rest and decrypt
      once when writing `nas.secret`.
- [ ] Add the Admin UI surface (currently RADIUS is API-only — works
      fine but power-users want buttons).
- [ ] Quota enforcement via `Acct-Interim-Interval` deltas — when a
      subscription exceeds its monthly quota, swap its `radusergroup`
      to `PKG_THROTTLED` for the rest of the month.
- [ ] CoA on package change — fire a `Mikrotik-Rate-Limit` change-of-
      authorization instead of a full disconnect.
