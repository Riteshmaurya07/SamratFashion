"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

interface ProductOption {
  _id: string;
  name: string;
  images: string[];
}

export default function BulkPrintingClient() {
  const router = useRouter();

  const [products, setProducts] = useState<ProductOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Form State
  const [organizationName, setOrganizationName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [qtyS, setQtyS] = useState(10);
  const [qtyM, setQtyM] = useState(25);
  const [qtyL, setQtyL] = useState(35);
  const [qtyXL, setQtyXL] = useState(20);
  const [qtyXXL, setQtyXXL] = useState(10);
  const [colorAllocation, setColorAllocation] = useState("Black (50), White (50)");
  const [customPrintingRequired, setCustomPrintingRequired] = useState(true);
  const [deliveryLocation, setDeliveryLocation] = useState("");
  const [customerNote, setCustomerNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState<{ text: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    async function fetchProducts() {
      try {
        const res = await api.get("/catalog/products?limit=20");
        if (res.data?.success) {
          const prods = res.data.data.products || res.data.data;
          setProducts(prods);
          if (prods.length > 0) setSelectedProductId(prods[0]._id);
        }
      } catch (err) {
        console.error("Failed to load catalog products", err);
      } finally {
        setIsLoading(false);
      }
    }
    fetchProducts();
  }, []);

  const totalQuantity = (qtyS || 0) + (qtyM || 0) + (qtyL || 0) + (qtyXL || 0) + (qtyXXL || 0);

  const handleSubmitInquiry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organizationName.trim() || !contactName.trim() || !email.trim() || !phone.trim() || !selectedProductId || totalQuantity < 10) return;

    setIsSubmitting(true);
    setToast(null);

    try {
      const res = await api.post("/bulk-orders/request", {
        organizationName: organizationName.trim(),
        contactName: contactName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        productId: selectedProductId,
        variantBreakdown: { S: qtyS, M: qtyM, L: qtyL, XL: qtyXL, XXL: qtyXXL },
        colorAllocation: colorAllocation.trim(),
        customPrintingRequired,
        deliveryLocation: deliveryLocation.trim() || "Delhi NCR",
        customerNote: customerNote.trim() || undefined,
      });

      if (res.data?.success) {
        setToast({ text: `Bulk request #${res.data.data.quoteNumber} submitted successfully!`, type: "success" });
        setTimeout(() => {
          router.push(`/bulk-orders/quote/${res.data.data.quoteNumber}`);
        }, 1500);
      }
    } catch (err: any) {
      if (err.response?.status === 401) {
        router.push("/login?redirect=/bulk-printing");
        return;
      }
      setToast({ text: err.response?.data?.message || "Submission failed.", type: "error" });
    } finally {
      setIsSubmitting(false);
    }
  };

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

      {/* Header Banner */}
      <header className="mb-12 flex flex-col items-start justify-between gap-5 border-b border-outline-variant/10 pb-8 md:flex-row md:items-end">
        <div>
          <h1 className="font-display-lg text-3xl font-extrabold tracking-tight text-on-surface md:text-5xl">
            Corporate & Bulk Printing
          </h1>
          <p className="mt-2 max-w-2xl font-body-md text-on-surface-variant">
            Custom branded apparel for corporate events, college fests, and team merch. Volume discounts & premium DTF printing.
          </p>
        </div>
        <Link
          href="/bulk-orders/request"
          className="inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary px-5 font-label-caps text-label-caps font-bold text-on-primary hover:bg-primary-container"
        >
          Guided request form
          <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
        </Link>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Form (8 cols) */}
        <div className="lg:col-span-8">
          <form onSubmit={handleSubmitInquiry} className="bg-surface-container-lowest p-6 md:p-8 rounded-2xl border border-outline-variant/20 shadow-sm space-y-6">
            <h2 className="font-headline-sm text-xl font-bold text-on-surface border-b border-outline-variant/10 pb-4">
              Request B2B Volume Quotation
            </h2>

            {/* Contact Details */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-label-caps uppercase text-on-surface mb-1">Organization / Company Name</label>
                <input
                  type="text"
                  required
                  value={organizationName}
                  onChange={(e) => setOrganizationName(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-3 text-sm focus:outline-none focus:border-primary"
                  placeholder="e.g. Acme Tech Solutions Ltd."
                />
              </div>

              <div>
                <label className="block text-xs font-label-caps uppercase text-on-surface mb-1">Contact Person Name</label>
                <input
                  type="text"
                  required
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-3 text-sm focus:outline-none focus:border-primary"
                  placeholder="e.g. Ritesh Maurya"
                />
              </div>

              <div>
                <label className="block text-xs font-label-caps uppercase text-on-surface mb-1">Business Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-3 text-sm focus:outline-none focus:border-primary"
                  placeholder="e.g. ritesh@example.com"
                />
              </div>

              <div>
                <label className="block text-xs font-label-caps uppercase text-on-surface mb-1">Phone Number</label>
                <input
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-3 text-sm focus:outline-none focus:border-primary"
                  placeholder="e.g. +91 98765 43210"
                />
              </div>
            </div>

            {/* Product Selection */}
            <div>
              <label className="block text-xs font-label-caps uppercase text-on-surface mb-1">Select Garment / Product</label>
              <select
                value={selectedProductId}
                onChange={(e) => setSelectedProductId(e.target.value)}
                className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-3 text-sm font-bold text-on-surface focus:outline-none focus:border-primary"
              >
                {products.map((p) => (
                  <option key={p._id} value={p._id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Size Breakdown Grid (Stitch Screen Match) */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="block text-xs font-label-caps uppercase text-on-surface">Size Breakdown (Min Total: 10)</label>
                <span className="font-bold text-sm text-primary">Total: {totalQuantity} units</span>
              </div>
              <div className="grid grid-cols-5 gap-3">
                {["S", "M", "L", "XL", "XXL"].map((sz) => {
                  const val = sz === "S" ? qtyS : sz === "M" ? qtyM : sz === "L" ? qtyL : sz === "XL" ? qtyXL : qtyXXL;
                  const setVal = sz === "S" ? setQtyS : sz === "M" ? setQtyM : sz === "L" ? setQtyL : sz === "XL" ? setQtyXL : setQtyXXL;

                  return (
                    <div key={sz} className="flex flex-col items-center bg-surface-container-low p-2 rounded-xl border border-outline-variant/30">
                      <span className="font-label-caps text-xs font-bold text-on-surface-variant mb-1">{sz}</span>
                      <input
                        type="number"
                        min="0"
                        value={val}
                        onChange={(e) => setVal(parseInt(e.target.value) || 0)}
                        className="w-full text-center bg-surface-container-lowest border border-outline-variant rounded-lg p-1.5 text-sm font-bold focus:border-primary"
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Customization Details */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-label-caps uppercase text-on-surface mb-1">Color Allocation</label>
                <input
                  type="text"
                  value={colorAllocation}
                  onChange={(e) => setColorAllocation(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-3 text-sm focus:outline-none focus:border-primary"
                  placeholder="e.g. Black (50), White (50)"
                />
              </div>

              <div>
                <label className="block text-xs font-label-caps uppercase text-on-surface mb-1">Delivery Location</label>
                <input
                  type="text"
                  required
                  value={deliveryLocation}
                  onChange={(e) => setDeliveryLocation(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-3 text-sm focus:outline-none focus:border-primary"
                  placeholder="e.g. Delhi NCR / Bangalore"
                />
              </div>
            </div>

            {/* Customer Notes */}
            <div>
              <label className="block text-xs font-label-caps uppercase text-on-surface mb-1">Additional Requirements / Notes</label>
              <textarea
                value={customerNote}
                onChange={(e) => setCustomerNote(e.target.value)}
                rows={3}
                className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-3 text-sm focus:outline-none focus:border-primary resize-none"
                placeholder="Mention print locations, logo requirements, or deadline date..."
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting || totalQuantity < 10}
              className="w-full py-4 bg-primary text-on-primary font-headline-sm text-sm font-bold rounded-xl hover:bg-primary-container transition-colors shadow-md disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-lg">request_quote</span>
              {isSubmitting ? "Submitting Request..." : "Request Official Quotation"}
            </button>
          </form>
        </div>

        {/* Right Column: Bulk Ordering Specs Card (4 cols) */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-surface-container-lowest p-6 rounded-2xl border border-outline-variant/20 shadow-sm space-y-4">
            <h3 className="font-headline-sm text-lg font-bold text-on-surface">Why SamratFashion Bulk?</h3>
            <ul className="space-y-3 text-xs text-on-surface-variant">
              <li className="flex items-start gap-2">
                <span className="material-symbols-outlined text-primary text-base">verified</span>
                <span><strong>Tiered Volume Pricing:</strong> Save up to 35% on orders of 50+ units.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="material-symbols-outlined text-primary text-base">print</span>
                <span><strong>Ultra-HD DTF Printing:</strong> Vibrant colors with 50+ wash durability.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="material-symbols-outlined text-primary text-base">local_shipping</span>
                <span><strong>Express Delivery:</strong> 5–7 business days production & dispatch.</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
