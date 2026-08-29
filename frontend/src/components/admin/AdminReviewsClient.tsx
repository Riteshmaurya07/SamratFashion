"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

interface AdminReviewItem {
  _id: string;
  rating: number;
  title?: string;
  body: string;
  photos: string[];
  status: string;
  createdAt: string;
  userId?: {
    _id: string;
    name: string;
    email: string;
  };
  productId?: {
    _id: string;
    name: string;
    images: string[];
  };
}

export default function AdminReviewsClient() {
  const router = useRouter();

  const [reviews, setReviews] = useState<AdminReviewItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState("All");
  const [ratingFilter, setRatingFilter] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");

  const [isUpdating, setIsUpdating] = useState(false);
  const [toast, setToast] = useState<{ text: string; type: "success" | "error" } | null>(null);

  // Fetch Admin Reviews
  useEffect(() => {
    async function fetchReviews() {
      setIsLoading(true);
      setError(null);
      try {
        const res = await api.get("/admin/reviews", {
          params: {
            status: statusFilter !== "All" ? statusFilter : undefined,
            rating: ratingFilter !== "All" ? ratingFilter : undefined,
            q: searchQuery || undefined,
          },
        });
        if (res.data?.success) {
          setReviews(res.data.data);
        }
      } catch (err: any) {
        if (err.response?.status === 403 || err.response?.status === 401) {
          router.push("/admin/login");
          return;
        }
        setError(err.response?.data?.message || "Failed to load admin reviews.");
      } finally {
        setIsLoading(false);
      }
    }
    fetchReviews();
  }, [statusFilter, ratingFilter, searchQuery, router]);

  // Moderate Review (Approve or Reject)
  const handleModerate = async (id: string, newStatus: "APPROVED" | "REJECTED") => {
    setIsUpdating(true);
    setToast(null);
    try {
      const res = await api.put(`/admin/reviews/${id}/status`, { status: newStatus });
      if (res.data?.success) {
        setReviews((prev) =>
          prev.map((r) => (r._id === id ? { ...r, status: newStatus } : r))
        );
        setToast({ text: `Review status updated to ${newStatus}`, type: "success" });
      }
    } catch (err: any) {
      setToast({ text: err.response?.data?.message || "Moderation update failed.", type: "error" });
    } finally {
      setIsUpdating(false);
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
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="font-display-lg text-3xl md:text-4xl font-extrabold text-on-surface tracking-tight">
            Customer Reviews Moderation
          </h1>
          <p className="font-body-md text-on-surface-variant mt-1">
            Review customer product ratings, verify photos, and approve or reject submissions.
          </p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant mb-6 shadow-sm flex flex-wrap gap-4 items-center">
        <div className="relative flex-1 min-w-[280px]">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-sm">search</span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-surface-container-low border border-outline-variant rounded-lg font-body-sm text-sm outline-none focus:border-primary"
            placeholder="Search by customer, product, review text..."
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-xs font-bold text-on-surface outline-none"
        >
          <option value="All">Status: All</option>
          <option value="PENDING">Pending Moderation</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
        </select>

        <select
          value={ratingFilter}
          onChange={(e) => setRatingFilter(e.target.value)}
          className="bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-xs font-bold text-on-surface outline-none"
        >
          <option value="All">Rating: All Stars</option>
          <option value="5">5 Stars</option>
          <option value="4">4 Stars</option>
          <option value="3">3 Stars</option>
          <option value="2">2 Stars</option>
          <option value="1">1 Star</option>
        </select>
      </div>

      {isLoading && (
        <div className="p-8 text-center font-bold text-on-surface-variant">Loading reviews for moderation...</div>
      )}

      {error && (
        <div className="p-4 bg-error-container text-on-error-container rounded-xl text-center font-bold mb-6">{error}</div>
      )}

      {/* Admin Moderation Data Table */}
      {!isLoading && !error && (
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface-container-low border-b border-outline-variant">
                  <th className="p-4 font-label-caps text-xs text-outline uppercase">Product</th>
                  <th className="p-4 font-label-caps text-xs text-outline uppercase">Customer</th>
                  <th className="p-4 font-label-caps text-xs text-outline uppercase">Rating & Content</th>
                  <th className="p-4 font-label-caps text-xs text-outline uppercase">Photos</th>
                  <th className="p-4 font-label-caps text-xs text-outline uppercase">Status</th>
                  <th className="p-4 font-label-caps text-xs text-outline uppercase text-right">Moderation Actions</th>
                </tr>
              </thead>
              <tbody className="font-body-sm text-sm">
                {reviews.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-on-surface-variant">
                      No reviews found matching the selected filters.
                    </td>
                  </tr>
                ) : (
                  reviews.map((rev) => (
                    <tr key={rev._id} className="border-b border-outline-variant hover:bg-surface-container-low transition-colors">
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-surface-container rounded-md overflow-hidden flex-shrink-0">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={rev.productId?.images?.[0] || "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=500"} alt="Product" className="w-full h-full object-cover" />
                          </div>
                          <span className="font-bold text-on-surface line-clamp-1">{rev.productId?.name || "Product"}</span>
                        </div>
                      </td>
                      <td className="p-4 font-medium text-on-surface-variant">
                        {rev.userId?.name || "Customer"}
                      </td>
                      <td className="p-4 max-w-md">
                        <div className="flex items-center gap-1 mb-1">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <span key={star} className={`material-symbols-outlined text-xs ${star <= rev.rating ? "text-amber-500" : "text-outline"}`}>
                              star
                            </span>
                          ))}
                        </div>
                        {rev.title && <p className="font-bold text-xs text-on-surface">{rev.title}</p>}
                        <p className="text-xs text-on-surface-variant line-clamp-2">{rev.body}</p>
                      </td>
                      <td className="p-4">
                        {rev.photos && rev.photos.length > 0 ? (
                          <div className="flex gap-1.5">
                            {rev.photos.map((p, i) => (
                              <div key={i} className="w-8 h-8 rounded border border-outline-variant overflow-hidden">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={p} alt="Attachment" className="w-full h-full object-cover" />
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-outline italic">None</span>
                        )}
                      </td>
                      <td className="p-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-1 rounded text-xs font-bold uppercase tracking-wider ${
                            rev.status === "APPROVED"
                              ? "bg-emerald-100 text-emerald-800"
                              : rev.status === "REJECTED"
                              ? "bg-red-100 text-red-800"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {rev.status}
                        </span>
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => handleModerate(rev._id, "REJECTED")}
                            disabled={isUpdating || rev.status === "REJECTED"}
                            className="px-3 py-1.5 border border-red-500 text-red-600 font-label-caps text-xs font-bold rounded-lg hover:bg-red-50 disabled:opacity-40"
                          >
                            Reject
                          </button>
                          <button
                            onClick={() => handleModerate(rev._id, "APPROVED")}
                            disabled={isUpdating || rev.status === "APPROVED"}
                            className="px-3 py-1.5 bg-emerald-600 text-white font-label-caps text-xs font-bold rounded-lg hover:bg-emerald-700 disabled:opacity-40"
                          >
                            Approve
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
      )}
    </div>
  );
}
