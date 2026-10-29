"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import axios from "axios";
import { api } from "@/lib/api";
import { useRouter } from "next/navigation";
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

export default function AdminProductsPage() {
  const router = useRouter();
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
      if (statusFilter) params.status = statusFilter;
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
    if (!colorFilter) return products;
    const target = colorFilter.toLowerCase();
    return products.filter((p) =>
      (p.variants || []).some(
        (v) => (v.color || "").trim().toLowerCase() === target
      )
    );
  }, [products, colorFilter]);

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
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-2">
        <div>
          <h1 className="font-headline-lg text-headline-lg text-on-background mb-1">Products</h1>
          <p className="font-body-md text-body-md text-on-surface-variant max-w-2xl">
            Manage your SamratFashion product catalog, variants, and colors.
          </p>
        </div>
        <Link
          href="/admin/products/new"
          className="flex items-center gap-2 px-5 py-3 bg-primary text-on-primary font-label-caps text-label-caps rounded-lg hover:opacity-90 transition-opacity self-start md:self-auto shadow-xs"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
          Add Product
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
      <section className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-surface border border-outline-variant/30 rounded-lg p-4 flex flex-col justify-between h-24 hover:scale-[1.02] transition-transform">
          <span className="font-label-caps text-label-caps text-on-surface-variant">Total Products</span>
          <span className="font-headline-lg text-headline-lg text-on-surface">
            {loading ? "—" : kpiCounts.total}
          </span>
        </div>
        <div className="bg-surface border border-outline-variant/30 rounded-lg p-4 flex flex-col justify-between h-24 hover:scale-[1.02] transition-transform">
          <span className="font-label-caps text-label-caps text-on-surface-variant">Active</span>
          <span className="font-headline-lg text-headline-lg text-primary">
            {loading ? "—" : kpiCounts.active}
          </span>
        </div>
        <div className="bg-surface border border-outline-variant/30 rounded-lg p-4 flex flex-col justify-between h-24 hover:scale-[1.02] transition-transform">
          <span className="font-label-caps text-label-caps text-on-surface-variant">Draft</span>
          <span className="font-headline-lg text-headline-lg text-on-surface">
            {loading ? "—" : kpiCounts.draft}
          </span>
        </div>
        <div className="bg-surface border border-outline-variant/30 rounded-lg p-4 flex flex-col justify-between h-24 hover:scale-[1.02] transition-transform">
          <span className="font-label-caps text-label-caps text-on-surface-variant">Out of Stock</span>
          <span className="font-headline-lg text-headline-lg text-error">
            {loading ? "—" : kpiCounts.outOfStock}
          </span>
        </div>
        <div className="bg-surface border border-outline-variant/30 rounded-lg p-4 flex flex-col justify-between h-24 hover:scale-[1.02] transition-transform">
          <span className="font-label-caps text-label-caps text-on-surface-variant">Archived</span>
          <span className="font-headline-lg text-headline-lg text-on-surface">
            {loading ? "—" : kpiCounts.archived}
          </span>
        </div>
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

      {/* Data Table with Colours & Variants */}
      <div className="bg-surface-container-lowest border border-outline-variant/20 rounded-b-xl overflow-hidden shadow-xs">
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
                      <tr
                        className="border-b border-outline-variant/10 hover:bg-surface-container-low/40 transition-colors group cursor-pointer"
                        onClick={() => router.push(`/admin/products/${p._id}/edit`)}
                      >
                        {/* Product Thumbnail & Name */}
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-3">
                            {p.images?.[0] ? (
                              <div className="w-10 h-10 bg-surface-container-high rounded overflow-hidden flex-shrink-0 border border-outline-variant/30">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={p.images[0]}
                                  alt={p.name}
                                  className="w-full h-full object-cover"
                                />
                              </div>
                            ) : (
                              <div className="w-10 h-10 bg-surface-container-high rounded flex items-center justify-center flex-shrink-0 text-outline border border-outline-variant/30">
                                <span className="material-symbols-outlined text-[20px]">image</span>
                              </div>
                            )}
                            <div>
                              <div className="font-medium text-on-surface">{p.name}</div>
                              <div className="text-xs text-on-surface-variant font-label-caps">
                                /{p.slug}
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
                        <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            {/* Expand Variants Toggle */}
                            <button
                              type="button"
                              onClick={() => toggleExpand(p._id)}
                              className={`p-1.5 rounded transition-colors ${
                                isExpanded
                                  ? "text-primary bg-primary-container/10"
                                  : "text-outline hover:text-on-surface hover:bg-surface-container-high"
                              }`}
                              title={isExpanded ? "Hide variant breakdown" : "View variant breakdown"}
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
                              className="p-1.5 text-outline hover:text-primary hover:bg-primary-container/10 rounded transition-colors"
                              title="Edit Product"
                            >
                              <span className="material-symbols-outlined text-[18px]">edit</span>
                            </Link>

                            <Link
                              href={`/admin/products/${p._id}/inventory`}
                              className="p-1.5 text-outline hover:text-primary hover:bg-primary-container/10 rounded transition-colors"
                              title="Inventory Ledger"
                            >
                              <span className="material-symbols-outlined text-[18px]">warehouse</span>
                            </Link>

                            <button
                              type="button"
                              onClick={() => handleDeleteProduct(p._id, p.name)}
                              disabled={deletingId === p._id}
                              className="p-1.5 text-outline hover:text-error hover:bg-error-container/10 rounded transition-colors disabled:opacity-50"
                              title="Delete Product"
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
