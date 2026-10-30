"use client";

import { useState } from "react";
import Link from "next/link";
import { Copy, Check, ArrowRight, Tag } from "lucide-react";

export interface CampaignItem {
  _id?: string;
  name: string;
  discountTag?: string;
  description?: string;
  couponId?: {
    code?: string;
    discountValue?: number;
    discountType?: string;
  };
}

interface InteractiveCampaignCardsProps {
  campaigns: CampaignItem[];
  className?: string;
}

export function InteractiveCampaignCards({
  campaigns = [],
  className = "",
}: InteractiveCampaignCardsProps) {
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const handleCopy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      setTimeout(() => {
        setCopiedCode(null);
      }, 2000);
    } catch {
      // Fallback
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2000);
    }
  };

  if (!campaigns || campaigns.length === 0) {
    return (
      <div className="bg-gradient-to-br from-neutral-950 via-neutral-900 to-neutral-950 rounded-2xl p-6 sm:p-8 md:p-12 border border-neutral-800 text-white relative overflow-hidden flex flex-col md:flex-row items-start md:items-center justify-between gap-6 md:gap-8">
        <div className="space-y-3 max-w-xl z-10">
          <div className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-neutral-400 font-semibold">
            <Tag className="w-3.5 h-3.5 text-neutral-400" />
            <span>LIMITED CAPSULES &amp; VOUCHERS</span>
          </div>
          <h3 className="font-headline-lg text-2xl md:text-3xl font-black uppercase tracking-tight">
            SEASON OFFERS &amp; DISCOUNTS
          </h3>
          <p className="text-neutral-300 text-xs sm:text-sm leading-relaxed">
            Explore exclusive promotional codes, seasonal discounts, and free shipping over ₹999 on all heavyweight 240+ GSM streetwear capsules.
          </p>
        </div>
        <div className="z-10 w-full sm:w-auto shrink-0 flex flex-col sm:flex-row gap-3">
          <Link
            href="/offers"
            className="w-full sm:w-auto px-8 py-4 bg-white text-neutral-950 font-mono text-xs uppercase font-bold tracking-wider rounded-md hover:bg-neutral-200 transition-colors inline-flex items-center justify-center text-center min-h-[44px]"
          >
            EXPLORE OFFERS &rarr;
          </Link>
          <Link
            href="/shop"
            className="w-full sm:w-auto px-8 py-4 bg-neutral-900 border border-neutral-700 text-white font-mono text-xs uppercase font-bold tracking-wider rounded-md hover:bg-white hover:text-neutral-950 transition-colors inline-flex items-center justify-center text-center min-h-[44px]"
          >
            SHOP DROPS
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${className}`}>
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
        <div>
          <h3 className="font-headline-lg text-2xl md:text-3xl font-black text-on-surface uppercase tracking-tight">
            ACTIVE OFFERS &amp; PROMOS
          </h3>
        </div>
        <Link
          href="/offers"
          className="font-mono text-xs text-on-surface hover:text-neutral-600 font-bold uppercase tracking-wider flex items-center gap-1.5"
        >
          <span>View All Deals</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
        {campaigns.slice(0, 2).map((camp) => {
          const couponCode = camp.couponId?.code;
          const isCopied = couponCode && copiedCode === couponCode;

          return (
            <div
              key={camp._id || camp.name}
              className="bg-neutral-950 text-white p-6 sm:p-8 rounded-2xl border border-neutral-800 relative overflow-hidden flex flex-col justify-between streetwear-card"
            >
              <div className="space-y-3 z-10">
                {camp.discountTag && (
                  <span className="inline-block px-3 py-1 rounded-sm bg-neutral-900 border border-neutral-700 text-white font-mono text-xs uppercase font-extrabold tracking-wider">
                    {camp.discountTag}
                  </span>
                )}
                <h4 className="font-headline-lg text-xl sm:text-2xl font-black uppercase text-white tracking-tight">
                  {camp.name}
                </h4>
                {camp.description && (
                  <p className="text-neutral-400 text-xs sm:text-sm leading-relaxed max-w-lg">
                    {camp.description}
                  </p>
                )}
              </div>

              <div className="pt-6 mt-6 border-t border-neutral-800 flex flex-wrap items-center justify-between gap-4 z-10">
                {couponCode ? (
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-neutral-400 uppercase">
                      CODE:
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopy(couponCode)}
                      title="Click to copy voucher code"
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-dashed transition-all cursor-pointer font-mono text-xs font-bold uppercase tracking-wider ${
                        isCopied
                          ? "border-emerald-500 bg-emerald-950/60 text-emerald-400"
                          : "border-neutral-600 bg-white/5 text-white hover:border-neutral-400 hover:bg-white/10"
                      }`}
                    >
                      {isCopied ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span>COPIED!</span>
                        </>
                      ) : (
                        <>
                          <span>{couponCode}</span>
                          <Copy className="w-3.5 h-3.5 opacity-60 ml-0.5" />
                        </>
                      )}
                    </button>
                  </div>
                ) : (
                  <span className="font-mono text-xs text-neutral-400 uppercase">
                    STOREWIDE PROMOTION
                  </span>
                )}

                <Link
                  href={couponCode ? `/shop?coupon=${encodeURIComponent(couponCode)}` : "/offers"}
                  className="px-6 py-2.5 sm:py-3 bg-white text-neutral-950 font-mono text-xs uppercase font-bold rounded-md hover:bg-neutral-200 transition-colors inline-flex items-center gap-1.5"
                >
                  <span>CLAIM OFFER</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
