"use client";

import Link from "next/link";
import {
  LayoutDashboard,
  Package,
  MapPin,
  Heart,
  Star,
} from "lucide-react";

export type AccountTabKey = "overview" | "orders" | "addresses" | "wishlist" | "reviews";

export interface AccountNavProps {
  currentTab: AccountTabKey;
  activeCount?: number;
}

const ACCOUNT_TABS = [
  { key: "overview" as AccountTabKey, label: "Overview", href: "/account", icon: LayoutDashboard },
  { key: "orders" as AccountTabKey, label: "Orders", href: "/account/orders", icon: Package },
  { key: "addresses" as AccountTabKey, label: "Addresses", href: "/account/addresses", icon: MapPin },
  { key: "wishlist" as AccountTabKey, label: "Wishlist", href: "/account/wishlist", icon: Heart },
  { key: "reviews" as AccountTabKey, label: "Reviews", href: "/account/reviews", icon: Star },
];

export function AccountNav({ currentTab, activeCount }: AccountNavProps) {
  return (
    <div className="relative mb-6 sm:mb-8">
      <div className="overflow-x-auto hide-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0 flex items-center gap-1.5 sm:gap-2 pb-1 border-b border-outline-variant/40">
          {ACCOUNT_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = tab.key === currentTab;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`shrink-0 whitespace-nowrap flex items-center gap-2 px-2.5 sm:px-4 py-2 sm:py-2.5 rounded-lg font-mono text-xs font-bold uppercase tracking-wider transition-all min-h-[40px] ${
                  isActive
                    ? "bg-neutral-950 text-white shadow-xs"
                    : "text-neutral-600 hover:text-neutral-950 hover:bg-surface-container-low"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
                {isActive && typeof activeCount === "number" && activeCount > 0 && (
                  <span className="bg-white/20 text-white text-[10px] px-1.5 py-0.2 rounded-full font-mono">
                    {activeCount}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
        {/* Subtle fade hint on mobile indicating scrollable row without word clipping */}
        <div className="pointer-events-none absolute right-0 top-0 bottom-1 w-8 bg-gradient-to-l from-surface to-transparent sm:hidden" />
      </div>
  );
}
