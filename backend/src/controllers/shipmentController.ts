import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { Order } from '../models/Order';
import { Shipment } from '../models/Shipment';
import { AuditLog } from '../models/AuditLog';
import { AppError } from '../utils/AppError';
import { catchAsync } from '../utils/catchAsync';

interface AuthRequest extends Request {
  user?: {
    id: string;
    role: string;
  };
}

export const createShipment = catchAsync(async (req: AuthRequest, res: Response) => {
  const orderId = req.params.id as string;
  const { carrier, trackingNumber, trackingUrl } = req.body;

  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    throw new AppError('Invalid order ID', 400);
  }

  const order = await Order.findById(orderId);
  if (!order) throw new AppError('Order not found', 404);

  // Validate allowed state
  if (order.status !== 'PROCESSING') {
    throw new AppError('Shipment can only be created for PROCESSING orders', 400);
  }

  const existingShipment = await Shipment.findOne({ orderId: order._id });
  if (existingShipment) {
    throw new AppError('Shipment already exists for this order', 400);
  }

  const shipment = await Shipment.create({
    orderId: order._id,
    userId: order.userId,
    carrier: carrier?.trim(),
    trackingNumber: trackingNumber?.trim(),
    trackingUrl: trackingUrl?.trim(),
    status: 'SHIPPED',
    shippedAt: new Date(),
    createdBy: req.user!.id,
    updatedBy: req.user!.id
  });

  // Update Order Status
  order.status = 'SHIPPED';
  await order.save();

  await AuditLog.create({
    actorId: req.user!.id,
    actorRole: req.user!.role,
    action: 'ADMIN_SHIPMENT_CREATED',
    entityType: 'ORDER',
    entityId: order._id,
    metadata: { shipmentId: shipment._id, trackingNumber: shipment.trackingNumber }
  });

  res.status(201).json({ success: true, data: shipment });
});

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
  if (trackingNumber) shipment.trackingNumber = trackingNumber.trim();
  if (trackingUrl !== undefined) shipment.trackingUrl = trackingUrl.trim();

  if (status) {
    // Only allow specific transitions
    if (shipment.status === 'SHIPPED' && status === 'DELIVERED') {
      if (order.status !== 'SHIPPED') {
        throw new AppError('Order must be SHIPPED before marking DELIVERED', 400);
      }
      shipment.status = 'DELIVERED';
      shipment.deliveredAt = new Date();
      order.status = 'DELIVERED';
      await order.save();

      await AuditLog.create({
        actorId: req.user!.id,
        actorRole: req.user!.role,
        action: 'ADMIN_ORDER_DELIVERED',
        entityType: 'ORDER',
        entityId: order._id,
        metadata: { shipmentId: shipment._id }
      });
    } else if (shipment.status !== status) {
       throw new AppError(`Invalid shipment status transition from ${shipment.status} to ${status}`, 400);
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

export const getShipment = catchAsync(async (req: AuthRequest, res: Response) => {
  const orderId = req.params.id as string;

  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    throw new AppError('Invalid order ID', 400);
  }

  const shipment = await Shipment.findOne({ orderId });
  
  res.status(200).json({ success: true, data: shipment });
});
