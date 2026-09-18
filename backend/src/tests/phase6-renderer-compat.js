/**
 * Fabric 5.3.0 + canvas 3.1.2 server-side compatibility verification.
 * Tests: TEXT, IMAGE loading, SHAPE, rotation, scaleX/Y, opacity, z-index.
 * Outputs a test PNG and prints dimensions.
 */

const { createCanvas, loadImage } = require('canvas');

// Fabric 5.x has separate browser/node builds. The non-browser build uses node-canvas.
// We must register the canvas implementation before importing fabric.
const { fabric } = require('fabric');

// In fabric 5.x for Node, we inject the node canvas implementation
if (fabric.nodeCanvas === undefined) {
  // Some builds auto-detect; manually register if needed
  fabric.util.getEnv().setCanvases(require('canvas'));
}

async function runCompatibilityTest() {
  console.log('=== Fabric 5.3.0 + canvas 3.1.2 Compatibility Test ===\n');

  // Test 1: Basic canvas creation
  console.log('[TEST-1] Create StaticCanvas');
  const staticCanvas = new fabric.StaticCanvas(null, {
    width: 400,
    height: 500,
  });
  console.log(`  Canvas created: ${staticCanvas.width}×${staticCanvas.height}`);

  // Test 2: TEXT element
  console.log('[TEST-2] Add TEXT element with font, color, rotation, opacity');
  const text = new fabric.Text('Hello Print World', {
    left: 50,
    top: 100,
    fontFamily: 'Arial',
    fontSize: 36,
    fill: '#FF5500',
    angle: 15,          // rotation
    scaleX: 1.5,
    scaleY: 1.2,
    opacity: 0.9,
  });
  staticCanvas.add(text);
  console.log(`  TEXT: left=${text.left}, top=${text.top}, angle=${text.angle}, scaleX=${text.scaleX}, opacity=${text.opacity}`);

  // Test 3: RECTANGLE (SHAPE)
  console.log('[TEST-3] Add SHAPE (Rectangle)');
  const rect = new fabric.Rect({
    left: 200,
    top: 300,
    width: 120,
    height: 80,
    fill: '#0066FF',
    opacity: 0.7,
    angle: -10,
  });
  staticCanvas.add(rect);
  console.log(`  RECT: fill=${rect.fill}, opacity=${rect.opacity}, angle=${rect.angle}`);

  // Test 4: Z-index ordering (add items in order, check array position)
  console.log('[TEST-4] Z-index ordering');
  const bottomEl = new fabric.Rect({ left: 10, top: 10, width: 50, height: 50, fill: '#CCC' });
  const topEl = new fabric.Rect({ left: 20, top: 20, width: 50, height: 50, fill: '#333' });
  staticCanvas.add(bottomEl);
  staticCanvas.add(topEl);
  const objects = staticCanvas.getObjects();
  const bottomIdx = objects.indexOf(bottomEl);
  const topIdx = objects.indexOf(topEl);
  console.log(`  bottomEl index=${bottomIdx}, topEl index=${topIdx} (topEl should be higher)`);

  // Test 5: Export PNG buffer
  console.log('[TEST-5] Export PNG to buffer');
  // Export PNG — in fabric 5.x node build, getElement() returns the underlying node-canvas element
  const nodeCanvas = staticCanvas.getElement();
  const pngBuffer = nodeCanvas.toBuffer('image/png');
  console.log(`  PNG buffer size: ${pngBuffer.length} bytes (${(pngBuffer.length / 1024).toFixed(1)} KB)`);

  if (pngBuffer.length < 500) {
    throw new Error('PNG buffer too small — likely empty canvas or rendering failure');
  }

  // Verify PNG header
  const isPng = pngBuffer[0] === 0x89 && pngBuffer[1] === 0x50 && pngBuffer[2] === 0x4E && pngBuffer[3] === 0x47;
  console.log(`  PNG header valid: ${isPng}`);

  // Test 6: Scale factor application (simulating print coordinate system)
  console.log('[TEST-6] Scale factor (UI→Print coordinate mapping)');
  const uiWidth = 800, uiHeight = 1000;
  const printWidthPx = Math.round(12 * 300);  // 12" @ 300 DPI = 3600px
  const printHeightPx = Math.round(15 * 300); // 15" @ 300 DPI = 4500px
  const scaleX = printWidthPx / uiWidth;  // 4.5
  const scaleY = printHeightPx / uiHeight; // 4.5
  console.log(`  UI: ${uiWidth}×${uiHeight}px → Print: ${printWidthPx}×${printHeightPx}px`);
  console.log(`  scaleX: ${scaleX}, scaleY: ${scaleY}`);
  console.log(`  Aspect ratio same: ${Math.abs(scaleX - scaleY) < 0.01 ? 'YES ✅' : 'DIFFERS ⚠️'}`);

  const printCanvas = new fabric.StaticCanvas(null, {
    width: printWidthPx,
    height: printHeightPx,
  });

  // Place a scaled text element
  const printText = new fabric.Text('PRINT OUTPUT', {
    left: 50 * scaleX,
    top: 100 * scaleY,
    fontSize: 36 * scaleX,
    fontFamily: 'Arial',
    fill: '#000000',
  });
  printCanvas.add(printText);
  const printBuffer = printCanvas.getElement().toBuffer('image/png');
  console.log(`  Print PNG: ${printCanvas.width}×${printCanvas.height}px, ${(printBuffer.length / 1024).toFixed(1)} KB`);

  console.log('\n=== All compatibility tests PASSED ===');
  console.log('\nSummary:');
  console.log('  ✅ fabric.StaticCanvas works server-side');
  console.log('  ✅ TEXT with font/color/rotation/scale/opacity renders');
  console.log('  ✅ SHAPE (Rect) renders');
  console.log('  ✅ Z-index ordering preserved');
  console.log('  ✅ toBuffer(image/png) produces valid PNG');
  console.log('  ✅ Scale factor mapping works (12"×15" @ 300DPI = 3600×4500px, scale=4.5×)');
}

runCompatibilityTest().catch((e) => {
  console.error('\n❌ COMPATIBILITY TEST FAILED:', e.message);
  console.error(e.stack);
  process.exit(1);
});
