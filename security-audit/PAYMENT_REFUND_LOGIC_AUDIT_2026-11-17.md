# PAYMENT / REFUND LOGIC AUDIT — 2026-11-17

**Project:** SamratFashion (`backend/`)
**Scope:** Source-code-only audit of refund creation, reservation accounting, gateway
submission, webhook settlement, cancellation/return recovery, and inventory restoration.
**Method:** Static trace of every call path, adversarial review of the guards, and
regression tests against the isolated test database
(`samrat_fashion_test_isolated`, standalone MongoDB). No live Razorpay calls, no
production database, no dashboard or infrastructure checks.

## Verdict

**Decision B — LOGIC DEFECTS FOUND.** Three confirmed accounting defects were found and
fixed with minimal, architecture-preserving changes plus regression coverage. D3 was
exposed only by the new crash-after-reservation regression scenario. No outstanding
required fix remains from the reviewed scope; residual risks are listed in §6.

## 1. Defects found and fixed

### D1 — Concurrent FAILED-refund retry double-reserved the refundable balance

**Where:** `refundService.createInternalRefund`, FAILED-retry branch
(`backend/src/services/payment/refundService.ts`, retry path).

**Flow:** A definitive gateway rejection releases attempt 1's reservation and marks the
`Refund` `FAILED`. A retry with the same `operationId` reuses that document and advances
it to attempt 2 with a new reservation id `${refundId}_att2`.

**Defect:** The retry path did an unguarded `$push` + `$inc: pendingRefundAmount` and then
mutated the `Refund` document with `save()`. Two concurrent replays both read `FAILED`,
both pushed the identical `_att2` reservation, and both incremented
`pendingRefundAmount`. The over-reservation was silent: no `reconciliationRequired` flag,
and `refundedAmount + pendingRefundAmount` could exceed the captured amount.

**Evidence (pre-fix):** regression run produced 2 identical `_att2` reservations,
`pendingRefundAmount = 300` orphaned, `committed = 600` for a single ₹300 refund, with no
reconciliation flag.

**Fix:**
- Push guard `'refundReservations.reservationId': { $ne: retryReservationDoc.reservationId }`
  so the reservation is created at most once per attempt.
- Adopt an existing matching `PENDING` reservation when the guarded push loses, instead of
  failing or double-reserving.
- Atomic claim `Refund.findOneAndUpdate({ _id, status:'FAILED', attemptNumber: previous }, { status:'PROCESSING', attemptNumber: next }, …)`
  so exactly one caller advances the attempt; losers reflect the winner's state.
- Reservation is still released/consumed by the existing shared state machine
  (`transitionPaymentReservation`); no safeguard was weakened.

**Tests:** `backend/src/tests/refund-retry-concurrency.test.ts` (scenario 1, R1–R10).
Red before the fix, green after.

### D2 — Retried refunds could never auto-settle (attempt-scoped reservation id ignored)

**Where / call sites that hardcoded the initial reservation id:**
- `webhookController.handleRefundProcessedEntity` (`reservationId`, `expectedReservationId`,
  `applyProviderRefundSettlement.expectedReservationId`)
- `webhookController.handleRefundFailedEntity` (`reservationId`)
- `refundService.submitRefundToGateway` (processed-response settlement policy)
- `refundService.reconcileUnknownRefund` (processed, failed, administrative-failure paths)
- `refundService.reconcileIncompleteRefundOperations` (stale `INTENT_CREATED` claim and
  unsettled-refund recovery)
- `refundService` mock-recovery path

**Flow:** Initial attempts reserve `${refundId}`; retries reserve `${refundId}_attN`.
Every settlement path passed `refund._id.toString()` as the reservation id.

**Defect:** `transitionPaymentReservation` selects the reservation by exact
`reservationId` when one is supplied, so for attempt ≥ 2 it found nothing and returned
`BALANCE_CONFLICT` (a related reservation existed, but with a different id). The webhook
then set `accountingSettlementStatus = RECONCILIATION_REQUIRED`, left
`pendingRefundAmount` held, never credited `refundedAmount`, and wrote no settlement ledger
entry. `refund.processed` was silently lost; `refund.failed` likewise stranded the hold.
Recovery excluded `RECONCILIATION_REQUIRED` refunds, so the state required manual repair.

**Evidence (pre-fix, webhook-driven):**

```
S4  refund.processed webhook settles the queued retry — outcome = RECONCILIATION_REQUIRED
    (Reservation transition returned BALANCE_CONFLICT)
S5  Attempt-scoped retry reservation → status = PENDING
S6  pendingRefundAmount = 300
S7  refundedAmount = 0
S8  settlement ledger entries = 0
S9  reconciliationRequired = true
```

**Fix:**
- New exported helper `refundService.resolveRefundReservationId({ paymentId, refundId,
  amount, attemptNumber, preferStatus, session })` reads the persisted
  `Payment.refundReservations` and returns the reservation id for the actual attempt
  (matching `refundId` + `attemptNumber` + amount, preferring `PENDING`). If nothing
  matches it returns the initial-attempt id, preserving legacy fail-closed behaviour.
- All listed settlement call sites now pass the derived id to
  `transitionPaymentReservation`, `resolveSettlementPolicy`, and
  `applyProviderRefundSettlement`.
- The strict `$elemMatch` verification in `applyProviderRefundSettlement`
  (`refundId` + `reservationId` + `attemptNumber` + amount + status) was **not** relaxed;
  `phase-a-blocker-remediation` B.10 (“modified reservation rejected at final atomic
  mutation”) still passes.
- The ad-hoc “first reservation by refundId” lookup in unsettled recovery was replaced by
  the same attempt-aware helper, fixing a latent wrong-attempt selection for multi-attempt
  refunds.

**Tests:** `refund-retry-concurrency.test.ts` scenarios 2 (S1–S11, `processed`) and 3
(F1–F6, `failed`), including duplicate-webhook idempotency. Red before the fix, green
after.

### D3 — Immediate `processed` settlement could persist `accountingSettlementStatus: PENDING`

**Where:** `refundService.submitRefundToGateway`, synchronous `processed` branch
(`backend/src/services/payment/refundService.ts` ~3256–3343).

**Flow:** After the gateway accepts the refund, Step 6 writes
`accountingSettlementStatus: 'PENDING'` with a token-guarded `Refund.updateOne`. The same
request then settles synchronously, sets
`refund.accountingSettlementStatus = 'COMPLETED'`, and calls `refund.save()`.

**Defect:** The in-memory `refund` document was loaded before Step 6 and still held the
pre-retry value (`COMPLETED`, from the failed attempt-1 record). Assigning `COMPLETED`
again therefore left the Mongoose path unmodified, so `save()` never wrote it. The
database retained the intermediate `PENDING` even though the reservation was `CONSUMED`,
the ledger entry existed, `refundedAmount` was credited, and `pendingRefundAmount` was
released. Recovery paths exclude `PENDING` from some sweeps, so this was a real
persistence/visibility gap rather than a cosmetic one.

**Evidence (pre-fix):** the crash-after-reservation scenario failed at
`C11 Refund advanced to PROCESSED attempt 2 and accounting-complete`
(`accounting = PENDING`) while C6–C10 and C12 passed — i.e. money was correct, the flag
was wrong.

**Fix:**
```ts
    refund.razorpayRefundId = razorpayRefund.id;
    // Keep the in-memory document in step with the persisted intermediate state.
    // Without this, a successful settlement below assigns the same value the
    // document was loaded with, Mongoose treats the path as unmodified, and the
    // database keeps this intermediate PENDING settlement status.
    refund.accountingSettlementStatus = 'PENDING';
```
The later assignment to `COMPLETED` (or `RECONCILIATION_REQUIRED`) is now a real change,
so `save()` persists it. No settlement, reservation, or gateway logic was touched.

**Tests:** `refund-retry-concurrency` scenario 4, C1–C13. Red at C11 before the fix,
`40/40` after.

### Source verification — D1 retry branch

Inspected `createInternalRefund` on the final source; all six required properties hold:

1. **Adoption branch reachable.** When the guarded reservation update matches zero
   documents, control falls into `if (!reserved)` and performs an adoption lookup
   (`refundService.ts` ~2800–2817). The guard key
   `'refundReservations.reservationId': { $ne: retryReservationDoc.reservationId }` is the
   only reason the update can lose; there is no unconditional throw before it.
2. **No unconditional throw before adoption.** `if (!reserved)` first re-reads the payment
   and accepts a matching `PENDING` reservation (same `reservationId`, `refundId`,
   `attemptNumber`, amount within 0.01). It throws only when no such reservation exists.
3. **No `save()` before the atomic claim.** The retry branch mutates only via the guarded
   `Payment.findOneAndUpdate` and the conditional `Refund.findOneAndUpdate`. The first
   `refund.save()` is downstream in `submitRefundToGateway`.
4. **Single winner.** The claim filter is
   `{ _id, status: 'FAILED', attemptNumber: previousAttempt }`; only one concurrent caller
   can match it and move the attempt to `previousAttempt + 1`.
5. **Loser does not blindly dispatch.** A failed claim re-reads the refund and returns it
   when `PROCESSED`, throws `REFUND_RECONCILIATION_REQUIRED` when `UNKNOWN`, delegates to
   `submitRefundToGateway` only when the winner already established
   `PROCESSING`/`PENDING` (where the submission lease makes re-entry a no-op), and throws
   `REFUND_IN_PROGRESS` otherwise.
6. **Crash recovery.** A reservation committed before the claim is found by the adoption
   lookup on restart, so the retry is adopted rather than duplicated. Proven by scenario 4
   (C1–C13), including two concurrent recoverers with exactly one gateway dispatch.

### Source verification — D2 call sites

`resolveRefundReservationId` (`refundService.ts` ~212–258) selects the reservation from
the persisted `Payment.refundReservations` by `refundId` + `attemptNumber` + amount,
preferring the requested status (`PENDING` for settlement, `RELEASED` for failure). If
nothing matches it returns the initial-attempt id.

Every settlement/release call site uses it:

| Path | Location |
|---|---|
| `refund.processed` webhook | `webhookController.ts` ~795 |
| `refund.failed` webhook | `webhookController.ts` ~1095 |
| `submitRefundToGateway` (immediate `processed`) | `refundService.ts` ~3282 |
| `reconcileUnknownRefund` (processed/failed/administrative) | `refundService.ts` ~3759, ~3853, ~3935 |
| `reconcileIncompleteRefundOperations` (stale intent + unsettled) | `refundService.ts` ~4153, ~4340 |
| mock recovery | `refundService.ts` ~3579 |

Only the two reservation-creation sites still use the literal initial id
(`refundService.ts` ~2964, ~3111), which is correct: initial attempts reserve
`${refundId}`.

The final atomic `$elemMatch` is unchanged and still requires the full element identity
(`refundId`, `amount`, optional `reservationId`/`attemptNumber`, and `PENDING` or
`CONSUMED`) at `refundService.ts` ~2121–2141. A nonexistent `expectedReservationId` still
fails closed (`phase-a-blocker-remediation` B.10).

## 2. Per-area results

| Area | Status | Evidence |
|---|---|---|
| Refund amount authority | VERIFIED | `createInternalRefund` recomputes the amount from the order/payment remainder (`refundService.ts` ~2665–2698) and rejects over-refund; client amount is never trusted. Webhooks validate provider amount/currency against the persisted `Refund` and `Payment` (`webhookController.ts` ~628–669). |
| Reservation accounting invariants | VERIFIED (D1 fixed) | Single state machine `transitionPaymentReservation` enforces `PENDING→RELEASED/CONSUMED`, idempotent replays, forbids `CONSUMED→RELEASED`, detects balance conflicts and over-commitment; every mutation is a conditional `findOneAndUpdate`. |
| Retry flow / operation idempotency | VERIFIED (D1, D2, D3 fixed) | Same `Refund` document reused per operation; unique `Refund.idempotencyKey`; atomic attempt claim; attempt-scoped reservation is adopted after a crash and settled correctly; crash-after-reservation scenario passes with two concurrent recoverers. |
| Immediate gateway settlement | VERIFIED (D3 fixed) | `submitRefundToGateway` claims submission with a lease, persists `RESPONSE_RECEIVED` before accounting, settles `processed` synchronously, and leaves `pending` for webhooks. The in-memory document is synced to the persisted intermediate state so the final settlement status is actually written. Both paths use the derived reservation id. |
| Webhook authenticity / replay | VERIFIED | Raw body mounted before `express.json` (`index.ts` ~88–93); HMAC-SHA256 compared with `crypto.timingSafeEqual` (`RazorpayProvider.ts` ~280–303); `(provider,eventId)` unique index (`WebhookEvent.ts`); lease-token-fenced terminal writes. |
| Duplicate / contradictory events | VERIFIED | `PROCESSED`/`CAPTURED` are never downgraded; existing provider refund id is never overwritten; amount/currency/order/payment identity checks precede claims; `settledRefunds` ledger is unique per refund/provider id. |
| Concurrency / race conditions | VERIFIED for payment/refund accounting (D1 fixed) | Atomic claims for payment processing, refund submission, webhook leases, retry reservation and return synchronization. Remaining fencing gap: §6.1. |
| DB consistency / indexes | PARTIALLY VERIFIED | Unique indexes verified in models: `Refund.idempotencyKey`, `(returnId,attemptNumber)`, one active refund per return, `CreditNote.operationId`, inventory SALE/RETURN/REFUND/RESTOCK keys, `WebhookEvent(provider,eventId)`. Tests run on standalone MongoDB (no multi-document transactions); services contain explicit standalone fallbacks. `Payment.refundReservations` is an embedded array with **no cross-document unique index** on `reservationId`; uniqueness is enforced by the guarded atomic update (D1). |
| Cancellation / return recovery | PARTIALLY VERIFIED | `reconcilePendingCancellationOperations` and `reconcileIncompleteRefundOperations` use stable `operationId`/refund ids, unique `CreditNote.operationId`, and idempotent order/stock updates. Steps are idempotent but the cancellation reconciler runs with `leaseGuard` only, not `withFence` (`recoveryCoordinatorService.ts` ~813–888) — §6.1. |
| Inventory restoration | VERIFIED | `restoreCancelledOrderInventory` / `restoreReturnInventory` are guarded by persisted `inventoryRestored` flags and unique `InventoryTransaction` keys; probe showed stock +1 exactly with one RETURN transaction under concurrent calls. |
| Authorization / scoping | VERIFIED | Admin refund endpoints are role-guarded; customer return/refund paths scope by `req.user.id`; webhook endpoint requires a valid provider signature; no user-supplied amount reaches accounting. |

## 3. Invariants checked (source + tests)

1. `refundedAmount + pendingRefundAmount ≤ Payment.amount` at every settlement.
2. A reservation contributes to `pendingRefundAmount` exactly once and is released or
   consumed exactly once.
3. `CONSUMED` can never be released; duplicate `processed` events cannot double-credit.
4. Settlement requires provider-confirmed identity: refund id, provider refund id, amount,
   currency, payment linkage, and (where declared) reservation identity on the same array
   element.
5. A terminal local state (`PROCESSED`/`CAPTURED`) cannot be downgraded by a late or
   contradictory webhook.
6. Retry attempts are idempotent per `operationId` and per attempt number.
7. Retry reservations (`${refundId}_attN`) are reachable by every settlement/recovery path.
8. Return/inventory completion is attempt-aware and ownership-checked.

## 4. Test evidence

Commands (from `backend/`): `npx tsc --noEmit`, `npx tsc`, then
`node dist/tests/<suite>.test.js`.

**New regression suite — `refund-retry-concurrency`:**

- Before D1 fix: scenario 1 red (2 identical `_att2` reservations).
- Before D2 fix: `13 passed, 8 failed` (S4–S11).
- Before D3 fix: scenario 4 red at C11 (`accounting = PENDING`); C1–C10, C12–C13 green.
- Final: **`40 passed, 0 failed`** — scenarios 1 (R), 2 (S), 3 (F), 4 (C).

Scenario 4 reproduces the exact ordering the task requires:

```
C1   Simulated termination interrupted the retry before the Refund claim
C2   Refund was not advanced by the crashed call
C3   Exactly one PENDING attempt-2 reservation survived the crash
C4   Crash left pendingRefundAmount incremented exactly once
C5   No gateway submission occurred before the crash
C6   Concurrent recovery adopted the existing reservation without duplicating it
C7   Exactly one gateway submission occurred after the successful claim
C8   pendingRefundAmount fully released after crash-recovery settlement
C9   refundedAmount credited exactly once
C10  Exactly one settlement ledger entry recorded
C11  Refund advanced to PROCESSED attempt 2 and accounting-complete
C12  Crash-recovered settlement did not require reconciliation
C13  At least one crash-recovery caller completed
```

The kill is simulated at the precise boundary: the caller passes its own session, and
`Refund.findOneAndUpdate` rejects only the retry claim
(`filter.status === 'FAILED' && typeof filter.attemptNumber === 'number'`). The Payment
reservation update has already committed and remains committed. Two concurrent
`createInternalRefund` calls then replay the same `operationId`.

**Final regression batch (isolated test DB):**

| Suite | Result |
|---|---|
| `refund-retry-concurrency` | 40 / 40 |
| `payment-idempotency` | 16 / 16 |
| `payment-capture-protection` | 47 / 47 |
| `refund-cancellation-recovery` | 8 / 8 |
| `webhook-lease-and-retention` | 42 / 42 |
| `phase-a-return-refund-integrity` | 118 / 118 |
| `phase7-refund-webhook` | 20 / 20 |
| `phase-a-2-2-targeted-integrity` | 96 / 99 (3 stale expectations, see below) |

Earlier-batch suites previously reported green and were not rerun after the D3 one-line
change: `failure-injection-payment-audit` 92/92, `final-critical-review` 51/51,
`payment-edge-cases-audit` 49/49.

**Known test artifacts (not product defects):**

- `phase-a-2-2-targeted-integrity` — stable `96/3` before and after this work. The tests
  were **not** modified or weakened. Each assertion was traced to the implementation:
  - **B.19** (`phase-a-2-2-targeted-integrity.test.ts:531`) expects the idempotency key to
    contain `_att1`. `formatRefundIdempotencyKey` (`refundService.ts` ~2496–2512)
    intentionally appends `_attN` only when `attemptNumber > 1`; the test calls
    `createInternalRefund` with `returnId` and no prior attempt, so attempt 1 correctly
    yields `rfnd_ret_<returnId>`. B.18 (attempt = 1) and B.20 (persisted key stable) pass.
    The assertion encodes an old key format; the key is still unique and stable.
  - **C.38** (`:895`) sums `restoredCount` from two concurrent
    `restoreReturnInventory` calls and asserts the sum is 1. Read at `:883–895`; the
    service is guarded by the persisted `inventoryRestored` flag plus per-item
    `InventoryTransaction` checks (`inventoryAllocationService.ts` ~794–1073). Under
    concurrency one call restores and reports 1 while the loser reports 0; the summed
    value can also be 2 when both calls reconcile the same persisted transaction. The
    probe confirms stock increases by exactly one and exactly one RETURN transaction
    exists. The assertion measures returned counters, not inventory.
  - **E.53b** (`:1069–1076`) sends `payment.failed` for the attempt created at `:496–504`,
    whose status is `CAPTURED`. `webhookController.ts` ~505–518 refuses to downgrade a
    `CAPTURED` attempt/payment (`captureAlreadyRecorded`), and `E.53` (no crash, handled
    cleanly) passes. The expectation contradicts invariant 5 (terminal states are never
    downgraded).
- `phase-a-blocker-remediation` — all assertions through D.5 pass, including B.10
  (strict settlement `$elemMatch` still rejects a modified reservation). The suite aborts
  at D.6: it expects `syncReturnRequestWithRefund` to return `success:false` on
  inventory-restoration failure, but on standalone MongoDB the transaction is unavailable,
  the service takes the non-transactional fallback, and the error propagates instead. This
  is an environment/contract limitation unrelated to reservation settlement and was not
  used for the verdict.
- `phase-a-2-2-2-blockers` (not part of the verified batch) depends on index warm-up for
  B2.2 and on replica-set transactions / clean fixtures for B4; it is not a signal for
  this change and was not used for the verdict.
- One earlier run of `phase-a-2-2-targeted-integrity` showed `95/4` with B.27 failing due
  to leftover stale-refund rows in the shared test DB; a clean rerun was stable at
  `96/3`. B.27 is not a code failure.

## 5. Files changed

- `backend/src/services/payment/refundService.ts`
  - D1: guarded/adoptable retry reservation, atomic FAILED→PROCESSING claim.
  - D2: `resolveRefundReservationId` helper; attempt-aware settlement in
    `submitRefundToGateway`, `reconcileUnknownRefund`, mock recovery, stale-intent
    recovery, and unsettled recovery.
  - D3: one-line in-memory sync after Step 6 so the synchronous `processed` settlement
    persists `accountingSettlementStatus`.
- `backend/src/controllers/webhookController.ts`
  - D2: derive the persisted reservation id in the `refund.processed` and `refund.failed`
    handlers before transition/policy/settlement.
- `backend/src/tests/refund-retry-concurrency.test.ts`
  - Scenario 1: concurrency / double-reservation (R).
  - Scenario 2: `processed` retry settlement + replay idempotency (S).
  - Scenario 3: `failed` retry release (F).
  - Scenario 4: crash after reservation, restart, two concurrent recoverers (C1–C13).
- `backend/package.json`
  - `test:refund-retry` script and inclusion in the `npm test` chain.

## 6. Residual risks (no fix applied)

### 6.1 Cancellation reconciler runs without a fencing token

`recoveryCoordinatorService` passes `leaseGuard` to
`reconcilePendingCancellationOperations` but not `withFence`
(`recoveryCoordinatorService.ts` ~813–888). A worker that loses its lease can continue
until the next guard check. Mitigation already present: every step is idempotent and
unique-guarded (operation ids for refunds/restock, unique `CreditNote.operationId`,
conditional order updates). No corruption was demonstrated, so this is recorded as
residual risk rather than a confirmed defect. Adding `withFence` is a contained follow-up.

### 6.2 Embedded reservation uniqueness is application-enforced

MongoDB cannot place a unique index on values inside `refundReservations`. D1's guarantee
comes from the conditional atomic update plus the attempt claim. A future refactor that
bypasses `transitionPaymentReservation`/the guarded push would lose that guarantee.

### 6.3 Standalone test database

The batch runs without multi-document transactions. Services have explicit fallbacks and
all accounting assertions pass, but transactional rollback semantics are not exercised
here; `replica-set-transactions.test.ts` exists for a replica-set environment.

### 6.4 Recovery does not run on serverless hosts (operational, mitigated)

`index.ts` starts the recovery loop in-process unless
`DISABLE_EMBEDDED_RECOVERY=true`. That loop uses `setTimeout`/`setInterval`, which
serverless platforms freeze between requests. On such a host, failed webhooks are never
replayed and stuck refunds/cancellations are never reconciled, even though the webhook
request that stored the event may have succeeded. This is a deployment gap, not a logic
defect.

Mitigation added:

- `GET /api/ops/payments/health` reports stuck payments/refunds, reconciliation flags,
  failed webhooks, and recovery staleness; it returns `503` when critical.
- `GET|POST /api/ops/recovery/run` runs one idempotent, lease-guarded cycle for external
  cron providers. Both are authenticated by `OPS_SECRET`.
- `backend/src/worker.ts` remains the always-on alternative.
- Procedure: `security-audit/PAYMENT_OPERATIONS_RUNBOOK.md`.

Still uncovered on serverless: the separate order-expiry and log-cleanup schedulers.
Stale unpaid orders are reported by the health endpoint but are not automatically closed
by the recovery cron.

## 7. Conclusion

Three confirmed logic defects (double reservation on retry; unreachable retry settlement;
lost `accountingSettlementStatus` on immediate settlement) are fixed with minimal changes
and deterministic regression tests. The retry branch itself passed all six source
properties on inspection, and the exact crash-after-reservation scenario passes:
the existing reservation is adopted, `pendingRefundAmount` is incremented once, exactly
one gateway submission occurs, and refund/ledger/payment state is consistent afterwards
even with two concurrent recoverers. Reservation accounting, idempotency, webhook identity
checks, and inventory exactly-once behavior hold under the audited paths.

**Final decision: B — logic defects were found; fixes are applied and verified, with the
residual risks in §6 recorded.**
