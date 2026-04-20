# 👑 Skynity Admin — Telegram Cheat Sheet

## 📋 Orders
| Command | What it does |
|---------|-------------|
| `/pending` | View all pending-approval orders with Approve/Reject buttons |

## 👥 Customers
| Command | What it does |
|---------|-------------|
| `/customers` | List last 20 customers |
| `/customers rahim` | Search by name, phone, or customer code |
| `/customer SKY-00001` | Full detail view of one customer (all subs, credentials) |
| `/customer 017XXXXXXXX` | Same — by phone |

## 🔌 Subscription Control
| Command | Example | What it does |
|---------|---------|-------------|
| `/suspend <login>` | `/suspend p8f3a2` | Disable on router + mark suspended |
| `/resume <login>` | `/resume p8f3a2` | Re-enable |
| `/renew <cust> <pkg>` | `/renew SKY-00001 PPPOE-10M-30D` | Extend subscription |
| `/active` | — | Who's currently online (PPPoE + Hotspot) |

## 📦 Packages
| Command | What it does |
|---------|-------------|
| `/packages` | List all packages |
| `/addpkg` | Add a package — 8-step guided wizard |

## 🛰 Routers
| Command | What it does |
|---------|-------------|
| `/routers` | List routers + live health check |
| `/addrouter` | Add a new router — 5-step guided wizard (password encrypted) |

## 📊 Stats
| Command | What it does |
|---------|-------------|
| `/stats` | Quick counters (pending, active, revenue) |
| `/today` | Today's summary with expiring-soon alerts |

## 💡 Customer Commands (also work for admins)
| Command | What it does |
|---------|-------------|
| `/start` | Welcome + main menu |
| `/buy` | Browse packages & purchase |
| `/mysubs` | View your own subscriptions |
| `/help` | Help text |

## 🎯 Typical Daily Workflow

**Morning:**
```
/today                           # see overnight orders
/pending                         # approve/reject each one
```

**During the day:**
- Telegram auto-notifies on each new paid order (with Approve/Reject buttons)
- Tap ✅ Approve — customer receives credentials instantly

**When a customer renews:**
```
/customer 017XXXXXXXX
/renew SKY-00042 PPPOE-10M-30D
```

**When a customer reports an issue:**
```
/customer 017XXXXXXXX            # see their subs
/active                          # are they online?
/suspend p8f3a2                  # force logout & disable
/resume p8f3a2                   # re-enable after fix
```

**Weekly ops:**
```
/stats                           # overall health
/routers                         # make sure all routers reachable
```
