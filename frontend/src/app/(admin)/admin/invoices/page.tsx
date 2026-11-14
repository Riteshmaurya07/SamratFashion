"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { Download, Search, FileText, ChevronLeft, ChevronRight } from "lucide-react";
import { downloadOrViewInvoicePdf } from "@/lib/invoiceHelper";

interface InvoiceItem {
  _id: string;
  invoiceNumber: string;
  orderNumber: string;
  issuedAt: string;
  customerSnapshot: { name: string; email: string };
  status: "ISSUED" | "VOID" | "REFUNDED";
  subtotal: number;
  discount?: number;
  shipping?: number;
  tax: number;
  total: number;
  refundedAmount?: number;
  netTotal?: number;
  currency: string;
  paymentSnapshot?: { provider: string; status: string };
}

export default function AdminInvoicesPage() {
  const [invoices, setInvoices] = useState<InvoiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [downloadingCsv, setDownloadingCsv] = useState(false);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 400);
    return () => clearTimeout(handler);
  }, [search]);

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, limit: 15 };
      if (debouncedSearch) params.search = debouncedSearch;
      if (status) params.status = status;
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;

      const res = await api.get("/admin/invoices", { params });
      if (res.data?.success) {
        setInvoices(res.data.data.items || []);
        setTotalPages(res.data.data.pagination?.totalPages || 1);
        setTotal(res.data.data.pagination?.total || 0);
      }
      setError("");
    } catch (err: unknown) {
      setError("Failed to fetch invoice register");
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, status, startDate, endDate, page]);

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  const handleExportCsv = async () => {
    setDownloadingCsv(true);
    try {
      const params: Record<string, string> = {};
      if (status) params.status = status;
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;

      const res = await api.get("/admin/invoices/export", {
        params,
        responseType: "blob"
      });

      const blob = new Blob([res.data], { type: "text/csv;charset=utf-8;" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `invoices_export_${new Date().toISOString().split("T")[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch {
      alert("Failed to export invoices CSV");
    } finally {
      setDownloadingCsv(false);
    }
  };

  const getStatusBadge = (st: string) => {
    switch (st) {
      case "ISSUED":
        return "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400";
      case "REFUNDED":
        return "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400";
      case "VOID":
        return "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400";
      default:
        return "bg-surface-container text-on-surface border-outline-variant/40";
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-outline-variant/20 pb-4">
        <div>
          <h1 className="font-headline-lg text-2xl sm:text-3xl font-black text-on-surface uppercase tracking-tight">
            Tax Invoice Register
          </h1>
          <p className="font-body-sm text-xs text-on-surface-variant mt-1">
            Official GST tax invoice snapshot records, statutory sequencing, and CSV reporting.
          </p>
        </div>
        <button
          type="button"
          onClick={handleExportCsv}
          disabled={downloadingCsv}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-neutral-900 text-white font-mono text-xs uppercase font-bold tracking-wider rounded-lg hover:bg-neutral-800 transition-colors shrink-0 disabled:opacity-50 cursor-pointer min-h-[40px]"
        >
          <Download className="w-4 h-4" />
          <span>{downloadingCsv ? "Exporting..." : "Export CSV"}</span>
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-50 text-red-600 border border-red-200 rounded-lg text-xs font-mono">
          {error}
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-4 shadow-xs space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Search */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search invoice or order #..."
              className="w-full pl-9 pr-3 py-2 text-xs bg-surface-container-low border border-outline-variant/50 rounded-lg focus:outline-none focus:border-primary text-on-surface placeholder:text-neutral-400"
            />
          </div>

          {/* Status Filter */}
          <div className="relative">
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              className="w-full px-3 py-2 text-xs bg-surface-container-low border border-outline-variant/50 rounded-lg focus:outline-none focus:border-primary text-on-surface font-mono uppercase"
            >
              <option value="">All Statuses</option>
              <option value="ISSUED">Issued</option>
              <option value="REFUNDED">Refunded</option>
              <option value="VOID">Void</option>
            </select>
          </div>

          {/* Start Date */}
          <div className="relative">
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setPage(1);
              }}
              className="w-full px-3 py-2 text-xs bg-surface-container-low border border-outline-variant/50 rounded-lg focus:outline-none focus:border-primary text-on-surface font-mono"
            />
          </div>

          {/* End Date */}
          <div className="relative">
            <input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setPage(1);
              }}
              className="w-full px-3 py-2 text-xs bg-surface-container-low border border-outline-variant/50 rounded-lg focus:outline-none focus:border-primary text-on-surface font-mono"
            />
          </div>
        </div>

        <div className="flex justify-between items-center text-xs text-on-surface-variant font-mono pt-1">
          <span>Total Invoices: <strong>{total}</strong></span>
          {(search || status || startDate || endDate) && (
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setStatus("");
                setStartDate("");
                setEndDate("");
                setPage(1);
              }}
              className="text-primary hover:underline font-bold"
            >
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* Invoices Table */}
      {/* Invoices Container */}
      <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl overflow-hidden shadow-xs">
        {/* Mobile Invoices Card View (shown on screens < 768px) */}
        <div className="block md:hidden divide-y divide-outline-variant/20 p-3 space-y-3">
          {loading ? (
            <div className="py-12 text-center text-xs font-mono text-neutral-400">Loading invoices...</div>
          ) : invoices.length === 0 ? (
            <div className="py-12 text-center text-xs font-mono text-neutral-500 uppercase font-bold">No invoices found</div>
          ) : (
            invoices.map((inv) => {
              const badgeClass = getStatusBadge(inv.status);
              return (
                <div key={inv._id} className="bg-surface border border-outline-variant/30 rounded-xl p-3.5 space-y-2.5 shadow-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-bold text-primary">#{inv.invoiceNumber}</span>
                    <span className={`px-2 py-0.5 rounded-full border text-[10px] font-mono font-bold uppercase ${badgeClass}`}>
                      {inv.status}
                    </span>
                  </div>

                  <div className="flex items-start justify-between gap-2 text-xs">
                    <div className="min-w-0">
                      <p className="font-semibold text-on-surface truncate">{inv.customerSnapshot?.name || "Customer"}</p>
                      <p className="text-[11px] text-on-surface-variant font-mono truncate">{inv.customerSnapshot?.email || "—"}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-mono font-bold text-sm text-neutral-900">
                        ₹{Math.round(inv.netTotal ?? inv.total).toLocaleString("en-IN")}
                      </p>
                      {inv.refundedAmount && inv.refundedAmount > 0 ? (
                        <span className="text-[10px] text-red-600 font-mono uppercase block">
                          -₹{Math.round(inv.refundedAmount).toLocaleString("en-IN")} refunded
                        </span>
                      ) : (
                        <span className="text-[10px] text-neutral-400 font-mono uppercase block">{inv.paymentSnapshot?.provider || "Razorpay"}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-outline-variant/15 text-[11px] font-mono text-neutral-500">
                    <span>Order #{inv.orderNumber} • {new Date(inv.issuedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
                    <button
                      type="button"
                      onClick={() => downloadOrViewInvoicePdf(inv.orderNumber, `Invoice-${inv.invoiceNumber}.pdf`)}
                      className="text-primary font-bold inline-flex items-center gap-1 hover:underline cursor-pointer"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>PDF</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Desktop Table (hidden on mobile, shown on md+) */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-surface-container-low border-b border-outline-variant/30 font-mono uppercase text-on-surface-variant text-[11px]">
                <th className="py-3 px-4">Invoice #</th>
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Order #</th>
                <th className="py-3 px-4">Customer</th>
                <th className="py-3 px-4">Total</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Method</th>
                <th className="py-3 px-4 text-right">PDF</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/20">
              {loading ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-neutral-400 font-mono">
                    Loading invoices...
                  </td>
                </tr>
              ) : invoices.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 space-y-2">
                    <FileText className="w-8 h-8 text-neutral-400 mx-auto" />
                    <p className="font-mono text-xs text-on-surface-variant uppercase font-bold">
                      No invoices found
                    </p>
                    <p className="text-[11px] text-neutral-400">
                      Invoices are issued automatically on payment confirmation.
                    </p>
                  </td>
                </tr>
              ) : (
                invoices.map((inv) => (
                  <tr key={inv._id} className="hover:bg-surface-container/50 transition-colors">
                    <td className="py-3.5 px-4 font-mono font-bold text-on-surface whitespace-nowrap">
                      {inv.invoiceNumber}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-neutral-500 whitespace-nowrap">
                      {inv.issuedAt ? new Date(inv.issuedAt).toISOString().split("T")[0] : "—"}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-primary font-bold whitespace-nowrap">
                      {inv.orderNumber}
                    </td>
                    <td className="py-3.5 px-4 text-on-surface">
                      <div className="font-semibold">{inv.customerSnapshot?.name || "Customer"}</div>
                      <div className="text-[10px] text-neutral-400 font-mono">{inv.customerSnapshot?.email}</div>
                    </td>
                    <td className="py-3.5 px-4 font-mono font-bold text-on-surface whitespace-nowrap">
                      <div>₹{Math.round(inv.netTotal ?? inv.total).toLocaleString("en-IN")}</div>
                      {inv.refundedAmount && inv.refundedAmount > 0 ? (
                        <div className="text-[10px] font-normal text-red-600 normal-case">
                          -₹{Math.round(inv.refundedAmount).toLocaleString("en-IN")} refunded
                        </div>
                      ) : null}
                    </td>
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <span className={`inline-block px-2 py-0.5 rounded-full border text-[10px] font-mono font-bold uppercase ${getStatusBadge(inv.status)}`}>
                        {inv.status}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-mono text-neutral-500 text-[11px] uppercase whitespace-nowrap">
                      {inv.paymentSnapshot?.provider || "ONLINE"}
                    </td>
                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => downloadOrViewInvoicePdf(inv.orderNumber, `Invoice-${inv.invoiceNumber}.pdf`)}
                        className="p-1.5 text-neutral-600 hover:text-primary hover:bg-surface-container rounded-lg transition-colors inline-flex items-center gap-1 font-mono text-[11px] font-bold cursor-pointer"
                        title="Download Tax Invoice PDF"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span>PDF</span>
                      </button>
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
