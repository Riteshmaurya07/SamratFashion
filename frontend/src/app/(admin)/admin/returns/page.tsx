"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { useRouter } from "next/navigation";

const STATUS_OPTIONS = ["", "REQUESTED", "INSPECTING", "APPROVED", "RECEIVED", "ACCEPTED", "REJECTED", "COMPLETED"];

export default function AdminReturnsPage() {
  const router = useRouter();
  const [returns, setReturns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [statusOpen, setStatusOpen] = useState(false);

  const fetchReturns = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/admin/returns");
      setReturns(res.data.data || []);
      setError("");
    } catch (err: any) {
      setError("Failed to load returns");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReturns();
  }, [fetchReturns]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "REQUESTED":
      case "INSPECTING":
        return "bg-secondary-container/10 text-secondary border border-secondary/20";
      case "APPROVED":
      case "RECEIVED":
        return "bg-primary-container/20 text-primary border border-primary/20";
      case "ACCEPTED":
      case "COMPLETED":
        return "bg-[#eef0ff] text-[#003ea8] border border-[#b4c5ff]";
      case "REJECTED":
        return "bg-error-container/20 text-error border border-error/20";
      default:
        return "bg-surface-container-high text-on-surface border border-outline-variant/30";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "REQUESTED": return "assignment_return";
      case "INSPECTING": return "search";
      case "APPROVED": return "check_circle";
      case "RECEIVED": return "inventory";
      case "ACCEPTED": return "task_alt";
      case "REJECTED": return "cancel";
      case "COMPLETED": return "done_all";
      default: return "help";
    }
  };

  const filteredReturns = returns.filter((r) => {
    const matchesSearch =
      !search ||
      r._id?.toLowerCase().includes(search.toLowerCase()) ||
      r.orderId?.toLowerCase().includes(search.toLowerCase()) ||
      (r.userId?.name || "").toLowerCase().includes(search.toLowerCase()) ||
      (r.userId?.email || "").toLowerCase().includes(search.toLowerCase());

    const matchesStatus = !statusFilter || r.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // KPI counts
  const kpis = {
    total: returns.length,
    pending: returns.filter((r) => ["REQUESTED", "INSPECTING"].includes(r.status)).length,
    approved: returns.filter((r) => ["APPROVED", "RECEIVED"].includes(r.status)).length,
    completed: returns.filter((r) => r.status === "COMPLETED").length,
    rejected: returns.filter((r) => r.status === "REJECTED").length,
  };

  return (
    <div className="flex flex-col gap-element-gap md:gap-gutter">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-2">
        <div>
          <h1 className="font-headline-lg text-headline-lg text-on-background mb-1">
            Returns Management
          </h1>
          <p className="font-body-md text-body-md text-on-surface-variant max-w-2xl">
            Manage customer returns, inspect items, and issue refunds.
          </p>
        </div>
        <button
          onClick={fetchReturns}
          className="flex items-center gap-2 px-4 py-2 border border-outline-variant text-on-surface font-label-caps text-label-caps rounded-lg hover:bg-surface-container-high transition-colors self-start md:self-auto"
        >
          <span className="material-symbols-outlined text-[18px]">refresh</span>
          Refresh
        </button>
      </div>

      {error && (
        <div className="text-error bg-error-container/20 p-4 rounded-md font-body-sm flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">error_outline</span>
          {error}
        </div>
      )}

      {/* KPI Cards */}
      <section className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { label: "Total Returns", value: kpis.total, color: "text-on-surface" },
          { label: "Pending Review", value: kpis.pending, color: "text-secondary", accent: "border-l-4 border-l-secondary" },
          { label: "Approved", value: kpis.approved, color: "text-primary", accent: "border-l-4 border-l-primary" },
          { label: "Completed", value: kpis.completed, color: "text-[#003ea8]", accent: "" },
          { label: "Rejected", value: kpis.rejected, color: "text-error", accent: "border-l-4 border-l-error" },
        ].map((kpi) => (
          <div
            key={kpi.label}
            className={`bg-surface border border-outline-variant rounded-lg p-4 flex flex-col justify-between h-24 hover:scale-[1.02] transition-transform ${kpi.accent}`}
          >
            <span className="font-label-caps text-label-caps text-on-surface-variant">{kpi.label}</span>
            <span className={`font-headline-sm text-headline-sm ${kpi.color}`}>
              {loading ? "—" : kpi.value}
            </span>
          </div>
        ))}
      </section>

      {/* Filter Toolbar */}
      <div className="flex flex-col md:flex-row gap-3 items-start md:items-center justify-between bg-surface-container-lowest p-4 rounded-t-xl border border-outline-variant/20 border-b-0">
        <div className="w-full md:w-auto flex-1 max-w-md relative">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-[18px]">
            search
          </span>
          <input
            type="text"
            placeholder="Search return ID, order, or customer..."
            className="w-full pl-10 pr-4 py-2.5 bg-surface-container-low border border-outline-variant/30 rounded-lg focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary font-body-sm text-body-sm text-on-surface transition-all placeholder:text-outline"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="w-full md:w-auto flex flex-wrap gap-2 items-center">
          {/* Status Filter */}
          <div className="relative">
            <button
              onClick={() => setStatusOpen(!statusOpen)}
              className="flex items-center gap-2 px-3 py-2 bg-surface-container-low border border-outline-variant/30 rounded-lg font-label-caps text-label-caps text-on-surface-variant hover:bg-surface-container-highest transition-colors whitespace-nowrap"
            >
              Status: {statusFilter || "All"}
              <span className="material-symbols-outlined text-[18px]">keyboard_arrow_down</span>
            </button>
            {statusOpen && (
              <div className="absolute top-full left-0 mt-1 bg-surface-container-lowest border border-outline-variant/30 rounded-lg shadow-[0_12px_40px_rgba(15,23,42,0.08)] z-20 py-1 min-w-[160px]">
                {STATUS_OPTIONS.map((s) => (
                  <button
                    key={s}
                    className={`w-full text-left px-4 py-2 font-label-caps text-label-caps hover:bg-surface-container-high transition-colors ${
                      statusFilter === s ? "text-primary bg-primary-container/10" : "text-on-surface"
                    }`}
                    onClick={() => {
                      setStatusFilter(s);
                      setStatusOpen(false);
                    }}
                  >
                    {s || "All"}
                  </button>
                ))}
              </div>
            )}
          </div>

          {(search || statusFilter) && (
            <button
              onClick={() => {
                setSearch("");
                setStatusFilter("");
              }}
              className="p-2 border border-outline-variant/30 rounded-lg text-on-surface-variant hover:bg-surface-container-high transition-colors"
              title="Clear filters"
            >
              <span className="material-symbols-outlined text-[18px]">filter_list_off</span>
            </button>
          )}
        </div>
      </div>

      {/* Data Table */}
      <div className="bg-surface-container-lowest border border-outline-variant/20 rounded-b-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container-lowest border-b border-outline-variant/20">
                <th className="py-3 px-4 font-label-caps text-label-caps text-outline font-medium tracking-wider whitespace-nowrap">
                  Return ID
                </th>
                <th className="py-3 px-4 font-label-caps text-label-caps text-outline font-medium tracking-wider whitespace-nowrap">
                  Order
                </th>
                <th className="py-3 px-4 font-label-caps text-label-caps text-outline font-medium tracking-wider whitespace-nowrap">
                  Customer
                </th>
                <th className="py-3 px-4 font-label-caps text-label-caps text-outline font-medium tracking-wider whitespace-nowrap">
                  Reason
                </th>
                <th className="py-3 px-4 font-label-caps text-label-caps text-outline font-medium tracking-wider whitespace-nowrap text-center">
                  Status
                </th>
                <th className="py-3 px-4 font-label-caps text-label-caps text-outline font-medium tracking-wider whitespace-nowrap">
                  Date
                </th>
                <th className="py-3 px-4 font-label-caps text-label-caps text-outline font-medium tracking-wider w-16"></th>
              </tr>
            </thead>
            <tbody className="font-body-sm text-body-sm text-on-surface">
              {loading ? (
                <>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <tr key={i} className="border-b border-outline-variant/10">
                      {[1, 2, 3, 4, 5, 6, 7].map((j) => (
                        <td key={j} className="py-3 px-4">
                          <div className="h-4 bg-surface-container-low rounded animate-pulse" />
                        </td>
                      ))}
                    </tr>
                  ))}
                </>
              ) : filteredReturns.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-16 px-4">
                    <div className="flex flex-col items-center gap-3 text-center">
                      <span className="material-symbols-outlined text-outline text-[48px]">
                        assignment_return
                      </span>
                      <p className="font-body-md text-body-md text-on-surface-variant">
                        {search || statusFilter ? "No returns match your filters" : "No returns yet"}
                      </p>
                      {(search || statusFilter) && (
                        <button
                          onClick={() => {
                            setSearch("");
                            setStatusFilter("");
                          }}
                          className="font-label-caps text-label-caps text-primary hover:underline"
                        >
                          Clear filters
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredReturns.map((ret) => (
                  <tr
                    key={ret._id}
                    className="border-b border-outline-variant/10 hover:bg-surface-container-lowest/50 cursor-pointer group transition-colors"
                    onClick={() => router.push(`/admin/returns/${ret._id}`)}
                  >
                    <td className="py-3 px-4 font-label-caps text-[11px] text-on-surface-variant tracking-wider">
                      {ret._id?.slice(-8).toUpperCase()}
                    </td>
                    <td className="py-3 px-4">
                      <button
                        className="font-label-caps text-label-caps text-primary hover:underline text-[11px]"
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(`/admin/orders/${ret.orderId}`);
                        }}
                      >
                        {ret.orderNumber || ret.orderId?.slice(-8).toUpperCase()}
                      </button>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium">{ret.userId?.name || "Unknown"}</div>
                      <div className="text-xs text-on-surface-variant">{ret.userId?.email}</div>
                    </td>
                    <td className="py-3 px-4 text-on-surface-variant max-w-[180px] truncate">
                      {ret.reason || "—"}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-label-caps ${getStatusColor(ret.status)}`}
                      >
                        <span className="material-symbols-outlined text-[12px]">
                          {getStatusIcon(ret.status)}
                        </span>
                        {ret.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 whitespace-nowrap text-on-surface-variant">
                      {new Date(ret.createdAt).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </td>
                    <td className="py-3 px-4">
                      <button className="p-1.5 text-outline hover:text-on-surface hover:bg-surface-container-high rounded transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100">
                        <span className="material-symbols-outlined text-[20px]">chevron_right</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="h-8" />
    </div>
  );
}
