"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { CreditCard, ChevronLeft, ChevronRight, Search } from "lucide-react";

interface PaymentAttemptItem {
  _id: string;
  orderId?: { _id: string; orderNumber: string; total: number; status: string };
  razorpayOrderId: string;
  razorpayPaymentId?: string;
  amount: number;
  currency: string;
  status: "PENDING" | "AUTHORIZED" | "PROCESSING" | "CAPTURED" | "FAILED";
  failureCode?: string;
  failureReason?: string;
  createdAt: string;
}

export default function AdminPaymentAttemptsPage() {
  const [attempts, setAttempts] = useState<PaymentAttemptItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 400);
    return () => clearTimeout(handler);
  }, [search]);

  const fetchAttempts = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, limit: 20 };
      if (statusFilter) params.status = statusFilter;
      if (debouncedSearch) params.razorpayOrderId = debouncedSearch;

      const res = await api.get("/admin/payment-attempts", { params });
      if (res.data?.success) {
        setAttempts(res.data.data.items || []);
        setTotalPages(res.data.data.pagination?.totalPages || 1);
        setTotal(res.data.data.pagination?.total || 0);
      }
      setError("");
    } catch {
      setError("Failed to fetch payment attempt diagnostics");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, debouncedSearch, page]);

  useEffect(() => {
    fetchAttempts();
  }, [fetchAttempts]);

  const getStatusBadge = (st: string) => {
    switch (st) {
      case "CAPTURED":
        return "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400";
      case "FAILED":
        return "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400";
      case "PROCESSING":
      case "AUTHORIZED":
        return "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400";
      default:
        return "bg-surface-container text-on-surface border-outline-variant/40";
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-outline-variant/20 pb-5">
        <div>
          <h1 className="font-headline-lg text-2xl sm:text-3xl font-black text-on-surface uppercase tracking-tight">
            Payment Attempt Diagnostics
          </h1>
          <p className="font-body-sm text-xs text-on-surface-variant mt-1">
            Audit gateway payment attempts, drop-off reasons, bank errors, and Razorpay transaction IDs.
          </p>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 text-red-600 border border-red-200 rounded-lg text-xs font-mono">
          {error}
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-4 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs uppercase text-on-surface-variant font-bold">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              className="px-3 py-1.5 text-xs bg-surface-container-low border border-outline-variant/50 rounded-lg focus:outline-none focus:border-primary text-on-surface font-mono uppercase"
            >
              <option value="">All Attempts</option>
              <option value="CAPTURED">Captured</option>
              <option value="FAILED">Failed</option>
              <option value="PENDING">Pending</option>
              <option value="AUTHORIZED">Authorized</option>
            </select>
          </div>

          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search Razorpay Order ID..."
              className="pl-9 pr-3 py-1.5 text-xs bg-surface-container-low border border-outline-variant/50 rounded-lg focus:outline-none focus:border-primary text-on-surface font-mono placeholder:text-neutral-400"
            />
          </div>
        </div>

        <div className="text-xs font-mono text-on-surface-variant">
          Total Attempts Tracked: <strong>{total}</strong>
        </div>
      </div>

      {/* Attempts Table */}
      <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-surface-container-low border-b border-outline-variant/30 font-mono uppercase text-on-surface-variant text-[11px]">
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Order #</th>
                <th className="py-3 px-4">Razorpay Order ID</th>
                <th className="py-3 px-4">Amount</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Failure Code / Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/20 font-body-sm">
              {loading ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-neutral-400 font-mono">
                    Loading payment diagnostics...
                  </td>
                </tr>
              ) : attempts.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 space-y-2">
                    <CreditCard className="w-8 h-8 text-neutral-400 mx-auto" />
                    <p className="font-mono text-xs text-on-surface-variant uppercase font-bold">
                      No payment attempts logged
                    </p>
                  </td>
                </tr>
              ) : (
                attempts.map((att) => (
                  <tr key={att._id} className="hover:bg-surface-container/50 transition-colors">
                    <td className="py-3.5 px-4 font-mono text-neutral-500 whitespace-nowrap">
                      {new Date(att.createdAt).toLocaleString("en-IN", {
                        dateStyle: "short",
                        timeStyle: "short"
                      })}
                    </td>
                    <td className="py-3.5 px-4 font-mono font-bold text-primary whitespace-nowrap">
                      {att.orderId?.orderNumber || "—"}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-on-surface font-semibold whitespace-nowrap">
                      {att.razorpayOrderId}
                    </td>
                    <td className="py-3.5 px-4 font-mono font-bold text-on-surface whitespace-nowrap">
                      ₹{Math.round(att.amount > 10000 ? att.amount / 100 : att.amount).toLocaleString("en-IN")}
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <span className={`inline-block px-2 py-0.5 rounded-full border text-[10px] font-mono font-bold uppercase ${getStatusBadge(att.status)}`}>
                        {att.status}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-mono text-[11px] text-neutral-500">
                      {att.failureCode ? (
                        <div>
                          <span className="text-red-500 font-bold">{att.failureCode}: </span>
                          <span>{att.failureReason || "Transaction incomplete"}</span>
                        </div>
                      ) : (
                        att.status === "CAPTURED" ? <span className="text-emerald-600 font-bold">Success (Payment Captured)</span> : "—"
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-outline-variant/20 bg-surface-container-lowest font-mono text-xs">
            <span className="text-neutral-500">Page {page} of {totalPages}</span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="p-1.5 rounded border border-outline-variant/40 disabled:opacity-30 hover:bg-surface-container cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="p-1.5 rounded border border-outline-variant/40 disabled:opacity-30 hover:bg-surface-container cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
