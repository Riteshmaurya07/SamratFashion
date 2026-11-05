# PAYMENT AND WEBHOOK AUDIT

**Project:** SamratFashion  
**Audit Date:** 2026-11-05  
**Verdict:** Controls are substantially stronger than the prior preliminary assessment, with one release-evidence blocker and one residual hardening item.

## 1. Payment Verification

### Verified controls

- **Server-side signature verification:** `verifyPayment` requires `razorpay_payment_id`, `razorpay_order_id`, and `razorpay_signature`, then verifies with the provider before any state change (`backend/src/controllers/paymentController.ts:101-118`).
- **Ownership:** the attempt is loaded by gateway order ID, then the order is loaded with `userId: req.user.id`; a mismatch returns 404 (`paymentController.ts:121-126`).
- **State/amount checks:** rejected failed attempts and attempt/order amount mismatch are rejected (`paymentController.ts:128-136`).
- **Mock isolation:** tests set `RAZORPAY_KEY_ID=rzp_test_mock`; `RazorpayProvider.getClient()` fails closed for test credentials (`backend/src/tests/testHelpers.ts`; `RazorpayProvider.ts`).
- **Idempotency:** a PAID non-cancelled order returns success without re-deducting stock; a cancelled order returns `ORDER_CANCELLED` (`paymentProcessor.ts:61-69`).
- **Concurrency:** exactly one processor wins the atomic `PENDING -> PROCESSING` claim; losers poll for a terminal outcome and can steal a stale claim after 10 seconds (`paymentProcessor.ts:12,71-128`).
- **Inventory:** deduction occurs only after the claim; failures are rolled back and, for real captures, a full auto-refund is initiated (`paymentProcessor.ts:128-195`).
- **Payment/attempt uniqueness:** `Payment.orderId` is unique; `Refund.idempotencyKey` and `razorpayRefundId` are unique; refund attempts have partial uniqueness (`models/Payment.ts`, `models/Refund.ts:41-102`).

### Residual hardening

When an order is already `PAID`, `processPaymentSuccess` assigns the incoming `razorpayPaymentId` to the attempt without comparing it to any stored value (`paymentProcessor.ts:57-65`). Signature verification and the gateway's order-scoped payment IDs make exploitation unlikely, but the safe behavior is:

1. If `attempt.razorpayPaymentId` exists and differs from the incoming value, return `RECONCILIATION_REQUIRED` and alert.
2. Do not overwrite a previously recorded payment ID on an idempotent replay.
3. Add a regression test for conflicting payment IDs on a PAID order.

## 2. Webhook Processing

### Verified controls

- Raw body is mounted only for `/api/webhooks` before JSON parsing (`backend/src/index.ts:87`), which is required for HMAC verification.
- Signature verification occurs before event processing; missing `event_id` is rejected (`webhookController.ts`).
- Unique `(provider,eventId)` index prevents duplicate event records (`WebhookEvent.ts:34`).
- Claim/lease model:
  - A worker atomically claims an event into `PROCESSING` with a unique `leaseToken` and `processingLockExpiresAt`.
  - `renewWebhookEventLease` requires `status: PROCESSING`, the same token, and an unexpired lease (`WebhookEvent.ts:57-88`).
  - The heartbeat renews the lease every third of its duration; a failed renewal marks the lease lost (`WebhookEvent.ts:103-126`).
  - Terminal writes are fenced by the lease token, so a stale worker cannot mark the event processed or failed (`webhookController.ts:159-210`; test A.2.15).
  - Expired `PROCESSING` events are recovered to `FAILED` for safe replay (`recoverStaleWebhookEvents`).
- Processed events return a 200 no-op on duplicate delivery; failed events remain retryable; unresolved events never receive an expiry (`logCleanupService`; webhook-lease suite).
- Refund webhooks validate amount, currency, payment IDs, and refund IDs before transition (`webhookController.ts`; tests F1.1-F1.7).

### Verified behavior for unknown attempts

For `payment.captured`/`order.paid`, if the `PaymentAttempt` cannot be found, `processPaymentSuccess` returns `null`, and the webhook handler returns `RECONCILIATION_REQUIRED` rather than falsely marking the event processed (`paymentProcessor.ts:45-49`; `webhookController.ts:273-283`). This is the correct fail-closed behavior.

## 3. Test Evidence

### Passing

- Main suite includes payment mock isolation, inventory allocations, bulk quote concurrency, refund cancellation/recovery, upload validation, logistics state machine, authoritative pricing, categories, taxonomy, and print workflows: **269/269 passed**.
- `test:webhook-lease`: **35 passed, 7 failed**.
- `test:integrity` (return/refund): **116 passed, 2 failed**.
- `test:remediation`: **285 passed, 0 failed** on a clean isolated DB; an earlier contaminated run was 281/4 (stale event from a timed-out run).

### Failure triage

| Suite | Failing checks | Root cause | App defect? |
|---|---|---|---|
| webhook-lease | 1.3, 1.5, 1.6, 1.7, 2.3, 2.5, 2.14 | Fixtures send `payment.captured` for `order_test_*`/`ord_deliv_*` with no `PaymentAttempt` or order. The app correctly returns `RECONCILIATION_REQUIRED`; tests assert `PROCESSED`. | No - stale fixture |
| integrity | 10.5b, 10.5c | Same missing `PaymentAttempt` fixture; recovery cannot transition a synthetic payment event to PROCESSED. | No - stale fixture |
| remediation | C.6 x4 | Prior run selected a stale `FAILED` event left by a timed-out run instead of the C.6 event. Clean-DB rerun passes all C.6 checks. | No - test isolation |

The 4 `C.6` failures were caused by cross-run test-DB contamination, not a code defect. On a clean DB the stolen-lease path throws `WEBHOOK_LEASE_LOST` with status 409 and leaves the event `PROCESSING`; `C.6b`/`C.6c` also pass. Keep the clean-DB condition in CI (pre-run cleanup or a unique DB per run).

## 4. Release Gates

1. Compare and reject conflicting `razorpayPaymentId` values on an already-PAID order.
2. Fix or quarantine the stale webhook/integrity fixtures; add them to the main CI command only after they pass deterministically.
3. Make `test:remediation` self-cleaning or run it against a unique DB per run; keep the deterministic C.6 assertions (stolen lease -> `AppError` code `WEBHOOK_LEASE_LOST`, status 409, event remains `PROCESSING`) in CI.
4. Keep `ALLOW_PAYMENT_MOCK` forbidden in production/staging and assert it at startup (already implemented).
5. Never expose provider errors or signatures in logs.
