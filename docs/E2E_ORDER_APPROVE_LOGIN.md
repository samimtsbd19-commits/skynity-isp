# E2E Test: Order -> Approve -> Login

This runbook verifies the full customer flow:

1. Customer places order from portal
2. Customer submits payment (trx id)
3. Admin approves order
4. Subscription credentials are generated
5. RADIUS/Hotspot login can be tested with generated credentials

## Prerequisites

- Deployed stack is running on VPS
- Public portal works: `https://wifi.skynity.org/portal`
- Admin works: `https://admin.skynity.org`
- API works: `https://api.skynity.org/api/portal/packages`
- At least one active hotspot package exists
- Router + RADIUS are already configured

## Step 0: Set variables (VPS shell)

```bash
export BASE="https://wifi.skynity.org/api"
export ADMIN_BASE="https://admin.skynity.org/api"
export TEST_PHONE="01700000000"
export TEST_NAME="E2E Test User"
export TEST_MAC="AA:BB:CC:DD:EE:11"
```

## Step 1: Pick one package code

```bash
curl -s "$BASE/portal/packages" | jq
```

Copy one `code` value (example: `HS-7D-10M`) and set:

```bash
export PKG_CODE="HS-7D-10M"
```

## Step 2: Create order

```bash
curl -s -X POST "$BASE/portal/orders" \
  -H "Content-Type: application/json" \
  -d "{
    \"package_code\":\"$PKG_CODE\",
    \"full_name\":\"$TEST_NAME\",
    \"phone\":\"$TEST_PHONE\",
    \"mac\":\"$TEST_MAC\"
  }" | tee /tmp/e2e-order.json
```

Extract order code:

```bash
export ORDER_CODE="$(jq -r '.order_code' /tmp/e2e-order.json)"
echo "ORDER_CODE=$ORDER_CODE"
```

## Step 3: Submit payment proof

```bash
curl -s -X POST "$BASE/portal/orders/$ORDER_CODE/payment" \
  -H "Content-Type: application/json" \
  -d "{
    \"method\":\"bkash\",
    \"sender_number\":\"$TEST_PHONE\",
    \"trx_id\":\"E2E-$(date +%s)\"
  }" | jq
```

## Step 4: Admin login and get token

```bash
read -p "Admin username: " ADMIN_USER
read -s -p "Admin password: " ADMIN_PASS; echo

curl -s -X POST "$ADMIN_BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}" | tee /tmp/e2e-login.json
```

If response contains `"needs_2fa": true`, complete 2FA:

```bash
export SESSION_ID="$(jq -r '.session_id' /tmp/e2e-login.json)"
read -p "2FA code: " OTP_CODE

curl -s -X POST "$ADMIN_BASE/auth/login/2fa" \
  -H "Content-Type: application/json" \
  -d "{\"session_id\":\"$SESSION_ID\",\"code\":\"$OTP_CODE\"}" | tee /tmp/e2e-login2fa.json

export ADMIN_TOKEN="$(jq -r '.token' /tmp/e2e-login2fa.json)"
```

If 2FA is not enabled:

```bash
export ADMIN_TOKEN="$(jq -r '.token' /tmp/e2e-login.json)"
```

## Step 5: Find order id and approve

```bash
curl -s "$ADMIN_BASE/orders?status=payment_submitted&limit=100" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | tee /tmp/e2e-orders.json

export ORDER_ID="$(jq -r --arg C "$ORDER_CODE" '.orders[] | select(.order_code==$C) | .id' /tmp/e2e-orders.json | head -n1)"
echo "ORDER_ID=$ORDER_ID"
```

Approve:

```bash
curl -s -X POST "$ADMIN_BASE/orders/$ORDER_ID/approve" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq
```

## Step 6: Poll order status and credentials

```bash
for i in {1..10}; do
  echo "Check #$i"
  curl -s "$BASE/portal/orders/$ORDER_CODE" | tee /tmp/e2e-order-status.json | jq
  STATUS="$(jq -r '.status' /tmp/e2e-order-status.json)"
  if [ "$STATUS" = "approved" ]; then
    break
  fi
  sleep 2
done
```

Expected fields after approval:

- `.status = "approved"`
- `.subscription.login_username`
- `.subscription.login_password`

## Step 7: Hotspot login test (manual)

Use generated credentials on captive portal:

- `http://wifi.skynity/` (or hotspot DNS/IP)

Watch logs on VPS:

```bash
cd /root/skynity
docker compose logs -f --tail=120 freeradius backend
```

Success indicators:

- FreeRADIUS receives `Access-Request`
- Reply includes accept (or clear reject reason)

## Quick cleanup (optional)

If this was a pure test user/order, reject or suspend from admin panel afterwards.

