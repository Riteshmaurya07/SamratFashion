"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Copy, Sparkles, Tag, ArrowRight } from "lucide-react";

interface CampaignItem {
  _id?: string;
  name: string;
  slug?: string;
  description?: string;
  discountTag?: string;
  couponId?: {
    code?: string;
    discountType?: string;
    discountValue?: number;
    minOrderValue?: number;
  };
}

interface BannerItem {
  _id?: string;
  title: string;
  subtitle?: string;
  image: string;
  ctaLabel?: string;
  ctaUrl?: string;
  position?: string;
}

interface CategoryItem {
  _id: string;
  name: string;
  slug: string;
  image?: string;
}

interface OffersClientProps {
  campaigns: CampaignItem[];
  banners: BannerItem[];
  categories: CategoryItem[];
}

export default function OffersClient({
  campaigns,
  banners,
  categories,
}: OffersClientProps) {
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => {
      setCopiedCode(null);
    }, 2500);
  };

  const promoBanners = banners.filter(
    (b) => b.position === "PROMOTIONAL_TILE" || b.position === "FEATURED_BANNER" || b.position === "HERO"
  );

  return (
    <div className="w-full flex flex-col items-center pb-28 lg:pb-16">
      {/* Header Banner */}
      <section className="w-full bg-neutral-950 text-white py-14 sm:py-20 border-b border-neutral-800">
        <div className="max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop text-center space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 text-white/90 border border-white/20 font-mono text-[11px] uppercase font-bold">
            <Sparkles className="w-3.5 h-3.5" />
            OFFICIAL SAMRAT FASHION PROMOTIONS
          </div>
          <h1 className="font-headline-lg text-3xl sm:text-5xl md:text-6xl font-black uppercase tracking-tight text-white">
            EXCLUSIVE OFFERS &amp; DEALS
          </h1>
          <p className="font-body-md text-sm sm:text-base text-neutral-400 max-w-2xl mx-auto leading-relaxed">
            Discover active coupon vouchers, seasonal capsule markdowns, and complimentary shipping on 240+ GSM heavyweight streetwear drops.
          </p>
        </div>
      </section>

      <div className="w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-12 space-y-16">
        {/* Active Campaigns Section */}
        <section className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 border-b border-outline-variant/30 pb-4">
            <div>
              <h2 className="font-headline-lg text-2xl sm:text-3xl font-black text-on-surface uppercase tracking-tight">
                ACTIVE DISCOUNT CAMPAIGNS
              </h2>
            </div>
            <span className="font-mono text-xs text-on-surface-variant uppercase">
              {campaigns.length > 0 ? `${campaigns.length} Active Offers` : "Special Promo Active"}
            </span>
          </div>

          {campaigns.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {campaigns.map((camp) => {
                const code = camp.couponId?.code;
                const isCopied = code && copiedCode === code;

                return (
                  <div
                    key={camp._id || camp.name}
                    className="bg-surface-container-lowest border border-outline-variant/40 rounded-2xl p-6 sm:p-8 shadow-sm flex flex-col justify-between relative overflow-hidden group hover:border-primary/50 transition-all"
                  >
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        {camp.discountTag ? (
                          <span className="px-3 py-1 rounded-full bg-primary/10 text-primary font-mono text-xs font-black uppercase tracking-wider">
                            {camp.discountTag}
                          </span>
                        ) : (
                          <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 font-mono text-xs font-bold uppercase tracking-wider">
                            SPECIAL SAVINGS
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1 font-mono text-[10px] text-on-surface-variant font-bold uppercase">
                          <Tag className="w-3 h-3 text-primary" /> Verified
                        </span>
                      </div>

                      <h3 className="font-headline-sm text-xl sm:text-2xl font-black uppercase text-on-surface tracking-tight">
                        {camp.name}
                      </h3>

                      {camp.description && (
                        <p className="text-xs sm:text-sm text-on-surface-variant leading-relaxed">
                          {camp.description}
                        </p>
                      )}

                      {camp.couponId && (
                        <div className="pt-2 text-xs font-mono text-on-surface-variant space-y-1">
                          {camp.couponId.discountValue && (
                            <p className="text-primary font-bold">
                              Discount: {camp.couponId.discountType === "PERCENTAGE" ? `${camp.couponId.discountValue}% OFF` : `₹${camp.couponId.discountValue} OFF`}
                            </p>
                          )}
                          {camp.couponId.minOrderValue ? (
                            <p>Minimum Order: ₹{camp.couponId.minOrderValue}</p>
                          ) : null}
                        </div>
                      )}
                    </div>

                    <div className="pt-6 mt-6 border-t border-outline-variant/30 flex flex-wrap items-center justify-between gap-3">
                      {code ? (
                        <button
                          type="button"
                          onClick={() => handleCopyCode(code)}
                          className={`px-4 py-2 rounded-xl font-mono text-xs font-bold uppercase tracking-wider flex items-center gap-2 transition-all ${
                            isCopied
                              ? "bg-emerald-600 text-white"
                              : "bg-surface-container-high text-on-surface hover:bg-primary hover:text-white"
                          }`}
                        >
                          {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                          <span>{isCopied ? "CODE COPIED!" : `CODE: ${code}`}</span>
                        </button>
                      ) : (
                        <span className="font-mono text-xs text-on-surface-variant uppercase font-semibold">
                          Automatic Discount
                        </span>
                      )}

                      <Link
                        href="/shop"
                        className="inline-flex items-center gap-1.5 px-5 py-2.5 bg-primary text-white font-mono text-xs uppercase font-bold rounded-xl hover:bg-primary/90 transition-colors shadow-sm"
                      >
                        <span>SHOP NOW</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="bg-surface-container-lowest border border-outline-variant/40 rounded-2xl p-8 sm:p-12 text-center space-y-4">
              <span className="inline-block p-3 rounded-full bg-primary/10 text-primary">
                <Tag className="w-6 h-6" />
              </span>
              <h3 className="font-headline-sm text-xl font-black uppercase text-on-surface">
                STANDARD COMPLIMENTARY SHIPPING DROP
              </h3>
              <p className="text-sm text-on-surface-variant max-w-md mx-auto">
                All domestic orders above ₹999 qualify for complimentary expedited Delhivery Express courier dispatch.
              </p>
              <Link
                href="/shop"
                className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-white font-mono text-xs uppercase font-bold rounded-xl hover:bg-primary/90 transition-colors"
              >
                <span>EXPLORE ALL STREETWEAR</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          )}
        </section>

        {/* Promotional Banners Showcase */}
        {promoBanners.length > 0 && (
          <section className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 border-b border-outline-variant/30 pb-4">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary font-bold">FEATURED DROPS</p>
                <h2 className="font-headline-lg text-2xl sm:text-3xl font-black text-on-surface uppercase tracking-tight">
                  PROMOTIONAL SHOWCASE
                </h2>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {promoBanners.map((b) => (
                <div
                  key={b._id || b.title}
                  className="group relative h-80 rounded-2xl overflow-hidden border border-neutral-800 bg-neutral-900 flex flex-col justify-end p-6"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={b.image}
                    alt={b.title}
                    className="absolute inset-0 w-full h-full object-cover opacity-60 group-hover:scale-105 group-hover:opacity-75 transition-all duration-700"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-neutral-950 via-neutral-950/40 to-transparent"></div>
                  <div className="relative z-10 space-y-2">
                    <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary font-bold">
                      {b.position || "CURATED DROP"}
                    </span>
                    <h3 className="font-headline-sm text-xl font-black uppercase text-white tracking-tight">
                      {b.title}
                    </h3>
                    {b.subtitle && (
                      <p className="text-neutral-300 text-xs line-clamp-2">{b.subtitle}</p>
                    )}
                    <Link
                      href={b.ctaUrl || "/shop"}
                      className="inline-flex items-center gap-1 font-mono text-xs text-primary group-hover:text-white transition-colors uppercase pt-2 font-bold"
                    >
                      {b.ctaLabel || "EXPLORE COLLECTION"} &rarr;
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* How to Redeem Offers Guide */}
        <section className="bg-surface-container-lowest border border-outline-variant/30 rounded-2xl p-6 sm:p-10 space-y-6">
          <h2 className="font-headline-sm text-xl sm:text-2xl font-black uppercase text-on-surface tracking-tight">
            HOW TO REDEEM DISCOUNT CODES
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-2">
              <span className="font-mono text-2xl font-black text-primary">01</span>
              <h4 className="font-bold text-sm uppercase text-on-surface">Copy Voucher Code</h4>
              <p className="text-xs text-on-surface-variant leading-relaxed">
                Click on the voucher badge above to copy the active discount coupon to your clipboard.
              </p>
            </div>
            <div className="space-y-2">
              <span className="font-mono text-2xl font-black text-primary">02</span>
              <h4 className="font-bold text-sm uppercase text-on-surface">Curate Your Bag</h4>
              <p className="text-xs text-on-surface-variant leading-relaxed">
                Add heavyweight tees, hoodies, or streetwear bottoms meeting the minimum order threshold.
              </p>
            </div>
            <div className="space-y-2">
              <span className="font-mono text-2xl font-black text-primary">03</span>
              <h4 className="font-bold text-sm uppercase text-on-surface">Apply at Checkout</h4>
              <p className="text-xs text-on-surface-variant leading-relaxed">
                Paste the promo code into the coupon field in your cart or checkout summary for instant deduction.
              </p>
            </div>
          </div>
        </section>

        {/* Shop By Curated Categories */}
        {categories.length > 0 && (
          <section className="space-y-6">
            <div className="flex justify-between items-end border-b border-outline-variant/30 pb-4">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary font-bold">ELIGIBLE DROPS</p>
                <h2 className="font-headline-lg text-2xl sm:text-3xl font-black text-on-surface uppercase tracking-tight">
                  SHOP BY CAPSULE
                </h2>
              </div>
              <Link href="/shop" className="font-mono text-xs text-primary hover:underline uppercase font-bold">
                View All &rarr;
              </Link>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {categories.slice(0, 8).map((cat) => (
                <Link
                  key={cat._id}
                  href={`/shop?category=${encodeURIComponent(cat.slug)}`}
                  className="p-5 rounded-2xl bg-surface-container-lowest border border-outline-variant/30 hover:border-primary/50 transition-all flex flex-col justify-between group shadow-sm"
                >
                  <div>
                    <span className="font-mono text-[10px] text-primary uppercase font-bold tracking-wider">
                      CAPSULE
                    </span>
                    <h4 className="font-headline-sm text-base font-bold text-on-surface group-hover:text-primary transition-colors mt-1">
                      {cat.name}
                    </h4>
                  </div>
                  <span className="font-mono text-xs text-on-surface-variant group-hover:text-primary transition-colors mt-4 flex items-center gap-1">
                    Explore &rarr;
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
