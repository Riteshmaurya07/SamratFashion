"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { ShieldCheck, ChevronLeft, ChevronRight } from "lucide-react";

interface AuditLogItem {
  _id: string;
  actorId?: { _id: string; name: string; email: string; role: string };
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export default function AdminAuditLogsPage() {
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [entityFilter, setEntityFilter] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, limit: 20 };
      if (actionFilter) params.action = actionFilter;
      if (entityFilter) params.entityType = entityFilter;

      const res = await api.get("/admin/audit-logs", { params });
      if (res.data?.success) {
        setLogs(res.data.data.items || []);
        setTotalPages(res.data.data.pagination?.totalPages || 1);
        setTotal(res.data.data.pagination?.total || 0);
      }
      setError("");
    } catch {
      setError("Failed to fetch audit logs");
    } finally {
      setLoading(false);
    }
  }, [actionFilter, entityFilter, page]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-outline-variant/20 pb-5">
        <div>
          <h1 className="font-headline-lg text-2xl sm:text-3xl font-black text-on-surface uppercase tracking-tight">
            Security &amp; Audit Logs
          </h1>
          <p className="font-body-sm text-xs text-on-surface-variant mt-1">
            Authoritative audit trail of administrative mutations, configuration edits, refunds, and order updates.
          </p>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 text-red-600 border border-red-200 rounded-lg text-xs font-mono">
          {error}
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-3.5 sm:p-4 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 w-full sm:w-auto">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs uppercase text-on-surface-variant font-bold">Action:</span>
            <input
              type="text"
              value={actionFilter}
              onChange={(e) => {
                setActionFilter(e.target.value);
                setPage(1);
              }}
              placeholder="e.g. ADMIN_INVENTORY_ADJUSTED"
              className="px-3 py-1.5 text-xs bg-surface-container-low border border-outline-variant/50 rounded-lg focus:outline-none focus:border-primary text-on-surface font-mono placeholder:text-neutral-400"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="font-mono text-xs uppercase text-on-surface-variant font-bold">Entity:</span>
            <select
              value={entityFilter}
              onChange={(e) => {
                setEntityFilter(e.target.value);
                setPage(1);
              }}
              className="px-3 py-1.5 text-xs bg-surface-container-low border border-outline-variant/50 rounded-lg focus:outline-none focus:border-primary text-on-surface font-mono uppercase"
            >
              <option value="">All Entities</option>
              <option value="Order">Order</option>
              <option value="Product">Product</option>
              <option value="Category">Category</option>
              <option value="Coupon">Coupon</option>
              <option value="Refund">Refund</option>
            </select>
          </div>
        </div>

        <div className="text-xs font-mono text-on-surface-variant">
          Total Recorded Actions: <strong>{total}</strong>
        </div>
      </div>

      {/* Audit Log Table */}
      {/* Audit Log Container */}
      <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl overflow-hidden shadow-xs">
        {/* Mobile Audit Feed (shown on screens < 768px) */}
        <div className="block md:hidden divide-y divide-outline-variant/20 p-3 space-y-3">
          {loading ? (
            <div className="py-12 text-center text-xs font-mono text-neutral-400">Loading audit trail...</div>
          ) : logs.length === 0 ? (
            <div className="py-12 text-center text-xs font-mono text-neutral-500 uppercase font-bold">No matching audit records</div>
          ) : (
            logs.map((log) => (
              <div key={log._id} className="bg-surface border border-outline-variant/30 rounded-xl p-3.5 space-y-2.5 shadow-xs">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-mono text-xs font-bold text-primary break-all">{log.action}</span>
                  <span className="inline-block px-2 py-0.5 rounded-full border border-primary/20 bg-primary/10 text-primary text-[10px] font-mono font-bold uppercase shrink-0">
                    {log.actorRole}
                  </span>
                </div>

                <div className="flex items-start justify-between gap-2 text-xs font-mono">
                  <div>
                    <span className="text-[10px] text-neutral-400 block uppercase">Actor</span>
                    <strong className="text-on-surface">{log.actorId?.name || "System Actor"}</strong>
                    <p className="text-[10px] text-neutral-400">{log.actorId?.email || "internal"}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-neutral-400 block uppercase">Target Entity</span>
                    <strong className="text-on-surface">{log.entityType} ({log.entityId ? log.entityId.slice(-6) : "—"})</strong>
                  </div>
                </div>

                {log.metadata && (
                  <div className="p-2 bg-surface-container-low rounded-lg text-[11px] font-mono text-neutral-600 border border-outline-variant/20 overflow-x-auto">
                    <code>{JSON.stringify(log.metadata)}</code>
                  </div>
                )}

                <div className="pt-1 text-[11px] font-mono text-neutral-500 border-t border-outline-variant/15 flex items-center justify-between">
                  <span>Timestamp</span>
                  <span>{new Date(log.createdAt).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "medium" })}</span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Desktop Table (hidden on mobile, shown on md+) */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-surface-container-low border-b border-outline-variant/30 font-mono uppercase text-on-surface-variant text-[11px]">
                <th className="py-3 px-4">Timestamp</th>
                <th className="py-3 px-4">Actor</th>
                <th className="py-3 px-4">Role</th>
                <th className="py-3 px-4">Action</th>
                <th className="py-3 px-4">Entity Type</th>
                <th className="py-3 px-4">Metadata</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/20 font-body-sm">
              {loading ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-neutral-400 font-mono">
                    Loading audit trail...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 space-y-2">
                    <ShieldCheck className="w-8 h-8 text-neutral-400 mx-auto" />
                    <p className="font-mono text-xs text-on-surface-variant uppercase font-bold">
                      No matching audit records
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
                    <td className="py-3.5 px-4 text-on-surface font-mono">
                      <div className="font-bold">{log.actorId?.name || "System Actor"}</div>
                      <div className="text-[10px] text-neutral-400">{log.actorId?.email}</div>
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <span className="inline-block px-2 py-0.5 rounded-full border border-primary/20 bg-primary/10 text-primary text-[10px] font-mono font-bold uppercase">
                        {log.actorRole}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-mono font-bold text-on-surface whitespace-nowrap">
                      {log.action}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-neutral-600 whitespace-nowrap">
                      {log.entityType} ({log.entityId ? log.entityId.slice(-6) : "—"})
                    </td>
                    <td className="py-3.5 px-4 font-mono text-[10px] text-neutral-500 max-w-xs truncate">
                      {log.metadata ? JSON.stringify(log.metadata) : "—"}
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
