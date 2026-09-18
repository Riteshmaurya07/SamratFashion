"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useCustomDesignStore } from "@/store/useCustomDesignStore";
import { useCartStore } from "@/store/useCartStore";
import { useAuthStore } from "@/store/useAuthStore";
import { api } from "@/lib/api";

interface ProductVariant {
  _id: string;
  size: string;
  color: string;
  hexCode: string;
  sku: string;
  stock: number;
  additionalPrice?: number;
  isAvailable: boolean;
}

interface BlankProduct {
  _id: string;
  name: string;
  slug: string;
  basePrice: number;
  mrp: number;
  discount: number;
  images: string[];
  variants: ProductVariant[];
  fabric?: string;
  gsm?: number;
}

const COLOR_SWATCHES = [
  { name: "Black", hex: "#18181b" },
  { name: "White", hex: "#ffffff" },
  { name: "Navy", hex: "#1e3a8a" },
  { name: "Charcoal", hex: "#3f3f46" },
  { name: "Maroon", hex: "#881337" },
  { name: "Sage", hex: "#3f6212" },
];

export default function CustomPrintingClient({ initialProducts }: { initialProducts: BlankProduct[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const targetDesignId = searchParams.get("designId");
  const { user } = useAuthStore();
  const { addItem } = useCartStore();

  const store = useCustomDesignStore();
  const {
    designId,
    productId,
    variantId: selectedVariantId,
    activeZone,
    setActiveZone,
    design,
    configurations,
    addElement,
    removeElement,
    setBaseProduct,
    loadDesign,
  } = store;

  const [designName, setDesignName] = useState("Custom Graphic Tee");
  const selectedColor = configurations[0]?.color || "Black";
  const selectedSize = configurations[0]?.sizes.find(s => s.quantity > 0)?.size || "L";
  const canvasSide = (activeZone ? activeZone.toUpperCase() : "FRONT") as "FRONT" | "BACK" | "LEFT_SLEEVE" | "RIGHT_SLEEVE";
  const setCanvasSide = (side: string) => setActiveZone(side.toLowerCase() as any);
  const elements = design[activeZone]?.elements || [];

  const [customizableProducts, setCustomizableProducts] = useState<BlankProduct[]>(initialProducts);
  const [selectedProduct, setSelectedProduct] = useState<BlankProduct | null>(initialProducts[0] || null);
  
  // Drag & Drop File Upload State
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadedLogo, setUploadedLogo] = useState<string | null>(null);

  // Operation States
  const [isAddingToCart, setIsAddingToCart] = useState(false);
  const [isBuyNowLoading, setIsBuyNowLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [activeImageIndex, setActiveImageIndex] = useState(0);

  // Track custom_design_started event on mount
  useEffect(() => {
    import("@/lib/analytics").then(({ trackEvent }) => {
      trackEvent("custom_design_started");
    });
  }, []);

  // Hydrate design state if designId query parameter is provided
  useEffect(() => {
    async function hydrateTargetDesign() {
      if (!targetDesignId || !user) return;
      try {
        const res = await api.get(`/designs/${targetDesignId}`);
        if (res.data?.success && res.data.data) {
          const designData = res.data.data;
          loadDesign(designData);
          if (designData.productId) {
            const p = typeof designData.productId === "object" ? designData.productId : null;
            if (p) {
              setSelectedProduct(p);
            }
          }
          const imageElem = designData.elements.find((e: any) => e.type === "IMAGE");
          if (imageElem) {
            setUploadedLogo(imageElem.imageUrl);
          }
        }
      } catch (err) {
        console.error("Failed to load design for editing:", err);
      }
    }
    hydrateTargetDesign();
  }, [targetDesignId, user, loadDesign]);

  // Fetch customizable products dynamically if not passed via props
  useEffect(() => {
    async function fetchCustomizable() {
      try {
        const res = await api.get("/catalog/customizable-products");
        if (res.data?.data?.length > 0) {
          setCustomizableProducts(res.data.data);
          if (!selectedProduct) {
            const p = res.data.data[0];
            setSelectedProduct(p);
            const v = p.variants?.find((varItem: any) => varItem.isAvailable && varItem.stock > 0) || p.variants?.[0];
            if (v) {
              setBaseProduct(p._id, v._id, v.color || "Black", v.size || "L");
            }
          }
        }
      } catch (err) {
        console.error("Failed to fetch customizable products:", err);
      }
    }
    fetchCustomizable();
  }, [selectedProduct, setBaseProduct]);

  // Handle Color Swatch Switch
  const handleColorSelect = (colorName: string) => {
    if (!selectedProduct) return;
    const matchingVariant = selectedProduct.variants.find(
      (v) => v.color?.toLowerCase() === colorName.toLowerCase() && v.isAvailable && v.stock > 0
    ) || selectedProduct.variants.find((v) => v.color?.toLowerCase() === colorName.toLowerCase()) || selectedProduct.variants[0];

    if (matchingVariant) {
      setBaseProduct(selectedProduct._id, matchingVariant._id, matchingVariant.color || colorName, matchingVariant.size || selectedSize);
    }
  };

  // Handle Size Switch
  const handleSizeSelect = (size: string) => {
    if (!selectedProduct) return;
    const matchingVariant = selectedProduct.variants.find(
      (v) => v.size === size && v.color?.toLowerCase() === selectedColor.toLowerCase() && v.isAvailable
    ) || selectedProduct.variants.find((v) => v.size === size && v.isAvailable) || selectedProduct.variants[0];

    if (matchingVariant) {
      setBaseProduct(selectedProduct._id, matchingVariant._id, matchingVariant.color || selectedColor, matchingVariant.size || size);
    }
  };

  // Handle File Upload & Validation
  const processUploadedFile = (file: File) => {
    const validTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp"];
    if (!validTypes.includes(file.type.toLowerCase())) {
      setMessage({ text: "Please upload a PNG, JPG, or WEBP image file.", type: "error" });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setMessage({ text: "File size exceeds 5MB limit. Please upload a smaller image.", type: "error" });
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      if (dataUrl) {
        setUploadedLogo(dataUrl);
        // Remove all previous elements
        elements.forEach((el: any) => removeElement(el.id));
        
        addElement({
          id: `img-${Date.now()}`,
          type: "IMAGE",
          x: 100,
          y: 100,
          width: 180,
          height: 180,
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
          opacity: 1,
          locked: false,
          zIndex: 1,
          properties: { imageUrl: dataUrl },
        });
        setMessage({ text: "Logo uploaded successfully!", type: "success" });
        setTimeout(() => setMessage(null), 3000);
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

  // Internal helper to ensure design is persisted before cart actions
  const ensureDesignSaved = async () => {
    if (designId) return designId;
    const saveRes = await api.post("/designs", {
      name: designName || "Custom Graphic Tee",
      productId,
      selectedVariantId,
      selectedColor,
      selectedSize,
      canvasWidth: 800,
      canvasHeight: 1000,
      elements,
      printLocations: [canvasSide],
    });
    if (saveRes.data?.success) {
      loadDesign(saveRes.data.data);
      return saveRes.data.data._id;
    }
    throw new Error("Failed to save design");
  };

  // Add Custom Item to Cart
  const handleAddToCart = async () => {
    if (!user) {
      router.push(`/login?redirect=/custom-designer`);
      return;
    }

    if (!selectedVariantId) {
      setMessage({ text: "Please select size and color", type: "error" });
      return;
    }
    if (!uploadedLogo) {
      setMessage({ text: "Please upload a logo first", type: "error" });
      return;
    }

    setIsAddingToCart(true);
    setMessage(null);

    try {
      const activeDesignId = await ensureDesignSaved();
      await addItem(productId || "", selectedVariantId || "", 1, activeDesignId);
      setMessage({ text: "Custom T-Shirt added to cart!", type: "success" });
      import("@/lib/analytics").then(({ trackEvent }) => {
        trackEvent("custom_design_added_to_cart", {
          design_id: activeDesignId,
        });
      });
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
      router.push(`/login?redirect=/custom-designer`);
      return;
    }

    if (!selectedVariantId) {
      setMessage({ text: "Please select size and color", type: "error" });
      return;
    }
    if (!uploadedLogo) {
      setMessage({ text: "Please upload a logo first", type: "error" });
      return;
    }

    setIsBuyNowLoading(true);
    setMessage(null);

    try {
      const activeDesignId = await ensureDesignSaved();
      await addItem(productId || "", selectedVariantId || "", 1, activeDesignId);
      router.push("/checkout");
    } catch (err: any) {
      setMessage({ text: err.response?.data?.message || "Buy Now action failed", type: "error" });
    } finally {
      setIsBuyNowLoading(false);
    }
  };

  const basePrice = selectedProduct?.basePrice ? selectedProduct.basePrice / 100 : 899;
  const mrp = selectedProduct?.mrp ? selectedProduct.mrp / 100 : basePrice + 300;
  const printFee = 200; // ₹200 server print fee
  const totalUnitPrice = basePrice + printFee;
  const totalMrp = mrp + printFee;
  
  const discountPercentage = Math.round(((totalMrp - totalUnitPrice) / totalMrp) * 100);

  const images = selectedProduct?.images?.length ? selectedProduct.images : ["/images/custom_print_hero.png"];

  return (
    <div className="min-h-screen bg-background text-on-background pb-24">
      {/* Toast Notification */}
      {message && (
        <div
          className={`fixed top-20 right-6 z-50 px-6 py-4 rounded-lg shadow-xl text-white font-medium transition-all ${
            message.type === "success" ? "bg-emerald-600" : "bg-red-600"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Main PDP Layout */}
      <main className="mx-auto max-w-7xl px-4 py-8 md:px-8 md:py-12">
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-2">
          
          {/* Left Column: Image Gallery */}
          <div className="flex flex-col gap-4">
            <div className="relative aspect-[4/5] w-full overflow-hidden rounded-2xl bg-surface-container shadow-sm border border-outline-variant/20">
              <Image
                src={images[activeImageIndex]}
                alt="Product Mockup"
                fill
                priority
                className="object-cover"
              />
              {/* Optional: Show uploaded logo dynamically on the image */}
              {uploadedLogo && (
                <div 
                  className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-80"
                  style={{ top: canvasSide === 'FRONT' ? '-15%' : '0' }}
                >
                  <img src={uploadedLogo} alt="Logo preview" className="w-32 h-32 object-contain opacity-90 drop-shadow-md" />
                </div>
              )}
            </div>
            
            {images.length > 1 && (
              <div className="grid grid-cols-4 gap-3">
                {images.map((img, idx) => (
                  <button
                    key={idx}
                    onClick={() => setActiveImageIndex(idx)}
                    className={`relative aspect-[4/5] overflow-hidden rounded-lg border-2 ${
                      activeImageIndex === idx ? "border-primary" : "border-transparent hover:border-outline-variant"
                    }`}
                  >
                    <Image src={img} alt={`Thumbnail ${idx + 1}`} fill className="object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Right Column: Product Details */}
          <div className="flex flex-col">
            <nav className="mb-4 flex text-sm text-on-surface-variant">
              <ol className="flex items-center space-x-2">
                <li><Link href="/" className="hover:text-primary transition-colors">Home</Link></li>
                <li><span className="mx-2">/</span></li>
                <li><Link href="/custom-printing" className="hover:text-primary transition-colors">Custom Printing</Link></li>
                <li><span className="mx-2">/</span></li>
                <li className="font-medium text-on-surface">Customized Logo Printed T-Shirt</li>
              </ol>
            </nav>

            <h1 className="font-display-lg text-3xl font-black text-on-surface md:text-4xl leading-tight">
              Customized Logo Printed T-Shirt | With Your Company Logo
            </h1>

            <div className="mt-4 flex flex-wrap items-end gap-3 border-b border-outline-variant/20 pb-6">
              <span className="font-price-lg text-3xl text-primary font-bold">₹{totalUnitPrice.toLocaleString("en-IN")}</span>
              <span className="font-price-md text-xl text-on-surface-variant line-through">₹{totalMrp.toLocaleString("en-IN")}</span>
              <span className="font-label-caps rounded bg-error/10 px-2 py-1 text-xs font-bold text-error">
                {discountPercentage}% OFF
              </span>
            </div>

            <div className="mt-6 flex flex-col gap-6">
              {/* Product Type Selector */}
              {customizableProducts.length > 1 && (
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-label-caps text-sm font-bold text-on-surface">Style</span>
                  </div>
                  <select
                    value={selectedProduct?._id || ""}
                    onChange={(e) => {
                      const prod = customizableProducts.find(p => p._id === e.target.value);
                      if (prod) {
                        setSelectedProduct(prod);
                        const v = prod.variants?.find(v => v.isAvailable && v.stock > 0) || prod.variants?.[0];
                        if (v) setBaseProduct(prod._id, v._id, v.color || "Black", v.size || "L");
                      }
                    }}
                    className="w-full rounded-xl border border-outline-variant bg-surface p-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    {customizableProducts.map(prod => (
                      <option key={prod._id} value={prod._id}>{prod.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Logo Upload Section */}
              <div className="rounded-xl border border-outline-variant/30 bg-surface-container-lowest p-5">
                <div className="mb-3 flex items-center justify-between">
                  <span className="font-label-caps text-sm font-bold text-on-surface">1. Upload Your Logo</span>
                  {uploadedLogo && <span className="text-xs font-bold text-emerald-600 flex items-center gap-1"><span className="material-symbols-outlined text-[14px]">check_circle</span> Logo Uploaded</span>}
                </div>
                
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragOver(true);
                  }}
                  onDragLeave={() => setIsDragOver(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors flex flex-col items-center justify-center gap-3 ${
                    isDragOver ? "border-primary bg-primary/5" : "border-outline-variant hover:border-primary/50 hover:bg-surface-container/50"
                  }`}
                >
                  <span className="material-symbols-outlined text-3xl text-on-surface-variant">cloud_upload</span>
                  <div>
                    <p className="font-headline-sm text-sm font-bold text-on-surface">Click to browse or drag image here</p>
                    <p className="font-body-sm text-xs text-on-surface-variant mt-1">PNG, JPG, or WEBP up to 5MB</p>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png, image/jpeg, image/webp"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        processUploadedFile(e.target.files[0]);
                      }
                    }}
                  />
                </div>
              </div>

              {/* Placement Selector */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-label-caps text-sm font-bold text-on-surface">2. Select Print Placement</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setCanvasSide("FRONT")}
                    className={`rounded-xl border py-3 text-sm font-bold transition-all ${
                      canvasSide === "FRONT"
                        ? "border-primary bg-primary/5 text-primary shadow-sm ring-1 ring-primary"
                        : "border-outline-variant bg-surface text-on-surface-variant hover:border-outline hover:bg-surface-container-lowest"
                    }`}
                  >
                    Front Left Chest
                  </button>
                  <button
                    onClick={() => setCanvasSide("BACK")}
                    className={`rounded-xl border py-3 text-sm font-bold transition-all ${
                      canvasSide === "BACK"
                        ? "border-primary bg-primary/5 text-primary shadow-sm ring-1 ring-primary"
                        : "border-outline-variant bg-surface text-on-surface-variant hover:border-outline hover:bg-surface-container-lowest"
                    }`}
                  >
                    Full Back
                  </button>
                </div>
              </div>

              {/* Color Selector */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-label-caps text-sm font-bold text-on-surface">3. Color</span>
                  <span className="text-sm font-medium text-on-surface-variant">{selectedColor}</span>
                </div>
                <div className="flex flex-wrap gap-3">
                  {COLOR_SWATCHES.map((swatch) => (
                    <button
                      key={swatch.name}
                      onClick={() => handleColorSelect(swatch.name)}
                      title={swatch.name}
                      aria-label={`Select ${swatch.name}`}
                      style={{ backgroundColor: swatch.hex }}
                      className={`h-10 w-10 rounded-full border-2 transition-all ${
                        selectedColor.toLowerCase() === swatch.name.toLowerCase()
                          ? "border-primary ring-2 ring-primary ring-offset-2 scale-110 shadow-md"
                          : "border-outline-variant hover:scale-105"
                      }`}
                    />
                  ))}
                </div>
              </div>

              {/* Size Selector */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-label-caps text-sm font-bold text-on-surface">4. Size</span>
                </div>
                <div className="grid grid-cols-4 gap-3 sm:grid-cols-6">
                  {["S", "M", "L", "XL", "2XL", "3XL", "4XL"].map((sz) => (
                    <button
                      key={sz}
                      onClick={() => handleSizeSelect(sz)}
                      className={`rounded-lg border py-2.5 text-sm font-bold transition-all ${
                        selectedSize === sz
                          ? "border-primary bg-primary text-on-primary shadow-sm"
                          : "border-outline-variant bg-surface text-on-surface hover:border-primary/50"
                      }`}
                    >
                      {sz}
                    </button>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div className="mt-4 flex flex-col gap-3">
                <button
                  onClick={handleAddToCart}
                  disabled={isAddingToCart || isBuyNowLoading}
                  className="w-full rounded-xl border-2 border-primary bg-surface py-4 text-base font-bold text-primary transition-all hover:bg-primary/5 disabled:opacity-50 flex justify-center items-center gap-2"
                >
                  <span className="material-symbols-outlined text-[20px]">shopping_bag</span>
                  {isAddingToCart ? "Adding..." : "Add to Cart"}
                </button>
                <button
                  onClick={handleBuyNow}
                  disabled={isAddingToCart || isBuyNowLoading}
                  className="w-full rounded-xl bg-primary py-4 text-base font-bold text-on-primary shadow-md transition-all hover:bg-primary-container active:scale-95 disabled:opacity-50 flex justify-center items-center gap-2"
                >
                  <span className="material-symbols-outlined text-[20px]">bolt</span>
                  {isBuyNowLoading ? "Processing..." : "Buy it Now"}
                </button>
              </div>

              {/* Product Description */}
              <div className="mt-8 pt-8 border-t border-outline-variant/20 prose prose-sm max-w-none text-on-surface-variant">
                <h3 className="text-on-surface font-bold text-lg mb-2">Product Description</h3>
                <p>
                  Premium cotton t-shirts with soft, breathable fabric and perfect fit. Ideal for daily wear, team uniforms, or custom branding. Shop now with fast delivery.
                </p>
                <ul className="mt-4 space-y-2">
                  <li><strong>Fabric:</strong> 100% Premium Cotton (240 GSM)</li>
                  <li><strong>Print Quality:</strong> High Definition DTG Print</li>
                  <li><strong>Fit:</strong> Regular Comfort Fit</li>
                  <li><strong>Care:</strong> Machine wash cold, do not iron directly on print.</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
