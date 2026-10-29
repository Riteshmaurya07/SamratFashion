"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import {
  SlidersHorizontal,
  X,
  ChevronDown,
  Minus,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
  RotateCcw,
} from "lucide-react";
import { ProductCard, ProductCardProps } from "@/components/catalog/ProductCard";
import { CategoryItem, ThemeItem, getActiveCategories, getActiveThemes } from "@/lib/catalog";
const MIN_WIDTH = 220;
const MAX_WIDTH = 380;
const DEFAULT_WIDTH = 280;

const STORAGE_KEY_WIDTH = "threadvibe_shop_sidebar_width";
const STORAGE_KEY_COLLAPSED = "threadvibe_shop_sidebar_collapsed";


const SIZES = ["S", "M", "L", "XL", "XXL"];

interface ShopCatalogLayoutProps {
  products: ProductCardProps[];
  total: number;
  currentSort: string;
  activeQuery: string;
  categories?: CategoryItem[];
  themes?: ThemeItem[];
}

export function ShopCatalogLayout({
  products,
  total,
  currentSort,
  activeQuery,
  categories,
  themes,
}: ShopCatalogLayoutProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Desktop sidebar resizable & collapsible state
  const [sidebarWidth, setSidebarWidth] = useState<number>(DEFAULT_WIDTH);
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // Mobile / Tablet drawer state (<1024px)
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState<boolean>(false);

  // Prevent background scroll when mobile filter drawer is open
  useEffect(() => {
    if (isMobileDrawerOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isMobileDrawerOpen]);
  // Search input state
  const [searchTerm, setSearchTerm] = useState(activeQuery);

  // Price slider / number input local state
  const currentMaxPrice = searchParams.get("maxPrice") || "";
  const [priceInput, setPriceInput] = useState<string>(currentMaxPrice);

  const [categoryList, setCategoryList] = useState<CategoryItem[]>(categories || []);
  const [themeList, setThemeList] = useState<ThemeItem[]>(themes || []);
  const [loadingFilters, setLoadingFilters] = useState<boolean>(!categories || !themes);

  useEffect(() => {
    if (categories && themes) {
      setCategoryList(categories);
      setThemeList(themes);
      setLoadingFilters(false);
      return;
    }

    let isMounted = true;
    setLoadingFilters(true);
    Promise.all([getActiveCategories(), getActiveThemes()])
      .then(([cats, thms]) => {
        if (!isMounted) return;
        setCategoryList(cats);
        setThemeList(thms);
        setLoadingFilters(false);
      })
      .catch((err: unknown) => {
        if (!isMounted) return;
        console.error("Failed to fetch filter options", err);
        setLoadingFilters(false);
      });

    return () => {
      isMounted = false;
    };
  }, [categories, themes]);

  const { rootCategories, childrenByParentId } = useMemo(() => {
    const roots: CategoryItem[] = [];
    const childrenMap = new Map<string, CategoryItem[]>();

    for (const cat of categoryList) {
      if (cat.parentCategory) {
        const parentId = typeof cat.parentCategory === "object" ? cat.parentCategory._id : cat.parentCategory;
        const existing = childrenMap.get(parentId) || [];
        existing.push(cat);
        childrenMap.set(parentId, existing);
      } else {
        roots.push(cat);
      }
    }

    roots.sort((a, b) => a.displayOrder - b.displayOrder);
    childrenMap.forEach((list) => list.sort((a, b) => a.displayOrder - b.displayOrder));

    return { rootCategories: roots, childrenByParentId: childrenMap };
  }, [categoryList]);

  const containerRef = useRef<HTMLDivElement>(null);
  // Synchronize price input when URL params change
  useEffect(() => {
    setPriceInput(searchParams.get("maxPrice") || "");
  }, [searchParams]);

  // Synchronize search input when activeQuery changes
  useEffect(() => {
    setSearchTerm(activeQuery);
  }, [activeQuery]);

  // Read saved user preferences from localStorage on mount
  useEffect(() => {
    try {
      const savedWidth = localStorage.getItem(STORAGE_KEY_WIDTH);
      if (savedWidth) {
        const parsed = Number(savedWidth);
        if (Number.isFinite(parsed) && parsed >= MIN_WIDTH && parsed <= MAX_WIDTH) {
          setSidebarWidth(parsed);
        }
      }

      const savedCollapsed = localStorage.getItem(STORAGE_KEY_COLLAPSED);
      if (savedCollapsed !== null) {
        setIsCollapsed(savedCollapsed === "true");
      }
    } catch {
      // Ignore localStorage failure in restricted contexts
    }
  }, []);

  // Compute active filters count
  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (searchParams.get("category")) count++;
    if (searchParams.get("theme")) count++;
    if (searchParams.get("size")) count++;
    const maxP = searchParams.get("maxPrice");
    if (maxP && maxP.trim() !== "") count++;
    return count;
  }, [searchParams]);

  // Generic filter update helper
  const updateFilter = useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      params.delete("page");
      router.push(`/shop?${params.toString()}`);
    },
    [router, searchParams]
  );

  // Reset all facet filters
  const handleClearAll = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("category");
    params.delete("theme");
    params.delete("size");
    params.delete("maxPrice");
    params.delete("page");
    const queryStr = params.toString();
    router.push(queryStr ? `/shop?${queryStr}` : "/shop");
  }, [router, searchParams]);

  // Safe setter for width with persistence
  const updateSidebarWidth = useCallback((newWidth: number) => {
    const clamped = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(newWidth)));
    setSidebarWidth(clamped);
    try {
      localStorage.setItem(STORAGE_KEY_WIDTH, clamped.toString());
    } catch {
      // Ignore storage errors
    }
  }, []);

  // Desktop sidebar toggle with persistence
  const handleToggleSidebar = useCallback(() => {
    setIsCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY_COLLAPSED, next.toString());
      } catch {
        // Ignore storage errors
      }
      return next;
    });
  }, []);

  // Dragging logic for desktop resizer handle
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      setIsDragging(true);

      const startX = e.clientX;
      const startWidth = sidebarWidth;

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const deltaX = moveEvent.clientX - startX;
        const targetWidth = startWidth + deltaX;

        let maxAllowed = MAX_WIDTH;
        if (containerRef.current) {
          const containerWidth = containerRef.current.getBoundingClientRect().width;
          maxAllowed = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, containerWidth - 320));
        }

        const clamped = Math.min(maxAllowed, Math.max(MIN_WIDTH, Math.round(targetWidth)));
        setSidebarWidth(clamped);
      };

      const handlePointerUp = (upEvent: PointerEvent) => {
        setIsDragging(false);
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        window.removeEventListener("pointercancel", handlePointerUp);
        document.body.style.removeProperty("cursor");
        document.body.style.removeProperty("user-select");

        const deltaX = upEvent.clientX - startX;
        let maxAllowed = MAX_WIDTH;
        if (containerRef.current) {
          const containerWidth = containerRef.current.getBoundingClientRect().width;
          maxAllowed = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, containerWidth - 320));
        }
        const finalWidth = Math.min(maxAllowed, Math.max(MIN_WIDTH, Math.round(startWidth + deltaX)));
        setSidebarWidth(finalWidth);
        try {
          localStorage.setItem(STORAGE_KEY_WIDTH, finalWidth.toString());
        } catch {
          // Ignore storage errors
        }
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", handlePointerUp);
    },
    [sidebarWidth]
  );

  // Keyboard navigation on resizer divider
  const handleResizerKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        updateSidebarWidth(sidebarWidth - 10);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        updateSidebarWidth(sidebarWidth + 10);
      } else if (e.key === "Home") {
        e.preventDefault();
        updateSidebarWidth(MIN_WIDTH);
      } else if (e.key === "End") {
        e.preventDefault();
        updateSidebarWidth(MAX_WIDTH);
      }
    },
    [sidebarWidth, updateSidebarWidth]
  );

  // Lock body scroll when mobile drawer is open
  useEffect(() => {
    if (isMobileDrawerOpen) {
      const originalStyle = window.getComputedStyle(document.body).overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = originalStyle;
      };
    }
  }, [isMobileDrawerOpen]);

  // Escape key closes mobile drawer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isMobileDrawerOpen) {
        setIsMobileDrawerOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isMobileDrawerOpen]);

  // Search submission handlers
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams(searchParams.toString());
    if (searchTerm.trim()) {
      params.set("search", searchTerm.trim());
      params.delete("q");
    } else {
      params.delete("search");
      params.delete("q");
    }
    params.delete("page");
    router.push(`/shop?${params.toString()}`);
  };

  const handleClearSearch = () => {
    setSearchTerm("");
    const params = new URLSearchParams(searchParams.toString());
    params.delete("search");
    params.delete("q");
    params.delete("page");
    router.push(`/shop?${params.toString()}`);
  };

  const handleSortChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const params = new URLSearchParams(searchParams.toString());
    if (e.target.value) {
      params.set("sort", e.target.value);
    } else {
      params.delete("sort");
    }
    router.push(`/shop?${params.toString()}`);
  };

  const handlePriceCommit = (valStr: string) => {
    const trimmed = valStr.trim();
    if (!trimmed) {
      updateFilter("maxPrice", null);
      return;
    }
    const num = Number(trimmed);
    if (Number.isFinite(num) && num > 0) {
      updateFilter("maxPrice", Math.round(num).toString());
    }
  };

  // Shared Filter Groups Markup
  const renderFilterContent = () => (
    <div className="space-y-6">
      {/* Category Filter */}
      <div className="border-b border-outline-variant/15 pb-5">
        <h3 className="font-mono text-xs uppercase text-on-surface font-bold tracking-wider mb-3.5 flex justify-between items-center">
          <span>Category</span>
          <Minus className="w-3.5 h-3.5 text-on-surface-variant" />
        </h3>
        {loadingFilters ? (
          <div className="space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-4 bg-surface-container animate-pulse rounded w-3/4" />
            ))}
          </div>
        ) : categoryList.length === 0 ? (
          <p className="text-xs text-neutral-400 italic">No categories available</p>
        ) : (
          <div className="space-y-2.5 font-body-sm text-xs text-on-surface-variant">
            {rootCategories.map((root) => {
              const isSelected = (searchParams.get("category") || "").toLowerCase() === root.slug.toLowerCase();
              const children = childrenByParentId.get(root._id) || [];
              return (
                <div key={root._id} className="space-y-1.5">
                  <label className="flex items-center gap-3 cursor-pointer group select-none">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) => updateFilter("category", e.target.checked ? root.slug : null)}
                      className="form-checkbox text-primary border-outline-variant/60 rounded focus:ring-primary h-4 w-4 transition-all accent-primary"
                    />
                    <span className={`group-hover:text-primary transition-colors ${isSelected ? "font-bold text-on-surface" : ""}`}>
                      {root.name}
                    </span>
                    {typeof root.productCount === "number" && root.productCount > 0 && (
                      <span className="font-mono text-[10px] text-neutral-400 ml-auto">
                        ({root.productCount})
                      </span>
                    )}
                  </label>
                  {children.length > 0 && (
                    <div className="pl-6 space-y-1.5 border-l border-outline-variant/20 ml-2">
                      {children.map((child) => {
                        const isChildSelected = (searchParams.get("category") || "").toLowerCase() === child.slug.toLowerCase();
                        return (
                          <label key={child._id} className="flex items-center gap-2.5 cursor-pointer group select-none">
                            <input
                              type="checkbox"
                              checked={isChildSelected}
                              onChange={(e) => updateFilter("category", e.target.checked ? child.slug : null)}
                              className="form-checkbox text-primary border-outline-variant/60 rounded focus:ring-primary h-3.5 w-3.5 transition-all accent-primary"
                            />
                            <span className={`group-hover:text-primary transition-colors text-[11px] ${isChildSelected ? "font-bold text-on-surface" : ""}`}>
                              {child.name}
                            </span>
                            {typeof child.productCount === "number" && child.productCount > 0 && (
                              <span className="font-mono text-[9px] text-neutral-400 ml-auto">
                                ({child.productCount})
                              </span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Capsule Theme Filter */}
      <div className="border-b border-outline-variant/15 pb-5">
        <h3 className="font-mono text-xs uppercase text-on-surface font-bold tracking-wider mb-3.5 flex justify-between items-center">
          <span>Capsule Drops</span>
          <Minus className="w-3.5 h-3.5 text-on-surface-variant" />
        </h3>
        {loadingFilters ? (
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <div key={i} className="h-4 bg-surface-container animate-pulse rounded w-2/3" />
            ))}
          </div>
        ) : themeList.length === 0 ? (
          <p className="text-xs text-neutral-400 italic">No drops available</p>
        ) : (
          <div className="space-y-2 font-body-sm text-xs text-on-surface-variant">
            {themeList.map((theme) => {
              const isSelected = (searchParams.get("theme") || "").toLowerCase() === theme.slug.toLowerCase();
              return (
                <label key={theme._id} className="flex items-center gap-3 cursor-pointer group select-none">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={(e) => updateFilter("theme", e.target.checked ? theme.slug : null)}
                    className="form-checkbox text-primary border-outline-variant/60 rounded focus:ring-primary h-4 w-4 transition-all accent-primary"
                  />
                  <span className={`group-hover:text-primary transition-colors ${isSelected ? "font-bold text-on-surface" : ""}`}>
                    {theme.name}
                  </span>
                  {typeof theme.productCount === "number" && theme.productCount > 0 && (
                    <span className="font-mono text-[10px] text-neutral-400 ml-auto">
                      ({theme.productCount})
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        )}
      </div>

      {/* Max Price Filter */}
      <div className="border-b border-outline-variant/15 pb-5">
        <h3 className="font-mono text-xs uppercase text-on-surface font-bold tracking-wider mb-3.5 flex justify-between items-center">
          <span>Max Price</span>
          <Minus className="w-3.5 h-3.5 text-on-surface-variant" />
        </h3>
        <div className="space-y-2">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant font-mono text-xs font-bold">
              ₹
            </span>
            <input
              type="number"
              min="0"
              max="15000"
              value={priceInput}
              onChange={(e) => setPriceInput(e.target.value)}
              onBlur={(e) => handlePriceCommit(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.currentTarget.blur();
                }
              }}
              placeholder="e.g. 2499"
              aria-label="Filter by maximum price"
              className="w-full bg-surface-container-low text-on-surface placeholder:text-on-surface-variant border border-outline-variant/40 rounded-lg pl-7 pr-3 py-2 text-xs font-mono focus:border-primary focus:outline-none"
            />
          </div>
          {searchParams.get("maxPrice") && (
            <button
              type="button"
              onClick={() => {
                setPriceInput("");
                updateFilter("maxPrice", null);
              }}
              className="font-mono text-[11px] text-primary hover:underline flex items-center gap-1 pt-0.5"
            >
              Reset price cap
            </button>
          )}
        </div>
      </div>

      {/* Size Filter */}
      <div className="pb-2">
        <h3 className="font-mono text-xs uppercase text-on-surface font-bold tracking-wider mb-3.5 flex justify-between items-center">
          <span>Garment Size</span>
          <Minus className="w-3.5 h-3.5 text-on-surface-variant" />
        </h3>
        <div className="flex flex-wrap gap-2">
          {SIZES.map((size) => {
            const isSelected = searchParams.get("size") === size;
            return (
              <button
                key={size}
                type="button"
                onClick={() => updateFilter("size", isSelected ? null : size)}
                className={`w-10 h-10 flex items-center justify-center border rounded-md font-mono text-xs transition-colors ${
                  isSelected
                    ? "border-neutral-900 bg-neutral-900 text-white font-bold shadow-xs"
                    : "border-outline-variant/50 text-on-surface hover:border-neutral-900 bg-surface-container-lowest"
                }`}
              >
                {size}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* ─── INTEGRATED TOOLBAR ────────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between bg-surface-container-lowest p-3 sm:p-4 rounded-xl border border-outline-variant/20 shadow-xs gap-3">
          {/* Left: Filters Toggle + Search */}
          <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0 sm:min-w-[240px] w-full sm:w-auto">
            {/* Filters Button (Opens drawer on <1024px; Toggles sidebar on ≥1024px) */}
            <button
              type="button"
              onClick={() => {
                if (window.innerWidth < 1024) {
                  setIsMobileDrawerOpen(true);
                } else {
                  handleToggleSidebar();
                }
              }}
              aria-label={isCollapsed ? "Expand filter sidebar" : "Collapse filter sidebar"}
              aria-expanded={!isCollapsed}
              aria-controls="shop-filter-sidebar"
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg font-mono text-xs font-bold transition-all border shrink-0 ${
                !isCollapsed || activeFiltersCount > 0
                  ? "bg-neutral-900 text-white border-neutral-900 shadow-xs"
                  : "bg-surface text-on-surface border-outline-variant/50 hover:border-neutral-900"
              }`}
            >
              {isCollapsed ? (
                <PanelLeftOpen className="w-4 h-4 text-inherit" />
              ) : (
                <PanelLeftClose className="w-4 h-4 text-inherit hidden lg:block" />
              )}
              <SlidersHorizontal className="w-4 h-4 lg:hidden" />
              <span>Filters</span>
              {activeFiltersCount > 0 && (
                <span className="flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-primary text-on-primary text-[10px] font-mono font-bold leading-none">
                  {activeFiltersCount}
                </span>
              )}
            </button>

            {/* Catalog Search Input */}
            <form onSubmit={handleSearchSubmit} className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-variant pointer-events-none" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search streetwear drops..."
                className="w-full bg-surface-container-low text-on-surface placeholder:text-on-surface-variant border border-outline-variant/40 rounded-lg pl-9 pr-8 py-2 text-xs font-body-sm focus:outline-none focus:border-primary"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={handleClearSearch}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface p-0.5"
                  aria-label="Clear search input"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </form>
          </div>

          {/* Right: Results Count + Sort Dropdown */}
          <div className="flex items-center gap-4 border-t sm:border-t-0 sm:border-l border-outline-variant/20 pt-2 sm:pt-0 sm:pl-4 justify-between sm:justify-end w-full sm:w-auto">
            <span className="font-body-sm text-xs text-on-surface-variant whitespace-nowrap">
              Showing <strong className="text-on-surface font-bold">{total}</strong> drops
            </span>

            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-on-surface-variant uppercase hidden sm:inline">Sort:</span>
              <div className="relative">
                <select
                  value={currentSort}
                  onChange={handleSortChange}
                  aria-label="Sort products by"
                  className="appearance-none bg-surface-container-low border border-outline-variant/40 rounded-lg pl-3 pr-8 py-1.5 text-xs font-mono text-on-surface focus:outline-none focus:border-primary cursor-pointer"
                >
                  <option value="">Featured</option>
                  <option value="-createdAt">Newest Drops</option>
                  <option value="basePrice">Price: Low to High</option>
                  <option value="-basePrice">Price: High to Low</option>
                  <option value="-averageRating">Top Rated</option>
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-on-surface-variant pointer-events-none" />
              </div>
            </div>
          </div>
        </div>

        {/* Active Filters Summary Strip */}
        {(activeFiltersCount > 0 || activeQuery) && (
          <div className="flex flex-wrap items-center gap-2 text-xs py-1">
            <span className="font-mono text-[11px] text-on-surface-variant uppercase font-bold">Active:</span>
            {searchParams.get("category") && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface-container-high text-on-surface font-mono text-[11px]">
                <span>
                  Category: {categoryList.find(c => c.slug.toLowerCase() === (searchParams.get("category") || "").toLowerCase())?.name || searchParams.get("category")}
                </span>
                <button
                  type="button"
                  onClick={() => updateFilter("category", null)}
                  className="hover:text-primary"
                  aria-label="Remove category filter"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            {searchParams.get("theme") && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface-container-high text-on-surface font-mono text-[11px]">
                <span>
                  Drop: {themeList.find(t => t.slug.toLowerCase() === (searchParams.get("theme") || "").toLowerCase())?.name || searchParams.get("theme")}
                </span>
                <button
                  type="button"
                  onClick={() => updateFilter("theme", null)}
                  className="hover:text-primary"
                  aria-label="Remove drop theme filter"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            {searchParams.get("size") && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface-container-high text-on-surface font-mono text-[11px]">
                <span>Size: {searchParams.get("size")}</span>
                <button
                  type="button"
                  onClick={() => updateFilter("size", null)}
                  className="hover:text-primary"
                  aria-label="Remove size filter"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            {searchParams.get("maxPrice") && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface-container-high text-on-surface font-mono text-[11px]">
                <span>Max: ₹{searchParams.get("maxPrice")}</span>
                <button
                  type="button"
                  onClick={() => updateFilter("maxPrice", null)}
                  className="hover:text-primary"
                  aria-label="Remove price filter"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            {activeQuery && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-primary/10 text-primary border border-primary/20 font-mono text-[11px]">
                <span>Query: &quot;{activeQuery}&quot;</span>
                <button
                  type="button"
                  onClick={handleClearSearch}
                  className="hover:text-neutral-900"
                  aria-label="Clear search query"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}

            <button
              type="button"
              onClick={handleClearAll}
              className="inline-flex items-center gap-1 font-mono text-[11px] text-primary hover:underline font-bold ml-1"
            >
              <RotateCcw className="w-3 h-3" /> Clear All
            </button>
          </div>
        )}
      </div>

      {/* ─── MAIN CATALOG WORKSPACE ────────────────────────────────────── */}
      <div ref={containerRef} className="flex items-start w-full relative">
        {/* Desktop Sidebar (Rendered on ≥1024px; Collapsible & Resizable) */}
        <aside
          id="shop-filter-sidebar"
          style={{
            width: isCollapsed ? 0 : `${sidebarWidth}px`,
          }}
          className={`hidden lg:block shrink-0 ${
            isDragging ? "" : "transition-[width,opacity] duration-300 ease-out"
          } ${
            isCollapsed
              ? "w-0 opacity-0 pointer-events-none invisible overflow-hidden m-0 p-0"
              : "opacity-100 visible"
          }`}
        >
          <div
            style={{ width: `${sidebarWidth}px` }}
            className="p-6 bg-surface-container-lowest rounded-xl border border-outline-variant/20 shadow-xs space-y-6"
          >
            <div className="flex justify-between items-center border-b border-outline-variant/15 pb-3.5">
              <h2 className="font-headline-sm text-sm font-bold text-on-surface uppercase tracking-wider">
                Filter Drops
              </h2>
              {activeFiltersCount > 0 && (
                <button
                  type="button"
                  onClick={handleClearAll}
                  className="font-mono text-[11px] text-primary hover:underline font-bold"
                >
                  Reset
                </button>
              )}
            </div>

            {renderFilterContent()}
          </div>
        </aside>

        {/* Draggable Vertical Divider (Only active on desktop when expanded) */}
        {!isCollapsed && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize filter sidebar"
            aria-valuenow={sidebarWidth}
            aria-valuemin={MIN_WIDTH}
            aria-valuemax={MAX_WIDTH}
            tabIndex={0}
            onPointerDown={handlePointerDown}
            onKeyDown={handleResizerKeyDown}
            className={`hidden lg:flex shrink-0 w-3 self-stretch justify-center cursor-col-resize select-none mx-0.5 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-full ${
              isDragging ? "bg-primary/10" : ""
            }`}
          >
            <div
              className={`w-[1px] h-full transition-colors rounded-full ${
                isDragging
                  ? "bg-primary w-[2px]"
                  : "bg-outline-variant/30 group-hover:bg-primary group-hover:w-[2px]"
              }`}
            />
          </div>
        )}

        {/* Product Grid Area (Expands into available horizontal space) */}
        <div className="flex-1 min-w-0 transition-all duration-300">
          {products.length > 0 ? (
            <div
              className={`grid gap-3 sm:gap-4 md:gap-6 ${
                isCollapsed
                  ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4"
                  : "grid-cols-2 lg:grid-cols-3"
              }`}
            >
              {products.map((product) => (
                <ProductCard
                  key={product.cardKey || (product.selectedColor ? `${product._id}-${product.selectedColor}` : product._id)}
                  {...product}
                />
              ))}
            </div>
          ) : (
            <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/30 p-12 text-center space-y-4 my-4">
              <p className="font-mono text-xs uppercase tracking-widest text-primary font-bold">
                NO MATCHING DROPS FOUND
              </p>
              <h3 className="font-headline-sm text-xl font-bold text-on-surface">
                We couldn&apos;t find any streetwear matching your current filter criteria.
              </h3>
              <p className="text-xs text-on-surface-variant max-w-md mx-auto">
                Try broadening your criteria, increasing max price, or reset filters to browse our full collection.
              </p>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleClearAll}
                  className="inline-block px-6 py-2.5 bg-neutral-900 text-white font-mono text-xs uppercase tracking-wider rounded-md font-bold hover:bg-neutral-800 transition-colors"
                >
                  RESET ALL FILTERS
                </button>
              </div>
            </div>
          )}

          {/* Pagination / Progress Indicator */}
          {products.length > 0 && products.length < total && (
            <div className="mt-16 flex flex-col items-center justify-center border-t border-outline-variant/20 pt-8">
              <p className="font-mono text-xs text-on-surface-variant mb-3 uppercase tracking-wider">
                VIEWING {products.length} OF {total} DROPS
              </p>
              <div className="w-48 h-1 bg-surface-container-high rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${(products.length / total) * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ─── MOBILE & TABLET SLIDE-IN DRAWER (<1024px) ─────────────────── */}
      <AnimatePresence>
        {isMobileDrawerOpen && (
          <div className="fixed inset-0 z-[100] flex lg:hidden">
            {/* Backdrop overlay */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-xs"
              onClick={() => setIsMobileDrawerOpen(false)}
              aria-hidden="true"
            />

            {/* Drawer sheet sliding in from the left */}
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="mobile-filter-title"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 300 }}
              className="relative z-[101] w-full max-w-xs sm:max-w-sm bg-surface-container-lowest h-full shadow-2xl flex flex-col border-r border-outline-variant/30 pb-safe"
            >
            {/* Header */}
            <div className="flex justify-between items-center px-6 py-4 border-b border-outline-variant/20">
              <div className="flex items-center gap-2">
                <h2 id="mobile-filter-title" className="font-headline-sm text-base font-bold text-on-surface uppercase tracking-wider">
                  Filter Drops
                </h2>
                {activeFiltersCount > 0 && (
                  <span className="flex items-center justify-center min-w-4 h-4 px-1 rounded-full bg-primary text-on-primary text-[10px] font-mono font-bold leading-none">
                    {activeFiltersCount}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setIsMobileDrawerOpen(false)}
                className="p-2 -mr-1.5 text-on-surface-variant hover:text-on-surface rounded-lg transition-colors touch-target-base flex items-center justify-center"
                aria-label="Close filters drawer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable Filters Body */}
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {renderFilterContent()}
            </div>

            {/* Footer Actions */}
            <div className="p-4 border-t border-outline-variant/20 bg-surface flex gap-3 pb-safe">
              <button
                type="button"
                onClick={() => {
                  handleClearAll();
                  setIsMobileDrawerOpen(false);
                }}
                className="flex-1 py-3 border border-outline-variant/50 font-mono text-xs uppercase tracking-wider font-bold rounded-lg text-on-surface hover:bg-surface-container-low active:scale-95 transition-all min-h-[44px]"
              >
                Clear All
              </button>
              <button
                type="button"
                onClick={() => setIsMobileDrawerOpen(false)}
                className="flex-1 py-3 bg-neutral-900 text-white font-mono text-xs uppercase tracking-wider font-bold rounded-lg shadow-sm hover:bg-neutral-800 active:scale-95 transition-all min-h-[44px]"
              >
                View ({total})
              </button>
            </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
