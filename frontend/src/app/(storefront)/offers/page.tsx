import { api } from "@/lib/api";
import { getActiveCategories } from "@/lib/catalog";
import OffersClient from "@/components/offers/OffersClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Special Offers & Deals | SamratFashion",
  description: "Browse current discount vouchers, promotional campaigns, and limited-time streetwear sales on heavyweight 240+ GSM apparel.",
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
    <OffersClient
      campaigns={campaigns}
      banners={banners}
      categories={categories}
    />
  );
}
