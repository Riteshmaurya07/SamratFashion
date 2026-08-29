# SAMRAT FASHION — ADMIN PRODUCT IMAGE UPLOAD UI & INTEGRATION (PHASE 13B)

---

## 1. EXECUTIVE SUMMARY

Phase 13B connects the frontend Admin Product management interface (`/admin/products/new` and `/admin/products/[id]/edit`) to the provider-agnostic backend `ImageService` (`/api/upload/image`) implemented in Phase 13A.

The raw text area for comma-separated image URLs has been replaced with an interactive, modern **Product Image Upload Control**.

---

## 2. KEY CAPABILITIES & FEATURES

1. **Interactive File Selection**:
   - Styled file picker button `[ Upload Images ]` and visual dropzone container supporting single or multiple image file selection (`JPEG`, `PNG`, `WEBP`).
2. **Sequential Multi-File Upload**:
   - Uploads files sequentially through `api.post('/upload/image', formData)` using `multipart/form-data`.
   - Displays real-time progress (`Uploading 1 of 3...`) and clear error alerts for rejected files.
3. **Primary Image Designation & Reorder Controls**:
   - Highlights the index `0` image with a prominent `PRIMARY` badge.
   - Provides keyboard-accessible `Move Left` (`chevron_left`) and `Move Right` (`chevron_right`) controls to reorder images on the fly before saving.
4. **Image Removal & Object URL Safety**:
   - Allows instant removal of individual image cards.
   - Uses persistent backend Cloudinary/CDN URLs exclusively (zero Blob URL memory leaks or local path persistence).
5. **Manual URL Fallback**:
   - Includes a collapsible manual URL paste option (`Paste Direct Image URL`) for legacy or external CDN image URL entry.
6. **Zero Secret Exposure**:
   - Upload requests go through authenticated backend routes (`/api/upload/image`). `CLOUDINARY_API_SECRET` remains 100% backend-only.

---

## 3. API & SECURITY CONTRACT

```http
POST /api/upload/image
Authorization: Bearer <admin_jwt_token>
Content-Type: multipart/form-data

file: <binary_image_data>
category: "product"
productId: "optional_product_id"
```

**Server-Side Guards**:
- MIME validation: `image/jpeg`, `image/jpg`, `image/png`, `image/webp`.
- Size restriction: Maximum 5MB (5,242,880 bytes).
- Authorization: Requires `ADMIN` or `SUPER_ADMIN` role (returns `403 Forbidden` for customers, `401 Unauthorized` for unauthenticated requests).
