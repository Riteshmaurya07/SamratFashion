import { PricingService } from "../services/pricingService";
import { Product, ProductStatus } from "../models/Product";
import { CustomDesign } from "../models/CustomDesign";

// --- Mock Setup ---
const mockProduct = {
  _id: "prod1",
  status: ProductStatus.ACTIVE,
  basePrice: 500,
  printMethods: ["DTF"],
  variants: [
    { _id: "var1", isAvailable: true, additionalPrice: 50, size: "M", color: "BLACK" },
    { _id: "var2", isAvailable: true, additionalPrice: 100, size: "L", color: "WHITE" },
  ],
};

const mockDesign = {
  _id: "des1",
  getActiveLayout: () => ({
    front: { elements: [{ id: "1", type: "TEXT" }] },
    back: { elements: [{ id: "2", type: "IMAGE" }] },
    leftSleeve: { elements: [] },
    rightSleeve: { elements: [] },
  }),
};

// Monkey patch mongoose models
(Product as any).findById = async (id: string) => {
  if (id === "prod1") return mockProduct;
  return null;
};

(CustomDesign as any).findById = async (id: string) => {
  if (id === "des1") return mockDesign;
  return null;
};

// --- Test Runner ---
async function runTests() {
  console.log("Running Phase 2 Pricing Tests...\n");
  let passed = 0;
  let failed = 0;

  const assertEqual = (expected: any, actual: any, name: string) => {
    if (expected === actual) {
      console.log(`✅ PASS: ${name}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${name} | Expected ${expected} but got ${actual}`);
      failed++;
    }
  };

  const assertThrows = async (fn: () => Promise<any>, expectedError: string, name: string) => {
    try {
      await fn();
      console.error(`❌ FAIL: ${name} | Expected error containing "${expectedError}" but succeeded`);
      failed++;
    } catch (e: any) {
      if (e.message.includes(expectedError)) {
        console.log(`✅ PASS: ${name}`);
        passed++;
      } else {
        console.error(`❌ FAIL: ${name} | Expected error "${expectedError}" but got "${e.message}"`);
        failed++;
      }
    }
  };

  // Test 1: Standard product pricing (quantity = 2)
  const standardRes = await PricingService.calculateItemPricing({
    productId: "prod1",
    variantId: "var1",
    quantity: 2,
    isCustomized: false,
  });
  // base = 500, var = 50 -> unit = 550 -> total = 1100. subtotal < 999 is false, so shipping 0? Wait, subtotal 1100 > 999, so shipping 0.
  assertEqual(1100, standardRes.total, "Standard product pricing calculates correctly");

  // Test 2: Custom product pricing with one variant (qty 3)
  const customRes1 = await PricingService.calculateItemPricing({
    productId: "prod1",
    variantId: "var1", // Not strictly used for root in customized, customConfigurations takes over
    quantity: 1,
    isCustomized: true,
    customConfigurations: [
      {
        color: "BLACK",
        variantId: "var1" as any,
        designId: "des1" as any,
        sizeDistribution: [{ size: "M", quantity: 3 }],
      },
    ],
  });
  // qty: 3. Base: 500*3=1500. Variant: 50*3=150. Print: DTF (front=200, back=200) = 400 * 3 = 1200. Total = 2850.
  assertEqual(2850, customRes1.total, "Custom pricing calculates correctly (Multiple sizes, Print Locations)");

  // Test 3: Multiple configurations (Colors)
  const customRes2 = await PricingService.calculateItemPricing({
    productId: "prod1",
    variantId: "var1",
    quantity: 1,
    isCustomized: true,
    customConfigurations: [
      {
        color: "BLACK",
        variantId: "var1" as any,
        designId: "des1" as any,
        sizeDistribution: [{ size: "M", quantity: 3 }], // Base: 1500, Var: 150, Print: 1200 => 2850
      },
      {
        color: "WHITE",
        variantId: "var2" as any,
        designId: "des1" as any,
        sizeDistribution: [{ size: "L", quantity: 2 }], // Base: 1000, Var: 200, Print: 800 => 2000
      },
    ],
  });
  // Total qty = 5. Subtotal = 2850 + 2000 = 4850. Discount = 0 (qty < 10). Total = 4850.
  assertEqual(4850, customRes2.total, "Multiple color configurations calculate correctly");

  // Test 4: Bulk discount (qty >= 10 -> 10% off)
  const bulkRes = await PricingService.calculateItemPricing({
    productId: "prod1",
    variantId: "var1",
    quantity: 1,
    isCustomized: true,
    customConfigurations: [
      {
        color: "BLACK",
        variantId: "var1" as any,
        designId: "des1" as any,
        sizeDistribution: [{ size: "M", quantity: 10 }], // Base: 5000, Var: 500, Print: 4000 => 9500
      },
    ],
  });
  // Total Subtotal = 9500. Discount = 950. Total = 8550.
  assertEqual(8550, bulkRes.total, "Bulk discounts (10+) calculate correctly (10% off)");
  assertEqual(950, bulkRes.bulkDiscount, "Bulk discount amount is accurate");

  // Test 5: Invalid Variant rejection
  await assertThrows(
    () =>
      PricingService.calculateItemPricing({
        productId: "prod1",
        variantId: "var1",
        quantity: 1,
        isCustomized: true,
        customConfigurations: [
          {
            color: "RED",
            variantId: "var_invalid" as any,
            sizeDistribution: [{ size: "M", quantity: 1 }],
          },
        ],
      }),
    "Variant var_invalid is unavailable",
    "Invalid variant is rejected server-side"
  );

  console.log(`\nTests Completed. Passed: ${passed}, Failed: ${failed}`);
  if (failed > 0) process.exit(1);
}

runTests().catch(console.error);
