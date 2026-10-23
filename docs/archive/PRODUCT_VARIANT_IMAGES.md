# SAMRAT FASHION — COLOR-SPECIFIC PRODUCT IMAGE GALLERY (FLIPKART-STYLE VARIANT SWITCHING)

---

## 1. EXECUTIVE SUMMARY

This feature fixes the ecommerce UX gap where selecting a product color previously changed variant state without switching the displayed product image gallery.

When a customer selects a color on the Product Detail Page (`/shop/[slug]`):
1. **Selected Color & Variant**: Selected color updates; compatible variant/SKU is determined.
2. **Gallery & Main Image Switch**: Main image and thumbnail gallery switch immediately to images associated with that specific color/variant.
3. **Price & Stock Synchronization**: Price (`basePrice + additionalPrice`) and stock update according to selected variant.
4. **Size & Color Memory**: Switching size preserves selected color gallery; switching color preserves selected size when available.
5. **Fallback Priority**: If color-specific images are missing, gallery falls back safely without breaking page layout.

---

## 2. MULTI-TIER IMAGE FALLBACK PRIORITY

```
Selected Variant Images (v.images[])
         ↓ (if empty)
Color Group Images (variants matching color with images[])
         ↓ (if empty)
Product Generic Gallery (product.images[])
         ↓ (if empty)
Default Catalog Placeholder Image
```

---

## 3. DATA SCHEMA & ARCHITECTURE

```typescript
// Backend Model (Product.ts)
export interface IProductVariant {
  _id?: mongoose.Types.ObjectId;
  size?: string;
  color?: string;
  hexCode?: string;
  sku: string;
  stock: number;
  additionalPrice: number;
  images: string[]; // Variant & Color-Specific Images
  isAvailable: boolean;
}
```

- **Storage Abstraction**: Uses provider-agnostic CDN URLs (`ImageService` / Cloudinary) created in Phase 13A/13B.
- **Admin Management**: Admins can assign color-specific image URLs to each variant in `ProductForm.tsx`.
