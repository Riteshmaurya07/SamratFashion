"use client";


interface MarqueeTickerProps {
  items?: string[];
  className?: string;
  speed?: "normal" | "slow" | "fast";
}

const DEFAULT_TICKER_ITEMS = [
  "240+ GSM HEAVYWEIGHT COMBED COTTON",
  "PAN-INDIA EXPRESS DISPATCH VIA DELHIVERY",
  "ENGINEERED BOXY DROP-SHOULDER SILHOUETTE",
  "FREE DOMESTIC SHIPPING ON ORDERS > ₹999",
  "BIO-WASHED PRE-SHRUNK ZERO-SAG COLLARS",
  "HIGH-DENSITY DTF CURED GRAPHICS",
  "7-DAY HASSLE-FREE RETURNS & EXCHANGES",
];

export function MarqueeTicker({
  items = DEFAULT_TICKER_ITEMS,
  className = "",
}: MarqueeTickerProps) {
  // Double the items to allow seamless infinite CSS translateX loop
  const displayItems = [...items, ...items];

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
