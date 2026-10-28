# FORMA — QA Commerce Lab

A local e-commerce testing ground for QA engineers. Browse products, manage a shopping bag, place simulated orders, test REST APIs and explore asynchronous microservice communication.

The QA laboratory lets you change locator behavior, add delays, expire sessions, pause consumers, decline payments and introduce duplicate event deliveries. Products, addresses and payments are fictional.

This repository contains the **application and its documentation**. Playwright automation and its CI configuration will live in a separate repository.

![FORMA storefront](docs/screenshots/storefront.png)

## Choose how to run it

| Mode | Install on your computer | Messaging | Best for |
|---|---|---|---|
| **Docker + Kafka (recommended)** | Git and Docker with Compose | Real Apache Kafka | Complete microservices and event scenarios |
| **Node only** | Git and Node.js 24.15+ in the Node 24 line | Built-in durable local broker | Quick UI/API practice without Docker |

Downloading the repository ZIP is an alternative to Git. Both modes use **http://localhost:3000**; run only one mode at a time.

**You do not need to install Kafka, Java, ZooKeeper, PostgreSQL or SQLite separately.** Docker downloads Kafka and starts the services. Node-only mode uses Node's built-in SQLite support and does not run Kafka.

## Option A: Docker + real Kafka

### 1. Install prerequisites

- Git, or download this repository's ZIP.
- Windows/macOS: install and start [Docker Desktop](https://docs.docker.com/desktop/). On Windows use **Linux containers** with the **WSL 2 backend**; complete Docker Desktop's WSL setup if prompted.
- Linux: install [Docker Engine](https://docs.docker.com/engine/install/) and the [Docker Compose plugin](https://docs.docker.com/compose/install/).
- Internet access for the first image download/build.
- Free ports **3000** (storefront/API) and **19092** (Kafka development listener).

Node.js and npm are **not required on the host** for this option. They run inside the containers. Databases and Kafka topics are created automatically.

Start Docker and wait for its engine, then check in PowerShell or Terminal:

```sh
docker version
docker compose version
```

`docker version` must show a responding **Server**, not just Client information. Resolve engine connection/access errors before proceeding.

### 2. Clone the application

```sh
git clone https://github.com/TomasevicJovan/qa-commerce-lab.git
cd qa-commerce-lab
```

For a ZIP download, extract it and open a terminal in the folder containing `compose.yaml`.

### 3. Build and start

```sh
docker compose up --build -d --wait --wait-timeout 180
docker compose ps
```

The first run takes longer while images and dependencies download. Wait for startup to finish. The stack includes Kafka, a control/event-audit service, a gateway, and Identity, Catalog, Orders, Inventory and Payments services. Each application service owns its data. No manual topic creation, database installation or environment file is required.

### 4. Open the app

- Storefront: **http://localhost:3000**
- QA laboratory: **http://localhost:3000/#lab**
- OpenAPI specification: **http://localhost:3000/api/openapi.json**
- Service status: **http://localhost:3000/api/lab/status**

In the QA laboratory, confirm **KAFKA TRANSPORT** and healthy services.

| Demo email | Demo password |
|---|---|
| `qa@example.com` | `Testing123!` |

You can register fictional customers through the sign-in dialog. Use separate browser profiles or incognito windows for two-customer scenarios.

### 5. Try a purchase

1. Sign in, add a product to the bag and continue to checkout.
2. Keep the fictional shipping details and choose a test payment method. Do not enter real card information.
3. Optionally use `SAVE10` for a 10% discount.
4. Place the order and open **My orders**. It should eventually become **confirmed**.
5. Open **QA laboratory** and inspect the events:

```text
OrderPlaced → InventoryReserved → PaymentApproved → OrderConfirmed
```

HTTP 202 means accepted for processing, not already paid. Select **Payment failure**, then place another order to see cancellation and stock restoration. Choose **Restore baseline** afterward.

### Stop, restart and inspect logs

```sh
# Stop containers; retain saved data
docker compose down

# Restart using saved users, orders, stock and settings
docker compose up -d --wait --wait-timeout 180

# Follow service logs; Ctrl+C leaves containers running
docker compose logs -f orders inventory payments

# Inspect Kafka startup/connection issues
docker compose logs --tail 100 kafka
```

After pulling source changes, rebuild using `docker compose up --build -d --wait --wait-timeout 180`.

### Reset Docker data

**Restore baseline** changes QA settings only. It does not remove orders or replenish stock.

For a completely fresh lab, these commands **delete this Compose project's saved data**, including users, orders, stock and Kafka events, then reseed the app:

```sh
docker compose down --volumes
docker compose up --build -d --wait --wait-timeout 180
```

Use this only when you intend to start fresh, for example to repeat the last-unit challenge. Keep service databases and Kafka in the same timeline; do not selectively delete one service's data.

## Option B: Node only, without Docker or Kafka

Install [Node.js](https://nodejs.org/) **24.15 or newer in the Node 24 line**, which includes npm and the SQLite API used here. Clone the repository as above, then run from its root:

```sh
node --version
npm start
```

No `npm install` is needed for this default mode. KafkaJS is loaded only in Kafka mode. Open **http://localhost:3000** and use the same demo login. Windows users can also double-click `start.cmd`.

Keep the terminal open. **Ctrl+C stops all application processes.** The QA panel should show **LOCAL TRANSPORT**. Checkout remains asynchronous, using a durable SQLite-backed local broker instead of Kafka.

Node mode saves data in `data/`; Docker uses separate named volumes. Switching modes does not transfer users or orders. Stop one mode before starting the other.

To reset Node-mode data, first stop the app:

```sh
npm run reset
npm start
```

Reset preserves the previous data in a timestamped backup and seeds fresh records on startup. It refuses to run while expected service ports are active.

For advanced host/container configuration, see [Backend](docs/BACKEND.md). The full Docker stack is the easiest way to use Kafka; setting an environment variable alone does not start a broker.

## What you can practice

- UI: repeated button names, contextual locators, dynamic IDs, replaced DOM nodes, debounced search, rendering delays, pagination, modal forms and responsive layout.
- API: registration/login, bearer sessions, products, carts, orders, payments, validation, authorization and rate limiting.
- Business rules: discounts, shipping boundaries, authoritative prices, idempotent retries and competing for limited stock.
- Events: order transitions, paused consumers, duplicate deliveries, payment compensation and service recovery.

Frontend: native JavaScript/CSS. Backend: independent Node.js HTTP processes with service-owned SQLite databases. Docker messaging: Apache Kafka through KafkaJS. No real payment provider is involved.

## Documentation

| Guide | Contents |
|---|---|
| [Business rules and critical flows](docs/BUSINESS.md) | Pricing, state machine, checkout, stock races and acceptance criteria |
| [Backend](docs/BACKEND.md) | Services, persistence, event contracts, Kafka, outbox/inbox and configuration |
| [Frontend](docs/FRONTEND.md) | Routes, state, UI behavior, locator modes and responsive design |
| [API guide](docs/API.md) | Endpoints, PowerShell examples and response behavior |
| [OpenAPI](docs/openapi.json) | Importable contract for Postman/Insomnia |
| [Challenge catalogue](docs/CHALLENGES.md) | UI, API and distributed-system exercises |

## Ports and data

| Component | Docker mode | Node-only mode |
|---|---|---|
| Storefront and gateway | localhost:3000 | localhost:3000 |
| Kafka listener for host tools | localhost:19092 | Not running |
| Control/event audit | Private container network | localhost:4100 |
| Identity / Catalog / Orders / Inventory / Payments | Private container network | localhost:4101–4105 |
| Saved data | Docker named volumes | `data/` directory |

Published ports bind to loopback. The lab is for local use: QA controls are deliberately global and unauthenticated. Do not expose it publicly or enter real customer information.

## Troubleshooting

| Problem | What to check |
|---|---|
| Docker cannot reach its engine | Start Docker Desktop, wait for readiness and check `docker version` in a terminal with Docker access. |
| Windows image compatibility errors | Use Linux containers and complete WSL 2 setup in Docker Desktop. |
| Port 3000 or 19092 already allocated | Stop another lab/server. Do not run both startup modes simultaneously. |
| Startup times out or a service is unhealthy | Inspect `docker compose ps` and `docker compose logs --tail 100`. Check Docker resources and build/download errors. |
| Orders remain pending | Resume paused inventory/payment consumers in the QA panel. |
| Failed payment has not restored stock | Compensation also needs Inventory running. Check order history and events. |
| Checkout reports changed prices | Restore baseline, reload the collection and reopen the bag. |
| API returns 429 | Disable the rate-limit scenario or wait for its 10-second window. QA controls remain available. |
| Sessions expire immediately | Restore baseline and sign in again; lifetime changes affect new tokens. |
| Node reports a SQLite/runtime error | Check `node --version`; use the documented Node 24 runtime. |
| Orders differ between Docker and Node | Expected: these modes have separate data stores. |

For source changes, `npm run check` checks syntax and `npm run spec` regenerates the API specification. Automated tests and CI for the future automation project are kept outside this repository.
