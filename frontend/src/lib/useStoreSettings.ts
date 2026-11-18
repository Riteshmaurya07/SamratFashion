"use client";

import { createContext, useContext, useEffect, useSyncExternalStore } from "react";
import { api } from "@/lib/api";
import { DEFAULT_STORE_SETTINGS, StoreSettings } from "@/lib/storeSettingsDefaults";

export { DEFAULT_STORE_SETTINGS };
export type { StoreSettings };

const CACHE_TTL_MS = 60_000;

let cachedSettings: { data: StoreSettings; expiresAt: number } | null = null;
let inFlightRequest: Promise<StoreSettings> | null = null;
let cacheVersion = 0;
let hasBeenInvalidated = false;
const listeners = new Set<() => void>();

export const StoreSettingsContext = createContext<StoreSettings | null>(null);

function emitChange(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): StoreSettings | null {
  return cachedSettings?.data ?? null;
}

function getServerSnapshot(): StoreSettings | null {
  return null;
}

/**
 * Seeds the client cache from server-rendered settings so components don't
 * trigger a redundant fetch or flash defaults on first paint.
 */
export function seedStoreSettingsCache(settings: StoreSettings): void {
  if (!cachedSettings && !hasBeenInvalidated) {
    cachedSettings = {
      data: settings,
      expiresAt: Date.now() + CACHE_TTL_MS,
    };
    emitChange();
  }
}

/**
 * The admin settings page calls this after a successful save so the storefront
 * does not keep showing the previous threshold.
 */
export function invalidateStoreSettingsCache(): void {
  cachedSettings = null;
  hasBeenInvalidated = true;
  cacheVersion += 1;
  emitChange();
}

async function fetchStoreSettings(): Promise<StoreSettings> {
  if (cachedSettings && cachedSettings.expiresAt > Date.now()) {
    return cachedSettings.data;
  }

  if (!inFlightRequest) {
    const startVersion = cacheVersion;
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
          if (cacheVersion === startVersion) {
            cachedSettings = { data: settings, expiresAt: Date.now() + CACHE_TTL_MS };
            hasBeenInvalidated = false;
          }
          return settings;
        }
        return DEFAULT_STORE_SETTINGS;
      })
      .catch(() => {
        return cachedSettings?.data ?? DEFAULT_STORE_SETTINGS;
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
  const contextSettings = useContext(StoreSettingsContext);
  const liveSettings = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    let active = true;
    if (cachedSettings && cachedSettings.expiresAt > Date.now()) {
      return;
    }
    fetchStoreSettings().then(() => {
      if (active) emitChange();
    });
    return () => {
      active = false;
    };
  }, [liveSettings]);

  return liveSettings ?? contextSettings ?? DEFAULT_STORE_SETTINGS;
}
