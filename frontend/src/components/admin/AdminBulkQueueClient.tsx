"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

interface BulkRequestItem {
  _id: string;
  quoteNumber: string;
  organizationName: string;
  contactName: string;
  email: string;
  totalQuantity: number;
  status: string;
  createdAt: string;
  productId?: {
    name: string;
    images: string[];
  };
}

export default function AdminBulkQueueClient() {
  const router = useRouter();

  const [requests, setRequests] = useState<BulkRequestItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    async function fetchRequests() {
      setIsLoading(true);
      setError(null);
      try {
        const res = await api.get("/admin/bulk-orders", {
          params: {
            status: statusFilter !== "All" ? statusFilter : undefined,
            q: searchQuery || undefined,
          },
        });
        if (res.data?.success) {
          setRequests(res.data.data);
        }
      } catch (err: any) {
        if (err.response?.status === 403 || err.response?.status === 401) {
          router.push("/admin/login");
          return;
        }
        setError(err.response?.data?.message || "Failed to load bulk requests.");
      } finally {
        setIsLoading(false);
      }
    }
    fetchRequests();
  }, [statusFilter, searchQuery, router]);

  return (
    <div className="flex-1 bg-background text-on-background min-h-screen p-6 md:p-10 font-body-md pb-24">
      {/* Header */}
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="font-display-lg text-3xl md:text-4xl font-extrabold text-on-surface tracking-tight">
            Bulk Order Requests & B2B Quotes
          </h1>
          <p className="font-body-md text-on-surface-variant mt-1">
            Review incoming corporate bulk inquiries, calculate volume pricing, and issue B2B quotations.
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
            placeholder="Search quote #, organization, customer..."
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-surface-container-low border border-outline-variant rounded-lg px-3 py-2 text-xs font-bold text-on-surface outline-none"
        >
          <option value="All">Status: All</option>
          <option value="REQUESTED">Requested</option>
          <option value="QUOTED">Quoted</option>
          <option value="ACCEPTED">Accepted</option>
          <option value="REJECTED">Rejected</option>
        </select>
      </div>

      {isLoading && (
        <div className="p-8 text-center font-bold text-on-surface-variant">Loading bulk requests...</div>
      )}

      {error && (
        <div className="p-4 bg-error-container text-on-error-container rounded-xl text-center font-bold mb-6">{error}</div>
      )}

      {/* Admin Queue Table */}
      {!isLoading && !error && (
        <div className="bg-surface-container-lowest rounded-xl border border-outline-variant overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface-container-low border-b border-outline-variant">
                  <th className="p-4 font-label-caps text-xs text-outline uppercase">Quote #</th>
                  <th className="p-4 font-label-caps text-xs text-outline uppercase">Organization</th>
                  <th className="p-4 font-label-caps text-xs text-outline uppercase">Contact</th>
                  <th className="p-4 font-label-caps text-xs text-outline uppercase">Product & Qty</th>
                  <th className="p-4 font-label-caps text-xs text-outline uppercase">Status</th>
                  <th className="p-4 font-label-caps text-xs text-outline uppercase text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="font-body-sm text-sm">
                {requests.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-on-surface-variant">
                      No bulk order requests found matching the selected filters.
                    </td>
                  </tr>
                ) : (
                  requests.map((r) => (
                    <tr
                      key={r._id}
                      onClick={() => router.push(`/admin/bulk-orders/${r._id}`)}
                      className="border-b border-outline-variant hover:bg-surface-container-low transition-colors cursor-pointer"
                    >
                      <td className="p-4 font-bold font-label-caps text-primary">#{r.quoteNumber}</td>
                      <td className="p-4 font-bold text-on-surface">{r.organizationName}</td>
                      <td className="p-4 text-on-surface-variant">
                        <p className="font-medium text-on-surface">{r.contactName}</p>
                        <p className="text-xs">{r.email}</p>
                      </td>
                      <td className="p-4">
                        <p className="font-bold text-on-surface">{r.productId?.name || "Product"}</p>
                        <p className="text-xs text-primary font-bold">{r.totalQuantity} units</p>
                      </td>
                      <td className="p-4">
                        <span
                          className={`inline-flex items-center px-2.5 py-1 rounded text-xs font-bold uppercase tracking-wider ${
                            r.status === "ACCEPTED"
                              ? "bg-emerald-100 text-emerald-800"
                              : r.status === "QUOTED"
                              ? "bg-blue-100 text-blue-800"
                              : r.status === "REJECTED"
                              ? "bg-red-100 text-red-800"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="p-4 text-right">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            router.push(`/admin/bulk-orders/${r._id}`);
                          }}
                          className="px-3 py-1.5 bg-primary text-on-primary font-label-caps text-xs font-bold rounded-lg hover:bg-primary-container transition-colors"
                        >
                          Manage Quote
                        </button>
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
