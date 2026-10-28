/* eslint-disable @next/next/no-img-element */
"use client";

import { useState, useEffect, ChangeEvent, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import {
  UploadCloud,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Sparkles,
  MessageSquare,
} from "lucide-react";

interface VariantAllocation {
  size: string;
  color?: string;
  quantity: number;
  sku?: string;
}

interface ArtworkFile {
  url: string;
  publicId?: string;
  originalFilename?: string;
  fileType?: string;
  sizeBytes?: number;
}

interface MockupHistoryItem {
  version: number;
  mockupUrl: string;
  notes?: string;
  uploadedAt: string;
  uploadedBy?: { name?: string; email?: string };
}

interface ApprovalDecision {
  decision: "APPROVED" | "REVISION_REQUESTED";
  comment?: string;
  decidedAt: string;
  mockupVersion?: number;
}

interface SuggestedQuote {
  unitPriceRupees: number;
  baseUnitPriceRupees: number;
  totalProductPriceRupees: number;
  discountPercentage: number;
  totalDiscountRupees: number;
  totalPrintingFeeRupees: number;
  setupFeeRupees: number;
  subtotalRupees: number;
  taxRupees: number;
  shippingRupees: number;
  totalRupees: number;
  appliedTier?: {
    minQuantity: number;
    maxQuantity?: number;
    discountPercentage?: number;
  };
  ruleSource: string;
}

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
    variantBreakdown?: Record<string, number>;
    variantAllocations?: VariantAllocation[];
    printLocations?: string[];
    printMethod?: string;
    printText?: string;
    preferredColors?: string[];
    needsDesignAssistance?: boolean;
    designPreferences?: string;
    deliveryLocation: string;
    city?: string;
    state?: string;
    postalCode?: string;
    requiredByDate?: string;
    customerNote?: string;
    status: string;
    createdAt: string;
    artworkFiles?: ArtworkFile[];
    currentMockupUrl?: string;
    mockupHistory?: MockupHistoryItem[];
    approvalDecision?: ApprovalDecision;
    approvalHistory?: ApprovalDecision[];
    productId?: {
      _id: string;
      name: string;
      images: string[];
      basePrice: number;
    };
    catalogItemId?: {
      _id: string;
      name: string;
      slug: string;
      mockupImageUrl: string;
      minOrderQuantity?: number;
    };
  };
  existingQuote?: {
    _id: string;
    quoteNumber: string;
    productPrice: number; // in paise
    printingFee: number;
    setupFee: number;
    discount: number;
    subtotal: number;
    tax: number;
    shipping: number;
    total: number;
    validUntil: string;
    status: string;
    notes?: string;
    convertedOrderId?: string;
  };
  suggestedQuote?: SuggestedQuote;
}

export default function AdminBulkDetailClient({ requestId }: { requestId: string }) {
  const router = useRouter();

  const [data, setData] = useState<BulkDetailData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Mockup Upload State
  const [mockupUrlInput, setMockupUrlInput] = useState("");
  const [mockupNotes, setMockupNotes] = useState("");
  const [isUploadingMockup, setIsUploadingMockup] = useState(false);
  const [isSharingMockup, setIsSharingMockup] = useState(false);
  const mockupFileInputRef = useRef<HTMLInputElement>(null);

  // Quote Form State (in ₹)
  const [productPriceRupees, setProductPriceRupees] = useState(0);
  const [printingFeeRupees, setPrintingFeeRupees] = useState(0);
  const [setupFeeRupees, setSetupFeeRupees] = useState(0);
  const [discountRupees, setDiscountRupees] = useState(0);
  const [shippingRupees, setShippingRupees] = useState(0);
  const [validUntilDays, setValidUntilDays] = useState(7);
  const [quoteNotes, setQuoteNotes] = useState("");

  const [isSubmittingQuote, setIsSubmittingQuote] = useState(false);
  const [toast, setToast] = useState<{ text: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    async function fetchDetail() {
      setIsLoading(true);
      setError(null);
      try {
        const res = await api.get(`/admin/bulk-orders/${requestId}`);
        if (res.data?.success) {
          const fetchedData: BulkDetailData = res.data.data;
          setData(fetchedData);
          const exQuote = fetchedData.existingQuote;
          const sug = fetchedData.suggestedQuote;

          if (exQuote) {
            setProductPriceRupees(Math.round(exQuote.productPrice / 100));
            setPrintingFeeRupees(Math.round(exQuote.printingFee / 100));
            setSetupFeeRupees(Math.round(exQuote.setupFee / 100));
            setDiscountRupees(Math.round(exQuote.discount / 100));
            setShippingRupees(Math.round(exQuote.shipping / 100));
            setQuoteNotes(exQuote.notes || "");
          } else if (sug) {
            setProductPriceRupees(sug.totalProductPriceRupees);
            setPrintingFeeRupees(sug.totalPrintingFeeRupees);
            setSetupFeeRupees(sug.setupFeeRupees);
            setDiscountRupees(sug.totalDiscountRupees);
            setShippingRupees(sug.shippingRupees || 0);
          } else if (fetchedData.request?.productId) {
            const baseUnit = fetchedData.request.productId.basePrice || 799;
            setProductPriceRupees(baseUnit * fetchedData.request.totalQuantity);
          }
        }
      } catch (err: unknown) {
        const e = err as { response?: { status?: number; data?: { message?: string } } };
        if (e.response?.status === 403 || e.response?.status === 401) {
          router.push("/admin/login");
          return;
        }
        setError(e.response?.data?.message || "Failed to load request details.");
      } finally {
        setIsLoading(false);
      }
    }
    fetchDetail();
  }, [requestId, router]);

  // Financial Calculations (in ₹)
  const subtotal = Math.max(0, productPriceRupees + printingFeeRupees + setupFeeRupees - discountRupees);
  const tax = Math.round(subtotal * 0.18); // 18% GST
  const total = subtotal + tax + shippingRupees;

  // Handle Mockup Image File Upload
  const handleMockupFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    setIsUploadingMockup(true);
    setToast(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("category", "product");
      const res = await api.post("/upload/image", formData, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 120000,
      });

      const url = res.data?.data?.url;
      if (!url) throw new Error("Upload did not return an image URL");
      setMockupUrlInput(url);
      setToast({ text: "Mockup file uploaded successfully. Review and share below.", type: "success" });
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string; response?: { data?: { message?: string } } };
      if (e.code === "ECONNABORTED" || e.message?.includes("timeout")) {
        setToast({ text: "Mockup upload timed out. Please try again or compress the image.", type: "error" });
      } else {
        setToast({ text: e.response?.data?.message || "Failed to upload mockup image.", type: "error" });
      }
    } finally {
      setIsUploadingMockup(false);
    }
  };

  // Submit Mockup to Customer
  const handleShareMockup = async () => {
    if (!mockupUrlInput.trim()) {
      setToast({ text: "Please upload or specify a mockup image URL.", type: "error" });
      return;
    }

    setIsSharingMockup(true);
    setToast(null);
    try {
      const res = await api.post(`/admin/bulk-orders/${requestId}/mockup`, {
        mockupUrl: mockupUrlInput.trim(),
        notes: mockupNotes.trim() || undefined,
      });

      if (res.data?.success) {
        setData((prev) => (prev ? { ...prev, request: res.data.data } : null));
        setMockupUrlInput("");
        setMockupNotes("");
        setToast({ text: "Mockup proof shared with customer for review!", type: "success" });
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setToast({ text: e.response?.data?.message || "Failed to share mockup.", type: "error" });
    } finally {
      setIsSharingMockup(false);
    }
  };

  // Issue Formal B2B Quotation
  const handleIssueQuote = async () => {
    setIsSubmittingQuote(true);
    setToast(null);

    try {
      const res = await api.post(`/admin/bulk-orders/${requestId}/quote`, {
        productPrice: productPriceRupees,
        printingFee: printingFeeRupees,
        setupFee: setupFeeRupees,
        discount: discountRupees,
        shipping: shippingRupees,
        validUntilDays,
        notes: quoteNotes.trim() || undefined,
      });

      if (res.data?.success) {
        setData((prev) =>
          prev ? { ...prev, request: res.data.data.request, existingQuote: res.data.data.quote } : null
        );
        setToast({ text: "B2B Quotation issued and sent to customer!", type: "success" });
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setToast({ text: e.response?.data?.message || "Failed to issue quotation.", type: "error" });
    } finally {
      setIsSubmittingQuote(false);
    }
  };

  // Update Inquiry Status (New, Under Review, Contacted, Confirmed, etc.)
  const handleUpdateStatus = async (newStatus: string) => {
    try {
      const res = await api.patch(`/admin/bulk-orders/${requestId}/status`, { status: newStatus });
      if (res.data?.success) {
        setData((prev) => (prev ? { ...prev, request: { ...prev.request, status: newStatus } } : null));
        setToast({ text: `Status updated to ${newStatus.replace(/_/g, " ")}`, type: "success" });
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setToast({ text: e.response?.data?.message || "Failed to update status.", type: "error" });
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 p-10 bg-background text-on-background min-h-screen flex items-center justify-center">
        <div className="text-center font-bold text-on-surface-variant text-xs animate-pulse">
          Loading bulk order request #{requestId}...
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex-1 p-10 bg-background text-on-background min-h-screen">
        <div className="p-6 bg-error-container text-on-error-container rounded-2xl text-center font-bold text-xs">
          {error || "Request not found."}
        </div>
      </div>
    );
  }

  const { request, existingQuote, suggestedQuote } = data;

  return (
    <div className="flex-1 bg-background text-on-background min-h-screen p-6 md:p-10 font-body-md pb-24 max-w-7xl mx-auto">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed top-20 right-6 z-50 px-5 py-3 rounded-xl shadow-xl text-white text-xs font-bold transition-all ${
            toast.type === "success" ? "bg-emerald-600" : "bg-red-600"
          }`}
        >
          {toast.text}
        </div>
      )}

      {/* Breadcrumb Header */}
      <div className="flex items-center gap-2 text-xs font-bold text-on-surface-variant mb-6 uppercase tracking-wider">
        <Link href="/admin/bulk-orders" className="hover:text-primary transition-colors">
          Bulk Queue
        </Link>
        <span>/</span>
        <span className="text-primary font-mono">#{request.quoteNumber}</span>
      </div>

      {/* Main Banner */}
      <div className="bg-surface-container-lowest p-6 rounded-3xl border border-outline-variant/30 shadow-xs mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <span className="text-[10px] font-bold text-primary font-mono uppercase bg-primary/10 px-2.5 py-0.5 rounded-full">
            Inquiry Ref #{request.quoteNumber}
          </span>
          <h1 className="text-2xl md:text-3xl font-black text-on-surface mt-1">
            {request.organizationName}
          </h1>
          <p className="text-xs text-on-surface-variant mt-1">
            Contact: <strong>{request.contactName}</strong> · {request.email} · {request.phone}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={request.status}
            onChange={(e) => handleUpdateStatus(e.target.value)}
            className="px-3 py-1.5 rounded-xl border border-outline-variant/50 bg-surface-container-low text-xs font-bold text-on-surface outline-none focus:border-primary"
          >
            <option value="REQUESTED">1. REQUESTED (New)</option>
            <option value="UNDER_REVIEW">2. UNDER REVIEW</option>
            <option value="CONTACTED">3. CONTACTED</option>
            <option value="MOCKUP_SHARED">4. MOCKUP SHARED</option>
            <option value="REVISION_REQUESTED">5. REVISION REQUESTED</option>
            <option value="DESIGN_APPROVED">6. DESIGN APPROVED</option>
            <option value="CONFIRMED">7. CONFIRMED</option>
            <option value="QUOTED">8. QUOTED</option>
            <option value="ACCEPTED">9. ACCEPTED</option>
            <option value="ORDER_CREATED">10. ORDER CREATED</option>
            <option value="CLOSED">CLOSED</option>
            <option value="REJECTED">REJECTED</option>
            <option value="CANCELLED">CANCELLED</option>
          </select>
          {existingQuote?.convertedOrderId && (
            <Link
              href={`/admin/orders/${existingQuote.convertedOrderId}`}
              className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 transition-colors shadow-sm"
            >
              <span>View Created Order</span>
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column (7 cols): Garment Specs, Artwork, Allocations, Mockup Proofs */}
        <div className="lg:col-span-7 space-y-6">
          {/* Garment & Quantity Requirements */}
          <div className="bg-surface-container-lowest p-6 rounded-3xl border border-outline-variant/30 shadow-xs space-y-4">
            <h3 className="text-base font-bold text-on-surface border-b border-outline-variant/20 pb-3">
              Garment & Requirements
            </h3>
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <p className="text-on-surface-variant text-[11px] uppercase font-bold">Selected Silhouette</p>
                <p className="font-bold text-on-surface text-sm">{request.productId?.name || "Garment"}</p>
                {request.catalogItemId && (
                  <p className="text-[11px] text-primary">Catalog: {request.catalogItemId.name}</p>
                )}
              </div>
              <div>
                <p className="text-on-surface-variant text-[11px] uppercase font-bold">Quantity & Configured MOQ</p>
                <p className="font-black text-primary text-base font-mono">
                  {request.totalQuantity} units{" "}
                  <span className="text-xs text-on-surface-variant font-normal">
                    (MOQ: {request.catalogItemId?.minOrderQuantity || 10} pcs)
                  </span>
                </p>
              </div>
            </div>

            {/* Structured Variant Allocations */}
            <div>
              <p className="text-xs text-on-surface-variant font-bold uppercase mb-2">Size & Color Allocations</p>
              {request.variantAllocations && request.variantAllocations.length > 0 ? (
                <div className="overflow-x-auto rounded-xl border border-outline-variant/30">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-surface-container-low text-on-surface-variant font-bold">
                      <tr>
                        <th className="p-2">Size</th>
                        <th className="p-2">Color</th>
                        <th className="p-2 text-right">Quantity</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-outline-variant/20">
                      {request.variantAllocations.map((alloc, idx) => (
                        <tr key={idx}>
                          <td className="p-2 font-bold">{alloc.size}</td>
                          <td className="p-2 text-on-surface-variant">{alloc.color || request.colorAllocation || "Standard"}</td>
                          <td className="p-2 text-right font-mono font-bold text-primary">{alloc.quantity}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="flex gap-2">
                  {Object.entries(request.variantBreakdown || {}).map(([sz, qty]) => (
                    <div key={sz} className="border border-outline-variant/40 rounded-xl p-2.5 text-center min-w-[50px] bg-surface-container-low">
                      <span className="text-[10px] text-on-surface-variant font-bold block">{sz}</span>
                      <span className="font-bold text-xs text-on-surface">{qty}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Printing Specifications */}
            <div className="grid grid-cols-2 gap-4 text-xs pt-2 border-t border-outline-variant/20">
              {request.printLocations && request.printLocations.length > 0 && (
                <div>
                  <p className="text-on-surface-variant text-[11px] uppercase font-bold">Print Locations (Legacy)</p>
                  <p className="font-bold text-on-surface">
                    {request.printLocations.join(", ")}
                  </p>
                </div>
              )}
              <div>
                <p className="text-on-surface-variant text-[11px] uppercase font-bold">Print Method</p>
                <p className="font-bold text-on-surface">{request.printMethod || "DTF Transfer"}</p>
              </div>
              {request.printText && (
                <div className="col-span-2">
                  <p className="text-on-surface-variant text-[11px] uppercase font-bold">Print Text</p>
                  <p className="font-bold text-on-surface font-mono bg-surface-container-low p-2 rounded-lg">
                    {request.printText}
                  </p>
                </div>
              )}
              {request.preferredColors && request.preferredColors.length > 0 && (
                <div className="col-span-2">
                  <p className="text-on-surface-variant text-[11px] uppercase font-bold">Preferred Ink Colors</p>
                  <p className="font-medium text-on-surface">{request.preferredColors.join(", ")}</p>
                </div>
              )}
            </div>

            <div>
              <p className="text-on-surface-variant text-[11px] uppercase font-bold">Delivery Location</p>
              <p className="font-medium text-on-surface text-xs">
                {request.deliveryLocation}
                {request.city ? `, ${request.city}` : ""}
                {request.state ? `, ${request.state}` : ""}
                {request.postalCode ? ` - ${request.postalCode}` : ""}
              </p>
            </div>

            {(request.customerNote || request.designPreferences) && (
              <div className="rounded-2xl border-2 border-primary/20 bg-primary/5 p-4 space-y-2">
                <div className="flex items-center gap-2 font-bold text-xs text-primary uppercase tracking-wider">
                  <MessageSquare className="h-4 w-4" />
                  <span>Customer Requirements & Instructions</span>
                </div>
                {request.customerNote && (
                  <p className="text-xs text-on-surface leading-relaxed whitespace-pre-line bg-white/80 p-3 rounded-xl border border-primary/10">
                    {request.customerNote}
                  </p>
                )}
                {request.designPreferences && (
                  <div className="pt-1">
                    <span className="text-[10px] font-bold uppercase text-on-surface-variant block">Design Preferences:</span>
                    <p className="text-xs text-on-surface italic mt-0.5">{request.designPreferences}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Customer Uploaded Artwork */}
          <div className="bg-surface-container-lowest p-6 rounded-3xl border border-outline-variant/30 shadow-xs space-y-4">
            <h3 className="text-base font-bold text-on-surface border-b border-outline-variant/20 pb-3 flex items-center justify-between">
              <span>Customer Reference Artwork</span>
              {request.needsDesignAssistance && (
                <span className="text-[10px] font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full">
                  Design Assistance Requested
                </span>
              )}
            </h3>

            {request.artworkFiles && request.artworkFiles.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {request.artworkFiles.map((art, idx) => (
                  <div key={idx} className="rounded-2xl border border-outline-variant/40 bg-surface-container-low p-3 space-y-2">
                    <div className="relative aspect-square w-full rounded-xl overflow-hidden bg-white flex items-center justify-center border border-outline-variant/20">
                      <img src={art.url} alt="Reference Artwork" className="h-full w-full object-contain" />
                    </div>
                    <div className="truncate text-xs">
                      <p className="font-bold truncate text-on-surface">{art.originalFilename || `Artwork #${idx + 1}`}</p>
                      <a
                        href={art.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-primary hover:underline font-bold inline-flex items-center gap-1 mt-0.5"
                      >
                        <span>Open Full Asset</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-on-surface-variant italic">
                No uploaded reference files provided with this request.
              </p>
            )}
          </div>

          {/* Mockup Proof & Customer Approval History */}
          <div className="bg-surface-container-lowest p-6 rounded-3xl border border-outline-variant/30 shadow-xs space-y-5">
            <h3 className="text-base font-bold text-on-surface border-b border-outline-variant/20 pb-3">
              Production Mockup & Customer Approval
            </h3>

            {/* Attach New Mockup Form */}
            <div className="bg-surface-container-low p-4 rounded-2xl border border-outline-variant/30 space-y-3">
              <span className="text-xs font-bold text-on-surface block">Upload / Share Garment Mockup</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => mockupFileInputRef.current?.click()}
                  disabled={isUploadingMockup}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-outline-variant bg-surface-container-lowest px-3 py-2 text-xs font-bold text-on-surface hover:bg-surface-container transition-colors"
                >
                  <UploadCloud className="h-3.5 w-3.5" />
                  <span>{isUploadingMockup ? "Uploading..." : "Upload Proof Image"}</span>
                </button>
                <input
                  ref={mockupFileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleMockupFileUpload}
                  className="hidden"
                />
              </div>

              <div>
                <input
                  type="text"
                  value={mockupUrlInput}
                  onChange={(e) => setMockupUrlInput(e.target.value)}
                  placeholder="Or paste asset URL (https://res.cloudinary.com/...)"
                  className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-2.5 text-xs outline-none focus:border-primary font-mono"
                />
              </div>

              <div>
                <textarea
                  rows={2}
                  value={mockupNotes}
                  onChange={(e) => setMockupNotes(e.target.value)}
                  placeholder="Notes for customer (e.g. 10cm chest placement centered 3 inches below collar)..."
                  className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-2.5 text-xs outline-none focus:border-primary"
                />
              </div>

              <button
                type="button"
                onClick={handleShareMockup}
                disabled={isSharingMockup || !mockupUrlInput.trim()}
                className="w-full rounded-xl bg-primary py-2.5 text-xs font-bold text-on-primary hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {isSharingMockup ? "Sending..." : "Share Mockup Proof with Customer"}
              </button>
            </div>

            {/* Approval Decision Callout */}
            {request.approvalDecision && (
              <div
                className={`p-4 rounded-2xl border ${
                  request.approvalDecision.decision === "APPROVED"
                    ? "bg-emerald-50 border-emerald-300 text-emerald-900"
                    : "bg-amber-50 border-amber-300 text-amber-900"
                }`}
              >
                <div className="flex items-center gap-2 font-bold text-xs">
                  {request.approvalDecision.decision === "APPROVED" ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      <span>Customer Approved Mockup Proof</span>
                    </>
                  ) : (
                    <>
                      <AlertCircle className="h-4 w-4 text-amber-600" />
                      <span>Customer Requested Design Revision</span>
                    </>
                  )}
                  <span className="text-[10px] font-mono opacity-70 ml-auto">
                    {new Date(request.approvalDecision.decidedAt).toLocaleString()}
                  </span>
                </div>
                {request.approvalDecision.comment && (
                  <p className="text-xs mt-2 italic bg-white/60 p-2.5 rounded-xl border border-black/5">
                    &ldquo;{request.approvalDecision.comment}&rdquo;
                  </p>
                )}
              </div>
            )}

            {/* Mockup Version Timeline */}
            {request.mockupHistory && request.mockupHistory.length > 0 && (
              <div className="space-y-3 pt-2">
                <span className="text-xs font-bold text-on-surface block">Shared Mockup History</span>
                <div className="space-y-2">
                  {request.mockupHistory.map((ver, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-3 p-3 rounded-xl border border-outline-variant/30 bg-surface-container-low"
                    >
                      <img src={ver.mockupUrl} alt={`Version ${ver.version}`} className="h-12 w-10 object-contain rounded bg-white border" />
                      <div className="flex-1 text-xs">
                        <p className="font-bold text-on-surface">Proof Version {ver.version}</p>
                        <p className="text-[11px] text-on-surface-variant font-mono">
                          Shared {new Date(ver.uploadedAt).toLocaleString()}
                        </p>
                        {ver.notes && <p className="text-[11px] italic mt-0.5">{ver.notes}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column (5 cols): Official B2B Quote Editor */}
        <div className="lg:col-span-5">
          <div className="bg-surface-container-lowest p-6 rounded-3xl border border-outline-variant/30 shadow-xs space-y-4 sticky top-6">
            <div className="flex items-center justify-between border-b border-outline-variant/20 pb-3">
              <h3 className="text-base font-bold text-on-surface">
                Official B2B Quotation
              </h3>
              {existingQuote && (
                <span className="text-[10px] font-bold font-mono uppercase bg-primary/10 text-primary px-2 py-0.5 rounded">
                  Quote {existingQuote.status}
                </span>
              )}
            </div>

            {/* Backend Suggested Pricing Info */}
            {suggestedQuote && (
              <div className="rounded-2xl border border-primary/20 bg-primary/5 p-3.5 text-xs space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-primary">
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>Authoritative Volume Pricing Applied</span>
                </div>
                <p className="text-on-surface-variant text-[11px]">
                  Source: <strong>{suggestedQuote.ruleSource} rule</strong> · Base ₹{suggestedQuote.baseUnitPriceRupees}/unit ·
                  Discount: <strong>{suggestedQuote.discountPercentage}% off</strong>
                </p>
              </div>
            )}

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-on-surface mb-1">Gross Product Total (₹) *</label>
                <input
                  type="number"
                  min={0}
                  value={productPriceRupees}
                  onChange={(e) => setProductPriceRupees(Number(e.target.value) || 0)}
                  className="w-full bg-surface-container-low border border-outline-variant/40 rounded-xl p-2.5 font-mono font-bold outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="block font-bold text-on-surface mb-1">Printing Fee (₹)</label>
                <input
                  type="number"
                  min={0}
                  value={printingFeeRupees}
                  onChange={(e) => setPrintingFeeRupees(Number(e.target.value) || 0)}
                  className="w-full bg-surface-container-low border border-outline-variant/40 rounded-xl p-2.5 font-mono font-bold outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="block font-bold text-on-surface mb-1">Setup / Screen Fee (₹)</label>
                <input
                  type="number"
                  min={0}
                  value={setupFeeRupees}
                  onChange={(e) => setSetupFeeRupees(Number(e.target.value) || 0)}
                  className="w-full bg-surface-container-low border border-outline-variant/40 rounded-xl p-2.5 font-mono font-bold outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="block font-bold text-on-surface mb-1">Volume / Commercial Discount (₹)</label>
                <input
                  type="number"
                  min={0}
                  value={discountRupees}
                  onChange={(e) => setDiscountRupees(Number(e.target.value) || 0)}
                  className="w-full bg-surface-container-low border border-outline-variant/40 rounded-xl p-2.5 font-mono font-bold text-emerald-700 outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="block font-bold text-on-surface mb-1">Shipping & Logistics (₹)</label>
                <input
                  type="number"
                  min={0}
                  value={shippingRupees}
                  onChange={(e) => setShippingRupees(Number(e.target.value) || 0)}
                  className="w-full bg-surface-container-low border border-outline-variant/40 rounded-xl p-2.5 font-mono font-bold outline-none focus:border-primary"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-on-surface mb-1">Validity (Days)</label>
                  <input
                    type="number"
                    min={1}
                    value={validUntilDays}
                    onChange={(e) => setValidUntilDays(Number(e.target.value) || 7)}
                    className="w-full bg-surface-container-low border border-outline-variant/40 rounded-xl p-2.5 font-mono outline-none focus:border-primary"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-on-surface mb-1">Commercial Notes</label>
                <textarea
                  rows={2}
                  value={quoteNotes}
                  onChange={(e) => setQuoteNotes(e.target.value)}
                  placeholder="Terms, turnaround estimate, ink details..."
                  className="w-full bg-surface-container-low border border-outline-variant/40 rounded-xl p-2.5 text-xs outline-none focus:border-primary"
                />
              </div>
            </div>

            {/* Arithmetic Summary */}
            <div className="border-t border-outline-variant/20 pt-4 space-y-2 text-xs">
              <div className="flex justify-between text-on-surface-variant">
                <span>Subtotal (Net of Discount):</span>
                <span className="font-mono font-bold text-on-surface">₹{subtotal.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-on-surface-variant">
                <span>GST (18% Authoritative Tax):</span>
                <span className="font-mono font-bold text-on-surface">₹{tax.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-on-surface-variant">
                <span>Freight:</span>
                <span className="font-mono font-bold text-on-surface">₹{shippingRupees.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm font-black text-on-surface border-t border-outline-variant/20 pt-2">
                <span>Total Quotation Payable:</span>
                <span className="font-mono text-primary text-base">₹{total.toLocaleString()}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleIssueQuote}
              disabled={isSubmittingQuote || total <= 0}
              className="w-full rounded-2xl bg-primary py-3 text-xs font-black text-on-primary hover:bg-primary/90 transition-colors shadow-md disabled:opacity-50 uppercase tracking-wider"
            >
              {isSubmittingQuote ? "Issuing..." : existingQuote ? "Update & Re-send Quotation" : "Issue Formal B2B Quotation"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
