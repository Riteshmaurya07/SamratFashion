"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

interface QueueItem {
  _id: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  item?: {
    productName: string;
    selectedColor: string;
    selectedSize: string;
    quantity: number;
    customizationSnapshot?: {
      name: string;
      previewImage?: string;
      printLocations?: string[];
    };
  };
  product?: {
    name: string;
    sku: string;
    color: string;
    size: string;
  } | null;
  status: string;
  priority: string;
  printLocations: string[];
  printMethod: string;
  createdAt: string;
  updatedAt: string;
}

interface AnalyticsData {
  total: number;
  pendingReview: number;
  readyForPrint: number;
  printing: number;
  qualityCheck: number;
  printed: number;
  completed: number;
  rejected: number;
  jobsToday: number;
  completedToday: number;
}

export default function AdminProductionQueueClient() {
  const router = useRouter();

  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter & Sorting States
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [priorityFilter, setPriorityFilter] = useState("All");
  const [sortBy, setSortBy] = useState("newest");

  // Selection & Batch Action States
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isExportingBatch, setIsExportingBatch] = useState(false);
  const [isUpdatingPriority, setIsUpdatingPriority] = useState(false);
  const [toast, setToast] = useState<{ text: string; type: "success" | "error" } | null>(null);

  // Fetch Production Queue & Aggregated Analytics
  useEffect(() => {
    async function fetchData() {
      setIsLoading(true);
      setError(null);
      try {
        const [queueRes, analyticsRes] = await Promise.all([
          api.get("/admin/production/queue", {
            params: {
              q: searchQuery || undefined,
              status: statusFilter !== "All" ? statusFilter : undefined,
              priority: priorityFilter !== "All" ? priorityFilter : undefined,
              sortBy,
            },
          }),
          api.get("/admin/production/analytics"),
        ]);

        if (queueRes.data?.success) {
          setQueue(queueRes.data.data);
        }
        if (analyticsRes.data?.success) {
          setAnalytics(analyticsRes.data.data);
        }
      } catch (err: any) {
        if (err.response?.status === 403 || err.response?.status === 401) {
          router.push("/admin/login");
          return;
        }
        setError(err.response?.data?.message || "Failed to load production queue.");
      } finally {
        setIsLoading(false);
      }
    }
    fetchData();
  }, [searchQuery, statusFilter, priorityFilter, sortBy, router]);

  // Checkbox Select All Toggle
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(queue.map((q) => q._id));
    } else {
      setSelectedIds([]);
    }
  };

  const handleSelectRow = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
  };

  // Batch Update Priority
  const handleBatchPriority = async (newPriority: string) => {
    if (selectedIds.length === 0) return;
    setIsUpdatingPriority(true);
    setToast(null);
    try {
      const res = await api.put("/admin/production/priority/batch", {
        printJobIds: selectedIds,
        priority: newPriority,
      });

      if (res.data?.success) {
        setQueue((prev) =>
          prev.map((q) => (selectedIds.includes(q._id) ? { ...q, priority: newPriority } : q))
        );
        setToast({ text: `Updated priority to ${newPriority} for ${selectedIds.length} print jobs`, type: "success" });
      }
    } catch (err: any) {
      setToast({ text: err.response?.data?.message || "Batch priority update failed", type: "error" });
    } finally {
      setIsUpdatingPriority(false);
    }
  };

  // Batch Export ZIP Package Download
  const handleBatchExport = async () => {
    if (selectedIds.length === 0) return;
    setIsExportingBatch(true);
    setToast(null);
    try {
      const response = await api.post(
        "/admin/production/batch-export",
        { printJobIds: selectedIds },
        { responseType: "blob" }
      );

      const blob = new Blob([response.data], { type: "application/zip" });
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.setAttribute("download", `sf_print_batch_${Date.now()}.zip`);
      document.body.appendChild(link);
      link.click();
      link.remove();

      setToast({ text: `Downloaded ZIP artwork batch package for ${selectedIds.length} print jobs!`, type: "success" });
    } catch (err: any) {
      setToast({ text: err.response?.data?.message || "Batch export failed", type: "error" });
    } finally {
      setIsExportingBatch(false);
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

      {/* Header Section */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-8 gap-4">
        <div>
          <h1 className="font-display-lg text-3xl md:text-4xl font-extrabold text-on-surface tracking-tight">
            Production Queue & Operations
          </h1>
          <p className="font-body-md text-on-surface-variant mt-1">
            Real-time shop floor print job queue, aggregated analytics, and high-res batch artwork exporter.
          </p>
        </div>
        <div className="flex gap-3">
          <Link
            href="/admin/custom-orders"
            className="px-5 py-2.5 bg-surface-container-high border border-outline text-on-surface rounded-lg font-label-caps text-xs font-bold hover:bg-surface-container-highest transition-colors"
          >
            Custom Orders List
          </Link>
        </div>
      </div>

      {/* Aggregated Analytics KPI Cards (Stitch Screen Match) */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-8">
        <div className="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant shadow-sm">
          <p className="font-label-caps text-[10px] text-outline uppercase tracking-wider mb-1">Total Queue</p>
          <p className="font-headline-lg text-2xl font-bold text-on-surface">{analytics?.total || 0}</p>
        </div>
        <div className="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant border-l-4 border-l-amber-500 shadow-sm">
          <p className="font-label-caps text-[10px] text-outline uppercase tracking-wider mb-1">Pending Review</p>
          <p className="font-headline-lg text-2xl font-bold text-on-surface">{analytics?.pendingReview || 0}</p>
        </div>
        <div className="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant border-l-4 border-l-indigo-500 shadow-sm">
          <p className="font-label-caps text-[10px] text-outline uppercase tracking-wider mb-1">Ready for Print</p>
          <p className="font-headline-lg text-2xl font-bold text-on-surface">{analytics?.readyForPrint || 0}</p>
        </div>
        <div className="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant border-l-4 border-l-blue-600 shadow-sm">
          <p className="font-label-caps text-[10px] text-outline uppercase tracking-wider mb-1">Printing Now</p>
          <p className="font-headline-lg text-2xl font-bold text-on-surface">{analytics?.printing || 0}</p>
        </div>
        <div className="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant border-l-4 border-l-emerald-500 shadow-sm">
          <p className="font-label-caps text-[10px] text-outline uppercase tracking-wider mb-1">Jobs Created Today</p>
          <p className="font-headline-lg text-2xl font-bold text-on-surface">{analytics?.jobsToday || 0}</p>
        </div>
        <div className="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant border-l-4 border-l-teal-500 shadow-sm">
          <p className="font-label-caps text-[10px] text-outline uppercase tracking-wider mb-1">Completed Today</p>
          <p className="font-headline-lg text-2xl font-bold text-on-surface">{analytics?.completedToday || 0}</p>
        </div>
      </div>

      {/* Filter & Batch Actions Bar */}
      <div className="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant mb-6 shadow-sm flex flex-wrap gap-4 items-center justify-between">
        <div className="flex flex-wrap gap-3 items-center flex-1">
          <div className="relative min-w-[240px]">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-sm">search</span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-surface-container-low border border-outline-variant rounded-lg font-body-sm text-sm outline-none focus:border-primary"
              placeholder="Search by order ID, SKU, customer..."
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-xs font-bold text-on-surface outline-none"
          >
            <option value="All">Status: All</option>
            <option value="PENDING_REVIEW">Pending Review</option>
            <option value="READY_FOR_PRINT">Ready for Print</option>
            <option value="PRINTING">Printing</option>
            <option value="QUALITY_CHECK">Quality Check</option>
            <option value="PRINTED">Printed</option>
            <option value="COMPLETED">Completed</option>
          </select>

          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-xs font-bold text-on-surface outline-none"
          >
            <option value="All">Priority: All</option>
            <option value="HIGH">High Priority</option>
            <option value="MEDIUM">Medium Priority</option>
            <option value="LOW">Low Priority</option>
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-xs font-bold text-on-surface outline-none"
          >
            <option value="newest">Sort: Newest First</option>
            <option value="oldest">Sort: Oldest First</option>
            <option value="priority">Sort: By Priority</option>
            <option value="status">Sort: By Status</option>
          </select>
        </div>

        {/* Batch Operations Button Group */}
        {selectedIds.length > 0 && (
          <div className="flex items-center gap-3 bg-primary/10 p-2 rounded-lg border border-primary/20">
            <span className="font-label-caps text-xs font-bold text-primary px-2">
              {selectedIds.length} Selected
            </span>
            <button
              onClick={() => handleBatchPriority("HIGH")}
              disabled={isUpdatingPriority}
              className="px-3 py-1.5 bg-red-600 text-white font-label-caps text-xs font-bold rounded hover:bg-red-700 transition-colors"
            >
              Set High Priority
            </button>
            <button
              onClick={handleBatchExport}
              disabled={isExportingBatch}
              className="px-4 py-1.5 bg-emerald-600 text-white font-label-caps text-xs font-bold rounded hover:bg-emerald-700 transition-colors shadow-sm disabled:opacity-50 flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[16px]">download_for_offline</span>
              {isExportingBatch ? "Packaging ZIP..." : "Batch Export Selected (ZIP)"}
            </button>
          </div>
        )}
      </div>

      {/* Loading Skeleton */}
      {isLoading && (
        <div className="bg-surface-container-lowest rounded-xl p-6 border border-outline-variant animate-pulse space-y-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-14 bg-surface-container rounded-lg" />
          ))}
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="p-4 bg-error-container text-on-error-container rounded-xl text-center font-bold mb-6">
          {error}
        </div>
      )}

      {/* Production Queue Data Table */}
      {!isLoading && !error && (
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface-container-low border-b border-outline-variant">
                  <th className="p-4 w-12 text-center">
                    <input
                      type="checkbox"
                      checked={queue.length > 0 && selectedIds.length === queue.length}
                      onChange={(e) => handleSelectAll(e.target.checked)}
                      className="rounded border-outline-variant text-primary focus:ring-primary cursor-pointer"
                    />
                  </th>
                  <th className="p-4 font-label-caps text-xs text-outline uppercase">Preview</th>
                  <th className="p-4 font-label-caps text-xs text-outline uppercase">Order ID</th>
                  <th className="p-4 font-label-caps text-xs text-outline uppercase">Customer</th>
                  <th className="p-4 font-label-caps text-xs text-outline uppercase">Product / SKU</th>
                  <th className="p-4 font-label-caps text-xs text-outline uppercase">Variant</th>
                  <th className="p-4 font-label-caps text-xs text-outline uppercase">Status</th>
                  <th className="p-4 font-label-caps text-xs text-outline uppercase">Priority</th>
                  <th className="p-4 font-label-caps text-xs text-outline uppercase text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="font-body-sm text-sm">
                {queue.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-8 text-center text-on-surface-variant">
                      No print jobs in queue matching the selected filters.
                    </td>
                  </tr>
                ) : (
                  queue.map((job) => {
                    const isSelected = selectedIds.includes(job._id);
                    const previewUrl =
                      job.item?.customizationSnapshot?.previewImage ||
                      "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=500";

                    return (
                      <tr
                        key={job._id}
                        className={`border-b border-outline-variant hover:bg-surface-container-low transition-colors ${
                          isSelected ? "bg-primary/5" : ""
                        }`}
                      >
                        <td className="p-4 text-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleSelectRow(job._id)}
                            className="rounded border-outline-variant text-primary focus:ring-primary cursor-pointer"
                          />
                        </td>
                        <td className="p-4">
                          <div className="w-12 h-12 bg-surface-container rounded-md border border-outline-variant overflow-hidden relative">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={previewUrl} alt="Print Preview" className="w-full h-full object-cover" />
                          </div>
                        </td>
                        <td className="p-4 font-bold font-label-caps text-on-surface">{job.orderNumber}</td>
                        <td className="p-4 text-on-surface-variant font-medium">{job.customerName}</td>
                        <td className="p-4">
                          <p className="font-bold text-on-surface line-clamp-1">{job.product?.name || job.item?.productName}</p>
                          <p className="text-xs text-on-surface-variant font-label-caps">SKU: {job.product?.sku || "CUSTOM-SKU"}</p>
                        </td>
                        <td className="p-4 text-xs font-bold text-on-surface">
                          {job.product?.color || job.item?.selectedColor} ({job.product?.size || job.item?.selectedSize}) • Qty: {job.item?.quantity}
                        </td>
                        <td className="p-4">
                          <span
                            className={`inline-flex items-center px-2.5 py-1 rounded text-xs font-bold uppercase tracking-wider ${
                              job.status === "PRINTED" || job.status === "COMPLETED"
                                ? "bg-emerald-100 text-emerald-800"
                                : job.status === "PRINTING"
                                ? "bg-blue-100 text-blue-800"
                                : job.status === "READY_FOR_PRINT"
                                ? "bg-indigo-100 text-indigo-800"
                                : "bg-amber-100 text-amber-800"
                            }`}
                          >
                            {job.status}
                          </span>
                        </td>
                        <td className="p-4">
                          <span
                            className={`text-xs font-bold ${
                              job.priority === "HIGH" ? "text-red-600 font-extrabold" : "text-on-surface-variant"
                            }`}
                          >
                            {job.priority}
                          </span>
                        </td>
                        <td className="p-4 text-right">
                          <button
                            onClick={() => router.push(`/admin/custom-orders/${job.orderId}`)}
                            className="px-3 py-1.5 bg-primary text-on-primary font-label-caps text-xs font-bold rounded-lg hover:bg-primary-container transition-colors"
                          >
                            Details
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
