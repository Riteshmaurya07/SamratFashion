import mongoose from "mongoose";
import { Product } from "../models/Product";
import { CustomPrintCatalogItem } from "../models/CustomPrintCatalogItem";
import { PrintPricingConfig, IVolumePricingTier } from "../models/PrintPricingConfig";

export interface IEffectivePricingRule {
  source: "PRODUCT" | "CATEGORY" | "GLOBAL" | "DEFAULT";
  minOrderQuantity: number;
  tiers: IVolumePricingTier[];
  printLocationFee: number; // in Rupees
  setupFee: number; // in Rupees
}

export interface ICalculatedBulkPricing {
  unitPriceRupees: number;
  baseUnitPriceRupees: number;
  totalProductPriceRupees: number;
  totalProductPricePaise: number;
  discountPercentage: number;
  totalDiscountRupees: number;
  totalDiscountPaise: number;
  printLocationFeeRupees: number;
  totalPrintingFeeRupees: number;
  totalPrintingFeePaise: number;
  setupFeeRupees: number;
  setupFeePaise: number;
  subtotalRupees: number;
  subtotalPaise: number;
  taxRupees: number;
  taxPaise: number;
  shippingRupees: number;
  shippingPaise: number;
  totalRupees: number;
  totalPaise: number;
  appliedTier?: IVolumePricingTier;
  ruleSource: string;
}

const DEFAULT_RULE: IEffectivePricingRule = {
  source: "DEFAULT",
  minOrderQuantity: 10,
  tiers: [
    { minQuantity: 10, maxQuantity: 19, discountPercentage: 5 },
    { minQuantity: 20, maxQuantity: 49, discountPercentage: 10 },
    { minQuantity: 50, discountPercentage: 20 },
  ],
  printLocationFee: 200,
  setupFee: 0,
};

/**
 * Precedence Order for Pricing & MOQ Rules:
 * 1. Product-specific PrintPricingConfig (scope: 'PRODUCT', productId: target)
 * 2. Category-specific PrintPricingConfig (scope: 'CATEGORY', categoryId: product.categoryId)
 * 3. Global PrintPricingConfig (scope: 'GLOBAL')
 * 4. System Default (MOQ 10, standard 10-19/20-49/50+ tiers)
 *
 * Catalog Item MOQ override (if defined on CustomPrintCatalogItem) sets the floor.
 */
export async function getEffectivePricingRule(
  productId: string | mongoose.Types.ObjectId,
  catalogItemId?: string | mongoose.Types.ObjectId
): Promise<IEffectivePricingRule> {
  const pId = typeof productId === "string" ? new mongoose.Types.ObjectId(productId) : productId;

  // 1. Check Product-level rule
  const productRule = await PrintPricingConfig.findOne({
    scope: "PRODUCT",
    productId: pId,
    isActive: true,
  });

  if (productRule) {
    let moq = productRule.minOrderQuantity;
    if (catalogItemId) {
      const catItem = await CustomPrintCatalogItem.findById(catalogItemId);
      if (catItem?.minOrderQuantity !== undefined && catItem.minOrderQuantity !== null) {
        moq = Math.max(moq, catItem.minOrderQuantity);
      }
    }
    return {
      source: "PRODUCT",
      minOrderQuantity: moq,
      tiers: productRule.tiers,
      printLocationFee: productRule.printLocationFee,
      setupFee: productRule.setupFee,
    };
  }

  // 2. Lookup product to find category
  const product = await Product.findById(pId);
  if (product?.categoryId) {
    const categoryRule = await PrintPricingConfig.findOne({
      scope: "CATEGORY",
      categoryId: product.categoryId,
      isActive: true,
    });

    if (categoryRule) {
      let moq = categoryRule.minOrderQuantity;
      if (catalogItemId) {
        const catItem = await CustomPrintCatalogItem.findById(catalogItemId);
        if (catItem?.minOrderQuantity !== undefined && catItem.minOrderQuantity !== null) {
          moq = Math.max(moq, catItem.minOrderQuantity);
        }
      }
      return {
        source: "CATEGORY",
        minOrderQuantity: moq,
        tiers: categoryRule.tiers,
        printLocationFee: categoryRule.printLocationFee,
        setupFee: categoryRule.setupFee,
      };
    }
  }

  // 3. Check Global rule
  const globalRule = await PrintPricingConfig.findOne({
    scope: "GLOBAL",
    isActive: true,
  });

  if (globalRule) {
    let moq = globalRule.minOrderQuantity;
    if (catalogItemId) {
      const catItem = await CustomPrintCatalogItem.findById(catalogItemId);
      if (catItem?.minOrderQuantity !== undefined && catItem.minOrderQuantity !== null) {
        moq = Math.max(moq, catItem.minOrderQuantity);
      }
    }
    return {
      source: "GLOBAL",
      minOrderQuantity: moq,
      tiers: globalRule.tiers,
      printLocationFee: globalRule.printLocationFee,
      setupFee: globalRule.setupFee,
    };
  }

  // 4. Default Fallback
  let moq = DEFAULT_RULE.minOrderQuantity;
  if (catalogItemId) {
    const catItem = await CustomPrintCatalogItem.findById(catalogItemId);
    if (catItem?.minOrderQuantity !== undefined && catItem.minOrderQuantity !== null) {
      moq = catItem.minOrderQuantity;
    }
  }

  return {
    ...DEFAULT_RULE,
    minOrderQuantity: moq,
  };
}

/**
 * Validates whether the submitted quantity satisfies the authoritative MOQ.
 */
export async function validateQuantityMOQ(
  quantity: number,
  productId: string | mongoose.Types.ObjectId,
  catalogItemId?: string | mongoose.Types.ObjectId
): Promise<{ valid: boolean; minQuantity: number; message?: string }> {
  const rule = await getEffectivePricingRule(productId, catalogItemId);
  if (quantity < rule.minOrderQuantity) {
    return {
      valid: false,
      minQuantity: rule.minOrderQuantity,
      message: `Minimum order quantity for this garment is ${rule.minOrderQuantity} units. Received ${quantity} units.`,
    };
  }
  return { valid: true, minQuantity: rule.minOrderQuantity };
}

/**
 * Calculates authoritative bulk pricing with strict currency conversions.
 * Product basePrice is in RUPEES.
 * Returned breakdown provides both RUPEES and PAISE formats for zero ambiguity.
 */
export async function calculateAuthoritativeBulkPricing(params: {
  productId: string | mongoose.Types.ObjectId;
  catalogItemId?: string | mongoose.Types.ObjectId;
  totalQuantity: number;
  printLocationsCount?: number;
  shippingRupees?: number;
  adminDiscountRupees?: number;
}): Promise<ICalculatedBulkPricing> {
  const {
    productId,
    catalogItemId,
    totalQuantity,
    printLocationsCount = 1,
    shippingRupees = 0,
    adminDiscountRupees = 0,
  } = params;

  const product = await Product.findById(productId);
  if (!product) {
    throw new Error("Target product not found for pricing calculation");
  }

  // Normalize product basePrice (Rupees)
  const baseUnitPriceRupees =
    product.basePrice > 10000 ? Math.round(product.basePrice / 100) : product.basePrice;

  const rule = await getEffectivePricingRule(productId, catalogItemId);

  // Match volume tier
  let appliedTier: IVolumePricingTier | undefined = undefined;
  if (rule.tiers && rule.tiers.length > 0) {
    // Sort descending by minQuantity to find the highest qualifying tier
    const sortedTiers = [...rule.tiers].sort((a, b) => b.minQuantity - a.minQuantity);
    appliedTier = sortedTiers.find((t) => {
      if (totalQuantity < t.minQuantity) return false;
      if (t.maxQuantity !== undefined && t.maxQuantity !== null && totalQuantity > t.maxQuantity) {
        return false;
      }
      return true;
    });
  }

  let unitPriceRupees = baseUnitPriceRupees;
  let discountPercentage = 0;

  if (appliedTier) {
    if (appliedTier.unitPrice !== undefined && appliedTier.unitPrice !== null && appliedTier.unitPrice > 0) {
      unitPriceRupees = appliedTier.unitPrice;
      if (baseUnitPriceRupees > unitPriceRupees) {
        discountPercentage = Math.round(((baseUnitPriceRupees - unitPriceRupees) / baseUnitPriceRupees) * 100);
      }
    } else if (appliedTier.discountPercentage && appliedTier.discountPercentage > 0) {
      discountPercentage = appliedTier.discountPercentage;
      const discountPerUnit = (baseUnitPriceRupees * discountPercentage) / 100;
      unitPriceRupees = Math.max(0, baseUnitPriceRupees - discountPerUnit);
    }
  }

  const rawProductTotalRupees = baseUnitPriceRupees * totalQuantity;
  const tieredDiscountRupees = Math.round(rawProductTotalRupees - unitPriceRupees * totalQuantity);
  const totalDiscountRupees = Math.max(0, tieredDiscountRupees + adminDiscountRupees);

  const totalProductPriceRupees = rawProductTotalRupees;
  const printLocations = Math.max(1, printLocationsCount);
  const totalPrintingFeeRupees = rule.printLocationFee * printLocations * totalQuantity;
  const setupFeeRupees = rule.setupFee;

  const grossSubtotalRupees = totalProductPriceRupees + totalPrintingFeeRupees + setupFeeRupees;
  const subtotalRupees = Math.max(0, grossSubtotalRupees - totalDiscountRupees);

  const taxRupees = Math.round(subtotalRupees * 0.18); // 18% GST
  const totalRupees = subtotalRupees + taxRupees + shippingRupees;

  return {
    unitPriceRupees,
    baseUnitPriceRupees,
    totalProductPriceRupees,
    totalProductPricePaise: Math.round(totalProductPriceRupees * 100),
    discountPercentage,
    totalDiscountRupees,
    totalDiscountPaise: Math.round(totalDiscountRupees * 100),
    printLocationFeeRupees: rule.printLocationFee,
    totalPrintingFeeRupees,
    totalPrintingFeePaise: Math.round(totalPrintingFeeRupees * 100),
    setupFeeRupees,
    setupFeePaise: Math.round(setupFeeRupees * 100),
    subtotalRupees,
    subtotalPaise: Math.round(subtotalRupees * 100),
    taxRupees,
    taxPaise: Math.round(taxRupees * 100),
    shippingRupees,
    shippingPaise: Math.round(shippingRupees * 100),
    totalRupees,
    totalPaise: Math.round(totalRupees * 100),
    appliedTier,
    ruleSource: rule.source,
  };
}
