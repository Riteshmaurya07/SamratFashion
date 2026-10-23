import { Request, Response, NextFunction } from "express";
import mongoose, { QueryFilter } from "mongoose";
import { CustomPrintCatalogItem } from "../models/CustomPrintCatalogItem";
import { Category, CategoryStatus, ICategory } from "../models/Category";
import "../models/Product";
import "../models/PrintPlacementTemplate";
import { AppError } from "../utils/AppError";
import { getEffectivePricingRule } from "../services/volumePricingService";

export const getCatalogItems = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { category } = req.query;
    const filter: Record<string, unknown> = { isActive: true };

    if (category && typeof category === "string" && category !== "All" && category !== "All Blanks") {
      if (mongoose.Types.ObjectId.isValid(category)) {
        filter.categoryId = new mongoose.Types.ObjectId(category);
      } else {
        const matchingCat = await Category.findOne({ slug: category.toLowerCase().trim() });
        if (matchingCat) {
          filter.categoryId = matchingCat._id;
        } else {
          // If no matching category found by slug, return empty without crash
          return res.status(200).json({ success: true, data: [] });
        }
      }
    }

    const items = await CustomPrintCatalogItem.find(filter)
      .sort({ sortOrder: 1, createdAt: 1 })
      .populate("productId", "name slug basePrice mrp discount images variants isCustomizable status categoryId")
      .populate("placementTemplateId", "name code side description imageUrl previewConfig")
      .populate("placementTemplateIds", "name code side description imageUrl previewConfig")
      .populate("categoryId", "name slug description");

    res.status(200).json({ success: true, data: items });
  } catch (error) {
    next(error);
  }
};

export const getCatalogItemBySlug = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await CustomPrintCatalogItem.findOne({ slug: req.params.slug, isActive: true })
      .populate("productId", "name slug description basePrice mrp discount images variants isCustomizable status fabric gsm fit sizeGuideTable categoryId")
      .populate("placementTemplateId", "name code side description imageUrl previewConfig")
      .populate("placementTemplateIds", "name code side description imageUrl previewConfig")
      .populate("categoryId", "name slug description");

    if (!item) return next(new AppError("Custom print catalog item not found", 404, "NOT_FOUND"));

    // Attach authoritative volume pricing rule and MOQ
    const pricingRule = await getEffectivePricingRule(item.productId._id, item._id);

    const result = {
      ...item.toObject(),
      pricingRule,
      effectiveMOQ: pricingRule.minOrderQuantity,
    };

    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

export const getCatalogCategories = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Distinct category IDs assigned to active custom print catalog items
    const activeItems = await CustomPrintCatalogItem.find({ isActive: true }).select("categoryId productId");
    const categoryIds = new Set<string>();

    for (const item of activeItems) {
      if (item.categoryId) {
        categoryIds.add(item.categoryId.toString());
      }
    }
    const filterQuery: QueryFilter<ICategory> = {
      _id: { $in: Array.from(categoryIds).map((id) => new mongoose.Types.ObjectId(id)) },
      status: CategoryStatus.ACTIVE,
    };
    const categories = await Category.find(filterQuery).sort({ displayOrder: 1, name: 1 });

    res.status(200).json({
      success: true,
      data: categories,
    });
  } catch (error) {
    next(error);
  }
};
