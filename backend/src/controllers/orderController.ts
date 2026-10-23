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
import { PricingService } from '../services/pricingService';
import { notificationService } from '../services/notifications/notificationService';

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
  const couponEligibleItems = [];

  for (const item of cart.items) {
    const product = await Product.findById(item.productId);
    if (!product || product.status !== 'ACTIVE') {
      throw new AppError(`Product unavailable: ${item.productId}`, 400);
    }

    const variant = product.variants.find((v: any) => v._id.toString() === item.variantId.toString());
    if (!variant) {
      throw new AppError(`Variant unavailable for product: ${product.name}`, 400);
    }

    // Validate positive integer quantity
    const parsedQty = Math.floor(Number(item.quantity || 1));
    if (!item.isCustomized && (!Number.isFinite(parsedQty) || parsedQty < 1)) {
      throw new AppError(`Invalid item quantity for ${product.name}`, 400);
    }

    // Phase 5 constraint: VALIDATE stock, DO NOT decrement here
    if (!item.isCustomized) {
      if (variant.stock < parsedQty) {
        throw new AppError(`Out of stock for ${product.name} (Size: ${variant.size}, Color: ${variant.color})`, 400);
      }
    } else if (item.customConfigurations && item.customConfigurations.length > 0) {
      for (const config of item.customConfigurations) {
        const configVariant = product.variants.find((v: any) => v._id.toString() === config.variantId.toString());
        if (!configVariant) {
          throw new AppError(`Variant unavailable for custom configuration in product: ${product.name}`, 400);
        }
        let totalQuantityForConfig = 0;
        for (const dist of config.sizeDistribution) {
          totalQuantityForConfig += dist.quantity;
        }
        if (configVariant.stock < totalQuantityForConfig) {
          throw new AppError(`Out of stock for ${product.name} (Color: ${config.color}) - Required: ${totalQuantityForConfig}, Available: ${configVariant.stock}`, 400);
        }
        
        // Fetch design to capture purchased version
        if (config.designId) {
          const design = await mongoose.model('CustomDesign').findById(config.designId);
          if (!design) throw new AppError('Custom design not found', 400);
          
          config.purchasedDesignVersion = design.currentVersion;
          config.approvedDesignVersion = design.approvedVersion || null;
        }
      }
    }

    // Re-calculate pricing dynamically
    const snapshot = await PricingService.calculateItemPricing({
      productId: product._id.toString(),
      variantId: item.variantId.toString(),
      quantity: item.quantity,
      isCustomized: item.isCustomized,
      customConfigurations: item.customConfigurations,
    });

    calculatedSubtotal += snapshot.total; // Use item's total including its own bulk discount

    const snapshotName = item.customizationSnapshot?.name
      ? `${product.name} (Custom: ${item.customizationSnapshot.name})`
      : product.name;

    const snapshotImage = item.customizationSnapshot?.previewImage || product.images[0] || '';

    // Resolve raw customer artwork into the order's canonical approval record.
    const designFiles = [];
    let customizationNotes: string | undefined;
    if (item.isCustomized && item.customConfigurations) {
      for (const config of item.customConfigurations) {
        if (!config.designId) continue;
        const design = await mongoose.model('CustomDesign').findById(config.designId);
        if (!design) continue;
        customizationNotes = design.instructions || customizationNotes;
        const artworkUrl = design.artwork?.url || design.previewImage?.front;
        if (artworkUrl) {
          designFiles.push({
            url: artworkUrl,
            fileType: 'image/png',
            filename: `${design.name || 'customer-design'}.png`,
            uploadedAt: design.createdAt || new Date(),
          });
        }
      }
    }

    orderItems.push({
      productId: product._id,
      variantId: variant._id,
      productName: snapshotName,
      productImage: snapshotImage,
      selectedSize: variant.size,
      selectedColor: variant.color,
      quantity: item.quantity,
      unitPrice: snapshot.subtotal / (item.quantity || 1),
      lineTotal: snapshot.total,

      // V2 Custom fields
      isCustomized: item.isCustomized,
      customConfigurations: item.customConfigurations,
      pricingSnapshot: snapshot,
      designFiles,
      customizationNotes,
      approvalStatus: item.isCustomized ? 'pending_design' : undefined,
      approvalHistory: item.isCustomized ? [{
        status: 'pending_design',
        note: customizationNotes || 'Order created',
        actor: 'customer',
        timestamp: new Date(),
      }] : undefined,

      // Legacy V1 Custom
      customDesignId: item.customDesignId,
      customizationSnapshot: item.customizationSnapshot,
    });

    // Enriched copy used ONLY for coupon eligibility: the order-item productId stays
    // a plain ObjectId for persistence, but the engine needs categoryId/themeIds.
    couponEligibleItems.push({
      ...orderItems[orderItems.length - 1],
      productId: {
        _id: product._id,
        categoryId: product.categoryId,
        themeIds: product.themeIds,
      },
    });
  }

  // 4. Calculate Totals (Authoritative server discount & coupon revalidation)
  let discount = 0;
  let couponDetails = null;
  let orderCouponFields: { couponCode?: string; couponId?: string } = {};

  if (cart.couponCode) {
    const cartCouponCode = cart.couponCode;
    const { validateAndCalculateCouponDiscount } = await import("../utils/couponEngine");
    try {
      const couponResult = await validateAndCalculateCouponDiscount(cartCouponCode, req.user.id, couponEligibleItems);
      discount = couponResult.discountAmount;
      couponDetails = couponResult.coupon;
    } catch (err: any) {
      throw new AppError(`Coupon error: ${err.message}`, 400);
    }

    if (couponDetails && discount > 0) {
      orderCouponFields = { couponCode: cartCouponCode.toUpperCase(), couponId: couponDetails.id };
    }
  }

  const eligibleSubtotalForShipping = calculatedSubtotal - discount;
  const isTestCheckout = eligibleSubtotalForShipping > 0 && eligibleSubtotalForShipping <= 5;
  const shipping = !isTestCheckout && calculatedSubtotal > 0 && eligibleSubtotalForShipping < 999 ? 100 : 0;
  const tax = 0; // Base prices inclusive
  const calculatedTotal = Math.max(0, calculatedSubtotal - discount + shipping);

  // Guard against zero-cost / negative invoicing: every checkout must have a payable amount.
  if (calculatedTotal < 1) {
    throw new AppError('Checkout total must be at least ₹1', 400);
  }

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
    idempotencyKey,
    ...orderCouponFields,
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

  // 6. Link CustomDesign to Order
  if (newOrder) {
    for (const item of newOrder.items) {
      if (item.isCustomized && item.customConfigurations) {
        for (const config of item.customConfigurations) {
          if (config.designId) {
            await mongoose.model('CustomDesign').findByIdAndUpdate(config.designId, { 
              orderId: newOrder._id,
              status: 'ORDERED' 
            });
          }
        }
      }
    }
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

  if (!orderIdStr || orderIdStr === 'undefined') {
    throw new AppError('Invalid order ID', 400);
  }

  let order = null;
  if (mongoose.Types.ObjectId.isValid(orderIdStr)) {
    order = await Order.findOne({ _id: orderIdStr, userId: req.user.id } as any);
  }
  if (!order) {
    order = await Order.findOne({ orderNumber: orderIdStr, userId: req.user.id } as any);
  }

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

  // Check shipment status if available (only block if picked up or shipped by carrier)
  const shipment = await mongoose.model('Shipment').findOne({ orderId: order._id });
  if (shipment && ['PICKED_UP', 'SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(shipment.status)) {
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

function readItemId(req: AuthRequest) {
  const value = req.params.itemId;
  return Array.isArray(value) ? value[0] : value;
}

function findOrderItem(order: IOrder, itemId: string) {
  return order.items.find((item) => item._id?.toString() === itemId);
}

export const approveOrderMockup = catchAsync(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError('Unauthorized', 401);

  const orderId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const itemId = readItemId(req);
  if (!orderId || !mongoose.Types.ObjectId.isValid(orderId) || !itemId || !mongoose.Types.ObjectId.isValid(itemId)) {
    throw new AppError('Invalid order or item ID', 400);
  }

  const rawNote = typeof req.body.note === 'string' ? req.body.note.trim().slice(0, 1000) : '';
  const note = rawNote || 'Mockup approved by customer';

  const order = await Order.findOneAndUpdate(
    {
      _id: orderId,
      userId: req.user.id,
      items: { $elemMatch: { _id: itemId, approvalStatus: 'mockup_sent', mockupImages: { $exists: true, $ne: [] } } },
    },
    {
      $set: { 'items.$.approvalStatus': 'approved' },
      $push: {
        'items.$.approvalHistory': {
          status: 'approved',
          note,
          actor: 'customer',
          timestamp: new Date(),
        },
      },
    },
    { returnDocument: 'after' }
  );

  if (!order) {
    const current = await Order.findOne({ _id: orderId, userId: req.user.id });
    if (!current) throw new AppError('Order not found', 404);
    const item = findOrderItem(current, itemId);
    if (!item) throw new AppError('Order item not found', 404);
    throw new AppError(`Mockup approval is not allowed from ${item.approvalStatus || 'pending_design'}`, 409);
  }

  await AuditLog.create({
    actorId: req.user.id,
    actorRole: req.user.role,
    action: 'CUSTOMER_MOCKUP_APPROVED',
    entityType: 'ORDER_ITEM',
    entityId: itemId,
    metadata: { orderId, note: req.body.note },
  });

  notificationService.notify({
    eventType: 'MOCKUP_APPROVED',
    entityType: 'ORDER',
    entityId: order._id,
    recipientEmail: req.user.email || 'support@samratfashion.com',
    data: { orderNumber: order.orderNumber },
  });

  res.status(200).json({
    status: 'success',
    data: order,
    message: 'Mockup approved successfully',
  });
});

export const requestOrderRevision = catchAsync(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError('Unauthorized', 401);

  const orderId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const itemId = readItemId(req);
  if (!orderId || !mongoose.Types.ObjectId.isValid(orderId) || !itemId || !mongoose.Types.ObjectId.isValid(itemId)) {
    throw new AppError('Invalid order or item ID', 400);
  }

  const note = typeof req.body.note === 'string' ? req.body.note.trim().slice(0, 1000) : '';
  if (!note) throw new AppError('Revision note is required (max 1000 characters)', 400);

  const order = await Order.findOneAndUpdate(
    {
      _id: orderId,
      userId: req.user.id,
      items: { $elemMatch: { _id: itemId, approvalStatus: 'mockup_sent', mockupImages: { $exists: true, $ne: [] } } },
    },
    {
      $set: { 'items.$.approvalStatus': 'revision_requested' },
      $push: {
        'items.$.approvalHistory': {
          status: 'revision_requested',
          note,
          actor: 'customer',
          timestamp: new Date(),
        },
      },
    },
    { returnDocument: 'after' }
  );

  if (!order) {
    const current = await Order.findOne({ _id: orderId, userId: req.user.id });
    if (!current) throw new AppError('Order not found', 404);
    const item = findOrderItem(current, itemId);
    if (!item) throw new AppError('Order item not found', 404);
    throw new AppError(`Revision request is not allowed from ${item.approvalStatus || 'pending_design'}`, 409);
  }

  await AuditLog.create({
    actorId: req.user.id,
    actorRole: req.user.role,
    action: 'CUSTOMER_REVISION_REQUESTED',
    entityType: 'ORDER_ITEM',
    entityId: itemId,
    metadata: { orderId, note },
  });

  notificationService.notify({
    eventType: 'MOCKUP_REVISION_REQUESTED',
    entityType: 'ORDER',
    entityId: order._id,
    recipientEmail: 'support@samratfashion.com',
    data: { orderNumber: order.orderNumber, note },
  });

  res.status(200).json({
    status: 'success',
    data: order,
    message: 'Revision requested successfully',
  });
});
