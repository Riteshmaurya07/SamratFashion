"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { HeartCrack } from "lucide-react";
import { useAuthStore } from "@/store/useAuthStore";
import { useWishlistStore } from "@/store/useWishlistStore";
import { ProductCard } from "@/components/catalog/ProductCard";
import { useEffect } from "react";

export default function WishlistPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuthStore();
  const { items, fetchWishlist, isLoading } = useWishlistStore();

  useEffect(() => {
    if (!authLoading) {
      if (!isAuthenticated) {
        router.push("/login?redirect=/account/wishlist");
      } else {
        fetchWishlist();
      }
    }
  }, [isAuthenticated, authLoading, router, fetchWishlist]);

  if (authLoading || (!isAuthenticated && !isLoading)) {
    return (
      <main className="flex-grow w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-20 flex justify-center">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
      </main>
    );
  }

  if (!isLoading && items.length === 0) {
    return (
      <main className="flex-grow w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-24 flex flex-col items-center justify-center">
        <div className="w-24 h-24 bg-surface-container rounded-full flex items-center justify-center mb-6 text-on-surface-variant">
          <HeartCrack className="w-10 h-10" />
        </div>
        <h1 className="font-headline-lg text-2xl sm:text-3xl font-black text-on-surface mb-3 uppercase tracking-tight">YOUR WISHLIST IS EMPTY</h1>
        <p className="text-on-surface-variant mb-8 text-center max-w-md font-body-sm text-sm">
          Save your favorite streetwear drops to your wishlist to track limited graphic releases and oversized cuts.
        </p>
        <Link href="/shop" className="px-8 py-3.5 bg-neutral-900 text-white rounded-md font-mono text-xs font-bold uppercase tracking-wider hover:bg-neutral-800 transition-colors shadow-sm">
          DISCOVER STREETWEAR DROPS
        </Link>
      </main>
    );
  }

  return (
    <main className="flex-grow w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-8 md:py-12">
      <div className="flex justify-between items-baseline mb-8 border-b border-outline-variant/30 pb-4">
        <h1 className="font-headline-lg text-2xl sm:text-3xl font-black text-on-surface uppercase tracking-tight">MY WISHLIST</h1>
        <span className="font-mono text-xs text-neutral-500 font-bold uppercase">{items.length} ITEM{items.length !== 1 ? 'S' : ''}</span>
      </div>
      
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-gutter">
        {items.map((item, idx) => {
          const product = item.productId as unknown as any;

          // Resolve the images for the exact variant the user wishlisted,
          // using the same 4-tier cascade as the PDP gallery:
          //  1. The specific wishlisted variant's images
          //  2. Any variant with the same color that has images  ← fixes the black-shows-white bug
          //     (black variant may have no own images but another black SKU does)
          //  3. Any variant across the product that has images
          let selectedColor: string | undefined;
          let displayImages: string[] = product.images || [];
          if (item.variantId && Array.isArray(product.variants)) {
            // Tier 1: exact variant match
            const wishedVariant = product.variants.find(
              (v: any) => v._id?.toString() === item.variantId || v.sku === item.variantId
            );
            if (wishedVariant?.color) {
              selectedColor = wishedVariant.color;
            }
            if (wishedVariant?.images?.length > 0) {
              displayImages = wishedVariant.images;
            } else if (wishedVariant?.color) {
              // Tier 2: same-color variant
              const sameColorVariant = product.variants.find(
                (v: any) =>
                  v.color?.toLowerCase() === wishedVariant.color?.toLowerCase() &&
                  v.images?.length > 0
              );
              if (sameColorVariant) {
                displayImages = sameColorVariant.images;
              } else {
                // Tier 3: any variant with images
                const anyVariant = product.variants.find((v: any) => v.images?.length > 0);
                if (anyVariant) displayImages = anyVariant.images;
                // Tier 4: product.images already set as default above
              }
            }
          }

          return (
            <ProductCard
              key={`${product._id}-${item.variantId ?? "root"}-${idx}`}
              _id={product._id}
              variantId={item.variantId}
              name={product.name}
              slug={product.slug}
              basePrice={product.basePrice}
              mrp={product.mrp}
              discount={product.discount}
              images={displayImages}
              isNewArrival={product.isNewArrival}
              isBestSeller={product.isBestSeller}
              variants={product.variants || []}
              averageRating={product.averageRating || 0}
              reviewCount={product.reviewCount || 0}
              selectedColor={selectedColor}
            />
          );
        })}
      </div>
    </main>
  );
}
