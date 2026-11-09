import mongoose from 'mongoose';
import { Order, IOrder, ICancellationOperation } from '../models/Order';
import { Shipment } from '../models/Shipment';
import { PrintJob } from '../models/PrintJob';
import { AuditLog } from '../models/AuditLog';
import { Payment } from '../models/Payment';
import { Refund, IRefund } from '../models/Refund';
import { Invoice, InvoiceStatus } from '../models/Invoice';
import { AppError } from '../utils/AppError';
import { createInternalRefund } from './payment/refundService';
import { InventoryAllocationService } from './inventory/inventoryAllocationService';

export type CancellationSource = 'CUSTOMER' | 'ADMIN' | 'SYSTEM';

export interface CancelOrderInput {
  orderId: string;
  actorId?: string;
  actorRole?: string;
  reason?: string;
  source: CancellationSource;
  /**
   * Customer cancellations are blocked once production of a custom-printed item
   * has been confirmed. Admin cancellations keep the previous, more permissive
   * behaviour so operations staff can still resolve exceptional cases.
   */
  enforceCustomPrintLock?: boolean;
}

export interface CancelOrderOutcome {
  order: IOrder;
  refund: IRefund | null;
  refundError: string | null;
  inventoryError: string | null;
}

export interface CancelOrderItemRequest {
  itemId: string;
  quantity?: number;
}

export interface CancelOrderItemsInput {
  orderId: string;
  items: CancelOrderItemRequest[];
  actorId?: string;
  actorRole?: string;
  reason?: string;
  source: CancellationSource;
  enforceCustomPrintLock?: boolean;
  operationId?: string;
}

export interface CancelOrderItemsOutcome {
  order: IOrder;
  refund: IRefund | null;
  refundAmount: number;
  refundError: string | null;
  inventoryError: string | null;
  fullyCancelled: boolean;
  operationId: string;
}

const BLOCKED_ORDER_STATUSES = ['SHIPPED', 'DELIVERED', 'CANCELLED'];
const HANDED_OFF_SHIPMENT_STATUSES = ['PICKED_UP', 'SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'];
const CONFIRMED_PRINT_STATES = ['READY_FOR_PRINT', 'PRINTING', 'QUALITY_CHECK', 'PRINTED', 'COMPLETED'];

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Cancels an order and, when it was paid, initiates the automatic refund.
 *
 * The order is marked CANCELLED *before* the gateway call. This is deliberate:
 * the cancellation must not be lost when Razorpay is slow, rejects the refund or
 * the network times out. Any refund failure is reported back to the admin panel
 * (and recorded as a refund/audit record) so it can be retried manually.
 */
export async function cancelOrderWithRefund(input: CancelOrderInput): Promise<CancelOrderOutcome> {
  const { orderId, actorId, actorRole, source, enforceCustomPrintLock } = input;
  const reason = (input.reason || '').trim() || (source === 'CUSTOMER' ? 'CUSTOMER_CANCELLED' : `${source}_CANCELLED`);

  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    throw new AppError('Invalid order ID', 400);
  }

  const order = await Order.findById(orderId);
  if (!order) {
    throw new AppError('Order not found', 404);
  }

  if (BLOCKED_ORDER_STATUSES.includes(order.status)) {
    throw new AppError(`Order in ${order.status} status cannot be cancelled`, 400);
  }

  // An order must not be cancelled once the carrier has taken physical custody,
  // even if the order-level status has not been advanced to SHIPPED yet.
  const shipment = await Shipment.findOne({ orderId: order._id });
  if (shipment && HANDED_OFF_SHIPMENT_STATUSES.includes(shipment.status)) {
    throw new AppError('Order has already been shipped and cannot be cancelled', 400);
  }

  if (enforceCustomPrintLock) {
    const printJobs = await PrintJob.find({ orderId: order._id });
    const isCustomConfirmed = printJobs.some((pj) => CONFIRMED_PRINT_STATES.includes(pj.status));
    if (isCustomConfirmed) {
      throw new AppError(
        'Custom-printed orders cannot be cancelled once customization has been confirmed by Samrat Fashion.',
        400
      );
    }
  }

  // Atomically flip the status so two simultaneous cancel requests cannot both
  // run the refund flow (and so the admin panel sees the cancellation immediately).
  const cancelledOrder = await Order.findOneAndUpdate(
    {
      _id: order._id,
      status: { $nin: BLOCKED_ORDER_STATUSES },
    } as any,
    {
      $set: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancellationReason: reason,
        cancellationSource: source,
      },
    },
    { returnDocument: 'after', lean: false }
  );

  if (!cancelledOrder) {
    throw new AppError('Order status changed and can no longer be cancelled', 409, 'ORDER_NOT_CANCELLABLE');
  }

  let inventoryError: string | null = null;
  try {
    await InventoryAllocationService.restoreCancelledOrderInventory(cancelledOrder._id, {
      reason: `${source === 'CUSTOMER' ? 'Customer' : 'Admin'} Order Cancellation: ${reason}`,
    });
  } catch (err) {
    inventoryError = errorMessage(err);
    console.error(`[CANCEL] Inventory restore failed for order ${cancelledOrder._id}:`, err);
  }

  const auditActorId = actorId ? new mongoose.Types.ObjectId(actorId) : cancelledOrder.userId;

  let refund: IRefund | null = null;
  let refundError: string | null = null;

  if (cancelledOrder.paymentStatus === 'PAID') {
    try {
      const payment = await Payment.findOne({ orderId: cancelledOrder._id });
      const remainingRefundable = payment
        ? Math.max(0, payment.amount - (payment.refundedAmount || 0) - (payment.pendingRefundAmount || 0))
        : cancelledOrder.total;
      const refundAmount = Math.min(cancelledOrder.total, remainingRefundable);

      if (refundAmount > 0) {
        refund = await createInternalRefund({
          orderId: cancelledOrder._id.toString(),
          amount: refundAmount,
          reason: `${source === 'CUSTOMER' ? 'Customer' : 'Admin'} Order Cancellation: ${reason}`,
          actorId: actorId || cancelledOrder.userId.toString(),
          actorRole: actorRole || source,
        });
      } else if (payment && (payment.pendingRefundAmount || 0) > 0) {
        refundError = 'A previous refund attempt is still pending and will be reconciled automatically.';
      }

      if (refund) {
        const paymentAfterRefund = await Payment.findOne({ orderId: cancelledOrder._id });
        const isFullyRefunded =
          refund.status === 'PROCESSED' &&
          Boolean(paymentAfterRefund) &&
          (paymentAfterRefund!.refundedAmount || 0) >= paymentAfterRefund!.amount;

        if (isFullyRefunded) {
          cancelledOrder.paymentStatus = 'REFUNDED';
          await cancelledOrder.save();
        }
      }
    } catch (err) {
      refundError = errorMessage(err);
      console.error(`[CANCEL] Automatic refund failed for order ${cancelledOrder._id}:`, err);

      // createInternalRefund persists the refund intent before calling the gateway,
      // so on failure there is usually a FAILED/UNKNOWN record to show the admin.
      try {
        refund = await Refund.findOne({ orderId: cancelledOrder._id }).sort({ createdAt: -1 });
      } catch (lookupErr) {
        console.error(`[CANCEL] Failed to load refund record for order ${cancelledOrder._id}:`, lookupErr);
      }

      try {
        await AuditLog.create({
          actorId: auditActorId,
          actorRole: actorRole || source,
          action: 'ORDER_CANCEL_REFUND_FAILED',
          entityType: 'ORDER',
          entityId: cancelledOrder._id,
          metadata: {
            reason,
            error: refundError,
            refundId: refund?._id,
            refundStatus: refund?.status,
          },
        });
      } catch (auditErr) {
        console.error(`[CANCEL] Failed to write refund failure audit log for order ${cancelledOrder._id}:`, auditErr);
      }
    }
  }

  try {
    await AuditLog.create({
      actorId: auditActorId,
      actorRole: actorRole || source,
      action: source === 'ADMIN' ? 'ADMIN_ORDER_CANCELLED' : 'ORDER_CANCELLED',
      entityType: 'ORDER',
      entityId: cancelledOrder._id,
      metadata: {
        reason,
        source,
        refundId: refund?._id,
        refundStatus: refund?.status,
        refundError,
        inventoryError,
      },
    });
  } catch (auditErr) {
    console.error(`[CANCEL] Failed to write cancellation audit log for order ${cancelledOrder._id}:`, auditErr);
  }

  return { order: cancelledOrder, refund, refundError, inventoryError };
}

/**
 * Cancels specific items (and quantities) within an order.
 * - Restores inventory only for the cancelled quantities.
 * - Computes prorated item refunds (accounting for unit price & coupon discounts).
 * - Updates the order total and invoice snapshots.
 * - If all items in the order become cancelled, automatically transitions order to CANCELLED.
 */
export async function cancelOrderItemsWithRefund(input: CancelOrderItemsInput): Promise<CancelOrderItemsOutcome> {
  const { orderId, items, actorId, actorRole, source, enforceCustomPrintLock } = input;
  const reason = (input.reason || '').trim() || (source === 'CUSTOMER' ? 'CUSTOMER_PARTIAL_CANCELLED' : `${source}_PARTIAL_CANCELLED`);

  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    throw new AppError('Invalid order ID', 400);
  }

  if (!Array.isArray(items) || items.length === 0) {
    throw new AppError('At least one item must be specified for cancellation', 400);
  }

  const opId = (input.operationId || '').trim() || new mongoose.Types.ObjectId().toString();

  // Retry loop for optimistic concurrency control on cancellationVersion
  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    attempts++;

    const order = await Order.findById(orderId);
    if (!order) {
      throw new AppError('Order not found', 404);
    }

    if (BLOCKED_ORDER_STATUSES.includes(order.status)) {
      throw new AppError(`Order in ${order.status} status cannot be cancelled`, 400);
    }

    const shipment = await Shipment.findOne({ orderId: order._id });
    if (shipment && HANDED_OFF_SHIPMENT_STATUSES.includes(shipment.status)) {
      throw new AppError('Order has already been shipped and cannot be cancelled', 400);
    }

    // Check for idempotent replay
    const existingOp = (order.cancellationOperations || []).find((op) => op.operationId === opId);
    if (existingOp) {
      let existingRefund: IRefund | null = null;
      if (existingOp.refundId) {
        existingRefund = await Refund.findById(existingOp.refundId);
      }
      return {
        order,
        refund: existingRefund,
        refundAmount: existingOp.refundAmount,
        refundError: null,
        inventoryError: null,
        fullyCancelled: existingOp.fullyCancelled,
        operationId: existingOp.operationId,
      };
    }

    // Validate requested items
    const requestedItemIds = items.map((i) => i.itemId);
    if (enforceCustomPrintLock) {
      const printJobs = await PrintJob.find({
        orderId: order._id,
        orderItemId: { $in: requestedItemIds },
      });
      const isCustomConfirmed = printJobs.some((pj) => CONFIRMED_PRINT_STATES.includes(pj.status));
      if (isCustomConfirmed) {
        throw new AppError(
          'Custom-printed items cannot be cancelled once customization has been confirmed by Samrat Fashion.',
          400
        );
      }
    }

    // Aggregate requests by itemId
    const requestMap = new Map<string, number>();
    for (const reqItem of items) {
      const idStr = String(reqItem.itemId);
      const prev = requestMap.get(idStr) || 0;
      requestMap.set(idStr, prev + (reqItem.quantity && reqItem.quantity > 0 ? reqItem.quantity : 0));
    }

    // Calculate total original line totals across the order to compute coupon discount share
    const totalLineSum = order.items.reduce((s, it) => s + (it.lineTotal || 0), 0);
    const originalDiscount = order.discount || 0;
    const discountRatio = totalLineSum > 0 ? Math.min(1, Math.max(0, originalDiscount / totalLineSum)) : 0;

    interface LineCancellationPlan {
      itemIndex: number;
      itemId: mongoose.Types.ObjectId;
      productId: mongoose.Types.ObjectId;
      variantId: mongoose.Types.ObjectId;
      cancelQuantity: number;
      refundAmount: number;
    }

    const cancellationPlans: LineCancellationPlan[] = [];
    const updatedItems = order.items.map((it: any) =>
      typeof it?.toObject === 'function' ? it.toObject() : { ...it }
    );

    for (const [idStr, requestedQty] of requestMap.entries()) {
      const idx = updatedItems.findIndex((it) => it._id && it._id.toString() === idStr);
      if (idx === -1) {
        throw new AppError(`Order item not found: ${idStr}`, 400);
      }

      const item = updatedItems[idx];
      const currentlyCancelled = item.cancelledQuantity || 0;
      const remainingUncancelled = Math.max(0, item.quantity - currentlyCancelled);

      if (remainingUncancelled <= 0) {
        throw new AppError(`Item "${item.productName}" is already cancelled`, 400);
      }

      const cancelQty = requestedQty > 0 ? Math.min(requestedQty, remainingUncancelled) : remainingUncancelled;
      if (cancelQty <= 0) {
        throw new AppError(`Invalid cancellation quantity for item "${item.productName}"`, 400);
      }

      const unitEffectivePrice = (item.lineTotal / (item.quantity || 1)) * (1 - discountRatio);
      const lineRefund = Math.round(cancelQty * unitEffectivePrice);

      cancellationPlans.push({
        itemIndex: idx,
        itemId: item._id,
        productId: item.productId,
        variantId: item.variantId,
        cancelQuantity: cancelQty,
        refundAmount: lineRefund,
      });

      // Update in-memory item snapshot
      item.cancelledQuantity = currentlyCancelled + cancelQty;
      item.cancelledAt = new Date();
      item.cancellationReason = reason;
      item.cancellationSource = source;
      item.cancelledValue = (item.cancelledValue || 0) + lineRefund;
    }

    // Check if every item in the entire order is now cancelled
    const fullyCancelled = updatedItems.every(
      (it) => (it.cancelledQuantity || 0) >= it.quantity
    );

    let calculatedRefundAmount = cancellationPlans.reduce((sum, p) => sum + p.refundAmount, 0);

    // If fully cancelled, refund whatever remains of the paid order (including shipping)
    if (fullyCancelled && order.paymentStatus === 'PAID') {
      const payment = await Payment.findOne({ orderId: order._id });
      const remainingPaidRefundable = payment
        ? Math.max(0, payment.amount - (payment.refundedAmount || 0) - (payment.pendingRefundAmount || 0))
        : order.total;
      calculatedRefundAmount = Math.min(order.total, remainingPaidRefundable);
    }

    // Recalculate order totals
    let newSubtotal = 0;
    let newDiscount = 0;
    let newTotal = 0;

    if (fullyCancelled) {
      newSubtotal = 0;
      newDiscount = 0;
      newTotal = 0;
    } else {
      // Sum remaining active item lines
      newSubtotal = updatedItems.reduce((sum, it) => {
        const activeQty = Math.max(0, it.quantity - (it.cancelledQuantity || 0));
        const unitNominal = it.lineTotal / (it.quantity || 1);
        return sum + Math.round(activeQty * unitNominal);
      }, 0);

      newDiscount = totalLineSum > 0 ? Math.round((newSubtotal / totalLineSum) * originalDiscount) : 0;
      newTotal = Math.max(0, newSubtotal - newDiscount + (order.shipping || 0));
    }

    const currentVersion = order.cancellationVersion || 0;
    const auditActorId = actorId ? new mongoose.Types.ObjectId(actorId) : order.userId;

    const newOperation: ICancellationOperation = {
      operationId: opId,
      itemIds: cancellationPlans.map((p) => p.itemId),
      items: cancellationPlans.map((p) => ({
        itemId: p.itemId,
        quantity: p.cancelQuantity,
        refundAmount: p.refundAmount,
      })),
      refundAmount: calculatedRefundAmount,
      fullyCancelled,
      source,
      reason,
      actorId: auditActorId,
      createdAt: new Date(),
    };

    const updateFields: any = {
      items: updatedItems,
      subtotal: newSubtotal,
      discount: newDiscount,
      total: newTotal,
      partiallyCancelled: !fullyCancelled,
      cancellationVersion: currentVersion + 1,
    };

    if (fullyCancelled) {
      updateFields.status = 'CANCELLED';
      updateFields.cancelledAt = new Date();
      updateFields.cancellationReason = reason;
      updateFields.cancellationSource = source;
    }

    // Optimistic concurrency write
    const updatedOrder = await Order.findOneAndUpdate(
      {
        _id: order._id,
        cancellationVersion: currentVersion,
        status: { $nin: BLOCKED_ORDER_STATUSES },
      } as any,
      {
        $set: updateFields,
        $push: { cancellationOperations: newOperation },
      },
      { returnDocument: 'after', lean: false }
    );

    if (!updatedOrder) {
      // Concurrency conflict - retry fetching fresh document
      if (attempts >= maxAttempts) {
        throw new AppError('Order cancellation conflict. Please retry.', 409, 'CANCELLATION_CONFLICT');
      }
      continue;
    }

    // 1. Inventory restoration for the cancelled quantities
    let inventoryError: string | null = null;
    try {
      const itemsToRestore = cancellationPlans.map((p) => ({
        orderItemId: p.itemId,
        productId: p.productId,
        variantId: p.variantId,
        quantity: p.cancelQuantity,
      }));

      await InventoryAllocationService.restoreCancelledItemQuantities(updatedOrder._id, itemsToRestore, {
        operationId: opId,
        reason: `${source === 'CUSTOMER' ? 'Customer' : 'Admin'} Item Cancellation: ${reason}`,
      });
    } catch (err) {
      inventoryError = errorMessage(err);
      console.error(`[CANCEL-ITEMS] Inventory restore failed for order ${updatedOrder._id}:`, err);
    }

    // 2. Refund processing for paid orders
    let refund: IRefund | null = null;
    let refundError: string | null = null;

    if (updatedOrder.paymentStatus === 'PAID' && calculatedRefundAmount > 0) {
      try {
        refund = await createInternalRefund({
          orderId: updatedOrder._id.toString(),
          amount: calculatedRefundAmount,
          reason: `${source === 'CUSTOMER' ? 'Customer' : 'Admin'} Item Cancellation: ${reason}`,
          actorId: actorId || updatedOrder.userId.toString(),
          actorRole: actorRole || source,
        });

        if (refund) {
          // Link refund to operation
          await Order.updateOne(
            { _id: updatedOrder._id, 'cancellationOperations.operationId': opId },
            { $set: { 'cancellationOperations.$.refundId': refund._id } }
          );

          if (fullyCancelled) {
            const paymentAfterRefund = await Payment.findOne({ orderId: updatedOrder._id });
            const isFullyRefunded =
              refund.status === 'PROCESSED' &&
              Boolean(paymentAfterRefund) &&
              (paymentAfterRefund!.refundedAmount || 0) >= paymentAfterRefund!.amount;

            if (isFullyRefunded) {
              updatedOrder.paymentStatus = 'REFUNDED';
              await updatedOrder.save();
            }
          }
        }
      } catch (err) {
        refundError = errorMessage(err);
        console.error(`[CANCEL-ITEMS] Refund failed for order ${updatedOrder._id}:`, err);

        try {
          refund = await Refund.findOne({ orderId: updatedOrder._id }).sort({ createdAt: -1 });
        } catch (lookupErr) {
          console.error(`[CANCEL-ITEMS] Failed to load refund record:`, lookupErr);
        }

        try {
          await AuditLog.create({
            actorId: auditActorId,
            actorRole: actorRole || source,
            action: 'ORDER_CANCEL_REFUND_FAILED',
            entityType: 'ORDER',
            entityId: updatedOrder._id,
            metadata: {
              operationId: opId,
              reason,
              error: refundError,
              refundId: refund?._id,
              refundStatus: refund?.status,
            },
          });
        } catch (auditErr) {
          console.error(`[CANCEL-ITEMS] Failed to write refund failure audit log:`, auditErr);
        }
      }
    }

    // 3. Sync Invoice if one exists
    try {
      const existingInvoice = await Invoice.findOne({ orderId: updatedOrder._id });
      if (existingInvoice) {
        // Update itemsSnapshot cancelled quantities
        for (const itemSnap of existingInvoice.itemsSnapshot) {
          const matchItem = updatedOrder.items.find(
            (it) => it.productId.toString() === itemSnap.productId.toString() &&
                    it.selectedSize === itemSnap.selectedSize &&
                    it.selectedColor === itemSnap.selectedColor
          );
          if (matchItem) {
            itemSnap.cancelledQuantity = matchItem.cancelledQuantity || 0;
          }
        }
        existingInvoice.subtotal = updatedOrder.subtotal;
        existingInvoice.discount = updatedOrder.discount;
        existingInvoice.total = updatedOrder.total;
        if (fullyCancelled) {
          existingInvoice.status = InvoiceStatus.REFUNDED;
        }
        await existingInvoice.save();
      }
    } catch (invErr) {
      console.error(`[CANCEL-ITEMS] Invoice update failed for order ${updatedOrder._id}:`, invErr);
    }

    // 4. Audit Log
    try {
      await AuditLog.create({
        actorId: auditActorId,
        actorRole: actorRole || source,
        action: fullyCancelled
          ? (source === 'ADMIN' ? 'ADMIN_ORDER_CANCELLED' : 'ORDER_CANCELLED')
          : (source === 'ADMIN' ? 'ADMIN_ORDER_ITEMS_CANCELLED' : 'ORDER_ITEMS_CANCELLED'),
        entityType: 'ORDER',
        entityId: updatedOrder._id,
        metadata: {
          operationId: opId,
          reason,
          source,
          itemCount: cancellationPlans.length,
          refundAmount: calculatedRefundAmount,
          refundId: refund?._id,
          refundStatus: refund?.status,
          refundError,
          inventoryError,
          fullyCancelled,
        },
      });
    } catch (auditErr) {
      console.error(`[CANCEL-ITEMS] Audit log error for order ${updatedOrder._id}:`, auditErr);
    }

    return {
      order: updatedOrder,
      refund,
      refundAmount: calculatedRefundAmount,
      refundError,
      inventoryError,
      fullyCancelled,
      operationId: opId,
    };
  }

  throw new AppError('Unable to complete cancellation after retrying', 500);
}
