# Database Schema

**Database:** MongoDB (`samrat_fashion`)
**ODM:** Mongoose v9.9

---

## Entity Relationship Diagram

```
User ─┬── Cart ──── CartItem ──► Product ──── Variant
      ├── Wishlist ── WishlistItem ──► Product
      ├── Address
      ├── Order ──── OrderItem ──► Product + Variant
      │    ├── Payment ── PaymentAttempt
      │    ├── Shipment
      │    ├── ReturnRequest ── ReturnItem
      │    └── Refund
      ├── Session
      └── PasswordResetToken

Category ◄── Product
Category ◄── Category (self-ref: parentCategory)
Theme ◄──── Product

InventoryTransaction ──► Product + Variant + Order/Refund/ReturnRequest
AuditLog ──► User (actor)
WebhookEvent (standalone, idempotent)
LogisticsEventLog (standalone, idempotent — logistics/courier webhook events)
```

---

## Models

### User

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `name` | String | Yes | | `trim` |
| `email` | String | Yes | | Unique, `lowercase`, `trim` |
| `phone` | String | No | | Unique sparse, `trim` |
| `passwordHash` | String | Yes | | |
| `role` | Enum | No | `CUSTOMER` | `CUSTOMER`, `ADMIN`, `SUPER_ADMIN` |
| `status` | Enum | No | `ACTIVE` | `ACTIVE`, `SUSPENDED`, `DISABLED` |
| `emailVerified` | Boolean | No | `false` | |
| `phoneVerified` | Boolean | No | `false` | |
| `avatar` | String | No | | URL |
| `lastLoginAt` | Date | No | | |

**Indexes:** `email` (unique), `phone` (unique sparse), `role`, `status`

### Product

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `name` | String | Yes | | `trim` |
| `slug` | String | Yes | | Unique, `lowercase`, `trim` |
| `description` | String | Yes | | |
| `images` | String[] | No | | Top-level product images |
| `categoryId` | ObjectId → Category | Yes | | |
| `themeIds` | ObjectId[] → Theme | No | | Multiple themes |
| `basePrice` | Number | Yes | | Min: 0 (in paise) |
| `mrp` | Number | No | | Min: 0 |
| `discount` | Number | No | | Min: 0, Max: 100 |
| `variants` | Array | No | | See Variant subdocument |
| `tags` | String[] | No | | `trim` each |
| `status` | Enum | No | `DRAFT` | `DRAFT`, `ACTIVE`, `INACTIVE`, `ARCHIVED` |
| `isFeatured` | Boolean | No | `false` | |
| `isNewArrival` | Boolean | No | `false` | |
| `isBestSeller` | Boolean | No | `false` | |
| `averageRating` | Number | No | `0` | Min: 0, Max: 5 |
| `reviewCount` | Number | No | `0` | Min: 0 |
| `offers.type` | String | No | | `trim` |
| `offers.description` | String | No | | `trim` |
| `seo.title` | String | No | | `trim` |
| `seo.description` | String | No | | `trim` |

#### Variant (subdocument — has `_id`)

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `size` | String | No | | `trim` |
| `color` | String | No | | `trim` |
| `hexCode` | String | No | | `trim` |
| `sku` | String | Yes | | `trim` |
| `stock` | Number | Yes | `0` | Min: 0 |
| `additionalPrice` | Number | No | `0` | Min: 0 |
| `images` | String[] | No | | Variant-level images |
| `isAvailable` | Boolean | No | `true` | |

**Indexes:** `slug` (unique), `categoryId`, `themeIds`, `status`, `isFeatured`, `isNewArrival`, `isBestSeller`, `tags`, `variants.sku`, text index on `name + description + tags`

### Category

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `name` | String | Yes | | `trim` |
| `slug` | String | Yes | | Unique, `lowercase`, `trim` |
| `description` | String | No | | `trim` |
| `image` | String | No | | URL |
| `parentCategory` | ObjectId → Category | No | `null` | Self-referencing hierarchy |
| `displayOrder` | Number | No | `0` | |
| `status` | Enum | No | `ACTIVE` | `ACTIVE`, `INACTIVE` |
| `seo.title` | String | No | | `trim` |
| `seo.description` | String | No | | `trim` |

**Indexes:** `slug` (unique), `status`, `parentCategory`, `displayOrder`

### Theme

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `name` | String | Yes | | `trim` |
| `slug` | String | Yes | | Unique, `lowercase`, `trim` |
| `description` | String | No | | `trim` |
| `heroImage` | String | No | | URL |
| `thumbnail` | String | No | | URL |
| `status` | Enum | No | `ACTIVE` | `ACTIVE`, `INACTIVE` |
| `displayOrder` | Number | No | `0` | |
| `isFeatured` | Boolean | No | `false` | |
| `seo.title` | String | No | | `trim` |
| `seo.description` | String | No | | `trim` |

**Indexes:** `slug` (unique), `status`, `isFeatured`, `displayOrder`

### Cart

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `userId` | ObjectId → User | Yes | | Unique (one cart per user) |
| `items` | Array | No | | See CartItem |

#### CartItem

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `productId` | ObjectId → Product | Yes | | |
| `variantId` | ObjectId | Yes | | References Product.variants |
| `quantity` | Number | Yes | `1` | Min: 1 |

**Indexes:** `userId` (unique)

### Order

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `orderNumber` | String | Yes | | Unique |
| `userId` | ObjectId → User | Yes | | Indexed |
| `items` | Array | Yes | | See OrderItem |
| `shippingAddress` | Object | Yes | | See OrderAddress (snapshot) |
| `subtotal` | Number | Yes | | Min: 0 |
| `discount` | Number | Yes | `0` | Min: 0 |
| `shipping` | Number | Yes | `0` | Min: 0 — **shipping cost in paise**, not the shipment object |
| `tax` | Number | Yes | `0` | Min: 0 |
| `total` | Number | Yes | | Min: 0 |
| `currency` | String | Yes | `INR` | |
| `status` | Enum | Yes | `PENDING` | `PENDING`, `CONFIRMED`, `PROCESSING`, `SHIPPED`, `DELIVERED`, `CANCELLED` |
| `paymentStatus` | Enum | Yes | `PENDING` | `PENDING`, `PAID`, `FAILED`, `REFUNDED` |
| `idempotencyKey` | String | No | | Partial unique index |

> **Shipping data** for an order (AWB/Waybill, carrier, tracking) is stored in the **`Shipment`** collection (one per order, unique `orderId`) — see the [Shipment](#shipment) section. The `Order.shipping` field is purely the numeric shipping cost.

#### OrderItem

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `productId` | ObjectId → Product | Yes | | |
| `variantId` | ObjectId | Yes | | |
| `productName` | String | Yes | | Snapshot at order time |
| `productImage` | String | Yes | | Primary image URL |
| `selectedSize` | String | Yes | | |
| `selectedColor` | String | Yes | | |
| `quantity` | Number | Yes | | Min: 1 |
| `unitPrice` | Number | Yes | | Min: 0 |
| `lineTotal` | Number | Yes | | Min: 0 |

#### OrderAddress (snapshot)

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `fullName` | String | Yes | | |
| `phone` | String | Yes | | |
| `addressLine1` | String | Yes | | |
| `addressLine2` | String | No | | |
| `city` | String | Yes | | |
| `state` | String | Yes | | |
| `postalCode` | String | Yes | | |
| `country` | String | Yes | `India` | |
| `landmark` | String | No | | |
| `addressType` | Enum | Yes | `HOME` | `HOME`, `WORK`, `OTHER` |

**Indexes:** `orderNumber` (unique), `userId`, `idempotencyKey` (unique with partial filter)

### Payment

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `orderId` | ObjectId → Order | Yes | | Unique |
| `userId` | ObjectId → User | Yes | | |
| `amount` | Number | Yes | | |
| `currency` | String | Yes | `INR` | |
| `status` | Enum | No | `PENDING` | `PENDING`, `AUTHORIZED`, `CAPTURED`, `FAILED`, `REFUNDED` |
| `provider` | String | Yes | `RAZORPAY` | |
| `refundedAmount` | Number | No | `0` | |

**Indexes:** `orderId` (unique)

### PaymentAttempt

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `paymentId` | ObjectId → Payment | Yes | | |
| `orderId` | ObjectId → Order | Yes | | |
| `razorpayOrderId` | String | Yes | | |
| `razorpayPaymentId` | String | No | | Set after successful payment |
| `amount` | Number | Yes | | |
| `currency` | String | Yes | `INR` | |
| `status` | Enum | No | `PENDING` | `PENDING`, `AUTHORIZED`, `CAPTURED`, `FAILED` |
| `failureCode` | String | No | | |
| `failureReason` | String | No | | |

### Address

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `userId` | ObjectId → User | Yes | | |
| `fullName` | String | Yes | | `trim` |
| `phone` | String | Yes | | `trim` |
| `addressLine1` | String | Yes | | `trim` |
| `addressLine2` | String | No | | `trim` |
| `city` | String | Yes | | `trim` |
| `state` | String | Yes | | `trim` |
| `postalCode` | String | Yes | | `trim` |
| `country` | String | Yes | `India` | `trim` |
| `landmark` | String | No | | `trim` |
| `addressType` | Enum | Yes | `HOME` | `HOME`, `WORK`, `OTHER` |
| `isDefault` | Boolean | No | `false` | |

### Wishlist

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `userId` | ObjectId → User | Yes | | Unique (one wishlist per user) |
| `items` | Array | No | | See WishlistItem |

#### WishlistItem

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `productId` | ObjectId → Product | Yes | | |
| `addedAt` | Date | No | `Date.now` | |

**Indexes:** `userId` (unique)

### Shipment

The `Shipment` collection holds the courier/logistics information for an order and is created by the **admin** (or eventually automatic) shipment flow. There is **one shipment per order** (unique `orderId`). The AWB / Waybill is stored here — it is **not** stored on the `Order` document.

> **Important — `Order.shipping` vs `Shipment`:** On the `Order` model, `shipping` is a **numeric** field representing the shipping cost (in paise). It is **not** the shipment object. Courier/shipment details (AWB, carrier, tracking) live in the separate `Shipment` collection referenced by `Shipment.orderId`. In order-API responses, the shipment is attached as `data.shipment`.

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `orderId` | ObjectId → Order | Yes | | Unique — one shipment per order |
| `userId` | ObjectId → User | Yes | | Indexed |
| `carrier` | String | Yes | | e.g., `Delhivery Express`, or mock provider |
| `trackingNumber` | String | Yes | | Mirrors the AWB / waybill number |
| `awbNumber` | String | Yes | | Delhivery AWB / waybill |
| `providerShipmentId` | String | No | | Provider shipment reference |
| `provider` | String | Yes | `mock` | `mock` or `delhivery` |
| `trackingUrl` | String | No | | Custom validator: must be HTTPS |
| `labelUrl` | String | No | | Shipping label URL |
| `pickupId` | String | No | | Courier pickup request ID |
| `pickupRequestedAt` | Date | No | | When pickup was requested |
| `status` | Enum | Yes | `PENDING` | See shipment statuses below |
| `shippedAt` | Date | No | | Set when handed to courier |
| `deliveredAt` | Date | No | | Set on delivery |
| `trackingHistory` | Array | No | `[]` | `ITrackingEvent[]` (status, location, description, timestamp, providerEventId) |
| `packageDetails` | Object | No | | `weightGrams`, `lengthCm`, `widthCm`, `heightCm` |
| `createdBy` | ObjectId → User | Yes | | Admin who created |
| `updatedBy` | ObjectId → User | Yes | | Admin who last updated |
| `createdAt` / `updatedAt` | Date | Yes | | Mongoose timestamps |

**Shipment statuses** (enum): `PENDING`, `LABEL_CREATED`, `PICKUP_REQUESTED`, `PICKED_UP`, `SHIPPED`, `IN_TRANSIT`, `OUT_FOR_DELIVERY`, `DELIVERED`, `NDR`, `RTO`, `CANCELLED`

**Tracking event** (`trackingHistory[]`): `status` (String, required), `location` (String), `description` (String, required), `timestamp` (Date, default now), `providerEventId` (String — used for dedup).

**Indexes:** `orderId` (unique), `userId`, `trackingNumber`, `awbNumber`

### Shipping Lifecycle (consistent with order status model)

The shipment status is **separate** from the order `status` and `paymentStatus`. The two are synchronized as follows:

- `LABEL_CREATED` / `PICKUP_REQUESTED` → order remains `PROCESSING` (cancellation still possible)
- `PICKED_UP` / `SHIPPED` / `IN_TRANSIT` / `OUT_FOR_DELIVERY` → order becomes `SHIPPED`
- `DELIVERED` → order becomes `DELIVERED` (`deliveredAt` recorded)
- `CANCELLED` → order cancelled (before courier handoff)
- `NDR` / `RTO` → exception / return-to-origin states

**Notes:**
- The **order ID** (or `orderNumber`) and the **AWB / Waybill** are different identifiers. The AWB/Waybill identifies the courier shipment; the order ID/orderNumber identifies the order in the SamratFashion system.
- **Shipping status must not overwrite payment status** — `paymentStatus` (`PENDING`/`PAID`/`FAILED`/`REFUNDED`) and shipping status remain separate fields.
- **Tracking events should be auditable** — they are stored as an append-only `trackingHistory` array with provider event IDs.
- **Webhook events should be handled idempotently** — deduplicated by `LogisticsEventLog.providerEventId`.

### LogisticsEventLog

Stores incoming logistics/carrier webhook events to guarantee idempotent processing.

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `providerEventId` | String | Yes | | Unique — dedup key for webhook idempotency |
| `awbNumber` | String | Yes | | Courier AWB / waybill |
| `eventType` | String | Yes | | Mapped shipment status |
| `payload` | Mixed | No | `{}` | Raw webhook payload |
| `processedAt` | Date | No | `Date.now` | |

**Indexes:** `providerEventId` (unique), `awbNumber`

### ReturnRequest

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `orderId` | ObjectId → Order | Yes | | Indexed |
| `userId` | ObjectId → User | Yes | | Indexed |
| `items` | Array | Yes | | See ReturnItem |
| `status` | Enum | Yes | `REQUESTED` | See return statuses below |
| `customerNote` | String | No | | Customer explanation |
| `adminNote` | String | No | | Admin notes |
| `refundId` | ObjectId → Refund | No | | Linked refund |
| `requestedAt` | Date | No | `Date.now` | |
| `approvedAt` | Date | No | | |
| `receivedAt` | Date | No | | |
| `inspectedAt` | Date | No | | |
| `completedAt` | Date | No | | |
| `rejectedAt` | Date | No | | |
| `cancelledAt` | Date | No | | |
| `reviewedBy` | ObjectId → User | No | | Admin who reviewed |

#### ReturnItem

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `productId` | ObjectId → Product | Yes | | |
| `variantId` | ObjectId | Yes | | |
| `quantity` | Number | Yes | | Min: 1 |
| `reason` | Enum | Yes | | `WRONG_SIZE`, `WRONG_PRODUCT`, `DAMAGED`, `DEFECTIVE`, `NOT_AS_DESCRIBED`, `OTHER` |

**Return statuses:** `REQUESTED`, `APPROVED`, `REJECTED`, `RECEIVED`, `INSPECTING`, `ACCEPTED`, `REJECTED_AFTER_INSPECTION`, `COMPLETED`, `CANCELLED`

**Indexes:** `orderId`, `userId`

### Refund

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `orderId` | ObjectId → Order | Yes | | Indexed |
| `paymentId` | ObjectId → Payment | Yes | | Indexed |
| `userId` | ObjectId → User | Yes | | |
| `amount` | Number | Yes | | |
| `currency` | String | Yes | `INR` | |
| `status` | Enum | No | `PENDING` | `PENDING`, `PROCESSED`, `FAILED`, `CANCELLED` |
| `reason` | String | No | | |
| `razorpayPaymentId` | String | No | | |
| `razorpayRefundId` | String | No | | Unique sparse |
| `initiatedBy` | ObjectId → User | Yes | | Admin who initiated |
| `initiatedByRole` | String | Yes | | |

**Indexes:** `orderId`, `paymentId`, `razorpayRefundId` (unique sparse)

### InventoryTransaction

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `orderId` | ObjectId → Order | No | | Linked order for SALE/RETURN/REFUND |
| `productId` | ObjectId → Product | Yes | | |
| `variantId` | ObjectId | Yes | | |
| `quantity` | Number | Yes | | |
| `type` | Enum | Yes | | `SALE`, `RESTOCK`, `ADJUSTMENT`, `REFUND`, `RETURN` |
| `refundId` | ObjectId → Refund | No | | |
| `returnId` | ObjectId → ReturnRequest | No | | |
| `reason` | String | No | | Explanation for adjustment |

**Indexes:** Compound unique sparse on `{ orderId, variantId, type }` (idempotency for SALE)

### AuditLog

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `actorId` | ObjectId → User | Yes | | Indexed |
| `actorRole` | String | Yes | | |
| `action` | String | Yes | | Indexed |
| `entityType` | String | Yes | | Indexed |
| `entityId` | ObjectId | Yes | | Indexed |
| `metadata` | Mixed | No | | Additional context |

**Indexes:** `actorId`, `action`, `entityType`, `entityId` (all individual)

### Session

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `userId` | ObjectId → User | Yes | | Indexed |
| `refreshTokenHash` | String | Yes | | Hashed refresh token |
| `expiresAt` | Date | Yes | | TTL index — auto-deleted by MongoDB |
| `revokedAt` | Date | No | | Set on logout |
| `lastUsedAt` | Date | No | `Date.now` | |
| `userAgent` | String | No | | Browser client hint |
| `ip` | String | No | | Client IP address |

**Indexes:** `expiresAt` (TTL, expireAfterSeconds: 0), `userId`

### PasswordResetToken

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `userId` | ObjectId → User | Yes | | Indexed |
| `tokenHash` | String | Yes | | Hashed reset token |
| `expiresAt` | Date | Yes | | TTL index — auto-deleted by MongoDB |
| `usedAt` | Date | No | | Set when token is used |

**Indexes:** `expiresAt` (TTL, expireAfterSeconds: 0), `userId`

### WebhookEvent

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `eventId` | String | Yes | | Razorpay event ID |
| `provider` | String | Yes | `RAZORPAY` | |
| `eventType` | String | Yes | | e.g., `payment.captured` |
| `status` | Enum | Yes | | `PROCESSED`, `FAILED`, `IGNORED` |
| `processedAt` | Date | No | `Date.now` | |

**Unique compound index:** `{ provider, eventId }` — ensures idempotency.

---

## Indexes Summary

| Model | Index | Type | Purpose |
|-------|-------|------|---------|
| User | `email` | Unique | Login lookup |
| User | `phone` | Unique sparse | Optional phone lookup |
| User | `role`, `status` | Regular | Admin filtering |
| Product | `slug` | Unique | URL-friendly lookup |
| Product | `categoryId` | Regular | Category filtering |
| Product | `themeIds` | Regular | Theme filtering |
| Product | `status`, `isFeatured`, `isNewArrival`, `isBestSeller` | Regular | Catalog filtering |
| Product | `tags` | Regular | Tag filtering |
| Product | `variants.sku` | Regular | SKU lookup |
| Product | `name + description + tags` | Text | Full-text search |
| Category | `slug` | Unique | URL-friendly lookup |
| Category | `status`, `parentCategory`, `displayOrder` | Regular | Filtering/sorting |
| Theme | `slug` | Unique | URL-friendly lookup |
| Theme | `status`, `isFeatured`, `displayOrder` | Regular | Filtering/sorting |
| Cart | `userId` | Unique | One cart per user |
| Order | `orderNumber` | Unique | Order lookup |
| Order | `userId` | Regular | User order history |
| Order | `idempotencyKey` | Unique (partial) | Prevent duplicate orders |
| Payment | `orderId` | Unique | One payment per order |
| Shipment | `orderId` | Unique | One shipment per order |
| Shipment | `userId` | Regular | User shipment lookup |
| Shipment | `trackingNumber`, `awbNumber` | Regular | Courier AWB/waybill lookup |
| LogisticsEventLog | `providerEventId` | Unique | Logistics webhook idempotency |
| LogisticsEventLog | `awbNumber` | Regular | Courier AWB/waybill lookup |
| ReturnRequest | `orderId`, `userId` | Regular | Order/user return lookup |
| Refund | `orderId`, `paymentId` | Regular | Payment/order refund lookup |
| Refund | `razorpayRefundId` | Unique sparse | Razorpay refund dedup |
| InventoryTransaction | `{ orderId, variantId, type }` | Compound unique sparse | SALE idempotency |
| AuditLog | `actorId`, `action`, `entityType`, `entityId` | Regular | Audit queries |
| Session | `expiresAt` | TTL (0s) | Auto-expire |
| Session | `userId` | Regular | User session lookup |
| PasswordResetToken | `expiresAt` | TTL (0s) | Auto-expire |
| PasswordResetToken | `userId` | Regular | User token lookup |
| WebhookEvent | `{ provider, eventId }` | Compound unique | Webhook idempotency |

---

## Disaster Recovery & Backup (Phase 11A)

- **Managed Provider:** MongoDB Atlas Continuous Cloud Backups & Automated Snapshots
- **RPO:** < 1 Minute (Continuous oplog stream)
- **RTO:** 5 to 15 Minutes
- **Production Guard:** Enforced via `restoreGuard.ts` (`assertRestoreTargetSafe`)
- **Disaster Recovery Guide:** See [`DISASTER_RECOVERY.md`](file:///d:/code/samratFashion/DISASTER_RECOVERY.md)
- **E2E Test Suite:** [`backend/src/tests/test-backup-restore-e2e.js`](file:///d:/code/samratFashion/backend/src/tests/test-backup-restore-e2e.js) (28/28 scenarios passed, Verdict: `BACKUP AND RESTORE VERIFIED`)

