import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { Order } from '../models/Order';
import { ReturnRequest } from '../models/ReturnRequest';
import { AuditLog } from '../models/AuditLog';
import { AppError } from '../utils/AppError';
import { catchAsync } from '../utils/catchAsync';
import { createInternalRefund } from '../services/payment/refundService';

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

  // Calculate previously returned quantities
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

  // Validate items
  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new AppError('Return items must be provided', 400);
  }

  const processedItems = [];
  for (const item of items) {
    const { variantId, quantity, reason } = item;
    if (!variantId || !quantity || !reason) {
      throw new AppError('Each return item must include variantId, quantity, and reason', 400);
    }
    const orderItem = order.items.find(oi => oi.variantId.toString() === variantId.toString());
    if (!orderItem) {
      throw new AppError(`Variant ${variantId} was not part of this order`, 400);
    }

    const isCustomItem = !!orderItem.customDesignId || (orderItem.customizationSnapshot && !!orderItem.customizationSnapshot.previewImage);
    if (isCustomItem) {
      const validCustomReasons = ['DAMAGED', 'WRONG_PRODUCT'];
      if (!validCustomReasons.includes(reason)) {
        throw new AppError('Custom-printed items are non-returnable except for damaged or incorrect products.', 400);
      }
    }

    const previouslyReturned = returnedQuantities[variantId.toString()] || 0;
    const returnableQuantity = orderItem.quantity - previouslyReturned;

    if (quantity > returnableQuantity) {
      throw new AppError(`Cannot return ${quantity} of variant ${variantId}. Only ${returnableQuantity} remaining available.`, 400);
    }

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

  const reverseAwb = `RET-AWB-${Math.floor(100000000 + Math.random() * 900000000)}`;

  returnRequest.status = 'APPROVED';
  returnRequest.approvedAt = new Date();
  returnRequest.reviewedBy = req.user!.id as any;
  (returnRequest as any).returnAwbNumber = reverseAwb;
  (returnRequest as any).returnCarrier = 'Samrat Reverse Logistics';
  if (req.body.adminNote) returnRequest.adminNote = req.body.adminNote;
  
  await returnRequest.save();

  await AuditLog.create({
    actorId: req.user!.id,
    actorRole: req.user!.role,
    action: 'ADMIN_RETURN_APPROVED',
    entityType: 'RETURN',
    entityId: returnRequest._id,
    metadata: { returnAwbNumber: reverseAwb }
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
  
  if (!['INSPECTING'].includes(returnRequest.status)) {
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

  // Create internal refund via refundService
  // We use createInternalRefund which safely verifies against remaining balance
  // and initiates Razorpay request.
  const refund = await createInternalRefund({
    orderId: order._id.toString(),
    amount: calculatedRefund, // Refund only the item value
    reason: `Return Request ${returnRequest._id}`,
    actorId: req.user!.id,
    actorRole: req.user!.role
  });

  returnRequest.status = 'ACCEPTED';
  returnRequest.inspectedAt = new Date();
  returnRequest.refundId = refund._id as any;
  if (req.body.adminNote) returnRequest.adminNote = req.body.adminNote;
  
  await returnRequest.save();

  await AuditLog.create({
    actorId: req.user!.id,
    actorRole: req.user!.role,
    action: 'ADMIN_RETURN_ACCEPTED',
    entityType: 'RETURN',
    entityId: returnRequest._id,
    metadata: { refundId: refund._id, amount: calculatedRefund }
  });

  res.status(200).json({ success: true, data: returnRequest });
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
