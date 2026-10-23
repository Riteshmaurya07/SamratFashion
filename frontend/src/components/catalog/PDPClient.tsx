"use client";

import { useState, useEffect, useMemo } from "react";
import Image from "next/image";
import { Star, Heart, Truck, Ruler, ShoppingBag, Loader2, ZoomIn, X, ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/useAuthStore";
import { useCartStore } from "@/store/useCartStore";
import { useWishlistStore } from "@/store/useWishlistStore";
import ProductReviewsSection from "@/components/catalog/ProductReviewsSection";

interface Variant {
  _id?: string;
  size: string;
  color: string;
  hexCode?: string;
  sku: string;
  stock?: number;
  additionalPrice?: number;
  images?: string[];
  isAvailable?: boolean;
}

interface SizeGuideRow {
  size: string;
  chest?: number;
  length?: number;
  shoulder?: number;
}

interface Product {
  _id: string;
  slug: string;
  name: string;
  description: string;
  basePrice: number;
  mrp?: number;
  discount?: number;
  images: string[];
  variants: Variant[];
  offers?: Array<{ type: string; description: string }>;
  fabric?: string;
  gsm?: number;
  fit?: string;
  gender?: string;
  careInstructions?: string[];
  printTypes?: string[];
  sizeGuideTable?: SizeGuideRow[];
  averageRating: number;
  reviewCount: number;
}

const isVariantAvailable = (v?: Variant | null): boolean => {
  if (!v) return false;
  if (v.isAvailable === false) return false;
  if (v.stock !== undefined && v.stock <= 0) return false;
  return true;
};

const COLOR_HEX_MAP: Record<string, string> = {
  black: "#000000",
  white: "#FFFFFF",
  navy: "#000080",
  "navy blue": "#000080",
  red: "#FF0000",
  blue: "#0000FF",
  green: "#008000",
  yellow: "#FFFF00",
  grey: "#808080",
  gray: "#808080",
  beige: "#F5F5DC",
  pink: "#FFC0CB",
  purple: "#800080",
  brown: "#A52A2A",
  orange: "#FFA500",
  maroon: "#800000",
  olive: "#808000",
  charcoal: "#36454F",
};

const getHexForColor = (colorName: string, explicitHex?: string): string => {
  if (explicitHex && /^#[0-9A-F]{6}$/i.test(explicitHex)) {
    return explicitHex;
  }
  const normalized = (colorName || "").toLowerCase().trim();
  return COLOR_HEX_MAP[normalized] || "#e5e5e5";
};

export function PDPClient({ product, initialSelectedColor, initialSelectedSize }: { product: Product; initialSelectedColor?: string; initialSelectedSize?: string }) {
  const [selectedImage, setSelectedImage] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [isBuyNowLoading, setIsBuyNowLoading] = useState(false);

  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const { items: cartItems, addItem, isLoading: isCartLoading } = useCartStore();
  const { toggleWishlist, isInWishlist, isLoading: isWishlistLoading } = useWishlistStore();

  // Extract unique sizes and colors with hex codes
  const sizes = useMemo(
    () => Array.from(new Set(product.variants.map((v) => (v.size || "").trim()).filter(Boolean))),
    [product.variants]
  );
  const colors = useMemo(
    () =>
      Array.from(
        new Map(
          product.variants
            .filter((v) => Boolean(v.color?.trim()))
            .map((v) => [v.color.trim(), getHexForColor(v.color, v.hexCode)])
        ).entries()
      ),
    [product.variants]
  );

  // Initial color & size determination (failsafe to first variant if no stock)
  const initialColor = useMemo(() => {
    if (initialSelectedColor) {
      const decodedColor = decodeURIComponent(initialSelectedColor).toLowerCase();
      const matchedVariant = product.variants.find((v) => v.color?.toLowerCase() === decodedColor);
      if (matchedVariant?.color) return matchedVariant.color;
    }

    const firstAvail = product.variants.find((v) => isVariantAvailable(v));
    if (firstAvail?.color) return firstAvail.color;
    if (product.variants.length > 0 && product.variants[0].color) return product.variants[0].color;
    // colors[0][0] can be `undefined` if all variants have color: undefined.
    // Always return a string to keep selectedColor typed correctly.
    return (colors.length > 0 ? colors[0][0] : "") || "";
  }, [product.variants, colors, initialSelectedColor]);

  const [selectedColor, setSelectedColor] = useState<string>(initialColor);

  const initialSize = useMemo(() => {
    if (initialSelectedSize && sizes.includes(initialSelectedSize)) {
      return initialSelectedSize;
    }
    const targetColor = selectedColor || initialColor;
    // Guard: if no color is defined on any variant, skip color-based lookup.
    if (!targetColor) return sizes.length > 0 ? sizes[0] : "";
    const availForColor = product.variants.find((v) => v.color?.toLowerCase() === targetColor.toLowerCase() && isVariantAvailable(v));
    if (availForColor?.size) return availForColor.size;
    const anyForColor = product.variants.find((v) => v.color?.toLowerCase() === targetColor.toLowerCase());
    if (anyForColor?.size) return anyForColor.size;
    return sizes.length > 0 ? sizes[0] : "";
  }, [product.variants, selectedColor, initialColor, sizes, initialSelectedSize]);

  const [selectedSize, setSelectedSize] = useState<string>(initialSize);

  // Sync state if product props update or if selectedColor is uninitialized
  useEffect(() => {
    if (initialColor && (!selectedColor || !product.variants.some(v => v.color?.toLowerCase() === selectedColor.toLowerCase()))) {
      setSelectedColor(initialColor);
    }
  }, [initialColor, selectedColor, product.variants]);

  useEffect(() => {
    if (initialSize && (!selectedSize || !product.variants.some(v => v.size === selectedSize))) {
      setSelectedSize(initialSize);
    }
  }, [initialSize, selectedSize, product.variants]);

  // Derive the selected variant based on size and color (case-insensitive color matching)
  const selectedVariant = useMemo(() => {
    if (!selectedSize || !selectedColor) return null;
    return (
      product.variants.find(
        (v) => v.size === selectedSize && v.color?.toLowerCase() === selectedColor.toLowerCase()
      ) || null
    );
  }, [selectedSize, selectedColor, product.variants]);

  // Derive the wishlist state for the CURRENTLY SELECTED VARIANT.
  // NOTE: plain const (not useMemo) — isInWishlist is a stable Zustand function
  // reference, so useMemo([isInWishlist, ...]) would never recompute when store
  // items change. Instead we rely on Zustand re-rendering the component whenever
  // wishlistItems changes (via the wishlistItems subscription above), and this
  // const is recomputed fresh on every render.
  const currentVariantId = selectedVariant
    ? (selectedVariant._id ? selectedVariant._id.toString() : selectedVariant.sku)
    : null;

  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: wishlistItems triggers the re-render
  const isWishlisted = isInWishlist(product._id, currentVariantId);

  // Determine active Color-Specific Gallery Images with robust multi-tier fallback
  const currentGalleryImages = useMemo(() => {
    // 1. Selected Variant specific images
    if (selectedVariant?.images && selectedVariant.images.length > 0) {
      return selectedVariant.images;
    }

    // 2. Color group images matching selectedColor
    if (selectedColor) {
      const colorMatch = product.variants.find(
        (v) => v.color?.toLowerCase() === selectedColor.toLowerCase() && v.images && v.images.length > 0
      );
      if (colorMatch && colorMatch.images && colorMatch.images.length > 0) {
        return colorMatch.images;
      }
    }

    // 3. Any variant with non-empty images across the product
    const anyVariantWithImages = product.variants.find((v) => v.images && v.images.length > 0);
    if (anyVariantWithImages && anyVariantWithImages.images && anyVariantWithImages.images.length > 0) {
      return anyVariantWithImages.images;
    }

    // 4. Product root gallery images
    if (product.images && product.images.length > 0) {
      return product.images;
    }

    // 5. Default fallback image
    return ["https://images.unsplash.com/photo-1523381210434-271e8be1f52b?q=80&w=2070&auto=format&fit=crop"];
  }, [selectedVariant, selectedColor, product.variants, product.images]);

  // Color change handler - switches color and resets main image to index 0 of new color gallery
  const handleColorChange = (newColor: string) => {
    setSelectedColor(newColor);
    setSelectedImage(0); // Reset gallery index to 0 for new color
    const validVariantsForColor = product.variants.filter((v) => v.color === newColor && isVariantAvailable(v));
    const isCurrentSizeAvailable = validVariantsForColor.some((v) => v.size === selectedSize);

    let newSize = selectedSize;
    if (!isCurrentSizeAvailable && validVariantsForColor.length > 0) {
      newSize = validVariantsForColor[0].size;
      setSelectedSize(newSize);
    }

    // Update URL to reflect selected color and size so it persists on refresh
    if (typeof window !== "undefined") {
      const newParams = new URLSearchParams(window.location.search);
      newParams.set("color", newColor);
      newParams.set("size", newSize);
      router.replace(`?${newParams.toString()}`, { scroll: false });
    }
  };

  const handleSizeChange = (newSize: string) => {
    setSelectedSize(newSize);
    if (typeof window !== "undefined") {
      const newParams = new URLSearchParams(window.location.search);
      newParams.set("size", newSize);
      router.replace(`?${newParams.toString()}`, { scroll: false });
    }
  };

  const isSelectedVariantAvailable = isVariantAvailable(selectedVariant);

  // Dynamic price calculation taking variant additionalPrice into account
  const currentPrice = useMemo(() => {
    const base = product.basePrice || 0;
    const addPrice = selectedVariant?.additionalPrice || 0;
    return Math.round(base + addPrice);
  }, [product.basePrice, selectedVariant]);

  const displayMrp = useMemo(() => {
    if (!product.mrp) return undefined;
    return Math.round(product.mrp);
  }, [product.mrp]);

  // Derive if the current selected variant is in the cart
  const isInCart = useMemo(() => {
    if (!selectedVariant) return false;
    return cartItems.some((item) => {
      const pId = typeof item.productId === "object" ? item.productId?._id : item.productId;
      const vId = item.variantId;
      const matchesProd = pId === product._id;
      const matchesVariant =
        vId === selectedVariant._id ||
        vId === selectedVariant.sku ||
        (item.variantDetails?.size === selectedVariant.size && item.variantDetails?.color === selectedColor);
      return matchesProd && matchesVariant;
    });
  }, [cartItems, product._id, selectedVariant, selectedColor]);

  const handleAddToCart = async () => {
    if (!isAuthenticated) {
      router.push(`/login?redirect=/shop/${product.slug}`);
      return;
    }
    if (isInCart) {
      router.push("/cart");
      return;
    }
    if (!selectedVariant || !isSelectedVariantAvailable) {
      alert("Please select an available size and color.");
      return;
    }
    if (selectedVariant.stock !== undefined && selectedVariant.stock < quantity) {
      alert("Not enough stock available.");
      return;
    }

    try {
      const variantIdToUse = selectedVariant._id ? selectedVariant._id.toString() : selectedVariant.sku;
      await addItem(product._id, variantIdToUse, quantity);

      // Analytics event: add_to_cart
      import("@/lib/analytics").then(({ trackAddToCart }) => {
        trackAddToCart({
          id: product._id,
          name: product.name,
          price: product.basePrice,
          quantity,
          variantSize: selectedVariant.size,
          variantColor: selectedColor,
        });
      });
    } catch (error) {
      console.error(error);
    }
  };

  // Track PDP View Event on Mount
  useEffect(() => {
    if (product) {
      import("@/lib/analytics").then(({ trackProductView }) => {
        trackProductView({
          id: product._id,
          name: product.name,
          price: product.basePrice,
        });
      });
    }
  }, [product]);

  const handleBuyNow = async () => {
    if (!isAuthenticated) {
      router.push(`/login?redirect=/shop/${product.slug}`);
      return;
    }
    if (!selectedVariant || !isSelectedVariantAvailable) {
      alert("Please select an available size and color.");
      return;
    }
    if (selectedVariant.stock !== undefined && selectedVariant.stock < quantity) {
      alert("Not enough stock available.");
      return;
    }

    setIsBuyNowLoading(true);
    try {
      const variantIdToUse = selectedVariant._id ? selectedVariant._id.toString() : selectedVariant.sku;
      await addItem(product._id, variantIdToUse, quantity);
      router.push("/cart");
    } catch (error) {
      console.error(error);
    } finally {
      setIsBuyNowLoading(false);
    }
  };

  const handleWishlistToggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!isAuthenticated) {
      router.push(`/login?redirect=/shop/${product.slug}`);
      return;
    }
    // Always use the CURRENT variant — currentVariantId updates whenever the user
    // switches color or size, so there is no stale-closure risk here.
    try {
      await toggleWishlist(product._id, currentVariantId);
    } catch (error) {
      console.error(error);
    }
  };

  // Lightbox helpers
  const openLightbox = (idx: number) => {
    setLightboxIndex(idx);
    setIsLightboxOpen(true);
  };
  const closeLightbox = () => setIsLightboxOpen(false);
  const lightboxPrev = () => setLightboxIndex((i) => (i - 1 + currentGalleryImages.length) % currentGalleryImages.length);
  const lightboxNext = () => setLightboxIndex((i) => (i + 1) % currentGalleryImages.length);

  return (
    <>
      {/* Lightbox Modal */}
      {isLightboxOpen && (
        <div
          className="fixed inset-0 z-[999] flex items-center justify-center bg-black/90 backdrop-blur-sm"
          onClick={closeLightbox}
        >
          <button
            onClick={closeLightbox}
            className="absolute top-5 right-5 text-white/80 hover:text-white bg-white/10 rounded-full p-2 transition-all hover:bg-white/20 z-10"
            aria-label="Close lightbox"
          >
            <X className="w-6 h-6" />
          </button>
          {currentGalleryImages.length > 1 && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); lightboxPrev(); }}
                className="absolute left-4 top-1/2 -translate-y-1/2 text-white/80 hover:text-white bg-white/10 rounded-full p-3 transition-all hover:bg-white/20 z-10"
                aria-label="Previous image"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); lightboxNext(); }}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-white/80 hover:text-white bg-white/10 rounded-full p-3 transition-all hover:bg-white/20 z-10"
                aria-label="Next image"
              >
                <ChevronRight className="w-6 h-6" />
              </button>
            </>
          )}
          <div
            className="relative w-full max-w-2xl max-h-[90vh] mx-6"
            onClick={(e) => e.stopPropagation()}
          >
            <Image
              src={currentGalleryImages[lightboxIndex] || currentGalleryImages[0]}
              alt={`${product.name} – full view`}
              width={900}
              height={1200}
              className="object-contain w-full max-h-[90vh] rounded-lg select-none"
              priority
            />
            {currentGalleryImages.length > 1 && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
                {currentGalleryImages.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setLightboxIndex(i)}
                    className={`w-1.5 h-1.5 rounded-full transition-all ${
                      i === lightboxIndex ? "bg-white scale-125" : "bg-white/40 hover:bg-white/70"
                    }`}
                    aria-label={`View image ${i + 1}`}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

    <div className="flex flex-col lg:flex-row gap-8 lg:gap-10 max-w-container-max mx-auto w-full pb-28 lg:pb-0">

      {/* ─── Image Gallery ─── */}
      <div className="w-full lg:w-[52%] flex flex-col-reverse md:flex-row gap-3 md:gap-4">

        {/* ── Thumbnails ── */}
        {/* Desktop: vertical column on left │ Mobile: horizontal row below main image */}
        <div
          className="
            flex md:flex-col gap-2.5
            overflow-x-auto md:overflow-y-auto md:overflow-x-hidden
            hide-scrollbar
            shrink-0
            md:w-[78px]
            md:max-h-[540px]
          "
        >
          {currentGalleryImages.map((img, idx) => (
            <button
              key={`thumb-${idx}`}
              onClick={() => setSelectedImage(idx)}
              aria-label={`View image ${idx + 1}`}
              className={`
                relative shrink-0
                w-[72px] h-[90px] md:w-[78px] md:h-[98px]
                rounded-lg overflow-hidden
                border-2 transition-all duration-200
                group
                ${
                  selectedImage === idx
                    ? "border-on-surface shadow-sm"
                    : "border-outline-variant/30 hover:border-outline-variant/70"
                }
              `}
            >
              <Image
                src={img}
                alt={`${product.name} thumbnail ${idx + 1}`}
                fill
                className="object-cover group-hover:scale-105 transition-transform duration-300"
              />
              {selectedImage === idx && (
                <div className="absolute inset-0 ring-1 ring-inset ring-on-surface/10 rounded-md pointer-events-none" />
              )}
            </button>
          ))}
        </div>

        {/* ── Main Image ── */}
        <div className="relative flex-1 group">
          {/* Image container */}
          <div
            className="
              relative w-full
              aspect-[4/5]
              bg-surface-container-low
              rounded-xl overflow-hidden
              border border-outline-variant/20
              shadow-sm
              cursor-zoom-in
            "
            onClick={() => openLightbox(selectedImage)}
          >
            <Image
              src={currentGalleryImages[selectedImage] || currentGalleryImages[0]}
              alt={product.name}
              fill
              className="object-contain transition-all duration-500 ease-in-out group-hover:scale-[1.03]"
              priority
              sizes="(max-width: 768px) 100vw, 55vw"
            />

            {/* Gradient overlay at bottom – subtle */}
            <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-black/5 to-transparent pointer-events-none rounded-b-xl" />

            {/* ── Zoom icon ── */}
            <button
              onClick={(e) => { e.stopPropagation(); openLightbox(selectedImage); }}
              className="
                absolute top-3 left-3
                bg-surface-container-lowest/75 backdrop-blur-sm
                rounded-full p-2
                text-on-surface/60 hover:text-on-surface
                opacity-0 group-hover:opacity-100
                transition-all duration-200
                shadow-sm
                z-10
              "
              aria-label="View fullscreen"
            >
              <ZoomIn className="w-4 h-4" />
            </button>

            {/* ── Wishlist / heart button ── */}
            <button
              disabled={isWishlistLoading}
              onClick={(e) => { e.stopPropagation(); handleWishlistToggle(e); }}
              className="
                absolute top-3 right-3
                bg-surface-container-lowest/80 backdrop-blur-sm
                p-2.5 rounded-full
                text-on-surface hover:text-red-500
                hover:scale-110 active:scale-90
                transition-all duration-200
                shadow-md
                disabled:opacity-50
                z-10
              "
              aria-label={isWishlisted ? "Remove from wishlist" : "Add to wishlist"}
            >
              <Heart
                className={`w-5 h-5 transition-all duration-200 ${
                  isWishlisted ? "fill-red-500 text-red-500 scale-110" : ""
                }`}
              />
            </button>

            {/* ── Image counter dot indicators ── */}
            {currentGalleryImages.length > 1 && (
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5 md:hidden">
                {currentGalleryImages.map((_, i) => (
                  <button
                    key={i}
                    onClick={(e) => { e.stopPropagation(); setSelectedImage(i); }}
                    className={`w-1.5 h-1.5 rounded-full transition-all ${
                      i === selectedImage
                        ? "bg-on-surface scale-125"
                        : "bg-on-surface/30 hover:bg-on-surface/60"
                    }`}
                    aria-label={`Image ${i + 1}`}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Product Details Column */}
      <div className="w-full lg:w-[48%] flex flex-col pt-1 lg:pt-4 pr-0 lg:pr-4 space-y-6">
        {/* Breadcrumb Bar */}
        <div className="flex items-center gap-2 text-on-surface-variant font-mono text-xs uppercase tracking-wider">
          <span className="hover:text-primary transition-colors cursor-pointer" onClick={() => router.push("/shop")}>STREETWEAR</span>
          <span className="text-neutral-400">/</span>
          <span className="text-on-surface font-bold truncate max-w-[280px]">{product.name}</span>
        </div>

        {/* Title & Ratings */}
        <div className="space-y-2 border-b border-outline-variant/30 pb-5">
          <h1 className="font-headline-lg text-2xl sm:text-3xl lg:text-4xl font-black text-on-surface tracking-tight uppercase leading-tight">
            {product.name}
          </h1>

          <div className="flex items-center gap-4 text-xs font-mono">
            {product.averageRating > 0 && (
              <div className="flex items-center gap-1.5 text-neutral-800 bg-surface-container px-2.5 py-1 rounded-sm">
                <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                <span className="font-bold">{product.averageRating.toFixed(1)}</span>
                <span className="text-neutral-400">({product.reviewCount || 0} reviews)</span>
              </div>
            )}
            <span className="text-neutral-500 font-mono uppercase tracking-wider text-[11px]">
              {product.fit || "OVERSIZED BOXY FIT"} &bull; {product.gsm ? `${product.gsm} GSM` : "240 GSM"}
            </span>
          </div>
        </div>

        {/* Price Row */}
        <div className="flex items-baseline gap-3.5 pt-1">
          <span className="font-mono text-3xl sm:text-4xl font-black text-on-surface tracking-tight">
            ₹{currentPrice.toLocaleString('en-IN')}
          </span>
          {displayMrp && displayMrp > currentPrice && (
            <div className="flex items-center gap-2.5 font-mono">
              <span className="text-neutral-400 line-through text-base">₹{displayMrp.toLocaleString('en-IN')}</span>
              <span className="bg-emerald-100 text-emerald-800 text-xs px-2 py-0.5 rounded-xs font-bold">
                {product.discount ? `${product.discount}% OFF` : `${Math.round(((displayMrp - currentPrice) / displayMrp) * 100)}% OFF`}
              </span>
            </div>
          )}
          <span className="font-mono text-neutral-400 text-xs ml-auto">(INCL. TAXES)</span>
        </div>

        {/* Color Selection */}
        <div className="space-y-2.5 pt-2">
          <div className="flex justify-between items-center text-xs font-mono">
            <span className="font-bold uppercase tracking-wider text-on-surface">
              COLOR: <span className="text-primary">{selectedColor}</span>
            </span>
          </div>
          <div className="flex flex-wrap gap-2.5">
            {colors.length === 1 ? (
              <div className="flex items-center gap-2 px-3 py-1.5 border border-outline-variant rounded-md bg-surface-container font-mono text-xs">
                <span className="w-3 h-3 rounded-full border border-black/10" style={{ backgroundColor: colors[0][1] }} />
                <span>{colors[0][0]}</span>
              </div>
            ) : (
              colors.map(([color, hex], idx) => {
                const isSelected = selectedColor === color;
                return (
                  <button
                    key={`color-${color || idx}`}
                    type="button"
                    onClick={() => handleColorChange(color)}
                    aria-label={`${color}, ${isSelected ? "selected" : "available"}`}
                    className={`w-9 h-9 rounded-full border-2 transition-all relative ${
                      isSelected ? "border-neutral-900 ring-2 ring-primary ring-offset-2 scale-105" : "border-outline-variant/60 hover:border-neutral-900"
                    }`}
                    style={{ backgroundColor: hex }}
                    title={color}
                  />
                );
              })
            )}
          </div>
        </div>

        {/* Size Selection */}
        <div className="space-y-2.5 pt-2">
          <div className="flex justify-between items-center text-xs font-mono">
            <span className="font-bold uppercase tracking-wider text-on-surface">
              SELECT SIZE: <span className="text-primary">{selectedSize}</span>
            </span>
            {product.sizeGuideTable && product.sizeGuideTable.length > 0 && (
              <button
                type="button"
                onClick={() => alert(`Size Guide (inches):\n` + product.sizeGuideTable?.map(r => `${r.size}: Chest ${r.chest || '-'}", Length ${r.length || '-'}", Shoulder ${r.shoulder || '-'}"`).join('\n'))}
                className="text-primary font-mono text-xs flex items-center gap-1 hover:underline cursor-pointer uppercase font-bold"
              >
                <Ruler className="w-3.5 h-3.5" /> SIZE CHART
              </button>
            )}
          </div>

          <div className="grid grid-cols-5 sm:grid-cols-6 gap-2">
            {sizes.map((size, idx) => {
              const isSelected = selectedSize === size;
              const variantForSize = product.variants.find(v => v.size === size && v.color === selectedColor);
              const isAvailable = isVariantAvailable(variantForSize);

              return (
                <button
                  key={`size-${size || idx}`}
                  type="button"
                  disabled={!isAvailable}
                  onClick={() => handleSizeChange(size)}
                  className={`py-2.5 rounded-md border font-mono text-xs transition-colors uppercase min-h-[44px] flex items-center justify-center ${
                    isSelected
                      ? "border-neutral-900 bg-neutral-900 text-white font-bold shadow-xs"
                      : !isAvailable
                        ? "border-outline-variant/30 bg-surface-container text-neutral-400 line-through cursor-not-allowed opacity-50"
                        : "border-outline-variant/60 hover:border-neutral-900 text-on-surface bg-surface-container-lowest"
                  }`}
                >
                  {size}
                </button>
              );
            })}
          </div>
          {selectedVariant && selectedVariant.stock !== undefined && selectedVariant.stock > 0 && selectedVariant.stock < 10 && (
            <p className="text-amber-700 font-mono text-xs font-semibold">
              ONLY {selectedVariant.stock} UNITS LEFT IN STOCK
            </p>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3 pt-3">
          {/* Quantity Selector */}
          <div className="flex items-center justify-between border border-outline-variant/60 rounded-md h-12 w-full sm:w-28 bg-surface-container-lowest font-mono">
            <button
              type="button"
              onClick={() => setQuantity(Math.max(1, quantity - 1))}
              className="px-3 text-neutral-600 hover:text-black transition-colors h-full text-base"
            >-</button>
            <span className="font-bold text-on-surface text-sm">{quantity}</span>
            <button
              type="button"
              onClick={() => setQuantity(selectedVariant && selectedVariant.stock !== undefined ? Math.min(selectedVariant.stock, quantity + 1) : quantity + 1)}
              className="px-3 text-neutral-600 hover:text-black transition-colors h-full text-base"
            >+</button>
          </div>

          <button
            type="button"
            onClick={handleAddToCart}
            disabled={!selectedVariant || !isSelectedVariantAvailable || isCartLoading}
            className={`flex-1 h-12 font-mono uppercase tracking-wider font-bold text-xs rounded-md transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${
              isInCart
                ? "bg-neutral-900 text-white shadow-sm hover:bg-neutral-800"
                : "bg-surface-container-lowest border border-neutral-900 text-neutral-900 hover:bg-neutral-900 hover:text-white"
            }`}
          >
            {isCartLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <ShoppingBag className="w-4 h-4" />
            )}
            {isCartLoading ? 'ADDING...' : isInCart ? 'VIEW IN CART' : 'ADD TO CART'}
          </button>

          <button
            type="button"
            onClick={handleBuyNow}
            disabled={!selectedVariant || !isSelectedVariantAvailable || isBuyNowLoading}
            className="flex-1 h-12 bg-primary text-white font-mono uppercase tracking-wider font-bold text-xs rounded-md hover:bg-primary/90 transition-all flex items-center justify-center gap-2 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed active:scale-95"
          >
            {isBuyNowLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {isBuyNowLoading ? 'PROCESSING...' : 'BUY NOW'}
          </button>
        </div>

        {/* Garment Specifications Bento */}
        <div className="bg-surface-container-low border border-outline-variant/30 rounded-lg p-5 space-y-3 font-mono text-xs">
          <h3 className="font-bold uppercase tracking-wider text-on-surface text-[11px] text-primary">GARMENT SPECIFICATIONS</h3>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-neutral-700">
            <div><span className="text-neutral-400">FABRIC:</span> {product.fabric || "100% Combed Cotton"}</div>
            <div><span className="text-neutral-400">WEIGHT:</span> {product.gsm ? `${product.gsm} GSM` : "240 GSM Heavy"}</div>
            <div><span className="text-neutral-400">FIT:</span> {product.fit || "Oversized Drop-Shoulder"}</div>
            <div><span className="text-neutral-400">TREATMENT:</span> Bio-Washed Pre-Shrunk</div>
          </div>
          {product.careInstructions && product.careInstructions.length > 0 && (
            <div className="pt-2 border-t border-outline-variant/20 text-[11px] text-neutral-500">
              <span className="text-neutral-400">CARE:</span> {product.careInstructions.join(" &bull; ")}
            </div>
          )}
        </div>

        {/* Delivery & Assurance */}
        <div className="border border-outline-variant/30 p-4 rounded-lg space-y-3 font-mono text-xs text-neutral-600 bg-surface">
          <div className="flex items-center gap-2.5 text-on-surface font-bold uppercase text-[11px]">
            <Truck className="w-4 h-4 text-primary" />
            <span>PAN-INDIA DISPATCH WITHIN 24-48H</span>
          </div>
          <p className="text-[11px] leading-relaxed">
            Complimentary express shipping on prepaid orders over ₹999. Delivered via Delhivery courier network. 7-day hassle-free return and exchange policy.
          </p>
        </div>

        {/* Description Section */}
        <div className="pt-4 border-t border-outline-variant/30 space-y-2">
          <h3 className="font-mono text-xs uppercase font-bold text-on-surface tracking-wider">ABOUT THIS DROP</h3>
          <div
            className="text-on-surface-variant leading-relaxed text-xs sm:text-sm prose max-w-none font-body-sm"
            dangerouslySetInnerHTML={{ __html: product.description.replace(/\n/g, '<br />') }}
          />
        </div>

        {/* Customer Reviews & Photo Showcase Section */}
        <ProductReviewsSection productId={product._id} />
      </div>
    </div>

    {/* ─── Sticky Mobile Action Bar (<1024px) ─── */}
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-surface/95 backdrop-blur-md border-t border-outline-variant/30 p-3 px-4 shadow-[0_-8px_24px_rgba(0,0,0,0.08)] lg:hidden pb-safe">
      <div className="flex items-center justify-between gap-3 max-w-md mx-auto">
        {/* Price & Selection summary */}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5 font-mono">
            <span className="font-black text-on-surface text-base">
              ₹{currentPrice.toLocaleString("en-IN")}
            </span>
            {displayMrp && displayMrp > currentPrice && (
              <span className="text-[11px] text-neutral-400 line-through">
                ₹{displayMrp.toLocaleString("en-IN")}
              </span>
            )}
          </div>
          <p className="font-mono text-[10px] text-neutral-500 uppercase truncate">
            {selectedColor} &bull; {selectedSize ? `SIZE ${selectedSize}` : "SELECT SIZE"}
          </p>
        </div>

        {/* Quick Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleWishlistToggle}
            aria-label={isInWishlist(product._id, currentVariantId) ? "Remove from wishlist" : "Add to wishlist"}
            className="w-11 h-11 flex items-center justify-center rounded-lg border border-outline-variant/50 bg-surface-container-lowest text-on-surface active:scale-95 transition-all"
          >
            <Heart
              className={`w-5 h-5 transition-colors ${
                isInWishlist(product._id, currentVariantId) ? "fill-red-600 text-red-600" : "text-neutral-700"
              }`}
            />
          </button>

          {isInCart ? (
            <button
              type="button"
              onClick={() => router.push("/cart")}
              className="h-11 px-5 bg-neutral-900 text-white font-mono text-xs uppercase tracking-wider font-bold rounded-lg shadow-sm hover:bg-neutral-800 active:scale-95 transition-all flex items-center justify-center gap-1.5"
            >
              <ShoppingBag className="w-4 h-4" />
              <span>IN CART</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleAddToCart}
              disabled={!selectedVariant || !isSelectedVariantAvailable || isCartLoading}
              className="h-11 px-5 bg-primary text-white font-mono text-xs uppercase tracking-wider font-bold rounded-lg shadow-md hover:bg-primary/90 active:scale-95 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isCartLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ShoppingBag className="w-4 h-4" />
              )}
              <span>{isCartLoading ? "ADDING..." : "ADD TO CART"}</span>
            </button>
          )}
        </div>
      </div>
    </div>
    </>
  );
}
