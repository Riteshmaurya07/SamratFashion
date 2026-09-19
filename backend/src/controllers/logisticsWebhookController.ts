import { Request, Response } from 'express';
import crypto from 'crypto';
import { Shipment } from '../models/Shipment';
import { Order } from '../models/Order';
import { LogisticsEventLog } from '../models/LogisticsEventLog';
import { catchAsync } from '../utils/catchAsync';
import { AppError } from '../utils/AppError';

/**
 * POST /api/webhooks/logistics
 * Carrier push webhook handler supporting Delhivery and standard carrier formats.
 */
export const handleLogisticsWebhook = catchAsync(async (req: Request, res: Response) => {
  const secret = process.env.DELHIVERY_WEBHOOK_SECRET || process.env.LOGISTICS_WEBHOOK_SECRET;
  if (!secret && (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging')) {
    throw new AppError('Logistics webhook secret is missing in server environment', 500);
  }
  const effectiveSecret = secret || 'dev_logistics_webhook_secret_key_12345';
  const signature = req.headers['x-logistics-signature'] || req.headers['x-shipment-signature'] || req.headers['x-delhivery-signature'];

  let rawBodyString: string;
  if (Buffer.isBuffer(req.body)) {
    rawBodyString = req.body.toString('utf8');
  } else if (typeof req.body === 'string') {
    rawBodyString = req.body;
  } else {
    rawBodyString = JSON.stringify(req.body || {});
  }

  // 1. Mandatory Signature Verification
  if (!signature) {
    throw new AppError('Missing logistics webhook signature header', 400);
  }

  const expectedSignature = crypto
    .createHmac('sha256', effectiveSecret)
    .update(rawBodyString)
    .digest('hex');

  if (signature !== expectedSignature && signature !== `sha256=${expectedSignature}`) {
    throw new AppError('Invalid logistics webhook signature', 400);
  }

  // Parse fields from standard or Delhivery payload
  let body: any = req.body || {};
  if (Buffer.isBuffer(req.body) || typeof req.body === 'string') {
    try {
      body = JSON.parse(rawBodyString);
    } catch (e) {
      body = {};
    }
  }

  const awb = (body.awbNumber || body.waybill || body.trackingNumber || body.Shipment?.Waybill || '').toString().trim();
  const rawStatus = (body.status || body.Shipment?.Status?.Status || body.ScanDetail?.ScanType || '').toString().trim();
  const location = (body.location || body.ScanDetail?.ScannedLocation || '').toString().trim();
  const description = (body.description || body.ScanDetail?.Instructions || body.StatusMessage || `Status: ${rawStatus}`).toString().trim();
  const timestamp = body.timestamp || body.ScanDetail?.ScanDateTime || Date.now();
  const providerEventId = (body.providerEventId || body.eventId || `${awb}_${rawStatus}_${timestamp}`).toString().trim();

  if (!awb || !rawStatus) {
    throw new AppError('Missing required awbNumber/waybill or status in webhook payload', 400);
  }

  // 2. Event Idempotency Check
  const existingLog = await LogisticsEventLog.findOne({ providerEventId });
  if (existingLog) {
    return res.status(200).json({ success: true, message: 'Event already processed (idempotent duplicate)' });
  }

  // 3. Find Target Shipment
  const shipment = await Shipment.findOne({ $or: [{ awbNumber: awb }, { trackingNumber: awb }] });
  if (!shipment) {
    return res.status(404).json({ success: false, message: 'Shipment not found for AWB' });
  }

  // 4. Map Carrier Status to Internal Status
  const statusUpper = rawStatus.toUpperCase().replace(/\s+/g, '_');
  let mappedStatus = 'LABEL_CREATED';

  if (['LABEL_CREATED', 'MANIFESTED'].includes(statusUpper)) {
    mappedStatus = 'LABEL_CREATED';
  } else if (['PICKUP_REQUESTED', 'PICKUP_SCHEDULED'].includes(statusUpper)) {
    mappedStatus = 'PICKUP_REQUESTED';
  } else if (['PICKED_UP', 'ACCEPTED', 'SHIPMENT_PICKED'].includes(statusUpper)) {
    mappedStatus = 'PICKED_UP';
  } else if (['IN_TRANSIT', 'DISPATCHED', 'IN-TRANSIT'].includes(statusUpper)) {
    mappedStatus = 'IN_TRANSIT';
  } else if (['OUT_FOR_DELIVERY'].includes(statusUpper)) {
    mappedStatus = 'OUT_FOR_DELIVERY';
  } else if (['DELIVERED'].includes(statusUpper)) {
    mappedStatus = 'DELIVERED';
  } else if (['NDR'].includes(statusUpper)) {
    mappedStatus = 'NDR';
  } else if (['RTO'].includes(statusUpper)) {
    mappedStatus = 'RTO';
  } else if (['CANCELLED'].includes(statusUpper)) {
    mappedStatus = 'CANCELLED';
  } else if (['SHIPPED'].includes(statusUpper)) {
    mappedStatus = 'SHIPPED';
  }

  // 5. Record Event Log for Idempotency
  await LogisticsEventLog.create({
    providerEventId,
    awbNumber: awb,
    eventType: mappedStatus,
    payload: req.body,
    processedAt: new Date()
  });

  // 6. Append Tracking History Event
  const eventTime = new Date(timestamp);
  shipment.trackingHistory.push({
    status: mappedStatus,
    location,
    description,
    timestamp: eventTime,
    providerEventId
  });

  shipment.status = mappedStatus as any;

  // 7. Synchronize Order Status State Machine
  // Rule 1 & 2: LABEL_CREATED / PICKUP_REQUESTED -> Order remains PROCESSING
  // Rule 3: PICKED_UP / SHIPPED / IN_TRANSIT / OUT_FOR_DELIVERY -> Order becomes SHIPPED
  // Rule 4: DELIVERED -> Order becomes DELIVERED
  if (mappedStatus === 'DELIVERED') {
    shipment.deliveredAt = shipment.deliveredAt || eventTime;
    const order = await Order.findById(shipment.orderId);
    if (order && order.status !== 'DELIVERED') {
      order.status = 'DELIVERED';
      await order.save();
    }
  } else if (['PICKED_UP', 'SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY'].includes(mappedStatus)) {
    shipment.shippedAt = shipment.shippedAt || eventTime;
    const order = await Order.findById(shipment.orderId);
    if (order && ['PROCESSING', 'CONFIRMED'].includes(order.status)) {
      order.status = 'SHIPPED';
      await order.save();
    }
  }

  await shipment.save();

  res.status(200).json({
    success: true,
    message: 'Logistics webhook processed successfully',
    data: { awbNumber: awb, status: shipment.status }
  });
});
