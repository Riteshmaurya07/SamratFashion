/**
 * Phase 6 — Printable-Zone Edge Case Test Suite
 *
 * Tests the validatePrintableZones() server-side bounding-box logic.
 * Covers: inside zone, partially outside, rotated crossing, scaled crossing,
 * between two zones, inside second zone.
 */

import dotenv from "dotenv";
dotenv.config();

let passed = 0;
let failed = 0;
const failures: string[] = [];

function pass(name: string) { console.log(`  ✅ PASS: ${name}`); passed++; }
function fail(name: string, reason: string) {
  console.error(`  ❌ FAIL: ${name} — ${reason}`);
  failed++; failures.push(`${name}: ${reason}`);
}

// ─── Exact copy of validatePrintableZones from customDesignController ─────────

function validatePrintableZones(design: any, product: any): void {
  const sides = ["front", "back", "leftSleeve", "rightSleeve"];

  for (const side of sides) {
    const elements = design[side]?.elements || [];
    if (elements.length === 0) continue;

    const zones = product.printableZones?.[side] || [];
    if (zones.length === 0 && elements.length > 0) {
      throw new Error(`Product does not support printing on ${side}`);
    }

    for (const el of elements) {
      const w = el.width * (el.scaleX || 1);
      const h = el.height * (el.scaleY || 1);
      const rad = ((el.rotation || 0) * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);

      const corners = [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: 0, y: h },
        { x: w, y: h },
      ].map((p) => ({
        x: el.x + p.x * cos - p.y * sin,
        y: el.y + p.x * sin + p.y * cos,
      }));

      const minX = Math.min(...corners.map((c) => c.x));
      const maxX = Math.max(...corners.map((c) => c.x));
      const minY = Math.min(...corners.map((c) => c.y));
      const maxY = Math.max(...corners.map((c) => c.y));

      let fitsInAtLeastOneZone = false;
      for (const zone of zones) {
        const zMinX = zone.x;
        const zMaxX = zone.x + zone.width;
        const zMinY = zone.y;
        const zMaxY = zone.y + zone.height;

        if (minX >= zMinX && maxX <= zMaxX && minY >= zMinY && maxY <= zMaxY) {
          fitsInAtLeastOneZone = true;
          break;
        }
      }

      if (!fitsInAtLeastOneZone) {
        throw new Error(`Element on ${side} falls outside valid printable zones.`);
      }
    }
  }
}

function shouldAccept(design: any, product: any, name: string) {
  try {
    validatePrintableZones(design, product);
    pass(name);
  } catch (e: any) {
    fail(name, `Validation rejected valid design: ${e.message}`);
  }
}

function shouldReject(design: any, product: any, name: string) {
  try {
    validatePrintableZones(design, product);
    fail(name, "Validation accepted invalid design (should have rejected)");
  } catch {
    pass(name);
  }
}

// ─── Test Product with two separate printable zones on FRONT ─────────────────
// Zone A: x=50, y=100, w=300, h=350 (chest area)
// Zone B: x=50, y=600, w=200, h=100 (bottom area)

const mockProduct = {
  printableZones: {
    front: [
      { x: 50, y: 100, width: 300, height: 350 },  // Zone A (chest)
      { x: 50, y: 600, width: 200, height: 100 },  // Zone B (bottom)
    ],
    back: [
      { x: 100, y: 100, width: 250, height: 400 },
    ],
    leftSleeve: [],
    rightSleeve: [],
  },
};

function makeEl(overrides: Partial<{
  x: number; y: number; width: number; height: number;
  rotation: number; scaleX: number; scaleY: number;
}>): any {
  return { x: 100, y: 150, width: 100, height: 80, rotation: 0, scaleX: 1, scaleY: 1, ...overrides };
}

async function runPrintZoneTests() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  Phase 6 — Printable-Zone Test Suite             ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  // PZ-1: Element completely inside Zone A
  console.log("\n[PZ-1] Element fully inside printable zone");
  shouldAccept(
    { front: { elements: [makeEl({ x: 100, y: 150, width: 100, height: 80 })] } },
    mockProduct,
    "PZ-1.1 Element fully inside Zone A accepted"
  );

  // PZ-2: Element partially outside Zone A (right edge crosses boundary)
  console.log("\n[PZ-2] Element partially outside zone");
  // Zone A ends at x=350. Element at x=300, width=100 → maxX=400 > 350
  shouldReject(
    { front: { elements: [makeEl({ x: 300, y: 150, width: 100, height: 80 })] } },
    mockProduct,
    "PZ-2.1 Element partially outside Zone A (right edge) rejected"
  );

  // PZ-3: Rotated element crossing boundary
  console.log("\n[PZ-3] Rotated element crossing boundary");
  // A 200×50 element rotated 45° at x=300, y=400 — bounding box will exceed zone A
  shouldReject(
    { front: { elements: [makeEl({ x: 300, y: 380, width: 200, height: 50, rotation: 45 })] } },
    mockProduct,
    "PZ-3.1 45°-rotated element crossing zone boundary rejected"
  );

  // PZ-3b: Rotated element fully inside zone A
  // Zone A: x=50..350, y=100..450. Small 50×30 element at x=150, y=200, rot=30 fits.
  shouldAccept(
    { front: { elements: [makeEl({ x: 150, y: 200, width: 50, height: 30, rotation: 30 })] } },
    mockProduct,
    "PZ-3.2 Small rotated element fully inside Zone A accepted"
  );

  // PZ-4: Scaled element crossing boundary
  console.log("\n[PZ-4] Scaled element crossing boundary");
  // 100×50 at x=250, y=150, scaleX=2 → effective w=200, right edge=450 > 350 (zone A max)
  shouldReject(
    { front: { elements: [makeEl({ x: 250, y: 150, width: 100, height: 50, scaleX: 2 })] } },
    mockProduct,
    "PZ-4.1 Scaled element (scaleX=2) crossing Zone A boundary rejected"
  );

  // PZ-5: Element between two zones (fits in neither)
  console.log("\n[PZ-5] Element between two zones (fits neither)");
  // Between Zone A (ends y=450) and Zone B (starts y=600). Element at y=500.
  shouldReject(
    { front: { elements: [makeEl({ x: 80, y: 500, width: 100, height: 50 })] } },
    mockProduct,
    "PZ-5.1 Element in gap between zones rejected (fits neither zone)"
  );

  // PZ-6: Element inside Zone B (second valid zone)
  console.log("\n[PZ-6] Element inside second zone");
  // Zone B: x=50..250, y=600..700. Element at x=60, y=610, w=100, h=50.
  shouldAccept(
    { front: { elements: [makeEl({ x: 60, y: 610, width: 100, height: 50 })] } },
    mockProduct,
    "PZ-6.1 Element fully inside Zone B (second valid zone) accepted"
  );

  // PZ-7: Side with no zones defined + element present = rejected
  console.log("\n[PZ-7] Side with no printable zones defined");
  shouldReject(
    { leftSleeve: { elements: [makeEl({ x: 10, y: 10, width: 50, height: 50 })] } },
    mockProduct,
    "PZ-7.1 Element on leftSleeve rejected when no zones defined for that side"
  );

  // PZ-8: Back zone validation
  console.log("\n[PZ-8] Back zone validation");
  // Back zone: x=100..350, y=100..500
  shouldAccept(
    { back: { elements: [makeEl({ x: 150, y: 200, width: 100, height: 100 })] } },
    mockProduct,
    "PZ-8.1 Element inside back zone accepted"
  );
  shouldReject(
    { back: { elements: [makeEl({ x: 50, y: 200, width: 100, height: 100 })] } },
    mockProduct,
    "PZ-8.2 Element partially outside back zone rejected (left edge)"
  );

  // PZ-9: Empty design is always accepted (no elements = no validation needed)
  console.log("\n[PZ-9] Empty side skipped");
  shouldAccept(
    { front: { elements: [] } },
    mockProduct,
    "PZ-9.1 Empty side with no elements skipped (accepted)"
  );

  console.log("\n══════════════════════════════════════════════");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failures.length) failures.forEach((f) => console.log("  •", f));
  console.log("══════════════════════════════════════════════");
  process.exit(failed > 0 ? 1 : 0);
}

runPrintZoneTests().catch((e) => {
  console.error("Printzone test runner crashed:", e);
  process.exit(1);
});
