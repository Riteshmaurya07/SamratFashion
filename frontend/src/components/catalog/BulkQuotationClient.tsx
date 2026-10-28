"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

interface QuoteData {
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
  bulkRequestId?: {
    _id: string;
    organizationName: string;
    contactName: string;
    email: string;
    phone: string;
    totalQuantity: number;
    colorAllocation?: string;
    variantBreakdown: { S?: number; M?: number; L?: number; XL?: number; XXL?: number };
    printLocations?: string[];
    printMethod?: string;
    productId?: {
      name: string;
      images: string[];
      description?: string;
    };
  };
}

export default function BulkQuotationClient({ quoteId }: { quoteId: string }) {
  const router = useRouter();

  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isProcessing, setIsProcessing] = useState(false);
  const [toast, setToast] = useState<{ text: string; type: "success" | "error" } | null>(null);

  // Fetch Quote Detail
  useEffect(() => {
    async function fetchQuote() {
      setIsLoading(true);
      setError(null);
      try {
        const res = await api.get(`/bulk-orders/quote/${quoteId}`);
        if (res.data?.success) {
          setQuote(res.data.data);
        }
      } catch (err: any) {
        if (err.response?.status === 401) {
          router.push(`/login?redirect=/bulk-orders/quote/${quoteId}`);
          return;
        }
        setError(err.response?.data?.message || "Failed to load bulk quotation.");
      } finally {
        setIsLoading(false);
      }
    }
    fetchQuote();
  }, [quoteId, router]);

  // Approve Quote
  const handleApproveQuote = async () => {
    if (!quote || isProcessing) return;
    setIsProcessing(true);
    setToast(null);

    try {
      const res = await api.post(`/bulk-orders/quote/${quote._id}/accept`);
      if (res.data?.success) {
        setQuote(res.data.data.quote);
        setToast({ text: "Quotation approved! Order created for payment.", type: "success" });
        import("@/lib/analytics").then(({ trackEvent }) => {
          trackEvent("bulk_quote_submitted", {
            quote_number: quote.quoteNumber,
            total_quantity: quote.bulkRequestId?.totalQuantity || 0,
          });
        });
        setTimeout(() => {
          if (res.data.data.order?._id) {
            router.push(`/account/orders/${res.data.data.order._id}`);
          }
        }, 1500);
      }
    } catch (err: unknown) {
      let msg = "Quotation approval failed.";
      if (err && typeof err === "object" && "response" in err) {
        const r = err.response;
        if (r && typeof r === "object" && "data" in r) {
          const d = r.data;
          if (d && typeof d === "object" && "message" in d && typeof d.message === "string") {
            msg = d.message;
          }
        }
      }
      setToast({ text: msg, type: "error" });
      setIsProcessing(false);
    }
  };

  // Reject Quote
  const handleRejectQuote = async () => {
    if (!quote || !confirm("Are you sure you want to reject this quotation?")) return;
    setIsProcessing(true);
    try {
      const res = await api.post(`/bulk-orders/quote/${quote._id}/reject`);
      if (res.data?.success) {
        setQuote(res.data.data);
        setToast({ text: "Quotation rejected.", type: "success" });
      }
    } catch (err: any) {
      setToast({ text: err.response?.data?.message || "Rejection failed.", type: "error" });
    } finally {
      setIsProcessing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 p-10 bg-background text-on-background min-h-screen flex items-center justify-center">
        <div className="text-center font-bold text-on-surface-variant">Loading quotation details...</div>
      </div>
    );
  }

  if (error || !quote) {
    return (
      <div className="flex-1 p-10 bg-background text-on-background min-h-screen">
        <div className="p-6 bg-error-container text-on-error-container rounded-xl text-center font-bold">{error || "Quotation not found."}</div>
      </div>
    );
  }

  const reqData = quote.bulkRequestId;

  return (
    <div className="flex-1 bg-background text-on-background min-h-screen p-6 md:p-12 font-body-md pb-24">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed top-20 right-6 z-50 px-6 py-4 rounded-lg shadow-xl text-white font-medium transition-all ${
            toast.type === "success" ? "bg-emerald-600" : "bg-red-600"
          }`}
        >
          {toast.text}
        </div>
      )}

      {/* Header */}
      <div className="mb-10">
        <h1 className="font-display-lg text-3xl md:text-5xl font-extrabold text-on-surface tracking-tight mb-2">
          Bulk Quotation
        </h1>
        <p className="font-body-md text-on-surface-variant">
          Review your official B2B quotation and approve it when you're ready to proceed to fulfillment.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Details (8 cols) */}
        <div className="lg:col-span-8 space-y-6">
          {/* Quote Header Card (Stitch Screen Match) */}
          <div className="bg-surface-container-lowest border border-outline-variant/20 rounded-2xl p-6 md:p-8 shadow-sm">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 pb-6 border-b border-outline-variant/20">
              <div>
                <p className="font-label-caps text-xs text-on-surface-variant mb-1">Quote Number</p>
                <p className="font-headline-sm text-2xl font-bold text-on-surface">#{quote.quoteNumber}</p>
              </div>
              <span
                className={`px-4 py-2 rounded-full font-label-caps text-xs font-bold uppercase tracking-wider ${
                  quote.status === "ACCEPTED"
                    ? "bg-emerald-100 text-emerald-800"
                    : quote.status === "REJECTED" || quote.status === "EXPIRED"
                    ? "bg-red-100 text-red-800"
                    : "bg-amber-100 text-amber-800"
                }`}
              >
                {quote.status === "SENT" ? "Awaiting Approval" : quote.status}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
              <div>
                <p className="font-label-caps text-xs text-on-surface-variant mb-1">Created Date</p>
                <p className="font-bold text-on-surface">{new Date(quote.createdAt).toLocaleDateString()}</p>
              </div>
              <div>
                <p className="font-label-caps text-xs text-on-surface-variant mb-1">Valid Until</p>
                <p className="font-bold text-red-600">{new Date(quote.validUntil).toLocaleDateString()}</p>
              </div>
            </div>
          </div>

          {/* Customer Information Card (Stitch Screen Match) */}
          <div className="bg-surface-container-lowest border border-outline-variant/20 rounded-2xl p-6 md:p-8 shadow-sm">
            <h2 className="font-headline-sm text-lg font-bold text-on-surface mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-outline">person</span>
              Customer Information
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <p className="font-label-caps text-xs text-on-surface-variant mb-1">Name</p>
                <p className="font-bold text-on-surface">{reqData?.contactName || "Customer"}</p>
              </div>
              <div>
                <p className="font-label-caps text-xs text-on-surface-variant mb-1">Organization</p>
                <p className="font-bold text-on-surface">{reqData?.organizationName || "Company"}</p>
              </div>
              <div>
                <p className="font-label-caps text-xs text-on-surface-variant mb-1">Email</p>
                <p className="font-bold text-on-surface">{reqData?.email}</p>
              </div>
              <div>
                <p className="font-label-caps text-xs text-on-surface-variant mb-1">Phone</p>
                <p className="font-bold text-on-surface">{reqData?.phone}</p>
              </div>
            </div>
          </div>

          {/* Product Configuration Section (Stitch Screen Match) */}
          <div className="bg-surface-container-lowest border border-outline-variant/20 rounded-2xl p-6 md:p-8 shadow-sm">
            <h2 className="font-headline-sm text-lg font-bold text-on-surface mb-6 flex items-center gap-2 border-b border-outline-variant/10 pb-4">
              <span className="material-symbols-outlined text-outline">checkroom</span>
              Product Configuration
            </h2>

            <div className="flex flex-col md:flex-row gap-6">
              <div className="w-full md:w-44 aspect-square bg-surface-container-low rounded-xl overflow-hidden flex-shrink-0 border border-outline-variant/30">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={reqData?.productId?.images?.[0] || "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=500"}
                  alt="Product"
                  className="w-full h-full object-cover"
                />
              </div>

              <div className="flex-1 space-y-4">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-bold text-lg text-on-surface">{reqData?.productId?.name || "Oversized T-Shirt"}</h3>
                    <p className="text-xs text-on-surface-variant">Premium Heavyweight Cotton</p>
                  </div>
                  <div className="text-right">
                    <p className="font-label-caps text-xs text-on-surface-variant mb-0.5">Total Quantity</p>
                    <p className="font-bold text-lg text-primary">{reqData?.totalQuantity || 100} units</p>
                  </div>
                </div>

                <div>
                  <p className="font-label-caps text-xs text-on-surface-variant mb-2 font-bold">Size Breakdown</p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(reqData?.variantBreakdown || {}).map(([sz, qty]) => (
                      <div key={sz} className="flex flex-col items-center border border-outline-variant/50 rounded-lg bg-surface-container-low p-2 min-w-[50px]">
                        <span className="font-label-caps text-[10px] font-bold text-on-surface-variant">{sz}</span>
                        <span className="font-bold text-sm text-on-surface">{qty}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Pricing Breakdown & Actions (4 cols - Stitch Match) */}
        <div className="lg:col-span-4">
          <div className="bg-surface-container-lowest border border-outline-variant/20 rounded-2xl p-6 md:p-8 shadow-sm space-y-6 sticky top-24">
            <h2 className="font-headline-sm text-lg font-bold text-on-surface border-b border-outline-variant/10 pb-4">
              Financial Summary
            </h2>

            <div className="space-y-3 text-sm font-label-caps">
              <div className="flex justify-between">
                <span className="text-on-surface-variant">Base Product Price</span>
                <span className="font-bold text-on-surface">₹{(quote.productPrice / 100).toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-on-surface-variant">Printing Charge</span>
                <span className="font-bold text-on-surface">₹{(quote.printingFee / 100).toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-on-surface-variant">Setup Fee</span>
                <span className="font-bold text-on-surface">₹{(quote.setupFee / 100).toLocaleString()}</span>
              </div>
              {quote.discount > 0 && (
                <div className="flex justify-between text-emerald-600 font-bold">
                  <span>Volume Discount</span>
                  <span>-₹{(quote.discount / 100).toLocaleString()}</span>
                </div>
              )}
              <div className="flex justify-between pt-2 border-t border-outline-variant/20 font-bold">
                <span>Subtotal</span>
                <span>₹{(quote.subtotal / 100).toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-on-surface-variant">GST (18%)</span>
                <span className="font-bold text-on-surface">₹{(quote.tax / 100).toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-on-surface-variant">Shipping</span>
                <span className="font-bold text-on-surface">₹{(quote.shipping / 100).toLocaleString()}</span>
              </div>
            </div>

            <div className="pt-4 border-t-2 border-on-surface">
              <div className="flex justify-between items-end">
                <span className="font-bold text-base text-on-surface">Final Total</span>
                <span className="font-display-lg text-2xl font-black text-primary">₹{(quote.total / 100).toLocaleString()}</span>
              </div>
              <p className="text-right text-[10px] text-on-surface-variant font-label-caps mt-1">Includes all applicable GST & shipping</p>
            </div>

            {quote.status === "ACCEPTED" && (
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 text-center space-y-2">
                <p className="font-bold text-xs text-emerald-800">Quotation Approved & Converted</p>
                <p className="text-[11px] text-emerald-700">This quote was accepted and an order was created.</p>
                {quote.convertedOrderId && (
                  <button
                    onClick={() => router.push(`/account/orders/${quote.convertedOrderId}`)}
                    className="w-full py-2.5 bg-neutral-900 text-white font-label-caps text-xs font-bold rounded-lg hover:bg-neutral-800 transition-colors"
                  >
                    View Order & Complete Payment
                  </button>
                )}
              </div>
            )}

            {quote.status !== "ACCEPTED" && quote.status !== "REJECTED" && (
              <div className="space-y-3 pt-4">
                <button
                  onClick={handleApproveQuote}
                  disabled={isProcessing}
                  className="w-full py-4 bg-primary text-on-primary font-label-caps text-xs font-bold rounded-xl hover:bg-primary/90 transition-colors shadow-md disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <span className="material-symbols-outlined text-lg">check_circle</span>
                  {isProcessing ? "Processing..." : "Approve Quote & Proceed"}
                </button>
                <button
                  onClick={handleRejectQuote}
                  disabled={isProcessing}
                  className="w-full py-2.5 text-error font-label-caps text-xs font-bold hover:underline text-center"
                >
                  Reject Quote
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
