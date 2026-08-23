import mongoose from "mongoose";
import { Coupon, DiscountType, CouponStatus } from "../models/Coupon";
import { CouponUsage } from "../models/CouponUsage";
import { AppError } from "../utils/AppError";

interface EligibleCalculationResult {
  coupon: {
    id: string;
    code: string;
    description?: string;
    discountType: string;
    discountValue: number;
  };
  eligibleSubtotal: number;
  discountAmount: number;
}

export const validateAndCalculateCouponDiscount = async (
  code: string,
  userId: string,
  cartItems: any[]
): Promise<EligibleCalculationResult> => {
  const normalizedCode = code.trim().toUpperCase();
  const coupon = await Coupon.findOne({ code: normalizedCode });

  if (!coupon) {
    throw new AppError("Invalid coupon code", 400, "COUPON_NOT_FOUND");
  }

  if (coupon.status !== CouponStatus.ACTIVE) {
    throw new AppError("Coupon is no longer active", 400, "COUPON_INACTIVE");
  }

  const now = new Date();
  if (coupon.startsAt && now < new Date(coupon.startsAt)) {
    throw new AppError("Coupon is not active yet", 400, "COUPON_NOT_STARTED");
  }

  if (coupon.expiresAt && now > new Date(coupon.expiresAt)) {
    throw new AppError("Coupon has expired", 400, "COUPON_EXPIRED");
  }

  if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) {
    throw new AppError("Coupon usage limit has been reached", 400, "COUPON_LIMIT_REACHED");
  }

  if (coupon.perUserUsageLimit) {
    const userUsageCount = await CouponUsage.countDocuments({
      couponId: coupon._id,
      userId: new mongoose.Types.ObjectId(userId),
    });

    if (userUsageCount >= coupon.perUserUsageLimit) {
      throw new AppError("You have already used this coupon maximum allowed times", 400, "COUPON_USER_LIMIT_REACHED");
    }
  }

  // Calculate eligible item subtotal based on applicability restrictions
  let eligibleSubtotal = 0;

  const hasProductRestriction = coupon.applicableProductIds && coupon.applicableProductIds.length > 0;
  const hasCategoryRestriction = coupon.applicableCategoryIds && coupon.applicableCategoryIds.length > 0;
  const hasThemeRestriction = coupon.applicableThemeIds && coupon.applicableThemeIds.length > 0;

  const appProductSet = new Set(coupon.applicableProductIds.map((id) => id.toString()));
  const appCategorySet = new Set(coupon.applicableCategoryIds.map((id) => id.toString()));
  const appThemeSet = new Set(coupon.applicableThemeIds.map((id) => id.toString()));

  for (const item of cartItems) {
    const product = item.productId;
    if (!product || item.isAvailable === false) continue;

    const productIdStr = (product._id || product).toString();
    const categoryIdStr = product.categoryId ? (product.categoryId._id || product.categoryId).toString() : "";
    const themeIdStrs = product.themeIds ? product.themeIds.map((t: any) => (t._id || t).toString()) : [];

    let isEligible = true;

    if (hasProductRestriction || hasCategoryRestriction || hasThemeRestriction) {
      isEligible = false;

      if (hasProductRestriction && appProductSet.has(productIdStr)) {
        isEligible = true;
      }
      if (hasCategoryRestriction && categoryIdStr && appCategorySet.has(categoryIdStr)) {
        isEligible = true;
      }
      if (hasThemeRestriction && themeIdStrs.some((tid: any) => appThemeSet.has(tid))) {
        isEligible = true;
      }
    }

    if (isEligible) {
      eligibleSubtotal += item.lineTotal;
    }
  }

  if (eligibleSubtotal <= 0) {
    throw new AppError("Coupon is not applicable to any items in your cart", 400, "COUPON_NOT_APPLICABLE");
  }

  if (coupon.minOrderValue && eligibleSubtotal < coupon.minOrderValue) {
    throw new AppError(
      `Minimum order subtotal of ₹${coupon.minOrderValue.toLocaleString()} required for this coupon`,
      400,
      "COUPON_MIN_VALUE_NOT_MET"
    );
  }

  let discountAmount = 0;
  if (coupon.discountType === DiscountType.PERCENTAGE) {
    discountAmount = Math.round((eligibleSubtotal * coupon.discountValue) / 100);
    if (coupon.maxDiscountAmount && discountAmount > coupon.maxDiscountAmount) {
      discountAmount = coupon.maxDiscountAmount;
    }
  } else {
    discountAmount = Math.min(coupon.discountValue, eligibleSubtotal);
  }

  return {
    coupon: {
      id: coupon._id.toString(),
      code: coupon.code,
      description: coupon.description,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
    },
    eligibleSubtotal,
    discountAmount,
  };
};
