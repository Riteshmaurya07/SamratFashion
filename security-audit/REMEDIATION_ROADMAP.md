# REMEDIATION ROADMAP

**Project:** SamratFashion  
**Audit Date:** 2026-11-05  
**Target:** Remove all production blockers, make critical controls test-proven, then re-audit.

## Prioritization Rules

- **P0:** Must be closed before any production traffic. Exploitable confidentiality/integrity issue or missing release evidence for a critical control.
- **P1:** Must be closed before general availability; may be staged behind a feature flag only if the exposed path is disabled.
- **P2:** Harden/operate; schedule within the first hardening sprint.
- **P3:** Hygiene/documentation.

## Launch vs Deferred Scope (2026-11-05 adjustment)

Custom Design, Custom Printing, custom artwork, AI design generation, custom templates, custom-print catalog, and print production workflows are deferred for approximately six months. They are disabled by default with `ENABLE_CUSTOM_DESIGN=false`; the backend rejects direct API access with `503 CUSTOM_DESIGN_DISABLED`. Normal shopping, checkout, catalog, bulk-order quotation, and unrelated admin operations remain active.

- **Launch (in scope):** SF-001 storage hardening for active categories, SF-006 test/release evidence, SF-008 payment hardening, frontend lint, operational readiness.
- **Deferred (~6 months):** SF-002, SF-003, SF-004, SF-005, SF-007, StoredAsset/private media migration, guest inquiry tokens, design ownership workflows, custom printing security, and full artwork migration. These remain open findings; they are not considered fixed.
- **Rule:** Do not run custom-design, custom-print, or custom-artwork tests as launch gate requirements while `ENABLE_CUSTOM_DESIGN=false`. Re-enable and re-audit before turning the flag on.

## Phase 0 - Immediate Code and Test Safety (1-2 days)

| ID | Finding | Change | Files | Acceptance |
|---|---|---|---|---|
| P0-A | SF-002 | Re-validate `designId` ownership in cart update; scope design reads/updates in order creation to `userId`; verify `matchedCount` | `cartController.ts:237-285`; `orderController.ts:130-177,311-322` | Cross-user cart update rejected; cross-user order creation rejected; victim design unchanged; negative tests pass |
| P0-B | SF-003 | Require auth or verified inquiry token for bulk design attachment; never link an unverified email to an existing user | `bulkOrderController.ts:187-212` | Guest + foreign design rejected; email-collision request not attributed; tests pass |
| P0-C | SF-006 | Remove `MONGODB_URI` production fallback; route all tests through `connectSafeTestDb` | `invoice-order-confirmation.test.ts:87`; test helpers; `package.json` | Test startup fails closed without a verified test URI |
| P0-D | SF-001 (partial) | Require `IMAGE_PROVIDER`; reject `local`/unknown in production/staging; remove runtime local fallback; gate `/uploads` static mount to dev/test | `ImageService.ts:10`; `env.ts:60-64`; `index.ts:110-119`; local provider | Startup tests ST-CFG-1..5 pass; production cannot select local |
| P1-A | SF-008 | Compare and reject conflicting `razorpayPaymentId` on a PAID order | `paymentProcessor.ts:57-65` | Conflict returns `RECONCILIATION_REQUIRED`; no overwrite |
| P1-B | SF-007 | Include `SUPER_ADMIN` in custom-design read/update checks | `customDesignController.ts:155,192` | Role matrix test passes |
| P2-A | Lint | Fix `handleCloseDrawer` declaration order; optionally replace `<img>` warnings | `AddressBookClient.tsx:120,191`; warning sites | `npm run lint --prefix frontend` exits 0 |
| P2-B | Docs/config | Remove misleading `IMAGE_PROVIDER=local`; align logistics docs with Nimbuspost | `.env.example`; docs | Config docs match code |

**Gate for Phase 0:** backend build + main suite; new negative tests; startup config tests; frontend build/test/lint.

## Phase 1 - Private Media Architecture (release-critical)

Implement the design in `UPLOAD_AND_STORAGE_AUDIT.md`.

| Step | Work | Acceptance |
|---|---|---|
| 1 | Add `StoredAsset` model and migration inventory | Every persisted image URL is mapped to an asset row with category/visibility |
| 2 | Add fail-closed provider contract and boot validation | Missing/local/unknown provider is fatal in production |
| 3 | Private Cloudinary authenticated delivery or private S3 presigning | Private objects are not readable via raw `secure_url` |
| 4 | Authenticated read endpoint with owner/RBAC checks | No token -> 401; foreign owner -> 404; owner -> short-lived URL |
| 5 | Local dev provider outside web root + real unlink | Deleted files are gone; no static path can serve them |
| 6 | Guest inquiry token (or force auth) for custom artwork | No anonymous unbound upload; token is single-use/short-lived |
| 7 | Delete lifecycle + async purge + audit log | Deletion revokes access and removes the object |
| 8 | Migrate existing URLs and revoke old public objects | Old custom-artwork/review URLs return 401/403/404 |
| 9 | Add malware scanning/quarantine and quotas | Infected/oversized/over-quota uploads rejected |
| 10 | Run ST-CFG, ST-AUTH, ST-PUB, ST-DEL, ST-UP, ST-MIG tests | All 25 storage regression tests pass |

**Gate for Phase 1:** no private category is public; deletion is effective; migration evidence attached.

## Phase 2 - Critical Test Evidence (release-critical)

| ID | Work | Acceptance |
|---|---|---|
| P0-E | Fix stale webhook/integrity fixtures (10 checks) | Real `PaymentAttempt` fixtures or reconciliation assertions; targeted suites green |
| P0-F | Update reverse 8.2 to `COMPLETED` | `test:reverse` 49/49 |
| P1-E | Make `test:remediation` self-cleaning (C.6 was cross-run contamination) | Pre-run cleanup or unique DB per run; C.6 stays green (409/`WEBHOOK_LEASE_LOST`/event remains PROCESSING) |
| P1-C | Wire webhook-lease, integrity, remediation into `npm test`/CI | CI fails on any of these suites failing |
| P1-D | Run critical suites against a replica set | Transaction paths exercised realistically |
| P2-C | Add cross-user IDOR tests (cart, order, bulk, addresses, returns) | Negative tests exist for every object reference |

**Gate for Phase 2:** zero failing critical checks; CI runs all critical suites; no production DB fallback.

## Phase 3 - Operational Readiness

| ID | Work | Acceptance |
|---|---|---|
| P2-D | Validate backup/restore in a disposable environment | RPO/RTO documented; restore drill passes; no production connection |
| P2-E | Verify replica set, index migrations, and preflight scripts | Indexes present; migrations reversible/monitored |
| P2-F | Configure alerts for reconciliation, webhook backlog, refund failures, purge failures | Alert routes tested |
| P2-G | Review `trust proxy`, CORS, cookie flags, HSTS for the real topology | Production-domain checks pass |
| P3-A | Add browser/E2E, accessibility, load, and abuse tests | Baseline thresholds documented |
| P3-B | Align README/SECURITY docs and deployment runbook | Docs match behavior |

## Execution Order

1. Phase 0 A-D and Phase 2 E-G in parallel: close exploitable IDOR, stop production DB fallback, fix stale fixtures and remediation test isolation, make config fail closed.
2. Phase 1 media architecture: largest change; start after config/static-mount guard is merged.
3. Phase 2 CI wiring and replica-set run.
4. Phase 3 operational drills.
5. Independent re-audit of SF-001/002/003 and the full test gate; issue a new go/no-go decision.

## Definition of Done

- For the launch feature set, SF-001 and SF-006 are closed with code + negative tests; SF-002, SF-003, SF-004, SF-005, and SF-007 remain deferred and must be closed before `ENABLE_CUSTOM_DESIGN=true`.
- All 10 stale-fixture failures resolved or reclassified with evidence; critical suites in CI and green.
- No test can reach production; no production startup can select local storage or mock payments.
- Private media is authorization-gated and deletion is effective.
- Backend/frontend builds pass; frontend lint passes; replica-set integration run passes.
- `PRODUCTION_READINESS_CHECKLIST.md` fully checked and re-signed.
