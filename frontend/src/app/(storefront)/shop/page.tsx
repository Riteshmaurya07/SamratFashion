import type { Metadata } from "next";
import { api } from "@/lib/api";
import { serverFetch } from "@/lib/serverApi";
import { ShopCatalogLayout } from "@/components/catalog/ShopCatalogLayout";
import { ProductCardProps } from "@/components/catalog/ProductCard";
import { Suspense } from "react";
import { getActiveCategories, getActiveThemes } from "@/lib/catalog";
import { getBreadcrumbJsonLd, getCollectionPageJsonLd } from "@/lib/seo";
import { JsonLd } from "@/components/seo/JsonLd";

export const revalidate = 60;
interface ProductsCacheStore {
  data: unknown;
  expires: number;
}
const productsMemCache = new Map<string, ProductsCacheStore>();
const PRODUCTS_CACHE_TTL = 120_000;


interface ProductsApiResponse {
  success?: boolean;
  data?: {
    items?: RawCatalogProduct[];
    products?: RawCatalogProduct[];
    total?: number;
  };
}

async function getProducts(searchParams: { [key: string]: string | string[] | undefined }) {
  const queryParams: Record<string, string | Array<string>> = {};
  Object.entries(searchParams).forEach(([key, value]) => {
    if (typeof value === "string") queryParams[key] = value;
    else if (Array.isArray(value)) queryParams[key] = value;
  });

  const cacheKey = JSON.stringify(queryParams);
  const cached = productsMemCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return cached.data as ProductsApiResponse;
  }

  const serverData = await serverFetch<ProductsApiResponse>("/catalog/products", {
    params: queryParams,
    revalidate: 60,
  });

  if (serverData?.data) {
    productsMemCache.set(cacheKey, { data: serverData, expires: Date.now() + PRODUCTS_CACHE_TTL });
    return serverData;
  }

  try {
    const params = new URLSearchParams();
    Object.entries(queryParams).forEach(([k, v]) => {
      if (Array.isArray(v)) v.forEach((val) => params.append(k, val));
      else params.append(k, v);
    });
    const res = await api.get("/catalog/products", { params });
    productsMemCache.set(cacheKey, { data: res.data, expires: Date.now() + PRODUCTS_CACHE_TTL });
    return res.data;
  } catch (error) {
    console.error("Failed to fetch products", error);
    return { data: { items: [], total: 0 } };
  }
}

import { ShopSearchTracker } from "@/components/catalog/ShopSearchTracker";
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}): Promise<Metadata> {
  const resolvedSearchParams = (await searchParams) || {};
  const cat = typeof resolvedSearchParams.category === "string" ? resolvedSearchParams.category : "";
  const theme = typeof resolvedSearchParams.theme === "string" ? resolvedSearchParams.theme : "";
  const q = typeof resolvedSearchParams.search === "string" ? resolvedSearchParams.search : typeof resolvedSearchParams.q === "string" ? resolvedSearchParams.q : "";

  let title = "Shop Oversized Streetwear & Graphic Tees | Samrat Fashion";
  let description =
    "Explore premium oversized t-shirts, hoodies, acid wash tees, and luxury urban streetwear in India. Heavyweight 240+ GSM combed cotton, PAN India delivery & COD.";

  if (cat) {
    const formattedCat = cat.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    title = `${formattedCat} Streetwear Collection | Samrat Fashion`;
    description = `Shop the latest ${formattedCat} collection online at Samrat Fashion India. Premium heavyweight fabrics, custom graphics, and fast express shipping.`;
  } else if (theme) {
    const formattedTheme = theme.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    title = `${formattedTheme} Drops | Streetwear | Samrat Fashion`;
    description = `Discover ${formattedTheme} drops engineered in heavyweight cotton. Authentic urban streetwear with express delivery across India.`;
  } else if (q) {
    title = `Search results for "${q}" | Samrat Fashion`;
    description = `Browse results for "${q}" across our premium oversized streetwear catalog.`;
  }

  return {
    title,
    description,
    alternates: {
      canonical: "/shop",
    },
    openGraph: {
      title,
      description,
      url: "/shop",
      type: "website",
    },
  };
}


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
      <JsonLd
        id="shop-breadcrumbs-jsonld"
        data={getBreadcrumbJsonLd([
          { name: "Home", url: "/" },
          { name: "Shop", url: "/shop" },
        ])}
      />
      <JsonLd
        id="shop-collection-jsonld"
        data={getCollectionPageJsonLd(
          "Streetwear Drops & Oversized Apparel",
          "Heavyweight oversized t-shirts, hoodies, and streetwear essentials engineered for urban street culture.",
          "/shop"
        )}
      />
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
