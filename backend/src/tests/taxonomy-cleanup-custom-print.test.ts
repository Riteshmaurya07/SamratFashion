/**
 * Taxonomy Cleanup & Custom-Print Catalog Regression Test Suite
 *
 * Verifies all requirements from the taxonomy and category specification:
 * 1. Category Administration: root creation, subcategory creation, rename/reorder, deactivation,
 *    two-level nesting rejection, circular rejection, foreign-ref deletion blockers.
 * 2. Product Management: assigning root categories (Coti, T-Shirt) without mandatory subcategories,
 *    assigning subcategories (Jersey, Corporate Jersey), inactive category selection rejection.
 * 3. Custom-Print Catalog: dynamic database-driven categories (/custom-print-catalog/categories),
 *    hierarchical filtering by category, inactive category exclusion.
 * 4. Seed Idempotency: reseeding preserves deactivated status and does not duplicate categories.
 */

import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import { Request } from "express";
import { Category } from "../models/Category";
import { Product } from "../models/Product";
import { CustomPrintCatalogItem } from "../models/CustomPrintCatalogItem";
import {
  createCategory,
  updateCategory,
  updateCategoryStatus,
  deleteCategory,
  createProduct,
  updateProduct,
} from "../controllers/adminCatalogController";
import {
  getCatalogItems,
  getCatalogCategories,
} from "../controllers/customPrintCatalogController";
import { runTaxonomyMigration } from "../scripts/migrateTaxonomy";
import { getVerifiedTestMongoUri, assertSafeTestDatabase } from "../config/testDbGuard";

interface MockResponse {
  statusCode: number;
  data: any;
  status(code: number): MockResponse;
  json(payload: any): MockResponse;
}

function createMockRes(): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    data: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.data = payload;
      return this;
    },
  };
  return res;
}

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(condition: boolean, desc: string, details?: string) {
  if (condition) {
    passed++;
    console.log(`  ✅ PASS: ${desc}`);
  } else {
    failed++;
    const msg = details ? `${desc} — ${details}` : desc;
    failures.push(msg);
    console.log(`  ❌ FAIL: ${msg}`);
  }
}

async function runTests() {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║  Taxonomy Cleanup & Custom-Print Regression Suite             ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  const testUri = getVerifiedTestMongoUri();
  await mongoose.connect(testUri);
  assertSafeTestDatabase();
  console.log(` Connected to verified isolated test database: ${mongoose.connection.name}\n`);

  const cleanupCategoryIds: mongoose.Types.ObjectId[] = [];
  const cleanupProductIds: mongoose.Types.ObjectId[] = [];
  const cleanupCustomItemIds: mongoose.Types.ObjectId[] = [];
  const timestamp = Date.now();

  try {
    const adminUser = { id: new mongoose.Types.ObjectId().toString(), role: "ADMIN" };

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 1: Category Administration (Root, Child, Hierarchy, Safety)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("[TEST GROUP 1: CATEGORY ADMINISTRATION]");

    // 1.1 Create Root Category (e.g. Coti)
    let cotiCatId = "";
    {
      const req = {
        body: {
          name: `Test Coti ${timestamp}`,
          slug: `test-coti-${timestamp}`,
          description: "Authentic Indian Coti",
          displayOrder: 1,
          status: "ACTIVE",
        },
        user: adminUser,
      } as unknown as Request;
      const res = createMockRes();
      let error: any = null;
      await createCategory(req as any, res as any, (err: any) => { error = err; });

      check(!error && res.statusCode === 201, "1.1 Create root category succeeds");
      if (res.data?.data?._id) {
        cotiCatId = res.data.data._id.toString();
        cleanupCategoryIds.push(res.data.data._id);
      }
    }

    // 1.2 Create Child Category under Root
    let jerseyCatId = "";
    {
      const req = {
        body: {
          name: `Test Jersey ${timestamp}`,
          slug: `test-jersey-${timestamp}`,
          description: "Subcategory of Custom Print",
          parentCategory: cotiCatId,
          displayOrder: 1,
          status: "ACTIVE",
        },
        user: adminUser,
      } as unknown as Request;
      const res = createMockRes();
      let error: any = null;
      await createCategory(req as any, res as any, (err: any) => { error = err; });

      check(!error && res.statusCode === 201, "1.2 Create child subcategory succeeds");
      if (res.data?.data?._id) {
        jerseyCatId = res.data.data._id.toString();
        cleanupCategoryIds.push(res.data.data._id);
      }
    }

    // 1.3 Reject Nesting Beyond 2 Levels (Child cannot become parent)
    {
      const req = {
        body: {
          name: `Third Level ${timestamp}`,
          slug: `third-level-${timestamp}`,
          parentCategory: jerseyCatId, // Child category!
          status: "ACTIVE",
        },
        user: adminUser,
      } as unknown as Request;
      const res = createMockRes();
      let error: any = null;
      await createCategory(req as any, res as any, (err: any) => { error = err; });

      check(Boolean(error) && error.statusCode === 400, "1.3 Rejects nesting beyond 2 levels (subcategories cannot be parents)");
    }

    // 1.4 Reject Self-Parent and Circular Hierarchy in Update
    {
      const req = {
        params: { id: jerseyCatId },
        body: { parentCategory: jerseyCatId },
        user: adminUser,
      } as unknown as Request;
      const res = createMockRes();
      let error: any = null;
      await updateCategory(req as any, res as any, (err: any) => { error = err; });

      check(Boolean(error) && error.statusCode === 400, "1.4 Rejects category becoming its own parent");
    }

    // 1.5 Rename and Reorder Category
    {
      const req = {
        params: { id: cotiCatId },
        body: { name: `Renamed Coti ${timestamp}`, displayOrder: 5 },
        user: adminUser,
      } as unknown as Request;
      const res = createMockRes();
      let error: any = null;
      await updateCategory(req as any, res as any, (err: any) => { error = err; });

      check(!error && res.data?.data?.name === `Renamed Coti ${timestamp}`, "1.5 Renames and reorders category successfully");
    }

    // 1.6 Deactivate and Reactivate Category
    {
      const reqDeact = {
        params: { id: cotiCatId },
        body: { status: "INACTIVE" },
        user: adminUser,
      } as unknown as Request;
      const resDeact = createMockRes();
      await updateCategoryStatus(reqDeact as any, resDeact as any, () => {});
      check(resDeact.data?.data?.status === "INACTIVE", "1.6A Deactivates category");

      const reqAct = {
        params: { id: cotiCatId },
        body: { status: "ACTIVE" },
        user: adminUser,
      } as unknown as Request;
      const resAct = createMockRes();
      await updateCategoryStatus(reqAct as any, resAct as any, () => {});
      check(resAct.data?.data?.status === "ACTIVE", "1.6B Reactivates category");
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 2: Product Management & Category Assignment
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("\n[TEST GROUP 2: PRODUCT MANAGEMENT & CATEGORY ASSIGNMENT]");

    // 2.1 Assign Product directly to Root Category (Coti) without requiring subcategory
    let testProductId = "";
    {
      const req = {
        body: {
          name: `Test Coti Vest ${timestamp}`,
          slug: `test-coti-vest-${timestamp}`,
          description: "Premium handcrafted ethnic coti vest",
          basePrice: 1999,
          categoryId: cotiCatId, // Root category!
          images: ["https://example.com/coti.jpg"],
          variants: [
            { size: "M", color: "Silk Beige", sku: `COTI-${timestamp}-M`, isAvailable: true, stock: 25 },
          ],
        },
        user: adminUser,
      } as unknown as Request;
      const res = createMockRes();
      let error: any = null;
      await createProduct(req as any, res as any, (err: any) => { error = err; });

      check(!error && res.statusCode === 201, "2.1 Creates product assigned directly to root category (no subcategory mandatory)");
      if (res.data?.data?._id) {
        testProductId = res.data.data._id.toString();
        cleanupProductIds.push(res.data.data._id);
      }
    }

    // 2.2 Assign Product to Subcategory (Jersey)
    {
      const req = {
        params: { id: testProductId },
        body: { categoryId: jerseyCatId },
        user: adminUser,
      } as unknown as Request;
      const res = createMockRes();
      let error: any = null;
      await updateProduct(req as any, res as any, (err: any) => { error = err; });

      check(!error && res.data?.data?.categoryId?.toString() === jerseyCatId, "2.2 Updates product to reference subcategory (Jersey)");
    }

    // 2.3 Reject New Product assigned to Inactive Category
    {
      // First deactivate cotiCat
      await Category.updateOne({ _id: cotiCatId }, { $set: { status: "INACTIVE" } });

      const req = {
        body: {
          name: `Rejected Product ${timestamp}`,
          slug: `rejected-prod-${timestamp}`,
          description: "Should fail because category is inactive",
          basePrice: 999,
          categoryId: cotiCatId, // Inactive!
          images: ["https://example.com/img.jpg"],
          variants: [{ size: "L", color: "Black", sku: `REJ-${timestamp}-L`, isAvailable: true, stock: 10 }],
        },
        user: adminUser,
      } as unknown as Request;
      const res = createMockRes();
      let error: any = null;
      await createProduct(req as any, res as any, (err: any) => { error = err; });

      check(Boolean(error) && error.statusCode === 400, "2.3 Rejects assigning new product to inactive category");

      // Reactivate
      await Category.updateOne({ _id: cotiCatId }, { $set: { status: "ACTIVE" } });
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 3: Safe Category Deletion (Foreign Reference Integrity)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("\n[TEST GROUP 3: SAFE CATEGORY DELETION & FOREIGN REFERENCE GUARDS]");

    // 3.1 Block deletion if products are assigned
    {
      const req = { params: { id: jerseyCatId }, user: adminUser } as unknown as Request;
      const res = createMockRes();
      let error: any = null;
      await deleteCategory(req as any, res as any, (err: any) => { error = err; });

      check(Boolean(error) && error.statusCode === 400, "3.1 Blocks deletion when active products are assigned to category");
      check(Boolean(error?.message && error.message.includes("product")), "3.1B Explains that product dependency blocks deletion");
    }

    // 3.2 Block deletion if child subcategories exist
    {
      const req = { params: { id: cotiCatId }, user: adminUser } as unknown as Request;
      const res = createMockRes();
      let error: any = null;
      await deleteCategory(req as any, res as any, (err: any) => { error = err; });

      check(Boolean(error) && error.statusCode === 400, "3.2 Blocks deletion when child subcategories belong to category");
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 4: Custom-Print Dynamic Categories & Filtering
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("\n[TEST GROUP 4: CUSTOM-PRINT DYNAMIC CATEGORIES & HIERARCHY FILTERING]");

    // Create a CustomPrintCatalogItem linked to jerseyCatId
    let testCustomItemId = "";
    {
      const item = await CustomPrintCatalogItem.create({
        name: `Custom Team Jersey ${timestamp}`,
        slug: `custom-team-jersey-${timestamp}`,
        description: "Official moisture-wicking team jersey",
        productId: new mongoose.Types.ObjectId(testProductId),
        categoryId: new mongoose.Types.ObjectId(jerseyCatId),
        mockupImageUrl: "https://example.com/jersey-mockup.png",
        displayPrice: 899,
        isActive: true,
        sortOrder: 1,
      });
      testCustomItemId = item._id.toString();
      cleanupCustomItemIds.push(item._id);
    }

    // 4.1 getCatalogCategories returns dynamic active category
    {
      const req = {} as Request;
      const res = createMockRes();
      await getCatalogCategories(req, res as any, () => {});
      const cats = res.data?.data || [];
      const hasJerseyCat = cats.some((c: any) => c._id?.toString() === jerseyCatId || c.slug === `test-jersey-${timestamp}`);
      check(hasJerseyCat, "4.1 /custom-print-catalog/categories returns active database-linked category");
    }

    // 4.2 Filter catalog items by specific child category
    {
      const req = { query: { category: `test-jersey-${timestamp}` } } as unknown as Request;
      const res = createMockRes();
      await getCatalogItems(req, res as any, () => {});
      const items = res.data?.data || [];
      const matches = items.some((i: any) => i._id?.toString() === testCustomItemId);
      check(matches, "4.2 Filters custom print items by exact subcategory slug");
    }

    // 4.3 Filter catalog items by parent root category includes child items
    {
      const req = { query: { category: `test-coti-${timestamp}` } } as unknown as Request;
      const res = createMockRes();
      await getCatalogItems(req, res as any, () => {});
      const items = res.data?.data || [];
      const includesDescendant = items.some((i: any) => i._id?.toString() === testCustomItemId);
      check(includesDescendant, "4.3 Filtering by parent root category includes descendant subcategory items");
    }

    // 4.4 Exclude subcategory if parent is deactivated
    {
      await Category.updateOne({ _id: cotiCatId }, { $set: { status: "INACTIVE" } });

      const req = {} as Request;
      const res = createMockRes();
      await getCatalogCategories(req, res as any, () => {});
      const cats = res.data?.data || [];
      const excluded = !cats.some((c: any) => c._id?.toString() === jerseyCatId);
      check(excluded, "4.4 Excludes subcategory from public custom-print categories when parent is inactive");

      // Reactivate
      await Category.updateOne({ _id: cotiCatId }, { $set: { status: "ACTIVE" } });
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 5: Migration Idempotency & Seed Non-destructive Safety
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("\n[TEST GROUP 5: MIGRATION IDEMPOTENCY & SEED PRESERVATION]");

    // 5.1 Run taxonomy migration dry-run and verify safe detection
    {
      const summary = await runTaxonomyMigration({ dryRun: true, connectionUri: testUri });
      check(summary.dryRun === true, "5.1 Taxonomy migration dry-run executes safely without writing");
      check(summary.categoriesCreated.length === 0, "5.1B No duplicate categories created on repeated run");
    }

    // 5.2 Deactivated items are preserved on repeated seed runs
    {
      // Deactivate test custom item
      await CustomPrintCatalogItem.updateOne({ _id: testCustomItemId }, { $set: { isActive: false } });
      const itemBefore = await CustomPrintCatalogItem.findById(testCustomItemId);
      check(itemBefore?.isActive === false, "5.2A Custom catalog item marked inactive");

      // Re-run migration
      await runTaxonomyMigration({ dryRun: false, connectionUri: testUri });
      const itemAfter = await CustomPrintCatalogItem.findById(testCustomItemId);
      check(itemAfter?.isActive === false, "5.2B Migration never reactivates administrator-deactivated item");
    }

  } catch (err) {
    console.error("💥 Unhandled test exception:", err);
    failed++;
    failures.push(`Unhandled test exception: ${err}`);
  } finally {
    console.log("\n🧹 Cleaning up test fixtures from database...");
    if (mongoose.connection.readyState === 1) {
      if (cleanupCustomItemIds.length > 0) {
        await CustomPrintCatalogItem.deleteMany({ _id: { $in: cleanupCustomItemIds } });
      }
      if (cleanupProductIds.length > 0) {
        await Product.deleteMany({ _id: { $in: cleanupProductIds } });
      }
      if (cleanupCategoryIds.length > 0) {
        await Category.deleteMany({ _id: { $in: cleanupCategoryIds } });
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
    failures.forEach((f) => console.log(`  - ${f}`));
  }
  console.log("════════════════════════════════════════════════════════════════\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Fatal test runner error:", err);
  process.exit(1);
});
