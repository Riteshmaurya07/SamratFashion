import { api } from "@/lib/api";
import { notFound } from "next/navigation";
import CustomPrintCatalogDetailClient from "@/components/custom-printing/CustomPrintCatalogDetailClient";

export const dynamic = "force-dynamic";

async function getCatalogItemBySlug(slug: string) {
  try {
    const res = await api.get(`/custom-print-catalog/${slug}`);
    if (res.data?.success && res.data.data) {
      return res.data.data;
    }
  } catch (error: unknown) {
    console.warn(`[Catalog] Custom print catalog lookup for ${slug} returned 404 or error:`, error);
  }
  return null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    const item = await getCatalogItemBySlug(slug);
    if (!item) return { title: "Custom Garment Not Found | SamratFashion" };
    return {
      title: `${item.name} | Custom Printing | SamratFashion`,
      description: item.description || `Custom ${item.name} — upload your logo and request bulk printing from SamratFashion.`,
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
