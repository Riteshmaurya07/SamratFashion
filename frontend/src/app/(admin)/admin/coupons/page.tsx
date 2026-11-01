"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import Link from "next/link";

export default function AdminCouponsPage() {
  const [coupons, setCoupons] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [, setTotalPages] = useState(1);
  const [, setTotal] = useState(0);

  const fetchCoupons = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/admin/coupons", {
        params: { search, status, page, limit: 10 },
      });
      setCoupons(res.data.data.items);
      setTotalPages(res.data.data.totalPages);
      setTotal(res.data.data.total || 0);
      setError("");
    } catch (err: any) {
      setError("Failed to fetch coupons");
    } finally {
      setLoading(false);
    }
  }, [search, status, page]);

  useEffect(() => {
    fetchCoupons();
  }, [fetchCoupons]);

  const toggleStatus = async (id: string, currentStatus: string) => {
    try {
      const nextStatus = currentStatus === "ACTIVE" ? "INACTIVE" : "ACTIVE";
      await api.patch(`/admin/coupons/${id}/status`, { status: nextStatus });
      fetchCoupons();
    } catch (err: any) {
      alert(err.response?.data?.message || "Failed to update coupon status");
    }
  };

  return (
    <div className="flex flex-col gap-element-gap md:gap-gutter">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-2">
        <div>
          <h1 className="font-headline-lg text-2xl sm:text-3xl font-black text-on-background mb-1">
            Coupons &amp; Discounts
          </h1>
          <p className="font-body-md text-xs sm:text-sm text-on-surface-variant max-w-2xl">
            Create and manage promotional discount codes, usage limits, and validity periods.
          </p>
        </div>
        <Link
          href="/admin/coupons/new"
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-on-primary font-mono text-xs uppercase font-bold rounded-lg hover:opacity-90 transition-opacity shadow-sm min-h-[40px]"
        >
          <span className="material-symbols-outlined text-[18px]">add</span>
          Create Coupon
        </Link>
      </div>

      {error && (
        <div className="text-error bg-error-container/20 p-4 rounded-md font-body-sm flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">error_outline</span>
          {error}
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="flex flex-col md:flex-row gap-3 items-start md:items-center justify-between bg-surface-container-lowest p-4 rounded-t-xl border border-outline-variant/20 border-b-0">
        <div className="w-full md:w-auto flex-1 max-w-md relative">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-[18px]">
            search
          </span>
          <input
            type="text"
            placeholder="Search by coupon code or description..."
            className="w-full pl-10 pr-4 py-2.5 bg-surface-container-low border border-outline-variant/30 rounded-lg focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary font-body-sm text-body-sm text-on-surface transition-all placeholder:text-outline"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="w-full md:w-auto flex flex-wrap gap-2 items-center">
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 bg-surface-container-low border border-outline-variant/30 rounded-lg font-label-caps text-label-caps text-on-surface-variant hover:bg-surface-container-highest transition-colors cursor-pointer"
          >
            <option value="">All Statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>

          {(search || status) && (
            <button
              onClick={() => {
                setSearch("");
                setStatus("");
                setPage(1);
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
      {/* Data Table Container */}
      <div className="bg-surface border border-outline-variant/50 rounded-b-xl overflow-hidden shadow-[0_12px_40px_rgba(15,23,42,0.08)]">
        {/* Mobile Card View (shown on screens < 768px) */}
        <div className="block md:hidden bg-surface-container-lowest divide-y divide-outline-variant/20 p-3 space-y-3">
          {loading ? (
            <div className="py-12 text-center text-xs font-mono text-neutral-400">Loading coupons...</div>
          ) : coupons.length === 0 ? (
            <div className="py-12 text-center text-xs text-neutral-500">No coupons found</div>
          ) : (
            coupons.map((c) => (
              <div key={c._id} className="bg-surface border border-outline-variant/30 rounded-xl p-3.5 space-y-3 shadow-xs">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="font-mono text-sm font-bold text-primary bg-primary-container/20 px-2.5 py-1 rounded-md border border-primary/20 inline-block">
                      {c.code}
                    </span>
                    <p className="font-semibold text-xs text-on-surface mt-1.5">
                      {c.discountType === "PERCENTAGE" ? `${c.discountValue}% OFF` : `₹${c.discountValue} OFF`}
                      {c.maxDiscountAmount && <span className="text-neutral-500 text-[11px] font-normal"> (Max ₹{c.maxDiscountAmount})</span>}
                    </p>
                  </div>
                  <span
                    className={`px-2.5 py-0.5 rounded-full font-mono text-[10px] font-bold uppercase shrink-0 ${
                      c.status === "ACTIVE" ? "bg-emerald-100 text-emerald-800" : "bg-neutral-100 text-neutral-600"
                    }`}
                  >
                    {c.status}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs font-mono text-neutral-600 pt-2 border-t border-outline-variant/20">
                  <div>
                    <span className="text-[10px] text-neutral-400 block uppercase">Min Order</span>
                    <strong className="text-on-surface">{c.minOrderValue > 0 ? `₹${c.minOrderValue.toLocaleString()}` : "No min"}</strong>
                  </div>
                  <div>
                    <span className="text-[10px] text-neutral-400 block uppercase">Usage</span>
                    <strong className="text-on-surface">{c.usedCount} {c.usageLimit ? `/ ${c.usageLimit}` : "(Unlimited)"}</strong>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-outline-variant/15 text-xs">
                  <span className="font-mono text-[11px] text-neutral-500">
                    Expires: {c.expiresAt ? new Date(c.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "Never"}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggleStatus(c._id, c.status)}
                      className="px-3 py-1.5 text-xs font-mono font-bold rounded-lg border border-outline-variant/60 hover:bg-surface-container transition-colors min-h-[36px]"
                    >
                      {c.status === "ACTIVE" ? "Deactivate" : "Activate"}
                    </button>
                    <Link
                      href={`/admin/coupons/${c._id}/edit`}
                      className="p-2 text-on-surface-variant hover:text-primary rounded-lg border border-outline-variant/40 hover:bg-surface-container transition-colors flex items-center justify-center min-h-[36px] min-w-[36px]"
                      title="Edit coupon"
                    >
                      <span className="material-symbols-outlined text-[18px]">edit</span>
                    </Link>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Desktop Data Table (hidden on mobile, shown on md+) */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container-low border-b border-outline-variant/50">
                <th className="p-4 font-label-caps text-label-caps text-on-surface-variant font-medium">Code</th>
                <th className="p-4 font-label-caps text-label-caps text-on-surface-variant font-medium">Discount</th>
                <th className="p-4 font-label-caps text-label-caps text-on-surface-variant font-medium">Min Order</th>
                <th className="p-4 font-label-caps text-label-caps text-on-surface-variant font-medium">Usage</th>
                <th className="p-4 font-label-caps text-label-caps text-on-surface-variant font-medium">Status</th>
                <th className="p-4 font-label-caps text-label-caps text-on-surface-variant font-medium">Expiry</th>
                <th className="p-4 font-label-caps text-label-caps text-on-surface-variant font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/30">
              {loading ? (
                <>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <tr key={i}>
                      {[1, 2, 3, 4, 5, 6, 7].map((j) => (
                        <td key={j} className="p-4">
                          <div className="h-4 bg-surface-container-low rounded animate-pulse" />
                        </td>
                      ))}
                    </tr>
                  ))}
                </>
              ) : coupons.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-16 px-4">
                    <div className="flex flex-col items-center gap-3 text-center">
                      <span className="material-symbols-outlined text-outline text-[48px]">sell</span>
                      <p className="font-body-md text-body-md text-on-surface-variant">No coupons found</p>
                    </div>
                  </td>
                </tr>
              ) : (
                coupons.map((c) => (
                  <tr key={c._id} className="hover:bg-surface-container-low/50 transition-colors group">
                    <td className="p-4 font-mono font-bold text-primary tracking-wide">{c.code}</td>
                    <td className="p-4 font-body-sm font-semibold text-on-surface">
                      {c.discountType === "PERCENTAGE" ? `${c.discountValue}% OFF` : `₹${c.discountValue} OFF`}
                      {c.maxDiscountAmount && <span className="text-xs text-on-surface-variant block font-normal">(Max ₹{c.maxDiscountAmount})</span>}
                    </td>
                    <td className="p-4 font-body-sm text-on-surface-variant">
                      {c.minOrderValue > 0 ? `₹${c.minOrderValue.toLocaleString()}` : "No min"}
                    </td>
                    <td className="p-4 font-body-sm text-on-surface-variant">
                      {c.usedCount} {c.usageLimit ? `/ ${c.usageLimit}` : "(Unlimited)"}
                    </td>
                    <td className="p-4">
                      <span
                        className={`px-2.5 py-1 rounded-full font-label-caps text-[10px] ${
                          c.status === "ACTIVE"
                            ? "bg-primary-fixed text-on-primary-fixed-variant border border-primary/20"
                            : "bg-surface-container-high text-on-surface-variant border border-outline/20"
                        }`}
                      >
                        {c.status}
                      </span>
                    </td>
                    <td className="p-4 font-body-sm text-on-surface-variant whitespace-nowrap">
                      {c.expiresAt
                        ? new Date(c.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
                        : "Never"}
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => toggleStatus(c._id, c.status)}
                          className="px-2.5 py-1 text-xs font-label-caps border border-outline-variant rounded hover:bg-surface-container-high transition-colors"
                        >
                          {c.status === "ACTIVE" ? "Deactivate" : "Activate"}
                        </button>
                        <Link
                          href={`/admin/coupons/${c._id}/edit`}
                          className="p-1 text-on-surface-variant hover:text-primary transition-colors"
                          title="Edit coupon"
                        >
                          <span className="material-symbols-outlined text-[20px]">edit</span>
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
