import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { Order } from '../models/Order';
import { Shipment } from '../models/Shipment';
import { AuditLog } from '../models/AuditLog';
import { AppError } from '../utils/AppError';
import { catchAsync } from '../utils/catchAsync';
import { logisticsService } from '../services/logistics/logisticsService';
import { generateShippingLabelPDFStream } from '../utils/pdfLabelGenerator';

interface AuthRequest extends Request {
  user?: {
    id: string;
    role: string;
  };
}

/**
 * POST /api/admin/orders/:id/shipment
 * Create shipment with logistics provider & AWB generation
 */
export const createShipment = catchAsync(async (req: AuthRequest, res: Response) => {
  const orderId = req.params.id as string;
  const { weightGrams, lengthCm, widthCm, heightCm } = req.body;

  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    throw new AppError('Invalid order ID', 400);
  }

  const order = await Order.findById(orderId);
  if (!order) throw new AppError('Order not found', 404);

  // Validate allowed order status
  if (!['PROCESSING', 'CONFIRMED'].includes(order.status)) {
    throw new AppError('Shipment can only be created for CONFIRMED or PROCESSING orders', 400);
  }

  // Idempotency check: if shipment already exists, return existing shipment
  const existingShipment = await Shipment.findOne({ orderId: order._id });
  if (existingShipment) {
    return res.status(200).json({ success: true, data: existingShipment, message: 'Shipment already created' });
  }

  const provider = logisticsService.getProvider();

  // Call provider to create shipment
  const providerRes = await provider.createShipment({
    orderId: order._id.toString(),
    orderNumber: order.orderNumber,
    recipient: {
      fullName: order.shippingAddress.fullName,
      phone: order.shippingAddress.phone,
      addressLine1: order.shippingAddress.addressLine1,
      addressLine2: order.shippingAddress.addressLine2,
      city: order.shippingAddress.city,
      state: order.shippingAddress.state,
      postalCode: order.shippingAddress.postalCode,
      country: order.shippingAddress.country || 'India'
    },
    items: order.items.map(item => ({
      productName: item.productName,
      quantity: item.quantity,
      unitPrice: item.unitPrice
    })),
    packageDetails: {
      weightGrams: Number(weightGrams) || 500,
      lengthCm: Number(lengthCm) || 30,
      widthCm: Number(widthCm) || 25,
      heightCm: Number(heightCm) || 5
    },
    codAmount: order.paymentStatus === 'PENDING' ? order.total : 0
  });

  const now = new Date();
  const shipment = await Shipment.create({
    orderId: order._id,
    userId: order.userId,
    carrier: providerRes.carrier,
    trackingNumber: providerRes.awbNumber,
    awbNumber: providerRes.awbNumber,
    providerShipmentId: providerRes.providerShipmentId,
    provider: provider.name,
    trackingUrl: providerRes.trackingUrl,
    labelUrl: providerRes.labelUrl,
    status: 'LABEL_CREATED',
    trackingHistory: [
      {
        status: 'LABEL_CREATED',
        location: 'Fulfillment Warehouse',
        description: 'Shipment created and AWB assigned',
        timestamp: now,
        providerEventId: `init_${providerRes.awbNumber}`
      }
    ],
    packageDetails: {
      weightGrams: Number(weightGrams) || 500,
      lengthCm: Number(lengthCm) || 30,
      widthCm: Number(widthCm) || 25,
      heightCm: Number(heightCm) || 5
    },
    createdBy: req.user!.id,
    updatedBy: req.user!.id
  });

  await AuditLog.create({
    actorId: req.user!.id,
    actorRole: req.user!.role,
    action: 'ADMIN_SHIPMENT_CREATED',
    entityType: 'ORDER',
    entityId: order._id,
    metadata: { shipmentId: shipment._id, awbNumber: shipment.awbNumber, carrier: shipment.carrier }
  });

  res.status(201).json({ success: true, data: shipment });
});

/**
 * GET /api/admin/orders/:id/shipment/label or /api/shipping/shipments/:awb/label
 * Stream PDF shipping label
 */
export const getShippingLabel = catchAsync(async (req: Request, res: Response) => {
  const idOrAwb = String(req.params.id || req.params.awb || '');

  let shipment = null;
  if (mongoose.Types.ObjectId.isValid(idOrAwb)) {
    shipment = await Shipment.findOne({ orderId: idOrAwb });
    if (!shipment) {
      shipment = await Shipment.findById(idOrAwb);
    }
  }

  if (!shipment) {
    shipment = await Shipment.findOne({ awbNumber: idOrAwb });
  }

  if (!shipment) {
    throw new AppError('Shipment not found', 404);
  }

  const order = await Order.findById(shipment.orderId);
  if (!order) {
    throw new AppError('Associated order not found', 404);
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="Label-${shipment.awbNumber}.pdf"`);

  const pdfStream = generateShippingLabelPDFStream(shipment, order);
  pdfStream.pipe(res);
});

/**
 * POST /api/admin/orders/:id/shipment/pickup
 * Request courier pickup for shipment
 */
export const requestPickup = catchAsync(async (req: AuthRequest, res: Response) => {
  const orderId = req.params.id as string;

  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    throw new AppError('Invalid order ID', 400);
  }

  const shipment = await Shipment.findOne({ orderId });
  if (!shipment) {
    throw new AppError('Shipment not found for this order', 404);
  }

  const provider = logisticsService.getProvider(shipment.provider);
  const pickupRes = await provider.requestPickup(shipment.awbNumber);

  shipment.pickupId = pickupRes.pickupId;
  shipment.pickupRequestedAt = new Date();
  shipment.status = 'PICKUP_REQUESTED';
  shipment.trackingHistory.push({
    status: 'PICKUP_REQUESTED',
    location: 'Warehouse Dispatch',
    description: `Courier pickup requested (Pickup ID: ${pickupRes.pickupId})`,
    timestamp: new Date()
  });
  shipment.updatedBy = req.user!.id as any;
  await shipment.save();

  await AuditLog.create({
    actorId: req.user!.id,
    actorRole: req.user!.role,
    action: 'ADMIN_SHIPMENT_PICKUP_REQUESTED',
    entityType: 'ORDER',
    entityId: shipment.orderId,
    metadata: { shipmentId: shipment._id, pickupId: pickupRes.pickupId }
  });

  res.status(200).json({ success: true, data: shipment });
});

/**
 * POST /api/admin/orders/:id/shipment/tracking/refresh
 * Manually query provider for tracking updates
 */
export const refreshTracking = catchAsync(async (req: AuthRequest, res: Response) => {
  const orderId = req.params.id as string;

  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    throw new AppError('Invalid order ID', 400);
  }

  const shipment = await Shipment.findOne({ orderId });
  if (!shipment) {
    throw new AppError('Shipment not found for this order', 404);
  }

  const provider = logisticsService.getProvider(shipment.provider);
  const trackingData = await provider.getTracking(shipment.awbNumber);

  // Update tracking events and status
  if (trackingData.history && trackingData.history.length > 0) {
    for (const evt of trackingData.history) {
      const exists = shipment.trackingHistory.some(existing => 
        existing.providerEventId === evt.providerEventId || 
        (existing.status === evt.status && existing.description === evt.description)
      );
      if (!exists) {
        shipment.trackingHistory.push({
          status: evt.status,
          location: evt.location,
          description: evt.description,
          timestamp: new Date(evt.timestamp),
          providerEventId: evt.providerEventId
        });
      }
    }
  }

  if (trackingData.status && shipment.status !== trackingData.status) {
    shipment.status = trackingData.status as any;
    if (trackingData.status === 'DELIVERED') {
      shipment.deliveredAt = shipment.deliveredAt || new Date();
      const order = await Order.findById(shipment.orderId);
      if (order && order.status !== 'DELIVERED') {
        order.status = 'DELIVERED';
        await order.save();
      }
    }
  }

  shipment.updatedBy = req.user!.id as any;
  await shipment.save();

  res.status(200).json({ success: true, data: shipment });
});

/**
 * POST /api/admin/orders/:id/shipment/cancel
 * Cancel shipment with logistics carrier
 */
export const cancelShipment = catchAsync(async (req: AuthRequest, res: Response) => {
  const orderId = req.params.id as string;

  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    throw new AppError('Invalid order ID', 400);
  }

  const shipment = await Shipment.findOne({ orderId });
  if (!shipment) {
    throw new AppError('Shipment not found for this order', 404);
  }

  if (['DELIVERED', 'CANCELLED'].includes(shipment.status)) {
    throw new AppError(`Cannot cancel shipment in status ${shipment.status}`, 400);
  }

  const provider = logisticsService.getProvider(shipment.provider);
  await provider.cancelShipment(shipment.providerShipmentId || '', shipment.awbNumber);

  shipment.status = 'CANCELLED';
  shipment.trackingHistory.push({
    status: 'CANCELLED',
    description: 'Shipment cancelled by admin',
    timestamp: new Date()
  });
  shipment.updatedBy = req.user!.id as any;
  await shipment.save();

  await AuditLog.create({
    actorId: req.user!.id,
    actorRole: req.user!.role,
    action: 'ADMIN_SHIPMENT_CANCELLED',
    entityType: 'ORDER',
    entityId: shipment.orderId,
    metadata: { shipmentId: shipment._id, awbNumber: shipment.awbNumber }
  });

  res.status(200).json({ success: true, data: shipment });
});

/**
 * GET /api/admin/orders/:id/shipment
 */
export const getShipment = catchAsync(async (req: AuthRequest, res: Response) => {
  const orderId = req.params.id as string;

  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    throw new AppError('Invalid order ID', 400);
  }

  const shipment = await Shipment.findOne({ orderId });
  res.status(200).json({ success: true, data: shipment });
});

/**
 * PATCH /api/admin/orders/:id/shipment
 * Fallback manual update of carrier / status
 */
export const updateShipment = catchAsync(async (req: AuthRequest, res: Response) => {
  const orderId = req.params.id as string;
  const { status, carrier, trackingNumber, trackingUrl } = req.body;

  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    throw new AppError('Invalid order ID', 400);
  }

  const order = await Order.findById(orderId);
  if (!order) throw new AppError('Order not found', 404);

  const shipment = await Shipment.findOne({ orderId: order._id });
  if (!shipment) throw new AppError('Shipment not found for this order', 404);

  if (carrier) shipment.carrier = carrier.trim();
  if (trackingNumber) {
    shipment.trackingNumber = trackingNumber.trim();
    shipment.awbNumber = trackingNumber.trim();
  }
  if (trackingUrl !== undefined) shipment.trackingUrl = trackingUrl.trim();

  if (status) {
    shipment.status = status;
    shipment.trackingHistory.push({
      status,
      description: `Shipment status updated to ${status} by admin`,
      timestamp: new Date()
    });

    if (status === 'DELIVERED') {
      shipment.deliveredAt = shipment.deliveredAt || new Date();
      if (order.status !== 'DELIVERED') {
        order.status = 'DELIVERED';
        await order.save();
      }
    } else if (['SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY'].includes(status)) {
      if (order.status === 'PROCESSING') {
        order.status = 'SHIPPED';
        await order.save();
      }
    }
  }

  shipment.updatedBy = req.user!.id as any;
  await shipment.save();

  await AuditLog.create({
    actorId: req.user!.id,
    actorRole: req.user!.role,
    action: 'ADMIN_SHIPMENT_UPDATED',
    entityType: 'ORDER',
    entityId: order._id,
    metadata: { shipmentId: shipment._id, status: shipment.status }
  });

  res.status(200).json({ success: true, data: shipment });
});
