import { cache } from "react";
import { serverFetch } from "@/lib/serverApi";
import { DEFAULT_STORE_SETTINGS, StoreSettings } from "@/lib/storeSettingsDefaults";

/**
 * Fetches storefront delivery settings on the server so SSR HTML and initial
 * client hydration render the live configured threshold immediately (no
 * ₹999 -> ₹99 flip after mount).
 */
export const getServerStoreSettings = cache(async function getServerStoreSettings(): Promise<StoreSettings> {
  const res = await serverFetch<{
    success?: boolean;
    data?: Partial<StoreSettings>;
  }>("/store-settings", {
    revalidate: 60,
  });

  const data = res?.data;
  if (
    data &&
    typeof data.freeShippingThreshold === "number" &&
    typeof data.standardShippingFee === "number"
  ) {
    return {
      freeShippingThreshold: data.freeShippingThreshold,
      standardShippingFee: data.standardShippingFee,
    };
  }

  return DEFAULT_STORE_SETTINGS;
});
