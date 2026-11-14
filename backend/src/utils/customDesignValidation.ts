import { z } from "zod";
import {
  DESIGN_LIMITS,
  isAllowedFontFamily,
  isAllowedShapeType,
  isSafeColor,
} from "./designRenderPolicy";

const safeUrlSchema = z.string().trim().refine(
  (url) => {
    const lower = url.toLowerCase();
    if (lower.startsWith("javascript:") || lower.startsWith("data:") || lower.startsWith("file:")) {
      return false;
    }
    return (
      url.startsWith("https://") ||
      url.startsWith("/uploads/") ||
      url.startsWith("uploads/") ||
      url.startsWith("samrat-fashion/")
    );
  },
  { message: "Unsafe or unsupported image URL format. Only HTTPS or managed artwork paths are allowed." }
);

export const designElementSchema = z.object({
  id: z.string().min(1).max(100),
  type: z.enum(["TEXT", "IMAGE", "SHAPE"]),
  x: z.number().min(-DESIGN_LIMITS.MAX_ELEMENT_OFFSET_PX).max(DESIGN_LIMITS.MAX_ELEMENT_OFFSET_PX),
  y: z.number().min(-DESIGN_LIMITS.MAX_ELEMENT_OFFSET_PX).max(DESIGN_LIMITS.MAX_ELEMENT_OFFSET_PX),
  width: z.number().min(1).max(DESIGN_LIMITS.MAX_ELEMENT_UI_DIMENSION),
  height: z.number().min(1).max(DESIGN_LIMITS.MAX_ELEMENT_UI_DIMENSION),
  rotation: z.number().min(-360).max(360).default(0),
  scaleX: z.number().min(0.01).max(50).default(1),
  scaleY: z.number().min(0.01).max(50).default(1),
  opacity: z.number().min(0).max(1).default(1),
  locked: z.boolean().default(false),
  zIndex: z.number().int().min(0).max(1000).default(0),
  properties: z.record(z.string(), z.unknown()).default({}),
}).superRefine((el, ctx) => {
  const scaledWidth = el.width * el.scaleX;
  const scaledHeight = el.height * el.scaleY;
  if (scaledWidth > DESIGN_LIMITS.MAX_ELEMENT_UI_DIMENSION || scaledHeight > DESIGN_LIMITS.MAX_ELEMENT_UI_DIMENSION) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Scaled element dimensions exceed the allowed limit of ${DESIGN_LIMITS.MAX_ELEMENT_UI_DIMENSION}px`,
    });
  }

  const props = el.properties || {};

  if (el.type === "TEXT") {
    if (props.text !== undefined) {
      if (typeof props.text !== "string") {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Text content must be a string" });
      } else if (props.text.length > DESIGN_LIMITS.MAX_TEXT_LENGTH) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Text exceeds maximum length of ${DESIGN_LIMITS.MAX_TEXT_LENGTH}` });
      }
    }
    if (props.fontSize !== undefined) {
      const fs = Number(props.fontSize);
      if (!Number.isFinite(fs) || fs < DESIGN_LIMITS.MIN_FONT_SIZE || fs > DESIGN_LIMITS.MAX_FONT_SIZE) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Font size must be between ${DESIGN_LIMITS.MIN_FONT_SIZE} and ${DESIGN_LIMITS.MAX_FONT_SIZE}` });
      }
    }
    if (props.fontFamily !== undefined && !isAllowedFontFamily(props.fontFamily)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Font family is not supported" });
    }
    for (const key of ["color", "fill"]) {
      if (props[key] !== undefined && !isSafeColor(props[key])) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Text ${key} is invalid` });
      }
    }
  } else if (el.type === "IMAGE") {
    const ref = props.imageUrl ?? props.publicId;
    if (ref === undefined || ref === null || ref === "") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Image element requires an artwork reference" });
    } else if (typeof ref !== "string" || ref.length > DESIGN_LIMITS.MAX_IMAGE_REFERENCE_LENGTH) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Image artwork reference length is invalid" });
    } else {
      const lower = ref.toLowerCase().trim();
      if (lower.startsWith("javascript:") || lower.startsWith("data:") || lower.startsWith("file:")) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Image element uses an unsupported URL scheme" });
      }
    }
  } else if (el.type === "SHAPE") {
    if (props.shapeType !== undefined && !isAllowedShapeType(props.shapeType)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Shape type is not supported" });
    }
    for (const key of ["fillColor", "strokeColor"]) {
      if (props[key] !== undefined && !isSafeColor(props[key])) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Shape ${key} is invalid` });
      }
    }
    if (props.strokeWidth !== undefined) {
      const sw = Number(props.strokeWidth);
      if (!Number.isFinite(sw) || sw < 0 || sw > DESIGN_LIMITS.MAX_STROKE_WIDTH) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Stroke width must be between 0 and ${DESIGN_LIMITS.MAX_STROKE_WIDTH}` });
      }
    }
  }
});

const sideSchema = z.object({
  elements: z.array(designElementSchema).max(DESIGN_LIMITS.MAX_ELEMENTS_PER_SIDE, `Maximum ${DESIGN_LIMITS.MAX_ELEMENTS_PER_SIDE} elements allowed per side`).default([]),
}).default({ elements: [] });

export const designLayoutSchema = z.object({
  front: sideSchema,
  back: sideSchema,
  leftSleeve: sideSchema,
  rightSleeve: sideSchema,
}).superRefine((layout, ctx) => {
  const total =
    (layout.front?.elements?.length || 0) +
    (layout.back?.elements?.length || 0) +
    (layout.leftSleeve?.elements?.length || 0) +
    (layout.rightSleeve?.elements?.length || 0);
  if (total > DESIGN_LIMITS.MAX_ELEMENTS_PER_DESIGN) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Total elements across all sides cannot exceed ${DESIGN_LIMITS.MAX_ELEMENTS_PER_DESIGN}`,
    });
  }
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
  printLocations: z.array(z.string()).optional(),
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
