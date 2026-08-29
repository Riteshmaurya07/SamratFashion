# SAMRAT FASHION — IMAGE STORAGE INFRASTRUCTURE (PHASE 13A)

---

## 1. ARCHITECTURE SUMMARY

SamratFashion isolates vendor-specific CDN dependencies behind `ImageService` and `IImageStorageProvider`.

```
Frontend (ProductForm, CustomPrinting, Review, CMS)
         ↓ HTTP POST /api/upload/image (Multer 5MB Buffer)
Backend UploadController (MIME Validation & RBAC)
         ↓
    ImageService
         ↓
IImageStorageProvider Contract
  ├── CloudinaryImageStorageProvider (Production CDN: res.cloudinary.com)
  └── LocalImageStorageProvider      (Dev & Automated Test Isolation)
```

---

## 2. ENVIRONMENT CONFIGURATION

```env
# Backend Environment (.env)
IMAGE_PROVIDER=cloudinary # 'cloudinary' | 'local'

# Cloudinary CDN Credentials (Backend Only — Never expose to browser)
CLOUDINARY_CLOUD_NAME=demo_cloud
CLOUDINARY_API_KEY=123456789012345
CLOUDINARY_API_SECRET=your_cloudinary_secret_here
```

---

## 3. SECURITY & AUTHORIZATION RULES

1. **Secret Protection**: `CLOUDINARY_API_SECRET` is used exclusively on the Node.js backend. Zero secret exposure in frontend, Git, or logs.
2. **RBAC Guard**:
   - `product`, `banner`, `campaign` asset uploads require `ADMIN` or `SUPER_ADMIN` role.
   - `custom-artwork` and `review` photo uploads require authenticated customer token (`req.user`).
3. **Payload Safeguards**:
   - Maximum upload file size: `5MB` (5 * 1024 * 1024 bytes).
   - Allowed MIME types: `image/jpeg`, `image/jpg`, `image/png`, `image/webp`.
