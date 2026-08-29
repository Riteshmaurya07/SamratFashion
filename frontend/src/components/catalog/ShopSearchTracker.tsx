"use client";

import { useEffect } from "react";
import { trackSearch } from "@/lib/analytics";

export function ShopSearchTracker({ query, totalResults }: { query: string; totalResults: number }) {
  useEffect(() => {
    if (query && query.trim()) {
      trackSearch(query, totalResults);
    }
  }, [query, totalResults]);

  return null;
}
