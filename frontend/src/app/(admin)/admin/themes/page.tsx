"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import Image from "next/image";

export default function AdminThemesPage() {
  const [themes, setThemes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const [isEditing, setIsEditing] = useState(false);
  const [currentTheme, setCurrentTheme] = useState<any>(null);
  const [formData, setFormData] = useState({
    name: "",
    slug: "",
    description: "",
    heroImage: "",
    thumbnail: "",
    displayOrder: 0,
    isFeatured: false,
    status: "ACTIVE",
  });

  const fetchThemes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/admin/themes");
      setThemes(res.data.data || []);
      setError("");
    } catch (err: any) {
      setError("Failed to fetch themes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchThemes();
  }, [fetchThemes]);

  const handleNameChange = (name: string) => {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-");
    if (!isEditing) {
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
      const payload = {
        ...formData,
        displayOrder: Number(formData.displayOrder || 0),
      };

      if (isEditing) {
        await api.put(`/admin/themes/${currentTheme._id}`, payload);
      } else {
        await api.post("/admin/themes", payload);
      }
      setIsEditing(false);
      setCurrentTheme(null);
      setFormData({
        name: "",
        slug: "",
        description: "",
        heroImage: "",
        thumbnail: "",
        displayOrder: 0,
        isFeatured: false,
        status: "ACTIVE",
      });
      await fetchThemes();
    } catch (err: any) {
      setFormError(err.response?.data?.message || "Failed to save theme");
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (theme: any) => {
    setIsEditing(true);
    setCurrentTheme(theme);
    setFormData({
      name: theme.name,
      slug: theme.slug,
      description: theme.description || "",
      heroImage: theme.heroImage || "",
      thumbnail: theme.thumbnail || "",
      displayOrder: theme.displayOrder || 0,
      isFeatured: !!theme.isFeatured,
      status: theme.status,
    });
  };

  const handleReset = () => {
    setIsEditing(false);
    setCurrentTheme(null);
    setFormData({
      name: "",
      slug: "",
      description: "",
      heroImage: "",
      thumbnail: "",
      displayOrder: 0,
      isFeatured: false,
      status: "ACTIVE",
    });
    setFormError("");
  };

  const toggleStatus = async (theme: any) => {
    try {
      const newStatus = theme.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
      await api.patch(`/admin/themes/${theme._id}/status`, { status: newStatus });
      await fetchThemes();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to change status");
    }
  };

  const activeCount = themes.filter((t) => t.status === "ACTIVE").length;
  const featuredCount = themes.filter((t) => t.isFeatured).length;

  return (
    <div className="flex flex-col gap-element-gap md:gap-gutter">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-2">
        <div>
          <h1 className="font-headline-lg text-headline-lg text-on-background mb-1">Themes & Drops</h1>
          <p className="font-body-md text-body-md text-on-surface-variant max-w-2xl">
            Manage streetwear collection themes, hero imagery, seasonal drops, and storefront display order.
          </p>
        </div>
        {isEditing && (
          <button
            onClick={handleReset}
            className="flex items-center gap-2 px-4 py-2 border border-outline-variant text-on-surface font-label-caps text-label-caps rounded-lg hover:bg-surface-container-high transition-colors self-start md:self-auto"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            New Theme
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
          <span className="font-label-caps text-label-caps text-on-surface-variant">Total Themes</span>
          <span className="font-headline-sm text-headline-sm text-on-surface">{themes.length}</span>
        </div>
        <div className="bg-surface border border-outline-variant/30 rounded-lg p-4 flex items-center justify-between border-l-4 border-l-primary">
          <span className="font-label-caps text-label-caps text-on-surface-variant">Active</span>
          <span className="font-headline-sm text-headline-sm text-primary">{activeCount}</span>
        </div>
        <div className="bg-surface border border-outline-variant/30 rounded-lg p-4 flex items-center justify-between">
          <span className="font-label-caps text-label-caps text-on-surface-variant">Featured</span>
          <span className="font-headline-sm text-headline-sm text-on-surface">{featuredCount}</span>
        </div>
      </div>

      {/* Split Layout: Form + Grid/Table */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Form Column */}
        <div className="col-span-1 border border-outline-variant/20 rounded-xl p-6 bg-surface-container-lowest h-fit">
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-headline-sm text-headline-sm text-on-surface">
              {isEditing ? "Edit Theme" : "Add Theme"}
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
              <label className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider">Theme Name *</label>
              <input
                required
                type="text"
                placeholder="e.g. Cyberpunk Drop 2026"
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
                placeholder="cyberpunk-drop-2026"
                className="w-full px-4 py-2.5 bg-surface-container-low border border-outline-variant/30 rounded-lg focus:outline-none focus:border-primary font-mono text-sm text-on-surface"
                value={formData.slug}
                onChange={(e) => setFormData({ ...formData, slug: e.target.value.toLowerCase().replace(/\s+/g, "-") })}
              />
            </div>

            {/* Description */}
            <div className="flex flex-col gap-1.5">
              <label className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider">Description</label>
              <textarea
                rows={2}
                placeholder="Theme description or tagline..."
                className="w-full px-4 py-2.5 bg-surface-container-low border border-outline-variant/30 rounded-lg focus:outline-none focus:border-primary font-body-sm text-on-surface"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>

            {/* Hero Image & Thumbnail URL */}
            <div className="flex flex-col gap-1.5">
              <label className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider">Hero Banner Image URL</label>
              <input
                type="text"
                placeholder="https://example.com/hero.jpg"
                className="w-full px-4 py-2.5 bg-surface-container-low border border-outline-variant/30 rounded-lg focus:outline-none focus:border-primary font-body-sm text-on-surface"
                value={formData.heroImage}
                onChange={(e) => setFormData({ ...formData, heroImage: e.target.value })}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider">Thumbnail Card Image URL</label>
              <input
                type="text"
                placeholder="https://example.com/thumb.jpg"
                className="w-full px-4 py-2.5 bg-surface-container-low border border-outline-variant/30 rounded-lg focus:outline-none focus:border-primary font-body-sm text-on-surface"
                value={formData.thumbnail}
                onChange={(e) => setFormData({ ...formData, thumbnail: e.target.value })}
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

            {/* Featured Checkbox */}
            <div className="flex items-center gap-2 pt-2">
              <input
                type="checkbox"
                id="isFeatured"
                checked={formData.isFeatured}
                onChange={(e) => setFormData({ ...formData, isFeatured: e.target.checked })}
                className="rounded border-outline-variant text-primary focus:ring-primary cursor-pointer"
              />
              <label htmlFor="isFeatured" className="font-label-caps text-xs font-bold text-on-surface cursor-pointer">
                Feature on Homepage
              </label>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="mt-2 w-full flex items-center justify-center gap-2 py-3 bg-primary text-on-primary rounded-lg font-label-caps text-label-caps hover:opacity-90 transition-opacity disabled:opacity-60"
            >
              {saving ? "Saving..." : isEditing ? "Update Theme" : "Create Theme"}
            </button>
          </form>
        </div>

        {/* Themes List Column */}
        <div className="col-span-1 lg:col-span-2 border border-outline-variant/20 rounded-xl bg-surface-container-lowest overflow-hidden shadow-sm">
          <div className="p-4 border-b border-outline-variant/20 bg-surface-container-lowest">
            <h3 className="font-headline-sm text-headline-sm text-on-surface">Active & Archive Themes</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface-container-low border-b border-outline-variant/50">
                  <th className="p-4 font-label-caps text-label-caps text-on-surface-variant font-medium">Preview</th>
                  <th className="p-4 font-label-caps text-label-caps text-on-surface-variant font-medium">Theme</th>
                  <th className="p-4 font-label-caps text-label-caps text-on-surface-variant font-medium">Order</th>
                  <th className="p-4 font-label-caps text-label-caps text-on-surface-variant font-medium">Featured</th>
                  <th className="p-4 font-label-caps text-label-caps text-on-surface-variant font-medium">Status</th>
                  <th className="p-4 font-label-caps text-label-caps text-on-surface-variant font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/30">
                {loading ? (
                  <tr><td colSpan={6} className="p-8 text-center text-on-surface-variant">Loading themes...</td></tr>
                ) : themes.length === 0 ? (
                  <tr><td colSpan={6} className="p-8 text-center text-on-surface-variant">No themes found</td></tr>
                ) : (
                  themes.map((t) => (
                    <tr key={t._id} className="hover:bg-surface-container-low/50 transition-colors">
                      <td className="p-4 w-20">
                        <div className="w-14 h-10 rounded bg-surface-container overflow-hidden relative border border-outline-variant/30">
                          {t.thumbnail || t.heroImage ? (
                            <Image src={t.thumbnail || t.heroImage} alt={t.name} fill className="object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-outline">
                              <span className="material-symbols-outlined text-[20px]">palette</span>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="flex flex-col">
                          <span className="font-body-sm font-semibold text-on-surface">{t.name}</span>
                          <span className="font-mono text-xs text-on-surface-variant/70">/{t.slug}</span>
                        </div>
                      </td>
                      <td className="p-4 font-body-sm text-on-surface-variant">{t.displayOrder || 0}</td>
                      <td className="p-4 font-body-sm">
                        {t.isFeatured ? (
                          <span className="text-primary font-bold flex items-center gap-1"><span className="material-symbols-outlined text-[16px]">star</span> Yes</span>
                        ) : (
                          <span className="text-on-surface-variant/50">No</span>
                        )}
                      </td>
                      <td className="p-4">
                        <span className={`px-2.5 py-1 rounded-full font-label-caps text-[10px] ${t.status === 'ACTIVE' ? 'bg-primary-fixed text-on-primary-fixed-variant' : 'bg-surface-container-high text-on-surface-variant'}`}>
                          {t.status}
                        </span>
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex justify-end gap-2">
                          <button onClick={() => toggleStatus(t)} className="px-2.5 py-1 text-xs font-label-caps border border-outline-variant rounded hover:bg-surface-container-high">
                            {t.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                          </button>
                          <button onClick={() => handleEdit(t)} className="p-1 text-on-surface-variant hover:text-primary">
                            <span className="material-symbols-outlined text-[20px]">edit</span>
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
    </div>
  );
}
