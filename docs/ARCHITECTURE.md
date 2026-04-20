# Skynity ISP — Architecture

> **TL;DR** — MikroTik handles **packets**, VPS handles **everything else**.
> The VPS never carries customer traffic — so your VPS stays cheap even with
> thousands of subscribers.

---

## 🇧🇩 সহজ বাংলা

আপনার setup-এ **দুটো আলাদা অংশ** একসাথে কাজ করে:

```
┌───────────────────────┐          ┌────────────────────────┐
│      VPS (আপনার app)  │          │    MikroTik router     │
│  ─────────────────── │          │ ────────────────────── │
│  • Dashboard         │◀────────▶│  • PPPoE/Hotspot auth  │
│  • Database          │   API    │  • Packet forwarding   │
│  • Billing/orders    │   poll   │  • Queue/shaping       │
│  • Customer portal   │  ~5 min  │  • NAT / firewall      │
│  • Monitoring        │          │  • DHCP / DNS          │
│  • Notifications     │          │                        │
└───────────────────────┘          └────────────────────────┘
         ↑                                    ↑
         │ admin access only                  │ actual user traffic
         │                                    │ (Netflix, YouTube,
         │                                    │  game, browsing)
   Admin laptop                         Customer devices
```

### ইউজার বাড়লে কী হবে?

- **MikroTik**-এ চাপ বাড়ে
  - প্রতিটা PPPoE/Hotspot session router-এর RAM খায়
  - সবার traffic (সব bytes) router দিয়ে যায় — তাই CPU/throughput limit আসে
  - Firewall rules, queue tree — সব router এ process হয়
- **VPS**-এ চাপ বাড়ে না তেমন
  - প্রতি ৫ মিনিটে MikroTik থেকে ~১ KB metadata নেয়
  - Subscription-এর সংখ্যা বাড়লে DB তে row বাড়ে — এটা নগণ্য
  - ১০০ জন customer vs ১০০০ জন — VPS এর load প্রায় same

### VPS কি পুরো "data" handle করতে পারবে?

**না**, কারণ traffic routing hardware-level কাজ — ASIC/CPU দিয়ে প্রতি সেকেন্ডে
million packet process হয়। VPS-এ Linux kernel দিয়ে সেটা করতে গেলে throughput
অনেক কম হবে + latency বাড়বে।

তবে আপনি চাইলে **alternative**:
- MikroTik **CHR** (Cloud Hosted Router) — VPS-এ install করা software router।
  তাহলে VPS = MikroTik। কিন্তু তখন আপনার physical router-এ শুধু bridging/PPPoE
  client থাকবে, traffic VPS এ fly করবে — bandwidth bill অনেক বেড়ে যাবে।
  **Recommended না** ছোট ISP-র জন্য।

### Router-এর চাপ কমানোর উপায় (এই app-এ implemented)

1. **FastTrack** — established connections firewall / queue bypass করে
2. **PCQ queues** — per-user queue না বানিয়ে shared kernel queue
3. **Monitoring interval tune** — default ৫ min, চাইলে বাড়ানো যায়
4. **Multi-router load balance** — নতুন order কম load-এর router-এ যাবে

---

## 🇬🇧 English

### Data plane vs control plane

| | Data plane | Control plane |
|---|---|---|
| **Lives on** | MikroTik router | VPS (this app) |
| **Handles** | Actual packets — every byte of customer traffic | Business logic — billing, orders, portal, dashboard |
| **Scales with** | Router hardware (RAM, CPU, interface speed) | DB + VPS resources (tiny per customer) |
| **User impact** | Real-time: packet drops, lag | Delayed: stale metrics, slow dashboard |

### What the VPS does

- Serves the admin dashboard + public portal
- Stores subscriptions / customers / orders / payments in MySQL
- Talks to MikroTik via its REST API (create/delete/update users)
- Polls MikroTik every 5 min for CPU / RAM / bytes / neighbors
- Runs cron jobs: expiry, retries, notifications, issue detection
- Sends SMS / Telegram / WhatsApp / email

### What the VPS does **not** do

- Forward customer packets (MikroTik does)
- Authenticate each PPPoE/Hotspot login in real-time (MikroTik does)
- Enforce bandwidth queues (MikroTik does, via `/queue`)

### When to worry about router capacity

Rule of thumb for RouterOS:
- **RB750Gr3 / hEX** — up to ~100 concurrent PPPoE users @ 100 Mbps
- **RB1100 / RB5009** — up to ~500 users @ 1 Gbps
- **CCR 2004 / 2116** — 1000+ users, multiple Gbps
- **CHR on beefy VPS** — theoretical 1 Gbps+ but uses VPS bandwidth quota

### Monitoring the right thing

This is why the Skynity **Health page** tracks:
- `cpu-load` — if it's >75% sustained, you're near the router's limit
- `free-memory` vs `total-memory` — address lists + logs eat RAM fast
- `temperature` — hot router = throttling = dropped packets
- Ping loss from router — tells you if upstream is healthy
- SFP Rx/Tx power — catches degraded fibre before it dies

Acting on these BEFORE customers complain is why this app exists.

---

## Further reading

- RouterOS FastTrack:    https://help.mikrotik.com/docs/display/ROS/FastTrack
- PCQ explanation:       https://help.mikrotik.com/docs/display/ROS/Per+Connection+Queue
- CHR overview:          https://help.mikrotik.com/docs/display/ROS/Cloud+Hosted+Router
