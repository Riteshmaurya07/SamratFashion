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
  ];

  let productRoutes: MetadataRoute.Sitemap = [];
  try {
    const res = await api.get("/catalog/products?limit=250");
    const items = res.data?.data?.items || res.data?.data?.products || [];
    if (Array.isArray(items)) {
      productRoutes = items
        .filter((p: { slug?: string }) => Boolean(p.slug))
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

  let categoryRoutes: MetadataRoute.Sitemap = [];
  try {
    const categories = await getActiveCategories();
    if (Array.isArray(categories)) {
      categoryRoutes = categories
        .filter((c) => {
          const slug = (c.slug || "").toLowerCase();
          return (
            Boolean(slug) &&
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
