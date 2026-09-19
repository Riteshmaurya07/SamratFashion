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

type PrintPlacementTemplate = {
  _id: string;
  name: string;
  code: string;
  side: string;
  description: string;
  imageUrl: string;
  previewConfig: { x: number; y: number; width: number; height: number };
};

type Artwork = { url: string; publicId?: string; format?: string };

const MAX_INSTRUCTIONS = 2000;

export default function CustomPrintingRequestClient() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuthStore();
  
  const [products, setProducts] = useState<Product[]>([]);
  const [placements, setPlacements] = useState<PrintPlacementTemplate[]>([]);
  
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState("");
  const [selectedPlacementId, setSelectedPlacementId] = useState("");
  
  const [designAssistanceRequested, setDesignAssistanceRequested] = useState(false);
  const [designAssistanceData, setDesignAssistanceData] = useState({ name: "", email: "" });
  
  const [instructions, setInstructions] = useState("");
  const [artwork, setArtwork] = useState<Artwork | null>(null);
  
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [loadingPlacements, setLoadingPlacements] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [submittedReference, setSubmittedReference] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    trackEvent("custom_printing_started");
    
    // Fetch products
    api.get("/catalog/customizable-products")
      .then(({ data }) => {
        const loaded = (data?.data || []) as Product[];
        setProducts(loaded);
        if (loaded[0]) selectProduct(loaded[0]);
      })
      .catch(() => setMessage({ type: "error", text: "We could not load customizable products. Please try again." }))
      .finally(() => setLoadingProducts(false));
      
    // Fetch placements
    api.get("/print-placements")
      .then(({ data }) => {
        setPlacements(data?.data || []);
      })
      .catch((err) => console.error("Failed to fetch placements", err))
      .finally(() => setLoadingPlacements(false));
      
  }, []);

  // Pre-fill user data
  useEffect(() => {
    if (user && !designAssistanceData.name && !designAssistanceData.email) {
      setDesignAssistanceData({
        name: user.name || "",
        email: user.email || ""
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

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

  const selectedPlacement = placements.find(p => p._id === selectedPlacementId) || null;

  // Determine the best preview background image based on hierarchy
  const previewBackground = useMemo(() => {
    if (selectedPlacement) {
      // If we have a BACK placement, try to find a back image (usually the second image)
      if (selectedPlacement.side === "BACK") {
        return selectedVariant?.images?.[1] || selectedProduct?.images?.[1] || selectedVariant?.images?.[0] || selectedProduct?.images?.[0] || selectedPlacement.imageUrl;
      }
      return selectedVariant?.images?.[0] || selectedProduct?.images?.[0] || selectedPlacement.imageUrl;
    }
    return selectedVariant?.images?.[0] || selectedProduct?.images?.[0] || "";
  }, [selectedVariant, selectedProduct, selectedPlacement]);

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
      trackEvent("custom_logo_uploaded");
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
    if (!selectedProduct || !selectedVariant || !selectedPlacement || !instructions.trim()) {
      setMessage({ type: "error", text: "Please complete all required selections (product, placement, and instructions)." });
      return;
    }
    
    if (designAssistanceRequested && (!designAssistanceData.name.trim() || !designAssistanceData.email.trim())) {
      setMessage({ type: "error", text: "Please provide your name and email for design assistance." });
      return;
    }
    
    setSubmitting(true);
    setMessage(null);
    try {
      const key = typeof window !== "undefined" ? crypto.randomUUID() : `${Date.now()}-${selectedVariantId}`;
      const payload = {
        productId: selectedProduct._id,
        selectedVariantId: selectedVariant._id,
        selectedColor: selectedVariant.color,
        selectedSize: selectedVariant.size,
        printLocations: [selectedPlacement.side],
        selectedPlacements: [{
          templateId: selectedPlacement._id,
          code: selectedPlacement.code,
          name: selectedPlacement.name,
        }],
        instructions: instructions.trim(),
        artwork: !designAssistanceRequested && artwork ? artwork : undefined,
        artworkType: designAssistanceRequested ? "NEEDS_DESIGN_ASSISTANCE" : (artwork ? "HAS_ARTWORK" : "NEEDS_DESIGN_ASSISTANCE"),
        designAssistanceName: designAssistanceRequested ? designAssistanceData.name : undefined,
        designAssistanceEmail: designAssistanceRequested ? designAssistanceData.email : undefined,
        idempotencyKey: key,
      };

      const { data } = await api.post("/designs/requests", payload);
      setSubmittedReference(data.data?._id || "");
      setMessage({ type: "success", text: "Your custom printing request has been submitted." });
      trackEvent("custom_request_submitted", { 
        product_id: selectedProduct._id, 
        has_artwork: !designAssistanceRequested && Boolean(artwork),
        design_assistance: designAssistanceRequested
      });
      
      setInstructions("");
      setArtwork(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (error: unknown) {
      const response = error as { response?: { data?: { message?: string } } };
      setMessage({ type: "error", text: response.response?.data?.message || "We could not submit your request. Please try again." });
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
          <p className="mx-auto mt-5 max-w-xl text-on-surface-variant">We have saved your preferences. Our team will review the request and contact you with the next steps.</p>
          
          <div className="mt-6 rounded-2xl bg-surface-container-low p-6 text-left">
            <h3 className="font-bold mb-4 border-b border-outline-variant/20 pb-2">Request Summary</h3>
            <dl className="grid grid-cols-2 gap-y-3 text-sm">
              <dt className="text-on-surface-variant">Reference</dt>
              <dd className="font-mono text-right font-bold">{submittedReference}</dd>
              <dt className="text-on-surface-variant">Product</dt>
              <dd className="text-right font-bold">{selectedProduct?.name}</dd>
              <dt className="text-on-surface-variant">Variant</dt>
              <dd className="text-right font-bold">{selectedVariant?.color} · {selectedVariant?.size}</dd>
              <dt className="text-on-surface-variant">Placement</dt>
              <dd className="text-right font-bold">{selectedPlacement?.name || "None"}</dd>
              <dt className="text-on-surface-variant">Artwork</dt>
              <dd className="text-right font-bold">{designAssistanceRequested ? "Design Assistance Requested" : (artwork ? "Uploaded" : "None")}</dd>
            </dl>
          </div>

          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <button onClick={() => { setSubmittedReference(""); setMessage(null); }} className="rounded-xl bg-primary px-6 py-3 font-bold text-on-primary hover:opacity-90">Submit another request</button>
            <Link href="/custom-designer" className="rounded-xl border border-outline-variant px-6 py-3 font-bold text-on-surface hover:bg-surface-container">Design it yourself</Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background text-on-background pb-20">
      <section className="border-b border-outline-variant/20 bg-surface-container-low px-4 py-14 md:px-8 md:py-16">
        <div className="mx-auto max-w-6xl">
          <p className="font-label-caps text-xs uppercase tracking-[0.2em] text-secondary">Custom printing</p>
          <div className="mt-4 flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div className="max-w-3xl">
              <h1 className="font-display-lg text-4xl font-black tracking-tight md:text-5xl lg:text-6xl">Bring the idea. We&apos;ll handle the finish.</h1>
              <p className="mt-5 max-w-2xl text-lg leading-relaxed text-on-surface-variant">Choose a product, select exactly where you want it printed, and share your requirements. A finished logo is optional.</p>
            </div>
            <Link href="/custom-designer" className="inline-flex min-h-12 items-center justify-center whitespace-nowrap rounded-xl border border-outline-variant bg-surface-container-lowest px-5 font-bold text-on-surface shadow-sm hover:bg-surface-container">Design it yourself <span className="ml-2" aria-hidden="true">→</span></Link>
          </div>
        </div>
      </section>

      <form onSubmit={handleSubmit} className="mx-auto max-w-6xl px-4 py-10 md:px-8">
        <div className="grid gap-12 lg:grid-cols-[1.1fr_0.9fr]">
          
          {/* Left Column: Selections */}
          <div className="space-y-12">
            
            {/* Step 1: Product Selection */}
            <section aria-labelledby="product-heading">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="font-label-caps text-xs uppercase tracking-[0.18em] text-secondary">01 · Choose your product</p>
                  <h2 id="product-heading" className="mt-2 font-headline-lg text-2xl font-bold">Start with a garment</h2>
                </div>
                <span className="text-sm text-on-surface-variant">{products.length} available</span>
              </div>
              
              {loadingProducts ? (
                <div className="mt-6 rounded-2xl bg-surface-container-low p-10 text-center text-on-surface-variant">Loading customizable products…</div>
              ) : products.length === 0 ? (
                <div className="mt-6 rounded-2xl border border-dashed border-outline-variant p-10 text-center text-on-surface-variant">No customizable products are available right now.</div>
              ) : (
                <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
                  {products.map((product) => (
                    <button type="button" key={product._id} onClick={() => selectProduct(product)} className={`overflow-hidden rounded-2xl border bg-surface-container-lowest text-left transition-shadow hover:shadow-md ${selectedProduct?._id === product._id ? "border-primary ring-2 ring-primary/20" : "border-outline-variant/30"}`} aria-pressed={selectedProduct?._id === product._id}>
                      <div className="aspect-[4/5] bg-surface-container">
                        {product.images[0] ? <img src={product.images[0]} alt={product.name} loading="lazy" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-sm text-on-surface-variant">Image unavailable</div>}
                      </div>
                      <div className="p-4">
                        <h3 className="line-clamp-2 font-bold text-on-surface">{product.name}</h3>
                        <p className="mt-2 text-sm text-on-surface-variant">Starting at ₹{(product.basePrice).toLocaleString("en-IN")}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {selectedProduct && (
                <div className="mt-6 space-y-5 rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-6 shadow-sm">
                  <fieldset>
                    <legend className="mb-3 font-bold text-sm">Select Color</legend>
                    <div className="flex flex-wrap gap-2">
                      {colors.map((variant) => (
                        <button type="button" key={variant.color} onClick={() => selectColor(variant.color || "")} className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${selectedVariant?.color === variant.color ? "border-primary bg-primary text-on-primary" : "border-outline-variant/40 bg-surface-container-low hover:bg-surface-container"}`} aria-label={`Color ${variant.color}`} aria-pressed={selectedVariant?.color === variant.color}>{variant.color}</button>
                      ))}
                    </div>
                  </fieldset>
                  <fieldset>
                    <legend className="mb-3 font-bold text-sm">Select Size</legend>
                    <div className="flex flex-wrap gap-2">
                      {sizes.map((variant) => (
                        <button type="button" key={variant._id} onClick={() => selectSize(variant.size || "")} className={`min-w-[3rem] rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${selectedVariantId === variant._id ? "border-primary bg-primary text-on-primary" : "border-outline-variant/40 bg-surface-container-low hover:bg-surface-container"}`} aria-label={`Size ${variant.size}`} aria-pressed={selectedVariantId === variant._id}>{variant.size}</button>
                      ))}
                    </div>
                  </fieldset>
                </div>
              )}
            </section>

            {/* Step 2: Placement Catalog */}
            {selectedProduct && selectedVariant && (
              <section aria-labelledby="placement-heading" className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="mb-6">
                  <p className="font-label-caps text-xs uppercase tracking-[0.18em] text-secondary">02 · Choose your print placement</p>
                  <h2 id="placement-heading" className="mt-2 font-headline-lg text-2xl font-bold">Where should we print it?</h2>
                </div>
                
                {loadingPlacements ? (
                  <div className="rounded-2xl bg-surface-container-low p-10 text-center text-on-surface-variant">Loading placement catalog…</div>
                ) : placements.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-outline-variant p-10 text-center text-on-surface-variant">No print placement options are currently available.</div>
                ) : (
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                    {placements.map((placement) => {
                      const isSelected = selectedPlacementId === placement._id;
                      return (
                        <button 
                          type="button" 
                          key={placement._id} 
                          onClick={() => {
                            setSelectedPlacementId(placement._id);
                            trackEvent("print_placement_selected", { placement: placement.code });
                          }} 
                          className={`relative overflow-hidden rounded-2xl border text-left transition-all hover:shadow-md ${isSelected ? "border-primary ring-2 ring-primary bg-primary/5" : "border-outline-variant/30 bg-surface-container-lowest"}`}
                          aria-pressed={isSelected}
                        >
                          <div className="aspect-[4/5] bg-surface-container w-full relative">
                            {placement.imageUrl ? (
                              <img src={placement.imageUrl} alt={placement.name} className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full items-center justify-center text-sm text-on-surface-variant">No image</div>
                            )}
                            
                            {/* Visual indicator of the logo placement area */}
                            <div 
                              className={`absolute border border-dashed flex items-center justify-center text-[10px] font-bold uppercase tracking-wider backdrop-blur-sm transition-colors ${isSelected ? "border-primary bg-primary/20 text-primary" : "border-outline-variant bg-surface-container/40 text-on-surface-variant"}`}
                              style={{
                                left: `${placement.previewConfig.x}%`,
                                top: `${placement.previewConfig.y}%`,
                                width: `${placement.previewConfig.width}%`,
                                height: `${placement.previewConfig.height}%`,
                              }}
                            >
                              Logo
                            </div>
                          </div>
                          <div className="p-4">
                            <h3 className={`font-bold text-sm ${isSelected ? "text-primary" : "text-on-surface"}`}>{placement.name}</h3>
                            {placement.description && <p className="mt-1 text-xs text-on-surface-variant line-clamp-2">{placement.description}</p>}
                          </div>
                          
                          {/* Selection Checkmark */}
                          {isSelected && (
                            <div className="absolute top-3 right-3 h-6 w-6 rounded-full bg-primary text-white flex items-center justify-center shadow-sm">
                              <svg width="14" height="10" viewBox="0 0 14 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M1 5L5 9L13 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>
            )}

            {/* Step 3: Artwork & Requirements */}
            {selectedPlacement && (
              <section aria-labelledby="artwork-heading" className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="mb-6">
                  <p className="font-label-caps text-xs uppercase tracking-[0.18em] text-secondary">03 · Provide artwork</p>
                  <h2 id="artwork-heading" className="mt-2 font-headline-lg text-2xl font-bold">Logo and requirements</h2>
                </div>

                <div className="space-y-6 rounded-3xl border border-outline-variant/30 bg-surface-container-lowest p-6 md:p-8 shadow-sm">
                  
                  {/* Artwork Toggle */}
                  <div className="flex flex-col gap-4 sm:flex-row">
                    <button 
                      type="button"
                      onClick={() => {
                        setDesignAssistanceRequested(false);
                        trackEvent("artwork_upload_selected");
                      }}
                      className={`flex-1 rounded-2xl border p-5 text-left transition-all ${!designAssistanceRequested ? "border-primary ring-1 ring-primary bg-primary/5" : "border-outline-variant/40 bg-surface-container-lowest hover:bg-surface-container-low"}`}
                    >
                      <h3 className={`font-bold ${!designAssistanceRequested ? "text-primary" : ""}`}>I have a logo</h3>
                      <p className="mt-1 text-xs text-on-surface-variant">Upload your own high-quality design.</p>
                    </button>
                    <button 
                      type="button"
                      onClick={() => {
                        setDesignAssistanceRequested(true);
                        trackEvent("design_assistance_selected");
                      }}
                      className={`flex-1 rounded-2xl border p-5 text-left transition-all ${designAssistanceRequested ? "border-primary ring-1 ring-primary bg-primary/5" : "border-outline-variant/40 bg-surface-container-lowest hover:bg-surface-container-low"}`}
                    >
                      <h3 className={`font-bold ${designAssistanceRequested ? "text-primary" : ""}`}>Don't have a logo?</h3>
                      <p className="mt-1 text-xs text-on-surface-variant">Our team will help you create one.</p>
                    </button>
                  </div>

                  {/* Upload Flow */}
                  {!designAssistanceRequested && (
                    <div className="animate-in fade-in duration-300">
                      <label htmlFor="artwork" className="font-bold">Upload your logo</label>
                      <p className="mt-1 text-sm text-on-surface-variant">PNG, JPG, or WEBP up to 5MB.</p>
                      
                      <div className="mt-3 relative">
                        <input 
                          ref={fileInputRef} 
                          id="artwork" 
                          type="file" 
                          accept="image/png,image/jpeg,image/webp" 
                          onChange={handleArtwork} 
                          disabled={uploading || submitting} 
                          className="block w-full rounded-xl border border-outline-variant/40 bg-surface-container-low p-3 text-sm file:mr-4 file:rounded-full file:border-0 file:bg-primary/10 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-primary hover:file:bg-primary/20" 
                        />
                        {uploading && (
                          <div className="absolute inset-0 bg-surface-container-low/80 backdrop-blur-sm flex items-center justify-center rounded-xl border border-outline-variant/40">
                            <span className="text-sm font-bold text-primary animate-pulse">Uploading artwork…</span>
                          </div>
                        )}
                      </div>
                      
                      {artwork && (
                        <div className="mt-3 flex items-center gap-3 rounded-lg bg-emerald-50 px-4 py-3 text-emerald-800 border border-emerald-200">
                          <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                          <span className="text-sm font-bold">Artwork uploaded successfully</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Design Assistance Flow */}
                  {designAssistanceRequested && (
                    <div className="space-y-4 rounded-xl bg-surface-container p-5 animate-in fade-in duration-300 border border-outline-variant/30">
                      <p className="text-sm font-medium">Please provide your contact details so our design team can reach out to you.</p>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <label htmlFor="da_name" className="mb-1 block text-sm font-bold">Your Name <span className="text-error">*</span></label>
                          <input 
                            id="da_name" 
                            type="text" 
                            required={designAssistanceRequested}
                            value={designAssistanceData.name} 
                            onChange={(e) => setDesignAssistanceData({...designAssistanceData, name: e.target.value})}
                            className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3 text-sm focus:border-primary focus:outline-none" 
                            placeholder="John Doe" 
                          />
                        </div>
                        <div>
                          <label htmlFor="da_email" className="mb-1 block text-sm font-bold">Email Address <span className="text-error">*</span></label>
                          <input 
                            id="da_email" 
                            type="email" 
                            required={designAssistanceRequested}
                            value={designAssistanceData.email} 
                            onChange={(e) => setDesignAssistanceData({...designAssistanceData, email: e.target.value})}
                            className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3 text-sm focus:border-primary focus:outline-none" 
                            placeholder="john@example.com" 
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Instructions */}
                  <div>
                    <label htmlFor="instructions" className="font-bold">
                      {designAssistanceRequested ? "Design Requirements" : "Printing Instructions"} <span className="text-error">*</span>
                    </label>
                    <textarea 
                      id="instructions" 
                      required 
                      maxLength={MAX_INSTRUCTIONS} 
                      value={instructions} 
                      onChange={(event) => setInstructions(event.target.value)} 
                      placeholder={designAssistanceRequested 
                        ? "Describe the logo or design you want us to create. What colors, text, or elements should be included?" 
                        : "Tell us about size preferences, alignment, colors, or anything else our production team should know."}
                      className="mt-3 min-h-36 w-full resize-y rounded-xl border border-outline-variant/40 bg-surface-container-low p-4 text-sm outline-none focus:border-primary focus:bg-surface-container-lowest transition-colors" 
                    /> 
                    <p className="mt-1 text-right text-xs text-on-surface-variant">{instructions.length}/{MAX_INSTRUCTIONS}</p>
                  </div>
                </div>
              </section>
            )}

          </div>

          {/* Right Column: Live Preview & Submission (Sticky) */}
          <div className="lg:sticky lg:top-8 space-y-6 self-start">
            
            {/* Live Preview Panel */}
            <div className="overflow-hidden rounded-3xl border border-outline-variant/30 bg-surface-container-lowest shadow-sm">
              <div className="bg-surface-container-low px-5 py-4 border-b border-outline-variant/20 flex justify-between items-center">
                <h3 className="font-bold">Live Preview</h3>
                {selectedPlacement && <span className="text-xs font-bold uppercase tracking-wider text-primary bg-primary/10 px-3 py-1 rounded-full">{selectedPlacement.name}</span>}
              </div>
              
              <div className="aspect-[4/5] bg-surface-container relative">
                {previewBackground ? (
                  <img src={previewBackground} alt="Product preview" className="h-full w-full object-cover transition-opacity duration-300" />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-on-surface-variant">Select a product to view</div>
                )}
                
                {/* Logo Overlay */}
                {selectedPlacement && (
                  <div 
                    className="absolute z-10 transition-all duration-500 ease-in-out border border-transparent hover:border-outline-variant/40 rounded-sm"
                    style={{
                      left: `${selectedPlacement.previewConfig.x}%`,
                      top: `${selectedPlacement.previewConfig.y}%`,
                      width: `${selectedPlacement.previewConfig.width}%`,
                      height: `${selectedPlacement.previewConfig.height}%`,
                    }}
                  >
                    {!designAssistanceRequested && artwork ? (
                      <img src={artwork.url} alt="Your uploaded logo" className="h-full w-full object-contain drop-shadow-md" />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center border-2 border-dashed border-primary/50 bg-primary/10 backdrop-blur-[2px] rounded-sm">
                        <span className="text-[10px] md:text-xs font-bold text-primary text-center px-1">
                          {designAssistanceRequested ? "We'll design this" : "Your Logo Here"}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Submission Panel */}
            {selectedPlacement && (
              <div className="rounded-3xl border border-outline-variant/30 bg-surface-container-lowest p-6 shadow-sm">
                <h3 className="font-bold mb-4">Request Summary</h3>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-sm mb-6">
                  <dt className="text-on-surface-variant">Product:</dt>
                  <dd className="font-bold text-right truncate" title={selectedProduct?.name}>{selectedProduct?.name}</dd>
                  <dt className="text-on-surface-variant">Variant:</dt>
                  <dd className="font-bold text-right">{selectedVariant?.color} · {selectedVariant?.size}</dd>
                  <dt className="text-on-surface-variant">Placement:</dt>
                  <dd className="font-bold text-right text-primary">{selectedPlacement.name}</dd>
                </dl>
                
                {message && (
                  <div role="alert" className={`mb-6 rounded-xl p-4 text-sm font-medium ${message.type === "error" ? "bg-error-container text-on-error-container" : "bg-emerald-100 text-emerald-800"}`}>
                    {message.text}
                  </div>
                )}
                
                <button 
                  type="submit" 
                  onClick={() => {
                    // Simple programmatic form submit trigger for the sticky button
                    const form = document.querySelector('form');
                    if (form) form.requestSubmit();
                  }}
                  disabled={submitting || uploading || authLoading} 
                  className="w-full rounded-xl bg-primary px-5 py-4 font-bold text-on-primary shadow-md transition-all hover:bg-primary/90 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
                >
                  {submitting ? "Submitting Request…" : !user ? "Log in to submit" : "Submit Printing Request"}
                </button>
                <p className="mt-4 text-center text-[11px] text-on-surface-variant leading-relaxed">
                  Submitting a request is free and does not create an order. Final pricing will be confirmed after our team reviews your requirements.
                </p>
              </div>
            )}
            
          </div>
        </div>
      </form>
    </main>
  );
}
