import mongoose from 'mongoose';
import { Order } from '../../models/Order';
import { Payment } from '../../models/Payment';
import { PaymentAttempt } from '../../models/PaymentAttempt';
import { Product } from '../../models/Product';
import { InventoryTransaction } from '../../models/InventoryTransaction';
import { createInternalRefund } from './refundService';

const CLAIM_STALE_MS = 10_000;
const TERMINAL_POLL_MS = 250;
const TERMINAL_POLL_MAX = 24;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
    return { order, attempt, success: true };
  }
  if (order.status === 'CANCELLED') {
    return { order, attempt, success: false, reason: 'ORDER_CANCELLED' };
  }
  return { order, attempt, success: false, reason: 'PROCESSING_IN_PROGRESS' };
};

const rollbackDecrements = async (
  orderId: mongoose.Types.ObjectId,
  decrementLog: Array<{ productId: any; variantId: any; totalQty: number }>
) => {
  for (const d of decrementLog) {
    await Product.updateOne(
      { _id: d.productId, 'variants._id': d.variantId },
      { $inc: { 'variants.$.stock': d.totalQty } }
    );
    await InventoryTransaction.deleteOne({
      orderId,
      productId: d.productId,
      variantId: d.variantId,
      type: 'SALE'
    });
  }
};

export const processPaymentSuccess = async (razorpayOrderId: string, razorpayPaymentId?: string) => {
  const attempt = await PaymentAttempt.findOne({ razorpayOrderId });
  if (!attempt) {
    console.warn(`[PAYMENT PROCESSOR] PaymentAttempt not found for razorpayOrderId: ${razorpayOrderId}`);
    return null;
  }

  const order = await Order.findById(attempt.orderId);
  if (!order) {
    console.warn(`[PAYMENT PROCESSOR] Order not found for id: ${attempt.orderId}`);
    return null;
  }

  if (razorpayPaymentId) {
    attempt.razorpayPaymentId = razorpayPaymentId;
  }

  // Idempotent execution: Already PAID (or CANCELLED after auto-refund) → nothing more to deduct.
  if (order.paymentStatus === 'PAID' && order.status !== 'CANCELLED') {
    attempt.status = 'CAPTURED';
    await attempt.save();
    return { order, attempt, success: true };
  }
  if (order.status === 'CANCELLED') {
    return { order, attempt, success: false, reason: 'ORDER_CANCELLED' };
  }

  // Atomic claim: exactly one concurrent caller (verifyPayment vs. Razorpay webhook)
  // may perform the inventory deduction. Losers wait for the terminal order outcome.
  const claim = await PaymentAttempt.findOneAndUpdate(
    { _id: attempt._id, status: 'PENDING' },
    { $set: { status: 'PROCESSING' } },
    { returnDocument: 'after' }
  );

  if (!claim) {
    const deadline = Date.now() + TERMINAL_POLL_MS * TERMINAL_POLL_MAX;
    while (Date.now() < deadline) {
      await sleep(TERMINAL_POLL_MS);
      const liveAtt = await PaymentAttempt.findById(attempt._id);
      const liveOrder = liveAtt ? await Order.findById(liveAtt.orderId) : null;
      if (liveOrder) {
        if (liveOrder.paymentStatus === 'PAID' && liveOrder.status !== 'CANCELLED') {
          return { order: liveOrder, attempt: liveAtt, success: true };
        }
        if (liveOrder.status === 'CANCELLED') {
          return { order: liveOrder, attempt: liveAtt, success: false, reason: 'STOCK_UNAVAILABLE' };
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

  const decrementLog: Array<{ productId: any; variantId: any; totalQty: number }> = [];
  let stockAllocationFailed = false;

  try {
    // 1. Atomic Inventory Deduction (grouped by product & variant to prevent duplicate updates)
    const variantMap = new Map<string, { productId: any; variantId: any; totalQty: number }>();

    for (const item of order.items) {
      const computedQty = item.isCustomized
        ? (item.customConfigurations || []).reduce(
            (sum: number, cfg: any) =>
              sum + (cfg.sizeDistribution || []).reduce((s: number, sd: any) => s + Math.max(0, Math.floor(Number(sd.quantity || 0))), 0),
            0
          )
        : Math.floor(Number(item.quantity || 1));

      if (!Number.isFinite(computedQty) || computedQty < 1) {
        console.warn(`[PAYMENT PROCESSOR] Invalid quantity ${computedQty} for item in order ${order._id}`);
        continue;
      }

      const key = `${item.productId.toString()}_${item.variantId.toString()}`;
      const existing = variantMap.get(key);
      if (existing) {
        existing.totalQty += computedQty;
      } else {
        variantMap.set(key, {
          productId: item.productId,
          variantId: item.variantId,
          totalQty: computedQty,
        });
      }
    }

    for (const entry of variantMap.values()) {
      const { productId, variantId, totalQty } = entry;
      if (totalQty < 1) continue;

      // Atomic conditional stock update — use $elemMatch so both conditions (_id AND stock >= qty)
      // apply to the SAME array element, preventing potential oversell on multi-variant products.
      const result = await Product.updateOne(
        {
          _id: productId,
          variants: {
            $elemMatch: {
              _id: variantId,
              stock: { $gte: totalQty },
            },
          },
        },
        {
          $inc: { 'variants.$.stock': -totalQty },
        }
      );

      if (result.modifiedCount === 1) {
        try {
          await InventoryTransaction.create({
            orderId: order._id,
            productId: productId,
            variantId: variantId,
            quantity: totalQty,
            type: 'SALE'
          });
          decrementLog.push({ productId, variantId, totalQty });
        } catch (createErr: any) {
          if (createErr.code !== 11000) {
            throw createErr;
          }
          // Unique (orderId, variantId, SALE) already exists → a previous run already
          // deducted this variant. Undo THIS run's duplicate $inc to avoid double-decrement.
          await Product.updateOne(
            { _id: productId, 'variants._id': variantId },
            { $inc: { 'variants.$.stock': totalQty } }
          );
        }
      } else {
        console.error(`[PAYMENT PROCESSOR] Overselling prevented for order ${order._id}, product ${productId}, variant ${variantId}`);
        stockAllocationFailed = true;
        break;
      }
    }
  } catch (err) {
    // Unexpected failure mid-loop → restore every decrement made in this run, then rethrow.
    await rollbackDecrements(order._id, decrementLog);
    throw err;
  }

  if (stockAllocationFailed) {
    // 1b. Roll back every partial decrement from THIS run (no leaked stock deductions).
    await rollbackDecrements(order._id, decrementLog);

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
          { status: 'CAPTURED', razorpayPaymentId: capturedPaymentId }
        );

        attempt.status = 'CAPTURED';
        attempt.razorpayPaymentId = capturedPaymentId;
        await attempt.save();

        order.paymentStatus = 'PAID';
        order.status = 'CANCELLED';
        await order.save();

        await createInternalRefund({
          orderId: order._id.toString(),
          amount: order.total,
          reason: 'AUTO_REFUND_STOCK_UNAVAILABLE',
          actorId: order.userId.toString(),
          actorRole: 'SYSTEM'
        });

        console.warn(`[PAYMENT PROCESSOR] Auto-refund initiated for cancelled order ${order._id} (stock unavailable)`);
      } catch (refundErr) {
        console.error(`[PAYMENT PROCESSOR] Auto-refund FAILED for order ${order._id}:`, refundErr);
        order.paymentStatus = 'FAILED';
        order.status = 'CANCELLED';
        await order.save();
        attempt.status = 'FAILED';
        await attempt.save();
      }
    } else {
      order.paymentStatus = 'FAILED';
      order.status = 'CANCELLED';
      await order.save();

      attempt.status = 'FAILED';
      await attempt.save();
    }

    return { order, attempt, success: false, reason: 'STOCK_UNAVAILABLE' };
  }

  // 2. Update Order Status
  order.paymentStatus = 'PAID';
  order.status = 'CONFIRMED';
  await order.save();

  // Asynchronously dispatch Order Confirmation & Payment Success Notifications
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

  // 3. Increment Coupon Usage idempotently (from the Order snapshot, never a live cart)
  if (order.discount > 0) {
    try {
      const CouponModel = mongoose.model('Coupon');
      const CouponUsageModel = mongoose.model('CouponUsage');

      const code = (order as any).couponCode as string | undefined;
      const couponId = (order as any).couponId as string | undefined;
      if (code || couponId) {
        const coupon = couponId
          ? await CouponModel.findById(couponId)
          : await CouponModel.findOne({ code: code!.toUpperCase() });
        if (coupon) {
          const usageExists = await CouponUsageModel.findOne({ orderId: order._id });
          if (!usageExists) {
            const updateRes = await CouponModel.updateOne(
              { _id: coupon._id, $or: [{ usageLimit: { $exists: false } }, { $expr: { $lt: ["$usedCount", "$usageLimit"] } }] },
              { $inc: { usedCount: 1 } }
            );
            if (updateRes.modifiedCount === 1) {
              await CouponUsageModel.create({
                couponId: coupon._id,
                userId: order.userId,
                orderId: order._id,
                discountAmount: order.discount,
              });
            }
          }
        }
      }
    } catch (err) {
      console.error('[PAYMENT PROCESSOR] Error tracking coupon usage:', err);
    }
  }

  // 4. Partial Cart Consumption: remove/decrement only items corresponding to this successfully paid Order
  try {
    const CartModel = mongoose.model('Cart');
    const cart = await CartModel.findOne({ userId: order.userId });
    if (cart && cart.items && cart.items.length > 0) {
      for (const orderItem of order.items) {
        const cartItemIdx = cart.items.findIndex((ci: any) => {
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

      await cart.save();
    }
  } catch (cartErr) {
    console.error('[PAYMENT PROCESSOR] Error in partial cart consumption:', cartErr);
  }

  // 5. Update Payment Attempt & Payment Records
  attempt.status = 'CAPTURED';
  await attempt.save();

  await Payment.updateOne(
    { _id: attempt.paymentId },
    { status: 'CAPTURED', razorpayPaymentId: razorpayPaymentId || attempt.razorpayPaymentId }
  );

  return { order, attempt, success: true };
};