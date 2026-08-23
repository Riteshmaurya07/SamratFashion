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
    └→ CANCELLED (at any point before DELIVERED)
```

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
