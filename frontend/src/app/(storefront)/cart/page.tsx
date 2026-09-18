"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Trash2, ShoppingBag, ShieldCheck, Heart } from "lucide-react";
import { useCartStore } from "@/store/useCartStore";
import { useAuthStore } from "@/store/useAuthStore";
import { useWishlistStore } from "@/store/useWishlistStore";
import { useEffect, useState } from "react";

export default function CartPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuthStore();
  const { items, summary, coupon, isLoading, updateQuantity, removeItem, applyCoupon, removeCoupon } = useCartStore();
  const { toggleWishlist, isInWishlist } = useWishlistStore();
  
  const [movingToWishlist, setMovingToWishlist] = useState<string | null>(null);
  const [couponCodeInput, setCouponCodeInput] = useState("");
  const [couponError, setCouponError] = useState("");
  const [couponLoading, setCouponLoading] = useState(false);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push("/login?redirect=/cart");
    }
  }, [isAuthenticated, authLoading, router]);

  // Track view_cart event on mount
  useEffect(() => {
    if (items && items.length > 0) {
      import("@/lib/analytics").then(({ trackEvent }) => {
        trackEvent("view_cart", {
          currency: "INR",
          value: summary.total / 100,
          item_count: items.length,
        });
      });
    }
  }, [items, summary.total]);

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
          <ShoppingBag className="w-10 h-10" />
        </div>
        <h1 className="font-display-lg text-on-surface mb-4">Your bag is empty</h1>
        <p className="text-on-surface-variant mb-8 text-center max-w-md font-body-md">
          Looks like you haven&apos;t added anything to your bag yet. Discover our latest drops and find your vibe.
        </p>
        <Link href="/shop" className="px-8 py-3 bg-primary text-on-primary rounded font-label-caps font-bold transition-transform hover:scale-105 active:scale-95 shadow-md">
          START SHOPPING
        </Link>
      </main>
    );
  }

  const handleMoveToWishlist = async (productId: string, variantId: string) => {
    setMovingToWishlist(variantId);
    try {
      if (!isInWishlist(productId, variantId)) {
        await toggleWishlist(productId, variantId);
      }
      await removeItem(productId, variantId);
    } catch (error) {
      console.error("Failed to move to wishlist", error);
    } finally {
      setMovingToWishlist(null);
    }
  };

  const handleApplyCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!couponCodeInput.trim()) return;
    setCouponLoading(true);
    setCouponError("");
    try {
      await applyCoupon(couponCodeInput.trim());
      setCouponCodeInput("");
    } catch (err: any) {
      setCouponError(err.message || "Invalid coupon");
    } finally {
      setCouponLoading(false);
    }
  };

  const handleRemoveCoupon = async () => {
    setCouponLoading(true);
    try {
      await removeCoupon();
    } catch (err) {} finally {
      setCouponLoading(false);
    }
  };

  return (
    <main className="flex-grow w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-8 md:py-12">
      <h1 className="font-display-lg text-on-surface mb-8">Shopping Bag</h1>
      
      <div className="flex flex-col lg:flex-row gap-12">
        {/* Cart Items */}
        <div className="w-full lg:w-2/3 flex flex-col gap-6">
          {items.map((item) => (
            <div key={`${item.productId._id}-${item.variantId}`} className={`flex gap-4 md:gap-6 bg-surface-container-lowest border border-outline-variant/20 rounded-lg p-4 ${!item.isAvailable ? 'opacity-70' : ''}`}>
              <Link href={item.isCustomized ? `/custom-designer?designId=${item.customConfigurations?.[0]?.designId}` : `/shop/${item.productId.slug}${item.variantDetails?.color ? `?color=${encodeURIComponent(item.variantDetails.color)}` : ''}`} className="w-24 md:w-32 aspect-[3/4] relative rounded overflow-hidden shrink-0 bg-surface-container">
                <Image src={item.isCustomized ? (item.customizationSnapshot?.previewImage || "/placeholder.jpg") : (item.variantDetails?.image || item.productId.images[0] || "/placeholder.jpg")} alt={item.productId.name} fill className="object-cover" />
              </Link>

              {/* Product Info */}
              <div className="flex flex-col flex-grow">
                <div className="flex justify-between items-start gap-4">
                  <Link href={item.isCustomized ? `/custom-designer?designId=${item.customConfigurations?.[0]?.designId}` : `/shop/${item.productId.slug}${item.variantDetails?.color ? `?color=${encodeURIComponent(item.variantDetails.color)}` : ''}`} className="font-headline-sm text-on-surface hover:text-primary transition-colors line-clamp-2">
                    {item.productId.name} {item.isCustomized && "(Custom)"}
                  </Link>
                  <span className="font-price-lg text-on-surface whitespace-nowrap">
                    ₹{item.unitPrice.toLocaleString()} {item.isCustomized && <span className="text-xs font-normal text-on-surface-variant">/pc</span>}
                  </span>
                </div>
                
                <div className="text-sm text-on-surface-variant mt-1 space-y-1">
                  {item.isCustomized && item.customConfigurations ? (
                    item.customConfigurations.map((config: any, idx: number) => (
                      <div key={idx} className="flex flex-col gap-1 mt-2">
                        <p className="font-bold text-on-surface">Color: {config.color}</p>
                        <p className="text-xs">Sizes: {config.sizeDistribution.map((d: any) => `${d.size} (${d.quantity})`).join(', ')}</p>
                      </div>
                    ))
                  ) : (
                    <>
                      {item.variantDetails?.color && <p>Color: {item.variantDetails.color}</p>}
                      {item.variantDetails?.size && <p>Size: {item.variantDetails.size}</p>}
                    </>
                  )}
                  {!item.isAvailable && <p className="text-error font-bold mt-1">Out of stock</p>}
                </div>

                <div className="mt-auto pt-4 flex flex-wrap justify-between items-end gap-4">
                  {/* Quantity */}
                  {item.isCustomized ? (
                    <div className="flex flex-col gap-1">
                      <span className="font-bold text-on-surface text-sm">Total Qty: {item.quantity}</span>
                      <Link 
                        href={`/custom-designer?designId=${item.customConfigurations?.[0]?.designId}`}
                        className="text-primary text-xs font-bold uppercase hover:underline"
                      >
                        Edit Sizes & Design
                      </Link>
                    </div>
                  ) : (
                    <div className="flex items-center border border-outline-variant/50 rounded h-10 bg-surface-container-lowest">
                      <button 
                        disabled={isLoading || !item.isAvailable || item.quantity <= 1}
                        onClick={() => updateQuantity(item.productId._id, item.variantId, item.quantity - 1)}
                        className="px-3 text-on-surface-variant hover:text-primary disabled:opacity-30 h-full"
                      >-</button>
                      <span className="font-bold text-on-surface text-sm px-2 min-w-[2rem] text-center">{item.quantity}</span>
                      <button 
                        disabled={isLoading || !item.isAvailable || item.quantity >= item.variantDetails.stock}
                        onClick={() => updateQuantity(item.productId._id, item.variantId, item.quantity + 1)}
                        className="px-3 text-on-surface-variant hover:text-primary disabled:opacity-30 h-full"
                      >+</button>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-4 text-sm font-label-caps">
                    <button 
                      disabled={isLoading || movingToWishlist === item.variantId}
                      onClick={() => handleMoveToWishlist(item.productId._id, item.variantId)}
                      className="flex items-center gap-1 text-on-surface-variant hover:text-primary transition-colors disabled:opacity-50"
                    >
                      <Heart className="w-4 h-4" /> 
                      <span className="hidden sm:inline">{movingToWishlist === item.variantId ? 'MOVING...' : 'MOVE TO WISHLIST'}</span>
                    </button>
                    <button 
                      disabled={isLoading}
                      onClick={() => removeItem(item.productId._id, item.variantId)}
                      className="flex items-center gap-1 text-on-surface-variant hover:text-error transition-colors disabled:opacity-50"
                    >
                      <Trash2 className="w-4 h-4" /> 
                      <span className="hidden sm:inline">REMOVE</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Order Summary */}
        <div className="w-full lg:w-1/3">
          <div className="bg-surface-container-lowest border border-outline-variant/20 rounded-lg p-6 sticky top-24">
            <h2 className="font-headline-sm text-on-surface mb-6">Order Summary</h2>

            {/* Coupon Code Box */}
            <div className="mb-6 pb-6 border-b border-outline-variant/20">
              <label className="block font-label-caps text-xs font-bold text-on-surface mb-2 uppercase">Promo / Coupon Code</label>
              {coupon ? (
                <div className="flex items-center justify-between bg-primary-container/20 border border-primary/30 p-3 rounded text-sm">
                  <div>
                    <span className="font-bold text-primary font-mono">{coupon.code}</span>
                    <p className="text-xs text-on-surface-variant">Discount applied</p>
                  </div>
                  <button onClick={handleRemoveCoupon} disabled={couponLoading} className="text-xs text-error font-label-caps hover:underline">
                    REMOVE
                  </button>
                </div>
              ) : (
                <form onSubmit={handleApplyCoupon} className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Enter code (e.g. SUMMER30)"
                    value={couponCodeInput}
                    onChange={(e) => setCouponCodeInput(e.target.value.toUpperCase())}
                    className="flex-1 bg-surface border border-outline-variant/50 rounded px-3 py-2 text-sm font-mono uppercase focus:outline-none focus:border-primary"
                  />
                  <button type="submit" disabled={couponLoading || !couponCodeInput.trim()} className="px-4 bg-surface-container-high border border-outline-variant rounded font-label-caps text-xs font-bold text-on-surface hover:bg-primary hover:text-on-primary transition-colors disabled:opacity-40">
                    APPLY
                  </button>
                </form>
              )}
              {couponError && <p className="text-xs text-error mt-2 font-body-sm">{couponError}</p>}
            </div>
            
            <div className="space-y-4 text-sm mb-6">
              <div className="flex justify-between text-on-surface-variant">
                <span>Subtotal</span>
                <span className="font-bold text-on-surface">₹{summary.subtotal.toLocaleString()}</span>
              </div>
              {summary.discount > 0 && (
                <div className="flex justify-between text-primary">
                  <span>Coupon Discount</span>
                  <span className="font-bold">-₹{summary.discount.toLocaleString()}</span>
                </div>
              )}
              <div className="flex justify-between text-on-surface-variant">
                <span>Shipping</span>
                <span className="font-bold text-on-surface">{summary.shipping === 0 ? "Free" : `₹${summary.shipping}`}</span>
              </div>
              <div className="flex justify-between text-on-surface-variant border-t border-outline-variant/20 pt-4 mt-4">
                <span className="font-bold text-base text-on-surface">Total</span>
                <span className="font-price-lg text-lg text-on-surface">₹{summary.total.toLocaleString()}</span>
              </div>
              <p className="text-xs text-on-surface-variant/70 text-right">(Inclusive of all taxes)</p>
            </div>

            <button 
              onClick={() => router.push('/checkout')}
              disabled={isLoading || items.some(i => !i.isAvailable)}
              className="w-full h-14 bg-primary text-on-primary font-label-caps font-bold text-[14px] rounded shadow-md hover:bg-primary/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed mb-4 flex items-center justify-center"
            >
              PROCEED TO CHECKOUT
            </button>

            <div className="flex items-center gap-2 text-xs text-on-surface-variant/80 justify-center">
              <ShieldCheck className="w-4 h-4" />
              <span>100% Secure Checkout</span>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
