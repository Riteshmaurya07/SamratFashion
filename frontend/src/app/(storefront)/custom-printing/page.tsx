import React from "react";
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
    console.error("Failed to fetch blank products for Custom Printing:", error);
    return [];
  }
}

export const metadata = {
  title: "Custom T-Shirt Printing & Studio Designer | SamratFashion",
  description: "Design your custom oversized graphic T-shirts with HD printing on premium 100% cotton blanks. Live studio editor & fast delivery across India.",
};

export default async function CustomPrintingPage() {
  const initialProducts = await getBlankProducts();

  return <CustomPrintingClient initialProducts={initialProducts} />;
}
