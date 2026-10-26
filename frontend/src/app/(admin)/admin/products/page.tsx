"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useRouter } from "next/navigation";

const STATUS_OPTIONS = ["", "ACTIVE", "DRAFT", "ARCHIVED"];

export default function AdminProductsPage() {
  const router = useRouter();
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [statusOpen, setStatusOpen] = useState(false);
  const [actionSuccess, setActionSuccess] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

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
    } catch (err: any) {
      setError(err.response?.data?.message || "Failed to delete product");
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
      const params: any = { limit: 50 };
      if (debouncedSearch) params.search = debouncedSearch;
      if (statusFilter) params.status = statusFilter;
      const res = await api.get("/admin/products", { params });
      setProducts(res.data.data.items);
      setError("");
    } catch (err: any) {
      setError("Failed to fetch products");
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, statusFilter]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "ACTIVE": return "bg-primary-container/20 text-primary border border-primary/20";
      case "DRAFT": return "bg-surface-container-high text-on-surface border border-outline-variant/30";
      case "ARCHIVED": return "bg-error-container/20 text-error border border-error/20";
      default: return "bg-surface-container-high text-on-surface border border-outline-variant/30";
    }
  };

  const kpiCounts = {
    total: products.length,
    active: products.filter(p => p.status === "ACTIVE").length,
    draft: products.filter(p => p.status === "DRAFT").length,
    archived: products.filter(p => p.status === "ARCHIVED").length,
    outOfStock: products.filter(p =>
      p.variants?.every((v: any) => v.stock === 0)
    ).length,
  };

  return (
    <div className="flex flex-col gap-element-gap md:gap-gutter">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-2">
        <div>
          <h1 className="font-headline-lg text-headline-lg text-on-background mb-1">Products</h1>
          <p className="font-body-md text-body-md text-on-surface-variant max-w-2xl">
            Manage your SamratFashion product catalog, variants and availability.
          </p>
        </div>
        <Link
          href="/admin/products/new"
          className="flex items-center gap-2 px-5 py-3 bg-primary text-on-primary font-label-caps text-label-caps rounded-lg hover:opacity-90 transition-opacity self-start md:self-auto"
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
        {[
          { label: "Total Products", value: kpiCounts.total, color: "text-on-surface" },
          { label: "Active", value: kpiCounts.active, color: "text-primary" },
          { label: "Draft", value: kpiCounts.draft, color: "text-outline" },
          { label: "Out of Stock", value: kpiCounts.outOfStock, color: "text-error" },
          { label: "Archived", value: kpiCounts.archived, color: "text-secondary" },
        ].map(kpi => (
          <div
            key={kpi.label}
            className="bg-surface p-4 rounded border border-outline-variant/30 flex flex-col justify-between h-24 hover:scale-[1.02] transition-transform"
          >
            <span className="font-label-caps text-label-caps text-outline">{kpi.label}</span>
            <span className={`font-headline-lg text-headline-lg ${kpi.color}`}>
              {loading ? "—" : kpi.value}
            </span>
          </div>
        ))}
      </section>

      {/* Filter Toolbar */}
      <div className="flex flex-col md:flex-row gap-3 items-start md:items-center justify-between bg-surface-container-lowest p-4 rounded-t-xl border border-outline-variant/20 border-b-0">
        <div className="w-full md:w-auto flex-1 max-w-md relative">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-[18px]">search</span>
          <input
            className="w-full pl-10 pr-4 py-2.5 bg-surface-container-low border border-outline-variant/30 rounded-lg focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary font-body-sm text-body-sm text-on-surface transition-all placeholder:text-outline"
            placeholder="Search products by name, slug, or SKU..."
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="w-full md:w-auto flex flex-wrap gap-2 items-center">
          {/* Status Filter */}
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
                {STATUS_OPTIONS.map(s => (
                  <button
                    key={s}
                    className={`w-full text-left px-4 py-2 font-label-caps text-label-caps hover:bg-surface-container-high transition-colors ${statusFilter === s ? "text-primary bg-primary-container/10" : "text-on-surface"}`}
                    onClick={() => { setStatusFilter(s); setStatusOpen(false); }}
                  >
                    {s || "All"}
                  </button>
                ))}
              </div>
            )}
          </div>

          {(search || statusFilter) && (
            <button
              onClick={() => { setSearch(""); setStatusFilter(""); }}
              className="p-2 border border-outline-variant/30 rounded-lg text-on-surface-variant hover:bg-surface-container-high transition-colors"
              title="Clear filters"
            >
              <span className="material-symbols-outlined text-[18px]">filter_list_off</span>
            </button>
          )}
        </div>
      </div>

      {/* Data Table */}
      <div className="bg-surface-container-lowest border border-outline-variant/20 rounded-b-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container-lowest border-b border-outline-variant/20">
                <th className="py-3 px-4 font-label-caps text-label-caps text-outline font-medium tracking-wider whitespace-nowrap">Product</th>
                <th className="py-3 px-4 font-label-caps text-label-caps text-outline font-medium tracking-wider whitespace-nowrap">Category</th>
                <th className="py-3 px-4 font-label-caps text-label-caps text-outline font-medium tracking-wider whitespace-nowrap text-right">Price</th>
                <th className="py-3 px-4 font-label-caps text-label-caps text-outline font-medium tracking-wider whitespace-nowrap text-center">Status</th>
                <th className="py-3 px-4 font-label-caps text-label-caps text-outline font-medium tracking-wider whitespace-nowrap text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="font-body-sm text-body-sm text-on-surface">
              {loading ? (
                <>
                  {[1, 2, 3, 4, 5].map(i => (
                    <tr key={i} className="border-b border-outline-variant/10">
                      {[1, 2, 3, 4, 5].map(j => (
                        <td key={j} className="py-3 px-4">
                          <div className="h-4 bg-surface-container-low rounded animate-pulse" />
                        </td>
                      ))}
                    </tr>
                  ))}
                </>
              ) : products.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-16 px-4">
                    <div className="flex flex-col items-center gap-3 text-center">
                      <span className="material-symbols-outlined text-outline text-[48px]">inventory_2</span>
                      <p className="font-body-md text-body-md text-on-surface-variant">No products found</p>
                      <Link href="/admin/products/new" className="font-label-caps text-label-caps text-primary hover:underline">
                        Add your first product
                      </Link>
                    </div>
                  </td>
                </tr>
              ) : (
                products.map((p) => (
                  <tr
                    key={p._id}
                    className="border-b border-outline-variant/10 hover:bg-surface-container-lowest/50 transition-colors group cursor-pointer"
                    onClick={() => router.push(`/admin/products/${p._id}/edit`)}
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        {p.images?.[0] ? (
                          <div className="w-10 h-10 bg-surface-container-high rounded overflow-hidden flex-shrink-0">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={p.images[0]} alt={p.name} className="w-full h-full object-cover" />
                          </div>
                        ) : (
                          <div className="w-10 h-10 bg-surface-container-high rounded flex items-center justify-center flex-shrink-0 text-outline">
                            <span className="material-symbols-outlined text-[20px]">image</span>
                          </div>
                        )}
                        <div>
                          <div className="font-medium">{p.name}</div>
                          <div className="text-xs text-on-surface-variant font-label-caps">{p.slug}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-on-surface-variant">{p.categoryId?.name || "—"}</td>
                    <td className="py-3 px-4 text-right font-label-caps text-label-caps font-bold">
                      ₹{p.basePrice?.toLocaleString("en-IN")}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-label-caps ${getStatusColor(p.status)}`}>
                        {p.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Link
                          href={`/admin/products/${p._id}/edit`}
                          className="inline-block p-1.5 text-outline hover:text-primary hover:bg-primary-container/10 rounded transition-colors"
                          title="Edit"
                        >
                          <span className="material-symbols-outlined text-[18px]">edit</span>
                        </Link>
                        <Link
                          href={`/admin/products/${p._id}/inventory`}
                          className="inline-block p-1.5 text-outline hover:text-primary hover:bg-primary-container/10 rounded transition-colors"
                          title="Inventory"
                        >
                          <span className="material-symbols-outlined text-[18px]">warehouse</span>
                        </Link>
                        <button
                          type="button"
                          onClick={() => handleDeleteProduct(p._id, p.name)}
                          disabled={deletingId === p._id}
                          className="inline-block p-1.5 text-outline hover:text-error hover:bg-error-container/10 rounded transition-colors disabled:opacity-50"
                          title="Delete Product and Cloudinary Assets"
                        >
                          <span className="material-symbols-outlined text-[18px]">
                            {deletingId === p._id ? "hourglass_empty" : "delete"}
                          </span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="h-8" />
    </div>
  );
}
