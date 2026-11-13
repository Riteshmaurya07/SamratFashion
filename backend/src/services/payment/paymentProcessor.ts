import mongoose from 'mongoose';
import { Order } from '../../models/Order';
import { Payment } from '../../models/Payment';
import { PaymentAttempt } from '../../models/PaymentAttempt';
import { DuplicateCaptureRefund } from '../../models/DuplicateCaptureRefund';
import { createInternalRefund, registerPostCommitHook } from './refundService';
import { razorpayProvider } from './RazorpayProvider';
import { InventoryAllocationService } from '../inventory/inventoryAllocationService';
import { confirmCouponReservation, releaseCouponReservation } from '../coupon/couponReservationService';
import '../../models/User';
import '../../models/Coupon';
import '../../models/CouponUsage';
import '../../models/Cart';
const CLAIM_STALE_MS = 10_000;
const TERMINAL_POLL_MS = 250;
const TERMINAL_POLL_MAX = 24;

/**
 * Issues the tax invoice once an order is paid. Runs after the payment
 * transaction commits so the invoice snapshot is built from persisted state.
 * Failures are logged and never fail the payment itself; the lazy invoice
 * endpoint and the admin register backfill will retry later.
 */
const scheduleInvoiceIssuance = (
  orderId: mongoose.Types.ObjectId,
  session?: mongoose.ClientSession
): void => {
  const task = async () => {
    try {
      // Dynamic require keeps the payment processor free of a startup cycle.
      const { getOrCreateInvoiceForOrder } = require('../../controllers/invoiceController');
      await getOrCreateInvoiceForOrder(orderId.toString());
    } catch (err) {
      console.error(`[PAYMENT PROCESSOR] Failed to issue invoice for order ${orderId}:`, err);
    }
  };

  if (session && session.inTransaction()) {
    registerPostCommitHook(session, task);
  } else {
    Promise.resolve().then(task).catch(() => {});
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const DUPLICATE_REFUND_CLAIM_MS = 60_000;

async function flagPaymentForDuplicateCapture(paymentId: mongoose.Types.ObjectId, reason: string): Promise<void> {
  const withReason = await Payment.updateOne(
    { _id: paymentId, reconciliationRequired: { $ne: true } },
    { $set: { reconciliationRequired: true, reconciliationReason: reason } }
  );
  if (withReason.matchedCount === 1) return;

  const alreadyFlagged = await Payment.updateOne(
    { _id: paymentId, reconciliationRequired: true },
    { $set: { reconciliationRequired: true } }
  );
  if (alreadyFlagged.matchedCount !== 1) {
    throw new Error(`Payment ${paymentId} disappeared while flagging duplicate capture reconciliation`);
  }
  await Payment.updateOne(
    {
      _id: paymentId,
      reconciliationRequired: true,
      $or: [
        { reconciliationReason: { $exists: false } },
        { reconciliationReason: null },
        { reconciliationReason: '' },
      ],
    },
    { $set: { reconciliationReason: reason } }
  );
}

interface PendingResult {
  order: any;
  attempt: any;
  success: boolean;
  reason?: string;
}

const buildTerminalResult = async (orderId: mongoose.Types.ObjectId, attempt: any): Promise<PendingResult | null> => {
  const order = await Order.findById(orderId);
  if (!order) return null;

  if (order.paymentStatus === 'PAID' && order.status !== 'CANCELLED') {
    scheduleInvoiceIssuance(order._id);
    return { order, attempt, success: true };
  }
  if (order.status === 'CANCELLED' || order.status === 'EXPIRED') {
    return { order, attempt, success: false, reason: 'ORDER_CANCELLED' };
  }
  return { order, attempt, success: false, reason: 'PROCESSING_IN_PROGRESS' };
};

async function refundDuplicateCapture(
  paymentAttemptId: mongoose.Types.ObjectId,
  orderId: mongoose.Types.ObjectId,
  capturePaymentId: string
): Promise<{ success: boolean; reason?: string }> {
  const attempt = await PaymentAttempt.findById(paymentAttemptId);
  if (!attempt) throw new Error(`Payment attempt ${paymentAttemptId} disappeared before duplicate capture refund`);
  const payment = await Payment.findById(attempt.paymentId);
  if (!payment) throw new Error(`Payment ${attempt.paymentId} is missing for duplicate capture refund`);

  const refundRecord = await DuplicateCaptureRefund.findOneAndUpdate(
    { paymentAttemptId: attempt._id },
    {
      $setOnInsert: {
        orderId,
        paymentId: payment._id,
        paymentAttemptId: attempt._id,
        capturePaymentId,
        amount: attempt.amount,
        currency: attempt.currency,
        status: 'PENDING',
      },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );
  if (
    refundRecord.capturePaymentId !== capturePaymentId ||
    refundRecord.amount !== attempt.amount ||
    refundRecord.paymentId.toString() !== payment._id.toString()
  ) {
    await flagPaymentForDuplicateCapture(
      payment._id,
      `Duplicate capture ledger conflicts with payment attempt ${attempt._id}; manual review required`
    );
    throw new Error(`Duplicate capture ledger identity conflict for payment attempt ${attempt._id}`);
  }

  await flagPaymentForDuplicateCapture(
    payment._id,
    `Duplicate payment capture ${capturePaymentId} for attempt ${attempt._id} is tracked separately; verify refund settlement`
  );

  if (refundRecord.status === 'PROCESSED') {
    await PaymentAttempt.updateOne(
      { _id: attempt._id },
      {
        $set: {
          status: 'FAILED',
          razorpayPaymentId: capturePaymentId,
          failureCode: 'DUPLICATE_CAPTURE_REFUNDED',
          failureReason: `Duplicate capture refunded as ${refundRecord.razorpayRefundId}`,
        },
      }
    );
    return { success: true };
  }
  if (refundRecord.status === 'FAILED') {
    return { success: false, reason: 'DUPLICATE_CAPTURE_REFUND_FAILED' };
  }

  const claimToken = new mongoose.Types.ObjectId().toString();
  const claimedRefund = await DuplicateCaptureRefund.findOneAndUpdate(
    {
      _id: refundRecord._id,
      $or: [
        { status: { $in: ['PENDING', 'UNKNOWN'] } },
          {
            status: 'PROCESSING',
            $or: [
              { claimExpiresAt: { $lte: new Date() } },
              { claimExpiresAt: { $exists: false } },
            ],
          },
      ],
    },
    {
      $set: {
        status: 'PROCESSING',
        claimToken,
        claimExpiresAt: new Date(Date.now() + DUPLICATE_REFUND_CLAIM_MS),
      },
    },
    { returnDocument: 'after' }
  );
  if (!claimedRefund) {
    return { success: false, reason: 'DUPLICATE_CAPTURE_REFUND_IN_PROGRESS' };
  }

  try {
    const refund = await razorpayProvider.createRefund(
      capturePaymentId,
      Math.round(attempt.amount * 100),
      {
        reason: 'duplicate_payment_capture',
        order_id: orderId.toString(),
        duplicate_capture_refund_id: refundRecord._id.toString(),
      },
      `duplicate_${attempt._id.toString()}`
    );
    const processed = refund.status === 'processed';
    const settledRefund = await DuplicateCaptureRefund.findOneAndUpdate(
      { _id: refundRecord._id, status: 'PROCESSING', claimToken },
      {
        $set: {
          status: processed ? 'PROCESSED' : 'PENDING',
          razorpayRefundId: refund.id,
          ...(processed
            ? { processedAt: new Date() }
            : { failureReason: `Razorpay refund is ${refund.status}` }),
        },
        $unset: {
          claimToken: 1,
          claimExpiresAt: 1,
          ...(processed ? { failureReason: 1 } : { processedAt: 1 }),
        },
      },
      { returnDocument: 'after' }
    );
    if (!settledRefund) {
      const currentRefund = await DuplicateCaptureRefund.findById(refundRecord._id);
      if (currentRefund?.status !== 'PROCESSED' || currentRefund.razorpayRefundId !== refund.id) {
        return { success: false, reason: 'DUPLICATE_CAPTURE_REFUND_IN_PROGRESS' };
      }
    }
    await PaymentAttempt.updateOne(
      { _id: attempt._id },
      {
        $set: {
          status: processed ? 'FAILED' : 'PROCESSING',
          razorpayPaymentId: capturePaymentId,
          failureCode: processed
            ? 'DUPLICATE_CAPTURE_REFUNDED'
            : 'DUPLICATE_CAPTURE_REFUND_PENDING',
          failureReason: processed
            ? `Duplicate capture refunded as ${refund.id}`
            : `Duplicate capture refund is ${refund.status}`,
        },
      }
    );
    return {
      success: processed,
      reason: processed ? undefined : 'DUPLICATE_CAPTURE_REFUND_PENDING',
    };
  } catch (error) {
    const failureReason = error instanceof Error ? error.message : String(error);
    const unknownRefund = await DuplicateCaptureRefund.findOneAndUpdate(
      { _id: refundRecord._id, status: 'PROCESSING', claimToken },
      {
        $set: { status: 'UNKNOWN', failureReason },
        $unset: { claimToken: 1, claimExpiresAt: 1 },
      },
      { returnDocument: 'after' }
    );
    if (!unknownRefund) {
      const currentRefund = await DuplicateCaptureRefund.findById(refundRecord._id);
      if (currentRefund?.status === 'PROCESSED') return { success: true };
      return { success: false, reason: 'DUPLICATE_CAPTURE_REFUND_IN_PROGRESS' };
    }
    await PaymentAttempt.updateOne(
      { _id: attempt._id },
      {
        $set: {
          status: 'PROCESSING',
          razorpayPaymentId: capturePaymentId,
          failureCode: 'DUPLICATE_CAPTURE_REFUND_UNKNOWN',
          failureReason,
        },
      }
    );
    console.error(`[PAYMENT PROCESSOR] Duplicate capture refund outcome is unknown for attempt ${attempt._id}:`, error);
    return { success: false, reason: 'DUPLICATE_CAPTURE_REFUND_UNKNOWN' };
  }
}


export const processPaymentSuccess = async (
  razorpayOrderId: string,
  razorpayPaymentId?: string,
  options: { session?: mongoose.ClientSession } = {}
) => {
  const session = options.session;
  const attempt = await PaymentAttempt.findOne({ razorpayOrderId }).session(session || null);
  if (!attempt) {
    console.warn(`[PAYMENT PROCESSOR] PaymentAttempt not found for razorpayOrderId: ${razorpayOrderId}`);
    return null;
  }

  const order = await Order.findById(attempt.orderId).session(session || null);
  if (!order) {
    console.warn(`[PAYMENT PROCESSOR] Order not found for id: ${attempt.orderId}`);
    return null;
  }

  if (razorpayPaymentId) {
    attempt.razorpayPaymentId = razorpayPaymentId;
  }

  // Idempotent execution of the same capture must not deduct inventory twice.
  if (order.paymentStatus === 'PAID' && order.status !== 'CANCELLED') {
    const payment = await Payment.findById(attempt.paymentId).session(session || null);
    if (
      attempt.failureCode === 'DUPLICATE_CAPTURE_REFUNDED' ||
      (razorpayPaymentId && payment?.razorpayPaymentId === razorpayPaymentId)
    ) {
      attempt.status = attempt.failureCode === 'DUPLICATE_CAPTURE_REFUNDED' ? 'FAILED' : 'CAPTURED';
      await attempt.save({ session: session || undefined });
      scheduleInvoiceIssuance(order._id, session);
      return { order, attempt, success: true };
    }

    const duplicatePaymentId = razorpayPaymentId || attempt.razorpayPaymentId;
    if (!duplicatePaymentId) {
      return { order, attempt, success: false, reason: 'DUPLICATE_CAPTURE_PAYMENT_ID_MISSING' };
    }

    if (session?.inTransaction()) {
      attempt.status = 'PROCESSING';
      attempt.razorpayPaymentId = duplicatePaymentId;
      attempt.failureCode = 'DUPLICATE_CAPTURE_REFUND_PENDING';
      attempt.failureReason = 'Duplicate capture refund queued until payment transaction commits';
      await attempt.save({ session });
      registerPostCommitHook(session, async () => {
        await refundDuplicateCapture(attempt._id, order._id, duplicatePaymentId);
      });
      return { order, attempt, success: false, reason: 'DUPLICATE_CAPTURE_REFUND_PENDING' };
    }

    const refundResult = await refundDuplicateCapture(attempt._id, order._id, duplicatePaymentId);
    const updatedAttempt = await PaymentAttempt.findById(attempt._id);
    return { order, attempt: updatedAttempt || attempt, ...refundResult };
  }
  if (order.status === 'CANCELLED' || order.status === 'EXPIRED') {
    return { order, attempt, success: false, reason: 'ORDER_CANCELLED' };
  }

  // Atomic claim: exactly one concurrent caller (verifyPayment vs. Razorpay webhook)
  // may perform the inventory deduction. Losers wait for the terminal order outcome.
  const claim = await PaymentAttempt.findOneAndUpdate(
    { _id: attempt._id, status: 'PENDING' },
    { $set: { status: 'PROCESSING' } },
    { session: session || undefined, returnDocument: 'after' }
  );

  if (!claim) {
    if (session && session.inTransaction()) {
      const liveAtt = await PaymentAttempt.findById(attempt._id).session(session);
      const liveOrder = liveAtt ? await Order.findById(liveAtt.orderId).session(session) : null;
      if (liveOrder) {
        if (liveOrder.paymentStatus === 'PAID' && liveOrder.status !== 'CANCELLED') {
          return { order: liveOrder, attempt: liveAtt, success: true };
        }
        if (liveOrder.status === 'CANCELLED' || liveOrder.status === 'EXPIRED') {
          return { order: liveOrder, attempt: liveAtt, success: false, reason: 'ORDER_CANCELLED' };
        }
      }
      return { order: liveOrder || order, attempt: liveAtt || attempt, success: false, reason: 'PROCESSING_IN_PROGRESS' };
    }
    const deadline = Date.now() + TERMINAL_POLL_MS * TERMINAL_POLL_MAX;
    while (Date.now() < deadline) {
      await sleep(TERMINAL_POLL_MS);
      const liveAtt = await PaymentAttempt.findById(attempt._id);
      const liveOrder = liveAtt ? await Order.findById(liveAtt.orderId) : null;
      if (liveOrder) {
        if (liveOrder.paymentStatus === 'PAID' && liveOrder.status !== 'CANCELLED') {
          return { order: liveOrder, attempt: liveAtt, success: true };
        }
        if (liveOrder.status === 'CANCELLED' || liveOrder.status === 'EXPIRED') {
          return { order: liveOrder, attempt: liveAtt, success: false, reason: 'ORDER_CANCELLED' };
        }
      }
      // Stale claim (previous processor crashed) → steal the lock and reprocess idempotently.
      if (liveAtt && liveAtt.status === 'PROCESSING' && Date.now() - new Date(liveAtt.updatedAt).getTime() > CLAIM_STALE_MS) {
        const stolen = await PaymentAttempt.findOneAndUpdate(
          { _id: attempt._id, status: 'PROCESSING', updatedAt: { $lte: new Date(Date.now() - CLAIM_STALE_MS) } },
          { $set: { status: 'PROCESSING' } },
          { returnDocument: 'after' }
        );
        if (stolen) {
          attempt.status = 'PROCESSING';
          break;
        }
      }
    }
    if (attempt.status !== 'PROCESSING') {
      return await buildTerminalResult(attempt.orderId, attempt);
    }
  }

  let stockAllocationFailed = false;

  try {
    const allocations = await InventoryAllocationService.resolveOrderAllocations(order.items);
    const deduction = await InventoryAllocationService.deductInventory(order._id, allocations, { session });
    if (!deduction.success) {
      stockAllocationFailed = true;
    }
  } catch (err) {
    console.error(`[PAYMENT PROCESSOR] Inventory allocation error for order ${order._id}:`, err);
    stockAllocationFailed = true;
  }

  if (stockAllocationFailed) {
    // 1b. Partial decrements already rolled back by InventoryAllocationService.deductInventory
    const paymentId = attempt.paymentId;
    const capturedPaymentId = razorpayPaymentId || attempt.razorpayPaymentId;

    // Only auto-refund when a capture is real (or explicitly mocked); with a dummy
    // key there is no captured money to return and the gateway call would throw.
    const keyId = process.env.RAZORPAY_KEY_ID;
    const isDummyKey = !keyId || keyId === 'dummy_key' || keyId.includes('dummy');
    const canAutoRefund =
      capturedPaymentId !== undefined &&
      (capturedPaymentId.startsWith('pay_mock_') ||
        capturedPaymentId.startsWith('order_mock_') ||
        !isDummyKey);

    if (canAutoRefund) {
      try {
        // Money was already captured at the gateway → record it, then auto-refund in full.
        await Payment.updateOne(
          { _id: paymentId },
          { status: 'CAPTURED', razorpayPaymentId: capturedPaymentId },
          { session: session || undefined }
        );

        attempt.status = 'CAPTURED';
        attempt.razorpayPaymentId = capturedPaymentId;
        await attempt.save({ session: session || undefined });

        order.paymentStatus = 'PAID';
        order.status = 'CANCELLED';
        await order.save({ session: session || undefined });
        await createInternalRefund({
          orderId: order._id.toString(),
          amount: order.total,
          reason: 'AUTO_REFUND_STOCK_UNAVAILABLE',
          actorId: order.userId.toString(),
          actorRole: 'SYSTEM',
          session: session || undefined
        });

        console.warn(`[PAYMENT PROCESSOR] Auto-refund initiated for cancelled order ${order._id} (stock unavailable)`);
      } catch (refundErr) {
        console.error(`[PAYMENT PROCESSOR] Auto-refund FAILED for order ${order._id}:`, refundErr);
        order.paymentStatus = 'FAILED';
        order.status = 'CANCELLED';
        await order.save({ session: session || undefined });
        attempt.status = 'FAILED';
        await attempt.save({ session: session || undefined });
      }
    } else {
      order.paymentStatus = 'FAILED';
      order.status = 'CANCELLED';
      await order.save({ session: session || undefined });

      attempt.status = 'FAILED';
      await attempt.save({ session: session || undefined });
    }

    if (order.discount > 0) {
      await releaseCouponReservation(order._id, 'STOCK_UNAVAILABLE', session || undefined).catch((releaseErr: unknown) => {
        console.error(JSON.stringify({
          level: 'ERROR',
          event: 'COUPON_RELEASE_FAILURE',
          orderId: order._id.toString(),
          reason: 'STOCK_UNAVAILABLE',
          message: releaseErr instanceof Error ? releaseErr.message : String(releaseErr),
        }));
      });
    }

    return { order, attempt, success: false, reason: 'STOCK_UNAVAILABLE' };
  }

  // 2. Update Order Status
  order.paymentStatus = 'PAID';
  order.status = 'CONFIRMED';
  await order.save({ session: session || undefined });

  // Issue the tax invoice as soon as payment is confirmed.
  scheduleInvoiceIssuance(order._id, session);

  // Asynchronously dispatch Order Confirmation & Payment Success Notifications ONLY post-commit
  const dispatchNotifications = async () => {
    try {
      const User = mongoose.model('User');
      const user = await User.findById(order.userId);
      if (user && user.email) {
        const { notificationService } = require('../notifications/notificationService');

        notificationService.notify({
          eventType: 'ORDER_CONFIRMED',
          entityType: 'ORDER',
          entityId: order._id,
          recipientEmail: user.email,
          idempotencyKey: `ORDER_CONFIRMED:${order._id}`,
          data: {
            customerName: user.name || 'Customer',
            orderNumber: order.orderNumber,
            items: order.items,
            total: order.total,
            shippingAddress: order.shippingAddress
          }
        });

        notificationService.notify({
          eventType: 'PAYMENT_SUCCESS',
          entityType: 'PAYMENT',
          entityId: attempt.paymentId || order._id,
          recipientEmail: user.email,
          idempotencyKey: `PAYMENT_SUCCESS:${order._id}`,
          data: {
            customerName: user.name || 'Customer',
            orderNumber: order.orderNumber,
            amount: order.total,
            paymentId: razorpayPaymentId || attempt.razorpayOrderId
          }
        });
      }
    } catch (notifErr) {
      console.error('[PAYMENT PROCESSOR] Notification dispatch exception:', notifErr);
    }
  };

  if (session && session.inTransaction()) {
    registerPostCommitHook(session, dispatchNotifications);
  } else {
    Promise.resolve().then(dispatchNotifications).catch(() => {});
  }
  // 3. Confirm Coupon Usage idempotently (from the reserved CouponUsage record)
  if (order.discount > 0) {
    try {
      await confirmCouponReservation(order._id, session || undefined);
    } catch (err) {
      console.error('[PAYMENT PROCESSOR] Error confirming coupon reservation:', err);
    }
  }

  // 4. Partial Cart Consumption: remove/decrement only items corresponding to this successfully paid Order
  try {
    const CartModel = mongoose.model('Cart');
    const cart = await CartModel.findOne({ userId: order.userId }).session(session || null);
    if (cart && cart.items && cart.items.length > 0) {
      for (const orderItem of order.items) {
        const cartItemIdx = cart.items.findIndex((ci: { productId: mongoose.Types.ObjectId; variantId: mongoose.Types.ObjectId; customDesignId?: mongoose.Types.ObjectId }) => {
          const matchProduct = ci.productId.toString() === orderItem.productId.toString();
          const matchVariant = ci.variantId.toString() === orderItem.variantId.toString();
          const orderCustomId = orderItem.customDesignId ? orderItem.customDesignId.toString() : null;
          const cartCustomId = ci.customDesignId ? ci.customDesignId.toString() : null;
          const matchCustom = orderCustomId === cartCustomId;
          return matchProduct && matchVariant && matchCustom;
        });

        if (cartItemIdx !== -1) {
          if (cart.items[cartItemIdx].quantity > orderItem.quantity) {
            cart.items[cartItemIdx].quantity -= orderItem.quantity;
          } else {
            cart.items.splice(cartItemIdx, 1);
          }
        }
      }

      if (order.discount > 0) {
        cart.couponCode = undefined;
      }

      await cart.save({ session: session || undefined });
    }
  } catch (cartErr) {
    console.error('[PAYMENT PROCESSOR] Error in partial cart consumption:', cartErr);
  }

  // 5. Update Payment Attempt & Payment Records
  attempt.status = 'CAPTURED';
  if (razorpayPaymentId) {
    attempt.razorpayPaymentId = razorpayPaymentId;
  }
  await attempt.save({ session: session || undefined });

  await Payment.updateOne(
    { _id: attempt.paymentId },
    { status: 'CAPTURED', razorpayPaymentId: razorpayPaymentId || attempt.razorpayPaymentId },
    { session: session || undefined }
  );
  return { order, attempt, success: true };
};