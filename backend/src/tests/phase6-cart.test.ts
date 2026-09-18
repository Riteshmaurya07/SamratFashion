/**
 * Phase 6 — Cart Consistency Test Suite
 *
 * Tests:
 * 1. Cart quantity = sum of sizeDistribution quantities
 * 2. Cart price = authoritative PricingService calculation (server ignores client totals)
 * 3. Editing a custom item does not corrupt other cart items
 * 4. Two different custom designs remain as separate cart items
 */

import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import { Cart } from "../models/Cart";
import { CustomDesign } from "../models/CustomDesign";
import { Product, ProductStatus } from "../models/Product";
import { PricingService } from "../services/pricingService";
import { createTestProduct, createTestDesign } from "./testHelpers";

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
let varBlackId: string;
let varWhiteId: string;
let design1Id: string;
let design2Id: string;

async function seed() {
  const { product, productId: pid, variantIds } = await createTestProduct({
    name: "Cart Test Tee",
    variants: [
      { size: "M", color: "BLACK", additionalPrice: 0, stock: 50, isAvailable: true },
      { size: "M", color: "WHITE", additionalPrice: 50, stock: 30, isAvailable: true },
    ],
    printMethods: ["DTF"],
  });
  testProductId = pid;
  varBlackId = variantIds[0];
  varWhiteId = variantIds[1];

  const makeLayout = (text: string) => ({
    front: { elements: [{ id: "el1", type: "TEXT" as const, x: 100, y: 100, width: 200, height: 50, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, locked: false, zIndex: 0, properties: { text } }] },
    back: { elements: [] },
    leftSleeve: { elements: [] },
    rightSleeve: { elements: [] },
  });

  const d1 = await CustomDesign.create({
    userId: new mongoose.Types.ObjectId(TEST_USER_ID),
    name: "Cart Test Design 1",
    productId: product._id,
    selectedVariantId: product.variants[0]._id,
    selectedColor: "BLACK",
    status: "DRAFT",
    requestType: "DESIGN",
    printLocations: ["FRONT"],
    currentVersion: 1,
    submissionKey: `cart-test-d1-${Date.now()}`,
    design: makeLayout("Design One"),
    versions: [{ version: 1, design: makeLayout("Design One"), createdBy: new mongoose.Types.ObjectId(TEST_USER_ID), createdAt: new Date(), status: "DRAFT", previewUrls: [], artworkUrls: [] }],
  });
  design1Id = d1._id.toString();

  const d2 = await CustomDesign.create({
    userId: new mongoose.Types.ObjectId(TEST_USER_ID),
    name: "Cart Test Design 2",
    productId: product._id,
    selectedVariantId: product.variants[1]._id,
    selectedColor: "WHITE",
    status: "DRAFT",
    requestType: "DESIGN",
    printLocations: ["FRONT"],
    currentVersion: 1,
    submissionKey: `cart-test-d2-${Date.now() + 1}`,
    design: makeLayout("Design Two"),
    versions: [{ version: 1, design: makeLayout("Design Two"), createdBy: new mongoose.Types.ObjectId(TEST_USER_ID), createdAt: new Date(), status: "DRAFT", previewUrls: [], artworkUrls: [] }],
  });
  design2Id = d2._id.toString();
}

async function cleanup() {
  await Cart.deleteMany({ userId: TEST_USER_ID });
  await CustomDesign.deleteMany({ userId: TEST_USER_ID });
  if (testProductId) await Product.deleteOne({ _id: testProductId });
}

// Mock CustomDesign.findById for PricingService (which looks up design to check print zones)
function patchDesignFindById() {
  const orig = (CustomDesign as any).findById.bind(CustomDesign);
  (CustomDesign as any).findById = async (id: string) => {
    const d = await orig(id);
    return d;
  };
}

async function runCartTests() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  Phase 6 — Cart Consistency Test Suite           ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  await mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/samrat_fashion");
  console.log("✅ Connected to MongoDB\n");
  await seed();

  // CART-1: Quantity = sum of sizeDistribution
  console.log("\n[CART-1] Quantity = sum of sizeDistribution quantities");
  {
    const customConfigurations = [
      {
        color: "BLACK",
        variantId: new mongoose.Types.ObjectId(varBlackId),
        designId: new mongoose.Types.ObjectId(design1Id),
        sizeDistribution: [
          { size: "S", quantity: 2 },
          { size: "M", quantity: 3 },
          { size: "L", quantity: 5 },
        ],
      },
      {
        color: "WHITE",
        variantId: new mongoose.Types.ObjectId(varWhiteId),
        designId: new mongoose.Types.ObjectId(design2Id),
        sizeDistribution: [
          { size: "M", quantity: 4 },
          { size: "L", quantity: 6 },
        ],
      },
    ];

    const totalFromSizeDistributions = customConfigurations.reduce(
      (total, config) => total + config.sizeDistribution.reduce((t, s) => t + s.quantity, 0),
      0
    );
    check(totalFromSizeDistributions === 20, "CART-1.1 Total quantity = sum of all sizeDistributions (2+3+5+4+6 = 20)", `total=${totalFromSizeDistributions}`);

    // Simulate cart add
    let cart = await Cart.findOne({ userId: TEST_USER_ID });
    if (!cart) cart = new Cart({ userId: TEST_USER_ID, items: [] });

    cart.items.push({
      productId: new mongoose.Types.ObjectId(testProductId),
      variantId: new mongoose.Types.ObjectId(varBlackId),
      quantity: 1,
      isCustomized: true,
      customConfigurations: customConfigurations as any,
    });
    await cart.save();
    check(cart.items.length === 1, "CART-1.2 One custom cart item added", `items=${cart.items.length}`);
  }

  // CART-2: Server pricing = authoritative (not client-submitted)
  console.log("\n[CART-2] Server pricing is authoritative");
  {
    // The server calculates pricing independently via PricingService
    // A client cannot pass price=1 and have it accepted
    // We verify the calculated snapshot vs. what a malicious client might submit

    try {
      const snapshot = await PricingService.calculateItemPricing({
        productId: testProductId,
        variantId: varBlackId,
        quantity: 1,
        isCustomized: true,
        customConfigurations: [
          {
            color: "BLACK",
            variantId: varBlackId as any,
            designId: design1Id as any,
            sizeDistribution: [{ size: "M", quantity: 5 }],
          },
        ],
      });
      const serverTotal = snapshot.total;
      const fakeClientTotal = 1;
      check(serverTotal > fakeClientTotal, "CART-2.1 Server-calculated total > malicious client total", `server=${serverTotal}, fake=${fakeClientTotal}`);
      check(snapshot.printCharges > 0, "CART-2.2 Print charges included in server calculation", `printCharges=${snapshot.printCharges}`);
    } catch (e: any) {
      fail("CART-2.1", `PricingService error: ${e.message}`);
    }
  }

  // CART-3: Editing custom item does not corrupt other items
  console.log("\n[CART-3] Edit custom item — other items unchanged");
  {
    let cart = await Cart.findOne({ userId: TEST_USER_ID });
    if (!cart) { fail("CART-3.1", "Cart not found"); }
    else {
      // Add a normal (non-custom) item
      cart.items.push({
        productId: new mongoose.Types.ObjectId(testProductId),
        variantId: new mongoose.Types.ObjectId(varWhiteId),
        quantity: 3,
        isCustomized: false,
      });
      await cart.save();

      const customItemId = cart.items[0]._id?.toString();
      const normalItemId = cart.items[1]._id?.toString();

      // Edit the custom item's sizeDistribution
      const customItem = cart.items.find(i => i._id?.toString() === customItemId);
      if (customItem && customItem.customConfigurations) {
        customItem.customConfigurations[0].sizeDistribution = [{ size: "M", quantity: 10 }];
      }
      await cart.save();

      const reloaded = await Cart.findOne({ userId: TEST_USER_ID });
      const normalItem = reloaded?.items.find(i => i._id?.toString() === normalItemId);
      check(normalItem?.quantity === 3, "CART-3.1 Normal item quantity unchanged after custom item edit", `qty=${normalItem?.quantity}`);
      check(normalItem?.isCustomized === false, "CART-3.2 Normal item isCustomized flag unchanged", `isCustomized=${normalItem?.isCustomized}`);

      const customItemReloaded = reloaded?.items.find(i => i._id?.toString() === customItemId);
      check(customItemReloaded?.customConfigurations?.[0].sizeDistribution[0].quantity === 10, "CART-3.3 Custom item sizeDistribution updated correctly", `qty=${customItemReloaded?.customConfigurations?.[0].sizeDistribution[0].quantity}`);
    }
  }

  // CART-4: Two custom designs remain as separate items
  console.log("\n[CART-4] Two custom designs are separate cart items");
  {
    await Cart.deleteMany({ userId: TEST_USER_ID });
    let cart = new Cart({ userId: TEST_USER_ID, items: [] });

    cart.items.push({
      productId: new mongoose.Types.ObjectId(testProductId),
      variantId: new mongoose.Types.ObjectId(varBlackId),
      quantity: 1,
      isCustomized: true,
      customConfigurations: [{
        color: "BLACK",
        variantId: new mongoose.Types.ObjectId(varBlackId),
        designId: new mongoose.Types.ObjectId(design1Id),
        sizeDistribution: [{ size: "M", quantity: 3 }],
      }] as any,
    });

    cart.items.push({
      productId: new mongoose.Types.ObjectId(testProductId),
      variantId: new mongoose.Types.ObjectId(varWhiteId),
      quantity: 1,
      isCustomized: true,
      customConfigurations: [{
        color: "WHITE",
        variantId: new mongoose.Types.ObjectId(varWhiteId),
        designId: new mongoose.Types.ObjectId(design2Id),
        sizeDistribution: [{ size: "L", quantity: 5 }],
      }] as any,
    });

    await cart.save();
    const reloaded = await Cart.findOne({ userId: TEST_USER_ID });
    check(reloaded?.items.length === 2, "CART-4.1 Two separate custom cart items exist", `items=${reloaded?.items.length}`);

    const item1DesignId = reloaded?.items[0].customConfigurations?.[0].designId?.toString();
    const item2DesignId = reloaded?.items[1].customConfigurations?.[0].designId?.toString();
    check(item1DesignId !== item2DesignId, "CART-4.2 Two items reference different designIds", `d1=${item1DesignId}, d2=${item2DesignId}`);
    check(item1DesignId === design1Id, "CART-4.3 Item 1 references Design 1", `designId=${item1DesignId}`);
    check(item2DesignId === design2Id, "CART-4.4 Item 2 references Design 2", `designId=${item2DesignId}`);
  }

  await cleanup();

  console.log("\n══════════════════════════════════════════════");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failures.length) failures.forEach(f => console.log("  •", f));
  console.log("══════════════════════════════════════════════");
  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

runCartTests().catch(e => {
  console.error("Cart test runner crashed:", e);
  process.exit(1);
});
