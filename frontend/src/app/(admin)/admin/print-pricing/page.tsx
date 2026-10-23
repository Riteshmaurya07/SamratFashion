"use client";

import { useEffect, useState, FormEvent } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Plus, Trash2, Layers } from "lucide-react";

type VolumeTier = {
  minQuantity: number;
  maxQuantity?: number;
  discountPercentage?: number;
  unitPrice?: number;
};

type PricingConfig = {
  _id: string;
  scope: "GLOBAL" | "CATEGORY" | "PRODUCT";
  productId?: { _id: string; name: string; basePrice: number };
  categoryId?: { _id: string; name: string };
  minOrderQuantity: number;
  tiers: VolumeTier[];
  printLocationFee: number;
  setupFee: number;
  isActive: boolean;
  createdAt: string;
};

type Product = { _id: string; name: string; basePrice: number };
type Category = { _id: string; name: string };

export default function AdminPrintPricingPage() {
  const [configs, setConfigs] = useState<PricingConfig[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<PricingConfig | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Form State
  const [scope, setScope] = useState<"GLOBAL" | "CATEGORY" | "PRODUCT">("GLOBAL");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [minOrderQuantity, setMinOrderQuantity] = useState("10");
  const [printLocationFee, setPrintLocationFee] = useState("200");
  const [setupFee, setSetupFee] = useState("0");
  const [isActive, setIsActive] = useState(true);
  const [tiers, setTiers] = useState<VolumeTier[]>([
    { minQuantity: 10, maxQuantity: 19, discountPercentage: 5 },
    { minQuantity: 20, maxQuantity: 49, discountPercentage: 10 },
    { minQuantity: 50, discountPercentage: 20 },
  ]);

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const [configRes, prodRes, catRes] = await Promise.all([
        api.get("/admin/print-pricing").catch(() => ({ data: { data: [] } })),
        api.get("/catalog/customizable-products").catch(() =>
          api.get("/admin/products?isCustomizable=true").catch(() => ({ data: { data: [] } }))
        ),
        api.get("/catalog/categories").catch(() => ({ data: { data: [] } })),
      ]);

      const rawConfigs = configRes.data?.data;
      setConfigs(Array.isArray(rawConfigs) ? rawConfigs : []);

      const rawProds = prodRes.data?.data;
      const prodList = Array.isArray(rawProds)
        ? rawProds
        : Array.isArray(rawProds?.products)
        ? rawProds.products
        : [];
      setProducts(prodList);

      const rawCats = catRes.data?.data;
      setCategories(Array.isArray(rawCats) ? rawCats : []);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e.response?.data?.message || "Failed to load volume pricing configurations.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  function openCreateModal() {
    setEditingConfig(null);
    setScope("GLOBAL");
    setSelectedProductId(products[0]?._id || "");
    setSelectedCategoryId(categories[0]?._id || "");
    setMinOrderQuantity("10");
    setPrintLocationFee("200");
    setSetupFee("0");
    setIsActive(true);
    setTiers([
      { minQuantity: 10, maxQuantity: 19, discountPercentage: 5 },
      { minQuantity: 20, maxQuantity: 49, discountPercentage: 10 },
      { minQuantity: 50, discountPercentage: 20 },
    ]);
    setError("");
    setSuccess("");
    setIsModalOpen(true);
  }

  function openEditModal(cfg: PricingConfig) {
    setEditingConfig(cfg);
    setScope(cfg.scope);
    setSelectedProductId(cfg.productId?._id || "");
    setSelectedCategoryId(cfg.categoryId?._id || "");
    setMinOrderQuantity(String(cfg.minOrderQuantity || 10));
    setPrintLocationFee(String(cfg.printLocationFee || 200));
    setSetupFee(String(cfg.setupFee || 0));
    setIsActive(cfg.isActive !== false);
    setTiers(cfg.tiers && cfg.tiers.length > 0 ? cfg.tiers : []);
    setError("");
    setSuccess("");
    setIsModalOpen(true);
  }

  function handleAddTier() {
    const lastTier = tiers[tiers.length - 1];
    const nextMin = lastTier ? (lastTier.maxQuantity ? lastTier.maxQuantity + 1 : lastTier.minQuantity + 20) : 10;
    setTiers([...tiers, { minQuantity: nextMin, discountPercentage: 15 }]);
  }

  function handleUpdateTier(index: number, field: keyof VolumeTier, val: string) {
    const next = [...tiers];
    const num = val === "" ? undefined : parseFloat(val);
    next[index] = { ...next[index], [field]: num };
    setTiers(next);
  }

  function handleRemoveTier(index: number) {
    setTiers(tiers.filter((_, i) => i !== index));
  }

  async function handleDelete(cfg: PricingConfig) {
    if (!confirm(`Are you sure you want to delete this ${cfg.scope} pricing rule?`)) return;
    try {
      await api.delete(`/admin/print-pricing/${cfg._id}`);
      setSuccess("Volume pricing configuration deleted.");
      loadData();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e.response?.data?.message || "Failed to delete pricing rule.");
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    setSuccess("");

    try {
      const payload = {
        scope,
        productId: scope === "PRODUCT" ? selectedProductId : undefined,
        categoryId: scope === "CATEGORY" ? selectedCategoryId : undefined,
        minOrderQuantity: parseInt(minOrderQuantity, 10) || 10,
        printLocationFee: parseFloat(printLocationFee) || 0,
        setupFee: parseFloat(setupFee) || 0,
        isActive,
        tiers: tiers.map((t) => ({
          minQuantity: Number(t.minQuantity),
          maxQuantity: t.maxQuantity !== undefined && t.maxQuantity !== null ? Number(t.maxQuantity) : undefined,
          discountPercentage: t.discountPercentage !== undefined && t.discountPercentage !== null ? Number(t.discountPercentage) : undefined,
          unitPrice: t.unitPrice !== undefined && t.unitPrice !== null ? Number(t.unitPrice) : undefined,
        })),
      };

      await api.post("/admin/print-pricing", payload);
      setSuccess("Pricing configuration saved successfully.");
      setIsModalOpen(false);
      loadData();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e.response?.data?.message || "Failed to save pricing configuration.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6 p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-outline-variant/20 pb-5">
        <div>
          <h1 className="text-2xl font-black text-on-surface">Volume Pricing & MOQ Configuration</h1>
          <p className="text-xs text-on-surface-variant mt-1">
            Configure dynamic minimum order quantities and quantity-tier discounts. Server-authoritative precedence rules apply.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/admin/print-catalog"
            className="rounded-xl border border-outline-variant/40 bg-surface-container-low px-4 py-2.5 text-xs font-bold text-on-surface hover:bg-surface-container transition-colors"
          >
            ← Print Catalog
          </Link>
          <button
            onClick={openCreateModal}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-on-primary hover:bg-primary/90 transition-colors shadow-sm"
          >
            <Plus className="h-4 w-4" />
            <span>New Pricing Rule</span>
          </button>
        </div>
      </div>

      {/* Precedence Explainer Chip */}
      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 text-xs text-on-surface space-y-1">
        <span className="font-bold text-primary uppercase text-[11px] tracking-wider">
          Precedence Order
        </span>
        <p className="text-on-surface-variant leading-relaxed">
          <strong>1. Product Rule:</strong> Overrides any category or global defaults for that exact garment. ·{" "}
          <strong>2. Category Rule:</strong> Applies to all garments belonging to that apparel category. ·{" "}
          <strong>3. Global Rule:</strong> Applies across all custom printing inquiries if no product/category rule is matched. ·{" "}
          <strong>4. Built-in Fallback:</strong> Default MOQ of 10 units with standard 5%/10%/20% volume discounts.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-error/30 bg-error-container p-4 text-xs font-bold text-on-error-container">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs font-bold text-emerald-800">
          {success}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="py-16 text-center text-xs font-bold text-on-surface-variant animate-pulse">
          Loading pricing configurations...
        </div>
      ) : configs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-outline-variant/40 bg-surface-container-lowest p-12 text-center space-y-4">
          <Layers className="h-10 w-10 text-on-surface-variant mx-auto" />
          <p className="text-base font-bold text-on-surface">No custom pricing rules configured</p>
          <p className="text-xs text-on-surface-variant max-w-md mx-auto">
            The platform is currently operating on the default fallback (MOQ 10, standard 10/20/50 tiers). Create a Global, Category, or Product rule to customize your pricing tiers.
          </p>
          <button
            onClick={openCreateModal}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-xs font-bold text-on-primary hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" /> Create First Rule
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-outline-variant/30 bg-surface-container-lowest shadow-xs">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-outline-variant/30 bg-surface-container-low/60 text-xs text-on-surface-variant uppercase font-bold tracking-wider">
              <tr>
                <th className="px-5 py-4">Scope & Target</th>
                <th className="px-5 py-4">Authoritative MOQ</th>
                <th className="px-5 py-4">Quantity Tiers</th>
                <th className="px-5 py-4">Print / Setup Fee</th>
                <th className="px-5 py-4">Status</th>
                <th className="px-5 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/20">
              {configs.map((cfg) => (
                <tr key={cfg._id} className="hover:bg-surface-container-low/40 transition-colors">
                  <td className="px-5 py-4">
                    <span
                      className={`inline-block font-mono text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
                        cfg.scope === "PRODUCT"
                          ? "bg-purple-100 text-purple-800"
                          : cfg.scope === "CATEGORY"
                          ? "bg-blue-100 text-blue-800"
                          : "bg-emerald-100 text-emerald-800"
                      }`}
                    >
                      {cfg.scope}
                    </span>
                    <p className="font-bold text-on-surface mt-1">
                      {cfg.scope === "PRODUCT"
                        ? cfg.productId?.name || "Target Product"
                        : cfg.scope === "CATEGORY"
                        ? cfg.categoryId?.name || "Target Category"
                        : "All Storefront Blanks (Global)"}
                    </p>
                  </td>
                  <td className="px-5 py-4 font-bold text-on-surface font-mono">
                    {cfg.minOrderQuantity} Units
                  </td>
                  <td className="px-5 py-4">
                    <div className="space-y-1">
                      {(cfg.tiers || []).map((t, idx) => (
                        <div key={idx} className="text-xs font-mono text-on-surface-variant">
                          <span className="font-bold text-on-surface">
                            {t.minQuantity}–{t.maxQuantity ? `${t.maxQuantity}` : "+"} units:
                          </span>{" "}
                          {t.unitPrice ? `₹${t.unitPrice}/unit` : `${t.discountPercentage}% off`}
                        </div>
                      ))}
                    </div>
                  </td>
                  <td className="px-5 py-4 text-xs font-mono text-on-surface-variant">
                    <p>Print: ₹{cfg.printLocationFee}/loc/unit</p>
                    <p>Setup: ₹{cfg.setupFee} flat</p>
                  </td>
                  <td className="px-5 py-4">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${
                        cfg.isActive ? "bg-emerald-100 text-emerald-800" : "bg-zinc-200 text-zinc-700"
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${cfg.isActive ? "bg-emerald-600" : "bg-zinc-500"}`} />
                      {cfg.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-right space-x-2">
                    <button
                      onClick={() => openEditModal(cfg)}
                      className="rounded-lg border border-outline-variant px-3 py-1.5 text-xs font-bold hover:bg-surface-container transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(cfg)}
                      className="rounded-lg p-1.5 text-error hover:bg-error/10 transition-colors"
                      title="Delete rule"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Editor Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-3xl bg-surface-container-lowest p-6 md:p-8 shadow-2xl space-y-6">
            <div className="flex items-center justify-between border-b border-outline-variant/20 pb-4">
              <h2 className="text-xl font-black text-on-surface">
                {editingConfig ? "Edit Volume Pricing Rule" : "Create Volume Pricing Rule"}
              </h2>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-on-surface-variant hover:text-on-surface font-bold text-lg"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5 text-sm" noValidate>
              <div>
                <label className="block font-bold mb-1 text-on-surface">Scope *</label>
                <div className="grid grid-cols-3 gap-3">
                  {(["GLOBAL", "CATEGORY", "PRODUCT"] as const).map((sc) => (
                    <button
                      type="button"
                      key={sc}
                      onClick={() => setScope(sc)}
                      className={`p-3 rounded-xl border text-center font-bold text-xs transition-colors ${
                        scope === sc
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-outline-variant/40 bg-surface-container-low text-on-surface-variant hover:border-outline-variant"
                      }`}
                    >
                      {sc} Rule
                    </button>
                  ))}
                </div>
              </div>

              {scope === "PRODUCT" && (
                <div>
                  <label className="block font-bold mb-1 text-on-surface">Target Product *</label>
                  <select
                    required
                    value={selectedProductId}
                    onChange={(e) => setSelectedProductId(e.target.value)}
                    className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-low p-3 outline-none focus:border-primary"
                  >
                    <option value="">-- Choose Target Product --</option>
                    {products.map((p) => (
                      <option key={p._id} value={p._id}>
                        {p.name} (Base: ₹{p.basePrice})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {scope === "CATEGORY" && (
                <div>
                  <label className="block font-bold mb-1 text-on-surface">Target Category *</label>
                  <select
                    required
                    value={selectedCategoryId}
                    onChange={(e) => setSelectedCategoryId(e.target.value)}
                    className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-low p-3 outline-none focus:border-primary"
                  >
                    <option value="">-- Choose Target Category --</option>
                    {categories.map((c) => (
                      <option key={c._id} value={c._id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block font-bold mb-1 text-on-surface">Minimum Order Quantity (MOQ) *</label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={minOrderQuantity}
                    onChange={(e) => setMinOrderQuantity(e.target.value)}
                    className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-low p-3 outline-none focus:border-primary font-mono"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1 text-on-surface">Print Location Fee (₹)</label>
                  <input
                    type="number"
                    min={0}
                    value={printLocationFee}
                    onChange={(e) => setPrintLocationFee(e.target.value)}
                    className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-low p-3 outline-none focus:border-primary font-mono"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1 text-on-surface">Setup Fee (₹)</label>
                  <input
                    type="number"
                    min={0}
                    value={setupFee}
                    onChange={(e) => setSetupFee(e.target.value)}
                    className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-low p-3 outline-none focus:border-primary font-mono"
                  />
                </div>
              </div>

              {/* Quantity Tiers */}
              <div className="space-y-3 pt-2 border-t border-outline-variant/20">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-on-surface">Quantity-Based Volume Tiers</label>
                  <button
                    type="button"
                    onClick={handleAddTier}
                    className="text-xs font-bold text-primary hover:underline inline-flex items-center gap-1"
                  >
                    + Add Tier
                  </button>
                </div>

                {tiers.map((tier, idx) => (
                  <div key={idx} className="flex items-center gap-3 bg-surface-container-low p-3 rounded-xl border border-outline-variant/20">
                    <div className="flex-1 grid grid-cols-4 gap-2">
                      <div>
                        <span className="text-[10px] text-on-surface-variant block mb-0.5">Min Qty</span>
                        <input
                          type="number"
                          min={1}
                          value={tier.minQuantity}
                          onChange={(e) => handleUpdateTier(idx, "minQuantity", e.target.value)}
                          className="w-full rounded-lg border border-outline-variant/40 bg-surface-container-lowest p-2 text-xs font-mono"
                        />
                      </div>
                      <div>
                        <span className="text-[10px] text-on-surface-variant block mb-0.5">Max Qty (Blank = +)</span>
                        <input
                          type="number"
                          min={1}
                          value={tier.maxQuantity ?? ""}
                          onChange={(e) => handleUpdateTier(idx, "maxQuantity", e.target.value)}
                          placeholder="Open"
                          className="w-full rounded-lg border border-outline-variant/40 bg-surface-container-lowest p-2 text-xs font-mono"
                        />
                      </div>
                      <div>
                        <span className="text-[10px] text-on-surface-variant block mb-0.5">Discount %</span>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={tier.discountPercentage ?? ""}
                          onChange={(e) => handleUpdateTier(idx, "discountPercentage", e.target.value)}
                          placeholder="e.g. 10"
                          className="w-full rounded-lg border border-outline-variant/40 bg-surface-container-lowest p-2 text-xs font-mono"
                        />
                      </div>
                      <div>
                        <span className="text-[10px] text-on-surface-variant block mb-0.5">Fixed Price (₹)</span>
                        <input
                          type="number"
                          min={0}
                          value={tier.unitPrice ?? ""}
                          onChange={(e) => handleUpdateTier(idx, "unitPrice", e.target.value)}
                          placeholder="Optional"
                          className="w-full rounded-lg border border-outline-variant/40 bg-surface-container-lowest p-2 text-xs font-mono"
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveTier(idx)}
                      className="text-error p-1 hover:bg-error/10 rounded transition-colors"
                      title="Remove tier"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="pricingActive"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="h-4 w-4 rounded accent-primary"
                />
                <label htmlFor="pricingActive" className="font-bold text-xs cursor-pointer select-none">
                  Rule Active & Enforced
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-outline-variant/20">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="rounded-xl border border-outline-variant px-5 py-2.5 text-xs font-bold hover:bg-surface-container transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-xl bg-primary px-6 py-2.5 text-xs font-bold text-on-primary hover:bg-primary/90 transition-colors shadow-sm disabled:opacity-50"
                >
                  {submitting ? "Saving..." : "Save Pricing Configuration"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
