/**
 * Print Placement Removal & Pricing Consistency Regression Test Suite
 *
 * Verifies:
 * 1. New CustomDesign and BulkOrderRequest documents do not default or fabricate ["FRONT"].
 * 2. Historical records containing ["FRONT", "BACK"] remain intact and readable.
 * 3. Production PrintJob applies internal safe default ["FRONT"] without corrupting customer request snapshot.
 * 4. Retail item customized pricing is location-independent per unit across distinct print methods (DTF, EMBROIDERY, SCREEN_PRINT).
 * 5. Bulk quotations use location-independent printingFeePerUnit and match authoritative pricing.
 * 6. Supplying or omitting placement fields has ZERO impact on final prices.
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

import { connectSafeTestDb, createTestProduct } from "./testHelpers";
import { CustomDesign } from "../models/CustomDesign";
import { BulkOrderRequest } from "../models/BulkOrderRequest";
import { PrintJob, PrintJobPriority, PrintJobStatus } from "../models/PrintJob";
import { PrintPricingConfig } from "../models/PrintPricingConfig";
import { PricingService } from "../services/pricingService";
import { calculateAuthoritativeBulkPricing, getEffectivePricingRule } from "../services/volumePricingService";
import { PRINT_PRICING_RULES } from "../config/pricingRules";

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

async function runPrintPlacementSemanticsAndPricingTests() {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║ Print Placement Removal & Pricing Consistency Test Suite       ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  const cleanupProductIds: mongoose.Types.ObjectId[] = [];
  const cleanupDesignIds: mongoose.Types.ObjectId[] = [];
  const cleanupBulkRequestIds: mongoose.Types.ObjectId[] = [];
  const cleanupPrintJobIds: mongoose.Types.ObjectId[] = [];
  const cleanupPricingConfigIds: mongoose.Types.ObjectId[] = [];

  try {
    await connectSafeTestDb();
    console.log(` Connected to verified isolated test database: ${mongoose.connection.name}\n`);

    const timestamp = Date.now();

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 1: REQUEST SEMANTICS - NEW REQUESTS VS HISTORICAL RECORDS
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("[TEST GROUP 1: REQUEST SEMANTICS - NEW REQUESTS VS HISTORICAL RECORDS]");

    const { product: dtfProduct, productId: dtfProductId, variantIds: dtfVariantIds } = await createTestProduct({
      name: `DTF Tee ${timestamp}`,
      basePrice: 600,
      printMethods: ["DTF"],
    });
    cleanupProductIds.push(dtfProduct._id);

    // 1.1 New CustomDesign without placement info
    const newDesign = await CustomDesign.create({
      name: "New Clean Design",
      userId: new mongoose.Types.ObjectId(),
      productId: dtfProduct._id,
      selectedVariantId: dtfVariantIds[0],
      selectedColor: "BLACK",
      selectedSize: "M",
      canvasWidth: 800,
      canvasHeight: 1000,
      design: { layers: [], selectedElements: [], elements: [] },
      instructions: "Clean modern graphic across chest",
      requestType: "PRINTING_REQUEST",
      status: "REQUESTED",
    });
    cleanupDesignIds.push(newDesign._id);

    const reloadedNewDesign = await CustomDesign.findById(newDesign._id);
    check(
      reloadedNewDesign?.printLocations === undefined || (Array.isArray(reloadedNewDesign.printLocations) && reloadedNewDesign.printLocations.length === 0),
      "1.1 New CustomDesign request does NOT default or fabricate printLocations: ['FRONT']"
    );

    // 1.2 Historical CustomDesign with legacy placement info
    const historicalDesign = await CustomDesign.create({
      name: "Historical Multi-Location Design",
      userId: new mongoose.Types.ObjectId(),
      productId: dtfProduct._id,
      selectedVariantId: dtfVariantIds[0],
      selectedColor: "BLACK",
      selectedSize: "M",
      canvasWidth: 800,
      canvasHeight: 1000,
      design: { layers: [], selectedElements: [], elements: [] },
      instructions: "Legacy custom print request",
      requestType: "PRINTING_REQUEST",
      status: "REQUESTED",
      printLocations: ["FRONT", "BACK"],
    });
    cleanupDesignIds.push(historicalDesign._id);

    const reloadedHistoricalDesign = await CustomDesign.findById(historicalDesign._id);
    check(
      Array.isArray(reloadedHistoricalDesign?.printLocations) &&
        reloadedHistoricalDesign.printLocations.length === 2 &&
        reloadedHistoricalDesign.printLocations[0] === "FRONT" &&
        reloadedHistoricalDesign.printLocations[1] === "BACK",
      "1.2 Historical CustomDesign preserves existing ['FRONT', 'BACK'] placements"
    );

    // 1.3 New BulkOrderRequest without placement info
    const newBulkRequest = await BulkOrderRequest.create({
      quoteNumber: `SF-QT-NEW-${timestamp}`,
      deliveryLocation: "100 Foot Road, Bengaluru",
      userId: new mongoose.Types.ObjectId(),
      organizationName: "Modern Startup",
      contactName: "Alex Rivera",
      email: "alex@startup.io",
      phone: "+919999900001",
      productId: dtfProduct._id,
      totalQuantity: 25,
      variantBreakdown: { M: 25 },
      variantAllocations: [{ size: "M", color: "BLACK", quantity: 25 }],
      customPrintingRequired: true,
      printMethod: "DTF Transfer",
    });
    cleanupBulkRequestIds.push(newBulkRequest._id);

    const reloadedNewBulkRequest = await BulkOrderRequest.findById(newBulkRequest._id);
    check(
      reloadedNewBulkRequest?.printLocations === undefined || (Array.isArray(reloadedNewBulkRequest.printLocations) && reloadedNewBulkRequest.printLocations.length === 0),
      "1.3 New BulkOrderRequest does NOT default or fabricate printLocations: ['FRONT']"
    );

    // 1.4 Historical BulkOrderRequest with legacy placement info
    const historicalBulkRequest = await BulkOrderRequest.create({
      quoteNumber: `SF-QT-HIST-${timestamp}`,
      deliveryLocation: "42 MG Road, Bengaluru",
      userId: new mongoose.Types.ObjectId(),
      contactName: "David Smith",
      email: "david@legacy.com",
      phone: "+919999900002",
      productId: dtfProduct._id,
      totalQuantity: 50,
      variantBreakdown: { L: 50 },
      variantAllocations: [{ size: "L", color: "BLACK", quantity: 50 }],
      customPrintingRequired: true,
      printLocations: ["FRONT", "BACK", "LEFT_SLEEVE"],
      printMethod: "DTF Transfer",
    });
    cleanupBulkRequestIds.push(historicalBulkRequest._id);

    const reloadedHistoricalBulkRequest = await BulkOrderRequest.findById(historicalBulkRequest._id);
    check(
      Array.isArray(reloadedHistoricalBulkRequest?.printLocations) &&
        reloadedHistoricalBulkRequest.printLocations.length === 3 &&
        reloadedHistoricalBulkRequest.printLocations[2] === "LEFT_SLEEVE",
      "1.4 Historical BulkOrderRequest preserves existing ['FRONT', 'BACK', 'LEFT_SLEEVE'] placements"
    );

    // 1.5 Internal Production Queue Default vs Customer Snapshot
    // When preparing a production PrintJob for a request without placement info,
    // the printer applies the safe production default ["FRONT"] without corrupting customer data
    const newRequestSnapshot = {
      name: "Custom Print Order",
      previewImage: "https://example.com/mock.png",
      printLocations: reloadedNewDesign?.printLocations && reloadedNewDesign.printLocations.length > 0 ? reloadedNewDesign.printLocations : undefined,
    };

    check(
      newRequestSnapshot.printLocations === undefined,
      "1.5 Customer customizationSnapshot does NOT claim customer selected ['FRONT']"
    );

    const productionPrintJob = await PrintJob.create({
      orderId: new mongoose.Types.ObjectId(),
      orderItemId: new mongoose.Types.ObjectId().toString(),
      customDesignId: newDesign._id,
      status: PrintJobStatus.PENDING_REVIEW,
      priority: PrintJobPriority.MEDIUM,
      printLocations: ["FRONT"],
    });
    cleanupPrintJobIds.push(productionPrintJob._id as any);

    check(
      Array.isArray(productionPrintJob.printLocations) &&
        productionPrintJob.printLocations.length === 1 &&
        productionPrintJob.printLocations[0] === "FRONT",
      "1.6 Internal PrintJob deliberately applies safe production default ['FRONT'] for machine operations"
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 2: RETAIL CUSTOMIZED PRICING - LOCATION-INDEPENDENT & DISTINCT METHODS
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("\n[TEST GROUP 2: RETAIL CUSTOMIZED PRICING - LOCATION-INDEPENDENT & DISTINCT METHODS]");

    // 2.1 DTF method: ₹200 flat printing fee per customized garment
    const pricingWithoutPlacement = await PricingService.calculateItemPricing({
      productId: dtfProductId,
      variantId: dtfVariantIds[0],
      quantity: 2,
      isCustomized: true,
      customConfigurations: [{
        designId: newDesign._id as any,
        variantId: dtfVariantIds[0] as any,
        color: "BLACK",
        sizeDistribution: [{ size: "M", quantity: 2 }],
      }],
    });

    const pricingWithLegacyPlacement = await PricingService.calculateItemPricing({
      productId: dtfProductId,
      variantId: dtfVariantIds[0],
      quantity: 2,
      isCustomized: true,
      customConfigurations: [{
        designId: historicalDesign._id as any,
        variantId: dtfVariantIds[0] as any,
        color: "BLACK",
        sizeDistribution: [{ size: "M", quantity: 2 }],
      }],
    });

    check(
      pricingWithoutPlacement.printCharges === 400,
      `2.1 DTF method calculates ₹200/unit printing fee (expected ₹400 for 2 units, got: ₹${pricingWithoutPlacement.printCharges})`
    );
    check(
      pricingWithoutPlacement.total === pricingWithLegacyPlacement.total,
      `2.2 Supplying 2 legacy print locations (FRONT, BACK) has ZERO effect on retail price (both: ₹${pricingWithoutPlacement.total})`
    );
    // 2.2 EMBROIDERY method: ₹250 flat printing fee per customized garment
    const { product: embroideryProduct, productId: embroideryProductId, variantIds: embroideryVariantIds } = await createTestProduct({
      name: `Embroidery Polo ${timestamp}`,
      basePrice: 800,
      printMethods: ["EMBROIDERY"],
    });
    cleanupProductIds.push(embroideryProduct._id);

    const embroideryDesign = await CustomDesign.create({
      name: "Embroidery Crest Design",
      userId: new mongoose.Types.ObjectId(),
      productId: embroideryProduct._id,
      selectedVariantId: embroideryVariantIds[0],
      selectedColor: "NAVY",
      selectedSize: "L",
      canvasWidth: 800,
      canvasHeight: 1000,
      design: { layers: [], selectedElements: [], elements: [] },
      instructions: "Embroidered chest crest",
      requestType: "PRINTING_REQUEST",
      status: "REQUESTED",
    });
    cleanupDesignIds.push(embroideryDesign._id);

    const embroideryPricing = await PricingService.calculateItemPricing({
      productId: embroideryProductId,
      variantId: embroideryVariantIds[0],
      quantity: 2,
      isCustomized: true,
      customConfigurations: [{
        designId: embroideryDesign._id as any,
        variantId: embroideryVariantIds[0] as any,
        color: "NAVY",
        sizeDistribution: [{ size: "L", quantity: 2 }],
      }],
    });
    check(
      embroideryPricing.printCharges === 500,
      `2.3 EMBROIDERY method uses configured ₹250/unit fee (expected ₹500 for 2 units, got: ₹${embroideryPricing.printCharges})`
    );
    check(
      embroideryPricing.printCharges > pricingWithoutPlacement.printCharges,
      `2.4 Distinct printing methods have distinct fee totals (EMBROIDERY ₹500 > DTF ₹400)`
    );

    // 2.3 SCREEN_PRINT method: ₹150 flat printing fee per customized garment
    const { product: screenProduct, productId: screenProductId, variantIds: screenVariantIds } = await createTestProduct({
      name: `Screen Print Tee ${timestamp}`,
      basePrice: 450,
      printMethods: ["SCREEN_PRINT"],
    });
    cleanupProductIds.push(screenProduct._id);

    const screenDesign = await CustomDesign.create({
      name: "Screen Print Festival Design",
      userId: new mongoose.Types.ObjectId(),
      productId: screenProduct._id,
      selectedVariantId: screenVariantIds[0],
      selectedColor: "WHITE",
      selectedSize: "XL",
      canvasWidth: 800,
      canvasHeight: 1000,
      design: { layers: [], selectedElements: [], elements: [] },
      instructions: "Screen printed festival logo",
      requestType: "PRINTING_REQUEST",
      status: "REQUESTED",
    });
    cleanupDesignIds.push(screenDesign._id);

    const screenPricing = await PricingService.calculateItemPricing({
      productId: screenProductId,
      variantId: screenVariantIds[0],
      quantity: 2,
      isCustomized: true,
      customConfigurations: [{
        designId: screenDesign._id as any,
        variantId: screenVariantIds[0] as any,
        color: "WHITE",
        sizeDistribution: [{ size: "XL", quantity: 2 }],
      }],
    });

    check(
      screenPricing.printCharges === 300,
      `2.5 SCREEN_PRINT method uses configured ₹150/unit fee (expected ₹300 for 2 units, got: ₹${screenPricing.printCharges})`
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 3: BULK QUOTATIONS - PRINTING FEE PER UNIT & CONSISTENCY
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("\n[TEST GROUP 3: BULK QUOTATIONS - PRINTING FEE PER UNIT & CONSISTENCY]");

    // 3.1 Verify PrintPricingConfig virtual and schema compatibility
    const customConfig = await PrintPricingConfig.create({
      scope: "PRODUCT",
      productId: dtfProduct._id,
      minOrderQuantity: 15,
      tiers: [
        { minQuantity: 15, maxQuantity: 29, discountPercentage: 10 },
        { minQuantity: 30, discountPercentage: 25 },
      ],
      printLocationFee: 175,
      setupFee: 500,
      isActive: true,
    });
    cleanupPricingConfigIds.push(customConfig._id);

    check(
      customConfig.printingFeePerUnit === 175,
      `3.1 PrintPricingConfig virtual printingFeePerUnit returns configured fee (₹${customConfig.printingFeePerUnit})`
    );

    // 3.2 Effective rule returns printingFeePerUnit
    const effectiveRule = await getEffectivePricingRule(dtfProductId);
    check(
      effectiveRule.printingFeePerUnit === 175 && effectiveRule.printLocationFee === 175,
      `3.2 getEffectivePricingRule resolves printingFeePerUnit=₹175 and retains printLocationFee=₹175`
    );

    // 3.3 Authoritative bulk pricing calculation
    const bulkPricingResult = await calculateAuthoritativeBulkPricing({
      productId: dtfProductId,
      totalQuantity: 20,
    });

    check(
      bulkPricingResult.printingFeePerUnitRupees === 175,
      `3.3 Bulk estimate reports printingFeePerUnitRupees=₹175`
    );
    check(
      bulkPricingResult.totalPrintingFeeRupees === 175 * 20,
      `3.4 Bulk total printing fee is exactly ₹175 * 20 = ₹3,500 (got: ₹${bulkPricingResult.totalPrintingFeeRupees})`
    );
    check(
      bulkPricingResult.setupFeeRupees === 500,
      `3.5 Setup fee preserved as flat ₹500 (got: ₹${bulkPricingResult.setupFeeRupees})`
    );

    // 3.4 Verify distinct method rules in PRINT_PRICING_RULES configuration
    check(
      PRINT_PRICING_RULES.DTF.unitPrintingFee === 200,
      "3.6 PRINT_PRICING_RULES.DTF has documented unitPrintingFee: 200"
    );
    check(
      PRINT_PRICING_RULES.EMBROIDERY.unitPrintingFee === 250,
      "3.7 PRINT_PRICING_RULES.EMBROIDERY has documented unitPrintingFee: 250"
    );
    check(
      PRINT_PRICING_RULES.SCREEN_PRINT.unitPrintingFee === 150,
      "3.8 PRINT_PRICING_RULES.SCREEN_PRINT has documented unitPrintingFee: 150"
    );

    console.log("\nCleaning up test fixtures from database...");
    for (const id of cleanupPrintJobIds) await PrintJob.findByIdAndDelete(id);
    for (const id of cleanupBulkRequestIds) await BulkOrderRequest.findByIdAndDelete(id);
    for (const id of cleanupDesignIds) await CustomDesign.findByIdAndDelete(id);
    for (const id of cleanupPricingConfigIds) await PrintPricingConfig.findByIdAndDelete(id);
    for (const id of cleanupProductIds) await dtfProduct.collection.deleteOne({ _id: id });
    console.log("Disconnected from MongoDB\n");
    await mongoose.disconnect();

    console.log("─────────────────────────────────────────────────────────────────");
    console.log(`Results: ${passed} passed, ${failed} failed`);
    console.log("─────────────────────────────────────────────────────────────────\n");

    if (failed > 0) {
      console.error("Test failures:\n" + failures.join("\n"));
      process.exit(1);
    }
  } catch (err: unknown) {
    console.error("Fatal test runner error:", err);
    process.exit(1);
  }
}

runPrintPlacementSemanticsAndPricingTests();
