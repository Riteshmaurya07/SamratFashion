import CustomPrintingClient from "@/components/custom-printing/CustomPrintingClient";

export const dynamic = "force-dynamic";

async function getBlankProducts() {
  try {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";
    const res = await fetch(`${apiUrl}/catalog/products?limit=10`, {
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.data?.products || [];
  } catch (error) {
    console.error("Failed to fetch blank products for Custom Designer:", error);
    return [];
  }
}

export const metadata = {
  title: "Custom T-Shirt Designer | SamratFashion",
  description: "Create, save, and order a custom graphic T-shirt with the SamratFashion design studio.",
};

export default async function CustomDesignerPage() {
  const initialProducts = await getBlankProducts();

  return <CustomPrintingClient initialProducts={initialProducts} />;
}
