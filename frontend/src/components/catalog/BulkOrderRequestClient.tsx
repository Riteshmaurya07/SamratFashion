"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuthStore } from "@/store/useAuthStore";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  MapPin,
  Package,
  Printer,
  Sparkles,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { api } from "@/lib/api";

interface ProductVariant {
  _id?: string;
  size?: string;
  color?: string;
  sku?: string;
  stock?: number;
  isAvailable?: boolean;
}

interface ProductOption {
  _id: string;
  name: string;
  images?: string[];
  description?: string;
  basePrice?: number;
  variants?: ProductVariant[];
}

interface ArtworkUpload {
  name: string;
  url: string;
  publicId?: string;
  fileType?: string;
  sizeBytes?: number;
}

interface PricingTier {
  minQuantity: number;
  maxQuantity?: number;
  discountPercentage?: number;
  unitPrice?: number;
}

type FormErrors = Partial<Record<
  | "organizationName"
  | "contactName"
  | "email"
  | "phone"
  | "productId"
  | "quantity"
  | "requiredByDate"
  | "deliveryLocation"
  | "artwork",
  string
>>;

const ACCEPTED_FILE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/svg+xml", "application/pdf"];

function getApiError(error: unknown) {
  if (typeof error !== "object" || error === null) return {};
  const response = "response" in error && typeof error.response === "object" && error.response !== null ? error.response : null;
  if (!response) return {};
  const status = "status" in response && typeof response.status === "number" ? response.status : undefined;
  const data = "data" in response && typeof response.data === "object" && response.data !== null ? response.data : null;
  const message = data && "message" in data && typeof data.message === "string" ? data.message : undefined;
  return { status, message };
}

export default function BulkOrderRequestClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuthStore();

  const [products, setProducts] = useState<ProductOption[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitError, setSubmitError] = useState("");
  const [submittedRequest, setSubmittedRequest] = useState<{ quoteNumber?: string; id?: string } | null>(null);

  // Dynamic MOQ & Volume Tiers
  const [dynamicMOQ, setDynamicMOQ] = useState(10);
  const [pricingTiers, setPricingTiers] = useState<PricingTier[]>([]);

  // Form Fields
  const [organizationName, setOrganizationName] = useState("");
  const [contactName, setContactName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [selectedProductId, setSelectedProductId] = useState(searchParams?.get("productId") || "");
  const catalogItemId = searchParams?.get("catalogItemId") || "";

  // Flexible size/quantity mapping
  const [sizeQuantities, setSizeQuantities] = useState<Record<string, number>>({
    S: 2,
    M: 3,
    L: 3,
    XL: 2,
  });

  const [colorAllocation, setColorAllocation] = useState("");
  const [customPrintingRequired, setCustomPrintingRequired] = useState(true);
  const [printLocations, setPrintLocations] = useState<string[]>(["FRONT"]);
  const [printMethod, setPrintMethod] = useState("DTF Transfer");
  const [printText, setPrintText] = useState("");
  const [preferredColors, setPreferredColors] = useState("");
  const [needsDesignAssistance, setNeedsDesignAssistance] = useState(false);
  const [artworkUploads, setArtworkUploads] = useState<ArtworkUpload[]>([]);
  const [requiredByDate, setRequiredByDate] = useState("");
  const [deliveryLocation, setDeliveryLocation] = useState("");
  const [city, setCity] = useState("");
  const [stateName, setStateName] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [customerNote, setCustomerNote] = useState("");

  useEffect(() => {
    if (user) {
      setContactName((prev) => prev || user.name || "");
      setEmail((prev) => prev || user.email || "");
      setPhone((prev) => prev || user.phone || "");
    }
  }, [user]);

  // Load products list
  useEffect(() => {
    async function fetchProducts() {
      try {
        const response = await api.get("/catalog/products?limit=50");
        const availableProducts = response.data?.data?.products || response.data?.data || [];
        setProducts(availableProducts);
        const requestedProdId = searchParams?.get("productId");
        setSelectedProductId((prev) => (requestedProdId && availableProducts.some((p: ProductOption) => p._id === requestedProdId) ? requestedProdId : prev || availableProducts[0]?._id || ""));
      } catch {
        setSubmitError("We could not load the available garments. Please refresh and try again.");
      }
    }

    fetchProducts();
  }, [searchParams]);

  // Fetch dynamic MOQ and Volume rules whenever selected product changes
  useEffect(() => {
    if (!selectedProductId) return;

    async function fetchRules() {
      try {
        const res = await api.get("/pricing/volume-rules", {
          params: {
            productId: selectedProductId,
            catalogItemId: catalogItemId || undefined,
          },
        });
        if (res.data?.success && res.data.data) {
          const rule = res.data.data;
          setDynamicMOQ(rule.minOrderQuantity || 10);
          setPricingTiers(rule.tiers || []);
        }
      } catch {
        setDynamicMOQ(10);
      }
    }

    fetchRules();

    // Adjust size options based on product's actual variants if available
    const prod = products.find((p) => p._id === selectedProductId);
    if (prod && Array.isArray(prod.variants) && prod.variants.length > 0) {
      const distinctSizes = Array.from(new Set(prod.variants.map((v) => v.size || "Free").filter(Boolean)));
      if (distinctSizes.length > 0) {
        const initialMap: Record<string, number> = {};
        distinctSizes.forEach((sz, idx) => {
          initialMap[sz] = idx < 2 ? 5 : 0;
        });
        setSizeQuantities(initialMap);
      }
    }
  }, [selectedProductId, catalogItemId, products]);

  const totalQuantity = useMemo(() => {
    return Object.values(sizeQuantities).reduce((acc, curr) => acc + (Number(curr) || 0), 0);
  }, [sizeQuantities]);

  const selectedProduct = products.find((product) => product._id === selectedProductId);

  const togglePrintLocation = (location: string) => {
    setPrintLocations((current) =>
      current.includes(location) ? current.filter((item) => item !== location) : [...current, location]
    );
  };

  const handleSizeQtyChange = (size: string, val: string) => {
    const q = Math.max(0, parseInt(val, 10) || 0);
    setSizeQuantities((prev) => ({ ...prev, [size]: q }));
  };

  const validate = (): FormErrors => {
    const nextErrors: FormErrors = {};
    if (organizationName.trim().length < 2) nextErrors.organizationName = "Enter your company or organization name.";
    if (contactName.trim().length < 2) nextErrors.contactName = "Enter a contact name.";
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) nextErrors.email = "Enter a valid work email.";
    if (phone.replace(/\D/g, "").length < 8) nextErrors.phone = "Enter a valid phone number.";
    if (!selectedProductId) nextErrors.productId = "Select a garment or product.";
    if (totalQuantity < dynamicMOQ) {
      nextErrors.quantity = `Minimum order quantity for this garment is ${dynamicMOQ} units. Total currently: ${totalQuantity}.`;
    }
    if (!requiredByDate) nextErrors.requiredByDate = "Select the date you need the order by.";
    if (requiredByDate && new Date(`${requiredByDate}T00:00:00`) < new Date(new Date().toDateString())) {
      nextErrors.requiredByDate = "The required date must be in the future.";
    }
    if (deliveryLocation.trim().length < 3) nextErrors.deliveryLocation = "Enter the delivery address or location.";
    if (customPrintingRequired && printLocations.length === 0) nextErrors.artwork = "Select at least one print location.";
    return nextErrors;
  };

  const handleArtworkUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    if (files.length === 0) return;

    for (const file of files) {
      if (!ACCEPTED_FILE_TYPES.includes(file.type.toLowerCase())) {
        setErrors((current) => ({
          ...current,
          artwork: "Please upload PNG, JPG, WEBP, SVG, or PDF files.",
        }));
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        setErrors((current) => ({
          ...current,
          artwork: "File size exceeds the 10MB limit.",
        }));
        return;
      }
    }

    setIsUploading(true);
    setErrors((current) => ({ ...current, artwork: undefined }));

    try {
      const uploaded: ArtworkUpload[] = [];
      for (const file of files) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("category", "custom-artwork");
        const response = await api.post("/upload/image", formData, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        const url = response.data?.data?.url;
        const publicId = response.data?.data?.publicId;
        if (!response.data?.success || !url) throw new Error("Upload did not return a file URL.");
        uploaded.push({
          name: file.name,
          url,
          publicId,
          fileType: file.type,
          sizeBytes: file.size,
        });
      }
      setArtworkUploads((current) => [...current, ...uploaded]);
    } catch (error: unknown) {
      const apiError = getApiError(error);
      if (apiError.status === 401) {
        router.push("/login?redirect=/bulk-orders/request");
        return;
      }
      setErrors((current) => ({ ...current, artwork: apiError.message || "Artwork upload failed. Please try again." }));
    } finally {
      setIsUploading(false);
    }
  };

  const removeArtwork = (index: number) => {
    setArtworkUploads((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors = validate();
    setErrors(nextErrors);
    setSubmitError("");
    if (Object.keys(nextErrors).length > 0) return;

    setIsSubmitting(true);
    try {
      // Build structured variant allocations
      const allocations = Object.entries(sizeQuantities)
        .filter(([_, q]) => q > 0)
        .map(([size, quantity]) => {
          const matched = selectedProduct?.variants?.find((v) => v.size === size);
          return {
            variantId: matched?._id,
            size,
            color: colorAllocation || matched?.color || "Standard",
            quantity,
            sku: matched?.sku,
          };
        });

      const response = await api.post("/bulk-orders/request", {
        organizationName: organizationName.trim(),
        contactName: contactName.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        productId: selectedProductId,
        catalogItemId: catalogItemId || undefined,
        variantAllocations: allocations,
        variantBreakdown: sizeQuantities,
        colorAllocation: colorAllocation.trim() || undefined,
        customPrintingRequired,
        printLocations: customPrintingRequired ? printLocations : [],
        printMethod: customPrintingRequired ? printMethod : undefined,
        printText: printText.trim() || undefined,
        preferredColors: preferredColors.trim()
          ? preferredColors.split(",").map((c) => c.trim()).filter(Boolean)
          : undefined,
        needsDesignAssistance,
        artworkFiles: artworkUploads.map((art) => ({
          url: art.url,
          publicId: art.publicId,
          originalFilename: art.name,
          fileType: art.fileType,
          sizeBytes: art.sizeBytes,
        })),
        deliveryLocation: deliveryLocation.trim(),
        city: city.trim() || undefined,
        state: stateName.trim() || undefined,
        postalCode: postalCode.trim() || undefined,
        requiredByDate,
        customerNote: customerNote.trim() || undefined,
      });

      if (!response.data?.success) throw new Error("The request could not be submitted.");
      setSubmittedRequest({
        quoteNumber: response.data.data?.quoteNumber,
        id: response.data.data?._id,
      });
    } catch (error: unknown) {
      const apiError = getApiError(error);
      if (apiError.status === 401) {
        router.push("/login?redirect=/bulk-orders/request");
        return;
      }
      setSubmitError(apiError.message || "We could not submit your request. Please check required fields.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (submittedRequest) {
    return (
      <main className="min-h-[70vh] bg-background px-4 py-16 md:px-8 md:py-24 max-w-3xl mx-auto">
        <div className="rounded-3xl border border-outline-variant/30 bg-surface-container-lowest p-8 md:p-12 text-center shadow-lg space-y-6">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
            <CheckCircle2 className="h-8 w-8" />
          </div>
          <div>
            <span className="text-xs font-bold text-primary font-mono uppercase bg-primary/10 px-3 py-1 rounded-full">
              Inquiry Ref #{submittedRequest.quoteNumber}
            </span>
            <h1 className="text-3xl font-black text-on-surface mt-3">Bulk Inquiry Submitted</h1>
            <p className="text-xs text-on-surface-variant max-w-md mx-auto mt-2 leading-relaxed">
              Our production and design team is reviewing your size allocations, printable requirements, and reference files. We will prepare your digital mockup proof and formal quotation.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row justify-center gap-3 pt-4">
            <Link
              href="/account/bulk-orders"
              className="rounded-xl bg-primary px-6 py-3 text-xs font-bold text-on-primary hover:bg-primary/90 transition-colors shadow-sm"
            >
              View Inquiries & Mockups
            </Link>
            <Link
              href="/custom-printing"
              className="rounded-xl border border-outline-variant px-6 py-3 text-xs font-bold text-on-surface hover:bg-surface-container transition-colors"
            >
              Back to Catalog
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background text-on-background px-4 py-10 md:px-8 max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div className="border-b border-outline-variant/20 pb-6">
        <span className="text-xs font-bold text-primary uppercase font-mono tracking-widest">
          B2B VOLUME PRODUCTION
        </span>
        <h1 className="text-3xl md:text-4xl font-black text-on-surface mt-1">
          Custom Bulk Printing & Corporate Inquiry
        </h1>
        <p className="text-xs text-on-surface-variant max-w-2xl mt-1 leading-relaxed">
          Order custom apparel for your team, company, or brand run. Minimum order quantity starts at{" "}
          <strong>{dynamicMOQ} units</strong> with volume pricing and digital proof approval before production.
        </p>
      </div>

      {submitError && (
        <div className="rounded-2xl border border-error/30 bg-error-container p-4 text-xs font-bold text-on-error-container">
          {submitError}
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-8 text-sm" noValidate>
        {/* Step 1: Organization & Contact */}
        <div className="bg-surface-container-lowest p-6 md:p-8 rounded-3xl border border-outline-variant/30 shadow-xs space-y-5">
          <h2 className="text-lg font-black text-on-surface flex items-center gap-2 border-b border-outline-variant/20 pb-3">
            <Building2 className="h-5 w-5 text-primary" />
            <span>1. Organization & Contact Information</span>
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block font-bold mb-1 text-on-surface">Company / Organization Name *</label>
              <input
                type="text"
                required
                value={organizationName}
                onChange={(e) => setOrganizationName(e.target.value)}
                placeholder="E.g. Acme Studio / St. Xavier Football Club"
                className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-low p-3 outline-none focus:border-primary text-xs"
              />
              {errors.organizationName && <p className="text-[11px] text-error mt-1">{errors.organizationName}</p>}
            </div>

            <div>
              <label className="block font-bold mb-1 text-on-surface">Contact Person *</label>
              <input
                type="text"
                required
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="Full name"
                className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-low p-3 outline-none focus:border-primary text-xs"
              />
              {errors.contactName && <p className="text-[11px] text-error mt-1">{errors.contactName}</p>}
            </div>

            <div>
              <label className="block font-bold mb-1 text-on-surface">Official Work Email *</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-low p-3 outline-none focus:border-primary text-xs"
              />
              {errors.email && <p className="text-[11px] text-error mt-1">{errors.email}</p>}
            </div>

            <div>
              <label className="block font-bold mb-1 text-on-surface">Contact Phone Number *</label>
              <input
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91 98765 43210"
                className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-low p-3 outline-none focus:border-primary text-xs font-mono"
              />
              {errors.phone && <p className="text-[11px] text-error mt-1">{errors.phone}</p>}
            </div>
          </div>
        </div>

        {/* Step 2: Garment & Size Quantities */}
        <div className="bg-surface-container-lowest p-6 md:p-8 rounded-3xl border border-outline-variant/30 shadow-xs space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-outline-variant/20 pb-3">
            <h2 className="text-lg font-black text-on-surface flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" />
              <span>2. Apparel Silhouette & Quantity Distribution</span>
            </h2>
            <div className="text-xs font-bold text-primary font-mono">
              MOQ: {dynamicMOQ} Units · Selected: {totalQuantity} Units
            </div>
          </div>

          <div>
            <label className="block font-bold mb-1 text-on-surface">Select Garment Blank *</label>
            <select
              value={selectedProductId}
              onChange={(e) => setSelectedProductId(e.target.value)}
              className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-low p-3 outline-none focus:border-primary text-xs"
            >
              {products.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.name} {p.basePrice ? `(Base: ₹${p.basePrice})` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Volume Pricing Tiers Banner */}
          {pricingTiers.length > 0 && (
            <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 text-xs space-y-2">
              <div className="flex items-center gap-1.5 font-bold text-primary">
                <Sparkles className="h-4 w-4" />
                <span>Volume Discount Schedule</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {pricingTiers.map((t, idx) => (
                  <div key={idx} className="bg-white/80 p-2 rounded-lg border border-primary/10 text-center font-mono">
                    <p className="font-bold text-on-surface">
                      {t.minQuantity}–{t.maxQuantity ? `${t.maxQuantity}` : "+"} units
                    </p>
                    <p className="text-[11px] text-primary font-bold">
                      {t.unitPrice ? `₹${t.unitPrice}/ea` : `${t.discountPercentage}% OFF`}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Size Quantity Matrix */}
          <div>
            <label className="block font-bold mb-2 text-on-surface">Quantity by Size *</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">
              {Object.entries(sizeQuantities).map(([sz, qty]) => (
                <div key={sz} className="rounded-xl border border-outline-variant/40 bg-surface-container-low p-3 text-center">
                  <span className="block font-bold text-xs text-on-surface mb-1">{sz}</span>
                  <input
                    type="number"
                    min={0}
                    value={qty}
                    onChange={(e) => handleSizeQtyChange(sz, e.target.value)}
                    className="w-full rounded-lg border border-outline-variant/40 bg-surface-container-lowest p-2 text-center font-mono font-bold text-xs outline-none focus:border-primary"
                  />
                </div>
              ))}
            </div>
            {errors.quantity && <p className="text-[11px] text-error mt-2 font-bold">{errors.quantity}</p>}
          </div>

          <div>
            <label className="block font-bold mb-1 text-on-surface">Color Preferences</label>
            <input
              type="text"
              value={colorAllocation}
              onChange={(e) => setColorAllocation(e.target.value)}
              placeholder="E.g. Ink Black, Off-White, Navy Blue..."
              className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-low p-3 outline-none focus:border-primary text-xs"
            />
          </div>
        </div>

        {/* Step 3: Printing Specifications & Artwork */}
        <div className="bg-surface-container-lowest p-6 md:p-8 rounded-3xl border border-outline-variant/30 shadow-xs space-y-5">
          <h2 className="text-lg font-black text-on-surface flex items-center gap-2 border-b border-outline-variant/20 pb-3">
            <Printer className="h-5 w-5 text-primary" />
            <span>3. Printing Requirements & Artwork Files</span>
          </h2>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="customPrintReq"
              checked={customPrintingRequired}
              onChange={(e) => setCustomPrintingRequired(e.target.checked)}
              className="h-4 w-4 rounded accent-primary"
            />
            <label htmlFor="customPrintReq" className="font-bold text-xs cursor-pointer select-none">
              Logo or Artwork Printing Required on this Run
            </label>
          </div>

          {customPrintingRequired && (
            <div className="space-y-4 pt-2">
              <div>
                <label className="block font-bold mb-2 text-on-surface">Print Placements *</label>
                <div className="flex flex-wrap gap-2">
                  {["FRONT", "BACK", "LEFT_SLEEVE", "RIGHT_SLEEVE"].map((loc) => {
                    const isSelected = printLocations.includes(loc);
                    return (
                      <button
                        type="button"
                        key={loc}
                        onClick={() => togglePrintLocation(loc)}
                        className={`rounded-xl border px-4 py-2 text-xs font-bold transition-colors ${
                          isSelected
                            ? "bg-primary text-white border-primary"
                            : "bg-surface-container-low border-outline-variant/40 text-on-surface hover:border-outline-variant"
                        }`}
                      >
                        {loc.replace("_", " ")}
                      </button>
                    );
                  })}
                </div>
                {errors.artwork && <p className="text-[11px] text-error mt-1">{errors.artwork}</p>}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block font-bold mb-1 text-on-surface">Text to be Printed (Optional)</label>
                  <input
                    type="text"
                    value={printText}
                    onChange={(e) => setPrintText(e.target.value)}
                    placeholder="Slogan, team name, hashtag..."
                    className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-low p-3 outline-none focus:border-primary text-xs"
                  />
                </div>

                <div>
                  <label className="block font-bold mb-1 text-on-surface">Preferred Print Inks / Colors</label>
                  <input
                    type="text"
                    value={preferredColors}
                    onChange={(e) => setPreferredColors(e.target.value)}
                    placeholder="E.g. Pure White, Pantone 186 C..."
                    className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-low p-3 outline-none focus:border-primary text-xs"
                  />
                </div>
              </div>

              {/* Artwork Upload Area */}
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <label className="block font-bold text-on-surface">Upload Artwork Files (PNG, JPG, SVG, PDF)</label>
                  <label className="flex items-center gap-1.5 text-xs font-bold cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={needsDesignAssistance}
                      onChange={(e) => setNeedsDesignAssistance(e.target.checked)}
                      className="h-3.5 w-3.5 rounded accent-primary"
                    />
                    <span>Need Help Creating / Redrawing Artwork</span>
                  </label>
                </div>

                <div className="rounded-2xl border-2 border-dashed border-outline-variant/50 p-6 text-center bg-surface-container-low space-y-2">
                  <UploadCloud className="h-8 w-8 text-on-surface-variant mx-auto" />
                  <p className="text-xs font-bold text-on-surface">Drag & drop logo or artwork files, or browse</p>
                  <p className="text-[11px] text-on-surface-variant">Vector SVG or 300+ DPI PNG recommended (max 10MB)</p>
                  <label className="inline-flex cursor-pointer rounded-xl bg-surface-container-lowest border border-outline-variant px-4 py-2 text-xs font-bold text-on-surface hover:bg-surface-container transition-colors shadow-xs">
                    <span>{isUploading ? "Uploading File..." : "Choose File"}</span>
                    <input
                      type="file"
                      multiple
                      accept="image/png,image/jpeg,image/webp,image/svg+xml,application/pdf"
                      onChange={handleArtworkUpload}
                      disabled={isUploading}
                      className="hidden"
                    />
                  </label>
                </div>

                {artworkUploads.length > 0 && (
                  <div className="space-y-2">
                    <span className="text-[11px] font-bold text-on-surface-variant uppercase">
                      Attached Reference Files ({artworkUploads.length})
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {artworkUploads.map((art, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between p-2.5 rounded-xl border border-outline-variant/30 bg-surface-container-low text-xs"
                        >
                          <span className="truncate font-medium">{art.name}</span>
                          <button
                            type="button"
                            onClick={() => removeArtwork(idx)}
                            className="text-error p-1 hover:bg-error/10 rounded"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Step 4: Logistics & Notes */}
        <div className="bg-surface-container-lowest p-6 md:p-8 rounded-3xl border border-outline-variant/30 shadow-xs space-y-5">
          <h2 className="text-lg font-black text-on-surface flex items-center gap-2 border-b border-outline-variant/20 pb-3">
            <MapPin className="h-5 w-5 text-primary" />
            <span>4. Delivery Location & Target Date</span>
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block font-bold mb-1 text-on-surface">Delivery Address / Location *</label>
              <input
                type="text"
                required
                value={deliveryLocation}
                onChange={(e) => setDeliveryLocation(e.target.value)}
                placeholder="Street address, business park, or landmark"
                className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-low p-3 outline-none focus:border-primary text-xs"
              />
              {errors.deliveryLocation && <p className="text-[11px] text-error mt-1">{errors.deliveryLocation}</p>}
            </div>

            <div>
              <label className="block font-bold mb-1 text-on-surface">City</label>
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="City"
                className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-low p-3 outline-none focus:border-primary text-xs"
              />
            </div>
            <div>
              <label className="block font-bold mb-1 text-on-surface">State</label>
              <input
                type="text"
                value={stateName}
                onChange={(e) => setStateName(e.target.value)}
                placeholder="State / Province"
                className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-low p-3 outline-none focus:border-primary text-xs"
              />
            </div>

            <div>
              <label className="block font-bold mb-1 text-on-surface">Postal Code</label>
              <input
                type="text"
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
                placeholder="PIN code"
                className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-low p-3 outline-none focus:border-primary text-xs font-mono"
              />
            </div>

            <div>
              <label className="block font-bold mb-1 text-on-surface">Print Technique</label>
              <select
                value={printMethod}
                onChange={(e) => setPrintMethod(e.target.value)}
                className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-low p-3 outline-none focus:border-primary text-xs"
              >
                <option value="DTF Transfer">DTF Transfer (Direct-to-Film)</option>
                <option value="Screen Print">Screen Print (High Volume)</option>
                <option value="Embroidery">Embroidery</option>
              </select>
            </div>

            <div>
              <label className="block font-bold mb-1 text-on-surface">Required Delivery Date *</label>
              <input
                type="date"
                required
                value={requiredByDate}
                onChange={(e) => setRequiredByDate(e.target.value)}
                className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-low p-3 outline-none focus:border-primary text-xs font-mono"
              />
              {errors.requiredByDate && <p className="text-[11px] text-error mt-1">{errors.requiredByDate}</p>}
            </div>
          </div>

          <div>
            <label className="block font-bold mb-1 text-on-surface">Additional Instructions or Special Notes</label>
            <textarea
              rows={3}
              value={customerNote}
              onChange={(e) => setCustomerNote(e.target.value)}
              placeholder="Specific brand guidelines, neck label printing, individual packaging requirements..."
              className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-low p-3 outline-none focus:border-primary text-xs"
            />
          </div>
        </div>

        {/* Submit Action */}
        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-8 py-4 text-xs font-black text-on-primary hover:bg-primary/90 transition-colors shadow-lg disabled:opacity-50 uppercase tracking-widest"
          >
            <span>{isSubmitting ? "Submitting Inquiry..." : "Submit Bulk Printing Inquiry"}</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </form>
    </main>
  );
}
