/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  FileText,
  Package,
  Plus,
  Eye,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/useAuthStore";

interface MockupHistoryItem {
  version: number;
  mockupUrl: string;
  notes?: string;
  uploadedAt: string;
}

interface ApprovalDecision {
  decision: "APPROVED" | "REVISION_REQUESTED";
  comment?: string;
  decidedAt: string;
  mockupVersion?: number;
}

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
  currentMockupUrl?: string;
  mockupHistory?: MockupHistoryItem[];
  approvalDecision?: ApprovalDecision;
  customerNote?: string;
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

  // Mockup Review Modal State
  const [selectedRequestForReview, setSelectedRequestForReview] = useState<BulkRequestItem | null>(null);
  const [revisionComment, setRevisionComment] = useState("");
  const [isSubmittingDecision, setIsSubmittingDecision] = useState(false);
  const [decisionFeedback, setDecisionFeedback] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const fetchBulkData = async () => {
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
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push("/login?redirect=/account/bulk-orders");
      return;
    }

    if (isAuthenticated) {
      fetchBulkData();
    }
  }, [authLoading, isAuthenticated, router]);

  const handleApproveMockup = async () => {
    if (!selectedRequestForReview) return;
    setIsSubmittingDecision(true);
    setDecisionFeedback(null);
    try {
      const res = await api.post(`/bulk-orders/requests/${selectedRequestForReview._id}/approve-mockup`);
      if (res.data?.success) {
        setDecisionFeedback({ text: "Mockup approved! We will now issue your official quotation.", type: "success" });
        await fetchBulkData();
        setTimeout(() => {
          setSelectedRequestForReview(null);
          setDecisionFeedback(null);
        }, 1800);
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setDecisionFeedback({ text: e.response?.data?.message || "Failed to approve mockup.", type: "error" });
    } finally {
      setIsSubmittingDecision(false);
    }
  };

  const handleRequestRevision = async () => {
    if (!selectedRequestForReview) return;
    if (!revisionComment.trim()) {
      setDecisionFeedback({ text: "Please enter your requested revisions or comments.", type: "error" });
      return;
    }

    setIsSubmittingDecision(true);
    setDecisionFeedback(null);
    try {
      const res = await api.post(`/bulk-orders/requests/${selectedRequestForReview._id}/request-revision`, {
        comment: revisionComment.trim(),
      });
      if (res.data?.success) {
        setDecisionFeedback({ text: "Revision requested! Our design team will prepare an updated proof.", type: "success" });
        await fetchBulkData();
        setTimeout(() => {
          setSelectedRequestForReview(null);
          setRevisionComment("");
          setDecisionFeedback(null);
        }, 1800);
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setDecisionFeedback({ text: e.response?.data?.message || "Failed to request revision.", type: "error" });
    } finally {
      setIsSubmittingDecision(false);
    }
  };

  if (authLoading || (!isAuthenticated && !authLoading)) {
    return (
      <div className="flex-1 min-h-[60vh] flex items-center justify-center bg-background text-on-surface-variant font-body-md">
        Authenticating account session...
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-background text-on-background px-4 py-6 md:py-8 md:px-8 max-w-6xl mx-auto space-y-8 pb-28 lg:pb-8">
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
          <h1 className="text-2xl md:text-3xl font-black text-on-surface">
            Bulk Orders & Mockup Proofs
          </h1>
        </div>
        <Link
          href="/bulk-orders/request"
          className="inline-flex items-center gap-2 self-start rounded-xl bg-primary px-5 py-2.5 text-xs font-bold text-on-primary hover:bg-primary/90 transition-colors shadow-sm"
        >
          <Plus className="h-4 w-4" />
          <span>New Bulk Inquiry</span>
        </Link>
      </div>

      {error && (
        <div className="rounded-2xl border border-error/30 bg-error-container p-4 text-xs font-bold text-on-error-container">
          {error}
        </div>
      )}

      {/* Section 1: Active Quotations */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-bold text-on-surface">
            Formal B2B Quotations ({quotes.length})
          </h2>
          <p className="text-xs text-on-surface-variant">
            Official volume quotes issued by our production team with locked pricing and specifications.
          </p>
        </div>

        {isLoading ? (
          <div className="py-12 text-center text-xs font-bold text-on-surface-variant animate-pulse">
            Loading quotations...
          </div>
        ) : quotes.length === 0 ? (
          <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-8 text-center space-y-3">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-surface-container-low text-on-surface-variant">
              <FileText className="h-6 w-6" />
            </div>
            <p className="font-bold text-base text-on-surface">No quotations issued yet</p>
            <p className="text-xs text-on-surface-variant max-w-md mx-auto">
              Once our team shares your mockup proof and you approve the design specifications, your formal quotation with volume discounts will appear here.
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
                  className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-6 shadow-xs hover:border-primary/40 transition-colors space-y-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <span className="text-xs text-on-surface-variant font-bold">Quote Reference</span>
                      <h3 className="text-base font-black text-primary font-mono">#{quote.quoteNumber}</h3>
                    </div>
                    <span
                      className={`text-[11px] px-2.5 py-1 rounded-full uppercase font-bold ${
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
                      <span className="text-on-surface-variant block mb-0.5">Total Payable</span>
                      <p className="font-black text-base text-on-surface font-mono">₹{totalRupees.toLocaleString()}</p>
                    </div>
                    <div>
                      <span className="text-on-surface-variant block mb-0.5">Valid Until</span>
                      <p className="font-bold text-on-surface font-mono">
                        {new Date(quote.validUntil).toLocaleDateString()}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-xs text-on-surface-variant font-mono">
                      Issued {new Date(quote.createdAt).toLocaleDateString()}
                    </span>
                    <Link
                      href={`/bulk-orders/quote/${quote.quoteNumber}`}
                      className="inline-flex items-center gap-1.5 text-xs text-primary font-bold hover:underline"
                    >
                      <span>{isAccepted ? "View Breakdown & Order" : "Review Terms & Accept"}</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Section 2: Submitted Inquiries & Mockup Proofs */}
      <section className="space-y-4 pt-6 border-t border-outline-variant/20">
        <div>
          <h2 className="text-lg font-bold text-on-surface">
            Submitted Inquiries & Design Proofs ({requests.length})
          </h2>
          <p className="text-xs text-on-surface-variant">
            Track your bulk apparel runs, review digital proofs shared by our team, and approve designs.
          </p>
        </div>

        {isLoading ? (
          <div className="py-8 text-center text-xs font-bold text-on-surface-variant animate-pulse">
            Loading inquiries...
          </div>
        ) : requests.length === 0 ? (
          <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-8 text-center space-y-3">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-surface-container-low text-on-surface-variant">
              <Package className="h-6 w-6" />
            </div>
            <p className="font-bold text-base text-on-surface">No bulk inquiries logged</p>
            <p className="text-xs text-on-surface-variant max-w-md mx-auto">
              Need custom printed apparel for your team, startup, or event? Submit your requirements for a personalized B2B quotation.
            </p>
            <div className="pt-2">
              <Link
                href="/bulk-orders/request"
                className="inline-flex items-center gap-2 rounded-xl bg-neutral-900 px-5 py-2.5 text-xs text-white hover:bg-neutral-800 transition-colors font-bold"
              >
                <Plus className="h-4 w-4" /> Start Bulk Request
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {requests.map((req) => {
              const hasMockup = Boolean(req.currentMockupUrl);
              const needsAction = req.status === "MOCKUP_SHARED" || req.status === "REVISION_REQUESTED";

              return (
                <div
                  key={req._id}
                  className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-6 flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-xs"
                >
                  <div className="space-y-1.5 flex-1">
                    <div className="flex items-center gap-2.5">
                      <span className="font-mono text-xs font-black text-primary">#{req.quoteNumber}</span>
                      <span
                        className={`text-[10px] px-2.5 py-0.5 rounded-full uppercase font-black tracking-wider ${
                          req.status === "DESIGN_APPROVED" || req.status === "ACCEPTED" || req.status === "ORDER_CREATED"
                            ? "bg-emerald-100 text-emerald-800"
                            : req.status === "MOCKUP_SHARED"
                            ? "bg-sky-100 text-sky-800"
                            : req.status === "REVISION_REQUESTED"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-surface-container-high text-on-surface"
                        }`}
                      >
                        {req.status.replace(/_/g, " ")}
                      </span>
                    </div>
                    <p className="font-bold text-sm text-on-surface">
                      {req.productId?.name || "Custom Apparel Blank"}
                    </p>
                    <p className="text-xs text-on-surface-variant">
                      {req.organizationName} · {req.totalQuantity} Units Total
                      {req.colorAllocation ? ` · Colors: ${req.colorAllocation}` : ""}
                    </p>
                    <p className="text-[11px] text-on-surface-variant font-mono">
                      Submitted on {new Date(req.createdAt).toLocaleDateString()}
                    </p>
                    {req.customerNote && (
                      <p className="text-xs text-on-surface bg-surface-container-low p-2.5 rounded-lg border border-outline-variant/20 italic max-w-xl mt-1 line-clamp-2">
                        &ldquo;{req.customerNote}&rdquo;
                      </p>
                    )}
                  </div>

                  {/* Actions / Mockup Review */}
                  <div className="flex items-center gap-3 self-start md:self-center">
                    {hasMockup ? (
                      <button
                        onClick={() => setSelectedRequestForReview(req)}
                        className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-colors ${
                          needsAction
                            ? "bg-primary text-white hover:bg-primary/90 shadow-sm animate-pulse"
                            : "border border-outline-variant text-on-surface hover:bg-surface-container"
                        }`}
                      >
                        <Eye className="h-4 w-4" />
                        <span>{needsAction ? "Review Mockup Proof (Action Required)" : "View Approved Mockup"}</span>
                      </button>
                    ) : (
                      <span className="text-xs text-on-surface-variant italic">
                        Mockup proof in preparation by design team
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Mockup Review & Approval Modal */}
      {selectedRequestForReview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-3xl bg-surface-container-lowest p-6 md:p-8 shadow-2xl space-y-6">
            <div className="flex items-center justify-between border-b border-outline-variant/20 pb-4">
              <div>
                <span className="text-[10px] font-bold text-primary font-mono uppercase bg-primary/10 px-2 py-0.5 rounded">
                  Proof Verification #{selectedRequestForReview.quoteNumber}
                </span>
                <h2 className="text-xl font-black text-on-surface mt-1">
                  Design Mockup & Digital Proof
                </h2>
              </div>
              <button
                onClick={() => setSelectedRequestForReview(null)}
                className="text-on-surface-variant hover:text-on-surface font-bold text-lg"
              >
                ✕
              </button>
            </div>

            {decisionFeedback && (
              <div
                className={`p-4 rounded-xl text-xs font-bold ${
                  decisionFeedback.type === "success"
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-error-container text-on-error-container"
                }`}
              >
                {decisionFeedback.text}
              </div>
            )}

            {/* Proof Preview Visual */}
            <div className="space-y-3">
              <div className="relative aspect-[4/5] max-h-80 mx-auto w-auto rounded-2xl overflow-hidden bg-white border border-outline-variant/30 flex items-center justify-center p-4">
                <img
                  src={selectedRequestForReview.currentMockupUrl}
                  alt="Production Proof"
                  className="h-full w-full object-contain"
                />
              </div>

              {selectedRequestForReview.mockupHistory && selectedRequestForReview.mockupHistory.length > 0 && (
                <div className="rounded-xl border border-outline-variant/20 bg-surface-container-low p-3 text-xs space-y-1">
                  <span className="font-bold text-on-surface block">
                    Proof Version {selectedRequestForReview.mockupHistory[selectedRequestForReview.mockupHistory.length - 1].version}
                  </span>
                  {selectedRequestForReview.mockupHistory[selectedRequestForReview.mockupHistory.length - 1].notes && (
                    <p className="text-on-surface-variant italic">
                      &ldquo;{selectedRequestForReview.mockupHistory[selectedRequestForReview.mockupHistory.length - 1].notes}&rdquo;
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Decision Controls */}
            {selectedRequestForReview.status === "MOCKUP_SHARED" || selectedRequestForReview.status === "REVISION_REQUESTED" ? (
              <div className="space-y-4 pt-2 border-t border-outline-variant/20">
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-on-surface">
                    Need Changes? Enter Revision Feedback:
                  </label>
                  <textarea
                    rows={2}
                    value={revisionComment}
                    onChange={(e) => setRevisionComment(e.target.value)}
                    placeholder="E.g. Please enlarge chest logo by 20% and shift 1 inch to the left..."
                    className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-low p-3 text-xs outline-none focus:border-primary"
                  />
                </div>

                <div className="flex flex-col sm:flex-row gap-3 pt-2">
                  <button
                    type="button"
                    onClick={handleRequestRevision}
                    disabled={isSubmittingDecision}
                    className="flex-1 rounded-xl border border-amber-600/40 bg-amber-50 py-3 text-xs font-bold text-amber-900 hover:bg-amber-100 transition-colors disabled:opacity-50"
                  >
                    {isSubmittingDecision ? "Submitting..." : "Request Design Revision"}
                  </button>

                  <button
                    type="button"
                    onClick={handleApproveMockup}
                    disabled={isSubmittingDecision}
                    className="flex-1 rounded-xl bg-emerald-600 py-3 text-xs font-black text-white hover:bg-emerald-700 transition-colors shadow-sm disabled:opacity-50 uppercase tracking-wider"
                  >
                    {isSubmittingDecision ? "Approving..." : "Approve Mockup Proof"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-center text-xs font-bold text-emerald-900">
                Mockup proof has been approved. Your formal quotation is locked against this visual.
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
