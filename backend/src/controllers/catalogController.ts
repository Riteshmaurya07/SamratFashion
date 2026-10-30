import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { Category, CategoryStatus } from "../models/Category";
import { Theme, ThemeStatus } from "../models/Theme";
import { Product, ProductStatus, IProduct } from "../models/Product";

type LeanProduct = IProduct & Required<{ _id: mongoose.Types.ObjectId }> & { __v: number };
import { AppError } from "../utils/AppError";
import { catalogQuerySchema } from "../utils/catalogValidation";

function isInactiveStatus(item: unknown): boolean {
  return typeof item === "object" && item !== null && "status" in item && item.status === CategoryStatus.INACTIVE;
}
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const catalogMemoryCache = new Map<string, CacheEntry<unknown>>();

export function invalidateCatalogCache(prefix?: string) {
  if (prefix) {
    for (const key of catalogMemoryCache.keys()) {
      if (key.startsWith(prefix)) catalogMemoryCache.delete(key);
    }
  } else {
    catalogMemoryCache.clear();
  }
}
function setCacheHeaders(res: Response, value: string): void {
  if (typeof res?.setHeader === "function") {
    res.setHeader("Cache-Control", value);
  }
}

function getFromCache<T>(key: string): T | null {
  const entry = catalogMemoryCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    catalogMemoryCache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setInCache<T>(key: string, data: T, ttlMs = 60000): void {
  catalogMemoryCache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

interface LeanCategoryItem {
  _id: mongoose.Types.ObjectId;
  parentCategory?: { _id: mongoose.Types.ObjectId; status?: CategoryStatus } | mongoose.Types.ObjectId | null;
  [key: string]: unknown;
}

interface LeanThemeItem {
  _id: mongoose.Types.ObjectId;
  [key: string]: unknown;
}

interface AggregationCountItem {
  _id: mongoose.Types.ObjectId | null;
  count: number;
}

export async function getCachedValidActiveCategoryIds(): Promise<mongoose.Types.ObjectId[]> {
  const cached = getFromCache<mongoose.Types.ObjectId[]>("validActiveCategoryIds");
  if (cached) return cached;

  const activeCategories = await Category.find({ status: CategoryStatus.ACTIVE })
    .populate("parentCategory", "status")
    .select("_id parentCategory")
    .lean<LeanCategoryItem[]>();

  const validIds = activeCategories
    .filter((cat) => !isInactiveStatus(cat.parentCategory))
    .map((c) => c._id);

  setInCache("validActiveCategoryIds", validIds, 60000);
  return validIds;
}


export const getCategories = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cached = getFromCache<Array<Record<string, unknown>>>("activeCategories");
    if (cached) {
      setCacheHeaders(res, "public, max-age=60, s-maxage=60, stale-while-revalidate=300");
      return res.status(200).json({ success: true, data: cached });
    }

    const [categories, productCounts] = await Promise.all([
      Category.find({ status: CategoryStatus.ACTIVE })
        .populate("parentCategory", "name slug status")
        .sort({ displayOrder: 1 })
        .lean<LeanCategoryItem[]>(),
      Product.aggregate<AggregationCountItem>([
        { $match: { status: ProductStatus.ACTIVE } },
        { $group: { _id: "$categoryId", count: { $sum: 1 } } }
      ])
    ]);

    // Exclude child categories whose parent is inactive
    const activeCategories = categories.filter((cat) => !isInactiveStatus(cat.parentCategory));
    const countMap = new Map(productCounts.map((item) => [item._id?.toString(), item.count]));

    const categoriesWithCounts = activeCategories.map((cat) => ({
      ...cat,
      productCount: countMap.get(cat._id.toString()) || 0
    }));

    setInCache("activeCategories", categoriesWithCounts, 60000);
    setCacheHeaders(res, "public, max-age=60, s-maxage=60, stale-while-revalidate=300");
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
    const cached = getFromCache<Array<Record<string, unknown>>>("activeThemes");
    if (cached) {
      setCacheHeaders(res, "public, max-age=60, s-maxage=60, stale-while-revalidate=300");
      return res.status(200).json({ success: true, data: cached });
    }

    const [themes, themeProductCounts] = await Promise.all([
      Theme.find({ status: ThemeStatus.ACTIVE }).sort({ displayOrder: 1 }).lean<LeanThemeItem[]>(),
      Product.aggregate<AggregationCountItem>([
        { $match: { status: ProductStatus.ACTIVE } },
        { $unwind: "$themeIds" },
        { $group: { _id: "$themeIds", count: { $sum: 1 } } }
      ])
    ]);

    const countMap = new Map(themeProductCounts.map((item) => [item._id?.toString(), item.count]));

    const themesWithCounts = themes.map((th) => ({
      ...th,
      productCount: countMap.get(th._id.toString()) || 0
    }));

    setInCache("activeThemes", themesWithCounts, 60000);
    setCacheHeaders(res, "public, max-age=60, s-maxage=60, stale-while-revalidate=300");
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
    const cacheKey = `products_${JSON.stringify(query)}`;
    const cached = getFromCache<Record<string, unknown>>(cacheKey);
    if (cached) {
      setCacheHeaders(res, "public, max-age=30, s-maxage=30, stale-while-revalidate=120");
      return res.status(200).json({ success: true, data: cached });
    }
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
      const validActiveCategoryIds = await getCachedValidActiveCategoryIds();
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

    const [products, total] = await Promise.all([
      Product.find(filter)
        .select("-variants.sku -variants.stock") // hide inventory details
        .sort(sortOption)
        .skip(skip)
        .limit(limit)
        .populate("categoryId", "name slug")
        .populate("themeIds", "name slug")
        .lean(),
      Product.countDocuments(filter)
    ]);
    setCacheHeaders(res, "public, max-age=30, s-maxage=30, stale-while-revalidate=120");

    const responseData = {
      items: products,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrevious: page > 1
    };

    setInCache(cacheKey, responseData, 30000);

    res.status(200).json({
      success: true,
      data: responseData
    });
  } catch (error) { next(error); }
};

export const getProductBySlug = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const product = await Product.findOne({ slug: req.params.slug, status: ProductStatus.ACTIVE })
      .populate("categoryId", "name slug status parentCategory")
      .populate("themeIds", "name slug status")
      .lean();
    setCacheHeaders(res, "public, max-age=60, s-maxage=60, stale-while-revalidate=300");

    if (!product) return next(new AppError("Product not found", 404, "NOT_FOUND"));

    // If product category is inactive, hide product from public storefront
    if (isInactiveStatus(product.categoryId)) {
      return next(new AppError("Product not found", 404, "NOT_FOUND"));
    }

    res.status(200).json({ success: true, data: product });
  } catch (error) { next(error); }
};

export const getRecommendedProducts = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const slug = req.params.slug;
    const currentProduct = await Product.findOne({ slug, status: ProductStatus.ACTIVE }).populate("categoryId", "name slug status");
    if (!currentProduct) {
      return next(new AppError("Product not found", 404, "NOT_FOUND"));
    }

    const categoryObj = currentProduct.categoryId;
    const currentCatId = categoryObj && typeof categoryObj === "object" && "_id" in categoryObj
      ? categoryObj._id
      : categoryObj;
    let currentCatSlug = "";
    if (categoryObj && typeof categoryObj === "object" && "slug" in categoryObj && typeof categoryObj.slug === "string") {
      currentCatSlug = categoryObj.slug;
    }
    // Determine complementary category (Coti <-> Kurta)
    let complementaryCatSlug = "";
    if (currentCatSlug === "coti") complementaryCatSlug = "kurta";
    else if (currentCatSlug === "kurta") complementaryCatSlug = "coti";

    let complementaryCat = null;
    if (complementaryCatSlug) {
      complementaryCat = await Category.findOne({ slug: complementaryCatSlug, status: CategoryStatus.ACTIVE });
    }

    // 1. Fetch complementary items (Complete the Look)
    let complementaryProducts: LeanProduct[] = [];
    if (complementaryCat) {
      complementaryProducts = await Product.find({
        _id: { $ne: currentProduct._id },
        categoryId: complementaryCat._id,
        status: ProductStatus.ACTIVE
      })
      .limit(4)
      .sort({ isBestSeller: -1, averageRating: -1 })
      .lean();
    }

    // 2. Fetch same-category items (More in This Category)
    const sameCategoryProducts = await Product.find({
      _id: { $ne: currentProduct._id },
      categoryId: currentCatId,
      status: ProductStatus.ACTIVE
    })
    .limit(4)
    .sort({ isBestSeller: -1, createdAt: -1 })
    .lean();

    // 3. Fallback other active products if needed
    const existingIds = [
      currentProduct._id,
      ...complementaryProducts.map(p => p._id),
      ...sameCategoryProducts.map(p => p._id)
    ];
    let otherProducts: LeanProduct[] = [];
    if (complementaryProducts.length + sameCategoryProducts.length < 4) {
      otherProducts = await Product.find({
        _id: { $nin: existingIds },
        status: ProductStatus.ACTIVE
      })
      .limit(4)
      .sort({ averageRating: -1 })
      .lean();
    }

    const allRecommended = [...complementaryProducts, ...sameCategoryProducts, ...otherProducts].slice(0, 8);

    setCacheHeaders(res, "public, max-age=60, s-maxage=60, stale-while-revalidate=300");
    res.status(200).json({
      success: true,
      data: {
        recommendations: allRecommended,
        pairingTitle: complementaryProducts.length > 0 ? "Complete The Look" : "You Might Also Like",
        total: allRecommended.length
      }
    });
  } catch (error) { next(error); }
};

export const getHomepageCatalog = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cached = getFromCache<Record<string, unknown>>("homepageCatalog");
    if (cached) {
      setCacheHeaders(res, "public, max-age=60, s-maxage=60, stale-while-revalidate=300");
      return res.status(200).json({ success: true, data: cached });
    }

    const validActiveCategoryIds = await getCachedValidActiveCategoryIds();

    const [trending, newArrivals, featuredThemes, categories] = await Promise.all([
      Product.find({ status: ProductStatus.ACTIVE, isBestSeller: true, categoryId: { $in: validActiveCategoryIds } })
        .limit(8)
        .select("name slug images basePrice mrp discount isNewArrival averageRating reviewCount")
        .lean(),
      Product.find({ status: ProductStatus.ACTIVE, isNewArrival: true, categoryId: { $in: validActiveCategoryIds } })
        .limit(8)
        .sort({ createdAt: -1 })
        .select("name slug images basePrice mrp discount averageRating reviewCount")
        .lean(),
      Theme.find({ status: ThemeStatus.ACTIVE, isFeatured: true })
        .limit(6)
        .sort({ displayOrder: 1 })
        .select("name slug thumbnail")
        .lean(),
      Category.find({
        status: CategoryStatus.ACTIVE,
        $or: [{ parentCategory: null }, { parentCategory: { $exists: false } }]
      })
        .sort({ displayOrder: 1, name: 1 })
        .select("name slug image description parentCategory displayOrder")
        .lean(),
    ]);

    const safeCategories = categories.filter((c) => validActiveCategoryIds.some((id) => id.toString() === c._id.toString()));

    const data = {
      trending,
      newArrivals,
      featuredThemes,
      categories: safeCategories
    };

    setInCache("homepageCatalog", data, 60000);
    setCacheHeaders(res, "public, max-age=60, s-maxage=60, stale-while-revalidate=300");
    res.status(200).json({ success: true, data });
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
