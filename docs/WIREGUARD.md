# 🔐 WireGuard VPN — MikroTik ↔ VPS Secure Tunnel

এই guide এ আমরা MikroTik router এবং VPS এর মধ্যে একটা **WireGuard VPN tunnel** setup করব, যাতে VPS MikroTik এ REST API দিয়ে access করতে পারে **কোনো public port expose না করে**।

## 🎯 Why WireGuard?

**Problem:** MikroTik এর REST API (www-ssl) public internet এ expose করা dangerous — brute force attack, 0-day exploits।

**Solution:** MikroTik একটা private VPN client হবে, VPS হবে server। MikroTik VPS এ "call" করবে, VPS direct access পাবে MikroTik এর private tunnel IP তে। MikroTik এর কোনো public port open রাখতে হবে না।

```
[Internet] ──❌── [MikroTik :443]      ← direct access blocked
                       ↕
[VPS (WG server 10.88.0.1)] ──encrypted tunnel── [MikroTik (WG client 10.88.0.2)]
                                                           ↕
                                              REST API accessible at 10.88.0.2:443
```

---

## Part A — VPS তে WireGuard Server

### 1. Install WireGuard

```bash
sudo apt update && sudo apt install -y wireguard qrencode
```

### 2. Key তৈরি করুন

```bash
cd /etc/wireguard
sudo wg genkey | sudo tee server_private.key | sudo wg pubkey | sudo tee server_public.key
sudo wg genkey | sudo tee client_mikrotik_private.key | sudo wg pubkey | sudo tee client_mikrotik_public.key
sudo chmod 600 /etc/wireguard/*.key
```

### 3. Server Config

```bash
sudo nano /etc/wireguard/wg0.conf
```

এই content দিন (key গুলো replace করুন):

```ini
[Interface]
Address = 10.88.0.1/24
ListenPort = 51820
PrivateKey = <SERVER_PRIVATE_KEY>  # cat /etc/wireguard/server_private.key
SaveConfig = false

# Enable IP forward (system-wide)
PostUp   = sysctl -w net.ipv4.ip_forward=1
PostDown = sysctl -w net.ipv4.ip_forward=0

# Peer: MikroTik
[Peer]
PublicKey = <MIKROTIK_CLIENT_PUBLIC_KEY>  # cat /etc/wireguard/client_mikrotik_public.key
AllowedIPs = 10.88.0.2/32
PersistentKeepalive = 25
```

### 4. Firewall & Enable

```bash
sudo ufw allow 51820/udp
sudo systemctl enable --now wg-quick@wg0
sudo wg show
```

Expected: `interface: wg0` with your pubkey, listening port 51820, peer listed but `latest handshake: (none)` — MikroTik এখনো connect করেনি, পরের step এ হবে।

---

## Part B — MikroTik এ WireGuard Client

### 1. MikroTik terminal এ:

```mikrotik
# WireGuard interface
/interface wireguard
add name=wg-vps listen-port=13231 private-key="<MIKROTIK_CLIENT_PRIVATE_KEY>"

# IP address on the tunnel
/ip address
add address=10.88.0.2/24 interface=wg-vps comment="WG to VPS"

# Peer = VPS
/interface wireguard peers
add interface=wg-vps \
    public-key="<SERVER_PUBLIC_KEY>" \
    endpoint-address=<YOUR_VPS_PUBLIC_IP> \
    endpoint-port=51820 \
    allowed-address=10.88.0.0/24 \
    persistent-keepalive=25s

# Firewall: allow WG interface to reach router services
/ip firewall filter
add chain=input action=accept in-interface=wg-vps comment="WG-VPS access to router" place-before=0
```

> Key গুলো replace করুন:
> - `<MIKROTIK_CLIENT_PRIVATE_KEY>` = VPS এর `cat /etc/wireguard/client_mikrotik_private.key`
> - `<SERVER_PUBLIC_KEY>` = VPS এর `cat /etc/wireguard/server_public.key`
> - `<YOUR_VPS_PUBLIC_IP>` = VPS এর public IP

### 2. Test the tunnel

**VPS থেকে:**
```bash
ping 10.88.0.2
sudo wg show  # latest handshake দেখাবে
```

**MikroTik থেকে:**
```mikrotik
/ping 10.88.0.1
```

Reply আসলে ✅ tunnel up।

---

## Part C — REST API শুধু Tunnel দিয়ে Limit করুন

এবার MikroTik এর REST API কে শুধু VPS (10.88.0.1) থেকে accept করতে set করুন:

```mikrotik
# API user শুধু WG network থেকে allow
/user set api-user address=10.88.0.0/24

# www-ssl শুধু WG থেকে
/ip service set www-ssl address=10.88.0.0/24
```

### VPS থেকে REST API test:

```bash
curl -k -u api-user:YOUR_PASSWORD https://10.88.0.2/rest/system/resource
```

JSON response পেলে ✅ sorted।

---

## Part D — `.env` Update

VPS এ backend এর `.env` update করুন:

```env
MIKROTIK_HOST=10.88.0.2          # ← tunnel IP
MIKROTIK_PORT=443
MIKROTIK_USERNAME=api-user
MIKROTIK_PASSWORD=your_strong_api_password
MIKROTIK_USE_SSL=true
MIKROTIK_REJECT_UNAUTHORIZED=false
```

Restart:

```bash
cd ~/skynity/skynity-isp/docker
docker compose restart backend
curl http://localhost:3000/health
```

Response এ `"mikrotik": { "status": "ok", ... }` দেখলে pipeline পুরো working।

---

## 🔧 Troubleshooting

### Tunnel up না
- VPS firewall: `sudo ufw status` → 51820/udp allowed?
- MikroTik peer endpoint সঠিক IP কিনা
- MikroTik থেকে `/ping 10.88.0.1` → timeout হলে key mismatch / firewall

### Tunnel up কিন্তু REST API ETIMEDOUT
- `/ip service print` → www-ssl address=10.88.0.0/24?
- `/user print` → api-user এর address=10.88.0.0/24?
- MikroTik firewall rule input chain এ wg-vps interface allowed কিনা

### Tunnel drops frequently
- `persistent-keepalive=25` দুই পাশেই আছে কিনা check করুন
- Starlink CGNAT এর জন্য outbound tunnel (MikroTik → VPS) use করা হচ্ছে — এটা ঠিক আছে
