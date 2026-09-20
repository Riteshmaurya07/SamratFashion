/**
 * Phase 6 — Order Snapshot Immutability Test Suite
 *
 * Verifies that after an order is created, the order snapshot fields are:
 * - productId, variantId, productName, productImage
 * - pricingSnapshot (full breakdown)
 * - customConfigurations with purchasedDesignVersion + approvedDesignVersion
 * - isCustomized flag
 *
 * And that modifying the CustomDesign after order creation does NOT
 * change the already-stored order snapshot.
 */

import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import { Order } from "../models/Order";
import { CustomDesign } from "../models/CustomDesign";
import { Product } from "../models/Product";
import { createTestProduct } from "./testHelpers";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function pass(name: string) { console.log(`  ✅ PASS: ${name}`); passed++; }
function fail(name: string, reason: string) {
  console.error(`  ❌ FAIL: ${name} — ${reason}`);
  failed++; failures.push(`${name}: ${reason}`);
}
function check(condition: boolean, name: string, failReason: string) {
  if (condition) pass(name); else fail(name, failReason);
}

const TEST_USER_ID = new mongoose.Types.ObjectId().toString();
let testProductId: string;
let variantId: string;
let designId: string;
let orderId: string;

const INITIAL_DESIGN_LAYOUT = {
  front: { elements: [{ id: "snap1", type: "TEXT" as const, x: 100, y: 100, width: 200, height: 50, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, locked: false, zIndex: 0, properties: { text: "Original Text" } }] },
  back: { elements: [] },
  leftSleeve: { elements: [] },
  rightSleeve: { elements: [] },
};

async function seed() {
  const { product, productId: pid, variantIds } = await createTestProduct({
    name: "Snapshot Test Tee",
    basePrice: 600,
    variants: [{ size: "L", color: "NAVY", additionalPrice: 100, stock: 20, isAvailable: true }],
    printMethods: ["DTF"],
  });
  testProductId = pid;
  variantId = variantIds[0];

  const design = await CustomDesign.create({
    userId: new mongoose.Types.ObjectId(TEST_USER_ID),
    name: "Snapshot Test Design",
    productId: product._id,
    selectedVariantId: product.variants[0]._id,
    selectedColor: "NAVY",
    status: "DRAFT",
    requestType: "DESIGN",
    printLocations: ["FRONT"],
    submissionKey: `snap-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    currentVersion: 1,
    design: INITIAL_DESIGN_LAYOUT,
    versions: [{
      version: 1,
      design: INITIAL_DESIGN_LAYOUT,
      createdBy: new mongoose.Types.ObjectId(TEST_USER_ID),
      createdAt: new Date(),
      status: "DRAFT",
      previewUrls: [],
      artworkUrls: [],
    }],
  });
  designId = design._id.toString();
}

async function cleanup() {
  if (orderId) await Order.deleteOne({ _id: orderId });
  if (designId) await CustomDesign.deleteOne({ _id: designId });
  if (testProductId) await Product.deleteOne({ _id: testProductId });
}

async function runOrderSnapshotTests() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  Phase 6 — Order Snapshot Immutability Tests     ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  await mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/samrat_fashion");
  console.log("✅ Connected to MongoDB\n");
  await seed();

  // OSN-1: Create order with all required snapshot fields
  console.log("\n[OSN-1] Create order with complete snapshot");
  {
    const pricingSnapshot = {
      basePrice: 600,
      variantPrice: 100,
      fabricPrice: 0,
      printCharges: 200,
      customizationCharges: 0,
      bulkDiscount: 0,
      tax: 0,
      shipping: 0,
      subtotal: 900,
      total: 900,
      currency: "INR",
      calculatedAt: new Date(),
    };

    const customConfig = {
      color: "NAVY",
      variantId: new mongoose.Types.ObjectId(variantId),
      designId: new mongoose.Types.ObjectId(designId),
      purchasedDesignVersion: 1,
      approvedDesignVersion: null,
      sizeDistribution: [{ size: "L", quantity: 1 }],
    };

    const order = await Order.create({
      orderNumber: `SNAP-TEST-${Date.now()}`,
      userId: new mongoose.Types.ObjectId(TEST_USER_ID),
      items: [{
        productId: new mongoose.Types.ObjectId(testProductId),
        variantId: new mongoose.Types.ObjectId(variantId),
        productName: "Snapshot Test Tee",
        productImage: "https://example.com/tee.jpg",
        selectedSize: "L",
        selectedColor: "NAVY",
        quantity: 1,
        unitPrice: 900,
        lineTotal: 900,
        isCustomized: true,
        customConfigurations: [customConfig],
        pricingSnapshot,
      }],
      shippingAddress: {
        fullName: "Test User",
        phone: "9999999999",
        addressLine1: "123 Test St",
        city: "Mumbai",
        state: "Maharashtra",
        postalCode: "400001",
        country: "India",
        addressType: "HOME",
      },
      subtotal: 900,
      discount: 0,
      shipping: 0,
      tax: 0,
      total: 900,
      currency: "INR",
      status: "PENDING",
      paymentStatus: "PENDING",
    });

    orderId = order._id.toString();
    check(!!order._id, "OSN-1.1 Order created successfully", "Order creation failed");

    const item = order.items[0];
    check(item.isCustomized === true, "OSN-1.2 isCustomized flag stored", `isCustomized=${item.isCustomized}`);
    check(item.pricingSnapshot?.total === 900, "OSN-1.3 pricingSnapshot.total stored", `total=${item.pricingSnapshot?.total}`);
    check(item.pricingSnapshot?.printCharges === 200, "OSN-1.4 pricingSnapshot.printCharges stored", `printCharges=${item.pricingSnapshot?.printCharges}`);
    check(item.customConfigurations?.[0].purchasedDesignVersion === 1, "OSN-1.5 purchasedDesignVersion stored", `v=${item.customConfigurations?.[0].purchasedDesignVersion}`);
    check(item.customConfigurations?.[0].designId?.toString() === designId, "OSN-1.6 designId stored in order", `designId=${item.customConfigurations?.[0].designId}`);
    check(item.productName === "Snapshot Test Tee", "OSN-1.7 productName snapshot stored", `name=${item.productName}`);
    check(item.productImage !== "", "OSN-1.8 productImage snapshot stored", `img=${item.productImage}`);
  }

  // OSN-2: Modify the CustomDesign after order — order snapshot must not change
  console.log("\n[OSN-2] Modifying CustomDesign after order does NOT change order snapshot");
  {
    const MODIFIED_LAYOUT = {
      front: { elements: [{ id: "snap1-modified", type: "TEXT" as const, x: 50, y: 50, width: 300, height: 80, rotation: 45, scaleX: 2, scaleY: 2, opacity: 0.5, locked: false, zIndex: 0, properties: { text: "COMPLETELY DIFFERENT TEXT" } }] },
      back: { elements: [{ id: "back1", type: "IMAGE" as const, x: 10, y: 10, width: 100, height: 100, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, locked: false, zIndex: 0, properties: { imageUrl: "https://example.com/art.png" } }] },
      leftSleeve: { elements: [] },
      rightSleeve: { elements: [] },
    };

    // Simulate requestRevision (creates V2)
    await CustomDesign.findOneAndUpdate(
      { _id: designId, currentVersion: 1 },
      {
        $set: { status: "DRAFT" },
        $inc: { currentVersion: 1 },
        $push: {
          versions: {
            version: 2,
            design: MODIFIED_LAYOUT,
            createdBy: new mongoose.Types.ObjectId(TEST_USER_ID),
            createdAt: new Date(),
            status: "DRAFT",
            revisionComment: "Post-order revision",
            previewUrls: [],
            artworkUrls: [],
          }
        }
      },
      { returnDocument: 'after' }
    );

    // Re-read the order — it must be unchanged
    const orderAfter = await Order.findById(orderId);
    const item = orderAfter?.items[0];

    check(item?.pricingSnapshot?.total === 900, "OSN-2.1 Order pricingSnapshot.total unchanged after design modification", `total=${item?.pricingSnapshot?.total}`);
    check(item?.customConfigurations?.[0].purchasedDesignVersion === 1, "OSN-2.2 Order purchasedDesignVersion=1 unchanged after V2 creation", `v=${item?.customConfigurations?.[0].purchasedDesignVersion}`);
    check(item?.productName === "Snapshot Test Tee", "OSN-2.3 Order productName snapshot unchanged", `name=${item?.productName}`);

    // Verify the CustomDesign now has V2 but order still says V1
    const designAfter = await CustomDesign.findById(designId);
    check(designAfter?.currentVersion === 2, "OSN-2.4 CustomDesign now at V2", `currentVersion=${designAfter?.currentVersion}`);
    check(item?.customConfigurations?.[0].purchasedDesignVersion === 1, "OSN-2.5 Order still references V1 (purchasedDesignVersion unchanged)", `v=${item?.customConfigurations?.[0].purchasedDesignVersion}`);
  }

  // OSN-3: Verify all required snapshot fields are present
  console.log("\n[OSN-3] All required snapshot fields present");
  {
    const order = await Order.findById(orderId);
    const item = order?.items[0];
    const snap = item?.pricingSnapshot;

    const requiredFields = ["basePrice", "variantPrice", "printCharges", "bulkDiscount", "tax", "shipping", "subtotal", "total", "currency", "calculatedAt"];
    for (const field of requiredFields) {
      check(snap?.[field as keyof typeof snap] !== undefined, `OSN-3.${field} pricingSnapshot.${field} is present`, `${field} is undefined`);
    }
  }

  await cleanup();

  console.log("\n══════════════════════════════════════════════");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failures.length) failures.forEach(f => console.log("  •", f));
  console.log("══════════════════════════════════════════════");
  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

runOrderSnapshotTests().catch(e => {
  console.error("Order snapshot test runner crashed:", e);
  process.exit(1);
});
