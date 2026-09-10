/* eslint-disable @next/next/no-img-element */
"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { trackEvent } from "@/lib/analytics";
import { useAuthStore } from "@/store/useAuthStore";

type Variant = {
  _id: string;
  size?: string;
  color?: string;
  hexCode?: string;
  sku: string;
  stock: number;
  isAvailable: boolean;
  images?: string[];
};

type Product = {
  _id: string;
  name: string;
  basePrice: number;
  images: string[];
  variants: Variant[];
};

type Artwork = { url: string; publicId?: string; format?: string };

const MAX_INSTRUCTIONS = 2000;

export default function CustomPrintingRequestClient() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuthStore();
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState("");
  const [locations, setLocations] = useState<Array<"FRONT" | "BACK">>(["FRONT"]);
  const [instructions, setInstructions] = useState("");
  const [artwork, setArtwork] = useState<Artwork | null>(null);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [submittedReference, setSubmittedReference] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    trackEvent("custom_printing_started");
    api.get("/catalog/customizable-products")
      .then(({ data }) => {
        const loaded = (data?.data || []) as Product[];
        setProducts(loaded);
        if (loaded[0]) selectProduct(loaded[0]);
      })
      .catch(() => setMessage({ type: "error", text: "We could not load customizable products. Please try again." }))
      .finally(() => setLoadingProducts(false));
  }, []);

  const availableVariants = useMemo(
    () => selectedProduct?.variants.filter((variant) => variant.isAvailable && variant.stock > 0) || [],
    [selectedProduct]
  );
  const selectedVariant = selectedProduct?.variants.find((variant) => variant._id === selectedVariantId) || null;
  const colors = useMemo(() => {
    const seen = new Set<string>();
    return availableVariants.filter((variant) => {
      const color = variant.color || "Colour available";
      if (seen.has(color)) return false;
      seen.add(color);
      return true;
    });
  }, [availableVariants]);
  const sizes = useMemo(
    () => availableVariants.filter((variant) => variant.color === selectedVariant?.color),
    [availableVariants, selectedVariant?.color]
  );
  const previewImage = selectedVariant?.images?.[0] || selectedProduct?.images?.[0] || "";

  function selectProduct(product: Product) {
    setSelectedProduct(product);
    const firstVariant = product.variants.find((variant) => variant.isAvailable && variant.stock > 0);
    setSelectedVariantId(firstVariant?._id || "");
    trackEvent("custom_product_selected", { product_id: product._id });
  }

  function selectColor(color: string) {
    const variant = availableVariants.find((item) => item.color === color);
    if (variant) setSelectedVariantId(variant._id);
  }

  function selectSize(size: string) {
    const variant = availableVariants.find((item) => item.color === selectedVariant?.color && item.size === size);
    if (variant) setSelectedVariantId(variant._id);
  }

  function toggleLocation(location: "FRONT" | "BACK") {
    setLocations((current) => current.includes(location)
      ? current.filter((item) => item !== location)
      : [...current, location]);
  }

  async function handleArtwork(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setMessage(null);
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("category", "custom-artwork");
      const { data } = await api.post("/upload/image", body, { headers: { "Content-Type": "multipart/form-data" } });
      setArtwork({ url: data.data.url, publicId: data.data.publicId, format: data.data.format });
    } catch (error: unknown) {
      const response = error as { response?: { data?: { message?: string } } };
      setMessage({ type: "error", text: response.response?.data?.message || "Artwork upload failed. You can submit without artwork." });
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) {
      router.push("/login?redirect=/custom-printing");
      return;
    }
    if (!selectedProduct || !selectedVariant || locations.length === 0 || !instructions.trim()) {
      setMessage({ type: "error", text: "Choose a product, variant, print location, and describe what you need." });
      return;
    }
    setSubmitting(true);
    setMessage(null);
    try {
      const key = typeof window !== "undefined" ? crypto.randomUUID() : `${Date.now()}-${selectedVariantId}`;
      const { data } = await api.post("/designs/requests", {
        productId: selectedProduct._id,
        selectedVariantId: selectedVariant._id,
        selectedColor: selectedVariant.color,
        selectedSize: selectedVariant.size,
        printLocations: locations,
        instructions: instructions.trim(),
        artwork: artwork || undefined,
        idempotencyKey: key,
      });
      setSubmittedReference(data.data?._id || "");
      setMessage({ type: "success", text: "Your custom printing request has been submitted." });
      trackEvent("custom_request_submitted", { product_id: selectedProduct._id, has_artwork: Boolean(artwork) });
      setInstructions("");
      setArtwork(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (error: unknown) {
      const response = error as { response?: { data?: { message?: string } } };
      setMessage({ type: "error", text: response.response?.data?.message || "We could not submit your request. Your selections are still here." });
    } finally {
      setSubmitting(false);
    }
  }

  if (submittedReference && message?.type === "success") {
    return (
      <main className="min-h-screen bg-background px-4 py-16 text-on-background md:px-8">
        <div className="mx-auto max-w-2xl rounded-3xl border border-outline-variant/30 bg-surface-container-lowest p-8 text-center shadow-sm md:p-14">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-700" aria-hidden="true">✓</div>
          <p className="mt-6 font-label-caps text-xs uppercase tracking-[0.2em] text-secondary">Request received</p>
          <h1 className="mt-3 font-display-lg text-3xl font-black tracking-tight md:text-5xl">Your custom printing request has been submitted.</h1>
          <p className="mx-auto mt-5 max-w-xl text-on-surface-variant">Select a product and provide your requirements. Our team will review the request and contact you with the next steps.</p>
          <p className="mt-5 font-mono text-xs text-on-surface-variant">Reference: {submittedReference}</p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <button onClick={() => { setSubmittedReference(""); setMessage(null); }} className="rounded-xl bg-primary px-6 py-3 font-bold text-on-primary">Submit another request</button>
            <Link href="/custom-designer" className="rounded-xl border border-outline-variant px-6 py-3 font-bold text-on-surface">Design it yourself</Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background text-on-background">
      <section className="border-b border-outline-variant/20 bg-surface-container-low px-4 py-14 md:px-8 md:py-20">
        <div className="mx-auto max-w-6xl">
          <p className="font-label-caps text-xs uppercase tracking-[0.2em] text-secondary">Custom printing</p>
          <div className="mt-4 flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div className="max-w-3xl"><h1 className="font-display-lg text-4xl font-black tracking-tight md:text-6xl">Bring the idea. We&apos;ll handle the finish.</h1><p className="mt-5 max-w-2xl text-lg leading-relaxed text-on-surface-variant">Choose a real customizable product, tell us where to print, and share your requirements. A finished logo is optional.</p></div>
            <Link href="/custom-designer" className="inline-flex min-h-12 items-center justify-center rounded-xl border border-outline-variant bg-surface-container-lowest px-5 font-bold text-on-surface">Design it yourself <span className="ml-2" aria-hidden="true">→</span></Link>
          </div>
        </div>
      </section>

      <form onSubmit={handleSubmit} className="mx-auto grid max-w-6xl gap-8 px-4 py-10 md:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:py-14">
        <section aria-labelledby="product-heading">
          <div className="flex items-end justify-between gap-4"><div><p className="font-label-caps text-xs uppercase tracking-[0.18em] text-secondary">01 · Choose your product</p><h2 id="product-heading" className="mt-2 font-headline-lg text-2xl font-bold">Start with a garment</h2></div><span className="text-sm text-on-surface-variant">{products.length} available</span></div>
          {loadingProducts ? <div className="mt-6 rounded-2xl bg-surface-container-low p-10 text-center text-on-surface-variant">Loading customizable products…</div> : products.length === 0 ? <div className="mt-6 rounded-2xl border border-dashed border-outline-variant p-10 text-center text-on-surface-variant">No customizable products are available right now.</div> : <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">{products.map((product) => <button type="button" key={product._id} onClick={() => selectProduct(product)} className={`overflow-hidden rounded-2xl border bg-surface-container-lowest text-left transition-shadow hover:shadow-md ${selectedProduct?._id === product._id ? "border-primary ring-2 ring-primary/20" : "border-outline-variant/30"}`} aria-pressed={selectedProduct?._id === product._id}><div className="aspect-[4/5] bg-surface-container">{product.images[0] ? <img src={product.images[0]} alt={product.name} loading="lazy" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-sm text-on-surface-variant">Image unavailable</div>}</div><div className="p-4"><h3 className="line-clamp-2 font-bold text-on-surface">{product.name}</h3><p className="mt-2 text-sm text-on-surface-variant">Starting at ₹{(product.basePrice / 100).toLocaleString("en-IN")}</p></div></button>)}</div>}
        </section>

        <section className="rounded-3xl border border-outline-variant/30 bg-surface-container-lowest p-5 shadow-sm md:p-7" aria-labelledby="request-heading">
          <div className="flex items-start justify-between gap-4"><div><p className="font-label-caps text-xs uppercase tracking-[0.18em] text-secondary">02 · Request details</p><h2 id="request-heading" className="mt-2 font-headline-lg text-2xl font-bold">Make it yours</h2></div>{selectedProduct && <div className="h-20 w-16 overflow-hidden rounded-lg bg-surface-container">{previewImage && <img src={previewImage} alt="Selected product preview" className="h-full w-full object-cover" />}</div>}</div>
          {selectedProduct && <div className="mt-6 space-y-6">
            <fieldset><legend className="mb-3 font-bold">Color</legend><div className="flex flex-wrap gap-2">{colors.map((variant) => <button type="button" key={variant.color} onClick={() => selectColor(variant.color || "")} className={`rounded-full border px-3 py-2 text-sm ${selectedVariant?.color === variant.color ? "border-primary bg-primary text-on-primary" : "border-outline-variant/40 bg-surface-container-low"}`} aria-label={`Color ${variant.color}`} aria-pressed={selectedVariant?.color === variant.color}>{variant.color}</button>)}</div></fieldset>
            <fieldset><legend className="mb-3 font-bold">Size</legend><div className="flex flex-wrap gap-2">{sizes.map((variant) => <button type="button" key={variant._id} onClick={() => selectSize(variant.size || "")} className={`min-w-12 rounded-lg border px-3 py-2 text-sm ${selectedVariantId === variant._id ? "border-primary bg-primary text-on-primary" : "border-outline-variant/40 bg-surface-container-low"}`} aria-label={`Size ${variant.size}`} aria-pressed={selectedVariantId === variant._id}>{variant.size}</button>)}</div></fieldset>
            <fieldset><legend className="mb-3 font-bold">Printing location</legend><div className="grid grid-cols-2 gap-3">{(["FRONT", "BACK"] as const).map((location) => <button type="button" key={location} onClick={() => toggleLocation(location)} className={`rounded-xl border px-4 py-4 text-left font-bold transition-colors ${locations.includes(location) ? "border-primary bg-primary/10 text-primary" : "border-outline-variant/40"}`} aria-label={`${location === "FRONT" ? "Front" : "Back"}, ${locations.includes(location) ? "selected" : "available"}`} aria-pressed={locations.includes(location)}><span className="block text-xs uppercase tracking-wider">{location}</span><span className="mt-1 block text-xs font-normal text-on-surface-variant">{locations.includes(location) ? "Selected" : "Available"}</span></button>)}</div></fieldset>
            <div><label htmlFor="artwork" className="font-bold">Upload your logo or artwork <span className="font-normal text-on-surface-variant">(optional)</span></label><p className="mt-1 text-sm text-on-surface-variant">Have a ready logo or design? Upload it here. PNG, JPG, or WEBP up to 5MB.</p><input ref={fileInputRef} id="artwork" type="file" accept="image/png,image/jpeg,image/webp" onChange={handleArtwork} disabled={uploading || submitting} className="mt-3 block w-full rounded-xl border border-outline-variant/40 bg-surface-container-low p-3 text-sm" />{uploading && <p className="mt-2 text-sm text-secondary" role="status">Uploading artwork…</p>}{artwork && <p className="mt-2 text-sm text-emerald-700" role="status">Artwork uploaded and attached.</p>}</div>
            <div><label htmlFor="instructions" className="font-bold">Additional Instructions / Requirements</label><textarea id="instructions" required maxLength={MAX_INSTRUCTIONS} value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="Tell us what you want printed, preferred style, colors, text, logo ideas, quantity, or anything else our team should know." className="mt-3 min-h-36 w-full resize-y rounded-xl border border-outline-variant/40 bg-surface-container-low p-4 text-sm outline-none focus:border-primary" /> <p className="mt-1 text-right text-xs text-on-surface-variant">{instructions.length}/{MAX_INSTRUCTIONS}</p></div>
            <div className="rounded-2xl border border-secondary/20 bg-secondary/5 p-5"><p className="font-label-caps text-xs font-bold uppercase tracking-[0.16em] text-secondary">Don&apos;t have a logo?</p><p className="mt-2 font-bold">No problem.</p><p className="mt-1 text-sm leading-relaxed text-on-surface-variant">Select the product and describe what you need in the instructions box. Our team will contact you to discuss the design.</p></div>
            <div className="rounded-2xl bg-surface-container-low p-5"><p className="font-label-caps text-xs uppercase tracking-[0.16em] text-on-surface-variant">Your request</p><dl className="mt-3 grid grid-cols-2 gap-y-2 text-sm"><dt className="text-on-surface-variant">Product</dt><dd className="text-right font-bold">{selectedProduct.name}</dd><dt className="text-on-surface-variant">Variant</dt><dd className="text-right font-bold">{selectedVariant?.color} · {selectedVariant?.size}</dd><dt className="text-on-surface-variant">Location</dt><dd className="text-right font-bold">{locations.join(", ")}</dd><dt className="text-on-surface-variant">Artwork</dt><dd className="text-right font-bold">{artwork ? "Uploaded" : "Not uploaded"}</dd></dl></div>
            {message && <div role="alert" className={`rounded-xl p-4 text-sm font-medium ${message.type === "error" ? "bg-error-container text-on-error-container" : "bg-emerald-100 text-emerald-800"}`}>{message.text}</div>}
            <button type="submit" disabled={submitting || uploading || authLoading} className="w-full rounded-xl bg-primary px-5 py-4 font-bold text-on-primary shadow-sm transition-opacity disabled:cursor-not-allowed disabled:opacity-60">{submitting ? "Submitting request…" : !user ? "Log in to submit request" : "Submit Custom Printing Request"}</button>
            <p className="text-center text-xs text-on-surface-variant">Final pricing will be confirmed after review. This request does not reserve inventory or create a payment.</p>
          </div>}
        </section>
      </form>
    </main>
  );
}
