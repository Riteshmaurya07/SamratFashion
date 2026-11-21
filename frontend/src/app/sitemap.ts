import { MetadataRoute } from "next";
import { api } from "@/lib/api";
import { getActiveCategories } from "@/lib/catalog";
import { SITE_URL } from "@/lib/seo";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = SITE_URL;
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: now,
      changeFrequency: "daily",
      priority: 1.0,
    },
    {
      url: `${baseUrl}/shop`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: `${baseUrl}/offers`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      url: `${baseUrl}/support`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.6,
    },
    {
      url: `${baseUrl}/terms`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.4,
    },
    {
      url: `${baseUrl}/privacy`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.4,
    },
    {
      url: `${baseUrl}/shipping-returns`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.4,
    },
  ];

  const FALLBACK_PRODUCTS = [
    {
      slug: "classic-mandarin-collar-textured-nehru-jacket",
    },
    {
      slug: "classic-4-pocket-safari-style-modi-jacket",
    },
  ];

  let productRoutes: MetadataRoute.Sitemap = [];
  try {
    const res = await api.get("/catalog/products?limit=100");
    const items = res.data?.data?.items || res.data?.data?.products || [];
    if (Array.isArray(items) && items.length > 0) {
      productRoutes = items
        .filter((p: { slug?: string; name?: string; status?: string }) => {
          if (!p.slug) return false;
          if (p.slug === "testing-product") return false;
          if (p.slug.startsWith("test-")) return false;
          if (p.name && p.name.toLowerCase().includes("testing")) return false;
          if (p.status && p.status !== "ACTIVE") return false;
          return true;
        })
        .map((p: { slug: string; updatedAt?: string; createdAt?: string; images?: string[] }) => ({
          url: `${baseUrl}/shop/${p.slug}`,
          lastModified: p.updatedAt ? new Date(p.updatedAt) : p.createdAt ? new Date(p.createdAt) : now,
          changeFrequency: "daily" as const,
          priority: 0.8,
          images: p.images && p.images.length > 0 ? p.images.slice(0, 5) : undefined,
        }));
    }
  } catch (error) {
    console.warn("Could not fetch catalog products during sitemap generation:", error);
  }

  if (productRoutes.length === 0) {
    productRoutes = FALLBACK_PRODUCTS.map((p) => ({
      url: `${baseUrl}/shop/${p.slug}`,
      lastModified: now,
      changeFrequency: "daily" as const,
      priority: 0.8,
    }));
  }

  let categoryRoutes: MetadataRoute.Sitemap = [];
  try {
    const categories = await getActiveCategories();
    if (Array.isArray(categories)) {
      categoryRoutes = categories
        .filter((c) => {
          const slug = (c.slug || "").toLowerCase();
          const hasProducts = typeof c.productCount !== "number" || c.productCount > 0;
          return (
            Boolean(slug) &&
            hasProducts &&
            !["custom-print", "custom-printing", "bulk-printing", "jersey", "corporate-jersey"].includes(slug)
          );
        })
        .map((c) => ({
          url: `${baseUrl}/shop?category=${encodeURIComponent(c.slug)}`,
          lastModified: c.updatedAt ? new Date(c.updatedAt) : now,
          changeFrequency: "weekly" as const,
          priority: 0.7,
        }));
    }
  } catch (error) {
    console.warn("Could not fetch categories during sitemap generation:", error);
  }

  return [...staticRoutes, ...categoryRoutes, ...productRoutes];
}
