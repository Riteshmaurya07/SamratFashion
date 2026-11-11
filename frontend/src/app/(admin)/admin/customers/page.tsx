"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { api } from "@/lib/api";
import { useRouter } from "next/navigation";
import Link from "next/link";

const STATUS_OPTIONS = ["", "ACTIVE", "SUSPENDED", "DISABLED"];

interface CustomerItem {
  _id: string;
  name: string;
  email: string;
  phone?: string;
  status: "ACTIVE" | "SUSPENDED" | "DISABLED";
  createdAt: string;
  orderCount?: number;
  totalPaidAmount?: number;
}

interface CustomerSummary {
  total: number;
  active: number;
  suspended: number;
  disabled: number;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "response" in error) {
    const res = (error as { response?: unknown }).response;
    if (res && typeof res === "object" && "data" in res) {
      const data = (res as { data?: unknown }).data;
      if (data && typeof data === "object" && "message" in data) {
        const msg = (data as { message?: unknown }).message;
        if (typeof msg === "string" && msg.trim()) return msg;
      }
    }
  }
  return fallback;
}

export default function AdminCustomersPage() {
  const router = useRouter();
  const [customers, setCustomers] = useState<CustomerItem[]>([]);
  const [summary, setSummary] = useState<CustomerSummary>({
    total: 0,
    active: 0,
    suspended: 0,
    disabled: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [statusOpen, setStatusOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const statusMenuRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Click-outside and Escape key dismissal for status dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (statusMenuRef.current && !statusMenuRef.current.contains(target)) {
        setStatusOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setStatusOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 400);
    return () => clearTimeout(handler);
  }, [search]);

  const fetchCustomers = useCallback(async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    try {
      const res = await api.get("/admin/customers", {
        params: { search: debouncedSearch, status, page, limit: 10 },
        signal: controller.signal,
      });
      setCustomers(res.data.data.items || []);
      setTotalPages(res.data.data.totalPages || 1);
      setTotal(res.data.data.total || 0);
      if (res.data.data.summary) {
        setSummary(res.data.data.summary);
      }
      setError("");
    } catch (err: unknown) {
      if (err && typeof err === "object" && "name" in err && (err as { name?: string }).name === "CanceledError") {
        return;
      }
      setError(getErrorMessage(err, "Failed to fetch customers"));
    } finally {
      if (abortControllerRef.current === controller) {
        setLoading(false);
      }
    }
  }, [debouncedSearch, status, page]);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  const handleExportCSV = async () => {
    try {
      setExporting(true);
      setError("");
      const response = await api.get("/admin/customers/export", { responseType: "blob" });
      const blob = new Blob([response.data], { type: "text/csv" });
      let filename = `customers-export-${new Date().toISOString().split("T")[0]}.csv`;
      const disposition = response.headers?.["content-disposition"];
      if (typeof disposition === "string") {
        const match = disposition.match(/filename="?([^"]+)"?/i);
        if (match && match[1]) {
          filename = match[1];
        }
      }
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to export customers CSV"));
    } finally {
      setExporting(false);
    }
  };

  const getStatusBadge = (s: string) => {
    switch (s) {
      case "ACTIVE":
        return "bg-emerald-50 text-emerald-700 border border-emerald-200";
      case "SUSPENDED":
        return "bg-rose-50 text-rose-700 border border-rose-200";
      case "DISABLED":
        return "bg-neutral-100 text-neutral-600 border border-neutral-300";
      default:
        return "bg-neutral-100 text-neutral-700 border border-neutral-200";
    }
  };

function formatInitials(name?: string): string {
  if (!name || !name.trim()) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

  return (
    <div className="flex flex-col gap-5">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-headline-lg text-2xl font-bold text-on-background">Customers</h1>
          <p className="font-body-md text-sm text-on-surface-variant max-w-2xl mt-0.5">
            Manage customer accounts, verify contact details, monitor order history, and control login access.
          </p>
        </div>
        <button
          onClick={handleExportCSV}
          disabled={exporting || loading}
          className="flex items-center gap-2 px-3.5 py-2 border border-outline-variant/60 text-on-surface font-mono text-xs font-bold rounded-lg hover:bg-surface-container transition-colors disabled:opacity-50 self-start sm:self-auto shadow-xs"
        >
          <span className="material-symbols-outlined text-[17px] text-primary">download</span>
          <span>{exporting ? "Exporting CSV..." : "Export Customers"}</span>
        </button>
      </div>

      {error && (
        <div className="text-error bg-error-container/20 border border-error/30 p-3.5 rounded-xl text-xs font-semibold flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px]">error_outline</span>
            <span>{error}</span>
          </div>
          <button onClick={() => setError("")} className="hover:opacity-70">
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      )}

      {/* Store-wide KPI Summary Cards */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <button
          type="button"
          onClick={() => { setStatus(""); setSearch(""); setPage(1); }}
          className={`text-left bg-surface-container-lowest border rounded-xl p-3.5 flex flex-col justify-between shadow-xs transition-all cursor-pointer ${
            status === "" ? "border-primary ring-2 ring-primary/20 bg-primary/[0.02]" : "border-outline-variant/30 hover:border-outline-variant hover:shadow-sm"
          }`}
        >
          <p className="font-mono text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Total Customers</p>
          <p className="font-mono text-2xl font-bold text-on-surface mt-1">
            {loading ? "—" : summary.total.toLocaleString("en-IN")}
          </p>
        </button>

        <button
          type="button"
          onClick={() => { setStatus((prev) => (prev === "ACTIVE" ? "" : "ACTIVE")); setPage(1); }}
          className={`text-left bg-surface-container-lowest border rounded-xl p-3.5 flex flex-col justify-between shadow-xs transition-all cursor-pointer ${
            status === "ACTIVE" ? "border-emerald-600 ring-2 ring-emerald-500/20 bg-emerald-500/[0.04]" : "border-outline-variant/30 hover:border-emerald-300 hover:shadow-sm"
          }`}
        >
          <p className="font-mono text-[10px] font-bold text-emerald-700 uppercase tracking-wider">Active</p>
          <p className="font-mono text-2xl font-bold text-emerald-900 mt-1">
            {loading ? "—" : summary.active.toLocaleString("en-IN")}
          </p>
        </button>

        <button
          type="button"
          onClick={() => { setStatus((prev) => (prev === "SUSPENDED" ? "" : "SUSPENDED")); setPage(1); }}
          className={`text-left bg-surface-container-lowest border rounded-xl p-3.5 flex flex-col justify-between shadow-xs transition-all cursor-pointer ${
            status === "SUSPENDED" ? "border-rose-600 ring-2 ring-rose-500/20 bg-rose-500/[0.04]" : "border-outline-variant/30 hover:border-rose-300 hover:shadow-sm"
          }`}
        >
          <p className="font-mono text-[10px] font-bold text-rose-700 uppercase tracking-wider">Suspended</p>
          <p className="font-mono text-2xl font-bold text-rose-900 mt-1">
            {loading ? "—" : summary.suspended.toLocaleString("en-IN")}
          </p>
        </button>

        <button
          type="button"
          onClick={() => { setStatus((prev) => (prev === "DISABLED" ? "" : "DISABLED")); setPage(1); }}
          className={`text-left bg-surface-container-lowest border rounded-xl p-3.5 flex flex-col justify-between shadow-xs transition-all cursor-pointer ${
            status === "DISABLED" ? "border-neutral-600 ring-2 ring-neutral-500/20 bg-neutral-500/[0.04]" : "border-outline-variant/30 hover:border-neutral-300 hover:shadow-sm"
          }`}
        >
          <p className="font-mono text-[10px] font-bold text-neutral-600 uppercase tracking-wider">Disabled</p>
          <p className="font-mono text-2xl font-bold text-neutral-800 mt-1">
            {loading ? "—" : summary.disabled.toLocaleString("en-IN")}
          </p>
        </button>
      </section>

      {/* Filter Toolbar */}
      <div className="flex flex-col md:flex-row gap-3 items-start md:items-center justify-between bg-surface-container-lowest p-3.5 rounded-t-xl border border-outline-variant/20 border-b-0 shadow-xs">
        {/* Search Input */}
        <div className="w-full md:w-auto flex-1 max-w-md relative">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-[18px]">search</span>
          <input
            type="text"
            placeholder="Search by name, email, phone, or ID..."
            className="w-full pl-9 pr-4 py-2 bg-surface-container-low border border-outline-variant/30 rounded-lg focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary text-xs font-medium text-on-surface transition-all placeholder:text-outline"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-outline hover:text-on-surface"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          )}
        </div>

        {/* Status Dropdown Filter */}
        <div className="w-full md:w-auto flex flex-wrap gap-2 items-center">
          <div className="relative" ref={statusMenuRef}>
            <button
              data-testid="status-dropdown-button"
              onClick={() => setStatusOpen(!statusOpen)}
              className="flex items-center gap-1.5 px-3 py-2 bg-surface-container-low border border-outline-variant/30 rounded-lg text-xs font-bold text-on-surface-variant hover:bg-surface-container transition-colors whitespace-nowrap"
              aria-haspopup="menu"
              aria-expanded={statusOpen}
            >
              Status: {status || "All"}
              <span className="material-symbols-outlined text-[16px]">keyboard_arrow_down</span>
            </button>
            {statusOpen && (
              <div
                role="menu"
                data-testid="status-dropdown-menu"
                className="absolute top-full right-0 mt-1 bg-surface-container-lowest border border-outline-variant/30 rounded-xl shadow-[0_12px_40px_rgba(15,23,42,0.12)] z-30 py-1 min-w-[150px]"
              >
                {STATUS_OPTIONS.map((s) => (
                  <button
                    key={s}
                    role="menuitem"
                    className={`w-full text-left px-3.5 py-1.5 text-xs font-medium hover:bg-surface-container transition-colors ${
                      status === s ? "text-primary font-bold bg-primary/5" : "text-on-surface"
                    }`}
                    onClick={() => {
                      setStatus(s);
                      setStatusOpen(false);
                      setPage(1);
                    }}
                  >
                    {s || "All Customers"}
                  </button>
                ))}
              </div>
            )}
          </div>

          {(search || status) && (
            <button
              onClick={() => {
                setSearch("");
                setStatus("");
                setPage(1);
              }}
              className="p-2 border border-outline-variant/30 rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors"
              title="Clear all filters"
            >
              <span className="material-symbols-outlined text-[17px]">filter_list_off</span>
            </button>
          )}
        </div>
      </div>

      {/* Data Table Container */}
      <div className="bg-surface-container-lowest border border-outline-variant/20 rounded-b-xl overflow-hidden shadow-xs">
        {/* Mobile Card View (shown on screens < 768px) */}
        <div className="block md:hidden divide-y divide-outline-variant/20 p-3 space-y-3">
          {loading ? (
            <div className="py-12 text-center text-xs font-mono text-neutral-400">Loading customers...</div>
          ) : customers.length === 0 ? (
            <div className="py-12 text-center text-xs text-neutral-500 font-mono">No customers found</div>
          ) : (
            customers.map((c) => (
              <div
                key={c._id}
                onClick={() => router.push(`/admin/customers/${c._id}`)}
                className="bg-surface border border-outline-variant/30 rounded-xl p-3.5 space-y-3 shadow-2xs cursor-pointer hover:border-primary transition-colors"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs shrink-0 border border-primary/20">
                      {formatInitials(c.name)}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-xs text-on-surface truncate">{c.name}</p>
                      <p className="text-[11px] text-on-surface-variant font-mono truncate">{c.email}</p>
                    </div>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase shrink-0 ${getStatusBadge(c.status)}`}>
                    {c.status}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1.5 border-t border-outline-variant/15 text-xs font-mono">
                  <div>
                    <span className="text-[10px] text-neutral-400 block uppercase">Phone</span>
                    <span className="text-on-surface">{c.phone || "—"}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-neutral-400 block uppercase">Total Spent</span>
                    <strong className="text-neutral-900 font-bold">₹{(c.totalPaidAmount || 0).toLocaleString("en-IN")}</strong>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1 border-t border-outline-variant/15 text-[11px] text-neutral-500 font-mono">
                  <span>ID: #{c._id?.slice(-8).toUpperCase()}</span>
                  <span className="text-primary font-bold inline-flex items-center gap-1">
                    <span>View Details</span>
                    <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                  </span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Desktop Data Table (hidden on mobile, shown on md+) */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container-lowest border-b border-outline-variant/20">
                <th className="py-3 px-4 font-mono text-[11px] uppercase font-bold text-outline tracking-wider whitespace-nowrap">Customer</th>
                <th className="py-3 px-4 font-mono text-[11px] uppercase font-bold text-outline tracking-wider whitespace-nowrap">Contact</th>
                <th className="py-3 px-4 font-mono text-[11px] uppercase font-bold text-outline tracking-wider whitespace-nowrap">Customer ID</th>
                <th className="py-3 px-4 font-mono text-[11px] uppercase font-bold text-outline tracking-wider whitespace-nowrap text-right">Orders</th>
                <th className="py-3 px-4 font-mono text-[11px] uppercase font-bold text-outline tracking-wider whitespace-nowrap text-right">Total Spent</th>
                <th className="py-3 px-4 font-mono text-[11px] uppercase font-bold text-outline tracking-wider whitespace-nowrap text-center">Status</th>
                <th className="py-3 px-4 font-mono text-[11px] uppercase font-bold text-outline tracking-wider whitespace-nowrap">Joined</th>
                <th className="py-3 px-4 font-mono text-[11px] uppercase font-bold text-outline tracking-wider whitespace-nowrap text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="text-xs text-on-surface">
              {loading ? (
                <>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <tr key={i} className="border-b border-outline-variant/10">
                      {[1, 2, 3, 4, 5, 6, 7, 8].map((j) => (
                        <td key={j} className="py-3.5 px-4">
                          <div className="h-4 bg-surface-container-low rounded animate-pulse" />
                        </td>
                      ))}
                    </tr>
                  ))}
                </>
              ) : customers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-16 px-4 text-center">
                    <div className="flex flex-col items-center gap-2.5 text-center">
                      <span className="material-symbols-outlined text-outline text-[44px]">group_off</span>
                      <p className="font-semibold text-sm text-on-surface-variant font-mono">No customers found</p>
                      {(search || status) && (
                        <button
                          onClick={() => { setSearch(""); setStatus(""); }}
                          className="font-mono text-xs text-primary font-bold hover:underline"
                        >
                          Clear all filters
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                customers.map((c) => (
                  <tr
                    key={c._id}
                    className="hover:bg-surface-container-low transition-colors group cursor-pointer border-b border-outline-variant/10"
                    onClick={() => router.push(`/admin/customers/${c._id}`)}
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs shrink-0 border border-primary/20">
                          {formatInitials(c.name)}
                        </div>
                        <div>
                          <p className="font-semibold text-xs text-on-surface group-hover:underline">{c.name}</p>
                          <p className="text-[11px] text-on-surface-variant font-mono">{c.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] text-on-surface-variant whitespace-nowrap">
                      {c.phone ? (
                        <span className="inline-flex items-center gap-1">
                          <span className="material-symbols-outlined text-[13px] text-outline">call</span>
                          <span>{c.phone}</span>
                        </span>
                      ) : (
                        <span className="text-outline">—</span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] text-outline">
                      #{c._id?.slice(-8).toUpperCase()}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-right">
                      {c.orderCount || 0}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs font-bold text-neutral-900 text-right">
                      ₹{(c.totalPaidAmount || 0).toLocaleString("en-IN")}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${getStatusBadge(c.status)}`}>
                        {c.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono text-[11px] text-outline whitespace-nowrap">
                      {new Date(c.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <Link
                        href={`/admin/customers/${c._id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="p-1.5 text-outline hover:text-primary hover:bg-surface-container rounded-md transition-colors inline-flex items-center gap-1"
                        title="View Customer Profile"
                      >
                        <span className="material-symbols-outlined text-[18px]">visibility</span>
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {!loading && (
          <div className="p-3.5 border-t border-outline-variant/20 flex items-center justify-between bg-surface-container-lowest">
            <p className="font-mono text-xs text-on-surface-variant">
              {total > 0 ? `Showing page ${page} of ${totalPages} (${total.toLocaleString()} total customers)` : "No results"}
            </p>
            <div className="flex gap-1 items-center">
              <button
                disabled={page === 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="p-1.5 rounded-md hover:bg-surface-container text-outline transition-colors disabled:opacity-40"
              >
                <span className="material-symbols-outlined text-[18px]">chevron_left</span>
              </button>
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                const pageNum = page <= 3 ? i + 1 : page - 2 + i;
                if (pageNum < 1 || pageNum > totalPages) return null;
                return (
                  <button
                    key={pageNum}
                    onClick={() => setPage(pageNum)}
                    className={`w-7 h-7 rounded-md font-mono text-xs font-bold flex items-center justify-center transition-colors ${
                      pageNum === page ? "bg-neutral-900 text-white shadow-2xs" : "hover:bg-surface-container text-on-surface"
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}
              <button
                disabled={page === totalPages || totalPages === 0}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="p-1.5 rounded-md hover:bg-surface-container text-outline transition-colors disabled:opacity-40"
              >
                <span className="material-symbols-outlined text-[18px]">chevron_right</span>
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="h-6" />
    </div>
  );
}
