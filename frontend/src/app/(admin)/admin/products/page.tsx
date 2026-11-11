"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import axios from "axios";
import { api } from "@/lib/api";
import {
  type RawProduct,
  type RawVariant,
  resolveColorHex,
  sortSizes,
} from "@/lib/inventoryUtils";

const STATUS_OPTIONS = ["", "ACTIVE", "DRAFT", "ARCHIVED"];

interface ProductItem extends RawProduct {
  basePrice?: number;
  status: string;
}

interface ColorwaySummary {
  color: string;
  hexCode?: string;
  image?: string;
  sizes: string[];
  totalStock: number;
  skus: string[];
}

interface ProductVariantSummary {
  totalVariants: number;
  totalStock: number;
  colors: ColorwaySummary[];
  allSizes: string[];
  hasOutOfStock: boolean;
  hasLowStock: boolean;
}

function summarizeProductVariants(variants: RawVariant[] = []): ProductVariantSummary {
  const colorMap = new Map<string, ColorwaySummary>();
  const sizeSet = new Set<string>();
  let totalStock = 0;
  let hasOutOfStock = false;
  let hasLowStock = false;

  variants.forEach((v) => {
    const color = (v.color || "Standard").trim();
    const size = (v.size || "Standard").trim();
    const stock = typeof v.stock === "number" ? v.stock : 0;
    const threshold = typeof v.reorderThreshold === "number" ? v.reorderThreshold : 5;

    totalStock += stock;
    if (stock === 0) hasOutOfStock = true;
    else if (stock <= threshold) hasLowStock = true;

    sizeSet.add(size);

    const hex = resolveColorHex(color, v.hexCode, variants);
    const key = color.toLowerCase();

    if (!colorMap.has(key)) {
      colorMap.set(key, {
        color,
        hexCode: hex,
        image: Array.isArray(v.images) && v.images.length > 0 ? v.images[0] : undefined,
        sizes: [],
        totalStock: 0,
        skus: [],
      });
    }

    const entry = colorMap.get(key)!;
    if (!entry.sizes.includes(size)) entry.sizes.push(size);
    entry.totalStock += stock;
    if (v.sku && !entry.skus.includes(v.sku)) entry.skus.push(v.sku);
  });

  const colors = Array.from(colorMap.values()).map((c) => ({
    ...c,
    sizes: sortSizes(c.sizes),
  }));

  return {
    totalVariants: variants.length,
    totalStock,
    colors,
    allSizes: sortSizes(Array.from(sizeSet)),
    hasOutOfStock,
    hasLowStock,
  };
}

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
function ProductThumbnail({ src, name }: { src?: string; name?: string }) {
  const [hasError, setHasError] = useState(false);
  const isUsable = src && !hasError && !src.includes("example.com");

  if (!isUsable) {
    return (
      <div className="w-16 h-18 bg-surface-container-high rounded-lg border border-outline-variant/30 flex items-center justify-center text-outline shrink-0">
        <span className="material-symbols-outlined text-[20px]">checkroom</span>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={name || "Product"}
      onError={() => setHasError(true)}
      className="w-16 h-18 rounded-lg object-cover border border-outline-variant/30 shrink-0 bg-surface-container"
    />
  );
}


export default function AdminProductsPage() {
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [colorFilter, setColorFilter] = useState("");
  const [statusOpen, setStatusOpen] = useState(false);
  const [actionSuccess, setActionSuccess] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Expanded product IDs for inline variant drawers
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpand = (productId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  };

  const handleDeleteProduct = async (id: string, name: string) => {
    if (
      !window.confirm(
        `Are you sure you want to permanently delete "${name}"? Associated Cloudinary images will also be removed.`
      )
    ) {
      return;
    }
    setDeletingId(id);
    setError("");
    setActionSuccess("");
    try {
      const res = await api.delete(`/admin/products/${id}`);
      setProducts((prev) => prev.filter((p) => p._id !== id));
      setActionSuccess(res.data?.message || "Product and Cloudinary assets deleted successfully");
    } catch (err: unknown) {
      setError(extractErrorMessage(err, "Failed to delete product"));
    } finally {
      setDeletingId(null);
    }
  };

  useEffect(() => {
    const handler = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(handler);
  }, [search]);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { limit: 50 };
      if (debouncedSearch) params.search = debouncedSearch;
      if (statusFilter && statusFilter !== "OUT_OF_STOCK") params.status = statusFilter;
      const res = await api.get("/admin/products", { params });
      setProducts(res.data?.data?.items || []);
      setError("");
    } catch (err: unknown) {
      setError(extractErrorMessage(err, "Failed to fetch products"));
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, statusFilter]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  // Extract unique colors across all loaded products for color filtering
  const availableColors = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => {
      (p.variants || []).forEach((v) => {
        if (v.color?.trim()) set.add(v.color.trim());
      });
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [products]);

  // Client-side color filter (backend supports search & status)
  const filteredProducts = useMemo(() => {
    let list = products;
    if (colorFilter) {
      const target = colorFilter.toLowerCase();
      list = list.filter((p) =>
        (p.variants || []).some(
          (v) => (v.color || "").trim().toLowerCase() === target
        )
      );
    }
    if (statusFilter === "OUT_OF_STOCK") {
      list = list.filter(
        (p) => !p.variants || p.variants.length === 0 || p.variants.every((v) => (v.stock || 0) === 0)
      );
    }
    return list;
  }, [products, colorFilter, statusFilter]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "ACTIVE":
        return "bg-primary-container/20 text-primary border border-primary/20";
      case "DRAFT":
        return "bg-surface-container-high text-on-surface border border-outline-variant/30";
      case "ARCHIVED":
        return "bg-error-container/20 text-error border border-error/20";
      default:
        return "bg-surface-container-high text-on-surface border border-outline-variant/30";
    }
  };

  const kpiCounts = {
    total: products.length,
    active: products.filter((p) => p.status === "ACTIVE").length,
    draft: products.filter((p) => p.status === "DRAFT").length,
    archived: products.filter((p) => p.status === "ARCHIVED").length,
    outOfStock: products.filter(
      (p) =>
        !p.variants ||
        p.variants.length === 0 ||
        p.variants.every((v) => (v.stock || 0) === 0)
    ).length,
  };

  return (
    <div className="flex flex-col gap-element-gap md:gap-gutter">
      {/* Page Header */}
      <div className="flex flex-row items-center justify-between gap-3 mb-2">
        <div>
          <h1 className="font-headline-lg text-xl sm:text-2xl font-bold text-on-background">Products</h1>
          <p className="font-body-md text-xs sm:text-sm text-on-surface-variant max-w-2xl mt-0.5">
            Manage your SamratFashion product catalog, variants, and colors.
          </p>
        </div>
        <Link
          href="/admin/products/new"
          className="flex items-center gap-1.5 px-3.5 py-2 sm:px-5 sm:py-2.5 bg-primary text-on-primary font-mono text-xs font-bold rounded-lg hover:opacity-90 transition-opacity shadow-xs shrink-0"
        >
          <span className="material-symbols-outlined text-[17px]">add</span>
          <span className="hidden xs:inline">Add Product</span>
          <span className="xs:hidden">New</span>
        </Link>
      </div>

      {error && (
        <div className="text-error bg-error-container/20 p-4 rounded-md font-body-sm flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">error_outline</span>
          {error}
        </div>
      )}
      {actionSuccess && (
        <div className="text-primary bg-primary-container/20 p-4 rounded-md font-body-sm flex items-center justify-between gap-2 border border-primary/20">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">check_circle</span>
            {actionSuccess}
          </div>
          <button type="button" onClick={() => setActionSuccess("")} className="hover:opacity-75">
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      )}

      {/* KPI Cards */}
      {/* KPI Cards / Filter Strip */}
      <section className="flex overflow-x-auto pb-1 gap-2.5 scrollbar-none snap-x sm:grid sm:grid-cols-3 md:grid-cols-5 sm:gap-4">
        <button
          type="button"
          onClick={() => { setStatusFilter(""); setSearch(""); }}
          className={`text-left bg-surface border rounded-xl p-3 sm:p-4 flex flex-col justify-between min-w-[125px] sm:min-w-0 sm:h-24 shrink-0 snap-start transition-all cursor-pointer ${
            statusFilter === "" ? "border-primary ring-2 ring-primary/20 bg-primary/[0.02]" : "border-outline-variant/30 hover:border-outline-variant"
          }`}
        >
          <span className="font-mono text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Total Products</span>
          <span className="text-xl sm:text-2xl font-bold font-mono text-on-surface mt-1">
            {loading ? "—" : kpiCounts.total}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter((prev) => (prev === "ACTIVE" ? "" : "ACTIVE"))}
          className={`text-left bg-surface border rounded-xl p-3 sm:p-4 flex flex-col justify-between min-w-[125px] sm:min-w-0 sm:h-24 shrink-0 snap-start transition-all cursor-pointer ${
            statusFilter === "ACTIVE" ? "border-emerald-600 ring-2 ring-emerald-500/20 bg-emerald-500/[0.04]" : "border-outline-variant/30 hover:border-emerald-300"
          }`}
        >
          <span className="font-mono text-[10px] font-bold text-emerald-700 uppercase tracking-wider">Active</span>
          <span className="text-xl sm:text-2xl font-bold font-mono text-emerald-900 mt-1">
            {loading ? "—" : kpiCounts.active}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter((prev) => (prev === "DRAFT" ? "" : "DRAFT"))}
          className={`text-left bg-surface border rounded-xl p-3 sm:p-4 flex flex-col justify-between min-w-[125px] sm:min-w-0 sm:h-24 shrink-0 snap-start transition-all cursor-pointer ${
            statusFilter === "DRAFT" ? "border-neutral-700 ring-2 ring-neutral-500/20 bg-neutral-500/[0.04]" : "border-outline-variant/30 hover:border-outline-variant"
          }`}
        >
          <span className="font-mono text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Draft</span>
          <span className="text-xl sm:text-2xl font-bold font-mono text-on-surface mt-1">
            {loading ? "—" : kpiCounts.draft}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter((prev) => (prev === "OUT_OF_STOCK" ? "" : "OUT_OF_STOCK"))}
          className={`text-left bg-surface border rounded-xl p-3 sm:p-4 flex flex-col justify-between min-w-[125px] sm:min-w-0 sm:h-24 shrink-0 snap-start transition-all cursor-pointer ${
            statusFilter === "OUT_OF_STOCK" ? "border-rose-600 ring-2 ring-rose-500/20 bg-rose-500/[0.04]" : "border-outline-variant/30 hover:border-rose-300"
          }`}
        >
          <span className="font-mono text-[10px] font-bold text-rose-700 uppercase tracking-wider">Out of Stock</span>
          <span className="text-xl sm:text-2xl font-bold font-mono text-rose-900 mt-1">
            {loading ? "—" : kpiCounts.outOfStock}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter((prev) => (prev === "ARCHIVED" ? "" : "ARCHIVED"))}
          className={`text-left bg-surface border rounded-xl p-3 sm:p-4 flex flex-col justify-between min-w-[125px] sm:min-w-0 sm:h-24 shrink-0 snap-start transition-all cursor-pointer ${
            statusFilter === "ARCHIVED" ? "border-neutral-500 ring-2 ring-neutral-500/20 bg-neutral-500/[0.04]" : "border-outline-variant/30 hover:border-neutral-300"
          }`}
        >
          <span className="font-mono text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Archived</span>
          <span className="text-xl sm:text-2xl font-bold font-mono text-on-surface mt-1">
            {loading ? "—" : kpiCounts.archived}
          </span>
        </button>
      </section>

      {/* Filter and Search Toolbar */}
      <div className="flex flex-col md:flex-row gap-3 items-start md:items-center justify-between bg-surface-container-lowest p-4 rounded-t-xl border border-outline-variant/20 border-b-0">
        <div className="w-full md:w-auto flex-1 max-w-md relative">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-[18px]">
            search
          </span>
          <input
            type="text"
            placeholder="Search products by name, slug, or SKU..."
            className="w-full pl-10 pr-4 py-2.5 bg-surface-container-low border border-outline-variant/30 rounded-lg focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary font-body-sm text-body-sm text-on-surface transition-all placeholder:text-outline"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="w-full md:w-auto flex flex-wrap gap-2 items-center">
          {/* Status Filter Dropdown */}
          <div className="relative">
            <button
              onClick={() => setStatusOpen(!statusOpen)}
              className="flex items-center gap-2 px-3 py-2 bg-surface-container-low border border-outline-variant/30 rounded-lg font-label-caps text-label-caps text-on-surface-variant hover:bg-surface-container-highest transition-colors whitespace-nowrap"
            >
              Status: {statusFilter || "All"}
              <span className="material-symbols-outlined text-[18px]">keyboard_arrow_down</span>
            </button>
            {statusOpen && (
              <div className="absolute top-full left-0 mt-1 bg-surface-container-lowest border border-outline-variant/30 rounded-lg shadow-[0_12px_40px_rgba(15,23,42,0.08)] z-20 py-1 min-w-[140px]">
                {STATUS_OPTIONS.map((s) => (
                  <button
                    key={s}
                    className={`w-full text-left px-4 py-2 font-label-caps text-label-caps hover:bg-surface-container-high transition-colors ${
                      statusFilter === s ? "text-primary bg-primary-container/10" : "text-on-surface"
                    }`}
                    onClick={() => {
                      setStatusFilter(s);
                      setStatusOpen(false);
                    }}
                  >
                    {s || "All"}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Color Filter Dropdown */}
          {availableColors.length > 0 && (
            <select
              value={colorFilter}
              onChange={(e) => setColorFilter(e.target.value)}
              className="px-3 py-2 bg-surface-container-low border border-outline-variant/30 rounded-lg font-label-caps text-label-caps text-on-surface-variant focus:outline-none focus:border-primary transition-colors cursor-pointer"
            >
              <option value="">Colour: All ({availableColors.length})</option>
              {availableColors.map((color) => (
                <option key={color} value={color}>
                  {color}
                </option>
              ))}
            </select>
          )}

          {(search || statusFilter || colorFilter) && (
            <button
              onClick={() => {
                setSearch("");
                setStatusFilter("");
                setColorFilter("");
              }}
              className="p-2 border border-outline-variant/30 rounded-lg text-on-surface-variant hover:bg-surface-container-high transition-colors"
              title="Clear filters"
            >
              <span className="material-symbols-outlined text-[18px]">filter_list_off</span>
            </button>
          )}
        </div>
      </div>

      {/* Mobile Card List (shown on screens < 768px) */}
      <div className="block md:hidden bg-surface-container-lowest border border-outline-variant/20 rounded-b-xl divide-y divide-outline-variant/10 p-3 space-y-3">
        {loading ? (
          <div className="py-12 text-center text-xs font-mono text-neutral-400">Loading products...</div>
        ) : filteredProducts.length === 0 ? (
          <div className="py-12 text-center space-y-2">
            <span className="material-symbols-outlined text-outline text-[40px]">inventory_2</span>
            <p className="text-xs text-neutral-500">No products match your criteria</p>
          </div>
        ) : (
          filteredProducts.map((p) => {
            const summary = summarizeProductVariants(p.variants);
            const categoryName = typeof p.categoryId === "object" && p.categoryId ? (p.categoryId as any).name : "—";
            const isExpanded = expandedIds.has(p._id);

            return (
              <div key={p._id} className="bg-surface border border-outline-variant/30 rounded-xl p-3.5 space-y-3 shadow-xs">
                {/* Top Row: Thumbnail + Product Meta */}
                <div className="flex gap-3 items-start">
                  <div className="shrink-0">
                    <ProductThumbnail src={p.images?.[0]} name={p.name} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <Link
                        href={`/shop/${p.slug}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-headline-sm text-sm font-bold text-on-surface truncate hover:text-primary transition-colors inline-flex items-center gap-1 group/mobtitle focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded-xs"
                        title={`View "${p.name}" on storefront (opens in new tab)`}
                      >
                        <span className="truncate group-hover/mobtitle:underline">{p.name}</span>
                        <span className="material-symbols-outlined text-[13px] text-outline shrink-0">open_in_new</span>
                      </Link>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase shrink-0 ${
                        p.status === "ACTIVE"
                          ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                          : p.status === "DRAFT"
                          ? "bg-neutral-100 text-neutral-700 border border-neutral-200"
                          : "bg-rose-100 text-rose-800 border border-rose-200"
                      }`}>
                        {p.status}
                      </span>
                    </div>
                    <Link
                      href={`/shop/${p.slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] font-mono text-neutral-500 hover:text-primary transition-colors truncate block"
                      title={`Live slug: /shop/${p.slug}`}
                    >
                      /{p.slug}
                    </Link>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 bg-surface-container-high rounded text-neutral-600">
                        {categoryName}
                      </span>
                      <span className="font-mono text-xs font-bold text-neutral-900">
                        ₹{p.basePrice?.toLocaleString() || "—"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Colors & Sizes Swatches on Mobile */}
                {summary.colors.length > 0 && (
                  <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                    {summary.colors.map((c) => (
                      <span
                        key={c.color}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-container-high border border-outline-variant/30 text-[11px] font-medium text-on-surface"
                      >
                        <span
                          className="w-2 h-2 rounded-full border border-black/20 shrink-0"
                          style={{ backgroundColor: c.hexCode || "#94A3B8" }}
                        />
                        <span>{c.color}</span>
                      </span>
                    ))}
                    <span className="text-[11px] font-mono text-neutral-500">
                      · Sizes: {summary.allSizes.join(", ") || "Standard"}
                    </span>
                  </div>
                )}

                {/* Stock & Summary Bar */}
                <div className="flex items-center justify-between text-xs font-mono pt-1 border-t border-outline-variant/15 text-neutral-600">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-neutral-400">Stock:</span>
                    <strong className={summary.hasOutOfStock ? "text-error" : summary.hasLowStock ? "text-amber-600" : "text-emerald-700"}>
                      {summary.totalStock} units
                    </strong>
                  </div>
                  <div className="text-[11px] text-neutral-500">
                    {summary.totalVariants} {summary.totalVariants === 1 ? "SKU" : "SKUs"}
                  </div>
                </div>

                {/* Mobile Actions with 44px Touch Targets */}
                <div className="pt-2 border-t border-outline-variant/15 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleExpand(p._id)}
                    aria-expanded={isExpanded}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-lg font-mono text-xs font-bold border transition-colors min-h-[44px] cursor-pointer ${
                      isExpanded
                        ? "bg-primary/10 border-primary/30 text-primary"
                        : "bg-surface-container border-outline-variant/40 text-on-surface hover:bg-surface-container-high"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[16px]">
                      {isExpanded ? "expand_less" : "expand_more"}
                    </span>
                    <span>{isExpanded ? "Hide SKUs" : `SKUs (${summary.totalVariants})`}</span>
                  </button>
                  <Link
                    href={`/admin/products/${p._id}/edit`}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 bg-neutral-900 text-white rounded-lg font-mono text-xs font-bold uppercase transition-colors min-h-[44px] hover:bg-neutral-800"
                  >
                    <span className="material-symbols-outlined text-[15px]">edit</span>
                    <span>Edit</span>
                  </Link>
                  <Link
                    href={`/admin/products/${p._id}/inventory`}
                    className="p-2.5 bg-surface-container border border-outline-variant/40 text-on-surface rounded-lg hover:bg-surface-container-high transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0"
                    title="Inventory Ledger"
                    aria-label="Inventory Ledger"
                  >
                    <span className="material-symbols-outlined text-[18px]">warehouse</span>
                  </Link>
                  <button
                    type="button"
                    onClick={() => handleDeleteProduct(p._id, p.name)}
                    disabled={deletingId === p._id}
                    className="p-2.5 bg-surface-container border border-outline-variant/40 text-outline hover:text-error hover:border-error/40 rounded-lg transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0 disabled:opacity-50 cursor-pointer"
                    title="Delete Product"
                    aria-label="Delete Product"
                  >
                    <span className="material-symbols-outlined text-[18px]">
                      {deletingId === p._id ? "hourglass_empty" : "delete"}
                    </span>
                  </button>
                </div>

                {/* Expandable Mobile Variant Breakdown Panel */}
                {isExpanded && (
                  <div className="pt-2.5 border-t border-outline-variant/15 space-y-2 animate-fadeIn">
                    <div className="flex items-center justify-between text-[10px] font-mono text-outline uppercase font-bold tracking-wider">
                      <span>Variant / SKU</span>
                      <span>Stock</span>
                    </div>
                    <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1 divide-y divide-outline-variant/10">
                      {(p.variants || []).map((v) => (
                        <div key={v._id || `${v.size}-${v.color}`} className="pt-1.5 first:pt-0 flex items-center justify-between text-xs font-mono">
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="w-2.5 h-2.5 rounded-full border border-black/20 shrink-0"
                              style={{ backgroundColor: resolveColorHex(v.color, undefined, p.variants) }}
                            />
                            <span className="font-semibold text-on-surface">{v.color}</span>
                            <span className="text-outline font-bold">· {v.size}</span>
                            <span className="text-[10px] text-neutral-400 truncate max-w-[90px]">{v.sku}</span>
                          </div>
                          <div className="shrink-0 text-right">
                            <span className={`font-bold ${v.stock === 0 ? "text-error" : v.stock < 5 ? "text-amber-600" : "text-emerald-700"}`}>
                              {v.stock} pcs
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Data Table with Colours & Variants (hidden on mobile, shown on md+) */}
      <div className="hidden md:block bg-surface-container-lowest border border-outline-variant/20 rounded-b-xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container-lowest border-b border-outline-variant/20">
                <th className="py-3 px-4 font-label-caps text-label-caps text-outline font-medium tracking-wider whitespace-nowrap">
                  Product
                </th>
                <th className="py-3 px-4 font-label-caps text-label-caps text-outline font-medium tracking-wider whitespace-nowrap">
                  Category
                </th>
                <th className="py-3 px-4 font-label-caps text-label-caps text-outline font-medium tracking-wider whitespace-nowrap">
                  Variants &amp; Colours
                </th>
                <th className="py-3 px-4 font-label-caps text-label-caps text-outline font-medium tracking-wider whitespace-nowrap text-center">
                  Total Stock
                </th>
                <th className="py-3 px-4 font-label-caps text-label-caps text-outline font-medium tracking-wider whitespace-nowrap text-right">
                  Price
                </th>
                <th className="py-3 px-4 font-label-caps text-label-caps text-outline font-medium tracking-wider whitespace-nowrap text-center">
                  Status
                </th>
                <th className="py-3 px-4 font-label-caps text-label-caps text-outline font-medium tracking-wider whitespace-nowrap text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="font-body-sm text-body-sm text-on-surface">
              {loading ? (
                <>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <tr key={i} className="border-b border-outline-variant/10">
                      {[1, 2, 3, 4, 5, 6, 7].map((j) => (
                        <td key={j} className="py-3 px-4">
                          <div className="h-4 bg-surface-container-low rounded animate-pulse" />
                        </td>
                      ))}
                    </tr>
                  ))}
                </>
              ) : filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-16 px-4">
                    <div className="flex flex-col items-center gap-3 text-center">
                      <span className="material-symbols-outlined text-outline text-[48px]">
                        inventory_2
                      </span>
                      <p className="font-body-md text-body-md text-on-surface-variant">
                        {search || statusFilter || colorFilter
                          ? "No products match your filter criteria"
                          : "No products found"}
                      </p>
                      <Link
                        href="/admin/products/new"
                        className="font-label-caps text-label-caps text-primary hover:underline"
                      >
                        Add your first product
                      </Link>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredProducts.map((p) => {
                  const summary = summarizeProductVariants(p.variants);
                  const isExpanded = expandedIds.has(p._id);
                  const categoryName =
                    typeof p.categoryId === "object" && p.categoryId
                      ? p.categoryId.name
                      : typeof p.categoryId === "string"
                      ? p.categoryId
                      : "—";

                  return (
                    <React.Fragment key={p._id}>
                      {/* Main Product Row */}
                      <tr className="border-b border-outline-variant/10 hover:bg-surface-container-low/30 transition-colors group">
                        {/* Product Thumbnail & Name */}
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-3">
                            {p.images?.[0] ? (
                              <Link
                                href={`/shop/${p.slug}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="w-10 h-10 bg-surface-container-high rounded overflow-hidden flex-shrink-0 border border-outline-variant/30 block hover:border-primary hover:opacity-90 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                title={`View "${p.name}" on live storefront (opens in new tab)`}
                                aria-label={`View ${p.name} on storefront`}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={p.images[0]}
                                  alt={p.name}
                                  className="w-full h-full object-cover hover:scale-105 transition-transform duration-200"
                                />
                              </Link>
                            ) : (
                              <Link
                                href={`/shop/${p.slug}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="w-10 h-10 bg-surface-container-high rounded flex items-center justify-center flex-shrink-0 text-outline border border-outline-variant/30 hover:border-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                title={`View "${p.name}" on live storefront`}
                                aria-label={`View ${p.name} on storefront`}
                              >
                                <span className="material-symbols-outlined text-[20px]">image</span>
                              </Link>
                            )}
                            <div className="min-w-0">
                              <Link
                                href={`/shop/${p.slug}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-medium text-on-surface hover:text-primary transition-colors inline-flex items-center gap-1 group/title focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded-xs"
                                title={`View "${p.name}" on live storefront (opens in new tab)`}
                              >
                                <span className="truncate group-hover/title:underline">{p.name}</span>
                                <span className="material-symbols-outlined text-[13px] text-outline opacity-0 group-hover/title:opacity-100 transition-opacity shrink-0">
                                  open_in_new
                                </span>
                              </Link>
                              <div>
                                <Link
                                  href={`/shop/${p.slug}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs text-on-surface-variant font-mono hover:text-primary transition-colors inline-flex items-center gap-0.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded-xs"
                                  title={`Live slug URL: /shop/${p.slug}`}
                                >
                                  <span>/{p.slug}</span>
                                  <span className="material-symbols-outlined text-[11px] opacity-60">open_in_new</span>
                                </Link>
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Category */}
                        <td className="py-3 px-4 text-on-surface-variant">
                          <span className="px-2 py-0.5 bg-surface-container-high text-on-surface-variant rounded text-xs font-label-caps">
                            {categoryName}
                          </span>
                        </td>

                        {/* Variants & Colours Preview */}
                        <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                          {summary.colors.length === 0 ? (
                            <span className="text-outline text-xs font-label-caps">
                              No variants
                            </span>
                          ) : (
                            <div className="flex flex-col gap-1.5">
                              {/* Color Swatch Badges */}
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {summary.colors.map((c) => (
                                  <span
                                    key={c.color}
                                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-surface-container-high border border-outline-variant/30 text-xs font-medium text-on-surface shadow-2xs"
                                    title={`${c.color} (${c.sizes.join(", ")})`}
                                  >
                                    <span
                                      className="w-2.5 h-2.5 rounded-full border border-black/20 shrink-0"
                                      style={{ backgroundColor: c.hexCode || "#94A3B8" }}
                                    />
                                    <span>{c.color}</span>
                                  </span>
                                ))}
                              </div>

                              {/* SKUs & Sizes Summary */}
                              <div className="text-[11px] text-on-surface-variant font-label-caps">
                                <span className="font-bold text-on-surface">
                                  {summary.totalVariants} {summary.totalVariants === 1 ? "SKU" : "SKUs"}
                                </span>
                                <span> · Sizes: </span>
                                <span className="font-medium">
                                  {summary.allSizes.join(", ") || "Standard"}
                                </span>
                              </div>
                            </div>
                          )}
                        </td>

                        {/* Total Stock */}
                        <td className="py-3 px-4 text-center">
                          <div className="flex flex-col items-center">
                            <span className="font-bold text-xs text-on-surface">
                              {summary.totalStock.toLocaleString("en-IN")} units
                            </span>
                            {summary.hasOutOfStock ? (
                              <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-error font-label-caps">
                                <span className="material-symbols-outlined text-[12px]">cancel</span>
                                OOS in size
                              </span>
                            ) : summary.hasLowStock ? (
                              <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-secondary font-label-caps">
                                <span className="material-symbols-outlined text-[12px]">warning</span>
                                Low Stock
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-primary font-label-caps">
                                <span className="material-symbols-outlined text-[12px]">check</span>
                                In Stock
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Price */}
                        <td className="py-3 px-4 text-right font-label-caps text-label-caps font-bold">
                          ₹{p.basePrice?.toLocaleString("en-IN")}
                        </td>

                        {/* Status */}
                        <td className="py-3 px-4 text-center">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-label-caps ${getStatusColor(
                              p.status
                            )}`}
                          >
                            {p.status}
                          </span>
                        </td>

                        {/* Actions */}
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {/* Expand Variants Toggle */}
                            <button
                              type="button"
                              onClick={() => toggleExpand(p._id)}
                              className={`p-1.5 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                                isExpanded
                                  ? "text-primary bg-primary-container/10"
                                  : "text-outline hover:text-on-surface hover:bg-surface-container-high"
                              }`}
                              title={isExpanded ? "Collapse variant breakdown" : "View variant breakdown"}
                              aria-label={isExpanded ? `Collapse variants for ${p.name}` : `Expand variants for ${p.name}`}
                              aria-expanded={isExpanded}
                            >
                              <span
                                className={`material-symbols-outlined text-[18px] transition-transform duration-200 ${
                                  isExpanded ? "rotate-180" : ""
                                }`}
                              >
                                expand_more
                              </span>
                            </button>

                            <Link
                              href={`/admin/products/${p._id}/edit`}
                              className="p-1.5 text-outline hover:text-primary hover:bg-primary-container/10 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                              title="Edit Product Details & Options"
                              aria-label={`Edit ${p.name}`}
                            >
                              <span className="material-symbols-outlined text-[18px]">edit</span>
                            </Link>

                            <Link
                              href={`/admin/products/${p._id}/inventory`}
                              className="p-1.5 text-outline hover:text-primary hover:bg-primary-container/10 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                              title="Manage Stock & Inventory"
                              aria-label={`Manage stock for ${p.name}`}
                            >
                              <span className="material-symbols-outlined text-[18px]">warehouse</span>
                            </Link>

                            <button
                              type="button"
                              onClick={() => handleDeleteProduct(p._id, p.name)}
                              disabled={deletingId === p._id}
                              className="p-1.5 text-outline hover:text-error hover:bg-error-container/10 rounded transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error"
                              title="Delete Product"
                              aria-label={`Delete ${p.name}`}
                            >
                              <span className="material-symbols-outlined text-[18px]">
                                {deletingId === p._id ? "hourglass_empty" : "delete"}
                              </span>
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Expandable Variant Breakdown Panel */}
                      {isExpanded && (
                        <tr className="bg-surface-container-low/30 border-b border-outline-variant/20 animate-fade-in">
                          <td colSpan={7} className="p-4 md:px-8">
                            <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-4 shadow-2xs flex flex-col gap-3">
                              {/* Header */}
                              <div className="flex items-center justify-between pb-2 border-b border-outline-variant/15">
                                <div className="flex items-center gap-2">
                                  <span className="material-symbols-outlined text-primary text-[18px]">
                                    palette
                                  </span>
                                  <span className="font-label-caps text-xs font-bold uppercase tracking-wider text-on-surface">
                                    Variant Breakdown: {p.name}
                                  </span>
                                </div>

                                <Link
                                  href="/admin/inventory"
                                  className="text-xs text-primary hover:underline font-label-caps flex items-center gap-1 font-semibold"
                                >
                                  <span>Manage in Physical Inventory</span>
                                  <span className="material-symbols-outlined text-[14px]">
                                    arrow_forward
                                  </span>
                                </Link>
                              </div>

                              {summary.colors.length === 0 ? (
                                <p className="text-xs text-on-surface-variant font-body-sm">
                                  No variants configured for this product.
                                </p>
                              ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                  {summary.colors.map((c) => (
                                    <div
                                      key={c.color}
                                      className="bg-surface-container-low/50 border border-outline-variant/30 rounded-lg p-3 flex flex-col gap-2"
                                    >
                                      {/* Colorway Header */}
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                          <span
                                            className="w-3.5 h-3.5 rounded-full border border-black/20 shrink-0"
                                            style={{ backgroundColor: c.hexCode || "#94A3B8" }}
                                          />
                                          <span className="font-bold text-xs text-on-surface">
                                            {c.color}
                                          </span>
                                        </div>
                                        <span className="text-[11px] font-label-caps text-on-surface-variant font-medium">
                                          {c.totalStock} units
                                        </span>
                                      </div>

                                      {/* Sizes List with SKUs */}
                                      <div className="flex flex-wrap gap-1.5 pt-1.5 border-t border-outline-variant/15">
                                        {(p.variants || [])
                                          .filter(
                                            (v: RawVariant) =>
                                              (v.color || "Standard").trim().toLowerCase() ===
                                              c.color.toLowerCase()
                                          )
                                          .map((v: RawVariant) => (
                                            <span
                                              key={v.sku}
                                              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-label-caps border ${
                                                v.stock === 0
                                                  ? "bg-error-container/20 text-error border-error/30"
                                                  : v.stock <= (v.reorderThreshold ?? 5)
                                                  ? "bg-secondary-container/20 text-secondary border-secondary/30"
                                                  : "bg-surface-container-lowest text-on-surface border-outline-variant/30"
                                              }`}
                                              title={`SKU: ${v.sku} · Available: ${v.stock} units`}
                                            >
                                              <span className="font-bold">Size {v.size}</span>
                                              <span className="opacity-40">·</span>
                                              <span className="font-semibold">{v.stock} units</span>
                                              <span className="text-[9px] text-outline ml-0.5 truncate max-w-[100px]">
                                                ({v.sku})
                                              </span>
                                            </span>
                                          ))}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="h-8" />
    </div>
  );
}
