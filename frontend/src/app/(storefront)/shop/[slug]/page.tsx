import type { Metadata } from "next";
import { api } from "@/lib/api";
import { PDPClient } from "@/components/catalog/PDPClient";
import { notFound } from "next/navigation";
import { SITE_URL, GEO_METADATA_OTHER, getBreadcrumbJsonLd, getProductJsonLd } from "@/lib/seo";
import { JsonLd } from "@/components/seo/JsonLd";

export const revalidate = 60;

interface RecommendationsData {
  recommendations: Array<{
    _id: string;
    slug: string;
    name: string;
    images: string[];
    basePrice: number;
    mrp?: number;
    discount?: number;
    averageRating?: number;
    reviewCount?: number;
    isNewArrival?: boolean;
    isBestSeller?: boolean;
    tags?: string[];
    variants?: Array<{
      color: string;
      hexCode?: string;
    }>;
  }>;
  pairingTitle?: string;
  total?: number;
}

async function getProductBySlug(slug: string) {
  try {
    const res = await api.get(`/catalog/products/${slug}`);
    return res.data.data;
  } catch (error: unknown) {
    if (error && typeof error === "object" && "response" in error) {
      const resp = error.response;
      if (resp && typeof resp === "object" && "status" in resp && resp.status === 404) {
        return null;
      }
    }
    console.error("Failed to fetch product details", error);
    return null;
  }
}

async function getRecommendations(slug: string): Promise<RecommendationsData | null> {
  try {
    const res = await api.get(`/catalog/products/${slug}/recommendations`);
    return res.data?.data || null;
  } catch (error: unknown) {
    console.error("Failed to fetch product recommendations", error);
    return null;
  }
}
export async function generateStaticParams() {
  try {
    const res = await api.get("/catalog/products?limit=50");
    const items = res.data?.data?.items || res.data?.data?.products || [];
    return items.map((p: { slug: string }) => ({ slug: p.slug }));
  } catch {
    return [];
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);

  if (!product) {
    return {
      title: "Product Not Found | Samrat Fashion",
      robots: { index: false, follow: false },
    };
  }

  const cleanDesc = (product.seo?.description || product.description || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);

  const title = product.seo?.title || `${product.name} | THREADVIBE by Samrat Fashion`;
  const description =
    cleanDesc ||
    `Buy ${product.name} at Samrat Fashion India. Heavyweight 240+ GSM oversized streetwear, cash on delivery & express PAN India shipping.`;

  const primaryImage = product.images?.[0] || `${SITE_URL}/og-image.jpg`;

  return {
    title,
    description,
    alternates: {
      canonical: `/shop/${product.slug}`,
    },
    openGraph: {
      title,
      description,
      url: `/shop/${product.slug}`,
      type: "article",
      images: [
        {
          url: primaryImage,
          width: 1000,
          height: 1250,
          alt: product.name,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [primaryImage],
    },
    other: {
      ...GEO_METADATA_OTHER,
      "product:price:amount": String(product.basePrice),
      "product:price:currency": "INR",
      "product:availability": product.status === "ACTIVE" ? "in stock" : "out of stock",
    },
  };
}


export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const resolvedParams = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};

  const [product, recData] = await Promise.all([
    getProductBySlug(resolvedParams.slug),
    getRecommendations(resolvedParams.slug),
  ]);

  if (!product) {
    notFound();
  }

  const colorParam = resolvedSearchParams.color;
  const initialSelectedColor = typeof colorParam === "string" ? colorParam : undefined;

  const sizeParam = resolvedSearchParams.size;
  const initialSelectedSize = typeof sizeParam === "string" ? sizeParam : undefined;

  return (
    <main className="flex-grow w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop pt-4 sm:pt-6 md:pt-8 pb-20 lg:pb-12">
      <JsonLd
        id="product-jsonld"
        data={getProductJsonLd({
          name: product.name,
          slug: product.slug,
          description: product.description,
          images: product.images,
          basePrice: product.basePrice,
          mrp: product.mrp,
          sku: product.variants?.[0]?.sku || product.slug,
          categoryName: product.categoryId?.name,
          averageRating: product.averageRating,
          reviewCount: product.reviewCount,
        })}
      />
      <JsonLd
        id="product-breadcrumbs-jsonld"
        data={getBreadcrumbJsonLd([
          { name: "Home", url: "/" },
          { name: "Shop", url: "/shop" },
          ...(product.categoryId?.name
            ? [{ name: product.categoryId.name, url: `/shop?category=${product.categoryId.slug}` }]
            : []),
          { name: product.name, url: `/shop/${product.slug}` },
        ])}
      />
      <PDPClient
        product={product}
        initialSelectedColor={initialSelectedColor}
        initialSelectedSize={initialSelectedSize}
        initialRecommendations={recData?.recommendations || []}
        initialRecommendationTitle={recData?.pairingTitle}
      />
    </main>
  );
}
