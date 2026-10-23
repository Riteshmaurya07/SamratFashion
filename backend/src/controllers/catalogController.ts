import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { Category, CategoryStatus } from "../models/Category";
import { Theme, ThemeStatus } from "../models/Theme";
import { Product, ProductStatus } from "../models/Product";
import { AppError } from "../utils/AppError";
import { catalogQuerySchema } from "../utils/catalogValidation";

function isInactiveStatus(item: unknown): boolean {
  return typeof item === "object" && item !== null && "status" in item && item.status === CategoryStatus.INACTIVE;
}

export const getCategories = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const categories = await Category.find({ status: CategoryStatus.ACTIVE })
      .populate("parentCategory", "name slug status")
      .sort({ displayOrder: 1 });

    // Exclude child categories whose parent is inactive
    const activeCategories = categories.filter(cat => !isInactiveStatus(cat.parentCategory));

    const productCounts = await Product.aggregate([
      { $match: { status: ProductStatus.ACTIVE } },
      { $group: { _id: "$categoryId", count: { $sum: 1 } } }
    ]);

    const countMap = new Map(productCounts.map(item => [item._id?.toString(), item.count]));

    const categoriesWithCounts = activeCategories.map(cat => {
      const obj = cat.toObject();
      return {
        ...obj,
        productCount: countMap.get(cat._id.toString()) || 0
      };
    });

    res.status(200).json({ success: true, data: categoriesWithCounts });
  } catch (error) { next(error); }
};

export const getCategoryBySlug = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawSlug = typeof req.params.slug === "string" ? req.params.slug : Array.isArray(req.params.slug) ? req.params.slug[0] : "";
    const slugParam = (rawSlug || "").toLowerCase().trim();
    const category = await Category.findOne({ slug: slugParam, status: CategoryStatus.ACTIVE })
      .populate("parentCategory", "name slug status");
    if (!category || isInactiveStatus(category.parentCategory)) {
      return next(new AppError("Category not found", 404, "NOT_FOUND"));
    }

    res.status(200).json({ success: true, data: category });
  } catch (error) { next(error); }
};

export const getThemes = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const themes = await Theme.find({ status: ThemeStatus.ACTIVE }).sort({ displayOrder: 1 });

    const themeProductCounts = await Product.aggregate([
      { $match: { status: ProductStatus.ACTIVE } },
      { $unwind: "$themeIds" },
      { $group: { _id: "$themeIds", count: { $sum: 1 } } }
    ]);
    const countMap = new Map(themeProductCounts.map(item => [item._id?.toString(), item.count]));

    const themesWithCounts = themes.map(th => ({
      ...th.toObject(),
      productCount: countMap.get(th._id.toString()) || 0
    }));

    res.status(200).json({ success: true, data: themesWithCounts });
  } catch (error) { next(error); }
};

export const getThemeBySlug = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rawSlug = typeof req.params.slug === "string" ? req.params.slug : Array.isArray(req.params.slug) ? req.params.slug[0] : "";
    const slugParam = (rawSlug || "").toLowerCase().trim();
    const theme = await Theme.findOne({ slug: slugParam, status: ThemeStatus.ACTIVE });
    if (!theme) return next(new AppError("Theme not found", 404, "NOT_FOUND"));
    res.status(200).json({ success: true, data: theme });
  } catch (error) { next(error); }
};
export const getProducts = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = catalogQuerySchema.parse(req.query);
    const page = query.page || 1;
    const limit = query.limit || 24;
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = { status: ProductStatus.ACTIVE };

    // Search (Case-insensitive, partial multi-word keyword match over name, description, tags, slug)
    const searchVal = (query.search || query.q || "").trim();
    if (searchVal) {
      const safeQuery = searchVal.slice(0, 100);
      const tokens = safeQuery.split(/\s+/).filter(Boolean);

      if (tokens.length > 0) {
        const tokenConditions = tokens.map(token => {
          const sanitized = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const searchRegex = new RegExp(sanitized, "i");
          return {
            $or: [
              { name: searchRegex },
              { description: searchRegex },
              { tags: searchRegex },
              { slug: searchRegex }
            ]
          };
        });

        const existingAnd = Array.isArray(filter.$and) ? (filter.$and as Array<Record<string, unknown>>) : [];
        filter.$and = [...existingAnd, ...tokenConditions];
      }
    }

    // Category filter
    if (query.category) {
      const trimmedCat = query.category.trim();
      const category = await Category.findOne({
        status: CategoryStatus.ACTIVE,
        $or: [
          { slug: trimmedCat.toLowerCase() },
          { name: { $regex: new RegExp(`^${trimmedCat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") } }
        ]
      }).populate("parentCategory", "name slug status");

      if (!category || isInactiveStatus(category.parentCategory)) {
        // Unknown, inactive, or orphaned category must not return the entire catalog
        filter.categoryId = new mongoose.Types.ObjectId();
      } else {
        // Collect canonical category ID and active descendant category IDs
        const descendantIds = [category._id];
        let currentLevel = [category._id];
        while (currentLevel.length > 0) {
          const children = await Category.find({
            parentCategory: { $in: currentLevel },
            status: CategoryStatus.ACTIVE
          }).select("_id");
          if (children.length === 0) break;
          const childIds = children.map(c => c._id);
          descendantIds.push(...childIds);
          currentLevel = childIds;
        }
        filter.categoryId = { $in: descendantIds };
      }
    } else {
      // General catalog: only include products from active categories
      const activeCategories = await Category.find({ status: CategoryStatus.ACTIVE })
        .populate("parentCategory", "status")
        .select("_id parentCategory");

      const validActiveCategoryIds = activeCategories
        .filter(cat => !isInactiveStatus(cat.parentCategory))
        .map(c => c._id);

      filter.categoryId = { $in: validActiveCategoryIds };
    }

    // Theme filter
    if (query.theme) {
      const theme = await Theme.findOne({ slug: query.theme.toLowerCase().trim(), status: ThemeStatus.ACTIVE });
      if (theme) {
        filter.themeIds = theme._id;
      } else {
        // Unknown or inactive theme must not return the entire catalog
        filter.themeIds = new mongoose.Types.ObjectId();
      }
    }
    // Max Price filter
    if (query.maxPrice && !isNaN(Number(query.maxPrice))) {
      filter.basePrice = { $lte: Number(query.maxPrice) };
    }

    // Size filter
    if (query.size) {
      filter["variants.size"] = query.size.toUpperCase();
    }

    // Sorting
    let sortOption: any = { createdAt: -1 };
    if (query.sort === "price_asc" || query.sort === "basePrice") sortOption = { basePrice: 1 };
    if (query.sort === "price_desc" || query.sort === "-basePrice") sortOption = { basePrice: -1 };
    if (query.sort === "-createdAt" || query.sort === "newest") sortOption = { createdAt: -1 };
    if (query.sort === "-averageRating") sortOption = { averageRating: -1 };

    const products = await Product.find(filter)
      .select("-variants.sku -variants.stock") // hide inventory details
      .sort(sortOption)
      .skip(skip)
      .limit(limit)
      .populate("categoryId", "name slug")
      .populate("themeIds", "name slug");

    const total = await Product.countDocuments(filter);

    res.status(200).json({
      success: true,
      data: {
        items: products,
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNext: page * limit < total,
        hasPrevious: page > 1
      }
    });
  } catch (error) { next(error); }
};

export const getProductBySlug = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const product = await Product.findOne({ slug: req.params.slug, status: ProductStatus.ACTIVE })
      .populate("categoryId", "name slug status parentCategory")
      .populate("themeIds", "name slug status");

    if (!product) return next(new AppError("Product not found", 404, "NOT_FOUND"));

    // If product category is inactive, hide product from public storefront
    if (isInactiveStatus(product.categoryId)) {
      return next(new AppError("Product not found", 404, "NOT_FOUND"));
    }

    res.status(200).json({ success: true, data: product });
  } catch (error) { next(error); }
};

export const getHomepageCatalog = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const activeCategories = await Category.find({ status: CategoryStatus.ACTIVE })
      .populate("parentCategory", "status")
      .select("_id parentCategory");

    const validActiveCategoryIds = activeCategories
      .filter(cat => !isInactiveStatus(cat.parentCategory))
      .map(c => c._id);

    const [trending, newArrivals, featuredThemes, categories] = await Promise.all([
      Product.find({ status: ProductStatus.ACTIVE, isBestSeller: true, categoryId: { $in: validActiveCategoryIds } })
        .limit(8)
        .select("name slug images basePrice mrp discount isNewArrival averageRating reviewCount"),
      Product.find({ status: ProductStatus.ACTIVE, isNewArrival: true, categoryId: { $in: validActiveCategoryIds } })
        .limit(8)
        .sort({ createdAt: -1 })
        .select("name slug images basePrice mrp discount averageRating reviewCount"),
      Theme.find({ status: ThemeStatus.ACTIVE, isFeatured: true })
        .limit(6)
        .sort({ displayOrder: 1 })
        .select("name slug thumbnail"),
      Category.find({ status: CategoryStatus.ACTIVE })
        .limit(8)
        .sort({ displayOrder: 1 })
        .select("name slug image description parentCategory displayOrder")
    ]);

    const safeCategories = categories.filter(c => validActiveCategoryIds.some(id => id.toString() === c._id.toString()));

    res.status(200).json({
      success: true,
      data: {
        trending,
        newArrivals,
        featuredThemes,
        categories: safeCategories
      }
    });
  } catch (error) { next(error); }
};

export const getCustomizableProducts = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const products = await Product.find({
      status: ProductStatus.ACTIVE,
      isCustomizable: true,
    }).sort({ isFeatured: -1, createdAt: -1 });


    res.status(200).json({
      success: true,
      data: products,
    });
  } catch (error) {
    next(error);
  }
};
