import { Request, Response, NextFunction } from "express";
import { PricingService, PricingCalculationRequest } from "../services/pricingService";

export const calculatePricingPreview = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const payload = req.body as PricingCalculationRequest;
    
    // Perform authoritative centralized calculation
    const snapshot = await PricingService.calculateItemPricing(payload);

    res.status(200).json({
      success: true,
      data: snapshot,
    });
  } catch (error) {
    next(error);
  }
};
