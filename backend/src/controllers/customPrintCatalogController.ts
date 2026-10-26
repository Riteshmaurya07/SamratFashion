import { Request, Response, NextFunction } from "express";
import mongoose, { QueryFilter } from "mongoose";
import { CustomPrintCatalogItem } from "../models/CustomPrintCatalogItem";
import { Category, CategoryStatus, ICategory } from "../models/Category";
import { Product } from "../models/Product";
import "../models/Product";
import { AppError } from "../utils/AppError";
import { getEffectivePricingRule } from "../services/volumePricingService";

export const getCatalogItems = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { category } = req.query;
    const filter: Record<string, unknown> = { isActive: true };

    if (category && typeof category === "string" && category !== "All" && category !== "All Blanks") {
      let targetCat: any = null;
      if (mongoose.Types.ObjectId.isValid(category)) {
        targetCat = await Category.findById(category);
      } else {
        targetCat = await Category.findOne({ slug: category.toLowerCase().trim() });
      }

      if (!targetCat || targetCat.status !== CategoryStatus.ACTIVE) {
        return res.status(200).json({ success: true, data: [] });
      }

      const childCategories = await Category.find({ parentCategory: targetCat._id, status: CategoryStatus.ACTIVE }).select("_id");
      const categoryIdsToMatch = [targetCat._id, ...childCategories.map((c) => c._id)];

      const fallbackProducts = await Product.find({ categoryId: { $in: categoryIdsToMatch } }).select("_id");
      const fallbackProductIds = fallbackProducts.map((p) => p._id);

      filter.$or = [
        { categoryId: { $in: categoryIdsToMatch } },
        { categoryId: { $exists: false }, productId: { $in: fallbackProductIds } },
        { categoryId: null, productId: { $in: fallbackProductIds } },
      ];
    }

    const items = await CustomPrintCatalogItem.find(filter)
      .sort({ sortOrder: 1, createdAt: 1 })
      .populate("productId", "name slug basePrice mrp discount images variants isCustomizable status categoryId")
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
    const activeItems = await CustomPrintCatalogItem.find({ isActive: true }).select("categoryId productId");
    const categoryIds = new Set<string>();

    for (const item of activeItems) {
      if (item.categoryId) {
        categoryIds.add(item.categoryId.toString());
      }
    }

    const unassignedProductIds = activeItems.filter((i) => !i.categoryId).map((i) => i.productId).filter(Boolean);
    if (unassignedProductIds.length > 0) {
      const prods = await Product.find({ _id: { $in: unassignedProductIds } }).select("categoryId");
      for (const p of prods) {
        if (p.categoryId) categoryIds.add(p.categoryId.toString());
      }
    }

    const filterQuery: QueryFilter<ICategory> = {
      _id: { $in: Array.from(categoryIds).map((id) => new mongoose.Types.ObjectId(id)) },
      status: CategoryStatus.ACTIVE,
    };
    const categories = await Category.find(filterQuery)
      .populate("parentCategory", "name slug status")
      .sort({ displayOrder: 1, name: 1 });

    const validCategories = categories.filter((c) => {
      if (c.parentCategory && typeof c.parentCategory === "object" && "status" in c.parentCategory) {
        return (c.parentCategory as { status?: string }).status === CategoryStatus.ACTIVE;
      }
      return true;
    });

    res.status(200).json({
      success: true,
      data: validCategories,
    });
  } catch (error) {
    next(error);
  }
};
