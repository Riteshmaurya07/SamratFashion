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
        <h1 className="font-display-lg text-on-surface mb-4">Your wishlist is empty</h1>
        <p className="text-on-surface-variant mb-8 text-center max-w-md font-body-md">
          Save your favorite items to your wishlist to keep track of them or buy them later.
        </p>
        <Link href="/shop" className="px-8 py-3 bg-primary text-on-primary rounded font-label-caps font-bold transition-transform hover:scale-105 active:scale-95 shadow-md">
          DISCOVER MORE
        </Link>
      </main>
    );
  }

  return (
    <main className="flex-grow w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-8 md:py-12">
      <div className="flex justify-between items-end mb-8 border-b border-outline-variant/20 pb-4">
        <h1 className="font-display-lg text-on-surface">My Wishlist</h1>
        <span className="font-label-caps text-on-surface-variant">{items.length} ITEM{items.length !== 1 ? 'S' : ''}</span>
      </div>
      
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-gutter">
        {items.map((item) => {
          // Map WishlistProduct back to ProductCardProps expected format
          // Wishlist doesn't strictly hold variants for display in the grid,
          // ProductCard expects variants for swatches. We might pass empty variants if not fully populated.
          const product = item.productId as unknown as any;
          return (
            <ProductCard 
              key={product._id} 
              _id={product._id}
              name={product.name}
              slug={product.slug}
              basePrice={product.basePrice}
              mrp={product.mrp}
              discount={product.discount}
              images={product.images}
              isNewArrival={product.isNewArrival}
              isBestSeller={product.isBestSeller}
              variants={product.variants || []}
              averageRating={product.averageRating || 0}
              reviewCount={product.reviewCount || 0}
            />
          );
        })}
      </div>
    </main>
  );
}
