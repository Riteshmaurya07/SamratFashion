"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";

export default function AdminCategoriesPage() {
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const [isEditing, setIsEditing] = useState(false);
  const [currentCategory, setCurrentCategory] = useState<any>(null);
  const [formData, setFormData] = useState({ name: "", slug: "", status: "ACTIVE" });

  const fetchCategories = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/admin/categories");
      setCategories(res.data.data);
      setError("");
    } catch (err: any) {
      setError("Failed to fetch categories");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  // Auto-generate slug from name
  const handleNameChange = (name: string) => {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-");
    if (!isEditing || !currentCategory?.slug) {
      setFormData((f) => ({ ...f, name, slug }));
    } else {
      setFormData((f) => ({ ...f, name }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError("");
    try {
      if (isEditing) {
        await api.put(`/admin/categories/${currentCategory._id}`, formData);
      } else {
        await api.post("/admin/categories", formData);
      }
      setIsEditing(false);
      setCurrentCategory(null);
      setFormData({ name: "", slug: "", status: "ACTIVE" });
      await fetchCategories();
    } catch (err: any) {
      setFormError(err.response?.data?.message || "Failed to save category");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (category: any) => {
    setIsEditing(true);
    setCurrentCategory(category);
    setFormData({ name: category.name, slug: category.slug, status: category.status });
  };

  const handleReset = () => {
    setIsEditing(false);
    setCurrentCategory(null);
    setFormData({ name: "", slug: "", status: "ACTIVE" });
    setFormError("");
  };

  const toggleStatus = async (category: any) => {
    try {
      const newStatus = category.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
      await api.patch(`/admin/categories/${category._id}/status`, { status: newStatus });
      await fetchCategories();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to change status");
    }
  };

  const activeCount = categories.filter((c) => c.status === "ACTIVE").length;

  return (
    <div className="flex flex-col gap-element-gap md:gap-gutter">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-2">
        <div>
          <h1 className="font-headline-lg text-headline-lg text-on-background mb-1">Categories</h1>
          <p className="font-body-md text-body-md text-on-surface-variant max-w-2xl">
            Manage product categories and taxonomy.
          </p>
        </div>
        {isEditing && (
          <button
            onClick={handleReset}
            className="flex items-center gap-2 px-4 py-2 border border-outline-variant text-on-surface font-label-caps text-label-caps rounded-lg hover:bg-surface-container-high transition-colors self-start md:self-auto"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            New Category
          </button>
        )}
      </div>

      {error && (
        <div className="text-error bg-error-container/20 p-4 rounded-md font-body-sm flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">error_outline</span>
          {error}
        </div>
      )}

      {/* KPI Mini Row */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-surface border border-outline-variant/30 rounded-lg p-4 flex items-center justify-between">
          <span className="font-label-caps text-label-caps text-on-surface-variant">Total</span>
          <span className="font-headline-sm text-headline-sm text-on-surface">{categories.length}</span>
        </div>
        <div className="bg-surface border border-outline-variant/30 rounded-lg p-4 flex items-center justify-between border-l-4 border-l-primary">
          <span className="font-label-caps text-label-caps text-on-surface-variant">Active</span>
          <span className="font-headline-sm text-headline-sm text-primary">{activeCount}</span>
        </div>
        <div className="bg-surface border border-outline-variant/30 rounded-lg p-4 flex items-center justify-between">
          <span className="font-label-caps text-label-caps text-on-surface-variant">Inactive</span>
          <span className="font-headline-sm text-headline-sm text-on-surface">{categories.length - activeCount}</span>
        </div>
      </div>

      {/* Split Layout: Form + Table */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Form Column */}
        <div className="col-span-1 border border-outline-variant/20 rounded-xl p-6 bg-surface-container-lowest">
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-headline-sm text-headline-sm text-on-surface">
              {isEditing ? "Edit Category" : "Add Category"}
            </h2>
            {isEditing && (
              <button
                onClick={handleReset}
                className="p-1.5 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded transition-colors"
                title="Cancel edit"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            )}
          </div>

          {formError && (
            <div className="mb-4 p-3 text-sm bg-error-container/20 text-error border border-error/20 rounded-lg flex items-center gap-2">
              <span className="material-symbols-outlined text-[16px]">error_outline</span>
              {formError}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {/* Name */}
            <div className="flex flex-col gap-1.5">
              <label className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider">
                Name
              </label>
              <input
                required
                type="text"
                placeholder="e.g. T-Shirts"
                className="w-full px-4 py-2.5 bg-surface-container-low border border-outline-variant/30 rounded-lg focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary font-body-sm text-body-sm text-on-surface transition-all placeholder:text-outline"
                value={formData.name}
                onChange={(e) => handleNameChange(e.target.value)}
              />
            </div>

            {/* Slug */}
            <div className="flex flex-col gap-1.5">
              <label className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider">
                Slug
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 font-label-caps text-[11px] text-outline">/</span>
                <input
                  required
                  type="text"
                  placeholder="t-shirts"
                  className="w-full pl-6 pr-4 py-2.5 bg-surface-container-low border border-outline-variant/30 rounded-lg focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary font-label-caps text-label-caps text-on-surface transition-all placeholder:text-outline"
                  value={formData.slug}
                  onChange={(e) =>
                    setFormData({ ...formData, slug: e.target.value.toLowerCase().replace(/\s+/g, "-") })
                  }
                />
              </div>
            </div>

            {/* Status */}
            <div className="flex flex-col gap-1.5">
              <label className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider">
                Status
              </label>
              <select
                className="w-full px-4 py-2.5 bg-surface-container-low border border-outline-variant/30 rounded-lg focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary font-body-sm text-body-sm text-on-surface transition-all"
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value })}
              >
                <option value="ACTIVE">ACTIVE</option>
                <option value="INACTIVE">INACTIVE</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="mt-2 w-full flex items-center justify-center gap-2 py-3 bg-primary text-on-primary rounded-lg font-label-caps text-label-caps hover:opacity-90 transition-opacity disabled:opacity-60"
            >
              {saving ? (
                <>
                  <span className="material-symbols-outlined text-[18px] animate-spin">
                    progress_activity
                  </span>
                  Saving...
                </>
              ) : isEditing ? (
                <>
                  <span className="material-symbols-outlined text-[18px]">save</span>
                  Update Category
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[18px]">add</span>
                  Create Category
                </>
              )}
            </button>
          </form>
        </div>

        {/* Table Column */}
        <div className="col-span-1 lg:col-span-2 border border-outline-variant/20 rounded-xl bg-surface-container-lowest overflow-hidden">
          <div className="p-4 border-b border-outline-variant/20 bg-surface-container-lowest">
            <h3 className="font-headline-sm text-headline-sm text-on-surface">All Categories</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface-container-lowest border-b border-outline-variant/20">
                  <th className="py-3 px-4 font-label-caps text-label-caps text-outline font-medium tracking-wider whitespace-nowrap">
                    Name
                  </th>
                  <th className="py-3 px-4 font-label-caps text-label-caps text-outline font-medium tracking-wider whitespace-nowrap">
                    Slug
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
                    {[1, 2, 3, 4].map((i) => (
                      <tr key={i} className="border-b border-outline-variant/10">
                        {[1, 2, 3, 4].map((j) => (
                          <td key={j} className="py-3 px-4">
                            <div className="h-4 bg-surface-container-low rounded animate-pulse" />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </>
                ) : categories.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-12 px-4">
                      <div className="flex flex-col items-center gap-3 text-center">
                        <span className="material-symbols-outlined text-outline text-[48px]">category</span>
                        <p className="font-body-md text-body-md text-on-surface-variant">
                          No categories yet
                        </p>
                        <p className="font-body-sm text-body-sm text-outline">
                          Create your first category using the form
                        </p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  categories.map((c) => (
                    <tr
                      key={c._id}
                      className={`border-b border-outline-variant/10 hover:bg-surface-container-lowest/50 transition-colors group ${
                        isEditing && currentCategory?._id === c._id
                          ? "bg-primary-container/5 border-l-2 border-l-primary"
                          : ""
                      }`}
                    >
                      <td className="py-3 px-4 font-medium">{c.name}</td>
                      <td className="py-3 px-4 text-on-surface-variant font-label-caps text-[11px]">
                        /{c.slug}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-label-caps border ${
                            c.status === "ACTIVE"
                              ? "bg-primary-container/20 text-primary border-primary/20"
                              : "bg-surface-container-high text-on-surface border-outline-variant/30"
                          }`}
                        >
                          {c.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => handleEdit(c)}
                            className="p-1.5 text-outline hover:text-primary hover:bg-primary-container/10 rounded transition-colors"
                            title="Edit"
                          >
                            <span className="material-symbols-outlined text-[18px]">edit</span>
                          </button>
                          <button
                            onClick={() => toggleStatus(c)}
                            className={`p-1.5 rounded transition-colors ${
                              c.status === "ACTIVE"
                                ? "text-outline hover:text-error hover:bg-error-container/20"
                                : "text-outline hover:text-primary hover:bg-primary-container/10"
                            }`}
                            title={c.status === "ACTIVE" ? "Deactivate" : "Activate"}
                          >
                            <span className="material-symbols-outlined text-[18px]">
                              {c.status === "ACTIVE" ? "toggle_on" : "toggle_off"}
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
      </div>

      <div className="h-8" />
    </div>
  );
}
