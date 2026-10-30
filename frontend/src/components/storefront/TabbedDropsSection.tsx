"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Flame, Sparkles } from "lucide-react";
import { ProductCard, ProductCardProps } from "@/components/catalog/ProductCard";
import { motion, AnimatePresence } from "motion/react";

interface TabbedDropsSectionProps {
  trendingProducts: ProductCardProps[];
  newArrivals: ProductCardProps[];
  className?: string;
}

type TabType = "trending" | "newArrivals";

export function TabbedDropsSection({
  trendingProducts = [],
  newArrivals = [],
  className = "",
}: TabbedDropsSectionProps) {
  const [activeTab, setActiveTab] = useState<TabType>(
    trendingProducts.length > 0 ? "trending" : "newArrivals"
  );

  const activeProducts =
    activeTab === "trending" ? trendingProducts : newArrivals;

  const catalogHref =
    activeTab === "trending"
      ? "/shop?sort=bestseller"
      : "/shop?sort=newest";

  if (trendingProducts.length === 0 && newArrivals.length === 0) {
    return null;
  }

  return (
    <section
      className={`py-12 md:py-20 bg-surface-container-lowest w-full flex justify-center border-b border-outline-variant/30 ${className}`}
    >
      <div className="w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop">
        {/* Section Header with Tabs */}
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-8 sm:mb-10 gap-4">
          <div className="space-y-3">
            <h2 className="font-headline-lg text-2xl md:text-4xl font-black text-on-surface uppercase tracking-tight">
              CURATED DROPS
            </h2>
            {/* Tab Switcher */}
            <div
              role="tablist"
              aria-label="Product Drop Categories"
              className="inline-flex items-center p-1 rounded-lg bg-surface-container-low border border-outline-variant/60"
            >
              {trendingProducts.length > 0 && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "trending"}
                  onClick={() => setActiveTab("trending")}
                  className={`flex items-center gap-1.5 px-3.5 sm:px-5 py-2 rounded-md font-mono text-xs uppercase tracking-wider font-bold transition-all cursor-pointer ${
                    activeTab === "trending"
                      ? "bg-neutral-950 text-white shadow-xs"
                      : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/40"
                  }`}
                >
                  <Flame className="w-3.5 h-3.5" />
                  <span>Trending</span>
                  <span
                    className={`ml-1 text-[10px] px-1.5 py-0.2 rounded-xs font-mono ${
                      activeTab === "trending"
                        ? "bg-white/20 text-white"
                        : "bg-surface-container-high text-on-surface-variant"
                    }`}
                  >
                    {trendingProducts.length}
                  </span>
                </button>
              )}

              {newArrivals.length > 0 && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "newArrivals"}
                  onClick={() => setActiveTab("newArrivals")}
                  className={`flex items-center gap-1.5 px-3.5 sm:px-5 py-2 rounded-md font-mono text-xs uppercase tracking-wider font-bold transition-all cursor-pointer ${
                    activeTab === "newArrivals"
                      ? "bg-neutral-950 text-white shadow-xs"
                      : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/40"
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>New Arrivals</span>
                  <span
                    className={`ml-1 text-[10px] px-1.5 py-0.2 rounded-xs font-mono ${
                      activeTab === "newArrivals"
                        ? "bg-white/20 text-white"
                        : "bg-surface-container-high text-on-surface-variant"
                    }`}
                  >
                    {newArrivals.length}
                  </span>
                </button>
              )}
            </div>
          </div>

          <Link
            href={catalogHref}
            className="font-mono text-xs text-on-surface hover:text-neutral-600 font-bold transition-colors flex items-center gap-1.5 uppercase tracking-wider self-start md:self-auto"
          >
            <span>
              {activeTab === "trending"
                ? "Explore All Bestsellers"
                : "Explore All New In"}
            </span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {/* Product Grid */}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 md:gap-6"
          >
            {activeProducts.slice(0, 8).map((product: ProductCardProps) => (
              <ProductCard key={product._id} {...product} />
            ))}
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}
