import mongoose from "mongoose";
import { Product, ProductStatus } from "../models/Product";
import { CustomDesign } from "../models/CustomDesign";
import { AppError } from "../utils/AppError";
import { IPricingSnapshot, ICustomConfiguration } from "../models/Cart";
import { PRINT_PRICING_RULES } from "../config/pricingRules";

export interface PricingCalculationRequest {
  productId: string;
  variantId: string;
  quantity: number; // for normal products
  isCustomized?: boolean;
  customConfigurations?: ICustomConfiguration[];
}

export class PricingService {
  static readonly PRINT_LOCATION_FEE = 200; // Flat fee per used location

  /**
   * Calculates the full pricing snapshot for a single Cart/Order item (normal or custom).
   */
  static async calculateItemPricing(request: PricingCalculationRequest): Promise<IPricingSnapshot> {
    const { productId, variantId, quantity, isCustomized, customConfigurations } = request;

    const product = await Product.findById(productId);
    if (!product || product.status !== ProductStatus.ACTIVE) {
      throw new AppError("Product is unavailable or invalid", 400);
    }

    let snapshot: IPricingSnapshot = {
      basePrice: product.basePrice,
      variantPrice: 0,
      fabricPrice: 0, // Not explicitly tracked in current schema, defaulting to 0
      printCharges: 0,
      customizationCharges: 0,
      bulkDiscount: 0,
      tax: 0,
      shipping: 0,
      subtotal: 0,
      total: 0,
      currency: "INR",
      calculatedAt: new Date(),
    };

    if (!isCustomized) {
      // Normal Product Calculation
      const variant = product.variants.find(
        (v) => (v._id && v._id.toString() === variantId.toString()) || v.sku === variantId.toString()
      );
      if (!variant || !variant.isAvailable) {
        throw new AppError("Variant is unavailable", 400);
      }

      snapshot.variantPrice = variant.additionalPrice || 0;
      const unitPrice = snapshot.basePrice + snapshot.variantPrice;
      snapshot.subtotal = unitPrice * quantity;
      
      // Calculate flat shipping for subtotal < 999
      snapshot.shipping = snapshot.subtotal > 0 && snapshot.subtotal < 999 ? 100 : 0;
      snapshot.total = snapshot.subtotal + snapshot.tax + snapshot.shipping;
      return snapshot;
    }

    // Custom Configuration Calculation
    if (!customConfigurations || customConfigurations.length === 0) {
      throw new AppError("Custom configurations missing", 400);
    }

    let totalSubtotal = 0;
    let totalQuantity = 0;
    let totalPrintCharges = 0;
    let totalVariantPrice = 0; // Cumulative for display or we average it. We'll store total variant impact.

    for (const config of customConfigurations) {
      const variant = product.variants.find(
        (v) => (v._id && v._id.toString() === config.variantId.toString())
      );
      if (!variant || !variant.isAvailable) {
        throw new AppError(`Variant ${config.variantId} is unavailable`, 400);
      }

      const configQuantity = config.sizeDistribution.reduce((acc, curr) => acc + curr.quantity, 0);
      if (configQuantity < 1) continue;

      totalQuantity += configQuantity;

      let printLocationFee = 0;
      if (config.designId) {
        const design = await CustomDesign.findById(config.designId);
        if (!design) throw new AppError(`Design ${config.designId} not found`, 404);
        
        const layout = design.getActiveLayout();
        const method = product.printMethods?.[0] || "DEFAULT"; // Fallback to first available method or DEFAULT
        const rules = PRINT_PRICING_RULES[method] || PRINT_PRICING_RULES["DEFAULT"];

        // Authoritatively check which zones have elements
        if (layout.front?.elements?.length > 0) printLocationFee += rules.front || 200;
        if (layout.back?.elements?.length > 0) printLocationFee += rules.back || 200;
        if (layout.leftSleeve?.elements?.length > 0) printLocationFee += rules.leftSleeve || 150;
        if (layout.rightSleeve?.elements?.length > 0) printLocationFee += rules.rightSleeve || 150;
      }

      const variantPriceTotal = (variant.additionalPrice || 0) * configQuantity;
      const printChargeTotal = printLocationFee * configQuantity;
      const basePriceTotal = product.basePrice * configQuantity;

      totalVariantPrice += variantPriceTotal;
      totalPrintCharges += printChargeTotal;
      totalSubtotal += basePriceTotal + variantPriceTotal + printChargeTotal;
    }

    // Apply Bulk Discount on total subtotal
    let discountPct = 0;
    if (totalQuantity >= 50) discountPct = 0.20; // 20% off for 50+
    else if (totalQuantity >= 10) discountPct = 0.10; // 10% off for 10+
    
    snapshot.bulkDiscount = totalSubtotal * discountPct;
    const discountedSubtotal = totalSubtotal - snapshot.bulkDiscount;

    snapshot.variantPrice = totalVariantPrice;
    snapshot.printCharges = totalPrintCharges;
    snapshot.subtotal = discountedSubtotal;
    snapshot.shipping = discountedSubtotal > 0 && discountedSubtotal < 999 ? 100 : 0;
    snapshot.total = discountedSubtotal + snapshot.shipping + snapshot.tax;

    return snapshot;
  }
}
