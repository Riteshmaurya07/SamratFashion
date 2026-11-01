import crypto from "crypto";
import mongoose from "mongoose";
import { Product, ProductStatus, IProductVariant } from "../../models/Product";
import { Category, CategoryStatus } from "../../models/Category";
import { PricingService } from "../pricingService";
import { validateAndCalculateCouponDiscount } from "../../utils/couponEngine";
import { getStoreShippingConfig } from "../../models/StoreShippingConfig";
import { ICustomConfiguration, IPricingSnapshot } from "../../models/Cart";

export interface PricingEngineItemInput {
  productId: string | mongoose.Types.ObjectId;
  variantId: string | mongoose.Types.ObjectId;
  quantity: number;
  isCustomized?: boolean;
  customConfigurations?: ICustomConfiguration[];
  customDesignId?: string | mongoose.Types.ObjectId;
  customizationSnapshot?: Record<string, unknown>;
}

export interface PricingEngineOptions {
  userId: string;
  items: PricingEngineItemInput[];
  couponCode?: string | null;
}

export interface ProcessedItemOutput {
  productId: {
    _id: mongoose.Types.ObjectId;
    name: string;
    slug: string;
    images: string[];
    basePrice: number;
    categoryId?: mongoose.Types.ObjectId;
    themeIds?: mongoose.Types.ObjectId[];
  };
  variantId: mongoose.Types.ObjectId;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  isAvailable: boolean;
  isCustomized?: boolean;
  customConfigurations?: ICustomConfiguration[];
  customizationSnapshot?: Record<string, unknown>;
  customDesignId?: string | mongoose.Types.ObjectId;
  pricingSnapshot: IPricingSnapshot | null;
  variantDetails?: {
    size?: string;
    color?: string;
    stock?: number;
    image?: string;
  };
}
export interface PricingSummaryOutput {
  subtotal: number; // GST-inclusive gross merchandise subtotal before order-level product coupon discounts
  discount: number; // Single coupon product discount
  shipping: number; // Authoritative shipping fee
  tax: number; // 0 (retail apparel selling prices are GST-inclusive)
  total: number; // Final payable amount
  pricingFingerprint: string;
  isFreeShippingEarned: boolean;
  freeShippingSource: "GLOBAL_THRESHOLD" | "CATEGORY_RULE" | "NONE";
  freeShippingThreshold: number;
  standardShippingFee: number;
  isGlobalFreeShippingActive: boolean;
  qualifyingCategoryIds: string[];
  qualifyingCategoryNames: string[];
}

export interface PricingEngineResult {
  items: ProcessedItemOutput[];
  coupon: {
    id: string;
    code: string;
    description?: string;
    discountType: string;
    discountValue: number;
  } | null;
  summary: PricingSummaryOutput;
  eligibleCouponItems: ProcessedItemOutput[];
}

export class PricingEngineService {
  /**
   * Generates a deterministic SHA-256 fingerprint representing all pricing inputs,
   * item costs, coupon state, global shipping config, and category shipping outcomes.
   */
  static generateFingerprint(data: {
    items: { productId: string; variantId: string; quantity: number; lineTotal: number }[];
    couponCode: string;
    discount: number;
    subtotal: number;
    shipping: number;
    total: number;
    threshold: number;
    fee: number;
    freeShippingActive: boolean;
    freeShippingSource: string;
    categoryRules: { categoryId: string; subtotal: number; threshold: number; enabled: boolean; qualifies: boolean }[];
  }): string {
    const sortedItems = [...data.items].sort((a, b) =>
      `${a.productId}_${a.variantId}`.localeCompare(`${b.productId}_${b.variantId}`)
    );

    const sortedCategoryRules = [...data.categoryRules].sort((a, b) =>
      a.categoryId.localeCompare(b.categoryId)
    );

    const canonicalPayload = {
      items: sortedItems,
      couponCode: data.couponCode || "",
      discount: data.discount,
      subtotal: data.subtotal,
      shipping: data.shipping,
      total: data.total,
      threshold: data.threshold,
      fee: data.fee,
      freeShippingActive: data.freeShippingActive,
      freeShippingSource: data.freeShippingSource,
      categoryRules: sortedCategoryRules,
    };

    return crypto
      .createHash("sha256")
      .update(JSON.stringify(canonicalPayload))
      .digest("hex");
  }

  /**
   * Authoritative cart and checkout pricing calculation engine.
   * Loads fresh product prices, configurations, and category taxonomy from MongoDB.
   * Evaluates shipping eligibility using GST-inclusive gross merchandise subtotal before order-level product coupon discounts.
   * Enforces independent Global and Category-Specific Free Shipping rules with 2-level roll-up.
   */
  static async calculate(options: PricingEngineOptions): Promise<PricingEngineResult> {
    const { userId, items, couponCode } = options;

    // 1. Fetch Store Shipping Configuration
    const shippingConfig = await getStoreShippingConfig();

    let grossSubtotal = 0;
    const processedItems: ProcessedItemOutput[] = [];
    const eligibleCouponItems: ProcessedItemOutput[] = [];
    const fingerprintItems: { productId: string; variantId: string; quantity: number; lineTotal: number }[] = [];
    const activeCategoryIdsInCart = new Set<string>();

    // 2. Authoritative item pricing loop
    for (const rawItem of items) {
      const prodIdStr = rawItem.productId ? rawItem.productId.toString() : "";
      const varIdStr = rawItem.variantId ? rawItem.variantId.toString() : "";

      if (!prodIdStr || !varIdStr) continue;

      const product = await Product.findById(prodIdStr);
      if (!product || product.status !== ProductStatus.ACTIVE) {
        processedItems.push({
          productId: {
            _id: product?._id || new mongoose.Types.ObjectId(prodIdStr),
            name: product?.name || "Unavailable Product",
            slug: product?.slug || "",
            images: product?.images || [],
            basePrice: product?.basePrice || 0,
            categoryId: product?.categoryId,
            themeIds: product?.themeIds,
          },
          variantId: new mongoose.Types.ObjectId(varIdStr),
          quantity: rawItem.quantity || 0,
          unitPrice: 0,
          lineTotal: 0,
          isAvailable: false,
          pricingSnapshot: null,
        });
        continue;
      }

      const variant = product.variants.find((v: IProductVariant) => v._id?.toString() === varIdStr);
      if (!variant) {
        processedItems.push({
          productId: {
            _id: product._id,
            name: product.name,
            slug: product.slug,
            images: product.images,
            basePrice: product.basePrice,
            categoryId: product.categoryId,
            themeIds: product.themeIds,
          },
          variantId: new mongoose.Types.ObjectId(varIdStr),
          quantity: rawItem.quantity || 0,
          unitPrice: 0,
          lineTotal: 0,
          isAvailable: false,
          pricingSnapshot: null,
        });
        continue;
      }

      // Compute item-level authoritative pricing snapshot
      const snapshot = await PricingService.calculateItemPricing({
        productId: product._id.toString(),
        variantId: variant._id?.toString() || varIdStr,
        quantity: rawItem.quantity,
        isCustomized: rawItem.isCustomized,
        customConfigurations: rawItem.customConfigurations,
      });

      grossSubtotal += snapshot.total;

      const computedQty = rawItem.isCustomized
        ? rawItem.customConfigurations?.reduce(
            (acc: number, c: ICustomConfiguration) =>
              acc +
              (c.sizeDistribution?.reduce(
                (s: number, d: { quantity: number }) => s + (d.quantity || 0),
                0
              ) || 0),
            0
          ) || rawItem.quantity || 1
        : rawItem.quantity;

      // Determine display image logic
      let displayImage: string | undefined = undefined;
      if (variant.images && variant.images.length > 0) {
        displayImage = variant.images[0];
      } else if (variant.color) {
        const sameColor = product.variants.find(
          (v: IProductVariant) => v.color === variant.color && v.images?.length > 0
        );
        displayImage = sameColor ? sameColor.images[0] : product.images[0];
      } else {
        displayImage = product.images[0];
      }

      const processedItem: ProcessedItemOutput = {
        productId: {
          _id: product._id,
          name: product.name,
          slug: product.slug,
          images: product.images,
          basePrice: product.basePrice,
          categoryId: product.categoryId,
          themeIds: product.themeIds,
        },
        variantId: variant._id || new mongoose.Types.ObjectId(varIdStr),
        quantity: computedQty,
        unitPrice: snapshot.subtotal / (computedQty || 1),
        lineTotal: snapshot.total,
        isAvailable: true,
        isCustomized: rawItem.isCustomized,
        customConfigurations: rawItem.customConfigurations,
        customizationSnapshot: rawItem.customizationSnapshot,
        customDesignId: rawItem.customDesignId,
        pricingSnapshot: snapshot,
        variantDetails: {
          size: variant.size,
          color: variant.color,
          stock: variant.stock,
          image: displayImage,
        },
      };

      processedItems.push(processedItem);

      if (product.categoryId) {
        activeCategoryIdsInCart.add(product.categoryId.toString());
      }

      fingerprintItems.push({
        productId: product._id.toString(),
        variantId: variant._id ? variant._id.toString() : varIdStr,
        quantity: computedQty,
        lineTotal: snapshot.total,
      });

      // Item structure for coupon engine evaluation
      eligibleCouponItems.push({
        ...processedItem,
        productId: {
          ...processedItem.productId,
          categoryId: product.categoryId,
          themeIds: product.themeIds,
        },
      });
    }

    // 3. Category Shipping Evaluation (2-Level Hierarchy, Roll-up & Independence)
    // A. Fetch categories referenced in cart and all enabled shipping categories in database
    const cartCategoryList = await Category.find({
      _id: { $in: Array.from(activeCategoryIdsInCart).map((id) => new mongoose.Types.ObjectId(id)) },
    })
      .populate("parentCategory", "_id name slug status isFreeShippingEnabled freeShippingMinAmount")
      .lean();

    const enabledCategoryList = await Category.find({
      isFreeShippingEnabled: true,
      status: CategoryStatus.ACTIVE,
    })
      .populate("parentCategory", "_id name slug status isFreeShippingEnabled freeShippingMinAmount")
      .lean();

    const categoryMap = new Map<string, any>();
    for (const c of cartCategoryList) categoryMap.set(c._id.toString(), c);
    for (const c of enabledCategoryList) categoryMap.set(c._id.toString(), c);

    // B. Build Category Buckets (de-duplicated aggregation with child-to-root roll-up)
    // Key: categoryId -> subtotal
    const categoryBucketSubtotals = new Map<string, number>();

    for (const item of processedItems) {
      if (!item.isAvailable || item.lineTotal <= 0) continue;
      const catIdStr = item.productId.categoryId ? item.productId.categoryId.toString() : null;
      if (!catIdStr) continue;

      const directCat = categoryMap.get(catIdStr);
      if (!directCat) continue;

      // 1. Direct Category Contribution (contributes once to direct bucket)
      const currentDirect = categoryBucketSubtotals.get(catIdStr) || 0;
      categoryBucketSubtotals.set(catIdStr, currentDirect + item.lineTotal);

      // 2. Child-to-Root Roll-Up (contributes once to root parent aggregate bucket)
      if (directCat.parentCategory) {
        const parentRef = directCat.parentCategory;
        const parentIdStr = (typeof parentRef === "object" && parentRef !== null && "_id" in parentRef)
          ? parentRef._id.toString()
          : parentRef.toString();

        if (parentIdStr && parentIdStr !== catIdStr) {
          const currentParent = categoryBucketSubtotals.get(parentIdStr) || 0;
          categoryBucketSubtotals.set(parentIdStr, currentParent + item.lineTotal);
        }
      }
    }

    // C. Evaluate Category Eligibility (Independent Qualification)
    const qualifyingCategoryIds: string[] = [];
    const qualifyingCategoryNames: string[] = [];
    const categoryRulesForFingerprint: {
      categoryId: string;
      subtotal: number;
      threshold: number;
      enabled: boolean;
      qualifies: boolean;
    }[] = [];

    for (const cat of enabledCategoryList) {
      const catIdStr = cat._id.toString();
      const bucketSubtotal = categoryBucketSubtotals.get(catIdStr) || 0;
      const threshold = Number(cat.freeShippingMinAmount ?? 0);

      // Zero-Threshold Rule (Section 7):
      // A category with free shipping enabled and threshold of ₹0 qualifies only when:
      // bucketSubtotal > 0 && bucketSubtotal >= freeShippingMinAmount
      let qualifies = false;
      if (cat.isFreeShippingEnabled) {
        if (threshold === 0) {
          qualifies = bucketSubtotal > 0;
        } else {
          qualifies = bucketSubtotal >= threshold;
        }
      }

      if (qualifies) {
        qualifyingCategoryIds.push(catIdStr);
        qualifyingCategoryNames.push(cat.name);
      }

      categoryRulesForFingerprint.push({
        categoryId: catIdStr,
        subtotal: bucketSubtotal,
        threshold,
        enabled: Boolean(cat.isFreeShippingEnabled),
        qualifies,
      });
    }

    // 4. Coupon Evaluation (Single-coupon behaviour preserved)
    let discount = 0;
    let appliedCoupon: PricingEngineResult["coupon"] = null;

    const normalizedCode = couponCode ? couponCode.trim().toUpperCase() : null;
    if (normalizedCode && eligibleCouponItems.length > 0) {
      try {
        const couponResult = await validateAndCalculateCouponDiscount(
          normalizedCode,
          userId,
          eligibleCouponItems
        );
        discount = couponResult.discountAmount;
        appliedCoupon = couponResult.coupon;
      } catch (err) {
        appliedCoupon = null;
        discount = 0;
      }
    }

    // 5. Global & Category Shipping Decision (Independence & Waiver)
    // Standard shipping is waived if Global rule qualifies OR any enabled category qualifies.
    let isFreeShippingEarned = false;
    let freeShippingSource: "GLOBAL_THRESHOLD" | "CATEGORY_RULE" | "NONE" = "NONE";
    let shipping = 0;

    const isGlobalQualified =
      shippingConfig.isGlobalFreeShippingActive &&
      grossSubtotal >= shippingConfig.globalFreeShippingThreshold;

    const isCategoryQualified = qualifyingCategoryIds.length > 0;

    if (grossSubtotal > 0) {
      if (isGlobalQualified) {
        isFreeShippingEarned = true;
        freeShippingSource = "GLOBAL_THRESHOLD";
        shipping = 0;
      } else if (isCategoryQualified) {
        isFreeShippingEarned = true;
        freeShippingSource = "CATEGORY_RULE";
        shipping = 0;
      } else {
        isFreeShippingEarned = false;
        freeShippingSource = "NONE";
        shipping = shippingConfig.standardShippingFee;
      }
    }

    // 6. Final Authoritative Payable Amount
    const tax = 0; // Retail prices are GST-inclusive
    const total = Math.max(0, grossSubtotal - discount + shipping);

    // 7. Generate Extended Pricing Fingerprint
    const pricingFingerprint = this.generateFingerprint({
      items: fingerprintItems,
      couponCode: appliedCoupon?.code || "",
      discount,
      subtotal: grossSubtotal,
      shipping,
      total,
      threshold: shippingConfig.globalFreeShippingThreshold,
      fee: shippingConfig.standardShippingFee,
      freeShippingActive: shippingConfig.isGlobalFreeShippingActive,
      freeShippingSource,
      categoryRules: categoryRulesForFingerprint,
    });

    return {
      items: processedItems,
      coupon: appliedCoupon,
      summary: {
        subtotal: grossSubtotal,
        discount,
        shipping,
        tax,
        total,
        pricingFingerprint,
        isFreeShippingEarned,
        freeShippingSource,
        freeShippingThreshold: shippingConfig.globalFreeShippingThreshold,
        standardShippingFee: shippingConfig.standardShippingFee,
        isGlobalFreeShippingActive: shippingConfig.isGlobalFreeShippingActive,
        qualifyingCategoryIds,
        qualifyingCategoryNames,
      },
      eligibleCouponItems,
    };
  }
}
