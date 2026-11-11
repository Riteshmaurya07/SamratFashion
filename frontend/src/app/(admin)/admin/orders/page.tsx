"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { api } from "@/lib/api";
import { useRouter } from "next/navigation";
import Image from "next/image";

interface OrderItem {
  _id?: string;
  productName?: string;
  productImage?: string;
  selectedSize?: string;
  selectedColor?: string;
  quantity?: number;
  unitPrice?: number;
  lineTotal?: number;
  isCustomized?: boolean;
  approvalStatus?: string;
  productId?: {
    _id?: string;
    name?: string;
    slug?: string;
    images?: string[];
  };
}
interface FinancialSummary {
  originalPaid: number;
  activeOrderTotal: number;
  refundInitiated: number;
  refundSettled: number;
  refundPending: number;
  refundFailed: number;
  hasPendingRefund: boolean;
  hasFailedRefund: boolean;
}


interface Order {
  _id: string;
  orderNumber: string;
  userId?: { name?: string; email?: string; phone?: string };
  shippingAddress?: {
    fullName?: string;
    phone?: string;
    city?: string;
    state?: string;
    postalCode?: string;
  };
  total: number;
  initialTotal?: number;
  subtotal: number;
  discount: number;
  shipping: number;
  status: string;
  paymentStatus: string;
  partiallyCancelled?: boolean;
  financialSummary?: FinancialSummary;
  cancellationOperations?: Array<{ refundAmount?: number }>;
  createdAt: string;
  items: OrderItem[];
}

const STATUS_TABS = [
  { id: "ALL", label: "All Orders", status: "" },
  { id: "CONFIRMED", label: "Needs Fulfillment", status: "CONFIRMED" },
  { id: "PROCESSING", label: "Processing", status: "PROCESSING" },
  { id: "SHIPPED", label: "Shipped", status: "SHIPPED" },
  { id: "DELIVERED", label: "Delivered", status: "DELIVERED" },
  { id: "CANCELLED", label: "Cancelled", status: "CANCELLED" },
  { id: "RETURNS", label: "Returns", status: "RETURN_REQUESTED" },
];

const STATUS_OPTIONS = ["", "PENDING", "CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED", "RETURN_REQUESTED", "RETURNED"];
const PAYMENT_OPTIONS = ["", "PAID", "PENDING", "FAILED", "REFUNDED"];
const EXPORT_RANGES = [
  { value: "today", label: "Today" },
  { value: "3d", label: "Last 3 days" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "all", label: "All time" },
];

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function getApiErrorMessage(error: unknown, fallback: string): string {
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
function OrderThumbnail({ src, name, size = 32 }: { src?: string; name?: string; size?: number }) {
  const [hasError, setHasError] = useState(false);
  const isUsable = src && !hasError && !src.includes("example.com");

  if (!isUsable) {
    return (
      <div className={`${size === 40 ? "w-10 h-10 rounded-lg" : "w-8 h-8 rounded-md"} bg-surface-container border border-outline-variant/30 flex items-center justify-center text-outline shrink-0`}>
        <span className="material-symbols-outlined text-[16px]">checkroom</span>
      </div>
    );
  }

  return (
    <Image
      src={src}
      alt={name || "Product"}
      width={size}
      height={size}
      unoptimized
      onError={() => setHasError(true)}
      className={`${size === 40 ? "w-10 h-10 rounded-lg" : "w-8 h-8 rounded-md"} object-cover border border-outline-variant/30 shrink-0 bg-surface-container`}
    />
  );
}



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
  const [exportOpen, setExportOpen] = useState(false);
  const [exportingRange, setExportingRange] = useState<string | null>(null);
  const [customStart, setCustomStart] = useState(() => toDateInputValue(new Date()));
  const [customEnd, setCustomEnd] = useState(() => toDateInputValue(new Date()));

  const [summary, setSummary] = useState({
    totalOrders: 0,
    todayOrders: 0,
    processingOrders: 0,
    awaitingPaymentOrders: 0,
    shippedOrders: 0,
  });
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [bulkSuccessMsg, setBulkSuccessMsg] = useState("");

  const statusMenuRef = useRef<HTMLDivElement>(null);
  const paymentMenuRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const [bulkFailures, setBulkFailures] = useState<Array<{ orderId: string; orderNumber?: string; reason: string }>>([]);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Click-outside & Escape key handlers for dropdown popovers
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (statusMenuRef.current && !statusMenuRef.current.contains(target)) {
        setStatusOpen(false);
      }
      if (paymentMenuRef.current && !paymentMenuRef.current.contains(target)) {
        setPaymentOpen(false);
      }
      if (exportMenuRef.current && !exportMenuRef.current.contains(target)) {
        setExportOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setStatusOpen(false);
        setPaymentOpen(false);
        setExportOpen(false);
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

  const fetchOrders = useCallback(async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, limit: 10 };
      if (debouncedSearch) params.search = debouncedSearch;
      if (statusFilter) params.status = statusFilter;
      if (paymentFilter) params.paymentStatus = paymentFilter;

      const response = await api.get("/admin/orders", {
        params,
        signal: controller.signal,
      });
      setOrders(response.data.data.items);
      setTotalPages(response.data.data.totalPages);
      setTotal(response.data.data.total || 0);
      if (response.data.data.summary) {
        setSummary(response.data.data.summary);
      }
    } catch (err: unknown) {
      if (err && typeof err === "object" && "name" in err && (err as { name?: string }).name === "CanceledError") {
        return; // Ignore aborted requests
      }
      setError(getApiErrorMessage(err, "Failed to load orders"));
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, statusFilter, paymentFilter]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  useEffect(() => {
    const handleFocus = () => fetchOrders();
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [fetchOrders]);

  const handleExport = useCallback(async (range: string) => {
    setExportOpen(false);
    setStatusOpen(false);
    setPaymentOpen(false);
    setExportingRange(range);
    setError("");

    try {
      const params: Record<string, string> = { range };
      if (debouncedSearch) params.search = debouncedSearch;
      if (statusFilter) params.status = statusFilter;
      if (paymentFilter) params.paymentStatus = paymentFilter;
      if (range === "custom") {
        params.startDate = customStart;
        params.endDate = customEnd;
      }

      const response = await api.get("/admin/orders/export/pdf", {
        params,
        responseType: "blob",
        timeout: 60000,
      });

      const blob = new Blob([response.data], { type: "application/pdf" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `orders-report-${toDateInputValue(new Date())}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: unknown) {
      let message = "Failed to export orders";
      if (err && typeof err === "object" && "response" in err) {
        const res = (err as { response?: unknown }).response;
        const data = res && typeof res === "object" && "data" in res ? (res as { data?: unknown }).data : null;
        if (data instanceof Blob) {
          try {
            const text = await data.text();
            const parsed = JSON.parse(text);
            if (parsed && typeof parsed === "object" && "message" in parsed && typeof parsed.message === "string") {
              message = parsed.message;
            }
          } catch {
            // Keep default message
          }
        }
      }
      setError(message);
    } finally {
      setExportingRange(null);
    }
  }, [debouncedSearch, statusFilter, paymentFilter, customStart, customEnd]);

  const handleBulkStatusUpdate = async (newStatus: string) => {
    if (selectedOrderIds.length === 0) return;
    try {
      setBulkUpdating(true);
      setError("");
      setBulkFailures([]);
      const res = await api.patch("/admin/orders/bulk-status", {
        orderIds: selectedOrderIds,
        status: newStatus,
      });
      const data = res.data?.data;
      if (data?.rejectedCount && data.rejectedCount > 0) {
        setBulkFailures(data.failures || []);
      }
      if (data?.updatedCount && data.updatedCount > 0) {
        setBulkSuccessMsg(`Updated ${data.updatedCount} order(s) to ${newStatus}`);
      } else {
        setBulkSuccessMsg("");
      }
      setSelectedOrderIds([]);
      await fetchOrders();
      setTimeout(() => setBulkSuccessMsg(""), 5000);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, "Failed to update selected orders"));
    } finally {
      setBulkUpdating(false);
    }
  };

  const toggleSelectAll = () => {
    if (orders.length > 0 && selectedOrderIds.length === orders.length) {
      setSelectedOrderIds([]);
    } else {
      setSelectedOrderIds(orders.map((o) => o._id));
    }
  };

  const toggleSelectOrder = (id: string, e?: React.SyntheticEvent) => {
    if (e) e.stopPropagation();
    if (selectedOrderIds.includes(id)) {
      setSelectedOrderIds(selectedOrderIds.filter((item) => item !== id));
    } else {
      setSelectedOrderIds([...selectedOrderIds, id]);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "DELIVERED": return "bg-emerald-50 text-emerald-700 border border-emerald-200";
      case "CANCELLED": return "bg-rose-50 text-rose-700 border border-rose-200";
      case "PENDING": return "bg-amber-50 text-amber-700 border border-amber-200";
      case "SHIPPED": return "bg-blue-50 text-blue-700 border border-blue-200";
      case "PROCESSING": return "bg-purple-50 text-purple-700 border border-purple-200";
      case "CONFIRMED": return "bg-sky-50 text-sky-700 border border-sky-200";
      case "RETURN_REQUESTED": return "bg-orange-50 text-orange-700 border border-orange-200";
      case "RETURNED": return "bg-neutral-100 text-neutral-700 border border-neutral-300";
      default: return "bg-neutral-100 text-neutral-700 border border-neutral-200";
    }
  };

  const getPaymentColor = (status: string) => {
    switch (status) {
      case "PAID": return "bg-emerald-50 text-emerald-700 border border-emerald-200";
      case "FAILED": return "bg-rose-50 text-rose-700 border border-rose-200";
      case "PENDING": return "bg-amber-50 text-amber-700 border border-amber-200";
      case "REFUNDED": return "bg-indigo-50 text-indigo-700 border border-indigo-200";
      default: return "bg-neutral-100 text-neutral-700 border border-neutral-200";
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="font-headline-lg text-2xl font-bold text-on-background">Orders</h1>
          <p className="font-body-md text-sm text-on-surface-variant max-w-2xl mt-0.5">
            Manage customer orders, track payments, update fulfillment stages, and monitor delivery logistics.
          </p>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap justify-end">
          {/* Export Dropdown */}
          <div className="relative" ref={exportMenuRef}>
            <button
              onClick={() => { setExportOpen(!exportOpen); setStatusOpen(false); setPaymentOpen(false); }}
              disabled={!!exportingRange}
              className="flex items-center gap-1.5 px-3.5 py-2 border border-outline-variant/60 text-on-surface text-xs font-bold rounded-lg hover:bg-surface-container transition-colors disabled:opacity-60 disabled:cursor-not-allowed shadow-xs"
              aria-haspopup="menu"
              aria-expanded={exportOpen}
            >
              <span className="material-symbols-outlined text-[17px] text-primary">picture_as_pdf</span>
              {exportingRange ? "Exporting..." : "Export PDF"}
              <span className="material-symbols-outlined text-[16px] text-on-surface-variant">keyboard_arrow_down</span>
            </button>

            {exportOpen && (
              <div
                className="absolute right-0 top-full mt-1.5 bg-surface-container-lowest border border-outline-variant/30 rounded-xl shadow-[0_12px_40px_rgba(15,23,42,0.12)] z-30 w-[260px] overflow-hidden p-1"
                role="menu"
              >
                <div className="px-3 pt-2.5 pb-1 font-mono text-[10px] uppercase font-bold tracking-wider text-outline">
                  Export by date range
                </div>
                {EXPORT_RANGES.map((range) => (
                  <button
                    key={range.value}
                    onClick={() => handleExport(range.value)}
                    className="w-full text-left px-3 py-2 text-xs text-on-surface hover:bg-surface-container rounded-lg transition-colors font-medium"
                    role="menuitem"
                  >
                    {range.label}
                  </button>
                ))}

                <div className="border-t border-outline-variant/20 p-2.5 mt-1 space-y-2">
                  <p className="font-mono text-[10px] uppercase font-bold tracking-wider text-outline">
                    Custom range
                  </p>
                  <label className="block text-[11px] text-on-surface-variant">
                    From
                    <input
                      type="date"
                      value={customStart}
                      max={customEnd}
                      onChange={(e) => setCustomStart(e.target.value)}
                      className="mt-1 w-full px-2 py-1.5 bg-surface-container-low border border-outline-variant/30 rounded-md text-on-surface text-xs focus:outline-none focus:border-primary"
                    />
                  </label>
                  <label className="block text-[11px] text-on-surface-variant">
                    To
                    <input
                      type="date"
                      value={customEnd}
                      min={customStart}
                      onChange={(e) => setCustomEnd(e.target.value)}
                      className="mt-1 w-full px-2 py-1.5 bg-surface-container-low border border-outline-variant/30 rounded-md text-on-surface text-xs focus:outline-none focus:border-primary"
                    />
                  </label>
                  <button
                    onClick={() => handleExport("custom")}
                    disabled={!customStart || !customEnd}
                    className="w-full mt-1 px-3 py-1.5 bg-primary text-on-primary rounded-lg text-xs font-bold disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
                  >
                    Download Range PDF
                  </button>
                </div>
              </div>
            )}
          </div>

          <button
            onClick={() => fetchOrders()}
            className="flex items-center gap-1.5 px-3.5 py-2 border border-outline-variant/60 text-on-surface text-xs font-bold rounded-lg hover:bg-surface-container transition-colors shadow-xs"
          >
            <span className="material-symbols-outlined text-[17px] text-on-surface-variant">refresh</span>
            Refresh
          </button>
        </div>
      </div>

      {/* Interactive KPI Summary Cards Row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <button
          type="button"
          onClick={() => { setStatusFilter(""); setPaymentFilter(""); setPage(1); }}
          className={`text-left bg-surface-container-lowest border rounded-xl p-3.5 flex flex-col justify-between shadow-xs transition-all ${
            statusFilter === "" && paymentFilter === ""
              ? "border-primary ring-2 ring-primary/20 bg-primary/[0.02]"
              : "border-outline-variant/30 hover:border-outline-variant hover:shadow-sm"
          }`}
        >
          <div className="flex items-center justify-between text-on-surface-variant mb-1.5">
            <span className="font-mono text-[10px] font-bold tracking-wider uppercase">Total Orders</span>
            <span className="material-symbols-outlined text-[18px] text-primary">shopping_bag</span>
          </div>
          <span className="text-2xl font-bold font-mono text-on-surface">{summary.totalOrders}</span>
        </button>

        <button
          type="button"
          onClick={() => { setStatusFilter("PROCESSING"); setPage(1); }}
          className={`text-left bg-surface-container-lowest border rounded-xl p-3.5 flex flex-col justify-between shadow-xs transition-all ${
            statusFilter === "PROCESSING"
              ? "border-purple-600 ring-2 ring-purple-500/20 bg-purple-500/[0.04]"
              : "border-outline-variant/30 hover:border-purple-300 hover:shadow-sm"
          }`}
        >
          <div className="flex items-center justify-between text-on-surface-variant mb-1.5">
            <span className="font-mono text-[10px] font-bold tracking-wider uppercase text-purple-700">Processing</span>
            <span className="material-symbols-outlined text-[18px] text-purple-600">sync</span>
          </div>
          <span className="text-2xl font-bold font-mono text-purple-900">{summary.processingOrders}</span>
        </button>

        <button
          type="button"
          onClick={() => { setPaymentFilter(prev => prev === "PENDING" ? "" : "PENDING"); setPage(1); }}
          className={`text-left bg-surface-container-lowest border rounded-xl p-3.5 flex flex-col justify-between shadow-xs transition-all ${
            paymentFilter === "PENDING"
              ? "border-amber-500 ring-2 ring-amber-500/20 bg-amber-500/[0.04]"
              : "border-outline-variant/30 hover:border-amber-300 hover:shadow-sm"
          }`}
        >
          <div className="flex items-center justify-between text-on-surface-variant mb-1.5">
            <span className="font-mono text-[10px] font-bold tracking-wider uppercase text-amber-700">Awaiting Payment</span>
            <span className="material-symbols-outlined text-[18px] text-amber-600">pending_actions</span>
          </div>
          <span className="text-2xl font-bold font-mono text-amber-900">{summary.awaitingPaymentOrders}</span>
        </button>

        <button
          type="button"
          onClick={() => { setStatusFilter(prev => prev === "SHIPPED" ? "" : "SHIPPED"); setPage(1); }}
          className={`text-left bg-surface-container-lowest border rounded-xl p-3.5 flex flex-col justify-between shadow-xs transition-all ${
            statusFilter === "SHIPPED"
              ? "border-blue-600 ring-2 ring-blue-500/20 bg-blue-500/[0.04]"
              : "border-outline-variant/30 hover:border-blue-300 hover:shadow-sm"
          }`}
        >
          <div className="flex items-center justify-between text-on-surface-variant mb-1.5">
            <span className="font-mono text-[10px] font-bold tracking-wider uppercase text-blue-700">Shipped</span>
            <span className="material-symbols-outlined text-[18px] text-blue-600">local_shipping</span>
          </div>
          <span className="text-2xl font-bold font-mono text-blue-900">{summary.shippedOrders}</span>
        </button>

        <button
          type="button"
          onClick={() => { setStatusFilter(prev => prev === "CONFIRMED" ? "" : "CONFIRMED"); setPage(1); }}
          className={`text-left bg-surface-container-lowest border rounded-xl p-3.5 flex flex-col justify-between shadow-xs transition-all col-span-2 sm:col-span-1 ${
            statusFilter === "CONFIRMED"
              ? "border-sky-600 ring-2 ring-sky-500/20 bg-sky-500/[0.04]"
              : "border-outline-variant/30 hover:border-sky-300 hover:shadow-sm"
          }`}
        >
          <div className="flex items-center justify-between text-on-surface-variant mb-1.5">
            <span className="font-mono text-[10px] font-bold tracking-wider uppercase text-sky-700">Today's Orders</span>
            <span className="material-symbols-outlined text-[18px] text-sky-600">today</span>
          </div>
          <span className="text-2xl font-bold font-mono text-sky-900">{summary.todayOrders}</span>
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

      {bulkSuccessMsg && (
        <div className="bg-emerald-50 text-emerald-800 border border-emerald-200 p-3.5 rounded-xl text-xs font-bold flex items-center justify-between gap-2 animate-fadeIn shadow-xs">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-emerald-600">check_circle</span>
            <span>{bulkSuccessMsg}</span>
          </div>
          <button onClick={() => setBulkSuccessMsg("")} className="hover:opacity-70">
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      )}
      {bulkFailures.length > 0 && (
        <div className="bg-amber-50 text-amber-900 border border-amber-300 p-3.5 rounded-xl text-xs space-y-1.5 shadow-xs animate-fadeIn">
          <div className="flex items-center justify-between font-bold text-amber-800">
            <span className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[17px]">warning</span>
              {bulkFailures.length} order(s) could not be updated:
            </span>
            <button onClick={() => setBulkFailures([])} className="hover:opacity-70">
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </div>
          <ul className="list-disc list-inside space-y-0.5 text-amber-900/90 pl-1">
            {bulkFailures.map((f) => (
              <li key={f.orderId}>
                <strong>#{f.orderNumber || f.orderId}</strong>: {f.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Bulk Selection Toolbar */}
      {selectedOrderIds.length > 0 && (
        <div className="bg-primary/[0.04] border border-primary/25 p-3 rounded-xl flex flex-wrap items-center justify-between gap-3 text-sm shadow-xs animate-fadeIn">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs font-bold text-primary px-2.5 py-1 bg-primary/10 rounded-md">
              {selectedOrderIds.length} order{selectedOrderIds.length > 1 ? "s" : ""} selected
            </span>
            <button
              onClick={() => setSelectedOrderIds([])}
              className="text-xs text-on-surface-variant hover:text-on-surface underline font-medium"
            >
              Clear Selection
            </button>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => handleBulkStatusUpdate("CONFIRMED")}
              disabled={bulkUpdating}
              className="px-3 py-1.5 bg-surface-container-lowest border border-outline-variant/60 rounded-lg font-mono text-xs font-bold text-on-surface hover:bg-surface-container transition-colors flex items-center gap-1.5 disabled:opacity-50 shadow-2xs"
            >
              <span className="material-symbols-outlined text-[15px] text-sky-600">check_circle</span>
              Mark Confirmed
            </button>
            <button
              onClick={() => handleBulkStatusUpdate("PROCESSING")}
              disabled={bulkUpdating}
              className="px-3 py-1.5 bg-surface-container-lowest border border-outline-variant/60 rounded-lg font-mono text-xs font-bold text-on-surface hover:bg-surface-container transition-colors flex items-center gap-1.5 disabled:opacity-50 shadow-2xs"
            >
              <span className="material-symbols-outlined text-[15px] text-purple-600">sync</span>
              Mark Processing
            </button>
          </div>
        </div>
      )}

      {/* 1-Click Status Navigation Tabs */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1 border-b border-outline-variant/20 scrollbar-none">
        {STATUS_TABS.map((tab) => {
          const isActive = statusFilter === tab.status;
          return (
            <button
              key={tab.id}
              onClick={() => { setStatusFilter(tab.status); setPage(1); }}
              className={`px-3.5 py-2 text-xs font-bold rounded-lg whitespace-nowrap transition-all flex items-center gap-1.5 ${
                isActive
                  ? "bg-neutral-900 text-white shadow-xs"
                  : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container"
              }`}
            >
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Table Controls / Filter Toolbar */}
      <div className="flex flex-col md:flex-row gap-3 items-start md:items-center justify-between bg-surface-container-lowest p-3.5 rounded-t-xl border border-outline-variant/20 border-b-0">
        {/* Full-Text Search across Order ID, Customer Name, Email, Phone, and City */}
        <div className="w-full md:w-auto flex-1 max-w-md relative">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-[18px]">search</span>
          <input
            className="w-full pl-9 pr-4 py-2 bg-surface-container-low border border-outline-variant/30 rounded-lg focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary text-xs font-medium text-on-surface transition-all placeholder:text-outline"
            placeholder="Search Order #, Name, Email, Phone, City..."
            type="text"
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

        {/* Filter Controls */}
        <div className="w-full md:w-auto flex flex-wrap gap-2 items-center">
          {/* Status Dropdown */}
          <div className="relative" ref={statusMenuRef}>
            <button
              onClick={() => { setStatusOpen(!statusOpen); setPaymentOpen(false); setExportOpen(false); }}
              className="flex items-center gap-1.5 px-3 py-2 bg-surface-container-low border border-outline-variant/30 rounded-lg text-xs font-bold text-on-surface-variant hover:bg-surface-container transition-colors whitespace-nowrap"
              aria-haspopup="menu"
              aria-expanded={statusOpen}
            >
              Status: {statusFilter || "All"}
              <span className="material-symbols-outlined text-[16px]">keyboard_arrow_down</span>
            </button>
            {statusOpen && (
              <div className="absolute top-full right-0 mt-1 bg-surface-container-lowest border border-outline-variant/30 rounded-xl shadow-[0_12px_40px_rgba(15,23,42,0.12)] z-30 py-1 min-w-[170px]">
                {STATUS_OPTIONS.map((s) => (
                  <button
                    key={s}
                    className={`w-full text-left px-3.5 py-1.5 text-xs font-medium hover:bg-surface-container transition-colors ${
                      statusFilter === s ? "text-primary font-bold bg-primary/5" : "text-on-surface"
                    }`}
                    onClick={() => { setStatusFilter(s); setStatusOpen(false); setPage(1); }}
                  >
                    {s || "All Statuses"}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Payment Dropdown */}
          <div className="relative" ref={paymentMenuRef}>
            <button
              onClick={() => { setPaymentOpen(!paymentOpen); setStatusOpen(false); setExportOpen(false); }}
              className="flex items-center gap-1.5 px-3 py-2 bg-surface-container-low border border-outline-variant/30 rounded-lg text-xs font-bold text-on-surface-variant hover:bg-surface-container transition-colors whitespace-nowrap"
              aria-haspopup="menu"
              aria-expanded={paymentOpen}
            >
              Payment: {paymentFilter || "All"}
              <span className="material-symbols-outlined text-[16px]">keyboard_arrow_down</span>
            </button>
            {paymentOpen && (
              <div className="absolute top-full right-0 mt-1 bg-surface-container-lowest border border-outline-variant/30 rounded-xl shadow-[0_12px_40px_rgba(15,23,42,0.12)] z-30 py-1 min-w-[150px]">
                {PAYMENT_OPTIONS.map((p) => (
                  <button
                    key={p}
                    className={`w-full text-left px-3.5 py-1.5 text-xs font-medium hover:bg-surface-container transition-colors ${
                      paymentFilter === p ? "text-primary font-bold bg-primary/5" : "text-on-surface"
                    }`}
                    onClick={() => { setPaymentFilter(p); setPaymentOpen(false); setPage(1); }}
                  >
                    {p || "All Payments"}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Clear Filters Button */}
          {(statusFilter || paymentFilter || search) && (
            <button
              onClick={() => { setStatusFilter(""); setPaymentFilter(""); setSearch(""); setPage(1); }}
              className="p-2 border border-outline-variant/40 rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors"
              title="Clear all filters"
            >
              <span className="material-symbols-outlined text-[17px]">filter_list_off</span>
            </button>
          )}
        </div>
      </div>

      {/* Data Table Container */}
      <div className="bg-surface-container-lowest border border-outline-variant/20 rounded-b-xl overflow-hidden relative shadow-xs">
        {/* Mobile View */}
        <div className="block md:hidden divide-y divide-outline-variant/20 p-3 space-y-3">
          {loading ? (
            <div className="py-12 text-center text-xs font-mono text-neutral-400">Loading orders...</div>
          ) : orders.length === 0 ? (
            <div className="py-12 text-center text-xs text-neutral-500 font-mono">No orders found</div>
          ) : (
            orders.map((order) => {
              const firstItem = order.items?.[0];
              const hasCustomPrint = order.items?.some((i) => i.isCustomized);
              return (
                <div
                  key={order._id}
                  onClick={() => router.push(`/admin/orders/${order._id}`)}
                  className="bg-surface border border-outline-variant/30 rounded-xl p-3.5 space-y-2.5 shadow-2xs cursor-pointer hover:border-primary transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-bold text-primary">#{order.orderNumber}</span>
                    <div className="flex items-center gap-1.5 flex-wrap justify-end">
                      {hasCustomPrint && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-purple-100 text-purple-800 border border-purple-200">
                          CUSTOM
                        </span>
                      )}
                      <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${getPaymentColor(order.paymentStatus)}`}>
                        {order.paymentStatus}
                      </span>
                      {order.partiallyCancelled && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-100 text-amber-800 border border-amber-300">
                          PARTIAL
                        </span>
                      )}
                      <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${getStatusColor(order.status)}`}>
                        {order.status}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-start justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <OrderThumbnail src={firstItem?.productImage} name={firstItem?.productName} size={40} />
                      <div className="min-w-0">
                        <p className="font-semibold text-on-surface truncate">{order.userId?.name || order.shippingAddress?.fullName || "Customer"}</p>
                        <p className="text-[11px] text-on-surface-variant truncate font-mono">
                          {order.shippingAddress?.city ? `${order.shippingAddress.city} · ` : ""}{order.userId?.email || order.shippingAddress?.phone || "—"}
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-mono font-bold text-sm text-neutral-900">₹{order.total.toLocaleString("en-IN")}</p>
                      {order.financialSummary && order.financialSummary.originalPaid !== order.total ? (
                        <span className="block text-[10px] text-neutral-500 font-mono">
                          Paid: ₹{order.financialSummary.originalPaid.toLocaleString("en-IN")}
                        </span>
                      ) : order.partiallyCancelled && order.initialTotal && order.initialTotal > order.total ? (
                        <span className="block text-[10px] text-neutral-500 font-mono">
                          Orig: ₹{order.initialTotal.toLocaleString("en-IN")}
                        </span>
                      ) : null}
                      {order.financialSummary?.refundSettled ? (
                        <span className="block text-[10px] text-emerald-700 font-mono">
                          -₹{order.financialSummary.refundSettled} settled
                        </span>
                      ) : null}
                      <span className="text-[10px] text-neutral-500 font-mono">{order.items?.length || 0} item{(order.items?.length || 0) > 1 ? "s" : ""}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-outline-variant/15 text-[11px] font-mono text-neutral-500">
                    <span>{new Date(order.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
                    <span className="text-primary font-bold inline-flex items-center gap-1">
                      <span>Manage</span>
                      <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Desktop Data Table */}
        <div className="hidden md:block overflow-x-auto">
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
                <th className="py-3 px-4 font-mono text-[11px] uppercase font-bold text-outline tracking-wider whitespace-nowrap">Order</th>
                <th className="py-3 px-4 font-mono text-[11px] uppercase font-bold text-outline tracking-wider whitespace-nowrap">Items</th>
                <th className="py-3 px-4 font-mono text-[11px] uppercase font-bold text-outline tracking-wider whitespace-nowrap">Customer</th>
                <th className="py-3 px-4 font-mono text-[11px] uppercase font-bold text-outline tracking-wider whitespace-nowrap text-right">Amount</th>
                <th className="py-3 px-4 font-mono text-[11px] uppercase font-bold text-outline tracking-wider whitespace-nowrap text-center">Payment</th>
                <th className="py-3 px-4 font-mono text-[11px] uppercase font-bold text-outline tracking-wider whitespace-nowrap text-center">Status</th>
                <th className="py-3 px-4 font-mono text-[11px] uppercase font-bold text-outline tracking-wider whitespace-nowrap w-16"></th>
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
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-16 px-4">
                    <div className="flex flex-col items-center gap-2.5 text-center">
                      <span className="material-symbols-outlined text-outline text-[44px]">inbox</span>
                      <p className="font-semibold text-sm text-on-surface-variant">No orders match your filters</p>
                      {(search || statusFilter || paymentFilter) && (
                        <button
                          onClick={() => { setSearch(""); setStatusFilter(""); setPaymentFilter(""); }}
                          className="font-mono text-xs text-primary hover:underline font-bold"
                        >
                          Clear all filters
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                orders.map((order) => {
                  const firstItem = order.items?.[0];
                  const hasCustomPrint = order.items?.some((i) => i.isCustomized);
                  return (
                    <tr
                      key={order._id}
                      onClick={() => router.push(`/admin/orders/${order._id}`)}
                      className="hover:bg-surface-container-low transition-colors cursor-pointer group border-b border-outline-variant/10"
                    >
                      <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedOrderIds.includes(order._id)}
                          onChange={(e) => toggleSelectOrder(order._id, e)}
                          className="rounded border-outline-variant text-primary focus:ring-primary cursor-pointer"
                        />
                      </td>

                      {/* Order Number & Placed Date */}
                      <td className="py-3 px-4">
                        <div className="font-mono text-xs font-bold text-primary group-hover:underline">
                          #{order.orderNumber}
                        </div>
                        <div className="text-[11px] text-outline font-mono mt-0.5">
                          {new Date(order.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                          <span className="mx-1">·</span>
                          {new Date(order.createdAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
                        </div>
                      </td>

                      {/* Items with Thumbnail Preview & Custom Print Badge */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2.5 max-w-[220px]">
                          <OrderThumbnail src={firstItem?.productImage} name={firstItem?.productName} size={32} />
                          <div className="min-w-0">
                            <p className="font-medium text-xs text-on-surface truncate">
                              {firstItem?.productName || "Product"}
                            </p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-[10px] text-outline font-mono">
                                {order.items?.length || 0} item{(order.items?.length || 0) > 1 ? "s" : ""}
                              </span>
                              {hasCustomPrint && (
                                <span className="px-1 py-0.2 rounded text-[8px] font-mono font-bold uppercase tracking-wider bg-purple-100 text-purple-800 border border-purple-200">
                                  Custom
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Customer Name, Email & Shipping City */}
                      <td className="py-3 px-4">
                        <div className="font-semibold text-xs text-on-surface">
                          {order.userId?.name || order.shippingAddress?.fullName || "Guest Customer"}
                        </div>
                        <div className="text-[11px] text-on-surface-variant font-mono truncate max-w-[190px]">
                          {order.userId?.email || "—"}
                        </div>
                        <div className="text-[10px] text-outline font-mono flex items-center gap-1 mt-0.5">
                          <span className="material-symbols-outlined text-[12px]">location_on</span>
                          <span>
                            {order.shippingAddress?.city || "—"}{order.shippingAddress?.state ? `, ${order.shippingAddress.state}` : ""}
                            {order.shippingAddress?.phone ? ` · ${order.shippingAddress.phone}` : ""}
                          </span>
                        </div>
                      </td>

                      {/* Amount with Invariant Initial Paid & Refund Transparency */}
                      <td className="py-3 px-4 text-right">
                        <div className="font-mono text-xs font-bold text-neutral-900">
                          ₹{order.total.toLocaleString("en-IN")}
                        </div>
                        {order.financialSummary && order.financialSummary.originalPaid !== order.total ? (
                          <div className="text-[10px] text-neutral-500 font-mono mt-0.5">
                            Paid: ₹{order.financialSummary.originalPaid.toLocaleString("en-IN")}
                          </div>
                        ) : order.partiallyCancelled && order.initialTotal && order.initialTotal > order.total ? (
                          <div className="text-[10px] text-neutral-500 font-mono mt-0.5">
                            Paid: ₹{order.initialTotal.toLocaleString("en-IN")}
                          </div>
                        ) : null}
                        {order.financialSummary && order.financialSummary.refundSettled > 0 ? (
                          <div className="text-[10px] text-emerald-700 font-mono font-medium">
                            -₹{order.financialSummary.refundSettled.toLocaleString("en-IN")} settled
                          </div>
                        ) : null}
                      </td>

                      {/* Payment Status Badge */}
                      <td className="py-3 px-4 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-bold ${getPaymentColor(order.paymentStatus)}`}>
                          {order.paymentStatus}
                        </span>
                        {order.financialSummary?.hasPendingRefund ? (
                          <span className="inline-block px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-amber-100 text-amber-800 border border-amber-300 mt-1">
                            REFUND PENDING (₹{order.financialSummary.refundPending})
                          </span>
                        ) : order.status === "CANCELLED" && order.paymentStatus === "PAID" ? (
                          <span className="inline-block px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-amber-100 text-amber-800 border border-amber-300 mt-1">
                            REFUND PENDING
                          </span>
                        ) : order.financialSummary?.hasFailedRefund ? (
                          <span className="inline-block px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-rose-100 text-rose-800 border border-rose-300 mt-1">
                            REFUND FAILED (₹{order.financialSummary.refundFailed})
                          </span>
                        ) : null}
                      </td>

                      {/* Order Status Badge */}
                      <td className="py-3 px-4 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-bold ${getStatusColor(order.status)}`}>
                          {order.status}
                        </span>
                      </td>

                      {/* Action Chevron */}
                      <td className="py-3 px-4 text-right">
                        <button className="p-1 text-outline hover:text-on-surface hover:bg-surface-container rounded-md transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100">
                          <span className="material-symbols-outlined text-[18px]">chevron_right</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {!loading && totalPages >= 1 && (
          <div className="p-3.5 border-t border-outline-variant/20 flex items-center justify-between bg-surface-container-lowest">
            <span className="font-mono text-xs text-on-surface-variant">
              {total > 0 ? `Showing page ${page} of ${totalPages} (${total} total orders)` : "No orders found"}
            </span>
            <div className="flex items-center gap-1">
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
                      pageNum === page
                        ? "bg-neutral-900 text-white shadow-2xs"
                        : "hover:bg-surface-container text-on-surface"
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}
              <button
                disabled={page === totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="p-1.5 rounded-md hover:bg-surface-container text-outline transition-colors disabled:opacity-40"
              >
                <span className="material-symbols-outlined text-[18px]">chevron_right</span>
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="h-4" />
    </div>
  );
}
