import mongoose from "mongoose";
import { Product, IProduct, IProductVariant } from "../../models/Product";
import { InventoryTransaction, IInventoryTransaction } from "../../models/InventoryTransaction";
import { IReturnRequest } from "../../models/ReturnRequest";
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
   * Authoritative, idempotent inventory restoration for cancelled orders.
   * - Never deletes original SALE inventory transactions (immutable stock ledger).
   * - Considers both REFUND and existing RESTOCK records to prevent double-restocking.
   * - Uses partial unique index uniq_refund_order_variant for idempotency.
   * - Verifies Product and variant existence.
   * - Restores stock atomically using MongoDB session transactions (with standalone fallback).
   */
  public static async restoreCancelledOrderInventory(
    orderId: mongoose.Types.ObjectId,
    options: {
      refundId?: mongoose.Types.ObjectId;
      reason?: string;
      session?: mongoose.ClientSession | null;
    } = {}
  ): Promise<{ restoredCount: number; alreadyRestored: boolean }> {
    const saleTransactions = await InventoryTransaction.find({
      orderId,
      type: "SALE",
    }).session(options.session || null);

    if (saleTransactions.length === 0) {
      return { restoredCount: 0, alreadyRestored: false };
    }

    let restoredCount = 0;
    let anyAlreadyRestored = false;

    for (const saleTx of saleTransactions) {
      // 1. Check if already restored via REFUND or legacy RESTOCK
      const existingRefund = await InventoryTransaction.findOne({
        orderId,
        variantId: saleTx.variantId,
        type: 'REFUND'
      }).session(options.session || null);

      const existingRestock = await InventoryTransaction.findOne({
        orderId,
        variantId: saleTx.variantId,
        type: 'RESTOCK'
      }).session(options.session || null);

      if (existingRefund || existingRestock) {
        anyAlreadyRestored = true;
        const existingTx = existingRefund || existingRestock;
        if (existingTx && existingTx.quantity !== saleTx.quantity) {
          throw new AppError(
            `Inventory reconciliation required: existing restoration quantity (${existingTx.quantity}) differs from original sale quantity (${saleTx.quantity}) for order ${orderId}`,
            409,
            'INVENTORY_RECONCILIATION_REQUIRED'
          );
        }
        if (existingTx && existingTx.status === 'PENDING') {
          const reconciled = await InventoryAllocationService.reconcilePendingTransaction(existingTx, {
            productId: saleTx.productId,
            variantId: saleTx.variantId,
            quantity: saleTx.quantity
          });
          if (reconciled) restoredCount++;
        }
        continue;
      }

      // 2. Perform atomic stock increment and ledger record
      let session: mongoose.ClientSession | null = null;
      try {
        session = await mongoose.startSession();
        session.startTransaction();

        const [createdTx] = await InventoryTransaction.create(
          [
            {
              orderId,
              productId: saleTx.productId,
              variantId: saleTx.variantId,
              quantity: saleTx.quantity,
              type: 'REFUND',
              refundId: options.refundId,
              status: 'COMPLETED',
              reason: options.reason || 'Order cancellation stock restoration'
            }
          ],
          { session }
        );

        const updateRes = await Product.updateOne(
          { _id: saleTx.productId, 'variants._id': saleTx.variantId },
          {
            $inc: { 'variants.$.stock': saleTx.quantity },
            $push: {
              'variants.$.recentTxIds': {
                $each: [createdTx._id],
                $slice: -20
              }
            }
          },
          { session }
        );

        if (updateRes.matchedCount === 0) {
          await session.abortTransaction();
          throw new AppError(
            `Product ${saleTx.productId} or variant ${saleTx.variantId} not found during cancellation stock restoration`,
            404,
            'PRODUCT_NOT_FOUND'
          );
        }

        await session.commitTransaction();
        restoredCount++;
      } catch (txErr: unknown) {
        if (session && session.inTransaction()) {
          await session.abortTransaction();
        }

        const errMessage = txErr instanceof Error ? txErr.message : String(txErr);
        let errCode: number | undefined;
        if (txErr && typeof txErr === 'object' && 'code' in txErr) {
          const codeVal = (txErr as { code: unknown }).code;
          if (typeof codeVal === 'number') errCode = codeVal;
        }

        if (errCode === 11000) {
          // Idempotent duplicate: check persisted record
          const existingAfterConflict = await InventoryTransaction.findOne({
            orderId,
            variantId: saleTx.variantId,
            type: 'REFUND'
          });
          if (existingAfterConflict) {
            if (existingAfterConflict.quantity !== saleTx.quantity) {
              throw new AppError(
                `Reconciliation conflict: Duplicate REFUND record quantity (${existingAfterConflict.quantity}) differs from cancellation quantity (${saleTx.quantity})`,
                409,
                'INVENTORY_RECONCILIATION_REQUIRED'
              );
            }
            anyAlreadyRestored = true;
            continue;
          }
        }

        const isNotReplicaSet = errMessage.includes('replica set') ||
                                errMessage.includes('Transaction numbers are only allowed');

        if (isNotReplicaSet) {
          // Standalone MongoDB fallback with durable intent
          let pendingTx: IInventoryTransaction;
          try {
            pendingTx = await InventoryTransaction.create({
              orderId,
              productId: saleTx.productId,
              variantId: saleTx.variantId,
              quantity: saleTx.quantity,
              type: 'REFUND',
              refundId: options.refundId,
              status: 'PENDING',
              reason: options.reason || 'Order cancellation stock restoration'
            });
          } catch (dupErr: unknown) {
            const isDup = dupErr && typeof dupErr === 'object' && 'code' in dupErr && (dupErr as { code: unknown }).code === 11000;
            if (isDup) {
              const existing = await InventoryTransaction.findOne({ orderId, variantId: saleTx.variantId, type: 'REFUND' });
              if (existing) {
                if (existing.quantity !== saleTx.quantity) {
                  throw new AppError('Quantity mismatch on duplicate cancellation restoration', 409, 'INVENTORY_RECONCILIATION_REQUIRED');
                }
                anyAlreadyRestored = true;
                continue;
              }
            }
            throw dupErr;
          }

          await Product.updateOne(
            { _id: saleTx.productId, 'variants._id': saleTx.variantId },
            { $push: { 'variants.$.pendingTxIds': pendingTx._id } }
          );

          const prodUpdate = await Product.updateOne(
            {
              _id: saleTx.productId,
              'variants._id': saleTx.variantId,
              'variants.recentTxIds': { $ne: pendingTx._id }
            },
            {
              $inc: { 'variants.$.stock': saleTx.quantity },
              $push: {
                'variants.$.recentTxIds': { $each: [pendingTx._id], $slice: -20 }
              },
              $pull: {
                'variants.$.pendingTxIds': pendingTx._id
              }
            }
          );

          if (prodUpdate.matchedCount === 0) {
            await InventoryTransaction.updateOne(
              { _id: pendingTx._id },
              { $set: { status: 'FAILED', reason: 'Product or variant not found' } }
            );
            throw new AppError(
              `Product ${saleTx.productId} or variant ${saleTx.variantId} not found during cancellation stock restoration`,
              404,
              'PRODUCT_NOT_FOUND'
            );
          }

          await InventoryTransaction.updateOne(
            { _id: pendingTx._id },
            { $set: { status: 'COMPLETED' } }
          );
          restoredCount++;
        } else {
          throw txErr;
        }
      } finally {
        if (session) {
          await session.endSession();
        }
      }
    }

    return {
      restoredCount,
      alreadyRestored: anyAlreadyRestored && restoredCount === 0
    };
  }

  /**
   * Preserved for backward compatibility. Delegates to restoreCancelledOrderInventory.
   */
  public static async restoreInventoryForOrder(orderId: mongoose.Types.ObjectId): Promise<number> {
    const res = await InventoryAllocationService.restoreCancelledOrderInventory(orderId);
    return res.restoredCount;
  }

  /**
   * Restores inventory for an accepted ReturnRequest in an atomic, crash-safe and idempotent manner.
   * - Aggregates multiple lines for identical variants.
   * - Protects historical RETURN records without returnId from accidental double-restocking.
   * - Enforces uniqueness per returnId and variantId via partial index uniq_return_variant.
   * - Uses MongoDB session transactions on replica sets.
   * - Uses durable operation intent (status: PENDING) + stock-side marker (recentTxIds) on standalone MongoDB.
   * - Recovers safely across process crashes, server restarts, DB errors and duplicate deliveries.
   */
  public static async restoreReturnInventory(
    returnRequest: IReturnRequest | { _id: mongoose.Types.ObjectId; items: Array<{ productId: mongoose.Types.ObjectId; variantId: mongoose.Types.ObjectId; quantity: number }>; inventoryRestored?: boolean; inventoryRestoredAt?: Date; requiresInventoryReconciliation?: boolean; inventoryReconciliationReason?: string },
    orderId: mongoose.Types.ObjectId,
    options: { allowHistoricalReconciliation?: boolean; session?: mongoose.ClientSession | null } = {}
  ): Promise<{ restoredCount: number; alreadyRestored: boolean; requiresReconciliation?: boolean }> {
    if (!returnRequest || !Array.isArray(returnRequest.items) || returnRequest.items.length === 0) {
      return { restoredCount: 0, alreadyRestored: false };
    }

    const returnId = returnRequest._id as mongoose.Types.ObjectId;

    // If return request document is already marked as inventory restored, short-circuit
    if (returnRequest.inventoryRestored) {
      return { restoredCount: 0, alreadyRestored: true };
    }

    // 1. Normalize and aggregate items by variantId
    const aggregated = new Map<string, { productId: mongoose.Types.ObjectId; variantId: mongoose.Types.ObjectId; quantity: number }>();
    for (const item of returnRequest.items) {
      const key = item.variantId.toString();
      const existing = aggregated.get(key);
      const qty = Number(item.quantity) || 1;
      if (existing) {
        existing.quantity += qty;
      } else {
        aggregated.set(key, {
          productId: item.productId,
          variantId: item.variantId,
          quantity: qty,
        });
      }
    }

    let restoredCount = 0;
    const entries = Array.from(aggregated.values());

    for (const entry of entries) {
      // 2A. Historical Inventory Guard:
      // Check if there is an unassociated historical RETURN record for this orderId and variantId lacking returnId.
      const historicalTx = await InventoryTransaction.findOne({
        orderId,
        variantId: entry.variantId,
        type: 'RETURN',
        returnId: null
      }).session(options.session || null);

      if (historicalTx && !options.allowHistoricalReconciliation) {
        // Historical RETURN transaction exists without returnId.
        // Automatically repeating restoration risks double-restocking.
        // Mark ReturnRequest as requiring manual reconciliation and stop automatic restoration.
        await mongoose.model('ReturnRequest').updateOne(
          { _id: returnId },
          {
            $set: {
              requiresInventoryReconciliation: true,
              inventoryReconciliationReason: `Historical RETURN record ${historicalTx._id} exists for order ${orderId} and variant ${entry.variantId} without returnId.`
            }
          },
          { session: options.session || undefined }
        );
        return {
          restoredCount,
          alreadyRestored: false,
          requiresReconciliation: true
        };
      }

      // 2B. Pre-check idempotency: Does a RETURN transaction already exist for this (returnId, variantId)?
      const existingTx = await InventoryTransaction.findOne({
        returnId,
        variantId: entry.variantId,
        type: 'RETURN'
      }).session(options.session || null);

      if (existingTx) {
        if (existingTx.status === 'COMPLETED') {
          continue;
        }
        // If transaction exists but is PENDING (e.g. process crashed during previous restoration),
        // reconcile it safely using the stock-side marker.
        const reconciled = await InventoryAllocationService.reconcilePendingTransaction(existingTx, entry, { session: options.session || undefined });
        if (reconciled) {
          restoredCount++;
        } else {
          // Defect D1: Failed pending-inventory reconciliation must fail explicitly
          return {
            restoredCount,
            alreadyRestored: false,
            requiresReconciliation: true
          };
        }
        continue;
      }

      // If caller supplied an existing session, execute directly inside caller's transaction
      if (options.session) {
        const [createdTx] = await InventoryTransaction.create(
          [
            {
              returnId,
              orderId,
              productId: entry.productId,
              variantId: entry.variantId,
              quantity: entry.quantity,
              type: 'RETURN',
              status: 'COMPLETED'
            }
          ],
          { session: options.session }
        );

        const updateRes = await Product.updateOne(
          { _id: entry.productId, 'variants._id': entry.variantId },
          {
            $inc: { 'variants.$.stock': entry.quantity },
            $push: {
              'variants.$.recentTxIds': {
                $each: [createdTx._id],
                $slice: -20
              }
            }
          },
          { session: options.session }
        );

        if (updateRes.matchedCount === 0) {
          throw new AppError(
            `Product ${entry.productId} or variant ${entry.variantId} not found during stock restoration`,
            404,
            'PRODUCT_NOT_FOUND'
          );
        }
        restoredCount++;
        continue;
      }

      // 3. Attempt MongoDB session transaction if replica set is supported
      let session: mongoose.ClientSession | null = null;

      try {
        session = await mongoose.startSession();
        session.startTransaction();

        const [createdTx] = await InventoryTransaction.create(
          [
            {
              returnId,
              orderId,
              productId: entry.productId,
              variantId: entry.variantId,
              quantity: entry.quantity,
              type: 'RETURN',
              status: 'COMPLETED'
            }
          ],
          { session }
        );

        const updateRes = await Product.updateOne(
          { _id: entry.productId, 'variants._id': entry.variantId },
          {
            $inc: { 'variants.$.stock': entry.quantity },
            $push: {
              'variants.$.recentTxIds': {
                $each: [createdTx._id],
                $slice: -20
              }
            }
          },
          { session }
        );

        if (updateRes.matchedCount === 0) {
          await session.abortTransaction();
          throw new AppError(
            `Product ${entry.productId} or variant ${entry.variantId} not found during stock restoration`,
            404,
            'PRODUCT_NOT_FOUND'
          );
        }

        await session.commitTransaction();
        restoredCount++;
      } catch (txErr: unknown) {
        if (session && session.inTransaction()) {
          await session.abortTransaction();
        }

        const errMessage = txErr instanceof Error ? txErr.message : String(txErr);
        let errCode: number | undefined;
        if (txErr && typeof txErr === 'object' && 'code' in txErr) {
          const codeVal = txErr.code;
          if (typeof codeVal === 'number') errCode = codeVal;
        }
        const isNotReplicaSet = errMessage.includes('replica set') ||
                                errMessage.includes('Transaction numbers are only allowed');

        if (isNotReplicaSet) {
          // Standalone MongoDB durable workflow:
          // Step 1: Create durable transaction intent with status: PENDING
          let pendingTx: IInventoryTransaction;
          try {
            pendingTx = await InventoryTransaction.create({
              returnId,
              orderId,
              productId: entry.productId,
              variantId: entry.variantId,
              quantity: entry.quantity,
              type: 'RETURN',
              status: 'PENDING'
            });
          } catch (createErr: unknown) {
            let createErrCode: number | undefined;
            if (createErr && typeof createErr === 'object' && 'code' in createErr) {
              const cVal = createErr.code;
              if (typeof cVal === 'number') createErrCode = cVal;
            }
            if (createErrCode === 11000) {
              // Another concurrent request created the transaction record
              const existing = await InventoryTransaction.findOne({ returnId, variantId: entry.variantId, type: 'RETURN' });
              if (existing && existing.status === 'PENDING') {
                const reconciled = await InventoryAllocationService.reconcilePendingTransaction(existing, entry);
                if (reconciled) restoredCount++;
              }
              continue;
            }
            throw createErr;
          }
          // Step 2: Atomically increment stock and record durable pendingTx._id
          const updateRes = await Product.updateOne(
            {
              _id: entry.productId,
              variants: {
                $elemMatch: {
                  _id: entry.variantId,
                  pendingTxIds: { $ne: pendingTx._id }
                }
              }
            },
            {
              $inc: { 'variants.$.stock': entry.quantity },
              $addToSet: { 'variants.$.pendingTxIds': pendingTx._id },
              $push: {
                'variants.$.recentTxIds': {
                  $each: [pendingTx._id],
                  $slice: -20
                }
              }
            }
          );

          if (updateRes.matchedCount === 0) {
            const prodExists = await Product.findOne({
              _id: entry.productId,
              'variants._id': entry.variantId
            });
            if (!prodExists) {
              await InventoryTransaction.updateOne(
                { _id: pendingTx._id },
                { $set: { status: 'FAILED', reason: 'Product or variant not found' } }
              );
              throw new AppError(
                `Product ${entry.productId} or variant ${entry.variantId} not found during stock restoration`,
                404,
                'PRODUCT_NOT_FOUND'
              );
            }
            const alreadyIncremented = await Product.findOne({
              _id: entry.productId,
              variants: {
                $elemMatch: {
                  _id: entry.variantId,
                  $or: [
                    { pendingTxIds: pendingTx._id },
                    { recentTxIds: pendingTx._id }
                  ]
                }
              }
            });
            if (!alreadyIncremented) {
              await InventoryTransaction.updateOne(
                { _id: pendingTx._id },
                { $set: { status: 'FAILED', reason: 'Stock update failed to match variant' } }
              );
              throw new AppError('Stock update failed to match variant', 500);
            }
          }

          // Step 3: Transition transaction to COMPLETED
          await InventoryTransaction.updateOne(
            { _id: pendingTx._id },
            { $set: { status: 'COMPLETED' } }
          );

          // Step 4: Safely release the pending marker now that transaction is durable
          await Product.updateOne(
            { _id: entry.productId, 'variants._id': entry.variantId },
            { $pull: { 'variants.$.pendingTxIds': pendingTx._id } }
          );
          restoredCount++;
        } else if (errCode === 11000 || errCode === 112 || errMessage.includes('WriteConflict') || errMessage.includes('TransientTransactionError')) {
          // Concurrent transaction conflict or unique index duplicate in replica set: safely continue
          continue;
        } else {
          throw txErr;
        }
      } finally {
        if (session) {
          await session.endSession();
        }
      }
    }

    // 4. Verify that all variants were successfully completed before marking return request inventoryRestored
    let allCompleted = true;
    for (const entry of entries) {
      const completed = await InventoryTransaction.findOne({
        returnId,
        variantId: entry.variantId,
        type: 'RETURN',
        status: 'COMPLETED'
      }).session(options.session || null);
      if (!completed) {
        allCompleted = false;
        break;
      }
    }

    if (allCompleted && entries.length > 0) {
      returnRequest.inventoryRestored = true;
      returnRequest.inventoryRestoredAt = new Date();
      await mongoose.model('ReturnRequest').updateOne(
        { _id: returnId },
        { $set: { inventoryRestored: true, inventoryRestoredAt: new Date() } },
        { session: options.session || undefined }
      );
    }

    return { restoredCount, alreadyRestored: restoredCount === 0 && allCompleted };
  }

  /**
   * Reconciles a single PENDING return transaction by checking whether its ID was already
   * recorded in the product variant's recentTxIds.
   */
  public static async reconcilePendingTransaction(
    tx: IInventoryTransaction,
    entry: { productId: mongoose.Types.ObjectId; variantId: mongoose.Types.ObjectId; quantity: number },
    options: { session?: mongoose.ClientSession } = {}
  ): Promise<boolean> {
    // Verify product and variant existence first
    const prodExists = await Product.findOne({
      _id: entry.productId,
      'variants._id': entry.variantId
    }).session(options.session || null);
    if (!prodExists) {
      await InventoryTransaction.updateOne(
        { _id: tx._id },
        { $set: { status: 'FAILED', reason: 'Product or variant not found during reconciliation' } },
        { session: options.session || undefined }
      );
      return false;
    }

    // Check if the variant already recorded this transaction in either durable pendingTxIds or recentTxIds
    const product = await Product.findOne({
      _id: entry.productId,
      variants: {
        $elemMatch: {
          _id: entry.variantId,
          $or: [
            { pendingTxIds: tx._id },
            { recentTxIds: tx._id }
          ]
        }
      }
    }).session(options.session || null);

    if (product) {
      // Stock was ALREADY incremented before the crash/interruption.
      // Do NOT increment stock again. Transition to COMPLETED and release pending marker.
      await InventoryTransaction.updateOne({ _id: tx._id }, { $set: { status: 'COMPLETED' } }, { session: options.session || undefined });
      await Product.updateOne(
        { _id: entry.productId, 'variants._id': entry.variantId },
        { $pull: { 'variants.$.pendingTxIds': tx._id } },
        { session: options.session || undefined }
      );
      return true;
    }

    // Stock was NOT incremented before the crash. Atomically apply increment and record marker.
    const updateRes = await Product.updateOne(
      {
        _id: entry.productId,
        variants: {
          $elemMatch: {
            _id: entry.variantId,
            pendingTxIds: { $ne: tx._id }
          }
        }
      },
      {
        $inc: { 'variants.$.stock': entry.quantity },
        $addToSet: { 'variants.$.pendingTxIds': tx._id },
        $push: {
          'variants.$.recentTxIds': {
            $each: [tx._id],
            $slice: -20
          }
        }
      },
      { session: options.session || undefined }
    );

    if (updateRes.matchedCount === 0) {
      return false;
    }

    await InventoryTransaction.updateOne({ _id: tx._id }, { $set: { status: 'COMPLETED' } }, { session: options.session || undefined });
    await Product.updateOne(
      { _id: entry.productId, 'variants._id': entry.variantId },
      { $pull: { 'variants.$.pendingTxIds': tx._id } },
      { session: options.session || undefined }
    );
    return true;
  }

  /**
   * Recovery procedure for application startup or scheduled reconciliation:
   * Finds all PENDING RETURN and REFUND transactions and brings them to completion deterministically.
   */
  public static async reconcilePendingInventoryRestorations(
    optionsOrGuard?: {
      withFence?: <T>(fn: (session: mongoose.ClientSession) => Promise<T>) => Promise<T>;
      leaseGuard?: () => Promise<boolean> | boolean;
    } | (() => Promise<boolean> | boolean)
  ): Promise<{ resolvedCount: number }> {
    const withFence = (typeof optionsOrGuard === 'object' && optionsOrGuard !== null && 'withFence' in optionsOrGuard)
      ? optionsOrGuard.withFence
      : undefined;
    const leaseGuard = typeof optionsOrGuard === 'function'
      ? optionsOrGuard
      : ((typeof optionsOrGuard === 'object' && optionsOrGuard !== null && 'leaseGuard' in optionsOrGuard) ? optionsOrGuard.leaseGuard : undefined);

    const pendingTransactions = await InventoryTransaction.find({
      type: { $in: ['RETURN', 'REFUND'] },
      status: 'PENDING'
    });

    let resolvedCount = 0;
    for (const tx of pendingTransactions) {
      if (leaseGuard) {
        const valid = await leaseGuard();
        if (!valid) {
          console.warn('[INVENTORY_RESTORE] Worker lost lease ownership during pending transaction reconciliation; aborting remaining mutations');
          break;
        }
      }

      if (withFence) {
        try {
          await withFence(async (session) => {
            const reconciled = await InventoryAllocationService.reconcilePendingTransaction(tx, {
              productId: tx.productId,
              variantId: tx.variantId,
              quantity: tx.quantity
            }, { session });
            if (reconciled) resolvedCount++;
          });
        } catch (fenceErr) {
          console.warn('[INVENTORY_RESTORE] Fenced transaction aborted:', fenceErr);
          break;
        }
      } else {
        const reconciled = await InventoryAllocationService.reconcilePendingTransaction(tx, {
          productId: tx.productId,
          variantId: tx.variantId,
          quantity: tx.quantity
        });
        if (reconciled) resolvedCount++;
      }
    }

    return { resolvedCount };
  }

  public static restoreInventoryForReturn = InventoryAllocationService.restoreReturnInventory;
}
