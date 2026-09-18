/**
 * Canonical Print Coordinate System
 *
 * Defines the relationship between the browser canvas (UI space) and
 * the physical print output (production space). All values are configurable
 * per product/print-area, with a sensible default for standard T-shirt fronts.
 *
 * Aspect ratio is always preserved. Width and height are derived from physical
 * inches × DPI — not from arbitrary CSS pixel values.
 *
 * Terminology:
 *  - UI space:      The coordinate space as used by the browser Fabric canvas (800×1000px typical)
 *  - Print space:   The physical print dimensions × DPI → final PNG dimensions
 *  - Scale factors: Derived, not defined independently, to prevent distortion
 */

export interface PrintAreaDimensions {
  /** Physical print area width in inches */
  widthInches: number;
  /** Physical print area height in inches */
  heightInches: number;
  /** Dots per inch for the output raster */
  dpi: number;
  /** UI canvas width (Fabric.js canvas width in pixels) */
  uiCanvasWidth: number;
  /** UI canvas height (Fabric.js canvas height in pixels) */
  uiCanvasHeight: number;
}

export interface ResolvedPrintDimensions {
  outputWidthPx: number;
  outputHeightPx: number;
  /** Scale factor: multiply any UI x-coordinate or width to get print x-coordinate */
  scaleX: number;
  /** Scale factor: multiply any UI y-coordinate or height to get print y-coordinate */
  scaleY: number;
  dpi: number;
  widthInches: number;
  heightInches: number;
}

/**
 * Standard T-shirt front/back print area: 12″ × 15″ at 300 DPI.
 * This matches a typical DTF/screen print chest area.
 * Sleeve areas use a smaller print area (4″ × 5″ typical).
 */
export const DEFAULT_PRINT_AREAS: Record<string, PrintAreaDimensions> = {
  FRONT: {
    widthInches: 12,
    heightInches: 15,
    dpi: 300,
    uiCanvasWidth: 800,
    uiCanvasHeight: 1000,
  },
  BACK: {
    widthInches: 12,
    heightInches: 15,
    dpi: 300,
    uiCanvasWidth: 800,
    uiCanvasHeight: 1000,
  },
  LEFT_SLEEVE: {
    widthInches: 4,
    heightInches: 5,
    dpi: 300,
    uiCanvasWidth: 800,
    uiCanvasHeight: 1000,
  },
  RIGHT_SLEEVE: {
    widthInches: 4,
    heightInches: 5,
    dpi: 300,
    uiCanvasWidth: 800,
    uiCanvasHeight: 1000,
  },
};

/**
 * Resolves the final output pixel dimensions and scale factors for a given print area.
 * Scale factors are derived from (outputPx / uiCanvas), not set independently,
 * ensuring no independent distortion of X vs Y unless the physical ratio differs.
 */
export function resolvePrintDimensions(area: PrintAreaDimensions): ResolvedPrintDimensions {
  const outputWidthPx = Math.round(area.widthInches * area.dpi);
  const outputHeightPx = Math.round(area.heightInches * area.dpi);

  return {
    outputWidthPx,
    outputHeightPx,
    scaleX: outputWidthPx / area.uiCanvasWidth,
    scaleY: outputHeightPx / area.uiCanvasHeight,
    dpi: area.dpi,
    widthInches: area.widthInches,
    heightInches: area.heightInches,
  };
}

/**
 * Returns a human-readable summary of the coordinate system for a given side.
 */
export function describePrintSystem(side: string, area?: PrintAreaDimensions): string {
  const a = area || DEFAULT_PRINT_AREAS[side] || DEFAULT_PRINT_AREAS.FRONT;
  const d = resolvePrintDimensions(a);
  return [
    `Side: ${side}`,
    `Physical: ${a.widthInches}″ × ${a.heightInches}″ @ ${a.dpi} DPI`,
    `Output: ${d.outputWidthPx}px × ${d.outputHeightPx}px`,
    `UI Canvas: ${a.uiCanvasWidth}px × ${a.uiCanvasHeight}px`,
    `Scale: ${d.scaleX.toFixed(3)}× (X), ${d.scaleY.toFixed(3)}× (Y)`,
    `Aspect ratio preserved: ${Math.abs(d.scaleX - d.scaleY) < 0.01 ? "YES" : "NO — ratio differs (intentional for this area)"}`,
  ].join("\n  ");
}
