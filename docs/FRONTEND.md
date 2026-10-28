# Frontend engineering guide

## Design and runtime

The browser frontend is a responsive, intentionally polished fictional store called FORMA. It uses native ES modules, HTML and CSS. There is no build step, CDN, external font, external image or third-party runtime dependency. Product illustrations are simple typographic/CSS objects. JavaScript is served by the gateway at the same origin as the API.

The framework-free approach keeps DOM behavior visible to QA engineers and allows the baseline to run without package installation. Browser automation will be maintained in a separate repository; no browser test tooling is required to run this application.

| File | Responsibility |
|---|---|
| `public/index.html` | Environment banner, navigation, main mount, shared modal and toast |
| `public/style.css` | Tokens, store layout, forms, dialogs, QA panel and responsive breakpoints |
| `public/app.js` | API wrapper, route rendering, session/cart state, checkout and QA interactions |

## Routes

| Hash route | View |
|---|---|
| `#shop` or empty | Product collection |
| `#orders` | Customer orders with status histories |
| `#lab` | Scenario controls, service health and latest 100 mirrored events |

Hash routing needs no server-side route fallback. Navigation closes the shared dialog. Unknown hash routes fall back to the collection. The account and bag controls are available from every page.

## State and API integration

- `token` is persisted in sessionStorage under `qa-token`. The user profile is reloaded with `/auth/me` on startup. Session storage is per browser context/tab lineage, not a multi-account store.
- Cart contents are authoritative on the server. The frontend loads `/cart` on sign-in and replaces it with `PUT /cart` after each change.
- `catalog` caches viewed products to render carts spanning pages. `/inventory` supplies current available units. Product-list prices may intentionally be stale in the relevant scenario.
- Search text, category, sort and page are view state. Search waits 350 ms after typing; category/sort changes reset page one.
- Requests use same-origin fetch and bearer authorization. A 401 clears local authentication. Other errors display as toasts or form messages.
- Render request counters and view versions discard stale responses when a search or navigation supersedes them. Product cards are rebuilt with `innerHTML`, intentionally replacing their DOM nodes.
- Orders and lab observations poll every two seconds while the document is visible. Order polling pauses while a dialog is open. Lab polling updates observations without overwriting unsaved scenario form edits.

## Interaction flows

### Authentication

The account button opens a native modal `<dialog>` with login or registration forms. The demo login is prefilled. Native browser validation handles basic email/required/minlength checks; the backend remains authoritative. Successful login loads the server cart and updates the header. Sign-out revokes the current token and clears local cart state.

### Collection and shopping bag

The collection requests up to six products, inventory and configuration in parallel. Skeletons remain visible until the response and configured rendering delay complete. Every card has a repeated `Add to bag +` button. Sold-out buttons are disabled at render time. The bag dialog shows quantity controls; reducing to zero removes that line. Quantity updates are saved through the API, and server errors do not silently overwrite the local cart.

### Checkout

Checkout uses fictional prefilled shipping details and a native test payment selector. Client totals use the same documented cent-based formula as the backend, which independently validates the result. The coupon input trims and uppercases the code. The submit button is disabled during a request. An idempotency key is retained for retries within the checkout attempt; changing the coupon rotates it. The backend owns final deduplication.

HTTP acceptance clears the visible bag and opens My orders. The browser polls status; it does not assume 202 means confirmed. Failed validation keeps checkout open and shows the backend message. A price mismatch asks the tester to close checkout, refresh the collection, and reopen the bag. If the browser loses a response after acceptance, inspect My orders or use the API with the original key/body; the UI does not persist an entire retry request across a reload.

### QA laboratory

The settings form patches global configuration only when Apply scenario is clicked. Presets first restore defaults, then apply their chosen settings. Restore baseline leaves users, orders, stock and event history intact. All browser sessions share settings, so coordinate parallel testers or use separate complete lab instances.

## Locator contracts and intentional challenges

| Target | Stable mode | Dynamic mode |
|---|---|---|
| Product card | `data-testid="product-p1"` | test ID omitted; generated class added |
| Add button | `id="add-p1"`, `data-testid="add-p1"` | generated UUID in ID; test ID omitted |
| Product identity | named article, heading, `data-product` | remains available for context |
| Button name | `Add to bag +` on every card | same repeated name |
| Order status | `data-testid="order-status"` scoped to order | unchanged |

Dynamic identifiers change on **rerender**, not continuously on a timer. Live locators should re-query after search, sorting, filtering or navigation. Cached DOM element handles can become detached. Semantic labels intentionally remain available so challenges can be solved robustly rather than by guessing UUIDs.

Example Playwright locators:

```js
// Stable mode
page.getByTestId('product-p1').getByRole('button', { name: 'Add to bag +', exact: true });
// Works in either locator mode
page.getByRole('article', { name: 'Arc Wireless Headphones', exact: true })
    .getByRole('button', { name: 'Add to bag +', exact: true });
// Scope a repeated status to the correct order
page.locator(`[data-order-id="${orderId}"]`).getByTestId('order-status');
// Native labeled form control
page.getByLabel('Discount code');
```

This version includes pagination, debounced search, delayed rendering, repeated labels, dynamic attributes, replaced nodes, native dropdowns and modal forms. It does not yet include virtual scrolling, shadow DOM, iframe checkout, custom date pickers or drag-and-drop. Those are sensible future challenge modules, not hidden existing features.

## Accessibility and responsive behavior

Navigation is named, buttons and inputs have labels, cards are named articles, dialogs use native modal behavior, error areas use alerts, and toasts use a live status region. No UI state relies on hover alone. Desktop uses three product columns; screens below 600 px use two and stack the hero/header. Focus outlines are retained. Native dialogs provide focus containment and Escape behavior.

Browser validation checked a 1440 px desktop and a 390 px mobile viewport with no horizontal overflow. This is a layout check rather than a full accessibility audit. Use keyboard-only and screen-reader passes as additional exercises.

## Extending the frontend

1. Add new server behavior and update its API contract first.
2. Add a view/control in `app.js` and visual styles in `style.css`.
3. Escape API-provided text with `esc` before inserting HTML; prefer textContent when possible.
4. Retain semantic names in challenging modes so tests can use meaningful context.
5. Add a challenge description and critical-flow rule when behavior affects business results.
6. Exercise the result through Playwright, including a narrow viewport.

The API specification generator and frontend do not share business-total implementation at runtime; tests verify that their outputs agree for documented examples. Avoid introducing floating-point dollar calculations in either layer.
