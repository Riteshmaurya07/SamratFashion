import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { logisticsService } from '../services/logistics/logisticsService';
import { Shipment } from '../models/Shipment';
import { Order } from '../models/Order';
import { AppError } from '../utils/AppError';
import { catchAsync } from '../utils/catchAsync';

interface AuthRequest extends Request {
  user?: {
    id: string;
    role: string;
  };
}

/**
 * GET /api/shipping/serviceability?postalCode=...
 * Check delivery and COD serviceability for a given postal code
 */
export const checkServiceability = catchAsync(async (req: Request, res: Response) => {
  const postalCode = String(req.query.postalCode || '');
  if (!postalCode) {
    throw new AppError('Postal code is required', 400);
  }

  const provider = logisticsService.getProvider();
  const result = await provider.checkServiceability(postalCode);

  res.status(200).json({
    success: true,
    data: result
  });
});

/**
 * POST /api/shipping/rates
 * Calculate estimated shipping rates
 */
export const calculateRates = catchAsync(async (req: Request, res: Response) => {
  const { destinationPostalCode, weightGrams, cod } = req.body;

  if (!destinationPostalCode) {
    throw new AppError('Destination postal code is required', 400);
  }

  const provider = logisticsService.getProvider();
  const result = await provider.getRates({
    destinationPostalCode: String(destinationPostalCode),
    weightGrams: Number(weightGrams) || 500,
    cod: Boolean(cod)
  });

  res.status(200).json({
    success: true,
    data: result
  });
});

/**
 * GET /api/shipping/track/:idOrAwb
 * Customer shipment tracking lookup
 */
export const getCustomerTracking = catchAsync(async (req: AuthRequest, res: Response) => {
  const idOrAwb = req.params.idOrAwb as string;
  if (!req.user) {
    throw new AppError('Unauthorized', 401);
  }

  let shipment = null;
  if (mongoose.Types.ObjectId.isValid(idOrAwb)) {
    shipment = await Shipment.findOne({ _id: idOrAwb, userId: req.user.id });
    if (!shipment) {
      shipment = await Shipment.findOne({ orderId: idOrAwb, userId: req.user.id });
    }
  }

  if (!shipment) {
    shipment = await Shipment.findOne({ awbNumber: idOrAwb, userId: req.user.id });
  }

  if (!shipment) {
    shipment = await Shipment.findOne({ trackingNumber: idOrAwb, userId: req.user.id });
  }

  if (!shipment) {
    throw new AppError('Shipment tracking not found for this account', 404);
  }

  const order = await Order.findById(shipment.orderId).select('orderNumber status paymentStatus createdAt total items');

  res.status(200).json({
    success: true,
    data: {
      shipment,
      orderSummary: order
    }
  });
});
