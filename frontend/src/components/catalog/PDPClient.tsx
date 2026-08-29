"use client";

import { useState, useEffect, useMemo } from "react";
import Image from "next/image";
import { Star, Heart, Share2, Truck, Ruler, ShieldCheck, ShoppingBag, Loader2 } from "lucide-react";
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

export function PDPClient({ product }: { product: Product }) {
  const [selectedImage, setSelectedImage] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [pincode, setPincode] = useState("");
  const [isBuyNowLoading, setIsBuyNowLoading] = useState(false);
  
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const { items: cartItems, addItem, isLoading: isCartLoading } = useCartStore();
  const { toggleWishlist, isInWishlist, isLoading: isWishlistLoading } = useWishlistStore();
  
  const isWishlisted = isInWishlist(product._id);

  // Extract unique sizes and colors with hex codes
  const sizes = useMemo(() => Array.from(new Set(product.variants.map((v) => v.size))), [product.variants]);
  const colors = useMemo(
    () =>
      Array.from(
        new Map(product.variants.map((v) => [v.color, getHexForColor(v.color, v.hexCode)])).entries()
      ),
    [product.variants]
  );

  // Initial color & size determination (failsafe to first variant if no stock)
  const initialColor = useMemo(() => {
    const firstAvail = product.variants.find((v) => isVariantAvailable(v));
    if (firstAvail?.color) return firstAvail.color;
    if (product.variants.length > 0 && product.variants[0].color) return product.variants[0].color;
    return colors.length > 0 ? colors[0][0] : "";
  }, [product.variants, colors]);

  const [selectedColor, setSelectedColor] = useState<string>(initialColor);

  const initialSize = useMemo(() => {
    const targetColor = selectedColor || initialColor;
    const availForColor = product.variants.find((v) => v.color?.toLowerCase() === targetColor.toLowerCase() && isVariantAvailable(v));
    if (availForColor?.size) return availForColor.size;
    const anyForColor = product.variants.find((v) => v.color?.toLowerCase() === targetColor.toLowerCase());
    if (anyForColor?.size) return anyForColor.size;
    return sizes.length > 0 ? sizes[0] : "";
  }, [product.variants, selectedColor, initialColor, sizes]);

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
    if (!isCurrentSizeAvailable && validVariantsForColor.length > 0) {
      setSelectedSize(validVariantsForColor[0].size);
    }
  };

  const isSelectedVariantAvailable = isVariantAvailable(selectedVariant);

  // Dynamic price calculation taking variant additionalPrice into account
  const currentPrice = useMemo(() => {
    const base = product.basePrice || 0;
    const addPrice = selectedVariant?.additionalPrice || 0;
    return base + addPrice;
  }, [product.basePrice, selectedVariant]);

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
      router.push("/checkout");
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
    try {
      await toggleWishlist(product._id);
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <div className="flex flex-col lg:flex-row gap-12 max-w-container-max mx-auto w-full">
      
      {/* Image Gallery */}
      <div className="w-full lg:w-1/2 flex flex-col md:flex-row-reverse gap-4">
        {/* Main Image */}
        <div className="w-full relative aspect-[3/4] bg-surface-container-low rounded-lg overflow-hidden border border-outline-variant/20">
          <Image 
            src={currentGalleryImages[selectedImage] || currentGalleryImages[0]} 
            alt={product.name} 
            fill 
            className="object-cover transition-all duration-300" 
            priority
          />
          <button 
            disabled={isWishlistLoading}
            onClick={handleWishlistToggle}
            className="absolute top-4 right-4 bg-surface-container-lowest/80 backdrop-blur p-2.5 rounded-full text-on-surface hover:scale-110 active:scale-90 transition-all duration-200 shadow-md disabled:opacity-50 z-10"
          >
            <Heart className={`w-5 h-5 transition-all duration-200 ${isWishlisted ? "fill-red-500 text-red-500 scale-110" : "text-on-surface hover:text-red-500"}`} />
          </button>
        </div>
        
        {/* Thumbnails */}
        <div className="flex md:flex-col gap-4 overflow-x-auto md:overflow-y-auto hide-scrollbar w-full md:w-20 shrink-0">
          {currentGalleryImages.map((img, idx) => (
            <button 
              key={`${img}-${idx}`}
              onClick={() => setSelectedImage(idx)}
              className={`relative w-20 aspect-[3/4] shrink-0 rounded overflow-hidden border-2 transition-colors ${
                selectedImage === idx ? "border-primary" : "border-transparent"
              }`}
            >
              <Image src={img} alt={`Thumbnail ${idx + 1}`} fill className="object-cover" />
            </button>
          ))}
        </div>
      </div>

      {/* Product Details */}
      <div className="w-full lg:w-1/2 flex flex-col pt-2 lg:pt-8 pr-4">
        {/* Breadcrumbs simplified */}
        <div className="flex items-center gap-2 text-on-surface-variant font-label-caps text-[10px] mb-4">
          <span>HOME</span> <span>/</span> <span>SHOP</span> <span>/</span> <span className="text-on-surface font-bold truncate">{product.name.toUpperCase()}</span>
        </div>

        <h1 className="font-display-lg-mobile md:text-[40px] text-on-surface font-extrabold leading-tight tracking-tight mb-2">
          {product.name}
        </h1>
        
        <div className="flex items-center gap-4 mb-6">
          <div className="flex items-center gap-1 text-primary">
            <Star className="w-5 h-5 fill-primary text-primary" />
            <span className="font-mono text-on-surface font-bold">{product.averageRating.toFixed(1)}</span>
          </div>
          <span className="text-on-surface-variant text-sm underline cursor-pointer">{product.reviewCount} Reviews</span>
          <button className="ml-auto text-on-surface-variant hover:text-primary transition-colors flex items-center gap-2 text-sm font-label-caps">
            <Share2 className="w-4 h-4" /> SHARE
          </button>
        </div>

        <div className="flex items-baseline gap-4 mb-8">
          <span className="font-price-lg text-[32px] text-on-surface">₹{currentPrice.toLocaleString()}</span>
          {product.mrp && product.mrp > currentPrice && (
            <>
              <span className="text-on-surface-variant line-through text-lg">₹{product.mrp.toLocaleString()}</span>
              {product.discount ? (
                <span className="bg-secondary-container text-on-secondary px-2 py-1 rounded font-bold text-sm">
                  {product.discount}% OFF
                </span>
              ) : (
                <span className="bg-secondary-container text-on-secondary px-2 py-1 rounded font-bold text-sm">
                  {Math.round(((product.mrp - currentPrice) / product.mrp) * 100)}% OFF
                </span>
              )}
            </>
          )}
          <span className="text-on-surface-variant text-xs ml-2">(Incl. of all taxes)</span>
        </div>

        {/* Offers Bento Box */}
        {product.offers && product.offers.length > 0 && (
          <div className="bg-surface-container-low border border-outline-variant/30 rounded-lg p-4 mb-8">
            <h3 className="font-label-caps text-on-surface font-bold mb-3 flex items-center gap-2">
              <Star className="w-4 h-4 text-secondary" /> ACTIVE OFFERS
            </h3>
            <ul className="space-y-2 text-sm text-on-surface-variant">
              {product.offers.map((offer, idx) => (
                <li key={idx} className="flex gap-2">
                  <span className="font-bold text-on-surface">{offer.type}:</span> {offer.description}
                </li>
              ))}
            </ul>
          </div>
        )}

        <hr className="border-outline-variant/20 mb-8" />

        {/* Color Selection */}
        <div className="mb-8">
          <div className="flex justify-between items-center mb-4">
            <span className="font-label-caps font-bold text-on-surface">COLOR: {selectedColor}</span>
          </div>
          <div className="flex flex-wrap gap-3">
            {colors.map(([color, hex]) => {
              const isSelected = selectedColor === color;
              return (
                <button
                  key={color}
                  onClick={() => handleColorChange(color)}
                  aria-label={`${color}, ${isSelected ? "selected" : "available"}`}
                  className={`w-12 h-12 rounded-full border-2 transition-all ${
                    isSelected ? "border-primary ring-2 ring-primary ring-offset-2" : "border-outline-variant/30 hover:border-primary"
                  }`}
                  style={{ backgroundColor: hex }}
                  title={color}
                />
              );
            })}
          </div>
        </div>

        {/* Size Selection */}
        <div className="mb-8">
          <div className="flex justify-between items-center mb-4">
            <span className="font-label-caps font-bold text-on-surface">SIZE: {selectedSize}</span>
            {product.sizeGuideTable && product.sizeGuideTable.length > 0 && (
              <button 
                onClick={() => alert(`Size Guide (inches):\n` + product.sizeGuideTable?.map(r => `${r.size}: Chest ${r.chest || '-'}", Length ${r.length || '-'}", Shoulder ${r.shoulder || '-'}"`).join('\n'))}
                className="text-primary font-label-caps text-xs flex items-center gap-1 hover:underline cursor-pointer"
              >
                <Ruler className="w-4 h-4" /> SIZE GUIDE
              </button>
            )}
          </div>
          <div className="grid grid-cols-4 md:grid-cols-6 gap-3">
            {sizes.map(size => {
              const isSelected = selectedSize === size;
              const variantForSize = product.variants.find(v => v.size === size && v.color === selectedColor);
              const isAvailable = isVariantAvailable(variantForSize);
              
              return (
                <button
                  key={size}
                  disabled={!isAvailable}
                  onClick={() => setSelectedSize(size)}
                  className={`py-3 rounded border font-label-caps transition-colors ${
                    isSelected 
                      ? "border-primary bg-primary text-on-primary font-bold" 
                      : !isAvailable 
                        ? "border-outline-variant/20 bg-surface-container text-on-surface-variant/40 line-through cursor-not-allowed opacity-50"
                        : "border-outline-variant/50 hover:border-primary text-on-surface"
                  }`}
                >
                  {size}
                </button>
              );
            })}
          </div>
          {selectedVariant && selectedVariant.stock !== undefined && selectedVariant.stock > 0 && selectedVariant.stock < 10 && (
            <p className="text-secondary text-xs font-bold mt-2">Only {selectedVariant.stock} left in stock!</p>
          )}
        </div>

        {/* Technical Specs & Garment Attributes */}
        {(product.fabric || product.gsm || product.fit || product.gender || (product.printTypes && product.printTypes.length > 0)) && (
          <div className="bg-surface-container-low border border-outline-variant/30 rounded-lg p-4 mb-8 space-y-2">
            <h4 className="font-label-caps font-bold text-on-surface text-xs uppercase tracking-wider mb-2">Garment Specifications</h4>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-on-surface-variant">
              {product.fabric && <div><span className="font-medium text-on-surface">Fabric:</span> {product.fabric}</div>}
              {product.gsm && <div><span className="font-medium text-on-surface">Weight:</span> {product.gsm} GSM</div>}
              {product.fit && <div><span className="font-medium text-on-surface">Fit:</span> {product.fit}</div>}
              {product.gender && <div><span className="font-medium text-on-surface">Gender:</span> {product.gender}</div>}
              {product.printTypes && product.printTypes.length > 0 && (
                <div className="col-span-2"><span className="font-medium text-on-surface">Printing:</span> {product.printTypes.join(", ")}</div>
              )}
            </div>
            {product.careInstructions && product.careInstructions.length > 0 && (
              <div className="pt-2 border-t border-outline-variant/20 text-xs text-on-surface-variant">
                <span className="font-medium text-on-surface">Care:</span> {product.careInstructions.join(" • ")}
              </div>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 mb-10">
          {/* Quantity */}
          <div className="flex items-center justify-between border border-outline-variant/50 rounded h-14 w-full sm:w-32 bg-surface-container-lowest">
            <button 
              onClick={() => setQuantity(Math.max(1, quantity - 1))}
              className="px-4 text-on-surface-variant hover:text-primary transition-colors h-full"
            >-</button>
            <span className="font-bold text-on-surface">{quantity}</span>
            <button 
              onClick={() => setQuantity(selectedVariant && selectedVariant.stock !== undefined ? Math.min(selectedVariant.stock, quantity + 1) : quantity + 1)}
              className="px-4 text-on-surface-variant hover:text-primary transition-colors h-full"
            >+</button>
          </div>
          
          <button 
            onClick={handleAddToCart}
            disabled={!selectedVariant || !isSelectedVariantAvailable || isCartLoading}
            className={`flex-1 h-14 font-label-caps font-bold text-[14px] rounded transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${
              isInCart 
                ? "bg-secondary-container text-on-secondary shadow-md hover:bg-secondary-container/90" 
                : "bg-surface-container-lowest border border-primary text-primary hover:bg-primary/5"
            }`}
          >
            {isCartLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <ShoppingBag className={`w-5 h-5 ${isInCart ? "fill-on-secondary" : ""}`} />
            )}
            {isCartLoading ? 'ADDING...' : isInCart ? 'VIEW IN CART' : 'ADD TO CART'}
          </button>
          
          <button 
            onClick={handleBuyNow}
            disabled={!selectedVariant || !isSelectedVariantAvailable || isBuyNowLoading}
            className="flex-1 h-14 bg-primary text-on-primary font-label-caps font-bold text-[14px] rounded shadow-md hover:bg-primary/90 hover:shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isBuyNowLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
            {isBuyNowLoading ? 'PROCESSING...' : 'BUY IT NOW'}
          </button>
        </div>

        {/* Pincode Check */}
        <div className="bg-surface-bright border border-outline-variant/20 p-4 rounded-lg mb-8">
          <h4 className="font-label-caps font-bold text-on-surface mb-3 flex items-center gap-2">
            <Truck className="w-4 h-4 text-primary" /> DELIVERY & RETURN
          </h4>
          <div className="flex mb-4">
            <input 
              type="text" 
              placeholder="Enter Pincode" 
              maxLength={6}
              value={pincode}
              onChange={(e) => setPincode(e.target.value.replace(/\D/g, ''))}
              className="bg-surface-container-lowest border border-outline-variant/50 rounded-l px-4 py-2 w-full text-sm focus:ring-1 focus:ring-primary focus:border-primary outline-none"
            />
            <button className="bg-surface-container-highest px-6 font-label-caps text-xs font-bold text-on-surface hover:text-primary transition-colors rounded-r border border-l-0 border-outline-variant/50">
              CHECK
            </button>
          </div>
          <div className="text-sm text-on-surface-variant flex items-start gap-2">
            <ShieldCheck className="w-4 h-4 shrink-0 text-primary" />
            <p>100% Original Products. Pay on delivery might be available. Easy 7 days returns and exchanges.</p>
          </div>
        </div>

        {/* Description */}
        <div className="mb-12">
          <h4 className="font-headline-sm text-on-surface mb-4">Product Description</h4>
          <div 
            className="text-on-surface-variant leading-relaxed text-sm prose max-w-none"
            dangerouslySetInnerHTML={{ __html: product.description.replace(/\n/g, '<br />') }}
          />
        </div>

        {/* Customer Reviews & Photo Showcase Section */}
        <ProductReviewsSection productId={product._id} />
      </div>
    </div>
  );
}
