import mongoose from "mongoose";
import { Product, IProduct, IProductVariant } from "../../models/Product";
import { InventoryTransaction } from "../../models/InventoryTransaction";
import { AppError } from "../../utils/AppError";

export interface SkuAllocation {
  productId: mongoose.Types.ObjectId;
  variantId: mongoose.Types.ObjectId;
  sku?: string;
  size?: string;
  color?: string;
  quantity: number;
}

export interface AggregatedAllocation {
  productId: mongoose.Types.ObjectId;
  variantId: mongoose.Types.ObjectId;
  sku?: string;
  size?: string;
  color?: string;
  totalQuantity: number;
}

export interface DeductionResult {
  success: boolean;
  failedAllocation?: AggregatedAllocation;
  deductedAllocations: AggregatedAllocation[];
}

/**
 * Authoritative Inventory Allocation Service
 *
 * Resolves exact SKU/variant inventory requirements for all order item types:
 * - Standard retail items (single variant)
 * - Bulk quotation items (single variant per item with isCustomized: true)
 * - Custom design items with multi-size/multi-color sizeDistribution configurations
 */
export class InventoryAllocationService {
  /**
   * Resolves raw allocations for a single order/cart item against the product document.
   */
  public static resolveItemAllocations(item: any, product: IProduct): SkuAllocation[] {
    const allocations: SkuAllocation[] = [];
    const prodId = product._id as mongoose.Types.ObjectId;

    // Case 1: Custom design with structured multi-variant configurations
    if (item.isCustomized && Array.isArray(item.customConfigurations) && item.customConfigurations.length > 0) {
      for (const config of item.customConfigurations) {
        if (Array.isArray(config.sizeDistribution) && config.sizeDistribution.length > 0) {
          for (const dist of config.sizeDistribution) {
            const qty = Math.floor(Number(dist.quantity || 0));
            if (!Number.isFinite(qty) || qty <= 0) continue;

            const targetSize = (dist.size || "").trim().toLowerCase();
            const targetColor = (config.color || "").trim().toLowerCase();

            // Match variant by exact (color + size)
            let matchedVariant = product.variants.find((v: IProductVariant) => {
              const vColor = (v.color || "").trim().toLowerCase();
              const vSize = (v.size || "").trim().toLowerCase();
              return vColor === targetColor && vSize === targetSize;
            });

            // Fallback: match by config.variantId if size matches or only 1 variant has that size
            if (!matchedVariant && config.variantId) {
              matchedVariant = product.variants.find((v: IProductVariant) => {
                if (!v._id) return false;
                return v._id.toString() === config.variantId.toString();
              });
            }

            if (!matchedVariant || !matchedVariant._id) {
              throw new AppError(
                `Unmappable inventory allocation for product ${product.name} (Color: ${config.color}, Size: ${dist.size})`,
                400,
                "INVENTORY_UNMAPPABLE"
              );
            }

            allocations.push({
              productId: prodId,
              variantId: matchedVariant._id,
              sku: matchedVariant.sku,
              size: matchedVariant.size,
              color: matchedVariant.color,
              quantity: qty,
            });
          }
        } else if (config.variantId) {
          // Configuration without explicit sizeDistribution breakdown (uses item quantity)
          const qty = Math.floor(Number(item.quantity || 1));
          if (qty > 0) {
            const matchedVariant = product.variants.find((v: IProductVariant) => v._id?.toString() === config.variantId.toString());
            if (!matchedVariant || !matchedVariant._id) {
              throw new AppError(`Variant unavailable for configuration in ${product.name}`, 400, "INVENTORY_UNMAPPABLE");
            }
            allocations.push({
              productId: prodId,
              variantId: matchedVariant._id,
              sku: matchedVariant.sku,
              size: matchedVariant.size,
              color: matchedVariant.color,
              quantity: qty,
            });
          }
        }
      }

      if (allocations.length === 0) {
        throw new AppError(`Custom item in product ${product.name} has no valid quantity allocations`, 400, "INVALID_ALLOCATION");
      }
      return allocations;
    }

    // Case 2: Normal products OR Bulk converted items (where isCustomized: true but customConfigurations is empty)
    const qty = Math.floor(Number(item.quantity || 0));
    if (!Number.isFinite(qty) || qty < 1) {
      throw new AppError(`Invalid item quantity for product ${product.name}: ${item.quantity}`, 400, "INVALID_QUANTITY");
    }

    if (!item.variantId) {
      throw new AppError(`Item in product ${product.name} is missing required variantId`, 400, "MISSING_VARIANT_ID");
    }

    // Match variant in product
    let matchedVariant = product.variants.find((v: IProductVariant) => v._id?.toString() === item.variantId.toString());

    // Secondary fallback: match by selectedSize and selectedColor if IDs drifted
    if (!matchedVariant && item.selectedSize) {
      matchedVariant = product.variants.find((v: IProductVariant) => {
        const sizeMatch = (v.size || "").toLowerCase() === item.selectedSize.toLowerCase();
        const colorMatch = item.selectedColor ? (v.color || "").toLowerCase() === item.selectedColor.toLowerCase() : true;
        return sizeMatch && colorMatch;
      });
    }

    if (!matchedVariant || !matchedVariant._id) {
      throw new AppError(`Variant unavailable for item: ${item.productName || product.name}`, 400, "VARIANT_NOT_FOUND");
    }

    allocations.push({
      productId: prodId,
      variantId: matchedVariant._id,
      sku: matchedVariant.sku,
      size: matchedVariant.size,
      color: matchedVariant.color,
      quantity: qty,
    });

    return allocations;
  }

  /**
   * Aggregates duplicate allocations for the same product and variant into a single combined demand.
   */
  public static aggregateAllocations(allocations: SkuAllocation[]): AggregatedAllocation[] {
    const map = new Map<string, AggregatedAllocation>();

    for (const alloc of allocations) {
      if (alloc.quantity < 1) continue;
      const key = `${alloc.productId.toString()}_${alloc.variantId.toString()}`;
      const existing = map.get(key);
      if (existing) {
        existing.totalQuantity += alloc.quantity;
      } else {
        map.set(key, {
          productId: alloc.productId,
          variantId: alloc.variantId,
          sku: alloc.sku,
          size: alloc.size,
          color: alloc.color,
          totalQuantity: alloc.quantity,
        });
      }
    }

    return Array.from(map.values());
  }

  /**
   * Resolves and aggregates all inventory requirements for an array of order/cart items.
   */
  public static async resolveOrderAllocations(items: any[]): Promise<AggregatedAllocation[]> {
    if (!Array.isArray(items) || items.length === 0) return [];

    const productIds = Array.from(new Set(items.map((i) => i.productId?.toString()).filter(Boolean)));
    const products = await Product.find({ _id: { $in: productIds } });
    const productMap = new Map<string, IProduct>(products.map((p) => [p._id.toString(), p]));

    const rawAllocations: SkuAllocation[] = [];

    for (const item of items) {
      const prodIdStr = item.productId?.toString();
      const product = productMap.get(prodIdStr);
      if (!product) {
        throw new AppError(`Product not found: ${item.productId}`, 404, "PRODUCT_NOT_FOUND");
      }
      const itemAllocations = this.resolveItemAllocations(item, product);
      rawAllocations.push(...itemAllocations);
    }

    return this.aggregateAllocations(rawAllocations);
  }

  /**
   * Validates that stock is available for all requested allocations without mutating the database.
   */
  public static async validateAvailability(allocations: AggregatedAllocation[]): Promise<void> {
    for (const alloc of allocations) {
      const product = await Product.findById(alloc.productId);
      if (!product || product.status !== "ACTIVE") {
        throw new AppError(`Product ${alloc.productId} is inactive or unavailable`, 400, "PRODUCT_UNAVAILABLE");
      }
      const variant = product.variants.find((v: IProductVariant) => v._id?.toString() === alloc.variantId.toString());
      if (!variant) {
        throw new AppError(`Variant ${alloc.variantId} not found in product ${product.name}`, 400, "VARIANT_NOT_FOUND");
      }
      if (variant.isAvailable === false) {
        throw new AppError(`Variant (${variant.sku || variant.size}) is marked unavailable`, 400, "VARIANT_UNAVAILABLE");
      }
      if (variant.stock < alloc.totalQuantity) {
        throw new AppError(
          `Insufficient stock for ${product.name} (${variant.size || ""} ${variant.color || ""}). Required: ${alloc.totalQuantity}, Available: ${variant.stock}`,
          400,
          "INSUFFICIENT_STOCK"
        );
      }
    }
  }

  /**
   * Atomically decrements stock for allocations with rollback protection on partial failure.
   */
  public static async deductInventory(
    orderId: mongoose.Types.ObjectId,
    allocations: AggregatedAllocation[]
  ): Promise<DeductionResult> {
    const deducted: AggregatedAllocation[] = [];

    for (const alloc of allocations) {
      if (alloc.totalQuantity < 1) continue;

      const result = await Product.updateOne(
        {
          _id: alloc.productId,
          variants: {
            $elemMatch: {
              _id: alloc.variantId,
              stock: { $gte: alloc.totalQuantity },
            },
          },
        },
        {
          $inc: { "variants.$.stock": -alloc.totalQuantity },
        }
      );

      if (result.modifiedCount === 1) {
        try {
          await InventoryTransaction.create({
            orderId,
            productId: alloc.productId,
            variantId: alloc.variantId,
            quantity: alloc.totalQuantity,
            type: "SALE",
          });
          deducted.push(alloc);
        } catch (createErr: any) {
          if (createErr.code !== 11000) {
            throw createErr;
          }
          // Idempotency: Unique (orderId, variantId, SALE) already exists from prior attempt.
          // Undo this run's duplicate decrement to prevent double-deduction.
          await Product.updateOne(
            { _id: alloc.productId, "variants._id": alloc.variantId },
            { $inc: { "variants.$.stock": alloc.totalQuantity } }
          );
        }
      } else {
        // Failed: Insufficient stock for this allocation. Roll back all allocations deducted in this run.
        await this.rollbackDeductions(orderId, deducted);
        return {
          success: false,
          failedAllocation: alloc,
          deductedAllocations: deducted,
        };
      }
    }

    return {
      success: true,
      deductedAllocations: deducted,
    };
  }

  /**
   * Rolls back deductions executed by an in-flight processing attempt.
   */
  public static async rollbackDeductions(
    orderId: mongoose.Types.ObjectId,
    allocations: AggregatedAllocation[]
  ): Promise<void> {
    for (const alloc of allocations) {
      await Product.updateOne(
        { _id: alloc.productId, "variants._id": alloc.variantId },
        { $inc: { "variants.$.stock": alloc.totalQuantity } }
      );
      await InventoryTransaction.deleteOne({
        orderId,
        productId: alloc.productId,
        variantId: alloc.variantId,
        type: "SALE",
      });
    }
  }

  /**
   * Restores inventory for an order upon cancellation or return only when an original SALE transaction exists.
   */
  public static async restoreInventoryForOrder(orderId: mongoose.Types.ObjectId): Promise<number> {
    const saleTransactions = await InventoryTransaction.find({
      orderId,
      type: "SALE",
    });

    let restoredCount = 0;

    for (const tx of saleTransactions) {
      // Re-increment stock
      await Product.updateOne(
        { _id: tx.productId, "variants._id": tx.variantId },
        { $inc: { "variants.$.stock": tx.quantity } }
      );

      // Create RESTOCK audit transaction
      await InventoryTransaction.create({
        orderId,
        productId: tx.productId,
        variantId: tx.variantId,
        quantity: tx.quantity,
        type: "RESTOCK",
      });

      // Remove the original SALE record so repeated cancel/refund calls cannot double-restore
      await InventoryTransaction.deleteOne({ _id: tx._id });
      restoredCount++;
    }

    return restoredCount;
  }
}
