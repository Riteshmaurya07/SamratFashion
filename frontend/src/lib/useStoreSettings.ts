"use client";

import { useEffect, useSyncExternalStore } from "react";
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
const listeners = new Set<() => void>();

function emitChange(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * A stable snapshot is required by useSyncExternalStore. The cached object is
 * only replaced when fresh settings arrive, so unchanged reads bail out of
 * re-rendering.
 */
function getSnapshot(): StoreSettings {
  return cachedSettings?.data ?? DEFAULT_STORE_SETTINGS;
}

/**
 * Always use the deterministic defaults while hydrating. The client cache may
 * already contain live settings, but rendering those on the first pass would
 * not match the server HTML and causes a hydration mismatch.
 */
function getServerSnapshot(): StoreSettings {
  return DEFAULT_STORE_SETTINGS;
}

/**
 * The admin settings page calls this after a successful save so the storefront
 * does not keep showing the previous threshold.
 */
export function invalidateStoreSettingsCache(): void {
  cachedSettings = null;
  emitChange();
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
  const settings = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    let active = true;
    fetchStoreSettings().then(() => {
      if (active) emitChange();
    });
    return () => {
      active = false;
    };
  }, []);

  return settings;
}
