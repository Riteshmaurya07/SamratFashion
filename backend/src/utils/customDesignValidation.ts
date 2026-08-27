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
  type: z.enum(["TEXT", "IMAGE", "SHAPE", "LOGO"]),
  side: z.enum(["FRONT", "BACK"]).default("FRONT"),
  x: z.number().min(-2000).max(2000),
  y: z.number().min(-2000).max(2000),
  width: z.number().min(5).max(2000),
  height: z.number().min(5).max(2000),
  rotation: z.number().min(-360).max(360).default(0),
  scale: z.number().min(0.01).max(50).default(1),
  zIndex: z.number().int().min(0).max(1000).default(0),
  opacity: z.number().min(0).max(1).default(1),
  
  // Text element attributes
  text: z.string().max(500).optional(),
  fontFamily: z.string().max(100).optional(),
  fontSize: z.number().min(8).max(200).optional(),
  fontWeight: z.string().max(50).optional(),
  color: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Invalid color format").optional(),
  alignment: z.enum(["left", "center", "right"]).optional(),

  // Image & Logo element attributes
  imageUrl: safeUrlSchema.optional(),
  
  // Shape element attributes
  shapeType: z.enum(["RECTANGLE", "CIRCLE", "STAR", "LINE"]).optional(),
  fillColor: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Invalid color format").optional(),
  strokeColor: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Invalid color format").optional(),
  strokeWidth: z.number().min(0).max(50).optional(),
});

export const createCustomDesignSchema = z.object({
  name: z.string().trim().min(1, "Design name is required").max(100),
  productId: z.string().min(1, "Product ID is required"),
  selectedVariantId: z.string().min(1, "Variant ID is required"),
  selectedColor: z.string().trim().min(1),
  selectedSize: z.string().trim().min(1),
  canvasWidth: z.number().min(100).max(3000).default(800),
  canvasHeight: z.number().min(100).max(3000).default(1000),
  elements: z.array(designElementSchema).max(50, "Maximum 50 elements allowed per design"),
  previewImage: z.object({
    front: safeUrlSchema.optional(),
    back: safeUrlSchema.optional(),
  }).optional(),
  printLocations: z.array(z.enum(["FRONT", "BACK"])).min(1, "At least one print location is required").default(["FRONT"]),
});

export const updateCustomDesignSchema = createCustomDesignSchema.partial();
