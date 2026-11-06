import { api } from "@/lib/api";
import { ShopCatalogLayout } from "@/components/catalog/ShopCatalogLayout";
import { ProductCardProps } from "@/components/catalog/ProductCard";
import { Suspense } from "react";
import { getActiveCategories, getActiveThemes } from "@/lib/catalog";
export const dynamic = "force-dynamic";
interface ProductsCacheStore {
  data: unknown;
  expires: number;
}
const productsMemCache = new Map<string, ProductsCacheStore>();
const PRODUCTS_CACHE_TTL = 30_000;


async function getProducts(searchParams: { [key: string]: string | string[] | undefined }) {
  try {
    const params = new URLSearchParams();

    // Convert Next.js searchParams object to URLSearchParams for axios
    Object.entries(searchParams).forEach(([key, value]) => {
      if (typeof value === "string") {
        params.append(key, value);
      } else if (Array.isArray(value)) {
        value.forEach(v => params.append(key, v));
      }
    });

    const cacheKey = params.toString();
    const cached = productsMemCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
      return cached.data;
    }

    const res = await api.get("/catalog/products", { params });
    const data = res.data;
    productsMemCache.set(cacheKey, { data, expires: Date.now() + PRODUCTS_CACHE_TTL });
    return data;
  } catch (error) {
    console.error("Failed to fetch products", error);
    return { data: { items: [], total: 0 } };
  }
}

import { ShopSearchTracker } from "@/components/catalog/ShopSearchTracker";

interface CatalogVariantItem {
  _id?: string;
  sku?: string;
  color?: string;
  hexCode?: string;
  images?: string[];
  size?: string;
}

interface RawCatalogProduct extends Omit<ProductCardProps, "variants"> {
  variants?: CatalogVariantItem[];
}

export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const resolvedSearchParams = (await searchParams) || {};
  const [resData, categories, themes] = await Promise.all([
    getProducts(resolvedSearchParams),
    getActiveCategories(),
    getActiveThemes(),
  ]);
  const rawProducts = (resData?.data?.items || resData?.data?.products || []) as RawCatalogProduct[];
  const rawTotal = typeof resData?.data?.total === "number" ? resData.data.total : 0;

  // Expand products by unique colorway so each colorway gets its own dedicated card in All Drops
  const products: ProductCardProps[] = rawProducts.flatMap((p: RawCatalogProduct) => {
    const variants = Array.isArray(p.variants) ? p.variants : [];
    const uniqueColorsMap = new Map<string, { color: string; hexCode?: string; images: string[]; variantId?: string }>();
    variants.forEach((v: CatalogVariantItem) => {
      const c = (v.color || "").trim();
      if (!c) return;
      const key = c.toLowerCase();
      const vId = v._id ? String(v._id) : v.sku;
      if (!uniqueColorsMap.has(key)) {
        uniqueColorsMap.set(key, {
          color: c,
          hexCode: v.hexCode,
          images: Array.isArray(v.images) && v.images.length > 0 ? v.images : [],
          variantId: vId,
        });
      } else {
        const existing = uniqueColorsMap.get(key)!;
        if ((!existing.images || existing.images.length === 0) && Array.isArray(v.images) && v.images.length > 0) {
          existing.images = v.images;
        }
        if (!existing.variantId && vId) {
          existing.variantId = vId;
        }
      }
    });
    const uniqueColors = Array.from(uniqueColorsMap.values());
    const validVariants = variants
      .filter((v): v is { color: string; hexCode?: string } => typeof v.color === "string" && v.color.trim().length > 0)
      .map((v) => ({ color: v.color.trim(), hexCode: v.hexCode }));

    // If product has 0 or 1 colorway, output standard single card
    if (uniqueColors.length <= 1) {
      const singleColor = uniqueColors[0];
      const singleVariantId = singleColor?.variantId || (variants[0]?._id ? String(variants[0]._id) : variants[0]?.sku);
      return [{
        ...p,
        _id: p._id,
        productId: p._id,
        cardKey: p._id,
        selectedColor: singleColor?.color,
        selectedColorHex: singleColor?.hexCode,
        variantId: singleVariantId,
        images: singleColor?.images?.length ? singleColor.images : p.images,
        variants: validVariants,
      }];
    }

    // If product has 2+ distinct colors, expand into dedicated cards per colorway
    return uniqueColors.map((uc) => {
      const colorImages = uc.images && uc.images.length > 0 ? uc.images : p.images;
      return {
        ...p,
        _id: p._id,
        productId: p._id,
        cardKey: `${p._id}-${uc.color.replace(/\s+/g, "-")}`,
        name: p.name,
        selectedColor: uc.color,
        selectedColorHex: uc.hexCode,
        variantId: uc.variantId,
        images: colorImages,
        variants: validVariants,
      };
    });
  });

  const total = products.length > rawProducts.length ? products.length : rawTotal;
  const activeQuery = typeof resolvedSearchParams.search === "string" ? resolvedSearchParams.search : typeof resolvedSearchParams.q === "string" ? resolvedSearchParams.q : "";
  const currentSort = typeof resolvedSearchParams.sort === "string" ? resolvedSearchParams.sort : "";

  return (
    <main className="flex-grow w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop pt-3 sm:pt-5 md:pt-8 pb-28 lg:pb-12">
      <ShopSearchTracker query={activeQuery} totalResults={total} />
      <Suspense fallback={<div className="h-96 w-full animate-pulse bg-surface-container-low rounded-2xl" />}>
        <ShopCatalogLayout
          products={products}
          total={total}
          currentSort={currentSort}
          activeQuery={activeQuery}
          categories={categories}
          themes={themes}
        />
      </Suspense>
    </main>
  );
}
