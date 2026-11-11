"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { resolveColorHex } from "@/lib/inventoryUtils";

interface Variant {
  _id: string;
  sku: string;
  size: string;
  color: string;
  stock: number;
  additionalPrice?: number;
  hexCode?: string;
}

interface ProductDetail {
  _id: string;
  name: string;
  slug: string;
  basePrice?: number;
  status: string;
  images?: string[];
  variants: Variant[];
}

interface InventoryTransactionItem {
  _id: string;
  variantId: string;
  productId: string;
  orderId?: string;
  quantity: number;
  type: "SALE" | "RESTOCK" | "ADJUSTMENT" | "REFUND" | "RETURN";
  reason?: string;
  createdAt: string;
  variantSnapshot?: { size?: string; color?: string; name?: string };
}
function extractApiMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "response" in error) {
    const res = (error as { response?: unknown }).response;
    if (res && typeof res === "object" && "data" in res) {
      const data = (res as { data?: unknown }).data;
      if (data && typeof data === "object" && "message" in data) {
        const msg = (data as { message?: unknown }).message;
        if (typeof msg === "string" && msg.trim()) return msg;
      }
    }
  }
  return fallback;
}


export default function ProductInventoryPage() {
  const params = useParams();
  const productId = params.id as string;

  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [history, setHistory] = useState<InventoryTransactionItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Adjustment Form State
  const [adjustVariant, setAdjustVariant] = useState("");
  const [adjustQuantity, setAdjustQuantity] = useState<number | "">(10);
  const [adjustType, setAdjustType] = useState<"RESTOCK" | "ADJUSTMENT">("RESTOCK");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjusting, setAdjusting] = useState(false);
  const [error, setError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");

  const fetchData = useCallback(async () => {
    try {
      const [pRes, hRes] = await Promise.all([
        api.get(`/admin/products/${productId}`),
        api.get(`/admin/products/${productId}/inventory`),
      ]);
      setProduct(pRes.data.data);
      setHistory(hRes.data.data.transactions || []);
      setLoading(false);
    } catch {
      setError("Failed to load inventory data");
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const selectedVariantObj = useMemo(() => {
    if (!product || !adjustVariant) return null;
    return product.variants?.find((v) => String(v._id) === String(adjustVariant)) || null;
  }, [product, adjustVariant]);

  const projectedStock = useMemo(() => {
    if (!selectedVariantObj) return null;
    const current = selectedVariantObj.stock || 0;
    const qty = typeof adjustQuantity === "number" ? adjustQuantity : 0;
    if (adjustType === "RESTOCK") {
      return current + Math.abs(qty);
    }
    // ADJUSTMENT can be positive or negative
    return current + qty;
  }, [selectedVariantObj, adjustQuantity, adjustType]);

  const handleAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustVariant) {
      alert("Please select a variant");
      return;
    }
    const qty = typeof adjustQuantity === "number" ? adjustQuantity : 0;
    if (qty === 0) {
      alert("Adjustment quantity cannot be 0");
      return;
    }
    const reasonTrimmed = adjustReason.trim();
    if (!reasonTrimmed || reasonTrimmed.length < 2) {
      alert("Please provide a valid adjustment reason");
      return;
    }

    setAdjusting(true);
    setError("");
    setActionSuccess("");

    try {
      await api.patch(`/admin/products/${productId}/variants/${adjustVariant}/inventory`, {
        quantity: qty,
        type: adjustType,
        reason: reasonTrimmed,
      });

      const matchedVariant = product?.variants?.find((v) => String(v._id) === String(adjustVariant));
      setActionSuccess(`Successfully adjusted inventory for SKU ${matchedVariant?.sku || ""}`);
      setAdjustReason("");
      await fetchData();
      setTimeout(() => setActionSuccess(""), 5000);
    } catch (err: unknown) {
      alert(extractApiMessage(err, "Failed to adjust inventory"));
    } finally {
      setAdjusting(false);
    }
  };

  const getTypeBadge = (type: string) => {
    switch (type) {
      case "RESTOCK":
        return "bg-emerald-50 text-emerald-700 border border-emerald-200";
      case "SALE":
        return "bg-blue-50 text-blue-700 border border-blue-200";
      case "RETURN":
      case "REFUND":
        return "bg-purple-50 text-purple-700 border border-purple-200";
      case "ADJUSTMENT":
        return "bg-amber-50 text-amber-700 border border-amber-200";
      default:
        return "bg-neutral-100 text-neutral-700 border border-neutral-200";
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-6 animate-pulse">
        <div className="h-10 bg-surface-container-low rounded-xl w-1/3" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-surface-container-low rounded-xl" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="h-80 bg-surface-container-low rounded-xl" />
          <div className="h-80 bg-surface-container-low col-span-2 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="p-8 text-error bg-error-container/20 rounded-xl font-body-sm flex items-center justify-between">
        <span>{error || "Product not found"}</span>
        <Link href="/admin/products" className="text-primary font-bold underline text-xs">
          Return to Products
        </Link>
      </div>
    );
  }

  const totalStock = product.variants?.reduce((sum, v) => sum + (v.stock || 0), 0) || 0;
  const lowStockCount = product.variants?.filter((v) => v.stock > 0 && v.stock < 10).length || 0;
  const outOfStockCount = product.variants?.filter((v) => (v.stock || 0) === 0).length || 0;

  return (
    <div className="flex flex-col gap-5">
      {/* Back navigation & Page Header */}
      <div>
        <Link
          href="/admin/products"
          className="inline-flex items-center gap-1.5 text-on-surface-variant hover:text-primary transition-colors font-mono text-xs font-bold mb-3"
        >
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          <span>Back to Products</span>
        </Link>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="font-headline-lg text-xl sm:text-2xl font-bold text-on-background">
              Inventory: {product.name}
            </h1>
            <p className="font-body-md text-xs sm:text-sm text-on-surface-variant mt-0.5 flex items-center gap-1.5 flex-wrap">
              <span>SKU Stock and live ledger for</span>
              <Link
                href={`/shop/${product.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline font-mono inline-flex items-center gap-0.5"
                title="View live product page"
              >
                <span>/{product.slug}</span>
                <span className="material-symbols-outlined text-[13px]">open_in_new</span>
              </Link>
            </p>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
            <Link
              href={`/admin/products/${product._id}/edit`}
              className="flex items-center gap-1.5 px-3 py-2 bg-surface-container border border-outline-variant/50 text-on-surface text-xs font-bold rounded-lg hover:bg-surface-container-high transition-colors shadow-2xs font-mono"
            >
              <span className="material-symbols-outlined text-[16px]">edit</span>
              <span>Edit Product</span>
            </Link>
            <Link
              href={`/shop/${product.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-2 bg-neutral-900 text-white text-xs font-bold rounded-lg hover:bg-neutral-800 transition-colors shadow-2xs font-mono"
            >
              <span>Storefront</span>
              <span className="material-symbols-outlined text-[14px]">open_in_new</span>
            </Link>
          </div>
        </div>
      </div>

      {actionSuccess && (
        <div className="p-3.5 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xl text-xs font-bold flex items-center justify-between gap-2 shadow-xs animate-fadeIn">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-emerald-600">check_circle</span>
            <span>{actionSuccess}</span>
          </div>
          <button type="button" onClick={() => setActionSuccess("")} className="hover:opacity-75">
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      )}

      {/* Stock KPI Row */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-3.5 flex flex-col justify-between shadow-xs">
          <span className="font-mono text-[10px] uppercase font-bold text-on-surface-variant tracking-wider">Total Stock</span>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="text-2xl font-bold font-mono text-primary">{totalStock.toLocaleString("en-IN")}</span>
            <span className="text-[11px] font-mono text-outline">units</span>
          </div>
        </div>

        <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-3.5 flex flex-col justify-between shadow-xs">
          <span className="font-mono text-[10px] uppercase font-bold text-on-surface-variant tracking-wider">Active SKUs</span>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="text-2xl font-bold font-mono text-on-surface">{product.variants?.length || 0}</span>
            <span className="text-[11px] font-mono text-outline">variants</span>
          </div>
        </div>

        <div className={`bg-surface-container-lowest border rounded-xl p-3.5 flex flex-col justify-between shadow-xs transition-colors ${
          lowStockCount > 0 ? "border-amber-300 bg-amber-500/[0.03]" : "border-outline-variant/30"
        }`}>
          <span className={`font-mono text-[10px] uppercase font-bold tracking-wider ${
            lowStockCount > 0 ? "text-amber-700" : "text-on-surface-variant"
          }`}>
            Low Stock (&lt; 10)
          </span>
          <div className="mt-1 flex items-baseline gap-1">
            <span className={`text-2xl font-bold font-mono ${lowStockCount > 0 ? "text-amber-800" : "text-on-surface"}`}>
              {lowStockCount}
            </span>
            <span className="text-[11px] font-mono text-outline">SKUs</span>
          </div>
        </div>

        <div className={`bg-surface-container-lowest border rounded-xl p-3.5 flex flex-col justify-between shadow-xs transition-colors ${
          outOfStockCount > 0 ? "border-rose-300 bg-rose-500/[0.03]" : "border-outline-variant/30"
        }`}>
          <span className={`font-mono text-[10px] uppercase font-bold tracking-wider ${
            outOfStockCount > 0 ? "text-rose-700" : "text-on-surface-variant"
          }`}>
            Out of Stock
          </span>
          <div className="mt-1 flex items-baseline gap-1">
            <span className={`text-2xl font-bold font-mono ${outOfStockCount > 0 ? "text-rose-700" : "text-on-surface"}`}>
              {outOfStockCount}
            </span>
            <span className="text-[11px] font-mono text-outline">SKUs</span>
          </div>
        </div>
      </section>

      {/* Main Grid: Left Controls (Stock List & Adjustment Form) + Right Ledger */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column (5 of 12 cols on desktop) */}
        <div className="lg:col-span-5 flex flex-col gap-5">
          {/* Current Stock Card */}
          <div className="border border-outline-variant/20 rounded-xl bg-surface-container-lowest overflow-hidden shadow-xs">
            <div className="p-3.5 border-b border-outline-variant/15 flex items-center justify-between bg-surface-container-low/40">
              <h2 className="text-xs font-bold font-mono uppercase tracking-wider text-on-surface flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[17px] text-primary">inventory_2</span>
                <span>Current Stock by SKU</span>
              </h2>
              <span className="text-[11px] font-mono text-outline font-bold">
                {product.variants?.length || 0} Variants
              </span>
            </div>
            <div className="p-3 flex flex-col gap-2 max-h-[380px] overflow-y-auto pr-1">
              {product.variants?.map((v) => {
                const hex = resolveColorHex(v.color, v.hexCode, product.variants);
                const isSelectedForAdjust = adjustVariant === v._id;

                return (
                  <div
                    key={v._id}
                    className={`flex justify-between items-center p-2.5 rounded-lg border transition-all ${
                      isSelectedForAdjust
                        ? "border-primary bg-primary/[0.04] ring-1 ring-primary/30"
                        : "border-outline-variant/20 bg-surface-container-low/50 hover:bg-surface-container"
                    }`}
                  >
                    <div className="min-w-0 pr-2">
                      <div className="font-mono text-xs font-bold text-on-surface truncate">{v.sku}</div>
                      <div className="flex items-center gap-1.5 text-[11px] text-on-surface-variant font-mono mt-0.5">
                        <span
                          className="w-2.5 h-2.5 rounded-full border border-black/20 shrink-0"
                          style={{ backgroundColor: hex }}
                        />
                        <span>{v.color}</span>
                        <span className="text-outline font-bold">· Size {v.size}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="text-right">
                        <div
                          className={`font-mono text-sm font-bold ${
                            v.stock === 0 ? "text-error" : v.stock < 10 ? "text-amber-600" : "text-emerald-700"
                          }`}
                        >
                          {v.stock} <span className="text-[10px] font-normal text-outline">pcs</span>
                        </div>
                        <span
                          className={`inline-block px-1.5 py-0.2 rounded text-[9px] font-mono font-bold uppercase ${
                            v.stock === 0
                              ? "bg-rose-100 text-rose-800 border border-rose-200"
                              : v.stock < 10
                              ? "bg-amber-100 text-amber-800 border border-amber-200"
                              : "bg-emerald-100 text-emerald-800 border border-emerald-200"
                          }`}
                        >
                          {v.stock === 0 ? "OOS" : v.stock < 10 ? "Low" : "In Stock"}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setAdjustVariant(v._id)}
                        className={`p-1.5 rounded-md transition-colors ${
                          isSelectedForAdjust
                            ? "bg-primary text-on-primary"
                            : "text-outline hover:text-primary hover:bg-surface-container"
                        }`}
                        title={`Select ${v.sku} for adjustment`}
                        aria-label={`Select ${v.sku} for adjustment`}
                      >
                        <span className="material-symbols-outlined text-[17px]">tune</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Adjust Stock Form */}
          <div className="border border-outline-variant/20 rounded-xl bg-surface-container-lowest overflow-hidden shadow-xs">
            <div className="p-3.5 border-b border-outline-variant/15 flex items-center justify-between bg-surface-container-low/40">
              <h2 className="text-xs font-bold font-mono uppercase tracking-wider text-on-surface flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[17px] text-amber-600">tune</span>
                <span>Adjust Stock</span>
              </h2>
              {selectedVariantObj && (
                <span className="text-[11px] font-mono text-primary font-bold">
                  SKU: {selectedVariantObj.sku}
                </span>
              )}
            </div>
            <div className="p-4">
              <form onSubmit={handleAdjust} className="flex flex-col gap-3.5">
                {/* Variant Selector */}
                <div className="flex flex-col gap-1">
                  <label className="font-mono text-[11px] uppercase font-bold text-on-surface-variant">
                    Target Variant
                  </label>
                  <select
                    required
                    className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant/30 rounded-lg focus:outline-none focus:border-primary text-xs font-mono font-medium text-on-surface"
                    value={adjustVariant}
                    onChange={(e) => setAdjustVariant(e.target.value)}
                  >
                    <option value="">Select Variant to Adjust</option>
                    {product.variants?.map((v) => (
                      <option key={v._id} value={v._id}>
                        {v.sku} ({v.color} - {v.size}) · {v.stock} pcs in stock
                      </option>
                    ))}
                  </select>
                </div>

                {/* Type and Quantity in responsive grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="font-mono text-[11px] uppercase font-bold text-on-surface-variant">
                      Adjustment Type
                    </label>
                    <select
                      className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant/30 rounded-lg focus:outline-none focus:border-primary text-xs font-mono text-on-surface"
                      value={adjustType}
                      onChange={(e) => setAdjustType(e.target.value as "RESTOCK" | "ADJUSTMENT")}
                    >
                      <option value="RESTOCK">Restock (+ Addition)</option>
                      <option value="ADJUSTMENT">Adjustment (± Delta)</option>
                    </select>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="font-mono text-[11px] uppercase font-bold text-on-surface-variant">
                      Quantity {adjustType === "RESTOCK" ? "to Add" : "Delta (±)"}
                    </label>
                    <input
                      required
                      type="number"
                      step="1"
                      className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant/30 rounded-lg focus:outline-none focus:border-primary text-xs font-mono font-bold text-on-surface"
                      value={adjustQuantity}
                      onChange={(e) => {
                        const val = e.target.value;
                        setAdjustQuantity(val === "" ? "" : Number(val));
                      }}
                      placeholder="e.g. 10 or -5"
                    />
                  </div>
                </div>

                {/* Projected Calculation Banner */}
                {selectedVariantObj && projectedStock !== null && (
                  <div className="p-2.5 bg-surface-container-low rounded-lg border border-outline-variant/20 flex items-center justify-between text-xs font-mono">
                    <span className="text-on-surface-variant">Projected Stock:</span>
                    <span className="font-bold">
                      {selectedVariantObj.stock} pcs →{" "}
                      <span className={projectedStock < 0 ? "text-error" : "text-emerald-700"}>
                        {Math.max(0, projectedStock)} pcs
                      </span>
                    </span>
                  </div>
                )}

                {/* Reason Input */}
                <div className="flex flex-col gap-1">
                  <label className="font-mono text-[11px] uppercase font-bold text-on-surface-variant">
                    Reason / Note
                  </label>
                  <input
                    required
                    type="text"
                    placeholder="e.g. New fabric shipment received"
                    className="w-full px-3 py-2 bg-surface-container-low border border-outline-variant/30 rounded-lg focus:outline-none focus:border-primary text-xs text-on-surface placeholder:text-outline"
                    value={adjustReason}
                    onChange={(e) => setAdjustReason(e.target.value)}
                  />
                  {/* Preset quick tags */}
                  <div className="flex items-center gap-1.5 flex-wrap pt-1">
                    {[
                      "Received new shipment",
                      "Physical audit correction",
                      "Damaged stock write-off",
                      "Supplier restock",
                    ].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setAdjustReason(preset)}
                        className="px-2 py-0.5 rounded text-[10px] font-mono bg-surface-container hover:bg-surface-container-high border border-outline-variant/30 text-on-surface-variant transition-colors"
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={adjusting || !adjustVariant}
                  className="w-full mt-1 flex items-center justify-center gap-2 py-2.5 bg-neutral-900 text-white rounded-lg font-mono text-xs font-bold uppercase hover:bg-neutral-800 transition-colors disabled:opacity-50 min-h-[44px]"
                >
                  {adjusting ? (
                    <>
                      <span className="material-symbols-outlined text-[16px] animate-spin">
                        progress_activity
                      </span>
                      <span>Saving Adjustment...</span>
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-[16px]">tune</span>
                      <span>Apply Stock Adjustment</span>
                    </>
                  )}
                </button>
              </form>
            </div>
          </div>
        </div>

        {/* Right Column: Transaction History & Ledger (7 of 12 cols on desktop) */}
        <div className="lg:col-span-7 border border-outline-variant/20 rounded-xl bg-surface-container-lowest overflow-hidden shadow-xs">
          <div className="p-3.5 border-b border-outline-variant/15 flex items-center justify-between bg-surface-container-low/40">
            <h2 className="text-xs font-bold font-mono uppercase tracking-wider text-on-surface flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[17px] text-primary">history</span>
              <span>Transaction History &amp; Ledger</span>
            </h2>
            <span className="text-[11px] font-mono text-outline font-bold">
              {history.length} Entries
            </span>
          </div>

          {/* Mobile Transaction Feed (< 768px) */}
          <div className="block md:hidden divide-y divide-outline-variant/15 p-3 space-y-2.5">
            {history.length === 0 ? (
              <div className="py-12 text-center text-xs font-mono text-outline">
                No inventory transactions recorded
              </div>
            ) : (
              history.map((t) => {
                const v = product.variants?.find((vari) => String(vari._id) === String(t.variantId));
                const variantColor = v?.color || t.variantSnapshot?.color;
                const variantSize = v?.size || t.variantSnapshot?.size;
                const hex = variantColor ? resolveColorHex(variantColor, v?.hexCode, product.variants) : undefined;
                const displaySku = v?.sku || (variantColor && variantSize ? `${variantColor} (${variantSize})` : String(t.variantId).slice(-6));

                return (
                  <div key={t._id} className="p-3 rounded-lg bg-surface-container-low/40 border border-outline-variant/20 space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-bold ${getTypeBadge(t.type)}`}>
                          {t.type}
                        </span>
                        {renderQtyChange(t)}
                      </div>
                      <span className="text-[11px] font-mono text-outline">
                        {new Date(t.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ·{" "}
                        {new Date(t.createdAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs font-mono pt-0.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {hex && (
                          <span
                            className="w-2.5 h-2.5 rounded-full border border-black/20 shrink-0"
                            style={{ backgroundColor: hex }}
                          />
                        )}
                        <span className="font-semibold text-on-surface truncate">
                          {displaySku}
                        </span>
                        {(variantColor || variantSize) && (
                          <span className="text-outline text-[11px]">
                            ({variantColor || ""} · {variantSize || ""})
                          </span>
                        )}
                      </div>
                    </div>

                    {t.reason && (
                      <p className="text-[11px] text-on-surface-variant line-clamp-2 pt-0.5">
                        {t.reason}
                      </p>
                    )}

                    {t.orderId && (
                      <div className="pt-0.5">
                        <Link
                          href={`/admin/orders/${t.orderId}`}
                          className="text-[11px] font-mono text-primary hover:underline inline-flex items-center gap-0.5"
                        >
                          <span>Order #{String(t.orderId).slice(-6)}</span>
                          <span className="material-symbols-outlined text-[12px]">open_in_new</span>
                        </Link>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Desktop Table (>= 768px) */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface-container-lowest border-b border-outline-variant/20">
                  <th className="py-2.5 px-3.5 font-mono text-[10px] uppercase font-bold text-outline tracking-wider whitespace-nowrap">
                    Date &amp; Time
                  </th>
                  <th className="py-2.5 px-3.5 font-mono text-[10px] uppercase font-bold text-outline tracking-wider whitespace-nowrap">
                    Variant / SKU
                  </th>
                  <th className="py-2.5 px-3.5 font-mono text-[10px] uppercase font-bold text-outline tracking-wider whitespace-nowrap text-center">
                    Type
                  </th>
                  <th className="py-2.5 px-3.5 font-mono text-[10px] uppercase font-bold text-outline tracking-wider whitespace-nowrap text-right">
                    Change
                  </th>
                  <th className="py-2.5 px-3.5 font-mono text-[10px] uppercase font-bold text-outline tracking-wider">
                    Reason / Details
                  </th>
                </tr>
              </thead>
              <tbody className="text-xs text-on-surface">
                {history.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-16 px-4 text-center">
                      <div className="flex flex-col items-center gap-2 text-outline">
                        <span className="material-symbols-outlined text-[36px]">history</span>
                        <p className="font-semibold text-xs text-on-surface-variant font-mono">
                          No transactions recorded yet
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  history.map((t) => {
                    const v = product.variants?.find((vari) => String(vari._id) === String(t.variantId));
                    const variantColor = v?.color || t.variantSnapshot?.color;
                    const variantSize = v?.size || t.variantSnapshot?.size;
                    const hex = variantColor ? resolveColorHex(variantColor, v?.hexCode, product.variants) : undefined;
                    const displaySku = v?.sku || (variantColor && variantSize ? `${variantColor} (${variantSize})` : String(t.variantId).slice(-6));

                    return (
                      <tr
                        key={t._id}
                        className="border-b border-outline-variant/10 hover:bg-surface-container-low/30 transition-colors"
                      >
                        <td className="py-2.5 px-3.5 whitespace-nowrap font-mono text-[11px] text-on-surface-variant">
                          <div>
                            {new Date(t.createdAt).toLocaleDateString("en-GB", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })}
                          </div>
                          <div className="text-[10px] text-outline">
                            {new Date(t.createdAt).toLocaleTimeString("en-US", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </div>
                        </td>

                        <td className="py-2.5 px-3.5">
                          <div className="font-mono text-xs font-bold text-on-surface">
                            {displaySku}
                          </div>
                          {(variantColor || variantSize) && (
                            <div className="flex items-center gap-1.5 text-[10px] font-mono text-outline mt-0.5">
                              {hex && (
                                <span
                                  className="w-2 h-2 rounded-full border border-black/20 shrink-0"
                                  style={{ backgroundColor: hex }}
                                />
                              )}
                              {variantColor && <span>{variantColor}</span>}
                              {variantSize && <span>· Size {variantSize}</span>}
                            </div>
                          )}
                        </td>

                        <td className="py-2.5 px-3.5 text-center">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-bold ${getTypeBadge(
                              t.type
                            )}`}
                          >
                            {t.type}
                          </span>
                        </td>

                        <td className="py-2.5 px-3.5 text-right font-mono text-xs font-bold">
                          {renderQtyChange(t)}
                        </td>

                        <td className="py-2.5 px-3.5 text-on-surface-variant text-xs max-w-[220px]">
                          {t.orderId && (
                            <div>
                              <Link
                                href={`/admin/orders/${t.orderId}`}
                                className="font-mono text-[11px] text-primary hover:underline inline-flex items-center gap-0.5"
                                title="View order"
                              >
                                <span>Order #{String(t.orderId).slice(-6)}</span>
                                <span className="material-symbols-outlined text-[11px]">open_in_new</span>
                              </Link>
                            </div>
                          )}
                          <div className="text-[11px] text-on-surface-variant truncate">
                            {t.reason || (t.orderId ? "Order fulfillment" : "Manual update")}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="h-6" />
    </div>
  );
}

function renderQtyChange(t: InventoryTransactionItem) {
  if (t.type === "SALE") {
    const qty = Math.abs(t.quantity);
    return <span className="font-mono text-xs font-bold text-rose-600">-{qty}</span>;
  }
  if (t.type === "RESTOCK" || t.type === "RETURN" || t.type === "REFUND") {
    const qty = Math.abs(t.quantity);
    return <span className="font-mono text-xs font-bold text-emerald-600">+{qty}</span>;
  }
  if (t.quantity > 0) {
    return <span className="font-mono text-xs font-bold text-emerald-600">+{t.quantity}</span>;
  }
  return <span className="font-mono text-xs font-bold text-rose-600">{t.quantity}</span>;
}
