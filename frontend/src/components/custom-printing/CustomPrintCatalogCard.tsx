/* eslint-disable @next/next/no-img-element */
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Sparkles, Eye, ShieldCheck, ArrowRight, Package, Star } from "lucide-react";
import { type CatalogItem } from "@/lib/customPrintCatalogData";

export type { CatalogItem };

interface CustomPrintCatalogCardProps {
  item: CatalogItem;
  onOpenBulkQuote?: (item: CatalogItem) => void;
}

export default function CustomPrintCatalogCard({ item, onOpenBulkQuote }: CustomPrintCatalogCardProps) {
  const router = useRouter();
  const [viewSide, setViewSide] = useState<"FRONT" | "BACK">("FRONT");
  const [activeColor, setActiveColor] = useState<string | null>(null);

  // Price calculations
  const displayPriceInRupees = item.displayPrice
    ? item.displayPrice > 10000
      ? Math.round(item.displayPrice / 100)
      : item.displayPrice
    : item.productId?.basePrice
    ? item.productId.basePrice > 10000
      ? Math.round(item.productId.basePrice / 100)
      : item.productId.basePrice
    : 410;

  const mrpInRupees = item.productId?.mrp
    ? item.productId.mrp > 10000
      ? Math.round(item.productId.mrp / 100)
      : item.productId.mrp
    : Math.round(displayPriceInRupees * 1.85);

  const discountPercent =
    mrpInRupees > displayPriceInRupees
      ? Math.round(((mrpInRupees - displayPriceInRupees) / mrpInRupees) * 100)
      : 35;

  const samplePrice = useMemo(() => {
    return Math.round(displayPriceInRupees * 1.55);
  }, [displayPriceInRupees]);

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
    if (unique.length === 0) return ["S", "M", "L", "XL", "2XL"];
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



  // Fabric specification description tag (PrintMine style)
  const getFabricTag = () => {
    if (item.productId?.fabric && item.productId?.gsm) {
      return `${item.productId.gsm} GSM ${item.productId.fabric}`;
    }
    const lower = item.name.toLowerCase();
    if (lower.includes("polo") || lower.includes("pique")) {
      return "200 GSM Matty-Cotton Blend · 15 Colours";
    }
    if (lower.includes("cotton") || lower.includes("pure")) {
      return "250 GSM 100% Pure Combed Cotton";
    }
    if (lower.includes("dryfit") || lower.includes("poly") || lower.includes("sports")) {
      return "180 GSM Moisture-Wicking Micro-Poly";
    }
    if (lower.includes("hoodie") || lower.includes("fleece")) {
      return "320 GSM Heavyweight Fleece Hoodie";
    }
    if (lower.includes("oversized") || lower.includes("streetwear")) {
      return "240 GSM Combed Streetwear Cotton";
    }
    return "Bio-Washed Combed Cotton · Colorfast Print";
  };
  const fabricTag = getFabricTag();

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm transition-all duration-300 hover:shadow-xl hover:border-neutral-900 dark:hover:border-neutral-100 hover:-translate-y-1">
      {/* Mockup Canvas Container */}
      <div className="relative aspect-[4/5] w-full overflow-hidden bg-neutral-100 dark:bg-neutral-800 select-none">
        {/* Top Badges Ribbon (PrintMine Style) */}
        <div className="absolute top-3 left-3 right-3 z-20 flex items-center justify-between pointer-events-none">
          <span className="rounded-md bg-neutral-900 text-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider shadow-sm flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-amber-400" />
            Best Seller
          </span>
          <span className="rounded-md bg-emerald-700 text-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider shadow-sm">
            From 2 Pcs Sample
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
          <div className="flex h-full items-center justify-center bg-neutral-100 dark:bg-neutral-800 text-neutral-400 text-sm font-medium">
            Mockup preview
          </div>
        )}

        {/* Interactive Front / Back View Switcher Tabs */}
        <div className="absolute bottom-3 left-3 z-20 flex rounded-md bg-neutral-900/85 p-0.5 backdrop-blur-md shadow-md border border-white/10">
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setViewSide("FRONT");
            }}
            aria-pressed={viewSide === "FRONT"}
            className={`rounded px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
              viewSide === "FRONT"
                ? "bg-white text-neutral-950 shadow-xs font-black"
                : "text-neutral-300 hover:text-white"
            }`}
          >
            Front
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setViewSide("BACK");
            }}
            aria-pressed={viewSide === "BACK"}
            className={`rounded px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
              viewSide === "BACK"
                ? "bg-white text-neutral-950 shadow-xs font-black"
                : "text-neutral-300 hover:text-white"
            }`}
          >
            Back
          </button>
        </div>

        {/* View Details Quick-Link */}
        <Link
          href={`/custom-printing/${item.slug}${activeColor ? `?color=${encodeURIComponent(activeColor)}` : ""}`}
          className="absolute bottom-3 right-3 z-20 inline-flex items-center gap-1 rounded-md bg-white/95 px-2.5 py-1 text-[10px] font-bold text-neutral-900 shadow-sm backdrop-blur-xs transition-transform hover:scale-105"
        >
          <Eye className="w-3 h-3" />
          Preview
        </Link>
      </div>

      {/* Card Body */}
      <div className="flex flex-1 flex-col p-4 sm:p-5">
        {/* Fabric Specification Tag */}
        <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-neutral-500 dark:text-neutral-400 mb-1.5">
          <span>{fabricTag}</span>
        </div>

        {/* Product Title */}
        <Link
          href={`/custom-printing/${item.slug}${activeColor ? `?color=${encodeURIComponent(activeColor)}` : ""}`}
          className="group/title block"
        >
          <h3 className="font-bold text-sm sm:text-base text-neutral-900 dark:text-neutral-100 leading-snug group-hover/title:underline transition-colors line-clamp-2">
            {item.name}
          </h3>
        </Link>

        {/* Print Locations & Free Proof badge */}
        <div className="mt-2 flex items-center justify-between text-[11px] text-neutral-500 dark:text-neutral-400">
          <div className="flex items-center gap-1 truncate">
            <ShieldCheck className="w-3.5 h-3.5 text-neutral-900 dark:text-neutral-100 shrink-0" />
            <span className="truncate">Front & Back Printing</span>
          </div>
          <div className="flex items-center gap-0.5 text-amber-500 shrink-0">
            <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
            <span className="font-bold text-[10px] text-neutral-700 dark:text-neutral-300">4.9</span>
          </div>
        </div>

        {/* Color Variants Swatches */}
        {uniqueColors.length > 0 && (
          <div className="mt-3 flex items-center justify-between gap-2 border-t border-neutral-100 dark:border-neutral-800 pt-2.5">
            <div className="flex items-center gap-1.5 py-0.5 overflow-x-auto">
              {uniqueColors.slice(0, 6).map((c) => (
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
                  className={`inline-block h-3.5 w-3.5 rounded-full border border-white dark:border-neutral-900 ring-1 ring-black/15 transition-all cursor-pointer ${
                    activeColor === c.name ? "scale-125 ring-2 ring-neutral-900 dark:ring-white z-10 shadow-xs" : "hover:scale-115"
                  }`}
                  style={{ backgroundColor: c.hex }}
                  aria-label={`Select ${c.name} color`}
                />
              ))}
              {uniqueColors.length > 6 && (
                <span className="text-[10px] text-neutral-400 font-bold">+{uniqueColors.length - 6}</span>
              )}
            </div>
            <span className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400 truncate">
              {activeColor || `${uniqueColors.length} Colours`}
            </span>
          </div>
        )}

        {/* Sizes Pill Badges */}
        <div className="mt-2 flex items-center gap-1 overflow-x-auto text-[10px]">
          <span className="font-semibold text-neutral-400 text-[9px] uppercase tracking-wider">Sizes:</span>
          {availableSizes.slice(0, 5).map((sz) => (
            <span
              key={sz}
              className="rounded border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-1.5 py-0.2 font-mono text-[9px] font-semibold text-neutral-700 dark:text-neutral-300"
            >
              {sz}
            </span>
          ))}
          {availableSizes.length > 5 && (
            <span className="text-[9px] text-neutral-400 font-mono">+{availableSizes.length - 5}</span>
          )}
        </div>

        {/* Card Footer: Pricing (PrintMine style: MRP Strikethrough, From Bulk Price, Sample Price) */}
        <div className="mt-auto pt-3 flex flex-col gap-2.5 border-t border-neutral-100 dark:border-neutral-800">
          <div className="flex items-baseline justify-between">
            <div className="space-y-0.5">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-neutral-400 line-through">
                  ₹{mrpInRupees.toLocaleString("en-IN")}
                </span>
                <span className="text-base sm:text-lg font-black text-neutral-900 dark:text-white">
                  From ₹{displayPriceInRupees.toLocaleString("en-IN")}
                </span>
                <span className="text-[10px] font-bold text-red-600 bg-red-50 dark:bg-red-950/40 px-1.5 py-0.5 rounded">
                  {discountPercent}% OFF
                </span>
              </div>
              <span className="text-[10px] text-neutral-500 dark:text-neutral-400 block">
                Sample ₹{samplePrice.toLocaleString("en-IN")} (2 Pcs) · Bulk from 20+
              </span>
            </div>
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
                  router.push(`/bulk-orders/request?productId=${item.productId?._id || ""}&catalogItemId=${item._id}`);
                }
              }}
              className="inline-flex items-center justify-center gap-1 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-2 text-xs font-bold text-neutral-800 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-colors cursor-pointer"
            >
              <Package className="w-3.5 h-3.5 text-neutral-500" />
              <span>Bulk Quote</span>
            </button>

            {/* Primary CTA: Customize */}
            <Link
              href={`/custom-printing/${item.slug}${activeColor ? `?color=${encodeURIComponent(activeColor)}` : ""}`}
              className="inline-flex items-center justify-center gap-1 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 px-3 py-2 text-xs font-bold shadow-xs hover:bg-neutral-800 dark:hover:bg-neutral-100 transition-all cursor-pointer group/btn"
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
