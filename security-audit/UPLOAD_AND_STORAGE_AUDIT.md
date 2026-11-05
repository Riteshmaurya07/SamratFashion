# UPLOAD AND STORAGE AUDIT

**Project:** SamratFashion  
**Audit Date:** 2026-11-05  
**Status:** Confirmed critical blocker (private media exposure) plus medium issues (anonymous upload, orphaned files)

## 1. Findings

### SF-001 - Private media is publicly retrievable by default (CONFIRMED, Critical)

**Production blocker: YES**

**Evidence**

- `ImageService.getProvider()` selects `process.env.IMAGE_PROVIDER || 'local'` (`backend/src/services/image/ImageService.ts:10`). A production process with the variable absent silently uses local disk.
- `validateProductionEnv()` validates Cloudinary credentials only when `IMAGE_PROVIDER` is exactly `cloudinary` (`backend/src/config/env.ts:60-64`). It does not require `IMAGE_PROVIDER`, reject `local`, or reject unknown values in production/staging.
- The local provider writes every folder under `backend/uploads` and returns `${baseUrl}/uploads/${folder}/${file}` (`LocalImageStorageProvider.ts:63-76`). Custom artwork uses `samrat-fashion/custom-designs`; reviews use `samrat-fashion/reviews` (`ImageService.ts:52-97`).
- Express serves the whole uploads directory as static content with no authentication or authorization and sets `Cross-Origin-Resource-Policy: cross-origin` (`backend/src/index.ts:110-119`).
- Cloudinary uploads use the default public delivery type; no `type: 'authenticated'`, `access_mode`, or access-control parameter is set (`CloudinaryImageStorageProvider.ts:43-53`). A `secure_url` is HTTPS, not private.
- The fallback path in each `ImageService.upload*` method can create a local public file on provider failure when the configured provider is not Cloudinary (`ImageService.ts:40-47,63-70,86-93,109-116`).
- Local `delete()` only removes the in-memory map entry and returns `true`; it never unlinks the file (`LocalImageStorageProvider.ts:92-98`). Deleting an asset does not revoke the public URL.

**Impact**

Custom artwork, review photos, and any future private category can be read by anyone holding the URL. URLs appear in order responses, admin dashboards, support screenshots, browser history, logs, and third-party referrers. A misconfigured production boot is sufficient; no attacker privilege is needed.

**Business impact**

Loss of customer artwork confidentiality, brand/reputation harm, potential privacy-law exposure, and unrecoverable exposure after deletion.

### SF-004 - Anonymous custom-artwork upload (CONFIRMED, Medium)

**Production blocker: NO (hardening required)**

`POST /api/upload/image` is `optionalAuth` and rate-limited to 100 uploads/15 minutes/IP (`backend/src/routes/uploadRoutes.ts:43`). `custom-artwork` is explicitly allowed for guests (`backend/src/controllers/uploadController.ts:88-91`). Uploads are capped at 10 MB and content is magic-byte checked; SVG is sanitized with DOMPurify. However, anonymous users can consume storage and compute, and there is no malware/content scanning, no per-user quota, and no binding of the upload to a server-issued inquiry. If custom artwork is later treated as private, the anonymous upload path also lacks an owner identity for authorization.

**Recommendation:** Require authentication, or issue a short-lived single-use inquiry token from the support/inquiry endpoint and bind the upload to that token. Apply per-identity quotas and asynchronous malware scanning.

### UF-003 - Upload deletion authorization (FALSE POSITIVE, closed)

`DELETE /api/upload/image` has `requireAuth, requireRole('ADMIN','SUPER_ADMIN')` (`backend/src/routes/uploadRoutes.ts:44`). No other delete route references `deleteImage`. The controller accepts an arbitrary `publicId`/`url` from an admin, which is acceptable for an admin-only maintenance endpoint; it should still be audit-logged. No change required for authorization.

### Content validation (VERIFIED, Low residual risk)

Verified controls:

- Category allowlist (`product`, `banner`, `campaign`, `custom-artwork`, `review`) and per-category RBAC (`uploadController.ts:69-98`).
- Magic-byte detection for JPEG/PNG/WebP/SVG/PDF (`uploadController.ts:105-165`).
- SVG/PDF only allowed for `custom-artwork` (`uploadController.ts:108-115,158-161`).
- SVG sanitized with DOMPurify SVG profile (`uploadController.ts:127-131,166-170`).
- 10 MB limit at multer and controller layers (`uploadRoutes.ts:7-9`; `uploadController.ts:120-123`).
- Base64 payload limited and validated equivalently (`uploadController.ts:132-177`).

Residual: PDF is not sanitized; no antivirus; `express.static` may serve user-supplied PDFs from the application origin.

## 2. Production-Safe Storage Design

The design below removes implicit trust in `IMAGE_PROVIDER`, separates public from private assets, and makes private access an authorization decision rather than a URL-possession decision.

### 2.1 Configuration invariants (fail closed at boot)

Required environment contract:

```text
IMAGE_PROVIDER=cloudinary|s3|local        # required, no default
PUBLIC_ASSET_STORAGE=cloudinary|s3        # required in production
PRIVATE_ASSET_STORAGE=cloudinary|s3       # required if private categories enabled
LOCAL_UPLOADS_STATIC=false                # must be false in production
ASSET_SIGNED_URL_TTL_SECONDS=300          # 60-900
```

Startup rules:

1. In `NODE_ENV=production|staging`, missing/unknown `IMAGE_PROVIDER` is fatal.
2. `IMAGE_PROVIDER=local` is fatal in strict environments.
3. Private storage credentials are validated at boot; no lazy construction.
4. No runtime fallback from the configured private provider to local disk. A provider failure must surface as an error and leave the upload uncommitted.
5. The static `/uploads` mount is registered only when `NODE_ENV` is `development|test` and `LOCAL_UPLOADS_STATIC=true`.

### 2.2 Asset model

Add a canonical asset record instead of persisting raw URLs:

```text
StoredAsset {
  _id,
  ownerUserId?: ObjectId,        // registered owner
  inquiryId?: ObjectId,          // anonymous inquiry owner
  category: 'product'|'banner'|'campaign'|'custom-artwork'|'review',
  visibility: 'public'|'private',
  provider: 'cloudinary'|'s3',
  storageKey: string,            // public_id or object key
  deliveryType: 'upload'|'authenticated'|'private',
  mime: string,
  bytes: number,
  sha256: string,
  status: 'PENDING'|'ACTIVE'|'DELETED',
  createdAt, deletedAt
}
```

Rules:

- `product`, `banner`, `campaign` are `public`; `custom-artwork`, `review` are `private`.
- The upload response for private assets returns `{ assetId }`, never a durable raw URL.
- Order/design/review documents store `assetId`, not an unauthenticated URL. A denormalized display URL may be generated on read with a short TTL.
- Private URLs are never written to logs or analytics.

### 2.3 Provider contract

```text
IStorageProvider {
  put(buffer, { category, key, visibility, mime }): Promise<{ storageKey, deliveryType }>
  signGet(storageKey, { ttlSeconds }): Promise<string>   // private only
  delete(storageKey, { deliveryType }): Promise<boolean>
  exists(storageKey): Promise<boolean>
}
```

**Cloudinary**

- Public categories: current public upload is acceptable.
- Private categories: upload with `type: 'authenticated'` (or `access_mode: 'authenticated'`) and, where supported, `access_control` restricted to the application. Persist `deliveryType: 'authenticated'`.
- Deliver private assets only through `cloudinary.url(publicId, { type: 'authenticated', sign_url: true, expires_at })` with a 60-900 second TTL.
- Never return `secure_url` for an authenticated asset.
- Delete with the correct `type`; confirm the result.

**S3-compatible**

- Bucket-level public access block enabled.
- Public assets in a public-read prefix/CDN; private assets in a separate private bucket/prefix.
- Private reads use presigned GET URLs with 60-900 second TTL.
- SSE enabled at rest; versioning and lifecycle deletion enabled.

**Local (development/test only)**

- Store outside any web root, for example `storage/private/<category>/<ownerId>/<uuid>`.
- Serve private files only through `GET /api/assets/:id/content` after authorization; set `Content-Disposition: attachment` for PDF, `X-Content-Type-Options: nosniff`, and a restrictive `Content-Security-Policy`.
- `delete()` must `fs.unlink` the file and be idempotent.
- Never mount the storage directory statically.

### 2.4 Authorization rules

| Category | Upload | Read | Delete |
|---|---|---|---|
| product/banner/campaign | ADMIN, SUPER_ADMIN | public | ADMIN, SUPER_ADMIN |
| custom-artwork (registered) | authenticated owner | owner, ADMIN, SUPER_ADMIN | owner, ADMIN, SUPER_ADMIN |
| custom-artwork (guest) | valid single-use inquiry token | inquiry token holder during TTL, ADMIN, SUPER_ADMIN | ADMIN, SUPER_ADMIN |
| review | authenticated owner bound to review/order | owner, ADMIN, SUPER_ADMIN (public only if product review policy explicitly allows) | owner, ADMIN, SUPER_ADMIN |

`GET /api/assets/:id/url` (or `/content`) must load `StoredAsset`, verify `status: ACTIVE`, then check ownership/RBAC before signing. Return `404` for non-owned private assets to avoid existence leakage.

### 2.5 Deletion and retention

1. `DELETE /api/assets/:id` authorizes owner/admin, sets `status: DELETED`, and writes an audit log.
2. Asynchronous purge deletes the provider object using the stored `deliveryType`.
3. Local purge unlinks the file; Cloudinary uses the correct type; S3 deletes the object version.
4. Purge failures are retried and alerted; a deleted asset must never remain retrievable.
5. Retention policy: private assets purged within 30 days of account/order closure unless a legal hold applies.

### 2.6 Migration plan for existing data

1. Inventory every URL in `CustomDesign`, `Order`, `Review`, `Product`, `Banner`, `Campaign`, and support attachments.
2. Create `StoredAsset` rows and classify by category/folder; mark `samrat-fashion/custom-designs` and `samrat-fashion/reviews` private.
3. Copy private objects to the private provider with authenticated/private delivery; keep originals until verification completes.
4. Rewrite document references to `assetId`; deploy readers that sign URLs on demand.
5. Revoke/delete old public objects and disable the `/uploads` static mount.
6. Verify no private URL is reachable without a signed URL; retain an audit report.

### 2.7 Rollout gates

- Boot fails with `IMAGE_PROVIDER` unset, `local`, or unknown in production.
- No `app.use('/uploads', express.static(...))` in production route table.
- Private asset read requires an authenticated/authorized request.
- Existing public custom-artwork URLs return 401/403/404 after migration.
- Deletion removes the object and the URL becomes unusable.

## 3. Regression Tests (Required)

Implement these as automated tests. They are written to be independent of implementation details but specific about observable behavior.

### Configuration

1. **ST-CFG-1** With `NODE_ENV=production` and `IMAGE_PROVIDER` unset, server startup throws and exits non-zero.
2. **ST-CFG-2** With `NODE_ENV=production` and `IMAGE_PROVIDER=local`, startup throws.
3. **ST-CFG-3** With `NODE_ENV=production` and `IMAGE_PROVIDER=unknown`, startup throws.
4. **ST-CFG-4** With `NODE_ENV=production`, `IMAGE_PROVIDER=cloudinary`, and any Cloudinary credential missing, startup throws.
5. **ST-CFG-5** With `NODE_ENV=production`, a Cloudinary upload failure does not create a local file and does not return a local URL.

### Private read authorization

6. **ST-AUTH-1** Upload custom artwork as user A; `GET /api/assets/:id/url` without a token returns 401.
7. **ST-AUTH-2** Same asset requested by user B returns 404 (not 403) and no signed URL.
8. **ST-AUTH-3** Same asset requested by owner A returns a signed URL that expires within the configured TTL.
9. **ST-AUTH-4** A signed URL cannot be re-signed or extended by the client; expiry is enforced by the provider.
10. **ST-AUTH-5** With `PRIVATE_ASSET_STORAGE=cloudinary`, the stored delivery type is `authenticated` and the raw `secure_url` is not persisted or returned for private assets.
11. **ST-AUTH-6** With local private storage, no static route can reach the private directory; a direct path request returns 404.

### Public read

12. **ST-PUB-1** Product/banner assets remain publicly readable without a token.
13. **ST-PUB-2** A private category cannot be uploaded through a public category override (category is server-derived from the authorized action, not trusted from the body).

### Deletion

14. **ST-DEL-1** Owner deletes their private asset; the provider object is removed and the prior URL/signed URL returns 404/410.
15. **ST-DEL-2** User B cannot delete user A's asset.
16. **ST-DEL-3** Local delete unlinks the file from disk (assert the path no longer exists).
17. **ST-DEL-4** Repeating delete is idempotent and does not resurrect the asset.

### Abuse and validation

18. **ST-UP-1** Anonymous `custom-artwork` upload without a valid inquiry token returns 401.
19. **ST-UP-2** An expired/reused inquiry token is rejected.
20. **ST-UP-3** PNG/JPEG/WebP pass; a renamed non-image is rejected by magic bytes.
21. **ST-UP-4** SVG with a script/event handler is sanitized; the stored bytes contain no executable handler.
22. **ST-UP-5** PDF is rejected outside custom-artwork and is served as an attachment with `nosniff` when allowed.
23. **ST-UP-6** Per-user/per-IP quota is enforced with 429 after the configured limit.

### Migration

24. **ST-MIG-1** After migration, a previously public custom-design URL is not anonymously retrievable.
25. **ST-MIG-2** Order/design payloads expose `assetId` or a short-lived signed URL, not a durable private URL.

## 4. Acceptance Criteria

- No private category is stored with public delivery or served by static middleware.
- No production boot can select `local` or an unknown provider.
- Every private read is authorized and time-limited.
- Every delete removes the backing object.
- All 25 tests above pass in CI, including a production-config startup test.
