"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { ArrowDownRight, ArrowUpRight, ChevronLeft, ChevronRight, History } from "lucide-react";

interface InventoryTx {
  _id: string;
  orderId?: { _id: string; orderNumber: string };
  productId: { _id: string; name: string; slug: string };
  variantId: string;
  quantity: number;
  type: "SALE" | "RESTOCK" | "ADJUSTMENT" | "REFUND" | "RETURN";
  reason?: string;
  createdAt: string;
}

export default function AdminInventoryLedgerPage() {
  const [transactions, setTransactions] = useState<InventoryTx[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const fetchLedger = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, limit: 20 };
      if (typeFilter) params.type = typeFilter;

      const res = await api.get("/admin/inventory-ledger", { params });
      if (res.data?.success) {
        setTransactions(res.data.data.items || []);
        setTotalPages(res.data.data.pagination?.totalPages || 1);
        setTotal(res.data.data.pagination?.total || 0);
      }
      setError("");
    } catch {
      setError("Failed to fetch inventory movement ledger");
    } finally {
      setLoading(false);
    }
  }, [typeFilter, page]);

  useEffect(() => {
    fetchLedger();
  }, [fetchLedger]);

  const getTypeBadge = (type: string) => {
    switch (type) {
      case "SALE":
        return {
          label: "SALE (-)",
          classes: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400",
          icon: ArrowDownRight
        };
      case "RESTOCK":
        return {
          label: "RESTOCK (+)",
          classes: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400",
          icon: ArrowUpRight
        };
      case "REFUND":
      case "RETURN":
        return {
          label: `${type} (+)`,
          classes: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400",
          icon: ArrowUpRight
        };
      default:
        return {
          label: type,
          classes: "bg-neutral-100 text-neutral-800 border-neutral-300 dark:bg-neutral-800 dark:text-neutral-300",
          icon: History
        };
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-outline-variant/20 pb-5">
        <div>
          <h1 className="font-headline-lg text-2xl sm:text-3xl font-black text-on-surface uppercase tracking-tight">
            Inventory Movement Ledger
          </h1>
          <p className="font-body-sm text-xs text-on-surface-variant mt-1">
            Immutable historical record of every stock deduction, restock, return restoration, and manual adjustment.
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
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs uppercase text-on-surface-variant font-bold">Filter Type:</span>
          <select
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value);
              setPage(1);
            }}
            className="px-3 py-1.5 text-xs bg-surface-container-low border border-outline-variant/50 rounded-lg focus:outline-none focus:border-primary text-on-surface font-mono uppercase"
          >
            <option value="">All Transactions</option>
            <option value="SALE">Sale (Order Captured)</option>
            <option value="RESTOCK">Restock (Inbound Batch)</option>
            <option value="ADJUSTMENT">Adjustment (Manual)</option>
            <option value="REFUND">Refund Restored</option>
            <option value="RETURN">Return Accepted</option>
          </select>
        </div>

        <div className="text-xs font-mono text-on-surface-variant">
          Total Ledger Events: <strong>{total}</strong>
        </div>
      </div>

      {/* Ledger Table */}
      <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-surface-container-low border-b border-outline-variant/30 font-mono uppercase text-on-surface-variant text-[11px]">
                <th className="py-3 px-4">Date & Time</th>
                <th className="py-3 px-4">Type</th>
                <th className="py-3 px-4">Product</th>
                <th className="py-3 px-4">Quantity</th>
                <th className="py-3 px-4">Order Ref</th>
                <th className="py-3 px-4">Reason / Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/20 font-body-sm">
              {loading ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-neutral-400 font-mono">
                    Loading ledger records...
                  </td>
                </tr>
              ) : transactions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 space-y-2">
                    <History className="w-8 h-8 text-neutral-400 mx-auto" />
                    <p className="font-mono text-xs text-on-surface-variant uppercase font-bold">
                      No stock movements recorded
                    </p>
                  </td>
                </tr>
              ) : (
                transactions.map((tx) => {
                  const badge = getTypeBadge(tx.type);
                  const Icon = badge.icon;
                  return (
                    <tr key={tx._id} className="hover:bg-surface-container/50 transition-colors">
                      <td className="py-3.5 px-4 font-mono text-neutral-500 whitespace-nowrap">
                        {new Date(tx.createdAt).toLocaleString("en-IN", {
                          dateStyle: "short",
                          timeStyle: "short"
                        })}
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border text-[10px] font-mono font-bold ${badge.classes}`}>
                          <Icon className="w-3 h-3" />
                          <span>{badge.label}</span>
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-on-surface">
                        <div className="font-semibold">{tx.productId?.name || "Product"}</div>
                      </td>
                      <td className="py-3.5 px-4 font-mono font-bold text-on-surface whitespace-nowrap">
                        {tx.type === "SALE" ? `-${tx.quantity}` : `+${tx.quantity}`}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-primary font-bold whitespace-nowrap">
                        {tx.orderId?.orderNumber || "—"}
                      </td>
                      <td className="py-3.5 px-4 text-on-surface-variant font-mono text-[11px]">
                        {tx.reason || "Automatic Inventory Movement"}
                      </td>
                    </tr>
                  );
                })
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
