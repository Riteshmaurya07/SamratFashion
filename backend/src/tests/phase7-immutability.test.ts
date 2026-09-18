/**
 * Phase 7 — Print Dimension Configuration & Immutability Test Suite
 *
 * Verifies Requirements 5 & 6:
 * - Dynamic resolution of print dimensions per print area (not hard-coded globally)
 * - Front/Back: 3600×4500 @ 300 DPI (12"×15")
 * - Sleeves: 1200×1500 @ 300 DPI (4"×5")
 * - Dynamic support for custom DPI & physical dimensions
 * - Immutable approved V1 asset retention when V2 revision draft is created
 * - Prevention of production asset overwrites
 */

import mongoose from "mongoose";
import { CustomDesign } from "../models/CustomDesign";
import { CustomDesignAsset } from "../models/CustomDesignAsset";
import { Product } from "../models/Product";
import { ProductionAssetService } from "../services/productionAssetService";
import { CanvasProductionRenderer } from "../services/rendering/CanvasProductionRenderer";
import {
  DEFAULT_PRINT_AREAS,
  resolvePrintDimensions,
  describePrintSystem
} from "../services/rendering/PrintCoordinateSystem";
import { AssetService } from "../services/assetService";
import { createTestProduct } from "./testHelpers";

process.env.PRODUCTION_RENDERER = "canvas";
process.env.IMAGE_PROVIDER = "local";

const productionAssetService = new ProductionAssetService(new CanvasProductionRenderer());
const TEST_USER_ID = new mongoose.Types.ObjectId().toString();

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

async function runImmutabilityAndDimensionTests() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  Phase 7 — Print Dimensions & Immutability Tests ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  await mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/samrat_fashion");
  console.log("✅ Connected to MongoDB\n");

  let product: any;
  let design: any;

  try {
    // ─── TEST 1: Print Dimension Configuration Audit ─────────────────────────
    console.log("[DIM-1] Physical Print Area & DPI Resolution Configuration");

    const frontDims = resolvePrintDimensions(DEFAULT_PRINT_AREAS.FRONT);
    check(frontDims.outputWidthPx === 3600 && frontDims.outputHeightPx === 4500, "DIM-1.1 FRONT dimensions = 3600×4500px (12\"×15\" @ 300 DPI)", `resolved=${frontDims.outputWidthPx}x${frontDims.outputHeightPx}`);
    check(frontDims.scaleX === 4.5 && frontDims.scaleY === 4.5, "DIM-1.2 FRONT scaleX=4.5, scaleY=4.5 (800×1000 UI canvas)", `scale=${frontDims.scaleX}x${frontDims.scaleY}`);

    const backDims = resolvePrintDimensions(DEFAULT_PRINT_AREAS.BACK);
    check(backDims.outputWidthPx === 3600 && backDims.outputHeightPx === 4500, "DIM-1.3 BACK dimensions = 3600×4500px (12\"×15\" @ 300 DPI)", `resolved=${backDims.outputWidthPx}x${backDims.outputHeightPx}`);

    const sleeveDims = resolvePrintDimensions(DEFAULT_PRINT_AREAS.LEFT_SLEEVE);
    check(sleeveDims.outputWidthPx === 1200 && sleeveDims.outputHeightPx === 1500, "DIM-1.4 LEFT_SLEEVE dimensions = 1200×1500px (4\"×5\" @ 300 DPI)", `resolved=${sleeveDims.outputWidthPx}x${sleeveDims.outputHeightPx}`);
    check(sleeveDims.scaleX === 1.5 && sleeveDims.scaleY === 1.5, "DIM-1.5 SLEEVE scaleX=1.5, scaleY=1.5 (800×1000 UI canvas)", `scale=${sleeveDims.scaleX}x${sleeveDims.scaleY}`);

    // Dynamic resolution check for custom print area (e.g. Tote Bag 14"x14" @ 300 DPI)
    const customToteArea = { widthInches: 14, heightInches: 14, dpi: 300, uiCanvasWidth: 800, uiCanvasHeight: 800 };
    const customResolved = resolvePrintDimensions(customToteArea);
    check(customResolved.outputWidthPx === 4200 && customResolved.outputHeightPx === 4200, "DIM-1.6 Dynamic print resolution for custom 14\"×14\" area = 4200×4200px", `resolved=${customResolved.outputWidthPx}x${customResolved.outputHeightPx}`);

    console.log(`\nPrint System Summary:\n  ${describePrintSystem("FRONT")}\n  ${describePrintSystem("LEFT_SLEEVE")}`);

    // ─── TEST 2: Production Asset Immutability Guard ─────────────────────────
    console.log("\n[IMM-1] Production Asset Immutability Guard");
    const pRes = await createTestProduct({ name: "Immutability Test Hoodie" });
    product = pRes.product;

    const layoutV1 = {
      front: { elements: [{ id: "e1", type: "TEXT" as const, x: 100, y: 100, width: 200, height: 50, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, zIndex: 1, properties: { text: "V1 APPROVED TEXT", fontSize: 24, color: "#000000" } }] },
      back: { elements: [] },
      leftSleeve: { elements: [] },
      rightSleeve: { elements: [] }
    };

    design = await CustomDesign.create({
      userId: new mongoose.Types.ObjectId(TEST_USER_ID),
      name: "Immutability Test Design",
      productId: product._id,
      selectedVariantId: product.variants[0]._id,
      selectedColor: "BLACK",
      status: "CUSTOMER_APPROVED",
      requestType: "DESIGN",
      printLocations: ["FRONT"],
      submissionKey: `imm-${Date.now()}`,
      currentVersion: 1,
      approvedVersion: 1,
      design: layoutV1,
      versions: [{ version: 1, design: layoutV1, createdBy: new mongoose.Types.ObjectId(TEST_USER_ID), createdAt: new Date(), status: "CUSTOMER_APPROVED", previewUrls: [], artworkUrls: [] }]
    });

    // Generate production asset for V1
    const v1Assets = await productionAssetService.generateProductionAssets(design, 1);
    check(v1Assets.length === 1, "IMM-1.1 Production asset generated for V1");

    const v1DbAsset = await CustomDesignAsset.findOne({ designId: design._id, version: 1, side: "FRONT", type: "PRODUCTION" });
    check(Boolean(v1DbAsset), "IMM-1.2 Production asset record persisted for V1 in DB");
    const originalV1AssetUrl = v1DbAsset?.originalUrl;

    // Attempting to re-register asset for same (designId, version=1, side=FRONT) should be rejected (409 Conflict)
    let duplicateRejected = false;
    try {
      await AssetService.registerProductionAsset({
        userId: TEST_USER_ID,
        designId: design._id.toString(),
        version: 1,
        side: "FRONT",
        url: "http://localhost/fake-overwrite.png",
        mimeType: "image/png",
        fileSize: 1234,
        width: 3600,
        height: 4500
      });
    } catch (err: any) {
      if (err.statusCode === 409 || err.code === "PRODUCTION_ASSET_ALREADY_EXISTS" || err.name === "MongoServerError") {
        duplicateRejected = true;
      }
    }
    check(duplicateRejected, "IMM-1.3 Application & DB immutability guard blocks overwriting approved V1 production asset");

    // ─── TEST 3: Revision Request Creates V2 Draft Without Mutating V1 Asset ──
    console.log("\n[IMM-2] Revision Request (V2 Draft Creation)");
    const layoutV2 = {
      front: { elements: [{ id: "e1", type: "TEXT" as const, x: 100, y: 100, width: 200, height: 50, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, zIndex: 1, properties: { text: "V2 REVISED TEXT", fontSize: 24, color: "#FF0000" } }] },
      back: { elements: [] },
      leftSleeve: { elements: [] },
      rightSleeve: { elements: [] }
    };

    // Customer requests revision -> currentVersion becomes 2, top-level status resets to DRAFT, approvedVersion stays 1
    design.currentVersion = 2;
    design.status = "DRAFT";
    design.design = layoutV2;
    design.versions.push({
      version: 2,
      design: layoutV2,
      createdBy: new mongoose.Types.ObjectId(TEST_USER_ID),
      createdAt: new Date(),
      status: "DRAFT",
      previewUrls: [],
      artworkUrls: []
    });
    await design.save();

    check(design.currentVersion === 2, "IMM-2.1 Design updated to V2 currentVersion");
    check(design.approvedVersion === 1, "IMM-2.2 approvedVersion remains locked to V1 (not overwritten)");

    // Re-verify V1 asset record in DB
    const reloadedV1DbAsset = await CustomDesignAsset.findOne({ designId: design._id, version: 1, side: "FRONT", type: "PRODUCTION" });
    check(reloadedV1DbAsset?.originalUrl === originalV1AssetUrl, "IMM-2.3 V1 production asset URL remains unchanged after V2 revision");

    // Attempting to generate production assets for unapproved V2 must be blocked
    let unapprovedBlocked = false;
    try {
      productionAssetService.validateForProduction(design, 2);
    } catch (err: any) {
      if (err.statusCode === 400) unapprovedBlocked = true;
    }
    check(unapprovedBlocked, "IMM-2.4 Generating production assets for unapproved V2 draft is blocked (400 Bad Request)");

  } catch (err: any) {
    console.error("Immutability test execution error:", err);
    failures.push(`Execution error: ${err.message}`);
    failed++;
  } finally {
    if (design) await CustomDesign.deleteOne({ _id: design._id });
    if (product) await Product.deleteOne({ _id: product._id });
    await CustomDesignAsset.deleteMany({ userId: TEST_USER_ID });
    await mongoose.disconnect();
  }

  console.log("\n══════════════════════════════════════════════");
  console.log(`Print Dimensions & Immutability Results: ${passed} passed, ${failed} failed`);
  if (failures.length) failures.forEach(f => console.log("  •", f));
  console.log("══════════════════════════════════════════════");
  process.exit(failed > 0 ? 1 : 0);
}

runImmutabilityAndDimensionTests().catch(e => {
  console.error("Immutability test runner crashed:", e);
  process.exit(1);
});
