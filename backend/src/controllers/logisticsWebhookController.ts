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
  const rawSigHeader = typeof signature === 'string' ? signature : Array.isArray(signature) ? signature[0] : '';
  if (!rawSigHeader) {
    throw new AppError('Missing logistics webhook signature header', 400);
  }

  const rawSig = (rawSigHeader.startsWith('sha256=') ? rawSigHeader.slice(7) : rawSigHeader).toLowerCase().trim();
  const expectedSignature = crypto
    .createHmac('sha256', effectiveSecret)
    .update(rawBodyString)
    .digest('hex');

  const sigBuf = Buffer.from(rawSig, 'utf8');
  const expBuf = Buffer.from(expectedSignature, 'utf8');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
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

  // 4. Map Carrier Status to Internal Status using explicit mapping (never invent transitions for unknown scans)
  const statusUpper = rawStatus.toUpperCase().replace(/\s+/g, '_');
  const CARRIER_STATUS_MAP: Record<string, string> = {
    LABEL_CREATED: 'LABEL_CREATED',
    MANIFESTED: 'LABEL_CREATED',
    PICKUP_REQUESTED: 'PICKUP_REQUESTED',
    PICKUP_SCHEDULED: 'PICKUP_REQUESTED',
    PICKED_UP: 'PICKED_UP',
    ACCEPTED: 'PICKED_UP',
    SHIPMENT_PICKED: 'PICKED_UP',
    SHIPPED: 'SHIPPED',
    DISPATCHED: 'SHIPPED',
    IN_TRANSIT: 'IN_TRANSIT',
    'IN-TRANSIT': 'IN_TRANSIT',
    OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
    DELIVERED: 'DELIVERED',
    NDR: 'NDR',
    RTO: 'RTO',
    CANCELLED: 'CANCELLED',
  };

  const SHIPMENT_STATUS_RANK: Record<string, number> = {
    LABEL_CREATED: 1,
    PICKUP_REQUESTED: 2,
    PICKED_UP: 3,
    SHIPPED: 4,
    IN_TRANSIT: 5,
    OUT_FOR_DELIVERY: 6,
    DELIVERED: 7,
  };

  const TERMINAL_SHIPMENT_STATUSES: Record<string, true> = {
    DELIVERED: true,
    CANCELLED: true,
    RTO: true,
  };

  const mappedStatus = CARRIER_STATUS_MAP[statusUpper] || null;
  // 5. Record Event Log for Idempotency
  await LogisticsEventLog.create({
    providerEventId,
    awbNumber: awb,
    eventType: mappedStatus || shipment.status,
    payload: req.body,
    processedAt: new Date()
  });

  // 6. Append Tracking History Event
  const eventTime = new Date(timestamp);
  shipment.trackingHistory.push({
    status: mappedStatus || shipment.status,
    location,
    description: description || `Status: ${rawStatus}`,
    timestamp: eventTime,
    providerEventId
  });

  // State machine transition evaluation: Prevent regression from out-of-order/delayed webhooks
  let shouldUpdateStatus = false;

  if (mappedStatus) {
    if (shipment.status === 'DELIVERED') {
      // Delivered is terminal: Never allow late or out-of-order scans to regress a delivered shipment!
      shouldUpdateStatus = false;
    } else if (TERMINAL_SHIPMENT_STATUSES[shipment.status] && !TERMINAL_SHIPMENT_STATUSES[mappedStatus]) {
      shouldUpdateStatus = false;
    } else if (mappedStatus in SHIPMENT_STATUS_RANK && shipment.status in SHIPMENT_STATUS_RANK) {
      if (SHIPMENT_STATUS_RANK[mappedStatus] >= SHIPMENT_STATUS_RANK[shipment.status]) {
        shouldUpdateStatus = true;
      } else {
        shouldUpdateStatus = false;
      }
    } else {
      shouldUpdateStatus = true;
    }
  }

  if (shouldUpdateStatus && mappedStatus) {
    shipment.status = mappedStatus as any;

    // 7. Synchronize Order Status State Machine
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
  }
  await shipment.save();

  res.status(200).json({
    success: true,
    message: 'Logistics webhook processed successfully',
    data: { awbNumber: awb, status: shipment.status }
  });
});
