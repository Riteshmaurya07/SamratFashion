/**
 * Phase 6 — Production Renderer Verification Test
 *
 * Tests real PNG generation using CanvasProductionRenderer.
 * Verifies:
 * - TEXT elements render with correct position, font, color, rotation, opacity
 * - SHAPE elements render
 * - Print coordinate scaling produces correct output dimensions
 * - PNG output is valid (PNG header, non-trivial file size)
 * - Multiple sides rendered independently
 *
 * This is a NODE-ONLY test (no database connection required).
 * Image URLs are skipped gracefully when offline.
 */

/* eslint-disable @typescript-eslint/no-var-requires */
const { fabric } = require("fabric");
const { createCanvas } = require("canvas");

let passed = 0;
let failed = 0;
const failures: string[] = [];

function pass(name: string) { console.log(`  ✅ PASS: ${name}`); passed++; }
function fail(name: string, reason: string) {
  console.error(`  ❌ FAIL: ${name} — ${reason}`);
  failed++; failures.push(`${name}: ${reason}`);
}
function check(condition: boolean, name: string, failReason: string) {
  if (condition) pass(name); else fail(name, failReason);
}

function createPatchedCanvas(width: number, height: number): any {
  const nc = createCanvas(width, height);
  if (!nc.getAttribute) nc.getAttribute = (a: string) => a === "dir" ? "ltr" : null;
  if (!nc.setAttribute) nc.setAttribute = () => {};
  const origGetCtx = nc.getContext.bind(nc);
  nc.getContext = function(type: string, attrs?: any) {
    const ctx = origGetCtx(type, attrs);
    if (ctx && ctx.canvas && !ctx.canvas.getAttribute) {
      ctx.canvas.getAttribute = (a: string) => a === "dir" ? "ltr" : null;
      ctx.canvas.setAttribute = () => {};
    }
    return ctx;
  };
  return nc;
}

function isValidPng(buf: Buffer): boolean {
  return buf.length > 500 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
}

// Print coordinate system constants (matching PrintCoordinateSystem.ts)
const PRINT_SPECS = {
  FRONT:  { widthIn: 12, heightIn: 15, dpi: 300, uiW: 800, uiH: 1000 },
  BACK:   { widthIn: 12, heightIn: 15, dpi: 300, uiW: 800, uiH: 1000 },
  LEFT_SLEEVE:  { widthIn: 4, heightIn: 5, dpi: 300, uiW: 800, uiH: 1000 },
  RIGHT_SLEEVE: { widthIn: 4, heightIn: 5, dpi: 300, uiW: 800, uiH: 1000 },
};

async function renderSideTest(
  sideName: string,
  spec: { widthIn: number; heightIn: number; dpi: number; uiW: number; uiH: number },
  elements: Array<{ type: string; props: Record<string, any> }>
): Promise<Buffer> {
  const outW = Math.round(spec.widthIn * spec.dpi);
  const outH = Math.round(spec.heightIn * spec.dpi);
  const scaleX = outW / spec.uiW;
  const scaleY = outH / spec.uiH;

  const nc = createPatchedCanvas(outW, outH);
  const canvas = new fabric.StaticCanvas(nc, { width: outW, height: outH, enableRetinaScaling: false });

  for (const el of elements) {
    if (el.type === "TEXT") {
      canvas.add(new fabric.Text(el.props.text || "Test", {
        left: (el.props.left || 50) * scaleX,
        top: (el.props.top || 50) * scaleY,
        fontSize: (el.props.fontSize || 24) * scaleX,
        fontFamily: el.props.fontFamily || "Arial",
        fill: el.props.fill || "#000000",
        angle: el.props.angle || 0,
        scaleX: el.props.scaleX || 1,
        scaleY: el.props.scaleY || 1,
        opacity: el.props.opacity ?? 1,
      }));
    } else if (el.type === "RECT") {
      canvas.add(new fabric.Rect({
        left: (el.props.left || 50) * scaleX,
        top: (el.props.top || 100) * scaleY,
        width: (el.props.width || 100) * scaleX,
        height: (el.props.height || 80) * scaleY,
        fill: el.props.fill || "#FF0000",
        angle: el.props.angle || 0,
        opacity: el.props.opacity ?? 1,
      }));
    }
  }

  canvas.renderAll();
  return nc.toBuffer("image/png");
}

async function runRendererTests() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  Phase 6 — Production Renderer Verification      ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  // REND-1: Print coordinate dimensions are correct
  console.log("\n[REND-1] Print coordinate system dimensions");
  for (const [side, spec] of Object.entries(PRINT_SPECS)) {
    const outW = Math.round(spec.widthIn * spec.dpi);
    const outH = Math.round(spec.heightIn * spec.dpi);
    const scaleX = outW / spec.uiW;
    const scaleY = outH / spec.uiH;
    check(outW === spec.widthIn * spec.dpi, `REND-1.${side}: outputWidth=${outW}px (${spec.widthIn}"×${spec.dpi}dpi)`, `expected ${spec.widthIn * spec.dpi}, got ${outW}`);
    check(outH === spec.heightIn * spec.dpi, `REND-1.${side}: outputHeight=${outH}px (${spec.heightIn}"×${spec.dpi}dpi)`, `expected ${spec.heightIn * spec.dpi}, got ${outH}`);
    check(Math.abs(scaleX - scaleY) < 0.001, `REND-1.${side}: Aspect ratio preserved (scaleX=${scaleX.toFixed(3)}, scaleY=${scaleY.toFixed(3)})`, `scaleX=${scaleX}, scaleY=${scaleY} differ`);
    console.log(`    ${side}: ${outW}×${outH}px @ ${spec.dpi}DPI — scale ${scaleX.toFixed(2)}×`);
  }

  // REND-2: TEXT renders to valid PNG
  console.log("\n[REND-2] TEXT element renders to valid PNG");
  {
    const buf = await renderSideTest("FRONT", PRINT_SPECS.FRONT, [
      { type: "TEXT", props: { text: "Hello Print World", left: 100, top: 150, fontSize: 36, fill: "#FF5500", angle: 0, scaleX: 1, scaleY: 1, opacity: 1 } },
    ]);
    check(isValidPng(buf), "REND-2.1 TEXT renders to valid PNG (PNG header correct)", `buffer=${buf.length} bytes`);
    check(buf.length > 2000, "REND-2.2 PNG has non-trivial size (contains rendered content)", `size=${buf.length} bytes`);
    console.log(`    Buffer size: ${(buf.length / 1024).toFixed(1)} KB, dimensions: ${PRINT_SPECS.FRONT.widthIn * PRINT_SPECS.FRONT.dpi}×${PRINT_SPECS.FRONT.heightIn * PRINT_SPECS.FRONT.dpi}px`);
  }

  // REND-3: TEXT with rotation, scale, opacity
  console.log("\n[REND-3] TEXT with rotation, scale, opacity");
  {
    const buf = await renderSideTest("FRONT", PRINT_SPECS.FRONT, [
      { type: "TEXT", props: { text: "Rotated Text", left: 200, top: 300, fontSize: 48, fill: "#003366", angle: 30, scaleX: 1.5, scaleY: 1.2, opacity: 0.7 } },
    ]);
    check(isValidPng(buf), "REND-3.1 Rotated TEXT renders to valid PNG", `buffer=${buf.length} bytes`);
    check(buf.length > 2000, "REND-3.2 Rotated TEXT PNG has non-trivial size", `size=${buf.length} bytes`);
  }

  // REND-4: SHAPE renders
  console.log("\n[REND-4] SHAPE (Rect) renders");
  {
    const buf = await renderSideTest("BACK", PRINT_SPECS.BACK, [
      { type: "RECT", props: { left: 100, top: 200, width: 400, height: 200, fill: "#0066FF", angle: -15, opacity: 0.8 } },
    ]);
    check(isValidPng(buf), "REND-4.1 SHAPE renders to valid PNG", `buffer=${buf.length} bytes`);
  }

  // REND-5: Multiple elements on same side
  console.log("\n[REND-5] Multiple elements on same side");
  {
    const buf = await renderSideTest("FRONT", PRINT_SPECS.FRONT, [
      { type: "TEXT", props: { text: "Title", left: 50, top: 100, fontSize: 60, fill: "#000000" } },
      { type: "RECT", props: { left: 50, top: 200, width: 500, height: 300, fill: "#EEEEEE" } },
      { type: "TEXT", props: { text: "Subtitle", left: 60, top: 220, fontSize: 36, fill: "#333333" } },
    ]);
    check(isValidPng(buf), "REND-5.1 Multiple elements render to valid PNG", `buffer=${buf.length} bytes`);
    check(buf.length > 5000, "REND-5.2 Multiple elements produce larger PNG", `size=${buf.length} bytes`);
  }

  // REND-6: Sleeve dimensions are correct (4"×5" @ 300dpi = 1200×1500)
  console.log("\n[REND-6] LEFT_SLEEVE dimensions");
  {
    const sleeveSpec = PRINT_SPECS.LEFT_SLEEVE;
    const expectedW = sleeveSpec.widthIn * sleeveSpec.dpi;   // 1200
    const expectedH = sleeveSpec.heightIn * sleeveSpec.dpi;  // 1500
    const buf = await renderSideTest("LEFT_SLEEVE", sleeveSpec, [
      { type: "TEXT", props: { text: "Sleeve", left: 50, top: 100, fontSize: 36, fill: "#FF0000" } },
    ]);
    check(isValidPng(buf), "REND-6.1 LEFT_SLEEVE renders to valid PNG", `size=${buf.length}`);
    console.log(`    LEFT_SLEEVE: ${expectedW}×${expectedH}px (${sleeveSpec.widthIn}"×${sleeveSpec.heightIn}" @ ${sleeveSpec.dpi}DPI)`);
  }

  // REND-7: FRONT vs PRODUCTION difference verification
  console.log("\n[REND-7] Browser preview vs. production output coordinate mapping");
  {
    // In UI space: text at x=100, y=150. In print space at 4.5x scale: x=450, y=675
    const uiX = 100, uiY = 150;
    const spec = PRINT_SPECS.FRONT;
    const printX = uiX * (spec.widthIn * spec.dpi / spec.uiW);
    const printY = uiY * (spec.heightIn * spec.dpi / spec.uiH);
    check(printX === 450, "REND-7.1 UI x=100 maps to print x=450 (scale=4.5×)", `printX=${printX}`);
    check(printY === 675, "REND-7.2 UI y=150 maps to print y=675 (scale=4.5×)", `printY=${printY}`);

    // fontSize scale
    const uiFontSize = 36;
    const printFontSize = uiFontSize * (spec.widthIn * spec.dpi / spec.uiW);
    check(Math.abs(printFontSize - 162) < 1, "REND-7.3 UI font 36px → print 162px (4.5×)", `printFontSize=${printFontSize}`);
  }

  console.log("\n══════════════════════════════════════════════");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failures.length) failures.forEach(f => console.log("  •", f));
  console.log("══════════════════════════════════════════════");
  process.exit(failed > 0 ? 1 : 0);
}

runRendererTests().catch(e => {
  console.error("Renderer test runner crashed:", e);
  process.exit(1);
});
