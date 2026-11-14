import type { Metadata } from "next";
import { api } from "@/lib/api";
import { getActiveCategories } from "@/lib/catalog";
import OffersClient from "@/components/offers/OffersClient";
import { getBreadcrumbJsonLd } from "@/lib/seo";
import { JsonLd } from "@/components/seo/JsonLd";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Special Streetwear Offers, Discounts & Coupons | Samrat Fashion",
  description:
    "Explore exclusive discount codes, seasonal drop offers, and limited-time deals on premium 240+ GSM oversized t-shirts and hoodies in India. Free shipping & COD available.",
  alternates: {
    canonical: "/offers",
  },
  openGraph: {
    title: "Special Streetwear Offers & Discounts | Samrat Fashion",
    description:
      "Save on luxury heavyweight oversized streetwear. Discover active discount coupons, bundle promotions, and seasonal drops.",
    url: "/offers",
    type: "website",
  },
};

async function getActiveCampaigns() {
  try {
    const res = await api.get("/catalog/campaigns/active");
    if (res.data?.success && Array.isArray(res.data.data)) {
      return res.data.data;
    }
    return [];
  } catch (error) {
    console.error("Failed to load active campaigns for offers page:", error);
    return [];
  }
}

async function getBanners() {
  try {
    const res = await api.get("/catalog/banners?position=ALL");
    if (res.data?.success && Array.isArray(res.data.data)) {
      return res.data.data;
    }
    return [];
  } catch (error) {
    console.error("Failed to load banners for offers page:", error);
    return [];
  }
}

export default async function OffersPage() {
  const [campaigns, banners, categories] = await Promise.all([
    getActiveCampaigns(),
    getBanners(),
    getActiveCategories(),
  ]);

  return (
    <>
      <JsonLd
        id="offers-breadcrumbs-jsonld"
        data={getBreadcrumbJsonLd([
          { name: "Home", url: "/" },
          { name: "Offers", url: "/offers" },
        ])}
      />
      <OffersClient
        campaigns={campaigns}
        banners={banners}
        categories={categories}
      />
    </>
  );
}
