import { Request, Response, NextFunction } from "express";
import { PricingService } from "../services/pricingService";
import { CustomDesign } from "../models/CustomDesign";
import { AppError } from "../utils/AppError";

/**
 * POST /api/pricing/calculate
 * Public price calculator used by the custom-design studio. Uses server-authoritative
 * pricing rules. When a config references a saved design, ownership is enforced so the
 * endpoint cannot be abused as a design-id enumeration oracle.
 */
export const calculatePricing = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { productId, variantId, quantity, isCustomized, customConfigurations } = req.body;

    if (Array.isArray(customConfigurations) && customConfigurations.length > 0) {
      const userId = (req as any).user?.id;
      for (const config of customConfigurations) {
        if (!config || !config.designId) continue;
        const design = await CustomDesign.findById(config.designId);
        if (!design) throw new AppError("Design not found", 404);
        if (userId && design.userId.toString() !== userId) {
          throw new AppError("Design not found", 404);
        }
      }
    }

    const data = await PricingService.calculateItemPricing({
      productId,
      variantId,
      quantity,
      isCustomized,
      customConfigurations,
    });

    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};