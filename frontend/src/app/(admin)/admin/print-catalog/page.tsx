/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useState, FormEvent, ChangeEvent, useRef } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import {
  UploadCloud,
  Trash2,
  Plus,
  Layers,
} from "lucide-react";


type Category = {
  _id: string;
  name: string;
  slug: string;
};

type Product = {
  _id: string;
  name: string;
  basePrice: number;
  images?: string[];
};

type CatalogItem = {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  mockupImageUrl: string;
  backMockupImageUrl?: string;
  displayPrice?: number;
  minOrderQuantity?: number;
  isActive: boolean;
  sortOrder: number;
  productId: Product;
  categoryId?: Category;
};

export default function AdminPrintCatalogPage() {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Modal / Form state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<CatalogItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form inputs
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [productId, setProductId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [mockupImageUrl, setMockupImageUrl] = useState("");
  const [backMockupImageUrl, setBackMockupImageUrl] = useState("");
  const [displayPrice, setDisplayPrice] = useState("");
  const [minOrderQuantity, setMinOrderQuantity] = useState("10");
  const [sortOrder, setSortOrder] = useState("0");
  const [isActive, setIsActive] = useState(true);

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const [catRes, prodRes, categoryListRes] = await Promise.all([
        api.get("/admin/print-catalog").catch(() => ({ data: { data: [] } })),
        api.get("/catalog/customizable-products").catch(() =>
          api.get("/admin/products?isCustomizable=true").catch(() => ({ data: { data: [] } }))
        ),
        api.get("/catalog/categories").catch(() => ({ data: { data: [] } })),
      ]);

      const rawItems = catRes.data?.data;
      setItems(Array.isArray(rawItems) ? rawItems : []);

      const rawProds = prodRes.data?.data;
      const prodList = Array.isArray(rawProds)
        ? rawProds
        : Array.isArray(rawProds?.products)
        ? rawProds.products
        : [];
      setProducts(prodList);


      const rawCats = categoryListRes.data?.data;
      setCategories(Array.isArray(rawCats) ? rawCats : []);
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
    setCategoryId(categories[0]?._id || "");
    setMockupImageUrl("");
    setDisplayPrice("");
    setMinOrderQuantity("10");
    setSortOrder("0");
    setIsActive(true);
    setError("");
    setSuccess("");
    setIsModalOpen(true);
  }

  function openEditModal(item: CatalogItem) {
    setEditingItem(item);
    setName(item.name);
    setSlug(item.slug);
    setDescription(item.description || "");
    setProductId(item.productId?._id || "");
    setCategoryId(item.categoryId?._id || "");
    setMockupImageUrl(item.mockupImageUrl || "");
    setBackMockupImageUrl(item.backMockupImageUrl || "");
    setDisplayPrice(item.displayPrice !== undefined ? String(item.displayPrice) : "");
    setMinOrderQuantity(item.minOrderQuantity !== undefined ? String(item.minOrderQuantity) : "10");
    setSortOrder(String(item.sortOrder || 0));
    setIsActive(item.isActive !== false);
    setError("");
    setSuccess("");
    setIsModalOpen(true);
  }

  async function handleToggleActive(item: CatalogItem) {
    try {
      const endpoint = item.isActive
        ? `/admin/print-catalog/${item._id}/deactivate`
        : `/admin/print-catalog/${item._id}/activate`;
      await api.patch(endpoint);
      setSuccess(`Catalog item ${item.isActive ? "deactivated" : "activated"} successfully.`);
      loadData();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e.response?.data?.message || "Failed to update item status.");
    }
  }

  async function handleDelete(item: CatalogItem) {
    if (!confirm(`Are you sure you want to permanently delete "${item.name}"?`)) return;
    try {
      await api.delete(`/admin/print-catalog/${item._id}`);
      setSuccess("Catalog item deleted successfully.");
      loadData();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e.response?.data?.message || "Failed to delete item.");
    }
  }

  async function handleImageUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    setUploadingImage(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("category", "product");
      const res = await api.post("/upload/image", formData, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 120000,
      });

      const url = res.data?.data?.url;
      if (!url) throw new Error("Upload did not return an image URL");
      setMockupImageUrl(url);
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string; response?: { data?: { message?: string } } };
      if (e.code === "ECONNABORTED" || e.message?.includes("timeout")) {
        setError("Image upload timed out. The file may be large. Please try again or compress the image.");
      } else {
        setError(e.response?.data?.message || "Failed to upload image. Please try again.");
      }
    } finally {
      setUploadingImage(false);
    }
  }


  async function handleSubmitForm(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !slug.trim() || !productId || !mockupImageUrl.trim()) {
      setError("Please fill all required fields, including a mockup image.");
      return;
    }

    setSubmitting(true);
    setError("");
    setSuccess("");

    try {
      const payload = {
        name: name.trim(),
        slug: slug.trim().toLowerCase(),
        description: description.trim() || undefined,
        productId,
        categoryId: categoryId || undefined,
        mockupImageUrl: mockupImageUrl.trim(),
        backMockupImageUrl: backMockupImageUrl.trim() || undefined,
        displayPrice: displayPrice ? parseFloat(displayPrice) : undefined,
        minOrderQuantity: minOrderQuantity ? parseInt(minOrderQuantity, 10) : 10,
        sortOrder: parseInt(sortOrder, 10) || 0,
        isActive,
      };

      if (editingItem) {
        await api.put(`/admin/print-catalog/${editingItem._id}`, payload);
        setSuccess("Print catalog item updated successfully.");
      } else {
        await api.post("/admin/print-catalog", payload);
        setSuccess("Print catalog item created successfully.");
      }

      setIsModalOpen(false);
      loadData();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e.response?.data?.message || "Operation failed.");
    } finally {
      setSubmitting(false);
    }
  }


  return (
    <div className="space-y-6 p-6 max-w-7xl mx-auto">
      {/* Top Header & Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-outline-variant/20 pb-5">
        <div>
          <h1 className="text-2xl font-black text-on-surface">Custom Print Garment Catalog</h1>
          <p className="text-xs text-on-surface-variant mt-1">
            Configure printable apparel blanks, live mockup visuals, and volume rules.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/admin/print-pricing"
            className="rounded-xl border border-outline-variant/40 bg-surface-container-low px-4 py-2.5 text-xs font-bold text-on-surface hover:bg-surface-container transition-colors"
          >
            Volume Pricing & MOQ
          </Link>
          <button
            onClick={openCreateModal}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-on-primary hover:bg-primary/90 transition-colors shadow-sm"
          >
            <Plus className="h-4 w-4" />
            <span>New Printable Garment</span>
          </button>
        </div>
      </div>

      {/* Messages */}
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

      {/* Data Table */}
      {loading ? (
        <div className="py-16 text-center text-xs font-bold text-on-surface-variant animate-pulse">
          Loading catalog entries...
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-outline-variant/40 bg-surface-container-lowest p-12 text-center space-y-4">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-surface-container-low text-on-surface-variant">
            <Layers className="h-6 w-6" />
          </div>
          <p className="text-base font-bold text-on-surface">No print catalog garments created yet</p>
          <p className="text-xs text-on-surface-variant max-w-md mx-auto">
            Add customizable garments from your inventory so customers can upload their logo and request bulk printing runs.
          </p>
          <button
            onClick={openCreateModal}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-xs font-bold text-on-primary hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" /> Create First Garment
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-outline-variant/30 bg-surface-container-lowest shadow-xs">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-outline-variant/30 bg-surface-container-low/60 text-xs text-on-surface-variant uppercase font-bold tracking-wider">
              <tr>
                <th className="px-5 py-4">Mockup & Garment</th>
                <th className="px-5 py-4">Linked Product</th>
                <th className="px-5 py-4">MOQ</th>
                <th className="px-5 py-4">Starting Price</th>
                <th className="px-5 py-4">Status</th>
                <th className="px-5 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/20">
              {items.map((item) => {

                return (
                  <tr key={item._id} className="hover:bg-surface-container-low/40 transition-colors">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="relative h-14 w-12 shrink-0 overflow-hidden rounded-lg border border-outline-variant/30 bg-surface-container-low">
                          <img
                            src={item.mockupImageUrl}
                            alt={item.name}
                            className="h-full w-full object-cover"
                          />
                        </div>
                        <div>
                          <p className="font-bold text-on-surface">{item.name}</p>
                          <p className="text-xs text-on-surface-variant font-mono">/{item.slug}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <p className="font-medium text-on-surface">{item.productId?.name || "N/A"}</p>
                      <p className="text-xs text-on-surface-variant font-mono">
                        Base: ₹{item.productId?.basePrice || 0}
                      </p>
                    </td>
                    <td className="px-5 py-4 font-bold text-on-surface">
                      {item.minOrderQuantity || 10} Units
                    </td>
                    <td className="px-5 py-4 font-bold text-on-surface">
                      {item.displayPrice ? `₹${item.displayPrice}` : "Dynamic Tier"}
                    </td>
                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${
                          item.isActive
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-zinc-200 text-zinc-700"
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            item.isActive ? "bg-emerald-600" : "bg-zinc-500"
                          }`}
                        />
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
                          item.isActive
                            ? "bg-amber-100 text-amber-900 hover:bg-amber-200"
                            : "bg-emerald-600 text-white hover:bg-emerald-700"
                        }`}
                      >
                        {item.isActive ? "Deactivate" : "Activate"}
                      </button>
                      <button
                        onClick={() => handleDelete(item)}
                        className="rounded-lg p-1.5 text-error hover:bg-error/10 transition-colors"
                        title="Delete entry"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal / Editor */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-3xl bg-surface-container-lowest p-6 md:p-8 shadow-2xl space-y-6">
            <div className="flex items-center justify-between border-b border-outline-variant/20 pb-4">
              <h2 className="text-xl font-black text-on-surface">
                {editingItem ? "Edit Printable Garment" : "Create New Printable Garment"}
              </h2>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-on-surface-variant hover:text-on-surface font-bold text-lg"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmitForm} className="space-y-5 text-sm" noValidate>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold mb-1 text-on-surface">Garment Title *</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      if (!editingItem) {
                        setSlug(
                          e.target.value
                            .toLowerCase()
                            .replace(/[^a-z0-9]+/g, "-")
                            .replace(/^-|-$/g, "")
                        );
                      }
                    }}
                    placeholder="E.g. Oversized Heavyweight Cotton Tee"
                    className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-low p-3 outline-none focus:border-primary"
                  />
                </div>

                <div>
                  <label className="block font-bold mb-1 text-on-surface">URL Slug *</label>
                  <input
                    type="text"
                    required
                    value={slug}
                    onChange={(e) => setSlug(e.target.value.toLowerCase())}
                    placeholder="oversized-heavyweight-tee"
                    className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-low p-3 font-mono outline-none focus:border-primary"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold mb-1 text-on-surface">Description</label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="240 GSM pre-shrunk combed cotton blank designed for high-density DTF graphics."
                  className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-low p-3 outline-none focus:border-primary"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold mb-1 text-on-surface">Linked Inventory Product *</label>
                  <select
                    required
                    value={productId}
                    onChange={(e) => setProductId(e.target.value)}
                    className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-low p-3 outline-none focus:border-primary"
                  >
                    <option value="">-- Choose Customizable Product --</option>
                    {products.map((p) => (
                      <option key={p._id} value={p._id}>
                        {p.name} (Base: ₹{p.basePrice})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold mb-1 text-on-surface">Custom Print Category</label>
                  <select
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                    className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-low p-3 outline-none focus:border-primary"
                  >
                    <option value="">-- Inherit from Product Category --</option>
                    {categories.map((c) => (
                      <option key={c._id} value={c._id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>


              {/* Mockup Upload & Visual Preview */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2 border-t border-outline-variant/20">
                <div className="space-y-3">
                  <label className="block font-bold text-on-surface">Product Mockup Image *</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingImage}
                      className="inline-flex items-center gap-2 rounded-xl border border-outline-variant bg-surface-container-low px-4 py-2.5 text-xs font-bold text-on-surface hover:bg-surface-container transition-colors"
                    >
                      <UploadCloud className="h-4 w-4" />
                      <span>{uploadingImage ? "Uploading..." : "Upload Image Asset"}</span>
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handleImageUpload}
                      className="hidden"
                    />
                  </div>
                  <div>
                    <span className="text-[11px] text-on-surface-variant block mb-1">
                      Or persist structured asset reference URL:
                    </span>
                    <input
                      type="text"
                      required
                      value={mockupImageUrl}
                      onChange={(e) => setMockupImageUrl(e.target.value)}
                      placeholder="https://res.cloudinary.com/..."
                      className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-low p-2.5 text-xs outline-none focus:border-primary font-mono"
                    />
                  </div>

                  <div className="pt-2">
                    <span className="text-[11px] text-on-surface-variant block mb-1">
                      Back Mockup Image URL (For Back View Preview):
                    </span>
                    <input
                      type="text"
                      value={backMockupImageUrl}
                      onChange={(e) => setBackMockupImageUrl(e.target.value)}
                      placeholder="/images/mockups/tshirt_back_black.png or https://..."
                      className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-low p-2.5 text-xs outline-none focus:border-primary font-mono"
                    />
                  </div>
                </div>

                {/* Live Preview Box with Printable Area Overlay */}
                <div>
                  <span className="block font-bold mb-1 text-on-surface text-xs">
                    Mockup Preview
                  </span>
                  <div className="relative aspect-[3/4] max-h-52 w-auto mx-auto overflow-hidden rounded-xl border border-outline-variant/30 bg-surface-container-low flex items-center justify-center">
                    {mockupImageUrl ? (
                      <img
                        src={mockupImageUrl}
                        alt="Garment Preview"
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <span className="text-xs text-on-surface-variant">
                        Upload mockup to preview garment
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Commercial Configuration */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-outline-variant/20">
                <div>
                  <label className="block font-bold mb-1 text-on-surface">Min Order Quantity (MOQ) *</label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={minOrderQuantity}
                    onChange={(e) => setMinOrderQuantity(e.target.value)}
                    placeholder="10"
                    className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-low p-3 outline-none focus:border-primary font-mono"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1 text-on-surface">Starting Price (₹)</label>
                  <input
                    type="number"
                    min={0}
                    value={displayPrice}
                    onChange={(e) => setDisplayPrice(e.target.value)}
                    placeholder="E.g. 799"
                    className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-low p-3 outline-none focus:border-primary font-mono"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1 text-on-surface">Sort Order</label>
                  <input
                    type="number"
                    value={sortOrder}
                    onChange={(e) => setSortOrder(e.target.value)}
                    className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-low p-3 outline-none focus:border-primary font-mono"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="h-4 w-4 rounded accent-primary"
                />
                <label htmlFor="isActive" className="font-bold text-xs cursor-pointer select-none">
                  Active & Visible in Custom Storefront Catalog
                </label>
              </div>

              {/* Form Buttons */}
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
                  {submitting
                    ? "Saving..."
                    : editingItem
                    ? "Update Garment Item"
                    : "Create Garment Item"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
