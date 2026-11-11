import mongoose from 'mongoose';
import crypto from 'crypto';
import { Order, IOrder, ICancellationOperation } from '../models/Order';
import { Shipment } from '../models/Shipment';
import { PrintJob } from '../models/PrintJob';
import { AuditLog } from '../models/AuditLog';
import { Payment } from '../models/Payment';
import { Refund, IRefund } from '../models/Refund';
import { Invoice, InvoiceStatus } from '../models/Invoice';
import { CreditNote, generateCreditNoteNumber } from '../models/CreditNote';
import { AppError } from '../utils/AppError';
import { createInternalRefund, reconcileUnknownRefund } from './payment/refundService';
import { InventoryAllocationService } from './inventory/inventoryAllocationService';
import { Product } from '../models/Product';
import { getStoreSettings } from './storeSettingsService';

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
  allowBelowThreshold?: boolean;
  overrideReason?: string;
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

  const now = new Date();
  const updatedItems = order.items.map((it: any) => {
    const itemObj = typeof it?.toObject === 'function' ? it.toObject() : { ...it };
    itemObj.cancelledQuantity = itemObj.quantity;
    itemObj.cancelledAt = itemObj.cancelledAt || now;
    itemObj.cancellationReason = itemObj.cancellationReason || reason;
    itemObj.cancellationSource = itemObj.cancellationSource || source;
    return itemObj;
  });

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
        cancelledAt: now,
        cancellationReason: reason,
        cancellationSource: source,
        partiallyCancelled: false,
        items: updatedItems,
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

  // Preserve historical invoice integrity: never mutate subtotal, discount, or total.
  // Generate a formal Credit Note if an invoice was already issued.
  try {
    const existingInvoice = await Invoice.findOne({ orderId: cancelledOrder._id });
    if (existingInvoice) {
      existingInvoice.status = InvoiceStatus.REFUNDED;
      for (const snap of existingInvoice.itemsSnapshot) {
        snap.cancelledQuantity = snap.quantity;
      }
      await existingInvoice.save();

      const fullCancelOpId = `full_cancel_${cancelledOrder._id}`;
      const existingCn = await CreditNote.findOne({ operationId: fullCancelOpId });
      if (!existingCn) {
        const cnNumber = await generateCreditNoteNumber();
        const refundAmt = refund ? refund.amount : (cancelledOrder.total || 0);
        await CreditNote.create({
          creditNoteNumber: cnNumber,
          invoiceId: existingInvoice._id,
          invoiceNumber: existingInvoice.invoiceNumber,
          orderId: cancelledOrder._id,
          orderNumber: cancelledOrder.orderNumber,
          userId: cancelledOrder.userId,
          operationId: fullCancelOpId,
          refundId: refund?._id,
          status: 'ISSUED',
          items: existingInvoice.itemsSnapshot.map((is) => ({
            productId: is.productId,
            productName: is.productName,
            productImage: is.productImage,
            selectedSize: is.selectedSize,
            selectedColor: is.selectedColor,
            quantity: is.quantity,
            unitPrice: is.unitPrice,
            lineTotal: is.lineTotal,
            refundAmount: is.lineTotal,
          })),
          subtotalRefunded: existingInvoice.subtotal,
          discountAdjusted: existingInvoice.discount,
          taxRefunded: existingInvoice.tax,
          totalRefundAmount: refundAmt,
          currency: existingInvoice.currency,
          reason,
        });
      }
    }
  } catch (invErr) {
    console.error(`[CANCEL] Invoice credit note handling failed for order ${cancelledOrder._id}:`, invErr);
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
 * - Computes prorated item refunds using invariant initial values and integer paise math.
 * - Preserves historical invoices as immutable financial records and generates CreditNotes.
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

  for (const reqItem of items) {
    if (!reqItem || !reqItem.itemId || !mongoose.Types.ObjectId.isValid(String(reqItem.itemId))) {
      throw new AppError('Each item must have a valid itemId', 400);
    }
    if (reqItem.quantity !== undefined && reqItem.quantity !== null) {
      if (typeof reqItem.quantity !== 'number' || !Number.isInteger(reqItem.quantity) || reqItem.quantity <= 0) {
        throw new AppError('Cancellation quantity must be a positive integer', 400);
      }
    }
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
      let replayRefundError: string | null = null;
      let replayInventoryError: string | null = null;

      // Reconcile/verify inventory restock on replay if needed
      if (existingOp.items && existingOp.items.length > 0) {
        try {
          const itemsToRestore = existingOp.items.map((opItem) => {
            const ordItem = order.items.find((it) => it._id && it._id.toString() === opItem.itemId.toString());
            return {
              orderItemId: opItem.itemId,
              productId: opItem.productId || ordItem?.productId,
              variantId: opItem.variantId || ordItem?.variantId,
              quantity: opItem.quantity,
            };
          }).filter((it) => it.productId && it.variantId);

          if (itemsToRestore.length > 0) {
            await InventoryAllocationService.restoreCancelledItemQuantities(order._id, itemsToRestore as any, {
              operationId: existingOp.operationId,
              reason: `Replay Item Cancellation: ${existingOp.reason || ''}`,
            });
            await Order.updateOne(
              { _id: order._id, 'cancellationOperations.operationId': existingOp.operationId },
              { $set: { 'cancellationOperations.$.inventoryRestored': true } }
            );
          }
        } catch (invErr) {
          replayInventoryError = errorMessage(invErr);
          console.error(`[CANCEL-ITEMS-REPLAY] Inventory replay error for order ${order._id}:`, invErr);
        }
      }

      // Reconcile/verify refund on replay
      if (existingOp.refundId) {
        existingRefund = await Refund.findById(existingOp.refundId);
      }
      if (!existingRefund) {
        const opHash = crypto.createHash('sha256').update(`${order._id}_${existingOp.operationId}`).digest('hex').slice(0, 24);
        existingRefund = await Refund.findOne({
          orderId: order._id,
          $or: [
            { gatewayIdempotencyKey: `rfnd_op_${opHash}` },
            { idempotencyKey: new RegExp(`^rfnd_op_${opHash}`) },
          ],
        });
      }

      if (existingRefund && existingRefund.status === 'UNKNOWN') {
        try {
          existingRefund = await reconcileUnknownRefund(existingRefund._id.toString());
        } catch (recErr) {
          replayRefundError = errorMessage(recErr);
        }
      }

      if ((!existingRefund || existingRefund.status === 'FAILED') && order.paymentStatus === 'PAID' && existingOp.refundAmount > 0) {
        try {
          existingRefund = await createInternalRefund({
            orderId: order._id.toString(),
            operationId: existingOp.operationId,
            amount: existingOp.refundAmount,
            reason: `${source === 'CUSTOMER' ? 'Customer' : 'Admin'} Item Cancellation: ${existingOp.reason || reason}`,
            actorId: actorId || order.userId.toString(),
            actorRole: actorRole || source,
          });

          if (existingRefund) {
            await Order.updateOne(
              { _id: order._id, 'cancellationOperations.operationId': existingOp.operationId },
              { $set: { 'cancellationOperations.$.refundId': existingRefund._id } }
            );
          }
        } catch (rErr) {
          replayRefundError = errorMessage(rErr);
          console.error(`[CANCEL-ITEMS-REPLAY] Refund replay error for order ${order._id}:`, rErr);
        }
      }

      // Reconcile credit note if invoice exists
      try {
        const existingInvoice = await Invoice.findOne({ orderId: order._id });
        if (existingInvoice) {
          const existingCn = await CreditNote.findOne({ operationId: existingOp.operationId });
          if (!existingCn && existingOp.items && existingOp.items.length > 0) {
            const cnNumber = await generateCreditNoteNumber();
            await CreditNote.create({
              creditNoteNumber: cnNumber,
              invoiceId: existingInvoice._id,
              invoiceNumber: existingInvoice.invoiceNumber,
              orderId: order._id,
              orderNumber: order.orderNumber,
              userId: order.userId,
              operationId: existingOp.operationId,
              refundId: existingRefund?._id,
              status: 'ISSUED',
              items: existingOp.items.map((opItem) => {
                const it = order.items.find((i) => i._id && i._id.toString() === opItem.itemId.toString());
                return {
                  productId: opItem.productId || it?.productId,
                  productName: it?.productName || 'Product',
                  productImage: it?.productImage,
                  selectedSize: it?.selectedSize || '',
                  selectedColor: it?.selectedColor || '',
                  quantity: opItem.quantity,
                  unitPrice: it ? Math.round((it.lineTotal / (it.quantity || 1)) * 100) / 100 : 0,
                  lineTotal: it ? Math.round(((it.lineTotal / (it.quantity || 1)) * opItem.quantity) * 100) / 100 : 0,
                  refundAmount: opItem.refundAmount,
                };
              }),
              subtotalRefunded: existingOp.refundAmount,
              discountAdjusted: 0,
              taxRefunded: 0,
              totalRefundAmount: existingOp.refundAmount,
              currency: order.currency,
              reason: existingOp.reason,
            });
            await Order.updateOne(
              { _id: order._id, 'cancellationOperations.operationId': existingOp.operationId },
              {
                $set: {
                  'cancellationOperations.$.creditNoteIssued': true,
                  'cancellationOperations.$.status': 'COMPLETED',
                  'cancellationOperations.$.updatedAt': new Date(),
                }
              }
            );
          }
        }
      } catch (cnErr) {
        console.error(`[CANCEL-ITEMS-REPLAY] Credit note replay error for order ${order._id}:`, cnErr);
      }

      return {
        order,
        refund: existingRefund,
        refundAmount: existingOp.refundAmount,
        refundError: replayRefundError,
        inventoryError: replayInventoryError,
        fullyCancelled: existingOp.fullyCancelled,
        operationId: existingOp.operationId,
      };
    }

    // Validate requested items
    const requestedItemIds = items.map((i) => String(i.itemId));
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

    // Use invariant initial values to prevent decaying discount ratio over sequential cancellations
    const initialSubtotal = order.initialSubtotal !== undefined && order.initialSubtotal > 0
      ? order.initialSubtotal
      : order.items.reduce((s, it) => s + (it.lineTotal || 0), 0);
    const initialDiscount = order.initialDiscount !== undefined
      ? order.initialDiscount
      : (order.discount || 0);
    const initialTotal = order.initialTotal !== undefined
      ? order.initialTotal
      : order.total;

    const initialSubtotalPaise = Math.round(initialSubtotal * 100);
    const initialDiscountPaise = Math.round(initialDiscount * 100);

    interface LineCancellationPlan {
      itemIndex: number;
      itemId: mongoose.Types.ObjectId;
      productId: mongoose.Types.ObjectId;
      variantId: mongoose.Types.ObjectId;
      cancelQuantity: number;
      refundAmount: number;
      subtotalAmount: number;
      discountAmount: number;
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

      if (requestedQty > remainingUncancelled) {
        throw new AppError(
          `Cannot cancel ${requestedQty} units of "${item.productName}". Only ${remainingUncancelled} uncancelled unit(s) remain.`,
          400
        );
      }

      const cancelQty = requestedQty > 0 ? requestedQty : remainingUncancelled;
      if (cancelQty <= 0) {
        throw new AppError(`Invalid cancellation quantity for item "${item.productName}"`, 400);
      }

      const itemTotalQty = item.quantity || 1;
      const lineTotalPaise = Math.round((item.lineTotal || 0) * 100);

      // Proportional coupon discount allocated to this line (in paise) based on invariant initial values
      const lineDiscountPaise = initialSubtotalPaise > 0
        ? Math.round((lineTotalPaise * initialDiscountPaise) / initialSubtotalPaise)
        : 0;

      // Net payable amount for this entire line (in paise)
      const netLinePayablePaise = Math.max(0, lineTotalPaise - lineDiscountPaise);

      // Base unit refund in integer paise (floored)
      const unitRefundPaise = Math.floor(netLinePayablePaise / itemTotalQty);

      // Remainder paise for this line
      const lineRemainderPaise = netLinePayablePaise - (unitRefundPaise * itemTotalQty);

      // Does this cancellation cancel all remaining units of this line?
      const isFinalUnitsForLine = (currentlyCancelled + cancelQty) >= itemTotalQty;

      // Assign the remaining paise to the final units so line totals are exact
      const thisLineRefundPaise = (unitRefundPaise * cancelQty) + (isFinalUnitsForLine ? lineRemainderPaise : 0);
      const lineRefund = thisLineRefundPaise / 100;

      const subtotalRefundPaise = Math.round((lineTotalPaise / itemTotalQty) * cancelQty);
      const discountRefundPaise = Math.max(0, subtotalRefundPaise - thisLineRefundPaise);

      cancellationPlans.push({
        itemIndex: idx,
        itemId: item._id,
        productId: item.productId,
        variantId: item.variantId,
        cancelQuantity: cancelQty,
        refundAmount: lineRefund,
        subtotalAmount: subtotalRefundPaise / 100,
        discountAmount: discountRefundPaise / 100,
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

    // Option C Free Delivery Threshold Safeguard:
    // 1. If fully cancelled, full cancellation is always permitted.
    // 2. System-initiated cancellations (automated expiry, stockouts) are exempt.
    // 3. Customer cancellations can NEVER override the threshold rule.
    // 4. Admin cancellations require explicit `allowBelowThreshold === true` with a validated `overrideReason`.
    let adminThresholdOverridden = false;
    let thresholdAuditDetails: {
      threshold: number;
      remainingSubtotal: number;
      remainingEligible: number;
      overrideReason: string;
    } | null = null;

    if (!fullyCancelled && source !== 'SYSTEM') {
      // Determine if order qualified for free shipping based on immutable checkout snapshot, falling back gracefully
      const initialShipping = typeof order.initialShipping === 'number'
        ? order.initialShipping
        : (order.shipping || 0);

      const qualifiedForFreeShipping = typeof order.qualifiedForFreeShipping === 'boolean'
        ? order.qualifiedForFreeShipping
        : (initialShipping === 0);

      // If customer paid for shipping at checkout, order is exempt from free-shipping threshold clawback
      if (qualifiedForFreeShipping) {
        // Resolve free shipping threshold from immutable snapshot first, falling back to current store settings for historical orders
        let threshold = typeof order.freeShippingThresholdSnapshot === 'number' && Number.isFinite(order.freeShippingThresholdSnapshot) && order.freeShippingThresholdSnapshot > 0
          ? order.freeShippingThresholdSnapshot
          : 0;

        if (threshold <= 0) {
          const storeSettings = await getStoreSettings();
          threshold = Number(storeSettings.freeShippingThreshold) || 0;
        }

        if (threshold > 0) {
          const thresholdPaise = Math.round(threshold * 100);
          const eligibleInitialPaise = Math.max(0, initialSubtotalPaise - initialDiscountPaise);

          // Only orders that originally met or exceeded the threshold qualify for this safeguard check
          const qualifiedViaThreshold = order.freeShippingReason
            ? order.freeShippingReason === 'THRESHOLD'
            : eligibleInitialPaise >= thresholdPaise;

          if (qualifiedViaThreshold) {
            let remainingSubtotalPaise = 0;
            const remainingProductIds: mongoose.Types.ObjectId[] = [];

            for (const it of updatedItems) {
              const activeQty = Math.max(0, it.quantity - (it.cancelledQuantity || 0));
              if (activeQty > 0) {
                const unitPaise = Math.round(((it.lineTotal || 0) / (it.quantity || 1)) * 100);
                remainingSubtotalPaise += activeQty * unitPaise;
                if (it.productId) {
                  remainingProductIds.push(it.productId);
                }
              }
            }

            // Integer paise discount allocation to projected remaining merchandise
            const remainingDiscountPaise = initialSubtotalPaise > 0
              ? Math.round((remainingSubtotalPaise * initialDiscountPaise) / initialSubtotalPaise)
              : 0;
            const remainingEligiblePaise = Math.max(0, remainingSubtotalPaise - remainingDiscountPaise);

            // Equality at threshold (remainingEligiblePaise >= thresholdPaise) ships free and is allowed!
            if (remainingEligiblePaise < thresholdPaise) {
              // Check if any of the remaining items has standalone freeDelivery: true
              const freeDeliveryProducts = remainingProductIds.length > 0
                ? await Product.find({ _id: { $in: remainingProductIds }, freeDelivery: true }).select('_id')
                : [];

              if (freeDeliveryProducts.length === 0) {
                const remainingSubtotal = remainingSubtotalPaise / 100;
                const remainingEligible = remainingEligiblePaise / 100;

                const isExplicitAdminOverride = source === 'ADMIN' && input.allowBelowThreshold === true;

                if (isExplicitAdminOverride) {
                  const overrideReason = (input.overrideReason || input.reason || '').trim();
                  if (!overrideReason) {
                    throw new AppError('An override reason is required for admin below-threshold cancellations', 400);
                  }
                  adminThresholdOverridden = true;
                  thresholdAuditDetails = {
                    threshold,
                    remainingSubtotal,
                    remainingEligible,
                    overrideReason,
                  };
                } else {
                  throw new AppError(
                    `Partial cancellation is not permitted because the remaining order value (₹${Math.round(remainingEligible).toLocaleString('en-IN')}) falls below the free delivery threshold of ₹${threshold.toLocaleString('en-IN')}. Please cancel the entire order instead.`,
                    400,
                    'PARTIAL_CANCELLATION_BELOW_THRESHOLD'
                  );
                }
              }
            }
          }
        }
      }
    }
    let calculatedRefundAmount = cancellationPlans.reduce((sum, p) => sum + p.refundAmount, 0);

    // If fully cancelled, refund whatever remains of the paid order (including shipping)
    if (fullyCancelled && order.paymentStatus === 'PAID') {
      const payment = await Payment.findOne({ orderId: order._id });
      const pastRefundsPaise = (order.cancellationOperations || []).reduce(
        (sum, op) => sum + Math.round((op.refundAmount || 0) * 100),
        0
      );
      const initialTotalPaise = Math.round(initialTotal * 100);
      const remainingOrderBalancePaise = Math.max(0, initialTotalPaise - pastRefundsPaise);
      const remainingOrderBalance = remainingOrderBalancePaise / 100;

      const remainingPaidRefundable = payment
        ? Math.max(0, payment.amount - (payment.refundedAmount || 0) - (payment.pendingRefundAmount || 0))
        : remainingOrderBalance;
      calculatedRefundAmount = Math.min(remainingOrderBalance, remainingPaidRefundable);

      if (cancellationPlans.length === 1) {
        cancellationPlans[0].refundAmount = calculatedRefundAmount;
      }
    }

    // Recalculate order totals in integer paise
    let newSubtotal = 0;
    let newDiscount = 0;
    let newTotal = 0;

    if (fullyCancelled) {
      newSubtotal = 0;
      newDiscount = 0;
      newTotal = 0;
    } else {
      let remainingSubtotalPaise = 0;
      for (const it of updatedItems) {
        const activeQty = Math.max(0, it.quantity - (it.cancelledQuantity || 0));
        const unitPaise = Math.round(((it.lineTotal || 0) / (it.quantity || 1)) * 100);
        remainingSubtotalPaise += activeQty * unitPaise;
      }

      const pastRefundsPaise = (order.cancellationOperations || []).reduce(
        (sum, op) => sum + Math.round((op.refundAmount || 0) * 100),
        0
      );
      const totalRefundedSoFarPaise = pastRefundsPaise + Math.round(calculatedRefundAmount * 100);
      const initialTotalPaise = Math.round(initialTotal * 100);

      // Invariant: remaining order total is exactly initial total minus all refunded amounts so far
      const remainingTotalPaise = Math.max(0, initialTotalPaise - totalRefundedSoFarPaise);

      newSubtotal = remainingSubtotalPaise / 100;
      newTotal = remainingTotalPaise / 100;
      const shippingPaise = Math.round((order.shipping || 0) * 100);
      newDiscount = Math.max(0, Math.round((remainingSubtotalPaise + shippingPaise - remainingTotalPaise) / 100));
    }

    const currentVersion = order.cancellationVersion || 0;
    const auditActorId = actorId ? new mongoose.Types.ObjectId(actorId) : order.userId;

    const newOperation: ICancellationOperation = {
      operationId: opId,
      itemIds: cancellationPlans.map((p) => p.itemId),
      items: cancellationPlans.map((p) => ({
        itemId: p.itemId,
        productId: p.productId,
        variantId: p.variantId,
        quantity: p.cancelQuantity,
        refundAmount: p.refundAmount,
      })),
      refundAmount: calculatedRefundAmount,
      fullyCancelled,
      source,
      reason,
      actorId: auditActorId,
      status: 'PENDING',
      inventoryRestored: false,
      creditNoteIssued: false,
      createdAt: new Date(),
    };

    const initialShippingVal = typeof order.initialShipping === 'number'
      ? order.initialShipping
      : (order.shipping || 0);

    const updateFields: any = {
      items: updatedItems,
      subtotal: newSubtotal,
      discount: newDiscount,
      total: newTotal,
      initialSubtotal,
      initialDiscount,
      initialShipping: initialShippingVal,
      initialTotal,
      partiallyCancelled: !fullyCancelled,
      cancellationVersion: currentVersion + 1,
    };
    if (order.freeShippingThresholdSnapshot !== undefined) {
      updateFields.freeShippingThresholdSnapshot = order.freeShippingThresholdSnapshot;
    }
    if (order.shippingFeeSnapshot !== undefined) {
      updateFields.shippingFeeSnapshot = order.shippingFeeSnapshot;
    }
    if (order.qualifiedForFreeShipping !== undefined) {
      updateFields.qualifiedForFreeShipping = order.qualifiedForFreeShipping;
    }
    if (order.freeShippingReason !== undefined) {
      updateFields.freeShippingReason = order.freeShippingReason;
    }

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


    if (adminThresholdOverridden && thresholdAuditDetails) {
      try {
        await AuditLog.create({
          actorId: auditActorId,
          actorRole: actorRole || source,
          action: 'ADMIN_OVERRIDE_FREE_SHIPPING_THRESHOLD',
          entityType: 'ORDER',
          entityId: updatedOrder._id,
          metadata: {
            operationId: opId,
            threshold: thresholdAuditDetails.threshold,
            remainingSubtotal: thresholdAuditDetails.remainingSubtotal,
            remainingEligible: thresholdAuditDetails.remainingEligible,
            overrideReason: thresholdAuditDetails.overrideReason,
          },
        });
      } catch (auditErr) {
        console.error(`[CANCEL-ITEMS] Failed to write admin threshold override audit log:`, auditErr);
      }
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
      await Order.updateOne(
        { _id: updatedOrder._id, 'cancellationOperations.operationId': opId },
        { $set: { 'cancellationOperations.$.inventoryRestored': true } }
      );
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
          operationId: opId,
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

        await Order.updateOne(
          { _id: updatedOrder._id, 'cancellationOperations.operationId': opId },
          {
            $set: {
              'cancellationOperations.$.status': 'FAILED',
              'cancellationOperations.$.updatedAt': new Date(),
            }
          }
        );
      }
    }

    // 3. Invoicing integrity: Never mutate historical totals. Generate a formal Credit Note.
    try {
      const existingInvoice = await Invoice.findOne({ orderId: updatedOrder._id });
      if (existingInvoice) {
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
        if (fullyCancelled) {
          existingInvoice.status = InvoiceStatus.REFUNDED;
        }
        await existingInvoice.save();

        const existingCn = await CreditNote.findOne({ operationId: opId });
        if (!existingCn) {
          const cnNumber = await generateCreditNoteNumber();
          const subtotalRefundedPaise = cancellationPlans.reduce((s, p) => Math.round(s + p.subtotalAmount * 100), 0);
          const discountAdjustedPaise = cancellationPlans.reduce((s, p) => Math.round(s + p.discountAmount * 100), 0);

          await CreditNote.create({
            creditNoteNumber: cnNumber,
            invoiceId: existingInvoice._id,
            invoiceNumber: existingInvoice.invoiceNumber,
            orderId: updatedOrder._id,
            orderNumber: updatedOrder.orderNumber,
            userId: updatedOrder.userId,
            operationId: opId,
            refundId: refund?._id,
            status: 'ISSUED',
            items: cancellationPlans.map((p) => {
              const it = updatedOrder.items.find((i) => i._id && i._id.toString() === p.itemId.toString());
              return {
                productId: p.productId,
                productName: it?.productName || 'Product',
                productImage: it?.productImage,
                selectedSize: it?.selectedSize || '',
                selectedColor: it?.selectedColor || '',
                quantity: p.cancelQuantity,
                unitPrice: it ? Math.round((it.lineTotal / (it.quantity || 1)) * 100) / 100 : 0,
                lineTotal: p.subtotalAmount,
                refundAmount: p.refundAmount,
              };
            }),
            subtotalRefunded: subtotalRefundedPaise / 100,
            discountAdjusted: discountAdjustedPaise / 100,
            taxRefunded: 0,
            totalRefundAmount: calculatedRefundAmount,
            currency: updatedOrder.currency,
            reason,
          });
        }
        await Order.updateOne(
          { _id: updatedOrder._id, 'cancellationOperations.operationId': opId },
          {
            $set: {
              'cancellationOperations.$.creditNoteIssued': true,
              'cancellationOperations.$.status': 'COMPLETED',
              'cancellationOperations.$.updatedAt': new Date(),
            }
          }
        );
      } else {
        await Order.updateOne(
          { _id: updatedOrder._id, 'cancellationOperations.operationId': opId },
          {
            $set: {
              'cancellationOperations.$.status': 'COMPLETED',
              'cancellationOperations.$.updatedAt': new Date(),
            }
          }
        );
      }
    } catch (invErr) {
      console.error(`[CANCEL-ITEMS] Credit note generation failed for order ${updatedOrder._id}:`, invErr);
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

/**
 * Sweeps and reconciles any PENDING cancellation operations.
 * Essential for crash recovery in standalone MongoDB or interrupted workers.
 */
export async function reconcilePendingCancellationOperations(
  orderId?: string,
  options?: {
    leaseGuard?: () => Promise<boolean> | boolean;
  }
): Promise<{
  inspectedCount: number;
  recoveredCount: number;
  errors: string[];
}> {
  const query: any = { 'cancellationOperations.status': 'PENDING' };
  if (orderId) {
    query._id = new mongoose.Types.ObjectId(orderId);
  }
  const pendingOrders = await Order.find(query);
  let inspectedCount = 0;
  let recoveredCount = 0;
  const errors: string[] = [];

  for (const order of pendingOrders) {
    if (options?.leaseGuard && !(await options.leaseGuard())) {
      console.warn('[RECOVERY] Lease lost during cancellation reconciliation; aborting remaining orders');
      break;
    }
    for (const op of order.cancellationOperations || []) {
      if (op.status !== 'PENDING') continue;
      inspectedCount++;
      try {
        // Step 1: Inventory
        if (!op.inventoryRestored && op.items && op.items.length > 0) {
          const itemsToRestore = op.items.map((opItem) => {
            const ordItem = order.items.find((it) => it._id && it._id.toString() === opItem.itemId.toString());
            return {
              orderItemId: opItem.itemId,
              productId: opItem.productId || ordItem?.productId,
              variantId: opItem.variantId || ordItem?.variantId,
              quantity: opItem.quantity,
            };
          }).filter((it) => it.productId && it.variantId);

          if (itemsToRestore.length > 0) {
            await InventoryAllocationService.restoreCancelledItemQuantities(order._id, itemsToRestore as any, {
              operationId: op.operationId,
              reason: `Crash Recovery Item Cancellation: ${op.reason || ''}`,
            });
            await Order.updateOne(
              { _id: order._id, 'cancellationOperations.operationId': op.operationId },
              { $set: { 'cancellationOperations.$.inventoryRestored': true } }
            );
          }
        }

        // Step 2: Refund
        let refundDoc: IRefund | null = null;
        if (op.refundId) {
          refundDoc = await Refund.findById(op.refundId);
        }
        if (!refundDoc) {
          const opHash = crypto.createHash('sha256').update(`${order._id}_${op.operationId}`).digest('hex').slice(0, 24);
          refundDoc = await Refund.findOne({
            orderId: order._id,
            $or: [
              { gatewayIdempotencyKey: `rfnd_op_${opHash}` },
              { idempotencyKey: new RegExp(`^rfnd_op_${opHash}`) },
            ],
          });
        }
        if (refundDoc && refundDoc.status === 'UNKNOWN') {
          refundDoc = await reconcileUnknownRefund(refundDoc._id.toString());
        }
        if (!refundDoc && order.paymentStatus === 'PAID' && op.refundAmount > 0) {
          refundDoc = await createInternalRefund({
            orderId: order._id.toString(),
            operationId: op.operationId,
            amount: op.refundAmount,
            reason: `Crash Recovery Refund: ${op.reason || ''}`,
            actorId: (op.actorId || order.userId).toString(),
            actorRole: op.source || 'SYSTEM',
          });
        }
        if (refundDoc) {
          await Order.updateOne(
            { _id: order._id, 'cancellationOperations.operationId': op.operationId },
            { $set: { 'cancellationOperations.$.refundId': refundDoc._id } }
          );
        }

        // Step 3: Credit Note
        if (!op.creditNoteIssued) {
          const existingInvoice = await Invoice.findOne({ orderId: order._id });
          if (existingInvoice) {
            const existingCn = await CreditNote.findOne({ operationId: op.operationId });
            if (!existingCn && op.items && op.items.length > 0) {
              const cnNumber = await generateCreditNoteNumber();
              await CreditNote.create({
                creditNoteNumber: cnNumber,
                invoiceId: existingInvoice._id,
                invoiceNumber: existingInvoice.invoiceNumber,
                orderId: order._id,
                orderNumber: order.orderNumber,
                userId: order.userId,
                operationId: op.operationId,
                refundId: refundDoc?._id,
                status: 'ISSUED',
                items: op.items.map((opItem) => {
                  const it = order.items.find((i) => i._id && i._id.toString() === opItem.itemId.toString());
                  return {
                    productId: opItem.productId || it?.productId,
                    productName: it?.productName || 'Product',
                    productImage: it?.productImage,
                    selectedSize: it?.selectedSize || '',
                    selectedColor: it?.selectedColor || '',
                    quantity: opItem.quantity,
                    unitPrice: it ? Math.round((it.lineTotal / (it.quantity || 1)) * 100) / 100 : 0,
                    lineTotal: it ? Math.round(((it.lineTotal / (it.quantity || 1)) * opItem.quantity) * 100) / 100 : 0,
                    refundAmount: opItem.refundAmount,
                  };
                }),
                subtotalRefunded: op.refundAmount,
                discountAdjusted: 0,
                taxRefunded: 0,
                totalRefundAmount: op.refundAmount,
                currency: order.currency,
                reason: op.reason,
              });
            }
          }
          await Order.updateOne(
            { _id: order._id, 'cancellationOperations.operationId': op.operationId },
            {
              $set: {
                'cancellationOperations.$.creditNoteIssued': true,
              }
            }
          );
        }

        const opFinalStatus: 'COMPLETED' | 'FAILED' | 'PENDING' =
          order.paymentStatus !== 'PAID' || op.refundAmount <= 0
            ? 'COMPLETED'
            : (refundDoc && refundDoc.status === 'PROCESSED')
            ? 'COMPLETED'
            : (refundDoc && refundDoc.status === 'FAILED')
            ? 'FAILED'
            : (refundDoc && (refundDoc.status === 'UNKNOWN' || refundDoc.status === 'PENDING'))
            ? 'PENDING'
            : 'COMPLETED';

        if (opFinalStatus !== 'PENDING') {
          await Order.updateOne(
            { _id: order._id, 'cancellationOperations.operationId': op.operationId },
            {
              $set: {
                'cancellationOperations.$.status': opFinalStatus,
                'cancellationOperations.$.updatedAt': new Date(),
              }
            }
          );
          recoveredCount++;
        }
      } catch (err: unknown) {
        errors.push(`Order ${order._id} operation ${op.operationId} recovery failed: ${errorMessage(err)}`);
      }
    }
  }

  return { inspectedCount, recoveredCount, errors };
}
