"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { Mail, MessageSquare, ChevronLeft, ChevronRight } from "lucide-react";

interface NotificationLogItem {
  _id: string;
  eventType: string;
  entityType: string;
  entityId: string;
  recipientEmail: string;
  recipientPhone?: string;
  channel: "EMAIL" | "SMS" | "WHATSAPP";
  status: "PENDING" | "SENT" | "FAILED" | "NOT_CONFIGURED";
  provider: string;
  attemptCount: number;
  sentAt?: string;
  lastError?: string;
  createdAt: string;
}

export default function AdminNotificationsPage() {
  const [logs, setLogs] = useState<NotificationLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [channelFilter, setChannelFilter] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, limit: 20 };
      if (statusFilter) params.status = statusFilter;
      if (channelFilter) params.channel = channelFilter;

      const res = await api.get("/admin/notifications", { params });
      if (res.data?.success) {
        setLogs(res.data.data.items || []);
        setTotalPages(res.data.data.pagination?.totalPages || 1);
        setTotal(res.data.data.pagination?.total || 0);
      }
      setError("");
    } catch {
      setError("Failed to fetch notification delivery logs");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, channelFilter, page]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const getStatusBadge = (st: string) => {
    switch (st) {
      case "SENT":
        return "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400";
      case "FAILED":
        return "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400";
      case "NOT_CONFIGURED":
        return "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400";
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
            Notification Delivery Center
          </h1>
          <p className="font-body-sm text-xs text-on-surface-variant mt-1">
            Real-time delivery status for transactional customer emails (Brevo), dispatch alerts, and quotations.
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
              <option value="">All Statuses</option>
              <option value="SENT">Sent</option>
              <option value="FAILED">Failed</option>
              <option value="NOT_CONFIGURED">Not Configured</option>
              <option value="PENDING">Pending</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-mono text-xs uppercase text-on-surface-variant font-bold">Channel:</span>
            <select
              value={channelFilter}
              onChange={(e) => {
                setChannelFilter(e.target.value);
                setPage(1);
              }}
              className="px-3 py-1.5 text-xs bg-surface-container-low border border-outline-variant/50 rounded-lg focus:outline-none focus:border-primary text-on-surface font-mono uppercase"
            >
              <option value="">All Channels</option>
              <option value="EMAIL">Email</option>
              <option value="SMS">SMS</option>
              <option value="WHATSAPP">WhatsApp</option>
            </select>
          </div>
        </div>

        <div className="text-xs font-mono text-on-surface-variant">
          Total Notifications: <strong>{total}</strong>
        </div>
      </div>

      {/* Notification Table */}
      <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-surface-container-low border-b border-outline-variant/30 font-mono uppercase text-on-surface-variant text-[11px]">
                <th className="py-3 px-4">Timestamp</th>
                <th className="py-3 px-4">Event Type</th>
                <th className="py-3 px-4">Channel</th>
                <th className="py-3 px-4">Masked Recipient</th>
                <th className="py-3 px-4">Provider</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Delivery Notes / Error</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/20 font-body-sm">
              {loading ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-neutral-400 font-mono">
                    Loading notification logs...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 space-y-2">
                    <Mail className="w-8 h-8 text-neutral-400 mx-auto" />
                    <p className="font-mono text-xs text-on-surface-variant uppercase font-bold">
                      No notifications recorded
                    </p>
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log._id} className="hover:bg-surface-container/50 transition-colors">
                    <td className="py-3.5 px-4 font-mono text-neutral-500 whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleString("en-IN", {
                        dateStyle: "short",
                        timeStyle: "medium"
                      })}
                    </td>
                    <td className="py-3.5 px-4 font-mono font-bold text-on-surface whitespace-nowrap">
                      {log.eventType}
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 font-mono text-[11px] text-neutral-600">
                        {log.channel === "EMAIL" ? <Mail className="w-3.5 h-3.5" /> : <MessageSquare className="w-3.5 h-3.5" />}
                        <span>{log.channel}</span>
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-mono text-on-surface">
                      <div>{log.recipientEmail}</div>
                      {log.recipientPhone && <div className="text-[10px] text-neutral-400">{log.recipientPhone}</div>}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-neutral-500 text-[11px] uppercase whitespace-nowrap">
                      {log.provider}
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <span className={`inline-block px-2 py-0.5 rounded-full border text-[10px] font-mono font-bold uppercase ${getStatusBadge(log.status)}`}>
                        {log.status}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-mono text-[11px] text-neutral-500 max-w-xs truncate">
                      {log.lastError ? (
                        <span className="text-red-500 font-semibold">{log.lastError}</span>
                      ) : (
                        log.sentAt ? `Dispatched in attempt #${log.attemptCount}` : "—"
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
