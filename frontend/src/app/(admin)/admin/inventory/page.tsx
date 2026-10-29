"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import axios from "axios";
import { api } from "@/lib/api";
import {
  type RawProduct,
  type NormalizedVariant,
  type FilterOptions,
  groupAllProductsInventory,
  calculateInventoryStats,
  extractUniqueColors,
  extractUniqueSizes,
  filterProductGroups,
  validateStockAdjustment,
} from "@/lib/inventoryUtils";

function extractErrorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { message?: string } | undefined;
    return data?.message || err.message || fallback;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return fallback;
}

export default function AdminInventoryPage() {
  const [rawProducts, setRawProducts] = useState<RawProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  // Pagination & Filtering state
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [totalBackendProducts, setTotalBackendProducts] = useState(0);

  const [search, setSearch] = useState("");
  const [stockFilter, setStockFilter] = useState<FilterOptions["stockStatus"]>("");
  const [colorFilter, setColorFilter] = useState("");
  const [sizeFilter, setSizeFilter] = useState("");

  // Accordion state (set of expanded product IDs)
  const [expandedProductIds, setExpandedProductIds] = useState<Set<string>>(new Set());

  // Inline Stock Adjustment State
  const [adjustingVariant, setAdjustingVariant] = useState<NormalizedVariant | null>(null);
  const [adjustQty, setAdjustQty] = useState<number>(0);
  const [adjustType, setAdjustType] = useState<"RESTOCK" | "ADJUSTMENT">("RESTOCK");
  const [adjustReason, setAdjustReason] = useState("");
  const [isSubmittingAdjust, setIsSubmittingAdjust] = useState(false);
  const [adjustError, setAdjustError] = useState("");

  const fetchProducts = useCallback(async (isInitial = true) => {
    if (isInitial) setLoading(true);
    else setRefreshing(true);

    try {
      const res = await api.get(`/admin/products?page=${page}&limit=${limit}`);
      const items = res.data?.data?.items || [];
      setRawProducts(items);
      setTotalBackendProducts(res.data?.data?.total || items.length);
      setError("");

      // On first load, expand first 3 products for immediate preview
      if (isInitial && items.length > 0) {
        setExpandedProductIds(new Set(items.slice(0, 3).map((p: RawProduct) => p._id)));
      }
    } catch (err: unknown) {
      setError(extractErrorMessage(err, "Failed to fetch products for inventory management"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [page, limit]);

  useEffect(() => {
    fetchProducts(true);
  }, [fetchProducts]);

  // Transform raw products into grouped structure
  const productGroups = useMemo(() => {
    return groupAllProductsInventory(rawProducts);
  }, [rawProducts]);

  // Aggregate stats across all products
  const stats = useMemo(() => {
    return calculateInventoryStats(productGroups);
  }, [productGroups]);

  // Extract available filter options
  const uniqueColors = useMemo(() => {
    return extractUniqueColors(productGroups);
  }, [productGroups]);

  const uniqueSizes = useMemo(() => {
    return extractUniqueSizes(productGroups);
  }, [productGroups]);

  // Filter products by search, stock status, color, and size
  const filteredGroups = useMemo(() => {
    return filterProductGroups(productGroups, {
      search,
      stockStatus: stockFilter,
      color: colorFilter,
      size: sizeFilter,
    });
  }, [productGroups, search, stockFilter, colorFilter, sizeFilter]);

  const activeFiltersCount =
    (search ? 1 : 0) +
    (stockFilter && stockFilter !== "ALL" ? 1 : 0) +
    (colorFilter ? 1 : 0) +
    (sizeFilter ? 1 : 0);

  const clearAllFilters = () => {
    setSearch("");
    setStockFilter("");
    setColorFilter("");
    setSizeFilter("");
  };

  const toggleExpandProduct = (productId: string) => {
    setExpandedProductIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  const expandAll = () => {
    setExpandedProductIds(new Set(filteredGroups.map((p) => p.productId)));
  };

  const collapseAll = () => {
    setExpandedProductIds(new Set());
  };

  const openAdjustPopover = (variant: NormalizedVariant) => {
    setAdjustingVariant(variant);
    setAdjustQty(0);
    setAdjustType("RESTOCK");
    setAdjustReason("");
    setAdjustError("");
  };

  const handleAdjustSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!adjustingVariant) return;

    const validation = validateStockAdjustment(
      adjustingVariant.stock,
      adjustQty,
      adjustReason
    );
    if (!validation.valid) {
      setAdjustError(validation.error || "Invalid adjustment");
      return;
    }

    setIsSubmittingAdjust(true);
    setAdjustError("");

    try {
      const res = await api.patch(
        `/admin/products/${adjustingVariant.productId}/variants/${adjustingVariant.variantId}/inventory`,
        {
          quantity: Number(adjustQty),
          type: adjustType,
          reason: adjustReason.trim(),
        }
      );

      const updatedData = res.data?.data;
      const newStock = updatedData?.newStock ?? adjustingVariant.stock + adjustQty;

      // Optimistic update of rawProducts so UI reflects update instantly
      setRawProducts((prev) =>
        prev.map((p) => {
          if (p._id !== adjustingVariant.productId) return p;
          return {
            ...p,
            variants: (p.variants || []).map((v) => {
              const vId = v._id || `${p._id}-var-${v.sku}`;
              if (vId === adjustingVariant.variantId || v.sku === adjustingVariant.sku) {
                return { ...v, stock: newStock };
              }
              return v;
            }),
          };
        })
      );

      setSuccessMessage(
        `Successfully adjusted ${adjustingVariant.sku} (${adjustingVariant.productName} · ${adjustingVariant.size}) to ${newStock} units.`
      );
      setAdjustingVariant(null);
      setAdjustQty(0);
      setAdjustReason("");

      // Background re-fetch to sync with authoritative database state
      fetchProducts(false);
    } catch (err: unknown) {
      setAdjustError(extractErrorMessage(err, "Failed to adjust inventory"));
    } finally {
      setIsSubmittingAdjust(false);
    }
  };

  return (
    <div className="flex flex-col gap-element-gap md:gap-gutter">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="material-symbols-outlined text-primary text-[24px]">inventory_2</span>
            <h1 className="font-headline-lg text-headline-lg text-on-background font-bold tracking-tight">
              Physical Inventory
            </h1>
          </div>
          <p className="font-body-md text-body-md text-on-surface-variant max-w-2xl">
            Real-time stock auditing, colorway &amp; size matrix, and precision stock adjustments across all SKUs.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start md:self-auto">
          <button
            onClick={() => fetchProducts(false)}
            disabled={refreshing || loading}
            className="flex items-center gap-2 px-3.5 py-2 border border-outline-variant/30 text-on-surface bg-surface-container-lowest font-label-caps text-label-caps rounded-lg hover:bg-surface-container-high transition-colors disabled:opacity-50 shadow-xs"
            title="Refresh Stock Data"
          >
            <span className={`material-symbols-outlined text-[18px] ${refreshing ? "animate-spin" : ""}`}>
              refresh
            </span>
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Error / Success Notifications */}
      {error && (
        <div className="text-error bg-error-container/20 border border-error/20 p-4 rounded-xl font-body-sm flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="material-symbols-outlined text-[20px]">error_outline</span>
            <span>{error}</span>
          </div>
          <button onClick={() => setError("")} className="text-error/80 hover:text-error">
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
      )}

      {successMessage && (
        <div className="text-primary bg-primary-container/10 border border-primary/20 p-4 rounded-xl font-body-sm flex items-center justify-between animate-fade-in shadow-xs">
          <div className="flex items-center gap-2.5">
            <span className="material-symbols-outlined text-[20px] text-primary">check_circle</span>
            <span className="text-on-surface font-medium">{successMessage}</span>
          </div>
          <button
            onClick={() => setSuccessMessage("")}
            className="text-on-surface-variant hover:text-on-surface p-1 rounded-md"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
      )}

      {/* KPI Cards Row */}
      <section className="grid grid-cols-2 lg:grid-cols-5 gap-3.5">
        {/* Total Products */}
        <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-4 flex flex-col justify-between shadow-xs">
          <div className="flex items-center justify-between text-on-surface-variant mb-1">
            <span className="font-label-caps text-label-caps">Total Products</span>
            <span className="material-symbols-outlined text-[18px] opacity-60">checkroom</span>
          </div>
          <span className="font-headline-lg text-headline-lg font-bold text-on-surface">
            {loading ? "—" : stats.totalProducts}
          </span>
          <span className="text-xs text-on-surface-variant mt-1 font-body-sm">
            Catalog master models
          </span>
        </div>

        {/* Total SKUs */}
        <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-4 flex flex-col justify-between shadow-xs">
          <div className="flex items-center justify-between text-on-surface-variant mb-1">
            <span className="font-label-caps text-label-caps">Total SKUs</span>
            <span className="material-symbols-outlined text-[18px] opacity-60">qr_code_2</span>
          </div>
          <span className="font-headline-lg text-headline-lg font-bold text-on-surface">
            {loading ? "—" : stats.totalVariants}
          </span>
          <span className="text-xs text-on-surface-variant mt-1 font-body-sm">
            Active size/color variants
          </span>
        </div>

        {/* Total Units */}
        <div className="bg-surface-container-lowest border border-outline-variant/30 border-l-4 border-l-primary rounded-xl p-4 flex flex-col justify-between shadow-xs">
          <div className="flex items-center justify-between text-on-surface-variant mb-1">
            <span className="font-label-caps text-label-caps">Total Units</span>
            <span className="material-symbols-outlined text-primary text-[18px]">warehouse</span>
          </div>
          <span className="font-headline-lg text-headline-lg font-bold text-primary">
            {loading ? "—" : stats.totalUnits.toLocaleString("en-IN")}
          </span>
          <span className="text-xs text-on-surface-variant mt-1 font-body-sm">
            Available on hand
          </span>
        </div>

        {/* Low Stock Badge */}
        <button
          onClick={() => setStockFilter(stockFilter === "LOW_STOCK" ? "" : "LOW_STOCK")}
          className={`text-left bg-surface-container-lowest border rounded-xl p-4 flex flex-col justify-between transition-all shadow-xs cursor-pointer ${
            stockFilter === "LOW_STOCK"
              ? "border-secondary ring-2 ring-secondary/30"
              : "border-outline-variant/30 hover:border-secondary/50"
          } ${stats.lowStockCount > 0 ? "border-l-4 border-l-secondary" : ""}`}
        >
          <div className="flex items-center justify-between text-on-surface-variant mb-1">
            <span className="font-label-caps text-label-caps">Low Stock</span>
            <span className="material-symbols-outlined text-secondary text-[18px]">warning</span>
          </div>
          <span
            className={`font-headline-lg text-headline-lg font-bold ${
              stats.lowStockCount > 0 ? "text-secondary" : "text-on-surface"
            }`}
          >
            {loading ? "—" : stats.lowStockCount}
          </span>
          <span className="text-xs text-on-surface-variant mt-1 font-body-sm flex items-center justify-between">
            <span>&le; reorder threshold</span>
            {stockFilter === "LOW_STOCK" && <span className="font-bold text-secondary">Filtered</span>}
          </span>
        </button>

        {/* Out of Stock Badge */}
        <button
          onClick={() => setStockFilter(stockFilter === "OUT_OF_STOCK" ? "" : "OUT_OF_STOCK")}
          className={`text-left bg-surface-container-lowest border rounded-xl p-4 flex flex-col justify-between transition-all shadow-xs cursor-pointer ${
            stockFilter === "OUT_OF_STOCK"
              ? "border-error ring-2 ring-error/30"
              : "border-outline-variant/30 hover:border-error/50"
          } ${stats.outOfStockCount > 0 ? "border-l-4 border-l-error" : ""}`}
        >
          <div className="flex items-center justify-between text-on-surface-variant mb-1">
            <span className="font-label-caps text-label-caps">Out of Stock</span>
            <span className="material-symbols-outlined text-error text-[18px]">error_outline</span>
          </div>
          <span
            className={`font-headline-lg text-headline-lg font-bold ${
              stats.outOfStockCount > 0 ? "text-error" : "text-on-surface"
            }`}
          >
            {loading ? "—" : stats.outOfStockCount}
          </span>
          <span className="text-xs text-on-surface-variant mt-1 font-body-sm flex items-center justify-between">
            <span>0 units available</span>
            {stockFilter === "OUT_OF_STOCK" && <span className="font-bold text-error">Filtered</span>}
          </span>
        </button>
      </section>

      {/* Filter and Control Bar */}
      <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-4 flex flex-col gap-3 shadow-xs">
        <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between">
          {/* Search Input */}
          <div className="flex-1 max-w-lg relative">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-[18px]">
              search
            </span>
            <input
              type="text"
              placeholder="Search by product, SKU, color, or slug..."
              className="w-full pl-9 pr-8 py-2 bg-surface-container-low border border-outline-variant/30 rounded-lg focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary font-body-sm text-body-sm text-on-surface transition-all placeholder:text-outline"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-outline hover:text-on-surface"
              >
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            )}
          </div>

          {/* Filters & Actions */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Stock Status Filter */}
            <select
              value={stockFilter || ""}
              onChange={(e) => setStockFilter(e.target.value as FilterOptions["stockStatus"])}
              className="px-3 py-2 bg-surface-container-low border border-outline-variant/30 rounded-lg font-label-caps text-xs text-on-surface focus:outline-none focus:border-primary transition-colors cursor-pointer"
            >
              <option value="">Stock Status: All</option>
              <option value="NEEDS_ATTENTION">⚠️ Needs Attention (Low or OOS)</option>
              <option value="OUT_OF_STOCK">✕ Out of Stock (0)</option>
              <option value="LOW_STOCK">⚠ Low Stock (≤ reorder)</option>
              <option value="HEALTHY">✓ Healthy In-Stock</option>
            </select>

            {/* Colour Filter */}
            <select
              value={colorFilter}
              onChange={(e) => setColorFilter(e.target.value)}
              className="px-3 py-2 bg-surface-container-low border border-outline-variant/30 rounded-lg font-label-caps text-xs text-on-surface focus:outline-none focus:border-primary transition-colors cursor-pointer"
            >
              <option value="">Colour: All ({uniqueColors.length})</option>
              {uniqueColors.map((color) => (
                <option key={color} value={color.toLowerCase()}>
                  {color}
                </option>
              ))}
            </select>

            {/* Size Filter */}
            <select
              value={sizeFilter}
              onChange={(e) => setSizeFilter(e.target.value)}
              className="px-3 py-2 bg-surface-container-low border border-outline-variant/30 rounded-lg font-label-caps text-xs text-on-surface focus:outline-none focus:border-primary transition-colors cursor-pointer"
            >
              <option value="">Size: All ({uniqueSizes.length})</option>
              {uniqueSizes.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>

            {/* Clear Filters Button */}
            {activeFiltersCount > 0 && (
              <button
                onClick={clearAllFilters}
                className="flex items-center gap-1.5 px-3 py-2 text-primary hover:bg-primary-container/10 border border-primary/20 rounded-lg font-label-caps text-xs transition-colors"
                title="Clear all active filters"
              >
                <span className="material-symbols-outlined text-[16px]">filter_alt_off</span>
                <span>Reset ({activeFiltersCount})</span>
              </button>
            )}

            <div className="h-6 w-px bg-outline-variant/30 mx-1 hidden sm:block" />

            {/* Expand / Collapse All Toggle */}
            <div className="flex items-center gap-1">
              <button
                onClick={expandAll}
                className="px-2.5 py-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-lg font-label-caps text-xs transition-colors flex items-center gap-1"
                title="Expand all product matrices"
              >
                <span className="material-symbols-outlined text-[16px]">unfold_more</span>
                <span className="hidden sm:inline">Expand All</span>
              </button>

              <button
                onClick={collapseAll}
                className="px-2.5 py-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-lg font-label-caps text-xs transition-colors flex items-center gap-1"
                title="Collapse all product matrices"
              >
                <span className="material-symbols-outlined text-[16px]">unfold_less</span>
                <span className="hidden sm:inline">Collapse All</span>
              </button>
            </div>
          </div>
        </div>

        {/* Active filter summary pill bar */}
        {activeFiltersCount > 0 && (
          <div className="flex items-center gap-2 pt-2 border-t border-outline-variant/15 text-xs text-on-surface-variant flex-wrap">
            <span className="font-medium">Active Filters:</span>
            {search && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-surface-container-high rounded-md">
                Search: &quot;{search}&quot;
                <button onClick={() => setSearch("")} className="hover:text-on-surface">
                  <span className="material-symbols-outlined text-[12px]">close</span>
                </button>
              </span>
            )}
            {stockFilter && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-surface-container-high rounded-md">
                Status: {stockFilter}
                <button onClick={() => setStockFilter("")} className="hover:text-on-surface">
                  <span className="material-symbols-outlined text-[12px]">close</span>
                </button>
              </span>
            )}
            {colorFilter && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-surface-container-high rounded-md capitalize">
                Color: {colorFilter}
                <button onClick={() => setColorFilter("")} className="hover:text-on-surface">
                  <span className="material-symbols-outlined text-[12px]">close</span>
                </button>
              </span>
            )}
            {sizeFilter && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-surface-container-high rounded-md uppercase">
                Size: {sizeFilter}
                <button onClick={() => setSizeFilter("")} className="hover:text-on-surface">
                  <span className="material-symbols-outlined text-[12px]">close</span>
                </button>
              </span>
            )}
            <span className="text-outline">
              ({filteredGroups.length} of {productGroups.length} products match)
            </span>
          </div>
        )}
      </div>

      {/* Product Master Rows & Size Matrix Container */}
      <div className="flex flex-col gap-3">
        {loading ? (
          /* Loading Skeletons */
          <div className="flex flex-col gap-3">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-4 flex flex-col gap-3 animate-pulse"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-surface-container-high rounded-lg" />
                    <div className="space-y-2">
                      <div className="w-48 h-4 bg-surface-container-high rounded" />
                      <div className="w-28 h-3 bg-surface-container-high rounded" />
                    </div>
                  </div>
                  <div className="w-24 h-6 bg-surface-container-high rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : filteredGroups.length === 0 ? (
          /* Empty State */
          <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-12 text-center flex flex-col items-center justify-center gap-3">
            <span className="material-symbols-outlined text-outline text-[48px]">inventory</span>
            <h3 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
              No matching inventory found
            </h3>
            <p className="font-body-sm text-body-sm text-on-surface-variant max-w-md">
              {activeFiltersCount > 0
                ? "No products or variants matched your current filters. Try resetting the search or filter options."
                : "No products exist in your catalog yet. Create products to start managing physical inventory."}
            </p>
            {activeFiltersCount > 0 ? (
              <button
                onClick={clearAllFilters}
                className="px-4 py-2 bg-primary text-on-primary font-label-caps text-xs rounded-lg hover:bg-primary/90 transition-colors mt-2"
              >
                Clear All Filters
              </button>
            ) : (
              <Link
                href="/admin/products/new"
                className="px-4 py-2 bg-primary text-on-primary font-label-caps text-xs rounded-lg hover:bg-primary/90 transition-colors mt-2"
              >
                Create Product
              </Link>
            )}
          </div>
        ) : (
          /* Product Master Rows */
          filteredGroups.map((product) => {
            const isExpanded = expandedProductIds.has(product.productId);

            return (
              <div
                key={product.productId}
                className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl overflow-hidden shadow-xs transition-shadow hover:shadow-sm"
              >
                {/* Product Summary Row */}
                <div
                  onClick={() => toggleExpandProduct(product.productId)}
                  className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 cursor-pointer hover:bg-surface-container-low/40 transition-colors"
                >
                  {/* Left: Product Info */}
                  <div className="flex items-center gap-3.5 min-w-[280px]">
                    {/* Expand/Collapse Chevron */}
                    <button
                      type="button"
                      aria-expanded={isExpanded}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleExpandProduct(product.productId);
                      }}
                      className="p-1 text-on-surface-variant hover:text-on-surface rounded transition-colors"
                      title={isExpanded ? "Collapse matrix" : "Expand matrix"}
                    >
                      <span
                        className={`material-symbols-outlined text-[20px] transition-transform duration-200 ${
                          isExpanded ? "rotate-90" : ""
                        }`}
                      >
                        chevron_right
                      </span>
                    </button>

                    {/* Thumbnail */}
                    <div className="w-12 h-12 bg-surface-container-high rounded-lg overflow-hidden shrink-0 border border-outline-variant/30 flex items-center justify-center">
                      {product.image ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={product.image}
                          alt={product.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="material-symbols-outlined text-[22px] text-outline">image</span>
                      )}
                    </div>

                    {/* Title, slug, category */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="font-semibold text-on-surface text-sm truncate max-w-md">
                          {product.name}
                        </h2>
                        {product.categoryName && (
                          <span className="px-2 py-0.5 bg-surface-container-high text-on-surface-variant rounded text-[10px] font-label-caps">
                            {product.categoryName}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-on-surface-variant font-label-caps truncate">
                        /{product.slug}
                      </div>
                    </div>
                  </div>

                  {/* Center: Color Swatches & SKU count */}
                  <div className="flex items-center gap-6 flex-wrap">
                    {/* Colourways summary */}
                    <div className="flex items-center gap-2">
                      <div className="flex -space-x-1.5 overflow-hidden py-0.5">
                        {product.colorways.map((cw) => (
                          <span
                            key={cw.color}
                            className="w-4 h-4 rounded-full border border-surface-container-lowest shrink-0 shadow-xs"
                            style={{ backgroundColor: cw.hexCode || "#94A3B8" }}
                            title={cw.color}
                          />
                        ))}
                      </div>
                      <span className="text-xs text-on-surface-variant font-label-caps">
                        {product.colorways.length} {product.colorways.length === 1 ? "Color" : "Colors"} ·{" "}
                        {product.totalVariants} SKUs
                      </span>
                    </div>

                    {/* Stock Health Badges with clear icons and labels */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {product.stockHealth.outOfStockCount > 0 && (
                        <span
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-label-caps font-semibold bg-error-container/30 text-error border border-error/30"
                          title="Out of stock variants"
                        >
                          <span className="material-symbols-outlined text-[13px]">cancel</span>
                          {product.stockHealth.outOfStockCount} Out of Stock
                        </span>
                      )}

                      {product.stockHealth.lowStockCount > 0 && (
                        <span
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-label-caps font-semibold bg-secondary-container/20 text-secondary border border-secondary/30"
                          title="Low stock variants below threshold"
                        >
                          <span className="material-symbols-outlined text-[13px]">warning</span>
                          {product.stockHealth.lowStockCount} Low
                        </span>
                      )}

                      {product.stockHealth.outOfStockCount === 0 &&
                        product.stockHealth.lowStockCount === 0 && (
                          <span
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-label-caps font-semibold bg-primary-container/20 text-primary border border-primary/20"
                            title="All variants healthy"
                          >
                            <span className="material-symbols-outlined text-[13px]">check_circle</span>
                            In Stock ({product.totalStock})
                          </span>
                        )}
                    </div>
                  </div>

                  {/* Right: Total Units & Quick Action buttons */}
                  <div className="flex items-center justify-between lg:justify-end gap-4 shrink-0">
                    <div className="text-left lg:text-right">
                      <div className="text-[10px] font-label-caps uppercase tracking-wider text-on-surface-variant">
                        Total Stock
                      </div>
                      <div className="font-bold text-base text-primary">
                        {product.totalStock.toLocaleString("en-IN")} units
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => toggleExpandProduct(product.productId)}
                        className="px-3 py-1.5 bg-surface-container-low hover:bg-surface-container-high border border-outline-variant/30 rounded-lg font-label-caps text-xs text-on-surface transition-colors flex items-center gap-1"
                      >
                        <span className="material-symbols-outlined text-[15px]">
                          {isExpanded ? "keyboard_arrow_up" : "grid_view"}
                        </span>
                        <span>{isExpanded ? "Hide Matrix" : "View Matrix"}</span>
                      </button>

                      <Link
                        href={`/admin/products/${product.productId}/inventory`}
                        className="p-1.5 text-outline hover:text-primary hover:bg-primary-container/10 border border-outline-variant/30 rounded-lg transition-colors"
                        title="View Inventory History / Audit Ledger"
                      >
                        <span className="material-symbols-outlined text-[17px]">history</span>
                      </Link>

                      <Link
                        href={`/admin/products/${product.productId}/edit`}
                        className="p-1.5 text-outline hover:text-on-surface hover:bg-surface-container-high border border-outline-variant/30 rounded-lg transition-colors"
                        title="Edit Product"
                      >
                        <span className="material-symbols-outlined text-[17px]">edit</span>
                      </Link>
                    </div>
                  </div>
                </div>

                {/* Expanded Colourway × Size Matrix Table */}
                {isExpanded && (
                  <div className="border-t border-outline-variant/20 bg-surface-container-low/20 p-4 md:p-5 flex flex-col gap-3 animate-fade-in">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 pb-1">
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-[18px] text-primary">
                          table_chart
                        </span>
                        <h3 className="font-label-caps text-xs font-bold uppercase tracking-wider text-on-surface">
                          Variant Matrix ({product.name})
                        </h3>
                      </div>
                      <span className="text-[11px] text-on-surface-variant font-label-caps">
                        Click any stock pill to adjust quantity or record physical audit
                      </span>
                    </div>

                    {product.colorways.length === 0 ? (
                      <div className="p-6 text-center text-on-surface-variant font-body-sm bg-surface-container-lowest rounded-lg border border-outline-variant/20">
                        No variants configured for this product.
                      </div>
                    ) : (
                      <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl overflow-hidden shadow-xs">
                        <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse min-w-[540px]">
                            <thead>
                              <tr className="bg-surface-container-low/60 border-b border-outline-variant/20 text-outline font-label-caps text-[11px] uppercase tracking-wider">
                                <th className="py-2.5 px-4 font-semibold w-48">Colourway</th>
                                {product.allSizes.map((sizeName) => (
                                  <th
                                    key={sizeName}
                                    className="py-2.5 px-3 font-semibold text-center min-w-[76px]"
                                  >
                                    Size {sizeName}
                                  </th>
                                ))}
                                <th className="py-2.5 px-4 font-semibold text-right w-28">Total</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-outline-variant/15 font-body-sm text-sm">
                              {product.colorways.map((cw) => (
                                <tr
                                  key={cw.color}
                                  className="hover:bg-surface-container-low/30 transition-colors"
                                >
                                  {/* Colourway Info */}
                                  <td className="py-3 px-4">
                                    <div className="flex items-center gap-2.5">
                                      <span
                                        className="w-4 h-4 rounded-full border border-black/20 shrink-0 shadow-xs"
                                        style={{ backgroundColor: cw.hexCode || "#94A3B8" }}
                                        title={cw.color}
                                      />
                                      <div>
                                        <div className="font-semibold text-xs text-on-surface">
                                          {cw.color}
                                        </div>
                                        <div className="text-[10px] text-on-surface-variant font-label-caps">
                                          {cw.variants.length} {cw.variants.length === 1 ? "size" : "sizes"}
                                        </div>
                                      </div>
                                    </div>
                                  </td>

                                  {/* Size Matrix Columns */}
                                  {product.allSizes.map((sizeName) => {
                                    const variantsForSize = cw.variantsBySize[sizeName] || [];

                                    if (variantsForSize.length === 0) {
                                      return (
                                        <td key={sizeName} className="py-3 px-3 text-center">
                                          <span
                                            className="text-outline/40 font-mono text-xs select-none"
                                            title="Not stocked in this colour"
                                          >
                                            —
                                          </span>
                                        </td>
                                      );
                                    }

                                    return (
                                      <td key={sizeName} className="py-2 px-2 text-center">
                                        <div className="flex flex-col items-center gap-1">
                                          {variantsForSize.map((v) => {
                                            const isOOS = v.stockStatus === "OUT_OF_STOCK";
                                            const isLow = v.stockStatus === "LOW_STOCK";

                                            return (
                                              <button
                                                key={v.variantId}
                                                type="button"
                                                onClick={() => openAdjustPopover(v)}
                                                className={`group relative inline-flex items-center justify-between gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-label-caps font-semibold transition-all cursor-pointer hover:scale-105 active:scale-95 shadow-2xs ${
                                                  isOOS
                                                    ? "bg-error-container/25 text-error border-error/40 hover:bg-error-container/40 ring-1 ring-error/20"
                                                    : isLow
                                                    ? "bg-secondary-container/20 text-secondary border-secondary/40 hover:bg-secondary-container/30 ring-1 ring-secondary/20"
                                                    : "bg-surface-container-low/80 text-on-surface border-outline-variant/30 hover:border-primary hover:text-primary hover:bg-primary-container/10"
                                                }`}
                                                title={`Click to adjust stock · SKU: ${v.sku} · Current: ${v.stock} units · Min: ${v.reorderThreshold}`}
                                              >
                                                <span className="flex items-center gap-1">
                                                  {isOOS ? (
                                                    <span className="material-symbols-outlined text-[13px] text-error">
                                                      cancel
                                                    </span>
                                                  ) : isLow ? (
                                                    <span className="material-symbols-outlined text-[13px] text-secondary">
                                                      warning
                                                    </span>
                                                  ) : null}
                                                  <span className="font-bold">{v.stock}</span>
                                                </span>
                                                <span className="material-symbols-outlined text-[12px] opacity-40 group-hover:opacity-100 transition-opacity">
                                                  tune
                                                </span>
                                              </button>
                                            );
                                          })}
                                        </div>
                                      </td>
                                    );
                                  })}

                                  {/* Total Units for this Colourway */}
                                  <td className="py-3 px-4 text-right">
                                    <div className="font-bold text-xs text-on-surface">
                                      {cw.totalStock} units
                                    </div>
                                    {cw.hasOutOfStock ? (
                                      <span className="text-[10px] text-error font-label-caps font-semibold">
                                        OOS Alert
                                      </span>
                                    ) : cw.hasLowStock ? (
                                      <span className="text-[10px] text-secondary font-label-caps font-semibold">
                                        Low Alert
                                      </span>
                                    ) : (
                                      <span className="text-[10px] text-outline font-label-caps">
                                        Healthy
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Pagination Bar */}
      {filteredGroups.length > 0 && (
        <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xs">
          <div className="text-xs text-on-surface-variant font-label-caps">
            Showing <span className="font-bold text-on-surface">{filteredGroups.length}</span> of{" "}
            <span className="font-bold text-on-surface">{totalBackendProducts || productGroups.length}</span> products{" "}
            ({stats.totalVariants} SKUs total)
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs text-on-surface-variant font-label-caps">
              <span>Per page:</span>
              <select
                value={limit}
                onChange={(e) => {
                  setLimit(Number(e.target.value));
                  setPage(1);
                }}
                className="bg-surface-container-low border border-outline-variant/30 rounded px-2 py-1 text-on-surface focus:outline-none"
              >
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>

            <div className="flex items-center gap-1">
              <button
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="p-1.5 border border-outline-variant/30 rounded-lg text-on-surface disabled:opacity-40 hover:bg-surface-container-high transition-colors"
                title="Previous Page"
              >
                <span className="material-symbols-outlined text-[18px]">chevron_left</span>
              </button>
              <span className="px-2 font-label-caps text-xs font-semibold text-on-surface">
                Page {page}
              </span>
              <button
                disabled={filteredGroups.length < limit || loading}
                onClick={() => setPage((p) => p + 1)}
                className="p-1.5 border border-outline-variant/30 rounded-lg text-on-surface disabled:opacity-40 hover:bg-surface-container-high transition-colors"
                title="Next Page"
              >
                <span className="material-symbols-outlined text-[18px]">chevron_right</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lightweight Inline Adjustment Popover Overlay */}
      {adjustingVariant && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-fade-in"
          onClick={() => setAdjustingVariant(null)}
        >
          <div
            className="bg-surface-container-lowest border border-outline-variant/30 rounded-2xl shadow-xl w-full max-w-md p-6 overflow-hidden flex flex-col gap-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Popover Header */}
            <div className="flex items-center justify-between pb-3 border-b border-outline-variant/20">
              <div className="flex items-center gap-2.5">
                <span className="material-symbols-outlined text-primary text-[22px]">tune</span>
                <div>
                  <h3 className="font-bold text-base text-on-surface">
                    Adjust Inventory
                  </h3>
                  <p className="text-xs text-on-surface-variant font-label-caps">
                    {adjustingVariant.sku}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setAdjustingVariant(null)}
                className="p-1.5 text-on-surface-variant hover:text-on-surface rounded-lg hover:bg-surface-container-high transition-colors"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {/* Product & Variant Context Card */}
            <div className="bg-surface-container-low p-3.5 rounded-xl border border-outline-variant/20 flex items-center justify-between">
              <div>
                <div className="font-semibold text-sm text-on-surface">
                  {adjustingVariant.productName}
                </div>
                <div className="text-xs text-on-surface-variant flex items-center gap-1.5 mt-0.5">
                  <span
                    className="w-2.5 h-2.5 rounded-full border border-black/20"
                    style={{ backgroundColor: adjustingVariant.hexCode || "#94A3B8" }}
                  />
                  <span>{adjustingVariant.color}</span>
                  <span>·</span>
                  <span className="font-bold">Size {adjustingVariant.size}</span>
                </div>
              </div>

              <div className="text-right">
                <div className="text-[10px] font-label-caps uppercase text-on-surface-variant">
                  Current Stock
                </div>
                <div className="font-bold text-lg text-primary">
                  {adjustingVariant.stock} units
                </div>
              </div>
            </div>

            {/* Adjustment Error display */}
            {adjustError && (
              <div className="p-3 text-xs bg-error-container/20 text-error border border-error/30 rounded-lg flex items-center gap-2">
                <span className="material-symbols-outlined text-[16px] shrink-0">error</span>
                <span>{adjustError}</span>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleAdjustSubmit} className="flex flex-col gap-4">
              {/* Adjustment Mode Toggle */}
              <div className="flex flex-col gap-1.5">
                <label className="font-label-caps text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
                  Adjustment Type
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setAdjustType("RESTOCK");
                      if (adjustQty < 0) setAdjustQty(Math.abs(adjustQty) || 5);
                    }}
                    className={`py-2 px-3 rounded-lg text-xs font-label-caps font-semibold flex items-center justify-center gap-1.5 border transition-all ${
                      adjustType === "RESTOCK"
                        ? "bg-primary text-on-primary border-primary shadow-xs"
                        : "bg-surface-container-low text-on-surface border-outline-variant/30 hover:bg-surface-container-high"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[16px]">add_circle</span>
                    Restock (+)
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setAdjustType("ADJUSTMENT");
                    }}
                    className={`py-2 px-3 rounded-lg text-xs font-label-caps font-semibold flex items-center justify-center gap-1.5 border transition-all ${
                      adjustType === "ADJUSTMENT"
                        ? "bg-secondary text-on-secondary border-secondary shadow-xs"
                        : "bg-surface-container-low text-on-surface border-outline-variant/30 hover:bg-surface-container-high"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[16px]">rule</span>
                    Audit Count (±)
                  </button>
                </div>
              </div>

              {/* Quantity Stepper & Input */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="font-label-caps text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
                    Quantity Adjustment
                  </label>
                  <span className="text-xs font-medium text-on-surface">
                    New Stock:{" "}
                    <span
                      className={`font-bold ${
                        adjustingVariant.stock + adjustQty < 0
                          ? "text-error"
                          : adjustingVariant.stock + adjustQty === 0
                          ? "text-error"
                          : adjustingVariant.stock + adjustQty <= adjustingVariant.reorderThreshold
                          ? "text-secondary"
                          : "text-primary"
                      }`}
                    >
                      {adjustingVariant.stock + adjustQty} units
                    </span>
                  </span>
                </div>

                {/* Quick Stepper Chips */}
                <div className="flex items-center gap-1.5 flex-wrap my-1">
                  {adjustType === "ADJUSTMENT" && (
                    <>
                      <button
                        type="button"
                        onClick={() => setAdjustQty((q) => q - 10)}
                        className="px-2 py-1 bg-surface-container-low hover:bg-surface-container-high text-on-surface border border-outline-variant/30 rounded text-xs font-label-caps"
                      >
                        -10
                      </button>
                      <button
                        type="button"
                        onClick={() => setAdjustQty((q) => q - 5)}
                        className="px-2 py-1 bg-surface-container-low hover:bg-surface-container-high text-on-surface border border-outline-variant/30 rounded text-xs font-label-caps"
                      >
                        -5
                      </button>
                      <button
                        type="button"
                        onClick={() => setAdjustQty((q) => q - 1)}
                        className="px-2 py-1 bg-surface-container-low hover:bg-surface-container-high text-on-surface border border-outline-variant/30 rounded text-xs font-label-caps"
                      >
                        -1
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => setAdjustQty((q) => q + 1)}
                    className="px-2 py-1 bg-surface-container-low hover:bg-surface-container-high text-on-surface border border-outline-variant/30 rounded text-xs font-label-caps"
                  >
                    +1
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdjustQty((q) => q + 5)}
                    className="px-2 py-1 bg-surface-container-low hover:bg-surface-container-high text-on-surface border border-outline-variant/30 rounded text-xs font-label-caps"
                  >
                    +5
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdjustQty((q) => q + 10)}
                    className="px-2 py-1 bg-surface-container-low hover:bg-surface-container-high text-on-surface border border-outline-variant/30 rounded text-xs font-label-caps"
                  >
                    +10
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdjustQty((q) => q + 25)}
                    className="px-2 py-1 bg-surface-container-low hover:bg-surface-container-high text-on-surface border border-outline-variant/30 rounded text-xs font-label-caps"
                  >
                    +25
                  </button>
                </div>

                <input
                  required
                  type="number"
                  placeholder="e.g. 10 or -3"
                  className="w-full px-3.5 py-2.5 bg-surface-container-low border border-outline-variant/30 rounded-lg focus:outline-none focus:border-primary font-body-sm text-on-surface"
                  value={adjustQty === 0 ? "" : adjustQty}
                  onChange={(e) => setAdjustQty(e.target.value === "" ? 0 : Number(e.target.value))}
                />
              </div>

              {/* Reason / Reference field with one-click quick presets */}
              <div className="flex flex-col gap-1.5">
                <label className="font-label-caps text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
                  Audit Reason (Required)
                </label>

                {/* Quick Reason Suggestions */}
                <div className="flex flex-wrap gap-1 mb-1">
                  {[
                    "Physical audit count",
                    "Factory shipment restock",
                    "Damaged goods deduction",
                    "Customer return replacement",
                  ].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setAdjustReason(preset)}
                      className="px-2 py-0.5 text-[10px] bg-surface-container-high hover:bg-surface-container-highest text-on-surface-variant rounded transition-colors"
                    >
                      + {preset}
                    </button>
                  ))}
                </div>

                <input
                  required
                  type="text"
                  placeholder="e.g. Physical inventory count, Restock PO #104"
                  className="w-full px-3.5 py-2 bg-surface-container-low border border-outline-variant/30 rounded-lg focus:outline-none focus:border-primary font-body-sm text-sm text-on-surface placeholder:text-outline"
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                />
              </div>

              {/* Modal Action Buttons */}
              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-outline-variant/20">
                <button
                  type="button"
                  disabled={isSubmittingAdjust}
                  onClick={() => setAdjustingVariant(null)}
                  className="px-4 py-2 border border-outline-variant/30 text-on-surface font-label-caps text-xs rounded-lg hover:bg-surface-container-high transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingAdjust || adjustQty === 0}
                  className="px-4 py-2 bg-primary text-on-primary font-label-caps text-xs rounded-lg hover:bg-primary/90 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isSubmittingAdjust ? (
                    <>
                      <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
                      <span>Saving...</span>
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-[16px]">save</span>
                      <span>Save Stock Adjustment</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
