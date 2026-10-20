"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import DOMPurify from "isomorphic-dompurify";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/useAuthStore";
import { useCartStore } from "@/store/useCartStore";
import { trackEvent } from "@/lib/analytics";
import PincodeChecker from "./PincodeChecker";
import SizeGuideModal from "./SizeGuideModal";
import BulkQuoteModal from "./BulkQuoteModal";
import ImageLightboxModal from "./ImageLightboxModal";
import { ALL_CUSTOM_CATALOG_ITEMS } from "@/lib/customPrintCatalogData";

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

const COLOR_SWATCHES = [
  { name: "Black", hex: "#18181b" },
  { name: "White", hex: "#ffffff" },
  { name: "Navy", hex: "#1e3a8a" },
  { name: "Charcoal", hex: "#3f3f46" },
  { name: "Maroon", hex: "#881337" },
  { name: "Royal Blue", hex: "#2563eb" },
  { name: "Sky Blue", hex: "#38bdf8" },
  { name: "Forest Green", hex: "#166534" },
];

export default function CustomPrintCatalogDetailClient({ item }: { item: CatalogItem }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuthStore();
  const { addItem } = useCartStore();

  const product = item?.productId || { _id: "prod-1", name: item.name, basePrice: item.displayPrice ? (item.displayPrice > 10000 ? Math.round(item.displayPrice / 100) : item.displayPrice) : 1449, images: [item.mockupImageUrl], variants: [] };
  const placement = item?.placementTemplateId || { _id: "p-1", name: "Front Chest Logo", code: "CHEST", side: "FRONT", previewConfig: { x: 35, y: 35, width: 30, height: 25 } };
  const [isRequestingAssistance, setIsRequestingAssistance] = useState(false);
  const [submittedRequest, setSubmittedRequest] = useState<{ id: string; name: string } | null>(null);
  const isRealProduct = Boolean(product._id && product._id.length === 24 && product._id !== "prod-1");
  // Variant Selection
  const availableVariants = useMemo(
    () => (product.variants || []).filter((v) => v.isAvailable !== false && (v.stock ?? 1) > 0),
    [product.variants]
  );

  // URL state synchronization & Initial Validation
  const initialColorFromUrl = searchParams.get("color");
  const initialSizeFromUrl = searchParams.get("size");

  const [selectedVariantId] = useState(() => availableVariants[0]?._id || "v-1");
  const selectedVariant = availableVariants.find((v) => v._id === selectedVariantId) || availableVariants[0] || null;

  const [selectedColor, setSelectedColor] = useState<string>(() => initialColorFromUrl || selectedVariant?.color || "Black");
  const [selectedSize, setSelectedSize] = useState<string>(() => initialSizeFromUrl || selectedVariant?.size || "L");
  const [canvasSide, setCanvasSide] = useState<string>(placement.side === "BACK" ? "BACK" : "FRONT");

  // Quantity Stepper & Multi-Size Allocation State
  const [quantity, setQuantity] = useState<number>(1);
  const [isBulkAllocationMode, setIsBulkAllocationMode] = useState<boolean>(false);
  const [sizeAllocations, setSizeAllocations] = useState<Record<string, number>>({
    S: 0,
    M: 0,
    L: 0,
    XL: 0,
    "2XL": 0,
    "3XL": 0,
    "4XL": 0,
  });

  // Customization & File Upload State
  const [uploadedLogo, setUploadedLogo] = useState<string | null>(null);
  const [designFiles, setDesignFiles] = useState<{ url: string; fileType: string; filename: string }[]>([]);
  const [customizationNotes, setCustomizationNotes] = useState<string>("");
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadContainerRef = useRef<HTMLDivElement>(null);
  const buyButtonRef = useRef<HTMLButtonElement>(null);

  // Modals & Gallery State
  const [isSizeGuideOpen, setIsSizeGuideOpen] = useState(false);
  const [isBulkQuoteOpen, setIsBulkQuoteOpen] = useState(false);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [activeImageIndex, setActiveImageIndex] = useState(0);

  // Operation & UI States
  const [isAddingToCart, setIsAddingToCart] = useState(false);
  const [isBuyNowLoading, setIsBuyNowLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [showStickyMobileBar, setShowStickyMobileBar] = useState(false);
  const [activeTab, setActiveTab] = useState<"specs" | "printing" | "care" | "faq">("specs");
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  // Recently Viewed State
  const [recentlyViewed, setRecentlyViewed] = useState<any[]>([]);

  // Gallery Images List
  const galleryImages = useMemo(() => {
    if (product.images && product.images.length > 0) return product.images;
    return [item.mockupImageUrl || "/images/custom_print_hero.png"];
  }, [product.images, item.mockupImageUrl]);

  // Bidirectional URL Search Params Synchronization
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    let changed = false;

    if (selectedColor && params.get("color") !== selectedColor) {
      params.set("color", selectedColor);
      changed = true;
    }
    if (selectedSize && params.get("size") !== selectedSize) {
      params.set("size", selectedSize);
      changed = true;
    }

    if (changed) {
      const newUrl = `${window.location.pathname}?${params.toString()}`;
      window.history.replaceState(null, "", newUrl);
    }
  }, [selectedColor, selectedSize]);

  // Handle Browser Back/Forward popstate
  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const color = params.get("color");
      const size = params.get("size");
      if (color) setSelectedColor(color);
      if (size) setSelectedSize(size);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  // Track recently viewed products in localStorage
  useEffect(() => {
    if (!item) return;
    try {
      const stored = localStorage.getItem("recently_viewed_custom_products");
      const list = stored ? JSON.parse(stored) : [];
      const current = {
        id: item._id,
        name: item.name,
        image: galleryImages[0],
        price: item.displayPrice ? (item.displayPrice > 10000 ? Math.round(item.displayPrice / 100) : item.displayPrice) : 1449,
        slug: item.slug,
      };
      const filtered = list.filter((x: any) => x.id !== current.id);
      const updated = [current, ...filtered].slice(0, 6);
      localStorage.setItem("recently_viewed_custom_products", JSON.stringify(updated));
      setRecentlyViewed(updated);
    } catch {
      // Ignore localStorage errors
    }
  }, [item, galleryImages]);

  // Handle Sticky Mobile Purchase Bar Intersection
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        setShowStickyMobileBar(!entry.isIntersecting);
      },
      { threshold: 0.1 }
    );
    if (buyButtonRef.current) {
      observer.observe(buyButtonRef.current);
    }
    return () => observer.disconnect();
  }, []);

  // Quantity Stepper Input Handler
  const handleQuantityChange = (newVal: number) => {
    const valid = Math.max(1, Math.min(1000, Math.floor(newVal || 1)));
    setQuantity(valid);
  };

  // Multi-Size Allocation Handler
  const handleSizeAllocationChange = (size: string, qty: number) => {
    const valid = Math.max(0, Math.min(500, Math.floor(qty || 0)));
    const updated = { ...sizeAllocations, [size]: valid };
    setSizeAllocations(updated);
    const total = Object.values(updated).reduce((acc, curr) => acc + curr, 0);
    setQuantity(Math.max(1, total));
  };

  // File Upload Process with DOMPurify SVG Sanitization
  const processUploadedFile = (file: File) => {
    const validTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/svg+xml", "application/pdf"];
    const ext = file.name.split('.').pop()?.toLowerCase();

    if (!validTypes.includes(file.type.toLowerCase()) && !['png', 'jpg', 'jpeg', 'webp', 'svg', 'pdf'].includes(ext || '')) {
      setMessage({ text: "Please upload a PNG, JPG, WEBP, SVG, or PDF file.", type: "error" });
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setMessage({ text: "File size exceeds 10MB limit. Please upload a smaller file.", type: "error" });
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      let dataUrl = e.target?.result as string;

      // DOMPurify Sanitization for SVG uploads
      if (file.type === "image/svg+xml" || ext === "svg") {
        try {
          const rawText = atob(dataUrl.split(",")[1] || "");
          const sanitizedSvg = DOMPurify.sanitize(rawText);
          dataUrl = `data:image/svg+xml;base64,${btoa(sanitizedSvg)}`;
        } catch {
          // Fallback
        }
      }

      if (dataUrl) {
        setUploadedLogo(dataUrl);
        setDesignFiles([{
          url: dataUrl,
          fileType: file.type || `image/${ext}`,
          filename: file.name
        }]);

        setMessage({ text: "File uploaded & validated successfully!", type: "success" });
        setTimeout(() => setMessage(null), 3500);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processUploadedFile(e.dataTransfer.files[0]);
    }
  };

  // Shared Add To Cart Handler
  const handleAddToCart = async () => {
    if (!user) {
      router.push(`/login?redirect=/custom-printing/${item.slug}`);
      return;
    }

    if (!isRealProduct) {
      setMessage({
        text: "This display mockup is not linked to a live inventory blank. Please customize an active blank from our catalog or design in our Studio Canvas.",
        type: "error",
      });
      return;
    }

    if (!uploadedLogo && designFiles.length === 0) {
      setMessage({ text: "Please upload your design file or logo first!", type: "error" });
      if (uploadContainerRef.current) {
        uploadContainerRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
        uploadContainerRef.current.focus();
      }
      return;
    }

    setIsAddingToCart(true);
    setMessage(null);

    try {
      const customConfigs = [{
        color: selectedColor,
        variantId: selectedVariantId,
        sizeDistribution: isBulkAllocationMode
          ? Object.entries(sizeAllocations).filter(([, qty]) => qty > 0).map(([size, quantity]) => ({ size, quantity }))
          : [{ size: selectedSize, quantity }]
      }];

      await addItem(
        product._id,
        selectedVariantId || product.variants?.[0]?._id || "default-var",
        quantity,
        undefined,
        true,
        customConfigs,
        designFiles,
        customizationNotes
      );

      setMessage({ text: `${quantity} ${item.name}(s) added to cart!`, type: "success" });
      trackEvent("custom_print_request_submitted", { catalog_item: item.slug, has_artwork: true });
      router.push("/cart");
    } catch (err: any) {
      setMessage({ text: err.response?.data?.message || "Failed to add to cart", type: "error" });
    } finally {
      setIsAddingToCart(false);
    }
  };

  // Direct Buy Now Flow
  const handleBuyNow = async () => {
    if (!user) {
      router.push(`/login?redirect=/custom-printing/${item.slug}`);
      return;
    }

    if (!isRealProduct) {
      setMessage({
        text: "This display mockup is not linked to a live inventory blank. Please customize an active blank from our catalog or design in our Studio Canvas.",
        type: "error",
      });
      return;
    }

    if (!uploadedLogo && designFiles.length === 0) {
      setMessage({ text: "Please upload your design file or logo first!", type: "error" });
      if (uploadContainerRef.current) {
        uploadContainerRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
        uploadContainerRef.current.focus();
      }
      return;
    }

    setIsBuyNowLoading(true);
    setMessage(null);

    try {
      const customConfigs = [{
        color: selectedColor,
        variantId: selectedVariantId,
        sizeDistribution: isBulkAllocationMode
          ? Object.entries(sizeAllocations).filter(([, qty]) => qty > 0).map(([size, quantity]) => ({ size, quantity }))
          : [{ size: selectedSize, quantity }]
      }];

      await addItem(
        product._id,
        selectedVariantId || product.variants?.[0]?._id || "default-var",
        quantity,
        undefined,
        true,
        customConfigs,
        designFiles,
        customizationNotes
      );

      router.push("/checkout");
    } catch (err: any) {
      setMessage({ text: err.response?.data?.message || "Buy Now action failed", type: "error" });
    } finally {
      setIsBuyNowLoading(false);
    }
  };

  // Path B: Request Design Assistance without upfront purchase
  const handleRequestDesignAssistance = async () => {
    if (!user) {
      router.push(`/login?redirect=/custom-printing/${item.slug}`);
      return;
    }

    if (!isRealProduct) {
      setMessage({
        text: "Design assistance requires a live customizable garment from our catalog.",
        type: "error",
      });
      return;
    }

    if (!selectedVariantId) {
      setMessage({ text: "Please select a size and color variant first.", type: "error" });
      return;
    }

    setIsRequestingAssistance(true);
    setMessage(null);

    try {
      const payload = {
        productId: product._id,
        selectedVariantId,
        selectedColor: selectedColor || "Black",
        selectedSize: selectedSize || "L",
        printLocations: [placement.side?.toUpperCase() === "BACK" ? "BACK" : "FRONT"],
        instructions: customizationNotes.trim() || `Design assistance request for ${item.name} (${placement.name}).`,
        artwork: uploadedLogo
          ? {
              url: uploadedLogo,
              format: uploadedLogo.includes(".png") ? "png" : "jpg",
            }
          : undefined,
        idempotencyKey: `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      };

      const res = await api.post("/designs/requests", payload);
      if (res.data?.success) {
        setSubmittedRequest({
          id: res.data.data?._id || "",
          name: res.data.data?.name || item.name,
        });
      }
    } catch (err: unknown) {
      let msg = "Failed to submit custom printing request.";
      if (err && typeof err === "object" && "response" in err) {
        const r = err.response;
        if (r && typeof r === "object" && "data" in r) {
          const d = r.data;
          if (d && typeof d === "object" && "message" in d && typeof d.message === "string") {
            msg = d.message;
          }
        }
      }
      setMessage({ text: msg, type: "error" });
    } finally {
      setIsRequestingAssistance(false);
    }
  };

  const displayPriceInRupees = typeof product.basePrice === "number" && product.basePrice > 0
    ? (product.basePrice > 10000 ? Math.round(product.basePrice / 100) : product.basePrice)
    : 1299;
  const unitPrice = displayPriceInRupees;
  const lineTotal = unitPrice * quantity;
  const productMrp = (product as { mrp?: number })?.mrp;
  const originalMrp = productMrp && productMrp > displayPriceInRupees ? productMrp : undefined;
  return (
    <main className="min-h-screen bg-background text-on-background pb-28 md:pb-24">
      {/* Top Announcement Marquee */}
      <div className="bg-black text-white text-xs py-2 px-4 text-center font-medium tracking-wide">
        🚚 Complimentary Pan-India Delivery on Prepaid Orders Over ₹999 | 🧵 240+ GSM Combed Cotton | 🔍 Staff Pre-Press Digital Mockup Approval
      </div>

      {/* Toast Notification */}
      {message && (
        <div
          role="alert"
          aria-live="assertive"
          className={`fixed top-20 right-6 z-50 px-6 py-3.5 rounded-lg shadow-xl text-white font-mono text-xs uppercase tracking-wider font-bold transition-all animate-in fade-in slide-in-from-top-2 duration-300 ${
            message.type === "success" ? "bg-neutral-900 border border-neutral-700" : "bg-red-600"
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="mx-auto max-w-7xl px-4 py-8 md:px-8 md:py-12">
        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" className="mb-6 flex text-xs text-on-surface-variant">
          <ol className="flex items-center space-x-2">
            <li><Link href="/" className="hover:text-primary transition-colors">Home</Link></li>
            <li><span className="mx-1.5">/</span></li>
            <li><Link href="/custom-printing" className="hover:text-primary transition-colors">Custom Printing</Link></li>
            <li><span className="mx-1.5">/</span></li>
            <li className="font-bold text-on-surface" aria-current="page">{item.name}</li>
          </ol>
        </nav>

        <div className="grid grid-cols-1 gap-12 lg:grid-cols-2">
          
          {/* Left Column: Sticky Mockup Gallery & Lightbox Zoom */}
          <div className="flex flex-col gap-4 lg:sticky lg:top-24 lg:self-start">
            <div
              onClick={() => setIsLightboxOpen(true)}
              className="group relative aspect-[4/5] w-full cursor-zoom-in overflow-hidden rounded-3xl bg-surface-container shadow-md border border-outline-variant/30"
              title="Click to zoom image"
            >
              <img
                src={galleryImages[activeImageIndex]}
                alt={`${item.name} Mockup Preview`}
                className="h-full w-full object-cover transition-all duration-500 group-hover:scale-105"
              />

              <div className="absolute top-4 right-4 rounded-full bg-black/60 px-3 py-1 text-[11px] font-bold text-white backdrop-blur-md">
                🔍 Click to Zoom
              </div>

              {/* Placement Badge */}
              <div className="absolute top-4 left-4 rounded-full bg-black/70 px-3.5 py-1.5 text-xs font-bold text-white backdrop-blur-md">
                Placement: {placement.name}
              </div>

              {/* Placement Logo Overlay */}
              <div
                className="absolute z-10 transition-all duration-300 pointer-events-none"
                style={{
                  left: `${placement.previewConfig.x}%`,
                  top: `${placement.previewConfig.y}%`,
                  width: `${placement.previewConfig.width}%`,
                  height: `${placement.previewConfig.height}%`,
                }}
              >
                {uploadedLogo ? (
                  <img src={uploadedLogo} alt="Uploaded Logo Preview" className="h-full w-full object-contain drop-shadow-xl" />
                ) : (
                  <div className="h-full w-full flex flex-col items-center justify-center p-1 text-center select-none opacity-90 drop-shadow-[0_1px_3px_rgba(0,0,0,0.5)]">
                    <svg className="w-8 h-8 mb-1 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polygon points="12 2 2 7 12 12 22 7 12 2" />
                      <polyline points="2 17 12 22 22 17" />
                      <polyline points="2 12 12 17 22 12" />
                    </svg>
                    <span className="text-[9px] font-black uppercase tracking-[0.16em] text-white">YOUR LOGO HERE</span>
                  </div>
                )}
              </div>
            </div>

            {/* Gallery Thumbnails */}
            {galleryImages.length > 1 && (
              <div className="grid grid-cols-4 gap-3">
                {galleryImages.map((img, idx) => (
                  <button
                    key={idx}
                    onClick={() => setActiveImageIndex(idx)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setActiveImageIndex(idx); }}
                    aria-label={`Select product image thumbnail ${idx + 1}`}
                    className={`relative aspect-[4/5] overflow-hidden rounded-xl border-2 transition-all ${
                      activeImageIndex === idx ? "border-primary ring-2 ring-primary/30 scale-105" : "border-transparent hover:border-outline-variant"
                    }`}
                  >
                    <img src={img} alt={`Thumbnail ${idx + 1}`} className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Right Column: Details & Customization Options */}
          <div className="flex flex-col space-y-6">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <div className="text-amber-400 text-sm font-bold flex items-center gap-1">
                  <span>★ ★ ★ ★ ★</span>
                  <span className="text-xs font-bold text-on-surface-variant ml-1">4.9 (142 reviews)</span>
                </div>
                <span className="text-xs font-bold text-emerald-700 bg-emerald-100 px-2.5 py-0.5 rounded-full">
                  VERIFIED PRODUCT
                </span>
              </div>

              <h1 className="font-display-lg text-3xl font-black text-on-surface md:text-4xl leading-tight">
                {item.name}
              </h1>

              {/* Dynamic Price Row */}
              <div className="mt-4 flex flex-wrap items-baseline gap-3 border-b border-outline-variant/20 pb-6">
                <span className="font-price-lg text-3xl font-black text-primary">₹{unitPrice.toLocaleString("en-IN")}</span>
                {originalMrp && (
                  <span className="font-price-md text-xl text-on-surface-variant line-through">₹{originalMrp.toLocaleString("en-IN")}</span>
                )}
                <span className="text-xs text-on-surface-variant ml-auto font-label-caps">Inclusive of all taxes · Express pan-India delivery</span>
              </div>
            </div>

            {/* Staff Digital Pre-Press Mockup Verification Banner */}
            <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5 text-on-surface text-xs leading-relaxed shadow-sm">
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-primary text-xl font-bold shrink-0">verified</span>
                <div>
                  <p className="font-bold text-sm text-on-surface mb-1">Pre-Press Digital Mockup Verification</p>
                  <p className="text-on-surface-variant leading-relaxed">
                    Upload your graphic or logo below. Prior to printing, our production studio inspects resolution, color separation, and exact print boundaries, generating a high-resolution pre-press proof for your account review.
                  </p>
                </div>
              </div>
            </div>

            {/* Step 1: File Upload Section */}
            <div
              ref={uploadContainerRef}
              tabIndex={-1}
              className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-6 shadow-xs space-y-4 focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <div className="flex items-center justify-between">
                <span className="font-label-caps text-sm font-extrabold text-on-surface flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-black text-white text-xs">1</span>
                  Upload Your Design File <span className="text-red-600">*</span>
                </span>
                {uploadedLogo && (
                  <span className="text-xs font-bold text-emerald-700 flex items-center gap-1 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                    ✓ File Validated
                  </span>
                )}
              </div>
              
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragOver(true);
                }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-3 ${
                  isDragOver ? "border-primary bg-primary/5 scale-[1.01]" : "border-outline-variant/60 hover:border-primary/60 hover:bg-surface-container/40"
                }`}
              >
                <div className="h-12 w-12 rounded-full bg-surface-container flex items-center justify-center text-primary text-2xl">
                  ☁️
                </div>
                <div>
                  <p className="font-bold text-sm text-on-surface">Click to browse or drag design file here</p>
                  <p className="text-xs text-on-surface-variant mt-1">PNG, JPG, WEBP, SVG, or PDF up to 10MB (DOMPurify Sanitized)</p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png, image/jpeg, image/webp, image/svg+xml, application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      processUploadedFile(e.target.files[0]);
                    }
                  }}
                />
              </div>

              {designFiles.length > 0 && (
                <div className="flex items-center justify-between rounded-xl bg-surface-container-low p-3 border border-outline-variant/30 text-xs">
                  <span className="font-semibold truncate max-w-[240px]">{designFiles[0].filename}</span>
                  <button 
                    onClick={() => { setUploadedLogo(null); setDesignFiles([]); }}
                    className="text-red-600 font-bold hover:underline"
                    aria-label="Remove uploaded file"
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>

            {/* Step 2: Customization Notes Section */}
            <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-6 shadow-xs space-y-3">
              <span className="font-label-caps text-sm font-extrabold text-on-surface flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-black text-white text-xs">2</span>
                Customization Notes & Instructions (Optional)
              </span>
              <textarea
                value={customizationNotes}
                onChange={(e) => setCustomizationNotes(e.target.value)}
                placeholder="Specify exact print location (Left Chest / Back / Sleeve), logo size in inches, Pantone colors, or special production instructions..."
                rows={3}
                className="w-full rounded-xl border border-outline-variant/40 bg-surface p-3.5 text-xs focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-gray-400"
              />
            </div>

            {/* Step 3: Print Placement Selector */}
            <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-6 shadow-xs space-y-3">
              <span className="font-label-caps text-sm font-extrabold text-on-surface flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-black text-white text-xs">3</span>
                Select Print Placement
              </span>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { side: "FRONT", label: "Front Left Chest" },
                  { side: "BACK", label: "Full Back" },
                  { side: "BOTH", label: "Front & Back (+₹150)" },
                  { side: "SLEEVE", label: "Left Sleeve" },
                ].map(({ side, label }) => (
                  <button
                    key={side}
                    onClick={() => setCanvasSide(side)}
                    aria-pressed={canvasSide === side}
                    className={`rounded-xl border py-3 px-2 text-xs font-bold transition-all min-h-[44px] ${
                      canvasSide === side
                        ? "border-black bg-black text-white shadow-sm"
                        : "border-outline-variant/40 bg-surface text-on-surface-variant hover:border-outline hover:bg-surface-container"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Step 4: Color Selector */}
            <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-6 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-label-caps text-sm font-extrabold text-on-surface flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-black text-white text-xs">4</span>
                  Select Fabric Color
                </span>
                <span className="text-xs font-bold text-primary">{selectedColor}</span>
              </div>
              <div className="flex flex-wrap gap-3">
                {COLOR_SWATCHES.map((swatch) => (
                  <button
                    key={swatch.name}
                    onClick={() => setSelectedColor(swatch.name)}
                    title={swatch.name}
                    aria-label={`Select ${swatch.name} color`}
                    style={{ backgroundColor: swatch.hex }}
                    className={`h-11 w-11 rounded-full border-2 transition-all min-h-[44px] min-w-[44px] ${
                      selectedColor.toLowerCase() === swatch.name.toLowerCase()
                        ? "border-primary ring-2 ring-primary ring-offset-2 scale-110 shadow-md"
                        : "border-outline-variant hover:scale-105"
                    }`}
                  />
                ))}
              </div>
            </div>

            {/* Step 5: Size Selector & Multi-Size Allocation Toggle */}
            <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-6 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <span className="font-label-caps text-sm font-extrabold text-on-surface flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-black text-white text-xs">5</span>
                  Select Size & Order Mode
                </span>
                <button
                  onClick={() => setIsSizeGuideOpen(true)}
                  className="text-xs font-bold text-primary hover:underline flex items-center gap-1"
                >
                  📏 View Size Chart
                </button>
              </div>

              {/* Mode Toggle */}
              <div className="flex rounded-xl bg-surface-container-low p-1 border border-outline-variant/30 text-xs">
                <button
                  onClick={() => setIsBulkAllocationMode(false)}
                  className={`flex-1 py-2 rounded-lg font-bold transition-all ${
                    !isBulkAllocationMode ? "bg-black text-white shadow-xs" : "text-on-surface-variant hover:text-black"
                  }`}
                >
                  Single Size Order
                </button>
                <button
                  onClick={() => setIsBulkAllocationMode(true)}
                  className={`flex-1 py-2 rounded-lg font-bold transition-all ${
                    isBulkAllocationMode ? "bg-black text-white shadow-xs" : "text-on-surface-variant hover:text-black"
                  }`}
                >
                  Corporate Multi-Size Allocation
                </button>
              </div>

              {!isBulkAllocationMode ? (
                <div className="grid grid-cols-4 gap-2.5 sm:grid-cols-7">
                  {["S", "M", "L", "XL", "2XL", "3XL", "4XL"].map((sz) => (
                    <button
                      key={sz}
                      onClick={() => setSelectedSize(sz)}
                      aria-pressed={selectedSize === sz}
                      className={`rounded-xl border py-3 text-xs font-bold transition-all min-h-[44px] ${
                        selectedSize === sz
                          ? "border-black bg-black text-white shadow-sm"
                          : "border-outline-variant/40 bg-surface text-on-surface hover:border-primary/50"
                      }`}
                    >
                      {sz}
                    </button>
                  ))}
                </div>
              ) : (
                /* Corporate Multi-Size Order Breakdown Matrix */
                <div className="space-y-3 pt-2">
                  <p className="text-xs text-on-surface-variant">Enter quantities for each size required for your team:</p>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {["S", "M", "L", "XL", "2XL", "3XL", "4XL"].map((sz) => (
                      <div key={sz} className="rounded-xl border border-outline-variant/40 bg-surface p-2.5 flex items-center justify-between">
                        <span className="font-bold text-xs">{sz}</span>
                        <input
                          type="number"
                          min={0}
                          max={500}
                          value={sizeAllocations[sz] || 0}
                          onChange={(e) => handleSizeAllocationChange(sz, parseInt(e.target.value) || 0)}
                          className="w-16 rounded-lg border border-outline-variant/60 bg-white p-1.5 text-center text-xs font-bold focus:border-black focus:outline-none"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Interactive Quantity Stepper Input */}
            <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-6 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-label-caps text-sm font-extrabold text-on-surface flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-black text-white text-xs">6</span>
                  Order Quantity
                </span>
                <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                  Total Units: {quantity} pcs
                </span>
              </div>

              <div className="flex items-center gap-4">
                <div className="flex items-center rounded-2xl border border-outline-variant/60 bg-surface p-1">
                  <button
                    onClick={() => handleQuantityChange(quantity - 1)}
                    disabled={quantity <= 1}
                    className="h-10 w-10 rounded-xl bg-surface-container text-lg font-bold text-on-surface hover:bg-surface-container-high disabled:opacity-40 flex items-center justify-center transition-colors min-h-[44px]"
                    aria-label="Decrease quantity"
                  >
                    -
                  </button>
                  <input
                    type="number"
                    min={1}
                    max={1000}
                    value={quantity}
                    onChange={(e) => handleQuantityChange(parseInt(e.target.value) || 1)}
                    className="w-16 text-center font-black text-sm text-on-surface bg-transparent focus:outline-none"
                    aria-label="Order quantity"
                  />
                  <button
                    onClick={() => handleQuantityChange(quantity + 1)}
                    className="h-10 w-10 rounded-xl bg-surface-container text-lg font-bold text-on-surface hover:bg-surface-container-high flex items-center justify-center transition-colors min-h-[44px]"
                    aria-label="Increase quantity"
                  >
                    +
                  </button>
                </div>

                <div className="text-xs text-on-surface-variant font-medium">
                  Total Line Price: <strong className="text-black text-sm">₹{lineTotal.toLocaleString("en-IN")}</strong>
                </div>
              </div>
            </div>

            {/* Corporate & Bulk Inquiry Banner (Path C) */}
            <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-low p-5 text-xs space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <p className="font-bold text-sm text-on-surface">Need 10+ Units for Your Team or Brand?</p>
                  <p className="text-on-surface-variant text-[11px] mt-0.5">
                    Direct-to-Film printing, screen print runs, custom embroidery, and dedicated wholesale pricing.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsBulkQuoteOpen(true)}
                  className="self-start sm:self-center px-4 py-2 rounded-lg bg-neutral-900 text-white font-label-caps text-xs font-bold hover:bg-neutral-800 transition-colors shrink-0"
                >
                  Request Bulk Quote (10+ Units)
                </button>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col gap-3 pt-2">
              {!isRealProduct && (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-900 space-y-2">
                  <p className="font-bold">Catalog Preview Sample</p>
                  <p>This item is currently a display mockup. To order, choose a blank from our customizable catalog or build directly in our interactive Studio Canvas.</p>
                  <div className="flex gap-2 pt-1">
                    <Link href="/custom-designer" className="inline-block px-3 py-1.5 rounded-lg bg-neutral-900 text-white font-label-caps text-[11px] font-bold">
                      Open Studio Canvas
                    </Link>
                    <Link href="/custom-printing" className="inline-block px-3 py-1.5 rounded-lg border border-outline-variant/50 font-label-caps text-[11px] font-bold text-on-surface">
                      Browse Active Blanks
                    </Link>
                  </div>
                </div>
              )}

              {isRealProduct && (
                <>
                  <button
                    onClick={handleAddToCart}
                    disabled={isAddingToCart || isBuyNowLoading || isRequestingAssistance}
                    className="w-full rounded-2xl border-2 border-black bg-white py-4 text-base font-extrabold text-black transition-all hover:bg-black hover:text-white disabled:opacity-50 flex justify-center items-center gap-2 shadow-sm min-h-[48px]"
                  >
                    <span>🛒</span>
                    {isAddingToCart ? "Adding to Cart..." : `Add ${quantity} to Cart (₹${lineTotal.toLocaleString("en-IN")})`}
                  </button>
                  
                  <button
                    ref={buyButtonRef}
                    onClick={handleBuyNow}
                    disabled={isAddingToCart || isBuyNowLoading || isRequestingAssistance}
                    className="w-full rounded-2xl bg-primary py-4 text-base font-extrabold text-on-primary shadow-md transition-all hover:bg-primary/90 active:scale-95 disabled:opacity-50 flex justify-center items-center gap-2 min-h-[48px]"
                  >
                    <span>⚡</span>
                    {isBuyNowLoading ? "Processing..." : "Buy it Now"}
                  </button>

                  {/* Path B: Request Design Assistance without Upfront Payment */}
                  <button
                    type="button"
                    onClick={handleRequestDesignAssistance}
                    disabled={isAddingToCart || isBuyNowLoading || isRequestingAssistance}
                    className="w-full rounded-xl border border-outline-variant/50 bg-surface-container-low py-3 text-xs font-bold text-on-surface transition-colors hover:bg-surface-container-high disabled:opacity-50 flex justify-center items-center gap-2"
                  >
                    <span>🎨</span>
                    {isRequestingAssistance ? "Submitting Request..." : "Request Design Assistance (Review Before Payment)"}
                  </button>
                </>
              )}
            </div>

            {/* Request Submitted Modal */}
            {submittedRequest && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
                <div className="w-full max-w-md rounded-2xl bg-surface-container-lowest p-6 shadow-2xl border border-outline-variant/30 space-y-4 text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <span className="material-symbols-outlined text-3xl">task_alt</span>
                  </div>
                  <h3 className="font-headline-sm text-lg font-bold text-on-surface">Design Request Submitted</h3>
                  <p className="text-xs text-on-surface-variant leading-relaxed">
                    We received your custom printing instructions for <strong>{submittedRequest.name}</strong>. Our team will prepare a digital placement proof for your review before payment.
                  </p>
                  <div className="flex flex-col gap-2 pt-2">
                    <Link
                      href="/account/designs"
                      className="w-full py-2.5 rounded-lg bg-primary text-on-primary font-label-caps text-xs font-bold hover:bg-primary/90 transition-colors"
                    >
                      View in Saved Designs
                    </Link>
                    <button
                      onClick={() => setSubmittedRequest(null)}
                      className="w-full py-2 text-xs text-on-surface-variant hover:text-on-surface font-label-caps"
                    >
                      Close
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Pincode Serviceability & Delivery Checker */}
            <PincodeChecker />

            {/* Trust Badges */}
            <div className="grid grid-cols-3 gap-3 border-t border-b border-outline-variant/20 py-4 text-center text-xs">
              <div>
                <span className="text-xl">🚚</span>
                <p className="font-bold text-on-surface mt-1">Free Shipping</p>
                <p className="text-[11px] text-on-surface-variant">Across India</p>
              </div>
              <div>
                <span className="text-xl">🛡️</span>
                <p className="font-bold text-on-surface mt-1">Mockup Approval</p>
                <p className="text-[11px] text-on-surface-variant">100% Satisfaction</p>
              </div>
              <div>
                <span className="text-xl">🔒</span>
                <p className="font-bold text-on-surface mt-1">Secure Checkout</p>
                <p className="text-[11px] text-on-surface-variant">Razorpay / UPI</p>
              </div>
            </div>

            {/* Specification Tabs & FAQ Accordion */}
            <div className="pt-4 space-y-4">
              <div className="flex border-b border-outline-variant/20 text-xs font-bold gap-6">
                {[
                  { id: "specs", label: "Fabric & Specs" },
                  { id: "printing", label: "Printing Quality" },
                  { id: "care", label: "Care Guide" },
                  { id: "faq", label: "FAQ" },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as any)}
                    className={`pb-3 border-b-2 transition-colors min-h-[44px] ${
                      activeTab === tab.id ? "border-black text-black font-extrabold" : "border-transparent text-on-surface-variant hover:text-black"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="text-xs leading-relaxed text-on-surface-variant space-y-3">
                {activeTab === "specs" && (
                  <ul className="space-y-2 list-disc pl-4">
                    <li><strong>Fabric:</strong> 100% Super Combed Cotton (240 GSM heavy-grade fabric).</li>
                    <li><strong>Finish:</strong> Bio-washed, pre-shrunk fabric for long-lasting durability.</li>
                    <li><strong>Fit:</strong> Regular Comfort Fit with durable ribbed collar and double-stitched hem.</li>
                    <li><strong>Use Case:</strong> Ideal for corporate teams, promotional events, tech startups & daily wear.</li>
                  </ul>
                )}

                {activeTab === "printing" && (
                  <ul className="space-y-2 list-disc pl-4">
                    <li><strong>Technology:</strong> High-Definition Direct-To-Garment (DTG) & Premium Screen Printing.</li>
                    <li><strong>Color Accuracy:</strong> Pantone matched digital prints with vibrant color contrast.</li>
                    <li><strong>Longevity:</strong> Crack-resistant print quality guaranteed for 50+ machine washes.</li>
                  </ul>
                )}

                {activeTab === "care" && (
                  <ul className="space-y-2 list-disc pl-4">
                    <li>Machine wash inside out with cold water and mild detergent.</li>
                    <li>Do not iron directly on the printed graphic area.</li>
                    <li>Dry in shade and avoid harsh bleach or chlorine cleaners.</li>
                  </ul>
                )}

                {activeTab === "faq" && (
                  <div className="space-y-3">
                    {[
                      {
                        q: "When will I receive my digital mockup for approval?",
                        a: "Our design team sends a high-resolution mockup to your WhatsApp / Email within 2-4 hours after your order is placed.",
                      },
                      {
                        q: "What if I need changes in the mockup?",
                        a: "You can request unlimited revisions until you are 100% satisfied with the design placement and logo size!",
                      },
                      {
                        q: "What file format is best for uploading?",
                        a: "High-resolution PNG (transparent background), SVG, PDF, or JPG (300 DPI) works best.",
                      },
                      {
                        q: "Do you offer bulk discounts?",
                        a: "Yes! Tiered quantity discounts are applied automatically at checkout, or contact us for orders above 100 pieces.",
                      },
                    ].map((item, idx) => (
                      <div key={idx} className="rounded-xl border border-outline-variant/30 p-3 bg-surface-container-lowest">
                        <button
                          onClick={() => setOpenFaq(openFaq === idx ? null : idx)}
                          aria-expanded={openFaq === idx}
                          className="w-full text-left font-bold text-on-surface flex justify-between items-center min-h-[44px]"
                        >
                          <span>{item.q}</span>
                          <span>{openFaq === idx ? "-" : "+"}</span>
                        </button>
                        {openFaq === idx && <p className="mt-2 text-on-surface-variant leading-relaxed">{item.a}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

          </div>
        </div>

        {/* Explore More Custom Apparel & Corporate Gifts */}
        <section aria-label="More custom products" className="mt-16 border-t border-outline-variant/20 pt-12">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-black text-on-surface md:text-2xl">Explore More Custom Garments</h2>
              <p className="text-xs text-on-surface-variant mt-0.5">Customize your company logo on premium polos, cotton tees, hoodies, and corporate gifts.</p>
            </div>
            <Link href="/custom-printing" className="text-xs font-bold text-primary hover:underline">
              View All 16 Products →
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4">
            {ALL_CUSTOM_CATALOG_ITEMS.filter((other) => other.slug !== item?.slug).slice(0, 4).map((rel) => {
              const relPrice = rel.displayPrice
                ? (rel.displayPrice > 10000 ? Math.round(rel.displayPrice / 100) : rel.displayPrice)
                : (rel.productId?.basePrice ? (rel.productId.basePrice > 10000 ? Math.round(rel.productId.basePrice / 100) : rel.productId.basePrice) : 1449);
              return (
                <Link
                  key={rel._id}
                  href={`/custom-printing/${rel.slug}`}
                  className="group flex flex-col justify-between overflow-hidden rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-3 shadow-2xs hover:shadow-md transition-all hover:border-primary/40"
                >
                  <div className="relative aspect-[4/5] w-full overflow-hidden rounded-xl bg-surface-container mb-3">
                    <img
                      src={rel.mockupImageUrl}
                      alt={rel.name}
                      className="h-full w-full object-cover group-hover:scale-105 transition-all duration-300"
                    />
                    {rel.category && (
                      <span className="absolute top-2 left-2 rounded-md bg-black/75 px-2 py-0.5 text-[10px] font-bold text-white backdrop-blur-xs">
                        {rel.category}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col flex-1 justify-between">
                    <div>
                      <h3 className="font-bold text-xs text-on-surface line-clamp-2 group-hover:text-primary transition-colors">
                        {rel.name}
                      </h3>
                    </div>
                    <div className="mt-3 flex items-center justify-between pt-2 border-t border-outline-variant/20">
                      <span className="text-sm font-extrabold text-primary">₹{relPrice.toLocaleString("en-IN")}</span>
                      <span className="text-[11px] font-bold text-on-surface-variant group-hover:text-primary">Customize →</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        {/* Recently Viewed Products Section */}
        {recentlyViewed.length > 0 && (
          <section aria-label="Recently viewed products" className="mt-16 border-t border-outline-variant/20 pt-12">
            <h2 className="text-xl font-black text-on-surface mb-6">Recently Viewed Custom Products</h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              {recentlyViewed.map((x) => (
                <Link
                  key={x.id}
                  href={`/custom-printing/${x.slug}`}
                  className="group rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-3 shadow-2xs hover:shadow-md transition-all"
                >
                  <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-surface-container mb-2">
                    <img src={x.image} alt={x.name} className="h-full w-full object-cover group-hover:scale-105 transition-all" />
                  </div>
                  <p className="font-bold text-xs text-on-surface truncate">{x.name}</p>
                  <p className="text-xs font-black text-primary mt-1">₹{x.price.toLocaleString("en-IN")}</p>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Sticky Mobile Purchase Bar with Safe-Area Insets */}
      {showStickyMobileBar && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 border-t border-gray-200 p-3 px-4 backdrop-blur-md shadow-2xl md:hidden pb-safe animate-in slide-in-from-bottom duration-200">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold text-gray-500">{selectedColor} · Size {selectedSize}</p>
              <p className="text-base font-black text-primary">₹{unitPrice.toLocaleString("en-IN")} <span className="text-xs text-gray-400 font-normal">x{quantity}</span></p>
            </div>
            <button
              onClick={handleAddToCart}
              disabled={isAddingToCart}
              className="rounded-xl bg-primary px-6 py-3 text-xs font-extrabold text-on-primary shadow-md hover:bg-primary/90 flex items-center gap-1.5 min-h-[44px]"
            >
              <span>🛒</span> {isAddingToCart ? "Adding..." : "Add to Cart"}
            </button>
          </div>
        </div>
      )}

      {/* Modals */}
      <SizeGuideModal isOpen={isSizeGuideOpen} onClose={() => setIsSizeGuideOpen(false)} />
      <BulkQuoteModal isOpen={isBulkQuoteOpen} onClose={() => setIsBulkQuoteOpen(false)} productName={item?.name || "Custom Apparel"} productId={product?._id} />
      <ImageLightboxModal isOpen={isLightboxOpen} onClose={() => setIsLightboxOpen(false)} images={galleryImages} currentIndex={activeImageIndex} onIndexChange={setActiveImageIndex} />
    </main>
  );
}
