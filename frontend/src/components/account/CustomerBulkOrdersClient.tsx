"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, FileText, Package, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/useAuthStore";

interface BulkRequestItem {
  _id: string;
  quoteNumber: string;
  organizationName: string;
  contactName: string;
  totalQuantity: number;
  status: string;
  createdAt: string;
  colorAllocation?: string;
  variantBreakdown?: Record<string, number>;
  productId?: {
    _id: string;
    name: string;
    images?: string[];
    basePrice?: number;
  };
}

interface BulkQuoteItem {
  _id: string;
  quoteNumber: string;
  productPrice: number;
  printingFee: number;
  setupFee: number;
  discount: number;
  subtotal: number;
  tax: number;
  shipping: number;
  total: number;
  validUntil: string;
  status: string;
  createdAt: string;
  convertedOrderId?: string;
  bulkRequestId?: BulkRequestItem;
}

export default function CustomerBulkOrdersClient() {
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuthStore();
  const [requests, setRequests] = useState<BulkRequestItem[]>([]);
  const [quotes, setQuotes] = useState<BulkQuoteItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push("/login?redirect=/account/bulk-orders");
      return;
    }

    async function fetchBulkData() {
      if (!isAuthenticated) return;
      setIsLoading(true);
      setError(null);
      try {
        const res = await api.get("/bulk-orders");
        if (res.data?.success && res.data.data) {
          setRequests(res.data.data.requests || []);
          setQuotes(res.data.data.quotes || []);
        }
      } catch (err: unknown) {
        let message = "Failed to load bulk order records.";
        if (err && typeof err === "object" && "response" in err) {
          const response = err.response;
          if (response && typeof response === "object" && "data" in response) {
            const data = response.data;
            if (data && typeof data === "object" && "message" in data && typeof data.message === "string") {
              message = data.message;
            }
          }
        }
        setError(message);
        setIsLoading(false);
      }
    }

    fetchBulkData();
  }, [authLoading, isAuthenticated, router]);

  if (authLoading || (!isAuthenticated && !authLoading)) {
    return (
      <div className="flex-1 min-h-[60vh] flex items-center justify-center bg-background text-on-surface-variant font-body-md">
        Authenticating account session...
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-background text-on-background px-margin-mobile py-8 md:px-margin-desktop md:py-12">
      <div className="max-w-container-max mx-auto space-y-8">
        {/* Breadcrumb & Navigation */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-outline-variant/20 pb-6">
          <div>
            <nav aria-label="Breadcrumb" className="mb-2 flex text-xs text-on-surface-variant font-label-caps">
              <ol className="flex items-center space-x-2">
                <li><Link href="/" className="hover:text-primary transition-colors">Home</Link></li>
                <li><span>/</span></li>
                <li><Link href="/account" className="hover:text-primary transition-colors">Account</Link></li>
                <li><span>/</span></li>
                <li className="font-bold text-on-surface" aria-current="page">Bulk Inquiries & Quotes</li>
              </ol>
            </nav>
            <h1 className="font-headline-lg text-2xl md:text-3xl font-black text-on-surface">
              Bulk Orders & Corporate Quotes
            </h1>
          </div>
          <Link
            href="/bulk-orders/request"
            className="inline-flex items-center gap-2 self-start rounded-lg bg-primary px-5 py-2.5 font-label-caps text-xs text-on-primary hover:bg-primary/90 transition-colors shadow-sm"
          >
            <Plus className="h-4 w-4" />
            <span>New Bulk Request</span>
          </Link>
        </div>

        {error && (
          <div className="rounded-xl border border-error/30 bg-error-container p-4 text-xs text-on-error-container">
            {error}
          </div>
        )}

        {/* Section 1: Active Quotations */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-headline-sm text-lg font-bold text-on-surface">
                Official Quotations ({quotes.length})
              </h2>
              <p className="text-xs text-on-surface-variant font-body-sm">
                Formal B2B quotes issued by our production team with locked pricing and specifications.
              </p>
            </div>
          </div>

          {isLoading ? (
            <div className="py-12 text-center text-xs font-label-caps text-on-surface-variant">
              Loading quotations...
            </div>
          ) : quotes.length === 0 ? (
            <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-8 text-center space-y-3">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-surface-container-low text-on-surface-variant">
                <FileText className="h-6 w-6" />
              </div>
              <p className="font-headline-sm text-base font-bold text-on-surface">No quotations issued yet</p>
              <p className="text-xs text-on-surface-variant max-w-md mx-auto">
                Once our team reviews your submitted bulk requirements, your formal quotation with volume discounts and print setup will appear here.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {quotes.map((quote) => {
                const totalRupees = Math.round(quote.total / 100);
                const isSent = quote.status === "SENT";
                const isAccepted = quote.status === "ACCEPTED";
                const isExpired = quote.status === "EXPIRED" || new Date(quote.validUntil) < new Date();

                return (
                  <div
                    key={quote._id}
                    className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-6 shadow-sm hover:border-primary/40 transition-colors space-y-4"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <span className="font-label-caps text-xs text-on-surface-variant">Quote Reference</span>
                        <h3 className="font-label-caps text-base font-bold text-primary">#{quote.quoteNumber}</h3>
                      </div>
                      <span
                        className={`font-label-caps text-[11px] px-2.5 py-1 rounded-full uppercase font-bold ${
                          isAccepted
                            ? "bg-emerald-100 text-emerald-800"
                            : isSent
                            ? "bg-primary/10 text-primary"
                            : isExpired
                            ? "bg-neutral-200 text-neutral-700"
                            : "bg-red-100 text-red-800"
                        }`}
                      >
                        {quote.status}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-xs border-t border-b border-outline-variant/15 py-3">
                      <div>
                        <span className="text-on-surface-variant font-label-caps">Total Payable</span>
                        <p className="font-bold text-base text-on-surface">₹{totalRupees.toLocaleString()}</p>
                      </div>
                      <div>
                        <span className="text-on-surface-variant font-label-caps">Valid Until</span>
                        <p className="font-bold text-on-surface">
                          {new Date(quote.validUntil).toLocaleDateString()}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <span className="text-xs text-on-surface-variant font-label-caps">
                        Issued {new Date(quote.createdAt).toLocaleDateString()}
                      </span>
                      <Link
                        href={`/bulk-orders/quote/${quote.quoteNumber}`}
                        className="inline-flex items-center gap-1.5 font-label-caps text-xs text-primary font-bold hover:underline"
                      >
                        <span>{isAccepted ? "View Breakdown" : "Review & Act"}</span>
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Section 2: Submitted Inquiries */}
        <section className="space-y-4 pt-6 border-t border-outline-variant/20">
          <div>
            <h2 className="font-headline-sm text-lg font-bold text-on-surface">
              Submitted Inquiries ({requests.length})
            </h2>
            <p className="text-xs text-on-surface-variant font-body-sm">
              Your logged bulk requests awaiting quotation or undergoing technical review.
            </p>
          </div>

          {isLoading ? (
            <div className="py-8 text-center text-xs font-label-caps text-on-surface-variant">
              Loading inquiries...
            </div>
          ) : requests.length === 0 ? (
            <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-8 text-center space-y-3">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-surface-container-low text-on-surface-variant">
                <Package className="h-6 w-6" />
              </div>
              <p className="font-headline-sm text-base font-bold text-on-surface">No bulk inquiries logged</p>
              <p className="text-xs text-on-surface-variant max-w-md mx-auto">
                Need customized apparel for your team, startup, or event? Submit your size and print requirements for a personalized B2B quotation.
              </p>
              <div className="pt-2">
                <Link
                  href="/bulk-orders/request"
                  className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-5 py-2.5 font-label-caps text-xs text-white hover:bg-neutral-800 transition-colors"
                >
                  <Plus className="h-4 w-4" /> Start Bulk Request (10+ Units)
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {requests.map((req) => (
                <div
                  key={req._id}
                  className="rounded-xl border border-outline-variant/20 bg-surface-container-lowest p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xs"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-label-caps text-xs font-bold text-primary">#{req.quoteNumber}</span>
                      <span className="font-label-caps text-[10px] px-2 py-0.5 rounded bg-surface-container-high text-on-surface uppercase font-bold">
                        {req.status}
                      </span>
                    </div>
                    <p className="font-bold text-sm text-on-surface">
                      {req.productId?.name || "Apparel Production Run"}
                    </p>
                    <p className="text-xs text-on-surface-variant font-label-caps">
                      {req.organizationName} · {req.totalQuantity} Units Total
                      {req.colorAllocation ? ` · Colors: ${req.colorAllocation}` : ""}
                    </p>
                  </div>
                  <div className="text-left sm:text-right text-xs text-on-surface-variant font-label-caps">
                    <span>Submitted {new Date(req.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
