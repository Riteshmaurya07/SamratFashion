# DATABASE AND INTEGRITY AUDIT

**Project:** SamratFashion  
**Audit Date:** 2026-11-05  
**Scope:** Inventory, refunds, payment reservations, webhook events, unique indexes, idempotency, transactions, and migration safety

## 1. Inventory Integrity

### Verified design

`InventoryAllocationService.deductInventory` (`backend/src/services/inventory/inventoryAllocationService.ts:235-310`):

1. For each aggregated allocation, atomically decrements a variant only when `stock >= requested` using `Product.updateOne` with `$elemMatch` and `$inc` (`:246-260`).
2. If the decrement succeeds, writes a `SALE` ledger row (`:262-276`).
3. A duplicate `SALE` (`uniq_sale_order_variant`) is treated as idempotent:
   - Inside a caller-owned transaction it propagates, so the transaction aborts cleanly (`:282-287`).
   - Outside a transaction it reverses only this run's decrement (`:288-293`).
4. Any insufficient-stock result rolls back all allocations deducted in the same run (`:295-303`).

Ledger uniqueness:

- `uniq_sale_order_variant` (`orderId, variantId`, `type: SALE`) - one sale per order/variant.
- `uniq_return_variant` (`returnId, variantId`, `type: RETURN`, valid `returnId`) - one return restock per return/variant.
- `uniq_refund_order_variant` (`orderId, variantId`, `type: REFUND`) - one cancellation refund ledger row per order/variant.
Source: `backend/src/models/InventoryTransaction.ts:36-65`.

### Verified restoration

- Cancelled-order restoration is authoritative and idempotent; it considers both `REFUND` and existing `RESTOCK` records and never deletes the original `SALE` ledger (`inventoryAllocationService.ts:339-507`).
- Return restoration is idempotent and crash-safe (`:586-830`).
- Duplicate or quantity-mismatched restoration fails closed with `INVENTORY_RECONCILIATION_REQUIRED` (`:474,507`).

### Residual risk

- The non-transactional duplicate-key recovery path is correct only if no concurrent writer changes the same variant between decrement and undo. Production must use a replica set and pass a session so the abort path is used. This is an operational requirement, not a code defect.
- `rollbackDeductions` deletes only this run's `SALE` rows. Keep that invariant when modifying the method.

## 2. Refund and Reservation Integrity

### Verified design

`createInternalRefund` (`backend/src/services/payment/refundService.ts:2382-2784`):

- Requires a `PAID` order and `CAPTURED` payment; blocks payments requiring reconciliation.
- Requires a captured attempt with a gateway payment ID.
- Rejects duplicate/terminal/unknown returns and in-flight attempts.
- Computes the refundable remainder as `amount - refundedAmount - pendingRefundAmount`.
- Validates amount precision and rejects zero/negative/NaN/Infinity.
- Reserves atomically on `Payment` with `$expr` guard plus `refundReservations.reservationId != refund._id` (`:2503-2530`).
- Creates a `Refund` with a deterministic idempotency key per return/attempt or order/attempt (`:2555-2578`).
- Uses a 60-second return claim token so concurrent refund attempts cannot both proceed (`:2522-2545`).
- Falls back safely when MongoDB transactions are unavailable, with explicit compensation on reservation failure (`:2600-2720`).

Unique safeguards (`backend/src/models/Refund.ts`):

- `idempotencyKey` unique sparse (`:41`).
- `razorpayRefundId` unique sparse (`:52`).
- `uniq_active_return_refund` prevents concurrent `PENDING|PROCESSING|UNKNOWN` refunds for one return, while allowing late provider success on an older attempt (`:80-92`).
- `uniq_return_attempt` prevents duplicate attempt numbers (`:96-104`).

Payment reservations are embedded in `Payment` and transitioned `PENDING -> CONSUMED|RELEASED` atomically by `transitionPaymentReservation`; settlement is fenced and accounting settlement is only marked complete after verification (`refundService.ts:1017-1206`; tests in `test:integrity` and `test:remediation`).

### Residual risk

- Late/duplicate provider settlements are handled. The `C.6` stolen-lease scenario passes on a clean DB; an earlier failure was cross-run test contamination. See `PAYMENT_AND_WEBHOOK_AUDIT.md`.
- Transactions require a replica set. The standalone fallback is compensatory, not atomic; production must run a replica set.

## 3. Payment Attempt Integrity

- `Payment.orderId` is unique, so one payment document exists per order (`models/Payment.ts`).
- `PaymentAttempt` status claim is atomic (`PENDING -> PROCESSING`), stale claims older than 10 seconds can be stolen, and terminal outcomes are polled (`paymentProcessor.ts:71-128`).
- A PAID non-cancelled order returns idempotent success without re-deducting inventory (`:61-69`).
- Stock failure rolls back partial decrements and, for a real capture, initiates a full auto-refund (`:128-195`).
- Orders with `paymentStatus: PAID` cannot be double-charged through the normal verify or webhook path.

Residual: compare `razorpayPaymentId` before overwriting it on a PAID order (`paymentProcessor.ts:57-65`).

## 4. Webhook Event Integrity

`WebhookEvent` (`backend/src/models/WebhookEvent.ts`):

- Unique `(provider, eventId)` (`:34`).
- Lease lookup index `(provider, status, processingLockExpiresAt)` (`:35`).
- Sparse TTL index on `expiresAt` (`:36`).
- Lease renewal requires `PROCESSING`, matching token, and unexpired lock (`:57-88`).
- Heartbeat stops renewing after a lost lease (`:103-126`).

Retention rules covered by tests: unresolved `PROCESSING`/`FAILED` events are preserved; recovered old events receive a fresh 120-day expiry; only resolved events with expired `expiresAt` are purged. Seven webhook-lease checks still fail on stale fixtures (successful-recovery assertions) and must be corrected before claiming full coverage.

## 5. Transaction and Deployment Requirements

1. **Replica set is mandatory in production.** Refund, inventory, and payment code uses sessions and transactions. The standalone refund fallback is a compatibility path, not a production substitute.
2. **Migrations must be run with preflight.** Webhook TTL, refund index, and inventory index migrations expose preflight/dry-run paths. Apply them before deploying code that assumes the indexes.
3. **Backups/DR were not verified in this audit.** `test:backup-restore` invokes `backend/src/tests/test-backup-restore-e2e.js` and was deliberately not run because it exercises a destructive restore path. Validate in an isolated environment with a disposable database and document RPO/RTO.
4. **No test may connect to production.** `invoice-order-confirmation.test.ts:87` falls back to `process.env.MONGODB_URI`; fix before running broad suites.
5. **Index builds on large collections** should use rolling/background migration and monitor for lock contention.
6. **Ledger immutability:** never delete `SALE`/`RETURN` rows during compensation; use compensating entries and keep the partial unique indexes.

## 6. Acceptance Criteria

- All ledger indexes exist in production and are verified by a preflight script.
- No double deduction under concurrent verify/webhook (test evidence required).
- No refund can exceed `amount - refundedAmount - pendingRefundAmount` under concurrency.
- No duplicate active refund per return; late terminal webhooks are recorded safely.
- Webhook lease fencing passes deterministically, including the `C.6` stolen-lease case.
- Production uses a replica set; standalone fallback is disabled or explicitly monitored.
- Backup/restore has a tested, documented runbook.
