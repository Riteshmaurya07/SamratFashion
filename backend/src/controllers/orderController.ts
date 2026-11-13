import { Request, Response } from 'express';
import crypto from 'crypto';

interface AuthRequest extends Request {
  user?: any;
}
import mongoose from 'mongoose';
import { Order, IOrder } from '../models/Order';
import { Cart } from '../models/Cart';
import { Address } from '../models/Address';
import { Product } from '../models/Product';
import { Shipment } from '../models/Shipment';
import { AuditLog } from '../models/AuditLog';
import { AppError } from '../utils/AppError';
import { isCustomDesignEnabled } from '../config/features';
import { catchAsync } from '../utils/catchAsync';
import { PricingService } from '../services/pricingService';
import { notificationService } from '../services/notifications/notificationService';
import { InventoryAllocationService } from '../services/inventory/inventoryAllocationService';
import { cancelOrderWithRefund, cancelOrderItemsWithRefund } from '../services/orderCancellationService';
import { calculateShipping, getStoreSettings } from '../services/storeSettingsService';
import { extractDesignIds, loadOwnedDesignsOrThrow } from '../utils/designOwnership';

function generateOrderNumber(): string {
  const date = new Date();
  const year = date.getFullYear();
  const randomStr = Math.floor(100000 + Math.random() * 900000).toString(); // 6 digit
  return `SF-${year}-${randomStr}`;
}
export const TRACKING_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days documented expiry policy

export function generateTrackingToken(): { rawToken: string; tokenHash: string; expiresAt: Date } {
  // Cryptographically secure token with at least 256 bits of entropy (32 bytes = 256 bits = 64 hex characters)
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + TRACKING_TOKEN_TTL_MS);
  return { rawToken, tokenHash, expiresAt };
}

export function hashTrackingToken(token: string): string {
  return crypto.createHash('sha256').update(token.trim()).digest('hex');
}

export function sanitizeTrackingUrl(rawUrl?: string | null): string | undefined {
  if (!rawUrl || typeof rawUrl !== 'string') return undefined;
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined;
    if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') return undefined;

    const trustedHosts = [
      'delhivery.com',
      'bluedart.com',
      'shiprocket.co',
      'dtdc.in',
      'indiapost.gov.in',
      'samratfashion.com',
    ];

    const hostname = parsed.hostname.toLowerCase();
    const isTrusted = trustedHosts.some(trusted => hostname === trusted || hostname.endsWith(`.${trusted}`))
      || hostname === 'localhost'
      || hostname.endsWith('.local');

    return isTrusted ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
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

  // 2. Load Cart
  const cart = await Cart.findOne({ userId: req.user.id });
  if (!cart || cart.items.length === 0) {
    throw new AppError('Cart is empty', 400);
  }

  if (!isCustomDesignEnabled() && cart.items.some((item: any) => item.isCustomized || (Array.isArray(item.customConfigurations) && item.customConfigurations.length > 0) || item.customDesignId)) {
    throw new AppError('Custom design features are disabled for this deployment', 503, 'CUSTOM_DESIGN_DISABLED');
  }

  // Security: order creation is a second, independent authorization boundary.
  // Every design referenced by the cart (V2 configurations and the legacy
  // customDesignId field) must belong to the authenticated customer before any
  // artwork, instructions or version metadata is read or mutated.
  const ownedDesigns = await loadOwnedDesignsOrThrow(
    cart.items.flatMap((item: any) => extractDesignIds(item)),
    req.user.id
  );

  // 1. Validate Address
  const address = await Address.findOne({ _id: addressId, userId: req.user.id });
  if (!address) {
    throw new AppError('Invalid shipping address', 400);
  }

  // 3. Validate Products, Variants, and Aggregated Stock Availability
  const cartAllocations = await InventoryAllocationService.resolveOrderAllocations(cart.items);
  await InventoryAllocationService.validateAvailability(cartAllocations);

  let calculatedSubtotal = 0;
  let allItemsFreeDelivery = true;
  const orderItems = [];
  const couponEligibleItems = [];
  for (const item of cart.items) {
    const product = await Product.findById(item.productId);
    if (!product || product.status !== 'ACTIVE') {
      throw new AppError(`Product unavailable: ${item.productId}`, 400);
    }

    if (!product.freeDelivery) {
      allItemsFreeDelivery = false;
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

    if (item.customConfigurations && item.customConfigurations.length > 0) {
      for (const config of item.customConfigurations) {
        // Capture the purchased version from the ownership-verified map only.
        if (config.designId) {
          const design = ownedDesigns.get(config.designId.toString());
          if (!design) {
            throw new AppError('Design not found or does not belong to you', 403, 'FORBIDDEN');
          }

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
        const design = ownedDesigns.get(config.designId.toString());
        if (!design) {
          // Defensive: the cart-level pre-check above should already have
          // rejected this request without revealing any design data.
          throw new AppError('Design not found or does not belong to you', 403, 'FORBIDDEN');
        }
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

  const storeSettings = await getStoreSettings();
  const shipping = calculateShipping(calculatedSubtotal, discount, storeSettings, {
    allItemsFreeDelivery,
  });
  const tax = 0; // Base prices inclusive
  const calculatedTotal = Math.max(0, calculatedSubtotal - discount + shipping);

  // Guard against zero-cost / negative invoicing: every checkout must have a payable amount.
  if (calculatedTotal < 1) {
    throw new AppError('Checkout total must be at least ₹1', 400);
  }

  // 5. Create Order
  const { rawToken, tokenHash, expiresAt: trackingExpiresAt } = generateTrackingToken();
  const orderData = {
    trackingTokenHash: tokenHash,
    trackingTokenCreatedAt: new Date(),
    trackingTokenExpiresAt: trackingExpiresAt,
    orderNumber: generateOrderNumber(),
    userId: req.user.id,
    items: orderItems,
    shippingAddress: {
      fullName: address.fullName,
      phone: address.phone,
      alternatePhone: address.alternatePhone,
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
    initialSubtotal: calculatedSubtotal,
    initialDiscount: discount,
    initialShipping: shipping,
    initialTotal: calculatedTotal,
    freeShippingThresholdSnapshot: storeSettings.freeShippingThreshold,
    shippingFeeSnapshot: storeSettings.standardShippingFee,
    qualifiedForFreeShipping: shipping === 0,
    freeShippingReason: shipping === 0 ? (allItemsFreeDelivery ? 'ALL_ITEMS_FREE' : 'THRESHOLD') : 'NONE',
    currency: 'INR',
    status: 'PENDING',
    paymentStatus: 'PENDING',
    idempotencyKey,
    ...orderCouponFields,
  };

  let newOrder: IOrder;

  // Order creation is a single-document write, which MongoDB already performs
  // atomically. Wrapping it in a multi-document transaction is unnecessary and
  // breaks on standalone deployments (e.g. "This MongoDB deployment does not
  // support retryable writes"), which surfaced as HTTP 500 at checkout.
  try {
    newOrder = await new Order(orderData).save();
  } catch (error: unknown) {
    const isDuplicateKey =
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 11000;
    const keyPattern =
      error !== null && typeof error === 'object' && 'keyPattern' in error
        ? (error as { keyPattern?: Record<string, unknown> }).keyPattern
        : undefined;

    // A concurrent submit can win the unique idempotency key race. Return the
    // already-created order instead of failing the checkout with a 500.
    if (isDuplicateKey && idempotencyKey && keyPattern?.idempotencyKey) {
      const existingOrder = await Order.findOne({ idempotencyKey, userId: req.user.id });
      if (existingOrder) {
        const existingPayload = existingOrder.toObject() as unknown as Record<string, unknown>;
        delete existingPayload.trackingTokenHash;
        return res.status(200).json({
          status: 'success',
          data: existingPayload,
          message: 'Order already created (idempotent return)',
        });
      }
    }

    throw error;
  }

  // 6. Link CustomDesign to Order
  // Every write is explicitly scoped to the authenticated owner. A foreign
  // design ID can therefore never have its status or order link mutated.
  if (newOrder) {
    for (const item of newOrder.items) {
      if (item.isCustomized && item.customConfigurations) {
        for (const config of item.customConfigurations) {
          if (!config.designId) continue;

          const linkResult = await mongoose.model('CustomDesign').updateOne(
            { _id: config.designId, userId: req.user.id },
            { $set: { orderId: newOrder._id, status: 'ORDERED' } }
          );

          if (linkResult.matchedCount !== 1) {
            throw new AppError('Design not found or does not belong to you', 403, 'FORBIDDEN');
          }
        }
      }
    }
  }

  const createdPayload = newOrder.toObject() as unknown as Record<string, unknown>;
  delete createdPayload.trackingTokenHash;

  res.status(201).json({
    status: 'success',
    data: {
      ...createdPayload,
      shareableTrackingToken: rawToken,
    }
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

  const orderPayload = order.toObject() as unknown as Record<string, unknown>;
  delete orderPayload.trackingTokenHash;

  res.status(200).json({
    status: 'success',
    data: {
      ...orderPayload,
      refunds,
      returns,
      shipment,
      hasActiveTrackingToken: Boolean(order.trackingTokenHash && !order.trackingTokenRevokedAt && (!order.trackingTokenExpiresAt || order.trackingTokenExpiresAt > new Date())),
      isTrackingTokenRevoked: Boolean(order.trackingTokenRevokedAt),
      trackingTokenExpiresAt: order.trackingTokenExpiresAt,
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

  // Ownership check stays at the controller boundary so a customer can never
  // cancel another customer's order.
  const ownedOrder = await Order.findOne({ _id: orderIdStr, userId: req.user.id } as any);
  if (!ownedOrder) {
    throw new AppError('Order not found', 404);
  }

  const reason = req.body.reason || 'CUSTOMER_CANCELLED';

  // The order is marked CANCELLED first and the refund is attempted afterwards.
  // A slow/failing gateway must never make the cancellation disappear from the
  // admin panel; failures are surfaced so the refund can be retried.
  const result = await cancelOrderWithRefund({
    orderId: ownedOrder._id.toString(),
    actorId: req.user.id,
    actorRole: req.user.role,
    reason,
    source: 'CUSTOMER',
    enforceCustomPrintLock: true,
  });

  let message = 'Order cancelled successfully';
  if (result.refund) {
    message =
      result.refund.status === 'PROCESSED'
        ? 'Order cancelled and refund processed successfully'
        : 'Order cancelled. Your refund is being processed automatically.';
  } else if (result.refundError) {
    message = 'Order cancelled. The automatic refund could not be started and will be retried by our team.';
  }

  res.status(200).json({
    status: 'success',
    data: result.order,
    refund: result.refund,
    refundError: result.refundError,
    inventoryError: result.inventoryError,
    message
  });
});

export const cancelOrderItems = catchAsync(async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    throw new AppError('Unauthorized', 401);
  }

  const orderIdStr = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!orderIdStr || !mongoose.Types.ObjectId.isValid(orderIdStr)) {
    throw new AppError('Invalid order ID', 400);
  }

  const ownedOrder = await Order.findOne({ _id: orderIdStr, userId: req.user.id } as any);
  if (!ownedOrder) {
    throw new AppError('Order not found', 404);
  }

  // Support items array, or single item via params / body
  const paramItemId = Array.isArray(req.params.itemId) ? req.params.itemId[0] : req.params.itemId;
  const items = Array.isArray(req.body.items) && req.body.items.length > 0
    ? req.body.items
    : paramItemId
    ? [{ itemId: paramItemId, quantity: req.body.quantity }]
    : req.body.itemId
    ? [{ itemId: req.body.itemId, quantity: req.body.quantity }]
    : [];

  if (items.length === 0) {
    throw new AppError('At least one item must be specified for cancellation', 400);
  }

  const reason = req.body.reason || 'CUSTOMER_PARTIAL_CANCELLED';

  const result = await cancelOrderItemsWithRefund({
    orderId: ownedOrder._id.toString(),
    items,
    operationId: req.body.operationId,
    actorId: req.user.id,
    actorRole: req.user.role,
    reason,
    source: 'CUSTOMER',
    enforceCustomPrintLock: true,
  });

  let message = result.fullyCancelled
    ? 'All items cancelled and order cancelled successfully'
    : 'Selected item(s) cancelled successfully';

  if (result.refund) {
    message =
      result.refund.status === 'PROCESSED'
        ? `${message}. Refund processed successfully.`
        : `${message}. Refund is being processed automatically.`;
  } else if (result.refundError) {
    message = `${message}. The automatic refund could not be started and will be retried by our team.`;
  }

  res.status(200).json({
    status: 'success',
    data: result.order,
    refund: result.refund,
    refundAmount: result.refundAmount,
    refundError: result.refundError,
    inventoryError: result.inventoryError,
    fullyCancelled: result.fullyCancelled,
    operationId: result.operationId,
    message
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

// Regenerate shareable tracking token for order owner
export const regenerateTrackingToken = catchAsync(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError('Unauthorized', 401);
  const orderIdStr = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  let order = null;
  if (mongoose.Types.ObjectId.isValid(orderIdStr)) {
    order = await Order.findOne({ _id: orderIdStr, userId: req.user.id });
  }
  if (!order) {
    order = await Order.findOne({ orderNumber: orderIdStr, userId: req.user.id });
  }
  if (!order) throw new AppError('Order not found', 404);

  const { rawToken, tokenHash, expiresAt } = generateTrackingToken();
  order.trackingTokenHash = tokenHash;
  order.trackingTokenCreatedAt = new Date();
  order.trackingTokenExpiresAt = expiresAt;
  order.trackingTokenRevokedAt = undefined;
  await order.save();

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  res.status(200).json({
    success: true,
    status: 'success',
    data: {
      trackingToken: rawToken,
      expiresAt,
      shareUrl: `${siteUrl}/track/${rawToken}`,
    },
  });
});

// Revoke shareable tracking token for order owner
export const revokeTrackingToken = catchAsync(async (req: AuthRequest, res: Response) => {
  if (!req.user) throw new AppError('Unauthorized', 401);
  const orderIdStr = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  let order = null;
  if (mongoose.Types.ObjectId.isValid(orderIdStr)) {
    order = await Order.findOne({ _id: orderIdStr, userId: req.user.id });
  }
  if (!order) {
    order = await Order.findOne({ orderNumber: orderIdStr, userId: req.user.id });
  }
  if (!order) throw new AppError('Order not found', 404);

  order.trackingTokenRevokedAt = new Date();
  await order.save();

  res.status(200).json({
    success: true,
    status: 'success',
    message: 'Tracking link has been revoked',
  });
});

// Public unauthenticated tracking endpoint protected by strict token validation and rate limiting
export const getPublicOrderTracking = catchAsync(async (req: Request, res: Response) => {
  const token = req.params.token;
  if (!token || typeof token !== 'string' || !/^[a-f0-9]{64}$/i.test(token.trim())) {
    throw new AppError('Tracking information not found or link has expired', 404, 'NOT_FOUND');
  }

  const tokenHash = hashTrackingToken(token.trim());
  const order = await Order.findOne({ trackingTokenHash: tokenHash }).lean();

  if (!order) {
    throw new AppError('Tracking information not found or link has expired', 404, 'NOT_FOUND');
  }

  // Set security and privacy headers (no-cache and search engine noindex)
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Referrer-Policy', 'no-referrer');

  if (order.trackingTokenRevokedAt) {
    return res.status(410).json({
      success: false,
      code: 'TRACKING_REVOKED',
      message: 'This tracking link has been revoked by the order owner.',
    });
  }

  if (order.trackingTokenExpiresAt && new Date(order.trackingTokenExpiresAt) < new Date()) {
    return res.status(410).json({
      success: false,
      code: 'TRACKING_EXPIRED',
      message: 'This tracking link has expired.',
    });
  }

  // Fetch associated shipment if available
  const shipment = await Shipment.findOne({ orderId: order._id }).lean();

  // Mask recipient name: e.g. "Arun Kumar" -> "Arun K."
  const nameParts = (order.shippingAddress.fullName || '').trim().split(/\s+/);
  let maskedName = 'Valued Customer';
  if (nameParts.length === 1 && nameParts[0]) {
    maskedName = nameParts[0].length > 2
      ? `${nameParts[0].charAt(0)}****${nameParts[0].charAt(nameParts[0].length - 1)}`
      : nameParts[0];
  } else if (nameParts.length > 1) {
    maskedName = `${nameParts[0]} ${nameParts[nameParts.length - 1].charAt(0)}.`;
  }

  // Sanitized delivery milestones
  const timeline = [
    { stage: 'CONFIRMED', label: 'Order Confirmed', completed: ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'].includes(order.status), timestamp: order.createdAt },
    { stage: 'PROCESSING', label: 'Order Processing', completed: ['PROCESSING', 'SHIPPED', 'DELIVERED'].includes(order.status) },
    { stage: 'PACKED', label: 'Packed at Warehouse', completed: Boolean(shipment) || ['SHIPPED', 'DELIVERED'].includes(order.status) },
    { stage: 'SHIPPED', label: 'Handed to Courier', completed: Boolean(shipment && ['IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'].includes(shipment.status)) || ['SHIPPED', 'DELIVERED'].includes(order.status) },
    { stage: 'DELIVERED', label: 'Delivered', completed: order.status === 'DELIVERED' || shipment?.status === 'DELIVERED', timestamp: order.deliveredAt },
  ];

  // Strict allowlist: Never leak full street address, phone, email, payment amounts, or transaction IDs
  res.status(200).json({
    success: true,
    data: {
      orderNumber: order.orderNumber,
      status: order.status,
      createdAt: order.createdAt,
      recipient: {
        maskedName,
        destinationCity: order.shippingAddress.city,
        destinationState: order.shippingAddress.state,
      },
      timeline,
      shipment: shipment ? {
        carrier: shipment.carrier,
        awbNumber: shipment.awbNumber || shipment.trackingNumber,
        trackingUrl: sanitizeTrackingUrl(shipment.trackingUrl),
        status: shipment.status,
        trackingHistory: Array.isArray(shipment.trackingHistory)
          ? shipment.trackingHistory.map(evt => ({
              status: evt.status,
              location: evt.location,
              description: evt.description,
              timestamp: evt.timestamp,
            }))
          : [],
      } : null,
      items: order.items.map(i => ({
        productName: i.productName,
        productImage: i.productImage,
        selectedSize: i.selectedSize,
        selectedColor: i.selectedColor,
        quantity: i.quantity,
      })),
    },
  });
});
