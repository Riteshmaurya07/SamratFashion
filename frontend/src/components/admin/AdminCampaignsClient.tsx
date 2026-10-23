"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

interface CampaignItem {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  discountTag?: string;
  status: string;
  startsAt?: string;
  endsAt?: string;
  createdAt: string;
  bannerIds?: Array<{ image: string }>;
  couponId?: { code: string; discountValue: number; discountType: string };
}

export default function AdminCampaignsClient() {
  const router = useRouter();

  const [campaigns, setCampaigns] = useState<CampaignItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState("All");
  // Campaign Modal & State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [discountTag, setDiscountTag] = useState("Up to 40% OFF");
  const [selectedCouponId, setSelectedCouponId] = useState("");
  const [availableCoupons, setAvailableCoupons] = useState<Array<{ _id: string; code: string; discountType: string; discountValue: number }>>([]);
  const [status, setStatus] = useState("ACTIVE");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState<{ text: string; type: "success" | "error" } | null>(null);

  // Fetch available coupons for linking
  useEffect(() => {
    async function fetchCoupons() {
      try {
        const res = await api.get("/admin/coupons?limit=50");
        if (res.data?.success && res.data.data?.items) {
          setAvailableCoupons(res.data.data.items);
        }
      } catch {
        // Fallback
      }
    }
    fetchCoupons();
  }, []);
  // Fetch Campaigns
  useEffect(() => {
    async function fetchCampaigns() {
      setIsLoading(true);
      setError(null);
      try {
        const res = await api.get("/admin/cms/campaigns", {
          params: { status: statusFilter !== "All" ? statusFilter : undefined },
        });
        if (res.data?.success) {
          setCampaigns(res.data.data);
        }
      } catch (err: any) {
        if (err.response?.status === 403 || err.response?.status === 401) {
          router.push("/admin/login");
          return;
        }
        setError(err.response?.data?.message || "Failed to load marketing campaigns.");
      } finally {
        setIsLoading(false);
      }
    }
    fetchCampaigns();
  }, [statusFilter, router]);

  // Open Create Modal
  const handleOpenCreateModal = () => {
    setEditingCampaignId(null);
    setName("");
    setDescription("");
    setDiscountTag("Up to 40% OFF");
    setSelectedCouponId("");
    setStatus("ACTIVE");
    setIsModalOpen(true);
  };

  // Open Edit Modal
  const handleOpenEditModal = (c: CampaignItem) => {
    setEditingCampaignId(c._id);
    setName(c.name);
    setDescription(c.description || "");
    setDiscountTag(c.discountTag || "Special Offer");
    const couponRef = c.couponId as unknown;
    if (couponRef && typeof couponRef === "object" && "_id" in couponRef && typeof (couponRef as { _id: string })._id === "string") {
      setSelectedCouponId((couponRef as { _id: string })._id);
    } else if (typeof couponRef === "string") {
      setSelectedCouponId(couponRef);
    } else {
      setSelectedCouponId("");
    }
    setStatus(c.status);
    setIsModalOpen(true);
  };

  // Save Campaign (Create or Update)
  const handleSaveCampaign = async () => {
    if (!name.trim()) return;
    setIsSubmitting(true);
    setToast(null);

    const payload = {
      name: name.trim(),
      description: description.trim() || undefined,
      discountTag: discountTag.trim() || undefined,
      couponId: selectedCouponId || undefined,
      status,
    };

    try {
      if (editingCampaignId) {
        const res = await api.put(`/admin/cms/campaigns/${editingCampaignId}`, payload);
        if (res.data?.success) {
          setCampaigns((prev) => prev.map((c) => (c._id === editingCampaignId ? res.data.data : c)));
          setIsModalOpen(false);
          setToast({ text: "Campaign updated successfully!", type: "success" });
        }
      } else {
        const res = await api.post("/admin/cms/campaigns", payload);
        if (res.data?.success) {
          setCampaigns([res.data.data, ...campaigns]);
          setIsModalOpen(false);
          setToast({ text: "Marketing campaign created successfully!", type: "success" });
        }
      }
    } catch (err: unknown) {
      let message = "Failed to save campaign.";
      if (err && typeof err === "object" && "response" in err) {
        const r = (err as { response?: { data?: { message?: string } } }).response;
        if (r?.data?.message) message = r.data.message;
      }
      setToast({ text: message, type: "error" });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Delete Campaign
  const handleDeleteCampaign = async (id: string, campName: string) => {
    if (!confirm(`Are you sure you want to delete campaign "${campName}"?`)) return;
    setToast(null);
    try {
      const res = await api.delete(`/admin/cms/campaigns/${id}`);
      if (res.data?.success) {
        setCampaigns((prev) => prev.filter((c) => c._id !== id));
        setToast({ text: "Campaign deleted successfully.", type: "success" });
      }
    } catch (err: unknown) {
      let message = "Failed to delete campaign.";
      if (err && typeof err === "object" && "response" in err) {
        const r = (err as { response?: { data?: { message?: string } } }).response;
        if (r?.data?.message) message = r.data.message;
      }
      setToast({ text: message, type: "error" });
    }
  };

  // Toggle Campaign Status
  const handleToggleStatus = async (id: string, newStatus: string) => {
    setToast(null);
    try {
      const res = await api.patch(`/admin/cms/campaigns/${id}/status`, { status: newStatus });
      if (res.data?.success) {
        setCampaigns((prev) => prev.map((c) => (c._id === id ? { ...c, status: newStatus } : c)));
        setToast({ text: `Campaign status updated to ${newStatus}`, type: "success" });
      }
    } catch (err: any) {
      setToast({ text: err.response?.data?.message || "Failed to update campaign status.", type: "error" });
    }
  };

  const activeCount = campaigns.filter((c) => c.status === "ACTIVE").length;
  const scheduledCount = campaigns.filter((c) => c.status === "SCHEDULED").length;
  const draftCount = campaigns.filter((c) => c.status === "DRAFT").length;

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

      {/* Header (Stitch Match) */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-10 gap-4">
        <div>
          <h1 className="font-headline-lg text-3xl md:text-5xl font-extrabold text-on-surface tracking-tight mb-2">
            Marketing Campaigns
          </h1>
          <p className="font-body-md text-on-surface-variant max-w-2xl">
            Create and manage promotional campaigns, discount banners, and seasonal drops across the storefront.
          </p>
        </div>
        <button
          onClick={handleOpenCreateModal}
          className="px-6 py-3 bg-primary text-on-primary font-label-caps text-xs font-bold rounded-xl hover:bg-primary-container transition-colors shadow-md flex items-center gap-2 self-start md:self-auto"
        >
          <span className="material-symbols-outlined text-lg">add_circle</span>
          Create Campaign
        </button>
      </div>

      {/* KPI Summary Cards (Stitch Screen Match) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-10">
        <div className="bg-surface-container-lowest p-6 rounded-2xl border border-outline-variant/20 shadow-sm">
          <p className="text-xs font-label-caps text-on-surface-variant uppercase font-bold mb-1">Total Campaigns</p>
          <p className="text-3xl font-extrabold text-on-surface">{campaigns.length}</p>
        </div>
        <div className="bg-surface-container-lowest p-6 rounded-2xl border border-outline-variant/20 shadow-sm">
          <p className="text-xs font-label-caps text-on-surface-variant uppercase font-bold mb-1">Active</p>
          <p className="text-3xl font-extrabold text-emerald-600">{activeCount}</p>
        </div>
        <div className="bg-surface-container-lowest p-6 rounded-2xl border border-outline-variant/20 shadow-sm">
          <p className="text-xs font-label-caps text-on-surface-variant uppercase font-bold mb-1">Scheduled</p>
          <p className="text-3xl font-extrabold text-amber-600">{scheduledCount}</p>
        </div>
        <div className="bg-surface-container-lowest p-6 rounded-2xl border border-outline-variant/20 shadow-sm">
          <p className="text-xs font-label-caps text-on-surface-variant uppercase font-bold mb-1">Drafts</p>
          <p className="text-3xl font-extrabold text-on-surface-variant">{draftCount}</p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant mb-8 shadow-sm flex flex-wrap gap-4 items-center justify-between">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-surface-container-low border border-outline-variant rounded-lg px-4 py-2 text-xs font-bold text-on-surface outline-none"
        >
          <option value="All">Status: All Campaigns</option>
          <option value="ACTIVE">Active Only</option>
          <option value="SCHEDULED">Scheduled Only</option>
          <option value="DRAFT">Drafts Only</option>
        </select>
      </div>

      {isLoading && (
        <div className="p-8 text-center font-bold text-on-surface-variant">Loading marketing campaigns...</div>
      )}

      {error && (
        <div className="p-4 bg-error-container text-on-error-container rounded-xl text-center font-bold mb-6">{error}</div>
      )}

      {/* Campaign Cards Grid (Stitch Screen Match) */}
      {!isLoading && !error && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {campaigns.length === 0 ? (
            <div className="col-span-3 p-12 text-center bg-surface-container-lowest rounded-2xl border border-outline-variant/20">
              <span className="material-symbols-outlined text-4xl text-outline mb-2">campaign</span>
              <p className="font-bold text-on-surface">No campaigns created yet.</p>
              <p className="text-xs text-on-surface-variant mt-1">Click "Create Campaign" to launch a promotional marketing campaign.</p>
            </div>
          ) : (
            campaigns.map((c) => (
              <div
                key={c._id}
                className="bg-surface-container-lowest border border-outline-variant/20 rounded-2xl overflow-hidden shadow-sm flex flex-col justify-between hover:shadow-md transition-shadow"
              >
                <div>
                  <div className="h-44 bg-surface-container-low relative overflow-hidden flex items-center justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={c.bannerIds?.[0]?.image || "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=500"}
                      alt={c.name}
                      className="w-full h-full object-cover"
                    />
                    <span
                      className={`absolute top-4 left-4 px-3 py-1 rounded-full font-label-caps text-[10px] font-bold uppercase tracking-wider ${
                        c.status === "ACTIVE"
                          ? "bg-emerald-600 text-white"
                          : c.status === "SCHEDULED"
                          ? "bg-amber-600 text-white"
                          : "bg-surface-container-high text-on-surface"
                      }`}
                    >
                      {c.status}
                    </span>
                  </div>

                  <div className="p-6">
                    <h3 className="font-headline-sm text-lg font-bold text-on-surface mb-2">{c.name}</h3>
                    {c.discountTag && (
                      <span className="inline-block bg-primary/10 text-primary font-bold text-xs px-2.5 py-1 rounded mb-3">
                        {c.discountTag}
                      </span>
                    )}
                    {c.description && <p className="text-xs text-on-surface-variant line-clamp-2 mb-3">{c.description}</p>}
                    {c.couponId && (
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-primary/10 text-primary font-mono text-xs font-bold mb-3 border border-primary/20">
                        <span className="material-symbols-outlined text-sm">sell</span>
                        <span>
                          Coupon: {typeof c.couponId === "object" && "code" in c.couponId ? (c.couponId as { code: string }).code : "Active"}
                        </span>
                      </div>
                    )}
                    <p className="text-xs text-on-surface-variant font-label-caps flex items-center gap-1">
                      <span className="material-symbols-outlined text-sm">calendar_today</span>
                      Created {new Date(c.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                <div className="p-4 border-t border-outline-variant/20 bg-surface-container-low flex justify-between items-center gap-2">
                  <div className="flex items-center gap-2">
                    {c.status === "ACTIVE" ? (
                      <button
                        onClick={() => handleToggleStatus(c._id, "PAUSED")}
                        className="px-3 py-1.5 border border-amber-600 text-amber-700 font-label-caps text-xs font-bold rounded-lg hover:bg-amber-50"
                      >
                        Pause
                      </button>
                    ) : (
                      <button
                        onClick={() => handleToggleStatus(c._id, "ACTIVE")}
                        className="px-3 py-1.5 bg-emerald-600 text-white font-label-caps text-xs font-bold rounded-lg hover:bg-emerald-700"
                      >
                        Activate
                      </button>
                    )}
                    <button
                      onClick={() => handleOpenEditModal(c)}
                      className="p-1.5 text-on-surface-variant hover:text-primary hover:bg-surface-container rounded-lg"
                      title="Edit Campaign"
                    >
                      <span className="material-symbols-outlined text-lg">edit</span>
                    </button>
                  </div>

                  <button
                    onClick={() => handleDeleteCampaign(c._id, c.name)}
                    className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg"
                    title="Delete Campaign"
                  >
                    <span className="material-symbols-outlined text-lg">delete</span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Create Campaign Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-on-background/50 backdrop-blur-sm">
          <div className="bg-surface-container-lowest w-full max-w-lg rounded-2xl shadow-2xl border border-outline-variant/20 overflow-hidden flex flex-col">
            <div className="p-6 border-b border-outline-variant/10 flex justify-between items-center bg-surface-container-low">
              <h3 className="font-bold text-lg text-on-surface">
                {editingCampaignId ? "Edit Marketing Campaign" : "Create Marketing Campaign"}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-surface-container rounded-full text-on-surface-variant">
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-label-caps uppercase text-on-surface mb-1">Campaign Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-3 text-sm focus:outline-none focus:border-primary"
                  placeholder="e.g. Summer Streetwear Sale 2026"
                />
              </div>

              <div>
                <label className="block text-xs font-label-caps uppercase text-on-surface mb-1">Discount Tagline</label>
                <input
                  type="text"
                  value={discountTag}
                  onChange={(e) => setDiscountTag(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-3 text-sm focus:outline-none focus:border-primary"
                  placeholder="e.g. Up to 40% OFF or Flat ₹500 OFF"
                />
              </div>

              <div>
                <label className="block text-xs font-label-caps uppercase text-on-surface mb-1">Linked Coupon Voucher (Optional)</label>
                <select
                  value={selectedCouponId}
                  onChange={(e) => setSelectedCouponId(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-3 text-xs font-bold text-on-surface"
                >
                  <option value="">No linked coupon (Announcement only)</option>
                  {availableCoupons.map((cp) => (
                    <option key={cp._id} value={cp._id}>
                      {cp.code} ({cp.discountType === "PERCENTAGE" ? `${cp.discountValue}% OFF` : `₹${cp.discountValue} OFF`})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-label-caps uppercase text-on-surface mb-1">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-3 text-sm focus:outline-none focus:border-primary resize-none"
                  placeholder="Campaign promotional details..."
                />
              </div>

              <div>
                <label className="block text-xs font-label-caps uppercase text-on-surface mb-1">Initial Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-3 text-xs font-bold text-on-surface"
                >
                  <option value="ACTIVE">Activate Now</option>
                  <option value="DRAFT">Save as Draft</option>
                </select>
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
                onClick={handleSaveCampaign}
                disabled={isSubmitting || !name.trim()}
                className="px-6 py-2.5 bg-primary text-on-primary font-label-caps text-xs font-bold rounded-xl hover:bg-primary-container transition-colors shadow-md disabled:opacity-50"
              >
                {isSubmitting ? "Saving..." : editingCampaignId ? "Update Campaign" : "Save Campaign"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
