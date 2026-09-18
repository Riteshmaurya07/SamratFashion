import { z } from "zod";

const safeUrlSchema = z.string().trim().refine(
  (url) =>
    (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:image/")) &&
    !url.toLowerCase().includes("javascript:") &&
    !url.toLowerCase().includes("data:text/html"),
  { message: "Unsafe or unsupported image URL format" }
);

export const designElementSchema = z.object({
  id: z.string().min(1).max(100),
  type: z.enum(["TEXT", "IMAGE", "SHAPE"]),
  x: z.number().min(-100, "Element out of printable bounds").max(600, "Element out of printable bounds"),
  y: z.number().min(-100, "Element out of printable bounds").max(700, "Element out of printable bounds"),
  width: z.number().min(5).max(2000),
  height: z.number().min(5).max(2000),
  rotation: z.number().min(-360).max(360).default(0),
  scaleX: z.number().min(0.01).max(50).default(1),
  scaleY: z.number().min(0.01).max(50).default(1),
  opacity: z.number().min(0).max(1).default(1),
  locked: z.boolean().default(false),
  zIndex: z.number().int().min(0).max(1000).default(0),
  properties: z.record(z.string(), z.unknown()).default({}),
});

export const designLayoutSchema = z.object({
  front: z.object({ elements: z.array(designElementSchema).default([]) }).default({ elements: [] }),
  back: z.object({ elements: z.array(designElementSchema).default([]) }).default({ elements: [] }),
  leftSleeve: z.object({ elements: z.array(designElementSchema).default([]) }).default({ elements: [] }),
  rightSleeve: z.object({ elements: z.array(designElementSchema).default([]) }).default({ elements: [] }),
});

export const createCustomDesignSchema = z.object({
  name: z.string().trim().min(1, "Design name is required").max(100),
  productId: z.string().min(1, "Product ID is required"),
  selectedVariantId: z.string().min(1, "Variant ID is required"),
  selectedColor: z.string().trim().min(1),
  selectedSize: z.string().trim().optional().default(""),
  canvasWidth: z.number().min(100).max(3000).default(800),
  canvasHeight: z.number().min(100).max(3000).default(1000),
  design: designLayoutSchema,
  previewImage: z.object({
    front: safeUrlSchema.optional(),
    back: safeUrlSchema.optional(),
  }).optional(),
  printLocations: z.array(z.enum(["FRONT", "BACK", "LEFT_SLEEVE", "RIGHT_SLEEVE"])).optional(), // UI display only, not authoritative
});
 
export const createCustomPrintingRequestSchema = z.object({
  productId: z.string().min(1, "Product is required"),
  selectedVariantId: z.string().min(1, "Variant is required"),
  selectedColor: z.string().trim().min(1).max(80),
  selectedSize: z.string().trim().min(1).max(40),
  printLocations: z.array(z.enum(["FRONT", "BACK"])).min(1).max(2).optional(),
  selectedPlacements: z.array(z.object({
    templateId: z.string(),
    code: z.string(),
    name: z.string()
  })).optional(),
  instructions: z.string().trim().min(1, "Instructions are required").max(2000),
  artworkType: z.enum(["HAS_ARTWORK", "NEEDS_DESIGN_ASSISTANCE"]).optional(),
  designAssistanceName: z.string().trim().max(100).optional(),
  designAssistanceEmail: z.string().trim().email().optional(),
  artwork: z.object({
    url: safeUrlSchema,
    publicId: z.string().trim().max(300).optional(),
    format: z.string().trim().max(20).optional(),
  }).optional(),
  idempotencyKey: z.string().trim().min(8).max(100).optional(),
  catalogItemId: z.string().trim().optional(),
});

export const updateCustomDesignSchema = createCustomDesignSchema.partial();
