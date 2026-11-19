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
    if (!req.user.emailVerified) {
      throw new AppError('Please verify your email address before initiating payment.', 403, 'EMAIL_NOT_VERIFIED');
    }

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
        paymentStatus: { $ne: 'PAID' },
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

      // Re-verify order did not concurrently transition out of PENDING/unpaid during the external Razorpay call
      const freshOrder = await Order.findById(order._id);
      if (!freshOrder || freshOrder.status !== 'PENDING' || freshOrder.paymentStatus === 'PAID') {
        throw new AppError('Order is no longer eligible for a new payment attempt.', 409);
      }

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

    const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body ?? {};
    if (
      typeof razorpay_payment_id !== 'string' || !razorpay_payment_id.trim() ||
      typeof razorpay_order_id !== 'string' || !razorpay_order_id.trim() ||
      typeof razorpay_signature !== 'string' || !razorpay_signature.trim()
    ) {
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

    // 3. Verify attempt state consistency against trusted server-side records.
    // A valid capture for a closed order still needs to reach the processor so
    // it can be recorded for reconciliation.
    const toPaise = (amount: unknown): number | null => {
      if (typeof amount !== 'number' || !Number.isFinite(amount)) return null;
      const paise = Math.round(amount * 100);
      return Number.isSafeInteger(paise) && paise > 0 && Math.abs(amount * 100 - paise) < 1e-6 ? paise : null;
    };
    const expectedAmountPaise = toPaise(order.total);
    const attemptAmountPaise = toPaise(attempt.amount);
    if (expectedAmountPaise === null || attemptAmountPaise === null || attemptAmountPaise !== expectedAmountPaise) {
      throw new AppError('Payment amount mismatch between attempt and order', 400);
    }
    const expectedCurrency = typeof order.currency === 'string' && order.currency.trim()
      ? order.currency.trim().toUpperCase()
      : 'INR';
    const attemptCurrency = typeof attempt.currency === 'string' && attempt.currency.trim()
      ? attempt.currency.trim().toUpperCase()
      : 'INR';
    if (!/^[A-Z]{3}$/.test(expectedCurrency) || attemptCurrency !== expectedCurrency) {
      throw new AppError('Payment currency mismatch between attempt and order', 400);
    }

    const existingPayment = await Payment.findById(attempt.paymentId);
    if (existingPayment) {
      const paymentAmountPaise = toPaise(existingPayment.amount);
      const paymentCurrency = typeof existingPayment.currency === 'string' && existingPayment.currency.trim()
        ? existingPayment.currency.trim().toUpperCase()
        : 'INR';
      if (
        existingPayment.orderId.toString() !== order._id.toString() ||
        paymentAmountPaise !== expectedAmountPaise ||
        paymentCurrency !== expectedCurrency
      ) {
        throw new AppError('Payment record mismatch with order', 400);
      }
    }

    // 4. Authoritative gateway capture verification
    const isAlreadyCaptured =
      attempt.status === 'CAPTURED' &&
      attempt.razorpayPaymentId === razorpay_payment_id &&
      order.paymentStatus === 'PAID' &&
      order.status !== 'CANCELLED' &&
      order.status !== 'EXPIRED' &&
      existingPayment?.status === 'CAPTURED' &&
      existingPayment?.razorpayPaymentId === razorpay_payment_id;

    if (!isAlreadyCaptured) {
      const isMock =
        razorpay_payment_id.startsWith('pay_mock_') ||
        razorpay_payment_id.startsWith('order_mock_') ||
        razorpay_order_id.startsWith('order_mock_');

      if (isMock) {
        if (!isMockPaymentPermitted()) {
          throw new AppError('Mock payments are forbidden in production and staging environments.', 403, 'FORBIDDEN');
        }
      } else {
        let gatewayPayment: unknown;
        try {
          gatewayPayment = await razorpayProvider.fetchPayment(razorpay_payment_id);
        } catch (fetchErr: unknown) {
          console.error(`[PAYMENT VERIFY] Gateway communication failure for ${razorpay_payment_id}:`, fetchErr);
          await Payment.updateOne(
            { orderId: order._id, reconciliationRequired: { $ne: true } },
            {
              $set: {
                reconciliationRequired: true,
                reconciliationReason: `Gateway verification temporarily unavailable during payment verification: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`,
              },
            }
          );
          return res.status(202).json({
            success: true,
            message: 'Payment verification is pending gateway confirmation. Please check your order status shortly.',
            data: { reconciliationRequired: true, reason: 'GATEWAY_VERIFICATION_TIMEOUT' },
          });
        }

        if (!gatewayPayment || typeof gatewayPayment !== 'object' || Array.isArray(gatewayPayment)) {
          throw new AppError('Invalid gateway payment response', 400, 'INVALID_GATEWAY_RESPONSE');
        }
        const gp = gatewayPayment as Record<string, unknown>;

        if (typeof gp.id !== 'string' || !gp.id.trim() || gp.id !== razorpay_payment_id) {
          throw new AppError('Gateway payment ID mismatch', 400, 'PAYMENT_ID_MISMATCH');
        }

        if (gp.entity !== undefined && gp.entity !== 'payment') {
          throw new AppError('Invalid gateway payment entity', 400, 'INVALID_GATEWAY_ENTITY');
        }

        if (typeof gp.order_id !== 'string' || !gp.order_id.trim()) {
          throw new AppError('Gateway order ID is missing or malformed', 400, 'ORDER_ID_MISSING');
        }
        if (gp.order_id !== attempt.razorpayOrderId) {
          throw new AppError('Gateway order ID mismatch', 400, 'ORDER_ID_MISMATCH');
        }

        if (typeof gp.amount !== 'number' || !Number.isSafeInteger(gp.amount) || gp.amount <= 0) {
          throw new AppError('Gateway payment amount is missing or malformed', 400, 'AMOUNT_MISSING');
        }
        if (gp.amount !== expectedAmountPaise) {
          throw new AppError('Gateway payment amount mismatch', 400, 'AMOUNT_MISMATCH');
        }

        if (typeof gp.currency !== 'string' || !gp.currency.trim()) {
          throw new AppError('Gateway payment currency is missing or malformed', 400, 'CURRENCY_MISSING');
        }
        if (gp.currency.trim().toUpperCase() !== expectedCurrency) {
          throw new AppError('Gateway payment currency mismatch', 400, 'CURRENCY_MISMATCH');
        }

        if (typeof gp.status !== 'string' || !gp.status.trim()) {
          throw new AppError('Gateway payment status is missing or malformed', 400, 'STATUS_MISSING');
        }
        const gatewayStatus = gp.status.trim().toLowerCase();
        if (gatewayStatus === 'authorized') {
          throw new AppError('Payment is authorized but not captured', 400, 'PAYMENT_NOT_CAPTURED');
        }
        if (gatewayStatus === 'failed') {
          throw new AppError('Payment has failed at the gateway', 400, 'PAYMENT_FAILED');
        }
        if (gatewayStatus !== 'captured') {
          throw new AppError(`Gateway reports payment status "${gp.status}", not captured`, 400, 'PAYMENT_NOT_CAPTURED');
        }
        if (gp.captured !== undefined && gp.captured !== true) {
          throw new AppError('Gateway payment captured flag is inconsistent with captured status', 400, 'PAYMENT_NOT_CAPTURED');
        }
      }
    }

    // A FAILED attempt is not a dead end: a verified capture supersedes an earlier
    // failure on the same Razorpay order (retries share one attempt), so let the
    // processor claim it. Closed orders are handled (and flagged for refund) there.
    // Process payment success immediately (updates order paymentStatus to PAID, deducts stock, updates payment attempt to CAPTURED)
    const result = await processPaymentSuccess(razorpay_order_id, razorpay_payment_id);

    if (result && result.success === false) {
      if (result.reason === 'PAYMENT_RECONCILIATION_REQUIRED' || result.reconciliationRequired === true) {
        return res.status(200).json({
          success: true,
          message: 'We verified the payment, but its order, attempt, or payment record needs reconciliation. Please contact support.',
          data: { reconciliationRequired: true, reason: result.reason }
        });
      }
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
          message: 'Your payment was captured, but this order was already closed. It has been recorded for refund reconciliation. Please contact support if you need assistance.',
          data: { orderCancelled: true, reconciliationRequired: true, reason: result.reason }
        });
      }
      return res.status(202).json({
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
