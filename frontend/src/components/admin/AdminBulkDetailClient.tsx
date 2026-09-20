"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

interface BulkDetailData {
  request: {
    _id: string;
    quoteNumber: string;
    organizationName: string;
    contactName: string;
    email: string;
    phone: string;
    totalQuantity: number;
    colorAllocation?: string;
    variantBreakdown: { S?: number; M?: number; L?: number; XL?: number; XXL?: number };
    deliveryLocation: string;
    customerNote?: string;
    status: string;
    createdAt: string;
    productId?: {
      name: string;
      images: string[];
      basePrice: number;
    };
  };
  existingQuote?: {
    productPrice: number;
    printingFee: number;
    setupFee: number;
    discount: number;
    subtotal: number;
    tax: number;
    shipping: number;
    total: number;
    status: string;
  };
}

export default function AdminBulkDetailClient({ requestId }: { requestId: string }) {
  const router = useRouter();

  const [data, setData] = useState<BulkDetailData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Quote Form State (in ₹)
  const [productPriceRupees, setProductPriceRupees] = useState(600);
  const [printingFeeRupees, setPrintingFeeRupees] = useState(120);
  const [setupFeeRupees, setSetupFeeRupees] = useState(2000);
  const [discountRupees, setDiscountRupees] = useState(6000);
  const [shippingRupees, setShippingRupees] = useState(2000);
  const [validUntilDays] = useState(7);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState<{ text: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    async function fetchDetail() {
      setIsLoading(true);
      setError(null);
      try {
        const res = await api.get(`/admin/bulk-orders/${requestId}`);
        if (res.data?.success) {
          setData(res.data.data);
          const req = res.data.data.request;
          const exQuote = res.data.data.existingQuote;

          if (exQuote) {
            setProductPriceRupees(exQuote.productPrice / 100);
            setPrintingFeeRupees(exQuote.printingFee / 100);
            setSetupFeeRupees(exQuote.setupFee / 100);
            setDiscountRupees(exQuote.discount / 100);
            setShippingRupees(exQuote.shipping / 100);
          } else if (req?.productId) {
            const baseUnit = (req.productId.basePrice || 149900) / 100;
            setProductPriceRupees(baseUnit * req.totalQuantity);
          }
        }
      } catch (err: any) {
        if (err.response?.status === 403 || err.response?.status === 401) {
          router.push("/admin/login");
          return;
        }
        setError(err.response?.data?.message || "Failed to load request details.");
      } finally {
        setIsLoading(false);
      }
    }
    fetchDetail();
  }, [requestId, router]);

  // Financial Calculations (in ₹)
  const subtotal = productPriceRupees + printingFeeRupees + setupFeeRupees - discountRupees;
  const tax = Math.round(subtotal * 0.18);
  const total = subtotal + tax + shippingRupees;

  // Issue Quote
  const handleIssueQuote = async () => {
    setIsSubmitting(true);
    setToast(null);

    try {
      const res = await api.post(`/admin/bulk-orders/${requestId}/quote`, {
        productPrice: productPriceRupees,
        printingFee: printingFeeRupees,
        setupFee: setupFeeRupees,
        discount: discountRupees,
        shipping: shippingRupees,
        validUntilDays,
      });

      if (res.data?.success) {
        setData((prev) => (prev ? { ...prev, request: res.data.data.request, existingQuote: res.data.data.quote } : null));
        setToast({ text: "B2B Quotation issued and sent to customer!", type: "success" });
      }
    } catch (err: any) {
      setToast({ text: err.response?.data?.message || "Failed to issue quotation.", type: "error" });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 p-10 bg-background text-on-background min-h-screen flex items-center justify-center">
        <div className="text-center font-bold text-on-surface-variant">Loading request details...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex-1 p-10 bg-background text-on-background min-h-screen">
        <div className="p-6 bg-error-container text-on-error-container rounded-xl text-center font-bold">{error || "Request not found."}</div>
      </div>
    );
  }

  const { request } = data;

  return (
    <div className="flex-1 bg-background text-on-background min-h-screen p-6 md:p-10 font-body-md pb-24">
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

      {/* Breadcrumb Header */}
      <div className="flex items-center gap-2 text-xs font-label-caps text-on-surface-variant mb-6 uppercase tracking-widest">
        <Link href="/admin/bulk-orders" className="hover:text-primary transition-colors">
          Bulk Queue
        </Link>
        <span className="material-symbols-outlined text-xs">chevron_right</span>
        <span className="text-primary font-bold">#{request.quoteNumber}</span>
      </div>

      {/* Header Info */}
      <div className="bg-surface-container-lowest p-6 rounded-2xl border border-outline-variant/20 shadow-sm mb-8 flex justify-between items-center">
        <div>
          <h1 className="font-headline-lg text-2xl md:text-3xl font-extrabold text-on-surface">
            {request.organizationName}
          </h1>
          <p className="text-xs text-on-surface-variant font-label-caps mt-1">
            Contact: {request.contactName} ({request.email}) • Requested {new Date(request.createdAt).toLocaleDateString()}
          </p>
        </div>
        <span
          className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
            request.status === "ACCEPTED" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
          }`}
        >
          {request.status}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Request Details (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          <div className="bg-surface-container-lowest p-6 rounded-2xl border border-outline-variant/20 shadow-sm space-y-4">
            <h3 className="font-headline-sm text-lg font-bold text-on-surface border-b border-outline-variant/10 pb-3">
              Order Requirements
            </h3>
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <p className="font-label-caps text-on-surface-variant uppercase">Product</p>
                <p className="font-bold text-on-surface text-sm">{request.productId?.name || "Product"}</p>
              </div>
              <div>
                <p className="font-label-caps text-on-surface-variant uppercase">Total Quantity</p>
                <p className="font-bold text-primary text-sm">{request.totalQuantity} units</p>
              </div>
            </div>

            <div>
              <p className="font-label-caps text-xs text-on-surface-variant uppercase mb-1 font-bold">Size Breakdown</p>
              <div className="flex gap-2">
                {Object.entries(request.variantBreakdown || {}).map(([sz, qty]) => (
                  <div key={sz} className="border border-outline-variant rounded-lg p-2 text-center min-w-[44px]">
                    <span className="font-label-caps text-[10px] text-on-surface-variant block">{sz}</span>
                    <span className="font-bold text-xs text-on-surface">{qty}</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className="font-label-caps text-xs text-on-surface-variant uppercase">Delivery Location</p>
              <p className="font-bold text-on-surface text-xs">{request.deliveryLocation}</p>
            </div>

            {request.customerNote && (
              <div>
                <p className="font-label-caps text-xs text-on-surface-variant uppercase">Customer Note</p>
                <p className="text-xs text-on-surface bg-surface-container-low p-3 rounded-xl italic">{request.customerNote}</p>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Quotation Form (5 cols) */}
        <div className="lg:col-span-5">
          <div className="bg-surface-container-lowest p-6 rounded-2xl border border-outline-variant/20 shadow-sm space-y-4">
            <h3 className="font-headline-sm text-lg font-bold text-on-surface border-b border-outline-variant/10 pb-3">
              B2B Quotation Pricing (in ₹)
            </h3>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-label-caps uppercase text-on-surface mb-1">Base Product Price (₹)</label>
                <input
                  type="number"
                  value={productPriceRupees}
                  onChange={(e) => setProductPriceRupees(Number(e.target.value))}
                  className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-2.5 font-bold focus:border-primary"
                />
              </div>

              <div>
                <label className="block font-label-caps uppercase text-on-surface mb-1">Printing Fee (₹)</label>
                <input
                  type="number"
                  value={printingFeeRupees}
                  onChange={(e) => setPrintingFeeRupees(Number(e.target.value))}
                  className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-2.5 font-bold focus:border-primary"
                />
              </div>

              <div>
                <label className="block font-label-caps uppercase text-on-surface mb-1">Setup Fee (₹)</label>
                <input
                  type="number"
                  value={setupFeeRupees}
                  onChange={(e) => setSetupFeeRupees(Number(e.target.value))}
                  className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-2.5 font-bold focus:border-primary"
                />
              </div>

              <div>
                <label className="block font-label-caps uppercase text-on-surface mb-1">Volume Discount (₹)</label>
                <input
                  type="number"
                  value={discountRupees}
                  onChange={(e) => setDiscountRupees(Number(e.target.value))}
                  className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-2.5 font-bold focus:border-primary text-emerald-700"
                />
              </div>

              <div>
                <label className="block font-label-caps uppercase text-on-surface mb-1">Shipping (₹)</label>
                <input
                  type="number"
                  value={shippingRupees}
                  onChange={(e) => setShippingRupees(Number(e.target.value))}
                  className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-2.5 font-bold focus:border-primary"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-outline-variant/20 text-xs space-y-1 font-label-caps">
              <div className="flex justify-between">
                <span>Subtotal:</span>
                <span className="font-bold">₹{subtotal.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span>18% GST Tax:</span>
                <span className="font-bold">₹{tax.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-base font-bold text-primary pt-1">
                <span>Quoted Total:</span>
                <span>₹{total.toLocaleString()}</span>
              </div>
            </div>

            <button
              onClick={handleIssueQuote}
              disabled={isSubmitting}
              className="w-full py-3 bg-primary text-on-primary font-label-caps text-xs font-bold rounded-xl hover:bg-primary-container transition-colors shadow-md disabled:opacity-50"
            >
              {isSubmitting ? "Issuing Quote..." : "Issue Official Quotation"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
