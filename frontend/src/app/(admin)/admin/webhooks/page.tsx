"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Radio, ChevronLeft, ChevronRight, Search, RotateCw, Loader2, ArrowRight, ChevronDown, ChevronUp } from "lucide-react";

interface WebhookItem {
  _id: string;
  eventId: string;
  provider: string;
  eventType: string;
  status: "PROCESSED" | "FAILED" | "IGNORED" | "PROCESSING" | "RECEIVED";
  lastError?: string | null;
  processingAttempts?: number;
  processedAt: string;
  createdAt: string;
}

export default function AdminWebhooksPage() {
  const [events, setEvents] = useState<WebhookItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [providerFilter, setProviderFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [eventIdFilter, setEventIdFilter] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleRetry = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setRetryingId(id);
    setActionMessage(null);
    try {
      const res = await api.post(`/admin/webhooks/${id}/retry`);
      if (res.data?.success) {
        setActionMessage(res.data.message || "Webhook reprocessed successfully");
        await fetchWebhooks();
      }
    } catch (err: unknown) {
      let msg = "Failed to retry webhook";
      if (err && typeof err === "object" && "response" in err) {
        const resp = err.response as { data?: { message?: string } };
        if (resp?.data?.message) msg = resp.data.message;
      }
      setActionMessage(`Error: ${msg}`);
    } finally {
      setRetryingId(null);
    }
  };

  useEffect(() => {
    const eventId = new URLSearchParams(window.location.search).get("eventId");
    if (eventId) setEventIdFilter(eventId);
  }, []);

  const fetchWebhooks = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, limit: 20 };
      if (providerFilter) params.provider = providerFilter;
      if (statusFilter) params.status = statusFilter;
      if (eventIdFilter) params.eventId = eventIdFilter;

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
  }, [providerFilter, statusFilter, eventIdFilter, page]);

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
            Authoritative event logs from Razorpay payments and NimbusPost logistics webhooks.
          </p>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 text-red-600 border border-red-200 rounded-lg text-xs font-mono">
          {error}
        </div>
      )}

      {actionMessage && (
        <div
          className={`p-4 rounded-lg text-xs font-mono border ${
            actionMessage.startsWith("Error:")
              ? "bg-red-50 text-red-600 border-red-200"
              : "bg-emerald-50 text-emerald-700 border-emerald-200"
          }`}
        >
          {actionMessage}
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-3.5 sm:p-4 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 w-full sm:w-auto">
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
              <option value="NIMBUSPOST">NimbusPost</option>
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

          <label className="relative">
            <span className="sr-only">Filter by event ID</span>
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" aria-hidden="true" />
            <input
              type="text"
              value={eventIdFilter}
              onChange={(e) => {
                setEventIdFilter(e.target.value);
                setPage(1);
              }}
              placeholder="Filter by event ID…"
              className="pl-9 pr-3 py-1.5 text-xs bg-surface-container-low border border-outline-variant/50 rounded-lg focus:outline-none focus:border-primary text-on-surface font-mono placeholder:text-neutral-400"
            />
          </label>
        </div>

        <div className="text-xs font-mono text-on-surface-variant">
          Total Inbound Webhook Events: <strong>{total}</strong>
        </div>
      </div>

      {/* Webhook Container */}
      <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl overflow-hidden shadow-xs">
        {/* Mobile Webhook Feed (shown on screens < 768px) */}
        <div className="block md:hidden divide-y divide-outline-variant/20 p-3 space-y-3">
          {loading ? (
            <div className="py-12 text-center text-xs font-mono text-neutral-400">Loading webhook events...</div>
          ) : events.length === 0 ? (
            <div className="py-12 text-center text-xs font-mono text-neutral-500 uppercase font-bold">No webhook events logged</div>
          ) : (
            events.map((evt) => (
              <div key={evt._id} className="bg-surface border border-outline-variant/30 rounded-xl p-3.5 space-y-2.5 shadow-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-bold text-on-surface">{evt.provider}</span>
                  <span className={`px-2 py-0.5 rounded-full border text-[10px] font-mono font-bold uppercase ${getStatusBadge(evt.status)}`}>
                    {evt.status}
                  </span>
                </div>

                <div className="pt-1">
                  <h4 className="font-mono text-xs font-bold text-primary">{evt.eventType}</h4>
                  <p className="text-[11px] font-mono text-neutral-500 truncate mt-0.5">{evt.eventId}</p>
                  {evt.lastError && (
                    <p className="text-[11px] font-mono text-red-600 dark:text-red-400 mt-1.5 bg-red-50/70 dark:bg-red-950/30 border border-red-200/70 dark:border-red-900/40 rounded px-2 py-1 break-words">
                      {evt.lastError}
                      {evt.processingAttempts ? ` (${evt.processingAttempts} attempts)` : ""}
                    </p>
                  )}
                </div>

                <div className="pt-1 text-[11px] font-mono text-neutral-500 border-t border-outline-variant/15 flex items-center justify-between">
                  <span>Processed</span>
                  <span>{new Date(evt.processedAt || evt.createdAt).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "medium" })}</span>
                </div>

                {evt.status !== "PROCESSED" && (
                  <div className="pt-2 flex items-center gap-2 border-t border-outline-variant/15">
                    <Link
                      href={`/admin/payment-reconciliation?eventId=${encodeURIComponent(evt.eventId)}`}
                      className="px-2.5 py-1 bg-surface-container-high hover:bg-surface-container text-on-surface text-[11px] font-mono font-bold rounded border border-outline-variant/40 inline-flex items-center gap-1"
                    >
                      <span>Reconcile</span>
                      <ArrowRight className="w-3 h-3" />
                    </Link>
                    <button
                      type="button"
                      disabled={retryingId === evt._id}
                      onClick={(e) => handleRetry(evt._id, e)}
                      className="px-2.5 py-1 bg-neutral-900 text-white hover:bg-neutral-800 text-[11px] font-mono font-bold rounded inline-flex items-center gap-1 disabled:opacity-50 cursor-pointer"
                    >
                      {retryingId === evt._id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <RotateCw className="w-3 h-3" />
                      )}
                      <span>Retry</span>
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Desktop Table (hidden on mobile, shown on md+) */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-surface-container-low border-b border-outline-variant/30 font-mono uppercase text-on-surface-variant text-[11px]">
                <th className="py-3 px-4">Processed Date</th>
                <th className="py-3 px-4">Provider</th>
                <th className="py-3 px-4">Event ID</th>
                <th className="py-3 px-4">Event Type</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Details / Error</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/20 font-body-sm">
              {loading ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-neutral-400 font-mono">
                    Loading webhook events...
                  </td>
                </tr>
              ) : events.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 space-y-2">
                    <Radio className="w-8 h-8 text-neutral-400 mx-auto" />
                    <p className="font-mono text-xs text-on-surface-variant uppercase font-bold">
                      No webhook events logged
                    </p>
                  </td>
                </tr>
              ) : (
                events.map((evt) => (
                  <>
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
                        {evt.processingAttempts && evt.processingAttempts > 1 ? (
                          <span className="ml-1.5 text-[10px] font-mono text-neutral-500">
                            ×{evt.processingAttempts}
                          </span>
                        ) : null}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-[11px] max-w-sm">
                        {evt.lastError ? (
                          <span className="text-red-600 dark:text-red-400 break-words">{evt.lastError}</span>
                        ) : (
                          <span className="text-neutral-400">—</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        {evt.status !== "PROCESSED" ? (
                          <div className="inline-flex items-center gap-1.5 justify-end">
                            <button
                              type="button"
                              onClick={() => toggleExpand(evt._id)}
                              className="p-1 rounded text-neutral-500 hover:text-on-surface hover:bg-surface-container-high border border-outline-variant/30 text-[10px] font-mono font-bold inline-flex items-center gap-0.5 cursor-pointer"
                              title="Toggle Event Details"
                            >
                              <span>{expandedIds.has(evt._id) ? "Hide" : "Details"}</span>
                              {expandedIds.has(evt._id) ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                            </button>
                            <Link
                              href={`/admin/payment-reconciliation?eventId=${encodeURIComponent(evt.eventId)}`}
                              className="px-2 py-1 bg-surface-container-high hover:bg-surface-container text-on-surface text-[10px] font-mono font-bold rounded border border-outline-variant/40 inline-flex items-center gap-1"
                              title="Open in Payment Reconciliation"
                            >
                              <span>Reconcile</span>
                              <ArrowRight className="w-3 h-3" />
                            </Link>
                            <button
                              type="button"
                              disabled={retryingId === evt._id}
                              onClick={(e) => handleRetry(evt._id, e)}
                              className="px-2 py-1 bg-neutral-900 text-white hover:bg-neutral-800 text-[10px] font-mono font-bold rounded inline-flex items-center gap-1 disabled:opacity-50 cursor-pointer"
                              title="Retry Webhook Processing"
                            >
                              {retryingId === evt._id ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <RotateCw className="w-3 h-3" />
                              )}
                              <span>Retry</span>
                            </button>
                          </div>
                        ) : (
                          <span className="text-neutral-400 font-mono text-[11px]">—</span>
                        )}
                      </td>
                    </tr>
                    {expandedIds.has(evt._id) && (
                      <tr className="bg-surface-container-low/50 border-b border-outline-variant/20">
                        <td colSpan={7} className="p-4 font-mono text-xs space-y-2">
                          <div className="flex flex-wrap items-center gap-3 text-[11px] text-neutral-600">
                            <span>Event ID: <strong>{evt.eventId}</strong></span>
                            <span>Provider: <strong>{evt.provider}</strong></span>
                            <span>Type: <strong>{evt.eventType}</strong></span>
                            <span>Attempts: <strong>{evt.processingAttempts || 1}</strong></span>
                          </div>
                          {evt.lastError && (
                            <div className="p-2.5 bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 rounded border border-red-200 dark:border-red-900/50 text-[11px]">
                              <strong>Error:</strong> {evt.lastError}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
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
