import { Request, Response } from 'express';

interface AuthRequest extends Request {
  user?: any;
}
import mongoose from 'mongoose';
import { Order, IOrder } from '../models/Order';
import { Cart } from '../models/Cart';
import { Address } from '../models/Address';
import { Product } from '../models/Product';
import { AuditLog } from '../models/AuditLog';
import { createInternalRefund } from '../services/payment/refundService';
import { AppError } from '../utils/AppError';
import { catchAsync } from '../utils/catchAsync';

function generateOrderNumber(): string {
  const date = new Date();
  const year = date.getFullYear();
  const randomStr = Math.floor(100000 + Math.random() * 900000).toString(); // 6 digit
  return `SF-${year}-${randomStr}`;
}

export const createOrder = catchAsync(async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    throw new AppError('Unauthorized', 401);
  }

  const { addressId, idempotencyKey } = req.body;

  if (!addressId) {
    throw new AppError('Shipping address is required', 400);
  }

  // Idempotency check
  if (idempotencyKey) {
    const existingOrder = await Order.findOne({ idempotencyKey, userId: req.user.id });
    if (existingOrder) {
      return res.status(200).json({
        status: 'success',
        data: existingOrder,
        message: 'Order already created (idempotent return)'
      });
    }
  }

  // 1. Validate Address
  const address = await Address.findOne({ _id: addressId, userId: req.user.id });
  if (!address) {
    throw new AppError('Invalid shipping address', 400);
  }

  // 2. Load Cart
  const cart = await Cart.findOne({ userId: req.user.id });
  if (!cart || cart.items.length === 0) {
    throw new AppError('Cart is empty', 400);
  }

  // 3. Validate Products, Variants, and Stock
  let calculatedSubtotal = 0;
  const orderItems = [];

  for (const item of cart.items) {
    const product = await Product.findById(item.productId);
    if (!product || product.status !== 'ACTIVE') {
      throw new AppError(`Product unavailable: ${item.productId}`, 400);
    }

    const variant = product.variants.find((v: any) => v._id.toString() === item.variantId.toString());
    if (!variant) {
      throw new AppError(`Variant unavailable for product: ${product.name}`, 400);
    }

    // Phase 5 constraint: VALIDATE stock, DO NOT decrement here
    if (variant.stock < item.quantity) {
      throw new AppError(`Out of stock for ${product.name} (Size: ${variant.size}, Color: ${variant.color})`, 400);
    }

    const customFee = item.customizationSnapshot?.customFee || 0;
    const unitPrice = product.basePrice + (variant.additionalPrice || 0) + customFee;
    const lineTotal = unitPrice * item.quantity;
    calculatedSubtotal += lineTotal;

    const snapshotName = item.customizationSnapshot?.name
      ? `${product.name} (Custom: ${item.customizationSnapshot.name})`
      : product.name;

    const snapshotImage = item.customizationSnapshot?.previewImage || product.images[0] || '';

    orderItems.push({
      productId: product._id,
      variantId: variant._id,
      productName: snapshotName,
      productImage: snapshotImage,
      selectedSize: variant.size,
      selectedColor: variant.color,
      quantity: item.quantity,
      unitPrice,
      lineTotal,
      customDesignId: item.customDesignId,
      customizationSnapshot: item.customizationSnapshot,
    });
  }

  // 4. Calculate Totals (Authoritative server discount & coupon revalidation)
  let discount = 0;
  let couponDetails = null;

  if (cart.couponCode) {
    const { validateAndCalculateCouponDiscount } = await import("../utils/couponEngine");
    try {
      const couponResult = await validateAndCalculateCouponDiscount(cart.couponCode, req.user.id, orderItems);
      discount = couponResult.discountAmount;
      couponDetails = couponResult.coupon;
    } catch (err: any) {
      throw new AppError(`Coupon error: ${err.message}`, 400);
    }
  }

  const eligibleSubtotalForShipping = calculatedSubtotal - discount;
  const shipping = calculatedSubtotal > 0 && eligibleSubtotalForShipping < 999 ? 100 : 0; // Free shipping over 999
  const tax = 0; // Base prices inclusive
  const calculatedTotal = Math.max(0, calculatedSubtotal - discount + shipping);

  // 5. Create Order
  const orderData = {
    orderNumber: generateOrderNumber(),
    userId: req.user.id,
    items: orderItems,
    shippingAddress: {
      fullName: address.fullName,
      phone: address.phone,
      addressLine1: address.addressLine1,
      addressLine2: address.addressLine2,
      city: address.city,
      state: address.state,
      postalCode: address.postalCode,
      country: address.country,
      landmark: address.landmark,
      addressType: address.addressType,
    },
    subtotal: calculatedSubtotal,
    discount,
    shipping,
    tax,
    total: calculatedTotal,
    currency: 'INR',
    status: 'PENDING',
    paymentStatus: 'PENDING',
    idempotencyKey
  };

  let newOrder: IOrder;

  // We will attempt to use a transaction. If it fails due to replica set requirement, we fall back.
  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    newOrder = new Order(orderData);
    await newOrder.save({ session });
    await session.commitTransaction();
  } catch (error: any) {
    await session.abortTransaction();
    // If the error is about transactions not being supported (Standalone MongoDB), do it non-atomically
    if (error.message.includes('transaction') || error.message.includes('replica set')) {
      newOrder = new Order(orderData);
      await newOrder.save();
    } else {
      throw error;
    }
  } finally {
    session.endSession();
  }

  res.status(201).json({
    status: 'success',
    data: newOrder
  });
});

export const getOrders = catchAsync(async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    throw new AppError('Unauthorized', 401);
  }

  const orders = await Order.find({ userId: req.user.id }).sort({ createdAt: -1 });

  res.status(200).json({
    status: 'success',
    data: orders
  });
});

export const getOrder = catchAsync(async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    throw new AppError('Unauthorized', 401);
  }

  const orderIdStr = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  if (!orderIdStr || orderIdStr === 'undefined' || !mongoose.Types.ObjectId.isValid(orderIdStr)) {
    throw new AppError('Invalid order ID', 400);
  }

  const order = await Order.findOne({ _id: orderIdStr, userId: req.user.id } as any);
  
  if (!order) {
    throw new AppError('Order not found', 404);
  }

  // Fetch associated refunds safely for the customer
  const refunds = await mongoose.model('Refund').find({ orderId: order._id, userId: req.user.id }).select('-initiatedByRole -initiatedBy');

  // Fetch returns safely for the customer
  const returns = await mongoose.model('ReturnRequest').find({ orderId: order._id, userId: req.user.id });

  // Fetch shipment if available
  const shipment = await mongoose.model('Shipment').findOne({ orderId: order._id });

  res.status(200).json({
    status: 'success',
    data: {
      ...order.toObject(),
      refunds,
      returns,
      shipment
    }
  });
});

export const cancelOrder = catchAsync(async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    throw new AppError('Unauthorized', 401);
  }

  const orderIdStr = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!orderIdStr || !mongoose.Types.ObjectId.isValid(orderIdStr)) {
    throw new AppError('Invalid order ID', 400);
  }

  const order = await Order.findOne({ _id: orderIdStr, userId: req.user.id } as any);
  if (!order) {
    throw new AppError('Order not found', 404);
  }

  // Allow cancellation ONLY if order is not SHIPPED, DELIVERED, or CANCELLED
  if (['SHIPPED', 'DELIVERED', 'CANCELLED'].includes(order.status)) {
    throw new AppError(`Order in ${order.status} status cannot be cancelled`, 400);
  }

  // Check shipment status if available
  const shipment = await mongoose.model('Shipment').findOne({ orderId: order._id });
  if (shipment && ['SHIPPED', 'DELIVERED'].includes(shipment.status)) {
    throw new AppError('Order has already been shipped and cannot be cancelled', 400);
  }

  // Check Custom Print Confirmation state
  const printJobs = await mongoose.model('PrintJob').find({ orderId: order._id });
  const confirmedStates = ['READY_FOR_PRINT', 'PRINTING', 'QUALITY_CHECK', 'PRINTED', 'COMPLETED'];
  const isCustomConfirmed = printJobs.some((pj: any) => confirmedStates.includes(pj.status));

  if (isCustomConfirmed) {
    throw new AppError('Custom-printed orders cannot be cancelled once customization has been confirmed by Samrat Fashion.', 400);
  }

  const reason = req.body.reason || 'CUSTOMER_CANCELLED';

  order.status = 'CANCELLED';
  await order.save();

  // If order was paid, initiate internal refund process
  if (order.paymentStatus === 'PAID') {
    try {
      await createInternalRefund({
        orderId: order._id.toString(),
        amount: order.total,
        reason: `Customer Order Cancellation: ${reason}`,
        actorId: req.user.id,
        actorRole: req.user.role
      });
    } catch (refundErr) {
      console.error('Failed to auto-create refund on order cancellation:', refundErr);
    }
  }

  await AuditLog.create({
    actorId: req.user.id,
    actorRole: req.user.role,
    action: 'ORDER_CANCELLED',
    entityType: 'ORDER',
    entityId: order._id,
    metadata: { reason }
  });

  res.status(200).json({
    status: 'success',
    data: order,
    message: 'Order cancelled successfully'
  });
});
