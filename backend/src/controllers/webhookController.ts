import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { WebhookEvent } from '../models/WebhookEvent';
import { PaymentAttempt } from '../models/PaymentAttempt';
import { Payment, IPayment } from '../models/Payment';
import { Order } from '../models/Order';
import { Product } from '../models/Product';
import { InventoryTransaction } from '../models/InventoryTransaction';
import { Refund, IRefund } from '../models/Refund';
import { razorpayProvider } from '../services/payment/RazorpayProvider';
import { processPaymentSuccess } from '../services/payment/paymentProcessor';

interface RefundEntity {
  id: string;
  payment_id?: string;
  notes?: Record<string, string>;
}

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

      await processPaymentSuccess(razorpayOrderId, razorpayPaymentId);
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
      await handleRefundProcessedEntity(payload.payload.refund.entity);
    } else if (eventType === 'refund.failed') {
      await handleRefundFailedEntity(payload.payload.refund.entity);
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

/**
 * DB-side handling of a Razorpay `refund.processed` event. Exported separately
 * from the HTTP endpoint so the transition logic can be unit-tested directly
 * with a stubbed entity (no signature/HTTP harness needed).
 */
async function handleRefundProcessedEntity(refundEntity: RefundEntity): Promise<void> {
  const razorpayRefundId = refundEntity.id;
  const razorpayPaymentId = refundEntity.payment_id || '';

  const notes = refundEntity.notes || {};
  const internalRefundId = notes.internal_refund_id;

  // Atomic claim: exactly one delivery (of any retries) flips a PENDING refund to
  // PROCESSED; later deliveries become idempotent no-ops.
  const refundSelector: any = internalRefundId
    ? { _id: internalRefundId, status: 'PENDING' }
    : { razorpayPaymentId, status: 'PENDING' };
  const refundRecord = (await Refund.findOneAndUpdate(
    refundSelector,
    { status: 'PROCESSED', razorpayRefundId },
    { returnDocument: 'after' }
  )) as IRefund | null;

  if (refundRecord) {
    const amount = refundRecord.amount || 0;

    // Move the reserved amount into refundedAmount in a single atomic pipeline update
    // (mirrors the reservation created in createInternalRefund).
    const payment = (await Payment.findOneAndUpdate(
      { _id: refundRecord.paymentId },
      [
        {
          $set: {
            refundedAmount: { $add: [{ $ifNull: ['$refundedAmount', 0] }, amount] },
            pendingRefundAmount: { $subtract: [{ $ifNull: ['$pendingRefundAmount', 0] }, amount] },
          },
        },
      ],
      { returnDocument: 'after', updatePipeline: true }
    )) as IPayment | null;

    if (payment) {
      const nowFullyRefunded = payment.refundedAmount >= payment.amount;
      if (nowFullyRefunded) {
        await Payment.updateOne({ _id: payment._id }, { status: 'REFUNDED' });
      }

      const order = await Order.findById(payment.orderId);
      if (order) {
        if (nowFullyRefunded) {
          order.paymentStatus = 'REFUNDED';
        }
        await order.save();

        // Inventory Restoration Logic for CANCELLED orders
        if (order.status === 'CANCELLED') {
          for (const item of order.items) {
            // Only restore stock that was actually deducted for this order+variant
            // (auto-refunded stock-failure orders never decremented successfully).
            const saleTxn = await InventoryTransaction.findOne({
              orderId: order._id,
              variantId: item.variantId,
              type: 'SALE'
            });
            if (!saleTxn) continue;

            // Pre-check: the sparse unique (orderId, variantId, type) index is the
            // authoritative guard, but this keeps us from inc'ing when not needed.
            const alreadyRestored = await InventoryTransaction.findOne({
              orderId: order._id,
              variantId: item.variantId,
              type: 'REFUND'
            });
            if (alreadyRestored) continue;

            await Product.updateOne(
              { _id: item.productId, 'variants._id': item.variantId },
              { $inc: { 'variants.$.stock': item.quantity } }
            );

            try {
              await InventoryTransaction.create({
                orderId: order._id,
                productId: item.productId,
                variantId: item.variantId,
                quantity: item.quantity,
                type: 'REFUND',
                refundId: refundRecord._id
              });
            } catch (err: any) {
              if (err?.code === 11000) {
                // Another refund (or a retried delivery) restored this variant first.
                // Roll our increment back so stock cannot be double-restored.
                await Product.updateOne(
                  { _id: item.productId, 'variants._id': item.variantId },
                  { $inc: { 'variants.$.stock': -item.quantity } }
                );
              } else {
                throw err;
              }
            }
          }
        }

        // Phase 7E: Return Request Restoration Logic
        const ReturnRequest = mongoose.model('ReturnRequest');
        const returnReq = await ReturnRequest.findOne({ refundId: refundRecord._id, status: 'ACCEPTED' });

        if (returnReq) {
          let allRestored = true;
          for (const item of returnReq.items) {
            try {
              const existingRestoration = await InventoryTransaction.findOne({
                orderId: order._id,
                variantId: item.variantId,
                type: 'RETURN'
              });
              if (existingRestoration) continue;

              const result = await Product.updateOne(
                { _id: item.productId, 'variants._id': item.variantId },
                { $inc: { 'variants.$.stock': item.quantity } }
              );
              if (result.modifiedCount === 1) {
                try {
                  await InventoryTransaction.create({
                    orderId: order._id,
                    productId: item.productId,
                    variantId: item.variantId,
                    quantity: item.quantity,
                    type: 'RETURN',
                    returnId: returnReq._id
                  });
                } catch (err: any) {
                  if (err?.code === 11000) {
                    // A previous return already restored this variant; undo our inc.
                    await Product.updateOne(
                      { _id: item.productId, 'variants._id': item.variantId },
                      { $inc: { 'variants.$.stock': -item.quantity } }
                    );
                  } else {
                    throw err;
                  }
                }
              } else {
                allRestored = false;
              }
            } catch (restoreErr) {
              allRestored = false;
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
}

/**
 * DB-side handling of a Razorpay `refund.failed` event. Exported for tests.
 */
async function handleRefundFailedEntity(refundEntity: RefundEntity): Promise<void> {
  const razorpayRefundId = refundEntity.id;

  // Atomic claim: only flip a PENDING record; a retried failure event is a no-op.
  const refundRecord = await Refund.findOneAndUpdate(
    { _id: refundEntity.notes?.internal_refund_id, status: 'PENDING' },
    { status: 'FAILED', razorpayRefundId },
    { returnDocument: 'after' }
  );

  if (refundRecord) {
    // Release the reservation made at refund creation so the balance is refundable again.
    await Payment.updateOne(
      { _id: refundRecord.paymentId },
      { $inc: { pendingRefundAmount: -(refundRecord.amount || 0) } }
    );
  }
}

export { handleRefundProcessedEntity, handleRefundFailedEntity };