# Production Sign-Off Certification

**Project:** Samrat Fashion (backend Express + TypeScript, frontend Next.js)
**Date:** 2026-09-19
**Certification basis:** audited scope + automated test execution on local MongoDB (`127.0.0.1:27017`) plus compiler/linter/code-scan checks.

---

## 1. Audit scope

- **Auth & session lifecycle:** login timing equalization, session rotation (family ID + token salt), reuse revocation, bounded legacy-session sweep, CSRF origin guard on `/refresh` + `/logout`.
- **Payment / refund / inventory:** order creation → payment (create / verify / capture) → atomic stock deduction (SALE transaction, idempotent), oversell prevention, refund reservation (`Payment.pendingRefundAmount`), `refund.processed` / `refund.failed` webhook handling, return-stock restoration, PENDING-order expiry reaper, payment retry guard.
- **Money unit correctness:** catalog / cart / checkout / orders / analytics expressed in rupees; paise only at the gateway boundary and inside the intentionally paise-denominated bulk-quote and print-catalog subsystems.
- **Coupons, admin search/pagination (reviews, tickets), catalog/category validation, pricing engine + per-design ownership, invoice numbering (Counter).**
- **Hygiene:** mongoose `new:true` → `returnDocument:'after'` deprecation sweep (27 sites / 15 files), error-handling behavior, observability dead-code removal, TypeScript strictness, ESLint.
- **Frontend:** money fixes carried through the UI, full logout (server revocation + local wipe), access-token refresh with BroadcastChannel peer handoff, cart/wishlist cross-tab live sync.
- **Out of scope by design:** uncounted product defects, third-party service completion, visual/UX design quality, and behavior not covered by the executed suites mentioned below.

## 2. Fixes completed

All ~30 audit items from the engagement, plus the four closing gaps:

1. **PENDING-order expiry reaper** — `backend/src/services/orderExpiryService.ts`; adds `EXPIRED` to `Order.status`; `startOrderExpiryScheduler()` starts after DB connect (skips `NODE_ENV=test`); age/interval configurable via `ORDER_EXPIRY_MS` / `ORDER_EXPIRY_INTERVAL_MS`. Atomic guard re-checks `status`/`paymentStatus`; paid and in-flight orders (AUTHORIZED/PROCESSING/CAPTURED attempts) are never expired; idle attempts failed with `PAYMENT_EXPIRED`; stock is never mutated (no pre-payment reservation exists). `createPaymentOrder` rejects retries on `EXPIRED`/`CANCELLED` orders.
2. **Cart/wishlist cross-tab sync** — `frontend/src/lib/crossTabChannel.ts` + `frontend/src/lib/crossTabSync.ts`, initialized in `AuthProvider`; publishes only after user-initiated local mutations; receipts silently re-fetch from the server (no feedback loop); logout broadcast clears sibling-tab state.
3. **Refund webhook tests** — `webhookController.ts` refactored to export `handleRefundProcessedEntity` / `handleRefundFailedEntity` (DB-layer, directly testable); new `phase7-refund-webhook` suite.
4. **Mongoose deprecation sweep** — all `new: true` update options migrated to `returnDocument: 'after'`.

Also: `updatePipeline: true` on the pipeline `findOneAndUpdate`; the security/auth/coupon/refund/money/admin search fixes listed in the prior readiness report.

## 3. Test suites and exact pass counts (`node dist/tests/*.test.js`)

| Suite | Passed | Failed |
|---|---|---|
| phase6-cart | 11 | 0 |
| phase6-inventory | 7 | 0 |
| phase6-order-snapshot | 23 | 0 |
| phase6-pricing | 20 | 0 |
| phase6-printzone | 11 | 0 |
| phase6-production-status | 36 | 0 |
| phase6-renderer | 23 | 0 |
| phase6-security | 9 | 0 |
| phase6-versioning | 15 | 0 |
| phase7-asset-storage | 23 | 0 |
| phase7-e2e-walkthrough | 30 | 0 |
| phase7-immutability | 13 | 0 |
| phase7-load-benchmark | 10 | 0 |
| phase7-manual-mockup | 48 | 0 |
| **phase7-order-expiry (new)** | **11** | 0 |
| phase7-payment-inventory | 8 | 0 |
| **phase7-refund-webhook (new)** | **17** | 0 |
| pricing (main) | 6 | 0 |
| phase6-performance | exit 0 (no per-check printer) | 0 |

**Total: 321 automated checks passing, 0 failing** across 19 runnable suites. `customDesign.test.js` cannot run locally — see section 6.

## 4. Typecheck / lint results

- Backend `npx tsc --noEmit`: **0 errors**; production build (`npx tsc` → `dist`): clean.
- Frontend `npx tsc --noEmit`: **0 errors**.
- Frontend ESLint (`src`): **0 errors, 15 warnings** — all pre-existing (`@next/next/no-img-element`, `react-hooks/exhaustive-deps`), non-blocking.

## 5. Security / payment / inventory verification

- **Security (phase6-security 9/9):** session family/grace rotation, reuse revocation, legacy-session bounded sweep, login timing equalization, CSRF origin guard, token-boundary behavior; no session/secret material exposed in public catalog responses.
- **Payment & inventory (phase7-payment-inventory 8/8):** stock deducted atomically exactly once on capture; no deduction on payment failure; preserved across abandoned/retried payments; oversell prevented (stock never negative, no phantom transaction).
- **Refund pipeline (phase7-refund-webhook 17/17):** `refund.processed` / `refund.failed` transitions, reservation release, full vs partial semantics, idempotent replays, CANCELLED-order stock restoration.
- **Expiry reaper (phase7-order-expiry 11/11):** stale-idle expiration, `PAYMENT_EXPIRED` attempt failure, in-flight/paid/fresh protection, atomic guard semantics, zero stock mutation.
- **End-to-end (phase7-e2e-walkthrough 30/30):** full checkout-to-confirmation path.
- **Secret scan:** no real credentials (`sk_live_*`, `rzp_live_*` keys, `AKIA*`, private-key blocks) in the tracked tree or in `backend/dist` build output; the only match is the `rzp_live_...` placeholder in `RAZORPAY_LIVE_CHECKLIST.md`. Only `.env.example` is tracked; real `.env` / `.env.local` are untracked and gitignored.

## 6. Remaining intentional limitations

- **`customDesign.test.js`** requires the optional dev dependency `mongodb-memory-server`, which is not installed; this standalone suite is excluded from the runnable set and does not exercise the production code path.
- **Real Razorpay sandbox validation** still requires live credentials; webhook semantics are verified at the DB layer only, so signed live-payload replay is pending credentials.
- **BroadcastChannel fallback:** browsers without `BroadcastChannel` silently degrade to per-tab state; the server remains the source of truth.
- **Cosmetic mongoose Buffer warning** may appear in some environments; no behavioral impact.
- **Working-tree artifacts:** test runs generated untracked `backend/uploads/…/production-assets/*` output (regenerable, not code, not committed).

## 7. Deployment prerequisites

- Set **all** env vars enforced at boot by `validateProductionEnv()` (`backend/src/config/env.ts`): `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (strong, rotated), `MONGODB_URI`, `RAZORPAY_KEY_ID` (must not be `dummy_key`), `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`; plus the conditional sets when providers are selected: `DELHIVERY_API_TOKEN`, `BREVO_API_KEY` / `EMAIL_FROM`, `CLOUDINARY_CLOUD_NAME` / `API_KEY` / `API_SECRET`. Placeholders are available in the committed `.env.example`.
- **Do not** set `ALLOW_PAYMENT_MOCK=true` in production (payment requests reject without a real `RAZORPAY_KEY_ID`).
- Configure the Razorpay webhook URL to the backend `/api/webhooks` (raw-body signature verification) and match `RAZORPAY_WEBHOOK_SECRET`.
- Frontend: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_RAZORPAY_KEY_ID` (public by design), `NEXT_PUBLIC_GA_MEASUREMENT_ID`; backend `FRONTEND_URL` for CORS-with-credentials.
- The order-expiry scheduler ships as an in-process interval and starts automatically in production (no cron dependency); tune via `ORDER_EXPIRY_MS` / `ORDER_EXPIRY_INTERVAL_MS` if the deployment environment requires different timing. No cron infrastructure is introduced unless required by the deployment.
- Persist MongoDB; ensure the `/uploads` directory is writable; `app.set("trust proxy", 1)` is active under `NODE_ENV=production`.

## 8. Final statement

Within the audited scope and tested behavior defined in section 1, **no known unaddressed functional bugs remain.** This certification is explicitly limited to that scope and to the executed test suites; it does not assert that every possible defect across the entire application is impossible.