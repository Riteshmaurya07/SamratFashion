"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, ExternalLink, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";

interface ReconciliationItem {
  incidentId: string;
  source: "PAYMENT" | "ATTEMPT" | "WEBHOOK";
  orderId?: string | null;
  orderNumber?: string | null;
  amount?: number;
  currency?: string;
  paymentId?: string | null;
  paymentStatus?: string | null;
  attemptId?: string | null;
  attemptStatus?: string | null;
  razorpayOrderId?: string | null;
  razorpayPaymentId?: string | null;
  webhookEventId?: string | null;
  webhookEventType?: string | null;
  webhookStatus?: string | null;
  issueReason: string;
  issueTime: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface ReconciliationSummary {
  unresolvedTotal: number;
  capturedAwaitingActionCount: number;
  capturedAwaitingActionAmountByCurrency: Array<{ currency: string; amount: number }>;
  paymentOrderMismatches: number;
  reconciliationRequiredPayments: number;
  capturedAttemptMismatches: number;
  failedRazorpayWebhooks: number;
  staleProcessingAttempts: number;
}

function money(amount?: number, currency?: string) {
  if (amount === undefined || amount === null || !Number.isFinite(amount)) return "—";
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: currency || "INR",
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency || "INR"} ${amount.toLocaleString("en-IN")}`;
  }
}

function timestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function statusClass(status?: string | null) {
  if (status === "FAILED") return "border-red-200 bg-red-50 text-red-700";
  if (status === "CAPTURED" || status === "PAID" || status === "PROCESSED") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  return "border-outline-variant/50 bg-surface-container-low text-on-surface-variant";
}

function RecordLinks({ item }: { item: ReconciliationItem }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-mono">
      {item.orderId && (
        <Link
          href={`/admin/orders/${encodeURIComponent(item.orderId)}`}
          className="text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Order {item.orderNumber || item.orderId}
        </Link>
      )}
      {item.attemptId && item.razorpayOrderId && (
        <Link
          href={`/admin/payment-attempts?razorpayOrderId=${encodeURIComponent(item.razorpayOrderId)}`}
          className="text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Attempt {item.attemptId.slice(-8)}
        </Link>
      )}
      {item.paymentId && !item.attemptId && (
        <Link
          href={`/admin/payment-attempts?paymentId=${encodeURIComponent(item.paymentId)}`}
          className="text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Payment attempts
        </Link>
      )}
      {item.webhookEventId && (
        <Link
          href={`/admin/webhooks?eventId=${encodeURIComponent(item.webhookEventId)}`}
          className="text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Webhook event
        </Link>
      )}
    </div>
  );
}

export default function AdminPaymentReconciliationPage() {
  const [items, setItems] = useState<ReconciliationItem[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 0 });
  const [summary, setSummary] = useState<ReconciliationSummary | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get("/admin/payment-reconciliation", { params: { page, limit: 20 } });
      if (!response.data?.success) throw new Error("Unsuccessful response");
      setItems(response.data.data?.items || []);
      setPagination(response.data.data?.pagination || { page, limit: 20, total: 0, totalPages: 0 });
      setSummary(response.data.data?.summary || null);
      setError("");
    } catch {
      setError("The reconciliation queue could not be loaded. Try refreshing the list.");
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    fetchQueue();
  }, [fetchQueue]);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 border-b border-outline-variant/30 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-headline-lg text-2xl font-black uppercase tracking-tight text-on-surface sm:text-3xl">
            Payment Reconciliation
          </h1>
          <p className="mt-1 max-w-3xl font-body-sm text-xs text-on-surface-variant">
            Review unresolved payment, attempt, and webhook indicators from existing records.
          </p>
        </div>
        <button
          type="button"
          onClick={fetchQueue}
          disabled={loading}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-outline-variant/60 px-3 text-xs font-mono font-bold uppercase text-on-surface transition-colors hover:bg-surface-container-low disabled:cursor-wait disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
          Refresh
        </button>
      </header>

      <div className="flex items-start gap-3 border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-950">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>
          <strong className="font-semibold">Read-only visibility.</strong>{" "}
          This queue does not apply payments or issue refunds. Review the linked records before taking any financial action.
        </p>
      </div>

      <section aria-label="Reconciliation summary" className="grid grid-cols-1 gap-px border border-outline-variant/40 bg-outline-variant/40 sm:grid-cols-2 xl:grid-cols-3">
        <article className="bg-surface-container-lowest px-4 py-3.5">
          <p className="text-[10px] font-mono font-bold uppercase tracking-wide text-on-surface-variant">Unresolved total</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-on-surface">{summary?.unresolvedTotal ?? "—"}</p>
          <p className="mt-0.5 text-[11px] text-on-surface-variant">Across all matching records</p>
        </article>
        <article className="bg-surface-container-lowest px-4 py-3.5">
          <p className="text-[10px] font-mono font-bold uppercase tracking-wide text-on-surface-variant">Captured awaiting action</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-on-surface">{summary?.capturedAwaitingActionCount ?? "—"}</p>
          <p className="mt-0.5 text-[11px] text-on-surface-variant">
            {summary
              ? summary.capturedAwaitingActionAmountByCurrency.length
                ? summary.capturedAwaitingActionAmountByCurrency.map(({ currency, amount }) => money(amount, currency)).join(" · ")
                : "—"
              : "Amount unavailable"}
          </p>
        </article>
        <article className="bg-surface-container-lowest px-4 py-3.5">
          <p className="text-[10px] font-mono font-bold uppercase tracking-wide text-on-surface-variant">Payment / order mismatches</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-on-surface">{summary?.paymentOrderMismatches ?? "—"}</p>
          <p className="mt-0.5 text-[11px] text-on-surface-variant">Captured attempt mismatches: {summary?.capturedAttemptMismatches ?? "—"}</p>
        </article>
        <article className="bg-surface-container-lowest px-4 py-3.5">
          <p className="text-[10px] font-mono font-bold uppercase tracking-wide text-on-surface-variant">Reconciliation required</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-on-surface">{summary?.reconciliationRequiredPayments ?? "—"}</p>
          <p className="mt-0.5 text-[11px] text-on-surface-variant">Payments carrying the reconciliation flag</p>
        </article>
        <article className="bg-surface-container-lowest px-4 py-3.5">
          <p className="text-[10px] font-mono font-bold uppercase tracking-wide text-on-surface-variant">Failed Razorpay webhooks</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-on-surface">{summary?.failedRazorpayWebhooks ?? "—"}</p>
          <p className="mt-0.5 text-[11px] text-on-surface-variant">Payment and refund events only</p>
        </article>
        <article className="bg-surface-container-lowest px-4 py-3.5">
          <p className="text-[10px] font-mono font-bold uppercase tracking-wide text-on-surface-variant">Stale PROCESSING attempts</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-on-surface">{summary?.staleProcessingAttempts ?? "—"}</p>
          <p className="mt-0.5 text-[11px] text-on-surface-variant">Unchanged for more than 15 minutes</p>
        </article>
      </section>

      {error && (
        <div role="alert" className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
          <button type="button" onClick={fetchQueue} className="ml-2 font-semibold underline underline-offset-2">
            Retry
          </button>
        </div>
      )}

      <section aria-label="Payment reconciliation indicators" className="overflow-hidden border border-outline-variant/40 bg-surface-container-lowest">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-outline-variant/30 bg-surface-container-low px-4 py-3">
          <p className="text-xs font-mono uppercase tracking-wide text-on-surface-variant">
            Unresolved indicators <span className="font-bold text-on-surface">{pagination.total}</span>
          </p>
          <p className="text-[11px] font-mono text-on-surface-variant">Newest issue first · maximum 100 per page</p>
        </div>

        <div className="divide-y divide-outline-variant/20 md:hidden">
          {loading && items.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-on-surface-variant" role="status">Loading reconciliation indicators…</div>
          ) : !loading && items.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <p className="font-semibold text-on-surface">No unresolved indicators found</p>
              <p className="mt-1 text-sm text-on-surface-variant">Recent pending checkouts are not counted as incidents.</p>
            </div>
          ) : items.map((item) => (
            <article key={item.incidentId} className="space-y-3 px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-on-surface-variant">{item.source}</span>
                  <p className="mt-1 text-sm font-semibold text-on-surface">{item.issueReason}</p>
                </div>
                <span className="shrink-0 text-[11px] font-mono text-on-surface-variant">{timestamp(item.issueTime)}</span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="block text-[10px] font-mono uppercase text-on-surface-variant">Order</span>
                  <span className="font-mono text-on-surface">{item.orderNumber || item.orderId || "—"}</span>
                </div>
                <div>
                  <span className="block text-[10px] font-mono uppercase text-on-surface-variant">Amount</span>
                  <span className="font-mono font-semibold text-on-surface">{money(item.amount, item.currency)}</span>
                </div>
              </div>
              <div className="space-y-1 text-[11px] font-mono text-on-surface-variant">
                {(item.paymentId || item.paymentStatus) && <p>Payment {item.paymentId || "—"} · {item.paymentStatus || "—"}</p>}
                {(item.attemptId || item.attemptStatus) && <p>Attempt {item.attemptId || "—"} · {item.attemptStatus || "—"}</p>}
                {item.razorpayOrderId && <p className="break-all">Razorpay order {item.razorpayOrderId}</p>}
                {item.razorpayPaymentId && <p className="break-all">Razorpay payment {item.razorpayPaymentId}</p>}
                {item.webhookEventType && <p>{item.webhookEventType} · {item.webhookStatus}</p>}
              </div>
              <RecordLinks item={item} />
            </article>
          ))}
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-outline-variant/30 text-[10px] font-mono uppercase tracking-wide text-on-surface-variant">
                <th scope="col" className="px-4 py-3">Issue / time</th>
                <th scope="col" className="px-4 py-3">Order</th>
                <th scope="col" className="px-4 py-3">Amount</th>
                <th scope="col" className="px-4 py-3">Payment / attempt</th>
                <th scope="col" className="px-4 py-3">Razorpay IDs</th>
                <th scope="col" className="px-4 py-3">Records</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/20">
              {loading && items.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-on-surface-variant" role="status">Loading reconciliation indicators…</td></tr>
              ) : !loading && items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center">
                    <p className="font-semibold text-on-surface">No unresolved indicators found</p>
                    <p className="mt-1 text-sm text-on-surface-variant">Recent pending checkouts are not counted as incidents.</p>
                  </td>
                </tr>
              ) : items.map((item) => (
                <tr key={item.incidentId} className="align-top hover:bg-surface-container-low/60">
                  <td className="min-w-64 px-4 py-3.5">
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 inline-flex rounded border border-outline-variant/50 px-1.5 py-0.5 text-[9px] font-mono font-bold text-on-surface-variant">{item.source}</span>
                      <div>
                        <p className="max-w-sm text-xs font-medium text-on-surface">{item.issueReason}</p>
                        <time dateTime={item.issueTime} className="mt-1 block text-[10px] font-mono text-on-surface-variant">{timestamp(item.issueTime)}</time>
                        {item.webhookEventType && <p className="mt-1 text-[10px] font-mono text-on-surface-variant">{item.webhookEventType} · {item.webhookStatus}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3.5 font-mono text-on-surface">
                    {item.orderId ? (
                      <Link href={`/admin/orders/${encodeURIComponent(item.orderId)}`} className="font-semibold text-primary underline-offset-4 hover:underline">
                        {item.orderNumber || item.orderId}
                      </Link>
                    ) : "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3.5 font-mono font-semibold text-on-surface">{money(item.amount, item.currency)}</td>
                  <td className="min-w-52 px-4 py-3.5">
                    <div className="space-y-1">
                      {item.paymentId && <p className="break-all font-mono text-[10px] text-on-surface-variant">Payment {item.paymentId}</p>}
                      {item.paymentStatus && <span className={`inline-flex rounded border px-1.5 py-0.5 text-[9px] font-mono font-bold ${statusClass(item.paymentStatus)}`}>{item.paymentStatus}</span>}
                      {item.attemptId && <p className="break-all font-mono text-[10px] text-on-surface-variant">Attempt {item.attemptId}</p>}
                      {item.attemptStatus && <span className={`inline-flex rounded border px-1.5 py-0.5 text-[9px] font-mono font-bold ${statusClass(item.attemptStatus)}`}>{item.attemptStatus}</span>}
                    </div>
                  </td>
                  <td className="min-w-56 px-4 py-3.5 font-mono text-[10px] text-on-surface-variant">
                    <div className="space-y-1">
                      {item.razorpayOrderId && <p className="break-all">Order: {item.razorpayOrderId}</p>}
                      {item.razorpayPaymentId && <p className="break-all">Payment: {item.razorpayPaymentId}</p>}
                      {item.webhookEventId && <p className="break-all">Event: {item.webhookEventId}</p>}
                    </div>
                  </td>
                  <td className="min-w-36 px-4 py-3.5"><RecordLinks item={item} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-outline-variant/30 px-4 py-3 text-xs font-mono">
            <span className="text-on-surface-variant">Page {page} of {pagination.totalPages}</span>
            <div className="flex gap-2">
              <button
                type="button"
                aria-label="Previous page"
                disabled={page <= 1 || loading}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                className="rounded border border-outline-variant/50 p-1.5 text-on-surface hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="Next page"
                disabled={page >= pagination.totalPages || loading}
                onClick={() => setPage((current) => current + 1)}
                className="rounded border border-outline-variant/50 p-1.5 text-on-surface hover:bg-surface-container-low disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}
      </section>

      <div className="flex items-center gap-1.5 text-[11px] text-on-surface-variant">
        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        Linked records open the existing admin order, payment-attempt, or webhook views.
      </div>
    </div>
  );
}
