import { api } from "@/lib/api";
import { notFound } from "next/navigation";
import CustomPrintCatalogDetailClient from "@/components/custom-printing/CustomPrintCatalogDetailClient";

export const dynamic = "force-dynamic";

async function getCatalogItemBySlug(slug: string) {
  try {
    const res = await api.get(`/custom-print-catalog/${slug}`);
    return res.data.data;
  } catch (error: unknown) {
    if ((error as { response?: { status?: number } }).response?.status === 404) return null;
    console.error("Failed to fetch catalog item", error);
    throw new Error("Failed to fetch catalog item");
  }
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
