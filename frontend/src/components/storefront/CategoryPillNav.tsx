"use client";

import Link from "next/link";
import { CategoryItem } from "@/lib/catalog";

interface CategoryPillNavProps {
  categories: CategoryItem[];
  className?: string;
}

export function CategoryPillNav({
  categories,
  className = "",
}: CategoryPillNavProps) {
  const activeCategories = (categories || []).filter((cat) => {
    const slug = (cat.slug || "").toLowerCase();
    return !["custom-print", "custom-printing", "bulk-printing", "jersey", "corporate-jersey"].includes(slug);
  });

  if (activeCategories.length === 0) return null;

  const getHref = (cat: CategoryItem) => `/shop?category=${encodeURIComponent(cat.slug)}`;

  return (
    <nav
      aria-label="Quick Category Filter"
      className={`w-full overflow-x-auto hide-scrollbar py-3 px-margin-mobile md:px-margin-desktop flex items-center justify-start md:justify-center gap-2 sm:gap-2.5 ${className}`}
    >
      <Link
        href="/shop"
        className="shrink-0 px-4 py-2 rounded-full border border-neutral-900 bg-neutral-950 text-white font-mono text-[11px] uppercase tracking-wider font-bold transition-all hover:bg-neutral-800 focus-visible:outline-2 focus-visible:outline-primary"
      >
        ALL CATALOG
      </Link>
      {activeCategories.map((cat) => (
        <Link
          key={cat._id}
          href={getHref(cat)}
          className="shrink-0 px-4 py-2 rounded-full border border-outline-variant/60 bg-surface-container-lowest text-on-surface font-mono text-[11px] uppercase tracking-wider font-semibold transition-all hover:border-neutral-950 hover:bg-neutral-900 hover:text-white focus-visible:outline-2 focus-visible:outline-primary"
        >
          {cat.name}
          {typeof cat.productCount === "number" && cat.productCount > 0 && (
            <span className="ml-1.5 opacity-60 text-[9px] font-mono">
              ({cat.productCount})
            </span>
          )}
        </Link>
      ))}
      <Link
        href="/offers"
        className="shrink-0 px-4 py-2 rounded-full border border-amber-600/40 bg-amber-500/10 text-amber-900 dark:text-amber-200 font-mono text-[11px] uppercase tracking-wider font-bold transition-all hover:bg-amber-500/20"
      >
        OFFERS & VOUCHERS
      </Link>
    </nav>
  );
}
