"use client";

import { useEffect, useRef, ReactNode } from "react";
import { api } from "@/lib/api";

interface BannerTrackerProps {
  bannerId?: string;
  children: ReactNode;
  className?: string;
}

export function BannerTracker({ bannerId, children, className }: BannerTrackerProps) {
  const trackedRef = useRef(false);

  useEffect(() => {
    if (!bannerId || trackedRef.current) return;
    trackedRef.current = true;
    api.post(`/catalog/banners/${bannerId}/impression`).catch(() => {});
  }, [bannerId]);

  const handleClick = (e: React.MouseEvent) => {
    if (!bannerId) return;
    const target = e.target as HTMLElement | null;
    const link = target?.closest("a");
    if (link) {
      api.post(`/catalog/banners/${bannerId}/click`).catch(() => {});
    }
  };

  return (
    <div onClick={handleClick} className={className}>
      {children}
    </div>
  );
}
