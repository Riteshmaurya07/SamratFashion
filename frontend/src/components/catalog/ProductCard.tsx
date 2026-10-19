"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Star, Heart } from "lucide-react";
import { useAuthStore } from "@/store/useAuthStore";
import { useWishlistStore } from "@/store/useWishlistStore";
import { useState } from "react";

export interface ProductCardProps {
  _id: string;
  slug: string;
  name: string;
  images: string[];
  basePrice: number;
  mrp?: number;
  discount?: number;
  averageRating?: number;
  reviewCount?: number;
  isNewArrival?: boolean;
  isBestSeller?: boolean;
  tags?: string[];
  variants?: Array<{
    color: string;
    hexCode?: string;
  }>;
  selectedColor?: string;
  variantId?: string | null;
}

export function ProductCard({
  _id,
  slug,
  name,
  images,
  basePrice,
  mrp,
  discount,
  averageRating = 0,
  reviewCount = 0,
  isNewArrival,
  isBestSeller,
  tags,
  variants,
  selectedColor,
  variantId,
}: ProductCardProps) {
  const variantImages = (variants || []).flatMap((v) => (v && "images" in v && Array.isArray(v.images) ? (v.images as string[]) : [])).filter(Boolean);
  const primaryImage =
    images && images.length > 0
      ? images[0]
      : variantImages.length > 0
      ? variantImages[0]
      : "https://images.unsplash.com/photo-1523381210434-271e8be1f52b?q=80&w=2070&auto=format&fit=crop";
  const secondaryImage = images[1] || variantImages[1] || primaryImage;

  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const { isInWishlist, toggleWishlist } = useWishlistStore();
  const [isWishlistLoading, setIsWishlistLoading] = useState(false);

  const isWishlisted = isInWishlist(_id, variantId);

  const handleWishlistToggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!isAuthenticated) {
      router.push(`/login?redirect=/shop/${slug}`);
      return;
    }
    setIsWishlistLoading(true);
    try {
      await toggleWishlist(_id, variantId);
    } catch (error) {
      console.error("Failed to toggle wishlist", error);
    } finally {
      setIsWishlistLoading(false);
    }
  };

  // Extract unique colors and hex codes for swatches
  const uniqueColorData = Array.from(
    new Map(
      variants?.map((v) => [v.color, v.hexCode || "#e5e5e5"]) || []
    )
  ).slice(0, 3);

  const targetUrl = selectedColor ? `/shop/${slug}?color=${encodeURIComponent(selectedColor)}` : `/shop/${slug}`;

  return (
    <div className="group relative flex flex-col justify-between h-full bg-surface-container-lowest rounded-lg overflow-hidden border border-outline-variant/40 streetwear-card">
      {/* Image Container with Streetwear Aspect Ratio */}
      <div className="relative aspect-[3/4] bg-neutral-900 overflow-hidden">
        <Link href={targetUrl} className="block w-full h-full relative">
          <Image
            src={primaryImage}
            alt={name}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            className="product-img-primary absolute inset-0 w-full h-full object-cover transition-all duration-700 ease-out group-hover:scale-105"
          />
          {secondaryImage && secondaryImage !== primaryImage && (
            <Image
              src={secondaryImage}
              alt={`${name} detail view`}
              fill
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
              className="product-img-secondary absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ease-out opacity-0 group-hover:opacity-100"
            />
          )}
        </Link>

        {/* Badges */}
        <div className="absolute top-2.5 left-2.5 flex flex-col gap-1.5 z-10 pointer-events-none">
          {isNewArrival && (
            <span className="bg-neutral-950 text-white font-mono text-[9px] uppercase tracking-wider px-2 py-0.5 rounded-xs font-bold border border-neutral-700">
              NEW DROP
            </span>
          )}
          {isBestSeller && !isNewArrival && (
            <span className="bg-primary text-white font-mono text-[9px] uppercase tracking-wider px-2 py-0.5 rounded-xs font-bold">
              BESTSELLER
            </span>
          )}
        </div>

        {/* Wishlist Button - Stopped from bubbling to parent link */}
        <button
          type="button"
          aria-label={isWishlisted ? "Remove from wishlist" : "Add to wishlist"}
          disabled={isWishlistLoading}
          onClick={handleWishlistToggle}
          className="absolute top-2.5 right-2.5 z-10 w-8 h-8 flex items-center justify-center bg-surface/90 backdrop-blur-md rounded-full text-on-surface shadow-sm hover:scale-110 active:scale-95 transition-all border border-outline-variant/40 disabled:opacity-50"
        >
          <Heart className={`w-4 h-4 transition-colors ${isWishlisted ? "fill-red-600 text-red-600" : "text-neutral-700 hover:text-red-600"}`} />
        </button>
      </div>

      {/* Product Details */}
      <div className="flex flex-col flex-grow p-4 space-y-2">
        <div className="space-y-1">
          <div className="flex justify-between items-start gap-2">
            <Link href={targetUrl} className="flex-1">
              <h3 className="font-headline-sm text-sm md:text-base font-bold text-on-surface line-clamp-1 group-hover:text-primary transition-colors tracking-tight">
                {name}
              </h3>
            </Link>
            {/* Rating rendered strictly when genuine review data exists */}
            {reviewCount !== undefined && reviewCount > 0 && averageRating !== undefined && averageRating > 0 && (
              <div className="flex items-center gap-0.5 text-neutral-600 shrink-0 font-mono text-[11px] pt-0.5">
                <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                <span>{averageRating.toFixed(1)}</span>
              </div>
            )}
          </div>

          {/* Garment Tag or Category Micro-spec */}
          <p className="font-mono text-[11px] text-on-surface-variant uppercase tracking-wider line-clamp-1">
            {tags && tags.length > 0 ? tags.slice(0, 2).join(" // ") : "240 GSM // HEAVYWEIGHT"}
          </p>
        </div>

        {/* Price Row */}
        {(() => {
          const displayPrice = Math.round(basePrice);
          const displayMrp = mrp ? Math.round(mrp) : undefined;
          const discountPct = discount || (displayMrp && displayMrp > displayPrice ? Math.round(((displayMrp - displayPrice) / displayMrp) * 100) : 0);
          return (
            <div className="flex items-baseline gap-2 pt-1 font-mono">
              <span className="font-black text-on-surface text-base md:text-lg">₹{displayPrice.toLocaleString('en-IN')}</span>
              {displayMrp && displayMrp > displayPrice && (
                <>
                  <span className="text-on-surface-variant text-xs line-through">₹{displayMrp.toLocaleString('en-IN')}</span>
                  {discountPct > 0 && (
                    <span className="text-emerald-700 text-xs font-bold font-mono">
                      {discountPct}% OFF
                    </span>
                  )}
                </>
              )}
            </div>
          );
        })()}

        {/* Color Swatches */}
        {uniqueColorData.length > 1 && (
          <div className="flex gap-1.5 pt-1">
            {uniqueColorData.map(([color, hex], idx) => (
              <div
                key={idx}
                title={color}
                className="w-3.5 h-3.5 rounded-full border border-neutral-300 ring-1 ring-black/5"
                style={{ backgroundColor: hex }}
              />
            ))}
          </div>
        )}

        {/* CTA Button */}
        <div className="pt-2 mt-auto">
          <Link
            href={targetUrl}
            className="w-full flex items-center justify-center py-2 px-3 border border-outline-variant text-on-surface font-mono text-[11px] uppercase tracking-wider font-bold rounded-md hover:bg-neutral-900 hover:text-white hover:border-neutral-900 transition-colors"
          >
            SELECT SIZE &rarr;
          </Link>
        </div>
      </div>
    </div>
  );
}
