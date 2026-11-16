import mongoose from 'mongoose';

/**
 * Identity linkage required before a captured gateway payment may be applied to
 * (or repaired against) an internal order.
 *
 * Reconciliation used to trust `PaymentAttempt.razorpayOrderId` on its own. That
 * is not enough: a stale/duplicated attempt row pointing at another order would
 * let captured money be applied to the wrong order. Every write must prove:
 *   attempt.orderId === order._id
 *   attempt.razorpayOrderId === gateway order id
 *   payment.orderId === order._id (when a payment record exists)
 *   attempt.paymentId === payment._id (when both are present)
 */
export interface ReconciliationLinkageInput {
  order: { _id: mongoose.Types.ObjectId; orderNumber?: string };
  attempt: {
    _id?: mongoose.Types.ObjectId;
    orderId: mongoose.Types.ObjectId;
    paymentId?: mongoose.Types.ObjectId | null;
    razorpayOrderId: string;
  };
  payment?: { _id: mongoose.Types.ObjectId; orderId: mongoose.Types.ObjectId } | null;
  gatewayOrderId: string;
}

export class ReconciliationLinkageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReconciliationLinkageError';
  }
}

export function assertReconciliationLinkage(input: ReconciliationLinkageInput): void {
  const { order, attempt, payment, gatewayOrderId } = input;

  if (!attempt.orderId || attempt.orderId.toString() !== order._id.toString()) {
    throw new ReconciliationLinkageError(
      `Payment attempt belongs to order ${attempt.orderId?.toString() || '(none)'}, not ${order._id.toString()} (${order.orderNumber || 'no order number'}).`
    );
  }

  if (!gatewayOrderId || attempt.razorpayOrderId !== gatewayOrderId) {
    throw new ReconciliationLinkageError(
      `Payment attempt is bound to Razorpay order ${attempt.razorpayOrderId || '(none)'}, not ${gatewayOrderId || '(none)'}.`
    );
  }

  if (payment) {
    if (!payment.orderId || payment.orderId.toString() !== order._id.toString()) {
      throw new ReconciliationLinkageError(
        `Payment ${payment._id.toString()} belongs to order ${payment.orderId?.toString() || '(none)'}, not ${order._id.toString()}.`
      );
    }
    if (attempt.paymentId && attempt.paymentId.toString() !== payment._id.toString()) {
      throw new ReconciliationLinkageError(
        `Payment attempt references payment ${attempt.paymentId.toString()} but the record on this order is ${payment._id.toString()}.`
      );
    }
  }
}
