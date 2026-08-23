"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { useRouter } from "next/navigation";

const STATUS_OPTIONS = ["", "ACTIVE", "SUSPENDED", "DISABLED"];

export default function AdminCustomersPage() {
  const router = useRouter();
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [statusOpen, setStatusOpen] = useState(false);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 400);
    return () => clearTimeout(handler);
  }, [search]);

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/admin/customers", {
        params: { search: debouncedSearch, status, page, limit: 10 },
      });
      setCustomers(res.data.data.items);
      setTotalPages(res.data.data.totalPages);
      setTotal(res.data.data.total || 0);
      setError("");
    } catch (err: any) {
      setError("Failed to fetch customers");
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, status, page]);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "ACTIVE": return "bg-primary-fixed text-on-primary-fixed-variant border border-primary/20";
      case "SUSPENDED": return "bg-error-container text-on-error-container border border-error/20";
      case "DISABLED": return "bg-surface-container-high text-on-surface-variant border border-outline/20";
      default: return "bg-surface-container-high text-on-surface-variant border border-outline-variant";
    }
  };

  const getInitials = (name: string) =>
    name ? name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2) : "?";

  const activeCount = customers.filter(c => c.status === "ACTIVE").length;

  return (
    <div className="flex flex-col gap-element-gap md:gap-gutter">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-2">
        <div>
          <h1 className="font-headline-lg text-headline-lg text-on-background mb-1">Customers</h1>
          <p className="font-body-md text-body-md text-on-surface-variant max-w-2xl">
            Manage customer accounts, activity, orders and customer relationships.
          </p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 border border-outline-variant text-on-surface font-label-caps text-label-caps rounded-lg hover:bg-surface-container-high transition-colors self-start md:self-auto">
          <span className="material-symbols-outlined text-[18px]">download</span>
          Export Customers
        </button>
      </div>

      {error && (
        <div className="text-error bg-error-container/20 p-4 rounded-md font-body-sm flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">error_outline</span>
          {error}
        </div>
      )}

      {/* KPI Cards */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Customers", value: total, color: "text-on-surface" },
          { label: "Active", value: customers.filter(c => c.status === "ACTIVE").length, color: "text-primary" },
          { label: "Suspended", value: customers.filter(c => c.status === "SUSPENDED").length, color: "text-secondary" },
          { label: "Disabled", value: customers.filter(c => c.status === "DISABLED").length, color: "text-outline" },
        ].map(kpi => (
          <div key={kpi.label} className="bg-surface-container-low p-5 rounded-xl border border-outline-variant/30 hover:scale-[1.02] transition-transform">
            <p className="font-label-caps text-label-caps text-on-surface-variant mb-2">{kpi.label}</p>
            <p className={`font-price-lg text-price-lg ${kpi.color}`}>{loading ? "—" : kpi.value.toLocaleString()}</p>
          </div>
        ))}
      </section>

      {/* Filter Toolbar */}
      <div className="flex flex-col md:flex-row gap-3 items-start md:items-center justify-between bg-surface-container-lowest p-4 rounded-t-xl border border-outline-variant/20 border-b-0">
        {/* Search */}
        <div className="w-full md:w-auto flex-1 max-w-md relative">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-[18px]">search</span>
          <input
            type="text"
            placeholder="Search by name, email or phone..."
            className="w-full pl-10 pr-4 py-2.5 bg-surface-container-low border border-outline-variant/30 rounded-lg focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary font-body-sm text-body-sm text-on-surface transition-all placeholder:text-outline"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Status Filter */}
        <div className="w-full md:w-auto flex flex-wrap gap-2 items-center">
          <div className="relative">
            <button
              onClick={() => setStatusOpen(!statusOpen)}
              className="flex items-center gap-2 px-3 py-2 bg-surface-container-low border border-outline-variant/30 rounded-lg font-label-caps text-label-caps text-on-surface-variant hover:bg-surface-container-highest transition-colors whitespace-nowrap"
            >
              Status: {status || "All"}
              <span className="material-symbols-outlined text-[18px]">keyboard_arrow_down</span>
            </button>
            {statusOpen && (
              <div className="absolute top-full left-0 mt-1 bg-surface-container-lowest border border-outline-variant/30 rounded-lg shadow-[0_12px_40px_rgba(15,23,42,0.08)] z-20 py-1 min-w-[140px]">
                {STATUS_OPTIONS.map(s => (
                  <button
                    key={s}
                    className={`w-full text-left px-4 py-2 font-label-caps text-label-caps hover:bg-surface-container-high transition-colors ${status === s ? "text-primary bg-primary-container/10" : "text-on-surface"}`}
                    onClick={() => { setStatus(s); setStatusOpen(false); setPage(1); }}
                  >
                    {s || "All"}
                  </button>
                ))}
              </div>
            )}
          </div>

          {(search || status) && (
            <button
              onClick={() => { setSearch(""); setStatus(""); setPage(1); }}
              className="p-2 border border-outline-variant/30 rounded-lg text-on-surface-variant hover:bg-surface-container-high transition-colors"
              title="Clear filters"
            >
              <span className="material-symbols-outlined text-[18px]">filter_list_off</span>
            </button>
          )}
        </div>
      </div>

      {/* Data Table */}
      <div className="bg-surface border border-outline-variant/50 rounded-b-xl overflow-hidden shadow-[0_12px_40px_rgba(15,23,42,0.08)]">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container-low border-b border-outline-variant/50">
                <th className="p-4 font-label-caps text-label-caps text-on-surface-variant font-medium">Customer</th>
                <th className="p-4 font-label-caps text-label-caps text-on-surface-variant font-medium">Customer ID</th>
                <th className="p-4 font-label-caps text-label-caps text-on-surface-variant font-medium text-right">Orders</th>
                <th className="p-4 font-label-caps text-label-caps text-on-surface-variant font-medium text-right">Total Spent</th>
                <th className="p-4 font-label-caps text-label-caps text-on-surface-variant font-medium">Status</th>
                <th className="p-4 font-label-caps text-label-caps text-on-surface-variant font-medium">Joined</th>
                <th className="p-4 font-label-caps text-label-caps text-on-surface-variant font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/30">
              {loading ? (
                <>
                  {[1, 2, 3, 4, 5].map(i => (
                    <tr key={i}>
                      {[1, 2, 3, 4, 5, 6, 7].map(j => (
                        <td key={j} className="p-4">
                          <div className="h-4 bg-surface-container-low rounded animate-pulse" />
                        </td>
                      ))}
                    </tr>
                  ))}
                </>
              ) : customers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-16 px-4">
                    <div className="flex flex-col items-center gap-3 text-center">
                      <span className="material-symbols-outlined text-outline text-[48px]">group_off</span>
                      <p className="font-body-md text-body-md text-on-surface-variant">No customers found</p>
                      {(search || status) && (
                        <button
                          onClick={() => { setSearch(""); setStatus(""); }}
                          className="font-label-caps text-label-caps text-primary hover:underline"
                        >
                          Clear filters
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                customers.map((c) => (
                  <tr
                    key={c._id}
                    className="hover:bg-surface-container-low/50 transition-colors group cursor-pointer"
                    onClick={() => router.push(`/admin/customers/${c._id}`)}
                  >
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        {/* Avatar */}
                        <div className="w-10 h-10 rounded-full bg-primary-container text-on-primary-container flex items-center justify-center font-headline-sm text-[14px] font-bold flex-shrink-0 border border-outline-variant/20">
                          {getInitials(c.name)}
                        </div>
                        <div>
                          <p className="font-body-sm text-body-sm font-semibold text-on-surface">{c.name}</p>
                          <p className="font-body-sm text-body-sm text-on-surface-variant text-xs">{c.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="p-4 font-label-caps text-label-caps text-on-surface-variant">
                      {c._id?.slice(-8).toUpperCase()}
                    </td>
                    <td className="p-4 font-body-sm text-body-sm text-on-surface text-right">
                      {c.orderCount || 0}
                    </td>
                    <td className="p-4 font-label-caps text-label-caps text-on-surface font-semibold text-right">
                      ₹{(c.totalPaidAmount || 0).toLocaleString("en-IN")}
                    </td>
                    <td className="p-4">
                      <span className={`px-2.5 py-1 rounded-full font-label-caps text-[10px] ${getStatusBadge(c.status)}`}>
                        {c.status}
                      </span>
                    </td>
                    <td className="p-4 font-body-sm text-body-sm text-on-surface-variant whitespace-nowrap">
                      {new Date(c.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          className="text-on-surface-variant hover:text-primary transition-colors"
                          onClick={(e) => { e.stopPropagation(); router.push(`/admin/customers/${c._id}`); }}
                          title="View customer"
                        >
                          <span className="material-symbols-outlined text-[20px]">visibility</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {!loading && (
          <div className="bg-surface border-t border-outline-variant/30 px-6 py-4 flex items-center justify-between">
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              {total > 0 ? `Showing page ${page} of ${totalPages} (${total.toLocaleString()} total)` : "No results"}
            </p>
            <div className="flex gap-1 items-center">
              <button
                disabled={page === 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
                className="px-3 py-1 border border-outline-variant rounded hover:bg-surface-container-low text-on-surface-variant disabled:opacity-50 transition-colors font-label-caps text-label-caps"
              >
                Prev
              </button>
              {Array.from({ length: Math.min(totalPages, 3) }, (_, i) => (
                <button
                  key={i + 1}
                  onClick={() => setPage(i + 1)}
                  className={`px-3 py-1 border rounded font-label-caps text-label-caps transition-colors ${page === i + 1 ? "border-primary bg-primary text-on-primary" : "border-outline-variant hover:bg-surface-container-low text-on-surface-variant"}`}
                >
                  {i + 1}
                </button>
              ))}
              {totalPages > 3 && <span className="px-2 text-on-surface-variant">...</span>}
              <button
                disabled={page === totalPages || totalPages === 0}
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                className="px-3 py-1 border border-outline-variant rounded hover:bg-surface-container-low text-on-surface-variant disabled:opacity-50 transition-colors font-label-caps text-label-caps"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="h-8" />
    </div>
  );
}
