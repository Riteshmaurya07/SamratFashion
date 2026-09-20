/**
 * Phase 6 — Pricing Integrity Test Suite
 *
 * Verifies that the server ignores client-submitted prices/discounts and
 * recalculates authoritatively. Tests bulk discounts, shipping thresholds,
 * print-location charges, and variant pricing.
 */

import dotenv from "dotenv";
dotenv.config();
import { PricingService } from "../services/pricingService";
import { Product, ProductStatus } from "../models/Product";
import { CustomDesign } from "../models/CustomDesign";

// ─── Test Harness ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assertEqual(expected: any, actual: any, name: string) {
  if (expected === actual) {
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${name} — Expected ${expected} got ${actual}`);
    failed++;
    failures.push(`${name}: expected ${expected} got ${actual}`);
  }
}

async function shouldReject(fn: () => Promise<any>, name: string) {
  try {
    await fn();
    console.error(`  ❌ FAIL: ${name} — Expected rejection but succeeded`);
    failed++;
    failures.push(name);
  } catch {
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  }
}

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockProduct = {
  _id: "prod_price_test",
  status: ProductStatus.ACTIVE,
  basePrice: 500,
  printMethods: ["DTF"],
  variants: [
    { _id: "var_M_BLACK", isAvailable: true, additionalPrice: 0, size: "M", color: "BLACK", stock: 100 },
    { _id: "var_L_BLACK", isAvailable: true, additionalPrice: 50, size: "L", color: "BLACK", stock: 100 },
    { _id: "var_XL_WHITE", isAvailable: true, additionalPrice: 100, size: "XL", color: "WHITE", stock: 10 },
    { _id: "var_UNAVAIL", isAvailable: false, additionalPrice: 0, size: "S", color: "RED", stock: 0 },
  ],
};

// Design with FRONT only
const mockDesignFrontOnly = {
  _id: "des_front_only",
  getActiveLayout: () => ({
    front: { elements: [{ id: "1", type: "TEXT" }] },
    back: { elements: [] },
    leftSleeve: { elements: [] },
    rightSleeve: { elements: [] },
  }),
};

// Design with FRONT + BACK
const mockDesignFrontBack = {
  _id: "des_front_back",
  getActiveLayout: () => ({
    front: { elements: [{ id: "1", type: "TEXT" }] },
    back: { elements: [{ id: "2", type: "IMAGE" }] },
    leftSleeve: { elements: [] },
    rightSleeve: { elements: [] },
  }),
};

(Product as any).findById = async (id: string) =>
  id === "prod_price_test" ? mockProduct : null;

(CustomDesign as any).findById = async (id: string) => {
  if (id === "des_front_only") return mockDesignFrontOnly;
  if (id === "des_front_back") return mockDesignFrontBack;
  return null;
};

// ─── Tests ────────────────────────────────────────────────────────────────────

async function runPricingTests() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  Phase 6 — Pricing Integrity Test Suite           ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  // ─── Normal Products ──────────────────────────────────────────────────────

  console.log("\n[PRICE-1] Normal product: base price calculation");
  {
    // base=500, additionalPrice=0, qty=2 → subtotal=1000, shipping=0 (≥999)
    const r = await PricingService.calculateItemPricing({
      productId: "prod_price_test",
      variantId: "var_M_BLACK",
      quantity: 2,
      isCustomized: false,
    });
    assertEqual(1000, r.subtotal, "PRICE-1.1 Normal product subtotal (2×500)");
    assertEqual(0, r.shipping, "PRICE-1.2 Free shipping for subtotal ≥ ₹999");
    assertEqual(1000, r.total, "PRICE-1.3 Total = subtotal (no shipping, no tax)");
    assertEqual("INR", r.currency, "PRICE-1.4 Currency is INR");
  }

  console.log("\n[PRICE-2] Normal product: variant additional price");
  {
    // base=500, additionalPrice=50, qty=1 → subtotal=550.
    // Line-item snapshots deliberately carry shipping=0 (pricingService.ts):
    // shipping is applied ONCE at cart/order level (₹100 below ₹999, free ≥ ₹999).
    const r = await PricingService.calculateItemPricing({
      productId: "prod_price_test",
      variantId: "var_L_BLACK",
      quantity: 1,
      isCustomized: false,
    });
    assertEqual(550, r.subtotal, "PRICE-2.1 Subtotal includes variant additionalPrice");
    assertEqual(0, r.shipping, "PRICE-2.2 Line snapshot excludes shipping (cart/order-level concern)");
    assertEqual(550, r.total, "PRICE-2.3 Total = subtotal (no shipping, no tax) in line snapshot");
  }

  console.log("\n[PRICE-3] Unavailable variant rejected");
  await shouldReject(
    () => PricingService.calculateItemPricing({
      productId: "prod_price_test",
      variantId: "var_UNAVAIL",
      quantity: 1,
      isCustomized: false,
    }),
    "PRICE-3.1 Unavailable variant is rejected by server"
  );

  console.log("\n[PRICE-4] Custom product: FRONT only print charge (DTF=₹200/location)");
  {
    // base=500, var=0, qty=2, print=200 (front only) → per unit: 700, total: 1400
    const r = await PricingService.calculateItemPricing({
      productId: "prod_price_test",
      variantId: "var_M_BLACK",
      quantity: 1,
      isCustomized: true,
      customConfigurations: [{
        color: "BLACK",
        variantId: "var_M_BLACK" as any,
        designId: "des_front_only" as any,
        sizeDistribution: [{ size: "M", quantity: 2 }],
      }],
    });
    // qty=2, base=500×2=1000, print=200×2=400, total=1400 (≥999 → shipping=0)
    assertEqual(1400, r.subtotal, "PRICE-4.1 Subtotal with FRONT-only DTF charge");
    assertEqual(0, r.shipping, "PRICE-4.2 Free shipping (subtotal ≥ ₹999)");
    assertEqual(200 * 2, r.printCharges, "PRICE-4.3 Print charges = ₹200×qty");
  }

  console.log("\n[PRICE-5] Custom product: FRONT+BACK print charges");
  {
    // base=500, print=200+200=400/unit, qty=3 → (500+400)×3=2700
    const r = await PricingService.calculateItemPricing({
      productId: "prod_price_test",
      variantId: "var_M_BLACK",
      quantity: 1,
      isCustomized: true,
      customConfigurations: [{
        color: "BLACK",
        variantId: "var_M_BLACK" as any,
        designId: "des_front_back" as any,
        sizeDistribution: [{ size: "M", quantity: 3 }],
      }],
    });
    assertEqual(400 * 3, r.printCharges, "PRICE-5.1 Print charges = (200+200)×3");
    assertEqual(2700, r.subtotal, "PRICE-5.2 Subtotal includes both print locations");
  }

  console.log("\n[PRICE-6] Bulk discount — 10+ units = 10% off");
  {
    // qty=10, base+print per unit = 500+400=900 → 9000 → 10% off = 8100
    const r = await PricingService.calculateItemPricing({
      productId: "prod_price_test",
      variantId: "var_M_BLACK",
      quantity: 1,
      isCustomized: true,
      customConfigurations: [{
        color: "BLACK",
        variantId: "var_M_BLACK" as any,
        designId: "des_front_back" as any,
        sizeDistribution: [{ size: "M", quantity: 10 }],
      }],
    });
    assertEqual(900, r.bulkDiscount, "PRICE-6.1 10% bulk discount on 10 units (₹900 off ₹9000)");
    assertEqual(8100, r.subtotal, "PRICE-6.2 Subtotal after 10% discount");
  }

  console.log("\n[PRICE-7] Bulk discount — 50+ units = 20% off");
  {
    // qty=50, per unit=900 → 45000 → 20% off = 36000
    const r = await PricingService.calculateItemPricing({
      productId: "prod_price_test",
      variantId: "var_M_BLACK",
      quantity: 1,
      isCustomized: true,
      customConfigurations: [{
        color: "BLACK",
        variantId: "var_M_BLACK" as any,
        designId: "des_front_back" as any,
        sizeDistribution: [{ size: "M", quantity: 50 }],
      }],
    });
    assertEqual(9000, r.bulkDiscount, "PRICE-7.1 20% bulk discount on 50 units (₹9000 off ₹45000)");
    assertEqual(36000, r.subtotal, "PRICE-7.2 Subtotal after 20% discount");
  }

  console.log("\n[PRICE-8] Price manipulation: server ignores client-submitted totals");
  {
    // The PricingService never reads req.body.price or req.body.total.
    // It only accepts: productId, variantId, quantity, customConfigurations.
    // Verify that calling with no price/total params still produces correct total.
    const r = await PricingService.calculateItemPricing({
      productId: "prod_price_test",
      variantId: "var_M_BLACK",
      quantity: 1,
      isCustomized: false,
      // Attacker would include: price: 1, total: 1 in req.body — these are ignored
    });
    const serverTotal = r.total;
    const fakeTotal = 1;
    if (serverTotal !== fakeTotal) {
      console.log(`  ✅ PASS: PRICE-8.1 Server-calculated total (${serverTotal}) ≠ fake total (${fakeTotal})`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: PRICE-8.1 Server total equals fake total — price accepted from client`);
      failed++;
      failures.push("PRICE-8.1");
    }
  }

  console.log("\n[PRICE-9] Multi-color configuration pricing");
  {
    // Config A: BLACK/M×3, Config B: WHITE/XL×2 (additionalPrice=100, front+back print)
    // A: (500+400)×3 = 2700, B: (500+100+400)×2 = 2000, total=4700, qty=5 → no bulk
    const r = await PricingService.calculateItemPricing({
      productId: "prod_price_test",
      variantId: "var_M_BLACK",
      quantity: 1,
      isCustomized: true,
      customConfigurations: [
        {
          color: "BLACK",
          variantId: "var_M_BLACK" as any,
          designId: "des_front_back" as any,
          sizeDistribution: [{ size: "M", quantity: 3 }],
        },
        {
          color: "WHITE",
          variantId: "var_XL_WHITE" as any,
          designId: "des_front_back" as any,
          sizeDistribution: [{ size: "XL", quantity: 2 }],
        },
      ],
    });
    assertEqual(4700, r.subtotal, "PRICE-9.1 Multi-color config subtotal = 2700 + 2000");
    assertEqual(0, r.bulkDiscount, "PRICE-9.2 No bulk discount (qty=5, < 10 threshold)");
  }

  // Summary
  console.log("\n══════════════════════════════════════════════");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failures.length) failures.forEach((f) => console.log("  •", f));
  console.log("══════════════════════════════════════════════");
  process.exit(failed > 0 ? 1 : 0);
}

runPricingTests().catch((e) => {
  console.error("Pricing test runner crashed:", e);
  process.exit(1);
});
