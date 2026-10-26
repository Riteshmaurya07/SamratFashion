import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { CustomPrintCatalogItem } from "../models/CustomPrintCatalogItem";
import { Product, ProductStatus } from "../models/Product";
import { Category } from "../models/Category";
import { AppError } from "../utils/AppError";
import { ImageService } from "../services/image/ImageService";

const catalogItemSchema = z.object({
  name: z.string().min(1).max(120).trim(),
  slug: z.string().min(1).max(120).trim().regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, numbers, and hyphens only"),
  description: z.string().max(500).trim().optional(),
  productId: z.string().min(1),
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

    const { productId, categoryId, slug } = parsed.data;

    // Validate productId format and customizable status
    if (!isValidId(productId)) {
      return next(new AppError("Invalid product ID", 400));
    }
    const product = await Product.findOne({ _id: productId, status: ProductStatus.ACTIVE, isCustomizable: true });
    if (!product) return next(new AppError("Product not found or not customizable", 404));


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
      categoryId: categoryId || product.categoryId,
    });

    const populated = await item.populate([
      { path: "productId", select: "name slug basePrice images" },
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


    if (updateData.categoryId) {
      if (!isValidId(updateData.categoryId)) return next(new AppError("Invalid category ID", 400));
      const cat = await Category.findById(updateData.categoryId);
      if (!cat) return next(new AppError("Category not found", 404));
    }
    const existingItem = await CustomPrintCatalogItem.findById(id);
    if (!existingItem) return next(new AppError("Catalog item not found", 404));

    const imagesToDelete: string[] = [];
    if (updateData.mockupImageUrl && existingItem.mockupImageUrl && existingItem.mockupImageUrl !== updateData.mockupImageUrl) {
      imagesToDelete.push(existingItem.mockupImageUrl);
    }
    if (updateData.backMockupImageUrl && existingItem.backMockupImageUrl && existingItem.backMockupImageUrl !== updateData.backMockupImageUrl) {
      imagesToDelete.push(existingItem.backMockupImageUrl);
    }
    if (imagesToDelete.length > 0) {
      await ImageService.deleteAssetsByUrls(imagesToDelete);
    }


    const item = await CustomPrintCatalogItem.findByIdAndUpdate(id, updateData, { returnDocument: 'after', runValidators: true })
      .populate("productId", "name slug basePrice images")
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

    const imagesToDelete: string[] = [];
    if (item.mockupImageUrl) imagesToDelete.push(item.mockupImageUrl);
    if (item.backMockupImageUrl) imagesToDelete.push(item.backMockupImageUrl);

    if (imagesToDelete.length > 0) {
      await ImageService.deleteAssetsByUrls(imagesToDelete);
    }
    res.status(200).json({ success: true, message: "Catalog item deleted successfully" });
  } catch (error) {
    next(error);
  }
};
