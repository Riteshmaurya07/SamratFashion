/**
 * Shared limits and property allowlists for customer-designed artwork.
 *
 * These limits are enforced in two places:
 *  - Zod validation at design write time (rejects hostile payloads early).
 *  - The renderer (defence in depth for legacy/DB-injected layouts that never
 *    passed through the current validation layer).
 */

export const DESIGN_LIMITS = {
  /** Maximum number of elements on a single printable side. */
  MAX_ELEMENTS_PER_SIDE: 100,
  /** Maximum number of elements across the whole four-side layout. */
  MAX_ELEMENTS_PER_DESIGN: 200,

  MAX_TEXT_LENGTH: 2000,
  MIN_FONT_SIZE: 4,
  MAX_FONT_SIZE: 300,
  MAX_STROKE_WIDTH: 50,

  /** UI-space bound (before print scale) for width * scaleX / height * scaleY. */
  MAX_ELEMENT_UI_DIMENSION: 3000,
  /** Print-space bound applied by the renderer after multiplying by print scale. */
  MAX_ELEMENT_PRINT_DIMENSION_PX: 10000,
  MAX_ELEMENT_PRINT_AREA_PX: 25_000_000,
  MAX_ELEMENT_OFFSET_PX: 50000,

  MAX_CANVAS_DIMENSION_PX: 6000,
  MAX_CANVAS_PIXELS: 20_000_000,

  MAX_IMAGE_BYTES: 10 * 1024 * 1024,
  MAX_IMAGE_DIMENSION_PX: 8192,
  MAX_IMAGE_PIXELS: 25_000_000,
  MAX_IMAGE_REFERENCE_LENGTH: 2048,
  IMAGE_FETCH_TIMEOUT_MS: 5000,
  IMAGE_DECODE_TIMEOUT_MS: 5000,
  MAX_IMAGE_REDIRECTS: 2,
} as const;

export const ALLOWED_FONT_FAMILIES: readonly string[] = [
  "Arial",
  "Arial Black",
  "Verdana",
  "Tahoma",
  "Trebuchet MS",
  "Times New Roman",
  "Georgia",
  "Garamond",
  "Courier New",
  "Brush Script MT",
  "Impact",
  "Comic Sans MS",
  "sans-serif",
  "serif",
  "monospace",
];

export const ALLOWED_FONT_WEIGHTS: readonly string[] = [
  "normal",
  "bold",
  "bolder",
  "lighter",
  "100",
  "200",
  "300",
  "400",
  "500",
  "600",
  "700",
  "800",
  "900",
];

export const ALLOWED_TEXT_ALIGNMENTS: readonly string[] = [
  "left",
  "center",
  "right",
  "justify",
];

export const ALLOWED_SHAPE_TYPES: readonly string[] = [
  "rectangle",
  "circle",
  "ellipse",
];

/**
 * Accepts CSS colours that cannot break out of a canvas paint value. Node-canvas
 * silently ignores invalid colours, so this is defence in depth rather than an
 * XSS boundary.
 */
const SAFE_COLOR_PATTERN =
  /^(#[0-9a-fA-F]{3,8}|(?:rgb|hsl)a?\(\s*[0-9.,%\s/-]+\)|transparent|currentColor)$/;

export function isSafeColor(value: unknown): boolean {
  return typeof value === "string" && SAFE_COLOR_PATTERN.test(value.trim());
}

export function isAllowedFontFamily(value: unknown): boolean {
  return typeof value === "string" && ALLOWED_FONT_FAMILIES.includes(value);
}

export function isAllowedFontWeight(value: unknown): boolean {
  return typeof value === "string" && ALLOWED_FONT_WEIGHTS.includes(value);
}

export function isAllowedTextAlignment(value: unknown): boolean {
  return typeof value === "string" && ALLOWED_TEXT_ALIGNMENTS.includes(value);
}

export function isAllowedShapeType(value: unknown): boolean {
  return typeof value === "string" && ALLOWED_SHAPE_TYPES.includes(value);
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Returns a log-safe element identifier without any attacker-controlled text. */
export function safeElementId(value: unknown): string {
  const cleaned = String(value ?? "")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, 40);
  return cleaned || "element";
}