# Project Context

## Business Domain

**THREADVIBE** (operating as **Samrat Fashion**) is a D2C (direct-to-consumer) e-commerce platform focused on the Indian market, specializing in:

- **Oversized graphic T-shirts** — the core product category
- **Custom T-shirt printing** — customer-designed apparel
- **Bulk orders** — B2B and team/organization orders

The platform targets a youth demographic interested in anime, gaming, pop culture, and streetwear aesthetics.

---

## User Roles

### Customer (default)
- Browse catalog, filter by category/theme
- Add to cart, wishlist management
- Checkout with Razorpay (INR)
- View order history, track shipments
- Initiate returns and refunds
- Manage addresses and account

### Admin
- Full catalog management (products, categories, themes)
- Order processing and status updates
- Shipment creation and tracking
- Return approval/rejection workflow (including post-inspection rejection)
- Refund initiation via Razorpay
- Inventory stock adjustments
- Customer account management (suspend/disable)
- View dashboard KPIs

### Super Admin
- All Admin permissions
- User role management (implied by role hierarchy)

---

## Product Model

Products use a **variant-based** model where a single product has multiple variants defined by size + color combinations:

```
Product
├── name: "Dragon Ball Z Oversized Tee"
├── slug: "dragon-ball-z-oversized-tee"
├── description: "Premium oversized tee..."
├── images: ["https://...jpg", ...]  ← top-level product images
├── categoryId: → Category
├── themeIds: → Theme[]
├── basePrice: 89900  (in paise)
├── mrp: 129900
├── discount: 30
├── variants: [
│   { _id: ObjectId, size: "M", color: "Black", hexCode: "#000000", sku: "DBZ-BLK-M", stock: 50, additionalPrice: 0, isAvailable: true, images: [...] },
│   ...
│ ]
├── tags: ["anime", "oversized", "cotton"]
├── status: ACTIVE | DRAFT | INACTIVE | ARCHIVED
├── isFeatured: true
├── isNewArrival: false
├── isBestSeller: true
├── averageRating: 4.5
├── reviewCount: 128
├── offers: { type: "FESTIVE", description: "30% off on festival sale" }
└── seo: { title: "...", description: "..." }
```

**Key detail:** Variants have their own `_id` (MongoDB auto-generated), `additionalPrice` (price modifier), `isAvailable` flag, and per-variant `images`.

### Category Hierarchy

Categories are hierarchical (parent-child) with a `status` field (`ACTIVE`/`INACTIVE`):

```
Men
├── T-Shirts
│   ├── Oversized
│   ├── Graphic
│   └── Plain
├── Hoodies
└── Joggers

Women
├── T-Shirts
├── Crop Tops
└── Hoodies

Accessories
├── Caps
└── Bags
```

### Themes

Themes are graphic/cultural categories that cut across product types. Each theme has a `status` (`ACTIVE`/`INACTIVE`), `isFeatured` flag, and optional `seo` fields.

Examples: Anime, Gaming, Marvel/DC, Nature, Abstract, Typography

A product can belong to multiple themes.

---

## Order Lifecycle

```
PENDING → CONFIRMED → PROCESSING → SHIPPED → DELIVERED
    └→ CANCELLED (at any point before SHIPPED or custom print confirmation)
```

### Warehouse Fulfillment Lifecycle (Phase 10C)

```
UNALLOCATED → ALLOCATED → PICKING → PICKED → PACKING → PACKED → QC_PENDING → QC_PASSED → READY_TO_SHIP → HANDED_OVER
```

- **Pick**: Staff confirms item picking against order items (`quantityPicked`). Does **NOT** trigger an inventory `SALE` transaction.
- **Pack**: Staff confirms item packing and inputs package dimensions/weight. Streams distinct 4x6/A4 Packing Slip PDF.
- **QC**: Quality Control check (`PASSED` / `FAILED`). For custom print orders, enforces `PrintJob.status === 'COMPLETED'`.
- **Ready to Ship**: Verifies payment `PAID`, picked, packed, and QC passed. `Order.status` remains `PROCESSING`.
- **Courier Handoff**: `Shipment.status = PICKED_UP` sets `Fulfillment.status = HANDED_OVER` and `Order.status = SHIPPED`.

### Customer Email + Notification Infrastructure (Phase 10D)

```
Business Event Trigger → NotificationService (Observer) → NotificationLog (Idempotency) → IEmailProvider (Console/Resend/Disabled)
```

- **Observer Pattern**: Notifications are asynchronous, fail-safe downstream consumers. Email failures **never** crash or roll back business transactions (`Order`, `Payment`, `Shipment`, `Refund`).
- **Notification Log**: `NotificationLog` collection records every dispatch attempt with an `idempotencyKey` to prevent duplicate emails on webhook replays.
- **Branded HTML Templates**: Responsive dark-themed email templates (`orderConfirmation`, `paymentSuccess`, `orderShipped`, `orderDelivered`, `passwordReset`, etc.) with security HTML escaping.
- **Provider Abstraction**: Supports `ConsoleEmailProvider` (dev console only), `ResendEmailProvider` (when `EMAIL_PROVIDER=resend`), and `DisabledEmailProvider` (production fail-safe).

### Payment States

```
PENDING → AUTHORIZED → CAPTURED → REFUNDED
                     → FAILED
```

Note: `AUTHORIZED` exists as a state but the typical flow is `PENDING` → `CAPTURED` (after Razorpay verification).

### Return Lifecycle

```
REQUESTED → APPROVED → RECEIVED → INSPECTING → ACCEPTED → COMPLETED
            ↓                                  ↓
          REJECTED                          REJECTED_AFTER_INSPECTION
            ↓
          CANCELLED (by customer before admin reviews)
```

---

## Courier / Shipping Integration (Delhivery)

SamratFashion has an automated courier integration with **Delhivery** as the shipping provider. This section is intended so future developers and AI coding agents understand how shipping works in the platform.

- **Shipping provider:** Delhivery (with a `mock` provider available for development via `LOGISTICS_PROVIDER`).
- **Backend-controlled:** All Delhivery API communication happens server-side through the logistics service layer (`src/services/logistics/`). The Delhivery API token is never exposed to the frontend.
- **Order → Payment → Shipment:** According to the project's business rules, **order creation and payment happen before shipment creation.** A shipment may only be created for an order in `CONFIRMED` or `PROCESSING` status.
  - Note: In the current implementation, shipment creation is triggered by an **admin** action (`POST /api/admin/orders/:id/shipment`). Automating shipment creation so it is triggered immediately after payment confirmation is **planned/in-progress** — it is not yet automatic in the code.
- **AWB storage:** The Delhivery AWB / Waybill must be stored against the order. It is persisted on the separate `Shipment` collection (`Shipment.awbNumber`, plus `trackingNumber`/`providerShipmentId`) and linked to the order via `Shipment.orderId` (one shipment per order). AWB is **not** embedded on the `Order` document.
- **Customer tracking:** Tracking must be exposed through the SamratFashion customer experience. Customers view shipment status, AWB, and tracking history in their order details, and via `GET /api/shipping/track/:idOrAwb`.
- **Webhooks / status updates:** Delhivery status updates synchronize shipping state. The backend receives `POST /api/webhooks/logistics`, maps the carrier status to an internal shipment status, and updates the order status accordingly (e.g., `PICKED_UP`/`SHIPPED`/`IN_TRANSIT`/`OUT_FOR_DELIVERY` → order `SHIPPED`; `DELIVERED` → order `DELIVERED`).
- **Customer-facing tracking should not require manual admin status updates.** Status changes should be propagated automatically via the logistics webhook (and/or automated refresh), so customers see accurate tracking without an admin manually editing shipment status.
- **Environment separation:** Production and staging credentials must remain **separate**. `DELHIVERY_ENV=sandbox` is an application-level label mapping to Delhivery's staging environment; it must not be treated as a production flag. Staging and production API tokens are distinct.
- **Secrets must never be committed:** `DELHIVERY_API_TOKEN`, `DELHIVERY_WEBHOOK_SECRET`, and any other real credentials must remain in untracked `.env` files only.
- **Resilience:** The shipping integration must be resilient to temporary Delhivery failures.
  - **Saving a paid order should not fail** solely because a courier API temporarily fails. A courier failure should not corrupt or block a confirmed, paid order.
  - **Shipment creation should be retryable and idempotent** (one shipment per order via unique `Shipment.orderId`) to prevent duplicate shipments / AWBs.
- **Shipment lifecycle:** See the [Logistics & Real Courier Lifecycle](#logistics--real-courier-lifecycle-delhivery) above for the status mapping (`LABEL_CREATED → PICKUP_REQUESTED → PICKED_UP / IN_TRANSIT → DELIVERED`, plus `NDR` / `RTO` / `CANCELLED`).

---

## Cart Model

Each user has a single cart document (unique on `userId`). Cart items reference a product variant (size + color) via `productId` + `variantId`. The cart stores quantities; the controller populates product details and recalculates totals on read.

Cart summary: `{ subtotal, shipping, tax, total }`

---

## Checkout Flow

1. User reviews cart (subtotal, shipping, tax computed server-side)
2. User selects/creates shipping address
3. Frontend calls `POST /api/orders` with `addressId` and optional `idempotencyKey`
4. Backend creates Order (status: PENDING, paymentStatus: PENDING) with line item snapshots
5. Frontend calls `POST /api/payments/create-order` with `orderId`
6. Backend creates Razorpay order and returns `razorpayOrderId`, `amount`, `currency`, `key`
7. Frontend opens Razorpay checkout modal
8. User completes payment on Razorpay
9. Frontend calls `POST /api/payments/verify` with Razorpay response data
10. Backend verifies HMAC-SHA256 signature, updates order status to CONFIRMED, paymentStatus to PAID
11. Redirect to `/order-confirmation/:id`

---

## Admin Workflows

### Inventory Management

Stock is tracked per variant (size + color). Every stock change creates an `InventoryTransaction` record:

| Transaction Type | Trigger | Required Fields |
|-----------------|---------|----------------|
| SALE | Order confirmed | `orderId` (compound unique ensures idempotency) |
| RESTOCK | Admin manual increase | `reason` |
| ADJUSTMENT | Admin manual correction | `reason` |
| RETURN | Return accepted | `returnId` |
| REFUND | Refund processed | `refundId` |

### Return Workflow

Multi-step approval process designed for quality control:

1. **Customer submits** → Status: `REQUESTED` (with reason, description, optional customerNote)
2. **Admin reviews** → `APPROVED` or `REJECTED` (with adminNote)
3. **Customer ships** item back
4. **Admin receives** → Status: `RECEIVED`
5. **Admin inspects** → Status: `INSPECTING`
6. **Admin accepts** → `ACCEPTED` or **rejects** → `REJECTED_AFTER_INSPECTION`
7. **Admin processes refund** (if accepted) → Refund created via Razorpay

Return reasons: `WRONG_SIZE`, `WRONG_PRODUCT`, `DAMAGED`, `DEFECTIVE`, `NOT_AS_DESCRIBED`, `OTHER`

### Webhook Handling

Razorpay sends webhooks for payment events. The backend:
1. Verifies webhook signature using HMAC-SHA256 (raw body required)
2. Checks idempotency via `{ provider, eventId }` compound unique index
3. Processes the event (e.g., payment captured → order confirmed)
4. Records the event in `WebhookEvent` collection with status `PROCESSED`, `FAILED`, or `IGNORED`

---

## Key Business Rules

- Products with status `DRAFT` are not visible to customers in the public catalog
- Cart quantity is validated against available stock at checkout time
- Orders cannot be cancelled once status reaches `DELIVERED`
- Refund amount cannot exceed `order.total - previouslyRefundedAmount`
- Admin actions are logged in `AuditLog` (with `actorRole`) for accountability
- Sessions (refresh tokens) auto-expire via MongoDB TTL indexes
- Password reset tokens auto-expire and are single-use
- Returns can be cancelled by the customer before admin approval
- Inventory SALE transactions use compound unique index for idempotency (prevents double stock deduction)
- Product variants have their own `isAvailable` flag independent of product-level `status`
- A courier shipment may only be created for an order in `CONFIRMED` or `PROCESSING` status (order + payment happen before shipment)
- A paid order must not fail to save solely because the Delhivery API is temporarily unavailable; shipment creation must be retryable and idempotent (one shipment per order via unique `Shipment.orderId`)
- Delhivery staging and production API tokens are distinct and must never be committed or mixed
- Production Readiness Gate (Phase 11C/11D): 0 P0/P1 blockers. Verified 28 application routes, 46 E2E readiness scenarios, secret sanitization, HttpOnly cookies, CORS validation, and Disaster Recovery guards. Status: `SOFTWARE LAUNCH CANDIDATE — PASS`.
- Real-Time Support Chat & Auto-Refresh (Phase 12B): Support conversations (`/support/[id]` & `/admin/support/[id]`) automatically synchronize using REST + 5000ms polling with visibility state control, auto-scroll behavior, message deduplication, and zero side-effect read-only operations. Status: `SUPPORT REAL-TIME SYNC VERIFIED`.
- Analytics & Conversion Instrumentation (Phase 12C): GA4 ecommerce measurement layer (`gtag.js`) implemented with automatic PII/secrets redaction, purchase deduplication by `orderNumber`, non-blocking async execution, and zero business-state mutations. Status: `ANALYTICS FOUNDATION IMPLEMENTED — PROVIDER NOT VERIFIED`.
- Razorpay LIVE Activation & Financial Readiness (Phase 12D): Payment chain, HMAC-SHA256 signature verification, idempotency tracking, server-side amount authority, refund limits, and zero PII/secret leakage verified. Environment currently configured in `RAZORPAY TEST` mode awaiting merchant LIVE credentials. Status: `RAZORPAY LIVE READY — CONTROLLED PAYMENT PENDING`.
- UX Polish, Performance Cleanup & Quality Gate (Phase 12E): Resolved all 27 ESLint warnings (`0 errors, 0 warnings`), optimized image & font loading, eliminated Blob URL leaks, verified support chat auto-refresh polling cleanup, and passed 24 UX/performance E2E test scenarios without changing business logic or payment authority. Status: `P3 CLEANUP COMPLETE`.
- Production Data, Configuration & Operational Sanity Audit (Phase 12F): Audited branding consistency (THREADVIBE corporate entity Samrat Fashion), contact info, URLs, legal routes (/privacy, /terms), SEO routes (/robots.txt, /sitemap.xml), catalog SKUs, inventory, and zero secret leakage. Created `PRODUCTION_DATA_CLEANUP.md`. Status: Software Gate: `SOFTWARE LAUNCH CANDIDATE — PASS` | Business Gate: `BUSINESS GO-LIVE PARTIALLY READY`.
