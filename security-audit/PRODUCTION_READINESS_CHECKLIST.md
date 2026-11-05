# PRODUCTION READINESS CHECKLIST

**Project:** SamratFashion  
**Audit Date:** 2026-11-05  
**Decision:** **NO-GO**  
**Launch blockers:** SF-001 (Critical), SF-006 (release evidence)  
**Deferred with ENABLE_CUSTOM_DESIGN=false:** SF-002, SF-003, SF-004, SF-005, SF-007 (custom design/custom printing stack)

## Security

- [ ] No unresolved Critical/High findings for the launch feature set
  - Open launch: SF-001. See `SECURITY_FINDINGS.md`.
  - Deferred custom-design findings: SF-002, SF-003, SF-004, SF-005, SF-007 (disabled by `ENABLE_CUSTOM_DESIGN=false`).
- [x] JWT algorithm pinned
- [x] Refresh token rotation, family revocation, reuse grace
- [x] Account status checked on authentication
- [x] Login enumeration mitigation
- [x] Strict production env validation for mock payments
- [ ] Strict production validation for `IMAGE_PROVIDER` (missing/default/local not rejected)
- [x] Webhook raw body + signature verification
- [ ] Webhook idempotency/lease fully demonstrated
  - Core tests pass; clean-DB remediation passes `C.6`; the suite needs pre-run cleanup/unique DB to stay deterministic.
- [x] Payment verification is signature-first, atomic, and idempotent
- [ ] Compare/reject conflicting `razorpayPaymentId` on a PAID order
- [ ] All routes have server-side authorization (IDOR audit complete)
  - Open: cart update and order design reference; guest bulk-order design attachment.
- [x] Upload deletion requires ADMIN/SUPER_ADMIN (UF-003 false positive closed)
- [ ] Private uploads are not publicly served
  - Local `/uploads` is static and Cloudinary delivery is public for private categories.
- [x] Helmet and CORS configured
- [x] Rate limiting on auth, upload, public tracking, and payment paths
- [ ] Malware scanning / upload quarantine
- [ ] Guest upload bound to a verified inquiry token

## Configuration

- [x] Mock payment forbidden in strict environments
- [ ] All mock/debug flags disabled in production (verify at deploy)
- [ ] Storage provider credentials validated at boot
- [ ] `IMAGE_PROVIDER` required and allowlisted; `local` rejected in production
- [ ] `FRONTEND_URL` / `ALLOWED_ORIGINS` verified for the production domain
- [ ] `NODE_ENV=production` verified
- [ ] `trust proxy` verified for the actual reverse proxy/CDN topology
- [ ] `.env.example` updated: remove `IMAGE_PROVIDER=local` as a production-looking default
- [ ] Logistics documentation matches the Nimbuspost provider

## Data Integrity

- [x] Inventory decrements are conditional and ledger-deduplicated
- [x] Inventory restoration is idempotent and does not delete the sale ledger
- [x] Payment/order state machine is guarded
- [x] Refund over/under-reservation is guarded
- [x] Webhook event identity and lease fencing are implemented
- [ ] Webhook stolen-lease path stays green on every CI run (`C.6` passes on a clean DB; make cleanup deterministic)
- [ ] Production MongoDB is a replica set with transactions enabled
- [ ] Index migrations run with preflight and verified in production
- [ ] Backup/restore and RPO/RTO validated in an isolated environment

## Build and Tests

- [x] Backend TypeScript build passes (exit 0)
- [x] Backend main suite passes (269/269, exit 0)
- [x] Frontend production build passes (exit 0)
- [x] Frontend unit tests pass (9/9, exit 0)
- [ ] Critical targeted suites pass
  - 10 failures: 9 stale webhook/integrity fixtures and 1 stale return-status expectation. C.6 passes on a clean DB.
- [x] Custom-print, tracking, Nimbuspost, b1-b4, a22, log-cleanup, alternate-phone suites pass
- [ ] All critical suites wired into the CI gate
- [ ] No test can connect to a production database
  - `invoice-order-confirmation.test.ts:87` has a production fallback.
- [ ] Frontend lint passes
  - 1 error at `AddressBookClient.tsx:120`; 9 warnings.
- [ ] Browser/E2E, accessibility, load, and abuse tests exist

## Upload and Media

- [ ] Private categories use authenticated/private delivery
- [ ] Private reads require authorization and short-lived signed URLs
- [ ] Local private files live outside the web root
- [ ] `/uploads` static mount is disabled in production
- [ ] Delete unlinks/removes the provider object and revokes access
- [ ] Existing public custom-artwork/review URLs are migrated and revoked
- [ ] Upload size/type/content tests pass (they do) and malware scanning is added

## Operations

- [ ] Graceful shutdown verified
- [ ] Health checks meaningful and monitored
- [ ] Structured logging with secret redaction verified
- [ ] Alerting for payment reconciliation, webhook backlog, refund failures, storage purge failures
- [ ] Backups/DR reviewed and rehearsed
- [ ] Rollback plan for the media migration and index changes
- [ ] Rate-limit and quota thresholds tuned for production traffic

## Release Gates

1. Close SF-001, SF-002, and SF-003 with code fixes and passing negative tests.
2. Remove the production-DB fallback and wire critical suites into CI.
3. Make `test:remediation` self-cleaning or use a unique DB per run; keep `C.6` green in CI.
4. Fix the frontend lint error and the 10 stale-fixture checks.
5. Re-run the full gate below and attach the logs to the release record.

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

**Overall Status:** NOT READY FOR PRODUCTION
