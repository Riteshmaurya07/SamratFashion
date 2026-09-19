import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { CustomPrintCatalogItem } from "../models/CustomPrintCatalogItem";
import { Product, ProductStatus } from "../models/Product";
import { PrintPlacementTemplate } from "../models/PrintPlacementTemplate";
import { AppError } from "../utils/AppError";

const catalogItemSchema = z.object({
  name: z.string().min(1).max(120).trim(),
  slug: z.string().min(1).max(120).trim().regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, numbers, and hyphens only"),
  description: z.string().max(500).trim().optional(),
  productId: z.string().min(1),
  placementTemplateId: z.string().min(1),
  mockupImageUrl: z.string().url(),
  displayPrice: z.number().min(0).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

const catalogItemUpdateSchema = catalogItemSchema.partial();

function isValidId(id: unknown): id is string {
  return typeof id === "string" && mongoose.Types.ObjectId.isValid(id);
}

export const getAdminCatalogItems = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await CustomPrintCatalogItem.find()
      .sort({ sortOrder: 1, createdAt: 1 })
      .populate("productId", "name slug basePrice images")
      .populate("placementTemplateId", "name code side previewConfig imageUrl");

    res.status(200).json({ success: true, data: items });
  } catch (error) {
    next(error);
  }
};

export const getAdminCatalogItemById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    if (!isValidId(id)) return next(new AppError("Invalid ID", 400));

    const item = await CustomPrintCatalogItem.findById(id)
      .populate("productId", "name slug basePrice images variants")
      .populate("placementTemplateId", "name code side previewConfig imageUrl description");

    if (!item) return next(new AppError("Catalog item not found", 404));
    res.status(200).json({ success: true, data: item });
  } catch (error) {
    next(error);
  }
};

export const createAdminCatalogItem = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = catalogItemSchema.safeParse(req.body);
    if (!parsed.success) {
      return next(new AppError(parsed.error.issues[0]?.message || "Validation failed", 400));
    }

    const { productId, placementTemplateId, slug } = parsed.data;

    // Validate ObjectId formats
    if (!isValidId(productId) || !isValidId(placementTemplateId)) {
      return next(new AppError("Invalid product or placement template ID", 400));
    }

    // Validate slug uniqueness
    const slugExists = await CustomPrintCatalogItem.findOne({ slug });
    if (slugExists) return next(new AppError("A catalog item with this slug already exists", 409));

    // Validate product exists and is customizable
    const product = await Product.findOne({ _id: productId, status: ProductStatus.ACTIVE, isCustomizable: true });
    if (!product) return next(new AppError("Product not found or not customizable", 404));

    // Validate placement template exists
    const template = await PrintPlacementTemplate.findOne({ _id: placementTemplateId, isActive: true });
    if (!template) return next(new AppError("Placement template not found or inactive", 404));

    const item = await CustomPrintCatalogItem.create(parsed.data);
    const populated = await item.populate([
      { path: "productId", select: "name slug basePrice images" },
      { path: "placementTemplateId", select: "name code side previewConfig imageUrl" },
    ]);

    res.status(201).json({ success: true, data: populated });
  } catch (error) {
    next(error);
  }
};

export const updateAdminCatalogItem = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    if (!isValidId(id)) return next(new AppError("Invalid ID", 400));

    const parsed = catalogItemUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return next(new AppError(parsed.error.issues[0]?.message || "Validation failed", 400));
    }

    const updateData = parsed.data;

    // If changing slug, check uniqueness
    if (updateData.slug) {
      const slugExists = await CustomPrintCatalogItem.findOne({ slug: updateData.slug, _id: { $ne: id } });
      if (slugExists) return next(new AppError("A catalog item with this slug already exists", 409));
    }

    // Validate product if provided
    if (updateData.productId) {
      if (!isValidId(updateData.productId)) return next(new AppError("Invalid product ID", 400));
      const product = await Product.findOne({ _id: updateData.productId, status: ProductStatus.ACTIVE, isCustomizable: true });
      if (!product) return next(new AppError("Product not found or not customizable", 404));
    }

    // Validate placement template if provided
    if (updateData.placementTemplateId) {
      if (!isValidId(updateData.placementTemplateId)) return next(new AppError("Invalid placement template ID", 400));
      const template = await PrintPlacementTemplate.findOne({ _id: updateData.placementTemplateId, isActive: true });
      if (!template) return next(new AppError("Placement template not found or inactive", 404));
    }

    const item = await CustomPrintCatalogItem.findByIdAndUpdate(id, updateData, { returnDocument: 'after', runValidators: true })
      .populate("productId", "name slug basePrice images")
      .populate("placementTemplateId", "name code side previewConfig imageUrl");

    if (!item) return next(new AppError("Catalog item not found", 404));
    res.status(200).json({ success: true, data: item });
  } catch (error) {
    next(error);
  }
};

export const deactivateAdminCatalogItem = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    if (!isValidId(id)) return next(new AppError("Invalid ID", 400));

    const item = await CustomPrintCatalogItem.findByIdAndUpdate(
      id,
      { isActive: false },
      { returnDocument: 'after' }
    );
    if (!item) return next(new AppError("Catalog item not found", 404));

    res.status(200).json({ success: true, message: "Catalog item deactivated", data: item });
  } catch (error) {
    next(error);
  }
};

export const activateAdminCatalogItem = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    if (!isValidId(id)) return next(new AppError("Invalid ID", 400));

    const item = await CustomPrintCatalogItem.findByIdAndUpdate(
      id,
      { isActive: true },
      { returnDocument: 'after' }
    );
    if (!item) return next(new AppError("Catalog item not found", 404));

    res.status(200).json({ success: true, message: "Catalog item activated", data: item });
  } catch (error) {
    next(error);
  }
};
