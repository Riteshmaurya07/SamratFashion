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
          value: summary.total,
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
        <h1 className="font-headline-lg text-2xl sm:text-3xl font-black text-on-surface mb-3 uppercase tracking-tight">YOUR BAG IS EMPTY</h1>
        <p className="text-on-surface-variant mb-8 text-center max-w-md font-body-sm text-sm">
          Looks like you haven&apos;t added any drops to your bag yet. Discover our latest heavyweight oversized tees and streetwear graphics.
        </p>
        <Link href="/shop" className="px-8 py-3.5 bg-neutral-900 text-white rounded-md font-mono text-xs font-bold uppercase tracking-wider hover:bg-neutral-800 transition-colors shadow-sm">
          DISCOVER STREETWEAR DROPS
        </Link>
      </main>
    );
  }

  const handleMoveToWishlist = async (productId: string, variantId: string, cartItemId?: string) => {
    setMovingToWishlist(variantId);
    try {
      if (!isInWishlist(productId, variantId)) {
        await toggleWishlist(productId, variantId);
      }
      await removeItem(productId, variantId, cartItemId);
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
    } catch (err: unknown) {
      let msg = "Invalid coupon code";
      if (err && typeof err === "object" && "message" in err && typeof err.message === "string") {
        msg = err.message;
      }
      setCouponError(msg);
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
    <main className="flex-grow w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-6 sm:py-8 md:py-12 pb-28 lg:pb-12">
      <div className="flex items-baseline justify-between mb-8 border-b border-outline-variant/30 pb-4">
        <h1 className="font-headline-lg text-2xl sm:text-3xl font-black text-on-surface uppercase tracking-tight">SHOPPING BAG</h1>
        <span className="font-mono text-xs text-neutral-500 font-bold uppercase">{items.length} ITEM{items.length !== 1 ? 'S' : ''}</span>
      </div>
      
      <div className="flex flex-col lg:flex-row gap-12">
        {/* Cart Items */}
        <div className="w-full lg:w-2/3 flex flex-col gap-6">
          {items.map((item, idx) => {
            const customHref = item.productId?.slug ? `/custom-printing/${item.productId.slug}` : "/shop";
            const standardHref = item.productId?.slug
              ? `/shop/${item.productId.slug}${item.variantDetails?.color ? `?color=${encodeURIComponent(item.variantDetails.color)}` : ''}`
              : "/shop";
            const itemHref = item.isCustomized ? customHref : standardHref;

            const unitPriceInRupees = item.unitPrice || item.productId?.basePrice || 0;

            return (
              <div key={`${item.productId._id}-${item.variantId}-${idx}`} className={`flex gap-3 sm:gap-6 bg-surface-container-lowest border border-outline-variant/20 rounded-lg p-3 sm:p-4 ${!item.isAvailable ? 'opacity-70' : ''}`}>
                <Link href={itemHref} className="w-20 sm:w-28 md:w-32 aspect-[3/4] relative rounded overflow-hidden shrink-0 bg-surface-container">
                  <Image src={item.isCustomized ? (item.customizationSnapshot?.previewImage || "/placeholder.jpg") : (item.variantDetails?.image || item.productId.images[0] || "/placeholder.jpg")} alt={item.productId.name} fill className="object-cover" />
                </Link>

                {/* Product Info */}
                <div className="flex flex-col flex-grow">
                  <div className="flex justify-between items-start gap-4">
                    <Link href={itemHref} className="font-headline-sm text-on-surface hover:text-primary transition-colors line-clamp-2">
                      {item.productId.name} {item.isCustomized && "(Custom)"}
                    </Link>
                    <span className="font-price-lg text-on-surface whitespace-nowrap">
                      ₹{unitPriceInRupees.toLocaleString("en-IN")} {item.isCustomized && <span className="text-xs font-normal text-on-surface-variant">/pc</span>}
                    </span>
                  </div>
                  
                  <div className="text-sm text-on-surface-variant mt-1 space-y-1">
                    {item.isCustomized && item.customConfigurations ? (
                      item.customConfigurations.map((config: any, cIdx: number) => (
                        <div key={cIdx} className="flex flex-col gap-1 mt-2">
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
                          href={itemHref}
                          className="text-primary text-xs font-bold uppercase hover:underline"
                        >
                          View Item Details
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
                    <div className="flex items-center gap-3 text-xs font-mono">
                      <button 
                        disabled={isLoading || movingToWishlist === item.variantId}
                        onClick={() => handleMoveToWishlist(item.productId._id, item.variantId, item._id)}
                        className="flex items-center gap-1.5 text-on-surface-variant hover:text-primary transition-colors disabled:opacity-50 py-1.5 px-2 rounded-md hover:bg-surface-container"
                      >
                        <Heart className="w-3.5 h-3.5" /> 
                        <span>{movingToWishlist === item.variantId ? 'MOVING...' : 'WISHLIST'}</span>
                      </button>
                      <button 
                        disabled={isLoading}
                        onClick={() => removeItem(item.productId._id, item.variantId, item._id)}
                        className="flex items-center gap-1.5 text-on-surface-variant hover:text-error transition-colors disabled:opacity-50 py-1.5 px-2 rounded-md hover:bg-surface-container"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> 
                        <span>REMOVE</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
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
                <span className="font-bold text-on-surface">
                  ₹{Math.round(summary.subtotal).toLocaleString("en-IN")}
                </span>
              </div>
              {summary.discount > 0 && (
                <div className="flex justify-between text-primary">
                  <span>Coupon Discount</span>
                  <span className="font-bold">
                    -₹{Math.round(summary.discount).toLocaleString("en-IN")}
                  </span>
                </div>
              )}
              <div className="flex justify-between text-on-surface-variant">
                <span>Shipping</span>
                <span className="font-bold text-on-surface">
                  {summary.shipping === 0 ? "Free" : `₹${Math.round(summary.shipping).toLocaleString("en-IN")}`}
                </span>
              </div>
              <div className="flex justify-between text-on-surface-variant border-t border-outline-variant/20 pt-4 mt-4">
                <span className="font-bold text-base text-on-surface">Total</span>
                <span className="font-price-lg text-lg text-on-surface">
                  ₹{Math.round(summary.total).toLocaleString("en-IN")}
                </span>
              </div>
              <p className="text-xs text-on-surface-variant/70 text-right">(Inclusive of all taxes)</p>
            </div>

            <button 
              onClick={() => router.push('/checkout')}
              disabled={isLoading || items.some(i => !i.isAvailable)}
              className="w-full h-12 bg-neutral-900 text-white font-mono text-xs uppercase tracking-wider font-bold rounded-md shadow-sm hover:bg-neutral-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed mb-4 flex items-center justify-center"
            >
              PROCEED TO CHECKOUT &rarr;
            </button>

            <div className="flex items-center gap-2 text-xs text-on-surface-variant/80 justify-center">
              <ShieldCheck className="w-4 h-4" />
              <span>100% Secure Checkout</span>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Sticky Checkout Action Bar */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-surface/95 backdrop-blur-md border-t border-outline-variant/30 p-3 px-4 shadow-[0_-8px_24px_rgba(0,0,0,0.08)] lg:hidden pb-safe">
        <div className="flex items-center justify-between gap-4 max-w-md mx-auto">
          <div>
            <p className="font-mono text-[10px] text-neutral-500 uppercase">Subtotal</p>
            <p className="font-price-lg text-lg font-black text-on-surface">
              ₹{Math.round(summary.total).toLocaleString("en-IN")}
            </p>
          </div>
          <button
            onClick={() => router.push('/checkout')}
            disabled={isLoading || items.some((i) => !i.isAvailable)}
            className="flex-1 max-w-[220px] h-11 bg-neutral-900 text-white font-mono text-xs uppercase tracking-wider font-bold rounded-lg shadow-sm hover:bg-neutral-800 active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            <span>CHECKOUT</span>
            <span>&rarr;</span>
          </button>
        </div>
      </div>
    </main>
  );
}
