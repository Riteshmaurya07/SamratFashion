/* eslint-disable @next/next/no-img-element */
"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Sparkles,
  Star,
  Truck,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Upload,
  FileText,
  CheckCircle2,
  ShoppingCart,
  Ruler,
  AlertCircle,
  Building,
  ChevronDown,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/useAuthStore";
import { useCartStore } from "@/store/useCartStore";
import { trackEvent } from "@/lib/analytics";
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
  description?: string;
  basePrice: number;
  mrp?: number;
  fabric?: string;
  gsm?: number;
  fit?: string;
  images: string[];
  variants: Variant[];
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
  placementTemplateId?: PlacementTemplate;
  placementTemplateIds?: PlacementTemplate[];
  effectiveMOQ?: number;
};

// Volume Pricing Tiers Calculation Template
const VOLUME_TIERS = [
  { min: 2, max: 2, label: "2 pcs", discount: 0, tag: "Base" },
  { min: 3, max: 5, label: "3–5 pcs", discount: 0.12, tag: "12% less" },
  { min: 6, max: 10, label: "6–10 pcs", discount: 0.24, tag: "24% less" },
  { min: 11, max: 14, label: "11–14 pcs", discount: 0.27, tag: "27% less" },
  { min: 15, max: 19, label: "15–19 pcs", discount: 0.28, tag: "28% less" },
  { min: 20, max: 29, label: "20–29 pcs", discount: 0.32, tag: "32% less" },
  { min: 30, max: 49, label: "30–49 pcs", discount: 0.35, tag: "35% less" },
  { min: 50, max: 75, label: "50–75 pcs", discount: 0.39, tag: "39% less" },
  { min: 76, max: 1000, label: "76–100 pcs", discount: 0.43, tag: "43% less" },
];

export default function CustomPrintCatalogDetailClient({ item }: { item: CatalogItem }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuthStore();
  const { addItem } = useCartStore();

  const product = item?.productId || {
    _id: "prod-1",
    name: item.name,
    basePrice: item.displayPrice || 410,
    images: [],
    variants: [],
  };

  // 1. DYNAMIC COLOR VARIANTS (Loaded directly from backend product variants)
  const productColorSwatches = useMemo(() => {
    const map = new Map<
      string,
      {
        name: string;
        hex: string;
        frontImage: string;
        backImage: string;
        sizes: string[];
        variants: Variant[];
      }
    >();

    const rawVariants = product?.variants || [];

    rawVariants
      .filter((v) => v.isAvailable !== false && v.color)
      .forEach((v) => {
        const colorName = v.color!.trim();
        const key = colorName.toLowerCase();
        const front = v.images?.[0] || item.mockupImageUrl || "/images/custom_polo_black_mockup.png";
        const back = v.images?.[1] || item.backMockupImageUrl || front;

        if (!map.has(key)) {
          map.set(key, {
            name: colorName,
            hex: v.hexCode || "#18181b",
            frontImage: front,
            backImage: back,
            sizes: v.size ? [v.size] : [],
            variants: [v],
          });
        } else {
          const entry = map.get(key)!;
          if (v.size && !entry.sizes.includes(v.size)) {
            entry.sizes.push(v.size);
          }
          entry.variants.push(v);
        }
      });

    // Fallback if no variants in database
    if (map.size === 0) {
      map.set("standard", {
        name: "Standard",
        hex: "#18181b",
        frontImage: item.mockupImageUrl || "/images/custom_polo_black_mockup.png",
        backImage: item.backMockupImageUrl || item.mockupImageUrl || "/images/custom_polo_black_mockup.png",
        sizes: ["S", "M", "L", "XL", "2XL"],
        variants: [],
      });
    }

    return Array.from(map.values());
  }, [product.variants, item.mockupImageUrl, item.backMockupImageUrl]);

  // Active Color Selection
  const initialColorFromUrl = searchParams.get("color");
  const [selectedColor, setSelectedColor] = useState<string>(() => {
    if (initialColorFromUrl && productColorSwatches.some((c) => c.name.toLowerCase() === initialColorFromUrl.toLowerCase())) {
      return initialColorFromUrl;
    }
    return productColorSwatches[0]?.name || "Standard";
  });

  // Ensure active color matches available product swatches
  useEffect(() => {
    if (productColorSwatches.length > 0 && !productColorSwatches.some((c) => c.name.toLowerCase() === selectedColor.toLowerCase())) {
      setSelectedColor(productColorSwatches[0].name);
    }
  }, [productColorSwatches, selectedColor]);

  // Active Color Variant Object
  const activeColorObject = useMemo(() => {
    return (
      productColorSwatches.find((c) => c.name.toLowerCase() === selectedColor.toLowerCase()) ||
      productColorSwatches[0]
    );
  }, [productColorSwatches, selectedColor]);

  // Gallery and Active View State (FRONT / BACK)
  const [activeSide, setActiveSide] = useState<"FRONT" | "BACK">("FRONT");
  const [activeGalleryIndex, setActiveGalleryIndex] = useState(0);

  // Active Display Image (Changes as active color or front/back changes)
  const displayImage = useMemo(() => {
    if (!activeColorObject) return item.mockupImageUrl;
    if (activeSide === "BACK") {
      return activeColorObject.backImage || activeColorObject.frontImage;
    }
    return activeColorObject.frontImage;
  }, [activeSide, activeColorObject, item.mockupImageUrl]);

  // Gallery Thumbnails (Front, Back, and any additional detail shots)
  const galleryThumbnails = useMemo(() => {
    const list: { name: string; side: "FRONT" | "BACK"; img: string }[] = [];
    if (activeColorObject) {
      list.push({ name: `${activeColorObject.name} Front`, side: "FRONT", img: activeColorObject.frontImage });
      if (activeColorObject.backImage && activeColorObject.backImage !== activeColorObject.frontImage) {
        list.push({ name: `${activeColorObject.name} Back`, side: "BACK", img: activeColorObject.backImage });
      }
    }
    if (item.backMockupImageUrl && !list.some((x) => x.img === item.backMockupImageUrl)) {
      list.push({ name: "Back View", side: "BACK", img: item.backMockupImageUrl });
    }
    if (product.images && product.images.length > 0) {
      product.images.forEach((img, idx) => {
        if (!list.some((x) => x.img === img)) {
          list.push({ name: `Detail ${idx + 1}`, side: "FRONT", img });
        }
      });
    }
    return list;
  }, [activeColorObject, item.backMockupImageUrl, product.images]);

  // Dynamic Available Sizes (Derived from active color variant or product)
  const availableSizes = useMemo(() => {
    const raw =
      activeColorObject?.sizes?.length > 0
        ? activeColorObject.sizes
        : (product?.variants || []).map((v) => v.size).filter(Boolean) as string[];
    const standardOrder = ["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL"];
    const unique = Array.from(new Set(raw));
    if (unique.length === 0) return ["S", "M", "L", "XL", "2XL"];
    return unique.sort((a, b) => {
      const idxA = standardOrder.indexOf(a.toUpperCase());
      const idxB = standardOrder.indexOf(b.toUpperCase());
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.localeCompare(b);
    });
  }, [activeColorObject, product.variants]);

  // 2. PRICING CALCULATIONS (Derived from backend basePrice / displayPrice)
  const baseSamplePrice = useMemo(() => {
    const raw = item.displayPrice || product.basePrice || 410;
    if (raw > 1000) return Math.round(raw / 2 * 10) / 10;
    return Math.round((raw / (1 - 0.43)) * 10) / 10;
  }, [item.displayPrice, product.basePrice]);

  const mrpPerPiece = useMemo(() => {
    if (product.mrp && product.mrp > 0) {
      return product.mrp > 10000 ? Math.round(product.mrp / 100) : product.mrp;
    }
    return Math.round(baseSamplePrice * 1.15);
  }, [product.mrp, baseSamplePrice]);

  // Quantity State (Default 2 pcs sample)
  const [quantity, setQuantity] = useState<number>(2);

  // Multi-Size Distribution State
  const [sizeAllocations, setSizeAllocations] = useState<Record<string, number>>({});

  // Initialize size allocations to match quantity
  useEffect(() => {
    setSizeAllocations((prev) => {
      const next: Record<string, number> = {};
      availableSizes.forEach((sz) => {
        next[sz] = prev[sz] || 0;
      });

      const total = Object.values(next).reduce((a, b) => a + b, 0);
      if (total === 0 && availableSizes.length > 0) {
        if (quantity === 2 && availableSizes.length >= 2) {
          next[availableSizes[0]] = 1;
          next[availableSizes[1]] = 1;
        } else {
          next[availableSizes[0]] = quantity;
        }
      }
      return next;
    });
  }, [availableSizes, quantity]);

  // Logo Upload & Customization Notes State
  const [uploadedLogo, setUploadedLogo] = useState<string | null>(null);
  const [designFiles, setDesignFiles] = useState<{ url: string; fileType: string; filename: string }[]>([]);
  const [customizationNotes, setCustomizationNotes] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Modals
  const [isSizeGuideOpen, setIsSizeGuideOpen] = useState(false);
  const [isBulkQuoteOpen, setIsBulkQuoteOpen] = useState(false);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);

  // UI & Loading States
  const [isAddingToCart, setIsAddingToCart] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [showStickyBar, setShowStickyBar] = useState(false);
  const [isInfoExpanded, setIsInfoExpanded] = useState(false);

  // Active Tier Computation
  const activeTier = useMemo(() => {
    return (
      VOLUME_TIERS.find((t) => quantity >= t.min && quantity <= t.max) ||
      VOLUME_TIERS[VOLUME_TIERS.length - 1]
    );
  }, [quantity]);

  const unitPrice = useMemo(() => {
    const discounted = baseSamplePrice * (1 - activeTier.discount);
    return Math.round(discounted * 10) / 10;
  }, [baseSamplePrice, activeTier.discount]);

  const totalPrice = useMemo(() => {
    return Math.round(unitPrice * quantity);
  }, [unitPrice, quantity]);

  const totalMrp = useMemo(() => {
    return Math.round(mrpPerPiece * quantity);
  }, [mrpPerPiece, quantity]);

  const discountPercent = useMemo(() => {
    if (totalMrp > totalPrice) {
      return Math.round(((totalMrp - totalPrice) / totalMrp) * 100);
    }
    return 11;
  }, [totalMrp, totalPrice]);

  // Next tier upsell computation
  const nextTierInfo = useMemo(() => {
    const currentIdx = VOLUME_TIERS.findIndex((t) => t === activeTier);
    if (currentIdx !== -1 && currentIdx < VOLUME_TIERS.length - 1) {
      const next = VOLUME_TIERS[currentIdx + 1];
      const diff = next.min - quantity;
      const nextUnitPrice = Math.round(baseSamplePrice * (1 - next.discount) * 10) / 10;
      const savingsPerPc = Math.round((unitPrice - nextUnitPrice) * 10) / 10;
      return {
        addPieces: diff,
        targetQty: next.min,
        nextPrice: nextUnitPrice,
        savingsPerPc: savingsPerPc > 0 ? savingsPerPc : 84.5,
      };
    }
    return null;
  }, [activeTier, quantity, baseSamplePrice, unitPrice]);

  // Total allocated sizes count
  const allocatedCount = useMemo(() => {
    return Object.values(sizeAllocations).reduce((acc, curr) => acc + curr, 0);
  }, [sizeAllocations]);

  // Steppers
  const handleQuantityStepper = (delta: number) => {
    const newQty = Math.max(2, Math.min(1000, quantity + delta));
    setQuantity(newQty);
  };

  const handleSelectTier = (tierMin: number) => {
    setQuantity(tierMin);
    const half = Math.floor(tierMin / 2);
    if (availableSizes.length >= 2) {
      setSizeAllocations({
        [availableSizes[0]]: half,
        [availableSizes[1]]: tierMin - half,
      });
    } else if (availableSizes.length > 0) {
      setSizeAllocations({ [availableSizes[0]]: tierMin });
    }
  };

  const handleSizeAllocationStepper = (sizeId: string, delta: number) => {
    const currentVal = sizeAllocations[sizeId] || 0;
    const newVal = Math.max(0, currentVal + delta);
    const updated = { ...sizeAllocations, [sizeId]: newVal };
    setSizeAllocations(updated);

    const total = Object.values(updated).reduce((a, b) => a + b, 0);
    if (total > 0) {
      setQuantity(total);
    }
  };

  // Upload logo handler
  const handleFileUpload = async (file: File) => {
    if (file.size > 25 * 1024 * 1024) {
      setMessage({ text: "File exceeds 25 MB limit. Please upload a smaller file.", type: "error" });
      return;
    }

    setMessage({ text: "Uploading logo file...", type: "success" });
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
      setDesignFiles([
        {
          url: uploadedUrl,
          fileType: file.type || "image/png",
          filename: file.name,
        },
      ]);
      setMessage({ text: "Logo uploaded successfully! Preview updated.", type: "success" });
      setTimeout(() => setMessage(null), 3500);
    } catch {
      const localUrl = URL.createObjectURL(file);
      setUploadedLogo(localUrl);
      setDesignFiles([
        {
          url: localUrl,
          fileType: file.type || "image/png",
          filename: file.name,
        },
      ]);
      setMessage({ text: "Logo attached! Digital proof will be generated for WhatsApp approval.", type: "success" });
      setTimeout(() => setMessage(null), 3500);
    }
  };

  // Intersection observer for sticky buy bar
  useEffect(() => {
    const handleScroll = () => {
      setShowStickyBar(window.scrollY > 400);
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Add To Cart Handler
  const handleAddToCart = async () => {
    if (!user) {
      router.push(`/login?redirect=/custom-printing/${item.slug}`);
      return;
    }

    if (allocatedCount !== quantity) {
      setMessage({
        text: `Please allocate all ${quantity} pieces across sizes (currently ${allocatedCount} selected).`,
        type: "error",
      });
      return;
    }

    setIsAddingToCart(true);
    setMessage(null);

    try {
      // Find variant matching selected size & color
      const matchedVariant =
        activeColorObject?.variants?.find((v) => {
          return Object.keys(sizeAllocations).some((sz) => sizeAllocations[sz] > 0 && v.size === sz);
        }) || activeColorObject?.variants?.[0] || product.variants?.[0];

      const customConfigs = [
        {
          color: selectedColor,
          variantId: matchedVariant?._id || "default-var",
          sizeDistribution: Object.entries(sizeAllocations)
            .filter(([, qty]) => qty > 0)
            .map(([size, qty]) => ({ size, quantity: qty })),
        },
      ];

      await addItem(
        product._id,
        matchedVariant?._id || "default-var",
        quantity,
        undefined,
        true,
        customConfigs,
        designFiles,
        customizationNotes
      );

      setMessage({ text: `${quantity} ${item.name}(s) added to your cart!`, type: "success" });
      trackEvent("custom_print_request_submitted", { catalog_item: item.slug, has_artwork: !!uploadedLogo });
      router.push("/cart");
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setMessage({ text: e.response?.data?.message || "Failed to add to cart", type: "error" });
    } finally {
      setIsAddingToCart(false);
    }
  };

  // Dynamic fabric specs description
  const fabricDescription = useMemo(() => {
    if (product.fabric && product.gsm) {
      return `${product.gsm} GSM ${product.fabric}`;
    }
    const nameLower = item.name.toLowerCase();
    if (nameLower.includes("polo")) return "60% Matty, 40% Cotton Blend (200–220 GSM)";
    if (nameLower.includes("cotton") || nameLower.includes("pure")) return "100% Super-Combed Cotton (240–260 GSM)";
    if (nameLower.includes("dryfit") || nameLower.includes("poly") || nameLower.includes("sports")) return "100% Performance Micro-Poly Mesh (160–180 GSM)";
    if (nameLower.includes("hoodie") || nameLower.includes("fleece")) return "Heavyweight 320 GSM Cotton Fleece";
    return "100% Bio-Washed Combed Cotton";
  }, [product.fabric, product.gsm, item.name]);

  return (
    <main className="min-h-screen bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 pb-28 md:pb-24">
      {/* 1. Top Announcement Marquee */}
      <div className="bg-neutral-950 text-white text-[11px] sm:text-xs py-2 px-4 text-center font-medium tracking-wide flex items-center justify-center gap-4 flex-wrap border-b border-neutral-800">
        <span className="flex items-center gap-1.5 font-bold text-amber-300">
          <Sparkles className="w-3.5 h-3.5" />
          GET EXTRA 12% OFF · CODE: FIRSTORDER
        </span>
        <span className="hidden md:inline text-neutral-600">|</span>
        <span className="flex items-center gap-1">
          <Truck className="w-3.5 h-3.5 text-neutral-400" />
          Free Shipping Across India
        </span>
        <span className="hidden md:inline text-neutral-600">|</span>
        <span className="flex items-center gap-1 text-emerald-400 font-medium">
          <CheckCircle2 className="w-3.5 h-3.5" />
          Free WhatsApp Proof Before We Print
        </span>
        <span className="hidden lg:inline text-neutral-600">|</span>
        <span className="hidden lg:flex items-center gap-1 text-neutral-300">
          <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
          Trusted by 81,000+ Customers
        </span>
      </div>

      {/* Toast Notification */}
      {message && (
        <div
          role="alert"
          className={`fixed top-20 right-6 z-50 px-6 py-3.5 rounded-xl shadow-2xl text-white text-xs font-bold transition-all animate-in fade-in slide-in-from-top-2 duration-300 flex items-center gap-2 ${
            message.type === "success" ? "bg-neutral-900 border border-neutral-700" : "bg-red-600"
          }`}
        >
          {message.type === "success" ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <AlertCircle className="w-4 h-4" />}
          <span>{message.text}</span>
        </div>
      )}

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-8 sm:py-8">
        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" className="mb-6 flex text-xs text-neutral-500 dark:text-neutral-400">
          <ol className="flex items-center space-x-2">
            <li><Link href="/" className="hover:text-neutral-900 dark:hover:text-white transition-colors">Home</Link></li>
            <li><span className="mx-1">/</span></li>
            <li><Link href="/custom-printing" className="hover:text-neutral-900 dark:hover:text-white transition-colors">Custom Printing</Link></li>
            <li><span className="mx-1">/</span></li>
            <li className="font-bold text-neutral-900 dark:text-white truncate" aria-current="page">{item.name}</li>
          </ol>
        </nav>

        {/* 2-Column Product Studio Layout */}
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 items-start">
          
          {/* ================= LEFT COLUMN: Media Gallery (Changes with Variant!) ================= */}
          <div className="lg:col-span-6 flex flex-col gap-3 lg:sticky lg:top-24">
            {/* Main Image Showcase Card */}
            <div className="relative aspect-[4/5] max-h-[460px] sm:max-h-none w-full rounded-2xl overflow-hidden bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-sm group">
              <img
                src={displayImage}
                alt={`${item.name} in ${selectedColor}`}
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-102"
              />

              {/* Floating Front / Back View Switcher Pill */}
              <div className="absolute top-3 left-3 z-20 flex rounded-lg bg-neutral-900/80 backdrop-blur-md p-0.5 border border-white/10 shadow-sm">
                <button
                  type="button"
                  onClick={() => setActiveSide("FRONT")}
                  className={`rounded px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
                    activeSide === "FRONT"
                      ? "bg-white text-neutral-950 shadow-xs font-black"
                      : "text-neutral-300 hover:text-white"
                  }`}
                >
                  Front
                </button>
                <button
                  type="button"
                  onClick={() => setActiveSide("BACK")}
                  className={`rounded px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
                    activeSide === "BACK"
                      ? "bg-white text-neutral-950 shadow-xs font-black"
                      : "text-neutral-300 hover:text-white"
                  }`}
                >
                  Back
                </button>
              </div>

              {/* Navigation Arrows */}
              <button
                type="button"
                onClick={() => setActiveSide(activeSide === "FRONT" ? "BACK" : "FRONT")}
                className="absolute left-3 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-white/90 text-neutral-800 shadow-md flex items-center justify-center hover:bg-white transition-all cursor-pointer opacity-80 sm:opacity-0 group-hover:opacity-100"
                aria-label="Toggle front/back view"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => setActiveSide(activeSide === "FRONT" ? "BACK" : "FRONT")}
                className="absolute right-3 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-white/90 text-neutral-800 shadow-md flex items-center justify-center hover:bg-white transition-all cursor-pointer opacity-80 sm:opacity-0 group-hover:opacity-100"
                aria-label="Toggle front/back view"
              >
                <ChevronRight className="w-5 h-5" />
              </button>

              {/* Zoom Action */}
              <button
                type="button"
                onClick={() => setIsLightboxOpen(true)}
                className="absolute top-3 right-3 rounded-full bg-white/90 p-2 text-neutral-700 shadow-sm hover:bg-white transition-colors cursor-pointer"
                aria-label="Zoom image"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
            </div>

            {/* Gallery Thumbnails Strip (Shows Variant Views!) */}
            <div className="grid grid-cols-4 gap-2 pt-1">
              {galleryThumbnails.map((thumb, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    setActiveSide(thumb.side);
                    setActiveGalleryIndex(idx);
                  }}
                  className={`aspect-[4/5] rounded-xl overflow-hidden border-2 transition-all cursor-pointer ${
                    activeGalleryIndex === idx
                      ? "border-orange-500 ring-2 ring-orange-500/30 scale-102"
                      : "border-neutral-200 dark:border-neutral-800 hover:border-neutral-400"
                  }`}
                >
                  <img src={thumb.img} alt={thumb.name} className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          </div>

          {/* ================= RIGHT COLUMN: Variant Selection & Pricing Form ================= */}
          <div className="lg:col-span-6 flex flex-col space-y-6">
            
            {/* 1. Header & Rating Block */}
            <div>
              <h1 className="text-2xl sm:text-3xl font-black text-neutral-950 dark:text-white leading-snug tracking-tight">
                {item.name}
              </h1>

              <div className="mt-2.5 flex items-center gap-3 text-xs">
                <div className="flex items-center gap-1 text-amber-500">
                  <Star className="w-4 h-4 fill-amber-500 text-amber-500" />
                  <span className="font-bold text-neutral-900 dark:text-white">4.3</span>
                  <span className="text-neutral-500">(970 Reviews)</span>
                </div>
                <span className="text-neutral-300 dark:text-neutral-700">•</span>
                <span className="font-semibold text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded">
                  12,240+ Orders Delivered
                </span>
              </div>

              {/* Price Header */}
              <div className="mt-4 flex flex-wrap items-baseline gap-3 border-b border-neutral-200 dark:border-neutral-800 pb-5">
                <span className="text-3xl font-black text-neutral-950 dark:text-white">
                  ₹{totalPrice.toLocaleString("en-IN")}
                </span>
                <span className="text-lg text-neutral-400 line-through">
                  ₹{totalMrp.toLocaleString("en-IN")}
                </span>
                <span className="rounded bg-orange-600 text-white text-xs font-bold px-2 py-0.5 uppercase tracking-wider">
                  SAVE {discountPercent}%
                </span>
                <span className="text-xs text-neutral-500 ml-auto block w-full sm:w-auto">
                  Inclusive of All Taxes
                </span>
              </div>
            </div>

            {/* 2. CARD: "Select Colour Variant" (Populated directly from backend variants!) */}
            <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 p-5 space-y-4 shadow-xs">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-black uppercase tracking-wider text-neutral-900 dark:text-white block">
                    Select Colour Variant
                  </span>
                  <span className="text-[11px] text-neutral-500">
                    Switching colour updates garment image preview
                  </span>
                </div>
                <span className="rounded bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 px-2.5 py-0.5 text-xs font-bold">
                  {selectedColor}
                </span>
              </div>

              {/* Dynamic Swatches Grid */}
              <div className="flex flex-wrap items-center gap-2">
                {productColorSwatches.map((col) => {
                  const isSelected = selectedColor.toLowerCase() === col.name.toLowerCase();
                  return (
                    <button
                      key={col.name}
                      type="button"
                      onClick={() => {
                        setSelectedColor(col.name);
                        setActiveGalleryIndex(0);
                      }}
                      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                        isSelected
                          ? "border-neutral-900 dark:border-white bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white ring-2 ring-neutral-900 dark:ring-white shadow-xs"
                          : "border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:border-neutral-400"
                      }`}
                    >
                      <span
                        className="h-3.5 w-3.5 rounded-full border border-black/20 shrink-0"
                        style={{ backgroundColor: col.hex }}
                      />
                      <span>{col.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 3. CARD: "Quantity & Volume Pricing" */}
            <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 p-5 space-y-4 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-wider text-neutral-900 dark:text-white">
                  Quantity
                </span>
                <span className="rounded bg-orange-600 text-white px-2.5 py-0.5 text-xs font-bold">
                  {quantity} pcs
                </span>
              </div>

              {/* Stepper & Unit Price Row */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-neutral-800 p-3.5 rounded-xl border border-neutral-200 dark:border-neutral-700">
                <div className="flex items-center border border-neutral-300 dark:border-neutral-600 rounded-lg overflow-hidden w-36 bg-neutral-50 dark:bg-neutral-900">
                  <button
                    type="button"
                    onClick={() => handleQuantityStepper(-1)}
                    disabled={quantity <= 2}
                    className="w-10 h-10 flex items-center justify-center text-sm font-bold text-neutral-700 dark:text-neutral-200 hover:bg-neutral-200 dark:hover:bg-neutral-800 disabled:opacity-30 cursor-pointer"
                  >
                    -
                  </button>
                  <input
                    type="number"
                    min={2}
                    max={1000}
                    value={quantity}
                    onChange={(e) => setQuantity(Math.max(2, parseInt(e.target.value) || 2))}
                    className="w-16 h-10 text-center font-bold text-sm bg-transparent border-x border-neutral-300 dark:border-neutral-600 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => handleQuantityStepper(1)}
                    className="w-10 h-10 flex items-center justify-center text-sm font-bold text-neutral-700 dark:text-neutral-200 hover:bg-neutral-200 dark:hover:bg-neutral-800 cursor-pointer"
                  >
                    +
                  </button>
                </div>

                <div className="text-right">
                  <div className="text-base font-black text-neutral-950 dark:text-white">
                    ₹{unitPrice.toFixed(2)} <span className="text-xs font-normal text-neutral-500">per piece</span>
                  </div>
                  <div className="text-xs text-neutral-500">
                    ₹{totalPrice.toLocaleString("en-IN")} total
                  </div>
                </div>
              </div>

              {/* Quantity-Wise Price List Grid */}
              <div className="space-y-2 pt-1">
                <span className="text-[11px] font-bold text-neutral-500 uppercase tracking-wider block">
                  Quantity-wise price list
                </span>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                  {VOLUME_TIERS.map((tier) => {
                    const isSelected = activeTier === tier;
                    const tierUnitPrice = Math.round(baseSamplePrice * (1 - tier.discount) * 10) / 10;
                    return (
                      <button
                        key={tier.label}
                        type="button"
                        onClick={() => handleSelectTier(tier.min)}
                        className={`p-2.5 rounded-xl border text-center transition-all cursor-pointer ${
                          isSelected
                            ? "border-orange-500 bg-orange-50 dark:bg-orange-950/30 ring-1 ring-orange-500"
                            : "border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 hover:border-neutral-400"
                        }`}
                      >
                        <span className="block text-[11px] font-black text-neutral-900 dark:text-white">
                          {tier.label}
                        </span>
                        <span className="block text-xs font-black text-neutral-950 dark:text-white mt-0.5">
                          ₹{tierUnitPrice}
                        </span>
                        <span className={`block text-[9px] font-bold mt-0.5 ${tier.discount > 0 ? "text-emerald-600" : "text-neutral-400"}`}>
                          {tier.tag}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Dynamic Upsell Green Alert */}
              {nextTierInfo && (
                <div className="flex items-center justify-between gap-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 p-3 text-xs text-emerald-900 dark:text-emerald-200">
                  <span>
                    Add <strong>{nextTierInfo.addPieces} more piece</strong> → pay <strong>₹{nextTierInfo.nextPrice}/pc</strong> and save ₹{nextTierInfo.savingsPerPc} on every piece.
                  </span>
                  <button
                    type="button"
                    onClick={() => handleSelectTier(nextTierInfo.targetQty)}
                    className="rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-bold px-3 py-1.5 text-xs shrink-0 cursor-pointer transition-colors"
                  >
                    Make it {nextTierInfo.targetQty}
                  </button>
                </div>
              )}
            </div>

            {/* 4. CARD: "Available Sizes" (Specific to this variant/product!) */}
            <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 p-5 space-y-4 shadow-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-black uppercase tracking-wider text-neutral-900 dark:text-white">
                    T-shirt sizes
                  </span>
                  <span className={`rounded px-2 py-0.5 text-xs font-bold ${
                    allocatedCount === quantity
                      ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                      : "bg-neutral-200 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-300"
                  }`}>
                    {allocatedCount}/{quantity} Selected {allocatedCount === quantity && "✅"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsSizeGuideOpen(true)}
                  className="text-xs font-bold text-neutral-700 dark:text-neutral-300 hover:text-orange-600 flex items-center gap-1 cursor-pointer"
                >
                  <Ruler className="w-3.5 h-3.5" />
                  <span>Size chart</span>
                </button>
              </div>

              {/* Counters Grid for Available Sizes */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {availableSizes.map((sz) => {
                  const count = sizeAllocations[sz] || 0;
                  return (
                    <div
                      key={sz}
                      className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-2.5 flex flex-col items-center justify-between space-y-1.5"
                    >
                      <span className="text-xs font-bold text-neutral-800 dark:text-neutral-200">{sz}</span>
                      <div className="flex items-center border border-neutral-200 dark:border-neutral-700 rounded-lg overflow-hidden bg-neutral-50 dark:bg-neutral-900 w-full justify-between">
                        <button
                          type="button"
                          onClick={() => handleSizeAllocationStepper(sz, -1)}
                          disabled={count <= 0}
                          className="w-8 h-8 flex items-center justify-center font-bold text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 disabled:opacity-30 cursor-pointer"
                        >
                          -
                        </button>
                        <span className="font-mono font-bold text-xs">{count}</span>
                        <button
                          type="button"
                          onClick={() => handleSizeAllocationStepper(sz, 1)}
                          className="w-8 h-8 flex items-center justify-center font-bold text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 cursor-pointer"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Status Message */}
              <div className="text-xs">
                {allocatedCount === quantity ? (
                  <span className="text-emerald-700 dark:text-emerald-400 font-semibold flex items-center gap-1">
                    <CheckCircle2 className="w-4 h-4" /> Perfect! All {quantity} selected across sizes.
                  </span>
                ) : allocatedCount < quantity ? (
                  <span className="text-amber-700 dark:text-amber-400 font-medium">
                    ⚠️ Please allocate {quantity - allocatedCount} more piece(s) across sizes.
                  </span>
                ) : (
                  <span className="text-red-600 font-medium">
                    ⚠️ You have selected {allocatedCount} of {quantity} pieces. Please adjust counters.
                  </span>
                )}
              </div>
            </div>

            {/* 5. CARD: "Upload Your Logo & Customization Instructions" */}
            <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 p-5 space-y-4 shadow-xs">
              <div className="rounded-xl bg-neutral-900 dark:bg-neutral-800 text-white p-4 text-center space-y-1">
                <span className="text-sm font-black flex items-center justify-center gap-1.5">
                  <Upload className="w-4 h-4" /> Upload Your Logo for WhatsApp Proof
                </span>
                <p className="text-xs text-neutral-300">
                  Our design team will share a realistic 3D mockup before printing starts
                </p>
              </div>

              {/* File Dropzone */}
              <input
                type="file"
                ref={fileInputRef}
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    handleFileUpload(e.target.files[0]);
                  }
                }}
                accept="image/png,image/jpeg,image/svg+xml,application/pdf"
                className="hidden"
              />

              {uploadedLogo ? (
                <div className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-3.5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <img src={uploadedLogo} alt="Uploaded logo" className="h-10 w-10 object-contain rounded bg-neutral-100 p-1" />
                    <div>
                      <span className="text-xs font-bold text-neutral-900 dark:text-white block">Logo Attached ✓</span>
                      <span className="text-[11px] text-neutral-500">Ready for WhatsApp proof generation</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="text-xs font-bold text-orange-600 hover:underline cursor-pointer"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-neutral-300 dark:border-neutral-700 hover:border-orange-500 rounded-xl p-6 text-center cursor-pointer transition-colors bg-white dark:bg-neutral-800"
                >
                  <Upload className="w-6 h-6 text-neutral-400 mx-auto mb-2" />
                  <span className="text-xs font-bold text-neutral-800 dark:text-neutral-200 block">
                    Upload your logo (Optional)
                  </span>
                  <span className="text-[10px] text-neutral-400 block mt-0.5">
                    PNG, JPG, PDF, AI, CDR or SVG · up to 25 MB
                  </span>
                </div>
              )}

              {/* Optional Text Customization Note */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-neutral-700 dark:text-neutral-300">
                  Any Text or Customization Needed (Optional)
                </label>
                <textarea
                  rows={2}
                  value={customizationNotes}
                  onChange={(e) => setCustomizationNotes(e.target.value)}
                  placeholder="You can type any customization in design you need (e.g. front left chest logo, staff names, etc.)"
                  className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-800 p-3 text-xs text-neutral-900 dark:text-white placeholder:text-neutral-400 focus:border-orange-500 focus:outline-none"
                />
              </div>

              {/* Reassurance Banner */}
              <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 p-3.5 space-y-1 text-xs text-amber-900 dark:text-amber-200">
                <div className="flex items-center gap-1.5 font-bold">
                  <FileText className="w-4 h-4 text-amber-600" />
                  <span>We’ll Send Design for Approval After Order is Placed/Confirmed</span>
                </div>
                <p className="text-[11px] text-amber-800 dark:text-amber-300/80 leading-relaxed pl-5">
                  Don’t have a logo? No problem! Place your order with text only — our team will create and share a custom design for you.
                </p>
              </div>
            </div>

            {/* 6. PRIMARY ACTION: Add To Cart Button */}
            <div className="space-y-3 pt-2">
              <button
                type="button"
                onClick={handleAddToCart}
                disabled={isAddingToCart}
                className="w-full rounded-xl bg-neutral-950 hover:bg-neutral-800 dark:bg-orange-600 dark:hover:bg-orange-700 text-white py-4 px-6 text-sm font-black uppercase tracking-wider shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <ShoppingCart className="w-5 h-5" />
                <span>{isAddingToCart ? "Adding to Cart..." : `ADD TO CART · ₹${totalPrice.toLocaleString("en-IN")}`}</span>
              </button>

              <button
                type="button"
                onClick={() => setIsBulkQuoteOpen(true)}
                className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 py-3 text-xs font-bold text-neutral-800 dark:text-neutral-200 hover:bg-neutral-50 transition-colors cursor-pointer"
              >
                Request Custom Bulk Enterprise Quote (50+ pcs)
              </button>
            </div>
          </div>
        </div>

        {/* ================= BELOW THE FOLD: PrintMine Social Proof & Specs ================= */}
        
        {/* Brand Merchandising Feature Section */}
        <section className="mt-16 rounded-3xl bg-neutral-900 text-white p-8 sm:p-12">
          <div className="max-w-2xl space-y-3 mb-10">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-400">Garment Specifications</span>
            <h2 className="text-3xl font-black text-white">
              {item.name}
            </h2>
            <p className="text-xs sm:text-sm text-neutral-300 leading-relaxed">
              {item.description || "Direct from our in-house manufacturing and printing lab. High-density colorfast print with 50+ wash longevity."}
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-6">
            <div className="space-y-1">
              <span className="text-xs font-bold text-amber-400">✓ In-House Manufacturing</span>
              <p className="text-xs text-neutral-400">Directly stitched & printed, zero broker margins.</p>
            </div>
            <div className="space-y-1">
              <span className="text-xs font-bold text-amber-400">✓ Premium Fabric</span>
              <p className="text-xs text-neutral-400">{fabricDescription}</p>
            </div>
            <div className="space-y-1">
              <span className="text-xs font-bold text-amber-400">✓ Front & Back Print Zones</span>
              <p className="text-xs text-neutral-400">High-density DTF logo on chest and centered on back.</p>
            </div>
            <div className="space-y-1">
              <span className="text-xs font-bold text-amber-400">✓ 50+ Wash Longevity</span>
              <p className="text-xs text-neutral-400">Cured OEKO-TEX inks that do not crack or peel.</p>
            </div>
            <div className="space-y-1">
              <span className="text-xs font-bold text-amber-400">✓ Multiple Sizes Available</span>
              <p className="text-xs text-neutral-400">{availableSizes.join(", ")} regular fit.</p>
            </div>
            <div className="space-y-1">
              <span className="text-xs font-bold text-amber-400">✓ Doorstep Express Courier</span>
              <p className="text-xs text-neutral-400">Shipped with real-time Delhivery / BlueDart live tracking.</p>
            </div>
          </div>
        </section>

        {/* Customer Reviews */}
        <section className="mt-16 pt-12 border-t border-neutral-200 dark:border-neutral-800">
          <div className="flex items-center justify-between mb-8">
            <div>
              <span className="text-xs font-bold text-amber-500 uppercase tracking-wider flex items-center gap-1">
                <Star className="w-4 h-4 fill-amber-500 text-amber-500" />
                4.3 / 5 Customer Rating
              </span>
              <h2 className="text-2xl font-black text-neutral-950 dark:text-white mt-1">
                Customer Reviews & Verification
              </h2>
            </div>
            <span className="text-xs text-neutral-500 font-semibold">970+ Verified Orders</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                name: "Shesh P.",
                title: "Good looking",
                review: "Fabric handfeel and color fidelity match our brand guidelines. Fast delivery.",
                rating: 5,
                tag: "Verified Buyer",
              },
              {
                name: "Sameer V.",
                title: "Quality and follow-up was great",
                review: "The WhatsApp proof approval ensured our vector logo had perfect proportions.",
                rating: 5,
                tag: "Verified Corporate Client",
              },
              {
                name: "Moses L.",
                title: "Awesome printing quality",
                review: "Ordered 50 pieces for our team. The print is sharp and washes well.",
                rating: 5,
                tag: "Verified Bulk Order",
              },
            ].map((r, i) => (
              <div
                key={i}
                className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 p-5 space-y-3 flex flex-col justify-between"
              >
                <div className="space-y-2">
                  <div className="flex items-center gap-1 text-amber-400">
                    {Array.from({ length: r.rating }).map((_, idx) => (
                      <Star key={idx} className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                    ))}
                  </div>
                  <strong className="block text-xs font-bold text-neutral-900 dark:text-white">{r.title}</strong>
                  <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed italic">&ldquo;{r.review}&rdquo;</p>
                </div>
                <div className="pt-2 border-t border-neutral-200 dark:border-neutral-800 flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-neutral-800 dark:text-neutral-200">{r.name}</span>
                  <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded font-bold">{r.tag}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* More Information & Company Details Accordion */}
        <section className="mt-12 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 p-6">
          <button
            type="button"
            onClick={() => setIsInfoExpanded(!isInfoExpanded)}
            className="w-full flex items-center justify-between text-left text-sm font-bold text-neutral-900 dark:text-white cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <Building className="w-4 h-4 text-neutral-500" />
              <span>More Information & Manufacturer Details</span>
            </div>
            <ChevronDown className={`w-4 h-4 text-neutral-500 transition-transform ${isInfoExpanded ? "rotate-180" : ""}`} />
          </button>

          {isInfoExpanded && (
            <div className="mt-4 pt-4 border-t border-neutral-200 dark:border-neutral-800 text-xs text-neutral-600 dark:text-neutral-400 space-y-3 leading-relaxed">
              <div>
                <strong className="block text-neutral-900 dark:text-white">Manufactured & Packed By:</strong>
                <span>SamratFashion / HK Enterprises (GST: 22AAMFH1314C1Z4)</span>
              </div>
              <div>
                <strong className="block text-neutral-900 dark:text-white">Customer Care:</strong>
                <span>Phone: +91 62621 27724 / +91 62624 27271 · Email: order@samratfashion.com</span>
              </div>
              <div>
                <strong className="block text-neutral-900 dark:text-white">Country of Origin:</strong>
                <span>India</span>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* ================= FLOATING STICKY BUY BAR ================= */}
      {showStickyBar && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-neutral-900/95 backdrop-blur-md border-t border-neutral-200 dark:border-neutral-800 p-3 sm:p-4 shadow-2xl transition-all animate-in slide-in-from-bottom-4 duration-300">
          <div className="mx-auto max-w-7xl flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 truncate">
              <img src={displayImage} alt="Thumbnail" className="h-10 w-10 rounded-lg object-cover bg-neutral-100 shrink-0" />
              <div className="truncate">
                <span className="text-xs font-bold text-neutral-900 dark:text-white truncate block">
                  {selectedColor} · {quantity} pcs · {item.name}
                </span>
                <span className="text-[11px] text-neutral-500">
                  ₹{totalPrice.toLocaleString("en-IN")} <span className="line-through">₹{totalMrp.toLocaleString("en-IN")}</span> ({discountPercent}% OFF)
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleAddToCart}
              disabled={isAddingToCart}
              className="rounded-xl bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-200 text-white dark:text-neutral-900 font-bold text-xs px-5 sm:px-6 py-2.5 sm:py-3 shadow-md transition-all flex items-center gap-2 shrink-0 cursor-pointer min-h-[44px]"
            >
              <ShoppingCart className="w-4 h-4" />
              <span>{isAddingToCart ? "Adding..." : "Add to Cart"}</span>
            </button>
          </div>
        </div>
      )}

      {/* Modals */}
      <SizeGuideModal isOpen={isSizeGuideOpen} onClose={() => setIsSizeGuideOpen(false)} />
      {isBulkQuoteOpen && (
        <BulkQuoteModal
          isOpen={isBulkQuoteOpen}
          onClose={() => setIsBulkQuoteOpen(false)}
          productName={item.name}
          productId={product._id}
          catalogItemId={item._id}
          minQuantity={50}
        />
      )}
      <ImageLightboxModal
        isOpen={isLightboxOpen}
        onClose={() => setIsLightboxOpen(false)}
        images={[displayImage]}
        currentIndex={0}
        onIndexChange={() => {}}
      />
    </main>
  );
}
