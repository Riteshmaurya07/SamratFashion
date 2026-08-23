import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { WebhookEvent } from '../models/WebhookEvent';
import { PaymentAttempt } from '../models/PaymentAttempt';
import { Payment } from '../models/Payment';
import { Order } from '../models/Order';
import { Product } from '../models/Product';
import { InventoryTransaction } from '../models/InventoryTransaction';
import { Refund } from '../models/Refund';
import { razorpayProvider } from '../services/payment/RazorpayProvider';

export const razorpayWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    const signature = req.headers['x-razorpay-signature'] as string;
    if (!signature) {
      res.status(400).send('Missing signature');
      return;
    }

    // req.body should be a Buffer because of express.raw
    const rawBody = req.body.toString('utf8');
    const isValid = razorpayProvider.verifyWebhookSignature(rawBody, signature);

    if (!isValid) {
      res.status(400).send('Invalid signature');
      return;
    }

    const payload = JSON.parse(rawBody);
    const eventId = req.headers['x-razorpay-event-id'] as string || payload.event_id;
    const eventType = payload.event;

    // Idempotency Check
    if (eventId) {
      const existingEvent = await WebhookEvent.findOne({ provider: 'RAZORPAY', eventId });
      if (existingEvent && existingEvent.status === 'PROCESSED') {
        res.status(200).send('Event already processed');
        return;
      }
      
      if (!existingEvent) {
        await WebhookEvent.create({
          eventId,
          provider: 'RAZORPAY',
          eventType,
          status: 'IGNORED'
        });
      }
    }

    // Process Supported Events
    if (eventType === 'payment.captured' || eventType === 'order.paid') {
      const paymentEntity = payload.payload.payment.entity;
      const razorpayOrderId = paymentEntity.order_id;
      const razorpayPaymentId = paymentEntity.id;
      const amountInPaise = paymentEntity.amount;
      const currency = paymentEntity.currency;

      const attempt = await PaymentAttempt.findOne({ razorpayOrderId });
      if (!attempt) {
        res.status(200).send('Attempt not found');
        return;
      }

      const order = await Order.findById(attempt.orderId);
      if (!order) {
        res.status(200).send('Order not found');
        return;
      }

      // Security check
      if (Math.round(order.total * 100) !== amountInPaise || (order.currency || 'INR') !== currency) {
        console.error('Webhook amount/currency mismatch', { orderId: order._id, rpAmount: amountInPaise });
        res.status(200).send('Amount mismatch');
        return;
      }

      // Only process if not already PAID
      if (order.paymentStatus !== 'PAID') {
        // Idempotent Inventory Deduction
        for (const item of order.items) {
          const transactionExists = await InventoryTransaction.findOne({
            orderId: order._id,
            variantId: item.variantId,
            type: 'SALE'
          });

          if (!transactionExists) {
            // Atomic conditional update
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
              // Stock deduction failed (overselling prevented). Log for admin intervention.
              console.error(`Overselling prevented for order ${order._id}, product ${item.productId}`);
            }
          }
        }

        // Update Order
        order.paymentStatus = 'PAID';
        order.status = 'CONFIRMED';
        await order.save();

        // Increment Coupon Usage idempotently on payment capture
        if (order.discount > 0) {
          const cart = await mongoose.model('Cart').findOne({ userId: order.userId });
          const code = cart?.couponCode;
          if (code) {
            const CouponModel = mongoose.model('Coupon');
            const CouponUsageModel = mongoose.model('CouponUsage');
            const coupon = await CouponModel.findOne({ code: code.toUpperCase() });
            if (coupon) {
              const usageExists = await CouponUsageModel.findOne({ orderId: order._id });
              if (!usageExists) {
                // Atomic conditional update
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
        }
        
        // Update Payment Attempt
        attempt.status = 'CAPTURED';
        attempt.razorpayPaymentId = razorpayPaymentId;
        await attempt.save();

        // Update Payment
        await Payment.updateOne({ _id: attempt.paymentId }, { status: 'CAPTURED' });
      }

    } else if (eventType === 'payment.failed') {
      const paymentEntity = payload.payload.payment.entity;
      const razorpayOrderId = paymentEntity.order_id;
      
      const attempt = await PaymentAttempt.findOne({ razorpayOrderId });
      if (attempt) {
        attempt.status = 'FAILED';
        attempt.failureCode = paymentEntity.error_code;
        attempt.failureReason = paymentEntity.error_description;
        await attempt.save();

        // Update Payment overall status if necessary
        const payment = await Payment.findById(attempt.paymentId);
        if (payment && payment.status === 'PENDING') {
          payment.status = 'FAILED';
          await payment.save();
        }

        // Update internal order payment status
        const order = await Order.findById(attempt.orderId);
        if (order && order.paymentStatus === 'PENDING') {
          order.paymentStatus = 'FAILED';
          await order.save();
        }
      }
    } else if (eventType === 'refund.processed') {
      const refundEntity = payload.payload.refund.entity;
      const razorpayRefundId = refundEntity.id;
      const razorpayPaymentId = refundEntity.payment_id;
      
      const notes = refundEntity.notes || {};
      const internalRefundId = notes.internal_refund_id;

      let refundRecord;
      if (internalRefundId) {
        refundRecord = await Refund.findById(internalRefundId);
      } else {
        refundRecord = await Refund.findOne({ razorpayPaymentId, status: 'PENDING' });
      }

      if (refundRecord && refundRecord.status !== 'PROCESSED') {
        refundRecord.status = 'PROCESSED';
        refundRecord.razorpayRefundId = razorpayRefundId;
        await refundRecord.save();

        const payment = await Payment.findById(refundRecord.paymentId);
        if (payment) {
          // Atomically increment refundedAmount
          payment.refundedAmount = (payment.refundedAmount || 0) + refundRecord.amount;
          
          if (payment.refundedAmount >= payment.amount) {
            payment.status = 'REFUNDED';
          }
          await payment.save();

          const order = await Order.findById(payment.orderId);
          if (order) {
            if (payment.status === 'REFUNDED') {
              order.paymentStatus = 'REFUNDED';
            }
            await order.save();

            // Inventory Restoration Logic for CANCELLED orders
            if (order.status === 'CANCELLED') {
              for (const item of order.items) {
                // Ensure idempotency for restoration
                const existingRestoration = await InventoryTransaction.findOne({
                  orderId: order._id,
                  variantId: item.variantId,
                  type: 'REFUND',
                  refundId: refundRecord._id
                });

                if (!existingRestoration) {
                  // Atomically restore stock
                  await Product.updateOne(
                    { _id: item.productId, 'variants._id': item.variantId },
                    { $inc: { 'variants.$.stock': item.quantity } }
                  );

                  await InventoryTransaction.create({
                    orderId: order._id,
                    productId: item.productId,
                    variantId: item.variantId,
                    quantity: item.quantity,
                    type: 'REFUND',
                    refundId: refundRecord._id
                  });
                }
              }
            }

            // Phase 7E: Return Request Restoration Logic
            const mongoose = require('mongoose');
            const ReturnRequest = mongoose.model('ReturnRequest');
            const returnReq = await ReturnRequest.findOne({ refundId: refundRecord._id, status: 'ACCEPTED' });
            
            if (returnReq) {
              let allRestored = true;
              for (const item of returnReq.items) {
                const existingRestoration = await InventoryTransaction.findOne({
                  orderId: order._id,
                  variantId: item.variantId,
                  type: 'RETURN',
                  returnId: returnReq._id
                });

                if (!existingRestoration) {
                  const result = await Product.updateOne(
                    { _id: item.productId, 'variants._id': item.variantId },
                    { $inc: { 'variants.$.stock': item.quantity } }
                  );
                  if (result.modifiedCount === 1) {
                    await InventoryTransaction.create({
                      orderId: order._id,
                      productId: item.productId,
                      variantId: item.variantId,
                      quantity: item.quantity,
                      type: 'RETURN',
                      returnId: returnReq._id
                    });
                  } else {
                    allRestored = false;
                  }
                }
              }
              if (allRestored) {
                returnReq.status = 'COMPLETED';
                returnReq.completedAt = new Date();
                await returnReq.save();
              }
            }
          }
        }
      }
    } else if (eventType === 'refund.failed') {
      const refundEntity = payload.payload.refund.entity;
      const razorpayRefundId = refundEntity.id;
      
      const refundRecord = await Refund.findOne({ razorpayRefundId });
      if (refundRecord && refundRecord.status !== 'FAILED') {
        refundRecord.status = 'FAILED';
        await refundRecord.save();
      }
    }

    if (eventId) {
      await WebhookEvent.updateOne(
        { provider: 'RAZORPAY', eventId }, 
        { status: 'PROCESSED' }
      );
    }

    res.status(200).send('OK');
  } catch (error: any) {
    console.error('Webhook error:', error);
    res.status(500).send('Internal Server Error');
  }
};
