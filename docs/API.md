# API testing guide

Base URL: **http://localhost:3000/api**. OpenAPI 3.0.3 is available as `docs/openapi.json` and `/api/openapi.json`. Import it into Postman or Insomnia. This is JSON REST plus background events; there is no GraphQL API.

## Endpoint inventory

| Method | Path (after `/api`) | Authentication | Purpose |
|---|---|---|---|
| POST | `/auth/register` | Public | Create account and token |
| POST | `/auth/login` | Public | Issue token |
| GET | `/auth/me` | Bearer | Current account |
| POST | `/auth/logout` | Bearer | Revoke current token |
| GET | `/products` | Public | Search, filter, sort, paginate |
| GET | `/products/{productId}` | Public | Authoritative product detail |
| GET | `/inventory` | Public | Available stock by product ID |
| GET | `/cart` | Bearer | Current account's cart |
| PUT | `/cart` | Bearer | Replace entire cart |
| GET | `/orders` | Bearer | Own orders, newest first |
| POST | `/orders` | Bearer + Idempotency-Key | Accept checkout |
| GET | `/orders/{orderId}` | Bearer | Own order and state history |
| GET | `/payments/{orderId}` | Bearer | Payment for own order |
| GET | `/lab/config` | Public/local QA | Read scenario configuration |
| POST | `/lab/config` | Public/local QA | Patch scenario configuration |
| POST | `/lab/defaults` | Public/local QA | Restore all scenario defaults |
| GET | `/lab/status` | Public/local QA | Health of six backend processes |
| GET | `/lab/events` | Public/local QA | Latest 100 mirrored events, newest first |
| GET | `/openapi.json` | Public | API specification |

Business requests use `Content-Type: application/json`. Protected requests use `Authorization: Bearer <token>`. No cookies are required. Error responses are JSON `{ "error": "..." }`.

### Search parameters

`GET /products?q=speaker&category=Audio&sort=price&page=1&limit=6`

- `q`: case-insensitive product-name substring; empty means all names.
- `category`: exact category match (`Audio`, `Workspace`, `Travel`, `Home`); unknown values produce an empty result.
- `sort=price`: ascending price; omitted/other values use seed order.
- `page`: positive integer, default 1.
- `limit`: integer 1–50, default 6.
- Result: `{ "items": [...], "total": 9, "page": 1, "limit": 6 }`. Total is the filtered total, not just the page size.

## End-to-end PowerShell example

Run the app first. This example purchases one headphone at baseline settings. On a fresh lab, repeat purchases eventually exhaust stock; reset data or use another product as needed.

```powershell
$baseUrl = 'http://localhost:3000/api'

# Reset scenario settings; business data remains intact
Invoke-RestMethod "$baseUrl/lab/defaults" -Method Post -ContentType 'application/json' -Body '{}'

# Login
$loginBody = @{ email='qa@example.com'; password='Testing123!' } | ConvertTo-Json
$session = Invoke-RestMethod "$baseUrl/auth/login" -Method Post -ContentType 'application/json' -Body $loginBody
$authHeaders = @{ Authorization="Bearer $($session.token)" }

# Search and check current availability
Invoke-RestMethod "$baseUrl/products?q=headphones"
Invoke-RestMethod "$baseUrl/inventory"

# Replace cart
$cartBody = @{ items=@(@{productId='p1';quantity=1}) } | ConvertTo-Json -Depth 10
Invoke-RestMethod "$baseUrl/cart" -Method Put -Headers $authHeaders -ContentType 'application/json' -Body $cartBody

# Capture exact checkout body and idempotency key for safe retries
$checkoutBody = @{
  address=@{name='Alex Tester';line1='12 Test Avenue';city='Sarajevo';postalCode='71000';country='BA'}
  paymentMethod='test-card'
  coupon='SAVE10'
  expectedTotal=12310
} | ConvertTo-Json -Depth 10 -Compress
$checkoutKey = [guid]::NewGuid().ToString()
$checkoutHeaders = @{ Authorization="Bearer $($session.token)"; 'Idempotency-Key'=$checkoutKey }
$order = Invoke-RestMethod "$baseUrl/orders" -Method Post -Headers $checkoutHeaders -ContentType 'application/json' -Body $checkoutBody
$order.id

# Poll until terminal. Use a deadline in a real automated test.
$deadline = (Get-Date).AddSeconds(15)
do {
  Start-Sleep -Milliseconds 250
  $order = Invoke-RestMethod "$baseUrl/orders/$($order.id)" -Headers $authHeaders
} while ($order.status -notin @('confirmed','cancelled','rejected') -and (Get-Date) -lt $deadline)
$order | ConvertTo-Json -Depth 10

# Verify payment and resulting stock
Invoke-RestMethod "$baseUrl/payments/$($order.id)" -Headers $authHeaders
Invoke-RestMethod "$baseUrl/inventory"

# Replay the exact same request: original order, no second charge
$replayed = Invoke-RestMethod "$baseUrl/orders" -Method Post -Headers $checkoutHeaders -ContentType 'application/json' -Body $checkoutBody
$replayed.id -eq $order.id

# Inspect events correlated to the order
Invoke-RestMethod "$baseUrl/lab/events" | Where-Object orderId -eq $order.id
```

## Combine UI and API

Sign in through the browser, then use the same email/password in an API client to obtain another session for the same customer. Both sessions share the saved cart and order list. Create the cart through `PUT /cart`; reopen the browser bag after refreshing/signing in to load current server state. Place an order in the UI and read its ID from the order article's `data-order-id` or the `/orders` response. Assert its payment, stock and events through the API.

The UI does not continuously synchronize carts changed by another session. A browser reload or sign-in reloads it; checkout also detects a server cart changed while catalog lookups were in flight.

## Configure failures

```powershell
# Decline the next payments (persists until changed)
Invoke-RestMethod "$baseUrl/lab/config" -Method Post -ContentType 'application/json' -Body '{"paymentMode":"decline","duplicateEvents":true}'

# Pause inventory, create orders, then resume processing
Invoke-RestMethod "$baseUrl/lab/config" -Method Post -ContentType 'application/json' -Body '{"pauseInventory":true}'
Invoke-RestMethod "$baseUrl/lab/config" -Method Post -ContentType 'application/json' -Body '{"pauseInventory":false}'

# Create short-lived sessions by logging in again after this call
Invoke-RestMethod "$baseUrl/lab/config" -Method Post -ContentType 'application/json' -Body '{"sessionSeconds":2}'

# Return settings to baseline
Invoke-RestMethod "$baseUrl/lab/defaults" -Method Post -ContentType 'application/json' -Body '{}'
```

See BACKEND.md for every setting and range. QA settings are global; tests running concurrently can interfere unless they use separate lab instances.

## Response semantics and negative cases

| Scenario | Expected |
|---|---|
| Malformed/non-object JSON | 400 |
| Too-large JSON body | 413 |
| Invalid login or expired/absent token | 401 |
| Invalid registration/cart/address/coupon/method | 422 |
| Duplicate email | 409 |
| Expected total mismatch | 409; cart retained, no new order |
| Same key and exact request | 200 and original order |
| Same key, different request | 409 |
| New valid checkout | 202 and intermediate order |
| Own order ID not found, or another customer's order/payment | 404 |
| Scenario request allowance exceeded | 429 and `Retry-After` |
| Gateway cannot reach a dependency | Usually 503; inspect service health |

Stock failure is an asynchronous **business outcome**, not an HTTP checkout validation failure: POST may return 202, followed by `rejected`. A declined payment similarly becomes `cancelled` after compensation. A payment lookup returns `{orderId,status:'pending'}` until a payment record exists; a stock-rejected order never creates one, so use order state to decide final outcome.

## Event testing

Use `/lab/events` for business-event correlation in either transport. In local mode a synthetic redelivery record has `originalId`. In Kafka mode literal duplicate event IDs are deduplicated in the mirror, so use Kafka consumer tooling for transport-level duplicate assertions and offsets. The mirror is an audit convenience, not a complete Kafka administration API.

The internal broker also exposes `/events?after=<seq>`, `/events` POST, `/recent`, `/config` and `/health` directly on port 4100 in Node mode. These trusted internal routes are outside the gateway OpenAPI contract and intentionally are not published as host ports in Docker mode.
