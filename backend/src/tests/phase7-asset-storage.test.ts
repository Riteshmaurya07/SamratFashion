/**
 * Phase 7 — Real Production Asset Storage Test Suite
 *
 * Verifies Requirement 1:
 * - Real PNG file generation via CanvasProductionRenderer
 * - Physical file persistence in storage
 * - CustomDesignAsset (PRODUCTION) DB record creation
 * - PNG magic bytes header validation
 * - Pixel dimension verification (3600x4500 for FRONT/BACK, 1200x1500 for Sleeves)
 * - MIME type: image/png
 * - Non-mock URL validation
 * - Admin asset query & retrieval
 */

import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import { CustomDesign } from "../models/CustomDesign";
import { CustomDesignAsset } from "../models/CustomDesignAsset";
import { ProductionAssetService } from "../services/productionAssetService";
import { CanvasProductionRenderer } from "../services/rendering/CanvasProductionRenderer";
import { createTestProduct } from "./testHelpers";
import { Product } from "../models/Product";

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

/**
 * Helper to parse PNG width, height, and color type from PNG IHDR chunk
 */
function parsePngMetadata(buffer: Buffer): { width: number; height: number; colorType: number } {
  // Check PNG signature
  if (buffer[0] !== 0x89 || buffer[1] !== 0x50 || buffer[2] !== 0x4e || buffer[3] !== 0x47) {
    throw new Error("Invalid PNG signature");
  }
  // IHDR chunk starts at byte 8 (length 4 bytes, type 4 bytes "IHDR", data starts at 16)
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const colorType = buffer.readUInt8(25); // 6 = RGBA (transparent), 2 = RGB
  return { width, height, colorType };
}

async function runAssetStorageTests() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  Phase 7 — Real Production Asset Storage Tests   ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  await mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/samrat_fashion");
  console.log("✅ Connected to MongoDB\n");

  let product: any;
  let design: any;

  try {
    const pRes = await createTestProduct({ name: "Production Storage Test Tee" });
    product = pRes.product;

    // Create a custom design with FRONT, BACK, and LEFT_SLEEVE elements
    design = await CustomDesign.create({
      userId: new mongoose.Types.ObjectId(TEST_USER_ID),
      name: "Real Asset Storage Test Design",
      productId: product._id,
      selectedVariantId: product.variants[0]._id,
      selectedColor: "BLACK",
      status: "CUSTOMER_APPROVED",
      requestType: "DESIGN",
      printLocations: ["FRONT", "BACK", "LEFT_SLEEVE"],
      submissionKey: `ast-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      currentVersion: 1,
      approvedVersion: 1,
      design: {
        front: {
          elements: [
            { id: "e1", type: "TEXT", x: 100, y: 150, width: 300, height: 80, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, zIndex: 1, properties: { text: "FRONT REAL ASSET", fontSize: 36, color: "#FF0000" } }
          ]
        },
        back: {
          elements: [
            { id: "e2", type: "SHAPE", x: 200, y: 200, width: 200, height: 200, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, zIndex: 1, properties: { shapeType: "rectangle", fillColor: "#00FF00" } }
          ]
        },
        leftSleeve: {
          elements: [
            { id: "e3", type: "TEXT", x: 50, y: 50, width: 200, height: 50, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, zIndex: 1, properties: { text: "SLEEVE LOGO", fontSize: 24, color: "#0000FF" } }
          ]
        },
        rightSleeve: { elements: [] }
      },
      versions: [
        {
          version: 1,
          design: {
            front: {
              elements: [
                { id: "e1", type: "TEXT", x: 100, y: 150, width: 300, height: 80, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, zIndex: 1, properties: { text: "FRONT REAL ASSET", fontSize: 36, color: "#FF0000" } }
              ]
            },
            back: {
              elements: [
                { id: "e2", type: "SHAPE", x: 200, y: 200, width: 200, height: 200, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, zIndex: 1, properties: { shapeType: "rectangle", fillColor: "#00FF00" } }
              ]
            },
            leftSleeve: {
              elements: [
                { id: "e3", type: "TEXT", x: 50, y: 50, width: 200, height: 50, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, zIndex: 1, properties: { text: "SLEEVE LOGO", fontSize: 24, color: "#0000FF" } }
              ]
            },
            rightSleeve: { elements: [] }
          },
          createdBy: new mongoose.Types.ObjectId(TEST_USER_ID),
          createdAt: new Date(),
          status: "CUSTOMER_APPROVED",
          previewUrls: [],
          artworkUrls: []
        }
      ]
    });

    // ─── TEST 1: Asset Generation ─────────────────────────────────────────────
    console.log("[AST-1] Generate Production Assets for Approved Version 1");
    const results = await productionAssetService.generateProductionAssets(design, 1);
    check(results.length === 3, "AST-1.1 Generated exactly 3 asset results (FRONT, BACK, LEFT_SLEEVE)", `count=${results.length}`);

    // ─── TEST 2: Database Record Registration ──────────────────────────────────
    console.log("\n[AST-2] Verify CustomDesignAsset Records in Database");
    const dbAssets = await CustomDesignAsset.find({ designId: design._id, version: 1, type: "PRODUCTION" });
    check(dbAssets.length === 3, "AST-2.1 DB contains 3 CustomDesignAsset records for V1", `count=${dbAssets.length}`);

    // ─── TEST 3: File Storage & PNG Properties Inspection ──────────────────────
    console.log("\n[AST-3] Inspect Physical Saved PNG Files");
    for (const res of results) {
      console.log(`\n  --- Inspecting Side: ${res.side} ---`);
      check(res.mimeType === "image/png", `AST-3.${res.side}.1 MIME type is image/png`, `mime=${res.mimeType}`);
      check(res.fileSize > 5000, `AST-3.${res.side}.2 File size > 5 KB (real rendered graphic)`, `size=${res.fileSize} bytes`);
      check(!res.url.includes("mock") && !res.url.includes("placeholder"), `AST-3.${res.side}.3 URL is NOT a fake/mock URL`, `url=${res.url}`);

      // Map HTTP URL to local file path
      const urlPath = new URL(res.url).pathname; // e.g. /uploads/samrat-fashion/...
      const diskPath = path.resolve(__dirname, "../../", urlPath.replace(/^\//, ""));

      check(fs.existsSync(diskPath), `AST-3.${res.side}.4 Physical file exists on disk`, `path=${diskPath}`);

      if (fs.existsSync(diskPath)) {
        const buf = fs.readFileSync(diskPath);
        const meta = parsePngMetadata(buf);

        if (res.side === "FRONT" || res.side === "BACK") {
          check(meta.width === 3600 && meta.height === 4500, `AST-3.${res.side}.5 Dimensions match 3600×4500 (12"×15" @ 300 DPI)`, `parsed=${meta.width}x${meta.height}`);
        } else if (res.side === "LEFT_SLEEVE") {
          check(meta.width === 1200 && meta.height === 1500, `AST-3.${res.side}.5 Dimensions match 1200×1500 (4"×5" @ 300 DPI)`, `parsed=${meta.width}x${meta.height}`);
        }

        // Color type 6 = RGBA (supports alpha/transparency), 2 = RGB
        check(meta.colorType === 6 || meta.colorType === 2, `AST-3.${res.side}.6 Valid PNG color mode`, `colorType=${meta.colorType}`);
      }
    }

    // ─── TEST 4: Admin Retrieval & Immutability Check ──────────────────────────
    console.log("\n[AST-4] Admin Asset Download & Retrieval Verification");
    const frontAsset = dbAssets.find(a => a.side === "FRONT");
    check(frontAsset?.version === 1, "AST-4.1 Front asset version matches target version 1", `version=${frontAsset?.version}`);
    check(frontAsset?.type === "PRODUCTION", "AST-4.2 Asset type is PRODUCTION", `type=${frontAsset?.type}`);
    check(Boolean(frontAsset?.originalUrl), "AST-4.3 Original URL present", `url=${frontAsset?.originalUrl}`);

  } catch (err: any) {
    console.error("Test execution failed:", err);
    failures.push(`Execution error: ${err.message}`);
    failed++;
  } finally {
    if (design) await CustomDesign.deleteOne({ _id: design._id });
    if (product) await Product.deleteOne({ _id: product._id });
    await CustomDesignAsset.deleteMany({ userId: TEST_USER_ID });
    await mongoose.disconnect();
  }

  console.log("\n══════════════════════════════════════════════");
  console.log(`Asset Storage Results: ${passed} passed, ${failed} failed`);
  if (failures.length) failures.forEach(f => console.log("  •", f));
  console.log("══════════════════════════════════════════════");
  process.exit(failed > 0 ? 1 : 0);
}

runAssetStorageTests().catch(e => {
  console.error("Asset storage test runner crashed:", e);
  process.exit(1);
});
