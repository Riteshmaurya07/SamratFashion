import { api } from "@/lib/api";
import { PDPClient } from "@/components/catalog/PDPClient";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

async function getProductBySlug(slug: string) {
  try {
    const res = await api.get(`/catalog/products/${slug}`);
    return res.data.data;
  } catch (error: unknown) {
    if ((error as any).response?.status === 404) {
      return null;
    }
    console.error("Failed to fetch product details", error);
    return null;
  }
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
  const product = await getProductBySlug(resolvedParams.slug);

  if (!product) {
    notFound();
  }

  const colorParam = resolvedSearchParams.color;
  const initialSelectedColor = typeof colorParam === 'string' ? colorParam : undefined;

  const sizeParam = resolvedSearchParams.size;
  const initialSelectedSize = typeof sizeParam === 'string' ? sizeParam : undefined;

  return (
    <main className="flex-grow w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-8 md:py-12">
      <PDPClient product={product} initialSelectedColor={initialSelectedColor} initialSelectedSize={initialSelectedSize} />
    </main>
  );
}
