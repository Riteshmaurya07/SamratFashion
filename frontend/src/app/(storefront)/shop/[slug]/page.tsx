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
    throw new Error("Failed to fetch product details");
  }
}

export default async function ProductPage({
  params,
}: {
  params: { slug: string };
}) {
  const product = await getProductBySlug(params.slug);

  if (!product) {
    notFound();
  }

  return (
    <main className="flex-grow w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-8 md:py-12">
      <PDPClient product={product} />
    </main>
  );
}
