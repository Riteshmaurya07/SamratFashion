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
        // Atomic conditional stock update
        const result = await Product.updateOne(
          { 
            _id: item.productId, 
            'variants._id': item.variantId, 
            'variants.stock': { $gte: item.quantity } 
          },
          { 
            $inc: { 'variants.$.stock': -item.quantity } 
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

    // 4. Update Payment Attempt & Payment Records
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
