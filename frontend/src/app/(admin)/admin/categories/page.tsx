"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import Image from "next/image";

export default function AdminCategoriesPage() {
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const [isEditing, setIsEditing] = useState(false);
  const [currentCategory, setCurrentCategory] = useState<any>(null);
  const [formData, setFormData] = useState({
    name: "",
    slug: "",
    description: "",
    image: "",
    parentCategory: "",
    displayOrder: 0,
    status: "ACTIVE",
  });

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
      const payload: any = {
        ...formData,
        parentCategory: formData.parentCategory || null,
        displayOrder: Number(formData.displayOrder || 0),
      };

      if (isEditing) {
        await api.put(`/admin/categories/${currentCategory._id}`, payload);
      } else {
        await api.post("/admin/categories", payload);
      }
      setIsEditing(false);
      setCurrentCategory(null);
      setFormData({ name: "", slug: "", description: "", image: "", parentCategory: "", displayOrder: 0, status: "ACTIVE" });
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
    setFormData({
      name: category.name,
      slug: category.slug,
      description: category.description || "",
      image: category.image || "",
      parentCategory: category.parentCategory ? (category.parentCategory._id || category.parentCategory) : "",
      displayOrder: category.displayOrder || 0,
      status: category.status,
    });
  };

  const handleReset = () => {
    setIsEditing(false);
    setCurrentCategory(null);
    setFormData({ name: "", slug: "", description: "", image: "", parentCategory: "", displayOrder: 0, status: "ACTIVE" });
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
            Manage product categories, parent-child taxonomy, thumbnails, and active products.
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

      {/* KPI Summary Row */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-surface border border-outline-variant/30 rounded-lg p-4 flex items-center justify-between">
          <span className="font-label-caps text-label-caps text-on-surface-variant">Total Categories</span>
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
        <div className="col-span-1 border border-outline-variant/20 rounded-xl p-6 bg-surface-container-lowest h-fit">
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
              <label className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider">Name *</label>
              <input
                required
                type="text"
                placeholder="e.g. T-Shirts"
                className="w-full px-4 py-2.5 bg-surface-container-low border border-outline-variant/30 rounded-lg focus:outline-none focus:border-primary font-body-sm text-on-surface"
                value={formData.name}
                onChange={(e) => handleNameChange(e.target.value)}
              />
            </div>

            {/* Slug */}
            <div className="flex flex-col gap-1.5">
              <label className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider">Slug *</label>
              <input
                required
                type="text"
                placeholder="t-shirts"
                className="w-full px-4 py-2.5 bg-surface-container-low border border-outline-variant/30 rounded-lg focus:outline-none focus:border-primary font-mono text-sm text-on-surface"
                value={formData.slug}
                onChange={(e) => setFormData({ ...formData, slug: e.target.value.toLowerCase().replace(/\s+/g, "-") })}
              />
            </div>

            {/* Parent Category */}
            <div className="flex flex-col gap-1.5">
              <label className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider">Parent Category</label>
              <select
                className="w-full px-4 py-2.5 bg-surface-container-low border border-outline-variant/30 rounded-lg focus:outline-none focus:border-primary font-body-sm text-on-surface"
                value={formData.parentCategory}
                onChange={(e) => setFormData({ ...formData, parentCategory: e.target.value })}
              >
                <option value="">None (Top Level Category)</option>
                {categories
                  .filter((c) => !isEditing || c._id !== currentCategory?._id)
                  .map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </div>

            {/* Image URL */}
            <div className="flex flex-col gap-1.5">
              <label className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider">Category Image URL</label>
              <input
                type="text"
                placeholder="https://example.com/image.jpg"
                className="w-full px-4 py-2.5 bg-surface-container-low border border-outline-variant/30 rounded-lg focus:outline-none focus:border-primary font-body-sm text-on-surface"
                value={formData.image}
                onChange={(e) => setFormData({ ...formData, image: e.target.value })}
              />
            </div>

            {/* Display Order & Status */}
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider">Display Order</label>
                <input
                  type="number"
                  min="0"
                  className="w-full px-4 py-2.5 bg-surface-container-low border border-outline-variant/30 rounded-lg focus:outline-none focus:border-primary font-body-sm text-on-surface"
                  value={formData.displayOrder}
                  onChange={(e) => setFormData({ ...formData, displayOrder: Number(e.target.value) })}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider">Status</label>
                <select
                  className="w-full px-4 py-2.5 bg-surface-container-low border border-outline-variant/30 rounded-lg focus:outline-none focus:border-primary font-body-sm text-on-surface"
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                >
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="INACTIVE">INACTIVE</option>
                </select>
              </div>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="mt-2 w-full flex items-center justify-center gap-2 py-3 bg-primary text-on-primary rounded-lg font-label-caps text-label-caps hover:opacity-90 transition-opacity disabled:opacity-60"
            >
              {saving ? "Saving..." : isEditing ? "Update Category" : "Create Category"}
            </button>
          </form>
        </div>

        {/* Table Column */}
        <div className="col-span-1 lg:col-span-2 border border-outline-variant/20 rounded-xl bg-surface-container-lowest overflow-hidden shadow-sm">
          <div className="p-4 border-b border-outline-variant/20 bg-surface-container-lowest">
            <h3 className="font-headline-sm text-headline-sm text-on-surface">Category Taxonomy</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface-container-low border-b border-outline-variant/50">
                  <th className="p-4 font-label-caps text-label-caps text-on-surface-variant font-medium">Image</th>
                  <th className="p-4 font-label-caps text-label-caps text-on-surface-variant font-medium">Category / Tree</th>
                  <th className="p-4 font-label-caps text-label-caps text-on-surface-variant font-medium">Products</th>
                  <th className="p-4 font-label-caps text-label-caps text-on-surface-variant font-medium">Order</th>
                  <th className="p-4 font-label-caps text-label-caps text-on-surface-variant font-medium">Status</th>
                  <th className="p-4 font-label-caps text-label-caps text-on-surface-variant font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/30">
                {loading ? (
                  <tr><td colSpan={6} className="p-8 text-center text-on-surface-variant">Loading categories...</td></tr>
                ) : categories.length === 0 ? (
                  <tr><td colSpan={6} className="p-8 text-center text-on-surface-variant">No categories found</td></tr>
                ) : (
                  categories.map((c) => {
                    const isChild = !!c.parentCategory;
                    const parentName = c.parentCategory ? (c.parentCategory.name || "Parent") : null;

                    return (
                      <tr key={c._id} className="hover:bg-surface-container-low/50 transition-colors">
                        <td className="p-4 w-16">
                          <div className="w-10 h-10 rounded bg-surface-container overflow-hidden relative border border-outline-variant/30">
                            {c.image ? (
                              <Image src={c.image} alt={c.name} fill className="object-cover" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-outline">
                                <span className="material-symbols-outlined text-[20px]">category</span>
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="p-4">
                          <div className="flex flex-col">
                            <span className={`font-body-sm font-semibold text-on-surface flex items-center gap-1.5 ${isChild ? 'pl-4 border-l-2 border-primary/40' : ''}`}>
                              {isChild && <span className="text-primary font-mono text-xs">↳</span>}
                              {c.name}
                            </span>
                            <span className="font-mono text-xs text-on-surface-variant/70">/{c.slug} {parentName && `(Parent: ${parentName})`}</span>
                          </div>
                        </td>
                        <td className="p-4 font-body-sm font-bold text-on-surface">
                          {c.productCount || 0} active
                        </td>
                        <td className="p-4 font-body-sm text-on-surface-variant">
                          {c.displayOrder || 0}
                        </td>
                        <td className="p-4">
                          <span className={`px-2.5 py-1 rounded-full font-label-caps text-[10px] ${c.status === 'ACTIVE' ? 'bg-primary-fixed text-on-primary-fixed-variant' : 'bg-surface-container-high text-on-surface-variant'}`}>
                            {c.status}
                          </span>
                        </td>
                        <td className="p-4 text-right">
                          <div className="flex justify-end gap-2">
                            <button onClick={() => toggleStatus(c)} className="px-2.5 py-1 text-xs font-label-caps border border-outline-variant rounded hover:bg-surface-container-high">
                              {c.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                            </button>
                            <button onClick={() => handleEdit(c)} className="p-1 text-on-surface-variant hover:text-primary">
                              <span className="material-symbols-outlined text-[20px]">edit</span>
                            </button>
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
    </div>
  );
}
