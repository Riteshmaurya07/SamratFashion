import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { Category } from "../models/Category";
import { Theme } from "../models/Theme";
import { Product } from "../models/Product";
import { CustomPrintCatalogItem } from "../models/CustomPrintCatalogItem";
import { Campaign } from "../models/Campaign";
import { Coupon } from "../models/Coupon";
import { InventoryTransaction } from "../models/InventoryTransaction";
import { AuditLog } from "../models/AuditLog";
import { AppError } from "../utils/AppError";
import { ImageService } from "../services/image/ImageService";
import {
  createCategorySchema, updateCategorySchema, categoryStatusSchema,
  createThemeSchema, updateThemeSchema, themeStatusSchema,
  createProductSchema, updateProductSchema, productStatusSchema,
  inventoryAdjustmentSchema
} from "../utils/catalogValidation";
import { invalidateCatalogCache } from "./catalogController";

interface AuthRequest extends Request {
  user?: {
    id: string;
    role: string;
  };
}

// Helpers
const normalizeString = (str?: string) => str ? str.trim().toLowerCase() : "";

const checkVariantUniqueness = (variants: any[]) => {
  const seen = new Set();
  for (const v of variants) {
    const key = `${normalizeString(v.size)}-${normalizeString(v.color)}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
};

const checkSkuUniqueness = async (variants: any[], productIdToExclude?: string) => {
  const skus = variants.map(v => v.sku).filter(Boolean);
  if (skus.length === 0) return true;
  
  const query: any = { "variants.sku": { $in: skus } };
  if (productIdToExclude) query._id = { $ne: productIdToExclude };
  
  const existing = await Product.findOne(query);
  return !existing;
};

// --- Category Admin ---
export const createCategory = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = createCategorySchema.parse(req.body);
    
    if (data.parentCategory) {
      const parent = await Category.findById(data.parentCategory);
      if (!parent) return next(new AppError("Parent category not found", 400));
      if (parent.parentCategory) {
        return next(new AppError("Cannot nest categories beyond 2 levels. Only root categories can be parents.", 400));
      }
    }

    const existing = await Category.findOne({ slug: data.slug });
    if (existing) return next(new AppError("Category slug already exists", 409, "DUPLICATE_SLUG"));

    const category = await Category.create(data as any);
    
    await AuditLog.create({
      actorId: req.user!.id,
      actorRole: req.user!.role,
      action: "ADMIN_CATEGORY_CREATED",
      entityType: "CATEGORY",
      entityId: (category as any)._id,
      metadata: { slug: (category as any).slug }
    });
    invalidateCatalogCache();

    res.status(201).json({ success: true, data: category });
  } catch (error) { next(error); }
};

export const updateCategory = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = updateCategorySchema.parse(req.body);
    
    if (data.parentCategory === req.params.id) {
      return next(new AppError("Category cannot be its own parent", 400));
    }
    
    if (data.parentCategory) {
      const parent = await Category.findById(data.parentCategory);
      if (!parent) return next(new AppError("Parent category not found", 400));
      if (parent.parentCategory) {
        return next(new AppError("Cannot nest categories beyond 2 levels. Only root categories can be parents.", 400));
      }
      const hasChildren = await Category.countDocuments({ parentCategory: req.params.id });
      if (hasChildren > 0) {
        return next(new AppError("This category has subcategories and cannot be assigned a parent (maximum 2 levels).", 400));
      }
    }

    if (data.slug) {
      const existing = await Category.findOne({ slug: data.slug, _id: { $ne: req.params.id } });
      if (existing) return next(new AppError("Category slug already exists", 409, "DUPLICATE_SLUG"));
    }
    const existingCategory = await Category.findById(req.params.id);
    if (!existingCategory) return next(new AppError("Category not found", 404, "NOT_FOUND"));

    if (data.image && existingCategory.image && existingCategory.image !== data.image) {
      await ImageService.deleteAssetByUrl(existingCategory.image);
    }

    
    const category = await Category.findByIdAndUpdate(req.params.id, data, { returnDocument: 'after' });
    if (!category) return next(new AppError("Category not found", 404, "NOT_FOUND"));

    await AuditLog.create({
      actorId: req.user!.id,
      actorRole: req.user!.role,
      action: "ADMIN_CATEGORY_UPDATED",
      entityType: "CATEGORY",
      entityId: category._id
    });
    invalidateCatalogCache();

    res.status(200).json({ success: true, data: category });
  } catch (error) { next(error); }
};

export const updateCategoryStatus = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { status } = categoryStatusSchema.parse(req.body);
    const category = await Category.findById(req.params.id);
    if (!category) return next(new AppError("Category not found", 404, "NOT_FOUND"));
    const prevStatus = category.status;
    category.status = status;
    await category.save();

    await AuditLog.create({
      actorId: req.user!.id,
      actorRole: req.user!.role,
      action: "ADMIN_CATEGORY_STATUS_CHANGED",
      entityType: "CATEGORY",
      entityId: category._id,
      metadata: { previousStatus: prevStatus, newStatus: status }
    });
    invalidateCatalogCache();

    res.status(200).json({ success: true, data: category });
  } catch (error) { next(error); }
};

export const getAdminCategories = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const categories = await Category.find()
      .populate("parentCategory", "name slug")
      .sort({ displayOrder: 1, createdAt: -1 });

    const productCounts = await Product.aggregate([
      { $match: { status: "ACTIVE" } },
      { $group: { _id: "$categoryId", count: { $sum: 1 } } }
    ]);

    const countMap = new Map(productCounts.map(item => [item._id?.toString(), item.count]));

    const categoriesWithCounts = categories.map(cat => ({
      ...cat.toObject(),
      productCount: countMap.get(cat._id.toString()) || 0
    }));

    res.status(200).json({ success: true, data: categoriesWithCounts });
  } catch (error) { next(error); }
};

export const getAdminCategoryById = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) return next(new AppError("Category not found", 404, "NOT_FOUND"));
    res.status(200).json({ success: true, data: category });
  } catch (error) { next(error); }
};
export const deleteCategory = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = typeof req.params.id === "string" ? req.params.id : Array.isArray(req.params.id) ? req.params.id[0] : "";
    const productCount = await Product.countDocuments({ categoryId: id });
    if (productCount > 0) {
      return next(new AppError(`Cannot delete category: ${productCount} product(s) are assigned to it. Reassign or remove products first.`, 400));
    }

    const childCount = await Category.countDocuments({ parentCategory: id });
    if (childCount > 0) {
      return next(new AppError(`Cannot delete category: ${childCount} subcategory(ies) belong to it. Reassign subcategories first.`, 400));
    }

    const customItemCount = await CustomPrintCatalogItem.countDocuments({ categoryId: id });
    if (customItemCount > 0) {
      return next(new AppError(`Cannot delete category: ${customItemCount} custom print catalog item(s) reference it. Reassign or remove items first.`, 400));
    }

    const objectId = new mongoose.Types.ObjectId(id);
    const campaignCount = await Campaign.countDocuments({ categoryIds: { $in: [objectId] } } as never);
    if (campaignCount > 0) {
      return next(new AppError(`Cannot delete category: ${campaignCount} active marketing campaign(s) reference it. Reassign campaigns first.`, 400));
    }

    const couponCount = await Coupon.countDocuments({ applicableCategoryIds: { $in: [objectId] } } as never);
    if (couponCount > 0) {
      return next(new AppError(`Cannot delete category: ${couponCount} coupon(s) reference it. Reassign coupons first.`, 400));
    }
    const category = await Category.findByIdAndDelete(id);
    if (!category) return next(new AppError("Category not found", 404, "NOT_FOUND"));
    if (category.image) {
      await ImageService.deleteAssetByUrl(category.image);
    }


    await AuditLog.create({
      actorId: req.user!.id,
      actorRole: req.user!.role,
      action: "ADMIN_CATEGORY_DELETED",
      entityType: "CATEGORY",
      entityId: category._id,
      metadata: { name: category.name, slug: category.slug }
    });
    invalidateCatalogCache();

    res.status(200).json({ success: true, message: "Category deleted successfully" });
  } catch (error) { next(error); }
};


// --- Theme Admin ---
export const createTheme = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = createThemeSchema.parse(req.body);
    const existing = await Theme.findOne({ slug: data.slug });
    if (existing) return next(new AppError("Theme slug already exists", 409, "DUPLICATE_SLUG"));

    const theme = await Theme.create(data);

    await AuditLog.create({
      actorId: req.user!.id,
      actorRole: req.user!.role,
      action: "ADMIN_THEME_CREATED",
      entityType: "THEME",
      entityId: theme._id
    });
    invalidateCatalogCache();

    res.status(201).json({ success: true, data: theme });
  } catch (error) { next(error); }
};

export const updateTheme = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = updateThemeSchema.parse(req.body);
    if (data.slug) {
      const existing = await Theme.findOne({ slug: data.slug, _id: { $ne: req.params.id } });
      if (existing) return next(new AppError("Theme slug already exists", 409, "DUPLICATE_SLUG"));
    }
    const existingTheme = await Theme.findById(req.params.id);
    if (!existingTheme) return next(new AppError("Theme not found", 404, "NOT_FOUND"));

    const themeImagesToDelete: string[] = [];
    if (data.heroImage && existingTheme.heroImage && existingTheme.heroImage !== data.heroImage) {
      themeImagesToDelete.push(existingTheme.heroImage);
    }
    if (data.thumbnail && existingTheme.thumbnail && existingTheme.thumbnail !== data.thumbnail) {
      themeImagesToDelete.push(existingTheme.thumbnail);
    }
    if (themeImagesToDelete.length > 0) {
      await ImageService.deleteAssetsByUrls(themeImagesToDelete);
    }

    const theme = await Theme.findByIdAndUpdate(req.params.id, data, { returnDocument: 'after' });
    if (!theme) return next(new AppError("Theme not found", 404, "NOT_FOUND"));

    await AuditLog.create({
      actorId: req.user!.id,
      actorRole: req.user!.role,
      action: "ADMIN_THEME_UPDATED",
      entityType: "THEME",
      entityId: theme._id
    });
    invalidateCatalogCache();

    res.status(200).json({ success: true, data: theme });
  } catch (error) { next(error); }
};

export const updateThemeStatus = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { status } = themeStatusSchema.parse(req.body);
    const theme = await Theme.findById(req.params.id);
    if (!theme) return next(new AppError("Theme not found", 404, "NOT_FOUND"));

    const prevStatus = theme.status;
    theme.status = status;
    await theme.save();

    await AuditLog.create({
      actorId: req.user!.id,
      actorRole: req.user!.role,
      action: "ADMIN_THEME_STATUS_CHANGED",
      entityType: "THEME",
      entityId: theme._id,
      metadata: { previousStatus: prevStatus, newStatus: status }
    });

    invalidateCatalogCache();
    res.status(200).json({ success: true, data: theme });
  } catch (error) { next(error); }
};

export const getAdminThemes = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const themes = await Theme.find().sort({ displayOrder: 1, createdAt: -1 });
    res.status(200).json({ success: true, data: themes });
  } catch (error) { next(error); }
};

export const getAdminThemeById = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const theme = await Theme.findById(req.params.id);
    if (!theme) return next(new AppError("Theme not found", 404, "NOT_FOUND"));
    res.status(200).json({ success: true, data: theme });
  } catch (error) { next(error); }
};

// --- Product Admin ---
export const createProduct = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = createProductSchema.parse(req.body);
    const existing = await Product.findOne({ slug: data.slug });
    if (existing) return next(new AppError("Product slug already exists", 409, "DUPLICATE_SLUG"));

    if (data.categoryId) {
      const categoryId = data.categoryId as string;
      if (!mongoose.Types.ObjectId.isValid(categoryId)) {
        return next(new AppError("Invalid categoryId", 400, "INVALID_CATEGORY"));
      }
      const categoryDoc = await Category.findById(categoryId);
      if (!categoryDoc) return next(new AppError("Invalid categoryId: category does not exist", 400, "INVALID_CATEGORY"));
      if (categoryDoc.status !== "ACTIVE") {
        return next(new AppError("Cannot assign new product to an inactive category. Please activate the category first.", 400, "INACTIVE_CATEGORY"));
      }
    }
    if (!checkVariantUniqueness(data.variants)) {
      return next(new AppError("Duplicate variant combinations (size + color) are not allowed", 400));
    }

    const isSkuUnique = await checkSkuUniqueness(data.variants);
    if (!isSkuUnique) return next(new AppError("One or more SKUs are already in use", 409));

    const product = await Product.create(data as any);

    await AuditLog.create({
      actorId: req.user!.id,
      actorRole: req.user!.role,
      action: "ADMIN_PRODUCT_CREATED",
      entityType: "PRODUCT",
      entityId: (product as any)._id
    });
    invalidateCatalogCache();

    res.status(201).json({ success: true, data: product });
  } catch (error) { next(error); }
};

export const updateProduct = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const data = updateProductSchema.parse(req.body);
    
    if (data.slug) {
      const existing = await Product.findOne({ slug: data.slug, _id: { $ne: req.params.id } });
      if (existing) return next(new AppError("Product slug already exists", 409, "DUPLICATE_SLUG"));
    }

    if (data.variants) {
      if (!checkVariantUniqueness(data.variants)) {
        return next(new AppError("Duplicate variant combinations (size + color) are not allowed", 400));
      }
      const isSkuUnique = await checkSkuUniqueness(data.variants, req.params.id as string);
      if (!isSkuUnique) return next(new AppError("One or more SKUs are already in use", 409));
    }

    const existingProduct = await Product.findById(req.params.id);
    if (!existingProduct) return next(new AppError("Product not found", 404, "NOT_FOUND"));

    const oldImages = new Set([
      ...(existingProduct.images || []),
      ...(existingProduct.variants?.flatMap((v) => v.images || []) || []),
    ]);

    const product = await Product.findByIdAndUpdate(req.params.id, data, { returnDocument: 'after' });
    if (!product) return next(new AppError("Product not found", 404, "NOT_FOUND"));

    // If images were modified, delete any removed assets from Cloudinary
    if (data.images !== undefined || data.variants !== undefined) {
      const newImages = new Set([
        ...(product.images || []),
        ...(product.variants?.flatMap((v) => v.images || []) || []),
      ]);
      const removedImages = Array.from(oldImages).filter((img) => !newImages.has(img));
      if (removedImages.length > 0) {
        await ImageService.deleteAssetsByUrls(removedImages);
      }
    }

    await AuditLog.create({
      actorId: req.user!.id,
      actorRole: req.user!.role,
      action: "ADMIN_PRODUCT_UPDATED",
      entityType: "PRODUCT",
      entityId: product._id
    });
    invalidateCatalogCache();

    res.status(200).json({ success: true, data: product });
  } catch (error) { next(error); }
};

export const deleteProduct = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = typeof req.params.id === "string" ? req.params.id : Array.isArray(req.params.id) ? req.params.id[0] : "";
    const product = await Product.findById(id);
    if (!product) return next(new AppError("Product not found", 404, "NOT_FOUND"));

    // Block deletion if custom print catalog items reference this product
    const customItemCount = await CustomPrintCatalogItem.countDocuments({ productId: id });
    if (customItemCount > 0) {
      return next(
        new AppError(
          `Cannot delete product: ${customItemCount} custom print catalog item(s) reference it. Reassign or remove catalog items first.`,
          400
        )
      );
    }

    // Gather all images from root product and all variants
    const allImages = [
      ...(product.images || []),
      ...(product.variants?.flatMap((v) => v.images || []) || []),
    ];

    await Product.findByIdAndDelete(id);

    // Remove all associated assets from Cloudinary / storage
    if (allImages.length > 0) {
      await ImageService.deleteAssetsByUrls(allImages);
    }

    await AuditLog.create({
      actorId: req.user!.id,
      actorRole: req.user!.role,
      action: "ADMIN_PRODUCT_DELETED",
      entityType: "PRODUCT",
      entityId: product._id,
      metadata: { name: product.name, slug: product.slug, deletedImagesCount: allImages.length }
    });

    invalidateCatalogCache();
    res.status(200).json({
      success: true,
      message: "Product and associated assets deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

export const updateProductStatus = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { status } = productStatusSchema.parse(req.body);
    const product = await Product.findById(req.params.id);
    if (!product) return next(new AppError("Product not found", 404, "NOT_FOUND"));

    // Validation for DRAFT -> ACTIVE
    if (status === "ACTIVE" && product.status === "DRAFT") {
      if (!product.name || !product.slug || !product.categoryId) {
        return next(new AppError("Product is missing core details required for activation", 400));
      }
      if (typeof product.basePrice !== 'number' || product.basePrice < 0) {
        return next(new AppError("Product has an invalid base price", 400));
      }
      if (!product.variants || product.variants.length === 0) {
        return next(new AppError("Product must have at least one variant to be active", 400));
      }
      const hasValidVariant = product.variants.some(v => v.sku && v.stock >= 0 && v.isAvailable);
      if (!hasValidVariant) {
        return next(new AppError("Product must have at least one available variant with a valid SKU and stock", 400));
      }
    }

    const prevStatus = product.status;
    product.status = status;
    await product.save();

    await AuditLog.create({
      actorId: req.user!.id,
      actorRole: req.user!.role,
      action: "ADMIN_PRODUCT_STATUS_CHANGED",
      entityType: "PRODUCT",
      entityId: product._id,
      metadata: { previousStatus: prevStatus, newStatus: status }
    });

    invalidateCatalogCache();
    res.status(200).json({ success: true, data: product });
  } catch (error) { next(error); }
};

export const getAdminProducts = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const query: any = {};
    if (req.query.search) {
      query.$or = [
        { name: { $regex: req.query.search, $options: "i" } },
        { slug: { $regex: req.query.search, $options: "i" } },
        { "variants.sku": { $regex: req.query.search, $options: "i" } }
      ];
    }
    if (req.query.status) query.status = req.query.status;
    if (req.query.category) query.categoryId = req.query.category;
    if (req.query.theme) query.themeIds = req.query.theme;
    if (req.query.featured === 'true') query.isFeatured = true;
    if (req.query.newArrival === 'true') query.isNewArrival = true;
    if (req.query.bestSeller === 'true') query.isBestSeller = true;

    const sortField = (req.query.sortField as string) || 'createdAt';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    const allowedSortFields = ['createdAt', 'basePrice', 'name', 'status'];
    const finalSortField = allowedSortFields.includes(sortField) ? sortField : 'createdAt';

    const [products, total] = await Promise.all([
      Product.find(query)
        .populate("categoryId", "name slug")
        .sort({ [finalSortField]: sortOrder })
        .skip(skip)
        .limit(limit),
      Product.countDocuments(query)
    ]);

    res.status(200).json({
      success: true,
      data: {
        items: products,
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      }
    });
  } catch (error) { next(error); }
};

export const getAdminProductById = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const product = await Product.findById(req.params.id).populate("categoryId").populate("themeIds");
    if (!product) return next(new AppError("Product not found", 404, "NOT_FOUND"));
    res.status(200).json({ success: true, data: product });
  } catch (error) { next(error); }
};

// --- Inventory Admin ---
export const adjustInventory = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { productId, variantId } = req.params;
    const { quantity, type, reason } = inventoryAdjustmentSchema.parse(req.body);

    const product = await Product.findById(productId);
    if (!product) return next(new AppError("Product not found", 404, "NOT_FOUND"));

    const variant = product.variants.find(v => v._id?.toString() === variantId);
    if (!variant) return next(new AppError("Variant not found", 404, "NOT_FOUND"));

    const previousStock = variant.stock;

    if (quantity < 0) {
      if (variant.stock < Math.abs(quantity)) {
        return next(new AppError(`Insufficient stock. Current stock is ${variant.stock}`, 400));
      }
      
      const updated = await Product.findOneAndUpdate(
        { _id: productId, "variants._id": variantId, "variants.stock": { $gte: Math.abs(quantity) } },
        { $inc: { "variants.$.stock": quantity } },
        { returnDocument: 'after' }
      );
      if (!updated) return next(new AppError("Concurrency error: stock changed during adjustment", 409));
    } else {
      const updated = await Product.findOneAndUpdate(
        { _id: productId, "variants._id": variantId },
        { $inc: { "variants.$.stock": quantity } },
        { returnDocument: 'after' }
      );
      if (!updated) return next(new AppError("Error adjusting inventory", 500));
    }

    const updatedProduct = await Product.findById(productId);
    const newStock = updatedProduct!.variants.find(v => v._id?.toString() === variantId)!.stock;

    await InventoryTransaction.create({
      productId,
      variantId,
      quantity,
      type,
      reason
    } as any);

    await AuditLog.create({
      actorId: req.user!.id,
      actorRole: req.user!.role,
      action: "ADMIN_INVENTORY_ADJUSTED",
      entityType: "PRODUCT",
      entityId: productId as any,
      metadata: { variantId, previousStock, adjustment: quantity, newStock, type, reason }
    });

    res.status(200).json({
      success: true,
      message: "Inventory adjusted successfully",
      data: { previousStock, newStock }
    });
  } catch (error) { next(error); }
};

export const getInventoryHistory = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const history = await InventoryTransaction.find({ productId: id })
      .sort({ createdAt: -1 })
      .limit(100);

    // To enrich actor details, we would need to join AuditLogs or store actorId in InventoryTransaction.
    // Since InventoryTransaction lacks actorId (except indirectly), we will fetch AuditLogs directly.
    const auditLogs = await AuditLog.find({ action: "ADMIN_INVENTORY_ADJUSTED", entityId: id })
      .populate("actorId", "name email")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: { transactions: history, auditLogs }
    });
  } catch (error) { next(error); }
};
