"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { api } from "@/lib/api";
import { trackEvent } from "@/lib/analytics";
import CustomPrintCatalogCard from "./CustomPrintCatalogCard";
import { ALL_CUSTOM_CATALOG_ITEMS, type CatalogItem } from "@/lib/customPrintCatalogData";

function CatalogSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="overflow-hidden rounded-2xl border border-outline-variant/30 bg-surface-container-lowest">
          <div className="aspect-[4/5] w-full animate-pulse bg-surface-container" />
          <div className="space-y-3 p-5">
            <div className="h-4 w-3/4 animate-pulse rounded-lg bg-surface-container" />
            <div className="h-3 w-full animate-pulse rounded-lg bg-surface-container" />
            <div className="h-3 w-2/3 animate-pulse rounded-lg bg-surface-container" />
          </div>
        </div>
      ))}
    </div>
  );
}

const CATEGORIES = [
  "All Custom Shirts",
  "Polo T-Shirts",
  "100% Cotton",
  "Oversized Tees",
  "Corporate Gifts",
  "Hoodies & Outerwear",
  "Accessories & Bags",
];

const DEFAULT_CATALOG_ITEMS: CatalogItem[] = ALL_CUSTOM_CATALOG_ITEMS;

export default function CustomPrintCatalogPage() {
  const [items, setItems] = useState<CatalogItem[]>(ALL_CUSTOM_CATALOG_ITEMS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState("All Custom Shirts");

  useEffect(() => {
    trackEvent("custom_print_catalog_view");

    api.get("/custom-print-catalog")
      .then(({ data }) => {
        if (data?.data && Array.isArray(data.data) && data.data.length > 0) {
          const isLegacyItem = (item: CatalogItem) => {
            const n = (item.name || "").toLowerCase();
            return (
              n.includes("arm logo") ||
              n.includes("half print") ||
              n.includes("front chest logo") ||
              n.includes("center logo") ||
              n.includes("full back logo") ||
              n === "left arm logo print" ||
              n === "right arm logo print" ||
              n === "half print"
            );
          };
          const cleanItems = data.data.filter((item: CatalogItem) => !isLegacyItem(item));
          if (cleanItems.length > 0) {
            setItems(cleanItems);
          }
        }
      })
      .catch(() => setError(null)) // fallback silently to ALL_CUSTOM_CATALOG_ITEMS
      .finally(() => setLoading(false));
  }, []);

  const filteredItems = items.filter(item => {
    if (selectedCategory === "All Custom Shirts") return true;
    if (selectedCategory === "Polo T-Shirts") return item.category === "Polo T-Shirts" || item.name.toLowerCase().includes("polo");
    if (selectedCategory === "100% Cotton") return item.category === "100% Cotton" || item.name.toLowerCase().includes("cotton") || item.name.toLowerCase().includes("biowashed");
    if (selectedCategory === "Oversized Tees") return item.category === "Oversized Tees" || item.name.toLowerCase().includes("oversized");
    if (selectedCategory === "Corporate Gifts") return item.category === "Corporate Gifts" || item.name.toLowerCase().includes("gift") || item.name.toLowerCase().includes("box");
    if (selectedCategory === "Hoodies & Outerwear") return item.category === "Hoodies & Outerwear" || item.name.toLowerCase().includes("hoodie") || item.name.toLowerCase().includes("jacket");
    if (selectedCategory === "Accessories & Bags") return item.category === "Accessories & Bags" || item.name.toLowerCase().includes("tote") || item.name.toLowerCase().includes("cap");
    return true;
  });

  return (
    <main className="min-h-screen bg-background text-on-background pb-24">
      {/* Top Announcement Marquee */}
      <div className="bg-black text-white text-xs py-2.5 px-4 overflow-hidden">
        <div className="flex items-center justify-center gap-6 whitespace-nowrap font-medium animate-pulse">
          <span>🎉 Get Extra 12% OFF – Use Code <strong>FIRSTORDER</strong></span>
          <span className="hidden md:inline">|</span>
          <span className="hidden md:inline">🚚 Free Shipping Across India</span>
          <span className="hidden md:inline">|</span>
          <span className="hidden md:inline">✅ Design Approval Before Printing</span>
          <span className="hidden md:inline">|</span>
          <span className="hidden md:inline">😊 Trusted by 70,900+ Happy Customers</span>
        </div>
      </div>

      {/* Hero Section */}
      <section className="relative overflow-hidden border-b border-outline-variant/20 bg-gradient-to-b from-surface-container-low to-background px-4 pb-14 pt-10 md:px-8 md:pb-16 md:pt-14">
        <div className="relative mx-auto max-w-7xl">
          <div className="flex flex-col justify-between gap-8 lg:flex-row lg:items-center">
            <div className="max-w-2xl space-y-5">
              <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3.5 py-1 text-xs font-bold text-primary border border-primary/20">
                <span className="flex h-2 w-2 rounded-full bg-primary animate-ping" />
                PRINTMINE QUALITY GUARANTEE
              </div>
              
              <h1 className="font-display-lg text-4xl font-black tracking-tight text-on-surface md:text-5xl lg:text-6xl leading-[1.15]">
                Customized Logo Printed T-Shirts
              </h1>
              
              <p className="text-base text-on-surface-variant leading-relaxed md:text-lg">
                Upgrade your company & team branding with premium customized logo printed T-shirts! Choose from high-quality Polo, Combed Cotton, or Oversized fits with HD digital logo printing.
              </p>

              {/* 4 Value Proposition Badges */}
              <div className="grid grid-cols-2 gap-3 pt-2 sm:grid-cols-4">
                <div className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3 shadow-xs">
                  <span className="text-xl">🎨</span>
                  <p className="mt-1.5 text-xs font-bold text-on-surface">Free Mockup Approval</p>
                  <p className="text-[11px] text-on-surface-variant">Review before print</p>
                </div>
                <div className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3 shadow-xs">
                  <span className="text-xl">⚡</span>
                  <p className="mt-1.5 text-xs font-bold text-on-surface">3-Day Express Print</p>
                  <p className="text-[11px] text-on-surface-variant">Fast dispatch</p>
                </div>
                <div className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3 shadow-xs">
                  <span className="text-xl">🧵</span>
                  <p className="mt-1.5 text-xs font-bold text-on-surface">240 GSM Cotton</p>
                  <p className="text-[11px] text-on-surface-variant">Super combed fabric</p>
                </div>
                <div className="rounded-xl border border-outline-variant/40 bg-surface-container-lowest p-3 shadow-xs">
                  <span className="text-xl">📦</span>
                  <p className="mt-1.5 text-xs font-bold text-on-surface">No MOQ Required</p>
                  <p className="text-[11px] text-on-surface-variant">Order 1 or 1,000+</p>
                </div>
              </div>

              <div className="pt-2 flex flex-wrap items-center gap-4">
                <Link
                  href="/custom-designer"
                  className="inline-flex min-h-12 items-center justify-center rounded-xl bg-primary px-6 text-sm font-bold text-on-primary shadow-md hover:bg-primary/90 transition-all active:scale-95"
                >
                  Create Custom T-Shirt →
                </Link>
                <a
                  href="#catalog-grid"
                  className="inline-flex min-h-12 items-center justify-center rounded-xl border border-outline-variant bg-surface px-5 text-sm font-bold text-on-surface shadow-xs hover:bg-surface-container transition-colors"
                >
                  Browse Options
                </a>
              </div>
            </div>

            {/* Hero Image Showcase */}
            <div className="relative aspect-square w-full max-w-[480px] overflow-hidden rounded-3xl border border-outline-variant/30 shadow-xl lg:w-[480px] shrink-0">
              <Image 
                src="/images/custom_print_hero.png" 
                alt="Custom Printed T-Shirts Showcase" 
                fill 
                className="object-cover" 
                priority 
              />
              <div className="absolute bottom-4 left-4 right-4 rounded-2xl bg-black/75 p-4 text-white backdrop-blur-md">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-amber-400">★ ★ ★ ★ ★ 4.9/5</p>
                    <p className="text-sm font-extrabold">Corporate & Team Branding</p>
                  </div>
                  <span className="rounded-lg bg-amber-400 px-2.5 py-1 text-xs font-black text-black">BESTSELLER</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Category Filter & Catalog Grid */}
      <section id="catalog-grid" aria-label="Custom print catalog" className="mx-auto max-w-7xl px-4 py-12 md:px-8">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-2xl font-black text-on-surface md:text-3xl">Choose Your Custom Garment Style</h2>
            <p className="mt-1 text-sm text-on-surface-variant">Select any option below to upload your logo and customize with your team specifications.</p>
          </div>
          {!loading && filteredItems.length > 0 && (
            <span className="text-xs font-bold text-primary bg-primary/10 px-3 py-1.5 rounded-full border border-primary/20">
              {filteredItems.length} {filteredItems.length === 1 ? "Style" : "Styles"} Available
            </span>
          )}
        </div>

        {/* Category Pills */}
        <div className="mb-8 flex flex-wrap gap-2.5 border-b border-outline-variant/20 pb-4">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`rounded-xl px-4 py-2 text-xs font-bold transition-all ${
                selectedCategory === cat
                  ? "bg-black text-white shadow-sm ring-1 ring-black"
                  : "border border-outline-variant/40 bg-surface text-on-surface-variant hover:border-outline hover:bg-surface-container"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {loading ? (
          <CatalogSkeleton />
        ) : error ? (
          <div className="rounded-2xl border border-error/30 bg-error-container p-10 text-center text-on-error-container" role="alert">
            <p className="font-bold">{error}</p>
            <button
              onClick={() => { setError(null); setLoading(true); api.get("/custom-print-catalog").then(({ data }) => setItems(data?.data || [])).finally(() => setLoading(false)); }}
              className="mt-4 rounded-xl bg-primary px-5 py-2 text-sm font-bold text-on-primary"
            >
              Try again
            </button>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-outline-variant bg-surface-container-lowest p-16 text-center">
            <h3 className="text-lg font-bold text-on-surface">No products found in this category.</h3>
            <button onClick={() => setSelectedCategory("All Custom Shirts")} className="mt-4 text-xs font-bold text-primary underline">
              View all products
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-3">
            {filteredItems.map((item) => (
              <CustomPrintCatalogCard key={item._id} item={item} />
            ))}
          </div>
        )}
      </section>

      {/* How It Works Section */}
      <section className="mx-auto max-w-7xl px-4 pb-16 md:px-8">
        <div className="rounded-3xl border border-outline-variant/20 bg-surface-container-lowest p-8 md:p-12 shadow-sm">
          <div className="text-center max-w-2xl mx-auto mb-10">
            <span className="text-xs font-bold uppercase tracking-widest text-primary">Simple 4-Step Process</span>
            <h2 className="mt-2 text-2xl font-black text-on-surface md:text-3xl">How Custom Printing Works</h2>
            <p className="mt-2 text-sm text-on-surface-variant">We ensure zero hassle and 100% satisfaction before your order goes into production.</p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { num: "01", icon: "👕", title: "Select Product & Color", desc: "Choose your favorite apparel style, fabric color, and size distribution." },
              { num: "02", icon: "📤", title: "Upload Your Logo", desc: "Upload your high-res design file (PNG/JPG/SVG/PDF) & placement notes." },
              { num: "03", icon: "✅", title: "Approve Digital Mockup", desc: "Our design team creates a high-res mockup and gets your approval before printing." },
              { num: "04", icon: "🚚", title: "Print & Doorstep Delivery", desc: "We print using premium DTG technology and ship directly to your doorstep." },
            ].map(({ num, icon, title, desc }) => (
              <div key={num} className="relative flex flex-col rounded-2xl border border-outline-variant/30 bg-surface-container-low p-6 shadow-xs">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-3xl">{icon}</span>
                  <span className="text-xs font-black text-primary bg-primary/10 px-2.5 py-1 rounded-full">{num}</span>
                </div>
                <h3 className="font-bold text-on-surface text-base">{title}</h3>
                <p className="mt-2 text-xs text-on-surface-variant leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Social Proof / Reviews Section */}
      <section className="mx-auto max-w-7xl px-4 pb-16 md:px-8">
        <div className="rounded-3xl bg-black text-white p-8 md:p-12">
          <div className="text-center max-w-xl mx-auto mb-10">
            <p className="text-amber-400 font-bold text-sm tracking-wider uppercase">Trusted by Corporate Teams & Businesses</p>
            <h2 className="text-2xl md:text-3xl font-black mt-2">What Our Customers Say</h2>
          </div>

          <div className="grid gap-6 md:grid-cols-3">
            {[
              {
                name: "Vikram Sharma",
                role: "Tech Startup Founder",
                text: "The manual mockup approval process gave us 100% peace of mind. The logo alignment and print quality on the polo tees were exceptional!",
                rating: 5,
              },
              {
                name: "Ananya Patel",
                role: "HR & People Ops Lead",
                text: "Ordered 50 custom tees for our annual hackathon. Fast delivery, soft 240 GSM combed cotton fabric, and the team approved our proof in under an hour.",
                rating: 5,
              },
              {
                name: "Rahul Mehta",
                role: "Marketing Director",
                text: "Best POD experience for corporate apparel in India. HD printing doesn't fade even after multiple machine washes. Will order again!",
                rating: 5,
              },
            ].map((rev, i) => (
              <div key={i} className="rounded-2xl bg-zinc-900 border border-zinc-800 p-6 flex flex-col justify-between">
                <div>
                  <div className="text-amber-400 text-sm mb-3">{"★".repeat(rev.rating)}</div>
                  <p className="text-sm text-zinc-300 leading-relaxed italic">"{rev.text}"</p>
                </div>
                <div className="mt-6 pt-4 border-t border-zinc-800">
                  <p className="font-bold text-sm text-white">{rev.name}</p>
                  <p className="text-xs text-zinc-400">{rev.role}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
