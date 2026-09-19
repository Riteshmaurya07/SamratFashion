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
  averageRating: number;
  reviewCount: number;
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
  averageRating,
  isNewArrival,
  isBestSeller,
  variants,
  selectedColor,
  variantId,
}: ProductCardProps) {
  const variantImages = (variants || []).flatMap((v: any) => v.images || []).filter(Boolean);
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
    <Link href={targetUrl} className="group relative cursor-pointer product-card-hover flex flex-col justify-between h-full bg-surface rounded-xl overflow-hidden border border-outline-variant/10">
      {/* Image Container */}
      <div className="relative aspect-[3/4] bg-surface-container-low overflow-hidden">
        <Image 
          src={primaryImage} 
          alt={name} 
          fill
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          className="product-img-primary absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ease-in-out opacity-100" 
        />
        <Image 
          src={secondaryImage} 
          alt={`${name} secondary view`} 
          fill
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          className="product-img-secondary absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ease-in-out opacity-0" 
        />
        
        {/* Badges & Actions */}
        <div className="absolute top-3 left-3 flex flex-col gap-2 z-10">
          {isNewArrival && (
            <span className="bg-secondary-container text-on-secondary-container font-label-caps text-[10px] px-2 py-1 rounded shadow-sm font-bold">
              NEW DROP
            </span>
          )}
          {isBestSeller && !isNewArrival && (
            <span className="bg-tertiary text-on-tertiary font-label-caps text-[10px] px-2 py-1 rounded shadow-sm font-bold">
              BESTSELLER
            </span>
          )}
        </div>
        
        <button 
          aria-label="Add to wishlist" 
          disabled={isWishlistLoading}
          onClick={handleWishlistToggle}
          className="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center bg-surface-container-lowest/80 backdrop-blur rounded-full text-on-surface shadow-sm hover:scale-110 active:scale-90 transition-all duration-200 disabled:opacity-50"
        >
          <Heart className={`w-4 h-4 transition-all duration-200 ${isWishlisted ? "fill-red-500 text-red-500 scale-110" : "text-on-surface hover:text-red-500"}`} />
        </button>
        

      </div>
      
      {/* Details */}
      <div className="flex flex-col flex-grow p-4">
        <div className="flex justify-between items-center mb-1 min-h-[3rem]">
          <h4 className="font-body-md text-body-md font-bold text-on-surface line-clamp-2 pr-2">{name}</h4>
          <div className="flex items-center gap-1 text-on-surface-variant shrink-0">
            <Star className="w-3.5 h-3.5 fill-primary text-primary" />
            <span className="font-mono text-[12px]">{averageRating.toFixed(1)}</span>
          </div>
        </div>
        
        <p className="font-body-sm text-body-sm text-on-surface-variant mb-2 line-clamp-1">
          {/* Typically description preview or tags here. Using mock for now since API might not have this specifically separated. */}
          Heavyweight Cotton • Comfort Fit
        </p>
        
        {(() => {
          const displayPrice = Math.round(basePrice);
          const displayMrp = mrp ? Math.round(mrp) : undefined;
          return (
            <div className="mt-auto flex items-center gap-2 font-mono">
              <span className="font-bold text-on-surface text-[16px]">₹{displayPrice.toLocaleString('en-IN')}</span>
              {displayMrp && displayMrp > displayPrice && (
                <>
                  <span className="text-on-surface-variant text-[12px] line-through">₹{displayMrp.toLocaleString('en-IN')}</span>
                  {discount ? (
                    <span className="text-secondary text-[12px] font-bold ml-auto">({discount}% OFF)</span>
                  ) : (
                    <span className="text-secondary text-[12px] font-bold ml-auto">
                      ({Math.round(((displayMrp - displayPrice) / displayMrp) * 100)}% OFF)
                    </span>
                  )}
                </>
              )}
            </div>
          );
        })()}
        
        {/* Color Swatches */}
        {uniqueColorData.length > 0 && (
          <div className="flex gap-1 mt-3 mb-4">
            {uniqueColorData.map(([color, hex], idx) => (
              <div 
                key={idx}
                title={color}
                className="w-4 h-4 rounded-full border border-outline-variant/30 cursor-pointer"
                style={{ backgroundColor: hex }}
              />
            ))}
          </div>
        )}
        
        {/* Quick Add Button */}
        <button 
          onClick={(e) => { 
            e.preventDefault(); 
            router.push(targetUrl); 
          }}
          className="w-full mt-auto bg-primary text-on-primary font-body-sm text-body-sm font-bold py-2 rounded shadow-sm hover:bg-primary/90 transition-colors"
        >
          Select Options
        </button>
      </div>
    </Link>
  );
}
