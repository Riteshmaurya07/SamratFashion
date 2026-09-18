/**
 * Phase 7 — Production Environment Renderer Load Benchmark
 *
 * Verifies Requirement 4:
 * - Single-side render time & memory footprint (heapUsed / heapTotal / rss)
 * - Concurrent multi-side rendering (FRONT + BACK + SLEEVES in parallel)
 * - Large multi-element design handling (50+ elements per side)
 * - Multiple simultaneous custom order asset generations (3 concurrent designs)
 * - Memory leak analysis (verifying memory returns to baseline after GC)
 */

import mongoose from "mongoose";
import { CustomDesign } from "../models/CustomDesign";
import { Product } from "../models/Product";
import { ProductionAssetService } from "../services/productionAssetService";
import { CanvasProductionRenderer } from "../services/rendering/CanvasProductionRenderer";
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

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getMemorySnapshot() {
  const mem = process.memoryUsage();
  return {
    heapUsed: mem.heapUsed,
    heapTotal: mem.heapTotal,
    rss: mem.rss,
  };
}

function generateComplexSideLayout(numElements: number) {
  const elements = [];
  for (let i = 0; i < numElements; i++) {
    if (i % 2 === 0) {
      elements.push({
        id: `el-${i}`,
        type: "TEXT" as const,
        x: 50 + (i * 15) % 600,
        y: 50 + (i * 20) % 800,
        width: 250,
        height: 60,
        rotation: (i * 15) % 360,
        scaleX: 1,
        scaleY: 1,
        opacity: 0.9,
        zIndex: i,
        properties: { text: `Benchmark Text Layer ${i}`, fontSize: 28, color: i % 4 === 0 ? "#FF0000" : "#0055FF" }
      });
    } else {
      elements.push({
        id: `el-${i}`,
        type: "SHAPE" as const,
        x: 100 + (i * 25) % 600,
        y: 100 + (i * 15) % 800,
        width: 150,
        height: 150,
        rotation: (i * 30) % 360,
        scaleX: 1,
        scaleY: 1,
        opacity: 0.8,
        zIndex: i,
        properties: { shapeType: i % 3 === 0 ? "circle" : "rectangle", fillColor: "#00FF88" }
      });
    }
  }
  return { elements };
}

async function runLoadBenchmarkTests() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  Phase 7 — Production Environment Benchmark     ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  await mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/samrat_fashion");
  console.log("✅ Connected to MongoDB\n");

  let product: any;
  const createdDesignIds: string[] = [];

  try {
    const pRes = await createTestProduct({ name: "Load Benchmark Tee" });
    product = pRes.product;

    const initialMem = getMemorySnapshot();
    console.log(`Initial Process Memory Baseline: HeapUsed=${formatMb(initialMem.heapUsed)}, RSS=${formatMb(initialMem.rss)}`);

    // ─── TEST 1: Single Side High-DPI Render Performance ────────────────────
    console.log("\n[LOAD-1] Single Side High-DPI Render Performance (3600×4500px @ 300 DPI)");
    const design1 = await CustomDesign.create({
      userId: new mongoose.Types.ObjectId(TEST_USER_ID),
      name: "Load Test Design 1",
      productId: product._id,
      selectedVariantId: product.variants[0]._id,
      selectedColor: "BLACK",
      status: "CUSTOMER_APPROVED",
      requestType: "DESIGN",
      printLocations: ["FRONT"],
      submissionKey: `bench-1-${Date.now()}`,
      currentVersion: 1,
      approvedVersion: 1,
      design: {
        front: generateComplexSideLayout(10),
        back: { elements: [] },
        leftSleeve: { elements: [] },
        rightSleeve: { elements: [] }
      },
      versions: [{ version: 1, design: { front: generateComplexSideLayout(10), back: { elements: [] }, leftSleeve: { elements: [] }, rightSleeve: { elements: [] } }, createdBy: new mongoose.Types.ObjectId(TEST_USER_ID), createdAt: new Date(), status: "CUSTOMER_APPROVED", previewUrls: [], artworkUrls: [] }]
    });
    createdDesignIds.push(design1._id.toString());

    const start1 = Date.now();
    const results1 = await productionAssetService.generateProductionAssets(design1, 1);
    const duration1 = Date.now() - start1;
    const mem1 = getMemorySnapshot();

    check(results1.length === 1, "LOAD-1.1 Single side FRONT asset rendered successfully");
    check(duration1 < 5000, `LOAD-1.2 Render duration (${duration1}ms) is < 5.0 seconds`, `duration=${duration1}ms`);
    console.log(`  📊 Single side render: time=${duration1}ms, HeapUsed=${formatMb(mem1.heapUsed)}, RSS=${formatMb(mem1.rss)}`);

    // ─── TEST 2: Concurrent Multi-Side Rendering ──────────────────────────────
    console.log("\n[LOAD-2] Concurrent 3-Side Asset Generation (FRONT + BACK + SLEEVE)");
    const design2 = await CustomDesign.create({
      userId: new mongoose.Types.ObjectId(TEST_USER_ID),
      name: "Load Test Design 2",
      productId: product._id,
      selectedVariantId: product.variants[0]._id,
      selectedColor: "WHITE",
      status: "CUSTOMER_APPROVED",
      requestType: "DESIGN",
      printLocations: ["FRONT", "BACK", "LEFT_SLEEVE"],
      submissionKey: `bench-2-${Date.now()}`,
      currentVersion: 1,
      approvedVersion: 1,
      design: {
        front: generateComplexSideLayout(15),
        back: generateComplexSideLayout(10),
        leftSleeve: generateComplexSideLayout(5),
        rightSleeve: { elements: [] }
      },
      versions: [{ version: 1, design: { front: generateComplexSideLayout(15), back: generateComplexSideLayout(10), leftSleeve: generateComplexSideLayout(5), rightSleeve: { elements: [] } }, createdBy: new mongoose.Types.ObjectId(TEST_USER_ID), createdAt: new Date(), status: "CUSTOMER_APPROVED", previewUrls: [], artworkUrls: [] }]
    });
    createdDesignIds.push(design2._id.toString());

    const start2 = Date.now();
    const results2 = await productionAssetService.generateProductionAssets(design2, 1);
    const duration2 = Date.now() - start2;
    const mem2 = getMemorySnapshot();

    check(results2.length === 3, "LOAD-2.1 All 3 sides rendered and stored in single pass");
    check(duration2 < 10000, `LOAD-2.2 3-side render duration (${duration2}ms) is < 10.0 seconds`, `duration=${duration2}ms`);
    console.log(`  📊 3-side render: time=${duration2}ms, HeapUsed=${formatMb(mem2.heapUsed)}, RSS=${formatMb(mem2.rss)}`);

    // ─── TEST 3: Heavy Multi-Element Design (50 Elements) ─────────────────────
    console.log("\n[LOAD-3] Large Image & 50-Element High Density Design");
    const design3 = await CustomDesign.create({
      userId: new mongoose.Types.ObjectId(TEST_USER_ID),
      name: "Load Test Design 3 (Heavy)",
      productId: product._id,
      selectedVariantId: product.variants[0]._id,
      selectedColor: "NAVY",
      status: "CUSTOMER_APPROVED",
      requestType: "DESIGN",
      printLocations: ["FRONT"],
      submissionKey: `bench-3-${Date.now()}`,
      currentVersion: 1,
      approvedVersion: 1,
      design: {
        front: generateComplexSideLayout(50),
        back: { elements: [] },
        leftSleeve: { elements: [] },
        rightSleeve: { elements: [] }
      },
      versions: [{ version: 1, design: { front: generateComplexSideLayout(50), back: { elements: [] }, leftSleeve: { elements: [] }, rightSleeve: { elements: [] } }, createdBy: new mongoose.Types.ObjectId(TEST_USER_ID), createdAt: new Date(), status: "CUSTOMER_APPROVED", previewUrls: [], artworkUrls: [] }]
    });
    createdDesignIds.push(design3._id.toString());

    const start3 = Date.now();
    const results3 = await productionAssetService.generateProductionAssets(design3, 1);
    const duration3 = Date.now() - start3;
    const mem3 = getMemorySnapshot();

    check(results3.length === 1, "LOAD-3.1 50-element design rendered successfully without crash");
    check(duration3 < 8000, `LOAD-3.2 50-element render duration (${duration3}ms) is < 8.0 seconds`, `duration=${duration3}ms`);
    console.log(`  📊 Heavy 50-element render: time=${duration3}ms, HeapUsed=${formatMb(mem3.heapUsed)}, RSS=${formatMb(mem3.rss)}`);

    // ─── TEST 4: Parallel Multi-Order Simultaneous Asset Generation ───────────
    console.log("\n[LOAD-4] Multiple Simultaneous Custom Orders (3 Concurrent Pipeline Runs)");
    const parallelDesigns = await Promise.all([1, 2, 3].map(i =>
      CustomDesign.create({
        userId: new mongoose.Types.ObjectId(TEST_USER_ID),
        name: "Parallel Order Design " + i,
        productId: product._id,
        selectedVariantId: product.variants[0]._id,
        selectedColor: "BLACK",
        status: "CUSTOMER_APPROVED",
        requestType: "DESIGN",
        printLocations: ["FRONT"],
        submissionKey: `bench-par-${i}-${Date.now()}`,
        currentVersion: 1,
        approvedVersion: 1,
        design: { front: generateComplexSideLayout(10), back: { elements: [] }, leftSleeve: { elements: [] }, rightSleeve: { elements: [] } },
        versions: [{ version: 1, design: { front: generateComplexSideLayout(10), back: { elements: [] }, leftSleeve: { elements: [] }, rightSleeve: { elements: [] } }, createdBy: new mongoose.Types.ObjectId(TEST_USER_ID), createdAt: new Date(), status: "CUSTOMER_APPROVED", previewUrls: [], artworkUrls: [] }]
      })
    ));

    parallelDesigns.forEach(d => createdDesignIds.push(d._id.toString()));

    const start4 = Date.now();
    const parallelResults = await Promise.all(
      parallelDesigns.map(d => productionAssetService.generateProductionAssets(d, 1))
    );
    const duration4 = Date.now() - start4;
    const mem4 = getMemorySnapshot();

    check(parallelResults.length === 3, "LOAD-4.1 3 parallel order renderings completed");
    check(parallelResults.every(r => r.length === 1), "LOAD-4.2 All parallel jobs returned rendered assets");
    check(duration4 < 15000, `LOAD-4.3 3 concurrent orders completed in ${duration4}ms (< 15.0s)`, `duration=${duration4}ms`);
    console.log(`  📊 3 concurrent order render: totalTime=${duration4}ms, HeapUsed=${formatMb(mem4.heapUsed)}, RSS=${formatMb(mem4.rss)}`);

    // ─── TEST 5: Memory Leak & Footprint Check ─────────────────────────────────
    console.log("\n[LOAD-5] Process Memory Footprint & Stability Audit");
    if (global.gc) {
      global.gc();
    }
    const finalMem = getMemorySnapshot();
    const heapDiffMb = (finalMem.heapUsed - initialMem.heapUsed) / (1024 * 1024);
    check(heapDiffMb < 150, `LOAD-5.1 Heap growth after rendering (${heapDiffMb.toFixed(2)} MB) is < 150 MB (no severe memory leak)`, `heapDiff=${heapDiffMb.toFixed(2)}MB`);
    console.log(`  📊 Final Memory Snapshot: HeapUsed=${formatMb(finalMem.heapUsed)}, RSS=${formatMb(finalMem.rss)}`);

  } catch (err: any) {
    console.error("Load benchmark execution error:", err);
    failures.push(`Execution error: ${err.message}`);
    failed++;
  } finally {
    if (product) await Product.deleteOne({ _id: product._id });
    if (createdDesignIds.length) await CustomDesign.deleteMany({ _id: { $in: createdDesignIds } });
    await mongoose.disconnect();
  }

  console.log("\n══════════════════════════════════════════════");
  console.log(`Load & Benchmark Results: ${passed} passed, ${failed} failed`);
  if (failures.length) failures.forEach(f => console.log("  •", f));
  console.log("══════════════════════════════════════════════");
  process.exit(failed > 0 ? 1 : 0);
}

runLoadBenchmarkTests().catch(e => {
  console.error("Load benchmark test runner crashed:", e);
  process.exit(1);
});
