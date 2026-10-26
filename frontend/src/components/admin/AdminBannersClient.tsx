"use client";

import { useState, useEffect, useRef, DragEvent } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import {
  UploadCloud,
  Image as ImageIcon,
  Link as LinkIcon,
  X,
  Calendar,
  Loader2,
  Smartphone,
  Eye,
  ChevronDown,
  ChevronUp,
  GripVertical,
  MousePointerClick,
  TrendingUp,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Sun,
  Moon,
  Users,
} from "lucide-react";

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
  textColor?: "LIGHT" | "DARK";
  textAlignment?: "LEFT" | "CENTER" | "RIGHT";
  overlayStrength?: "NONE" | "LIGHT" | "MEDIUM" | "HEAVY";
  targetAudience?: "ALL" | "RETAIL" | "B2B_CUSTOM";
  impressions?: number;
  clicks?: number;
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
  const [audienceFilter, setAudienceFilter] = useState("All");
  // Banner Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingBannerId, setEditingBannerId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [image, setImage] = useState("");
  const [mobileImage, setMobileImage] = useState("");
  const [ctaLabel, setCtaLabel] = useState("SHOP NOW");
  const [ctaUrl, setCtaUrl] = useState("/shop");
  const [position, setPosition] = useState("HERO");
  const [displayOrder, setDisplayOrder] = useState(0);
  const [status, setStatus] = useState("ACTIVE");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [textColor, setTextColor] = useState<"LIGHT" | "DARK">("LIGHT");
  const [textAlignment, setTextAlignment] = useState<"LEFT" | "CENTER" | "RIGHT">("LEFT");
  const [overlayStrength, setOverlayStrength] = useState<"NONE" | "LIGHT" | "MEDIUM" | "HEAVY">("MEDIUM");
  const [targetAudience, setTargetAudience] = useState<"ALL" | "RETAIL" | "B2B_CUSTOM">("ALL");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState<{ text: string; type: "success" | "error" } | null>(null);

  // Drag-and-drop reorder state
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [isReordering, setIsReordering] = useState(false);
  // Upload states
  const [isUploading, setIsUploading] = useState(false);
  const [isUploadingMobile, setIsUploadingMobile] = useState(false);
  const [imageTab, setImageTab] = useState<"upload" | "url">("upload");
  const [mobileImageTab, setMobileImageTab] = useState<"upload" | "url">("upload");
  const [isDragging, setIsDragging] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mobileFileInputRef = useRef<HTMLInputElement>(null);
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
          let data: BannerItem[] = res.data.data || [];
          if (audienceFilter !== "All") {
            data = data.filter((b) => (b.targetAudience || "ALL") === audienceFilter);
          }
          setBanners(data);
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
  }, [positionFilter, statusFilter, audienceFilter, router]);

  // Open Create Modal
  const handleOpenCreateModal = () => {
    setEditingBannerId(null);
    setTitle("");
    setSubtitle("");
    setImage("");
    setMobileImage("");
    setCtaLabel("SHOP NOW");
    setCtaUrl("/shop");
    setPosition("HERO");
    setDisplayOrder(0);
    setStatus("ACTIVE");
    setTextColor("LIGHT");
    setTextAlignment("LEFT");
    setOverlayStrength("MEDIUM");
    setTargetAudience("ALL");
    setStartsAt("");
    setEndsAt("");
    setImageTab("upload");
    setShowAdvanced(false);
    setIsModalOpen(true);
  };

  // Open Edit Modal
  const handleOpenEditModal = (b: BannerItem) => {
    setEditingBannerId(b._id);
    setTitle(b.title);
    setSubtitle(b.subtitle || "");
    setImage(b.image);
    setMobileImage(b.mobileImage || "");
    setCtaLabel(b.ctaLabel || "SHOP NOW");
    setCtaUrl(b.ctaUrl || "/shop");
    setPosition(b.position);
    setDisplayOrder(b.displayOrder || 0);
    setStatus(b.status);
    setTextColor(b.textColor || "LIGHT");
    setTextAlignment(b.textAlignment || "LEFT");
    setOverlayStrength(b.overlayStrength || "MEDIUM");
    setTargetAudience(b.targetAudience || "ALL");
    setStartsAt(b.startsAt ? b.startsAt.slice(0, 16) : "");
    setEndsAt(b.endsAt ? b.endsAt.slice(0, 16) : "");
    setImageTab(b.image ? (b.image.startsWith("http") && !b.image.includes("cloudinary") ? "url" : "upload") : "upload");
    setShowAdvanced(Boolean(b.mobileImage || b.startsAt || b.endsAt));
    setIsModalOpen(true);
  };

  // File Upload Handlers
  const handleFileUpload = async (file: File, isMobile = false) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setToast({ text: "Please upload a valid image file (JPG, PNG, WebP).", type: "error" });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setToast({ text: "File size exceeds 10MB limit.", type: "error" });
      return;
    }

    if (isMobile) setIsUploadingMobile(true);
    else setIsUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("category", "banner");
      const res = await api.post("/upload/image", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const url = res.data?.data?.url;
      if (!url) throw new Error("Upload did not return an image URL");

      if (isMobile) {
        setMobileImage(url);
      } else {
        setImage(url);
      }
      setToast({ text: "Image uploaded successfully!", type: "success" });
    } catch (err: unknown) {
      let msg = "Failed to upload image.";
      if (err instanceof Error) {
        msg = err.message;
      }
      setToast({ text: msg, type: "error" });
    } finally {
      if (isMobile) setIsUploadingMobile(false);
      else setIsUploading(false);
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };
  // Visual Drag-and-Drop Card Handlers
  const handleDragStartCard = (e: DragEvent<HTMLDivElement>, index: number) => {
    setDraggedIdx(index);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOverCard = (e: DragEvent<HTMLDivElement>, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverIdx !== index) {
      setDragOverIdx(index);
    }
  };

  const handleDragEndCard = () => {
    setDraggedIdx(null);
    setDragOverIdx(null);
  };

  const handleDropOnCard = async (e: DragEvent<HTMLDivElement>, dropIndex: number) => {
    e.preventDefault();
    if (draggedIdx === null || draggedIdx === dropIndex) {
      setDraggedIdx(null);
      setDragOverIdx(null);
      return;
    }

    const nextList = [...banners];
    const [moved] = nextList.splice(draggedIdx, 1);
    nextList.splice(dropIndex, 0, moved);

    const reindexed = nextList.map((item, i) => ({ ...item, displayOrder: i }));
    setBanners(reindexed);
    setDraggedIdx(null);
    setDragOverIdx(null);
    setIsReordering(true);

    try {
      await api.put("/admin/cms/banners/reorder", {
        items: reindexed.map((b) => ({ id: b._id, displayOrder: b.displayOrder })),
      });
      setToast({ text: "Banner sequence reordered and saved!", type: "success" });
    } catch (err: unknown) {
      let msg = "Failed to save reordered banners.";
      if (err instanceof Error) msg = err.message;
      setToast({ text: msg, type: "error" });
    } finally {
      setIsReordering(false);
    }
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
      mobileImage: mobileImage.trim() || undefined,
      ctaLabel: ctaLabel.trim() || "SHOP NOW",
      ctaUrl: ctaUrl.trim() || "/shop",
      position,
      displayOrder: Number(displayOrder) || 0,
      status,
      textColor,
      textAlignment,
      overlayStrength,
      targetAudience,
      startsAt: startsAt ? new Date(startsAt).toISOString() : undefined,
      endsAt: endsAt ? new Date(endsAt).toISOString() : undefined,
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
      if (err instanceof Error) {
        message = err.message;
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

      {/* Analytics Summary Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant/30 shadow-xs">
          <p className="text-[11px] font-label-caps uppercase text-on-surface-variant font-bold">Total Banners</p>
          <p className="text-2xl font-black text-on-surface mt-1">{banners.length}</p>
        </div>
        <div className="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant/30 shadow-xs">
          <p className="text-[11px] font-label-caps uppercase text-on-surface-variant font-bold flex items-center gap-1">
            <Eye className="w-3.5 h-3.5 text-primary" />
            <span>Storefront Views</span>
          </p>
          <p className="text-2xl font-black text-on-surface mt-1">
            {banners.reduce((acc, b) => acc + (b.impressions || 0), 0).toLocaleString()}
          </p>
        </div>
        <div className="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant/30 shadow-xs">
          <p className="text-[11px] font-label-caps uppercase text-on-surface-variant font-bold flex items-center gap-1">
            <MousePointerClick className="w-3.5 h-3.5 text-emerald-600" />
            <span>Total Clicks</span>
          </p>
          <p className="text-2xl font-black text-on-surface mt-1">
            {banners.reduce((acc, b) => acc + (b.clicks || 0), 0).toLocaleString()}
          </p>
        </div>
        <div className="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant/30 shadow-xs">
          <p className="text-[11px] font-label-caps uppercase text-on-surface-variant font-bold flex items-center gap-1">
            <TrendingUp className="w-3.5 h-3.5 text-amber-500" />
            <span>Average CTR</span>
          </p>
          <p className="text-2xl font-black text-on-surface mt-1">
            {(() => {
              const views = banners.reduce((acc, b) => acc + (b.impressions || 0), 0);
              const clicks = banners.reduce((acc, b) => acc + (b.clicks || 0), 0);
              return views > 0 ? ((clicks / views) * 100).toFixed(1) : "0.0";
            })()}%
          </p>
        </div>
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

        <select
          value={audienceFilter}
          onChange={(e) => setAudienceFilter(e.target.value)}
          className="bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-xs font-bold text-on-surface outline-none"
        >
          <option value="All">Audience: All</option>
          <option value="ALL">Public (All)</option>
          <option value="RETAIL">Retail Only</option>
          <option value="B2B_CUSTOM">B2B / Custom Print Only</option>
        </select>

        {isReordering && (
          <div className="flex items-center gap-1.5 text-xs text-primary font-bold ml-auto animate-pulse">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>Saving reordered slides...</span>
          </div>
        )}
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
            banners.map((b, index) => (
              <div
                key={b._id}
                draggable
                onDragStart={(e) => handleDragStartCard(e, index)}
                onDragOver={(e) => handleDragOverCard(e, index)}
                onDrop={(e) => handleDropOnCard(e, index)}
                onDragEnd={handleDragEndCard}
                className={`bg-surface-container-lowest border rounded-2xl overflow-hidden shadow-sm flex flex-col justify-between transition-all ${
                  dragOverIdx === index ? "border-primary ring-2 ring-primary/30 scale-[1.01]" : "border-outline-variant/20"
                }`}
              >
                <div>
                  <div className="h-44 bg-surface-container-low relative overflow-hidden group">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={b.image} alt={b.title} className="w-full h-full object-cover" />

                    {/* Drag Grip Handle */}
                    <div
                      className="absolute top-3 left-3 flex items-center gap-1 bg-black/75 backdrop-blur-sm text-white px-2 py-1 rounded cursor-grab active:cursor-grabbing hover:bg-black transition-colors"
                      title="Drag card to reorder sequence"
                    >
                      <GripVertical className="w-3.5 h-3.5 text-neutral-300" />
                      <span className="font-mono text-[10px] font-bold">#{b.displayOrder}</span>
                    </div>

                    <div className="absolute top-3 right-3 flex items-center gap-1.5">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                          b.status === "ACTIVE" ? "bg-emerald-600 text-white" : "bg-amber-600 text-white"
                        }`}
                      >
                        {b.status}
                      </span>
                      <span className="bg-black/75 text-white font-label-caps text-[10px] px-2 py-0.5 rounded">
                        {b.position}
                      </span>
                    </div>

                    {/* Audience Badge */}
                    <div className="absolute bottom-2 left-3">
                      <span className="bg-neutral-900/80 backdrop-blur-sm text-neutral-200 text-[10px] font-mono px-2 py-0.5 rounded border border-neutral-700/60 flex items-center gap-1">
                        <Users className="w-3 h-3 text-primary" />
                        <span>
                          {b.targetAudience === "RETAIL"
                            ? "Retail Shoppers"
                            : b.targetAudience === "B2B_CUSTOM"
                            ? "B2B Custom Print"
                            : "All Visitors"}
                        </span>
                      </span>
                    </div>
                  </div>

                  {/* Performance Metrics Bar */}
                  <div className="flex items-center justify-between px-5 py-2.5 bg-surface-container-low/60 border-b border-outline-variant/15 text-[11px]">
                    <div className="flex items-center gap-3 text-on-surface-variant">
                      <span className="flex items-center gap-1" title="Impressions">
                        <Eye className="w-3.5 h-3.5 text-primary" />
                        <span className="font-mono font-bold">{(b.impressions || 0).toLocaleString()}</span>
                      </span>
                      <span className="flex items-center gap-1" title="Clicks">
                        <MousePointerClick className="w-3.5 h-3.5 text-emerald-600" />
                        <span className="font-mono font-bold">{(b.clicks || 0).toLocaleString()}</span>
                      </span>
                    </div>
                    <span className="px-2 py-0.5 rounded font-mono font-bold text-[10px] bg-primary/10 text-primary">
                      {((b.clicks || 0) / Math.max(b.impressions || 1, 1) * 100).toFixed(1)}% CTR
                    </span>
                  </div>

                  <div className="p-5">
                    <h3 className="font-bold text-base text-on-surface mb-1">{b.title}</h3>
                    {b.subtitle && <p className="text-xs text-on-surface-variant line-clamp-2 mb-3">{b.subtitle}</p>}
                    <div className="flex items-center gap-2 text-xs font-label-caps text-primary">
                      <span>CTA: {b.ctaLabel || "SHOP NOW"}</span>
                      <span>• {b.ctaUrl}</span>
                    </div>

                    {/* Style Configuration Tags */}
                    <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono text-on-surface-variant mt-3 pt-2.5 border-t border-outline-variant/15">
                      <span className="px-1.5 py-0.5 rounded bg-surface-container">
                        {b.textColor === "DARK" ? "Dark Text" : "White Text"}
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-surface-container">
                        Align: {b.textAlignment || "LEFT"}
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-surface-container">
                        Overlay: {b.overlayStrength || "MEDIUM"}
                      </span>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-surface-container-lowest w-full max-w-5xl max-h-[92vh] rounded-2xl shadow-2xl border border-outline-variant/30 overflow-hidden flex flex-col">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-outline-variant/20 flex justify-between items-center bg-surface-container-low shrink-0">
              <div className="flex items-center gap-2.5">
                <span className="material-symbols-outlined text-primary text-xl">view_carousel</span>
                <h3 className="font-bold text-base text-on-surface">
                  {editingBannerId ? "Edit Storefront Banner" : "Create Storefront Banner"}
                </h3>
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-primary/10 text-primary">
                  {position}
                </span>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 hover:bg-surface-container rounded-full text-on-surface-variant transition-colors"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body - 2 Columns (Form on left, Live Storefront Preview on right) */}
            <div className="overflow-y-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Form Column */}
              <div className="lg:col-span-7 space-y-4">
                {/* Title & Subtitle */}
                <div>
                  <label className="block text-xs font-label-caps uppercase text-on-surface mb-1">
                    Banner Title *
                  </label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-3 text-sm focus:outline-none focus:border-primary text-on-surface"
                    placeholder="e.g. Summer Festival Drop 2026"
                  />
                </div>

                <div>
                  <label className="block text-xs font-label-caps uppercase text-on-surface mb-1">
                    Subtitle / Headline (Optional)
                  </label>
                  <input
                    type="text"
                    value={subtitle}
                    onChange={(e) => setSubtitle(e.target.value)}
                    className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-3 text-sm focus:outline-none focus:border-primary text-on-surface"
                    placeholder="e.g. Heavyweight 240+ GSM Oversized Streetwear Blanks"
                  />
                </div>

                {/* Banner Image Asset (Upload & URL) */}
                <div className="rounded-xl border border-outline-variant/30 bg-surface-container-low/40 p-4 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
                    <div>
                      <label className="text-xs font-label-caps uppercase text-on-surface font-bold">
                        Banner Image Asset *
                      </label>
                      <p className="text-[11px] text-on-surface-variant">
                        {position === "HERO"
                          ? "Recommended: 1920 × 720 px (16:9 widescreen, under 10MB)"
                          : position === "PROMOTIONAL_TILE"
                          ? "Recommended: 800 × 800 px (1:1 square)"
                          : position === "ANNOUNCEMENT_BAR"
                          ? "Recommended: 1920 × 80 px (slim strip or text only)"
                          : "Recommended: 1400 × 600 px (landscape card)"}
                      </p>
                    </div>
                    {/* Mode Toggle */}
                    <div className="flex bg-surface-container p-0.5 rounded-lg border border-outline-variant/40 shrink-0 self-start sm:self-auto">
                      <button
                        type="button"
                        onClick={() => setImageTab("upload")}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-bold transition-all ${
                          imageTab === "upload"
                            ? "bg-surface-container-lowest text-primary shadow-xs"
                            : "text-on-surface-variant hover:text-on-surface"
                        }`}
                      >
                        <UploadCloud className="w-3.5 h-3.5" />
                        <span>Upload</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setImageTab("url")}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-bold transition-all ${
                          imageTab === "url"
                            ? "bg-surface-container-lowest text-primary shadow-xs"
                            : "text-on-surface-variant hover:text-on-surface"
                        }`}
                      >
                        <LinkIcon className="w-3.5 h-3.5" />
                        <span>URL</span>
                      </button>
                    </div>
                  </div>

                  {/* Upload Dropzone */}
                  {imageTab === "upload" ? (
                    <div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/svg+xml"
                        onChange={(e) => {
                          if (e.target.files?.[0]) handleFileUpload(e.target.files[0]);
                        }}
                        className="hidden"
                      />

                      {image ? (
                        <div className="flex items-center gap-3 p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10">
                          <div className="relative h-14 w-24 rounded-lg overflow-hidden border border-outline-variant/30 bg-surface-container shrink-0">
                            <img src={image} alt="Uploaded banner" className="h-full w-full object-cover" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-bold text-emerald-900 truncate">Asset Ready</p>
                            <p className="text-[10px] text-emerald-800 font-mono truncate">{image}</p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => fileInputRef.current?.click()}
                              disabled={isUploading}
                              className="px-2.5 py-1.5 rounded-lg border border-outline-variant bg-surface-container text-xs font-bold text-on-surface hover:bg-surface-container-high transition-colors"
                            >
                              {isUploading ? "Uploading..." : "Replace"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setImage("")}
                              className="p-1.5 rounded-lg text-error hover:bg-error/10 transition-colors"
                              title="Remove image"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div
                          onClick={() => fileInputRef.current?.click()}
                          onDragOver={(e) => {
                            e.preventDefault();
                            setIsDragging(true);
                          }}
                          onDragLeave={() => setIsDragging(false)}
                          onDrop={handleDrop}
                          className={`cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition-all ${
                            isDragging
                              ? "border-primary bg-primary/10"
                              : "border-outline-variant/50 hover:border-primary/70 hover:bg-surface-container"
                          }`}
                        >
                          {isUploading ? (
                            <div className="flex flex-col items-center gap-2 py-2">
                              <Loader2 className="w-6 h-6 animate-spin text-primary" />
                              <span className="text-xs font-bold text-primary">Uploading to Cloud Storage...</span>
                            </div>
                          ) : (
                            <div className="flex flex-col items-center gap-1.5 py-1">
                              <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-1">
                                <UploadCloud className="w-5 h-5" />
                              </div>
                              <p className="text-xs font-bold text-on-surface">
                                Click to browse or drag & drop banner file
                              </p>
                              <p className="text-[11px] text-on-surface-variant">
                                Supports JPG, PNG, WebP up to 10MB
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div>
                      <input
                        type="text"
                        value={image}
                        onChange={(e) => setImage(e.target.value)}
                        className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-3 text-xs focus:outline-none focus:border-primary font-mono text-on-surface"
                        placeholder="https://res.cloudinary.com/... or /images/banners/hero.jpg"
                      />
                    </div>
                  )}
                </div>

                {/* CTA Configuration & Presets */}
                <div className="space-y-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-label-caps uppercase text-on-surface mb-1">CTA Label</label>
                      <input
                        type="text"
                        value={ctaLabel}
                        onChange={(e) => setCtaLabel(e.target.value)}
                        className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-3 text-xs font-bold text-on-surface uppercase focus:outline-none focus:border-primary"
                        placeholder="SHOP NOW"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-label-caps uppercase text-on-surface mb-1">CTA Path</label>
                      <input
                        type="text"
                        value={ctaUrl}
                        onChange={(e) => setCtaUrl(e.target.value)}
                        className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-3 text-xs font-mono text-on-surface focus:outline-none focus:border-primary"
                        placeholder="/shop"
                      />
                    </div>
                  </div>
                  {/* Quick Preset Chips */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="text-[10px] uppercase font-bold text-on-surface-variant tracking-wider mr-1">
                      Quick Links:
                    </span>
                    {[
                      { label: "All Shop", path: "/shop" },
                      { label: "Custom Printing", path: "/custom-printing" },
                      { label: "T-Shirts", path: "/shop?category=t-shirts" },
                      { label: "Special Offers", path: "/offers" },
                    ].map((preset) => (
                      <button
                        key={preset.path}
                        type="button"
                        onClick={() => setCtaUrl(preset.path)}
                        className={`text-[10px] font-bold px-2 py-0.5 rounded-md border transition-colors ${
                          ctaUrl === preset.path
                            ? "border-primary bg-primary text-on-primary"
                            : "border-outline-variant/40 bg-surface-container hover:bg-surface-container-high text-on-surface-variant"
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Position, Order, Status */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-outline-variant/20">
                  <div>
                    <label className="block text-xs font-label-caps uppercase text-on-surface mb-1">Position</label>
                    <select
                      value={position}
                      onChange={(e) => setPosition(e.target.value)}
                      className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-2.5 text-xs font-bold text-on-surface outline-none focus:border-primary"
                    >
                      <option value="HERO">Hero Slide</option>
                      <option value="PROMOTIONAL_TILE">Promo Tile</option>
                      <option value="ANNOUNCEMENT_BAR">Announcement Bar</option>
                      <option value="FEATURED_BANNER">Featured Banner</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-label-caps uppercase text-on-surface mb-1">Display Order</label>
                    <input
                      type="number"
                      min="0"
                      value={displayOrder}
                      onChange={(e) => setDisplayOrder(Number(e.target.value))}
                      className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-2.5 text-xs font-bold text-on-surface outline-none focus:border-primary font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-label-caps uppercase text-on-surface mb-1">Status</label>
                    <select
                      value={status}
                      onChange={(e) => setStatus(e.target.value)}
                      className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-2.5 text-xs font-bold text-on-surface outline-none focus:border-primary"
                    >
                      <option value="ACTIVE">Active (Live)</option>
                      <option value="DRAFT">Draft</option>
                      <option value="PAUSED">Paused</option>
                    </select>
                  </div>
                </div>
                {/* Text Styling & Contrast Switcher */}
                <div className="rounded-xl border border-outline-variant/30 bg-surface-container-low/40 p-4 space-y-3.5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    {/* Text Color */}
                    <div>
                      <label className="block text-xs font-label-caps uppercase text-on-surface mb-1.5 font-bold">
                        Text Color
                      </label>
                      <div className="grid grid-cols-2 gap-1.5 bg-surface-container p-1 rounded-xl border border-outline-variant/40">
                        <button
                          type="button"
                          onClick={() => setTextColor("LIGHT")}
                          className={`flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                            textColor === "LIGHT"
                              ? "bg-surface-container-lowest text-primary shadow-xs"
                              : "text-on-surface-variant hover:text-on-surface"
                          }`}
                        >
                          <Sun className="w-3.5 h-3.5 text-amber-500" />
                          <span>White</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setTextColor("DARK")}
                          className={`flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-bold transition-all ${
                            textColor === "DARK"
                              ? "bg-surface-container-lowest text-primary shadow-xs"
                              : "text-on-surface-variant hover:text-on-surface"
                          }`}
                        >
                          <Moon className="w-3.5 h-3.5 text-zinc-700" />
                          <span>Dark</span>
                        </button>
                      </div>
                    </div>

                    {/* Text Alignment */}
                    <div>
                      <label className="block text-xs font-label-caps uppercase text-on-surface mb-1.5 font-bold">
                        Alignment
                      </label>
                      <div className="grid grid-cols-3 gap-1.5 bg-surface-container p-1 rounded-xl border border-outline-variant/40">
                        <button
                          type="button"
                          onClick={() => setTextAlignment("LEFT")}
                          className={`flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                            textAlignment === "LEFT"
                              ? "bg-surface-container-lowest text-primary shadow-xs"
                              : "text-on-surface-variant hover:text-on-surface"
                          }`}
                          title="Left Align"
                        >
                          <AlignLeft className="w-3.5 h-3.5" />
                          <span>Left</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setTextAlignment("CENTER")}
                          className={`flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                            textAlignment === "CENTER"
                              ? "bg-surface-container-lowest text-primary shadow-xs"
                              : "text-on-surface-variant hover:text-on-surface"
                          }`}
                          title="Center Align"
                        >
                          <AlignCenter className="w-3.5 h-3.5" />
                          <span>Center</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setTextAlignment("RIGHT")}
                          className={`flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-bold transition-all ${
                            textAlignment === "RIGHT"
                              ? "bg-surface-container-lowest text-primary shadow-xs"
                              : "text-on-surface-variant hover:text-on-surface"
                          }`}
                          title="Right Align"
                        >
                          <AlignRight className="w-3.5 h-3.5" />
                          <span>Right</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Overlay Contrast */}
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="text-xs font-label-caps uppercase text-on-surface font-bold">
                        Overlay Contrast Strength
                      </label>
                      <span className="text-[10px] font-mono text-on-surface-variant">
                        {overlayStrength === "NONE" ? "0% (Raw Image)" : overlayStrength === "LIGHT" ? "30% (Subtle)" : overlayStrength === "MEDIUM" ? "60% (Balanced)" : "85% (High Contrast)"}
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-1.5 bg-surface-container p-1 rounded-xl border border-outline-variant/40">
                      {(["NONE", "LIGHT", "MEDIUM", "HEAVY"] as const).map((strength) => (
                        <button
                          key={strength}
                          type="button"
                          onClick={() => setOverlayStrength(strength)}
                          className={`py-1.5 rounded-lg text-xs font-bold transition-all ${
                            overlayStrength === strength
                              ? "bg-surface-container-lowest text-primary shadow-xs"
                              : "text-on-surface-variant hover:text-on-surface"
                          }`}
                        >
                          {strength}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Target Audience Segment */}
                  <div>
                    <label className="block text-xs font-label-caps uppercase text-on-surface mb-1 font-bold">
                      Target Audience Segment
                    </label>
                    <div className="grid grid-cols-3 gap-1.5 bg-surface-container p-1 rounded-xl border border-outline-variant/40">
                      {(
                        [
                          { id: "ALL", label: "All Visitors" },
                          { id: "RETAIL", label: "Retail Only" },
                          { id: "B2B_CUSTOM", label: "B2B / Custom Print" },
                        ] as const
                      ).map((aud) => (
                        <button
                          key={aud.id}
                          type="button"
                          onClick={() => setTargetAudience(aud.id)}
                          className={`py-1.5 px-1 rounded-lg text-xs font-bold transition-all text-center truncate ${
                            targetAudience === aud.id
                              ? "bg-surface-container-lowest text-primary shadow-xs"
                              : "text-on-surface-variant hover:text-on-surface"
                          }`}
                        >
                          {aud.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Advanced Options (Mobile Image & Scheduling) */}
                <div className="pt-2 border-t border-outline-variant/20">
                  <button
                    type="button"
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    className="flex items-center gap-1.5 text-xs font-bold text-on-surface-variant hover:text-on-surface transition-colors"
                  >
                    <span>Advanced Options (Mobile Image & Schedule)</span>
                    {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>

                  {showAdvanced && (
                    <div className="mt-3 p-4 rounded-xl border border-outline-variant/30 bg-surface-container-low/30 space-y-4">
                      {/* Mobile Image */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-xs font-label-caps uppercase text-on-surface flex items-center gap-1.5">
                            <Smartphone className="w-3.5 h-3.5 text-on-surface-variant" />
                            <span>Mobile Image (Optional)</span>
                          </label>
                          <div className="flex gap-1 text-[10px] font-bold">
                            <button
                              type="button"
                              onClick={() => setMobileImageTab("upload")}
                              className={`px-2 py-0.5 rounded ${mobileImageTab === "upload" ? "bg-primary text-white" : "text-on-surface-variant"}`}
                            >
                              Upload
                            </button>
                            <button
                              type="button"
                              onClick={() => setMobileImageTab("url")}
                              className={`px-2 py-0.5 rounded ${mobileImageTab === "url" ? "bg-primary text-white" : "text-on-surface-variant"}`}
                            >
                              URL
                            </button>
                          </div>
                        </div>

                        {mobileImageTab === "upload" ? (
                          <div>
                            <input
                              ref={mobileFileInputRef}
                              type="file"
                              accept="image/*"
                              onChange={(e) => {
                                if (e.target.files?.[0]) handleFileUpload(e.target.files[0], true);
                              }}
                              className="hidden"
                            />
                            {mobileImage ? (
                              <div className="flex items-center justify-between p-2 rounded-lg border border-outline-variant bg-surface-container text-xs">
                                <span className="font-mono truncate">{mobileImage}</span>
                                <button
                                  type="button"
                                  onClick={() => setMobileImage("")}
                                  className="text-error font-bold ml-2"
                                >
                                  Remove
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => mobileFileInputRef.current?.click()}
                                disabled={isUploadingMobile}
                                className="w-full py-2.5 rounded-lg border border-dashed border-outline-variant text-xs font-bold text-on-surface hover:bg-surface-container transition-colors"
                              >
                                {isUploadingMobile ? "Uploading Mobile Asset..." : "+ Upload Mobile-Specific Image (e.g. 750 × 1000 px)"}
                              </button>
                            )}
                          </div>
                        ) : (
                          <input
                            type="text"
                            value={mobileImage}
                            onChange={(e) => setMobileImage(e.target.value)}
                            className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-2.5 text-xs font-mono text-on-surface"
                            placeholder="https://..."
                          />
                         )}
                      </div>

                      {/* Date Schedule */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-outline-variant/20">
                        <div>
                          <label className="block text-xs font-label-caps uppercase text-on-surface mb-1 flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5 text-on-surface-variant" />
                            <span>Publish Date (Starts At)</span>
                          </label>
                          <input
                            type="datetime-local"
                            value={startsAt}
                            onChange={(e) => setStartsAt(e.target.value)}
                            className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-2.5 text-xs text-on-surface"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-label-caps uppercase text-on-surface mb-1 flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5 text-on-surface-variant" />
                            <span>Expiry Date (Ends At)</span>
                          </label>
                          <input
                            type="datetime-local"
                            value={endsAt}
                            onChange={(e) => setEndsAt(e.target.value)}
                            className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-2.5 text-xs text-on-surface"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Live Storefront Preview Column */}
              <div className="lg:col-span-5 flex flex-col space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-label-caps uppercase text-on-surface font-bold flex items-center gap-1.5">
                    <Eye className="w-4 h-4 text-primary" />
                    <span>Live Storefront Preview</span>
                  </span>
                  <span
                    className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                      status === "ACTIVE" ? "bg-emerald-600 text-white" : "bg-zinc-600 text-white"
                    }`}
                  >
                    {status}
                  </span>
                </div>

                {/* Preview Frame */}
                <div className="relative rounded-2xl overflow-hidden border border-outline-variant/40 bg-neutral-950 text-white shadow-lg flex flex-col justify-end p-5 min-h-[260px] select-none">
                  {/* Background Mockup Image */}
                  {image ? (
                    <img
                      src={image}
                      alt="Live Preview"
                      className="absolute inset-0 w-full h-full object-cover opacity-65"
                    />
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-neutral-900 border border-neutral-800">
                      <ImageIcon className="w-10 h-10 text-neutral-600 mb-2" />
                      <p className="text-xs font-bold text-neutral-400">Upload or paste an image to preview</p>
                      <p className="text-[10px] text-neutral-500 mt-1 font-mono">{position}</p>
                    </div>
                  )}

                  {/* Dynamic Gradient Overlay */}
                  {image && overlayStrength !== "NONE" && (
                    <div
                      className={`absolute inset-0 pointer-events-none transition-all ${
                        textColor === "DARK"
                          ? overlayStrength === "LIGHT"
                            ? "bg-gradient-to-t from-white/40 via-white/15 to-transparent"
                            : overlayStrength === "MEDIUM"
                            ? "bg-gradient-to-t from-white/85 via-white/45 to-transparent"
                            : "bg-gradient-to-t from-white/95 via-white/70 to-white/30"
                          : overlayStrength === "LIGHT"
                          ? "bg-gradient-to-t from-black/40 via-black/15 to-transparent"
                          : overlayStrength === "MEDIUM"
                          ? "bg-gradient-to-t from-black/85 via-black/40 to-transparent"
                          : "bg-gradient-to-t from-black/95 via-black/70 to-black/30"
                      }`}
                    />
                  )}

                  {/* Content Overlay */}
                  <div
                    className={`relative z-10 space-y-1.5 flex flex-col ${
                      textAlignment === "CENTER"
                        ? "items-center text-center"
                        : textAlignment === "RIGHT"
                        ? "items-end text-right"
                        : "items-start text-left"
                    } ${textColor === "DARK" ? "text-neutral-900" : "text-white"}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-primary text-[10px] font-bold uppercase tracking-wider text-white">
                        {position === "HERO"
                          ? "Hero Carousel"
                          : position === "ANNOUNCEMENT_BAR"
                          ? "Top Alert"
                          : position}
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-black/60 text-white font-mono text-[9px]">
                        {targetAudience}
                      </span>
                      {displayOrder > 0 && (
                        <span className="text-[10px] font-mono opacity-70">Order #{displayOrder}</span>
                      )}
                    </div>

                    <h4 className="font-headline-sm text-lg sm:text-xl font-black uppercase tracking-tight line-clamp-2">
                      {title || "YOUR HEADLINE HERE"}
                    </h4>

                    {subtitle && (
                      <p className={`text-xs font-body-sm line-clamp-2 leading-relaxed ${textColor === "DARK" ? "text-neutral-700" : "text-neutral-300"}`}>
                        {subtitle}
                      </p>
                    )}

                    {ctaLabel && (
                      <div className="pt-2">
                        <span className={`inline-flex items-center gap-1 px-4 py-2 rounded-xl font-bold text-xs uppercase tracking-wider shadow-sm ${textColor === "DARK" ? "bg-black text-white" : "bg-white text-black"}`}>
                          <span>{ctaLabel}</span>
                          <span className="text-sm font-black">&rarr;</span>
                        </span>
                      </div>
                    )}
                  </div>
                </div>
                {/* Preview Meta Info */}
                <div className="rounded-xl border border-outline-variant/20 bg-surface-container-low p-3 space-y-1.5 text-xs text-on-surface-variant">
                  <div className="flex justify-between items-center">
                    <span className="font-medium">Target Destination:</span>
                    <span className="font-mono font-bold text-primary">{ctaUrl || "/shop"}</span>
                  </div>
                  {startsAt && (
                    <div className="flex justify-between items-center text-[11px]">
                      <span>Schedule Start:</span>
                      <span className="font-mono">{new Date(startsAt).toLocaleString()}</span>
                    </div>
                  )}
                  {endsAt && (
                    <div className="flex justify-between items-center text-[11px]">
                      <span>Schedule End:</span>
                      <span className="font-mono">{new Date(endsAt).toLocaleString()}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 border-t border-outline-variant/20 bg-surface-container-low flex justify-between items-center shrink-0">
              <p className="text-xs text-on-surface-variant hidden sm:block">
                {!title.trim() ? "Title is required" : !image.trim() ? "Image is required" : "Ready to save"}
              </p>
              <div className="flex items-center gap-3 ml-auto">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-5 py-2.5 border border-outline-variant font-label-caps text-xs font-bold rounded-xl text-on-surface-variant hover:bg-surface-container transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveBanner}
                  disabled={isSubmitting || !title.trim() || !image.trim()}
                  className="inline-flex items-center gap-2 px-6 py-2.5 bg-primary text-on-primary font-label-caps text-xs font-bold rounded-xl hover:bg-primary/90 transition-colors shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>{isSubmitting ? "Saving..." : editingBannerId ? "Update Banner" : "Save Banner"}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
