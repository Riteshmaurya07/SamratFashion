import { Request, Response } from 'express';
import { Order } from '../models/Order';
import { Payment } from '../models/Payment';
import { PaymentAttempt } from '../models/PaymentAttempt';
import { razorpayProvider } from '../services/payment/RazorpayProvider';
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
    const isStrictEnv = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging';

    if (!keyId || keyId === 'dummy_key') {
      if (isStrictEnv) {
        throw new AppError('Payment gateway configuration error: RAZORPAY_KEY_ID is missing on backend server.', 500, 'PAYMENT_CONFIG_ERROR');
      } else if (process.env.ALLOW_PAYMENT_MOCK !== 'true') {
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

    // Amount in paise
    const amountInPaise = Math.round(order.total * 100);
    if (amountInPaise < 100) {
      throw new AppError('Order amount must be at least 100 paise (₹1)', 400);
    }

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

    // Verify Signature
    const isMockAllowed = process.env.NODE_ENV === 'development' && process.env.ALLOW_PAYMENT_MOCK === 'true';
    const isMockSignature = isMockAllowed && razorpay_signature.startsWith('sig_mock_');
    const isValid = isMockSignature || razorpayProvider.verifyPaymentSignature(
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    );

    if (!isValid) {
      throw new AppError('Invalid payment signature', 400);
    }

    // Find attempt, scoped to the caller's own order (prevents verifying/releasing
    // another user's payment attempt by a guessed razorpay order id).
    const attempt = await PaymentAttempt.findOne({ razorpayOrderId: razorpay_order_id });
    if (!attempt) throw new AppError('Payment attempt not found', 404);

    const order = await Order.findOne({ _id: attempt.orderId, userId: req.user.id });
    if (!order) throw new AppError('Payment attempt not found', 404);

    // Process payment success immediately (updates order paymentStatus to PAID, deducts stock, updates payment attempt to CAPTURED)
    const result = await processPaymentSuccess(razorpay_order_id, razorpay_payment_id);

    if (result && result.success === false) {
      if (result.reason === 'STOCK_UNAVAILABLE' || result.reason === 'ORDER_CANCELLED') {
        return res.status(200).json({
          success: true,
          message: 'Payment was captured but the order could not be confirmed due to a stock issue. Your payment will be refunded automatically.',
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
