import { Order } from '../../models/Order';
import { Payment } from '../../models/Payment';
import { PaymentAttempt } from '../../models/PaymentAttempt';
import { Refund } from '../../models/Refund';
import { AuditLog } from '../../models/AuditLog';
import { AppError } from '../../utils/AppError';
import { razorpayProvider } from './RazorpayProvider';
import mongoose from 'mongoose';

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

  // Calculate maximum refundable amount
  const capturedAmount = payment.amount;
  const previouslyRefunded = payment.refundedAmount || 0;
  
  // Check if there are any PENDING refunds that haven't been finalized yet
  const pendingRefunds = await Refund.find({ paymentId: payment._id, status: 'PENDING' });
  const pendingAmount = pendingRefunds.reduce((sum, r) => sum + r.amount, 0);

  const remainingRefundable = capturedAmount - previouslyRefunded - pendingAmount;

  // Default to full remaining if amount is not provided explicitly
  const refundAmount = amount ? Number(amount) : remainingRefundable;

  if (refundAmount <= 0) {
    throw new AppError('Refund amount must be greater than zero', 400);
  }
  if (refundAmount > remainingRefundable) {
    throw new AppError(`Cannot refund more than the remaining refundable amount (₹${remainingRefundable})`, 400);
  }
  if (order.currency !== payment.currency) {
    throw new AppError('Currency mismatch', 400);
  }

  // Convert to paise safely (integer arithmetic)
  const amountInPaise = Math.round(refundAmount * 100);

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
