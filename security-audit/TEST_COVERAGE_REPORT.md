# TEST COVERAGE REPORT

**Project:** SamratFashion  
**Audit Date:** 2026-11-05  
**Verdict:** Builds pass. The main suite and clean-DB remediation suite pass. Webhook-lease, integrity, and reverse still have 10 stale-fixture failures and are not part of `npm test`, so the current test evidence is insufficient for production approval.

## 1. Corrected Counts

| Scope | Passed | Failed | Total | Exit |
|---|---:|---:|---:|---:|
| Backend `npm test` (13 groups) | 269 | 0 | 269 | 0 |
| Backend targeted suites (12 runs) | 960 | 10 | 970 | mixed |
| Backend total | 1229 | 10 | 1239 | - |
| Frontend `npm test` (1 suite) | 9 | 0 | 9 | 0 |
| **Grand total** | **1238** | **10** | **1248** | - |

**Count correction:** an earlier note reported 289 for the main backend suite. The fresh log has exactly 13 `Results:` lines summing to **269**. 289 is incorrect and must not be used.

Main suite group counts in execution order: 65, 27, 15, 19, 6, 8, 10, 10, 15, 22, 21, 32, 19 = 269.

## 2. Commands and Results

### Backend build

```powershell
npm.cmd run build --prefix backend
# exit 0
```

Log: `C:\Users\Dell.000\AppData\Local\Temp\opencode\backend-build-20261105-103111.log`

### Backend main suite

```powershell
npm.cmd test --prefix backend
# 13 groups, 269 passed, 0 failed, exit 0
```

Log: `C:\Users\Dell.000\AppData\Local\Temp\opencode\backend-test-20261105-103120.log`

Included: DB guard, Cloudinary cleanup, payment mock isolation, inventory allocations, bulk quote concurrency, refund cancellation/recovery, upload validation, logistics state machine, authoritative pricing, categories, taxonomy/custom-print, bulk redesign, print placement/pricing.

### Backend targeted suites

| Command | Passed | Failed | Exit | Log |
|---|---:|---:|---:|---|
| `npm.cmd run test:custom-print --prefix backend` | 101 | 0 | 0 | `suite-20261105-103303\custom-print.log` |
| `npm.cmd run test:log-cleanup --prefix backend` | 20 | 0 | 0 | `...\log-cleanup.log` |
| `npm.cmd run test:alternate-phone --prefix backend` | 17 | 0 | 0 | `...\alternate-phone.log` |
| `npm.cmd run test:shareable-tracking --prefix backend` | 33 | 0 | 0 | `...\shareable-tracking.log` |
| `npm.cmd run test:tracking-http --prefix backend` | 41 | 0 | 0 | `...\tracking-http.log` |
| `npm.cmd run test:nimbuspost --prefix backend` | 88 | 0 | 0 | `...\nimbuspost.log` |
| `npm.cmd run test:reverse --prefix backend` | 48 | 1 | 1 | `...\reverse.log` |
| `npm.cmd run test:b1-b4 --prefix backend` | 77 | 0 | 0 | `...\b1-b4.log` |
| `npm.cmd run test:a22 --prefix backend` | 99 | 0 | 0 | `...\a22.log` |
| `npm.cmd run test:webhook-lease --prefix backend` | 35 | 7 | 1 | `...\webhook-lease.log` |
| `npm.cmd run test:integrity --prefix backend` | 116 | 2 | 1 | `...\integrity.log` |
| `npm.cmd run test:remediation --prefix backend` (clean DB) | 285 | 0 | 0 | `remediation-clean-20261105.log` |

The remediation suite first hit a 900000 ms timeout in the combined run. A later run against the contaminated DB completed with 281 passed, 4 failed. A clean-DB rerun completed with **285 passed, 0 failed**. The dirty run is retained only as evidence of cross-run test contamination.

### Frontend

```powershell
npm.cmd run build --prefix frontend
# exit 0; Next.js 16.3.1 compiled, TypeScript passed, 32/32 static pages
```

```powershell
npm.cmd test --prefix frontend
# 9 passed, 0 failed, exit 0
```

```powershell
npm.cmd run lint --prefix frontend
# exit 0: 0 errors, 10 warnings
```

- Build log: `C:\Users\Dell.000\AppData\Local\Temp\opencode\frontend-build-20261105-111118.log`
- **Lint status:** The prior `react-hooks/immutability` error was fixed by moving `handleCloseDrawer` into a `useCallback` before the effect that uses it. Remaining output is 10 warnings only.
- Warnings: eight `@next/next/no-img-element`; one `react-hooks/exhaustive-deps` in `CustomerSupportClient.tsx:178/216`.
- Frontend test note: Node emits `MODULE_TYPELESS_PACKAGE_JSON` because `frontend/package.json` lacks `"type": "module"`; tests still pass. Non-blocking hygiene item.

## 3. Failing Checks

### Stale fixtures (10) - app behavior is correct, tests are obsolete

- `webhook-lease`: 1.3, 1.5, 1.6, 1.7, 2.3, 2.5, 2.14.
- `integrity`: 10.5b, 10.5c.
- Cause: fixtures emit `payment.captured` for synthetic orders without a `PaymentAttempt`. The processor returns `RECONCILIATION_REQUIRED` and the event stays unresolved; tests expect `PROCESSED`/`expiresAt`.
- Required: update fixtures to create a real `Payment` + `PaymentAttempt` + captured state, or assert reconciliation instead of success.

### Stale return-status expectation (1)

- `reverse`: 8.2 expects `ReturnRequest.status === 'ACCEPTED'`.
- Cause: mock refund completes synchronously; `syncReturnRequestWithRefund` correctly sets `COMPLETED` on `PROCESSED` (`refundService.ts:1017,1172`).
- Required: update assertion to `COMPLETED` (and add a case for asynchronous pending refunds if desired).

### Resolved test-isolation failures (4)

The first `remediation` run timed out after 900000 ms. It left a stale `FAILED` webhook event (`evt_gen_fail_1793855234773`) in the test DB. The next run's `executeWebhookInboxBatch(1)` selects the oldest candidate first, so it processed that leftover event instead of the newly created `C.6` event; the zero-match interceptor therefore never applied to the intended event.

- Root cause: cross-run test-DB contamination plus FIFO `batchLimit: 1`.
- Clean-DB rerun (unique isolated database): **285 passed, 0 failed**, including all four `C.6` checks:
  - `executeWebhookInboxBatch` throws `AppError`.
  - Code is `WEBHOOK_LEASE_LOST`.
  - Status is `409`.
  - Event remains `PROCESSING`.
- Conclusion: **no app defect demonstrated** for `C.6`; the source fencing logic is correct.
- Remaining hygiene issue: the suite cleans up only at the end, so a timeout/crash poisons the next run. Add pre-run cleanup or use a unique test DB per run, then keep `test:remediation` in CI.

## 4. Excluded / Not Run

| Test | Reason |
|---|---|
| `test:backup-restore` | Runs a destructive restore path; must use a disposable database. Not run. |
| `invoice-order-confirmation.test.ts` | Production-DB fallback removed; now uses `connectSafeTestDb`. |
| Phase 6/7 and other unwired suites | Not part of `npm test`; safety review required before running. |
| Browser/E2E and accessibility | No automated suite found. |
| Load/performance/DoS | Not covered. |
| Malware scanning | No implementation; upload tests cover type/size/sanitization only. |

## 5. Coverage Gaps by Control

| Control | Evidence status |
|---|---|
| Auth/ownership for cart update and order design reference | **No passing regression test found**; source-confirmed vulnerable. |
| Guest bulk-order design attachment | No negative test found. |
| Production image provider fail-closed | **No test**; source-confirmed gap. |
| Private image authorization | **No test**; no private path exists. |
| Local file deletion | **No test**; source-confirmed no unlink. |
| Payment signature and mock isolation | Covered; 15/15 in main. |
| Payment idempotency/concurrency | Covered by main and remediation; all C.6 checks pass on a clean DB. |
| Webhook signature/replay/lease | Covered; remediation 285/285 on a clean DB. |
| Inventory deduplication | Covered by main, b1-b4, a22. |
| Refund reservation/over-refund | Covered by integrity/remediation; 3 fixture failures remain. |
| Replica-set transaction behavior | Not tested against a real replica set in this audit. |

## 6. CI Release Gate (Recommended)

```powershell
npm.cmd run build --prefix backend
npm.cmd test --prefix backend
npm.cmd run test:webhook-lease --prefix backend
npm.cmd run test:integrity --prefix backend
npm.cmd run test:remediation --prefix backend
npm.cmd run build --prefix frontend
npm.cmd test --prefix frontend
npm.cmd run lint --prefix frontend
```

Do not gate on the current targeted suites until the 10 stale-fixture failures are fixed or explicitly reclassified with evidence. Add the security regression tests from `UPLOAD_AND_STORAGE_AUDIT.md` and the cross-user tests from `API_SECURITY_AUDIT.md`.
