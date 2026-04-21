---
name: ISP Network Architecture
description: Starlink ISP setup details, PCQ logic, load analysis, MikroTik model recommendations
type: project
originSessionId: b538d755-9caa-44c5-95b4-160c34872bc9
---
## Physical Setup
- **ISP:** Starlink satellite
- **Total bandwidth:** 350–450 Mbps (use 400 Mbps as planning figure)
- **Router:** MikroTik hEX (RB750Gr3) — RouterOS 7.22.1 — IP 192.168.50.1 — REST API port 80 (www service, no SSL)
- **Router interfaces:** ether1-WAN (Starlink CGNAT 100.98.172.x), bridge-Hotspot (10.5.50.0/24), ether4-LAN (192.168.40.0/24), ether5-Admin (192.168.50.0/24)
- **VPS:** 46.202.166.89 — Coolify — domain wifi.skynity.org — CANNOT reach MikroTik directly (Starlink CGNAT blocks inbound)
- **Access Points:** 2× Cudy AX3000 Wi-Fi 6 (bridge mode, connected to MikroTik)
- **Users:** 150 subscribers, each on 5 Mbps package
- **Location:** Bangladesh

## Data Plane (MikroTik handles everything)
```
Starlink → MikroTik → 2× AP → 150 Users
               ↑
         ALL packet routing, NAT, PCQ queuing, PPPoE termination
         VPS/Skynity backend does NOT touch user data packets
```

## Management Plane (VPS/Skynity)
- User provisioning (create PPP secret / Hotspot user on MikroTik via API)
- Billing, payments, orders
- Telegram bot notifications
- Monitoring (polls MikroTik every 5 min via REST API)
- Cron jobs: expiry, suspension auto-lift, usage snapshots

## PCQ Bandwidth Sharing Logic
- 150 users × 5 Mbps = 750 Mbps committed (intentional over-subscription)
- Starlink provides 400 Mbps real capacity
- PCQ guarantees 5 Mbps per user when all 150 are active (gets ~2.6 Mbps at full load)
- When fewer users active, idle bandwidth shared automatically

```
10 active:  400÷10  = 40 Mbps each  (burst)
50 active:  400÷50  = 8 Mbps each   (burst)
100 active: 400÷100 = 4 Mbps each   (near limit)
150 active: 400÷150 = 2.6 Mbps each (peak hour — rare)
```

## PCQ Settings in Skynity (need to update)
- `provisioning.pcq_total_download` → set to **400** (Mbps)
- `provisioning.pcq_total_upload` → set to **50** (Mbps, Starlink upload ~50-100)
- `provisioning.pcq_enabled` → true
- `provisioning.pcq_mode` → `per_user_equal`

## MikroTik Model Recommendations
| Model | PPPoE users | Verdict |
|-------|------------|---------|
| hAP ax³ | ~50 | Too small for 150 |
| RB4011 | ~300 | ✅ Good for 150 users |
| CCR1009 | ~500 | ✅✅ Professional |
| CCR2004 | ~2000 | ✅✅✅ Future-proof |

## Service Types
- **PPPoE:** wired users, username/password login, MikroTik PPP server
- **Hotspot:** Wi-Fi captive portal users, browser-based login
- Both supported in Skynity

## Suspension System (already works)
Presets: 30m, 1h, 6h, 12h, 1d, 3d, 7d, 30d, permanent, custom
Scheduler: `liftExpired()` runs every minute, auto-restores MikroTik user
File: `backend/src/services/suspensions.js`
