import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import mongoose from "mongoose";
import { Product } from "../models/Product";
import { Category } from "../models/Category";
import {
  createProduct,
  updateProduct,
  adjustInventory,
} from "../controllers/adminCatalogController";
import {
  getProducts,
  getProductBySlug,
} from "../controllers/catalogController";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(cond: boolean, name: string, details?: string) {
  if (cond) {
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } else {
    const msg = `  ❌ FAIL: ${name}${details ? ` — ${details}` : ""}`;
    console.error(msg);
    failures.push(`${name}${details ? `: ${details}` : ""}`);
    failed++;
  }
}

interface MockResponse {
  statusCode: number;
  data: unknown;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
}

function createMockRes(): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    data: null,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.data = payload;
      return res;
    },
  };
  return res;
}

async function runTshirtVariantTests() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  T-Shirt Section & Variant Management Verification Suite     ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  await mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/samrat_fashion");
  console.log("Connected to MongoDB for test execution\n");

  const adminId = new mongoose.Types.ObjectId().toString();

  try {
    // ─── 1. VERIFY SEEDED T-SHIRTS IN T-SHIRTS CATEGORY ──────────────
    console.log("[1. Storefront T-Shirts Query & Price Boundary]");

    // Test 1.1: getProducts with category=t-shirts returns seeded products
    {
      const req: unknown = { query: { category: "t-shirts" } };
      const res = createMockRes();
      let err: unknown = null;
      await getProducts(req as never, res as never, (e: unknown) => { err = e; });
      check(!err, "TSHIRT-1 getProducts with category=t-shirts succeeds");

      const responseData = res.data as { success: boolean; data: { items?: any[]; products?: any[]; total: number } };
      const prods = responseData?.data?.items || responseData?.data?.products || [];
      check(prods.length >= 4, `TSHIRT-2 Returns all seeded T-Shirts under parent category (count: ${prods.length})`);

      // Verify every product price is <= 5 Rupees
      const allUnder5 = prods.every((p) => p.basePrice <= 5 && p.basePrice >= 1);
      check(allUnder5, "TSHIRT-3 All T-Shirt products are priced <= 5 Rupees (real payment test safe)");
    }

    // Test 1.2: Check individual product slug & color variants
    {
      const req: unknown = { params: { slug: "heavyweight-oversized-streetwear-tshirt" } };
      const res = createMockRes();
      let err: unknown = null;
      await getProductBySlug(req as never, res as never, (e: unknown) => { err = e; });
      check(!err, "TSHIRT-4 getProductBySlug succeeds for heavyweight-oversized-streetwear-tshirt");

      const responseData = res.data as { success: boolean; data: any };
      const product = responseData?.data;
      check(product?.basePrice === 2, "TSHIRT-5 Base price is exactly ₹2");

      const colors = Array.from(new Set(product?.variants?.map((v: any) => v.color)));
      check(colors.length === 4, `TSHIRT-6 Product has 4 distinct colors: ${colors.join(", ")}`);
      check(colors.includes("Pitch Black") && colors.includes("Off-White"), "TSHIRT-7 Contains Pitch Black and Off-White");
    }

    // ─── 2. ADMIN LISTING NEW PRODUCT & DIRECT VARIANT CREATION ───────
    console.log("\n[2. Admin Creating New Product with Color & Size Variants]");

    const testTshirtCat = await Category.findOne({ slug: "t-shirts" });
    check(Boolean(testTshirtCat), "ADMIN-PROD-1 T-Shirts category exists in database");

    const newProdSlug = `admin-custom-tee-${Date.now()}`;
    let createdProdId = "";
    let variant1Id = "";


    // Test 2.1: Admin directly creates new product with multiple color variants and stock quantities
    {
      const req: unknown = {
        user: { id: adminId, role: "ADMIN" },
        body: {
          name: "Admin Listed Custom Color Tee",
          slug: newProdSlug,
          description: "New product listed directly by admin with color variants and custom quantities.",
          basePrice: 1, // ₹1
          mrp: 999,
          categoryId: testTshirtCat?._id.toString(),
          status: "ACTIVE",
          images: ["https://example.com/tee-front.jpg"],
          variants: [
            {
              sku: `ADM-BLK-M-${Date.now()}`,
              size: "M",
              color: "Matte Black",
              hexCode: "#0F172A",
              stock: 75,
              isAvailable: true,
              additionalPrice: 0,
              images: ["https://example.com/tee-black.jpg"],
            },
            {
              sku: `ADM-WHT-L-${Date.now()}`,
              size: "L",
              color: "Snow White",
              hexCode: "#FFFFFF",
              stock: 120,
              isAvailable: true,
              additionalPrice: 0,
              images: ["https://example.com/tee-white.jpg"],
            },
          ],
        },
      };
      const res = createMockRes();
      let err: unknown = null;
      await createProduct(req as never, res as never, (e: unknown) => { err = e; });
      check(!err, "ADMIN-PROD-2 Admin creates new product with custom color variants");
      check(res.statusCode === 201, "ADMIN-PROD-3 Returns HTTP 201 Created");

      const responseData = res.data as { success: boolean; data: any };
      const createdProd = responseData?.data;
      createdProdId = createdProd?._id?.toString() || "";
      variant1Id = createdProd?.variants?.[0]?._id?.toString() || "";


      check(createdProd?.variants?.length === 2, "ADMIN-PROD-4 2 variants persisted");
      check(createdProd?.variants?.[0]?.color === "Matte Black", "ADMIN-PROD-5 Variant 1 color is Matte Black");
      check(createdProd?.variants?.[0]?.stock === 75, "ADMIN-PROD-6 Variant 1 initial stock is 75");
      check(createdProd?.variants?.[1]?.stock === 120, "ADMIN-PROD-7 Variant 2 initial stock is 120");
    }

    // ─── 3. ADMIN INVENTORY QUANTITY ADJUSTMENT LOGIC ─────────────────
    console.log("\n[3. Admin Live Inventory & Quantity Adjustment Logic]");

    // Test 3.1: Admin increases stock quantity of variant 1 by +25 (75 -> 100)
    {
      const req: unknown = {
        user: { id: adminId, role: "ADMIN" },
        params: { productId: createdProdId, variantId: variant1Id },
        body: {
          quantity: 25,
          type: "RESTOCK",
          reason: "Warehouse replenishment from factory",
        },
      };
      const res = createMockRes();
      let err: unknown = null;
      await adjustInventory(req as never, res as never, (e: unknown) => { err = e; });
      check(!err, "INV-1 Admin adjusts variant stock upward (+25)");
      check(res.statusCode === 200, "INV-2 Returns HTTP 200");

      const responseData = res.data as { success: boolean; data: { previousStock: number; newStock: number } };
      check(responseData?.data?.previousStock === 75, "INV-3 Previous stock was 75");
      check(responseData?.data?.newStock === 100, "INV-4 New stock is 100");

      const reloaded = await Product.findById(createdProdId);
      const var1 = reloaded?.variants?.find((v) => v._id?.toString() === variant1Id);
      check(var1?.stock === 100, "INV-5 Database persists new stock of 100");
    }

    // Test 3.2: Admin decreases stock quantity of variant 1 by -15 (100 -> 85)
    {
      const req: unknown = {
        user: { id: adminId, role: "ADMIN" },
        params: { productId: createdProdId, variantId: variant1Id },
        body: {
          quantity: -15,
          type: "ADJUSTMENT",
          reason: "Damaged during packaging check",
        },
      };
      const res = createMockRes();
      let err: unknown = null;
      await adjustInventory(req as never, res as never, (e: unknown) => { err = e; });
      check(!err, "INV-6 Admin decreases variant stock (-15)");

      const responseData = res.data as { success: boolean; data: { previousStock: number; newStock: number } };
      check(responseData?.data?.previousStock === 100, "INV-7 Previous stock was 100");
      check(responseData?.data?.newStock === 85, "INV-8 New stock is 85");
    }

    // Test 3.3: Rejects inventory decrement exceeding available stock
    {
      const req: unknown = {
        user: { id: adminId, role: "ADMIN" },
        params: { productId: createdProdId, variantId: variant1Id },
        body: {
          quantity: -500, // Available is 85
          type: "CORRECTION",
          reason: "Over-decrement attempt",
        },
      };
      const res = createMockRes();
      let err: unknown = null;
      await adjustInventory(req as never, res as never, (e: unknown) => { err = e; });
      check(Boolean(err), "INV-9 Rejects decrement exceeding available stock with HTTP 400");
    }

    // ─── 4. ADMIN EDITING PRODUCT VARIANTS & COLORS ───────────────────
    console.log("\n[4. Admin Editing Existing Product Variants & Adding New Color]");

    // Test 4.1: Admin updates product, adding a 3rd color variant (Crimson Red)
    {
      const req: unknown = {
        user: { id: adminId, role: "ADMIN" },
        params: { id: createdProdId },
        body: {
          variants: [
            {
              sku: `ADM-BLK-M-${Date.now()}`,
              size: "M",
              color: "Matte Black",
              hexCode: "#0F172A",
              stock: 85,
              isAvailable: true,
              additionalPrice: 0,
            },
            {
              sku: `ADM-WHT-L-${Date.now()}`,
              size: "L",
              color: "Snow White",
              hexCode: "#FFFFFF",
              stock: 120,
              isAvailable: true,
              additionalPrice: 0,
            },
            {
              sku: `ADM-RED-XL-${Date.now()}`,
              size: "XL",
              color: "Crimson Red",
              hexCode: "#DC2626",
              stock: 60,
              isAvailable: true,
              additionalPrice: 0,
            },
          ],
        },
      };
      const res = createMockRes();
      let err: unknown = null;
      await updateProduct(req as never, res as never, (e: unknown) => { err = e; });
      check(!err, "UPDATE-1 Admin updates variants and adds Crimson Red");
      check(res.statusCode === 200, "UPDATE-2 Returns HTTP 200");

      const reloaded = await Product.findById(createdProdId);
      check(reloaded?.variants?.length === 3, "UPDATE-3 Product now has 3 variants in database");
      const redVar = reloaded?.variants?.find((v) => v.color === "Crimson Red");
      check(Boolean(redVar), "UPDATE-4 Crimson Red variant found in database");
      check(redVar?.stock === 60, "UPDATE-5 Crimson Red stock is 60");
    }

    // Cleanup temporary test product
    if (createdProdId) {
      await Product.deleteOne({ _id: createdProdId });
    }

  } finally {
    await mongoose.disconnect();
    console.log("\nDisconnected from MongoDB");
  }

  console.log("\n══════════════════════════════════════════════════════════════");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log("══════════════════════════════════════════════════════════════\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runTshirtVariantTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
