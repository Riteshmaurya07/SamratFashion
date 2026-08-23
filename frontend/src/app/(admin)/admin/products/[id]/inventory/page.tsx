"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";

export default function ProductInventoryPage() {
  const params = useParams();
  const router = useRouter();
  const productId = params.id as string;

  const [product, setProduct] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Adjustment Form State
  const [adjustVariant, setAdjustVariant] = useState("");
  const [adjustQuantity, setAdjustQuantity] = useState<number>(0);
  const [adjustType, setAdjustType] = useState("RESTOCK");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjusting, setAdjusting] = useState(false);
  const [error, setError] = useState("");

  const fetchData = useCallback(async () => {
    try {
      const [pRes, hRes] = await Promise.all([
        api.get(`/admin/products/${productId}`),
        api.get(`/admin/products/${productId}/inventory`),
      ]);
      setProduct(pRes.data.data);
      setHistory(hRes.data.data.transactions);
      setLoading(false);
    } catch (err) {
      setError("Failed to load inventory data");
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustVariant) return alert("Please select a variant");
    if (!adjustReason || adjustReason.length < 2) return alert("Reason is required");
    if (adjustQuantity === 0) return alert("Quantity cannot be 0");

    setAdjusting(true);
    try {
      await api.patch(`/admin/products/${productId}/variants/${adjustVariant}/inventory`, {
        quantity: Number(adjustQuantity),
        type: adjustType,
        reason: adjustReason,
      });
      setAdjustVariant("");
      setAdjustQuantity(0);
      setAdjustReason("");
      await fetchData();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to adjust inventory");
    } finally {
      setAdjusting(false);
    }
  };

  const getTypeBadge = (type: string) => {
    switch (type) {
      case "RESTOCK": return "bg-primary-container/20 text-primary border border-primary/20";
      case "SALE": return "bg-surface-container-high text-on-surface border border-outline-variant/30";
      case "RETURN": return "bg-[#eef0ff] text-[#003ea8] border border-[#b4c5ff]";
      case "ADJUSTMENT": return "bg-secondary-container/10 text-secondary border border-secondary/20";
      default: return "bg-surface-container-high text-on-surface border border-outline-variant/30";
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-6 animate-pulse">
        <div className="h-10 bg-surface-container-low rounded-xl w-1/3" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="h-64 bg-surface-container-low rounded-xl" />
          <div className="h-64 bg-surface-container-low rounded-xl" />
          <div className="h-64 bg-surface-container-low col-span-2 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="p-8 text-error bg-error-container/20 rounded-xl font-body-sm">
        {error || "Product not found"}
      </div>
    );
  }

  const totalStock = product.variants?.reduce((sum: number, v: any) => sum + (v.stock || 0), 0) || 0;
  const lowStockCount = product.variants?.filter((v: any) => v.stock < 10).length || 0;

  return (
    <div className="flex flex-col gap-element-gap md:gap-gutter">
      {/* Back + Header */}
      <div>
        <button
          onClick={() => router.back()}
          className="inline-flex items-center gap-2 text-on-surface-variant hover:text-primary transition-colors font-label-caps text-[12px] mb-4"
        >
          <span className="material-symbols-outlined text-[16px]">arrow_back</span>
          BACK TO PRODUCTS
        </button>
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="font-headline-lg text-headline-lg text-on-background mb-1">
              Inventory: {product.name}
            </h1>
            <p className="font-body-md text-body-md text-on-surface-variant">
              Manage stock levels and view transaction history for{" "}
              <span className="font-label-caps text-[11px]">/{product.slug}</span>
            </p>
          </div>
        </div>
      </div>

      {/* Stock KPI Row */}
      <section className="grid grid-cols-3 gap-4">
        <div className="bg-surface border border-outline-variant/30 rounded-lg p-4 flex items-center justify-between">
          <span className="font-label-caps text-label-caps text-on-surface-variant">Variants</span>
          <span className="font-headline-sm text-headline-sm text-on-surface">{product.variants?.length || 0}</span>
        </div>
        <div className="bg-surface border border-outline-variant/30 rounded-lg p-4 flex items-center justify-between border-l-4 border-l-primary">
          <span className="font-label-caps text-label-caps text-on-surface-variant">Total Stock</span>
          <span className="font-headline-sm text-headline-sm text-primary">{totalStock}</span>
        </div>
        <div className={`bg-surface border border-outline-variant/30 rounded-lg p-4 flex items-center justify-between ${lowStockCount > 0 ? "border-l-4 border-l-error" : ""}`}>
          <span className="font-label-caps text-label-caps text-on-surface-variant">Low Stock</span>
          <span className={`font-headline-sm text-headline-sm ${lowStockCount > 0 ? "text-error" : "text-on-surface"}`}>{lowStockCount}</span>
        </div>
      </section>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column */}
        <div className="col-span-1 flex flex-col gap-6">
          {/* Current Stock Card */}
          <div className="border border-outline-variant/20 rounded-xl bg-surface-container-lowest overflow-hidden">
            <div className="p-4 border-b border-outline-variant/20">
              <h2 className="font-headline-sm text-headline-sm text-on-surface flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                  inventory_2
                </span>
                Current Stock
              </h2>
            </div>
            <div className="p-4 flex flex-col gap-2">
              {product.variants?.map((v: any) => (
                <div
                  key={v._id}
                  className="flex justify-between items-center p-3 border border-outline-variant/20 rounded-lg bg-surface-container-low hover:bg-surface-container transition-colors"
                >
                  <div>
                    <div className="font-label-caps text-label-caps text-on-surface">{v.sku}</div>
                    <div className="font-body-sm text-[11px] text-on-surface-variant mt-0.5">
                      {v.size && `Size: ${v.size}`}
                      {v.size && v.color && " · "}
                      {v.color && `Color: ${v.color}`}
                    </div>
                  </div>
                  <div
                    className={`font-price-lg text-[20px] font-bold ${
                      v.stock === 0 ? "text-error" : v.stock < 10 ? "text-secondary" : "text-primary"
                    }`}
                  >
                    {v.stock}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Adjust Stock Form */}
          <div className="border border-outline-variant/20 rounded-xl bg-surface-container-lowest overflow-hidden">
            <div className="p-4 border-b border-outline-variant/20">
              <h2 className="font-headline-sm text-headline-sm text-on-surface flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px]">tune</span>
                Adjust Stock
              </h2>
            </div>
            <div className="p-4">
              <form onSubmit={handleAdjust} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider">
                    Variant
                  </label>
                  <select
                    required
                    className="w-full px-4 py-2.5 bg-surface-container-low border border-outline-variant/30 rounded-lg focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary font-body-sm text-body-sm text-on-surface transition-all"
                    value={adjustVariant}
                    onChange={(e) => setAdjustVariant(e.target.value)}
                  >
                    <option value="">Select Variant</option>
                    {product.variants?.map((v: any) => (
                      <option key={v._id} value={v._id}>
                        {v.sku} ({v.stock} in stock)
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider">
                      Type
                    </label>
                    <select
                      className="w-full px-4 py-2.5 bg-surface-container-low border border-outline-variant/30 rounded-lg focus:outline-none focus:border-primary font-body-sm text-body-sm text-on-surface transition-all"
                      value={adjustType}
                      onChange={(e) => setAdjustType(e.target.value)}
                    >
                      <option value="RESTOCK">Restock (+)</option>
                      <option value="ADJUSTMENT">Adjustment (±)</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider">
                      Quantity
                    </label>
                    <input
                      required
                      type="number"
                      className="w-full px-4 py-2.5 bg-surface-container-low border border-outline-variant/30 rounded-lg focus:outline-none focus:border-primary font-body-sm text-body-sm text-on-surface transition-all"
                      value={adjustQuantity}
                      onChange={(e) => setAdjustQuantity(Number(e.target.value))}
                    />
                    <p className="font-body-sm text-[11px] text-outline">Use negative for deductions</p>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider">
                    Reason
                  </label>
                  <input
                    required
                    type="text"
                    placeholder="e.g. Received new shipment"
                    className="w-full px-4 py-2.5 bg-surface-container-low border border-outline-variant/30 rounded-lg focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary font-body-sm text-body-sm text-on-surface transition-all placeholder:text-outline"
                    value={adjustReason}
                    onChange={(e) => setAdjustReason(e.target.value)}
                  />
                </div>

                <button
                  type="submit"
                  disabled={adjusting}
                  className="w-full flex items-center justify-center gap-2 py-3 bg-primary text-on-primary rounded-lg font-label-caps text-label-caps hover:opacity-90 transition-opacity disabled:opacity-60"
                >
                  {adjusting ? (
                    <>
                      <span className="material-symbols-outlined text-[18px] animate-spin">
                        progress_activity
                      </span>
                      Applying...
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-[18px]">tune</span>
                      Apply Adjustment
                    </>
                  )}
                </button>
              </form>
            </div>
          </div>
        </div>

        {/* Transaction History */}
        <div className="col-span-1 lg:col-span-2 border border-outline-variant/20 rounded-xl bg-surface-container-lowest overflow-hidden">
          <div className="p-4 border-b border-outline-variant/20">
            <h2 className="font-headline-sm text-headline-sm text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px]">history</span>
              Transaction History
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface-container-lowest border-b border-outline-variant/20">
                  <th className="py-3 px-4 font-label-caps text-label-caps text-outline font-medium tracking-wider whitespace-nowrap">
                    Date
                  </th>
                  <th className="py-3 px-4 font-label-caps text-label-caps text-outline font-medium tracking-wider whitespace-nowrap">
                    Variant (SKU)
                  </th>
                  <th className="py-3 px-4 font-label-caps text-label-caps text-outline font-medium tracking-wider whitespace-nowrap">
                    Type
                  </th>
                  <th className="py-3 px-4 font-label-caps text-label-caps text-outline font-medium tracking-wider whitespace-nowrap text-right">
                    Qty Change
                  </th>
                  <th className="py-3 px-4 font-label-caps text-label-caps text-outline font-medium tracking-wider whitespace-nowrap">
                    Reason / Details
                  </th>
                </tr>
              </thead>
              <tbody className="font-body-sm text-body-sm text-on-surface">
                {history.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 px-4">
                      <div className="flex flex-col items-center gap-3 text-center">
                        <span className="material-symbols-outlined text-outline text-[48px]">history</span>
                        <p className="font-body-md text-body-md text-on-surface-variant">
                          No transactions found
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  history.map((t: any) => {
                    const v = product.variants?.find((vari: any) => vari._id === t.variantId);
                    return (
                      <tr
                        key={t._id}
                        className="border-b border-outline-variant/10 hover:bg-surface-container-lowest/50 transition-colors"
                      >
                        <td className="py-3 px-4 whitespace-nowrap text-on-surface-variant text-xs">
                          {new Date(t.createdAt).toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                          })}
                          <br />
                          <span className="text-[10px]">
                            {new Date(t.createdAt).toLocaleTimeString("en-US", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-label-caps text-[11px]">
                          {v?.sku || t.variantId?.slice(-6)}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-label-caps ${getTypeBadge(
                              t.type
                            )}`}
                          >
                            {t.type}
                          </span>
                        </td>
                        <td
                          className={`py-3 px-4 text-right font-bold font-label-caps text-label-caps ${
                            t.quantity > 0 ? "text-primary" : "text-error"
                          }`}
                        >
                          {t.quantity > 0 ? `+${t.quantity}` : t.quantity}
                        </td>
                        <td className="py-3 px-4 text-on-surface-variant max-w-[200px] truncate">
                          {t.reason || (t.orderId ? `Order ${t.orderId?.slice(-6)}` : "N/A")}
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

      <div className="h-8" />
    </div>
  );
}
