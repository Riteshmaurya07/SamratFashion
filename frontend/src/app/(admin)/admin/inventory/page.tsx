"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

interface InventoryItem {
  productId: string;
  productName: string;
  productSlug: string;
  image?: string;
  variantId: string;
  sku: string;
  size?: string;
  color?: string;
  stock: number;
  reorderThreshold: number;
  warehouseLocation?: string;
}

export default function AdminInventoryPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [stockFilter, setStockFilter] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);

  // Quick adjust modal state
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [adjustQty, setAdjustQty] = useState<number>(0);
  const [adjustType, setAdjustType] = useState("RESTOCK");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjusting, setAdjusting] = useState(false);
  const [modalError, setModalError] = useState("");

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/admin/products?limit=100");
      setProducts(res.data.data.items || []);
      setError("");
    } catch (err: any) {
      setError("Failed to fetch products for inventory management");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  // Flatten products into variant-level inventory items
  const inventoryItems: InventoryItem[] = [];
  products.forEach((p) => {
    (p.variants || []).forEach((v: any) => {
      inventoryItems.push({
        productId: p._id,
        productName: p.name,
        productSlug: p.slug,
        image: p.images?.[0],
        variantId: v._id,
        sku: v.sku,
        size: v.size,
        color: v.color,
        stock: v.stock || 0,
        reorderThreshold: v.reorderThreshold ?? 5,
        warehouseLocation: v.warehouseLocation || "Main Warehouse",
      });
    });
  });

  // KPI Calculations
  const totalVariants = inventoryItems.length;
  const totalUnits = inventoryItems.reduce((sum, item) => sum + item.stock, 0);
  const outOfStockItems = inventoryItems.filter((i) => i.stock === 0);
  const lowStockItems = inventoryItems.filter((i) => i.stock > 0 && i.stock <= i.reorderThreshold);

  // Filtering
  const filteredItems = inventoryItems.filter((item) => {
    const matchesSearch =
      !search ||
      item.productName.toLowerCase().includes(search.toLowerCase()) ||
      item.sku.toLowerCase().includes(search.toLowerCase()) ||
      item.productSlug.toLowerCase().includes(search.toLowerCase());

    let matchesStock = true;
    if (stockFilter === "OUT_OF_STOCK") matchesStock = item.stock === 0;
    else if (stockFilter === "LOW_STOCK") matchesStock = item.stock > 0 && item.stock < 10;
    else if (stockFilter === "HEALTHY") matchesStock = item.stock >= 10;

    return matchesSearch && matchesStock;
  });

  const handleAdjustSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItem) return;
    if (!adjustReason || adjustReason.trim().length < 2) {
      setModalError("Reason is required (at least 2 characters)");
      return;
    }
    if (adjustQty === 0) {
      setModalError("Quantity adjustment cannot be 0");
      return;
    }

    setAdjusting(true);
    setModalError("");
    try {
      await api.patch(
        `/admin/products/${selectedItem.productId}/variants/${selectedItem.variantId}/inventory`,
        {
          quantity: Number(adjustQty),
          type: adjustType,
          reason: adjustReason,
        }
      );
      setSelectedItem(null);
      setAdjustQty(0);
      setAdjustReason("");
      await fetchProducts();
    } catch (err: any) {
      setModalError(err.response?.data?.message || "Failed to adjust inventory");
    } finally {
      setAdjusting(false);
    }
  };

  return (
    <div className="flex flex-col gap-element-gap md:gap-gutter">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-2">
        <div>
          <h1 className="font-headline-lg text-headline-lg text-on-background mb-1">
            Physical Inventory
          </h1>
          <p className="font-body-md text-body-md text-on-surface-variant max-w-2xl">
            Real-time stock auditing, low-stock alerts, and manual inventory adjustments across all SKUs.
          </p>
        </div>
        <button
          onClick={fetchProducts}
          className="flex items-center gap-2 px-4 py-2 border border-outline-variant text-on-surface font-label-caps text-label-caps rounded-lg hover:bg-surface-container-high transition-colors self-start md:self-auto"
        >
          <span className="material-symbols-outlined text-[18px]">refresh</span>
          Refresh Stock
        </button>
      </div>

      {error && (
        <div className="text-error bg-error-container/20 p-4 rounded-md font-body-sm flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">error_outline</span>
          {error}
        </div>
      )}

      {/* KPI Cards Row */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-surface border border-outline-variant/30 rounded-lg p-4 flex flex-col justify-between h-24 hover:scale-[1.02] transition-transform">
          <span className="font-label-caps text-label-caps text-on-surface-variant">Total SKUs</span>
          <span className="font-headline-lg text-headline-lg text-on-surface">
            {loading ? "—" : totalVariants}
          </span>
        </div>

        <div className="bg-surface border border-outline-variant/30 rounded-lg p-4 flex flex-col justify-between h-24 border-l-4 border-l-primary hover:scale-[1.02] transition-transform">
          <span className="font-label-caps text-label-caps text-on-surface-variant">Total Units</span>
          <span className="font-headline-lg text-headline-lg text-primary">
            {loading ? "—" : totalUnits.toLocaleString("en-IN")}
          </span>
        </div>

        <div
          className={`bg-surface border border-outline-variant/30 rounded-lg p-4 flex flex-col justify-between h-24 hover:scale-[1.02] transition-transform ${
            lowStockItems.length > 0 ? "border-l-4 border-l-secondary" : ""
          }`}
        >
          <span className="font-label-caps text-label-caps text-on-surface-variant">Low Stock (&lt;10)</span>
          <span className={`font-headline-lg text-headline-lg ${lowStockItems.length > 0 ? "text-secondary" : "text-on-surface"}`}>
            {loading ? "—" : lowStockItems.length}
          </span>
        </div>

        <div
          className={`bg-surface border border-outline-variant/30 rounded-lg p-4 flex flex-col justify-between h-24 hover:scale-[1.02] transition-transform ${
            outOfStockItems.length > 0 ? "border-l-4 border-l-error" : ""
          }`}
        >
          <span className="font-label-caps text-label-caps text-on-surface-variant">Out of Stock (0)</span>
          <span className={`font-headline-lg text-headline-lg ${outOfStockItems.length > 0 ? "text-error" : "text-on-surface"}`}>
            {loading ? "—" : outOfStockItems.length}
          </span>
        </div>
      </section>

      {/* Filter Toolbar */}
      <div className="flex flex-col md:flex-row gap-3 items-start md:items-center justify-between bg-surface-container-lowest p-4 rounded-t-xl border border-outline-variant/20 border-b-0">
        <div className="w-full md:w-auto flex-1 max-w-md relative">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-[18px]">
            search
          </span>
          <input
            type="text"
            placeholder="Search by product name, SKU, or slug..."
            className="w-full pl-10 pr-4 py-2.5 bg-surface-container-low border border-outline-variant/30 rounded-lg focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary font-body-sm text-body-sm text-on-surface transition-all placeholder:text-outline"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="w-full md:w-auto flex flex-wrap gap-2 items-center">
          {/* Stock Filter Dropdown */}
          <div className="relative">
            <button
              onClick={() => setFilterOpen(!filterOpen)}
              className="flex items-center gap-2 px-3 py-2 bg-surface-container-low border border-outline-variant/30 rounded-lg font-label-caps text-label-caps text-on-surface-variant hover:bg-surface-container-highest transition-colors whitespace-nowrap"
            >
              Stock Status:{" "}
              {stockFilter === "OUT_OF_STOCK"
                ? "Out of Stock"
                : stockFilter === "LOW_STOCK"
                ? "Low Stock"
                : stockFilter === "HEALTHY"
                ? "In Stock"
                : "All"}
              <span className="material-symbols-outlined text-[18px]">keyboard_arrow_down</span>
            </button>
            {filterOpen && (
              <div className="absolute top-full left-0 mt-1 bg-surface-container-lowest border border-outline-variant/30 rounded-lg shadow-[0_12px_40px_rgba(15,23,42,0.08)] z-20 py-1 min-w-[160px]">
                {[
                  { key: "", label: "All" },
                  { key: "OUT_OF_STOCK", label: "Out of Stock (0)" },
                  { key: "LOW_STOCK", label: "Low Stock (<10)" },
                  { key: "HEALTHY", label: "In Stock (10+)" },
                ].map((f) => (
                  <button
                    key={f.key}
                    className={`w-full text-left px-4 py-2 font-label-caps text-label-caps hover:bg-surface-container-high transition-colors ${
                      stockFilter === f.key ? "text-primary bg-primary-container/10" : "text-on-surface"
                    }`}
                    onClick={() => {
                      setStockFilter(f.key);
                      setFilterOpen(false);
                    }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {(search || stockFilter) && (
            <button
              onClick={() => {
                setSearch("");
                setStockFilter("");
              }}
              className="p-2 border border-outline-variant/30 rounded-lg text-on-surface-variant hover:bg-surface-container-high transition-colors"
              title="Clear filters"
            >
              <span className="material-symbols-outlined text-[18px]">filter_list_off</span>
            </button>
          )}
        </div>
      </div>

      {/* Inventory Data Table */}
      <div className="bg-surface-container-lowest border border-outline-variant/20 rounded-b-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container-lowest border-b border-outline-variant/20">
                <th className="py-3 px-4 font-label-caps text-label-caps text-outline font-medium tracking-wider whitespace-nowrap">
                  Product
                </th>
                <th className="py-3 px-4 font-label-caps text-label-caps text-outline font-medium tracking-wider whitespace-nowrap">
                  SKU
                </th>
                <th className="py-3 px-4 font-label-caps text-label-caps text-outline font-medium tracking-wider whitespace-nowrap">
                  Variant Details
                </th>
                <th className="py-3 px-4 font-label-caps text-label-caps text-outline font-medium tracking-wider whitespace-nowrap text-center">
                  Stock Level
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
                      {[1, 2, 3, 4, 5].map((j) => (
                        <td key={j} className="py-3 px-4">
                          <div className="h-4 bg-surface-container-low rounded animate-pulse" />
                        </td>
                      ))}
                    </tr>
                  ))}
                </>
              ) : filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-16 px-4">
                    <div className="flex flex-col items-center gap-3 text-center">
                      <span className="material-symbols-outlined text-outline text-[48px]">
                        warehouse
                      </span>
                      <p className="font-body-md text-body-md text-on-surface-variant">
                        {search || stockFilter ? "No inventory items match your filters" : "No variants found"}
                      </p>
                      {(search || stockFilter) && (
                        <button
                          onClick={() => {
                            setSearch("");
                            setStockFilter("");
                          }}
                          className="font-label-caps text-label-caps text-primary hover:underline"
                        >
                          Clear filters
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => (
                  <tr
                    key={`${item.productId}-${item.variantId}`}
                    className="border-b border-outline-variant/10 hover:bg-surface-container-lowest/50 transition-colors group"
                  >
                    {/* Product info */}
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        {item.image ? (
                          <div className="w-10 h-10 bg-surface-container-high rounded overflow-hidden flex-shrink-0">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={item.image} alt={item.productName} className="w-full h-full object-cover" />
                          </div>
                        ) : (
                          <div className="w-10 h-10 bg-surface-container-high rounded flex items-center justify-center flex-shrink-0 text-outline">
                            <span className="material-symbols-outlined text-[20px]">image</span>
                          </div>
                        )}
                        <div>
                          <div className="font-medium">{item.productName}</div>
                          <div className="text-xs text-on-surface-variant font-label-caps">/{item.productSlug}</div>
                        </div>
                      </div>
                    </td>

                    {/* SKU */}
                    <td className="py-3 px-4 font-label-caps text-[11px] font-bold text-on-surface">
                      {item.sku}
                    </td>

                    {/* Variant Details */}
                    <td className="py-3 px-4 text-on-surface-variant">
                      {item.size && `Size: ${item.size}`}
                      {item.size && item.color && " · "}
                      {item.color && `Color: ${item.color}`}
                      {!item.size && !item.color && "—"}
                    </td>

                    {/* Stock Level */}
                    <td className="py-3 px-4 text-center">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-label-caps font-bold ${
                          item.stock === 0
                            ? "bg-error-container/20 text-error border border-error/20"
                            : item.stock < 10
                            ? "bg-secondary-container/20 text-secondary border border-secondary/20"
                            : "bg-primary-container/20 text-primary border border-primary/20"
                        }`}
                      >
                        <span className="material-symbols-outlined text-[14px]">
                          {item.stock === 0 ? "error_outline" : item.stock < 10 ? "warning" : "check_circle"}
                        </span>
                        {item.stock} units
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => {
                            setSelectedItem(item);
                            setAdjustQty(0);
                            setAdjustType("RESTOCK");
                            setAdjustReason("");
                            setModalError("");
                          }}
                          className="px-3 py-1.5 bg-primary-container/10 text-primary hover:bg-primary-container/20 rounded-lg font-label-caps text-[11px] transition-colors flex items-center gap-1"
                        >
                          <span className="material-symbols-outlined text-[16px]">tune</span>
                          Adjust
                        </button>

                        <Link
                          href={`/admin/products/${item.productId}/inventory`}
                          className="p-1.5 text-outline hover:text-primary hover:bg-primary-container/10 rounded transition-colors"
                          title="View History"
                        >
                          <span className="material-symbols-outlined text-[18px]">history</span>
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Adjust Stock Modal Overlay */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-fade-in">
          <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl shadow-[0_12px_40px_rgba(15,23,42,0.16)] w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4 border-b border-outline-variant/20 pb-3">
              <div>
                <h2 className="font-headline-sm text-headline-sm text-on-surface">Adjust Inventory</h2>
                <p className="font-body-sm text-body-sm text-on-surface-variant">
                  {selectedItem.productName} ({selectedItem.sku})
                </p>
              </div>
              <button
                onClick={() => setSelectedItem(null)}
                className="p-1 text-on-surface-variant hover:text-on-surface rounded-lg hover:bg-surface-container-high transition-colors"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {modalError && (
              <div className="mb-4 p-3 text-sm bg-error-container/20 text-error border border-error/20 rounded-lg flex items-center gap-2">
                <span className="material-symbols-outlined text-[16px]">error_outline</span>
                {modalError}
              </div>
            )}

            <form onSubmit={handleAdjustSubmit} className="flex flex-col gap-4">
              {/* Current Stock Banner */}
              <div className="bg-surface-container-low p-3 rounded-lg border border-outline-variant/20 flex justify-between items-center">
                <span className="font-label-caps text-label-caps text-on-surface-variant">Current Stock</span>
                <span className="font-headline-sm text-headline-sm text-primary">{selectedItem.stock} units</span>
              </div>

              {/* Type */}
              <div className="flex flex-col gap-1.5">
                <label className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider">
                  Adjustment Type
                </label>
                <select
                  className="w-full px-4 py-2.5 bg-surface-container-low border border-outline-variant/30 rounded-lg focus:outline-none focus:border-primary font-body-sm text-body-sm text-on-surface transition-all"
                  value={adjustType}
                  onChange={(e) => setAdjustType(e.target.value)}
                >
                  <option value="RESTOCK">Restock (+)</option>
                  <option value="ADJUSTMENT">Physical Audit Adjustment (±)</option>
                </select>
              </div>

              {/* Quantity */}
              <div className="flex flex-col gap-1.5">
                <label className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider">
                  Quantity (+ / -)
                </label>
                <input
                  required
                  type="number"
                  placeholder="e.g. 25 or -5"
                  className="w-full px-4 py-2.5 bg-surface-container-low border border-outline-variant/30 rounded-lg focus:outline-none focus:border-primary font-body-sm text-body-sm text-on-surface transition-all"
                  value={adjustQty}
                  onChange={(e) => setAdjustQty(Number(e.target.value))}
                />
                <p className="font-body-sm text-[11px] text-outline">
                  New stock will be: <span className="font-bold text-on-surface">{selectedItem.stock + adjustQty}</span>
                </p>
              </div>

              {/* Reason */}
              <div className="flex flex-col gap-1.5">
                <label className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider">
                  Reason / Reference
                </label>
                <input
                  required
                  type="text"
                  placeholder="e.g. Physical inventory count, Restock PO #104"
                  className="w-full px-4 py-2.5 bg-surface-container-low border border-outline-variant/30 rounded-lg focus:outline-none focus:border-primary font-body-sm text-body-sm text-on-surface transition-all placeholder:text-outline"
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                />
              </div>

              {/* Submit Buttons */}
              <div className="flex items-center justify-end gap-3 mt-2">
                <button
                  type="button"
                  onClick={() => setSelectedItem(null)}
                  className="px-4 py-2.5 border border-outline-variant/30 text-on-surface rounded-lg font-label-caps text-label-caps hover:bg-surface-container-high transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={adjusting}
                  className="px-5 py-2.5 bg-primary text-on-primary rounded-lg font-label-caps text-label-caps hover:opacity-90 transition-opacity disabled:opacity-60 flex items-center gap-2"
                >
                  {adjusting ? (
                    <>
                      <span className="material-symbols-outlined text-[18px] animate-spin">
                        progress_activity
                      </span>
                      Updating...
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-[18px]">save</span>
                      Confirm Adjustment
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="h-8" />
    </div>
  );
}
