"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { ArrowRight, Search } from "lucide-react";

interface BulkRequestItem {
  _id: string;
  quoteNumber: string;
  organizationName: string;
  contactName: string;
  email: string;
  totalQuantity: number;
  status: string;
  createdAt: string;
  currentMockupUrl?: string;
  productId?: {
    name: string;
    images?: string[];
    basePrice?: number;
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
          const list = res.data.data?.requests || res.data.data || [];
          setRequests(Array.isArray(list) ? list : []);
        }
      } catch (err: unknown) {
        const e = err as { response?: { status?: number; data?: { message?: string } } };
        if (e.response?.status === 403 || e.response?.status === 401) {
          router.push("/admin/login");
          return;
        }
        setError(e.response?.data?.message || "Failed to load bulk requests.");
      } finally {
        setIsLoading(false);
      }
    }
    fetchRequests();
  }, [statusFilter, searchQuery, router]);

  function getStatusBadge(status: string) {
    switch (status) {
      case "ORDER_CREATED":
      case "ACCEPTED":
        return "bg-emerald-100 text-emerald-800 border-emerald-300";
      case "DESIGN_APPROVED":
        return "bg-purple-100 text-purple-800 border-purple-300";
      case "MOCKUP_SHARED":
        return "bg-sky-100 text-sky-800 border-sky-300";
      case "REVISION_REQUESTED":
        return "bg-amber-100 text-amber-800 border-amber-300";
      case "QUOTED":
        return "bg-blue-100 text-blue-800 border-blue-300";
      case "UNDER_REVIEW":
        return "bg-yellow-100 text-yellow-800 border-yellow-300";
      case "REJECTED":
      case "CANCELLED":
        return "bg-red-100 text-red-800 border-red-300";
      case "REQUESTED":
      default:
        return "bg-zinc-100 text-zinc-800 border-zinc-300";
    }
  }

  return (
    <div className="flex-1 bg-background text-on-background min-h-screen p-6 md:p-10 font-body-md pb-24">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black text-on-surface tracking-tight">
            Bulk Order Requests & Quotes
          </h1>
          <p className="text-xs text-on-surface-variant mt-1">
            Review B2B customer inquiries, upload design mockups, receive feedback, and issue quotations.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/print-catalog"
            className="rounded-xl border border-outline-variant px-4 py-2 text-xs font-bold text-on-surface hover:bg-surface-container transition-colors"
          >
            Print Catalog
          </Link>
          <Link
            href="/admin/print-pricing"
            className="rounded-xl border border-outline-variant px-4 py-2 text-xs font-bold text-on-surface hover:bg-surface-container transition-colors"
          >
            Volume Pricing
          </Link>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-surface-container-lowest p-4 rounded-2xl border border-outline-variant/30 mb-6 shadow-xs flex flex-wrap gap-4 items-center">
        <div className="relative flex-1 min-w-[260px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-on-surface-variant" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-surface-container-low border border-outline-variant/40 rounded-xl text-xs outline-none focus:border-primary"
            placeholder="Search quote #, organization, customer, email..."
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-surface-container-low border border-outline-variant/40 rounded-xl px-3 py-2 text-xs font-bold text-on-surface outline-none"
        >
          <option value="All">All Inquiries</option>
          <option value="REQUESTED">1. Requested (New)</option>
          <option value="UNDER_REVIEW">2. Under Review</option>
          <option value="CONTACTED">3. Contacted</option>
          <option value="MOCKUP_SHARED">4. Mockup Shared</option>
          <option value="REVISION_REQUESTED">5. Revision Requested</option>
          <option value="DESIGN_APPROVED">6. Design Approved</option>
          <option value="CONFIRMED">7. Confirmed</option>
          <option value="QUOTED">8. Quoted</option>
          <option value="ACCEPTED">9. Quote Accepted</option>
          <option value="ORDER_CREATED">10. Order Created</option>
          <option value="CLOSED">Closed</option>
          <option value="REJECTED">Rejected</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
      </div>

      {isLoading && (
        <div className="p-12 text-center text-xs font-bold text-on-surface-variant animate-pulse">
          Loading bulk queue...
        </div>
      )}

      {error && (
        <div className="p-4 bg-error-container text-on-error-container rounded-xl text-center text-xs font-bold mb-6">
          {error}
        </div>
      )}

      {!isLoading && !error && (
        <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/30 overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-surface-container-low/60 border-b border-outline-variant/30 text-xs font-bold text-on-surface-variant uppercase tracking-wider">
                  <th className="p-4">Reference</th>
                  <th className="p-4">Organization / Contact</th>
                  <th className="p-4">Apparel & Quantity</th>
                  <th className="p-4">Proof Status</th>
                  <th className="p-4">Date</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/20">
                {requests.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-12 text-center text-on-surface-variant text-xs">
                      No bulk requests found for the selected criteria.
                    </td>
                  </tr>
                ) : (
                  requests.map((req) => (
                    <tr key={req._id} className="hover:bg-surface-container-low/40 transition-colors">
                      <td className="p-4">
                        <span className="font-mono font-bold text-primary text-xs">#{req.quoteNumber}</span>
                      </td>
                      <td className="p-4">
                        <p className="font-bold text-on-surface">{req.organizationName}</p>
                        <p className="text-xs text-on-surface-variant">
                          {req.contactName} ({req.email})
                        </p>
                      </td>
                      <td className="p-4">
                        <p className="font-medium text-on-surface">{req.productId?.name || "Garment"}</p>
                        <p className="text-xs font-bold text-primary font-mono">{req.totalQuantity} Units</p>
                      </td>
                      <td className="p-4">
                        <span
                          className={`inline-block border text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wider ${getStatusBadge(
                            req.status
                          )}`}
                        >
                          {req.status.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="p-4 text-xs text-on-surface-variant font-mono">
                        {new Date(req.createdAt).toLocaleDateString()}
                      </td>
                      <td className="p-4 text-right">
                        <Link
                          href={`/admin/bulk-orders/${req._id}`}
                          className="inline-flex items-center gap-1 rounded-lg bg-surface-container-low border border-outline-variant px-3 py-1.5 text-xs font-bold text-on-surface hover:bg-surface-container transition-colors"
                        >
                          <span>Manage</span>
                          <ArrowRight className="h-3 w-3" />
                        </Link>
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
