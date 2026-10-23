"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

interface BannerItem {
  _id: string;
  title: string;
  subtitle?: string;
  image: string;
  mobileImage?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  position: string;
  displayOrder: number;
  status: string;
  startsAt?: string;
  endsAt?: string;
  createdAt: string;
}

export default function AdminBannersClient() {
  const router = useRouter();

  const [banners, setBanners] = useState<BannerItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [positionFilter, setPositionFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");

  // Banner Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingBannerId, setEditingBannerId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [image, setImage] = useState("");
  const [ctaLabel, setCtaLabel] = useState("SHOP NOW");
  const [ctaUrl, setCtaUrl] = useState("/shop");
  const [position, setPosition] = useState("HERO");
  const [displayOrder, setDisplayOrder] = useState(0);
  const [status, setStatus] = useState("ACTIVE");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState<{ text: string; type: "success" | "error" } | null>(null);
  // Fetch Admin Banners
  useEffect(() => {
    async function fetchBanners() {
      setIsLoading(true);
      setError(null);
      try {
        const res = await api.get("/admin/cms/banners", {
          params: {
            position: positionFilter !== "All" ? positionFilter : undefined,
            status: statusFilter !== "All" ? statusFilter : undefined,
          },
        });
        if (res.data?.success) {
          setBanners(res.data.data);
        }
      } catch (err: any) {
        if (err.response?.status === 403 || err.response?.status === 401) {
          router.push("/admin/login");
          return;
        }
        setError(err.response?.data?.message || "Failed to load admin banners.");
      } finally {
        setIsLoading(false);
      }
    }
    fetchBanners();
  }, [positionFilter, statusFilter, router]);

  // Open Create Modal
  const handleOpenCreateModal = () => {
    setEditingBannerId(null);
    setTitle("");
    setSubtitle("");
    setImage("");
    setCtaLabel("SHOP NOW");
    setCtaUrl("/shop");
    setPosition("HERO");
    setDisplayOrder(0);
    setStatus("ACTIVE");
    setIsModalOpen(true);
  };

  // Open Edit Modal
  const handleOpenEditModal = (b: BannerItem) => {
    setEditingBannerId(b._id);
    setTitle(b.title);
    setSubtitle(b.subtitle || "");
    setImage(b.image);
    setCtaLabel(b.ctaLabel || "SHOP NOW");
    setCtaUrl(b.ctaUrl || "/shop");
    setPosition(b.position);
    setDisplayOrder(b.displayOrder || 0);
    setStatus(b.status);
    setIsModalOpen(true);
  };

  // Save Banner (Create or Update)
  const handleSaveBanner = async () => {
    if (!title.trim() || !image.trim()) return;
    setIsSubmitting(true);
    setToast(null);

    const payload = {
      title: title.trim(),
      subtitle: subtitle.trim() || undefined,
      image: image.trim(),
      ctaLabel: ctaLabel.trim() || "SHOP NOW",
      ctaUrl: ctaUrl.trim() || "/shop",
      position,
      displayOrder: Number(displayOrder) || 0,
      status,
    };

    try {
      if (editingBannerId) {
        const res = await api.put(`/admin/cms/banners/${editingBannerId}`, payload);
        if (res.data?.success) {
          setBanners((prev) => prev.map((b) => (b._id === editingBannerId ? res.data.data : b)));
          setIsModalOpen(false);
          setToast({ text: "Banner updated successfully!", type: "success" });
        }
      } else {
        const res = await api.post("/admin/cms/banners", payload);
        if (res.data?.success) {
          setBanners([res.data.data, ...banners]);
          setIsModalOpen(false);
          setToast({ text: "Banner created successfully!", type: "success" });
        }
      }
    } catch (err: unknown) {
      let message = "Failed to save banner.";
      if (err && typeof err === "object" && "response" in err) {
        const r = (err as { response?: { data?: { message?: string } } }).response;
        if (r?.data?.message) message = r.data.message;
      }
      setToast({ text: message, type: "error" });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Toggle Banner Status
  const handleToggleStatus = async (id: string, newStatus: string) => {
    setToast(null);
    try {
      const res = await api.patch(`/admin/cms/banners/${id}/status`, { status: newStatus });
      if (res.data?.success) {
        setBanners((prev) => prev.map((b) => (b._id === id ? { ...b, status: newStatus } : b)));
        setToast({ text: `Banner status updated to ${newStatus}`, type: "success" });
      }
    } catch (err: any) {
      setToast({ text: err.response?.data?.message || "Failed to update banner status.", type: "error" });
    }
  };

  // Delete Banner
  const handleDeleteBanner = async (id: string) => {
    if (!confirm("Are you sure you want to delete this banner?")) return;
    try {
      const res = await api.delete(`/admin/cms/banners/${id}`);
      if (res.data?.success) {
        setBanners((prev) => prev.filter((b) => b._id !== id));
        setToast({ text: "Banner deleted.", type: "success" });
      }
    } catch (err: any) {
      setToast({ text: err.response?.data?.message || "Failed to delete banner.", type: "error" });
    }
  };

  return (
    <div className="flex-1 bg-background text-on-background min-h-screen p-6 md:p-10 font-body-md pb-24">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed top-20 right-6 z-50 px-6 py-4 rounded-lg shadow-xl text-white font-medium transition-all ${
            toast.type === "success" ? "bg-emerald-600" : "bg-red-600"
          }`}
        >
          {toast.text}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-8 gap-4">
        <div>
          <h1 className="font-display-lg text-3xl md:text-4xl font-extrabold text-on-surface tracking-tight">
            Banner Management
          </h1>
          <p className="font-body-md text-on-surface-variant mt-1">
            Manage storefront Hero banners, promotional tiles, and announcement bars.
          </p>
        </div>
        <button
          onClick={handleOpenCreateModal}
          className="px-6 py-3 bg-primary text-on-primary font-label-caps text-xs font-bold rounded-xl hover:bg-primary-container transition-colors shadow-md flex items-center gap-2"
        >
          <span className="material-symbols-outlined text-lg">add_circle</span>
          Create New Banner
        </button>
      </div>

      {/* Filter Bar */}
      <div className="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant mb-6 shadow-sm flex flex-wrap gap-4 items-center">
        <select
          value={positionFilter}
          onChange={(e) => setPositionFilter(e.target.value)}
          className="bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-xs font-bold text-on-surface outline-none"
        >
          <option value="All">Position: All</option>
          <option value="HERO">Hero Slides</option>
          <option value="PROMOTIONAL_TILE">Promotional Tiles</option>
          <option value="ANNOUNCEMENT_BAR">Announcement Bar</option>
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-xs font-bold text-on-surface outline-none"
        >
          <option value="All">Status: All</option>
          <option value="ACTIVE">Active</option>
          <option value="DRAFT">Draft</option>
          <option value="PAUSED">Paused</option>
        </select>
      </div>

      {isLoading && (
        <div className="p-8 text-center font-bold text-on-surface-variant">Loading banners...</div>
      )}

      {error && (
        <div className="p-4 bg-error-container text-on-error-container rounded-xl text-center font-bold mb-6">{error}</div>
      )}

      {/* Banners Grid */}
      {!isLoading && !error && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {banners.length === 0 ? (
            <div className="col-span-3 p-12 text-center bg-surface-container-lowest rounded-2xl border border-outline-variant/20">
              <span className="material-symbols-outlined text-4xl text-outline mb-2">view_carousel</span>
              <p className="font-bold text-on-surface">No banners found.</p>
              <p className="text-xs text-on-surface-variant mt-1">Click "Create New Banner" to add storefront marketing assets.</p>
            </div>
          ) : (
            banners.map((b) => (
              <div key={b._id} className="bg-surface-container-lowest border border-outline-variant/20 rounded-2xl overflow-hidden shadow-sm flex flex-col justify-between">
                <div>
                  <div className="h-44 bg-surface-container-low relative overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={b.image} alt={b.title} className="w-full h-full object-cover" />
                    <span
                      className={`absolute top-3 left-3 px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${
                        b.status === "ACTIVE"
                          ? "bg-emerald-600 text-white"
                          : "bg-amber-600 text-white"
                      }`}
                    >
                      {b.status}
                    </span>
                    <span className="absolute top-3 right-3 bg-black/60 text-white font-label-caps text-[10px] px-2 py-0.5 rounded">
                      {b.position}
                    </span>
                  </div>

                  <div className="p-5">
                    <h3 className="font-bold text-base text-on-surface mb-1">{b.title}</h3>
                    {b.subtitle && <p className="text-xs text-on-surface-variant line-clamp-2 mb-3">{b.subtitle}</p>}
                    <div className="flex items-center gap-2 text-xs font-label-caps text-primary">
                      <span>CTA: {b.ctaLabel || "SHOP NOW"}</span>
                      <span>• {b.ctaUrl}</span>
                    </div>
                  </div>
                </div>

                <div className="p-4 border-t border-outline-variant/20 bg-surface-container-low flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    {b.status === "ACTIVE" ? (
                      <button
                        onClick={() => handleToggleStatus(b._id, "PAUSED")}
                        className="px-3 py-1.5 border border-amber-600 text-amber-700 font-label-caps text-xs font-bold rounded-lg hover:bg-amber-50"
                      >
                        Pause
                      </button>
                    ) : (
                      <button
                        onClick={() => handleToggleStatus(b._id, "ACTIVE")}
                        className="px-3 py-1.5 bg-emerald-600 text-white font-label-caps text-xs font-bold rounded-lg hover:bg-emerald-700"
                      >
                        Publish
                      </button>
                    )}
                    <button
                      onClick={() => handleOpenEditModal(b)}
                      className="p-1.5 text-on-surface-variant hover:text-primary hover:bg-surface-container rounded-lg"
                      title="Edit Banner"
                    >
                      <span className="material-symbols-outlined text-lg">edit</span>
                    </button>
                  </div>

                  <button
                    onClick={() => handleDeleteBanner(b._id)}
                    className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg"
                    title="Delete Banner"
                  >
                    <span className="material-symbols-outlined text-lg">delete</span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Create / Edit Banner Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-on-background/50 backdrop-blur-sm">
          <div className="bg-surface-container-lowest w-full max-w-lg rounded-2xl shadow-2xl border border-outline-variant/20 overflow-hidden flex flex-col">
            <div className="p-6 border-b border-outline-variant/10 flex justify-between items-center bg-surface-container-low">
              <h3 className="font-bold text-lg text-on-surface">
                {editingBannerId ? "Edit Storefront Banner" : "Create Storefront Banner"}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-surface-container rounded-full text-on-surface-variant">
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-label-caps uppercase text-on-surface mb-1">Banner Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-3 text-sm focus:outline-none focus:border-primary"
                  placeholder="e.g. Summer Festival Collection Drop"
                />
              </div>

              <div>
                <label className="block text-xs font-label-caps uppercase text-on-surface mb-1">Subtitle / Headline</label>
                <input
                  type="text"
                  value={subtitle}
                  onChange={(e) => setSubtitle(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-3 text-sm focus:outline-none focus:border-primary"
                  placeholder="e.g. Premium 240 GSM Oversized Tees starting at ₹999"
                />
              </div>

              <div>
                <label className="block text-xs font-label-caps uppercase text-on-surface mb-1">Banner Image URL</label>
                <input
                  type="text"
                  value={image}
                  onChange={(e) => setImage(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-3 text-xs focus:outline-none focus:border-primary"
                  placeholder="Paste Image URL..."
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-label-caps uppercase text-on-surface mb-1">CTA Label</label>
                  <input
                    type="text"
                    value={ctaLabel}
                    onChange={(e) => setCtaLabel(e.target.value)}
                    className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-3 text-xs font-bold text-on-surface"
                    placeholder="SHOP NOW"
                  />
                </div>

                <div>
                  <label className="block text-xs font-label-caps uppercase text-on-surface mb-1">CTA Path</label>
                  <input
                    type="text"
                    value={ctaUrl}
                    onChange={(e) => setCtaUrl(e.target.value)}
                    className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-3 text-xs font-bold text-on-surface"
                    placeholder="/shop"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-label-caps uppercase text-on-surface mb-1">Position</label>
                  <select
                    value={position}
                    onChange={(e) => setPosition(e.target.value)}
                    className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-2.5 text-xs font-bold text-on-surface"
                  >
                    <option value="HERO">Hero Slide</option>
                    <option value="PROMOTIONAL_TILE">Promo Tile</option>
                    <option value="ANNOUNCEMENT_BAR">Announcement</option>
                    <option value="FEATURED_BANNER">Featured</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-label-caps uppercase text-on-surface mb-1">Order</label>
                  <input
                    type="number"
                    min="0"
                    value={displayOrder}
                    onChange={(e) => setDisplayOrder(Number(e.target.value))}
                    className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-2.5 text-xs font-bold text-on-surface"
                  />
                </div>

                <div>
                  <label className="block text-xs font-label-caps uppercase text-on-surface mb-1">Status</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-2.5 text-xs font-bold text-on-surface"
                  >
                    <option value="ACTIVE">Active</option>
                    <option value="DRAFT">Draft</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="p-6 border-t border-outline-variant/10 bg-surface-container-low flex justify-end gap-3">
              <button
                onClick={() => setIsModalOpen(false)}
                className="px-5 py-2.5 border border-outline-variant font-label-caps text-xs font-bold rounded-xl text-on-surface-variant hover:bg-surface-container transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveBanner}
                disabled={isSubmitting || !title.trim() || !image.trim()}
                className="px-6 py-2.5 bg-primary text-on-primary font-label-caps text-xs font-bold rounded-xl hover:bg-primary-container transition-colors shadow-md disabled:opacity-50"
              >
                {isSubmitting ? "Saving..." : editingBannerId ? "Update Banner" : "Save Banner"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
