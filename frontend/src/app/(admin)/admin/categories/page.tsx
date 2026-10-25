"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Image from "next/image";
import { api } from "@/lib/api";
import {
  Plus,
  Search,
  X,
  Edit2,
  Trash2,
  AlertCircle,
  CheckCircle2,
  FolderTree,
  RotateCcw,
  Eye,
  EyeOff,
  CornerDownRight,
  Loader2,
} from "lucide-react";

interface CategoryParentRef {
  _id: string;
  name: string;
  slug: string;
  status?: string;
}

interface CategoryItem {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  image?: string;
  parentCategory?: string | CategoryParentRef | null;
  displayOrder: number;
  status: "ACTIVE" | "INACTIVE";
  productCount?: number;
  createdAt?: string;
  updatedAt?: string;
}
function extractErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "response" in err) {
    const res = err.response;
    if (res && typeof res === "object" && "data" in res) {
      const data = res.data;
      if (data && typeof data === "object" && "message" in data && typeof data.message === "string") {
        return data.message;
      }
    }
  }
  if (err instanceof Error) {
    return err.message;
  }
  return fallback;
}

function CategoryThumbnail({ src, alt }: { src?: string; alt: string }) {
  const [hasError, setHasError] = useState(false);
  const isValidUrl = Boolean(
    src && (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("/"))
  );

  if (!isValidUrl || hasError) {
    return (
      <div className="w-10 h-10 rounded-lg bg-surface-container-high border border-outline-variant/40 flex items-center justify-center text-on-surface-variant font-mono font-bold text-xs uppercase select-none shrink-0 shadow-2xs">
        {alt ? alt.slice(0, 2) : "CA"}
      </div>
    );
  }

  return (
    <div className="w-10 h-10 rounded-lg bg-surface-container overflow-hidden relative border border-outline-variant/30 shrink-0 shadow-2xs">
      <Image
        src={src!}
        alt={alt}
        fill
        sizes="40px"
        className="object-cover"
        onError={() => setHasError(true)}
      />
    </div>
  );
}

export default function AdminCategoriesPage() {
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [bannerFeedback, setBannerFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "INACTIVE">("ALL");

  // Drawer / Form state
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CategoryItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // Form Fields
  const [formData, setFormData] = useState({
    name: "",
    slug: "",
    description: "",
    image: "",
    parentCategory: "",
    displayOrder: 0,
    status: "ACTIVE" as "ACTIVE" | "INACTIVE",
  });

  // Delete Confirmation State
  const [categoryToDelete, setCategoryToDelete] = useState<CategoryItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  // Status Toggling State
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const fetchCategories = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/admin/categories");
      if (res.data?.success && Array.isArray(res.data.data)) {
        setCategories(res.data.data);
      }
      setError("");
    } catch {
      setError("Failed to fetch product categories. Please check server connectivity.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  const handleCloseDrawer = useCallback(() => {
    setIsDrawerOpen(false);
    setEditingCategory(null);
    setFormError("");
  }, []);

  // Close modals on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (categoryToDelete) setCategoryToDelete(null);
        else if (isDrawerOpen) handleCloseDrawer();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDrawerOpen, categoryToDelete, handleCloseDrawer]);

  // Auto-generate slug from name on create
  const handleNameChange = (name: string) => {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-");

    if (!editingCategory) {
      setFormData((prev) => ({ ...prev, name, slug }));
    } else {
      setFormData((prev) => ({ ...prev, name }));
    }
  };

  const handleOpenCreate = () => {
    setEditingCategory(null);
    setFormData({
      name: "",
      slug: "",
      description: "",
      image: "",
      parentCategory: "",
      displayOrder: categories.length + 1,
      status: "ACTIVE",
    });
    setFormError("");
    setIsDrawerOpen(true);
  };

  const handleOpenEdit = (category: CategoryItem) => {
    setEditingCategory(category);
    const parentId = category.parentCategory
      ? typeof category.parentCategory === "object"
        ? category.parentCategory._id
        : category.parentCategory
      : "";

    setFormData({
      name: category.name,
      slug: category.slug,
      description: category.description || "",
      image: category.image || "",
      parentCategory: parentId || "",
      displayOrder: category.displayOrder || 0,
      status: category.status,
    });
    setFormError("");
    setIsDrawerOpen(true);
  };


  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError("");
    try {
      const payload = {
        name: formData.name.trim(),
        slug: formData.slug.trim(),
        description: formData.description.trim() || undefined,
        image: formData.image.trim() || undefined,
        parentCategory: formData.parentCategory || null,
        displayOrder: Number(formData.displayOrder || 0),
        status: formData.status,
      };

      if (editingCategory) {
        await api.put(`/admin/categories/${editingCategory._id}`, payload);
        setBannerFeedback({ type: "success", text: `Category "${payload.name}" updated successfully.` });
      } else {
        await api.post("/admin/categories", payload);
        setBannerFeedback({ type: "success", text: `Category "${payload.name}" created successfully.` });
      }

      handleCloseDrawer();
      await fetchCategories();
      setTimeout(() => setBannerFeedback(null), 5000);
    } catch (err: unknown) {
      setFormError(extractErrorMessage(err, "Failed to save category"));
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (cat: CategoryItem) => {
    setTogglingId(cat._id);
    const nextStatus = cat.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
    try {
      await api.patch(`/admin/categories/${cat._id}/status`, { status: nextStatus });
      setBannerFeedback({
        type: "success",
        text: `Category "${cat.name}" is now ${nextStatus.toLowerCase()}.`,
      });
      await fetchCategories();
      setTimeout(() => setBannerFeedback(null), 4000);
    } catch (err: unknown) {
      setBannerFeedback({ type: "error", text: extractErrorMessage(err, "Failed to update category status") });
    } finally {
      setTogglingId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!categoryToDelete) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await api.delete(`/admin/categories/${categoryToDelete._id}`);
      setBannerFeedback({
        type: "success",
        text: `Category "${categoryToDelete.name}" was deleted successfully.`,
      });
      setCategoryToDelete(null);
      await fetchCategories();
      setTimeout(() => setBannerFeedback(null), 5000);
    } catch (err: unknown) {
      setDeleteError(extractErrorMessage(err, "Failed to delete category"));
    } finally {
      setDeleting(false);
    }
  };

  // Hierarchy rules for Parent selector
  const hasSubcategories = useMemo(() => {
    if (!editingCategory) return false;
    return categories.some((c) => {
      const pId = c.parentCategory
        ? typeof c.parentCategory === "object"
          ? c.parentCategory._id
          : c.parentCategory
        : null;
      return pId === editingCategory._id;
    });
  }, [editingCategory, categories]);

  const validParentOptions = useMemo(() => {
    return categories.filter((c) => {
      // Must be a root category itself (cannot nest beyond 2 levels)
      if (c.parentCategory) return false;
      // Cannot be itself
      if (editingCategory && c._id === editingCategory._id) return false;
      return true;
    });
  }, [categories, editingCategory]);

  // Hierarchical display ordering & filtering
  const displayItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    // If searching, show matching items directly
    if (query || statusFilter !== "ALL") {
      return categories.filter((c) => {
        const matchesQuery =
          !query || c.name.toLowerCase().includes(query) || c.slug.toLowerCase().includes(query);
        const matchesStatus = statusFilter === "ALL" || c.status === statusFilter;
        return matchesQuery && matchesStatus;
      });
    }

    // Default hierarchical view: Root categories with children indented below them
    const roots = categories
      .filter((c) => !c.parentCategory)
      .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));

    const childrenMap = new Map<string, CategoryItem[]>();
    for (const c of categories) {
      if (c.parentCategory) {
        const pId = typeof c.parentCategory === "object" ? c.parentCategory._id : c.parentCategory;
        if (pId) {
          const list = childrenMap.get(pId) || [];
          list.push(c);
          childrenMap.set(pId, list);
        }
      }
    }

    const ordered: CategoryItem[] = [];
    for (const root of roots) {
      ordered.push(root);
      const children = childrenMap.get(root._id) || [];
      children.sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
      for (const child of children) {
        ordered.push(child);
      }
    }

    // Include any orphaned categories if present
    for (const c of categories) {
      if (!ordered.some((item) => item._id === c._id)) {
        ordered.push(c);
      }
    }

    return ordered;
  }, [categories, searchQuery, statusFilter]);

  const totalCount = categories.length;
  const activeCount = categories.filter((c) => c.status === "ACTIVE").length;
  const inactiveCount = totalCount - activeCount;

  return (
    <div className="space-y-6">
      {/* ─── 1. Page Header ────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-outline-variant/30 pb-5">
        <div>
          <h1 className="font-headline-lg text-2xl sm:text-3xl font-black text-on-surface uppercase tracking-tight">
            Categories
          </h1>
          <p className="font-body-sm text-xs text-on-surface-variant mt-1">
            Manage product taxonomy, two-level category trees, thumbnails, and active products.
          </p>
        </div>
        <button
          type="button"
          onClick={handleOpenCreate}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary text-white font-mono text-xs uppercase font-bold tracking-wider rounded-lg hover:bg-primary/90 transition-transform active:scale-95 shrink-0 shadow-xs cursor-pointer touch-target-base justify-center"
        >
          <Plus className="w-4 h-4" />
          <span>Add Category</span>
        </button>
      </div>

      {/* Global Feedback Banner */}
      {bannerFeedback && (
        <div
          role="status"
          aria-live="polite"
          className={`p-3.5 rounded-xl border text-xs font-mono flex items-center justify-between gap-3 animate-in fade-in duration-200 ${
            bannerFeedback.type === "success"
              ? "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800"
              : "bg-red-50 text-red-800 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800"
          }`}
        >
          <div className="flex items-center gap-2">
            {bannerFeedback.type === "success" ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
            )}
            <span>{bannerFeedback.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setBannerFeedback(null)}
            className="p-1 hover:opacity-75 cursor-pointer"
            aria-label="Dismiss notification"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-50 text-red-600 border border-red-200 rounded-xl text-xs font-mono flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ─── 2. Summary KPI Cards (with loading skeletons) ─────────────── */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Total Categories */}
        <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-5 shadow-xs flex flex-col justify-between h-28">
          <span className="font-mono text-[11px] uppercase tracking-wider text-on-surface-variant font-bold">
            Total Categories
          </span>
          {loading ? (
            <div className="h-8 w-20 bg-surface-container animate-pulse rounded-md" />
          ) : (
            <div className="flex items-baseline justify-between">
              <span className="font-price-lg text-2xl sm:text-3xl font-black text-on-surface">
                {totalCount}
              </span>
              <span className="font-mono text-[11px] text-neutral-400">Taxonomy Nodes</span>
            </div>
          )}
        </div>

        {/* Active Categories */}
        <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-5 shadow-xs flex flex-col justify-between h-28 border-l-4 border-l-emerald-600">
          <span className="font-mono text-[11px] uppercase tracking-wider text-emerald-700 dark:text-emerald-400 font-bold">
            Active Categories
          </span>
          {loading ? (
            <div className="h-8 w-20 bg-surface-container animate-pulse rounded-md" />
          ) : (
            <div className="flex items-baseline justify-between">
              <span className="font-price-lg text-2xl sm:text-3xl font-black text-emerald-700 dark:text-emerald-400">
                {activeCount}
              </span>
              <span className="font-mono text-[11px] text-neutral-400">Live on Storefront</span>
            </div>
          )}
        </div>

        {/* Inactive Categories */}
        <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-5 shadow-xs flex flex-col justify-between h-28 border-l-4 border-l-neutral-400">
          <span className="font-mono text-[11px] uppercase tracking-wider text-on-surface-variant font-bold">
            Inactive Categories
          </span>
          {loading ? (
            <div className="h-8 w-20 bg-surface-container animate-pulse rounded-md" />
          ) : (
            <div className="flex items-baseline justify-between">
              <span className="font-price-lg text-2xl sm:text-3xl font-black text-neutral-600 dark:text-neutral-400">
                {inactiveCount}
              </span>
              <span className="font-mono text-[11px] text-neutral-400">Hidden from Store</span>
            </div>
          )}
        </div>
      </section>

      {/* ─── 3. Category Management Toolbar ────────────────────────────── */}
      <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-3.5 sm:p-4 shadow-xs flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-1 max-w-xl">
          {/* Search Box */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search categories by name or slug..."
              className="w-full pl-9 pr-8 py-2 text-xs bg-surface-container-low border border-outline-variant/50 rounded-lg focus:outline-none focus:border-primary text-on-surface placeholder:text-neutral-400"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-on-surface p-0.5 cursor-pointer"
                aria-label="Clear search query"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-1.5">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as "ALL" | "ACTIVE" | "INACTIVE")}
              aria-label="Filter categories by status"
              className="px-3 py-2 text-xs bg-surface-container-low border border-outline-variant/50 rounded-lg focus:outline-none focus:border-primary text-on-surface font-mono uppercase cursor-pointer"
            >
              <option value="ALL">All Statuses</option>
              <option value="ACTIVE">Active Only</option>
              <option value="INACTIVE">Inactive Only</option>
            </select>
          </div>
        </div>

        {/* Results summary & Clear action */}
        <div className="flex items-center justify-between sm:justify-end gap-3 font-mono text-xs text-on-surface-variant pt-1 sm:pt-0">
          <span>
            Showing <strong>{displayItems.length}</strong> of {totalCount}
          </span>
          {(searchQuery || statusFilter !== "ALL") && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                setStatusFilter("ALL");
              }}
              className="inline-flex items-center gap-1 text-primary hover:underline font-bold cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Clear</span>
            </button>
          )}
        </div>
      </div>

      {/* ─── 4. Full-Width Taxonomy Table ──────────────────────────────── */}
      <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-surface-container-low border-b border-outline-variant/30 font-mono uppercase text-on-surface-variant text-[11px]">
                <th className="py-3.5 px-4 w-16">Image</th>
                <th className="py-3.5 px-4">Category</th>
                <th className="py-3.5 px-4">Active Products</th>
                <th className="py-3.5 px-4">Display Order</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/20 font-body-sm">
              {loading ? (
                <tr>
                  <td colSpan={6} className="text-center py-16 text-neutral-400 font-mono">
                    <div className="inline-flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-primary" />
                      <span>Loading taxonomy tree...</span>
                    </div>
                  </td>
                </tr>
              ) : displayItems.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-16 space-y-2">
                    <FolderTree className="w-8 h-8 text-neutral-400 mx-auto" />
                    <p className="font-mono text-xs text-on-surface-variant uppercase font-bold">
                      {searchQuery || statusFilter !== "ALL"
                        ? "No matching categories found"
                        : "No categories in database"}
                    </p>
                    <p className="text-[11px] text-neutral-400">
                      {searchQuery || statusFilter !== "ALL"
                        ? "Try clearing filters to view all categories."
                        : "Click 'Add Category' above to create your first root category."}
                    </p>
                  </td>
                </tr>
              ) : (
                displayItems.map((cat) => {
                  const isChild = Boolean(cat.parentCategory);
                  const parentName =
                    typeof cat.parentCategory === "object" && cat.parentCategory
                      ? cat.parentCategory.name
                      : null;

                  return (
                    <tr
                      key={cat._id}
                      className="hover:bg-surface-container/50 transition-colors group"
                    >
                      {/* Image Thumbnail */}
                      <td className="py-3 px-4 w-16">
                        <CategoryThumbnail src={cat.image} alt={cat.name} />
                      </td>

                      {/* Category & Hierarchy */}
                      <td className="py-3 px-4">
                        <div className="flex flex-col gap-0.5">
                          <div className={`flex items-center gap-2 ${isChild ? "pl-5 sm:pl-6" : ""}`}>
                            {isChild && (
                              <CornerDownRight className="w-3.5 h-3.5 text-primary shrink-0" />
                            )}
                            <span
                              className={`font-semibold text-on-surface text-sm tracking-tight ${
                                isChild ? "text-neutral-700 dark:text-neutral-200" : "font-black"
                              }`}
                            >
                              {cat.name}
                            </span>
                            {isChild ? (
                              <span className="inline-block px-1.5 py-0.5 rounded bg-surface-container text-neutral-500 font-mono text-[10px] font-medium border border-outline-variant/30">
                                Subcategory
                              </span>
                            ) : (
                              <span className="inline-block px-1.5 py-0.5 rounded bg-primary/10 text-primary font-mono text-[10px] font-bold border border-primary/20">
                                Root Category
                              </span>
                            )}
                          </div>
                          <div
                            className={`font-mono text-[11px] text-neutral-400 flex items-center gap-2 ${
                              isChild ? "pl-5 sm:pl-6" : ""
                            }`}
                          >
                            <span>/{cat.slug}</span>
                            {parentName && (
                              <span className="text-neutral-500">
                                &bull; Parent: <strong>{parentName}</strong>
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* Active Products */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span className="font-mono text-xs font-bold text-on-surface">
                          {cat.productCount || 0}{" "}
                          <span className="text-neutral-400 font-normal">active</span>
                        </span>
                      </td>

                      {/* Display Order */}
                      <td className="py-3 px-4 font-mono text-xs text-neutral-500 whitespace-nowrap">
                        {cat.displayOrder || 0}
                      </td>

                      {/* Status */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <span
                          className={`inline-block px-2.5 py-0.5 rounded-full border text-[10px] font-mono font-bold uppercase ${
                            cat.status === "ACTIVE"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400"
                              : "bg-neutral-100 text-neutral-600 border-neutral-300 dark:bg-neutral-800 dark:text-neutral-400"
                          }`}
                        >
                          {cat.status}
                        </span>
                      </td>

                      {/* Actions (Plural) */}
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Toggle Active Status */}
                          <button
                            type="button"
                            disabled={togglingId === cat._id}
                            onClick={() => handleToggleStatus(cat)}
                            title={cat.status === "ACTIVE" ? "Deactivate category" : "Activate category"}
                            aria-label={`${cat.status === "ACTIVE" ? "Deactivate" : "Activate"} category ${cat.name}`}
                            className="p-2 rounded-lg text-neutral-500 hover:text-on-surface hover:bg-surface-container transition-colors disabled:opacity-40 cursor-pointer touch-target-base flex items-center justify-center"
                          >
                            {togglingId === cat._id ? (
                              <Loader2 className="w-4 h-4 animate-spin text-primary" />
                            ) : cat.status === "ACTIVE" ? (
                              <EyeOff className="w-4 h-4" />
                            ) : (
                              <Eye className="w-4 h-4 text-emerald-600" />
                            )}
                          </button>

                          {/* Edit Category */}
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(cat)}
                            title="Edit category"
                            aria-label={`Edit category ${cat.name}`}
                            className="p-2 rounded-lg text-neutral-500 hover:text-primary hover:bg-surface-container transition-colors cursor-pointer touch-target-base flex items-center justify-center"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>

                          {/* Delete Category */}
                          <button
                            type="button"
                            onClick={() => {
                              setDeleteError("");
                              setCategoryToDelete(cat);
                            }}
                            title="Delete category"
                            aria-label={`Delete category ${cat.name}`}
                            className="p-2 rounded-lg text-neutral-500 hover:text-error hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors cursor-pointer touch-target-base flex items-center justify-center"
                          >
                            <Trash2 className="w-4 h-4" />
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

      {/* ─── 5. Slide-in Drawer for Create & Edit ───────────────────────── */}
      {isDrawerOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="category-drawer-title"
          className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-xs animate-in fade-in duration-200"
          onClick={handleCloseDrawer}
        >
          <div
            className="w-full max-w-md bg-surface-container-lowest h-full shadow-2xl border-l border-outline-variant/30 flex flex-col overflow-y-auto custom-scrollbar"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer Header */}
            <div className="flex items-center justify-between px-6 py-5 border-b border-outline-variant/20 bg-surface">
              <div>
                <h2
                  id="category-drawer-title"
                  className="font-headline-sm text-lg font-bold text-on-surface uppercase tracking-tight"
                >
                  {editingCategory ? "Edit Category" : "Add New Category"}
                </h2>
                <p className="font-body-sm text-[11px] text-neutral-400 mt-0.5">
                  {editingCategory
                    ? `Updating "${editingCategory.name}"`
                    : "Create a root or child category in taxonomy."}
                </p>
              </div>
              <button
                type="button"
                onClick={handleCloseDrawer}
                className="p-2 text-neutral-400 hover:text-on-surface rounded-lg cursor-pointer touch-target-base flex items-center justify-center"
                aria-label="Close category drawer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Drawer Form */}
            <form onSubmit={handleFormSubmit} className="p-6 space-y-4 flex-1 flex flex-col">
              {formError && (
                <div
                  role="alert"
                  className="p-3 bg-red-50 text-red-700 border border-red-200 rounded-lg text-xs font-mono flex items-start gap-2"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Name */}
              <div className="space-y-1.5">
                <label className="font-mono text-xs uppercase font-bold text-on-surface">
                  Category Name <span className="text-red-500">*</span>
                </label>
                <input
                  required
                  type="text"
                  placeholder="e.g. Oversized T-Shirts"
                  value={formData.name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-xs bg-surface-container-low border border-outline-variant/50 rounded-lg focus:outline-none focus:border-primary text-on-surface"
                />
              </div>

              {/* Slug */}
              <div className="space-y-1.5">
                <label className="font-mono text-xs uppercase font-bold text-on-surface">
                  URL Slug <span className="text-red-500">*</span>
                </label>
                <input
                  required
                  type="text"
                  placeholder="oversized-t-shirts"
                  value={formData.slug}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      slug: e.target.value.toLowerCase().replace(/\s+/g, "-"),
                    }))
                  }
                  className="w-full px-3.5 py-2.5 text-xs bg-surface-container-low border border-outline-variant/50 rounded-lg focus:outline-none focus:border-primary text-on-surface font-mono"
                />
                <p className="font-mono text-[10px] text-neutral-400">
                  Target storefront path: /shop?category={formData.slug || "slug"}
                </p>
              </div>

              {/* Parent Category (2-level rule enforcement) */}
              <div className="space-y-1.5">
                <label className="font-mono text-xs uppercase font-bold text-on-surface">
                  Parent Category
                </label>
                <select
                  disabled={hasSubcategories}
                  value={hasSubcategories ? "" : formData.parentCategory}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, parentCategory: e.target.value }))
                  }
                  className="w-full px-3.5 py-2.5 text-xs bg-surface-container-low border border-outline-variant/50 rounded-lg focus:outline-none focus:border-primary text-on-surface font-mono uppercase disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="">None (Top-Level Root Category)</option>
                  {validParentOptions.map((opt) => (
                    <option key={opt._id} value={opt._id}>
                      {opt.name} {opt.status !== "ACTIVE" ? "(Inactive)" : ""}
                    </option>
                  ))}
                </select>
                {hasSubcategories && (
                  <p className="font-mono text-[10px] text-amber-600 dark:text-amber-400">
                    This category has subcategories and must remain a root category (maximum 2 levels).
                  </p>
                )}
              </div>

              {/* Category Image URL */}
              <div className="space-y-1.5">
                <label className="font-mono text-xs uppercase font-bold text-on-surface">
                  Category Image URL
                </label>
                <input
                  type="text"
                  placeholder="https://images.unsplash.com/... or /images/..."
                  value={formData.image}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, image: e.target.value }))
                  }
                  className="w-full px-3.5 py-2.5 text-xs bg-surface-container-low border border-outline-variant/50 rounded-lg focus:outline-none focus:border-primary text-on-surface"
                />
                {formData.image && (
                  <div className="flex items-center gap-2 pt-1">
                    <span className="font-mono text-[10px] text-neutral-400">Thumbnail Preview:</span>
                    <CategoryThumbnail src={formData.image} alt={formData.name || "Preview"} />
                  </div>
                )}
              </div>

              {/* Description */}
              <div className="space-y-1.5">
                <label className="font-mono text-xs uppercase font-bold text-on-surface">
                  Description
                </label>
                <textarea
                  rows={2}
                  placeholder="Editorial streetwear collection details..."
                  value={formData.description}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, description: e.target.value }))
                  }
                  className="w-full px-3.5 py-2 text-xs bg-surface-container-low border border-outline-variant/50 rounded-lg focus:outline-none focus:border-primary text-on-surface resize-none"
                />
              </div>

              {/* Display Order & Status */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="space-y-1.5">
                  <label className="font-mono text-xs uppercase font-bold text-on-surface">
                    Display Order
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={formData.displayOrder}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        displayOrder: Math.max(0, parseInt(e.target.value, 10) || 0),
                      }))
                    }
                    className="w-full px-3.5 py-2.5 text-xs bg-surface-container-low border border-outline-variant/50 rounded-lg focus:outline-none focus:border-primary text-on-surface font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="font-mono text-xs uppercase font-bold text-on-surface">
                    Status
                  </label>
                  <select
                    value={formData.status}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        status: e.target.value as "ACTIVE" | "INACTIVE",
                      }))
                    }
                    className="w-full px-3.5 py-2.5 text-xs bg-surface-container-low border border-outline-variant/50 rounded-lg focus:outline-none focus:border-primary text-on-surface font-mono uppercase"
                  >
                    <option value="ACTIVE">ACTIVE</option>
                    <option value="INACTIVE">INACTIVE</option>
                  </select>
                </div>
              </div>

              {/* Actions Footer */}
              <div className="pt-6 mt-auto border-t border-outline-variant/20 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={handleCloseDrawer}
                  disabled={saving}
                  className="px-4 py-2.5 font-mono text-xs uppercase font-bold text-neutral-500 hover:text-on-surface rounded-lg transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2.5 bg-primary text-white font-mono text-xs uppercase font-bold tracking-wider rounded-lg hover:bg-primary/90 transition-transform active:scale-95 disabled:opacity-50 cursor-pointer flex items-center gap-2"
                >
                  {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{saving ? "Saving..." : editingCategory ? "Update Category" : "Create Category"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─── 6. Accessible Delete Confirmation Dialog ───────────────────── */}
      {categoryToDelete && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
          onClick={() => {
            if (!deleting) setCategoryToDelete(null);
          }}
        >
          <div
            className="w-full max-w-md bg-surface-container-lowest rounded-2xl p-6 shadow-2xl border border-outline-variant/30 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-950/50 text-red-600 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 id="delete-dialog-title" className="font-headline-sm text-base font-bold text-on-surface">
                  Delete Category?
                </h3>
                <p className="font-mono text-xs text-neutral-500">
                  {categoryToDelete.name} (/{categoryToDelete.slug})
                </p>
              </div>
            </div>

            <p className="text-xs text-on-surface-variant font-body-sm leading-relaxed">
              Are you sure you want to delete this category? This action cannot be undone. If products or subcategories belong to this category, deletion will be blocked by database safeguards.
            </p>

            {deleteError && (
              <div
                role="alert"
                className="p-3 bg-red-50 text-red-700 border border-red-200 rounded-lg text-xs font-mono flex items-start gap-2"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
                <span>{deleteError}</span>
              </div>
            )}

            <div className="pt-2 flex items-center justify-end gap-3">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setCategoryToDelete(null)}
                className="px-4 py-2 font-mono text-xs uppercase font-bold text-neutral-500 hover:text-on-surface rounded-lg transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={handleConfirmDelete}
                className="px-4 py-2 bg-error text-white font-mono text-xs uppercase font-bold tracking-wider rounded-lg hover:bg-error/90 transition-transform active:scale-95 disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
              >
                {deleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{deleting ? "Deleting..." : "Delete Category"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
