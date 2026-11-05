# ARCHITECTURE REVIEW

**Project:** SamratFashion  
**Audit Date:** 2026-11-05  
**Scope:** Security-relevant structure, trust boundaries, critical flows, and architectural risks

## 1. System Shape

```text
samratFashion/
  backend/    Express 5 + TypeScript + Mongoose 9
              controllers / routes / services / models / middleware
              payments (Razorpay), webhooks, inventory, refunds, logistics,
              uploads/images, auth, admin/customer APIs
  frontend/   Next.js 16.3.1 App Router + React 19 + TypeScript
              public storefront, account, custom designer, admin console
```

- API and UI are separate deployables. The frontend calls the backend over HTTP.
- MongoDB is the system of record for users, orders, payments, refunds, inventory, webhooks, and assets.
- Razorpay is the payment gateway; Nimbuspost is the active logistics adapter; Cloudinary/local disk are storage providers.
- Schedulers run in the backend process (and a worker entry point) for webhooks, tracking, cleanup, and reconciliation.
- No message broker: webhook processing, refunds, and inventory updates are database-coordinated via leases, unique indexes, and sessions.

## 2. Trust Boundaries

| Boundary | Trusted side | Untrusted side | Primary controls |
|---|---|---|---|
| Browser -> API | API | Browser | JWT access/refresh tokens, CORS/CSRF posture, rate limits, Zod validation |
| Gateway -> API | API | Razorpay payload | HMAC signature over raw body, event ID uniqueness, lease fencing |
| API -> MongoDB | API | Database network | Credentials/TLS (deployment responsibility), schema validation, unique indexes |
| API -> storage | API | User uploads | Category RBAC, size/type limits, magic bytes, SVG sanitization |
| User -> media URL | API | Anyone with a URL | **Broken today**: static `/uploads` and public Cloudinary delivery |
| Admin -> API | Admin console | Admin user | RBAC middleware plus per-resource checks |

## 3. Critical Flows

### Payment verify

1. Authenticated user submits gateway IDs/signature.
2. API verifies the signature, loads the attempt by gateway order ID, then loads the order scoped to the user.
3. A single atomic claim moves the attempt to `PROCESSING`; stale claims can be recovered.
4. Inventory is deducted; on failure it is rolled back and a captured payment triggers auto-refund.
5. The order becomes `PAID`; duplicate verification is idempotent.

**Assessment:** Strong. Requires replica-set transactions in production and a compare-and-reject guard for conflicting payment IDs.

### Webhook inbox

1. Raw body + signature verified.
2. Unique `(provider,eventId)` event record.
3. Worker claims with a lease token and processes with a heartbeat.
4. Terminal writes are fenced by the token; expired leases are recovered.
5. Unknown payment attempts and contradictory orders fail closed to reconciliation.

**Assessment:** Strong design. The stolen-lease path (`C.6`) passes on a clean DB; keep the suite self-cleaning so CI remains deterministic.

### Refund and return

1. Return/refund request validates owner/admin role and order state.
2. Reservation is made atomically on the payment with `$expr` guards.
3. A `Refund` is created with a deterministic idempotency key and a short return claim.
4. Provider creation is followed by fenced settlement; retries and late webhooks are handled.
5. Return status becomes `COMPLETED` after a processed refund.

**Assessment:** Strong, with explicit compensation for non-transactional deployments. Production must use a replica set.

### Inventory

1. Aggregated allocations decrement variants with a conditional update.
2. A `SALE` ledger row enforces one deduction per order/variant.
3. Partial unique indexes make returns and cancellation restocks idempotent.
4. Restoration is authoritative and never deletes the original sale ledger.

**Assessment:** Good. Non-transactional fallback is race-prone by nature; require sessions in production.

### Uploads and media

1. Multipart/base64 input is size and magic-byte checked.
2. Category determines authorization and allowed types.
3. Cloudinary/local provider returns a URL; documents persist the URL.
4. Express statically serves the local uploads directory.

**Assessment:** Broken confidentiality boundary for private categories. The URL is treated as a capability, but it is durable, unauthenticated, and not revocable. This is the top architectural remediation.

## 4. Strengths

- Clear controller/service/model separation; critical invariants are mostly centralized in services.
- Defense in depth for payments: signature verification, ownership, state checks, atomic claims, idempotency, and ledger uniqueness.
- Webhook design uses raw bodies, unique event identity, leases, heartbeats, fencing, and stale recovery.
- Refund/inventory accounting is ledger-based rather than in-place mutation only.
- Strict test DB guard exists for the suites that use it.
- Frontend production build and backend TypeScript build pass.
- Helmet, CORS, rate limiting, Zod validation, and centralized error handling are present.

## 5. Architectural Risks

1. **Media as public URL capability (Critical).** Private content is inseparable from public delivery. Requires an asset model, private providers, signed URLs, and an authenticated read path.
2. **Ownership checks are per-controller, not systemic.** The cart-update and order-design paths show that one missed predicate creates IDOR. Introduce a shared "resolve owned design" helper and negative tests.
3. **Guest identity is ambiguous.** Email-based attribution and unnamed uploads create spoofing/unowned-content risks. Require verified identity or scoped inquiry tokens.
4. **Database coordination is complex without a broker.** Correctness depends on indexes, leases, and transactions. Production topology (replica set) and migration preflight are mandatory.
5. **Test evidence is fragmented.** Critical suites are outside `npm test`, 10 stale-fixture checks fail, and one test can target production. Passing CI does not currently prove critical controls.
6. **Deletion is not durable.** Local files are never unlinked; public URLs remain valid. Deletion must be a first-class, asynchronous, auditable lifecycle.
7. **Lint is red.** `AddressBookClient.tsx:120` violates `react-hooks/immutability`; this should be fixed before release even though it is not a security boundary.
8. **Documentation drift.** `.env.example` advertises `IMAGE_PROVIDER=local`; logistics docs mention Delhivery while code branches on Nimbuspost. Misconfiguration risk.

## 6. Recommended Target Architecture for Media

```text
Upload -> category RPC -> authorize -> store private/public
       -> StoredAsset(owner, category, visibility, provider, key)
Read   -> authorize asset -> sign short-lived URL -> return
Delete -> mark DELETED -> async purge -> verify gone
```

- Public categories may use a CDN; private categories must use authenticated Cloudinary delivery or private S3 with presigned URLs.
- The API is the only component allowed to mint private URLs.
- Existing URLs are migrated and revoked; the static mount is removed in production.

## 7. Architecture Acceptance Criteria

- Every private data flow crosses an authorization decision; no durable public URL is a capability.
- Ownership is enforced by shared helpers and negative tests, not only per-controller convention.
- Webhook/refund/inventory guarantees are backed by deterministic passing tests on a replica set.
- Production startup rejects local storage, missing providers, and mock payment flags.
- Deletion revokes access and removes the backing object.
- CI runs all critical suites and fails on any red check.
