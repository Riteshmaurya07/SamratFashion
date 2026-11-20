"use client";

import Link from "next/link";
import { HeartCrack } from "lucide-react";
import { useAuthStore } from "@/store/useAuthStore";
import { useWishlistStore } from "@/store/useWishlistStore";
import { ProductCard } from "@/components/catalog/ProductCard";
import { SignInRequiredState } from "@/components/auth/SignInRequiredState";
import { AccountNav } from "@/components/account/AccountNav";
import { useEffect } from "react";

export default function WishlistPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuthStore();
  const { items, fetchWishlist, isLoading } = useWishlistStore();

  useEffect(() => {
    if (!authLoading && isAuthenticated) {
      fetchWishlist();
    }
  }, [isAuthenticated, authLoading, fetchWishlist]);

  if (authLoading) {
    return (
      <main className="flex-grow w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop pt-4 sm:pt-6 md:pt-6 pb-12 sm:pb-16 lg:pb-10">
        <div className="w-full max-w-5xl mx-auto flex flex-col pb-8 sm:pb-12 lg:pb-8">
          <AccountNav currentTab="wishlist" />
          <div className="py-20 flex justify-center">
            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        </div>
      </main>
    );
  }

  if (!isAuthenticated) {
    return <SignInRequiredState context="wishlist" redirectPath="/account/wishlist" />;
  }

  return (
    <main className="flex-grow w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop pt-4 sm:pt-6 md:pt-6 pb-12 sm:pb-16 lg:pb-10">
      <div className="w-full max-w-5xl mx-auto flex flex-col pb-8 sm:pb-12 lg:pb-8">
        <AccountNav currentTab="wishlist" activeCount={items.length} />

        {/* Header Section */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 mb-6 sm:mb-8 pb-6 border-b border-outline-variant/40">
          <div>
            <div className="flex items-center gap-3 mb-1.5 flex-wrap">
              <h1 className="font-headline-lg text-2xl sm:text-3xl lg:text-4xl font-black text-on-surface uppercase tracking-tight">
                MY WISHLIST
              </h1>
              {!isLoading && items.length > 0 && (
                <span className="bg-surface-container-high text-on-surface font-mono text-[11px] font-bold uppercase px-2.5 py-0.5 rounded-md">
                  {items.length} {items.length === 1 ? "Item" : "Items"}
                </span>
              )}
            </div>
            {items.length > 0 && (
              <p className="font-body-md text-xs sm:text-sm text-on-surface-variant max-w-xl leading-relaxed">
                Save your favorite pieces to track availability, size restocks, and new tailored arrivals.
              </p>
            )}
          </div>
        </div>

        {/* Empty State Card (Keeps AccountNav intact!) */}
        {!isLoading && items.length === 0 ? (
          <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-2xl p-8 sm:p-12 text-center flex flex-col items-center justify-center max-w-xl mx-auto my-6 shadow-2xs">
            <div className="w-20 h-20 bg-surface-container rounded-full flex items-center justify-center mb-5 text-on-surface-variant">
              <HeartCrack className="w-9 h-9" />
            </div>
            <h2 className="font-headline-lg text-xl sm:text-2xl font-black text-on-surface mb-2 uppercase tracking-tight">
              YOUR WISHLIST IS EMPTY
            </h2>
            <p className="text-on-surface-variant mb-6 text-center text-xs sm:text-sm font-body-sm leading-relaxed max-w-md">
              Save your favorite pieces to your wishlist to track availability, size restocks, and new tailored arrivals.
            </p>
            <Link
              href="/shop"
              className="px-8 py-3.5 bg-neutral-900 text-white rounded-lg font-mono text-xs font-bold uppercase tracking-wider hover:bg-neutral-800 transition-colors shadow-xs"
            >
              EXPLORE COLLECTION
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 md:gap-6">
            {items.map((item, idx) => {
              const product = item.productId as unknown as any;

              // Resolve the images for the exact variant the user wishlisted,
              // using the same 4-tier cascade as the PDP gallery:
              let selectedColor: string | undefined;
              let displayImages: string[] = product.images || [];
              if (item.variantId && Array.isArray(product.variants)) {
                const wishedVariant = product.variants.find(
                  (v: any) => v._id?.toString() === item.variantId || v.sku === item.variantId
                );
                if (wishedVariant?.color) {
                  selectedColor = wishedVariant.color;
                }
                if (wishedVariant?.images?.length > 0) {
                  displayImages = wishedVariant.images;
                } else if (wishedVariant?.color) {
                  const sameColorVariant = product.variants.find(
                    (v: any) =>
                      v.color?.toLowerCase() === wishedVariant.color?.toLowerCase() &&
                      v.images?.length > 0
                  );
                  if (sameColorVariant) {
                    displayImages = sameColorVariant.images;
                  } else {
                    const anyVariant = product.variants.find((v: any) => v.images?.length > 0);
                    if (anyVariant) displayImages = anyVariant.images;
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
                  freeDelivery={product.freeDelivery}
                  variants={product.variants || []}
                  averageRating={product.averageRating || 0}
                  reviewCount={product.reviewCount || 0}
                  selectedColor={selectedColor}
                  tags={product.tags}
                />
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
