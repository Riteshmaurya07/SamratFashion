/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useState, FormEvent } from "react";
import { api } from "@/lib/api";

type PlacementTemplate = {
  _id: string;
  name: string;
  code: string;
  side: string;
};

type Product = {
  _id: string;
  name: string;
  basePrice: number;
};

type CatalogItem = {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  mockupImageUrl: string;
  displayPrice?: number;
  isActive: boolean;
  sortOrder: number;
  productId: Product;
  placementTemplateId: PlacementTemplate;
};

export default function AdminPrintCatalogPage() {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [placements, setPlacements] = useState<PlacementTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Modal / Form state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<CatalogItem | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Form inputs
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [productId, setProductId] = useState("");
  const [placementTemplateId, setPlacementTemplateId] = useState("");
  const [mockupImageUrl, setMockupImageUrl] = useState("");
  const [displayPrice, setDisplayPrice] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  const [isActive, setIsActive] = useState(true);

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const [catRes, prodRes, placeRes] = await Promise.all([
        api.get("/admin/print-catalog"),
        api.get("/admin/products?isCustomizable=true"),
        api.get("/print-placements"),
      ]);
      setItems(catRes.data?.data || []);
      setProducts(prodRes.data?.data || []);
      setPlacements(placeRes.data?.data || []);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e.response?.data?.message || "Failed to load admin catalog items.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  function openCreateModal() {
    setEditingItem(null);
    setName("");
    setSlug("");
    setDescription("");
    setProductId(products[0]?._id || "");
    setPlacementTemplateId(placements[0]?._id || "");
    setMockupImageUrl("http://localhost:5000/uploads/catalog-mockups/front_chest_mockup_1789033409264.png");
    setDisplayPrice("499");
    setSortOrder("1");
    setIsActive(true);
    setIsModalOpen(true);
  }

  function openEditModal(item: CatalogItem) {
    setEditingItem(item);
    setName(item.name);
    setSlug(item.slug);
    setDescription(item.description || "");
    setProductId(typeof item.productId === "object" ? item.productId._id : item.productId);
    setPlacementTemplateId(typeof item.placementTemplateId === "object" ? item.placementTemplateId._id : item.placementTemplateId);
    setMockupImageUrl(item.mockupImageUrl);
    setDisplayPrice(item.displayPrice ? (item.displayPrice / 100).toString() : "");
    setSortOrder(item.sortOrder.toString());
    setIsActive(item.isActive);
    setIsModalOpen(true);
  }

  async function handleToggleActive(item: CatalogItem) {
    setError("");
    setSuccess("");
    try {
      const endpoint = item.isActive ? `/admin/print-catalog/${item._id}/deactivate` : `/admin/print-catalog/${item._id}/activate`;
      await api.patch(endpoint);
      setSuccess(`Item "${item.name}" ${item.isActive ? "deactivated" : "activated"} successfully.`);
      loadData();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e.response?.data?.message || "Action failed.");
    }
  }

  async function handleSubmitForm(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    setSuccess("");

    try {
      const payload = {
        name,
        slug,
        description,
        productId,
        placementTemplateId,
        mockupImageUrl,
        displayPrice: displayPrice ? Math.round(parseFloat(displayPrice) * 100) : 0,
        sortOrder: parseInt(sortOrder, 10) || 0,
        isActive,
      };

      if (editingItem) {
        await api.put(`/admin/print-catalog/${editingItem._id}`, payload);
        setSuccess(`Catalog item "${name}" updated successfully.`);
      } else {
        await api.post("/admin/print-catalog", payload);
        setSuccess(`Catalog item "${name}" created successfully.`);
      }

      setIsModalOpen(false);
      loadData();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e.response?.data?.message || "Save failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-outline-variant/30 pb-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-on-surface">Print Catalog Management</h1>
          <p className="text-sm text-on-surface-variant">Manage customer-facing custom printing catalog items, placement mockups, and pricing.</p>
        </div>
        <button
          onClick={openCreateModal}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-on-primary shadow-sm hover:bg-primary/90 transition-all"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
          Create Catalog Item
        </button>
      </div>

      {/* Messages */}
      {error && <div className="rounded-xl bg-error-container p-4 text-sm font-bold text-on-error-container">{error}</div>}
      {success && <div className="rounded-xl bg-emerald-100 p-4 text-sm font-bold text-emerald-800">{success}</div>}

      {/* Table */}
      {loading ? (
        <div className="py-12 text-center text-sm font-bold text-on-surface-variant">Loading print catalog items...</div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-outline-variant p-12 text-center">
          <p className="font-bold text-on-surface">No print catalog items found.</p>
          <p className="text-sm text-on-surface-variant mt-1">Click "Create Catalog Item" to add your first print offering.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-outline-variant/30 bg-surface-container-lowest shadow-xs">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-container-low text-xs font-bold uppercase tracking-wider text-on-surface-variant border-b border-outline-variant/20">
              <tr>
                <th className="px-5 py-3.5">Item</th>
                <th className="px-5 py-3.5">Placement</th>
                <th className="px-5 py-3.5">Product</th>
                <th className="px-5 py-3.5">Price</th>
                <th className="px-5 py-3.5">Status</th>
                <th className="px-5 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/20">
              {items.map((item) => (
                <tr key={item._id} className="hover:bg-surface-container-low/50 transition-colors">
                  <td className="px-5 py-4 flex items-center gap-3">
                    <img
                      src={item.mockupImageUrl}
                      alt={item.name}
                      className="h-12 w-10 rounded-lg object-cover border border-outline-variant/40 bg-surface-container"
                    />
                    <div>
                      <p className="font-bold text-on-surface">{item.name}</p>
                      <p className="text-xs text-on-surface-variant font-mono">/custom-printing/{item.slug}</p>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
                      {typeof item.placementTemplateId === "object" ? item.placementTemplateId.name : item.placementTemplateId}
                    </span>
                  </td>
                  <td className="px-5 py-4 font-medium text-on-surface">
                    {typeof item.productId === "object" ? item.productId.name : item.productId}
                  </td>
                  <td className="px-5 py-4 font-bold text-on-surface">
                    {item.displayPrice ? `₹${(item.displayPrice / 100).toLocaleString("en-IN")}` : "Contact"}
                  </td>
                  <td className="px-5 py-4">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${
                        item.isActive ? "bg-emerald-100 text-emerald-800" : "bg-zinc-200 text-zinc-700"
                      }`}
                    >
                      <span className={`h-2 w-2 rounded-full ${item.isActive ? "bg-emerald-600" : "bg-zinc-500"}`} />
                      {item.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-right space-x-2">
                    <button
                      onClick={() => openEditModal(item)}
                      className="rounded-lg border border-outline-variant px-3 py-1.5 text-xs font-bold hover:bg-surface-container transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleToggleActive(item)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                        item.isActive ? "bg-error/10 text-error hover:bg-error/20" : "bg-emerald-600 text-white hover:bg-emerald-700"
                      }`}
                    >
                      {item.isActive ? "Deactivate" : "Activate"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-3xl bg-surface-container-lowest p-6 shadow-xl space-y-5">
            <h2 className="text-xl font-bold text-on-surface">
              {editingItem ? "Edit Print Catalog Item" : "Create New Print Catalog Item"}
            </h2>

            <form onSubmit={handleSubmitForm} className="space-y-4 text-sm" noValidate>
              <div>
                <label className="block font-bold mb-1">Item Title *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (!editingItem) setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
                  }}
                  placeholder="E.g. Front Chest Logo Print"
                  className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-low p-3 outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="block font-bold mb-1">URL Slug *</label>
                <input
                  type="text"
                  required
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase())}
                  placeholder="front-chest-logo"
                  className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-low p-3 font-mono outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="block font-bold mb-1">Product *</label>
                <select
                  required
                  value={productId}
                  onChange={(e) => setProductId(e.target.value)}
                  className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-low p-3 outline-none focus:border-primary"
                >
                  {products.map((p) => (
                    <option key={p._id} value={p._id}>{p.name} (Base Price ₹{(p.basePrice / 100).toLocaleString("en-IN")})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold mb-1">Placement Template *</label>
                <select
                  required
                  value={placementTemplateId}
                  onChange={(e) => setPlacementTemplateId(e.target.value)}
                  className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-low p-3 outline-none focus:border-primary"
                >
                  {placements.map((pt) => (
                    <option key={pt._id} value={pt._id}>{pt.name} ({pt.code} - {pt.side})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold mb-1">Mockup Image URL *</label>
                <input
                  type="text"
                  required
                  value={mockupImageUrl}
                  onChange={(e) => setMockupImageUrl(e.target.value)}
                  placeholder="http://localhost:5000/uploads/catalog-mockups/..."
                  className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-low p-3 outline-none focus:border-primary"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold mb-1">Starting Price (₹)</label>
                  <input
                    type="number"
                    value={displayPrice}
                    onChange={(e) => setDisplayPrice(e.target.value)}
                    placeholder="499"
                    className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-low p-3 outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">Sort Order</label>
                  <input
                    type="number"
                    value={sortOrder}
                    onChange={(e) => setSortOrder(e.target.value)}
                    placeholder="1"
                    className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-low p-3 outline-none focus:border-primary"
                  />
                </div>
              </div>

              <div>
                <label className="flex items-center gap-2 font-bold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    className="h-4 w-4 rounded text-primary focus:ring-primary"
                  />
                  Active (Visible in Storefront Catalog)
                </label>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-outline-variant/30">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="rounded-xl border border-outline-variant px-5 py-2.5 font-bold hover:bg-surface-container transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-xl bg-primary px-6 py-2.5 font-bold text-on-primary hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {submitting ? "Saving..." : editingItem ? "Update Item" : "Create Item"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
