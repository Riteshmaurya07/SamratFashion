"use client";

import ProductForm from "@/components/admin/ProductForm";
import { useParams } from "next/navigation";

export default function EditProductPage() {
  const params = useParams();
  return <ProductForm productId={params.id as string} />;
}
