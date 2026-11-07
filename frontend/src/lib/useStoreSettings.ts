"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export interface StoreSettings {
  freeShippingThreshold: number;
  standardShippingFee: number;
}

/**
 * Fallback values match the backend defaults so the first paint is stable even
 * when the settings request has not resolved yet.
 */
export const DEFAULT_STORE_SETTINGS: StoreSettings = {
  freeShippingThreshold: 999,
  standardShippingFee: 100,
};

const CACHE_TTL_MS = 60_000;

let cachedSettings: { data: StoreSettings; expiresAt: number } | null = null;
let inFlightRequest: Promise<StoreSettings> | null = null;

/**
 * The admin settings page calls this after a successful save so the storefront
 * does not keep showing the previous threshold.
 */
export function invalidateStoreSettingsCache(): void {
  cachedSettings = null;
}

async function fetchStoreSettings(): Promise<StoreSettings> {
  if (cachedSettings && cachedSettings.expiresAt > Date.now()) {
    return cachedSettings.data;
  }

  if (!inFlightRequest) {
    inFlightRequest = api
      .get("/store-settings")
      .then((res) => {
        const data = res.data?.data;
        if (
          data &&
          typeof data.freeShippingThreshold === "number" &&
          typeof data.standardShippingFee === "number"
        ) {
          const settings: StoreSettings = {
            freeShippingThreshold: data.freeShippingThreshold,
            standardShippingFee: data.standardShippingFee,
          };
          cachedSettings = { data: settings, expiresAt: Date.now() + CACHE_TTL_MS };
          return settings;
        }
        return DEFAULT_STORE_SETTINGS;
      })
      .catch(() => {
        // Keep the safe defaults; a settings outage must not break the page.
        return DEFAULT_STORE_SETTINGS;
      })
      .finally(() => {
        inFlightRequest = null;
      });
  }

  return inFlightRequest;
}

/**
 * Reads the public delivery settings used by storefront copy and cart nudges.
 */
export function useStoreSettings(): StoreSettings {
  const [settings, setSettings] = useState<StoreSettings>(
    cachedSettings?.data ?? DEFAULT_STORE_SETTINGS
  );

  useEffect(() => {
    let active = true;
    fetchStoreSettings().then((next) => {
      if (active) setSettings(next);
    });
    return () => {
      active = false;
    };
  }, []);

  return settings;
}
