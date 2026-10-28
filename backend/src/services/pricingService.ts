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

    // Canonical currency unit: RUPEES (Razorpay gateway performs paise conversion at boundary)
    const normalizedBasePrice = Math.round(Number(product.basePrice || 0));

    let snapshot: IPricingSnapshot = {
      basePrice: normalizedBasePrice,
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
      const parsedQty = Math.floor(Number(quantity));
      if (!Number.isFinite(parsedQty) || parsedQty < 1) {
        throw new AppError("Quantity must be a positive integer", 400);
      }

      const variant = product.variants.find(
        (v) => (v._id && v._id.toString() === variantId.toString()) || v.sku === variantId.toString()
      );
      if (!variant || !variant.isAvailable) {
        throw new AppError("Variant is unavailable", 400);
      }

      const normalizedVariantPrice = Math.round(Number(variant.additionalPrice || 0));
      snapshot.variantPrice = normalizedVariantPrice;
      const unitPrice = snapshot.basePrice + snapshot.variantPrice;
      snapshot.subtotal = unitPrice * parsedQty;
      
      // Line item pricing snapshot reflects product subtotal; top-level shipping calculated at cart/order level
      snapshot.shipping = 0;
      snapshot.total = snapshot.subtotal + snapshot.tax;
      return snapshot;
    }

    // Custom Configuration Calculation
    if (!customConfigurations || customConfigurations.length === 0) {
      throw new AppError("Custom configurations missing", 400);
    }

    let totalSubtotal = 0;
    let totalQuantity = 0;
    let totalPrintCharges = 0;
    let totalVariantPrice = 0; // Cumulative for display

    for (const config of customConfigurations) {
      const variant = product.variants.find(
        (v) => (v._id && v._id.toString() === config.variantId.toString())
      );
      if (!variant || !variant.isAvailable) {
        throw new AppError(`Variant ${config.variantId} is unavailable`, 400);
      }

      const configQuantity = (config.sizeDistribution || []).reduce((acc, curr) => {
        const q = Math.floor(Number(curr.quantity));
        if (!Number.isFinite(q) || q < 0) {
          throw new AppError("Size distribution quantity must be a non-negative integer", 400);
        }
        return acc + q;
      }, 0);

      if (configQuantity < 1) continue;

      totalQuantity += configQuantity;

      let printLocationFee = 0;
      if (config.designId) {
        const design = await CustomDesign.findById(config.designId);
        if (!design) throw new AppError(`Design ${config.designId} not found`, 404);
        
        const rawMethod = product.printMethods?.[0] || "DEFAULT";
        const methodKey = rawMethod.toUpperCase().replace(/\s+/g, '_');
        const rules = PRINT_PRICING_RULES[methodKey] || PRINT_PRICING_RULES["DEFAULT"];
        // Location-independent printing fee per customized unit
        printLocationFee = rules.unitPrintingFee ?? rules.front ?? PricingService.PRINT_LOCATION_FEE;
      } else {
        printLocationFee = PricingService.PRINT_LOCATION_FEE;
      }

      const normalizedVariantPrice = Math.round(Number(variant.additionalPrice || 0));

      const variantPriceTotal = normalizedVariantPrice * configQuantity;
      const printChargeTotal = printLocationFee * configQuantity;
      const basePriceTotal = normalizedBasePrice * configQuantity;

      totalVariantPrice += variantPriceTotal;
      totalPrintCharges += printChargeTotal;
      totalSubtotal += basePriceTotal + variantPriceTotal + printChargeTotal;
    }

    if (totalQuantity < 1) {
      throw new AppError("Total quantity for custom item must be at least 1", 400);
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
    snapshot.shipping = 0; // Top-level shipping evaluated ONCE at cart/order level
    snapshot.total = discountedSubtotal + snapshot.tax;

    return snapshot;
  }
}
