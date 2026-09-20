"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { useRouter } from "next/navigation";

interface Order {
  _id: string;
  orderNumber: string;
  userId: { name: string; email: string };
  total: number;
  status: string;
  paymentStatus: string;
  createdAt: string;
  items: any[];
}

const STATUS_OPTIONS = ["", "PENDING", "CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED", "RETURN_REQUESTED", "RETURNED"];
const PAYMENT_OPTIONS = ["", "PAID", "PENDING", "FAILED", "REFUNDED"];

export default function AdminOrdersList() {
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [paymentFilter, setPaymentFilter] = useState("");
  const [statusOpen, setStatusOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);

  const [summary, setSummary] = useState({
    totalOrders: 0,
    todayOrders: 0,
    processingOrders: 0,
    awaitingPaymentOrders: 0,
    shippedOrders: 0,
  });
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 500);
    return () => clearTimeout(handler);
  }, [search]);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page, limit: 10 };
      if (debouncedSearch) params.search = debouncedSearch;
      if (statusFilter) params.status = statusFilter;
      if (paymentFilter) params.paymentStatus = paymentFilter;
      const response = await api.get("/admin/orders", { params });
      setOrders(response.data.data.items);
      setTotalPages(response.data.data.totalPages);
      setTotal(response.data.data.total || 0);
      if (response.data.data.summary) {
        setSummary(response.data.data.summary);
      }
    } catch (err: any) {
      setError(err.response?.data?.message || "Failed to load orders");
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, statusFilter, paymentFilter]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const toggleSelectAll = () => {
    if (selectedOrderIds.length === orders.length) {
      setSelectedOrderIds([]);
    } else {
      setSelectedOrderIds(orders.map((o) => o._id));
    }
  };

  const toggleSelectOrder = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (selectedOrderIds.includes(id)) {
      setSelectedOrderIds(selectedOrderIds.filter((item) => item !== id));
    } else {
      setSelectedOrderIds([...selectedOrderIds, id]);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "DELIVERED": return "bg-[#eef0ff] text-[#003ea8] border border-[#b4c5ff]";
      case "CANCELLED": return "bg-error-container/20 text-error border border-error/20";
      case "PENDING": return "bg-secondary-container/10 text-secondary border border-secondary/20";
      case "SHIPPED": return "bg-surface-container-high text-on-surface border border-outline-variant/30";
      case "PROCESSING": return "bg-secondary-container/10 text-secondary border border-secondary/20";
      case "CONFIRMED": return "bg-surface-container-high text-on-surface border border-outline-variant/30";
      case "RETURN_REQUESTED": return "bg-error-container/10 text-error border border-error/20";
      case "RETURNED": return "bg-surface-container-high text-on-surface border border-outline-variant/30";
      default: return "bg-surface-container-high text-on-surface border border-outline-variant/30";
    }
  };

  const getPaymentColor = (status: string) => {
    switch (status) {
      case "PAID": return "bg-primary-container/20 text-primary border border-primary/20";
      case "FAILED": return "bg-error-container/40 text-error border border-error/20";
      case "REFUNDED": return "bg-surface-container-high text-on-surface border border-outline-variant/30";
      default: return "bg-surface-container-high text-on-surface border border-outline-variant/30";
    }
  };

  return (
    <div className="flex flex-col gap-element-gap md:gap-gutter">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-2">
        <div>
          <h1 className="font-headline-lg text-headline-lg text-on-background mb-1">Orders</h1>
          <p className="font-body-md text-body-md text-on-surface-variant max-w-2xl">
            Manage customer orders, payments, fulfillment and delivery status.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchOrders}
            className="flex items-center gap-2 px-4 py-2 border border-outline-variant text-on-surface font-label-caps text-label-caps rounded-lg hover:bg-surface-container-high transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">refresh</span>
            Refresh
          </button>
        </div>
      </div>

      {/* Stitch-style KPI Summary Cards Row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 md:gap-4 mb-2">
        <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-4 flex flex-col justify-between shadow-sm hover:border-primary/40 transition-colors">
          <div className="flex items-center justify-between text-on-surface-variant mb-2">
            <span className="font-label-caps text-[11px] font-bold tracking-wider uppercase">Total Orders</span>
            <span className="material-symbols-outlined text-[20px] text-primary">shopping_bag</span>
          </div>
          <span className="font-headline-lg text-2xl font-bold text-on-surface">{summary.totalOrders}</span>
        </div>

        <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-4 flex flex-col justify-between shadow-sm hover:border-primary/40 transition-colors">
          <div className="flex items-center justify-between text-on-surface-variant mb-2">
            <span className="font-label-caps text-[11px] font-bold tracking-wider uppercase">Today</span>
            <span className="material-symbols-outlined text-[20px] text-secondary">today</span>
          </div>
          <span className="font-headline-lg text-2xl font-bold text-on-surface">{summary.todayOrders}</span>
        </div>

        <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-4 flex flex-col justify-between shadow-sm hover:border-primary/40 transition-colors">
          <div className="flex items-center justify-between text-on-surface-variant mb-2">
            <span className="font-label-caps text-[11px] font-bold tracking-wider uppercase">Processing</span>
            <span className="material-symbols-outlined text-[20px] text-warning">sync</span>
          </div>
          <span className="font-headline-lg text-2xl font-bold text-on-surface">{summary.processingOrders}</span>
        </div>

        <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-4 flex flex-col justify-between shadow-sm hover:border-primary/40 transition-colors">
          <div className="flex items-center justify-between text-on-surface-variant mb-2">
            <span className="font-label-caps text-[11px] font-bold tracking-wider uppercase">Awaiting Payment</span>
            <span className="material-symbols-outlined text-[20px] text-tertiary">pending_actions</span>
          </div>
          <span className="font-headline-lg text-2xl font-bold text-on-surface">{summary.awaitingPaymentOrders}</span>
        </div>

        <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-4 flex flex-col justify-between shadow-sm hover:border-primary/40 transition-colors col-span-2 sm:col-span-1">
          <div className="flex items-center justify-between text-on-surface-variant mb-2">
            <span className="font-label-caps text-[11px] font-bold tracking-wider uppercase">Shipped</span>
            <span className="material-symbols-outlined text-[20px] text-success">local_shipping</span>
          </div>
          <span className="font-headline-lg text-2xl font-bold text-on-surface">{summary.shippedOrders}</span>
        </div>
      </div>

      {error && (
        <div className="text-error bg-error-container/20 p-4 rounded-md font-body-sm flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">error_outline</span>
          {error}
        </div>
      )}

      {/* Bulk Selection Toolbar */}
      {selectedOrderIds.length > 0 && (
        <div className="bg-primary-container/20 border border-primary/30 p-3 rounded-lg flex items-center justify-between text-sm">
          <div className="flex items-center gap-3">
            <span className="font-label-caps font-bold text-primary">{selectedOrderIds.length} orders selected</span>
            <button onClick={() => setSelectedOrderIds([])} className="text-xs text-on-surface-variant hover:underline">
              Clear Selection
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button disabled className="px-3 py-1.5 bg-surface-container-high border border-outline-variant rounded font-label-caps text-xs font-bold text-on-surface-variant opacity-50 cursor-not-allowed" title="Bulk export require backend report pipeline">
              Export Selected
            </button>
          </div>
        </div>
      )}

      {/* Table Controls / Filter Toolbar */}
      <div className="flex flex-col md:flex-row gap-3 items-start md:items-center justify-between bg-surface-container-lowest p-4 rounded-t-xl border border-outline-variant/20 border-b-0">
        {/* Search */}
        <div className="w-full md:w-auto flex-1 max-w-md relative">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-[18px]">search</span>
          <input
            className="w-full pl-10 pr-4 py-2.5 bg-surface-container-low border border-outline-variant/30 rounded-lg focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary font-body-sm text-body-sm text-on-surface transition-all placeholder:text-outline"
            placeholder="Search Order ID, Customer, Email..."
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Filter Controls */}
        <div className="w-full md:w-auto flex flex-wrap gap-2 items-center">
          {/* Status Filter */}
          <div className="relative">
            <button
              onClick={() => { setStatusOpen(!statusOpen); setPaymentOpen(false); }}
              className="flex items-center gap-2 px-3 py-2 bg-surface-container-low border border-outline-variant/30 rounded-lg font-label-caps text-label-caps text-on-surface-variant hover:bg-surface-container-highest transition-colors whitespace-nowrap"
            >
              Status: {statusFilter || "All"}
              <span className="material-symbols-outlined text-[18px]">keyboard_arrow_down</span>
            </button>
            {statusOpen && (
              <div className="absolute top-full left-0 mt-1 bg-surface-container-lowest border border-outline-variant/30 rounded-lg shadow-[0_12px_40px_rgba(15,23,42,0.08)] z-20 py-1 min-w-[160px]">
                {STATUS_OPTIONS.map(s => (
                  <button
                    key={s}
                    className={`w-full text-left px-4 py-2 font-label-caps text-label-caps hover:bg-surface-container-high transition-colors ${statusFilter === s ? "text-primary bg-primary-container/10" : "text-on-surface"}`}
                    onClick={() => { setStatusFilter(s); setStatusOpen(false); setPage(1); }}
                  >
                    {s || "All"}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Payment Filter */}
          <div className="relative">
            <button
              onClick={() => { setPaymentOpen(!paymentOpen); setStatusOpen(false); }}
              className="flex items-center gap-2 px-3 py-2 bg-surface-container-low border border-outline-variant/30 rounded-lg font-label-caps text-label-caps text-on-surface-variant hover:bg-surface-container-highest transition-colors whitespace-nowrap"
            >
              Payment: {paymentFilter || "All"}
              <span className="material-symbols-outlined text-[18px]">keyboard_arrow_down</span>
            </button>
            {paymentOpen && (
              <div className="absolute top-full left-0 mt-1 bg-surface-container-lowest border border-outline-variant/30 rounded-lg shadow-[0_12px_40px_rgba(15,23,42,0.08)] z-20 py-1 min-w-[140px]">
                {PAYMENT_OPTIONS.map(p => (
                  <button
                    key={p}
                    className={`w-full text-left px-4 py-2 font-label-caps text-label-caps hover:bg-surface-container-high transition-colors ${paymentFilter === p ? "text-primary bg-primary-container/10" : "text-on-surface"}`}
                    onClick={() => { setPaymentFilter(p); setPaymentOpen(false); setPage(1); }}
                  >
                    {p || "All"}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Clear Filters */}
          {(statusFilter || paymentFilter || search) && (
            <button
              onClick={() => { setStatusFilter(""); setPaymentFilter(""); setSearch(""); setPage(1); }}
              className="p-2 border border-outline-variant/30 rounded-lg text-on-surface-variant hover:bg-surface-container-high transition-colors"
              title="Clear filters"
            >
              <span className="material-symbols-outlined text-[18px]">filter_list_off</span>
            </button>
          )}
        </div>
      </div>

      {/* Data Table Container */}
      <div className="bg-surface-container-lowest border border-outline-variant/20 rounded-b-xl overflow-hidden relative">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container-lowest border-b border-outline-variant/20">
                <th className="py-3 px-4 w-10">
                  <input
                    type="checkbox"
                    checked={orders.length > 0 && selectedOrderIds.length === orders.length}
                    onChange={toggleSelectAll}
                    className="rounded border-outline-variant text-primary focus:ring-primary cursor-pointer"
                  />
                </th>
                <th className="py-3 px-4 font-label-caps text-label-caps text-outline font-medium tracking-wider whitespace-nowrap">Order</th>
                <th className="py-3 px-4 font-label-caps text-label-caps text-outline font-medium tracking-wider whitespace-nowrap">Date</th>
                <th className="py-3 px-4 font-label-caps text-label-caps text-outline font-medium tracking-wider whitespace-nowrap">Customer</th>
                <th className="py-3 px-4 font-label-caps text-label-caps text-outline font-medium tracking-wider whitespace-nowrap text-right">Items</th>
                <th className="py-3 px-4 font-label-caps text-label-caps text-outline font-medium tracking-wider whitespace-nowrap text-right">Amount</th>
                <th className="py-3 px-4 font-label-caps text-label-caps text-outline font-medium tracking-wider whitespace-nowrap text-center">Payment</th>
                <th className="py-3 px-4 font-label-caps text-label-caps text-outline font-medium tracking-wider whitespace-nowrap text-center">Status</th>
                <th className="py-3 px-4 font-label-caps text-label-caps text-outline font-medium tracking-wider whitespace-nowrap w-16"></th>
              </tr>
            </thead>
            <tbody className="font-body-sm text-body-sm text-on-surface">
              {loading ? (
                <>
                  {[1, 2, 3, 4, 5].map(i => (
                    <tr key={i} className="border-b border-outline-variant/10">
                      {[1, 2, 3, 4, 5, 6, 7, 8].map(j => (
                        <td key={j} className="py-3 px-4">
                          <div className="h-4 bg-surface-container-low rounded animate-pulse" />
                        </td>
                      ))}
                    </tr>
                  ))}
                </>
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-16 px-4">
                    <div className="flex flex-col items-center gap-3 text-center">
                      <span className="material-symbols-outlined text-outline text-[48px]">inbox</span>
                      <p className="font-body-md text-body-md text-on-surface-variant">No orders found</p>
                      {(search || statusFilter || paymentFilter) && (
                        <button
                          onClick={() => { setSearch(""); setStatusFilter(""); setPaymentFilter(""); }}
                          className="font-label-caps text-label-caps text-primary hover:underline"
                        >
                          Clear filters
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                orders.map((order) => (
                  <tr
                    key={order._id}
                    onClick={() => router.push(`/admin/orders/${order._id}`)}
                    className="hover:bg-surface-container-low transition-colors cursor-pointer group border-b border-outline-variant/10"
                  >
                    <td className="py-4 px-4" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedOrderIds.includes(order._id)}
                        onChange={(e) => toggleSelectOrder(order._id, e as any)}
                        className="rounded border-outline-variant text-primary focus:ring-primary cursor-pointer"
                      />
                    </td>
                    <td className="py-3 px-4 font-label-caps text-label-caps font-bold">{order.orderNumber}</td>
                    <td className="py-3 px-4 text-on-surface-variant whitespace-nowrap">
                      {new Date(order.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                      <br />
                      <span className="text-xs text-outline">
                        {new Date(order.createdAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-medium">{order.userId?.name || "Unknown"}</div>
                      <div className="text-on-surface-variant text-xs">{order.userId?.email}</div>
                    </td>
                    <td className="py-3 px-4 text-right">{order.items?.length || 0} Items</td>
                    <td className="py-3 px-4 text-right font-label-caps text-label-caps font-bold">
                      ₹{order.total.toLocaleString("en-IN")}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-label-caps ${getPaymentColor(order.paymentStatus)}`}>
                        {order.paymentStatus}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-label-caps ${getStatusColor(order.status)}`}>
                        {order.status}
                      </span>
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

        {/* Pagination */}
        {!loading && totalPages >= 1 && (
          <div className="p-4 border-t border-outline-variant/20 flex items-center justify-between bg-surface-container-lowest">
            <span className="font-body-sm text-body-sm text-on-surface-variant">
              {total > 0 ? `Showing page ${page} of ${totalPages} (${total} total)` : "No results"}
            </span>
            <div className="flex items-center gap-1">
              <button
                disabled={page === 1}
                onClick={() => setPage(p => p - 1)}
                className="p-1 rounded hover:bg-surface-container-high text-outline transition-colors disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[20px]">chevron_left</span>
              </button>
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                const pageNum = page <= 3 ? i + 1 : page - 2 + i;
                if (pageNum < 1 || pageNum > totalPages) return null;
                return (
                  <button
                    key={pageNum}
                    onClick={() => setPage(pageNum)}
                    className={`w-8 h-8 rounded font-label-caps text-[12px] flex items-center justify-center transition-colors ${pageNum === page ? "bg-primary text-on-primary" : "hover:bg-surface-container-high text-on-surface"}`}
                  >
                    {pageNum}
                  </button>
                );
              })}
              <button
                disabled={page === totalPages}
                onClick={() => setPage(p => p + 1)}
                className="p-1 rounded hover:bg-surface-container-high text-outline transition-colors disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[20px]">chevron_right</span>
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="h-8" />
    </div>
  );
}
