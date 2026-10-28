import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { PrintPricingConfig } from "../models/PrintPricingConfig";
import { Product } from "../models/Product";
import { Category } from "../models/Category";
import { AppError } from "../utils/AppError";
import { calculateAuthoritativeBulkPricing, getEffectivePricingRule } from "../services/volumePricingService";

const tierSchema = z.object({
  minQuantity: z.number().int().min(1),
  maxQuantity: z.number().int().min(1).optional(),
  discountPercentage: z.number().min(0).max(100).optional(),
  unitPrice: z.number().min(0).optional(),
});

const pricingConfigSchema = z.object({
  scope: z.enum(["GLOBAL", "CATEGORY", "PRODUCT"]),
  productId: z.string().optional(),
  categoryId: z.string().optional(),
  minOrderQuantity: z.number().int().min(1).default(10),
  tiers: z.array(tierSchema).default([]),
  printLocationFee: z.number().min(0).optional(),
  printingFeePerUnit: z.number().min(0).optional(),
  setupFee: z.number().min(0).default(0),
  isActive: z.boolean().default(true),
});

export const getPricingConfigs = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { scope, productId, categoryId } = req.query;
    const filter: Record<string, unknown> = {};
    if (scope) filter.scope = scope;
    if (productId && mongoose.Types.ObjectId.isValid(productId as string)) {
      filter.productId = new mongoose.Types.ObjectId(productId as string);
    }
    if (categoryId && mongoose.Types.ObjectId.isValid(categoryId as string)) {
      filter.categoryId = new mongoose.Types.ObjectId(categoryId as string);
    }

    const configs = await PrintPricingConfig.find(filter)
      .populate("productId", "name slug basePrice")
      .populate("categoryId", "name slug")
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, data: configs });
  } catch (error) {
    next(error);
  }
};

export const getPricingConfigById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id as string)) {
      return next(new AppError("Invalid Config ID", 400));
    }

    const config = await PrintPricingConfig.findById(id)
      .populate("productId", "name slug basePrice")
      .populate("categoryId", "name slug");

    if (!config) return next(new AppError("Pricing configuration not found", 404));

    res.status(200).json({ success: true, data: config });
  } catch (error) {
    next(error);
  }
};

export const createOrUpdatePricingConfig = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = pricingConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      return next(new AppError(parsed.error.issues[0]?.message || "Invalid pricing config payload", 400));
    }

    const { scope, productId, categoryId, minOrderQuantity, tiers, printLocationFee, printingFeePerUnit, setupFee, isActive } = parsed.data;
    const resolvedFee = printingFeePerUnit ?? printLocationFee ?? 200;

    if (scope === "PRODUCT") {
      if (!productId || !mongoose.Types.ObjectId.isValid(productId)) {
        return next(new AppError("Product ID is required for PRODUCT scope", 400));
      }
      const product = await Product.findById(productId);
      if (!product) return next(new AppError("Referenced product not found", 404));
    }

    if (scope === "CATEGORY") {
      if (!categoryId || !mongoose.Types.ObjectId.isValid(categoryId)) {
        return next(new AppError("Category ID is required for CATEGORY scope", 400));
      }
      const category = await Category.findById(categoryId);
      if (!category) return next(new AppError("Referenced category not found", 404));
    }

    // Upsert or create
    const query: Record<string, unknown> = { scope };
    if (scope === "PRODUCT") query.productId = new mongoose.Types.ObjectId(productId);
    if (scope === "CATEGORY") query.categoryId = new mongoose.Types.ObjectId(categoryId);

    const updated = await PrintPricingConfig.findOneAndUpdate(
      query,
      {
        scope,
        productId: productId ? new mongoose.Types.ObjectId(productId) : undefined,
        categoryId: categoryId ? new mongoose.Types.ObjectId(categoryId) : undefined,
        minOrderQuantity,
        tiers,
        printLocationFee: resolvedFee,
        setupFee,
        isActive,
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true, runValidators: true }
    );

    res.status(200).json({
      success: true,
      message: "Volume pricing configuration saved successfully.",
      data: updated,
    });
  } catch (error) {
    next(error);
  }
};

export const deletePricingConfig = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id as string)) {
      return next(new AppError("Invalid Config ID", 400));
    }

    const deleted = await PrintPricingConfig.findByIdAndDelete(id);
    if (!deleted) return next(new AppError("Pricing configuration not found", 404));

    res.status(200).json({
      success: true,
      message: "Pricing configuration deleted successfully.",
    });
  } catch (error) {
    next(error);
  }
};

export const getPublicPricingRule = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { productId, catalogItemId } = req.query;
    if (!productId || typeof productId !== "string" || !mongoose.Types.ObjectId.isValid(productId)) {
      return next(new AppError("Valid productId query parameter is required", 400));
    }

    const rule = await getEffectivePricingRule(productId, typeof catalogItemId === "string" ? catalogItemId : undefined);
    res.status(200).json({ success: true, data: rule });
  } catch (error) {
    next(error);
  }
};

export const calculatePublicBulkEstimate = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { productId, catalogItemId, totalQuantity } = req.body;
    if (!productId || typeof productId !== "string" || !mongoose.Types.ObjectId.isValid(productId)) {
      return next(new AppError("Valid productId is required", 400));
    }

    const qty = Number(totalQuantity);
    if (!Number.isFinite(qty) || qty < 1) {
      return next(new AppError("totalQuantity must be at least 1", 400));
    }

    const estimate = await calculateAuthoritativeBulkPricing({
      productId,
      catalogItemId,
      totalQuantity: qty,
    });

    res.status(200).json({ success: true, data: estimate });
  } catch (error) {
    next(error);
  }
};
