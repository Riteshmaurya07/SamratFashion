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
}: ProductCardProps) {
  const primaryImage = images[0] || "https://images.unsplash.com/photo-1523381210434-271e8be1f52b?q=80&w=2070&auto=format&fit=crop";
  const secondaryImage = images[1] || primaryImage;

  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const { isInWishlist, toggleWishlist } = useWishlistStore();
  const [isWishlistLoading, setIsWishlistLoading] = useState(false);

  const isWishlisted = isInWishlist(_id);

  const handleWishlistToggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!isAuthenticated) {
      router.push(`/login?redirect=/shop/${slug}`);
      return;
    }
    setIsWishlistLoading(true);
    try {
      await toggleWishlist(_id);
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

  return (
    <Link href={`/shop/${slug}`} className="group flex flex-col relative product-card-hover cursor-pointer h-full">
      {/* Image Container */}
      <div className="relative aspect-[3/4] bg-surface-container-low overflow-hidden rounded mb-4 border border-outline-variant/10">
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
          className="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center bg-surface-container-lowest/80 backdrop-blur rounded-full text-on-surface shadow-sm hover:text-secondary hover:scale-110 transition-all duration-200 disabled:opacity-50"
        >
          <Heart className={`w-4 h-4 ${isWishlisted ? "fill-secondary text-secondary" : ""}`} />
        </button>
        
        {/* Quick Add (Hover) */}
        <div className="absolute bottom-0 left-0 w-full p-3 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-in-out z-10">
          <button 
            onClick={(e) => { 
              e.preventDefault(); 
              router.push(`/shop/${slug}`); 
            }}
            className="w-full bg-primary/90 backdrop-blur text-on-primary font-body-sm text-body-sm font-bold py-2 rounded shadow-sm hover:bg-primary transition-colors"
          >
            Select Options
          </button>
        </div>
      </div>
      
      {/* Details */}
      <div className="flex flex-col flex-grow">
        <div className="flex justify-between items-start mb-1">
          <h4 className="font-body-md text-body-md font-bold text-on-surface truncate pr-2">{name}</h4>
          <div className="flex items-center gap-1 text-on-surface-variant shrink-0">
            <Star className="w-3.5 h-3.5 fill-primary text-primary" />
            <span className="font-mono text-[12px]">{averageRating.toFixed(1)}</span>
          </div>
        </div>
        
        <p className="font-body-sm text-body-sm text-on-surface-variant mb-2 truncate">
          {/* Typically description preview or tags here. Using mock for now since API might not have this specifically separated. */}
          Heavyweight Cotton • Comfort Fit
        </p>
        
        <div className="mt-auto flex items-center gap-2 font-mono">
          <span className="font-bold text-on-surface text-[16px]">₹{basePrice.toLocaleString()}</span>
          {mrp && mrp > basePrice && (
            <>
              <span className="text-on-surface-variant text-[12px] line-through">₹{mrp.toLocaleString()}</span>
              {discount ? (
                <span className="text-secondary text-[12px] font-bold ml-auto">({discount}% OFF)</span>
              ) : (
                <span className="text-secondary text-[12px] font-bold ml-auto">
                  ({Math.round(((mrp - basePrice) / mrp) * 100)}% OFF)
                </span>
              )}
            </>
          )}
        </div>
        
        {/* Color Swatches */}
        {uniqueColorData.length > 0 && (
          <div className="flex gap-1 mt-3">
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
      </div>
    </Link>
  );
}
