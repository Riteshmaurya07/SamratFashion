import { Request, Response } from 'express';
import { Order } from '../models/Order';
import { Payment } from '../models/Payment';
import { PaymentAttempt } from '../models/PaymentAttempt';
import { razorpayProvider, isMockPaymentPermitted } from '../services/payment/RazorpayProvider';
import { isStrictProductionOrStaging } from '../config/env';
import { processPaymentSuccess } from '../services/payment/paymentProcessor';
import { AppError } from '../utils/AppError';

interface AuthRequest extends Request {
  user?: any;
}

export const createPaymentOrder = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) throw new AppError('Unauthorized', 401);

    const { orderId } = req.body;
    if (!orderId) throw new AppError('orderId is required', 400);

    const keyId = process.env.RAZORPAY_KEY_ID;
    const isStrictEnv = isStrictProductionOrStaging();

    if (isStrictEnv && process.env.ALLOW_PAYMENT_MOCK === 'true') {
      throw new AppError('Configuration error: Mock payments are forbidden in production and staging environments.', 500, 'PAYMENT_CONFIG_ERROR');
    }

    if (!keyId || keyId === 'dummy_key' || keyId.includes('dummy')) {
      if (isStrictEnv) {
        throw new AppError('Payment gateway configuration error: RAZORPAY_KEY_ID is missing on backend server.', 500, 'PAYMENT_CONFIG_ERROR');
      } else if (!isMockPaymentPermitted()) {
        throw new AppError('Payment gateway configuration error: RAZORPAY_KEY_ID is not configured. Set ALLOW_PAYMENT_MOCK=true in .env to enable local dev mocks.', 500, 'PAYMENT_CONFIG_ERROR');
      }
    }

    const order = await Order.findOne({ _id: orderId, userId: req.user.id });
    if (!order) throw new AppError('Order not found', 404);

    if (order.paymentStatus !== 'PENDING' && order.paymentStatus !== 'FAILED') {
      throw new AppError(`Cannot create payment for order with status ${order.paymentStatus}`, 400);
    }

    // Expired/cancelled orders are terminal: never allow a retry to resurrect them
    // after the reaper (or an admin) closed them.
    if (order.status !== 'PENDING') {
      throw new AppError(`This order is no longer payable (status ${order.status})`, 400);
    }

    // A captured-but-unapplied payment must be reconciled by a human before a
    // second charge is allowed; retrying here would take the money twice.
    // This covers both the explicit reconciliation flag and any capture that is
    // still recorded on a non-paid order (e.g. attempt CAPTURED, payment CAPTURED).
    const [existingPayment, capturedAttempt] = await Promise.all([
      Payment.findOne({ orderId: order._id }),
      PaymentAttempt.findOne({
        orderId: order._id,
        razorpayPaymentId: { $exists: true, $nin: [null, ''] },
        status: { $in: ['CAPTURED', 'PROCESSING'] },
      }),
    ]);
    const captureAwaitsReconciliation =
      Boolean(existingPayment?.reconciliationRequired) ||
      Boolean(existingPayment && existingPayment.status === 'CAPTURED') ||
      Boolean(existingPayment?.razorpayPaymentId) ||
      Boolean(capturedAttempt);
    if (captureAwaitsReconciliation) {
      throw new AppError(
        'A captured payment for this order is awaiting reconciliation. Please contact support instead of paying again.',
        409,
        'PAYMENT_RECONCILIATION_REQUIRED'
      );
    }

    // Amount in paise
    const amountInPaise = Math.round(order.total * 100);
    if (amountInPaise < 100) {
      throw new AppError('Order amount must be at least 100 paise (₹1)', 400);
    }

    const activeAttempt = await PaymentAttempt.findOne({
      orderId: order._id,
      status: { $in: ['PENDING', 'AUTHORIZED', 'PROCESSING'] },
    }).sort({ createdAt: -1 });
    if (activeAttempt) {
      if (activeAttempt.status === 'PROCESSING') {
        throw new AppError('Payment is already being processed for this order', 409);
      }
      return res.status(200).json({
        success: true,
        data: {
          keyId: keyId || process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID || 'dummy_key',
          order_id: activeAttempt.razorpayOrderId,
          razorpayOrderId: activeAttempt.razorpayOrderId,
          amount: amountInPaise,
          currency: order.currency || 'INR',
          name: "Samrat Fashion",
          description: `Order ${order.orderNumber}`
        }
      });
    }

    const lockExpiresAt = new Date(Date.now() + 2 * 60 * 1000);
    const lock = await Order.findOneAndUpdate(
      {
        _id: order._id,
        userId: req.user.id,
        status: 'PENDING',
        $or: [
          { paymentAttemptLockExpiresAt: { $exists: false } },
          { paymentAttemptLockExpiresAt: { $lte: new Date() } },
        ],
      },
      { $set: { paymentAttemptLockExpiresAt: lockExpiresAt } },
      { returnDocument: 'after' }
    );
    if (!lock) {
      throw new AppError('Payment setup is already in progress for this order. Please retry shortly.', 409);
    }

    try {
      // Create Razorpay order
      const rpOrder = await razorpayProvider.createOrder(amountInPaise, order.orderNumber, {
        internalOrderId: order._id.toString()
      });

      // Upsert Payment Record (One per internal order)
      let payment = await Payment.findOne({ orderId: order._id });
      if (!payment) {
        payment = await Payment.create({
          orderId: order._id,
          userId: req.user.id,
          amount: order.total,
          currency: order.currency || 'INR',
          status: 'PENDING',
          provider: 'RAZORPAY'
        });
      }

      // Create Payment Attempt
      await PaymentAttempt.create({
        paymentId: payment._id,
        orderId: order._id,
        razorpayOrderId: rpOrder.id,
        amount: order.total,
        currency: order.currency || 'INR',
        status: 'PENDING'
      });

      res.status(200).json({
        success: true,
        data: {
          keyId: keyId || process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID || 'dummy_key',
          order_id: rpOrder.id,
          razorpayOrderId: rpOrder.id,
          amount: rpOrder.amount,
          currency: rpOrder.currency,
          name: "Samrat Fashion",
          description: `Order ${order.orderNumber}`
        }
      });
    } finally {
      await Order.updateOne(
        { _id: order._id, paymentAttemptLockExpiresAt: lockExpiresAt },
        { $unset: { paymentAttemptLockExpiresAt: 1 } }
      );
    }
  } catch (error: any) {
    console.error("[PAYMENT ERROR] createPaymentOrder failed:", error);
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

export const verifyPayment = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) throw new AppError('Unauthorized', 401);

    const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;
    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      throw new AppError('Missing payment verification details', 400);
    }

    // 1. Verify gateway signature (uses constant-time comparison and enforces mock isolation)
    const isValid = razorpayProvider.verifyPaymentSignature(
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    );

    if (!isValid) {
      throw new AppError('Invalid payment signature', 400);
    }

    // 2. Find attempt, strictly scoped to caller's own order
    const attempt = await PaymentAttempt.findOne({ razorpayOrderId: razorpay_order_id });
    if (!attempt) throw new AppError('Payment attempt not found', 404);

    const order = await Order.findOne({ _id: attempt.orderId, userId: req.user.id });
    if (!order) throw new AppError('Payment attempt not found', 404);

    // 3. Verify order and attempt state consistency
    if (attempt.amount !== order.total) {
      throw new AppError('Payment amount mismatch between attempt and order', 400);
    }
    // A FAILED attempt is not a dead end: a verified capture supersedes an earlier
    // failure on the same Razorpay order (retries share one attempt), so let the
    // processor claim it. Closed orders are handled (and flagged for refund) there.
    // Process payment success immediately (updates order paymentStatus to PAID, deducts stock, updates payment attempt to CAPTURED)
    const result = await processPaymentSuccess(razorpay_order_id, razorpay_payment_id);

    if (result && result.success === false) {
      if (result.reason === 'STOCK_UNAVAILABLE') {
        return res.status(200).json({
          success: true,
          message: 'Payment was captured but the order could not be confirmed due to a stock issue. Your payment will be refunded automatically.',
          data: { orderCancelled: true, reason: result.reason }
        });
      }
      if (result.reason === 'ORDER_CANCELLED') {
        return res.status(200).json({
          success: true,
          message: 'Your payment was captured, but this order had already been closed. Our team has been notified and will process a refund to your original payment method.',
          data: { orderCancelled: true, reason: result.reason }
        });
      }
      return res.status(200).json({
        success: true,
        message: 'Payment is being processed. Please check your order status shortly.',
        data: { processing: true, reason: result.reason }
      });
    }

    res.status(200).json({
      success: true,
      message: 'Payment verified and order confirmed successfully.'
    });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};

export const getPaymentStatus = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) throw new AppError('Unauthorized', 401);

    const { orderId } = req.params;
    const order = await Order.findOne({ _id: orderId, userId: req.user.id });
    if (!order) throw new AppError('Order not found', 404);

    const payment = await Payment.findOne({ orderId: order._id });

    res.status(200).json({
      success: true,
      data: {
        orderStatus: order.status,
        paymentStatus: order.paymentStatus,
        providerPaymentStatus: payment?.status || 'PENDING'
      }
    });
  } catch (error: any) {
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
};
