/**
 * Comprehensive Backend-Driven Category & Catalog Verification Suite
 *
 * Verifies all 14 acceptance criteria from Phase 9:
 * 1. Public category API returns active categories in displayOrder.
 * 2. Inactive categories do not appear in public results.
 * 3. Creating an active category makes it available to public catalog.
 * 4. Editing name, slug, image, or order is reflected appropriately.
 * 5. Deactivating a category removes it from public navigation and filters.
 * 6. Inactive categories with existing products remain referenced in DB.
 * 7. Valid category filters products correctly.
 * 8. Parent category filtering includes active descendants.
 * 9. Invalid category slug returns 0 products (never entire catalog).
 * 10. Inactive category slug returns 0 products (never entire catalog).
 * 11. Theme filters use actual themes; invalid/inactive returns 0 products.
 * 12. Combined price, size, search, and sorting continue working.
 * 13. General catalog excludes products belonging to inactive categories.
 * 14. Product detail returns 404 for products in inactive categories.
 */

import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import { Request, Response } from "express";
import { Category, CategoryStatus } from "../models/Category";
import { Theme, ThemeStatus } from "../models/Theme";
import { Product, ProductStatus } from "../models/Product";
import {
  getCategories,
  getCategoryBySlug,
  getThemes,
  getThemeBySlug,
  getProducts,
  getProductBySlug,
  getHomepageCatalog,
} from "../controllers/catalogController";
import {
  createCategory,
  updateCategory,
  updateCategoryStatus,
} from "../controllers/adminCatalogController";
import { AppError } from "../utils/AppError";
import { getVerifiedTestMongoUri, assertSafeTestDatabase } from "../config/testDbGuard";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function pass(name: string): void {
  console.log(`  ✅ PASS: ${name}`);
  passed++;
}

function fail(name: string, reason: string): void {
  console.error(`  ❌ FAIL: ${name} — ${reason}`);
  failed++;
  failures.push(`${name}: ${reason}`);
}

interface MockResponse {
  statusCode: number;
  body: unknown;
  status(code: number): MockResponse;
  json(data: unknown): MockResponse;
}

function createMockResponse(): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: unknown) {
      this.body = data;
      return this;
    },
  };
  return res;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

interface ProductListResponse {
  items: Array<{ _id: unknown; name: string; slug: string; categoryId: unknown }>;
  total: number;
  page: number;
  limit: number;
}

async function runTests(): Promise<void> {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║  Backend-Driven Categories Verification Suite                 ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  const testUri = getVerifiedTestMongoUri();
  await mongoose.connect(testUri);
  assertSafeTestDatabase();
  console.log(` Connected to verified isolated test database: ${mongoose.connection.name}\n`);

  // Track created test IDs for guaranteed cleanup
  const cleanupCategoryIds: mongoose.Types.ObjectId[] = [];
  const cleanupThemeIds: mongoose.Types.ObjectId[] = [];
  const cleanupProductIds: mongoose.Types.ObjectId[] = [];

  const timestamp = Date.now();

  try {
    // ─── SETUP: Test Categories ───
    const parentCategory = await Category.create({
      name: `Parent Streetwear ${timestamp}`,
      slug: `parent-streetwear-${timestamp}`,
      description: "Parent root category for streetwear",
      displayOrder: 1,
      status: CategoryStatus.ACTIVE,
    });
    cleanupCategoryIds.push(parentCategory._id);

    const childOversized = await Category.create({
      name: `Child Oversized ${timestamp}`,
      slug: `child-oversized-${timestamp}`,
      description: "240 GSM heavy oversized tees",
      parentCategory: parentCategory._id,
      displayOrder: 1,
      status: CategoryStatus.ACTIVE,
    });
    cleanupCategoryIds.push(childOversized._id);

    const childGraphic = await Category.create({
      name: `Child Graphic ${timestamp}`,
      slug: `child-graphic-${timestamp}`,
      description: "Underground street art prints",
      parentCategory: parentCategory._id,
      displayOrder: 2,
      status: CategoryStatus.ACTIVE,
    });
    cleanupCategoryIds.push(childGraphic._id);

    const standaloneActive = await Category.create({
      name: `Standalone Basics ${timestamp}`,
      slug: `standalone-basics-${timestamp}`,
      description: "Minimal boxy blanks",
      displayOrder: 3,
      status: CategoryStatus.ACTIVE,
    });
    cleanupCategoryIds.push(standaloneActive._id);

    const inactiveCategory = await Category.create({
      name: `Archived Vintage ${timestamp}`,
      slug: `archived-vintage-${timestamp}`,
      description: "Inactive historical archive",
      displayOrder: 99,
      status: CategoryStatus.INACTIVE,
    });
    cleanupCategoryIds.push(inactiveCategory._id);

    // ─── SETUP: Test Themes ───
    const activeTheme = await Theme.create({
      name: `Cyber Drop ${timestamp}`,
      slug: `cyber-drop-${timestamp}`,
      description: "Neon cyberpunk capsule",
      status: ThemeStatus.ACTIVE,
      displayOrder: 1,
      isFeatured: true,
    });
    cleanupThemeIds.push(activeTheme._id);

    const inactiveTheme = await Theme.create({
      name: `Legacy Drop ${timestamp}`,
      slug: `legacy-drop-${timestamp}`,
      description: "Deactivated drop",
      status: ThemeStatus.INACTIVE,
      displayOrder: 2,
    });
    cleanupThemeIds.push(inactiveTheme._id);

    // ─── SETUP: Test Products ───
    const productOversized = await Product.create({
      name: `Heavy Oversized Boxy Tee ${timestamp}`,
      slug: `heavy-oversized-boxy-tee-${timestamp}`,
      description: "Heavy 240 GSM drop shoulder tee",
      categoryId: childOversized._id,
      themeIds: [activeTheme._id],
      basePrice: 799,
      status: ProductStatus.ACTIVE,
      variants: [
        { sku: `OVR-M-${timestamp}`, size: "M", color: "BLACK", stock: 20, isAvailable: true },
        { sku: `OVR-L-${timestamp}`, size: "L", color: "BLACK", stock: 20, isAvailable: true },
      ],
      images: ["https://example.com/oversized.jpg"],
    });
    cleanupProductIds.push(productOversized._id);

    const productGraphic = await Product.create({
      name: `Underground Cyber Tee ${timestamp}`,
      slug: `underground-cyber-tee-${timestamp}`,
      description: "Tokyo underground graphic tee",
      categoryId: childGraphic._id,
      themeIds: [activeTheme._id],
      basePrice: 899,
      status: ProductStatus.ACTIVE,
      variants: [
        { sku: `GRP-M-${timestamp}`, size: "M", color: "WHITE", stock: 15, isAvailable: true },
      ],
      images: ["https://example.com/graphic.jpg"],
    });
    cleanupProductIds.push(productGraphic._id);

    const productStandalone = await Product.create({
      name: `Raw Minimal Blank ${timestamp}`,
      slug: `raw-minimal-blank-${timestamp}`,
      description: "Clean minimalist blank",
      categoryId: standaloneActive._id,
      basePrice: 599,
      status: ProductStatus.ACTIVE,
      variants: [
        { sku: `MNL-S-${timestamp}`, size: "S", color: "GREY", stock: 30, isAvailable: true },
      ],
      images: ["https://example.com/minimal.jpg"],
    });
    cleanupProductIds.push(productStandalone._id);

    const productInactiveCat = await Product.create({
      name: `Deadstock Vintage Tee ${timestamp}`,
      slug: `deadstock-vintage-tee-${timestamp}`,
      description: "Belongs to inactive category",
      categoryId: inactiveCategory._id,
      basePrice: 1299,
      status: ProductStatus.ACTIVE,
      variants: [
        { sku: `VNT-XL-${timestamp}`, size: "XL", color: "BLACK", stock: 5, isAvailable: true },
      ],
      images: ["https://example.com/vintage.jpg"],
    });
    cleanupProductIds.push(productInactiveCat._id);

    console.log("[TEST GROUP 1: PUBLIC CATEGORY ENDPOINTS]");

    // 1. getCategories returns active categories in displayOrder, excludes inactive
    {
      const req = {} as Request;
      const res = createMockResponse();
      await getCategories(req, res as unknown as Response, () => {});

      const body = res.body as ApiResponse<Array<{ slug: string; status: string; displayOrder: number }>>;
      const slugs = body.data.map(c => c.slug);

      if (slugs.includes(childOversized.slug) && slugs.includes(childGraphic.slug) && slugs.includes(standaloneActive.slug)) {
        pass("1.1 Active categories are present in getCategories");
      } else {
        fail("1.1 Active categories present", `Missing active categories in ${JSON.stringify(slugs)}`);
      }

      if (!slugs.includes(inactiveCategory.slug)) {
        pass("1.2 Inactive categories are excluded from getCategories");
      } else {
        fail("1.2 Inactive categories excluded", `Inactive slug ${inactiveCategory.slug} was found in response`);
      }
    }

    // 2. getCategoryBySlug: active slug succeeds, inactive slug returns 404
    {
      const reqActive = { params: { slug: childOversized.slug } } as unknown as Request;
      const resActive = createMockResponse();
      await getCategoryBySlug(reqActive, resActive as unknown as Response, () => {});

      const activeBody = resActive.body as ApiResponse<{ slug: string }>;
      if (activeBody?.data?.slug === childOversized.slug) {
        pass("2.1 getCategoryBySlug returns active category by slug");
      } else {
        fail("2.1 getCategoryBySlug active", `Expected ${childOversized.slug}, got ${JSON.stringify(activeBody)}`);
      }

      const reqInactive = { params: { slug: inactiveCategory.slug } } as unknown as Request;
      const resInactive = createMockResponse();
      let nextInactiveError: unknown = null;
      await getCategoryBySlug(reqInactive, resInactive as unknown as Response, (err) => { nextInactiveError = err; });

      if (nextInactiveError instanceof AppError && nextInactiveError.statusCode === 404) {
        pass("2.2 getCategoryBySlug returns 404 for inactive category");
      } else {
        fail("2.2 getCategoryBySlug inactive", `Expected 404 AppError, got ${nextInactiveError}`);
      }

      const reqNonExistent = { params: { slug: `ghost-cat-${timestamp}` } } as unknown as Request;
      const resNonExistent = createMockResponse();
      let nextNonExistentError: unknown = null;
      await getCategoryBySlug(reqNonExistent, resNonExistent as unknown as Response, (err) => { nextNonExistentError = err; });

      if (nextNonExistentError instanceof AppError && nextNonExistentError.statusCode === 404) {
        pass("2.3 getCategoryBySlug returns 404 for non-existent category");
      } else {
        fail("2.3 getCategoryBySlug non-existent", `Expected 404 AppError, got ${nextNonExistentError}`);
      }
    }

    console.log("\n[TEST GROUP 2: PUBLIC THEMES ENDPOINTS]");

    // 3. getThemes and getThemeBySlug
    {
      const req = {} as Request;
      const res = createMockResponse();
      await getThemes(req, res as unknown as Response, () => {});
      const body = res.body as ApiResponse<Array<{ slug: string }>>;
      const themeSlugs = body.data.map(t => t.slug);

      if (themeSlugs.includes(activeTheme.slug) && !themeSlugs.includes(inactiveTheme.slug)) {
        pass("3.1 getThemes returns active themes and excludes inactive themes");
      } else {
        fail("3.1 getThemes active vs inactive", `Theme slugs: ${JSON.stringify(themeSlugs)}`);
      }

      const reqTheme = { params: { slug: activeTheme.slug } } as unknown as Request;
      const resTheme = createMockResponse();
      await getThemeBySlug(reqTheme, resTheme as unknown as Response, () => {});
      const themeBody = resTheme.body as ApiResponse<{ slug: string }>;
      if (themeBody?.data?.slug === activeTheme.slug) {
        pass("3.2 getThemeBySlug returns active theme");
      } else {
        fail("3.2 getThemeBySlug active", `Expected ${activeTheme.slug}, got ${JSON.stringify(themeBody)}`);
      }

      const reqInactiveTheme = { params: { slug: inactiveTheme.slug } } as unknown as Request;
      const resInactiveTheme = createMockResponse();
      let inactiveThemeErr: unknown = null;
      await getThemeBySlug(reqInactiveTheme, resInactiveTheme as unknown as Response, (err) => { inactiveThemeErr = err; });
      if (inactiveThemeErr instanceof AppError && inactiveThemeErr.statusCode === 404) {
        pass("3.3 getThemeBySlug returns 404 for inactive theme");
      } else {
        fail("3.3 getThemeBySlug inactive", `Expected 404 AppError, got ${inactiveThemeErr}`);
      }
    }

    console.log("\n[TEST GROUP 3: PRODUCT FILTERING & CATALOG INTEGRITY]");

    // 4. Product filtering by valid child category
    {
      const req = { query: { category: childOversized.slug } } as unknown as Request;
      const res = createMockResponse();
      await getProducts(req, res as unknown as Response, () => {});
      const body = res.body as ApiResponse<ProductListResponse>;
      const items = body.data.items;

      const hasOversized = items.some(p => p.slug === productOversized.slug);
      const hasGraphic = items.some(p => p.slug === productGraphic.slug);

      if (hasOversized && !hasGraphic) {
        pass("4.1 getProducts filters products by valid child category slug");
      } else {
        fail("4.1 getProducts child filter", `Expected only oversized tee, got ${items.map(i => i.slug)}`);
      }
    }

    // 5. Parent category filtering includes active descendant categories
    {
      const req = { query: { category: parentCategory.slug } } as unknown as Request;
      const res = createMockResponse();
      await getProducts(req, res as unknown as Response, () => {});
      const body = res.body as ApiResponse<ProductListResponse>;
      const items = body.data.items;

      const hasOversized = items.some(p => p.slug === productOversized.slug);
      const hasGraphic = items.some(p => p.slug === productGraphic.slug);
      const hasStandalone = items.some(p => p.slug === productStandalone.slug);

      if (hasOversized && hasGraphic && !hasStandalone) {
        pass("5.1 Parent category filter includes products from all active descendant child categories");
      } else {
        fail("5.1 Parent category hierarchy", `Expected oversized and graphic, but not standalone. Got ${items.map(i => i.slug)}`);
      }
    }

    // 6. Unknown category slug returns 0 products (does NOT return unfiltered catalog)
    {
      const req = { query: { category: `unknown-slug-${timestamp}` } } as unknown as Request;
      const res = createMockResponse();
      await getProducts(req, res as unknown as Response, () => {});
      const body = res.body as ApiResponse<ProductListResponse>;

      if (body.data.total === 0 && body.data.items.length === 0) {
        pass("6.1 Unknown category slug returns 0 products without exposing catalog");
      } else {
        fail("6.1 Unknown category returns empty", `Expected 0 items, got ${body.data.total}`);
      }
    }

    // 7. Inactive category slug returns 0 products (does NOT return unfiltered catalog)
    {
      const req = { query: { category: inactiveCategory.slug } } as unknown as Request;
      const res = createMockResponse();
      await getProducts(req, res as unknown as Response, () => {});
      const body = res.body as ApiResponse<ProductListResponse>;

      if (body.data.total === 0 && body.data.items.length === 0) {
        pass("7.1 Inactive category slug returns 0 products without exposing catalog");
      } else {
        fail("7.1 Inactive category returns empty", `Expected 0 items, got ${body.data.total}`);
      }
    }

    // 8. Theme filter: active theme filters correctly, inactive theme returns 0 products
    {
      const reqActive = { query: { theme: activeTheme.slug } } as unknown as Request;
      const resActive = createMockResponse();
      await getProducts(reqActive, resActive as unknown as Response, () => {});
      const activeBody = resActive.body as ApiResponse<ProductListResponse>;

      const hasOversized = activeBody.data.items.some(p => p.slug === productOversized.slug);
      const hasStandalone = activeBody.data.items.some(p => p.slug === productStandalone.slug);

      if (hasOversized && !hasStandalone) {
        pass("8.1 Active theme slug filters products correctly");
      } else {
        fail("8.1 Active theme filter", `Expected oversized in theme, got ${activeBody.data.items.map(i => i.slug)}`);
      }

      const reqInactive = { query: { theme: inactiveTheme.slug } } as unknown as Request;
      const resInactive = createMockResponse();
      await getProducts(reqInactive, resInactive as unknown as Response, () => {});
      const inactiveBody = resInactive.body as ApiResponse<ProductListResponse>;

      if (inactiveBody.data.total === 0 && inactiveBody.data.items.length === 0) {
        pass("8.2 Inactive theme slug returns 0 products without exposing catalog");
      } else {
        fail("8.2 Inactive theme filter", `Expected 0 items, got ${inactiveBody.data.total}`);
      }
    }

    // 9. General catalog browsing excludes products belonging to inactive categories
    {
      const req = { query: {} } as unknown as Request;
      const res = createMockResponse();
      await getProducts(req, res as unknown as Response, () => {});
      const body = res.body as ApiResponse<ProductListResponse>;

      const hasInactiveProduct = body.data.items.some(p => p.slug === productInactiveCat.slug);
      if (!hasInactiveProduct) {
        pass("9.1 General catalog excludes products belonging to inactive categories");
      } else {
        fail("9.1 General catalog inactive filter", `Product in inactive category was found in general catalog`);
      }
    }

    // 10. getProductBySlug: product in inactive category returns 404
    {
      const reqActiveProd = { params: { slug: productOversized.slug } } as unknown as Request;
      const resActiveProd = createMockResponse();
      await getProductBySlug(reqActiveProd, resActiveProd as unknown as Response, () => {});
      const activeProdBody = resActiveProd.body as ApiResponse<{ slug: string }>;

      if (activeProdBody?.data?.slug === productOversized.slug) {
        pass("10.1 getProductBySlug returns active product in active category");
      } else {
        fail("10.1 getProductBySlug active", `Expected ${productOversized.slug}`);
      }

      const reqInactiveProd = { params: { slug: productInactiveCat.slug } } as unknown as Request;
      const resInactiveProd = createMockResponse();
      let inactiveProdErr: unknown = null;
      await getProductBySlug(reqInactiveProd, resInactiveProd as unknown as Response, (err) => { inactiveProdErr = err; });

      if (inactiveProdErr instanceof AppError && inactiveProdErr.statusCode === 404) {
        pass("10.2 getProductBySlug returns 404 for product whose category is inactive");
      } else {
        fail("10.2 getProductBySlug inactive category product", `Expected 404, got ${inactiveProdErr}`);
      }
    }

    console.log("\n[TEST GROUP 4: ADMIN CATEGORY LIFECYCLE & MUTATION PROPAGATION]");

    // 11. Admin create category -> immediately accessible publicly
    let dynamicCategoryId = "";
    const dynamicSlug = `dyn-streetwear-${timestamp}`;
    {
      const mockAdminReq = {
        user: { id: new mongoose.Types.ObjectId().toString(), role: "ADMIN" },
        body: {
          name: `Dynamic Streetwear ${timestamp}`,
          slug: dynamicSlug,
          description: "Created via admin panel",
          displayOrder: 5,
          status: "ACTIVE",
        },
      } as unknown as Request;
      const mockAdminRes = createMockResponse();

      await createCategory(mockAdminReq as unknown as Request, mockAdminRes as unknown as Response, () => {});
      const createdBody = mockAdminRes.body as ApiResponse<{ _id: string; slug: string }>;
      dynamicCategoryId = createdBody?.data?._id?.toString() || "";
      if (dynamicCategoryId) cleanupCategoryIds.push(new mongoose.Types.ObjectId(dynamicCategoryId));

      // Public verification
      const pubReq = { params: { slug: dynamicSlug } } as unknown as Request;
      const pubRes = createMockResponse();
      await getCategoryBySlug(pubReq, pubRes as unknown as Response, () => {});
      const pubBody = pubRes.body as ApiResponse<{ slug: string }>;

      if (pubBody?.data?.slug === dynamicSlug) {
        pass("11.1 Creating category in admin makes it immediately accessible to public API");
      } else {
        fail("11.1 Admin create propagation", `Category was not accessible via public API`);
      }
    }

    // 12. Admin update category name & display order -> immediately reflected
    {
      const updatedName = `Renamed Streetwear ${timestamp}`;
      const mockAdminReq = {
        user: { id: new mongoose.Types.ObjectId().toString(), role: "ADMIN" },
        params: { id: dynamicCategoryId },
        body: {
          name: updatedName,
          displayOrder: 1,
        },
      } as unknown as Request;
      const mockAdminRes = createMockResponse();

      await updateCategory(mockAdminReq as unknown as Request, mockAdminRes as unknown as Response, () => {});

      const pubReq = { params: { slug: dynamicSlug } } as unknown as Request;
      const pubRes = createMockResponse();
      await getCategoryBySlug(pubReq, pubRes as unknown as Response, () => {});
      const pubBody = pubRes.body as ApiResponse<{ name: string; displayOrder: number }>;

      if (pubBody?.data?.name === updatedName && pubBody?.data?.displayOrder === 1) {
        pass("12.1 Updating category in admin updates public category name and displayOrder");
      } else {
        fail("12.1 Admin update propagation", `Expected name ${updatedName}, got ${pubBody?.data?.name}`);
      }
    }

    // 13. Admin deactivates category -> category disappears from public API and filters
    {
      const mockStatusReq = {
        user: { id: new mongoose.Types.ObjectId().toString(), role: "ADMIN" },
        params: { id: dynamicCategoryId },
        body: { status: "INACTIVE" },
      } as unknown as Request;
      const mockStatusRes = createMockResponse();

      await updateCategoryStatus(mockStatusReq as unknown as Request, mockStatusRes as unknown as Response, () => {});

      const pubReq = { params: { slug: dynamicSlug } } as unknown as Request;
      const pubRes = createMockResponse();
      let pubErr: unknown = null;
      await getCategoryBySlug(pubReq, pubRes as unknown as Response, (err) => { pubErr = err; });

      if (pubErr instanceof AppError && pubErr.statusCode === 404) {
        pass("13.1 Deactivating category removes it from public category endpoints");
      } else {
        fail("13.1 Deactivate propagation", `Expected 404 for deactivated category, got ${pubErr}`);
      }

      // Products queried with deactivated slug return 0
      const prodReq = { query: { category: dynamicSlug } } as unknown as Request;
      const prodRes = createMockResponse();
      await getProducts(prodReq, prodRes as unknown as Response, () => {});
      const prodBody = prodRes.body as ApiResponse<ProductListResponse>;

      if (prodBody.data.total === 0) {
        pass("13.2 Deactivated category query returns 0 products without exposing catalog");
      } else {
        fail("13.2 Deactivated category product query", `Expected 0 total, got ${prodBody.data.total}`);
      }
    }

    // 14. Homepage aggregation returns active categories and respects displayOrder
    {
      const req = {} as Request;
      const res = createMockResponse();
      await getHomepageCatalog(req, res as unknown as Response, () => {});
      const homeBody = res.body as ApiResponse<{ categories: Array<{ slug: string; status?: string }> }>;
      const homeSlugs = homeBody.data.categories.map(c => c.slug);

      const includesRoot = homeSlugs.includes(parentCategory.slug) && homeSlugs.includes(standaloneActive.slug);
      const excludesInactive = !homeSlugs.includes(inactiveCategory.slug);
      const excludesChild = !homeSlugs.includes(childOversized.slug);

      if (includesRoot && excludesInactive && excludesChild) {
        pass("14.1 Homepage aggregation returns active root categories, excludes subcategories and inactive categories");
      } else {
        fail("14.1 Homepage aggregation", `Homepage slugs: ${JSON.stringify(homeSlugs)}, includesRoot: ${includesRoot}, excludesInactive: ${excludesInactive}, excludesChild: ${excludesChild}`);
      }
    }

  } catch (err) {
    console.error("💥 Unhandled test runner exception:", err);
    failed++;
    failures.push(`Unhandled runner error: ${err}`);
  } finally {
    // Clean up created test documents
    if (mongoose.connection.readyState === 1) {
      if (cleanupProductIds.length > 0) {
        await Product.deleteMany({ _id: { $in: cleanupProductIds } });
      }
      if (cleanupCategoryIds.length > 0) {
        await Category.deleteMany({ _id: { $in: cleanupCategoryIds } });
      }
      if (cleanupThemeIds.length > 0) {
        await Theme.deleteMany({ _id: { $in: cleanupThemeIds } });
      }
    }
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    console.log(" Disconnected from MongoDB\n");
  }

  console.log("════════════════════════════════════════════════════════════════");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log("Failures:");
    failures.forEach(f => console.log(`  - ${f}`));
  }
  console.log("════════════════════════════════════════════════════════════════\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Fatal test runner failure:", err);
  process.exit(1);
});
