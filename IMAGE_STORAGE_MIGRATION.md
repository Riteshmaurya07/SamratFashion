# SAMRAT FASHION — IMAGE STORAGE MIGRATION PLAN (CLOUDINARY → CLOUDFLARE R2)

---

## 1. MIGRATION ARCHITECTURE OVERVIEW

SamratFashion uses a provider-agnostic `IImageStorageProvider` abstraction managed by `ImageService`.

```
Application (ProductForm, CustomPrinting, Review, CMS)
         ↓
    ImageService
         ↓
  IImageStorageProvider (Interface)
    ├── CloudinaryImageStorageProvider (Current)
    └── CloudflareR2StorageProvider   (Future)
```

Because application components call `ImageService` instead of vendor SDKs, migrating to Cloudflare R2 will require zero changes to frontend UI or backend business controllers.

---

## 2. PHASED MIGRATION STEPS

### Phase 1: Implement `CloudflareR2StorageProvider`
- Create `CloudflareR2StorageProvider.ts` implementing `IImageStorageProvider` using `@aws-sdk/client-s3` (R2 S3-compatible API).
- Configure `IMAGE_PROVIDER=r2` with `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_BUCKET_NAME`.

### Phase 2: Asset Sync & Dual-Read Execution
- Run background sync script to export assets from Cloudinary buckets (`samrat-fashion/*`) to Cloudflare R2 buckets.
- Enable dual-read fallback in `ImageService.ts` to inspect R2 first, falling back to Cloudinary legacy URLs if absent.

### Phase 3: Provider Cutover & Decommissioning
- Set `IMAGE_PROVIDER=r2` in production environment variables.
- Verify asset resolution via Cloudflare R2 CDN custom domain.
- Decommission Cloudinary account after 30-day verification window.
