import { Order } from '../../models/Order';
import { Payment } from '../../models/Payment';
import { PaymentAttempt } from '../../models/PaymentAttempt';
import { Refund } from '../../models/Refund';
import { AuditLog } from '../../models/AuditLog';
import { AppError } from '../../utils/AppError';
import { razorpayProvider } from './RazorpayProvider';

interface CreateRefundParams {
  orderId: string;
  amount?: number; // if not provided, full remaining amount is refunded
  reason: string;
  actorId: string;
  actorRole: string;
}

export const createInternalRefund = async ({ orderId, amount, reason, actorId, actorRole }: CreateRefundParams) => {
  const order = await Order.findById(orderId);
  if (!order) throw new AppError('Order not found', 404);

  if (order.paymentStatus !== 'PAID') {
    throw new AppError('Refunds can only be processed for PAID orders', 400);
  }

  const payment = await Payment.findOne({ orderId: order._id });
  if (!payment) throw new AppError('Payment record not found', 404);

  if (payment.status !== 'CAPTURED') {
    throw new AppError('Refunds can only be processed for CAPTURED payments', 400);
  }

  const attempt = await PaymentAttempt.findOne({ paymentId: payment._id, status: 'CAPTURED' });
  if (!attempt || !attempt.razorpayPaymentId) {
    throw new AppError('Valid Razorpay Payment ID not found', 400);
  }

  // Remaining refundable = amount - processed - in-flight (reserved) refunds.
  const remainder = payment.amount - (payment.refundedAmount || 0) - (payment.pendingRefundAmount || 0);

  // Default to full remaining when amount is not provided explicitly
  const refundAmount = amount ? Number(amount) : remainder;

  if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
    throw new AppError('Refund amount must be greater than zero', 400);
  }
  if (refundAmount > remainder) {
    throw new AppError(`Cannot refund more than the remaining refundable amount (₹${remainder.toFixed(2)})`, 400);
  }
  if (order.currency !== payment.currency) {
    throw new AppError('Currency mismatch', 400);
  }

  // Convert to paise safely (integer arithmetic)
  const amountInPaise = Math.round(refundAmount * 100);

  // Atomically reserve the amount on the Payment document. $expr guards against
  // concurrent refunds overshooting the remaining balance (read-then-write TOCTOU).
  const reservationFilter: any = {
    _id: payment._id,
    status: 'CAPTURED',
    $expr: {
      $gte: [
        {
          $subtract: [
            { $subtract: ['$amount', { $ifNull: ['$refundedAmount', 0] }] },
            { $ifNull: ['$pendingRefundAmount', 0] },
          ],
        },
        refundAmount,
      ],
    },
  };
  const reserved = (await Payment.findOneAndUpdate(
    reservationFilter,
    { $inc: { pendingRefundAmount: refundAmount } },
    { returnDocument: 'after' }
  )) as any;

  if (!reserved) {
    const fresh = await Payment.findById(payment._id);
    const remaining =
      (payment.amount || 0) - (fresh?.refundedAmount || 0) - (fresh?.pendingRefundAmount || 0);
    throw new AppError(
      `Cannot refund more than the remaining refundable amount (₹${remaining.toFixed(2)})`,
      400
    );
  }

  // Create Internal Refund record (PENDING)
  const refund = await Refund.create({
    orderId: order._id,
    paymentId: payment._id,
    userId: order.userId,
    amount: refundAmount,
    currency: payment.currency,
    status: 'PENDING',
    reason: reason || 'Admin initiated refund',
    razorpayPaymentId: attempt.razorpayPaymentId,
    initiatedBy: actorId,
    initiatedByRole: actorRole
  });

  try {
    // Call Razorpay API
    const razorpayRefund = await razorpayProvider.createRefund(
      attempt.razorpayPaymentId, 
      amountInPaise, 
      { internal_refund_id: refund._id.toString() }
    );

    // Successfully sent to Razorpay
    refund.razorpayRefundId = razorpayRefund.id;
    await refund.save();

    // Audit Log
    await AuditLog.create({
      actorId: actorId,
      actorRole: actorRole,
      action: 'ADMIN_REFUND_REQUESTED',
      entityType: 'ORDER',
      entityId: order._id,
      metadata: {
        refundId: refund._id,
        amount: refundAmount,
        razorpayRefundId: razorpayRefund.id,
        reason
      }
    });

    return refund;

  } catch (razorpayError: any) {
    // Release the reservation: the refund was never sent to the gateway.
    await Payment.updateOne(
      { _id: payment._id },
      { $inc: { pendingRefundAmount: -refundAmount } }
    );

    // Razorpay rejected the API call immediately
    refund.status = 'FAILED';
    refund.reason = `Razorpay API Error: ${razorpayError.error?.description || razorpayError.message}`;
    await refund.save();

    await AuditLog.create({
      actorId: actorId,
      actorRole: actorRole,
      action: 'ADMIN_REFUND_FAILED',
      entityType: 'ORDER',
      entityId: order._id,
      metadata: {
        refundId: refund._id,
        amount: refundAmount,
        reason: refund.reason
      }
    });

    throw new AppError(refund.reason, 400);
  }
};
