# API SECURITY AUDIT

**Project:** SamratFashion  
**Audit Date:** 2026-11-05  
**Scope:** Route-level and controller-level authentication/authorization, IDOR, object ownership, and RBAC

## 1. Route Authorization Summary

### Uploads

| Route | Middleware | Controller authorization | Verdict |
|---|---|---|---|
| `POST /api/upload/image` | `uploadLimiter`, `optionalAuth`, multer | category allowlist; admin-only for product/banner/campaign; guest allowed for custom-artwork; auth required for review | Partial: guest custom-artwork is intentional but should be token-bound |
| `DELETE /api/upload/image` | `requireAuth`, `requireRole('ADMIN','SUPER_ADMIN')` | admin-only | Correct |

Evidence: `backend/src/routes/uploadRoutes.ts:43-44`, `backend/src/controllers/uploadController.ts:69-98`.

### Orders and tracking

| Route | Protection | Ownership |
|---|---|---|
| `GET /api/orders/public-track/:token` | public, rate-limited | token hash + expiry; no user ID required |
| `GET /api/orders` | `requireAuth` | `Order.find({ userId: req.user.id })` |
| `GET /api/orders/:id` | `requireAuth` | `findOne({ _id|orderNumber, userId })` |
| `POST /api/orders` | `requireAuth` | cart and address scoped to `req.user.id` |
| Cancel/confirm/return/refund endpoints | `requireAuth` | `findOne({ _id, userId })` |

Evidence: `backend/src/controllers/orderController.ts:344,365-368,411,506,524,570,626-629,658-661`.

### Addresses

`Address` routes require authentication; controllers filter by `userId`. The alternate-phone suite verified schema validation and isolation in the isolated test DB (17/17 passing).

### Cart and wishlist

- Cart routes require authentication and load `Cart.findOne({ userId })`.
- `addItemToCart` validates that every `customConfigurations[].designId` belongs to the caller (`cartController.ts:170-179`).
- **`updateCartItemQuantity` does not perform the same validation** (`cartController.ts:237-285`). See SF-002.

### Payments

- Create-order and verify endpoints require authentication.
- `verifyPayment` verifies the gateway signature, loads the `PaymentAttempt` by `razorpayOrderId`, then loads the order with `userId: req.user.id` (`paymentController.ts:101-138`).
- Payment attempts and orders are cross-checked for amount/state.
- No cross-user payment IDOR was found.

### Webhooks

- `POST /api/webhooks/razorpay` uses `express.raw({ type: 'application/json' })` mounted before JSON parsing (`backend/src/index.ts:87`).
- Signature verification is required; `event_id` is mandatory; unique `(provider,eventId)` prevents replay duplication.
- Lease token, heartbeat, fencing, and stale recovery are implemented (`WebhookEvent.ts:34-126`).
- Residual test gap: several unwired suites assert stale outcomes; see `TEST_COVERAGE_REPORT.md`.

### Admin routes

Admin routers are mounted with authentication and role middleware (`ADMIN`, `SUPER_ADMIN`). Sampled controllers use those roles. One inconsistency:

- `getDesignById` and `updateDesign` allow `ADMIN` but not `SUPER_ADMIN` (`customDesignController.ts:155,192`). This is a functional inconsistency, not an authorization bypass. Fix for consistency.

## 2. Confirmed Authorization Findings

### SF-002 - Cross-user CustomDesign reference and mutation (High)

**Production blocker: YES**

**Attack path**

1. Attacker adds a legitimate customized item to their own cart.
2. Attacker calls `PUT /api/cart/:itemId` with `customConfigurations` containing a victim's `designId`. The update path does not re-validate ownership (`cartController.ts:256-274`).
3. Attacker calls `POST /api/orders`. `createOrder` fetches the design by ID without an owner filter (`orderController.ts:130-137`) and copies the victim's artwork URL into the attacker's order (`orderController.ts:163-177`).
4. After order creation, the design is updated by ID with `orderId` and `status: 'ORDERED'` (`orderController.ts:311-322`).

**Impact**

- Confidential artwork URL disclosure to the attacker via the order response.
- Integrity corruption of the victim's design (`orderId`, status).
- Possible production confusion: admin sees the victim's artwork attached to the attacker's order.

**Required fix**

- Re-validate every `customConfigurations[].designId` in `updateCartItemQuantity` exactly as `addItemToCart` does.
- In `createOrder`, scope design reads to `{ _id: designId, userId: req.user.id }`; reject mismatch.
- Scope the post-order `findByIdAndUpdate` with `{ _id: designId, userId: req.user.id }` and verify `matchedCount`.
- Add regression tests for cross-user design references in cart update and order creation.

### SF-003 - Guest bulk-order design attachment and email attribution (High)

**Production blocker: YES**

`createBulkRequest` is `optionalAuth`. When the caller is unauthenticated and the supplied email does not match an existing account, `resolvedUserId` is undefined, so the design lookup uses only `_id` (`bulkOrderController.ts:187-212`). Any `CustomDesign` ID can be attached. If the email does match an existing user, the request is attributed to that user without proving control of the email.

**Impact**

- Cross-user design reference in bulk requests.
- Request attribution spoofing to an existing account.
- Admin workflow confusion and potential artwork disclosure.

**Required fix**

- Require authentication for design attachment; or require a verified email/inquiry token.
- When unauthenticated, reject `customDesignId` unless it belongs to a guest inquiry record created in the same session.
- Do not resolve an arbitrary existing user by email alone; require email verification before linking a request to an account.
- Add regression tests for guest + victim design ID and for an unauthenticated email collision.

### SF-007 - `SUPER_ADMIN` missing in custom design read/update (Low)

`customDesignController.ts:155,192` checks `req.user.role !== "ADMIN"` rather than an allowlist including `SUPER_ADMIN`. This blocks super-admins from those two operations but does not grant unauthorized access. Fix for consistency.

## 3. Verified Non-Issues

- Orders, addresses, invoices, support tickets, shipments, and tracking are ownership-scoped.
- Refund routes are admin-only.
- Shipment routes are admin-only.
- Upload deletion is admin-only (UF-003 closed as false positive).
- Payment verification is signature-first and ownership-scoped.
- Public tracking uses a high-entropy token hash with TTL and an explicit field allowlist; no address/phone/payment leakage.

## 4. Authorization Acceptance Criteria

1. Every route that returns or mutates a user-owned resource has a server-side ownership predicate.
2. Every client-supplied object ID is validated against the authenticated principal before use.
3. `SUPER_ADMIN` is consistently included in admin role checks.
4. Cross-user tests exist for cart update, order creation, custom designs, bulk requests, invoices, addresses, returns, and refunds.
5. Global authorization middleware is not a substitute for per-resource ownership checks.
