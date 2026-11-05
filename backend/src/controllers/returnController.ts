import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { Order } from '../models/Order';
import { ReturnRequest, IReturnRequest } from '../models/ReturnRequest';
import { ReverseShipment } from '../models/ReverseShipment';
import { Shipment } from '../models/Shipment';
import { AuditLog } from '../models/AuditLog';
import { AppError } from '../utils/AppError';
import { catchAsync } from '../utils/catchAsync';
import { createInternalRefund } from '../services/payment/refundService';
import { InventoryAllocationService } from '../services/inventory/inventoryAllocationService';
import { nimbusPostLogisticsProvider } from '../services/logistics/NimbusPostLogisticsProvider';

interface AuthRequest extends Request {
  user?: {
    id: string;
    role: string;
  };
}

const getRETURN_WINDOW_DAYS = () => parseInt(process.env.RETURN_WINDOW_DAYS || '7');

export const createReturn = catchAsync(async (req: AuthRequest, res: Response) => {
  const orderId = req.params.id as string;
  const { items, customerNote } = req.body;

  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    throw new AppError('Invalid order ID', 400);
  }

  const order = await Order.findOne({ _id: orderId, userId: req.user!.id });
  if (!order) throw new AppError('Order not found', 404);

  if (order.status !== 'DELIVERED') {
    throw new AppError('Only DELIVERED orders can be returned', 400);
  }

  // Check return window
  const shipment = await mongoose.model('Shipment').findOne({ orderId: order._id });
  // Prefer the delivered-at snapshots over updatedAt, which churns on every status change.
  const deliveredAt = shipment?.deliveredAt || order.deliveredAt || order.updatedAt;
  const daysSinceDelivery = (Date.now() - deliveredAt.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceDelivery > getRETURN_WINDOW_DAYS()) {
    throw new AppError(`Return window of ${getRETURN_WINDOW_DAYS()} days has expired`, 400);
  }

  const returnLockToken = new mongoose.Types.ObjectId().toString();
  const returnLockExpiresAt = new Date(Date.now() + 5 * 60 * 1000);
  const lockedOrder = await Order.findOneAndUpdate(
    {
      _id: order._id,
      userId: req.user!.id,
      status: 'DELIVERED',
      $or: [
        { returnRequestLockExpiresAt: { $exists: false } },
        { returnRequestLockExpiresAt: { $lte: new Date() } },
      ],
    },
    {
      $set: {
        returnRequestLockToken: returnLockToken,
        returnRequestLockExpiresAt: returnLockExpiresAt,
      },
    },
    { returnDocument: 'after' }
  );
  if (!lockedOrder) {
    throw new AppError('A return request for this order is already being submitted. Please retry shortly.', 409);
  }

  try {
    const existingReturns = await ReturnRequest.find({
      orderId: order._id,
      status: { $nin: ['CANCELLED', 'REJECTED', 'REJECTED_AFTER_INSPECTION'] }
    });

    const returnedQuantities: Record<string, number> = {};
    for (const r of existingReturns) {
      for (const item of r.items) {
        const key = item.variantId.toString();
        returnedQuantities[key] = (returnedQuantities[key] || 0) + item.quantity;
      }
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new AppError('Return items must be provided', 400);
    }

    const processedItems = [];
    for (const item of items) {
      const { variantId, quantity, reason } = item;
      if (!variantId || !Number.isInteger(quantity) || quantity <= 0 || !reason) {
        throw new AppError('Each return item must include variantId, quantity, and reason', 400);
      }
      const orderItems = order.items.filter(oi => oi.variantId.toString() === variantId.toString());
      if (orderItems.length === 0) {
        throw new AppError(`Variant ${variantId} was not part of this order`, 400);
      }
      const orderItem = orderItems[0];
      const purchasedQuantity = orderItems.reduce((total, item) => total + item.quantity, 0);

      const isCustomItem = orderItems.some(item =>
        !!item.customDesignId || !!item.customizationSnapshot?.previewImage
      );
      if (isCustomItem) {
        const validCustomReasons = ['DAMAGED', 'WRONG_PRODUCT'];
        if (!validCustomReasons.includes(reason)) {
          throw new AppError('Custom-printed items are non-returnable except for damaged or incorrect products.', 400);
        }
      }

      const previouslyReturned = returnedQuantities[variantId.toString()] || 0;
      const returnableQuantity = purchasedQuantity - previouslyReturned;

      if (quantity > returnableQuantity) {
        throw new AppError(`Cannot return ${quantity} of variant ${variantId}. Only ${returnableQuantity} remaining available.`, 400);
      }

      returnedQuantities[variantId.toString()] = previouslyReturned + quantity;
      processedItems.push({
        productId: orderItem.productId,
        variantId,
        quantity,
        reason
      });
    }

    const returnRequest = await ReturnRequest.create({
      orderId: order._id,
      userId: order.userId,
      items: processedItems,
      customerNote,
      status: 'REQUESTED'
    });

    await AuditLog.create({
      actorId: req.user!.id,
      actorRole: req.user!.role,
      action: 'RETURN_REQUESTED',
      entityType: 'ORDER',
      entityId: order._id,
      metadata: { returnId: returnRequest._id, items: processedItems }
    });

    res.status(201).json({ success: true, data: returnRequest });
  } finally {
    await Order.updateOne(
      { _id: order._id, returnRequestLockToken: returnLockToken },
      { $unset: { returnRequestLockToken: 1, returnRequestLockExpiresAt: 1 } }
    );
  }
});

export const getCustomerReturns = catchAsync(async (req: AuthRequest, res: Response) => {
  const returns = await ReturnRequest.find({ userId: req.user!.id }).sort({ createdAt: -1 });
  res.status(200).json({ success: true, data: returns });
});

export const getOrderReturns = catchAsync(async (req: AuthRequest, res: Response) => {
  const returns = await ReturnRequest.find({ orderId: req.params.id, userId: req.user!.id }).sort({ createdAt: -1 });
  res.status(200).json({ success: true, data: returns });
});

export const getReturnById = catchAsync(async (req: AuthRequest, res: Response) => {
  const returnRequest = await ReturnRequest.findOne({ _id: req.params.returnId, userId: req.user!.id });
  if (!returnRequest) throw new AppError('Return request not found', 404);
  res.status(200).json({ success: true, data: returnRequest });
});

export const cancelReturn = catchAsync(async (req: AuthRequest, res: Response) => {
  const returnRequest = await ReturnRequest.findOne({ _id: req.params.returnId, userId: req.user!.id });
  if (!returnRequest) throw new AppError('Return request not found', 404);

  if (returnRequest.status !== 'REQUESTED') {
    throw new AppError('Only REQUESTED returns can be cancelled by the customer', 400);
  }

  returnRequest.status = 'CANCELLED';
  returnRequest.cancelledAt = new Date();
  await returnRequest.save();

  res.status(200).json({ success: true, data: returnRequest });
});

// ADMIN APIs

export const getAdminReturns = catchAsync(async (req: AuthRequest, res: Response) => {
  const returns = await ReturnRequest.find()
    .sort({ createdAt: -1 })
    .populate('userId', 'name email');
  res.status(200).json({ success: true, data: returns });
});

export const getAdminReturnById = catchAsync(async (req: AuthRequest, res: Response) => {
  const returnRequest = await ReturnRequest.findById(req.params.id).populate('userId', 'name email');
  if (!returnRequest) throw new AppError('Return request not found', 404);
  res.status(200).json({ success: true, data: returnRequest });
});

export const approveReturn = catchAsync(async (req: AuthRequest, res: Response) => {
  const returnRequest = await ReturnRequest.findById(req.params.id);
  if (!returnRequest) throw new AppError('Return not found', 404);
  
  if (returnRequest.status !== 'REQUESTED') {
    throw new AppError(`Cannot approve return in ${returnRequest.status} state`, 400);
  }

  returnRequest.status = 'APPROVED';
  returnRequest.approvedAt = new Date();
  returnRequest.reviewedBy = req.user!.id as any;
  if (req.body.adminNote) returnRequest.adminNote = req.body.adminNote;
  if (req.body.pickupAddress) returnRequest.pickupAddress = req.body.pickupAddress;
  if (req.body.packageDetails) returnRequest.packageDetails = req.body.packageDetails;
  
  await returnRequest.save();

  await AuditLog.create({
    actorId: req.user!.id,
    actorRole: req.user!.role,
    action: 'ADMIN_RETURN_APPROVED',
    entityType: 'RETURN',
    entityId: returnRequest._id,
    metadata: { status: 'APPROVED' }
  });

  res.status(200).json({ success: true, data: returnRequest });
});

export const rejectReturn = catchAsync(async (req: AuthRequest, res: Response) => {
  const returnRequest = await ReturnRequest.findById(req.params.id);
  if (!returnRequest) throw new AppError('Return not found', 404);
  
  if (returnRequest.status !== 'REQUESTED') {
    throw new AppError(`Cannot reject return in ${returnRequest.status} state`, 400);
  }

  returnRequest.status = 'REJECTED';
  returnRequest.rejectedAt = new Date();
  returnRequest.reviewedBy = req.user!.id as any;
  if (req.body.adminNote) returnRequest.adminNote = req.body.adminNote;
  
  await returnRequest.save();

  await AuditLog.create({
    actorId: req.user!.id,
    actorRole: req.user!.role,
    action: 'ADMIN_RETURN_REJECTED',
    entityType: 'RETURN',
    entityId: returnRequest._id
  });

  res.status(200).json({ success: true, data: returnRequest });
});

export const receiveReturn = catchAsync(async (req: AuthRequest, res: Response) => {
  const returnRequest = await ReturnRequest.findById(req.params.id);
  if (!returnRequest) throw new AppError('Return not found', 404);
  
  if (!['APPROVED'].includes(returnRequest.status)) {
    throw new AppError(`Cannot mark as received in ${returnRequest.status} state. Approve the return first.`, 400);
  }

  returnRequest.status = 'RECEIVED';
  returnRequest.receivedAt = new Date();
  
  await returnRequest.save();

  await AuditLog.create({
    actorId: req.user!.id,
    actorRole: req.user!.role,
    action: 'ADMIN_RETURN_RECEIVED',
    entityType: 'RETURN',
    entityId: returnRequest._id
  });

  res.status(200).json({ success: true, data: returnRequest });
});

export const inspectReturn = catchAsync(async (req: AuthRequest, res: Response) => {
  const returnRequest = await ReturnRequest.findById(req.params.id);
  if (!returnRequest) throw new AppError('Return not found', 404);
  
  if (!['RECEIVED'].includes(returnRequest.status)) {
    throw new AppError(`Cannot inspect return in ${returnRequest.status} state`, 400);
  }

  returnRequest.status = 'INSPECTING';
  
  await returnRequest.save();

  res.status(200).json({ success: true, data: returnRequest });
});

export const acceptReturn = catchAsync(async (req: AuthRequest, res: Response) => {
  const returnRequest = await ReturnRequest.findById(req.params.id);
  if (!returnRequest) throw new AppError('Return not found', 404);
  
  const isInspecting = returnRequest.status === 'INSPECTING';
  const isRetryableFailedRefund = returnRequest.status === 'ACCEPTED' && (returnRequest.refundStatus === 'FAILED' || !returnRequest.refundStatus);
  if (!isInspecting && !isRetryableFailedRefund) {
    if (returnRequest.status === 'ACCEPTED') {
      if (returnRequest.refundStatus === 'PROCESSED') {
        throw new AppError('Return request has already been accepted and refunded.', 400);
      }
      if (returnRequest.refundStatus === 'UNKNOWN') {
        throw new AppError('Previous refund attempt is in an UNKNOWN state and requires reconciliation before retrying.', 409);
      }
      if (returnRequest.refundStatus === 'PROCESSING' || returnRequest.refundStatus === 'PENDING') {
        throw new AppError('Refund is already in progress for this return.', 409);
      }
    }
    throw new AppError(`Cannot accept return in ${returnRequest.status} state`, 400);
  }

  const order = await Order.findById(returnRequest.orderId);
  if (!order) throw new AppError('Associated order not found', 404);

  // Proportional refund based on what the customer actually paid for these items.
  // Refund share = (returned line value / subtotal) * (order.total - shipping),
  // so a coupon discount is allocated fairly instead of refunding the full
  // pre-discount unit price.
  let returnedValue = 0;
  for (const item of returnRequest.items) {
    const orderItem = order.items.find(oi => oi.variantId.toString() === item.variantId.toString());
    if (orderItem) {
      returnedValue += (orderItem.lineTotal * item.quantity) / (orderItem.quantity || 1);
    }
  }

  const paidGoods = Math.max(0, order.total - (order.shipping || 0));
  const calculatedRefund =
    order.subtotal > 0 ? Math.round((returnedValue / order.subtotal) * paidGoods) : returnedValue;

  if (!Number.isFinite(calculatedRefund) || calculatedRefund <= 0) {
    throw new AppError('Calculated refund amount is zero or negative', 400);
  }

  let claimedReturn: IReturnRequest | null = null;
  if (isInspecting) {
    // Atomic claim: Transition status from INSPECTING to ACCEPTED
    claimedReturn = await ReturnRequest.findOneAndUpdate(
      { _id: returnRequest._id, status: 'INSPECTING' },
      {
        $set: {
          status: 'ACCEPTED',
          inspectedAt: new Date(),
          adminNote: req.body.adminNote || returnRequest.adminNote,
        }
      },
      { returnDocument: 'after' }
    );

    if (!claimedReturn) {
      throw new AppError('Return request is not in INSPECTING state or has already been processed', 400);
    }
  } else {
    claimedReturn = returnRequest;
  }

  // Step 1: Safely and idempotently restore inventory for the return
  const restoreResult = await InventoryAllocationService.restoreReturnInventory(claimedReturn, order._id);
  if (restoreResult.requiresReconciliation) {
    throw new AppError(
      claimedReturn.inventoryReconciliationReason || 'Historical inventory reconciliation required before accepting return.',
      409,
      'HISTORICAL_INVENTORY_RECONCILIATION_REQUIRED'
    );
  }

  // Step 2: Create internal refund intent and submit to gateway.
  // If the refund encounters an error, DO NOT rollback ReturnRequest status to INSPECTING;
  // the return remains ACCEPTED with refundStatus recording the error state.
  const refund = await createInternalRefund({
    orderId: order._id.toString(),
    returnId: claimedReturn._id.toString(),
    amount: calculatedRefund,
    reason: `Return Request ${claimedReturn._id}`,
    actorId: req.user!.id,
    actorRole: req.user!.role,
  });

  claimedReturn.refundId = refund._id as mongoose.Types.ObjectId;
  await claimedReturn.save();
  await AuditLog.create({
    actorId: req.user!.id,
    actorRole: req.user!.role,
    action: 'ADMIN_RETURN_ACCEPTED',
    entityType: 'RETURN',
    entityId: returnRequest._id,
    metadata: { refundId: refund._id, amount: calculatedRefund }
  });

  res.status(200).json({ success: true, data: claimedReturn });
});

export const rejectReturnAfterInspection = catchAsync(async (req: AuthRequest, res: Response) => {
  const returnRequest = await ReturnRequest.findById(req.params.id);
  if (!returnRequest) throw new AppError('Return not found', 404);
  
  if (!['INSPECTING'].includes(returnRequest.status)) {
    throw new AppError(`Cannot reject return in ${returnRequest.status} state`, 400);
  }

  returnRequest.status = 'REJECTED_AFTER_INSPECTION';
  returnRequest.rejectedAt = new Date();
  if (req.body.adminNote) returnRequest.adminNote = req.body.adminNote;
  
  await returnRequest.save();

  await AuditLog.create({
    actorId: req.user!.id,
    actorRole: req.user!.role,
    action: 'ADMIN_RETURN_REJECTED_AFTER_INSPECTION',
    entityType: 'RETURN',
    entityId: returnRequest._id
  });

  res.status(200).json({ success: true, data: returnRequest });
});

/**
 * POST /api/admin/returns/:id/reverse-quotes
 * Fetch live reverse courier quotes (customer location -> Raebareli warehouse) via NimbusPost V2
 */
export const getReverseCourierQuotes = catchAsync(async (req: AuthRequest, res: Response) => {
  const returnId = req.params.id as string;
  if (!mongoose.Types.ObjectId.isValid(returnId)) throw new AppError('Invalid return ID', 400);

  const returnRequest = await ReturnRequest.findById(returnId);
  if (!returnRequest) throw new AppError('Return request not found', 404);

  if (returnRequest.status !== 'APPROVED') {
    throw new AppError(`Reverse courier rates can only be queried for APPROVED returns (current status: ${returnRequest.status}).`, 400);
  }

  const order = await Order.findById(returnRequest.orderId);
  if (!order) throw new AppError('Associated order not found', 404);

  const { pickupAddress, packageDetails } = req.body;
  const customerPin = (pickupAddress?.postalCode || returnRequest.pickupAddress?.postalCode || order.shippingAddress?.postalCode || '').trim();
  if (!/^[1-9][0-9]{5}$/.test(customerPin)) {
    throw new AppError('Valid 6-digit customer pickup PIN code is required.', 400, 'INVALID_CUSTOMER_PIN');
  }

  const w = Number(packageDetails?.weightGrams || returnRequest.packageDetails?.weightGrams);
  const l = Number(packageDetails?.lengthCm || returnRequest.packageDetails?.lengthCm);
  const wi = Number(packageDetails?.widthCm || returnRequest.packageDetails?.widthCm);
  const h = Number(packageDetails?.heightCm || returnRequest.packageDetails?.heightCm);

  if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(l) || l <= 0 || !Number.isFinite(wi) || wi <= 0 || !Number.isFinite(h) || h <= 0) {
    throw new AppError('Return parcel weight and dimensions (length, width, height) are required and must be finite positive numbers.', 400, 'INVALID_PACKAGE_DETAILS');
  }

  let returnedValue = 0;
  for (const item of returnRequest.items) {
    const orderItem = order.items.find(oi => oi.variantId.toString() === item.variantId.toString());
    if (orderItem) {
      returnedValue += (orderItem.lineTotal * item.quantity) / (orderItem.quantity || 1);
    }
  }
  const orderValuePaise = Math.max(100, Math.round(returnedValue * 100));
  const warehousePostalCode = (process.env.ORIGIN_POSTAL_CODE || '229402').trim();

  const ratesResult = await nimbusPostLogisticsProvider.getReverseRates({
    customerPostalCode: customerPin,
    warehousePostalCode,
    weightGrams: Math.round(w),
    lengthCm: Math.round(l * 10) / 10,
    widthCm: Math.round(wi * 10) / 10,
    heightCm: Math.round(h * 10) / 10,
    orderValuePaise,
    returnRequestId: returnRequest._id.toString()
  });

  res.status(200).json({ success: true, data: ratesResult });
});

/**
 * POST /api/admin/returns/:id/book-reverse-pickup
 * Explicitly books a real NimbusPost reverse courier pickup from customer's address
 */
export const bookReversePickup = catchAsync(async (req: AuthRequest, res: Response) => {
  const returnId = req.params.id as string;
  if (!mongoose.Types.ObjectId.isValid(returnId)) throw new AppError('Invalid return ID', 400);

  const returnRequest = await ReturnRequest.findById(returnId);
  if (!returnRequest) throw new AppError('Return request not found', 404);

  if (returnRequest.status !== 'APPROVED') {
    throw new AppError(`Cannot book reverse pickup for return in ${returnRequest.status} state. Approve the return first.`, 400);
  }

  // Idempotency: Prevent duplicate reverse shipments for the same return request
  const existingReverse = await ReverseShipment.findOne({ returnRequestId: returnRequest._id });
  if (existingReverse) {
    return res.status(200).json({
      success: true,
      data: existingReverse,
      message: 'Reverse shipment already booked for this return request.'
    });
  }

  const order = await Order.findById(returnRequest.orderId);
  if (!order) throw new AppError('Associated order not found', 404);

  const { pickupAddress, packageDetails, courierId, returnReason, returnReasonNote, idempotencyKey } = req.body;

  const addr = pickupAddress || returnRequest.pickupAddress || {
    fullName: order.shippingAddress.fullName,
    phone: order.shippingAddress.phone,
    alternatePhone: order.shippingAddress.alternatePhone,
    addressLine1: order.shippingAddress.addressLine1,
    addressLine2: order.shippingAddress.addressLine2,
    city: order.shippingAddress.city,
    state: order.shippingAddress.state,
    postalCode: order.shippingAddress.postalCode,
    country: order.shippingAddress.country || 'India'
  };

  if (!addr.fullName || !addr.phone || !addr.addressLine1 || !addr.city || !addr.state || !addr.postalCode) {
    throw new AppError('Complete customer pickup address (name, phone, addressLine1, city, state, postalCode) is required.', 400, 'INVALID_PICKUP_ADDRESS');
  }

  const w = Number(packageDetails?.weightGrams);
  const l = Number(packageDetails?.lengthCm);
  const wi = Number(packageDetails?.widthCm);
  const h = Number(packageDetails?.heightCm);

  if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(l) || l <= 0 || !Number.isFinite(wi) || wi <= 0 || !Number.isFinite(h) || h <= 0) {
    throw new AppError('Return package weight and dimensions must be explicitly provided and greater than 0.', 400, 'INVALID_PACKAGE_DETAILS');
  }

  const pkg = {
    weightGrams: Math.round(w),
    lengthCm: Math.round(l * 10) / 10,
    widthCm: Math.round(wi * 10) / 10,
    heightCm: Math.round(h * 10) / 10
  };

  const forwardShipment = await Shipment.findOne({ orderId: order._id });
  const parentNimbusOrderId = forwardShipment?.provider === 'nimbuspost' ? forwardShipment.providerShipmentId : undefined;

  const reverseRes = await nimbusPostLogisticsProvider.createReverseShipment({
    returnRequestId: returnRequest._id.toString(),
    orderId: order._id.toString(),
    orderNumber: order.orderNumber,
    parentNimbusOrderId,
    courierId: courierId || undefined,
    returnReason: returnReason || returnRequest.items[0]?.reason || 'wrong_item',
    returnReasonNote: returnReasonNote || returnRequest.customerNote || 'Customer return',
    pickupAddress: addr,
    items: returnRequest.items.map(item => {
      const orderItem = order.items.find(oi => oi.variantId.toString() === item.variantId.toString());
      return {
        productName: orderItem?.productName || 'Returned Apparel',
        quantity: item.quantity,
        unitPrice: orderItem?.unitPrice || 0,
        sku: (orderItem as any)?.sku || 'SKU-RETURN'
      };
    }),
    packageDetails: pkg
  });

  const warehousePostalCode = (process.env.ORIGIN_POSTAL_CODE || '229402').trim();

  const reverseShipment = await ReverseShipment.create({
    returnRequestId: returnRequest._id,
    orderId: order._id,
    userId: order.userId,
    provider: 'nimbuspost',
    providerOrderId: reverseRes.providerOrderId,
    awbNumber: reverseRes.awbNumber,
    carrier: reverseRes.carrier,
    courierId: reverseRes.courierId,
    pickupAddress: addr,
    warehouseAddress: {
      address: 'Samrat family showroom , Pichhwara chauraha , Bindaganj Road, jagatpur',
      city: 'Rae Bareli',
      state: 'Uttar Pradesh',
      postalCode: warehousePostalCode,
      country: 'India'
    },
    packageDetails: pkg,
    mode: 'NIMBUSPOST',
    status: 'REVERSE_REQUESTED',
    trackingUrl: reverseRes.trackingUrl,
    labelUrl: reverseRes.labelUrl,
    bookedAt: new Date(),
    trackingHistory: [
      {
        status: 'REVERSE_REQUESTED',
        location: addr.city,
        description: `Reverse courier pickup booked via ${reverseRes.carrier} (AWB: ${reverseRes.awbNumber})`,
        timestamp: new Date(),
        providerEventId: `rev_init_${reverseRes.awbNumber}`
      }
    ],
    idempotencyKey: idempotencyKey || undefined,
    createdBy: req.user!.id as any,
    updatedBy: req.user!.id as any
  });

  returnRequest.reverseShipmentId = reverseShipment._id as any;
  returnRequest.returnShippingMethod = 'NIMBUSPOST_REVERSE';
  returnRequest.returnAwbNumber = reverseRes.awbNumber;
  returnRequest.returnCarrier = reverseRes.carrier;
  returnRequest.pickupAddress = addr;
  returnRequest.packageDetails = { ...pkg, isConfirmed: true, confirmedAt: new Date(), confirmedBy: req.user!.id as any };
  await returnRequest.save();

  await AuditLog.create({
    actorId: req.user!.id,
    actorRole: req.user!.role,
    action: 'ADMIN_REVERSE_PICKUP_BOOKED',
    entityType: 'RETURN',
    entityId: returnRequest._id,
    metadata: {
      reverseShipmentId: reverseShipment._id,
      awbNumber: reverseRes.awbNumber,
      carrier: reverseRes.carrier,
      providerOrderId: reverseRes.providerOrderId
    }
  });

  res.status(201).json({
    success: true,
    data: {
      returnRequest,
      reverseShipment
    },
    message: `Reverse pickup successfully booked via ${reverseRes.carrier}. AWB: ${reverseRes.awbNumber}`
  });
});

/**
 * POST /api/admin/returns/:id/manual-shipping
 * Record offline or customer-arranged return shipping tracking details
 */
export const manualReturnShipping = catchAsync(async (req: AuthRequest, res: Response) => {
  const returnId = req.params.id as string;
  if (!mongoose.Types.ObjectId.isValid(returnId)) throw new AppError('Invalid return ID', 400);

  const returnRequest = await ReturnRequest.findById(returnId);
  if (!returnRequest) throw new AppError('Return request not found', 404);

  if (returnRequest.status !== 'APPROVED') {
    throw new AppError(`Cannot configure manual shipping in ${returnRequest.status} state. Approve the return first.`, 400);
  }

  const { carrier, trackingNumber, adminNote } = req.body;
  if (!carrier || typeof carrier !== 'string' || !carrier.trim()) {
    throw new AppError('Carrier name is required for manual return shipping.', 400);
  }
  if (!trackingNumber || typeof trackingNumber !== 'string' || !trackingNumber.trim()) {
    throw new AppError('Tracking / AWB Number is required for manual return shipping.', 400);
  }

  const trimmedCarrier = carrier.trim();
  const trimmedAwb = trackingNumber.trim();

  const order = await Order.findById(returnRequest.orderId);
  if (!order) throw new AppError('Associated order not found', 404);

  const reverseShipment = await ReverseShipment.findOneAndUpdate(
    { returnRequestId: returnRequest._id },
    {
      $set: {
        returnRequestId: returnRequest._id,
        orderId: order._id,
        userId: order.userId,
        provider: 'manual',
        awbNumber: trimmedAwb,
        carrier: trimmedCarrier,
        mode: 'MANUAL',
        status: 'IN_TRANSIT',
        pickupAddress: returnRequest.pickupAddress || {
          fullName: order.shippingAddress.fullName,
          phone: order.shippingAddress.phone,
          addressLine1: order.shippingAddress.addressLine1,
          city: order.shippingAddress.city,
          state: order.shippingAddress.state,
          postalCode: order.shippingAddress.postalCode,
          country: 'India'
        },
        warehouseAddress: {
          address: 'Samrat family showroom , Pichhwara chauraha , Bindaganj Road, jagatpur',
          city: 'Rae Bareli',
          state: 'Uttar Pradesh',
          postalCode: '229402',
          country: 'India'
        },
        packageDetails: returnRequest.packageDetails || {
          weightGrams: 500,
          lengthCm: 30,
          widthCm: 25,
          heightCm: 5
        },
        bookedAt: new Date(),
        createdBy: req.user!.id as any,
        updatedBy: req.user!.id as any
      },
      $push: {
        trackingHistory: {
          status: 'IN_TRANSIT',
          location: 'Customer Dispatch',
          description: `Customer shipped parcel via ${trimmedCarrier} (AWB: ${trimmedAwb})`,
          timestamp: new Date()
        }
      }
    },
    { upsert: true, returnDocument: 'after' }
  );

  returnRequest.reverseShipmentId = reverseShipment._id as any;
  returnRequest.returnShippingMethod = 'CUSTOMER_SHIPS';
  returnRequest.returnAwbNumber = trimmedAwb;
  returnRequest.returnCarrier = trimmedCarrier;
  if (adminNote) returnRequest.adminNote = adminNote;
  await returnRequest.save();

  await AuditLog.create({
    actorId: req.user!.id,
    actorRole: req.user!.role,
    action: 'ADMIN_RETURN_MANUAL_SHIPPING_RECORDED',
    entityType: 'RETURN',
    entityId: returnRequest._id,
    metadata: { awbNumber: trimmedAwb, carrier: trimmedCarrier }
  });

  res.status(200).json({
    success: true,
    data: {
      returnRequest,
      reverseShipment
    },
    message: 'Manual customer shipping details saved.'
  });
});

/**
 * GET /api/admin/returns/:id/reverse-shipment
 * Fetch active reverse shipment details for a return request
 */
export const getReturnReverseShipment = catchAsync(async (req: AuthRequest, res: Response) => {
  const returnId = req.params.id as string;
  if (!mongoose.Types.ObjectId.isValid(returnId)) throw new AppError('Invalid return ID', 400);

  const reverseShipment = await ReverseShipment.findOne({ returnRequestId: returnId });
  res.status(200).json({ success: true, data: reverseShipment });
});
