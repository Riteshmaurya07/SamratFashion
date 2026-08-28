# API Reference

Base URL: `http://localhost:5000/api`

All responses follow the format:
```json
{
  "success": true | false,
  "message": "Description",
  "code": "ERROR_CODE",
  "errors": [],
  "data": { ... }
}
```

---

## Health & Observability (Phase 11B)

### `GET /api/health/live` (or `/health/live`)
Minimal liveness check. Always returns HTTP 200 OK. Does not check database or external APIs.

**Response (200):**
```json
{
  "status": "ok",
  "service": "samrat-fashion-backend",
  "timestamp": "2026-08-29T00:00:00.000Z"
}
```

### `GET /api/health/ready` (or `/health/ready`)
Readiness check verifying database connection.

**Response (200 - Ready):**
```json
{
  "status": "ready",
  "database": "connected",
  "service": "samrat-fashion-backend"
}
```

**Response (503 - Unavailable):**
```json
{
  "status": "unavailable",
  "database": "disconnected",
  "service": "samrat-fashion-backend"
}
```

### `GET /api/admin/diagnostics`
Admin-only system status panel (`requireAuth` + `ADMIN`/`SUPER_ADMIN`).

**Response (200 - Admin Only):**
```json
{
  "status": "HEALTHY",
  "database": "CONNECTED",
  "paymentProvider": "HEALTHY",
  "logisticsProvider": "HEALTHY",
  "emailProvider": "HEALTHY",
  "requestId": "req_123456789"
}
```


---

## Auth Routes

| Method | Route | Rate Limit | Auth | Description |
|--------|-------|-----------|------|-------------|
| POST | `/api/auth/register` | 10 req/15min | Public | Register new customer |
| POST | `/api/auth/login` | 10 req/15min | Public | Login |
| POST | `/api/auth/refresh` | None | Public | Refresh access token |
| POST | `/api/auth/logout` | None | Public | Logout (invalidate session) |
| GET | `/api/auth/me` | None | Required | Get current user |
| POST | `/api/auth/forgot-password` | 3 req/hr | Public | Request password reset |
| POST | `/api/auth/reset-password` | 3 req/hr | Public | Reset password with token |

### `POST /api/auth/register`

**Body:**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "phone": "9876543210",
  "password": "SecurePass123"
}
```

Password must have: min 8 chars, 1 uppercase, 1 lowercase, 1 digit.

### `POST /api/auth/login`

**Body:**
```json
{
  "email": "john@example.com",
  "password": "SecurePass123"
}
```

**Response:** Sets refresh token as HTTP-only cookie. Returns access token in body.

### `POST /api/auth/refresh`

Uses the refresh token from HTTP-only cookie. Returns new access token.

### `POST /api/auth/logout`

**Auth:** Required (but works without — clears cookie regardless)

### `GET /api/auth/me`

**Auth:** Required (`Authorization: Bearer <token>`)

### `POST /api/auth/forgot-password`

**Body:** `{ "email": "john@example.com" }`

### `POST /api/auth/reset-password`

**Body:**
```json
{
  "token": "reset_token_from_email",
  "newPassword": "NewSecurePass123"
}
```

---

## Catalog Routes (Public)

All catalog routes are public — no authentication required.

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/catalog/homepage` | Homepage aggregation (trending products) |
| GET | `/api/catalog/categories` | List all categories |
| GET | `/api/catalog/categories/:slug` | Category by slug |
| GET | `/api/catalog/themes` | List all themes |
| GET | `/api/catalog/themes/:slug` | Theme by slug |
| GET | `/api/catalog/products` | List products with filters |
| GET | `/api/catalog/products/:slug` | Product by slug |

### `GET /api/catalog/products`

**Query Parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `page` | number | Page number (default: 1) |
| `limit` | number | Items per page |
| `q` | string | Text search |
| `category` | string | Filter by category slug |
| `theme` | string | Filter by theme slug |
| `sort` | string | `newest`, `price_asc`, `price_desc`, `relevance` |

---

## Cart Routes

All cart routes require authentication. Auth middleware is applied to the entire router.

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/cart` | Get user's cart |
| POST | `/api/cart/items` | Add item to cart |
| PATCH | `/api/cart/items/:itemId` | Update item quantity (`itemId` format: `productId_variantId`) |
| DELETE | `/api/cart/items/:itemId` | Remove item from cart (`itemId` format: `productId_variantId`) |
| DELETE | `/api/cart` | Clear entire cart |

### `POST /api/cart/items`

**Body:**
```json
{
  "productId": "...",
  "variantId": "...",
  "quantity": 1
}
```

### `PATCH /api/cart/items/:itemId`

**Path param:** `:itemId` = `productId_variantId` (e.g. `65f1234_65f5678`)

**Body:**
```json
{
  "quantity": 3
}
```

### `DELETE /api/cart/items/:itemId`

**Path param:** `:itemId` = `productId_variantId` (e.g. `65f1234_65f5678`)

---

## Wishlist Routes

All wishlist routes require authentication.

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/wishlist` | Get user's wishlist |
| POST | `/api/wishlist/items/:productId` | Add product to wishlist |
| DELETE | `/api/wishlist/items/:productId` | Remove product from wishlist |
| DELETE | `/api/wishlist` | Clear entire wishlist |

---

## Address Routes

All address routes require authentication.

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/addresses` | List user's addresses |
| POST | `/api/addresses` | Create new address |
| GET | `/api/addresses/:id` | Get address by ID |
| PUT | `/api/addresses/:id` | Update address |
| DELETE | `/api/addresses/:id` | Delete address |
| PATCH | `/api/addresses/:id/default` | Set address as default |

### `POST /api/addresses`

**Body:**
```json
{
  "fullName": "John Doe",
  "phone": "9876543210",
  "addressLine1": "123 Main Street",
  "addressLine2": "Apt 4B",
  "city": "Mumbai",
  "state": "Maharashtra",
  "postalCode": "400001",
  "country": "India",
  "landmark": "Near Station",
  "addressType": "HOME",
  "isDefault": true
}
```

---

## Order Routes

All order routes require authentication.

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/orders` | List user's orders |
| POST | `/api/orders` | Create order from cart |
| GET | `/api/orders/returns` | List user's return requests |
| GET | `/api/orders/:id` | Get order detail |
| POST | `/api/orders/:id/cancel` | Cancel order |
| POST | `/api/orders/:id/returns` | Submit return request |
| GET | `/api/orders/:id/returns` | List returns for order |
| GET | `/api/orders/:id/returns/:returnId` | Get return detail |
| POST | `/api/orders/:id/returns/:returnId/cancel` | Cancel return request |

### `POST /api/orders`

**Body:**
```json
{
  "addressId": "...",
  "idempotencyKey": "optional-unique-key"
}
```

### `POST /api/orders/:id/returns`

**Body:**
```json
{
  "items": [
    {
      "productId": "...",
      "variantId": "...",
      "quantity": 1,
      "reason": "WRONG_SIZE",
      "description": "Ordered M, received L"
    }
  ],
  "customerNote": "Please process quickly"
}
```

**Return reasons:** `WRONG_SIZE`, `WRONG_PRODUCT`, `DAMAGED`, `DEFECTIVE`, `NOT_AS_DESCRIBED`, `OTHER`

---

## Payment Routes

All payment routes require authentication.

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/payments/create-order` | Create Razorpay order |
| POST | `/api/payments/verify` | Verify payment signature |
| GET | `/api/payments/order/:orderId` | Get payment status |

### `POST /api/payments/create-order`

**Body:** `{ "orderId": "..." }`

**Response:**
```json
{
  "data": {
    "razorpayOrderId": "order_xxx",
    "amount": 89900,
    "currency": "INR",
    "key": "rzp_test_xxx"
  }
}
```

### `POST /api/payments/verify`

**Body:**
```json
{
  "razorpayOrderId": "order_xxx",
  "razorpayPaymentId": "pay_xxx",
  "razorpaySignature": "signature_xxx",
  "orderId": "internal_order_id"
}
```

---

## Admin Routes

All admin routes require `ADMIN` or `SUPER_ADMIN` role. Two routers are mounted at `/api/admin`:

- `adminCatalogRoutes` — catalog management (products, categories, themes, inventory)
- `adminRoutes` — operations (dashboard, orders, returns, refunds, shipments, customers)

### Dashboard

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/admin/dashboard` | Dashboard KPIs (revenue, order counts, low stock) |

### Categories (Admin)

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/admin/categories` | List all categories (incl. inactive) |
| POST | `/api/admin/categories` | Create category |
| GET | `/api/admin/categories/:id` | Get category by ID |
| PUT | `/api/admin/categories/:id` | Update category |
| PATCH | `/api/admin/categories/:id/status` | Toggle category status |

### Themes (Admin)

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/admin/themes` | List all themes (incl. inactive) |
| POST | `/api/admin/themes` | Create theme |
| GET | `/api/admin/themes/:id` | Get theme by ID |
| PUT | `/api/admin/themes/:id` | Update theme |
| PATCH | `/api/admin/themes/:id/status` | Toggle theme status |

### Products (Admin)

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/admin/products` | List all products (incl. drafts) |
| POST | `/api/admin/products` | Create product |
| GET | `/api/admin/products/:id` | Get product by ID |
| PUT | `/api/admin/products/:id` | Update product |
| PATCH | `/api/admin/products/:id/status` | Toggle product status |
| GET | `/api/admin/products/:id/inventory` | Get inventory history |
| PATCH | `/api/admin/products/:productId/variants/:variantId/inventory` | Adjust stock |

**Inventory adjustment body:**
```json
{
  "quantity": 50,
  "type": "RESTOCK",
  "reason": "Restocked from supplier"
}
```

**Inventory type values:** `RESTOCK`, `ADJUSTMENT`

### Orders (Admin)

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/admin/orders` | List all orders |
| GET | `/api/admin/orders/:id` | Get order detail |
| PATCH | `/api/admin/orders/:id/status` | Update order status |
| POST | `/api/admin/orders/:id/cancel` | Cancel order |

### Shipments (Admin)

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/admin/orders/:id/shipment` | Get shipment for order |
| POST | `/api/admin/orders/:id/shipment` | Create shipment |
| PATCH | `/api/admin/orders/:id/shipment` | Update shipment |

### Refunds (Admin)

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/admin/orders/:id/refund` | Initiate refund |
| GET | `/api/admin/orders/:id/refunds` | List refunds for order |

**Refund body:**
```json
{
  "amount": 89900,
  "reason": "Customer returned damaged item"
}
```

### Returns (Admin)

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/admin/returns` | List all return requests |
| GET | `/api/admin/returns/:id` | Get return detail |
| POST | `/api/admin/returns/:id/approve` | Approve return request |
| POST | `/api/admin/returns/:id/reject` | Reject return request |
| POST | `/api/admin/returns/:id/receive` | Mark item received |
| POST | `/api/admin/returns/:id/inspect` | Mark as inspecting |
| POST | `/api/admin/returns/:id/accept` | Accept return (after inspection) |
| POST | `/api/admin/returns/:id/reject-after-inspection` | Reject return (after inspection) |

**Reject body:**
```json
{
  "adminNote": "Item shows signs of use beyond inspection"
}
```

### Customers (Admin)

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/admin/customers` | List all customers |
| GET | `/api/admin/customers/:id` | Get customer detail |
| PATCH | `/api/admin/customers/:id/status` | Update customer status |

**Customer status body:**
```json
{
  "status": "SUSPENDED"
}
```

---

---

## Warehouse Fulfillment Routes (Phase 10C)

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/api/admin/orders/:id/fulfillment` | Admin | Get or initialize warehouse fulfillment record |
| POST | `/api/admin/orders/:id/fulfillment/allocate` | Admin | Allocate order for picking (`ALLOCATED`) |
| POST | `/api/admin/orders/:id/fulfillment/pick` | Admin | Confirm item picking (`PICKED`). No inventory SALE deduction |
| POST | `/api/admin/orders/:id/fulfillment/pack` | Admin | Confirm item packing & package dimensions (`PACKED`) |
| GET | `/api/admin/orders/:id/fulfillment/packing-slip` | Admin | Streamed 4x6 / A4 Packing Slip PDF (distinct from Invoice & Label) |
| POST | `/api/admin/orders/:id/fulfillment/qc` | Admin | Confirm Quality Check (`QC_PASSED` / `QC_FAILED`). Enforces Custom Print completion |
| POST | `/api/admin/orders/:id/fulfillment/ready-to-ship` | Admin | Mark order `READY_TO_SHIP` for courier dispatch |

---

## Shipping & Logistics Routes

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/api/shipping/serviceability` | Public | Check PIN code delivery & COD serviceability |
| POST | `/api/shipping/rates` | Public | Calculate shipping rates & ETAs |
| GET | `/api/shipping/track/:idOrAwb` | Required | Customer tracking history for order/AWB |
| GET | `/api/admin/orders/:id/shipment/label` | Admin | Secure 4x6 shipping label PDF stream |
| POST | `/api/admin/orders/:id/shipment` | Admin | Create courier shipment (Delhivery / Mock) |
| POST | `/api/admin/orders/:id/shipment/pickup` | Admin | Request courier pickup |
| POST | `/api/admin/orders/:id/shipment/tracking/refresh` | Admin | Refresh tracking from courier provider |
| POST | `/api/admin/orders/:id/shipment/cancel` | Admin | Cancel courier shipment |

> **Note on shipment creation:** In the current implementation the courier shipment (and AWB assignment) is created by an **admin** action through `POST /api/admin/orders/:id/shipment`, not automatically when a customer pays. The conceptual "automatic" shipment trigger described in [Delhivery Shipping Integration](#delhivery-shipping-integration) below is the automation the integration is intended to support. The lifecycle and planned/automatic behavior are documented separately so they are not confused with the currently shipping APIs.

---

## Delhivery Shipping Integration

SamratFashion uses **Delhivery** as its courier/logistics provider for dispatched shipments. The integration is backend-controlled through a logistics service layer that also supports a `mock` provider for development (selected via `LOGISTICS_PROVIDER`).

> **Important — environment semantics:** `DELHIVERY_ENV=sandbox` is an **application-level label** that maps to Delhivery's **staging/test** environment. It *must not* be assumed to be a Delhivery-production flag. Production API calls require the appropriate **production** token.

### Shipping Lifecycle (Target / Conceptual)

The automated shipping lifecycle targeted by the integration is:

```
Customer places order
  → Payment confirmation (Razorpay verified)
  → Order saved (paymentStatus PENDING → PAID when confirmed)
  → Pincode/serviceability check (GET /api/shipping/serviceability)
  → Shipping calculation where applicable (POST /api/shipping/rates)
  → Delhivery shipment creation (POST /api/admin/orders/:id/shipment)
  → AWB / Waybill received
  → AWB saved against the shipment (Shipment.awbNumber)
  → Shipping label generation (GET /api/admin/orders/:id/shipment/label)
  → Pickup request / workflow (POST /api/admin/orders/:id/shipment/pickup)
  → Delhivery pickup (provider status → PICKED_UP)
  → Shipment tracking (GET /api/shipping/track/:idOrAwb)
  → Delhivery status updates / webhook (POST /api/webhooks/logistics)
  → MongoDB order/shipping status update
  → Customer tracking page / notifications
```

**Current implementation status:**

- **Implemented:** serviceability, rate calculation, admin-triggered shipment creation, AWB assignment, shipping-label PDF generation, pickup request, manual tracking refresh, logistics webhook, customer tracking lookup, and order-status synchronization.
- **Automatic (on-payment) shipment creation:** currently **planned / in progress**. Today a shipment is created by an **admin** action, not automatically at the moment of payment. The code does not auto-create a shipment when an order is paid.

### Backend API Responsibilities

The backend orchestrates the whole shipping lifecycle:

- **Serviceability** — query Delhivery PIN-code serviceability & COD availability.
- **Rate calculation** — estimate shipping cost via Delhivery rate endpoints.
- **Shipment creation** — call Delhivery to create a shipment and obtain an AWB/Waybill.
- **AWB storage** — persist the returned AWB/Waybill against the shipment (and, via it, the order).
- **Label generation** — produce a 4x6 PDF shipping label.
- **Pickup** — request a courier pickup for a created shipment.
- **Tracking** — fetch/refresh tracking events from Delhivery and expose them to the customer.
- **Webhook handling** — receive Delhivery status updates and synchronize order/shipping state.
- **Notifications** — reflect delivery/status changes in the customer experience.

### Implemented Shipping Routes

The routes below **exist** in the codebase:

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | `/api/shipping/serviceability?postalCode=...` | Public | Check PIN-code delivery & COD serviceability |
| POST | `/api/shipping/rates` | Public | Calculate estimated shipping rates & ETA |
| GET | `/api/shipping/track/:idOrAwb` | Customer | Customer tracking lookup (order, shipment ID, AWB, or tracking number) |
| GET | `/api/admin/orders/:id/shipment` | Admin | Get shipment for an order |
| POST | `/api/admin/orders/:id/shipment` | Admin | Create courier shipment (Delhivery / Mock), assigns AWB |
| PATCH | `/api/admin/orders/:id/shipment` | Admin | Update shipment (carrier, tracking, status) |
| GET | `/api/admin/orders/:id/shipment/label` | Admin | Secure 4x6 PDF shipping label stream |
| POST | `/api/admin/orders/:id/shipment/pickup` | Admin | Request courier pickup |
| POST | `/api/admin/orders/:id/shipment/tracking/refresh` | Admin | Refresh tracking from courier provider |
| POST | `/api/admin/orders/:id/shipment/cancel` | Admin | Cancel courier shipment |
| POST | `/api/webhooks/logistics` | Signature-verified | Receive Delhivery/carrier status webhooks |

### Proposed / Planned Routes

The following routes are **NOT yet present in the codebase** and are documented here as **proposed/planned** — they must **not** be treated as implemented:

| Method | Route | Status | Notes |
|--------|-------|--------|-------|
| POST | `/api/shipping/serviceability` | **Proposed** | Current implementation uses `GET /api/shipping/serviceability` |
| POST | `/api/shipping/rate` | **Proposed** | Current implementation uses `POST /api/shipping/rates` |
| POST | `/api/shipping/create` | **Proposed** | No such route exists; shipment is created under `/api/admin/orders/:id/shipment` |
| GET | `/api/shipping/track/:awb` | **Proposed** | Current implementation uses `/api/shipping/track/:idOrAwb` |
| GET | `/api/shipping/label/:awb` | **Proposed** | Label is served via `/api/admin/orders/:id/shipment/label` |
| POST | `/api/shipping/pickup` | **Proposed** | Pickup is handled via `/api/admin/orders/:id/shipment/pickup` |
| POST | `/api/shipping/webhook` | **Proposed** | Webhook is served at `/api/webhooks/logistics` |

### Authentication & Token Handling

- **Provider API calls** are made **server-side only** using a Delhivery API token (`DELHIVERY_API_TOKEN`) sent as an `Authorization: Token <token>` header. This token is **never** exposed to frontend JavaScript.
- **Shipping APIs** follow normal app auth:
  - Public: serviceability & rates.
  - Customer: `/api/shipping/track/:idOrAwb` requires a valid JWT (`requireAuth`).
  - Admin: all `/api/admin/orders/:id/shipment*` routes require `requireAuth` + `requireRole("ADMIN", "SUPER_ADMIN")`.
- **Webhook** (`/api/webhooks/logistics`) is authenticated by an HMAC-SHA256 signature over the raw body using an application-level shared secret (see below).

### Staging vs Production

- **`DELHIVERY_ENV=sandbox`** is an application-level label. When set, the Delhivery provider targets the **staging** base URL (`https://staging-express.delhivery.com` by default). It should map to Delhivery's staging/test environment.
- **Production** API calls target the Delhivery production base URL (`https://track.delhivery.com` by default) and require a **production** API token.
- Staging and production API tokens are **distinct** and must be kept separate.

### AWB / Waybill

- On successful shipment creation, Delhivery returns a **Waybill (AWB)** number. The provider maps this to `awbNumber` on the `Shipment` record (`trackingNumber` mirrors the AWB). The AWB identifies the courier shipment and is distinct from the internal `Order.orderNumber`.
- The AWB (Waybill) is stored against the shipment and, through `Shipment.orderId`, associated with the order.

### Shipment Creation

- Shipment creation calls the provider's shipment API with recipient/package details and the configured pickup location; the returned AWB is persisted.
- **Idempotency:** creation is guarded by a unique index on `Shipment.orderId` (one shipment per order). If a shipment already exists, the controller returns the existing shipment instead of creating a duplicate.
- Shipment creation is currently allowed only for orders in `CONFIRMED` or `PROCESSING` status.

### Tracking

- Customer-side tracking is exposed via `GET /api/shipping/track/:idOrAwb` (scoped to the authenticated customer's own shipments).
- Admin can refresh tracking on demand via `POST /api/admin/orders/:id/shipment/tracking/refresh`, which pulls and appends provider tracking events (deduplicated by provider event ID).
- Tracking history is stored on the shipment as `trackingHistory`.

### Label Generation

- A 4x6 PDF shipping label is generated server-side and streamed as `application/pdf` via `GET /api/admin/orders/:id/shipment/label` (admin-only).

### Pickup

- Courier pickup is requested via `POST /api/admin/orders/:id/shipment/pickup`; on success the shipment transitions to `PICKUP_REQUESTED` and records the pickup ID.

### Webhooks

- `POST /api/webhooks/logistics` receives Delhivery/carrier status updates (raw body, HMAC-SHA256 signature verified against an application-level shared secret).
- Incoming AWB + status are mapped to an internal shipment status; order status is synchronized (e.g., `PICKED_UP`/`SHIPPED`/`IN_TRANSIT`/`OUT_FOR_DELIVERY` → `SHIPPED`, `DELIVERED` → `DELIVERED`).
- Webhook events are handled **idempotently** — duplicate events are ignored using a unique `LogisticsEventLog.providerEventId` index.

### Error Handling

- Provider failures are wrapped in `AppError` with codes such as `LOGISTICS_CONFIG_ERROR`, `LOGISTICS_SERVICEABILITY_UNAVAILABLE`, `LOGISTICS_RATE_UNAVAILABLE`, or `LOGISTICS_PROVIDER_ERROR`.
- Provider API errors are logged server-side (operation + status + message) **without** logging authentication tokens or secrets.

### Retry Behavior

- There is **no automatic retry** on courier API failure in the current implementation. Courier failures surface as errors to the caller (admin), who can retry the action manually. Automatic/idempotent retries are **planned**.

### Idempotency Considerations

- One shipment per order (unique `Shipment.orderId`) prevents duplicate AWB/shipment creation.
- Tracking events are deduplicated by provider event ID.
- Webhook events are deduplicated via `LogisticsEventLog.providerEventId`.

---

## Environment Variables (Delhivery)

Only example names are shown — no real credentials.

```env
DELHIVERY_ENV=sandbox
DELHIVERY_API_TOKEN=
DELHIVERY_CLIENT_NAME=
DELHIVERY_PICKUP_LOCATION=
DELHIVERY_WEBHOOK_SECRET=
ORIGIN_POSTAL_CODE=
```

- **`DELHIVERY_ENV=sandbox`** is an application-level environment label; `sandbox` should map to Delhivery's **staging** environment.
- **`DELHIVERY_API_TOKEN`** must contain the appropriate staging or production token (depending on which environment the app targets). A staging token should **not** be invented or assumed to be the production token.
- **`DELHIVERY_CLIENT_NAME`** must match the registered Delhivery client/account name.
- **`DELHIVERY_PICKUP_LOCATION`** must match a registered pickup location.
- **`ORIGIN_POSTAL_CODE`** is the warehouse/pickup location PIN.
- **`DELHIVERY_WEBHOOK_SECRET`** is only used if the project's webhook implementation requires an application-level shared secret / signature validation mechanism (the `POST /api/webhooks/logistics` handler does use one).

---

## Webhook Routes

### `POST /api/webhooks/logistics`

Receive Delhivery/carrier shipment status webhooks. Mounted with `express.raw()` before `express.json()` to preserve the raw body for signature verification.

**Signature headers:** `x-logistics-signature` (or `x-shipment-signature` / `x-delhivery-signature`) — an HMAC-SHA256 hex digest of the raw request body, signed with an application-level shared secret (`DELHIVERY_WEBHOOK_SECRET` or `LOGISTICS_WEBHOOK_SECRET`).

**Body (standard / Delhivery):**
```json
{
  "awbNumber": "DELHI12345678",
  "status": "IN_TRANSIT",
  "location": "Mumbai Hub",
  "description": "Shipment in transit",
  "timestamp": "2026-01-15T10:00:00Z",
  "providerEventId": "delhivery_evt_123"
}
```

The handler also supports nested Delhivery-style payloads (`Shipment.Waybill`, `Shipment.Status.Status`, `ScanDetail.*`). Incoming AWB + status are mapped to an internal shipment status and the order status is synchronized. Idempotent: duplicate events are safely ignored via the unique `LogisticsEventLog.providerEventId` index.

### `POST /api/webhooks/razorpay`

Receive Razorpay webhook events. Mounted with `express.raw()` before `express.json()` to preserve the raw body for signature verification.

**Content-Type:** `application/json` (raw body)

Idempotent: duplicate events are safely ignored via `WebhookEvent` collection.

---

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `SUCCESS` | 200 | Request succeeded |
| `VALIDATION_ERROR` | 400 | Zod validation failed |
| `MONGO_VALIDATION_ERROR` | 400 | Mongoose validation failed |
| `UNAUTHORIZED` | 401 | Not authenticated |
| `TOKEN_EXPIRED` | 401 | Access token expired |
| `FORBIDDEN` | 403 | Insufficient permissions |
| `NOT_FOUND` | 404 | Resource not found |
| `RATE_LIMITED` | 429 | Too many requests |
| `INTERNAL_ERROR` | 500 | Server error |
