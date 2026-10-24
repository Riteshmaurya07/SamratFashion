"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { Radio, ChevronLeft, ChevronRight } from "lucide-react";

interface WebhookItem {
  _id: string;
  eventId: string;
  provider: string;
  eventType: string;
  status: "PROCESSED" | "FAILED" | "IGNORED";
  processedAt: string;
  createdAt: string;
}

export default function AdminWebhooksPage() {
  const [events, setEvents] = useState<WebhookItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [providerFilter, setProviderFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const fetchWebhooks = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, limit: 20 };
      if (providerFilter) params.provider = providerFilter;
      if (statusFilter) params.status = statusFilter;

      const res = await api.get("/admin/webhooks", { params });
      if (res.data?.success) {
        setEvents(res.data.data.items || []);
        setTotalPages(res.data.data.pagination?.totalPages || 1);
        setTotal(res.data.data.pagination?.total || 0);
      }
      setError("");
    } catch {
      setError("Failed to fetch webhook events");
    } finally {
      setLoading(false);
    }
  }, [providerFilter, statusFilter, page]);

  useEffect(() => {
    fetchWebhooks();
  }, [fetchWebhooks]);

  const getStatusBadge = (st: string) => {
    switch (st) {
      case "PROCESSED":
        return "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400";
      case "FAILED":
        return "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400";
      case "IGNORED":
        return "bg-neutral-100 text-neutral-600 border-neutral-300 dark:bg-neutral-800 dark:text-neutral-400";
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
            Webhook &amp; Logistics Monitor
          </h1>
          <p className="font-body-sm text-xs text-on-surface-variant mt-1">
            Authoritative event logs from Razorpay payments and Delhivery logistics webhooks.
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
            <span className="font-mono text-xs uppercase text-on-surface-variant font-bold">Provider:</span>
            <select
              value={providerFilter}
              onChange={(e) => {
                setProviderFilter(e.target.value);
                setPage(1);
              }}
              className="px-3 py-1.5 text-xs bg-surface-container-low border border-outline-variant/50 rounded-lg focus:outline-none focus:border-primary text-on-surface font-mono uppercase"
            >
              <option value="">All Providers</option>
              <option value="RAZORPAY">Razorpay</option>
              <option value="DELHIVERY">Delhivery</option>
            </select>
          </div>

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
              <option value="">All Statuses</option>
              <option value="PROCESSED">Processed</option>
              <option value="FAILED">Failed</option>
              <option value="IGNORED">Ignored</option>
            </select>
          </div>
        </div>

        <div className="text-xs font-mono text-on-surface-variant">
          Total Inbound Webhook Events: <strong>{total}</strong>
        </div>
      </div>

      {/* Webhook Table */}
      <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-surface-container-low border-b border-outline-variant/30 font-mono uppercase text-on-surface-variant text-[11px]">
                <th className="py-3 px-4">Processed Date</th>
                <th className="py-3 px-4">Provider</th>
                <th className="py-3 px-4">Event ID</th>
                <th className="py-3 px-4">Event Type</th>
                <th className="py-3 px-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/20 font-body-sm">
              {loading ? (
                <tr>
                  <td colSpan={5} className="text-center py-12 text-neutral-400 font-mono">
                    Loading webhook events...
                  </td>
                </tr>
              ) : events.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-12 space-y-2">
                    <Radio className="w-8 h-8 text-neutral-400 mx-auto" />
                    <p className="font-mono text-xs text-on-surface-variant uppercase font-bold">
                      No webhook events logged
                    </p>
                  </td>
                </tr>
              ) : (
                events.map((evt) => (
                  <tr key={evt._id} className="hover:bg-surface-container/50 transition-colors">
                    <td className="py-3.5 px-4 font-mono text-neutral-500 whitespace-nowrap">
                      {new Date(evt.processedAt || evt.createdAt).toLocaleString("en-IN", {
                        dateStyle: "short",
                        timeStyle: "medium"
                      })}
                    </td>
                    <td className="py-3.5 px-4 font-mono font-bold text-on-surface whitespace-nowrap">
                      {evt.provider}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-neutral-600 max-w-xs truncate">
                      {evt.eventId}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-primary font-bold whitespace-nowrap">
                      {evt.eventType}
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <span className={`inline-block px-2 py-0.5 rounded-full border text-[10px] font-mono font-bold uppercase ${getStatusBadge(evt.status)}`}>
                        {evt.status}
                      </span>
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
