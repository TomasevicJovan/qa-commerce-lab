# QA challenge catalogue

Start from baseline unless the exercise says otherwise. The QA panel is at `/#lab`. All settings are global and persistent. Restore baseline after each exercise; reset business data only when you need fresh stock/users/orders. No exercise requires real customer or payment information.

## Locator and synchronization exercises

| ID | Setup and action | Expected learning / assertion |
|---|---|---|
| UI-01 Repeated names | Add only the Orbit Desk Lamp while six identical add-button names exist | Scope the button to a named product article; bag contains p2 |
| UI-02 Dynamic IDs | Apply Locator challenge; capture an ID, then change sort/category | UUID IDs change after rerender; semantic/context locators still work |
| UI-03 Missing test IDs | Use dynamic mode | Product and add-button test IDs disappear; meaningful article/heading labels remain |
| UI-04 Detached elements | Save an element handle, then search or change category | Old card detaches; re-query with a locator rather than reusing stale handles |
| UI-05 Debounce | Type `speaker` quickly, then clear it | UI settles to matching cards after 350 ms and ignores stale responses |
| UI-06 Rendering delay | Set renderDelay=2500 and navigate to the collection | Skeletons appear; wait for the target element/state rather than fixed sleeps |
| UI-07 API latency | Set apiDelay=2000, then sign in and update bag | Loading/disabled submission behavior tolerates slow API responses |
| UI-08 Pagination | Browse the default nine items | Page 1 has six, page 2 has three; changing category resets page one |
| UI-09 Modal forms | Open bag, move to checkout, use Escape/backdrop | Dialog content is replaced; locate the currently visible form and preserve focus behavior |
| UI-10 Native validation | Empty a required address field or enter invalid registration data | Browser prevents obvious invalid submit; direct API tests still verify backend validation |
| UI-11 Responsive layout | Use 390 px width; browse, sign in and open the bag | No horizontal overflow; controls remain reachable without hover |
| UI-12 Keyboard journey | Use Tab, Enter and Escape through login/cart/checkout | Visible focus, label association, modal containment; record accessibility gaps |

Playwright example that survives both locator modes:

```js
const card = page.getByRole('article', { name: 'Orbit Desk Lamp', exact: true });
await card.getByRole('button', { name: 'Add to bag +', exact: true }).click();
await expect(page.locator('#cart-count')).toHaveText('1');
```

The dynamic challenge is intentionally solvable. Stable `data-product` values and semantic context remain available. The version does not include iframes, shadow roots or virtual scrolling; add those as separate future modules if needed.

## Business and API exercises

| ID | Setup and action | Expected result |
|---|---|---|
| API-01 Cart validation | PUT negative, zero, fractional, >10 quantities; duplicate product IDs | 422; original cart preserved |
| API-02 Catalog contract | Search/filter/sort; page=0 or limit=51 | Correct filtered totals and order; invalid numeric pagination returns 422 |
| API-03 Authentication | Login with bad password; GET cart without token | 401; no sensitive account detail |
| API-04 Ownership | A buys an item; B reads A's order and payment | Both lookups return 404 |
| API-05 Exact replay | Repeat checkout with same key and identical body | Original order ID, single payment and stock deduction |
| API-06 Key conflict | Reuse key with another coupon/address/body | 409; no second order |
| API-07 Empty cart | Place checkout with a new key and empty cart | 422 |
| API-08 Shipping boundary | Compare two lamps with and without SAVE10 | $158.00 with free shipping vs $149.20 including $7 shipping after discount |
| API-09 Price mismatch | Enable stalePrice, buy a list-priced item | 409 before mutation; cart retained |
| API-10 Coupons | SAVE10, EXPIRED, an unknown code | Valid discount, expired error, unknown error |
| API-11 Session expiry | Set sessionSeconds=2, sign in again, wait >2 s | Protected endpoints return 401; signing back in restores saved cart/orders |
| API-12 Rate limit | Enable rateLimit; exceed 12 requests in 10 s using one token | 429 with Retry-After; QA controls still work |
| API-13 Cross-origin guard | Send gateway request with Origin https://example.com | 403 |
| API-14 Server/client totals | Build cart by API, buy by UI, verify server total | Same cent-based result; browser assumptions do not override backend rules |

## Distributed-system exercises

### EVT-01: Last-unit competition

Fresh business data is required for the simplest reproduction. p6 starts with one unit. Use two customers and isolated browser contexts. Prepare both carts, then submit checkout in parallel. Both HTTP requests can be accepted, but exactly one order confirms, one rejects, stock ends at zero and the losing order has no payment record.

### EVT-02: Payment compensation

Set paymentMode=decline. Record starting stock, place an order and poll for `cancelled`. Verify `InventoryReserved → PaymentFailed → InventoryReleased` and stock restored exactly once. Repeat with paymentMode=timeout. Do not equate a 202 response with success.

### EVT-03: Duplicate deliveries

Enable duplicateEvents and place both successful and declined orders. Assert one payment per order, one stock decrement, and at most one compensation effect. Local audit shows synthetic redelivery entries; Kafka tooling shows repeated same-ID messages. Observe effects, not just event counts.

### EVT-04: Inventory backlog

Enable pauseInventory, then place several orders. Each remains pending and available stock is unchanged. Resume and verify all eventually settle according to current stock, without recreating orders.

### EVT-05: Held reservation

Enable pausePayments. Checkout reaches payment_pending and stock decreases. Another customer attempting the last reserved item should fail. Resume Payments and verify confirmation; alternatively switch paymentMode to decline before resuming and verify compensation.

### EVT-06: Compensation backlog

Enable a payment delay of 4000 and paymentMode=decline. After InventoryReserved appears, pauseInventory before the delayed payment fails. The order reaches compensating and units remain reserved. Resume Inventory; stock returns and status becomes cancelled. This demonstrates why compensation itself needs recovery.

### EVT-07: Service restart

In Kafka/Compose mode, stop only Inventory, place an order, restart Inventory and inspect consumer lag/order recovery. In direct Node mode, run individual services in separate terminals if you want to stop one manually; the all-in-one launcher shuts the run down if a child exits with a failure. Backend automated tests already exercise independent Inventory restart in local transport mode.

### EVT-08: Payment outcome changes while paused

Pause Payments with paymentMode=approve, create an order, change paymentMode to decline and resume. The payment declines because the setting is evaluated when handling starts. The setting is global, not snapshotted into the order. Compare that behavior with real systems where routing/configuration may be versioned per transaction.

### EVT-09: Event correlation

Create an order through the UI. Read `/orders` through an API session for the same customer. Filter `/lab/events` by orderId; assert required event types and order history. Use event IDs to distinguish attempts from effects. Do not treat audit sequence as a Kafka offset.

## Good automation practices to exercise

Prefer state-based waits with deadlines over arbitrary delays. Keep unique users/carts/keys per test. Preserve exact request bodies for idempotency retries. Poll for terminal business states; intermediate states may be short-lived. Restore global scenario configuration in test teardown. Use isolated complete lab instances for parallel scenario suites, because global failure toggles deliberately affect everyone. Treat expected intentional failures as assertions, not flaky tests to retry until green.
