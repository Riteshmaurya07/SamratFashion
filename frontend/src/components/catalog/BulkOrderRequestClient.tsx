"use client";

import { ChangeEvent, FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuthStore } from "@/store/useAuthStore";
import {
  AlertCircle,
  ArrowRight,
  Building2,
  CalendarDays,
  CheckCircle2,
  FileText,
  Mail,
  MapPin,
  Package,
  Phone,
  Printer,
  Trash2,
  UploadCloud,
  User,
} from "lucide-react";
import { api } from "@/lib/api";

interface ProductOption {
  _id: string;
  name: string;
  images?: string[];
  description?: string;
}

interface ArtworkUpload {
  name: string;
  url: string;
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
  | "artwork", string
>>;

const MINIMUM_QUANTITY = 10;
const ACCEPTED_FILE_TYPES = ["image/jpeg", "image/png", "image/webp"];

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
  const [isLoadingProducts, setIsLoadingProducts] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitError, setSubmitError] = useState("");
  const [submittedRequest, setSubmittedRequest] = useState<{ quoteNumber?: string; id?: string } | null>(null);
  const [artworkUploads, setArtworkUploads] = useState<ArtworkUpload[]>([]);

  const [organizationName, setOrganizationName] = useState("");
  const [contactName, setContactName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [selectedProductId, setSelectedProductId] = useState(searchParams?.get("productId") || "");
  const [qtyS, setQtyS] = useState(2);
  const [qtyM, setQtyM] = useState(3);
  const [qtyL, setQtyL] = useState(3);
  const [qtyXL, setQtyXL] = useState(2);
  const [qtyXXL, setQtyXXL] = useState(0);
  const [colorAllocation, setColorAllocation] = useState("");
  const [customPrintingRequired, setCustomPrintingRequired] = useState(true);
  const [printLocations, setPrintLocations] = useState<string[]>(["FRONT"]);
  const [printMethod, setPrintMethod] = useState("DTF Transfer");
  const [requiredByDate, setRequiredByDate] = useState("");
  const [deliveryLocation, setDeliveryLocation] = useState("");
  const [customerNote, setCustomerNote] = useState("");

  useEffect(() => {
    if (user) {
      if (!contactName && user.name) setContactName(user.name);
      if (!email && user.email) setEmail(user.email);
      if (!phone && user.phone) setPhone(user.phone);
    }
  }, [user]);

  useEffect(() => {
    async function fetchProducts() {
      try {
        const response = await api.get("/catalog/products?limit=50");
        const availableProducts = response.data?.data?.products || response.data?.data || [];
        setProducts(availableProducts);
        const requestedProdId = searchParams?.get("productId");
        if (requestedProdId && availableProducts.some((p: ProductOption) => p._id === requestedProdId)) {
          setSelectedProductId(requestedProdId);
        } else if (availableProducts.length > 0 && !selectedProductId) {
          setSelectedProductId(availableProducts[0]._id);
        }
      } catch {
        setSubmitError("We could not load the available garments. Please refresh and try again.");
      } finally {
        setIsLoadingProducts(false);
      }
    }

    fetchProducts();
  }, [searchParams]);

  const totalQuantity = useMemo(
    () => qtyS + qtyM + qtyL + qtyXL + qtyXXL,
    [qtyS, qtyM, qtyL, qtyXL, qtyXXL]
  );

  const selectedProduct = products.find((product) => product._id === selectedProductId);

  const togglePrintLocation = (location: string) => {
    setPrintLocations((current) =>
      current.includes(location) ? current.filter((item) => item !== location) : [...current, location]
    );
  };

  const validate = (): FormErrors => {
    const nextErrors: FormErrors = {};
    if (organizationName.trim().length < 2) nextErrors.organizationName = "Enter your company or organization name.";
    if (contactName.trim().length < 2) nextErrors.contactName = "Enter a contact name.";
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) nextErrors.email = "Enter a valid work email.";
    if (phone.replace(/\D/g, "").length < 8) nextErrors.phone = "Enter a valid phone number.";
    if (!selectedProductId) nextErrors.productId = "Select a garment or product.";
    if (totalQuantity < MINIMUM_QUANTITY) nextErrors.quantity = `Bulk requests start at ${MINIMUM_QUANTITY} units.`;
    if (!requiredByDate) nextErrors.requiredByDate = "Select the date you need the order by.";
    if (requiredByDate && new Date(`${requiredByDate}T00:00:00`) < new Date(new Date().toDateString())) {
      nextErrors.requiredByDate = "The required date must be in the future.";
    }
    if (deliveryLocation.trim().length < 3) nextErrors.deliveryLocation = "Enter the delivery city, address, or location.";
    if (customPrintingRequired && printLocations.length === 0) nextErrors.artwork = "Select at least one print location.";
    return nextErrors;
  };

  const handleArtworkUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (files.length === 0) return;

    const invalidFile = files.find((file) => !ACCEPTED_FILE_TYPES.includes(file.type) || file.size > 5 * 1024 * 1024);
    if (invalidFile) {
      setErrors((current) => ({
        ...current,
        artwork: `${invalidFile.name} must be a JPG, PNG, or WEBP image under 5MB.`,
      }));
      return;
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
        if (!response.data?.success || !url) throw new Error("Upload did not return a file URL.");
        uploaded.push({ name: file.name, url });
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

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors = validate();
    setErrors(nextErrors);
    setSubmitError("");
    if (Object.keys(nextErrors).length > 0) return;

    setIsSubmitting(true);
    try {
      const artworkNote = artworkUploads.length > 0
        ? `Reference artwork: ${artworkUploads.map((file) => `${file.name} (${file.url})`).join(", ")}`
        : "";
      const notes = [customerNote.trim(), artworkNote].filter(Boolean).join("\n\n");
      const response = await api.post("/bulk-orders/request", {
        organizationName: organizationName.trim(),
        contactName: contactName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        productId: selectedProductId,
        variantBreakdown: { S: qtyS, M: qtyM, L: qtyL, XL: qtyXL, XXL: qtyXXL },
        colorAllocation: colorAllocation.trim() || undefined,
        customPrintingRequired,
        printLocations: customPrintingRequired ? printLocations : [],
        printMethod: customPrintingRequired ? printMethod : undefined,
        deliveryLocation: deliveryLocation.trim(),
        requiredByDate,
        customerNote: notes || undefined,
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
      setSubmitError(apiError.message || "We could not submit your request. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (submittedRequest) {
    return (
      <main className="min-h-[70vh] bg-background px-margin-mobile py-16 md:px-margin-desktop md:py-24">
        <div className="mx-auto max-w-2xl rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-8 text-center shadow-sm md:p-12">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
            <CheckCircle2 className="h-9 w-9" aria-hidden="true" />
          </div>
          <h1 className="mt-6 font-display-lg text-display-lg-mobile tracking-tight text-on-surface md:text-3xl">
            Bulk Quote Request Received
          </h1>
          <p className="mx-auto mt-4 max-w-xl font-body-md text-body-md leading-relaxed text-on-surface-variant">
            Your production request has been logged in our system. Our B2B operations team is reviewing your garment specifications, artwork files, and delivery requirements.
          </p>
          {submittedRequest.quoteNumber && (
            <div className="mt-6 inline-block rounded-lg border border-outline-variant/40 bg-surface-container-low px-4 py-2 font-label-caps text-sm text-on-surface">
              Official Reference: <span className="font-bold text-primary">#{submittedRequest.quoteNumber}</span>
            </div>
          )}
          <div className="mt-8 rounded-xl border border-outline-variant/20 bg-surface-container-low p-5 text-left text-xs text-on-surface-variant space-y-2">
            <p className="font-bold text-on-surface font-label-caps uppercase text-[11px]">What happens next?</p>
            <p>1. Our technical team verifies print file resolution and color separation.</p>
            <p>2. A formal B2B quotation including volume product discounts, printing charges, and GST will be issued.</p>
            <p>3. You can review the quote and convert it to an order directly from your customer account.</p>
          </div>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href="/custom-printing" className="inline-flex min-h-12 items-center justify-center rounded-lg border border-outline-variant/50 px-6 font-label-caps text-label-caps text-on-surface hover:border-primary hover:text-primary transition-colors">
              Back to Custom Hub
            </Link>
            <Link href="/account" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-primary px-6 font-label-caps text-label-caps text-on-primary hover:bg-primary/90 transition-colors">
              Track in Account <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background text-on-background">
      <div className="mx-auto max-w-container-max px-margin-mobile py-8 md:px-margin-desktop md:py-14">
        <div className="mb-8 flex items-center justify-between gap-4 border-b border-outline-variant/20 pb-6 md:mb-12">
          <div>
            <h1 className="mt-3 font-display-lg text-display-lg-mobile tracking-tight text-on-surface md:text-display-lg">Request a Bulk Quote.</h1>
            <p className="mt-4 max-w-2xl font-body-md text-body-md leading-relaxed text-on-surface-variant">
              Tell us what you need and our B2B team will prepare a tailored apparel and printing quotation. Bulk requests start at {MINIMUM_QUANTITY} units.
            </p>
          </div>
          <Link href="/bulk-printing" className="hidden items-center gap-2 font-label-caps text-label-caps text-on-surface-variant hover:text-primary md:inline-flex">
            <ArrowRight className="h-4 w-4 rotate-180" aria-hidden="true" /> Back
          </Link>
        </div>

        {(submitError || errors.artwork) && (
          <div className="mb-6 flex items-start gap-3 rounded-lg border border-error/30 bg-error-container px-4 py-3 text-sm text-on-error-container" role="alert">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{submitError || errors.artwork}</span>
          </div>
        )}

        <div className="grid gap-8 lg:grid-cols-12">
          <form onSubmit={handleSubmit} noValidate className="space-y-6 lg:col-span-8">
            <section className="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-6 shadow-sm md:p-8">
              <h2 className="flex items-center gap-2 border-b border-outline-variant/15 pb-4 font-headline-sm text-headline-sm text-on-surface">
                <User className="h-5 w-5 text-primary" aria-hidden="true" /> Tell us about you
              </h2>
              <div className="mt-6 grid gap-5 md:grid-cols-2">
                <Field label="Full Name" icon={<User className="h-4 w-4" />} value={contactName} onChange={setContactName} error={errors.contactName} placeholder="Your full name" required />
                <Field label="Company / Organization" icon={<Building2 className="h-4 w-4" />} value={organizationName} onChange={setOrganizationName} error={errors.organizationName} placeholder="Company or team name" required />
                <Field label="Work Email" icon={<Mail className="h-4 w-4" />} value={email} onChange={setEmail} error={errors.email} placeholder="you@company.com" type="email" required />
                <Field label="Phone Number" icon={<Phone className="h-4 w-4" />} value={phone} onChange={setPhone} error={errors.phone} placeholder="+91 98765 43210" type="tel" required />
              </div>
              <p className="mt-5 font-body-sm text-body-sm text-on-surface-variant">We use your phone number to coordinate proofing and delivery details.</p>
            </section>

            <section className="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-6 shadow-sm md:p-8">
              <h2 className="flex items-center gap-2 border-b border-outline-variant/15 pb-4 font-headline-sm text-headline-sm text-on-surface">
                <Package className="h-5 w-5 text-primary" aria-hidden="true" /> Product and quantity
              </h2>
              <label className="mt-6 block font-label-caps text-label-caps uppercase text-on-surface">Garment / Product</label>
              <select value={selectedProductId} onChange={(event) => setSelectedProductId(event.target.value)} disabled={isLoadingProducts} className="mt-2 w-full rounded-lg border border-outline-variant/40 bg-surface-container-low px-4 py-3 font-body-md text-body-md text-on-surface outline-none focus:border-primary">
                <option value="">{isLoadingProducts ? "Loading garments..." : "Select a garment"}</option>
                {products.map((product) => <option key={product._id} value={product._id}>{product.name}</option>)}
              </select>
              {errors.productId && <p className="mt-2 text-sm text-error">{errors.productId}</p>}
              <div className="mt-6 flex items-center justify-between gap-4">
                <label className="font-label-caps text-label-caps uppercase text-on-surface">Size breakdown</label>
                <span className={`font-label-caps text-label-caps ${errors.quantity ? "text-error" : "text-primary"}`}>{totalQuantity} / {MINIMUM_QUANTITY} units minimum</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
                {(["S", "M", "L", "XL", "XXL"] as const).map((size) => {
                  const values = { S: qtyS, M: qtyM, L: qtyL, XL: qtyXL, XXL: qtyXXL };
                  const setters = { S: setQtyS, M: setQtyM, L: setQtyL, XL: setQtyXL, XXL: setQtyXXL };
                  return <label key={size} className="rounded-lg border border-outline-variant/30 bg-surface-container-low p-3 text-center"><span className="font-label-caps text-label-caps text-on-surface-variant">{size}</span><input type="number" min="0" value={values[size]} onChange={(event) => setters[size](Math.max(0, Number(event.target.value) || 0))} className="mt-2 w-full rounded-md border border-outline-variant/40 bg-surface-container-lowest px-2 py-2 text-center font-body-md text-on-surface outline-none focus:border-primary" /></label>;
                })}
              </div>
              {errors.quantity && <p className="mt-2 text-sm text-error">{errors.quantity}</p>}
              <div className="mt-6 grid gap-5 md:grid-cols-2">
                <Field label="Color Allocation" value={colorAllocation} onChange={setColorAllocation} placeholder="Black 50, White 50" />
                <label><span className="font-label-caps text-label-caps uppercase text-on-surface">Print Method</span><select value={printMethod} onChange={(event) => setPrintMethod(event.target.value)} disabled={!customPrintingRequired} className="mt-2 w-full rounded-lg border border-outline-variant/40 bg-surface-container-low px-4 py-3 font-body-md text-body-md text-on-surface outline-none focus:border-primary"><option>DTF Transfer</option><option>Screen Printing</option><option>Embroidery</option><option>Vinyl</option></select></label>
              </div>
            </section>

            <section className="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-6 shadow-sm md:p-8">
              <h2 className="flex items-center gap-2 border-b border-outline-variant/15 pb-4 font-headline-sm text-headline-sm text-on-surface"><Printer className="h-5 w-5 text-primary" aria-hidden="true" /> Customization and references</h2>
              <label className="mt-6 flex items-start gap-3 rounded-lg border border-outline-variant/30 bg-surface-container-low p-4"><input type="checkbox" checked={customPrintingRequired} onChange={(event) => setCustomPrintingRequired(event.target.checked)} className="mt-1 h-4 w-4 accent-primary" /><span><span className="block font-headline-sm text-on-surface">I need custom printing or decoration</span><span className="mt-1 block font-body-sm text-body-sm text-on-surface-variant">Select the print locations and share artwork or reference files below.</span></span></label>
              <div className="mt-5 flex flex-wrap gap-3">
                {["FRONT", "BACK", "SLEEVE"].map((location) => <button type="button" key={location} onClick={() => togglePrintLocation(location)} disabled={!customPrintingRequired} className={`rounded-full border px-4 py-2 font-label-caps text-label-caps transition-colors ${printLocations.includes(location) && customPrintingRequired ? "border-primary bg-primary text-on-primary" : "border-outline-variant/50 text-on-surface-variant hover:border-primary"}`}>{location}</button>)}
              </div>
              {errors.artwork && <p className="mt-2 text-sm text-error">{errors.artwork}</p>}
              <label className="mt-6 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-outline-variant/40 bg-surface-container-low px-6 py-8 text-center hover:border-primary hover:bg-primary/5"><UploadCloud className="h-8 w-8 text-primary" aria-hidden="true" /><span className="mt-3 font-headline-sm text-on-surface">Upload artwork or reference images</span><span className="mt-1 font-body-sm text-body-sm text-on-surface-variant">JPG, PNG, or WEBP · 5MB max per file</span><input type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={handleArtworkUpload} disabled={isUploading} className="sr-only" /></label>
              {isUploading && <p className="mt-3 font-label-caps text-label-caps text-primary">Uploading artwork...</p>}
              {artworkUploads.length > 0 && <ul className="mt-4 space-y-2">{artworkUploads.map((file) => <li key={file.url} className="flex items-center justify-between gap-3 rounded-lg bg-surface-container-low px-3 py-2 text-sm"><span className="flex min-w-0 items-center gap-2 text-on-surface"><FileText className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" /><span className="truncate">{file.name}</span></span><button type="button" onClick={() => setArtworkUploads((current) => current.filter((item) => item.url !== file.url))} className="text-on-surface-variant hover:text-error" aria-label={`Remove ${file.name}`}><Trash2 className="h-4 w-4" aria-hidden="true" /></button></li>)}</ul>}
              <label className="mt-6 block font-label-caps text-label-caps uppercase text-on-surface">Additional requirements<textarea value={customerNote} onChange={(event) => setCustomerNote(event.target.value)} maxLength={1000} rows={4} className="mt-2 w-full resize-none rounded-lg border border-outline-variant/40 bg-surface-container-low px-4 py-3 font-body-md text-body-md text-on-surface outline-none focus:border-primary" placeholder="Mention logo placement, packaging, fit, or proofing requirements." /></label>
            </section>

            <section className="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-6 shadow-sm md:p-8">
              <h2 className="flex items-center gap-2 border-b border-outline-variant/15 pb-4 font-headline-sm text-headline-sm text-on-surface"><CalendarDays className="h-5 w-5 text-primary" aria-hidden="true" /> Delivery details</h2>
              <div className="mt-6 grid gap-5 md:grid-cols-2">
                <label><span className="font-label-caps text-label-caps uppercase text-on-surface">Required by</span><input type="date" value={requiredByDate} onChange={(event) => setRequiredByDate(event.target.value)} min={new Date().toISOString().slice(0, 10)} className="mt-2 w-full rounded-lg border border-outline-variant/40 bg-surface-container-low px-4 py-3 font-body-md text-body-md text-on-surface outline-none focus:border-primary" />{errors.requiredByDate && <span className="mt-2 block text-sm text-error">{errors.requiredByDate}</span>}</label>
                <label><span className="font-label-caps text-label-caps uppercase text-on-surface">Delivery location</span><span className="relative mt-2 block"><MapPin className="absolute left-3 top-3.5 h-4 w-4 text-on-surface-variant" aria-hidden="true" /><input value={deliveryLocation} onChange={(event) => setDeliveryLocation(event.target.value)} className="w-full rounded-lg border border-outline-variant/40 bg-surface-container-low py-3 pl-10 pr-4 font-body-md text-body-md text-on-surface outline-none focus:border-primary" placeholder="City, postcode, or full address" /> </span>{errors.deliveryLocation && <span className="mt-2 block text-sm text-error">{errors.deliveryLocation}</span>}</label>
              </div>
            </section>

            <button type="submit" disabled={isSubmitting || isUploading || isLoadingProducts} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-lg bg-primary px-6 font-headline-sm text-on-primary shadow-sm transition-colors hover:bg-primary-container disabled:cursor-not-allowed disabled:opacity-60">{isSubmitting ? "Submitting request..." : "Continue →"}</button>
          </form>

          <aside className="lg:col-span-4">
            <div className="space-y-5 lg:sticky lg:top-24">
              <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-lowest p-6 shadow-sm md:p-8">
                <h2 className="border-b border-outline-variant/15 pb-4 font-headline-sm text-headline-sm text-on-surface">Your Request</h2>
                <div className="mt-6 space-y-4 font-body-sm text-body-sm text-on-surface-variant">
                  <SummaryRow icon={<Package className="h-4 w-4" />} label="Garment" value={selectedProduct?.name || "Select a garment"} />
                  <SummaryRow icon={<Package className="h-4 w-4" />} label="Quantity" value={`${totalQuantity} units`} />
                  <SummaryRow icon={<Printer className="h-4 w-4" />} label="Decoration" value={customPrintingRequired ? `${printMethod} · ${printLocations.join(", ") || "Choose location"}` : "No printing"} />
                  <SummaryRow icon={<CalendarDays className="h-4 w-4" />} label="Required by" value={requiredByDate || "Select a date"} />
                  <SummaryRow icon={<MapPin className="h-4 w-4" />} label="Delivery" value={deliveryLocation || "Add a location"} />
                </div>
                <div className="mt-7 border-t border-outline-variant/20 pt-5"><div className="flex items-center justify-between"><span className="font-label-caps text-label-caps uppercase text-on-surface-variant">Estimated total</span><span className="font-headline-sm text-headline-sm text-primary">Quotation</span></div><p className="mt-2 font-body-sm text-body-sm text-on-surface-variant">Our team will confirm pricing after reviewing your requirements.</p></div>
              </div>
              <div className="rounded-2xl bg-surface-container-low p-6"><p className="font-label-caps text-label-caps uppercase tracking-[0.12em] text-secondary">Need help?</p><p className="mt-3 font-body-sm text-body-sm leading-relaxed text-on-surface-variant">Share as much detail as possible. A specialist will follow up with proofs, pricing, and production timing.</p></div>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}

function Field({ label, icon, value, onChange, error, placeholder, type = "text", required = false }: { label: string; icon?: ReactNode; value: string; onChange: (value: string) => void; error?: string; placeholder: string; type?: string; required?: boolean }) {
  return <label className="block"><span className="flex items-center gap-2 font-label-caps text-label-caps uppercase text-on-surface">{icon}{label}</span><input required={required} type={type} value={value} onChange={(event) => onChange(event.target.value)} className={`mt-2 w-full rounded-lg border bg-surface-container-low px-4 py-3 font-body-md text-body-md text-on-surface outline-none focus:border-primary ${error ? "border-error" : "border-outline-variant/40"}`} placeholder={placeholder} />{error && <span className="mt-2 block text-sm text-error">{error}</span>}</label>;
}

function SummaryRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <div className="flex items-start gap-3"><span className="mt-0.5 text-primary">{icon}</span><div className="min-w-0"><p className="font-label-caps text-label-caps uppercase text-on-surface-variant">{label}</p><p className="mt-1 break-words font-body-sm text-body-sm font-medium text-on-surface">{value}</p></div></div>;
}
