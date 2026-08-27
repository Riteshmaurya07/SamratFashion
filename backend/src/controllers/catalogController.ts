import { Request, Response, NextFunction } from "express";
import { Category, CategoryStatus } from "../models/Category";
import { Theme, ThemeStatus } from "../models/Theme";
import { Product, ProductStatus } from "../models/Product";
import { AppError } from "../utils/AppError";
import { catalogQuerySchema } from "../utils/catalogValidation";

export const getCategories = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const categories = await Category.find({ status: CategoryStatus.ACTIVE }).sort({ displayOrder: 1 });
    res.status(200).json({ success: true, data: categories });
  } catch (error) { next(error); }
};

export const getCategoryBySlug = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const category = await Category.findOne({ slug: req.params.slug, status: CategoryStatus.ACTIVE });
    if (!category) return next(new AppError("Category not found", 404, "NOT_FOUND"));
    res.status(200).json({ success: true, data: category });
  } catch (error) { next(error); }
};

export const getThemes = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const themes = await Theme.find({ status: ThemeStatus.ACTIVE }).sort({ displayOrder: 1 });
    res.status(200).json({ success: true, data: themes });
  } catch (error) { next(error); }
};

export const getThemeBySlug = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const theme = await Theme.findOne({ slug: req.params.slug, status: ThemeStatus.ACTIVE });
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

    const filter: any = { status: ProductStatus.ACTIVE };

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

        filter.$and = filter.$and || [];
        filter.$and.push(...tokenConditions);
      }
    }

    // Category filter
    if (query.category) {
      const category = await Category.findOne({ 
        $or: [
          { slug: query.category.toLowerCase() },
          { name: { $regex: new RegExp(`^${query.category.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") } }
        ]
      });
      if (category) filter.categoryId = category._id;
    }

    // Theme filter
    if (query.theme) {
      const theme = await Theme.findOne({ slug: query.theme.toLowerCase() });
      if (theme) filter.themeIds = theme._id;
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
      .populate("categoryId", "name slug")
      .populate("themeIds", "name slug");

    if (!product) return next(new AppError("Product not found", 404, "NOT_FOUND"));
    res.status(200).json({ success: true, data: product });
  } catch (error) { next(error); }
};

export const getHomepageCatalog = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Derive standard homepage sections commonly required by premium themes:
    // Trending (Best Sellers), New Arrivals, Featured Themes, Categories
    const [trending, newArrivals, featuredThemes, categories] = await Promise.all([
      Product.find({ status: ProductStatus.ACTIVE, isBestSeller: true })
        .limit(8)
        .select("name slug images basePrice mrp discount isNewArrival"),
      Product.find({ status: ProductStatus.ACTIVE, isNewArrival: true })
        .limit(8)
        .sort({ createdAt: -1 })
        .select("name slug images basePrice mrp discount"),
      Theme.find({ status: ThemeStatus.ACTIVE, isFeatured: true })
        .limit(6)
        .sort({ displayOrder: 1 })
        .select("name slug thumbnail"),
      Category.find({ status: CategoryStatus.ACTIVE })
        .limit(8)
        .sort({ displayOrder: 1 })
        .select("name slug image")
    ]);

    res.status(200).json({
      success: true,
      data: {
        trending,
        newArrivals,
        featuredThemes,
        categories
      }
    });
  } catch (error) { next(error); }
};

export const getCustomizableProducts = async (req: Request, res: Response, next: NextFunction) => {
  try {
    let products = await Product.find({
      status: ProductStatus.ACTIVE,
      isCustomizable: true,
    }).sort({ isFeatured: -1, createdAt: -1 });

    // Fallback if no products have isCustomizable: true explicitly set in DB yet
    if (products.length === 0) {
      products = await Product.find({ status: ProductStatus.ACTIVE }).limit(10);
    }

    res.status(200).json({
      success: true,
      data: products,
    });
  } catch (error) {
    next(error);
  }
};
