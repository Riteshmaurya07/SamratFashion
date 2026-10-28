/**
 * Phase 2: Inventory Allocation Regression Test Suite
 *
 * Verifies that:
 * 1. Normal order items deduct exact requested quantities from the correct variant.
 * 2. Multi-size custom items deduct stock from each corresponding variant.
 * 3. Bulk quotation converted items (isCustomized: true with empty customConfigurations)
 *    accurately deduct stock rather than being skipped.
 * 4. Duplicate demands for the same product and variant in an order are aggregated.
 * 5. Rollback of partial deductions works without leaking stock decrements.
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

import { connectSafeTestDb, createTestProduct } from "./testHelpers";
import { InventoryAllocationService } from "../services/inventory/inventoryAllocationService";
import { Product } from "../models/Product";
import { Order } from "../models/Order";

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

async function runInventoryTests() {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║  Inventory Allocation & Multi-SKU Precision Verification Suite  ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  const cleanupProductIds: mongoose.Types.ObjectId[] = [];
  const cleanupOrderIds: mongoose.Types.ObjectId[] = [];

  try {
    await connectSafeTestDb();
    console.log(` Connected to verified isolated test database: ${mongoose.connection.name}\n`);

    const timestamp = Date.now();

    // Setup: Product with 3 size variants
    const { product: prodDoc } = await createTestProduct({
      name: `Inventory Test Tee ${timestamp}`,
      variants: [
        { size: "S", color: "BLACK", stock: 20, isAvailable: true },
        { size: "M", color: "BLACK", stock: 25, isAvailable: true },
        { size: "L", color: "BLACK", stock: 30, isAvailable: true },
      ],
    });
    const product = prodDoc;
    cleanupProductIds.push(product._id);

    const varS = product.variants.find((v: any) => v.size === "S")!;
    const varM = product.variants.find((v: any) => v.size === "M")!;
    const varL = product.variants.find((v: any) => v.size === "L")!;

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 1: NORMAL RETAIL ITEM DEDUCTION
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("[TEST GROUP 1: NORMAL RETAIL ITEM ALLOCATIONS]");

    const normalItem = {
      productId: product._id,
      variantId: varS._id,
      quantity: 5,
      isCustomized: false,
    };

    const allocsNormal = InventoryAllocationService.resolveItemAllocations(normalItem, product);
    check(allocsNormal.length === 1 && allocsNormal[0].quantity === 5, "1.1 Resolves single variant allocation with quantity 5");
    check(allocsNormal[0].variantId.toString() === varS._id.toString(), "1.2 Allocates to exact variant ID (Size S)");

    const orderId1 = new mongoose.Types.ObjectId();
    cleanupOrderIds.push(orderId1);
    const aggNormal = InventoryAllocationService.aggregateAllocations(allocsNormal);
    const deductNormal = await InventoryAllocationService.deductInventory(orderId1, aggNormal);
    check(deductNormal.success === true, "1.3 Deducts stock atomically for normal order");

    const reloadedAfterNormal = await Product.findById(product._id);
    const stockS = reloadedAfterNormal!.variants.find((v: any) => v.size === "S")!.stock;
    check(stockS === 15, `1.4 Exact final stock for Size S: 15 (20 - 5 = ${stockS})`);

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 2: MULTI-VARIANT CUSTOM DESIGN ITEM ALLOCATION
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("\n[TEST GROUP 2: MULTI-VARIANT CUSTOM DESIGN ALLOCATIONS]");

    const customDesignItem = {
      productId: product._id,
      isCustomized: true,
      customConfigurations: [
        {
          color: "BLACK",
          variantId: varM._id,
          sizeDistribution: [
            { size: "M", quantity: 8 },
            { size: "L", quantity: 12 },
          ],
        },
      ],
    };

    const allocsCustom = InventoryAllocationService.resolveItemAllocations(customDesignItem, product);
    check(allocsCustom.length === 2, "2.1 Resolves 2 distinct SKU allocations from sizeDistribution");
    check(
      allocsCustom.some((a) => a.size === "M" && a.quantity === 8) &&
        allocsCustom.some((a) => a.size === "L" && a.quantity === 12),
      "2.2 Correctly maps size M (8) and size L (12)"
    );

    const orderId2 = new mongoose.Types.ObjectId();
    cleanupOrderIds.push(orderId2);
    const aggCustom = InventoryAllocationService.aggregateAllocations(allocsCustom);
    const deductCustom = await InventoryAllocationService.deductInventory(orderId2, aggCustom);
    check(deductCustom.success === true, "2.3 Deducts multi-variant custom allocations atomically");

    const reloadedAfterCustom = await Product.findById(product._id);
    const stockM = reloadedAfterCustom!.variants.find((v: any) => v.size === "M")!.stock;
    const stockL = reloadedAfterCustom!.variants.find((v: any) => v.size === "L")!.stock;
    check(stockM === 17, `2.4 Exact final stock for Size M: 17 (25 - 8 = ${stockM})`);
    check(stockL === 18, `2.5 Exact final stock for Size L: 18 (30 - 12 = ${stockL})`);

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 3: BULK ORDER CONVERTED ITEM ALLOCATION (isCustomized without configs)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("\n[TEST GROUP 3: BULK CONVERTED ITEM ALLOCATIONS]");

    const bulkConvertedItem = {
      productId: product._id,
      variantId: varL._id,
      quantity: 10,
      isCustomized: true, // Crucial: bulk order sets isCustomized=true but customConfigurations=[]
      customConfigurations: [],
    };

    const allocsBulk = InventoryAllocationService.resolveItemAllocations(bulkConvertedItem, product);
    check(allocsBulk.length === 1 && allocsBulk[0].quantity === 10, "3.1 Resolves bulk item allocation of 10 units");
    check(allocsBulk[0].variantId.toString() === varL._id.toString(), "3.2 Correctly targets variant L");

    const orderId3 = new mongoose.Types.ObjectId();
    cleanupOrderIds.push(orderId3);
    const aggBulk = InventoryAllocationService.aggregateAllocations(allocsBulk);
    const deductBulk = await InventoryAllocationService.deductInventory(orderId3, aggBulk);
    check(deductBulk.success === true, "3.3 Bulk converted item stock deducted without being skipped");

    const reloadedAfterBulk = await Product.findById(product._id);
    const finalStockL = reloadedAfterBulk!.variants.find((v: any) => v.size === "L")!.stock;
    check(finalStockL === 8, `3.4 Exact final stock for Size L: 8 (18 - 10 = ${finalStockL})`);

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 4: DUPLICATE DEMAND AGGREGATION & OVERSALE ROLLBACK
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("\n[TEST GROUP 4: DUPLICATE AGGREGATION & ROLLBACK]");

    // Two order items requesting the same variant S (5 + 5 = 10)
    const rawAllocs: any[] = [
      { productId: product._id, variantId: varS._id, quantity: 5 },
      { productId: product._id, variantId: varS._id, quantity: 5 },
    ];
    const aggregated = InventoryAllocationService.aggregateAllocations(rawAllocs);
    check(aggregated.length === 1 && aggregated[0].totalQuantity === 10, "4.1 Aggregates duplicate variant demands to 10");

    // Attempt to deduct 50 units when only 15 exist in stock
    const excessAllocs = [{ productId: product._id, variantId: varS._id, totalQuantity: 50 }];
    const orderId4 = new mongoose.Types.ObjectId();
    cleanupOrderIds.push(orderId4);
    const excessDeduct = await InventoryAllocationService.deductInventory(orderId4, excessAllocs);
    check(excessDeduct.success === false, "4.2 Rejects deduction when stock is insufficient (50 > 15)");

    const reloadedAfterFailed = await Product.findById(product._id);
    const unchangedStockS = reloadedAfterFailed!.variants.find((v: any) => v.size === "S")!.stock;
    check(unchangedStockS === 15, `4.3 Stock remains unchanged after rejection (15 = ${unchangedStockS})`);

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 5: SAFE INVENTORY RESTORATION ON CANCELLATION
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("\n[TEST GROUP 5: SAFE RESTOCK ON CANCELLATION]");

    // Restore stock for orderId1 (which deducted 5 units of S)
    const restoredCount = await InventoryAllocationService.restoreInventoryForOrder(orderId1);
    check(restoredCount === 1, "5.1 Exactly 1 SALE transaction was restored");

    const reloadedAfterRestock = await Product.findById(product._id);
    const restoredStockS = reloadedAfterRestock!.variants.find((v: any) => v.size === "S")!.stock;
    check(restoredStockS === 20, `5.2 Restocked Size S back to 20 (15 + 5 = ${restoredStockS})`);

    // Second restoration must be a no-op (prevents double restoration)
    const secondRestoredCount = await InventoryAllocationService.restoreInventoryForOrder(orderId1);
    check(secondRestoredCount === 0, "5.3 Second cancellation call is an idempotent no-op (0 restored)");

  } catch (err: unknown) {
    console.error("💥 Unhandled test exception:", err);
    failed++;
    failures.push(`Unhandled test exception: ${err}`);
  } finally {
    console.log("\n🧹 Cleaning up test fixtures from database...");
    if (cleanupProductIds.length > 0) {
      await Product.deleteMany({ _id: { $in: cleanupProductIds } });
    }
    if (cleanupOrderIds.length > 0) {
      await Order.deleteMany({ _id: { $in: cleanupOrderIds } });
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

runInventoryTests().catch((err) => {
  console.error("Fatal test runner error:", err);
  process.exit(1);
});
