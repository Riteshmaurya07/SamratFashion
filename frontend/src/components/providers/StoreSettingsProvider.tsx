"use client";

import React, { useEffect } from "react";
import {
  StoreSettings,
  StoreSettingsContext,
  seedStoreSettingsCache,
} from "@/lib/useStoreSettings";

/**
 * Seeds storefront delivery settings from the Server Component layout so both
 * SSR HTML and initial client hydration render the authoritative backend value
 * with zero threshold flicker (e.g. no ₹999 -> ₹99 flip).
 */
export function StoreSettingsProvider({
  initialSettings,
  children,
}: {
  initialSettings: StoreSettings;
  children: React.ReactNode;
}) {
  useEffect(() => {
    seedStoreSettingsCache(initialSettings);
  }, [initialSettings]);

  return (
    <StoreSettingsContext.Provider value={initialSettings}>
      {children}
    </StoreSettingsContext.Provider>
  );
}
