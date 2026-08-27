import { z } from "zod";
import { CategoryStatus } from "../models/Category";
import { ThemeStatus } from "../models/Theme";
import { ProductStatus } from "../models/Product";

const seoSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
}).optional();

// --- Category Validation ---
export const createCategorySchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  slug: z.string().min(2, "Slug must be at least 2 characters").regex(/^[a-z0-9-]+$/, "Slug can only contain lowercase letters, numbers, and hyphens"),
  description: z.string().optional(),
  image: z.string().url("Must be a valid URL").or(z.literal("")).optional(),
  parentCategory: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid ObjectId").nullable().optional(),
  displayOrder: z.number().int().min(0).optional(),
  status: z.nativeEnum(CategoryStatus).optional(),
  seo: seoSchema,
});

export const updateCategorySchema = createCategorySchema.partial();

export const categoryStatusSchema = z.object({
  status: z.nativeEnum(CategoryStatus),
});

// --- Theme Validation ---
export const createThemeSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  slug: z.string().min(2, "Slug must be at least 2 characters").regex(/^[a-z0-9-]+$/, "Slug can only contain lowercase letters, numbers, and hyphens"),
  description: z.string().optional(),
  heroImage: z.string().url("Must be a valid URL").or(z.literal("")).optional(),
  thumbnail: z.string().url("Must be a valid URL").or(z.literal("")).optional(),
  status: z.nativeEnum(ThemeStatus).optional(),
  displayOrder: z.number().int().min(0).optional(),
  isFeatured: z.boolean().optional(),
  seo: seoSchema,
});

export const updateThemeSchema = createThemeSchema.partial();

export const themeStatusSchema = z.object({
  status: z.nativeEnum(ThemeStatus),
});

// --- Product Validation ---
export const productVariantSchema = z.object({
  size: z.string().optional(),
  color: z.string().optional(),
  hexCode: z.string().regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, "Invalid hex code").optional(),
  sku: z.string().min(1, "SKU is required"),
  stock: z.number().int().min(0, "Stock cannot be negative"),
  additionalPrice: z.number().min(0, "Price cannot be negative").optional(),
  images: z.array(z.string().url("Must be a valid URL")).optional(),
  isAvailable: z.boolean().optional(),
});

export const productOfferSchema = z.object({
  type: z.string().min(1, "Offer type is required"),
  description: z.string().min(1, "Offer description is required"),
});

export const sizeGuideRowSchema = z.object({
  size: z.string().min(1, "Size label is required"),
  chest: z.number().min(0, "Measurement cannot be negative").optional(),
  length: z.number().min(0, "Measurement cannot be negative").optional(),
  shoulder: z.number().min(0, "Measurement cannot be negative").optional(),
});

export const createProductSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  slug: z.string().min(2, "Slug must be at least 2 characters").regex(/^[a-z0-9-]+$/, "Slug can only contain lowercase letters, numbers, and hyphens"),
  description: z.string().min(5, "Description must be at least 5 characters"),
  images: z.array(z.string().url("Must be a valid URL")).min(1, "At least one image is required"),
  categoryId: z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid Category ID"),
  themeIds: z.array(z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid Theme ID")).optional(),
  basePrice: z.number().min(0, "Price cannot be negative"),
  mrp: z.number().min(0, "MRP cannot be negative").optional(),
  discount: z.number().min(0).max(100, "Discount cannot exceed 100").optional(),
  variants: z.array(productVariantSchema).min(1, "At least one variant is required"),
  tags: z.array(z.string()).optional(),
  status: z.nativeEnum(ProductStatus).optional(),
  isFeatured: z.boolean().optional(),
  isNewArrival: z.boolean().optional(),
  isBestSeller: z.boolean().optional(),
  averageRating: z.number().min(0).max(5).optional(),
  reviewCount: z.number().int().min(0).optional(),
  offers: z.array(productOfferSchema).optional(),
  fabric: z.string().max(100, "Fabric description too long").optional(),
  gsm: z.number().int().min(0, "GSM must be a non-negative integer").optional(),
  fit: z.enum(["OVERSIZED", "RELAXED", "REGULAR", "BOXER"]).optional(),
  gender: z.enum(["UNISEX", "MEN", "WOMEN"]).optional(),
  careInstructions: z.array(z.string()).optional(),
  printTypes: z.array(z.enum(["DTG", "PU_PRINT", "EMBROIDERY", "SCREEN_PRINT"])).optional(),
  sizeGuideTable: z.array(sizeGuideRowSchema).optional(),
  seo: seoSchema,
});

export const updateProductSchema = createProductSchema.partial();

export const productStatusSchema = z.object({
  status: z.nativeEnum(ProductStatus),
});

// --- Query Validation ---
export const catalogQuerySchema = z.object({
  page: z.string().regex(/^\d+$/).transform(Number).optional(),
  limit: z.string().regex(/^\d+$/).transform(Number).optional(),
  q: z.string().optional(), // search
  search: z.string().optional(), // search alias
  category: z.string().optional(), // slug
  theme: z.string().optional(), // slug
  sort: z.string().optional(),
  maxPrice: z.string().optional(),
  size: z.string().optional(),
});

export const inventoryAdjustmentSchema = z.object({
  quantity: z.number().int().refine(val => val !== 0, "Quantity cannot be 0"),
  type: z.enum(["RESTOCK", "ADJUSTMENT"]),
  reason: z.string().min(2, "Reason must be provided for manual adjustments")
});
