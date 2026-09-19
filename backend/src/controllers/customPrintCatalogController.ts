import { Request, Response, NextFunction } from "express";
import { CustomPrintCatalogItem } from "../models/CustomPrintCatalogItem";
import { AppError } from "../utils/AppError";

export const getCatalogItems = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await CustomPrintCatalogItem.find({
      isActive: true,
      name: {
        $not: {
          $regex: /arm logo|half print|front chest logo|center logo|full back logo/i,
        },
      },
    })
      .sort({ sortOrder: 1, createdAt: 1 })
      .populate("productId", "name slug basePrice images variants isCustomizable status")
      .populate("placementTemplateId", "name code side description imageUrl previewConfig");

    res.status(200).json({ success: true, data: items });
  } catch (error) {
    next(error);
  }
};

export const getCatalogItemBySlug = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await CustomPrintCatalogItem.findOne({ slug: req.params.slug, isActive: true })
      .populate("productId", "name slug basePrice mrp discount images variants isCustomizable status")
      .populate("placementTemplateId", "name code side description imageUrl previewConfig");

    if (!item) return next(new AppError("Custom print catalog item not found", 404, "NOT_FOUND"));

    res.status(200).json({ success: true, data: item });
  } catch (error) {
    next(error);
  }
};
