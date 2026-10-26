/**
 * Cloudinary & Product Asset Cleanup Test Suite
 *
 * Verifies that:
 * 1. Cloudinary public IDs are accurately extracted from all image URL formats.
 * 2. Deleting a product removes all associated assets (root images and variant images) from storage.
 * 3. Updating a product and removing images cleans up only the removed assets from storage.
 * 4. Products referenced by custom-print catalog items cannot be deleted without reassigning first.
 * 5. External non-storage URLs (e.g. Unsplash) are safely ignored during deletion.
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

import { getVerifiedTestMongoUri, assertSafeTestDatabase } from "../config/testDbGuard";
import { Product, ProductStatus } from "../models/Product";
import { Category, CategoryStatus } from "../models/Category";
import { CustomPrintCatalogItem } from "../models/CustomPrintCatalogItem";
import { ImageService } from "../services/image/ImageService";
import { IImageStorageProvider, ImageUploadResult } from "../services/image/IImageStorageProvider";
import { deleteProduct, updateProduct } from "../controllers/adminCatalogController";
import { Request, Response } from "express";
import { ContentBanner, BannerStatus, BannerPosition } from "../models/ContentBanner";
import { deleteAdminBanner, updateAdminBanner } from "../controllers/adminCmsController";
import { deleteAdminCatalogItem } from "../controllers/adminCustomPrintCatalogController";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(condition: boolean, desc: string, details?: string): void {
  if (condition) {
    console.log(`  ✅ PASS: ${desc}`);
    passed++;
  } else {
    const msg = details ? `${desc} — ${details}` : desc;
    failures.push(msg);
    console.error(`  ❌ FAIL: ${msg}`);
    failed++;
  }
}

interface MockResponse {
  statusCode: number;
  data: unknown;
  status(code: number): MockResponse;
  json(payload: unknown): MockResponse;
}

function createMockRes(): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    data: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.data = payload;
      return this;
    },
  };
  return res;
}

async function runCloudinaryCleanupTests(): Promise<void> {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║  Cloudinary Product Asset Cleanup Verification Suite           ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  // Connect to isolated test database
  const testUri = getVerifiedTestMongoUri();
  await mongoose.connect(testUri);
  assertSafeTestDatabase();
  console.log(` Connected to verified isolated test database: ${mongoose.connection.name}\n`);

  const cleanupProductIds: mongoose.Types.ObjectId[] = [];
  const cleanupCategoryIds: mongoose.Types.ObjectId[] = [];
  const cleanupCustomItemIds: mongoose.Types.ObjectId[] = [];
  const cleanupBannerIds: mongoose.Types.ObjectId[] = [];
  const timestamp = Date.now();

  // Mock Image Storage Provider to track asset deletions without external network calls
  const deletedPublicIds: string[] = [];
  const mockStorageProvider: IImageStorageProvider = {
    async upload(): Promise<ImageUploadResult> {
      return {
        provider: "cloudinary",
        publicId: "samrat-fashion/products/mock_asset",
        url: "https://res.cloudinary.com/dtvkytjnx/image/upload/v12345/samrat-fashion/products/mock_asset.jpg",
        secureUrl: "https://res.cloudinary.com/dtvkytjnx/image/upload/v12345/samrat-fashion/products/mock_asset.jpg",
        width: 800,
        height: 1000,
        format: "jpg",
        bytes: 1024,
      };
    },
    async delete(publicId: string): Promise<boolean> {
      deletedPublicIds.push(publicId);
      return true;
    },
    getUrl(publicId: string): string {
      return `https://res.cloudinary.com/dtvkytjnx/image/upload/v12345/${publicId}.jpg`;
    },
    transform(publicId: string): string {
      return this.getUrl(publicId);
    },
    async exists(publicId: string): Promise<boolean> {
      return !deletedPublicIds.includes(publicId);
    },
  };

  ImageService.setProvider(mockStorageProvider);

  try {
    // ─────────────────────────────────────────────────────────────────────────────
    // 1. URL & Public ID Extraction
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("[TEST GROUP 1: PUBLIC ID EXTRACTION]");

    check(
      ImageService.extractPublicId(
        "https://res.cloudinary.com/dtvkytjnx/image/upload/v1792953337/samrat-fashion/products/a8lpmvrrbxzmlsgywgkn.jpg"
      ) === "samrat-fashion/products/a8lpmvrrbxzmlsgywgkn",
      "1.1 Extracts publicId from standard Cloudinary URL with version"
    );

    check(
      ImageService.extractPublicId(
        "https://res.cloudinary.com/dtvkytjnx/image/upload/c_scale,w_500/v1792953337/samrat-fashion/products/nehru_vest.png"
      ) === "samrat-fashion/products/nehru_vest",
      "1.2 Extracts publicId from transformed Cloudinary URL"
    );

    check(
      ImageService.extractPublicId("samrat-fashion/products/plain_id") === "samrat-fashion/products/plain_id",
      "1.3 Handles already-relative storage publicId"
    );

    check(
      ImageService.extractPublicId("/uploads/samrat-fashion/products/local_photo.webp") ===
        "samrat-fashion/products/local_photo.webp",
      "1.4 Handles local upload storage path"
    );

    check(
      ImageService.extractPublicId("https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=800") === null,
      "1.5 Ignores external non-Cloudinary image URLs (e.g. Unsplash)"
    );

    check(ImageService.extractPublicId("") === null, "1.6 Empty string returns null");

    // ─────────────────────────────────────────────────────────────────────────────
    // 2. Batch Deletion Logic
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("\n[TEST GROUP 2: BATCH ASSET DELETION]");

    deletedPublicIds.length = 0;
    const testUrls = [
      "https://res.cloudinary.com/dtvkytjnx/image/upload/v1/samrat-fashion/products/asset_one.jpg",
      "https://res.cloudinary.com/dtvkytjnx/image/upload/v1/samrat-fashion/products/asset_two.png",
      "https://images.unsplash.com/photo-something", // external, ignored
      "https://res.cloudinary.com/dtvkytjnx/image/upload/v1/samrat-fashion/products/asset_one.jpg", // duplicate, deduped
    ];

    const deletedCount = await ImageService.deleteAssetsByUrls(testUrls);
    check(deletedCount === 2, "2.1 Deletes correct number of unique storage assets");
    check(deletedPublicIds.includes("samrat-fashion/products/asset_one"), "2.2 Deleted asset_one");
    check(deletedPublicIds.includes("samrat-fashion/products/asset_two"), "2.3 Deleted asset_two");
    check(deletedPublicIds.length === 2, "2.4 Deduplicates repeated URLs and ignores external URLs");

    // ─────────────────────────────────────────────────────────────────────────────
    // 3. Product Deletion & Cloudinary Asset Removal
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("\n[TEST GROUP 3: PRODUCT DELETION CASCADE]");

    const category = await Category.create({
      name: `Nehru Vests ${timestamp}`,
      slug: `nehru-vests-${timestamp}`,
      status: CategoryStatus.ACTIVE,
      displayOrder: 1,
    });
    cleanupCategoryIds.push(category._id);

    const product = await Product.create({
      name: `Elegant Sage Nehru Vest ${timestamp}`,
      slug: `elegant-sage-nehru-vest-${timestamp}`,
      description: "Premium tailored Nehru vest with Mandarin collar",
      categoryId: category._id,
      basePrice: 2499,
      status: ProductStatus.ACTIVE,
      images: [
        "https://res.cloudinary.com/dtvkytjnx/image/upload/v1/samrat-fashion/products/nehru_root_front.jpg",
        "https://res.cloudinary.com/dtvkytjnx/image/upload/v1/samrat-fashion/products/nehru_root_back.jpg",
      ],
      variants: [
        {
          size: "M",
          color: "SAGE",
          sku: `NEH-SAGE-M-${timestamp}`,
          stock: 25,
          additionalPrice: 0,
          isAvailable: true,
          images: [
            "https://res.cloudinary.com/dtvkytjnx/image/upload/v1/samrat-fashion/products/nehru_variant_m_1.jpg",
          ],
        },
        {
          size: "L",
          color: "SAGE",
          sku: `NEH-SAGE-L-${timestamp}`,
          stock: 30,
          additionalPrice: 0,
          isAvailable: true,
          images: [
            "https://res.cloudinary.com/dtvkytjnx/image/upload/v1/samrat-fashion/products/nehru_variant_l_1.jpg",
          ],
        },
      ],
    });
    cleanupProductIds.push(product._id);

    // Call deleteProduct
    deletedPublicIds.length = 0;
    const req = {
      params: { id: product._id.toString() },
      user: { id: new mongoose.Types.ObjectId().toString(), role: "ADMIN" },
    } as unknown as Request;
    const res = createMockRes();
    let deleteError: unknown = null;

    await deleteProduct(req as unknown as Request, res as unknown as Response, (err: unknown) => {
      deleteError = err;
    });

    check(!deleteError && res.statusCode === 200, "3.1 Product deletion endpoint succeeds with status 200");

    const foundInDb = await Product.findById(product._id);
    check(foundInDb === null, "3.2 Product is deleted from database");

    // Verify all 4 images (2 root + 2 variants) were deleted from Cloudinary
    check(deletedPublicIds.length === 4, "3.3 Exactly 4 Cloudinary assets were sent for deletion");
    check(
      deletedPublicIds.includes("samrat-fashion/products/nehru_root_front") &&
        deletedPublicIds.includes("samrat-fashion/products/nehru_root_back") &&
        deletedPublicIds.includes("samrat-fashion/products/nehru_variant_m_1") &&
        deletedPublicIds.includes("samrat-fashion/products/nehru_variant_l_1"),
      "3.4 All root and variant Cloudinary images were deleted from storage"
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // 4. Update Product & Orphan Asset Deletion
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("\n[TEST GROUP 4: IMAGE REMOVAL ON PRODUCT UPDATE]");

    const editProduct = await Product.create({
      name: `Heritage Bandhgala ${timestamp}`,
      slug: `heritage-bandhgala-${timestamp}`,
      description: "Classic Bandhgala jacket",
      categoryId: category._id,
      basePrice: 3999,
      status: ProductStatus.ACTIVE,
      images: [
        "https://res.cloudinary.com/dtvkytjnx/image/upload/v1/samrat-fashion/products/keep_image_1.jpg",
        "https://res.cloudinary.com/dtvkytjnx/image/upload/v1/samrat-fashion/products/remove_image_2.jpg",
      ],
      variants: [
        {
          size: "40",
          color: "NAVY",
          sku: `BDG-NAVY-40-${timestamp}`,
          stock: 10,
          additionalPrice: 0,
          isAvailable: true,
          images: [],
        },
      ],
    });
    cleanupProductIds.push(editProduct._id);

    deletedPublicIds.length = 0;
    const updateReq = {
      params: { id: editProduct._id.toString() },
      body: {
        images: [
          "https://res.cloudinary.com/dtvkytjnx/image/upload/v1/samrat-fashion/products/keep_image_1.jpg",
          "https://res.cloudinary.com/dtvkytjnx/image/upload/v1/samrat-fashion/products/new_added_image_3.jpg",
        ],
      },
      user: { id: new mongoose.Types.ObjectId().toString(), role: "ADMIN" },
    } as unknown as Request;
    const updateRes = createMockRes();
    let updateErr: unknown = null;

    await updateProduct(updateReq as unknown as Request, updateRes as unknown as Response, (err: unknown) => {
      updateErr = err;
    });

    check(!updateErr && updateRes.statusCode === 200, "4.1 Product update succeeds");
    check(
      deletedPublicIds.length === 1 &&
        deletedPublicIds.includes("samrat-fashion/products/remove_image_2"),
      "4.2 Removed image was deleted from Cloudinary, while kept image was preserved"
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // 5. Deletion Safeguard: Custom Print References
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("\n[TEST GROUP 5: DELETION SAFEGUARD WITH CATALOG REFERENCES]");

    const protectedProduct = await Product.create({
      name: `Custom Blank Tee ${timestamp}`,
      slug: `custom-blank-tee-${timestamp}`,
      description: "Customizable apparel base",
      categoryId: category._id,
      basePrice: 699,
      status: ProductStatus.ACTIVE,
      isCustomizable: true,
      variants: [
        {
          size: "L",
          color: "WHITE",
          sku: `BLANK-WHT-L-${timestamp}`,
          stock: 50,
          additionalPrice: 0,
          isAvailable: true,
          images: [],
        },
      ],
    });
    cleanupProductIds.push(protectedProduct._id);

    const customItem = await CustomPrintCatalogItem.create({
      name: `Custom Printed Tee ${timestamp}`,
      slug: `custom-printed-tee-${timestamp}`,
      description: "Direct reference to product",
      categoryId: category._id,
      productId: protectedProduct._id,
      mockupImageUrl: "https://example.com/mockup.png",
      displayPrice: 899,
      sortOrder: 1,
      isActive: true,
    });
    cleanupCustomItemIds.push(customItem._id as mongoose.Types.ObjectId);

    deletedPublicIds.length = 0;
    const blockedReq = {
      params: { id: protectedProduct._id.toString() },
      user: { id: new mongoose.Types.ObjectId().toString(), role: "ADMIN" },
    } as unknown as Request;
    const blockedRes = createMockRes();
    const blockedState = { error: null as { statusCode?: number } | null };

    await deleteProduct(blockedReq as unknown as Request, blockedRes as unknown as Response, (err: unknown) => {
      blockedState.error = err as { statusCode?: number };
    });

    check(
      blockedState.error !== null && blockedState.error.statusCode === 400,
      "5.1 Deletion is blocked with 400 when custom-print catalog item references the product"
    );
    const stillInDb = await Product.findById(protectedProduct._id);
    check(stillInDb !== null, "5.2 Product remains in database when deletion is blocked");
    check(deletedPublicIds.length === 0, "5.3 No assets are deleted when product deletion is blocked");

    // ─────────────────────────────────────────────────────────────────────────────
    // 6. Banner Deletion & Cloudinary Asset Removal
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("\n[TEST GROUP 6: BANNER DELETION CASCADE]");

    const banner = await ContentBanner.create({
      title: `Hero Sale Drop ${timestamp}`,
      subtitle: "Exclusive Streetwear Collection",
      image: "https://res.cloudinary.com/dtvkytjnx/image/upload/v1/samrat-fashion/banners/hero_desktop.jpg",
      mobileImage: "https://res.cloudinary.com/dtvkytjnx/image/upload/v1/samrat-fashion/banners/hero_mobile.jpg",
      position: BannerPosition.HERO,
      status: BannerStatus.ACTIVE,
    });
    cleanupBannerIds.push(banner._id as mongoose.Types.ObjectId);

    deletedPublicIds.length = 0;
    const bannerDeleteReq = {
      params: { id: banner._id.toString() },
      user: { id: new mongoose.Types.ObjectId().toString(), role: "ADMIN" },
    } as unknown as Request;
    const bannerDeleteRes = createMockRes();
    let bannerDeleteErr: unknown = null;

    await deleteAdminBanner(bannerDeleteReq, bannerDeleteRes as unknown as Response, (err) => {
      bannerDeleteErr = err;
    });

    check(!bannerDeleteErr && bannerDeleteRes.statusCode === 200, "6.1 Banner deletion endpoint succeeds with status 200");
    const bannerInDb = await ContentBanner.findById(banner._id);
    check(bannerInDb === null, "6.2 Banner is deleted from database");
    check(
      deletedPublicIds.includes("samrat-fashion/banners/hero_desktop") &&
        deletedPublicIds.includes("samrat-fashion/banners/hero_mobile"),
      "6.3 Both desktop and mobile banner assets deleted from Cloudinary storage"
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // 7. Banner Image Update & Replaced Asset Removal
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("\n[TEST GROUP 7: BANNER IMAGE UPDATE]");

    const updateBannerItem = await ContentBanner.create({
      title: `Promo Banner ${timestamp}`,
      image: "https://res.cloudinary.com/dtvkytjnx/image/upload/v1/samrat-fashion/banners/old_banner.jpg",
      position: BannerPosition.HERO,
      status: BannerStatus.DRAFT,
    });
    cleanupBannerIds.push(updateBannerItem._id as mongoose.Types.ObjectId);

    deletedPublicIds.length = 0;
    const updateBannerReq = {
      params: { id: updateBannerItem._id.toString() },
      body: {
        title: `Promo Banner ${timestamp}`,
        image: "https://res.cloudinary.com/dtvkytjnx/image/upload/v1/samrat-fashion/banners/new_banner.jpg",
      },
      user: { id: new mongoose.Types.ObjectId().toString(), role: "ADMIN" },
    } as unknown as Request;
    const updateBannerRes = createMockRes();
    let updateBannerErr: unknown = null;

    await updateAdminBanner(updateBannerReq, updateBannerRes as unknown as Response, (err) => {
      updateBannerErr = err;
    });

    check(!updateBannerErr && updateBannerRes.statusCode === 200, "7.1 Banner update succeeds with status 200");
    check(
      deletedPublicIds.includes("samrat-fashion/banners/old_banner"),
      "7.2 Replaced old banner image was removed from Cloudinary storage"
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // 8. Custom Print Catalog Item Deletion & Mockup Removal
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("\n[TEST GROUP 8: CUSTOM PRINT CATALOG ITEM DELETION]");

    const testPrintItem = await CustomPrintCatalogItem.create({
      name: `Boxy Cut Mockup Item ${timestamp}`,
      slug: `boxy-cut-mockup-${timestamp}`,
      productId: protectedProduct._id,
      mockupImageUrl: "https://res.cloudinary.com/dtvkytjnx/image/upload/v1/samrat-fashion/mockups/front_mockup.png",
      backMockupImageUrl: "https://res.cloudinary.com/dtvkytjnx/image/upload/v1/samrat-fashion/mockups/back_mockup.png",
      displayPrice: 999,
      isActive: true,
    });
    cleanupCustomItemIds.push(testPrintItem._id as mongoose.Types.ObjectId);

    deletedPublicIds.length = 0;
    const printItemReq = {
      params: { id: testPrintItem._id.toString() },
    } as unknown as Request;
    const printItemRes = createMockRes();
    let printItemErr: unknown = null;

    await deleteAdminCatalogItem(printItemReq, printItemRes as unknown as Response, (err) => {
      printItemErr = err;
    });

    check(!printItemErr && printItemRes.statusCode === 200, "8.1 Catalog item deletion succeeds with status 200");
    const printItemInDb = await CustomPrintCatalogItem.findById(testPrintItem._id);
    check(printItemInDb === null, "8.2 Catalog item is deleted from database");
    check(
      deletedPublicIds.includes("samrat-fashion/mockups/front_mockup") &&
        deletedPublicIds.includes("samrat-fashion/mockups/back_mockup"),
      "8.3 Both front and back mockups removed from Cloudinary storage"
    );

  } catch (err: unknown) {
    console.error("💥 Unhandled test exception:", err);
    failed++;
    failures.push(`Unhandled test exception: ${err}`);
  } finally {
    ImageService.resetProvider();
    console.log("\n🧹 Cleaning up test fixtures from database...");
    if (cleanupCustomItemIds.length > 0) {
      await CustomPrintCatalogItem.deleteMany({ _id: { $in: cleanupCustomItemIds } });
    }
    if (cleanupBannerIds.length > 0) {
      await ContentBanner.deleteMany({ _id: { $in: cleanupBannerIds } });
    }
    if (cleanupProductIds.length > 0) {
      await Product.deleteMany({ _id: { $in: cleanupProductIds } });
    }
    if (cleanupCategoryIds.length > 0) {
      await Category.deleteMany({ _id: { $in: cleanupCategoryIds } });
    }
    await mongoose.disconnect();
    console.log(" Disconnected from MongoDB\n");
  }

  console.log("════════════════════════════════════════════════════════════════");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log("Failures:");
    failures.forEach((f) => console.log(`  - ${f}`));
  }
  console.log("════════════════════════════════════════════════════════════════\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runCloudinaryCleanupTests().catch((err) => {
  console.error("Fatal test runner error:", err);
  process.exit(1);
});
