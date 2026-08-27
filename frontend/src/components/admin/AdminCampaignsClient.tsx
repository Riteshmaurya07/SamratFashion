"use client";

import React, { useState, useEffect } from "react";
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

  // Create Campaign Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [discountTag, setDiscountTag] = useState("Up to 40% OFF");
  const [status, setStatus] = useState("ACTIVE");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState<{ text: string; type: "success" | "error" } | null>(null);

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

  // Create Campaign
  const handleCreateCampaign = async () => {
    if (!name.trim()) return;
    setIsSubmitting(true);
    setToast(null);

    try {
      const res = await api.post("/admin/cms/campaigns", {
        name: name.trim(),
        description: description.trim() || undefined,
        discountTag: discountTag.trim() || undefined,
        status,
      });

      if (res.data?.success) {
        setCampaigns([res.data.data, ...campaigns]);
        setIsModalOpen(false);
        setName("");
        setDescription("");
        setToast({ text: "Marketing campaign created successfully!", type: "success" });
      }
    } catch (err: any) {
      setToast({ text: err.response?.data?.message || "Failed to create campaign.", type: "error" });
    } finally {
      setIsSubmitting(false);
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
          onClick={() => setIsModalOpen(true)}
          className="px-6 py-3 bg-primary text-on-primary font-label-caps text-xs font-bold rounded-xl hover:bg-primary-container transition-colors shadow-md flex items-center gap-2"
        >
          <span className="material-symbols-outlined text-lg">add</span>
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
                    {/* eslint-disable-next-next/no-img-element */}
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
                    {c.description && <p className="text-xs text-on-surface-variant line-clamp-2 mb-4">{c.description}</p>}
                    <p className="text-xs text-on-surface-variant font-label-caps flex items-center gap-1">
                      <span className="material-symbols-outlined text-sm">calendar_today</span>
                      Created {new Date(c.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                <div className="p-4 border-t border-outline-variant/20 bg-surface-container-low flex justify-between gap-3">
                  {c.status === "ACTIVE" ? (
                    <button
                      onClick={() => handleToggleStatus(c._id, "PAUSED")}
                      className="w-full py-2 border border-amber-600 text-amber-700 font-label-caps text-xs font-bold rounded-xl hover:bg-amber-50"
                    >
                      Pause Campaign
                    </button>
                  ) : (
                    <button
                      onClick={() => handleToggleStatus(c._id, "ACTIVE")}
                      className="w-full py-2 bg-emerald-600 text-white font-label-caps text-xs font-bold rounded-xl hover:bg-emerald-700"
                    >
                      Activate Campaign
                    </button>
                  )}
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
              <h3 className="font-bold text-lg text-on-surface">Create Marketing Campaign</h3>
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
                onClick={handleCreateCampaign}
                disabled={isSubmitting || !name.trim()}
                className="px-6 py-2.5 bg-primary text-on-primary font-label-caps text-xs font-bold rounded-xl hover:bg-primary-container transition-colors shadow-md disabled:opacity-50"
              >
                {isSubmitting ? "Saving..." : "Save Campaign"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
