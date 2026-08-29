"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
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

  const {
    designId,
    designName,
    setDesignName,
    productId,
    selectedVariantId,
    selectedColor,
    selectedSize,
    canvasSide,
    setCanvasSide,
    elements,
    selectedElementId,
    setSelectedElementId,
    addElement,
    updateElement,
    removeElement,
    setBaseProduct,
    loadDesign,
  } = useCustomDesignStore();

  const [activeTab, setActiveTab] = useState<"upload" | "text" | "shapes" | "product">("upload");
  const [customizableProducts, setCustomizableProducts] = useState<BlankProduct[]>(initialProducts);
  const [selectedProduct, setSelectedProduct] = useState<BlankProduct | null>(initialProducts[0] || null);
  
  // Design Input States
  const [customText, setCustomText] = useState("THREADVIBE");
  const [textColor, setTextColor] = useState("#ffffff");
  const [fontFamily, setFontFamily] = useState("Hanken Grotesk");
  const [fontSize, setFontSize] = useState(36);
  
  // Drag & Drop File Upload State
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Operation States
  const [isSaving, setIsSaving] = useState(false);
  const [isAddingToCart, setIsAddingToCart] = useState(false);
  const [isBuyNowLoading, setIsBuyNowLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  // Mouse Drag Element Handling
  const canvasRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ x: number; y: number; elemX: number; elemY: number }>({ x: 0, y: 0, elemX: 0, elemY: 0 });

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
          setMessage({ text: `Loaded design: ${designData.name}`, type: "success" });
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

  // Handle Garment Product Selection
  const handleSelectProduct = (prod: BlankProduct) => {
    setSelectedProduct(prod);
    const variant = prod.variants.find((v) => v.isAvailable && v.stock > 0) || prod.variants[0];
    if (variant) {
      setBaseProduct(prod._id, variant._id, variant.color || "Black", variant.size || "L");
    }
    setMessage({ text: `Selected garment: ${prod.name}`, type: "success" });
  };

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
        addElement({
          type: "IMAGE",
          imageUrl: dataUrl,
          width: 180,
          height: 180,
          rotation: 0,
          scale: 1,
          opacity: 1,
        });
        setMessage({ text: "Artwork image added to canvas!", type: "success" });
      }
    };
    reader.readAsDataURL(file);
  };

  // Drag and drop handlers
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processUploadedFile(e.dataTransfer.files[0]);
    }
  };

  // Add Text Element
  const handleAddText = () => {
    if (!customText.trim()) return;
    addElement({
      type: "TEXT",
      text: customText,
      fontFamily,
      fontSize,
      color: textColor,
      width: 220,
      height: 60,
      rotation: 0,
      scale: 1,
      opacity: 1,
      alignment: "center",
    });
    setCustomText("");
  };

  // Add Shape Element
  const handleAddShape = (shapeType: "RECTANGLE" | "CIRCLE" | "STAR") => {
    addElement({
      type: "SHAPE",
      shapeType,
      fillColor: textColor || "#004ac6",
      strokeColor: "#000000",
      strokeWidth: 2,
      width: 120,
      height: 120,
      rotation: 0,
      scale: 1,
      opacity: 1,
    });
  };

  // Canvas Mouse Drag Handling
  const handleMouseDown = (e: React.MouseEvent, elem: any) => {
    e.stopPropagation();
    setSelectedElementId(elem.id);
    isDraggingRef.current = true;
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      elemX: elem.x,
      elemY: elem.y,
    };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDraggingRef.current || !selectedElementId) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    updateElement(selectedElementId, {
      x: Math.round(dragStartRef.current.elemX + dx),
      y: Math.round(dragStartRef.current.elemY + dy),
    });
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
  };

  // Save Custom Design API
  const handleSaveDesign = async () => {
    if (!user) {
      router.push(`/login?redirect=/custom-printing`);
      return;
    }

    if (!productId || !selectedVariantId) {
      setMessage({ text: "Please select a valid store product and variant", type: "error" });
      return;
    }

    setIsSaving(true);
    setMessage(null);

    try {
      const payload = {
        name: designName || "Custom Graphic Tee",
        productId,
        selectedVariantId,
        selectedColor,
        selectedSize,
        canvasWidth: 800,
        canvasHeight: 1000,
        elements,
        printLocations: ["FRONT"],
      };

      let res;
      if (designId) {
        res = await api.put(`/designs/${designId}`, payload);
      } else {
        res = await api.post("/designs", payload);
      }

      if (res.data?.success) {
        loadDesign(res.data.data);
        setMessage({ text: "Custom design saved to your account!", type: "success" });
        import("@/lib/analytics").then(({ trackEvent }) => {
          trackEvent("custom_design_saved", {
            design_id: res.data.data._id,
            design_name: res.data.data.name,
          });
        });
      }
    } catch (err: any) {
      setMessage({ text: err.response?.data?.message || "Failed to save design", type: "error" });
    } finally {
      setIsSaving(false);
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
      printLocations: ["FRONT"],
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
      router.push(`/login?redirect=/custom-printing`);
      return;
    }

    if (!selectedVariantId) {
      setMessage({ text: "Please select size and color", type: "error" });
      return;
    }

    setIsAddingToCart(true);
    setMessage(null);

    try {
      const activeDesignId = await ensureDesignSaved();
      await addItem(productId, selectedVariantId, 1, activeDesignId);
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
      router.push(`/login?redirect=/custom-printing`);
      return;
    }

    if (!selectedVariantId) {
      setMessage({ text: "Please select size and color", type: "error" });
      return;
    }

    setIsBuyNowLoading(true);
    setMessage(null);

    try {
      const activeDesignId = await ensureDesignSaved();
      await addItem(productId, selectedVariantId, 1, activeDesignId);
      router.push("/checkout");
    } catch (err: any) {
      setMessage({ text: err.response?.data?.message || "Buy Now action failed", type: "error" });
    } finally {
      setIsBuyNowLoading(false);
    }
  };

  const activeElements = elements.filter((el) => el.side === canvasSide);
  const selectedElement = elements.find((el) => el.id === selectedElementId);
  const basePrice = selectedProduct?.basePrice ? selectedProduct.basePrice / 100 : 899;
  const printFee = 200; // ₹200 server print fee
  const totalUnitPrice = basePrice + printFee;
  const currentColorHex = COLOR_SWATCHES.find((c) => c.name.toLowerCase() === selectedColor.toLowerCase())?.hex || "#18181b";

  return (
    <div className="min-h-screen bg-background text-on-background font-body-md pb-24">
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

      {/* Hero Header */}
      <section className="bg-surface-container-low border-b border-outline-variant/10 py-10 px-4 md:px-12 text-center">
        <span className="inline-flex items-center gap-2 bg-primary text-on-primary px-4 py-1.5 rounded-full font-label-caps text-[12px] uppercase tracking-widest mb-3">
          <span className="material-symbols-outlined text-[16px]">verified</span>
          Custom T-Shirt Printing Studio
        </span>
        <h1 className="font-display-lg text-3xl md:text-5xl font-black text-on-surface tracking-tight mb-2">
          Design Your Signature Graphic Tee
        </h1>
        <p className="font-body-md text-on-surface-variant max-w-2xl mx-auto">
          Choose a real SamratFashion heavyweight T-Shirt, upload your artwork, customize live on the garment, and checkout securely.
        </p>
      </section>

      {/* STEP 1: Customizable Store Product Gallery Carousel */}
      <section className="max-w-[1440px] mx-auto px-4 md:px-8 py-8 border-b border-outline-variant/10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-headline-lg text-xl font-bold text-on-surface flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">apparel</span>
            1. Select Customizable Store Garment
          </h2>
          <span className="font-label-caps text-xs text-on-surface-variant">
            {customizableProducts.length} Premium Blanks Available
          </span>
        </div>

        {/* Garment Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 overflow-x-auto pb-2">
          {customizableProducts.map((prod) => (
            <div
              key={prod._id}
              onClick={() => handleSelectProduct(prod)}
              className={`cursor-pointer bg-surface rounded-xl p-3 border transition-all hover:scale-[1.02] flex flex-col justify-between ${
                selectedProduct?._id === prod._id
                  ? "border-primary ring-2 ring-primary ring-offset-2 ring-offset-background shadow-lg"
                  : "border-outline-variant/20 hover:border-outline-variant"
              }`}
            >
              <div className="relative aspect-square w-full rounded-lg bg-surface-container overflow-hidden mb-2">
                {/* eslint-disable-next-next/no-img-element */}
                <img
                  src={prod.images[0] || "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=500"}
                  alt={prod.name}
                  className="w-full h-full object-cover"
                />
                <span className="absolute top-2 right-2 bg-primary text-on-primary text-[10px] font-label-caps px-2 py-0.5 rounded-full font-bold">
                  CUSTOMIZABLE
                </span>
              </div>
              <div>
                <h4 className="font-headline-sm text-sm font-bold text-on-surface line-clamp-1">{prod.name}</h4>
                <div className="flex items-center justify-between mt-1">
                  <span className="font-label-caps text-xs font-bold text-primary">₹{prod.basePrice / 100}</span>
                  {prod.mrp && <span className="font-label-caps text-[10px] line-through text-on-surface-variant">₹{prod.mrp / 100}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* STEP 2: Main Custom Studio Workspace */}
      <section className="max-w-[1440px] mx-auto px-4 md:px-8 py-8">
        {/* Studio Top Control Bar */}
        <div className="bg-surface-container-lowest p-4 rounded-t-xl border border-outline-variant/20 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="material-symbols-outlined text-primary">palette</span>
            <input
              type="text"
              value={designName}
              onChange={(e) => setDesignName(e.target.value)}
              className="bg-transparent font-headline-sm font-bold text-lg text-on-surface border-b border-dashed border-outline focus:border-primary focus:outline-none px-1"
              placeholder="Name your custom design..."
            />
          </div>

          {/* Front / Back Side Switch */}
          <div className="flex items-center bg-surface-container p-1 rounded-lg border border-outline-variant/20">
            <button
              onClick={() => setCanvasSide("FRONT")}
              className={`px-5 py-2 rounded-md font-label-caps text-xs transition-colors ${
                canvasSide === "FRONT" ? "bg-primary text-on-primary font-bold shadow-sm" : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              FRONT VIEW
            </button>
            <button
              onClick={() => setCanvasSide("BACK")}
              className={`px-5 py-2 rounded-md font-label-caps text-xs transition-colors ${
                canvasSide === "BACK" ? "bg-primary text-on-primary font-bold shadow-sm" : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              BACK VIEW
            </button>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleSaveDesign}
              disabled={isSaving}
              className="px-4 py-2.5 bg-surface-container-high border border-outline text-on-surface font-headline-sm text-sm rounded-lg hover:bg-surface-container-highest transition-colors disabled:opacity-50"
            >
              {isSaving ? "Saving..." : "Save Design"}
            </button>
          </div>
        </div>

        {/* 3-Column Studio Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 border-x border-b border-outline-variant/20 rounded-b-xl bg-surface">
          {/* Column 1: Tools & Drag-and-Drop Uploader (3 cols) */}
          <div className="lg:col-span-3 border-r border-outline-variant/20 p-6 flex flex-col gap-6">
            <h3 className="font-headline-sm text-lg font-bold text-on-surface">Design Tools</h3>

            {/* Nav Tabs */}
            <div className="flex gap-2 border-b border-outline-variant/20 pb-3">
              {[
                { id: "upload", label: "Upload Artwork", icon: "upload_file" },
                { id: "text", label: "Add Text", icon: "title" },
                { id: "shapes", label: "Shapes", icon: "shapes" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`flex-1 py-2 flex items-center justify-center gap-1.5 font-label-caps text-xs rounded-md transition-colors ${
                    activeTab === tab.id ? "bg-primary text-on-primary font-bold" : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px]">{tab.icon}</span>
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Drag & Drop File Upload Tool */}
            {activeTab === "upload" && (
              <div className="flex flex-col gap-4">
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragOver(true);
                  }}
                  onDragLeave={() => setIsDragOver(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors flex flex-col items-center justify-center gap-3 ${
                    isDragOver ? "border-primary bg-primary/5" : "border-outline-variant hover:border-primary hover:bg-surface-container"
                  }`}
                >
                  <span className="material-symbols-outlined text-4xl text-primary">cloud_upload</span>
                  <div>
                    <p className="font-headline-sm text-sm font-bold text-on-surface">Drag & Drop Artwork File</p>
                    <p className="font-body-sm text-xs text-on-surface-variant mt-1">PNG, JPG, or WEBP (Max 5MB)</p>
                  </div>
                  <button className="px-4 py-2 bg-surface-container-high text-on-surface font-label-caps text-xs font-bold rounded-lg border border-outline-variant">
                    Browse Computer
                  </button>
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
            )}

            {/* Text Tool */}
            {activeTab === "text" && (
              <div className="flex flex-col gap-4">
                <div>
                  <label className="font-label-caps text-xs text-on-surface-variant block mb-1">Text Content</label>
                  <input
                    type="text"
                    value={customText}
                    onChange={(e) => setCustomText(e.target.value)}
                    className="w-full px-3 py-2 bg-surface-container rounded border border-outline-variant text-sm focus:outline-none focus:border-primary"
                    placeholder="Enter custom text..."
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="font-label-caps text-xs text-on-surface-variant block mb-1">Font Family</label>
                    <select
                      value={fontFamily}
                      onChange={(e) => setFontFamily(e.target.value)}
                      className="w-full px-2 py-2 bg-surface-container rounded border border-outline-variant text-xs focus:outline-none focus:border-primary"
                    >
                      <option value="Hanken Grotesk">Hanken Grotesk</option>
                      <option value="Inter">Inter</option>
                      <option value="JetBrains Mono">JetBrains Mono</option>
                      <option value="Impact">Impact</option>
                      <option value="Georgia">Georgia</option>
                    </select>
                  </div>

                  <div>
                    <label className="font-label-caps text-xs text-on-surface-variant block mb-1">Font Size ({fontSize}px)</label>
                    <input
                      type="range"
                      min={16}
                      max={72}
                      value={fontSize}
                      onChange={(e) => setFontSize(Number(e.target.value))}
                      className="w-full mt-2 accent-primary"
                    />
                  </div>
                </div>

                <div>
                  <label className="font-label-caps text-xs text-on-surface-variant block mb-1">Text Color</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={textColor}
                      onChange={(e) => setTextColor(e.target.value)}
                      className="w-10 h-10 rounded border border-outline-variant cursor-pointer"
                    />
                    <span className="font-label-caps text-xs text-on-surface-variant uppercase">{textColor}</span>
                  </div>
                </div>

                <button
                  onClick={handleAddText}
                  className="w-full py-3 bg-primary text-on-primary font-headline-sm text-sm font-bold rounded-lg hover:bg-primary-container transition-colors shadow-sm"
                >
                  + Add Text to Tee
                </button>
              </div>
            )}

            {/* Shapes Tool */}
            {activeTab === "shapes" && (
              <div className="grid grid-cols-3 gap-3">
                {[
                  { type: "RECTANGLE", label: "Box", icon: "square" },
                  { type: "CIRCLE", label: "Circle", icon: "circle" },
                  { type: "STAR", label: "Star", icon: "star" },
                ].map((s) => (
                  <button
                    key={s.type}
                    onClick={() => handleAddShape(s.type as any)}
                    className="p-4 bg-surface-container rounded-lg border border-outline-variant/20 flex flex-col items-center gap-2 hover:border-primary transition-colors"
                  >
                    <span className="material-symbols-outlined text-2xl text-primary">{s.icon}</span>
                    <span className="font-label-caps text-xs text-on-surface">{s.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Column 2: Live Garment Mockup Canvas (6 cols) */}
          <div className="lg:col-span-6 p-6 flex flex-col items-center justify-center bg-surface-container-low min-h-[560px] relative overflow-hidden">
            {/* Real T-Shirt Garment Mockup Canvas Container */}
            <div
              ref={canvasRef}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              className="relative w-[380px] h-[480px] sm:w-[420px] sm:h-[520px] rounded-3xl flex items-center justify-center shadow-2xl overflow-hidden select-none border border-outline-variant/20 transition-colors duration-300"
              style={{
                backgroundColor: currentColorHex,
              }}
            >
              {/* Photorealistic T-Shirt Vector Background Outline */}
              <svg className="absolute inset-0 w-full h-full opacity-20 pointer-events-none stroke-white" viewBox="0 0 100 100" preserveAspectRatio="none">
                <path d="M 20,10 L 35,5 L 65,5 L 80,10 L 95,25 L 80,35 L 80,95 L 20,95 L 20,35 L 5,25 Z" fill="none" strokeWidth="1.5" />
              </svg>

              {/* Printable Bounding Box Area Overlay */}
              <div className="absolute w-[240px] h-[320px] sm:w-[280px] sm:h-[360px] border-2 border-dashed border-primary/40 rounded-xl flex items-center justify-center pointer-events-none">
                <span className="absolute top-2 left-3 font-label-caps text-[10px] text-primary/70 uppercase tracking-widest">
                  Print Area ({canvasSide})
                </span>
              </div>

              {/* Render Active Elements */}
              {activeElements.map((elem) => (
                <div
                  key={elem.id}
                  onMouseDown={(e) => handleMouseDown(e, elem)}
                  style={{
                    position: "absolute",
                    left: `${elem.x}px`,
                    top: `${elem.y}px`,
                    width: `${elem.width}px`,
                    height: `${elem.height}px`,
                    transform: `rotate(${elem.rotation}deg) scale(${elem.scale})`,
                    opacity: elem.opacity,
                    zIndex: elem.zIndex,
                  }}
                  className={`cursor-move flex items-center justify-center transition-shadow ${
                    selectedElementId === elem.id ? "ring-2 ring-primary ring-offset-2 ring-offset-black" : ""
                  }`}
                >
                  {elem.type === "TEXT" && (
                    <span
                      style={{
                        fontFamily: elem.fontFamily || "Hanken Grotesk",
                        fontSize: `${elem.fontSize || 32}px`,
                        color: elem.color || "#ffffff",
                        fontWeight: "700",
                        textAlign: elem.alignment || "center",
                        lineHeight: 1.1,
                      }}
                    >
                      {elem.text}
                    </span>
                  )}

                  {elem.type === "IMAGE" && elem.imageUrl && (
                    // eslint-disable-next-next/no-img-element
                    <img src={elem.imageUrl} alt="Custom Artwork" className="w-full h-full object-contain pointer-events-none" />
                  )}

                  {elem.type === "SHAPE" && (
                    <div
                      style={{
                        width: "100%",
                        height: "100%",
                        backgroundColor: elem.fillColor || "#004ac6",
                        border: `${elem.strokeWidth || 2}px solid ${elem.strokeColor || "#000000"}`,
                        borderRadius: elem.shapeType === "CIRCLE" ? "50%" : "4px",
                      }}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Column 3: Garment Color/Size Swatches & Authoritative Price Summary (3 cols) */}
          <div className="lg:col-span-3 border-l border-outline-variant/20 p-6 flex flex-col gap-6">
            <div>
              <h3 className="font-headline-sm text-lg font-bold text-on-surface">{selectedProduct?.name}</h3>
              <p className="font-body-sm text-xs text-on-surface-variant mt-1">100% Heavyweight Cotton — {selectedProduct?.fabric || "240 GSM"}</p>
            </div>

            {/* Garment Color Swatches */}
            <div>
              <label className="font-label-caps text-xs text-on-surface-variant block mb-2">
                Color: <span className="text-on-surface font-bold">{selectedColor}</span>
              </label>
              <div className="flex flex-wrap gap-3">
                {COLOR_SWATCHES.map((swatch) => (
                  <button
                    key={swatch.name}
                    onClick={() => handleColorSelect(swatch.name)}
                    style={{ backgroundColor: swatch.hex }}
                    className={`w-8 h-8 rounded-full border-2 transition-transform ${
                      selectedColor.toLowerCase() === swatch.name.toLowerCase()
                        ? "border-primary scale-110 shadow-md ring-2 ring-primary/40"
                        : "border-outline-variant hover:scale-105"
                    }`}
                    title={swatch.name}
                  />
                ))}
              </div>
            </div>

            {/* Size Selector */}
            <div>
              <label className="font-label-caps text-xs text-on-surface-variant block mb-2">Size</label>
              <div className="grid grid-cols-4 gap-2">
                {["S", "M", "L", "XL"].map((sz) => (
                  <button
                    key={sz}
                    onClick={() => handleSizeSelect(sz)}
                    className={`py-2 rounded-lg font-headline-sm text-xs font-bold transition-colors ${
                      selectedSize === sz
                        ? "bg-primary text-on-primary shadow-sm"
                        : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
                    }`}
                  >
                    {sz}
                  </button>
                ))}
              </div>
            </div>

            {/* Inspector for Selected Element */}
            {selectedElement && (
              <div className="p-4 bg-surface-container rounded-xl border border-outline-variant/20 flex flex-col gap-3">
                <div className="flex items-center justify-between border-b border-outline-variant/20 pb-2">
                  <span className="font-label-caps text-xs font-bold text-on-surface">Selected Element</span>
                  <button
                    onClick={() => removeElement(selectedElement.id)}
                    className="text-red-500 hover:text-red-600 font-label-caps text-xs flex items-center gap-1"
                  >
                    <span className="material-symbols-outlined text-[14px]">delete</span> Delete
                  </button>
                </div>

                {selectedElement.type === "TEXT" && (
                  <div>
                    <label className="font-label-caps text-[10px] text-on-surface-variant block mb-1">Edit Text</label>
                    <input
                      type="text"
                      value={selectedElement.text || ""}
                      onChange={(e) => updateElement(selectedElement.id, { text: e.target.value })}
                      className="w-full px-2 py-1 bg-surface-container-lowest rounded border border-outline-variant text-xs"
                    />
                  </div>
                )}

                <div>
                  <label className="font-label-caps text-[10px] text-on-surface-variant block mb-1">
                    Rotation ({selectedElement.rotation || 0}°)
                  </label>
                  <input
                    type="range"
                    min={-180}
                    max={180}
                    value={selectedElement.rotation || 0}
                    onChange={(e) => updateElement(selectedElement.id, { rotation: Number(e.target.value) })}
                    className="w-full accent-primary"
                  />
                </div>
              </div>
            )}

            {/* Server Authoritative Price Breakdown */}
            <div className="p-4 bg-surface-container-low rounded-xl border border-outline-variant/10 flex flex-col gap-2 mt-auto">
              <div className="flex justify-between text-xs font-body-sm text-on-surface-variant">
                <span>Base Garment Price</span>
                <span>₹{basePrice}</span>
              </div>
              <div className="flex justify-between text-xs font-body-sm text-on-surface-variant">
                <span>HD Print Fee ({canvasSide})</span>
                <span>₹{printFee}</span>
              </div>
              <div className="border-t border-outline-variant/20 pt-2 flex justify-between font-headline-sm font-bold text-sm text-on-surface">
                <span>Total Custom Price</span>
                <span className="text-primary font-extrabold text-base">₹{totalUnitPrice}</span>
              </div>
            </div>

            {/* Action Buttons: Add to Cart & Buy Now */}
            <div className="flex flex-col gap-3">
              <button
                onClick={handleAddToCart}
                disabled={isAddingToCart || isBuyNowLoading}
                className="w-full py-3 bg-surface-container-highest text-on-surface border border-outline font-headline-sm text-sm font-bold rounded-xl hover:bg-surface-container-high transition-colors shadow-sm disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-[18px]">shopping_bag</span>
                {isAddingToCart ? "Adding to Cart..." : "Add to Cart"}
              </button>

              <button
                onClick={handleBuyNow}
                disabled={isAddingToCart || isBuyNowLoading}
                className="w-full py-3.5 bg-primary text-on-primary font-headline-sm text-sm font-bold rounded-xl hover:bg-primary-container transition-all shadow-md active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-[18px]">bolt</span>
                {isBuyNowLoading ? "Processing..." : `Buy Now — ₹${totalUnitPrice}`}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
