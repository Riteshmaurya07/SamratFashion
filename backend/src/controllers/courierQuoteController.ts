import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { Order } from '../models/Order';
import { Fulfillment, FulfillmentStatus, computePackageFingerprint } from '../models/Fulfillment';
import { Shipment } from '../models/Shipment';
import { CourierQuote } from '../models/CourierQuote';
import { logisticsService } from '../services/logistics/logisticsService';
import { AppError } from '../utils/AppError';
import { catchAsync } from '../utils/catchAsync';

interface AuthRequest extends Request {
  user?: {
    id: string;
    role: string;
  };
}

/**
 * POST /api/admin/orders/:id/courier-quotes
 * Generate multi-courier shipping rate quotes for an order via NimbusPost V2
 * 
 * Invariants:
 * 1. Order must be PAID (prepaid only; no COD inference).
 * 2. Fulfillment must exist and be in READY_TO_SHIP status.
 * 3. Package details must be explicitly confirmed by admin in Fulfillment (no defaults).
 * 4. Stored package details, destination PIN, and order value are authoritative.
 */
export const createOrderCourierQuote = catchAsync(async (req: AuthRequest, res: Response) => {
  const orderId = req.params.id as string;

  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    throw new AppError('Invalid order ID provided', 400);
  }

  const order = await Order.findById(orderId);
  if (!order) {
    throw new AppError('Order not found', 404);
  }

  // 0. Existing-Shipment Protection: An order with an existing shipment cannot receive courier quotes
  const existingShipment = await Shipment.findOne({ orderId: order._id });
  if (existingShipment) {
    throw new AppError(
      'Cannot generate courier quotes: a shipment has already been created for this order.',
      400,
      'SHIPMENT_ALREADY_EXISTS'
    );
  }
  // 1. Strict Payment Check: Samrat Fashion checkout is prepaid; unpaid orders cannot receive courier quotes
  if (order.paymentStatus !== 'PAID') {
    throw new AppError(
      `Courier rate quotes can only be generated for PAID orders. Current order payment status is '${order.paymentStatus}'.`,
      400,
      'ORDER_UNPAID'
    );
  }

  // 2. Strict Fulfillment Readiness Check: Must have a Fulfillment record in READY_TO_SHIP status
  const fulfillment = await Fulfillment.findOne({ orderId: order._id });
  if (!fulfillment) {
    throw new AppError(
      'No fulfillment record found for this order. The order must be processed through warehouse fulfillment before requesting courier rates.',
      400,
      'FULFILLMENT_NOT_FOUND'
    );
  }

  if (fulfillment.status !== FulfillmentStatus.READY_TO_SHIP) {
    throw new AppError(
      `Order is not ready for courier shipping. Fulfillment status must be READY_TO_SHIP (current status: ${fulfillment.status}).`,
      400,
      'FULFILLMENT_NOT_READY_TO_SHIP'
    );
  }

  // 3. Strict Package Confirmation Check: Must use explicitly confirmed measurements from database
  const pkg = fulfillment.packageDetails;
  if (!pkg || !pkg.isConfirmed) {
    throw new AppError(
      'Parcel package measurements have not been confirmed by admin. Please confirm actual packed weight and dimensions before requesting courier quotes.',
      400,
      'PACKAGE_NOT_CONFIRMED'
    );
  }

  const weightNum = Number(pkg.weightGrams);
  const lengthNum = Number(pkg.lengthCm);
  const widthNum = Number(pkg.widthCm);
  const heightNum = Number(pkg.heightCm);

  if (!weightNum || !Number.isFinite(weightNum) || weightNum <= 0) {
    throw new AppError('Confirmed package weight must be greater than 0 grams.', 400, 'INVALID_PACKAGE_DETAILS');
  }
  if (!lengthNum || !Number.isFinite(lengthNum) || lengthNum <= 0 ||
      !widthNum || !Number.isFinite(widthNum) || widthNum <= 0 ||
      !heightNum || !Number.isFinite(heightNum) || heightNum <= 0) {
    throw new AppError('Confirmed package dimensions (length, width, height) must all be greater than 0 cm.', 400, 'INVALID_PACKAGE_DETAILS');
  }

  // 4. Authoritative Destination PIN from customer shipping address
  const destPin = (order.shippingAddress?.postalCode || '').trim();
  if (!/^[1-9][0-9]{5}$/.test(destPin)) {
    throw new AppError(
      `Order destination postal code '${destPin}' is invalid. Customer must have a valid 6-digit Indian PIN code.`,
      400,
      'INVALID_DESTINATION_PIN'
    );
  }

  // 5. Authoritative Origin Warehouse PIN
  const originPostalCode = (process.env.ORIGIN_POSTAL_CODE || '229402').trim();
  if (!/^[1-9][0-9]{5}$/.test(originPostalCode)) {
    throw new AppError(
      `Configured origin postal code '${originPostalCode}' is invalid. Must be a valid 6-digit Indian PIN code.`,
      400,
      'INVALID_ORIGIN_PIN'
    );
  }

  // 6. Authoritative Order Value & Payment Mode (Prepaid only)
  const paymentMode: 'prepaid' = 'prepaid';
  const orderValuePaise = Math.round(order.total * 100);

  // 7. Multi-courier Provider Lookup
  const requestedProvider = String(req.body?.provider || 'nimbuspost').toLowerCase();
  const multiProvider = logisticsService.getMultiCourierProvider(requestedProvider);

  const rateResult = await multiProvider.getMultiCourierRates({
    originPostalCode,
    destinationPostalCode: destPin,
    weightGrams: Math.round(weightNum),
    lengthCm: Math.round(lengthNum * 10) / 10,
    widthCm: Math.round(widthNum * 10) / 10,
    heightCm: Math.round(heightNum * 10) / 10,
    paymentMode,
    orderValuePaise,
    orderId: order._id.toString(),
    orderNumber: order.orderNumber
  });

  // 8. Deterministic Package Fingerprint for Stale Invalidation
  const packageFingerprint = computePackageFingerprint(pkg);

  // 9. Quote Validity: 15 minutes
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 15 * 60 * 1000);

  const quote = await CourierQuote.create({
    orderId: order._id,
    orderNumber: order.orderNumber,
    provider: rateResult.provider,
    originPostalCode,
    destinationPostalCode: destPin,
    paymentMode,
    orderValuePaise,
    packageDetails: {
      weightGrams: Math.round(weightNum),
      lengthCm: Math.round(lengthNum * 10) / 10,
      widthCm: Math.round(widthNum * 10) / 10,
      heightCm: Math.round(heightNum * 10) / 10
    },
    packageFingerprint,
    availableCouriers: rateResult.available,
    excludedCouriers: rateResult.excluded,
    expiresAt,
    createdBy: req.user?.id ? new mongoose.Types.ObjectId(req.user.id) : undefined
  });

  res.status(201).json({
    success: true,
    data: {
      quoteId: quote._id.toString(),
      orderId: order._id.toString(),
      orderNumber: order.orderNumber,
      provider: quote.provider,
      originPostalCode: quote.originPostalCode,
      destinationPostalCode: quote.destinationPostalCode,
      paymentMode: quote.paymentMode,
      orderValuePaise: quote.orderValuePaise,
      packageDetails: quote.packageDetails,
      packageFingerprint: quote.packageFingerprint,
      availableCouriers: quote.availableCouriers,
      excludedCouriers: quote.excludedCouriers,
      expiresAt: quote.expiresAt,
      isExpired: false,
      isStale: false
    }
  });
});

/**
 * GET /api/admin/orders/:id/courier-quotes/latest
 * Retrieve the latest generated quote for an order with stale and expiration validation
 */
export const getLatestOrderCourierQuote = catchAsync(async (req: Request, res: Response) => {
  const orderId = req.params.id as string;

  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    throw new AppError('Invalid order ID provided', 400);
  }

  const quote = await CourierQuote.findOne({ orderId }).sort({ createdAt: -1 });
  if (!quote) {
    return res.status(200).json({ success: true, data: null });
  }

  // Validate current fulfillment state, shipment existence, and package fingerprint
  const existingShipment = await Shipment.findOne({ orderId: quote.orderId });
  const isShipmentCreated = Boolean(existingShipment);
  const fulfillment = await Fulfillment.findOne({ orderId: quote.orderId });
  const isFulfillmentReady = fulfillment?.status === FulfillmentStatus.READY_TO_SHIP;
  const currentFingerprint = computePackageFingerprint(fulfillment?.packageDetails);
  const isPackageStale = !currentFingerprint || currentFingerprint !== quote.packageFingerprint;
  const isExpired = quote.isExpired();
  const isStale = isExpired || isPackageStale || !isFulfillmentReady || isShipmentCreated;

  let staleReason: string | undefined;
  if (isShipmentCreated) {
    staleReason = 'A courier shipment has already been created for this order.';
  } else if (isPackageStale) {
    staleReason = 'Package measurements have changed since this quote was generated.';
  } else if (!isFulfillmentReady) {
    staleReason = `Fulfillment status is no longer READY_TO_SHIP (current: ${fulfillment?.status || 'NONE'}).`;
  } else if (isExpired) {
    staleReason = 'Quote validity period (15 minutes) has expired.';
  }

  res.status(200).json({
    success: true,
    data: {
      quoteId: quote._id.toString(),
      orderId: quote.orderId.toString(),
      orderNumber: quote.orderNumber,
      provider: quote.provider,
      originPostalCode: quote.originPostalCode,
      destinationPostalCode: quote.destinationPostalCode,
      paymentMode: quote.paymentMode,
      orderValuePaise: quote.orderValuePaise,
      packageDetails: quote.packageDetails,
      packageFingerprint: quote.packageFingerprint,
      availableCouriers: quote.availableCouriers,
      excludedCouriers: quote.excludedCouriers,
      expiresAt: quote.expiresAt,
      isExpired,
      isStale,
      isPackageStale,
      isFulfillmentReady,
      isShipmentCreated,
      staleReason,
      createdAt: quote.createdAt
    }
  });
});

/**
 * GET /api/admin/courier-quotes/:quoteId
 * Retrieve specific courier quote by its ID with validation against current fulfillment
 */
export const getCourierQuoteById = catchAsync(async (req: Request, res: Response) => {
  const quoteId = req.params.quoteId as string;

  if (!mongoose.Types.ObjectId.isValid(quoteId)) {
    throw new AppError('Invalid quote ID provided', 400);
  }

  const quote = await CourierQuote.findById(quoteId);
  if (!quote) {
    throw new AppError('Courier quote not found', 404);
  }

  // Validate current fulfillment state, shipment existence, and package fingerprint
  const existingShipment = await Shipment.findOne({ orderId: quote.orderId });
  const isShipmentCreated = Boolean(existingShipment);
  const fulfillment = await Fulfillment.findOne({ orderId: quote.orderId });
  const isFulfillmentReady = fulfillment?.status === FulfillmentStatus.READY_TO_SHIP;
  const currentFingerprint = computePackageFingerprint(fulfillment?.packageDetails);
  const isPackageStale = !currentFingerprint || currentFingerprint !== quote.packageFingerprint;
  const isExpired = quote.isExpired();
  const isStale = isExpired || isPackageStale || !isFulfillmentReady || isShipmentCreated;

  let staleReason: string | undefined;
  if (isShipmentCreated) {
    staleReason = 'A courier shipment has already been created for this order.';
  } else if (isPackageStale) {
    staleReason = 'Package measurements have changed since this quote was generated.';
  } else if (!isFulfillmentReady) {
    staleReason = `Fulfillment status is no longer READY_TO_SHIP (current: ${fulfillment?.status || 'NONE'}).`;
  } else if (isExpired) {
    staleReason = 'Quote validity period (15 minutes) has expired.';
  }

  res.status(200).json({
    success: true,
    data: {
      quoteId: quote._id.toString(),
      orderId: quote.orderId.toString(),
      orderNumber: quote.orderNumber,
      provider: quote.provider,
      originPostalCode: quote.originPostalCode,
      destinationPostalCode: quote.destinationPostalCode,
      paymentMode: quote.paymentMode,
      orderValuePaise: quote.orderValuePaise,
      packageDetails: quote.packageDetails,
      packageFingerprint: quote.packageFingerprint,
      availableCouriers: quote.availableCouriers,
      excludedCouriers: quote.excludedCouriers,
      expiresAt: quote.expiresAt,
      isExpired,
      isStale,
      isPackageStale,
      isFulfillmentReady,
      isShipmentCreated,
      staleReason,
      createdAt: quote.createdAt
    }
  });
});
