import { Request, Response } from 'express';

interface AuthRequest extends Request {
  user?: any;
}
import mongoose from 'mongoose';
import { Order, IOrder } from '../models/Order';
import { Cart } from '../models/Cart';
import { Address } from '../models/Address';
import { Product } from '../models/Product';
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

    const unitPrice = product.basePrice + (variant.additionalPrice || 0);
    const lineTotal = unitPrice * item.quantity;
    calculatedSubtotal += lineTotal;

    orderItems.push({
      productId: product._id,
      variantId: variant._id,
      productName: product.name,
      productImage: product.images[0] || '', // grab first image as snapshot
      selectedSize: variant.size,
      selectedColor: variant.color,
      quantity: item.quantity,
      unitPrice,
      lineTotal
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

    // Clear the cart
    cart.items = [];
    await cart.save({ session });

    await session.commitTransaction();
  } catch (error: any) {
    await session.abortTransaction();
    // If the error is about transactions not being supported (Standalone MongoDB), do it non-atomically
    if (error.message.includes('transaction') || error.message.includes('replica set')) {
      newOrder = new Order(orderData);
      await newOrder.save(); // save order first
      
      // then clear cart (if this fails, it's a soft failure because order is created)
      cart.items = [];
      await cart.save();
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

  const order = await Order.findOne({ _id: req.params.id, userId: req.user.id });
  
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

  const order = await Order.findOne({ _id: req.params.id, userId: req.user.id });
  
  if (!order) {
    throw new AppError('Order not found', 404);
  }

  // Allow cancellation only if PENDING or CONFIRMED (before processing/shipping)
  if (!['PENDING', 'CONFIRMED'].includes(order.status)) {
    throw new AppError('Order cannot be cancelled at this stage', 400);
  }

  order.status = 'CANCELLED';
  await order.save();

  res.status(200).json({
    status: 'success',
    data: order,
    message: 'Order cancelled successfully'
  });
});
