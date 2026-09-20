/**
 * Phase 6 — Performance Baseline Test Suite
 *
 * Measures response times for key operations:
 * - Pricing API (normal product, custom product)
 * - Design save (small, large design)
 * - Design load
 * - Cart load
 * - Production renderer (TEXT-only, TEXT+SHAPE multi-element)
 *
 * Records: average, p95, max across N iterations.
 * Establishes the baseline — do not optimize before measuring.
 */

import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import { PricingService } from "../services/pricingService";
import { Product } from "../models/Product";
import { CustomDesign } from "../models/CustomDesign";
import { Cart } from "../models/Cart";
import { createTestProduct } from "./testHelpers";

const ITERATIONS = 10;

let testProductId: string;
let testVariantId: string;
let testDesignId: string;
const TEST_USER_ID = new mongoose.Types.ObjectId().toString();

// ─── Timer Utilities ──────────────────────────────────────────────────────────

async function measure(label: string, fn: () => Promise<void>, n = ITERATIONS) {
  const times: number[] = [];
  for (let i = 0; i < n; i++) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const sorted = [...times].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? sorted[sorted.length - 1];
  const max = sorted[sorted.length - 1];
  console.log(`  📊 ${label}`);
  console.log(`     avg=${avg.toFixed(1)}ms  p95=${p95.toFixed(1)}ms  max=${max.toFixed(1)}ms  (n=${n})`);
  return { avg, p95, max };
}

// ─── Seed Data ────────────────────────────────────────────────────────────────

function makeLayout(numElements: number) {
  const elements = [];
  for (let i = 0; i < numElements; i++) {
    elements.push({
      id: `el${i}`,
      type: "TEXT" as const,
      x: 50 + (i % 5) * 100,
      y: 50 + Math.floor(i / 5) * 80,
      width: 200,
      height: 50,
      rotation: i * 5 % 90,
      scaleX: 1,
      scaleY: 1,
      opacity: 0.8 + (i % 3) * 0.1,
      locked: false,
      zIndex: i,
      properties: { text: `Element ${i}`, fontSize: 24, fontFamily: "Arial", color: "#000000" },
    });
  }
  return {
    front: { elements },
    back: { elements: [] },
    leftSleeve: { elements: [] },
    rightSleeve: { elements: [] },
  };
}

async function seed() {
  const { product, productId: pid, variantIds } = await createTestProduct({
    name: "Perf Test Tee",
    printMethods: ["DTF"],
  });
  testProductId = pid;
  testVariantId = variantIds[0];

  // Mock design for pricing
  const origFindById = (CustomDesign as any).findById;
  (CustomDesign as any).findById = async (id: string) => {
    if (id === "perf_design_id") {
      return {
        _id: "perf_design_id",
        getActiveLayout: () => ({
          front: { elements: [{ id: "1", type: "TEXT" }] },
          back: { elements: [] },
          leftSleeve: { elements: [] },
          rightSleeve: { elements: [] },
        }),
      };
    }
    return origFindById.call(CustomDesign, id);
  };

  // Real design for save/load tests
  const layout = makeLayout(5);
  const design = await CustomDesign.create({
    userId: new mongoose.Types.ObjectId(TEST_USER_ID),
    name: "Perf Test Design",
    productId: product._id,
    selectedVariantId: product.variants[0]._id,
    selectedColor: "BLACK",
    status: "DRAFT",
    requestType: "DESIGN",
    printLocations: ["FRONT"],
    submissionKey: `perf-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    currentVersion: 1,
    design: layout,
    versions: [{ version: 1, design: layout, createdBy: new mongoose.Types.ObjectId(TEST_USER_ID), createdAt: new Date(), status: "DRAFT", previewUrls: [], artworkUrls: [] }],
  });
  testDesignId = design._id.toString();
}

async function cleanup() {
  if (testDesignId) await CustomDesign.deleteOne({ _id: testDesignId });
  if (testProductId) await Product.deleteOne({ _id: testProductId });
  await Cart.deleteMany({ userId: TEST_USER_ID });
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function runPerfTests() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  Phase 6 — Performance Baseline                  ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  await mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/samrat_fashion");
  console.log("✅ Connected to MongoDB\n");
  await seed();

  const results: Record<string, { avg: number; p95: number; max: number }> = {};

  // PERF-1: Normal product pricing
  console.log("[PERF-1] Normal product pricing (single variant, qty=1)");
  results["pricing_normal"] = await measure("PricingService.calculateItemPricing (normal)", async () => {
    await PricingService.calculateItemPricing({
      productId: testProductId,
      variantId: testVariantId,
      quantity: 1,
      isCustomized: false,
    });
  });

  // PERF-2: Custom product pricing
  console.log("\n[PERF-2] Custom product pricing (1 config, FRONT print)");
  results["pricing_custom"] = await measure("PricingService.calculateItemPricing (custom)", async () => {
    await PricingService.calculateItemPricing({
      productId: testProductId,
      variantId: testVariantId,
      quantity: 1,
      isCustomized: true,
      customConfigurations: [{
        color: "BLACK",
        variantId: testVariantId as any,
        designId: "perf_design_id" as any,
        sizeDistribution: [{ size: "M", quantity: 5 }],
      }],
    });
  });

  // PERF-3: Design load (read from DB)
  console.log("\n[PERF-3] Design load (read from MongoDB)");
  results["design_load"] = await measure("CustomDesign.findById (5-element design)", async () => {
    await CustomDesign.findById(testDesignId);
  });

  // PERF-4: Design save (update existing)
  console.log("\n[PERF-4] Design save (update with 5 elements)");
  const layout5 = makeLayout(5);
  results["design_save_5"] = await measure("CustomDesign update (5 elements)", async () => {
    await CustomDesign.findByIdAndUpdate(testDesignId, { $set: { design: layout5 } });
  });

  // PERF-5: Large design save (50 elements)
  console.log("\n[PERF-5] Large design save (50 elements)");
  const layout50 = makeLayout(50);
  results["design_save_50"] = await measure("CustomDesign update (50 elements)", async () => {
    await CustomDesign.findByIdAndUpdate(testDesignId, { $set: { design: layout50 } });
  });

  // PERF-6: Cart load (setup a cart first)
  console.log("\n[PERF-6] Cart load (1 custom item)");
  let cart = await Cart.findOne({ userId: TEST_USER_ID });
  if (!cart) cart = new Cart({ userId: TEST_USER_ID, items: [] });
  cart.items = [];
  cart.items.push({
    productId: new mongoose.Types.ObjectId(testProductId),
    variantId: new mongoose.Types.ObjectId(testVariantId),
    quantity: 1,
    isCustomized: true,
    customConfigurations: [{
      color: "BLACK",
      variantId: new mongoose.Types.ObjectId(testVariantId),
      designId: new mongoose.Types.ObjectId(testDesignId),
      sizeDistribution: [{ size: "M", quantity: 5 }],
    }] as any,
  });
  await cart.save();

  results["cart_load"] = await measure("Cart.findOne (1 custom item)", async () => {
    await Cart.findOne({ userId: TEST_USER_ID }).populate("items.productId");
  });

  // PERF-7: Production rendering (server-side, TEXT + SHAPE)
  console.log("\n[PERF-7] Server-side PNG rendering (TEXT + RECT, FRONT side @ 300 DPI)");
  try {
    const { fabric } = require("fabric");
    const { createCanvas } = require("canvas");

    results["render_simple"] = await measure("Fabric render (TEXT+RECT → 3600×4500px PNG)", async () => {
      const outW = 3600, outH = 4500;
      const nc = createCanvas(outW, outH);
      if (!nc.getAttribute) nc.getAttribute = (a: string) => a === "dir" ? "ltr" : null;
      if (!nc.setAttribute) nc.setAttribute = () => {};
      const origCtx = nc.getContext.bind(nc);
      nc.getContext = (t: string, a?: any) => { const ctx = origCtx(t, a); if (ctx?.canvas && !ctx.canvas.getAttribute) { ctx.canvas.getAttribute = (a2: string) => a2 === "dir" ? "ltr" : null; } return ctx; };

      const c = new fabric.StaticCanvas(nc, { width: outW, height: outH, enableRetinaScaling: false });
      c.add(new fabric.Text("Production Output", { left: 50 * 4.5, top: 100 * 4.5, fontSize: 36 * 4.5, fontFamily: "Arial", fill: "#000" }));
      c.add(new fabric.Rect({ left: 200 * 4.5, top: 300 * 4.5, width: 200 * 4.5, height: 100 * 4.5, fill: "#FF5500" }));
      c.renderAll();
      nc.toBuffer("image/png");
    }, 3); // fewer iterations for render (expensive)
  } catch (e: any) {
    console.log(`  ⚠️  Renderer performance test skipped: ${e.message}`);
  }

  // Summary Report
  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║  PERFORMANCE BASELINE REPORT                                 ║");
  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log("║  Operation                           avg      p95      max   ║");
  console.log("╠══════════════════════════════════════════════════════════════╣");
  for (const [key, r] of Object.entries(results)) {
    const label = key.padEnd(36);
    const avg = r.avg.toFixed(1).padStart(6);
    const p95 = r.p95.toFixed(1).padStart(6);
    const max = r.max.toFixed(1).padStart(6);
    console.log(`║  ${label}${avg}ms  ${p95}ms  ${max}ms  ║`);
  }
  console.log("╚══════════════════════════════════════════════════════════════╝");

  console.log("\n⚠️  These are baseline measurements. Optimize only if p95 exceeds acceptable thresholds.");
  console.log("    Typical acceptable thresholds: pricing <200ms, design load/save <300ms, cart <500ms, render <10s");

  await cleanup();
  await mongoose.disconnect();
  process.exit(0);
}

runPerfTests().catch(e => {
  console.error("Performance test runner crashed:", e);
  process.exit(1);
});
