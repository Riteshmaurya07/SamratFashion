"use client";


import { useStoreSettings } from "@/lib/useStoreSettings";
import { formatFreeShippingRule } from "@/lib/storeSettingsDefaults";

interface MarqueeTickerProps {
  items?: string[];
  className?: string;
  speed?: "normal" | "slow" | "fast";
}

const DEFAULT_TICKER_ITEMS = [
  "TAILORED INDIAN MENSWEAR",
  "PAN-INDIA EXPRESS COURIER DISPATCH",
  "BREATHABLE WOVEN & COTTON BLENDS",
  "FREE DOMESTIC SHIPPING ON ORDERS ₹999+",
  "STRUCTURED COLLARS & CLEAN FINISHING",
  "SECURE PREPAID CHECKOUT VIA RAZORPAY",
  "7-DAY HASSLE-FREE RETURNS & EXCHANGES",
];

export function MarqueeTicker({
  items = DEFAULT_TICKER_ITEMS,
  className = "",
}: MarqueeTickerProps) {
  const { freeShippingThreshold } = useStoreSettings();
  const resolvedItems = items.map((item) =>
    item.includes("₹999")
      ? formatFreeShippingRule(freeShippingThreshold, { uppercase: true, includeDomestic: true })
      : item
  );

  // Double the items to allow seamless infinite CSS translateX loop
  const displayItems = [...resolvedItems, ...resolvedItems];

  return (
    <div
      aria-label="Brand announcements"
      className={`w-full overflow-hidden bg-neutral-950 text-white border-y border-neutral-800 select-none py-2.5 sm:py-3 relative ${className}`}
    >
      <div className="flex w-max animate-marquee motion-reduce:animate-none hover:[animation-play-state:paused]">
        {displayItems.map((item, index) => (
          <div
            key={index}
            className="flex items-center gap-4 sm:gap-6 px-4 sm:px-6 whitespace-nowrap"
          >
            <span className="font-mono text-[10px] sm:text-[11px] uppercase tracking-[0.18em] font-semibold text-neutral-200">
              {item}
            </span>
            <span
              className="text-neutral-600 text-[10px] select-none"
              aria-hidden="true"
            >
              ✦
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
