import React from "react";
import { getProductBySlug } from "./page";
import { getProductJsonLd, getBreadcrumbJsonLd, getFaqPageJsonLd, getProductFaqs } from "@/lib/seo";
import { JsonLd } from "@/components/seo/JsonLd";

export default async function ProductLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);

  if (!product) {
    return <>{children}</>;
  }

  const isAvailable =
    product.status === "ACTIVE" &&
    (Array.isArray(product.variants) && product.variants.length > 0
      ? product.variants.some(
          (v: { isAvailable?: boolean; stock?: number }) =>
            v.isAvailable !== false && (v.stock === undefined || v.stock > 0)
        )
      : product.isAvailable !== false);

  return (
    <>
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
          isAvailable,
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
      <JsonLd
        id="product-faq-jsonld"
        data={getFaqPageJsonLd(getProductFaqs(product))}
      />
      {children}
    </>
  );
}
