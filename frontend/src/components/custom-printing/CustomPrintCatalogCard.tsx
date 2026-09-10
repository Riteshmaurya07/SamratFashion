/* eslint-disable @next/next/no-img-element */
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

type PreviewConfig = { x: number; y: number; width: number; height: number };
type PlacementTemplate = {
  _id: string;
  name: string;
  code: string;
  side: string;
  previewConfig: PreviewConfig;
};
type Variant = {
  _id?: string;
  size?: string;
  color?: string;
  hexCode?: string;
  isAvailable?: boolean;
  stock?: number;
  images?: string[];
};
type Product = { _id: string; name: string; basePrice: number; variants?: Variant[] };

export type CatalogItem = {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  mockupImageUrl: string;
  displayPrice?: number;
  isActive: boolean;
  productId: Product;
  placementTemplateId: PlacementTemplate;
};

export default function CustomPrintCatalogCard({ item }: { item: CatalogItem }) {
  const displayPriceInRupees = item.displayPrice ? item.displayPrice / 100 : null;

  // Extract unique color variants
  const uniqueColors = Array.from(
    new Map(
      (item.productId?.variants || [])
        .filter((v) => v.isAvailable !== false && (v.stock ?? 1) > 0 && v.color)
        .map((v) => [v.color, { name: v.color!, hex: v.hexCode || "#000000", image: v.images?.[0] }])
    ).values()
  );

  const [activeColor, setActiveColor] = useState<string | null>(null);

  const currentMockupImage = useMemo(() => {
    if (!activeColor) return item.mockupImageUrl;
    const found = uniqueColors.find((c) => c.name === activeColor);
    return found?.image || item.mockupImageUrl;
  }, [activeColor, uniqueColors, item.mockupImageUrl]);

  return (
    <Link
      href={`/custom-printing/${item.slug}${activeColor ? `?color=${encodeURIComponent(activeColor)}` : ""}`}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-outline-variant/30 bg-surface-container-lowest shadow-sm transition-all duration-300 hover:shadow-xl hover:border-primary/30 hover:-translate-y-1"
      aria-label={`View ${item.name} — ${item.placementTemplateId.name} placement`}
    >
      {/* Mockup Image Container */}
      <div className="relative aspect-[4/5] w-full overflow-hidden bg-surface-container">
        {currentMockupImage ? (
          <img
            src={currentMockupImage}
            alt={`${item.name} mockup showing ${item.placementTemplateId.name} print placement in ${activeColor || "default color"}`}
            className="h-full w-full object-cover transition-all duration-500 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-surface-container text-on-surface-variant text-sm">
            No mockup image
          </div>
        )}

        {/* Sample Print Logo Overlay */}
        <div
          className="absolute z-10 transition-all duration-300 pointer-events-none"
          style={{
            left: `${item.placementTemplateId.previewConfig.x}%`,
            top: `${item.placementTemplateId.previewConfig.y}%`,
            width: `${item.placementTemplateId.previewConfig.width}%`,
            height: `${item.placementTemplateId.previewConfig.height}%`,
          }}
          aria-hidden="true"
        >
          <div className="h-full w-full flex flex-col items-center justify-center p-0.5 text-center select-none opacity-90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]">
            <svg
              className="w-5 h-5 mb-0.5 max-w-full max-h-[45%]"
              viewBox="0 0 24 24"
              fill="none"
              stroke={activeColor === "Pure White" || activeColor === "Heather Grey" ? "#0f172a" : "#ffffff"}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polygon points="12 2 2 7 12 12 22 7 12 2" />
              <polyline points="2 17 12 22 22 17" />
              <polyline points="2 12 12 17 22 12" />
            </svg>
            <span
              className="text-[7px] font-black uppercase tracking-[0.14em] leading-tight"
              style={{ color: activeColor === "Pure White" || activeColor === "Heather Grey" ? "#0f172a" : "#ffffff" }}
            >
              YOUR LOGO
            </span>
          </div>
        </div>

        {/* Placement badge */}
        <div className="absolute bottom-3 left-3">
          <span className="rounded-full bg-black/60 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white backdrop-blur-sm">
            {item.placementTemplateId.name}
          </span>
        </div>
      </div>

      {/* Card content */}
      <div className="flex flex-1 flex-col p-5">
        <h3 className="font-bold text-on-surface leading-snug group-hover:text-primary transition-colors">
          {item.name}
        </h3>

        {/* Color Variants Swatches */}
        {uniqueColors.length > 0 && (
          <div className="mt-2.5 flex items-center gap-2">
            <div className="flex items-center gap-1.5 overflow-hidden py-1">
              {uniqueColors.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  title={c.name}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setActiveColor(c.name);
                  }}
                  onMouseEnter={() => setActiveColor(c.name)}
                  className={`inline-block h-4 w-4 rounded-full border border-white/80 ring-1 ring-black/10 transition-all ${
                    activeColor === c.name ? "scale-125 ring-2 ring-primary z-10 shadow-md" : "hover:scale-110"
                  }`}
                  style={{ backgroundColor: c.hex }}
                  aria-label={`Select ${c.name} color`}
                />
              ))}
            </div>
            <span className="text-[11px] font-medium text-on-surface-variant">
              {activeColor ? activeColor : `${uniqueColors.length} Colors`}
            </span>
          </div>
        )}

        {item.description && (
          <p className="mt-2 text-sm text-on-surface-variant line-clamp-2 leading-relaxed">
            {item.description}
          </p>
        )}
        <div className="mt-auto pt-4 flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-on-surface-variant">
            {displayPriceInRupees
              ? `Starting from ₹${displayPriceInRupees.toLocaleString("en-IN")}`
              : "Contact for price"}
          </span>
          <span
            className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-on-primary shadow-sm transition-all group-hover:shadow-md group-hover:bg-primary/90"
          >
            Customize
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M2 7H12M8 3l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </span>
        </div>
      </div>
    </Link>
  );
}
