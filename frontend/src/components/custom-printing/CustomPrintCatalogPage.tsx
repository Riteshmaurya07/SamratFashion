"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import {
  Package,
  Search,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Truck,
  CheckCircle2,
  X,
  SlidersHorizontal,
} from "lucide-react";
import { api } from "@/lib/api";
import { trackEvent } from "@/lib/analytics";
import CustomPrintCatalogCard from "./CustomPrintCatalogCard";
import BulkQuoteModal from "./BulkQuoteModal";
import { type CatalogItem } from "@/lib/customPrintCatalogData";

interface BackendCategory {
  _id: string;
  name: string;
  slug: string;
}

export default function CustomPrintCatalogPage() {
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [categories, setCategories] = useState<BackendCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter & Search states
  const [selectedCategory, setSelectedCategory] = useState("All Blanks");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"featured" | "price_asc" | "price_desc" | "moq_asc">("featured");

  // Bulk Quote Modal state
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [selectedBulkItem, setSelectedBulkItem] = useState<CatalogItem | null>(null);

  useEffect(() => {
    trackEvent("custom_print_catalog_view");

    async function loadCatalog() {
      setLoading(true);
      setError(null);
      try {
        const [itemsRes, catRes] = await Promise.all([
          api.get("/custom-print-catalog"),
          api.get("/custom-print-catalog/categories").catch(() => api.get("/catalog/categories")),
        ]);

        const printItems = itemsRes.data?.data;
        if (Array.isArray(printItems)) {
          setCatalogItems(printItems);
        } else {
          setCatalogItems([]);
        }

        const catData = catRes.data?.data;
        if (Array.isArray(catData)) {
          setCategories(catData);
        }
      } catch (err: unknown) {
        let msg = "Failed to load printable garments.";
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

    loadCatalog();
  }, []);

  // Filter & Sort Logic
  const filteredAndSortedItems = useMemo(() => {
    let result = [...catalogItems];

    // 1. Category Filter
    if (selectedCategory !== "All Blanks") {
      result = result.filter((item) => {
        if (item.categoryId && typeof item.categoryId === "object" && "name" in item.categoryId) {
          return (item.categoryId as BackendCategory).name === selectedCategory;
        }
        return item.category === selectedCategory;
      });
    }

    // 2. Search Query Filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter((item) => {
        const nameMatch = item.name.toLowerCase().includes(q);
        const descMatch = (item.description || "").toLowerCase().includes(q);
        const fabricMatch = (item.productId?.fabric || "").toLowerCase().includes(q);
        const fitMatch = (item.productId?.fit || "").toLowerCase().includes(q);
        return nameMatch || descMatch || fabricMatch || fitMatch;
      });
    }

    // 3. Sorting
    if (sortBy === "price_asc") {
      result.sort((a, b) => (a.displayPrice || a.productId?.basePrice || 0) - (b.displayPrice || b.productId?.basePrice || 0));
    } else if (sortBy === "price_desc") {
      result.sort((a, b) => (b.displayPrice || b.productId?.basePrice || 0) - (a.displayPrice || a.productId?.basePrice || 0));
    } else if (sortBy === "moq_asc") {
      result.sort((a, b) => (a.minOrderQuantity || 10) - (b.minOrderQuantity || 10));
    }

    return result;
  }, [catalogItems, selectedCategory, searchQuery, sortBy]);

  const handleOpenBulkModal = (item?: CatalogItem) => {
    setSelectedBulkItem(item || catalogItems[0] || null);
    setBulkModalOpen(true);
  };

  return (
    <main className="min-h-screen bg-background text-on-background pb-24">
      {/* Editorial Announcement Bar */}
      <div className="bg-neutral-900 text-white text-xs py-2 px-4 text-center font-label-caps tracking-widest uppercase">
        Complimentary Express Shipping on Orders Above ₹999 · Digital Proof Verification Before Production
      </div>

      {/* Compact Hero Section */}
      <section className="border-b border-outline-variant/20 bg-surface-container-low px-4 py-10 md:px-8 md:py-14">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-8">
            <div className="max-w-2xl space-y-4">
              <span className="font-label-caps text-xs text-primary font-bold uppercase tracking-[0.14em] flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                THREADVIBE // CUSTOM APPAREL LAB
              </span>
              <h1 className="font-headline-lg text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight text-on-surface leading-[1.15]">
                Your Logo. Your Team. Your T-Shirt.
              </h1>
              <p className="font-body-md text-sm md:text-base text-on-surface-variant leading-relaxed">
                Premium custom apparel for company uniforms, startup teams, colleges, events, and brand merchandise. Choose high-density Direct-to-Film (DTF) or screen printing with pre-press digital proofs before production.
              </p>

              {/* Primary & Secondary Action CTAs */}
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <a
                  href="#blanks"
                  className="inline-flex items-center gap-2 rounded-xl bg-neutral-900 px-5 py-3 text-xs font-bold text-white shadow-sm hover:bg-neutral-800 transition-all cursor-pointer font-label-caps"
                >
                  <span>Explore Products</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </a>
                <button
                  type="button"
                  onClick={() => handleOpenBulkModal()}
                  className="inline-flex items-center gap-2 rounded-xl border border-outline-variant/60 bg-surface-container-lowest px-5 py-3 text-xs font-bold text-on-surface hover:bg-surface-container transition-all cursor-pointer font-label-caps"
                >
                  <Package className="w-4 h-4 text-primary" />
                  <span>Bulk Enquiry</span>
                </button>
              </div>

              {/* Concise Trust Points Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4 border-t border-outline-variant/20 text-xs">
                <div className="flex items-center gap-2 text-on-surface">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="font-medium text-[11px] leading-tight">Digital Proof Approval</span>
                </div>
                <div className="flex items-center gap-2 text-on-surface">
                  <ShieldCheck className="w-4 h-4 text-primary shrink-0" />
                  <span className="font-medium text-[11px] leading-tight">100% Combed Cotton</span>
                </div>
                <div className="flex items-center gap-2 text-on-surface">
                  <Sparkles className="w-4 h-4 text-amber-500 shrink-0" />
                  <span className="font-medium text-[11px] leading-tight">MOQ from 10 pcs</span>
                </div>
                <div className="flex items-center gap-2 text-on-surface">
                  <Truck className="w-4 h-4 text-primary shrink-0" />
                  <span className="font-medium text-[11px] leading-tight">Express Pan-India</span>
                </div>
              </div>
            </div>

            {/* Hero Quick Badge Card */}
            <div className="rounded-2xl border border-outline-variant/30 bg-surface-container-lowest p-6 shadow-sm max-w-sm w-full space-y-4 self-center lg:self-auto shrink-0">
              <div className="flex items-center gap-2 text-primary font-bold text-xs uppercase tracking-wider">
                <Package className="w-4 h-4" />
                <span>3-Step Customization</span>
              </div>
              <ol className="space-y-3 text-xs text-on-surface-variant font-medium">
                <li className="flex items-start gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-black text-white text-[10px] font-bold">1</span>
                  <span><strong>Select Garment:</strong> Choose fit, fabric weight, and active blank color.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-black text-white text-[10px] font-bold">2</span>
                  <span><strong>Upload Logo:</strong> Preview front chest & back graphic positions.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-black text-white text-[10px] font-bold">3</span>
                  <span><strong>Proof & Order:</strong> Review digital mockup, approve quote, and produce.</span>
                </li>
              </ol>
              <Link
                href="/custom-designer"
                className="block text-center rounded-xl bg-surface-container py-2 text-xs font-bold text-primary hover:bg-surface-container-high transition-colors"
              >
                Or Launch 2D Studio Canvas ↗
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Catalog Blanks Discovery Section */}
      <section id="blanks" className="mx-auto max-w-7xl px-4 py-10 md:px-8">
        {/* Controls Toolbar: Search, Category Pills, and Sort Dropdown */}
        <div className="mb-8 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="font-headline-lg text-2xl md:text-3xl font-black text-on-surface">
                Printable Garment Collection
              </h2>
              <p className="font-body-sm text-xs md:text-sm text-on-surface-variant mt-0.5">
                Toggle between front and back mockups, view available sizes and colors, and configure your custom print.
              </p>
            </div>

            {/* Product Search Box */}
            <div className="relative w-full md:w-72">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-variant" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search garments, fabric..."
                className="w-full rounded-xl border border-outline-variant/40 bg-surface-container-lowest pl-10 pr-9 py-2 text-xs font-medium text-on-surface placeholder:text-neutral-400 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary transition-all"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface"
                  aria-label="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Categories and Sort Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-outline-variant/20">
            {/* Category Filter Pills */}
            <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto pb-1">
              <button
                onClick={() => setSelectedCategory("All Blanks")}
                className={`rounded-lg px-3.5 py-1.5 font-label-caps text-xs font-bold transition-colors cursor-pointer ${
                  selectedCategory === "All Blanks"
                    ? "bg-neutral-900 text-white"
                    : "border border-outline-variant/40 bg-surface-container-lowest text-on-surface-variant hover:border-outline hover:text-on-surface"
                }`}
              >
                All Blanks ({catalogItems.length})
              </button>
              {categories.map((cat) => (
                <button
                  key={cat._id}
                  onClick={() => setSelectedCategory(cat.name)}
                  className={`rounded-lg px-3.5 py-1.5 font-label-caps text-xs font-bold transition-colors cursor-pointer ${
                    selectedCategory === cat.name
                      ? "bg-neutral-900 text-white"
                      : "border border-outline-variant/40 bg-surface-container-lowest text-on-surface-variant hover:border-outline hover:text-on-surface"
                  }`}
                >
                  {cat.name}
                </button>
              ))}
            </div>

            {/* Sort Dropdown */}
            <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
              <SlidersHorizontal className="w-3.5 h-3.5 text-on-surface-variant" />
              <span className="text-xs text-on-surface-variant font-medium">Sort:</span>
              <select
                value={sortBy}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === "price_asc" || val === "price_desc" || val === "moq_asc") {
                    setSortBy(val);
                  } else {
                    setSortBy("featured");
                  }
                }}
                className="rounded-lg border border-outline-variant/40 bg-surface-container-lowest px-2.5 py-1.5 text-xs font-medium text-on-surface focus:border-primary focus:outline-none cursor-pointer"
              >
                <option value="featured">Featured</option>
                <option value="price_asc">Price: Low to High</option>
                <option value="price_desc">Price: High to Low</option>
                <option value="moq_asc">MOQ: Low to High</option>
              </select>
            </div>
          </div>
        </div>

        {/* Products Grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="overflow-hidden rounded-2xl border border-outline-variant/30 bg-surface-container-lowest animate-pulse">
                <div className="aspect-[4/5] w-full bg-surface-container-low" />
                <div className="p-4 space-y-2.5">
                  <div className="h-4 w-3/4 rounded bg-surface-container-low" />
                  <div className="h-3 w-1/2 rounded bg-surface-container-low" />
                  <div className="h-8 w-full rounded bg-surface-container-low mt-4" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-error/30 bg-error-container p-8 text-center text-on-error-container space-y-3">
            <p className="font-bold text-sm">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-lg bg-neutral-900 text-white text-xs font-bold"
            >
              Retry
            </button>
          </div>
        ) : filteredAndSortedItems.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-outline-variant/40 bg-surface-container-lowest p-12 text-center space-y-4">
            <Package className="h-10 w-10 text-on-surface-variant mx-auto" />
            <h3 className="font-headline-sm text-base font-bold text-on-surface">No printable garments found</h3>
            <p className="text-xs text-on-surface-variant max-w-md mx-auto">
              {searchQuery
                ? `No apparel blanks matched your search "${searchQuery}". Try clearing filters or using different keywords.`
                : "There are currently no active printable garments configured in this category."}
            </p>
            <div className="flex justify-center gap-3 pt-2">
              <button
                onClick={() => {
                  setSearchQuery("");
                  setSelectedCategory("All Blanks");
                }}
                className="px-4 py-2 rounded-lg border border-outline-variant/40 font-label-caps text-xs text-on-surface hover:bg-surface-container-low cursor-pointer"
              >
                Reset Filters
              </button>
              <Link
                href="/bulk-orders/request"
                className="px-4 py-2 rounded-lg bg-neutral-900 text-white font-label-caps text-xs font-bold hover:bg-neutral-800"
              >
                Submit Custom Bulk Request
              </Link>
            </div>
          </div>
        ) : (
          <div>
            <div className="mb-4 text-xs font-medium text-on-surface-variant">
              Showing {filteredAndSortedItems.length} of {catalogItems.length} customizable garments
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {filteredAndSortedItems.map((item) => (
                <CustomPrintCatalogCard
                  key={item._id}
                  item={item}
                  onOpenBulkQuote={(it) => handleOpenBulkModal(it)}
                />
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Bulk Quote Modal */}
      {selectedBulkItem && (
        <BulkQuoteModal
          isOpen={bulkModalOpen}
          onClose={() => setBulkModalOpen(false)}
          productName={selectedBulkItem.name}
          productId={selectedBulkItem.productId?._id}
          catalogItemId={selectedBulkItem._id}
          minQuantity={selectedBulkItem.minOrderQuantity || 10}
        />
      )}
    </main>
  );
}
