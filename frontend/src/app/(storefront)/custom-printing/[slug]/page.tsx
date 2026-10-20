import { api } from "@/lib/api";
import { notFound } from "next/navigation";
import CustomPrintCatalogDetailClient from "@/components/custom-printing/CustomPrintCatalogDetailClient";
import { ALL_CUSTOM_CATALOG_ITEMS } from "@/lib/customPrintCatalogData";

export const dynamic = "force-dynamic";

async function getCatalogItemBySlug(slug: string) {
  try {
    const res = await api.get(`/custom-print-catalog/${slug}`);
    if (res.data?.data) return res.data.data;
  } catch (error: unknown) {
    console.warn(`[Catalog] Custom print catalog lookup for ${slug} failed, checking live products`, error);
  }

  try {
    const prodRes = await api.get(`/catalog/products/${slug}`);
    if (prodRes.data?.data) {
      const prod = prodRes.data.data;
      return {
        _id: prod._id,
        name: prod.name,
        slug: prod.slug,
        description: prod.description,
        mockupImageUrl: prod.images?.[0] || "/images/custom_polo_blue_mockup.png",
        displayPrice: prod.basePrice,
        isActive: prod.status === "ACTIVE",
        category: typeof prod.categoryId === "object" && prod.categoryId !== null ? prod.categoryId.name : "Custom Apparel",
        productId: prod,
        placementTemplateId: {
          _id: "placement-chest",
          name: "Front Chest Logo",
          code: "FRONT_CHEST",
          side: "FRONT",
          previewConfig: { x: 35, y: 35, width: 30, height: 25 },
        },
      };
    }
  } catch (error: unknown) {
    console.warn(`[Catalog] Product lookup for ${slug} failed, checking display fallback`, error);
  }

  const fallback = ALL_CUSTOM_CATALOG_ITEMS.find((item) => item.slug === slug);
  return fallback || null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const item = await getCatalogItemBySlug(slug);
    if (!item) return { title: "Not Found" };
    return {
      title: `${item.name} | Custom Printing | SamratFashion`,
      description: item.description || `Custom ${item.name} — upload your logo and request a custom print from SamratFashion.`,
    };
  } catch {
    return { title: "Custom Printing | SamratFashion" };
  }
}

export default async function CustomPrintCatalogDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const item = await getCatalogItemBySlug(slug);
  if (!item) notFound();

  return <CustomPrintCatalogDetailClient item={item} />;
}
