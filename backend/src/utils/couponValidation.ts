import { z } from "zod";
import { DiscountType, CouponStatus } from "../models/Coupon";

export const createCouponSchema = z.object({
  code: z
    .string()
    .min(3, "Code must be at least 3 characters")
    .max(25, "Code cannot exceed 25 characters")
    .regex(/^[a-zA-Z0-9_-]+$/, "Code contains invalid characters"),
  description: z.string().optional(),
  discountType: z.nativeEnum(DiscountType),
  discountValue: z.number().positive("Discount value must be greater than 0"),
  minOrderValue: z.number().min(0, "Minimum order value cannot be negative").default(0),
  maxDiscountAmount: z.number().positive("Max discount amount must be greater than 0").optional(),
  startsAt: z.string().datetime().or(z.date()).optional(),
  expiresAt: z.string().datetime().or(z.date()).optional(),
  usageLimit: z.number().int().positive("Usage limit must be positive").optional(),
  perUserUsageLimit: z.number().int().positive("Per user limit must be positive").default(1),
  status: z.nativeEnum(CouponStatus).optional(),
  applicableProductIds: z.array(z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid Product ID")).optional(),
  applicableCategoryIds: z.array(z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid Category ID")).optional(),
  applicableThemeIds: z.array(z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid Theme ID")).optional(),
}).refine(data => {
  if (data.discountType === DiscountType.PERCENTAGE && data.discountValue > 100) {
    return false;
  }
  return true;
}, {
  message: "Percentage discount cannot exceed 100%",
  path: ["discountValue"],
}).refine(data => {
  if (data.startsAt && data.expiresAt) {
    const start = new Date(data.startsAt).getTime();
    const end = new Date(data.expiresAt).getTime();
    return end > start;
  }
  return true;
}, {
  message: "Expiration date must be after start date",
  path: ["expiresAt"],
});

export const updateCouponSchema = createCouponSchema.partial();

export const couponStatusSchema = z.object({
  status: z.nativeEnum(CouponStatus),
});

export const applyCouponSchema = z.object({
  code: z.string().min(1, "Coupon code is required"),
});
