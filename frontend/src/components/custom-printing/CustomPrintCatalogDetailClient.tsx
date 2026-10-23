"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Sparkles, MessageSquare, Eye } from "lucide-react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/useAuthStore";
import { useCartStore } from "@/store/useCartStore";
import { trackEvent } from "@/lib/analytics";
import PincodeChecker from "./PincodeChecker";
import SizeGuideModal from "./SizeGuideModal";
import BulkQuoteModal from "./BulkQuoteModal";
import ImageLightboxModal from "./ImageLightboxModal";
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
  mrp?: number;
  images: string[];
  variants: Variant[];
};
type VolumePricingTier = {
  minQuantity: number;
  maxQuantity?: number;
  discountPercentage?: number;
  unitPrice?: number;
};
type PricingRule = {
  source: string;
  minOrderQuantity: number;
  tiers: VolumePricingTier[];
  printLocationFee: number;
  setupFee: number;
};
type CatalogItem = {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  mockupImageUrl: string;
  backMockupImageUrl?: string;
  displayPrice?: number;
  minOrderQuantity?: number;
  productId: Product;
  placementTemplateId: PlacementTemplate;
  placementTemplateIds?: PlacementTemplate[];
  pricingRule?: PricingRule;
  effectiveMOQ?: number;
};
// (Hardcoded COLOR_SWATCHES replaced by dynamic productColorSwatches from product variants)

const REQUIREMENT_PROMPTS = [
  { label: "Logo placement and print size", prompt: "• Placement & Size: Small 3.5-inch logo on front right chest, 11-inch wide logo centered on back." },
  { label: "Garment color and fabric preference", prompt: "• Garment & Fabric: 100% bio-washed combed cotton in custom brand colors." },
  { label: "Front, back or sleeve printing", prompt: "• Print Locations: Front chest + full back graphic." },
  { label: "Bulk order and size distribution", prompt: "• Size Distribution: Need M, L, and XL divided according to our team count." },
  { label: "Brand colors and artwork instructions", prompt: "• Brand Colors: Match corporate logo hex codes and keep design sharp/minimal." },
  { label: "Delivery expectations", prompt: "• Delivery Expectations: Required for upcoming event; please expedite digital proof." },
  { label: "Special packaging or other requests", prompt: "• Special Requests: Individual polybag packing with size stickers." },
];
export default function CustomPrintCatalogDetailClient({ item }: { item: CatalogItem }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuthStore();
  const { addItem } = useCartStore();

  const product = item?.productId;
  const allPlacements: PlacementTemplate[] = useMemo(() => {
    if (item?.placementTemplateIds && item.placementTemplateIds.length > 0) {
      return item.placementTemplateIds;
    }
    if (item?.placementTemplateId) {
      return [item.placementTemplateId];
    }
    return [];
  }, [item]);

  const frontPlacement = useMemo(() => {
    const found = allPlacements.find((p) => p.side === "FRONT");
    if (found) return found;
    return (
      allPlacements[0] || {
        _id: "front-default",
        name: "Front Chest Print",
        code: "FRONT_CHEST",
        side: "FRONT",
        previewConfig: { x: 35, y: 32, width: 28, height: 24 },
      }
    );
  }, [allPlacements]);

  const backPlacement = useMemo(() => {
    const found = allPlacements.find((p) => p.side === "BACK");
    if (found) return found;
    return {
      _id: "back-default",
      name: "Full Back Print",
      code: "BACK_FULL",
      side: "BACK",
      previewConfig: { x: 25, y: 22, width: 50, height: 45 },
    };
  }, [allPlacements]);

  const [selectedPlacementIndex, setSelectedPlacementIndex] = useState(0);
  const [canvasSide, setCanvasSide] = useState<string>("FRONT");

  const activePlacement = useMemo(() => {
    if (canvasSide === "BACK") return backPlacement;
    return allPlacements[selectedPlacementIndex] || frontPlacement;
  }, [canvasSide, backPlacement, allPlacements, selectedPlacementIndex, frontPlacement]);

  const placement = activePlacement;
  const effectiveMOQ = item?.effectiveMOQ || item?.pricingRule?.minOrderQuantity || item?.minOrderQuantity || 10;
  const pricingTiers = item?.pricingRule?.tiers || [];

  const isRealProduct = Boolean(product?._id && product._id.length === 24);
  // Variant Selection
  const productVariants = product?.variants;
  const availableVariants = useMemo(
    () => (productVariants || []).filter((v) => v.isAvailable !== false && (v.stock ?? 1) > 0),
    [productVariants]
  );
  // Dynamic Color Swatches & Variants Resolution
  const productColorSwatches = useMemo(() => {
    const map = new Map<string, { name: string; hex: string; frontImage: string; backImage: string }>();
    availableVariants.forEach((v) => {
      if (v.color) {
        const key = v.color.toLowerCase();
        if (!map.has(key)) {
          map.set(key, {
            name: v.color,
            hex: v.hexCode || "#18181b",
            frontImage: v.images?.[0] || item.mockupImageUrl,
            backImage: v.images?.[1] || item.backMockupImageUrl || item.mockupImageUrl,
          });
        }
      }
    });
    return Array.from(map.values());
  }, [availableVariants, item.mockupImageUrl, item.backMockupImageUrl]);

  const initialColorFromUrl = searchParams.get("color");
  const initialSizeFromUrl = searchParams.get("size");

  const [selectedVariantId] = useState(() => availableVariants[0]?._id || "v-1");
  const selectedVariant = availableVariants.find((v) => v._id === selectedVariantId) || availableVariants[0] || null;

  const [selectedColor, setSelectedColor] = useState<string>(() => {
    if (initialColorFromUrl && availableVariants.some((v) => v.color?.toLowerCase() === initialColorFromUrl.toLowerCase())) {
      return initialColorFromUrl;
    }
    return availableVariants[0]?.color || "Pitch Black";
  });
  const [selectedSize, setSelectedSize] = useState<string>(() => initialSizeFromUrl || selectedVariant?.size || "L");

  const activeColorSet = useMemo(() => {
    const found = productColorSwatches.find((c) => c.name.toLowerCase() === selectedColor.toLowerCase());
    return (
      found ||
      productColorSwatches[0] || {
        name: selectedColor,
        hex: "#18181b",
        frontImage: item.mockupImageUrl,
        backImage: item.backMockupImageUrl || item.mockupImageUrl,
      }
    );
  }, [productColorSwatches, selectedColor, item.mockupImageUrl, item.backMockupImageUrl]);

  const currentMockupDisplayImage = useMemo(() => {
    if (canvasSide === "BACK") {
      return activeColorSet.backImage;
    }
    return activeColorSet.frontImage;
  }, [canvasSide, activeColorSet]);

  const isDarkShirt = useMemo(() => {
    const hex = activeColorSet.hex.toLowerCase();
    return !["#ffffff", "#f8fafc", "#fafafa"].includes(hex) && !activeColorSet.name.toLowerCase().includes("white");
  }, [activeColorSet]);
  const [quantity, setQuantity] = useState<number>(() => effectiveMOQ || 10);
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
  const [sloganText, setSloganText] = useState("");
  const [customizationNotes, setCustomizationNotes] = useState<string>("");
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadContainerRef = useRef<HTMLDivElement>(null);
  const buyButtonRef = useRef<HTMLButtonElement>(null);

  // Direct Bulk Inquiry State
  const [customerName, setCustomerName] = useState(user?.name || "");
  const [customerPhone, setCustomerPhone] = useState(user?.phone || "");
  const [customerEmail, setCustomerEmail] = useState(user?.email || "");
  const [companyName, setCompanyName] = useState("");
  const [isSubmittingInquiry, setIsSubmittingInquiry] = useState(false);
  const [inquiryErrors, setInquiryErrors] = useState<Record<string, string>>({});
  const [submittedInquiry, setSubmittedInquiry] = useState<{
    quoteNumber: string;
    totalQuantity: number;
    productName: string;
    contactName: string;
    email: string;
    phone: string;
    customerRequirements?: string;
  } | null>(null);

  useEffect(() => {
    if (user) {
      setCustomerName((prev: string) => prev || user.name || "");
      setCustomerEmail((prev: string) => prev || user.email || "");
      setCustomerPhone((prev: string) => prev || user.phone || "");
    }
  }, [user]);

  // Modals & Gallery State
  const [isSizeGuideOpen, setIsSizeGuideOpen] = useState(false);
  const [isBulkQuoteOpen, setIsBulkQuoteOpen] = useState(false);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [activeImageIndex, setActiveImageIndex] = useState(0);

  // Operation & UI States
  const [relatedItems, setRelatedItems] = useState<CatalogItem[]>([]);
  const [isAddingToCart, setIsAddingToCart] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [showStickyMobileBar, setShowStickyMobileBar] = useState(false);
  const [activeTab, setActiveTab] = useState<"specs" | "printing" | "care" | "faq">("specs");
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  // Recently Viewed State
  const [recentlyViewed, setRecentlyViewed] = useState<any[]>([]);

  useEffect(() => {
    api.get("/custom-print-catalog").then((res: { data?: { data?: CatalogItem[] } }) => {
      if (Array.isArray(res.data?.data)) {
        setRelatedItems(res.data.data.filter((x: CatalogItem) => x.slug !== item?.slug).slice(0, 4));
      }
    }).catch(() => {});
  }, [item?.slug]);
  // Gallery Images List
  const galleryImages = useMemo(() => {
    const list: string[] = [];
    // 1. Color variant images
    const variantMatch = availableVariants.find(
      (v) => v.color?.toLowerCase() === selectedColor?.toLowerCase()
    );
    if (variantMatch?.images && variantMatch.images.length > 0) {
      variantMatch.images.forEach((img) => {
        if (!list.includes(img)) list.push(img);
      });
    }
    // 2. Front & Back mockups
    if (item?.mockupImageUrl && !list.includes(item.mockupImageUrl)) {
      list.push(item.mockupImageUrl);
    }
    if (item?.backMockupImageUrl && !list.includes(item.backMockupImageUrl)) {
      list.push(item.backMockupImageUrl);
    }
    // 3. Product images
    if (product?.images) {
      product.images.forEach((img) => {
        if (!list.includes(img)) list.push(img);
      });
    }
    return list.length > 0 ? list : ["/images/custom_print_hero.png"];
  }, [availableVariants, selectedColor, item?.mockupImageUrl, item?.backMockupImageUrl, product?.images]);

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
  const processUploadedFile = async (file: File) => {
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

    setMessage({ text: "Uploading and validating artwork asset...", type: "success" });
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("category", "custom-artwork");
      const res = await api.post("/upload/image", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      const uploadedUrl = res.data?.data?.url;
      if (!uploadedUrl) throw new Error("Upload did not return an asset URL.");

      setUploadedLogo(uploadedUrl);
      setDesignFiles([{
        url: uploadedUrl,
        fileType: file.type || `image/${ext}`,
        filename: file.name
      }]);

      setMessage({ text: "Artwork uploaded & verified successfully!", type: "success" });
      setTimeout(() => setMessage(null), 3500);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setMessage({ text: e.response?.data?.message || "Failed to upload artwork file.", type: "error" });
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processUploadedFile(e.dataTransfer.files[0]);
    }
  };

  // Direct Submit Bulk Printing Inquiry
  const handleSubmitInquiry = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const errors: Record<string, string> = {};

    if (!customerName.trim() || customerName.trim().length < 2) {
      errors.name = "Customer name is required.";
    }
    if (!customerPhone.trim() || customerPhone.replace(/\D/g, "").length < 8) {
      errors.phone = "Valid mobile or contact number is required.";
    }
    if (!customerEmail.trim() || !/^\S+@\S+\.\S+$/.test(customerEmail.trim())) {
      errors.email = "Valid email address is required.";
    }
    if (quantity < effectiveMOQ) {
      errors.quantity = `Requested quantity (${quantity}) is below the minimum order requirement (${effectiveMOQ} units).`;
    }
    if (!uploadedLogo && designFiles.length === 0 && !sloganText.trim()) {
      errors.artwork = "Please upload an artwork/logo file or enter slogan text to be printed.";
    }

    setInquiryErrors(errors);
    if (Object.keys(errors).length > 0) {
      setMessage({ text: Object.values(errors)[0], type: "error" });
      return;
    }

    setIsSubmittingInquiry(true);
    setMessage(null);

    try {
      const allocations = isBulkAllocationMode
        ? Object.entries(sizeAllocations)
            .filter(([_, q]) => q > 0)
            .map(([size, q]) => ({
              size,
              color: selectedColor,
              quantity: q,
            }))
        : [{ size: selectedSize, color: selectedColor, quantity }];

      const breakdown = isBulkAllocationMode
        ? sizeAllocations
        : { [selectedSize]: quantity };

      const combinedInstructions = customizationNotes.trim();

      const response = await api.post("/bulk-orders/request", {
        organizationName: companyName.trim() || "Individual",
        contactName: customerName.trim(),
        email: customerEmail.trim().toLowerCase(),
        phone: customerPhone.trim(),
        productId: product?._id,
        catalogItemId: item._id,
        variantAllocations: allocations,
        variantBreakdown: breakdown,
        colorAllocation: selectedColor,
        customPrintingRequired: true,
        printLocations: [canvasSide || placement.side || "FRONT"],
        printMethod: "DTF Transfer",
        printText: sloganText.trim() || undefined,
        artworkFiles: designFiles.map((f) => ({
          url: f.url,
          originalFilename: f.filename,
          fileType: f.fileType,
        })),
        customerNote: combinedInstructions || undefined,
        deliveryLocation: "To be confirmed during confirmation",
      });

      if (response.data?.success) {
        setSubmittedInquiry({
          quoteNumber: response.data.data?.quoteNumber,
          totalQuantity: quantity,
          productName: item.name,
          contactName: customerName.trim(),
          email: customerEmail.trim(),
          phone: customerPhone.trim(),
          customerRequirements: combinedInstructions || undefined,
        });
        setMessage({ text: "Bulk printing inquiry submitted successfully!", type: "success" });
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setMessage({ text: e.response?.data?.message || "Failed to submit inquiry. Please try again.", type: "error" });
    } finally {
      setIsSubmittingInquiry(false);
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
          <div className="flex flex-col gap-3 lg:sticky lg:top-24 lg:self-start">
            {/* View Side Interactive Tabs */}
            <div className="flex items-center justify-between pb-1">
              <span className="font-label-caps text-xs font-bold text-on-surface uppercase tracking-wider flex items-center gap-1.5">
                <Eye className="w-3.5 h-3.5 text-primary" />
                Live Mockup Preview
              </span>
              <div className="flex rounded-xl bg-surface-container-high p-1 border border-outline-variant/30">
                <button
                  type="button"
                  onClick={() => {
                    setCanvasSide("FRONT");
                    setActiveImageIndex(0);
                  }}
                  aria-pressed={canvasSide === "FRONT"}
                  className={`rounded-lg px-3 py-1 text-xs font-bold transition-all cursor-pointer ${
                    canvasSide === "FRONT"
                      ? "bg-neutral-900 text-white shadow-xs"
                      : "text-on-surface-variant hover:text-on-surface"
                  }`}
                >
                  Front View
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCanvasSide("BACK");
                    if (galleryImages.length > 1) {
                      setActiveImageIndex(1);
                    }
                  }}
                  aria-pressed={canvasSide === "BACK"}
                  className={`rounded-lg px-3 py-1 text-xs font-bold transition-all cursor-pointer ${
                    canvasSide === "BACK"
                      ? "bg-neutral-900 text-white shadow-xs"
                      : "text-on-surface-variant hover:text-on-surface"
                  }`}
                >
                  Back View
                </button>
              </div>
            </div>

            <div
              onClick={() => setIsLightboxOpen(true)}
              className="group relative aspect-[4/5] w-full cursor-zoom-in overflow-hidden rounded-3xl bg-surface-container shadow-md border border-outline-variant/30"
              title="Click to zoom image"
            >
              <img
                src={currentMockupDisplayImage}
                alt={`${item.name} Mockup Preview`}
                className="h-full w-full object-cover transition-all duration-500 group-hover:scale-105"
              />

              <div className="absolute top-4 right-4 rounded-full bg-black/60 px-3 py-1 text-[11px] font-bold text-white backdrop-blur-md">
                🔍 Click to Zoom
              </div>

              {/* Placement Badge */}
              <div className="absolute top-4 left-4 rounded-full bg-black/75 px-3 py-1 text-xs font-bold text-white backdrop-blur-md flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                <span>Placement: {activePlacement.name} ({activePlacement.side})</span>
              </div>

              {/* Subtle Printable Zone Boundary */}
              <div
                className={`absolute z-10 transition-all duration-300 pointer-events-none rounded-xl flex items-center justify-center p-1 ${
                  uploadedLogo
                    ? ""
                    : isDarkShirt
                    ? "border-2 border-dashed border-white/60 bg-black/15 shadow-sm"
                    : "border-2 border-dashed border-neutral-900/40 bg-white/30 shadow-sm"
                }`}
                style={{
                  left: `${activePlacement.previewConfig.x}%`,
                  top: `${activePlacement.previewConfig.y}%`,
                  width: `${activePlacement.previewConfig.width}%`,
                  height: `${activePlacement.previewConfig.height}%`,
                }}
              >
                {uploadedLogo ? (
                  <img
                    src={uploadedLogo}
                    alt="Uploaded Logo Preview"
                    className="h-full w-full object-contain drop-shadow-xl"
                  />
                ) : (
                  <div className="h-full w-full flex flex-col items-center justify-center p-1 text-center select-none">
                    <span
                      className={`text-[8.5px] font-black uppercase tracking-[0.14em] px-2 py-0.5 rounded shadow-xs ${
                        isDarkShirt ? "text-white bg-black/60" : "text-neutral-950 bg-white/80"
                      }`}
                    >
                      {canvasSide === "BACK" ? "Back Print Area" : "Chest Print Area"}
                    </span>
                    <span
                      className={`text-[7.5px] font-bold mt-1 ${
                        isDarkShirt ? "text-white/80" : "text-neutral-700"
                      }`}
                    >
                      Upload artwork below
                    </span>
                  </div>
                )}
              </div>
            </div>

            {allPlacements.length > 1 && (
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <span className="text-xs font-bold text-on-surface w-full">Configured Print Areas:</span>
                {allPlacements.map((pt, idx) => (
                  <button
                    key={pt._id}
                    type="button"
                    onClick={() => {
                      setSelectedPlacementIndex(idx);
                      setCanvasSide(pt.side === "BACK" ? "BACK" : "FRONT");
                    }}
                    className={`rounded-xl border px-3 py-1.5 text-xs font-bold transition-colors ${
                      selectedPlacementIndex === idx
                        ? "bg-primary text-white border-primary shadow-xs"
                        : "bg-surface-container-low border-outline-variant/40 text-on-surface hover:border-outline-variant"
                    }`}
                  >
                    {pt.name} ({pt.code} - {pt.side})
                  </button>
                ))}
              </div>
            )}

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
            {/* MOQ & Volume Pricing Schedule */}
            <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 text-xs space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="font-bold text-primary flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4" />
                  <span>Configured Volume Pricing & MOQ</span>
                </span>
                <span className="font-mono text-[11px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded">
                  Minimum Order: {effectiveMOQ} Units
                </span>
              </div>
              {pricingTiers && pricingTiers.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1 font-mono">
                  {pricingTiers.map((tier, idx) => (
                    <div key={idx} className="bg-white/80 p-2 rounded-xl border border-primary/10 text-center">
                      <p className="font-bold text-on-surface">
                        {tier.minQuantity}–{tier.maxQuantity ? `${tier.maxQuantity}` : "+"} units
                      </p>
                      <p className="text-[11px] font-bold text-primary">
                        {tier.unitPrice ? `₹${tier.unitPrice}/ea` : `${tier.discountPercentage}% OFF`}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-on-surface-variant">
                  Dedicated volume pricing applies starting at {effectiveMOQ} units. Submit a bulk printing request to lock commercial terms.
                </p>
              )}
            </div>

            {/* Staff Digital Pre-Press Mockup Verification Banner */}
            <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-low p-4 text-on-surface text-xs leading-relaxed shadow-sm">
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

              <div className="pt-2 border-t border-outline-variant/20">
                <label className="block text-xs font-bold text-on-surface mb-1">
                  Slogan, Name, or Wording to Print (Optional)
                </label>
                <input
                  type="text"
                  value={sloganText}
                  onChange={(e) => setSloganText(e.target.value)}
                  placeholder="e.g. COMPANY NAME, Brand Motto, Event Slogan, Team Name..."
                  className="w-full rounded-xl border border-outline-variant/40 bg-surface p-3 text-xs outline-none focus:border-primary"
                />
                <span className="text-[11px] text-on-surface-variant mt-1 block">
                  You can upload a logo file, enter slogan text, or provide both.
                </span>
              </div>
            </div>

            {/* Step 2: Customer Requirements & Preferences Section (Section 6) */}
            <div className="rounded-2xl border-2 border-primary/25 bg-surface-container-lowest p-6 shadow-xs space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <MessageSquare className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-headline-sm text-base font-bold text-on-surface flex items-center gap-2">
                      <span>Tell Us Exactly What You Need</span>
                    </h3>
                    <p className="font-body-sm text-xs text-on-surface-variant mt-0.5 leading-relaxed">
                      Have a specific design or customization in mind? Share your requirements and preferences. Our team can review your instructions alongside your selected product and artwork.
                    </p>
                  </div>
                </div>
                <span className="text-[10px] font-bold text-primary bg-primary/10 px-2.5 py-1 rounded-full shrink-0 border border-primary/20">
                  Custom Brief
                </span>
              </div>

              <div>
                <label htmlFor="customer-requirements" className="block text-xs font-bold text-on-surface mb-1.5">
                  Describe your ideal T-shirt, logo placement, print size, colors, quantities or any special instructions:
                </label>
                <textarea
                  id="customer-requirements"
                  value={customizationNotes}
                  onChange={(e) => setCustomizationNotes(e.target.value.slice(0, 1000))}
                  placeholder="Example: I need 50 grey polo T-shirts for my company. Place our small logo on the right chest and a larger company logo on the back. Use navy-blue printing, keep the design minimal, and divide the order between M, L and XL sizes. Please share a digital proof before production."
                  rows={5}
                  maxLength={1000}
                  className="w-full rounded-xl border border-outline-variant/50 bg-surface p-3.5 text-xs text-on-surface focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary placeholder:text-neutral-400 leading-relaxed font-body-sm transition-all"
                />
                <div className="mt-1.5 flex items-center justify-between text-[11px] text-on-surface-variant">
                  <span>Click suggestion chips below to populate or append instructions:</span>
                  <span className="font-mono font-medium">{customizationNotes.length}/1000</span>
                </div>
              </div>

              {/* Clickable Requirement Prompts / Suggestions */}
              <div className="space-y-1.5 pt-1">
                <p className="text-[10px] uppercase font-bold text-on-surface-variant/80 tracking-wider">
                  Requirement Suggestions:
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {REQUIREMENT_PROMPTS.map((promptItem, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        setCustomizationNotes((prev) => {
                          const trimmed = prev.trim();
                          if (!trimmed) return promptItem.prompt;
                          if (trimmed.includes(promptItem.prompt)) return prev;
                          return `${trimmed}\n${promptItem.prompt}`;
                        });
                      }}
                      className="inline-flex items-center gap-1 rounded-lg border border-outline-variant/40 bg-surface-container-low px-2.5 py-1 text-[11px] font-medium text-on-surface hover:border-primary/50 hover:bg-surface-container transition-all cursor-pointer"
                    >
                      <span className="text-primary font-bold">+</span>
                      <span>{promptItem.label}</span>
                    </button>
                  ))}
                </div>
              </div>
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
                {productColorSwatches.map((swatch) => (
                  <button
                    key={swatch.name}
                    type="button"
                    onClick={() => setSelectedColor(swatch.name)}
                    title={swatch.name}
                    aria-label={`Select ${swatch.name} color`}
                    style={{ backgroundColor: swatch.hex }}
                    className={`h-11 w-11 rounded-full border-2 transition-all min-h-[44px] min-w-[44px] cursor-pointer ${
                      selectedColor.toLowerCase() === swatch.name.toLowerCase()
                        ? "border-primary ring-2 ring-primary ring-offset-2 scale-110 shadow-md"
                        : "border-outline-variant/60 hover:scale-105"
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

            {/* Step 7: Customer Contact Information */}
            <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-6 shadow-xs space-y-4">
              <span className="font-label-caps text-sm font-extrabold text-on-surface flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-black text-white text-xs">7</span>
                Customer Contact Information
              </span>
              <p className="text-xs text-on-surface-variant">
                Enter your details so the SamratFashion team can contact you with digital proofs and confirm your order.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="block font-bold text-on-surface mb-1">Customer Name *</label>
                  <input
                    type="text"
                    required
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Your full name"
                    className="w-full rounded-xl border border-outline-variant/40 bg-surface p-2.5 text-xs outline-none focus:border-primary"
                  />
                  {inquiryErrors.name && <p className="text-[10px] text-error mt-0.5">{inquiryErrors.name}</p>}
                </div>

                <div>
                  <label className="block font-bold text-on-surface mb-1">Mobile / WhatsApp Number *</label>
                  <input
                    type="tel"
                    required
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="+91 98765 43210"
                    className="w-full rounded-xl border border-outline-variant/40 bg-surface p-2.5 text-xs outline-none focus:border-primary font-mono"
                  />
                  {inquiryErrors.phone && <p className="text-[10px] text-error mt-0.5">{inquiryErrors.phone}</p>}
                </div>

                <div>
                  <label className="block font-bold text-on-surface mb-1">Work Email Address *</label>
                  <input
                    type="email"
                    required
                    value={customerEmail}
                    onChange={(e) => setCustomerEmail(e.target.value)}
                    placeholder="name@company.com"
                    className="w-full rounded-xl border border-outline-variant/40 bg-surface p-2.5 text-xs outline-none focus:border-primary"
                  />
                  {inquiryErrors.email && <p className="text-[10px] text-error mt-0.5">{inquiryErrors.email}</p>}
                </div>

                <div>
                  <label className="block font-bold text-on-surface mb-1">Company / Organization (Optional)</label>
                  <input
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="Company or organization"
                    className="w-full rounded-xl border border-outline-variant/40 bg-surface p-2.5 text-xs outline-none focus:border-primary"
                  />
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col gap-3 pt-2">
              <button
                type="button"
                onClick={handleSubmitInquiry}
                disabled={isSubmittingInquiry || quantity < effectiveMOQ}
                className="w-full rounded-2xl bg-primary py-4 text-sm font-black text-on-primary shadow-lg hover:bg-primary/90 active:scale-98 transition-all disabled:opacity-50 uppercase tracking-widest min-h-[48px]"
              >
                {isSubmittingInquiry
                  ? "Submitting Inquiry..."
                  : `Submit Bulk Printing Inquiry (${quantity} pcs)`}
              </button>

              {quantity < effectiveMOQ && (
                <p className="text-center text-[11px] text-error font-bold">
                  ⚠️ Minimum order quantity for this garment is {effectiveMOQ} units.
                </p>
              )}

              {/* Retail 1-Piece Sample Checkout */}
              <div className="pt-2 border-t border-outline-variant/20 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
                <span className="text-on-surface-variant text-[11px]">
                  Need a single sample unit first before bulk production?
                </span>
                <button
                  type="button"
                  onClick={handleAddToCart}
                  disabled={isAddingToCart}
                  className="rounded-xl border border-outline-variant bg-surface-container-low px-4 py-2 font-bold text-on-surface hover:bg-surface-container transition-colors shrink-0"
                >
                  {isAddingToCart ? "Adding..." : "Order 1 Sample (Add to Cart)"}
                </button>
              </div>
            </div>

            {/* Persistent Confirmation Card */}
            {submittedInquiry && (
              <div className="rounded-3xl border border-emerald-300 bg-emerald-50 p-6 md:p-8 text-center space-y-4 shadow-md animate-in fade-in zoom-in-95 duration-300">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-600 text-white text-2xl font-black">
                  ✓
                </div>
                <div>
                  <span className="font-mono text-xs font-black text-emerald-800 uppercase bg-emerald-100 px-3 py-1 rounded-full border border-emerald-300">
                    Inquiry Reference #{submittedInquiry.quoteNumber}
                  </span>
                  <h3 className="text-xl font-black text-emerald-950 mt-2">
                    Bulk Printing Inquiry Received!
                  </h3>
                  <p className="text-xs text-emerald-900 max-w-md mx-auto mt-1 leading-relaxed">
                    Thank you, <strong>{submittedInquiry.contactName}</strong>! We have logged your printing inquiry for{" "}
                    <strong>{submittedInquiry.totalQuantity} units</strong> of {item.name}. Our production team will review your artwork and reach out via <strong>{submittedInquiry.email}</strong> / <strong>{submittedInquiry.phone}</strong> with your digital proof and confirmation.
                  </p>
                  {submittedInquiry.customerRequirements && (
                    <div className="mt-3 rounded-xl bg-white/90 p-3.5 text-left border border-emerald-200 text-xs">
                      <p className="font-bold text-[11px] uppercase tracking-wider text-emerald-800 flex items-center gap-1.5">
                        <MessageSquare className="w-3.5 h-3.5 text-emerald-700" />
                        <span>Attached Requirements:</span>
                      </p>
                      <p className="text-emerald-950 mt-1 whitespace-pre-line italic">
                        &ldquo;{submittedInquiry.customerRequirements}&rdquo;
                      </p>
                    </div>
                  )}
                </div>
                <div className="flex flex-col sm:flex-row justify-center gap-3 pt-2">
                  <Link
                    href="/account/bulk-orders"
                    className="rounded-xl bg-emerald-700 px-5 py-2.5 text-xs font-bold text-white hover:bg-emerald-800 transition-colors shadow-sm"
                  >
                    View Inquiries in Account
                  </Link>
                  <button
                    type="button"
                    onClick={() => setSubmittedInquiry(null)}
                    className="rounded-xl border border-emerald-600 px-5 py-2.5 text-xs font-bold text-emerald-900 hover:bg-emerald-100 transition-colors"
                  >
                    Submit Another Inquiry
                  </button>
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

          {relatedItems.length > 0 && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-4">
              {relatedItems.map((rel) => {
                const relPrice = rel.displayPrice || rel.productId?.basePrice || 1299;
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
          )}
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
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-white/95 border-t border-gray-200 p-3 px-4 backdrop-blur-md shadow-2xl md:hidden pb-safe animate-in slide-in-from-bottom duration-200">
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
      <BulkQuoteModal
        isOpen={isBulkQuoteOpen}
        onClose={() => setIsBulkQuoteOpen(false)}
        productName={item?.name || "Custom Apparel"}
        productId={product?._id}
        catalogItemId={item?._id}
        minQuantity={effectiveMOQ}
        customerRequirements={customizationNotes}
        selectedColor={selectedColor}
      />
      <ImageLightboxModal isOpen={isLightboxOpen} onClose={() => setIsLightboxOpen(false)} images={galleryImages} currentIndex={activeImageIndex} onIndexChange={setActiveImageIndex} />
    </main>
  );
}
