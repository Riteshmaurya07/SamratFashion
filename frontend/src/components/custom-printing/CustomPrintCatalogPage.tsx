"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { FileCheck, Layers, Package, Palette, ShieldCheck, Sparkles, Truck, UploadCloud } from "lucide-react";
import { api } from "@/lib/api";
import { trackEvent } from "@/lib/analytics";
import CustomPrintCatalogCard from "./CustomPrintCatalogCard";
import { type CatalogItem } from "@/lib/customPrintCatalogData";

interface RawProduct {
  _id: string;
  name: string;
  slug: string;
  basePrice: number;
  mrp?: number;
  images: string[];
  description?: string;
  isCustomizable?: boolean;
  categoryId?: { _id: string; name: string } | string;
  variants: Array<{
    _id?: string;
    size?: string;
    color?: string;
    hexCode?: string;
    stock?: number;
    isAvailable?: boolean;
    images?: string[];
  }>;
}

const CATEGORIES = [
  "All Blanks",
  "Oversized Tees",
  "Minimal Essentials",
  "Polo & Collared",
  "Hoodies & Outerwear",
];

export default function CustomPrintCatalogPage() {
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState("All Blanks");

  useEffect(() => {
    trackEvent("custom_print_catalog_view");

    async function loadCustomizableProducts() {
      setLoading(true);
      setError(null);
      try {
        // Priority 1: Fetch live customizable products
        const resCustom = await api.get("/catalog/customizable-products");
        const rawProducts: RawProduct[] = resCustom.data?.data || [];

        if (Array.isArray(rawProducts) && rawProducts.length > 0) {
          const adapted: CatalogItem[] = rawProducts.map((prod) => {
            const categoryName =
              typeof prod.categoryId === "object" && prod.categoryId !== null
                ? prod.categoryId.name
                : prod.name.toLowerCase().includes("polo")
                ? "Polo & Collared"
                : prod.name.toLowerCase().includes("hoodie")
                ? "Hoodies & Outerwear"
                : prod.name.toLowerCase().includes("oversized")
                ? "Oversized Tees"
                : "Minimal Essentials";

            return {
              _id: prod._id,
              name: prod.name,
              slug: prod.slug,
              description: prod.description,
              mockupImageUrl: prod.images?.[0] || "/images/custom_polo_blue_mockup.png",
              displayPrice: prod.basePrice,
              isActive: true,
              category: categoryName,
              productId: {
                _id: prod._id,
                name: prod.name,
                basePrice: prod.basePrice,
                mrp: prod.mrp,
                variants: (prod.variants || []).map((v) => ({
                  _id: v._id,
                  size: v.size || "Free",
                  color: v.color || "Standard",
                  hexCode: v.hexCode || "#000000",
                  stock: typeof v.stock === "number" ? v.stock : 10,
                  isAvailable: v.isAvailable !== false,
                  images: v.images || prod.images || [],
                })),
              },
              placementTemplateId: {
                _id: "placement-chest",
                name: "Front Chest & Back",
                code: "CHEST_BACK",
                side: "FRONT",
                previewConfig: { x: 35, y: 35, width: 30, height: 25 },
              },
            };
          });
          setCatalogItems(adapted);
          return;
        }

        // Priority 2: Try custom-print-catalog endpoint
        const resPrintCatalog = await api.get("/custom-print-catalog");
        const printItems = resPrintCatalog.data?.data;
        if (Array.isArray(printItems) && printItems.length > 0) {
          setCatalogItems(printItems);
          return;
        }

        setCatalogItems([]);
      } catch (err: unknown) {
        let msg = "Failed to load customizable garments.";
        if (err && typeof err === "object" && "response" in err) {
          const res = err.response;
          if (res && typeof res === "object" && "data" in res) {
            const data = res.data;
            if (data && typeof data === "object" && "message" in data && typeof data.message === "string") {
              msg = data.message;
            }
          }
        }
        setError(msg);
      } finally {
        setLoading(false);
      }
    }

    loadCustomizableProducts();
  }, []);

  const filteredItems = useMemo(() => {
    if (selectedCategory === "All Blanks") return catalogItems;
    return catalogItems.filter((item) => {
      const cat = (item.category || "").toLowerCase();
      const name = (item.name || "").toLowerCase();
      if (selectedCategory === "Oversized Tees") {
        return cat.includes("oversized") || name.includes("oversized") || name.includes("boxy");
      }
      if (selectedCategory === "Minimal Essentials") {
        return cat.includes("minimal") || cat.includes("cotton") || name.includes("blank") || name.includes("tee");
      }
      if (selectedCategory === "Polo & Collared") {
        return cat.includes("polo") || name.includes("polo") || name.includes("collar");
      }
      if (selectedCategory === "Hoodies & Outerwear") {
        return cat.includes("hoodie") || cat.includes("outerwear") || name.includes("hoodie") || name.includes("sweatshirt");
      }
      return true;
    });
  }, [catalogItems, selectedCategory]);

  return (
    <main className="min-h-screen bg-background text-on-background pb-24">
      {/* Editorial Announcement Bar */}
      <div className="bg-neutral-900 text-white text-xs py-2 px-4 text-center font-label-caps tracking-widest uppercase">
        Complimentary Express Shipping on Orders Above ₹999 · Digital Proof Verification Before Production
      </div>

      {/* Hero Section */}
      <section className="border-b border-outline-variant/20 bg-surface-container-low px-4 py-12 md:px-8 md:py-16">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-10">
            <div className="max-w-2xl space-y-6">
              <span className="font-label-caps text-xs text-primary font-bold uppercase tracking-[0.14em]">
                THREADVIBE // CUSTOM APPAREL LAB
              </span>
              <h1 className="font-headline-lg text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight text-on-surface leading-[1.1]">
                Custom DTF Apparel & Graphic Studio
              </h1>
              <p className="font-body-md text-base md:text-lg text-on-surface-variant leading-relaxed">
                Direct-to-Film printing on heavy 240+ GSM combed cotton silhouettes. Front chest, back graphic, and sleeve placements verified by staff before production.
              </p>

              {/* 3 Intent Pathways */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                <a
                  href="#blanks"
                  className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-4 hover:border-primary/50 transition-colors group"
                >
                  <Package className="h-5 w-5 text-primary mb-2 group-hover:scale-110 transition-transform" />
                  <p className="font-headline-sm text-sm font-bold text-on-surface">1. Customize Blanks</p>
                  <p className="font-body-sm text-[11px] text-on-surface-variant mt-1">Pick a live garment, select placement, and upload artwork.</p>
                </a>

                <Link
                  href="/custom-designer"
                  className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-4 hover:border-primary/50 transition-colors group"
                >
                  <Palette className="h-5 w-5 text-primary mb-2 group-hover:scale-110 transition-transform" />
                  <p className="font-headline-sm text-sm font-bold text-on-surface">2. Studio Canvas</p>
                  <p className="font-body-sm text-[11px] text-on-surface-variant mt-1">Interactive 2D design editor with front & back placement zones.</p>
                </Link>

                <Link
                  href="/bulk-orders/request"
                  className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-4 hover:border-primary/50 transition-colors group"
                >
                  <Layers className="h-5 w-5 text-primary mb-2 group-hover:scale-110 transition-transform" />
                  <p className="font-headline-sm text-sm font-bold text-on-surface">3. Corporate Bulk</p>
                  <p className="font-body-sm text-[11px] text-on-surface-variant mt-1">Dedicated B2B runs starting at 10 units with volume discounts.</p>
                </Link>
              </div>
            </div>

            {/* Showcase Visual */}
            <div className="relative aspect-[4/5] w-full max-w-[440px] overflow-hidden rounded-2xl border border-outline-variant/30 bg-surface-container shadow-lg self-center lg:self-auto shrink-0">
              <Image
                src="/images/custom_print_hero.png"
                alt="Custom Streetwear Printing Lab"
                fill
                className="object-cover"
                priority
              />
              <div className="absolute bottom-4 left-4 right-4 rounded-xl bg-neutral-900/90 p-4 text-white backdrop-blur-xs border border-white/10">
                <p className="font-label-caps text-[10px] text-primary uppercase font-bold tracking-widest">DTF Specification</p>
                <p className="font-headline-sm text-sm font-bold mt-0.5">Heavyweight 240+ GSM Combed Cotton</p>
                <p className="text-[11px] text-neutral-300 mt-1">Pre-shrunk, bio-washed fabric with digital proof verification.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Catalog Blanks Discovery */}
      <section id="blanks" className="mx-auto max-w-7xl px-4 py-12 md:px-8">
        <div className="mb-8 flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-outline-variant/20 pb-5">
          <div>
            <h2 className="font-headline-lg text-2xl md:text-3xl font-black text-on-surface">
              Customizable Streetwear Blanks
            </h2>
            <p className="font-body-sm text-sm text-on-surface-variant mt-1">
              Select an apparel silhouette below to configure placement, upload your artwork, or request design assistance.
            </p>
          </div>
          <span className="font-label-caps text-xs text-primary font-bold bg-primary/10 px-3 py-1.5 rounded-full border border-primary/20 self-start sm:self-auto">
            {filteredItems.length} Garments Available
          </span>
        </div>

        {/* Category Pills */}
        <div className="mb-8 flex flex-wrap gap-2">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`rounded-lg px-4 py-2 font-label-caps text-xs font-bold transition-colors ${
                selectedCategory === cat
                  ? "bg-neutral-900 text-white"
                  : "border border-outline-variant/40 bg-surface-container-lowest text-on-surface-variant hover:border-outline-variant hover:text-on-surface"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Products Grid */}
        {loading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="overflow-hidden rounded-2xl border border-outline-variant/30 bg-surface-container-lowest animate-pulse">
                <div className="aspect-[3/4] w-full bg-surface-container-low" />
                <div className="p-4 space-y-2">
                  <div className="h-4 w-3/4 rounded bg-surface-container-low" />
                  <div className="h-3 w-1/2 rounded bg-surface-container-low" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-error/30 bg-error-container p-8 text-center text-on-error-container">
            <p className="font-bold text-sm">{error}</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-outline-variant/40 bg-surface-container-lowest p-12 text-center space-y-4">
            <Package className="h-10 w-10 text-on-surface-variant mx-auto" />
            <h3 className="font-headline-sm text-base font-bold text-on-surface">No blanks available in this category</h3>
            <p className="text-xs text-on-surface-variant max-w-md mx-auto">
              Try selecting another garment category or start designing directly on our primary blanks in the Studio Canvas.
            </p>
            <div className="flex justify-center gap-3 pt-2">
              <button
                onClick={() => setSelectedCategory("All Blanks")}
                className="px-4 py-2 rounded-lg border border-outline-variant/40 font-label-caps text-xs text-on-surface hover:bg-surface-container-low"
              >
                View All Blanks
              </button>
              <Link
                href="/custom-designer"
                className="px-4 py-2 rounded-lg bg-neutral-900 text-white font-label-caps text-xs font-bold hover:bg-neutral-800"
              >
                Launch Studio Canvas
              </Link>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {filteredItems.map((item) => (
              <CustomPrintCatalogCard key={item._id} item={item} />
            ))}
          </div>
        )}
      </section>

      {/* Industrial Printing Specifications */}
      <section className="mx-auto max-w-7xl px-4 py-12 md:px-8 border-t border-outline-variant/20">
        <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-8 md:p-12 shadow-sm space-y-8">
          <div>
            <span className="font-label-caps text-xs text-primary font-bold uppercase tracking-wider">Production Standards</span>
            <h2 className="font-headline-lg text-2xl md:text-3xl font-black text-on-surface mt-1">
              Direct-to-Film Technical Specifications
            </h2>
            <p className="font-body-md text-sm text-on-surface-variant mt-2 max-w-2xl">
              We operate commercial DTF printers producing high-definition transfer prints on pre-shrunk, bio-washed heavyweight fabrics.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="space-y-2 p-4 rounded-xl bg-surface-container-low border border-outline-variant/20">
              <Sparkles className="h-6 w-6 text-primary" />
              <h3 className="font-headline-sm text-sm font-bold text-on-surface">240+ GSM Cotton</h3>
              <p className="font-body-sm text-xs text-on-surface-variant leading-relaxed">
                Super-combed 100% cotton jersey with structured architectural boxy fits.
              </p>
            </div>

            <div className="space-y-2 p-4 rounded-xl bg-surface-container-low border border-outline-variant/20">
              <ShieldCheck className="h-6 w-6 text-primary" />
              <h3 className="font-headline-sm text-sm font-bold text-on-surface">50+ Wash Durability</h3>
              <p className="font-body-sm text-xs text-on-surface-variant leading-relaxed">
                High-density industrial polyurethane inks cured at 165°C for zero peel or fade.
              </p>
            </div>

            <div className="space-y-2 p-4 rounded-xl bg-surface-container-low border border-outline-variant/20">
              <UploadCloud className="h-6 w-6 text-primary" />
              <h3 className="font-headline-sm text-sm font-bold text-on-surface">Artwork Specs</h3>
              <p className="font-body-sm text-xs text-on-surface-variant leading-relaxed">
                Accepts PNG, SVG, and high-res vector files. Transparent background at 300 DPI recommended.
              </p>
            </div>

            <div className="space-y-2 p-4 rounded-xl bg-surface-container-low border border-outline-variant/20">
              <FileCheck className="h-6 w-6 text-primary" />
              <h3 className="font-headline-sm text-sm font-bold text-on-surface">Pre-Press Proofing</h3>
              <p className="font-body-sm text-xs text-on-surface-variant leading-relaxed">
                Our design team inspects scaling and placement before the garment enters production.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Production Workflow */}
      <section className="mx-auto max-w-7xl px-4 py-12 md:px-8">
        <div className="border-t border-outline-variant/20 pt-10">
          <h2 className="font-headline-lg text-2xl md:text-3xl font-black text-on-surface mb-8">
            How The Custom Journey Works
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="space-y-3 p-5 rounded-2xl border border-outline-variant/20 bg-surface-container-lowest">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Package className="h-5 w-5" />
              </div>
              <h3 className="font-headline-sm text-sm font-bold text-on-surface">1. Choose Garment & Size</h3>
              <p className="text-xs text-on-surface-variant leading-relaxed">
                Select your blank streetwear silhouette, available colorway, and size breakdown.
              </p>
            </div>

            <div className="space-y-3 p-5 rounded-2xl border border-outline-variant/20 bg-surface-container-lowest">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <UploadCloud className="h-5 w-5" />
              </div>
              <h3 className="font-headline-sm text-sm font-bold text-on-surface">2. Provide Artwork</h3>
              <p className="text-xs text-on-surface-variant leading-relaxed">
                Upload your graphic or logo directly, or submit a design assistance request if you need file prep.
              </p>
            </div>

            <div className="space-y-3 p-5 rounded-2xl border border-outline-variant/20 bg-surface-container-lowest">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <FileCheck className="h-5 w-5" />
              </div>
              <h3 className="font-headline-sm text-sm font-bold text-on-surface">3. Staff Verification</h3>
              <p className="text-xs text-on-surface-variant leading-relaxed">
                Our technicians verify print zone bounds and produce a digital pre-press proof for your review.
              </p>
            </div>

            <div className="space-y-3 p-5 rounded-2xl border border-outline-variant/20 bg-surface-container-lowest">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Truck className="h-5 w-5" />
              </div>
              <h3 className="font-headline-sm text-sm font-bold text-on-surface">4. Express Fulfillment</h3>
              <p className="text-xs text-on-surface-variant leading-relaxed">
                After proof confirmation, your order is printed, quality checked, and shipped via Delhivery.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Frequently Asked Questions */}
      <section className="mx-auto max-w-7xl px-4 py-12 md:px-8 border-t border-outline-variant/20">
        <h2 className="font-headline-lg text-2xl md:text-3xl font-black text-on-surface mb-8">
          Custom Apparel FAQs
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs">
          <div className="p-5 rounded-xl border border-outline-variant/20 bg-surface-container-lowest space-y-2">
            <h3 className="font-bold text-sm text-on-surface">Is there a minimum order quantity (MOQ)?</h3>
            <p className="text-on-surface-variant leading-relaxed">
              No MOQ for single custom orders or design assistance requests—you can order 1 custom piece. For corporate bulk orders with tiered B2B pricing, our minimum is 10 units.
            </p>
          </div>

          <div className="p-5 rounded-xl border border-outline-variant/20 bg-surface-container-lowest space-y-2">
            <h3 className="font-bold text-sm text-on-surface">What file formats are accepted?</h3>
            <p className="text-on-surface-variant leading-relaxed">
              We accept PNG, SVG, and high-resolution JPEG files up to 10MB. For optimal DTF print clarity, we recommend transparent PNG or vector SVG files at 300 DPI.
            </p>
          </div>

          <div className="p-5 rounded-xl border border-outline-variant/20 bg-surface-container-lowest space-y-2">
            <h3 className="font-bold text-sm text-on-surface">What is the difference between Path A, B, and C?</h3>
            <p className="text-on-surface-variant leading-relaxed">
              Path A is direct checkout for ready artwork. Path B is design assistance where our team reviews your files before payment. Path C is for 10+ units with official B2B quotation.
            </p>
          </div>

          <div className="p-5 rounded-xl border border-outline-variant/20 bg-surface-container-lowest space-y-2">
            <h3 className="font-bold text-sm text-on-surface">What is the return policy on custom printing?</h3>
            <p className="text-on-surface-variant leading-relaxed">
              Custom-printed apparel is produced specifically to your approved specifications and cannot be returned for buyer&apos;s remorse. Any garment with manufacturing defects or printing errors is replaced promptly.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
