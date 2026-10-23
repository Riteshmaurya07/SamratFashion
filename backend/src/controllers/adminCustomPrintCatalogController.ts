import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { CustomPrintCatalogItem } from "../models/CustomPrintCatalogItem";
import { Product, ProductStatus } from "../models/Product";
import { PrintPlacementTemplate } from "../models/PrintPlacementTemplate";
import { Category } from "../models/Category";
import { AppError } from "../utils/AppError";

const catalogItemSchema = z.object({
  name: z.string().min(1).max(120).trim(),
  slug: z.string().min(1).max(120).trim().regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, numbers, and hyphens only"),
  description: z.string().max(500).trim().optional(),
  productId: z.string().min(1),
  placementTemplateId: z.string().optional(),
  placementTemplateIds: z.array(z.string()).optional(),
  categoryId: z.string().optional(),
  mockupImageUrl: z.string().min(1).trim(),
  backMockupImageUrl: z.string().min(1).trim().optional(),
  displayPrice: z.number().min(0).optional(),
  minOrderQuantity: z.number().int().min(1).optional(),
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
      .populate("placementTemplateId", "name code side previewConfig imageUrl")
      .populate("placementTemplateIds", "name code side previewConfig imageUrl")
      .populate("categoryId", "name slug");

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
      .populate("placementTemplateId", "name code side previewConfig imageUrl description")
      .populate("placementTemplateIds", "name code side previewConfig imageUrl description")
      .populate("categoryId", "name slug");

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

    const { productId, placementTemplateId, placementTemplateIds, categoryId, slug } = parsed.data;

    // Validate productId format and customizable status
    if (!isValidId(productId)) {
      return next(new AppError("Invalid product ID", 400));
    }
    const product = await Product.findOne({ _id: productId, status: ProductStatus.ACTIVE, isCustomizable: true });
    if (!product) return next(new AppError("Product not found or not customizable", 404));

    // Resolve template IDs
    const templateIdList: string[] = [];
    if (Array.isArray(placementTemplateIds) && placementTemplateIds.length > 0) {
      templateIdList.push(...placementTemplateIds);
    } else if (placementTemplateId) {
      templateIdList.push(placementTemplateId);
    }

    if (templateIdList.length === 0) {
      return next(new AppError("At least one print placement template must be selected", 400));
    }

    for (const tId of templateIdList) {
      if (!isValidId(tId)) return next(new AppError(`Invalid placement template ID: ${tId}`, 400));
      const exists = await PrintPlacementTemplate.findOne({ _id: tId, isActive: true });
      if (!exists) return next(new AppError(`Placement template ${tId} not found or inactive`, 404));
    }

    // Validate category if specified
    if (categoryId) {
      if (!isValidId(categoryId)) return next(new AppError("Invalid category ID", 400));
      const cat = await Category.findById(categoryId);
      if (!cat) return next(new AppError("Category not found", 404));
    }

    // Validate slug uniqueness
    const slugExists = await CustomPrintCatalogItem.findOne({ slug });
    if (slugExists) return next(new AppError("A catalog item with this slug already exists", 409));

    const item = await CustomPrintCatalogItem.create({
      ...parsed.data,
      placementTemplateId: templateIdList[0],
      placementTemplateIds: templateIdList,
      categoryId: categoryId || product.categoryId,
    });

    const populated = await item.populate([
      { path: "productId", select: "name slug basePrice images" },
      { path: "placementTemplateId", select: "name code side previewConfig imageUrl" },
      { path: "placementTemplateIds", select: "name code side previewConfig imageUrl" },
      { path: "categoryId", select: "name slug" },
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

    const updateData = { ...parsed.data };

    if (updateData.slug) {
      const slugExists = await CustomPrintCatalogItem.findOne({ slug: updateData.slug, _id: { $ne: id } });
      if (slugExists) return next(new AppError("A catalog item with this slug already exists", 409));
    }

    if (updateData.productId) {
      if (!isValidId(updateData.productId)) return next(new AppError("Invalid product ID", 400));
      const product = await Product.findOne({ _id: updateData.productId, status: ProductStatus.ACTIVE, isCustomizable: true });
      if (!product) return next(new AppError("Product not found or not customizable", 404));
    }

    if (updateData.placementTemplateIds && updateData.placementTemplateIds.length > 0) {
      for (const tId of updateData.placementTemplateIds) {
        if (!isValidId(tId)) return next(new AppError(`Invalid placement template ID: ${tId}`, 400));
        const template = await PrintPlacementTemplate.findOne({ _id: tId, isActive: true });
        if (!template) return next(new AppError(`Placement template ${tId} not found or inactive`, 404));
      }
      updateData.placementTemplateId = updateData.placementTemplateIds[0];
    } else if (updateData.placementTemplateId) {
      if (!isValidId(updateData.placementTemplateId)) return next(new AppError("Invalid placement template ID", 400));
      const template = await PrintPlacementTemplate.findOne({ _id: updateData.placementTemplateId, isActive: true });
      if (!template) return next(new AppError("Placement template not found or inactive", 404));
      updateData.placementTemplateIds = [updateData.placementTemplateId];
    }

    if (updateData.categoryId) {
      if (!isValidId(updateData.categoryId)) return next(new AppError("Invalid category ID", 400));
      const cat = await Category.findById(updateData.categoryId);
      if (!cat) return next(new AppError("Category not found", 404));
    }

    const item = await CustomPrintCatalogItem.findByIdAndUpdate(id, updateData, { returnDocument: 'after', runValidators: true })
      .populate("productId", "name slug basePrice images")
      .populate("placementTemplateId", "name code side previewConfig imageUrl")
      .populate("placementTemplateIds", "name code side previewConfig imageUrl")
      .populate("categoryId", "name slug");

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

export const deleteAdminCatalogItem = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params.id as string;
    if (!isValidId(id)) return next(new AppError("Invalid ID", 400));

    const item = await CustomPrintCatalogItem.findByIdAndDelete(id);
    if (!item) return next(new AppError("Catalog item not found", 404));

    res.status(200).json({ success: true, message: "Catalog item deleted successfully" });
  } catch (error) {
    next(error);
  }
};
