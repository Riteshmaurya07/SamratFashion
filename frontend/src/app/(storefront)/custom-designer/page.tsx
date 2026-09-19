import CustomPrintingClient from "@/components/custom-printing/CustomPrintingClient";

export const dynamic = "force-dynamic";

async function getBlankProducts() {
  try {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";
    const resCustom = await fetch(`${apiUrl}/catalog/customizable-products`, {
      cache: "no-store",
    });
    if (resCustom.ok) {
      const data = await resCustom.json();
      if (Array.isArray(data.data) && data.data.length > 0) {
        return data.data;
      }
    }

    const res = await fetch(`${apiUrl}/catalog/products?limit=10`, {
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.data?.items || data.data?.products || (Array.isArray(data.data) ? data.data : []);
  } catch (error) {
    console.error("Failed to fetch blank products for Custom Designer:", error);
    return [];
  }
}

export const metadata = {
  title: "Custom T-Shirt Designer | SamratFashion",
  description: "Upload your design file, select garment size & color, and order a custom printed T-shirt with manual mockup approval.",
};

export default async function CustomDesignerPage() {
  const initialProducts = await getBlankProducts();

  return <CustomPrintingClient initialProducts={initialProducts} />;
}

