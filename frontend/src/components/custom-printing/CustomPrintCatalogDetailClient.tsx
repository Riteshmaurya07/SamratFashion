/* eslint-disable @next/next/no-img-element */
"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { trackEvent } from "@/lib/analytics";
import { useAuthStore } from "@/store/useAuthStore";

type PreviewConfig = { x: number; y: number; width: number; height: number };
type PlacementTemplate = {
  _id: string;
  name: string;
  code: string;
  side: string;
  description?: string;
  previewConfig: PreviewConfig;
  imageUrl?: string;
};
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
type CatalogItem = {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  mockupImageUrl: string;
  displayPrice?: number;
  productId: Product;
  placementTemplateId: PlacementTemplate;
};

type ArtworkMode = "has_logo" | "needs_help";
type Artwork = { url: string; publicId?: string; format?: string };

const MAX_INSTRUCTIONS = 2000;

function SamplePrintLogo({ isLightGarment, text = "YOUR LOGO" }: { isLightGarment: boolean; text?: string }) {
  const inkColor = isLightGarment ? "#0f172a" : "#ffffff";
  return (
    <div className="h-full w-full flex flex-col items-center justify-center p-1 text-center select-none pointer-events-none transition-all duration-300">
      <div className="flex flex-col items-center justify-center opacity-90 drop-shadow-[0_1px_3px_rgba(0,0,0,0.5)] max-h-full max-w-full">
        <svg
          className="w-7 h-7 mb-0.5 max-w-full max-h-[45%]"
          viewBox="0 0 24 24"
          fill="none"
          stroke={inkColor}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polygon points="12 2 2 7 12 12 22 7 12 2" />
          <polyline points="2 17 12 22 22 17" />
          <polyline points="2 12 12 17 22 12" />
        </svg>
        <span
          className="text-[8px] font-black uppercase tracking-[0.16em] leading-tight"
          style={{ color: inkColor }}
        >
          {text}
        </span>
      </div>
    </div>
  );
}

export default function CustomPrintCatalogDetailClient({ item }: { item: CatalogItem }) {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuthStore();

  const product = item.productId;
  const placement = item.placementTemplateId;

  // Variant selection
  const availableVariants = useMemo(
    () => product.variants.filter((v) => v.isAvailable && v.stock > 0),
    [product.variants]
  );
  const [selectedVariantId, setSelectedVariantId] = useState(() => availableVariants[0]?._id || "");
  const selectedVariant = product.variants.find((v) => v._id === selectedVariantId) || null;

  const colors = useMemo(() => {
    const seen = new Set<string>();
    return availableVariants.filter((v) => {
      const c = v.color || "One Color";
      if (seen.has(c)) return false;
      seen.add(c);
      return true;
    });
  }, [availableVariants]);

  const sizes = useMemo(
    () => availableVariants.filter((v) => v.color === selectedVariant?.color),
    [availableVariants, selectedVariant?.color]
  );

  // Artwork mode
  const [artworkMode, setArtworkMode] = useState<ArtworkMode>("has_logo");
  const [artwork, setArtwork] = useState<Artwork | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Design assistance
  const [assistanceName, setAssistanceName] = useState("");
  const [assistanceEmail, setAssistanceEmail] = useState("");

  // Pre-fill from logged in user
  useEffect(() => {
    if (user) {
      if (!assistanceName) setAssistanceName(user.name || "");
      if (!assistanceEmail) setAssistanceEmail(user.email || "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Instructions
  const [instructions, setInstructions] = useState("");

  // Submission
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [submittedRef, setSubmittedRef] = useState("");

  // Preview image: variant image or mockup
  const previewBackground = useMemo(() => {
    if (placement.side === "BACK") {
      return selectedVariant?.images?.[1] || product.images[1] || item.mockupImageUrl;
    }
    return selectedVariant?.images?.[0] || product.images[0] || item.mockupImageUrl;
  }, [selectedVariant, product.images, placement.side, item.mockupImageUrl]);

  function selectColor(color: string) {
    const v = availableVariants.find((x) => x.color === color);
    if (v) setSelectedVariantId(v._id);
  }
  function selectSize(size: string) {
    const v = availableVariants.find((x) => x.color === selectedVariant?.color && x.size === size);
    if (v) setSelectedVariantId(v._id);
  }

  async function handleArtworkUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setMessage(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("category", "custom-artwork");
      const { data } = await api.post("/upload/image", form, { headers: { "Content-Type": "multipart/form-data" } });
      setArtwork({ url: data.data.url, publicId: data.data.publicId, format: data.data.format });
      trackEvent("custom_print_logo_uploaded", { catalog_item: item.slug });
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setMessage({ type: "error", text: e.response?.data?.message || "Logo upload failed. Please try again." });
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!user) {
      router.push(`/login?redirect=/custom-printing/${item.slug}`);
      return;
    }
    if (!selectedVariant) {
      setMessage({ type: "error", text: "Please select a product variant." });
      return;
    }
    if (!instructions.trim()) {
      setMessage({ type: "error", text: "Please enter printing instructions." });
      return;
    }
    if (artworkMode === "needs_help" && (!assistanceName.trim() || !assistanceEmail.trim())) {
      setMessage({ type: "error", text: "Please enter your name and email so we can contact you." });
      return;
    }

    setSubmitting(true);
    setMessage(null);
    try {
      const key = typeof window !== "undefined" ? crypto.randomUUID() : `${Date.now()}-${selectedVariantId}`;
      const payload = {
        catalogItemId: item._id,
        productId: product._id,
        selectedVariantId: selectedVariant._id,
        selectedColor: selectedVariant.color || "",
        selectedSize: selectedVariant.size || "",
        printLocations: [placement.side === "BACK" ? "BACK" : "FRONT"],
        selectedPlacements: [{ templateId: placement._id, code: placement.code, name: placement.name }],
        instructions: instructions.trim(),
        artwork: artworkMode === "has_logo" && artwork ? artwork : undefined,
        artworkType: artworkMode === "needs_help" ? "NEEDS_DESIGN_ASSISTANCE" : artwork ? "HAS_ARTWORK" : "NEEDS_DESIGN_ASSISTANCE",
        designAssistanceName: artworkMode === "needs_help" ? assistanceName : undefined,
        designAssistanceEmail: artworkMode === "needs_help" ? assistanceEmail : undefined,
        idempotencyKey: key,
      };

      const { data } = await api.post("/designs/requests", payload);
      setSubmittedRef(data.data?._id || "");
      setMessage({ type: "success", text: "Your custom printing request has been submitted." });
      trackEvent("custom_print_request_submitted", { catalog_item: item.slug, has_artwork: artworkMode === "has_logo" && Boolean(artwork) });
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setMessage({ type: "error", text: e.response?.data?.message || "Request submission failed. Please try again." });
    } finally {
      setSubmitting(false);
    }
  }

  // Success screen
  if (submittedRef && message?.type === "success") {
    return (
      <main className="min-h-screen bg-background px-4 py-16 text-on-background md:px-8">
        <div className="mx-auto max-w-2xl rounded-3xl border border-outline-variant/30 bg-surface-container-lowest p-8 text-center shadow-sm md:p-14">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 text-2xl" aria-hidden="true">✓</div>
          <p className="mt-6 text-xs font-bold uppercase tracking-[0.2em] text-secondary">Request received</p>
          <h1 className="mt-3 text-3xl font-black tracking-tight md:text-4xl">Custom print request submitted!</h1>
          <p className="mt-4 text-on-surface-variant">Our team will review your request and get in touch with next steps.</p>

          <div className="mt-8 rounded-2xl bg-surface-container-low p-6 text-left">
            <h2 className="font-bold mb-4 border-b border-outline-variant/20 pb-2">Request Summary</h2>
            <dl className="grid grid-cols-2 gap-y-3 text-sm">
              <dt className="text-on-surface-variant">Reference</dt>
              <dd className="font-mono text-right font-bold">{submittedRef.slice(-8).toUpperCase()}</dd>
              <dt className="text-on-surface-variant">Catalog Item</dt>
              <dd className="text-right font-bold">{item.name}</dd>
              <dt className="text-on-surface-variant">Placement</dt>
              <dd className="text-right font-bold text-primary">{placement.name}</dd>
              <dt className="text-on-surface-variant">Variant</dt>
              <dd className="text-right font-bold">{selectedVariant?.color} · {selectedVariant?.size}</dd>
              <dt className="text-on-surface-variant">Artwork</dt>
              <dd className="text-right font-bold">{artworkMode === "needs_help" ? "Design Assistance Requested" : artwork ? "Logo Uploaded" : "None"}</dd>
            </dl>
          </div>

          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href="/custom-printing" className="rounded-xl bg-primary px-6 py-3 font-bold text-on-primary hover:opacity-90">
              View more designs
            </Link>
            <Link href="/account/designs" className="rounded-xl border border-outline-variant px-6 py-3 font-bold text-on-surface hover:bg-surface-container">
              My requests
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background pb-20 text-on-background">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="border-b border-outline-variant/20 bg-surface-container-low px-4 py-3 md:px-8">
        <ol className="mx-auto flex max-w-6xl items-center gap-2 text-sm text-on-surface-variant">
          <li><Link href="/" className="hover:text-on-surface">Home</Link></li>
          <li aria-hidden="true">/</li>
          <li><Link href="/custom-printing" className="hover:text-on-surface">Custom Printing</Link></li>
          <li aria-hidden="true">/</li>
          <li className="font-bold text-on-surface" aria-current="page">{item.name}</li>
        </ol>
      </nav>

      <div className="mx-auto max-w-6xl px-4 py-8 md:px-8">
        <div className="grid gap-12 lg:grid-cols-[1fr_1fr]">
          {/* Left: Preview (sticky) */}
          <div className="lg:sticky lg:top-8 space-y-4 self-start">
            <div className="overflow-hidden rounded-3xl border border-outline-variant/30 bg-surface-container-lowest shadow-md">
              <div className="border-b border-outline-variant/20 bg-surface-container-low px-5 py-4 flex justify-between items-center">
                <h2 className="font-bold">Preview</h2>
                <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-primary">
                  {placement.name}
                </span>
              </div>

              <div className="relative aspect-[4/5] w-full bg-surface-container">
                <img
                  src={previewBackground || item.mockupImageUrl}
                  alt={`${item.name} product preview`}
                  className="h-full w-full object-cover"
                />
                {/* Logo overlay at configured placement bounds */}
                <div
                  className="absolute z-10 transition-all duration-500"
                  style={{
                    left: `${placement.previewConfig.x}%`,
                    top: `${placement.previewConfig.y}%`,
                    width: `${placement.previewConfig.width}%`,
                    height: `${placement.previewConfig.height}%`,
                  }}
                  aria-hidden="true"
                >
                  {artworkMode === "has_logo" && artwork ? (
                    <img
                      src={artwork.url}
                      alt="Your uploaded logo preview"
                      className="h-full w-full object-contain drop-shadow-lg"
                    />
                  ) : (
                    <SamplePrintLogo
                      isLightGarment={
                        selectedVariant?.color === "Pure White" || selectedVariant?.color === "Heather Grey"
                      }
                      text={artworkMode === "needs_help" ? "DESIGN SERVICE" : "YOUR LOGO"}
                    />
                  )}
                </div>
              </div>
            </div>

            {/* Item description card */}
            <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-5">
              <p className="text-xs font-bold uppercase tracking-[0.15em] text-secondary">Placement</p>
              <h1 className="mt-2 text-2xl font-black tracking-tight">{item.name}</h1>
              <p className="mt-1 text-sm font-semibold text-primary">{placement.name}</p>
              {item.description && (
                <p className="mt-3 text-sm text-on-surface-variant leading-relaxed">{item.description}</p>
              )}
              {item.displayPrice && (
                <p className="mt-3 text-lg font-black text-on-surface">
                  Starting from ₹{(item.displayPrice / 100).toLocaleString("en-IN")}
                </p>
              )}
            </div>
          </div>

          {/* Right: Form */}
          <form onSubmit={handleSubmit} className="space-y-8" noValidate>
            {/* Variant Selection */}
            {availableVariants.length > 0 && (
              <section aria-labelledby="variant-heading" className="rounded-3xl border border-outline-variant/30 bg-surface-container-lowest p-6 shadow-sm">
                <h2 id="variant-heading" className="font-bold text-lg mb-5">Select Your Variant</h2>

                {colors.length > 0 && (
                  <fieldset className="mb-6">
                    <legend className="mb-3 text-sm font-bold flex items-center justify-between">
                      <span>Color</span>
                      <span className="text-xs font-semibold text-primary">{selectedVariant?.color}</span>
                    </legend>
                    <div className="flex flex-wrap gap-3">
                      {colors.map((v) => {
                        const isSelected = selectedVariant?.color === v.color;
                        const hex = v.hexCode || "#0f172a";
                        return (
                          <button
                            type="button"
                            key={v.color}
                            onClick={() => selectColor(v.color || "")}
                            aria-pressed={isSelected}
                            aria-label={`Select color ${v.color}`}
                            className={`flex items-center gap-2.5 rounded-2xl border px-4 py-2.5 text-sm font-medium transition-all shadow-xs ${
                              isSelected
                                ? "border-primary bg-primary/10 ring-2 ring-primary text-on-surface font-bold shadow-sm"
                                : "border-outline-variant/40 bg-surface-container-low hover:bg-surface-container text-on-surface-variant"
                            }`}
                          >
                            <span
                              className="h-4 w-4 rounded-full border border-white/80 ring-1 ring-black/20 shadow-xs flex-shrink-0"
                              style={{ backgroundColor: hex }}
                            />
                            <span>{v.color}</span>
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>
                )}

                {sizes.length > 0 && (
                  <fieldset>
                    <legend className="mb-3 text-sm font-bold">Size</legend>
                    <div className="flex flex-wrap gap-2">
                      {sizes.map((v) => (
                        <button
                          type="button"
                          key={v._id}
                          onClick={() => selectSize(v.size || "")}
                          aria-pressed={selectedVariantId === v._id}
                          aria-label={`Size ${v.size}`}
                          className={`min-w-[2.75rem] rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${selectedVariantId === v._id ? "border-primary bg-primary text-on-primary" : "border-outline-variant/40 bg-surface-container-low hover:bg-surface-container"}`}
                        >
                          {v.size}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                )}
              </section>
            )}

            {/* Artwork Mode Toggle */}
            <section aria-labelledby="artwork-mode-heading" className="rounded-3xl border border-outline-variant/30 bg-surface-container-lowest p-6 shadow-sm space-y-6">
              <h2 id="artwork-mode-heading" className="font-bold text-lg">Your Artwork</h2>

              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => { setArtworkMode("has_logo"); trackEvent("custom_print_has_logo_selected"); }}
                  aria-pressed={artworkMode === "has_logo"}
                  className={`rounded-2xl border p-4 text-left transition-all ${artworkMode === "has_logo" ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-outline-variant/40 hover:bg-surface-container-low"}`}
                >
                  <span className="block text-2xl mb-2" aria-hidden="true">🖼️</span>
                  <span className="block font-bold text-sm">I Have My Logo</span>
                  <span className="block mt-1 text-xs text-on-surface-variant">Upload your artwork</span>
                </button>
                <button
                  type="button"
                  onClick={() => { setArtworkMode("needs_help"); trackEvent("custom_print_design_assistance_selected", { catalog_item: item.slug }); }}
                  aria-pressed={artworkMode === "needs_help"}
                  className={`rounded-2xl border p-4 text-left transition-all ${artworkMode === "needs_help" ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-outline-variant/40 hover:bg-surface-container-low"}`}
                >
                  <span className="block text-2xl mb-2" aria-hidden="true">✏️</span>
                  <span className="block font-bold text-sm">I Need Help With My Design</span>
                  <span className="block mt-1 text-xs text-on-surface-variant">Our team will assist</span>
                </button>
              </div>

              {/* Logo Upload */}
              {artworkMode === "has_logo" && (
                <div className="animate-in fade-in duration-200 space-y-3">
                  <label htmlFor="logo-upload" className="block font-bold">
                    Upload Your Logo
                  </label>
                  <p className="text-sm text-on-surface-variant">PNG, JPG, or WEBP up to 5MB. High-resolution recommended.</p>
                  <div className="relative">
                    <input
                      ref={fileInputRef}
                      id="logo-upload"
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={handleArtworkUpload}
                      disabled={uploading || submitting}
                      className="block w-full rounded-xl border border-outline-variant/40 bg-surface-container-low p-3 text-sm file:mr-4 file:rounded-full file:border-0 file:bg-primary/10 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-primary hover:file:bg-primary/20"
                    />
                    {uploading && (
                      <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-surface-container-low/80 backdrop-blur-sm">
                        <span className="animate-pulse text-sm font-bold text-primary">Uploading logo…</span>
                      </div>
                    )}
                  </div>
                  {artwork && (
                    <div className="flex items-center gap-3 rounded-xl bg-emerald-50 px-4 py-3 text-emerald-800 border border-emerald-200">
                      <svg className="h-5 w-5 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                      <span className="text-sm font-bold">Logo uploaded — preview updated above</span>
                    </div>
                  )}
                </div>
              )}

              {/* Design Assistance Form */}
              {artworkMode === "needs_help" && (
                <div className="animate-in fade-in duration-200 space-y-4 rounded-2xl bg-surface-container p-5 border border-outline-variant/30">
                  <p className="text-sm font-medium text-on-surface-variant">Don't have a logo? No problem. Our team will contact you and help create the perfect design.</p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label htmlFor="da_name" className="mb-1.5 block text-sm font-bold">
                        Your Name <span className="text-error" aria-label="required">*</span>
                      </label>
                      <input
                        id="da_name"
                        type="text"
                        required={artworkMode === "needs_help"}
                        value={assistanceName}
                        onChange={(e) => setAssistanceName(e.target.value)}
                        placeholder="Full Name"
                        className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3 text-sm focus:border-primary focus:outline-none"
                      />
                    </div>
                    <div>
                      <label htmlFor="da_email" className="mb-1.5 block text-sm font-bold">
                        Email Address <span className="text-error" aria-label="required">*</span>
                      </label>
                      <input
                        id="da_email"
                        type="email"
                        required={artworkMode === "needs_help"}
                        value={assistanceEmail}
                        onChange={(e) => setAssistanceEmail(e.target.value)}
                        placeholder="you@example.com"
                        className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3 text-sm focus:border-primary focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}
            </section>

            {/* Printing Instructions */}
            <section aria-labelledby="instructions-heading" className="rounded-3xl border border-outline-variant/30 bg-surface-container-lowest p-6 shadow-sm">
              <h2 id="instructions-heading" className="font-bold text-lg mb-1">
                {artworkMode === "needs_help" ? "Design Requirements" : "Printing Instructions"} <span className="text-error text-sm" aria-label="required">*</span>
              </h2>
              <p className="mb-4 text-sm text-on-surface-variant">
                {artworkMode === "needs_help"
                  ? "Describe the design you'd like. Include colors, text, style preferences, or any references."
                  : "Tell us about size preferences, alignment, colors, or any special production notes."}
              </p>
              <textarea
                id="instructions"
                required
                maxLength={MAX_INSTRUCTIONS}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder={artworkMode === "needs_help" ? "E.g. I want a minimalist logo with our company name 'Acme' in blue..." : "E.g. Logo at chest height, centered, around 8cm wide..."}
                className="min-h-36 w-full resize-y rounded-xl border border-outline-variant/40 bg-surface-container-low p-4 text-sm outline-none focus:border-primary focus:bg-surface-container-lowest transition-colors"
              />
              <p className="mt-1 text-right text-xs text-on-surface-variant">{instructions.length}/{MAX_INSTRUCTIONS}</p>
            </section>

            {/* Error/message display */}
            {message && message.type === "error" && (
              <div role="alert" className="rounded-xl bg-error-container p-4 text-sm font-medium text-on-error-container">
                {message.text}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={submitting || uploading || authLoading}
              className="w-full rounded-2xl bg-primary px-5 py-4 text-base font-bold text-on-primary shadow-md transition-all hover:bg-primary/90 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Submitting Request…" : !user ? "Log in to Request Custom Print" : "Request Custom Print"}
            </button>
            <p className="text-center text-xs text-on-surface-variant leading-relaxed">
              Submitting a request is free and does not create a payment. We will confirm pricing after reviewing your requirements.
            </p>
          </form>
        </div>
      </div>
    </main>
  );
}
