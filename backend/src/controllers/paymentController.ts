import { Request, Response } from 'express';
import { Order } from '../models/Order';
import { Payment } from '../models/Payment';
import { PaymentAttempt } from '../models/PaymentAttempt';
import { razorpayProvider } from '../services/payment/RazorpayProvider';
import { AppError } from '../utils/AppError';

interface AuthRequest extends Request {
  user?: any;
}

export const createPaymentOrder = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) throw new AppError('Unauthorized', 401);

    const { orderId } = req.body;
    if (!orderId) throw new AppError('orderId is required', 400);

    const order = await Order.findOne({ _id: orderId, userId: req.user.id });
    if (!order) throw new AppError('Order not found', 404);

    if (order.paymentStatus !== 'PENDING' && order.paymentStatus !== 'FAILED') {
      throw new AppError(`Cannot create payment for order with status ${order.paymentStatus}`, 400);
    }

    // Amount in paise
    const amountInPaise = Math.round(order.total * 100);

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
        keyId: process.env.RAZORPAY_KEY_ID || 'dummy_key',
        amount: rpOrder.amount,
        currency: rpOrder.currency,
        razorpayOrderId: rpOrder.id,
        name: "Samrat Fashion",
        description: `Order ${order.orderNumber}`
      }
    });
  } catch (error: any) {
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
    const isValid = razorpayProvider.verifyPaymentSignature(
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    );

    if (!isValid) {
      throw new AppError('Invalid payment signature', 400);
    }

    // Find attempt
    const attempt = await PaymentAttempt.findOne({ razorpayOrderId: razorpay_order_id });
    if (!attempt) throw new AppError('Payment attempt not found', 404);

    // Verify ownership
    const order = await Order.findOne({ _id: attempt.orderId, userId: req.user.id });
    if (!order) throw new AppError('Unauthorized access to payment attempt', 403);

    // Update attempt
    attempt.razorpayPaymentId = razorpay_payment_id;
    attempt.status = 'AUTHORIZED'; // We wait for webhook to mark CAPTURED and deduct inventory
    await attempt.save();

    // Update payment
    const payment = await Payment.findById(attempt.paymentId);
    if (payment && payment.status === 'PENDING') {
      payment.status = 'AUTHORIZED';
      await payment.save();
    }

    // We do NOT update the Internal Order status or inventory here. 
    // That is the absolute source of truth driven by Webhook.

    res.status(200).json({
      success: true,
      message: 'Payment verified successfully. Awaiting final capture confirmation.'
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
