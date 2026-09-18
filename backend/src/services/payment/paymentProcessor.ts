import mongoose from 'mongoose';
import { Order } from '../../models/Order';
import { Payment } from '../../models/Payment';
import { PaymentAttempt } from '../../models/PaymentAttempt';
import { Product } from '../../models/Product';
import { InventoryTransaction } from '../../models/InventoryTransaction';

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

  // Idempotent execution: Only process inventory & order status if not already PAID
  if (order.paymentStatus !== 'PAID') {
    // 1. Idempotent Inventory Deduction
    for (const item of order.items) {
      const transactionExists = await InventoryTransaction.findOne({
        orderId: order._id,
        variantId: item.variantId,
        type: 'SALE'
      });

      if (!transactionExists) {
        // Atomic conditional stock update — use $elemMatch so both conditions (_id AND stock >= qty)
        // apply to the SAME array element, preventing potential oversell on multi-variant products
        const totalQty = item.isCustomized
          ? (item.customConfigurations || []).reduce(
              (sum: number, cfg: any) =>
                sum + (cfg.sizeDistribution || []).reduce((s: number, sd: any) => s + (sd.quantity || 0), 0),
              0
            )
          : item.quantity;

        const result = await Product.updateOne(
          {
            _id: item.productId,
            variants: {
              $elemMatch: {
                _id: item.variantId,
                stock: { $gte: totalQty },
              },
            },
          },
          {
            $inc: { 'variants.$.stock': -totalQty },
          }
        );

        if (result.modifiedCount === 1) {
          await InventoryTransaction.create({
            orderId: order._id,
            productId: item.productId,
            variantId: item.variantId,
            quantity: item.quantity,
            type: 'SALE'
          });
        } else {
          console.error(`[PAYMENT PROCESSOR] Overselling prevented for order ${order._id}, product ${item.productId}`);
        }
      }
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

    // 3. Increment Coupon Usage idempotently
    if (order.discount > 0) {
      try {
        const CartModel = mongoose.model('Cart');
        const CouponModel = mongoose.model('Coupon');
        const CouponUsageModel = mongoose.model('CouponUsage');
        
        const cart = await CartModel.findOne({ userId: order.userId });
        const code = cart?.couponCode;
        if (code) {
          const coupon = await CouponModel.findOne({ code: code.toUpperCase() });
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
  } else {
    // If order was already PAID, just make sure attempt status is updated
    attempt.status = 'CAPTURED';
    await attempt.save();
  }

  return { order, attempt };
};
