/* eslint-disable @next/next/no-img-element */
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Sparkles, Eye, ShieldCheck, ArrowRight, Package } from "lucide-react";
import { type CatalogItem } from "@/lib/customPrintCatalogData";

export type { CatalogItem };

interface CustomPrintCatalogCardProps {
  item: CatalogItem;
  onOpenBulkQuote?: (item: CatalogItem) => void;
}

export default function CustomPrintCatalogCard({ item, onOpenBulkQuote }: CustomPrintCatalogCardProps) {
  const [viewSide, setViewSide] = useState<"FRONT" | "BACK">("FRONT");
  const [activeColor, setActiveColor] = useState<string | null>(null);

  const displayPriceInRupees = item.displayPrice
    ? (item.displayPrice > 10000 ? Math.round(item.displayPrice / 100) : item.displayPrice)
    : item.productId?.basePrice
    ? (item.productId.basePrice > 10000 ? Math.round(item.productId.basePrice / 100) : item.productId.basePrice)
    : null;

  // Extract unique color variants from product data
  // Extract unique color variants from product data with front & back assets
  const uniqueColors = useMemo(() => {
    const map = new Map<string, { name: string; hex: string; frontImage: string; backImage: string }>();
    (item.productId?.variants || [])
      .filter((v) => v.isAvailable !== false && (v.stock ?? 1) > 0 && v.color)
      .forEach((v) => {
        const key = v.color!.toLowerCase();
        if (!map.has(key)) {
          map.set(key, {
            name: v.color!,
            hex: v.hexCode || "#18181b",
            frontImage: v.images?.[0] || item.mockupImageUrl,
            backImage: v.images?.[1] || item.backMockupImageUrl || item.mockupImageUrl,
          });
        }
      });
    return Array.from(map.values());
  }, [item.productId?.variants, item.mockupImageUrl, item.backMockupImageUrl]);

  // Extract available sizes from product data
  const availableSizes = useMemo(() => {
    const rawSizes = (item.productId?.variants || [])
      .filter((v) => v.isAvailable !== false && (v.stock ?? 1) > 0 && v.size)
      .map((v) => v.size as string);
    const standardOrder = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL"];
    const unique = Array.from(new Set(rawSizes));
    return unique.sort((a, b) => {
      const idxA = standardOrder.indexOf(a.toUpperCase());
      const idxB = standardOrder.indexOf(b.toUpperCase());
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.localeCompare(b);
    });
  }, [item.productId?.variants]);

  // Active color object
  const activeColorObject = useMemo(() => {
    if (activeColor) {
      return uniqueColors.find((c) => c.name.toLowerCase() === activeColor.toLowerCase()) || uniqueColors[0] || null;
    }
    return uniqueColors[0] || null;
  }, [activeColor, uniqueColors]);

  // Resolve current front and back mockup images
  const currentImage = useMemo(() => {
    if (activeColorObject) {
      return viewSide === "BACK" ? activeColorObject.backImage : activeColorObject.frontImage;
    }
    return viewSide === "BACK"
      ? item.backMockupImageUrl || item.mockupImageUrl || "/images/custom_print_hero.png"
      : item.mockupImageUrl || "/images/custom_print_hero.png";
  }, [viewSide, activeColorObject, item.backMockupImageUrl, item.mockupImageUrl]);
  // Resolve placement configs for front and back
  const frontPlacement = useMemo(() => {
    const found = item.placementTemplateIds?.find((p) => p.side === "FRONT");
    if (found) return found;
    if (item.placementTemplateId?.side === "FRONT") return item.placementTemplateId;
    return {
      name: "Front Chest Print",
      code: "FRONT_CHEST",
      previewConfig: { x: 35, y: 32, width: 28, height: 24 },
    };
  }, [item.placementTemplateIds, item.placementTemplateId]);

  const backPlacement = useMemo(() => {
    const found = item.placementTemplateIds?.find((p) => p.side === "BACK");
    if (found) return found;
    return {
      name: "Full Back Print",
      code: "BACK_FULL",
      previewConfig: { x: 25, y: 22, width: 50, height: 45 },
    };
  }, [item.placementTemplateIds]);

  const activePlacement = viewSide === "FRONT" ? frontPlacement : backPlacement;

  // Supported placements summary text
  const supportedPlacementsText = useMemo(() => {
    if (item.placementTemplateIds && item.placementTemplateIds.length > 1) {
      const names = item.placementTemplateIds.map((p) => p.name || p.side);
      return names.slice(0, 2).join(" + ");
    }
    return item.placementTemplateId?.name || "Front Chest + Back Available";
  }, [item.placementTemplateIds, item.placementTemplateId]);

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-outline-variant/30 bg-surface-container-lowest shadow-sm transition-all duration-300 hover:shadow-xl hover:border-primary/40 hover:-translate-y-1">
      {/* Mockup Canvas Container */}
      <div className="relative aspect-[4/5] w-full overflow-hidden bg-surface-container select-none">
        {/* Top Badges Ribbon */}
        <div className="absolute top-3 left-3 right-3 z-20 flex items-center justify-between pointer-events-none">
          <span className="rounded-lg bg-black/85 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-white backdrop-blur-md shadow-xs flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-amber-400" />
            Custom Print Blank
          </span>
          <span className="rounded-full bg-primary/90 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-on-primary backdrop-blur-md shadow-xs">
            MOQ: {item.minOrderQuantity || 10} pcs
          </span>
        </div>

        {/* Garment Mockup Image */}
        {currentImage ? (
          <img
            src={currentImage}
            alt={`${item.name} ${viewSide.toLowerCase()} mockup view`}
            className="h-full w-full object-cover transition-all duration-500 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-surface-container text-on-surface-variant text-sm font-medium">
            Mockup unavailable
          </div>
        )}

        {/* Subtle Printable Zone Boundary */}
        <div
          className="absolute z-10 transition-all duration-300 pointer-events-none rounded-lg border border-dashed border-white/70 bg-black/15 flex items-center justify-center p-1"
          style={{
            left: `${activePlacement.previewConfig.x}%`,
            top: `${activePlacement.previewConfig.y}%`,
            width: `${activePlacement.previewConfig.width}%`,
            height: `${activePlacement.previewConfig.height}%`,
          }}
          aria-hidden="true"
        >
          <span className="text-[7.5px] font-black uppercase tracking-[0.14em] text-white/95 bg-black/60 px-2 py-0.5 rounded shadow-xs text-center">
            {viewSide === "FRONT" ? "Chest Print Area" : "Back Print Area"}
          </span>
        </div>

        {/* Interactive Front / Back View Switcher Tabs */}
        <div className="absolute bottom-3 left-3 z-20 flex rounded-lg bg-black/80 p-0.5 backdrop-blur-md shadow-md border border-white/10">
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setViewSide("FRONT");
            }}
            aria-pressed={viewSide === "FRONT"}
            className={`rounded-md px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
              viewSide === "FRONT"
                ? "bg-white text-black shadow-xs font-black"
                : "text-white/80 hover:text-white"
            }`}
          >
            Front View
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setViewSide("BACK");
            }}
            aria-pressed={viewSide === "BACK"}
            className={`rounded-md px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
              viewSide === "BACK"
                ? "bg-white text-black shadow-xs font-black"
                : "text-white/80 hover:text-white"
            }`}
          >
            Back View
          </button>
        </div>

        {/* View Details Hover Overlay Quick-Link */}
        <Link
          href={`/custom-printing/${item.slug}${activeColor ? `?color=${encodeURIComponent(activeColor)}` : ""}`}
          className="absolute bottom-3 right-3 z-20 inline-flex items-center gap-1 rounded-lg bg-white/95 px-2.5 py-1 text-[10px] font-bold text-neutral-900 shadow-sm backdrop-blur-xs transition-transform hover:scale-105"
        >
          <Eye className="w-3 h-3" />
          Preview
        </Link>
      </div>

      {/* Card Body */}
      <div className="flex flex-1 flex-col p-4 sm:p-5">
        {/* Category & Title */}
        <Link
          href={`/custom-printing/${item.slug}${activeColor ? `?color=${encodeURIComponent(activeColor)}` : ""}`}
          className="group/title block"
        >
          <h3 className="font-bold text-base text-on-surface leading-snug group-hover/title:text-primary transition-colors line-clamp-1">
            {item.name}
          </h3>
        </Link>

        {/* Print Locations Supported */}
        <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-on-surface-variant">
          <ShieldCheck className="w-3.5 h-3.5 text-primary shrink-0" />
          <span className="truncate font-medium">{supportedPlacementsText}</span>
        </div>

        {/* Fabric & Fit Specification Tags (if verified on underlying product) */}
        {(item.productId?.fabric || item.productId?.fit || item.productId?.gsm) && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] font-bold text-neutral-600">
            {item.productId.fabric && (
              <span className="rounded bg-surface-container-high px-2 py-0.5 border border-outline-variant/30">
                {item.productId.fabric}
              </span>
            )}
            {item.productId.gsm && (
              <span className="rounded bg-surface-container-high px-2 py-0.5 border border-outline-variant/30">
                {item.productId.gsm} GSM
              </span>
            )}
            {item.productId.fit && (
              <span className="rounded bg-surface-container-high px-2 py-0.5 border border-outline-variant/30">
                {item.productId.fit} Fit
              </span>
            )}
          </div>
        )}

        {/* Color Variants Swatches */}
        {uniqueColors.length > 0 && (
          <div className="mt-3 flex items-center gap-2">
            <div className="flex items-center gap-1.5 py-0.5">
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
                  className={`inline-block h-4 w-4 rounded-full border border-white ring-1 ring-black/15 transition-all cursor-pointer ${
                    activeColor === c.name ? "scale-125 ring-2 ring-primary z-10 shadow-sm" : "hover:scale-115"
                  }`}
                  style={{ backgroundColor: c.hex }}
                  aria-label={`Select ${c.name} color`}
                />
              ))}
            </div>
            <span className="text-[11px] font-medium text-on-surface-variant truncate">
              {activeColor || `${uniqueColors.length} Colors`}
            </span>
          </div>
        )}

        {/* Available Sizes Pill Badges */}
        {availableSizes.length > 0 && (
          <div className="mt-2.5 flex items-center gap-1 overflow-x-auto pb-0.5 text-[10px]">
            <span className="font-bold text-on-surface-variant/70 text-[9px] uppercase tracking-wider">Sizes:</span>
            {availableSizes.map((sz) => (
              <span
                key={sz}
                className="rounded border border-outline-variant/40 bg-surface-container-low px-1.5 py-0.5 font-bold font-mono text-on-surface"
              >
                {sz}
              </span>
            ))}
          </div>
        )}

        {/* Card Footer: Pricing & Action Buttons */}
        <div className="mt-auto pt-4 flex flex-col gap-2.5 border-t border-outline-variant/20">
          <div className="flex items-baseline justify-between">
            <div>
              <span className="font-price-md text-base sm:text-lg font-black text-on-surface">
                {displayPriceInRupees
                  ? `From ₹${displayPriceInRupees.toLocaleString("en-IN")}`
                  : "Contact for pricing"}
              </span>
              <span className="text-[10px] text-on-surface-variant block font-mono">
                Min. {item.minOrderQuantity || 10} units
              </span>
            </div>
            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
              Digital Proof Included
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1">
            {/* Secondary CTA: Quick Bulk Quote */}
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (onOpenBulkQuote) {
                  onOpenBulkQuote(item);
                } else {
                  window.location.href = `/bulk-orders/request?productId=${item.productId?._id || ""}&catalogItemId=${item._id}`;
                }
              }}
              className="inline-flex items-center justify-center gap-1 rounded-xl border border-outline-variant/60 bg-surface-container-low px-3 py-2 text-xs font-bold text-on-surface hover:bg-surface-container hover:border-outline transition-colors cursor-pointer"
            >
              <Package className="w-3.5 h-3.5 text-on-surface-variant" />
              Bulk Quote
            </button>

            {/* Primary CTA: Customize */}
            <Link
              href={`/custom-printing/${item.slug}${activeColor ? `?color=${encodeURIComponent(activeColor)}` : ""}`}
              className="inline-flex items-center justify-center gap-1 rounded-xl bg-neutral-900 px-3 py-2 text-xs font-bold text-white shadow-xs hover:bg-neutral-800 transition-all cursor-pointer group/btn"
            >
              <span>Customize</span>
              <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover/btn:translate-x-0.5" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
