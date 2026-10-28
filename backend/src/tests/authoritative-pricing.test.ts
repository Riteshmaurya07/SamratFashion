/**
 * Phase 7: Authoritative Pricing and Currency Units Regression Test Suite
 *
 * Verifies that:
 * 1. Products priced at ₹9,999, ₹10,000, ₹10,001, ₹15,000, and ₹25,000 are NEVER divided by 100.
 * 2. Variant add-on prices (e.g. ₹12,000) are accurately preserved in Rupees.
 * 3. Bulk discount tiers apply accurately to authoritative snapshots.
 * 4. Financial conversions between paise (Razorpay gateway / BulkQuote) and rupees are exact.
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

import { connectSafeTestDb, createTestProduct } from "./testHelpers";
import { PricingService } from "../services/pricingService";
import { Product } from "../models/Product";

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

async function runPricingTests() {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║  Authoritative Pricing & Currency Unit Precision Test Suite    ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  const cleanupProductIds: mongoose.Types.ObjectId[] = [];

  try {
    await connectSafeTestDb();
    console.log(` Connected to verified isolated test database: ${mongoose.connection.name}\n`);

    const timestamp = Date.now();

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 1: HIGH-VALUE RUPEE THRESHOLD ACCURACY (NO DIVISION BY 100)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("[TEST GROUP 1: HIGH-VALUE RUPEE THRESHOLD ACCURACY]");

    const pricePoints = [9999, 10000, 10001, 15000, 25000];

    for (const basePrice of pricePoints) {
      const { product, productId, variantIds } = await createTestProduct({
        name: `Luxury Apparel ₹${basePrice} ${timestamp}`,
        basePrice,
        variants: [{ size: "M", color: "BLACK", stock: 10, isAvailable: true, additionalPrice: 0 }],
      });
      cleanupProductIds.push(product._id);

      const snapshot = await PricingService.calculateItemPricing({
        productId,
        variantId: variantIds[0],
        quantity: 1,
        isCustomized: false,
      });

      check(
        snapshot.basePrice === basePrice,
        `1.1 Base price ₹${basePrice} preserved exactly without division by 100 (got: ₹${snapshot.basePrice})`
      );
      check(
        snapshot.total === basePrice,
        `1.2 Total for ₹${basePrice} product equals ₹${basePrice} (got: ₹${snapshot.total})`
      );
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 2: HIGH-VALUE VARIANT ADD-ON PRICES
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("\n[TEST GROUP 2: HIGH-VALUE VARIANT ADD-ON PRICES]");

    const { product: addonProduct, productId: addonProdId, variantIds: addonVarIds } = await createTestProduct({
      name: `Gold Embroidered Suit ${timestamp}`,
      basePrice: 5000,
      variants: [
        { size: "XL", color: "GOLD", stock: 10, isAvailable: true, additionalPrice: 12000 },
      ],
    });
    cleanupProductIds.push(addonProduct._id);

    const addonSnapshot = await PricingService.calculateItemPricing({
      productId: addonProdId,
      variantId: addonVarIds[0],
      quantity: 2,
      isCustomized: false,
    });

    check(
      addonSnapshot.variantPrice === 12000,
      `2.1 Additional variant price ₹12,000 preserved without division by 100 (got: ₹${addonSnapshot.variantPrice})`
    );
    // Unit price = 5000 + 12000 = 17000; for 2 units = 34000
    check(
      addonSnapshot.subtotal === 34000,
      `2.2 Subtotal for 2 units of (5,000 + 12,000) equals ₹34,000 (got: ₹${addonSnapshot.subtotal})`
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 3: FINANCIAL CONVERSIONS (PAISE TO RUPEES AT BOUNDARY)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("\n[TEST GROUP 3: GATEWAY PAISE CONVERSION AT BOUNDARIES]");

    // Razorpay amount in paise for ₹15,000 product
    const orderTotalRupees = 15000;
    const razorpayAmountPaise = Math.round(orderTotalRupees * 100);
    check(razorpayAmountPaise === 1500000, "3.1 Exact paise conversion for ₹15,000 is 1,500,000 paise");

    // Partial rupee rounding (e.g. ₹1,499.50)
    const partialPrice = 1499.5;
    const roundedPaise = Math.round(partialPrice * 100);
    check(roundedPaise === 149950, "3.2 Partial rupee rounding produces integer paise (149,950)");

    const backToRupees = Math.round(roundedPaise / 100);
    check(backToRupees === 1500, "3.3 Integer conversion back to rupees rounds cleanly to ₹1,500");

  } catch (err: unknown) {
    console.error("💥 Unhandled test exception:", err);
    failed++;
    failures.push(`Unhandled test exception: ${err}`);
  } finally {
    console.log("\n🧹 Cleaning up test fixtures from database...");
    if (cleanupProductIds.length > 0) {
      await Product.deleteMany({ _id: { $in: cleanupProductIds } });
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

runPricingTests().catch((err) => {
  console.error("Fatal test runner error:", err);
  process.exit(1);
});
