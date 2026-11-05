# SECURITY FINDINGS

**Project:** SamratFashion  
**Audit Date:** 2026-11-05  
**Verdict:** NOT PRODUCTION READY FOR THE LAUNCH FEATURE SET  
**Launch blockers:** 2 (SF-001 Critical, SF-006 release evidence)  
**Deferred with ENABLE_CUSTOM_DESIGN=false:** SF-002, SF-003, SF-004, SF-005, SF-007 (custom design/custom printing stack)

## Severity Summary

| ID | Severity | Status | Finding | Blocker |
|---|---|---|---|---|
| SF-001 | Critical | Confirmed | Private customer media publicly retrievable via local/static or public Cloudinary delivery | Yes |
| SF-002 | High | Confirmed / Deferred | Cross-user CustomDesign reference via cart update and order creation | Deferred (disabled in launch) |
| SF-003 | High | Confirmed / Deferred | Guest bulk-order design attachment and email-based attribution spoofing | Deferred (disabled in launch) |
| SF-004 | Medium | Confirmed | Anonymous custom-artwork upload without inquiry binding or malware scan | No (hardening) |
| SF-005 | Medium | Confirmed | Local asset deletion leaves files on disk | Partially (folded into SF-001) |
| SF-006 | Medium | Confirmed | Test harness has a production-DB fallback and unwired critical suites | Yes (release evidence) |
| SF-007 | Low | Confirmed | `SUPER_ADMIN` missing from two custom-design role checks | No |
| SF-008 | Info | Verified | Payment/webhook controls are strong; residual payment-ID consistency hardening | No |
| UF-003 | N/A | False positive | Upload deletion authorization is correct | No |

## SF-001 - Private customer media is publicly retrievable

- **Severity:** Critical
- **Confidence:** High (source-confirmed)
- **Category:** Data exposure / access control / configuration
- **Affected files:** `backend/src/services/image/ImageService.ts:10,40-47,63-70,86-93,109-116`; `backend/src/services/image/LocalImageStorageProvider.ts:63-91`; `backend/src/services/image/CloudinaryImageStorageProvider.ts:43-62`; `backend/src/config/env.ts:60-64`; `backend/src/index.ts:110-119`
- **Evidence:**
  - Provider defaults to `local` when `IMAGE_PROVIDER` is unset.
  - Strict env validation only checks Cloudinary when the variable is explicitly `cloudinary`; it never requires or allowlists the value.
  - Local provider writes custom artwork and reviews to `backend/uploads`.
  - Express serves the whole uploads directory statically with `Cross-Origin-Resource-Policy: cross-origin`.
  - Cloudinary upload does not set authenticated/private delivery.
  - Local delete does not unlink the file.
- **Business impact:** Customer artwork/review confidentiality loss; URLs can persist in caches and third-party logs; deletion is ineffective.
- **Remediation:** Implement the configuration, asset-model, provider, authorization, deletion, and migration design in `UPLOAD_AND_STORAGE_AUDIT.md`.
- **Regression tests:** ST-CFG-1..5, ST-AUTH-1..6, ST-PUB-1..2, ST-DEL-1..4, ST-UP-1..6, ST-MIG-1..2.
- **Production blocker:** Yes.

## SF-002 - Cross-user CustomDesign reference and mutation

- **Severity:** High
- **Confidence:** High (source-confirmed)
- **Category:** IDOR / horizontal authorization
- **Affected files:** `backend/src/controllers/cartController.ts:170-179,237-285`; `backend/src/controllers/orderController.ts:130-137,163-177,311-322`
- **Evidence:** `addItemToCart` validates ownership, but `updateCartItemQuantity` does not. `createOrder` reads designs by ID without `userId` and then updates them by ID.
- **Attack scenario:** Attacker replaces `designId` in their customized cart item with a victim's design ID, places an order, receives the victim's artwork URL in the order payload, and mutates the victim's design status/order link.
- **Impact:** Confidentiality of artwork; integrity of design records; production/admin confusion.
- **Remediation:** Re-validate ownership in the update path; scope all reads/updates to `{ _id, userId: req.user.id }`; verify `matchedCount`; add cross-user tests.
- **Regression tests:** Cart update rejects foreign design (403/404); order creation rejects foreign design; no victim design mutation occurs.
- **Production blocker:** Yes.

## SF-003 - Guest bulk-order design attachment and email attribution

- **Severity:** High
- **Confidence:** High (source-confirmed)
- **Category:** Authorization / integrity
- **Affected files:** `backend/src/controllers/bulkOrderController.ts:187-212`
- **Evidence:** `optionalAuth`; undefined `resolvedUserId` removes the owner predicate from the design lookup; an arbitrary existing user is resolved by email alone.
- **Impact:** Cross-user design reference; account attribution spoofing.
- **Remediation:** Require authentication for design attachment or a verified inquiry token; do not link by unverified email; scope design reads to owner/inquiry.
- **Regression tests:** Guest with victim design ID rejected; unauthenticated request with existing user's email is not attributed to that user.
- **Production blocker:** Yes.

## SF-004 - Anonymous custom-artwork upload abuse surface

- **Severity:** Medium
- **Confidence:** High
- **Affected files:** `backend/src/routes/uploadRoutes.ts:43`; `backend/src/controllers/uploadController.ts:88-98`
- **Evidence:** `optionalAuth`; guest category explicitly allowed; 10 MB/file and 100 requests/15 min/IP; no per-user quota, inquiry binding, or malware scan.
- **Impact:** Storage/compute abuse, unowned private content, and no accountability for uploads.
- **Remediation:** Token-bound guest uploads or authentication, quotas, malware scanning, and asset ownership records.
- **Production blocker:** No, but required before enabling guest uploads in production.

## SF-005 - Local delete leaves files on disk

- **Severity:** Medium
- **Confidence:** High
- **Affected files:** `backend/src/services/image/LocalImageStorageProvider.ts:92-98`
- **Evidence:** `delete()` only deletes from `memoryAssets`; no `fs.unlink`.
- **Impact:** Deleted images remain publicly retrievable forever.
- **Remediation:** Implement real unlink with idempotency; include in the storage migration.
- **Production blocker:** Part of SF-001.

## SF-006 - Test harness production-DB fallback and unwired suites

- **Severity:** Medium (release evidence blocker)
- **Confidence:** High
- **Affected files:** `backend/src/tests/invoice-order-confirmation.test.ts`; `backend/src/tests/feature-disablement.test.ts`; `backend/package.json` test scripts
- **Evidence:** The invoice test formerly fell back to `process.env.MONGODB_URI`; that fallback has been removed and it now uses `connectSafeTestDb`. The feature-disablement suite uses only the verified isolated test database. The main `npm test` still excludes webhook-lease, refund/inventory integrity, remediation, NimbusPost, tracking, and custom-print suites.
- **Impact:** The unsafe production-DB fallback is closed for the suites touched in this pass; passing `npm test` alone still does not prove webhook/refund/inventory controls.
- **Remediation:** Route every remaining test through `connectSafeTestDb`/`getVerifiedTestMongoUri`; remove all remaining production fallbacks; add the critical suites to the CI gate.
- **Production blocker:** Yes until the harness and CI wiring are corrected.

## SF-007 - `SUPER_ADMIN` inconsistency

- **Severity:** Low
- **Confidence:** High
- **Affected files:** `backend/src/controllers/customDesignController.ts:155,192`
- **Evidence:** Checks compare only to `"ADMIN"`.
- **Impact:** Super-admins cannot perform two design operations; no privilege escalation.
- **Remediation:** Use an admin role allowlist.

## SF-008 - Payment and webhook controls (verified)

- **Severity:** Informational / residual hardening
- **Confidence:** High
- **Evidence:** Signature-first verification, ownership-scoped attempts, atomic `PENDING -> PROCESSING` claim, stale-claim recovery, idempotent paid-order return, unique webhook event identity, lease token + heartbeat + fencing, and stale-event recovery.
- **Residual:** `processPaymentSuccess` overwrites `attempt.razorpayPaymentId` when the order is already `PAID` without comparing the incoming ID to the stored one (`paymentProcessor.ts:57-65`). Signature verification makes this low risk, but compare-and-reject is safer.
- **Production blocker:** No.

## UF-003 - Upload deletion authorization (closed)

False positive. `DELETE /api/upload/image` requires authentication and `ADMIN`/`SUPER_ADMIN`.
