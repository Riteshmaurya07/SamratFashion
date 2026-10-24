"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import {
  Package,
  Search,
  Sparkles,
  ShieldCheck,
  Truck,
  CheckCircle2,
  X,
  SlidersHorizontal,
  MessageCircle,
  HelpCircle,
  ChevronDown,
  Star,
  Layers,
  Clock,
  Receipt,
} from "lucide-react";
import { api } from "@/lib/api";
import { trackEvent } from "@/lib/analytics";
import CustomPrintCatalogCard from "./CustomPrintCatalogCard";
import BulkQuoteModal from "./BulkQuoteModal";
import { type CatalogItem } from "@/lib/customPrintCatalogData";


const FAQS = [
  {
    q: "Can I order just 2 pieces to check the quality before ordering in bulk?",
    a: "Yes! Unlike traditional printing presses that demand 50+ pieces minimum, our sample MOQ starts at just 2 pieces. You can test our fabric weight, fitting, and high-definition print quality with a 2-piece sample before placing your company's full bulk order.",
  },
  {
    q: "How does the design approval process work? Will I see a mockup before printing?",
    a: "Every single order includes free design verification. Once you upload your logo or artwork, our in-house graphic design team creates a photorealistic 3D digital proof showing the exact placement, dimensions, and colors. We share this preview via WhatsApp and Email for your approval before a single thread is printed.",
  },
  {
    q: "What file formats can I upload for my company logo?",
    a: "We support PNG, JPG, JPEG, SVG, PDF, AI, and CorelDRAW (CDR) files up to 25 MB. For best results, vector files (SVG/PDF/AI) or high-resolution PNGs (300 DPI with transparent background) are recommended. If your logo is low-resolution, our designers will vectorize it for free.",
  },
  {
    q: "How long does production and delivery take across India?",
    a: "Sample orders (2–5 pcs) are printed and dispatched within 48 business hours. Bulk orders (20–500 pcs) dispatch in 3–5 business days. We partner with Delhivery, BlueDart, and express air cargo for door-to-door delivery across all 19,000+ Indian PIN codes, typically taking 2–4 days after dispatch.",
  },
  {
    q: "Can I mix different sizes (e.g. 5 M, 10 L, 5 XL) and colors in a single order?",
    a: "Yes! In any bulk order, you can freely divide your total quantity across any standard sizes (S, M, L, XL, 2XL, 3XL, 4XL) at no additional charge. You can even split colors as long as the print artwork remains identical.",
  },
  {
    q: "Do you provide a GST business tax invoice for Input Tax Credit (ITC)?",
    a: "Absolutely. All corporate and team orders include a 100% compliant GST invoice featuring your business legal name, GSTIN, and state code. You can claim full 18% Input Tax Credit on business merch and uniforms.",
  },
  {
    q: "Will the logo print crack or fade after washing?",
    a: "No. We use premium Direct-to-Film (DTF) and cured screen printing technology with colorfast OEKO-TEX certified inks. The print withstands 50+ wash cycles without peeling, cracking, or color degradation when washed inside-out in cold or warm water.",
  },
];

const FABRIC_COMPARISON = [
  {
    name: "Classic Polo Matty Blend",
    gsm: "200–220 GSM",
    composition: "60% Cotton, 40% Polyester Pique",
    feel: "Structured, wrinkle-resistant, breathable collar",
    bestFor: "Corporate office uniforms, retail staff, exhibitions, conferences",
    durability: "Excellent for everyday office wear; minimal ironing needed",
    badge: "Most Popular for Teams",
  },
  {
    name: "100% Pure Combed Cotton",
    gsm: "240–260 GSM Heavyweight",
    composition: "100% Super-Combed Bio-Washed Cotton",
    feel: "Ultra-soft luxury handfeel, maximum breathability",
    bestFor: "Startup merch, college fest tees, executive gifts, premium retail",
    durability: "Pre-shrunk fabric; rich colorfast finish that gets softer with every wash",
    badge: "Premium Handfeel",
  },
  {
    name: "Micro-Polyester Dry-Fit",
    gsm: "160–180 GSM Featherweight",
    composition: "100% Performance Micro-Poly Mesh",
    feel: "Moisture-wicking, quick-drying athletic stretch",
    bestFor: "Marathons, sports tournaments, fitness teams, outdoor field reps",
    durability: "Sweat-wicking, anti-bacterial, color vibrant under direct sunlight",
    badge: "Athletic Performance",
  },
];

const VOLUME_TIERS = [
  { range: "2 – 5 Pcs", label: "Sample Batch", discount: "Standard Price", note: "Test fabric & print fit before bulk" },
  { range: "6 – 20 Pcs", label: "Small Teams", discount: "15% OFF", note: "Ideal for startups & small departments" },
  { range: "21 – 50 Pcs", label: "Company Teams", discount: "25% OFF", note: "Free design proof & priority dispatch" },
  { range: "51 – 100 Pcs", label: "Annual Uniforms", discount: "35% OFF", note: "Dedicated account manager & free swatch" },
  { range: "100+ Pcs", label: "Enterprise Bulk", discount: "45% OFF", note: "Custom neck tags, polybags & best pricing" },
];

const REVIEWS = [
  {
    name: "Rohan Varma",
    role: "Founder, Zenith Media (Bengaluru)",
    review: "Ordered 35 polo t-shirts with our logo for our annual team offsite. The 2-piece sample came in 3 days, and the bulk order was flawless. The collar and logo print quality exceeded expectations.",
    rating: 5,
    tag: "Verified Team Order (35 Pcs)",
  },
  {
    name: "Pooja Singhal",
    role: "HR Lead, Nexus Tech (Pune)",
    review: "The WhatsApp proof approval saved us from a logo placement mistake! Their designer noticed our logo had a white outline and corrected it for free before printing. GST invoice arrived instantly.",
    rating: 5,
    tag: "Verified Corporate Client",
  },
  {
    name: "Amitabh Banerjee",
    role: "Events Head, IIT Kharagpur Fest",
    review: "We ordered 250 pure cotton oversized tees for our fest committee. Super soft 240 GSM fabric, vibrant back print, and delivered 2 days ahead of schedule. Truly hassle-free.",
    rating: 5,
    tag: "Verified Bulk Order (250 Pcs)",
  },
];

export default function CustomPrintCatalogPage() {
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter & Search states (Database-driven)
  const [availableCategories, setAvailableCategories] = useState<Array<{ _id: string; name: string; slug: string; parentCategory?: any }>>([]);
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"featured" | "price_asc" | "price_desc" | "moq_asc">("featured");


  // Bulk Quote Modal state
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [selectedBulkItem, setSelectedBulkItem] = useState<CatalogItem | null>(null);

  // FAQ Accordion State
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(0);

  useEffect(() => {
    trackEvent("custom_print_catalog_view");

    async function loadCatalog() {
      setLoading(true);
      setError(null);
      try {
        const [itemsRes, catRes] = await Promise.all([
          api.get("/custom-print-catalog"),
          api.get("/custom-print-catalog/categories"),
        ]);
        const printItems = itemsRes.data?.data;
        if (Array.isArray(printItems)) {
          setCatalogItems(printItems);
        } else {
          setCatalogItems([]);
        }
        if (Array.isArray(catRes.data?.data)) {
          setAvailableCategories(catRes.data.data);
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

    // 1. Category Filter (Database-driven by category ID / slug)
    if (selectedCategory !== "All") {
      result = result.filter((item) => {
        const itemCat = item.categoryId;
        if (itemCat && typeof itemCat === "object") {
          if (itemCat.slug === selectedCategory || itemCat._id === selectedCategory) return true;
          if (itemCat.parentCategory) {
            const pSlug = typeof itemCat.parentCategory === "object" ? itemCat.parentCategory.slug : undefined;
            const pId = typeof itemCat.parentCategory === "object" ? itemCat.parentCategory._id : itemCat.parentCategory;
            if (pSlug === selectedCategory || pId === selectedCategory) return true;
          }
        } else if (typeof itemCat === "string") {
          if (itemCat === selectedCategory) return true;
        }

        const prodCat = item.productId?.categoryId;
        if (prodCat) {
          if (typeof prodCat === "object") {
            return prodCat.slug === selectedCategory || prodCat._id === selectedCategory;
          }
          return prodCat === selectedCategory;
        }

        return false;
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
      result.sort((a, b) => (a.minOrderQuantity || 2) - (b.minOrderQuantity || 2));
    }

    return result;
  }, [catalogItems, selectedCategory, searchQuery, sortBy]);

  const handleOpenBulkModal = (item?: CatalogItem) => {
    setSelectedBulkItem(item || catalogItems[0] || null);
    setBulkModalOpen(true);
  };


  return (
    <main className="min-h-screen bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 pb-24">
      {/* 1. Top Urgency & Trust Ribbon (PrintMine Style) */}
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

      {/* 2. Breadcrumbs Bar */}
      <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-8">
        <nav aria-label="Breadcrumb" className="text-xs text-neutral-500 dark:text-neutral-400 flex items-center gap-1.5">
          <Link href="/" className="hover:text-neutral-900 dark:hover:text-white transition-colors">Home</Link>
          <span>/</span>
          <Link href="/custom-printing" className="hover:text-neutral-900 dark:hover:text-white transition-colors">Collections</Link>
          <span>/</span>
          <span className="text-neutral-900 dark:text-white font-semibold">Custom Logo Printed T-Shirts</span>
        </nav>
      </div>

      {/* 3. Collection Hero Header (PrintMine Style) */}
      <section className="px-4 pt-6 pb-10 sm:px-8 sm:pt-8 sm:pb-12 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/60">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-3xl space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full bg-neutral-100 dark:bg-neutral-800 px-3 py-1 text-xs font-semibold text-neutral-700 dark:text-neutral-300">
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              <span>Printed In-House with Zero Middlemen</span>
            </div>

            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight text-neutral-950 dark:text-white leading-[1.15]">
              Custom Logo T-Shirts for Companies & Teams — From 2 Pieces
            </h1>

            <p className="text-sm sm:text-base text-neutral-600 dark:text-neutral-300 leading-relaxed">
              Order branded Polo T-shirts, 100% combed cotton tees, and dry-fit uniforms printed with your company logo in-house. Start with a <strong>2-piece sample</strong> before placing bulk company orders. You approve a <strong>3D digital preview on WhatsApp</strong> before anything is printed.
            </p>

            {/* 4 Trust Feature Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3">
              <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800/50 p-3">
                <span className="text-xs font-bold text-neutral-900 dark:text-white flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  From 2 Pieces
                </span>
                <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5">Test sample fit before bulk</p>
              </div>

              <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800/50 p-3">
                <span className="text-xs font-bold text-neutral-900 dark:text-white flex items-center gap-1.5">
                  <MessageCircle className="w-3.5 h-3.5 text-emerald-600" />
                  Free Proof
                </span>
                <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5">WhatsApp approval first</p>
              </div>

              <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800/50 p-3">
                <span className="text-xs font-bold text-neutral-900 dark:text-white flex items-center gap-1.5">
                  <Truck className="w-3.5 h-3.5 text-blue-600" />
                  Pan-India Fast
                </span>
                <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5">Doorstep express courier</p>
              </div>

              <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800/50 p-3">
                <span className="text-xs font-bold text-neutral-900 dark:text-white flex items-center gap-1.5">
                  <Receipt className="w-3.5 h-3.5 text-indigo-600" />
                  GST Invoices
                </span>
                <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5">Claim full 18% ITC</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 5. Catalog Blanks Discovery Section */}
      <section id="blanks" className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
        {/* Controls Toolbar: Search, Category Pills, and Sort Dropdown */}
        <div className="mb-8 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl sm:text-3xl font-black text-neutral-950 dark:text-white">
                Best Sellers & Custom Apparel Collection
              </h2>
              <p className="text-xs sm:text-sm text-neutral-500 dark:text-neutral-400 mt-1">
                The gifts & uniforms teams reorder the most. Select any style, preview front/back logo zones, and start with a 2-piece sample.
              </p>
            </div>

            {/* Product Search Box */}
            <div className="relative w-full md:w-80">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search polo, cotton, hoodies..."
                className="w-full rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 pl-10 pr-9 py-2.5 text-xs font-medium text-neutral-900 dark:text-white placeholder:text-neutral-400 focus:border-neutral-900 dark:focus:border-white focus:outline-none transition-all"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
                  aria-label="Clear search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Categories and Sort Bar (PrintMine Pill Style) */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-neutral-200 dark:border-neutral-800">
            {/* Category Filter Pills (Horizontal scroll on mobile) */}
            <div className="flex flex-nowrap items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none -mx-4 px-4 sm:mx-0 sm:px-0">
              <button
                type="button"
                onClick={() => setSelectedCategory("All")}
                className={`rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all cursor-pointer ${
                  selectedCategory === "All"
                    ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 shadow-xs"
                    : "border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-300 hover:border-neutral-400"
                }`}
              >
                All Items
              </button>
              {availableCategories.map((cat) => {
                const isSelected = selectedCategory === cat.slug || selectedCategory === cat._id;
                return (
                  <button
                    key={cat._id}
                    type="button"
                    onClick={() => setSelectedCategory(cat.slug)}
                    className={`rounded-lg px-3.5 py-1.5 text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                      isSelected
                        ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 shadow-xs"
                        : "border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-300 hover:border-neutral-400"
                    }`}
                  >
                    {cat.name}
                  </button>
                );
              })}
            </div>

            {/* Sort Dropdown */}
            <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
              <SlidersHorizontal className="w-3.5 h-3.5 text-neutral-500" />
              <span className="text-xs text-neutral-500 font-medium">Sort:</span>
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
                className="rounded-lg border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2.5 py-1.5 text-xs font-medium text-neutral-900 dark:text-white focus:border-neutral-900 focus:outline-none cursor-pointer"
              >
                <option value="featured">Best Sellers</option>
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
              <div key={i} className="overflow-hidden rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 animate-pulse">
                <div className="aspect-[4/5] w-full bg-neutral-200 dark:bg-neutral-800" />
                <div className="p-4 space-y-2.5">
                  <div className="h-4 w-3/4 rounded bg-neutral-200 dark:bg-neutral-800" />
                  <div className="h-3 w-1/2 rounded bg-neutral-200 dark:bg-neutral-800" />
                  <div className="h-8 w-full rounded bg-neutral-200 dark:bg-neutral-800 mt-4" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 dark:bg-red-950/30 p-8 text-center text-red-700 dark:text-red-300 space-y-3">
            <p className="font-bold text-sm">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-lg bg-neutral-900 text-white text-xs font-bold"
            >
              Retry
            </button>
          </div>
        ) : filteredAndSortedItems.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-12 text-center space-y-4">
            <Package className="h-10 w-10 text-neutral-400 mx-auto" />
            <h3 className="text-base font-bold text-neutral-900 dark:text-white">No custom apparel blanks matched</h3>
            <p className="text-xs text-neutral-500 max-w-md mx-auto">
              {searchQuery
                ? `No apparel blanks matched your search "${searchQuery}". Try clearing filters or using different keywords.`
                : "There are currently no active customizable garments in this category."}
            </p>
            <div className="flex justify-center gap-3 pt-2">
              <button
                onClick={() => {
                  setSearchQuery("");
                  setSelectedCategory("All T-Shirts");
                }}
                className="px-4 py-2 rounded-lg border border-neutral-300 text-xs font-semibold hover:bg-neutral-50 cursor-pointer"
              >
                Reset Filters
              </button>
              <Link
                href="/bulk-orders/request"
                className="px-4 py-2 rounded-lg bg-neutral-900 text-white text-xs font-bold hover:bg-neutral-800"
              >
                Submit Custom Bulk Request
              </Link>
            </div>
          </div>
        ) : (
          <div>
            <div className="mb-4 text-xs font-medium text-neutral-500 flex items-center justify-between">
              <span>Showing {filteredAndSortedItems.length} customizable styles</span>
              <span className="text-[11px] text-emerald-700 font-semibold bg-emerald-50 px-2 py-0.5 rounded">
                Sample order starts at 2 pieces
              </span>
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

      {/* 6. "Inside the SamratFashion Studio & Factory" (PrintMine Factory Showcase) */}
      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-8 border-t border-neutral-200 dark:border-neutral-800">
        <div className="rounded-3xl bg-neutral-900 text-white p-8 sm:p-12 overflow-hidden relative">
          <div className="max-w-3xl space-y-4">
            <span className="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              Inside the SamratFashion Print Studio
            </span>
            <h2 className="text-3xl sm:text-4xl font-black tracking-tight text-white">
              Why 81,000+ Teams Reorder From Us
            </h2>
            <p className="text-sm sm:text-base text-neutral-300 leading-relaxed">
              We own the entire process from fabric knitting and tailoring to high-density DTF and screen printing. Zero trading, zero middlemen commissions — you get factory-direct quality, sharp logo fidelity, and fast dispatch.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 pt-10 border-t border-neutral-800 mt-8">
            <div className="space-y-2">
              <div className="h-10 w-10 rounded-xl bg-neutral-800 flex items-center justify-center text-amber-400">
                <Layers className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-base text-white">In-House Manufacturing</h3>
              <p className="text-xs text-neutral-400 leading-relaxed">
                Directly spun, dyed, cut, and stitched. Consistent fabric weights (200–260 GSM) that hold shape wash after wash.
              </p>
            </div>

            <div className="space-y-2">
              <div className="h-10 w-10 rounded-xl bg-neutral-800 flex items-center justify-center text-emerald-400">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-base text-white">50+ Wash Longevity</h3>
              <p className="text-xs text-neutral-400 leading-relaxed">
                High-density Japanese inks and cured DTF heat transfers guarantee zero cracking, peeling, or fading under regular machine wash.
              </p>
            </div>

            <div className="space-y-2">
              <div className="h-10 w-10 rounded-xl bg-neutral-800 flex items-center justify-center text-blue-400">
                <MessageCircle className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-base text-white">WhatsApp Proof Sign-Off</h3>
              <p className="text-xs text-neutral-400 leading-relaxed">
                No blind surprises. You receive an accurate 3D proof on WhatsApp with logo millimeter scale before production begins.
              </p>
            </div>

            <div className="space-y-2">
              <div className="h-10 w-10 rounded-xl bg-neutral-800 flex items-center justify-center text-purple-400">
                <Clock className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-base text-white">48h Express Dispatch</h3>
              <p className="text-xs text-neutral-400 leading-relaxed">
                Rapid turnaround for event merchandise and offsites, with live tracking via Delhivery and BlueDart across all Indian PIN codes.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 7. The 4-Step Custom Ordering Process ("How It Works") */}
      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-8 border-t border-neutral-200 dark:border-neutral-800">
        <div className="text-center max-w-2xl mx-auto space-y-3 mb-10">
          <span className="text-xs font-bold uppercase tracking-wider text-neutral-500">Simple & Transparent</span>
          <h2 className="text-3xl font-black text-neutral-950 dark:text-white">
            How Custom Ordering Works
          </h2>
          <p className="text-xs sm:text-sm text-neutral-500">
            From your logo upload to doorstep delivery in 4 effortless steps.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 space-y-3 relative">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-900 text-white font-mono text-xs font-black">
              1
            </span>
            <h3 className="font-bold text-base text-neutral-900 dark:text-white">Pick Your Garment</h3>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">
              Choose from Polo Matty, 100% Super-Combed Cotton, or Micro-Poly Dry-Fit in over 15 rich brand colors.
            </p>
          </div>

          <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 space-y-3 relative">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-900 text-white font-mono text-xs font-black">
              2
            </span>
            <h3 className="font-bold text-base text-neutral-900 dark:text-white">Upload Your Artwork</h3>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">
              Submit your company logo, crest, or text in PNG, JPG, PDF, or SVG. Specify front, back, or sleeve placement.
            </p>
          </div>

          <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 space-y-3 relative">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-white font-mono text-xs font-black">
              3
            </span>
            <h3 className="font-bold text-base text-neutral-900 dark:text-white">Approve WhatsApp Proof</h3>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">
              Our graphic designers generate a high-definition 3D proof. We WhatsApp it to you; we only print once you give the green light.
            </p>
          </div>

          <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 space-y-3 relative">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-900 text-white font-mono text-xs font-black">
              4
            </span>
            <h3 className="font-bold text-base text-neutral-900 dark:text-white">Doorstep Fast Delivery</h3>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 leading-relaxed">
              Carefully printed, ironed, individually poly-packed, and shipped with live courier tracking and a compliant GST invoice.
            </p>
          </div>
        </div>
      </section>

      {/* 8. Fabric & Material Comparison Matrix */}
      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-8 border-t border-neutral-200 dark:border-neutral-800">
        <div className="max-w-2xl mb-8">
          <span className="text-xs font-bold uppercase tracking-wider text-neutral-500">Fabric Guide</span>
          <h2 className="text-2xl sm:text-3xl font-black text-neutral-950 dark:text-white mt-1">
            Compare Our 3 Signature Fabrics
          </h2>
          <p className="text-xs sm:text-sm text-neutral-500 mt-1">
            Choose the right weight and breathability for your team uniforms, events, or merchandise.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {FABRIC_COMPARISON.map((f) => (
            <div
              key={f.name}
              className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 flex flex-col justify-between shadow-xs space-y-4"
            >
              <div className="space-y-3">
                <span className="inline-block rounded-md bg-neutral-100 dark:bg-neutral-800 px-2.5 py-1 text-[11px] font-bold text-neutral-800 dark:text-neutral-200">
                  {f.badge}
                </span>
                <h3 className="text-lg font-black text-neutral-900 dark:text-white">{f.name}</h3>
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between border-b border-neutral-100 dark:border-neutral-800 pb-1.5">
                    <span className="text-neutral-400">Weight:</span>
                    <span className="font-bold text-neutral-800 dark:text-neutral-200">{f.gsm}</span>
                  </div>
                  <div className="flex justify-between border-b border-neutral-100 dark:border-neutral-800 pb-1.5">
                    <span className="text-neutral-400">Composition:</span>
                    <span className="font-semibold text-neutral-800 dark:text-neutral-200 text-right">{f.composition}</span>
                  </div>
                  <div className="pt-1 text-neutral-600 dark:text-neutral-300">
                    <strong className="block text-neutral-900 dark:text-white mb-0.5">Feel & Texture:</strong>
                    {f.feel}
                  </div>
                  <div className="pt-2 text-neutral-600 dark:text-neutral-300">
                    <strong className="block text-neutral-900 dark:text-white mb-0.5">Best Used For:</strong>
                    {f.bestFor}
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-neutral-100 dark:border-neutral-800">
                <a
                  href="#blanks"
                  className="block text-center rounded-xl bg-neutral-100 dark:bg-neutral-800 py-2.5 text-xs font-bold text-neutral-900 dark:text-white hover:bg-neutral-200 transition-colors"
                >
                  View Styles in this Fabric →
                </a>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 9. Transparent Bulk Tier Pricing Table */}
      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-8 border-t border-neutral-200 dark:border-neutral-800">
        <div className="rounded-3xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-8 sm:p-10 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-600">Volume Savings</span>
              <h2 className="text-2xl sm:text-3xl font-black text-neutral-950 dark:text-white mt-1">
                Transparent Bulk Discount Tiers
              </h2>
              <p className="text-xs sm:text-sm text-neutral-500 mt-1">
                The more your team orders, the more you save. No hidden pre-press or screen setup charges.
              </p>
            </div>

            <button
              type="button"
              onClick={() => handleOpenBulkModal()}
              className="inline-flex items-center gap-2 rounded-xl bg-neutral-900 text-white px-5 py-3 text-xs font-bold hover:bg-neutral-800 transition-colors cursor-pointer self-start md:self-auto shrink-0"
            >
              <Package className="w-4 h-4 text-amber-400" />
              <span>Get Custom Quote for 50+ Pcs</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {VOLUME_TIERS.map((tier) => (
              <div
                key={tier.range}
                className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800/40 p-4 flex flex-col justify-between"
              >
                <div>
                  <span className="font-mono text-sm font-black text-neutral-950 dark:text-white">{tier.range}</span>
                  <p className="text-xs font-semibold text-neutral-500 mt-0.5">{tier.label}</p>
                </div>
                <div className="my-3 py-2 border-y border-neutral-200 dark:border-neutral-700">
                  <span className="text-base font-black text-emerald-600 dark:text-emerald-400">{tier.discount}</span>
                </div>
                <p className="text-[11px] text-neutral-500 leading-tight">{tier.note}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 10. Client Reviews & Corporate Wall of Love */}
      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-8 border-t border-neutral-200 dark:border-neutral-800">
        <div className="text-center max-w-xl mx-auto space-y-2 mb-8">
          <span className="text-xs font-bold uppercase tracking-wider text-amber-600 flex items-center justify-center gap-1">
            <Star className="w-3.5 h-3.5 fill-amber-500 text-amber-500" />
            4.9 / 5 Customer Rating
          </span>
          <h2 className="text-2xl sm:text-3xl font-black text-neutral-950 dark:text-white">
            Loved by Fast-Growing Companies
          </h2>
          <p className="text-xs sm:text-sm text-neutral-500">
            Real feedback from team leaders, startup founders, and event managers.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {REVIEWS.map((rev) => (
            <div
              key={rev.name}
              className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 space-y-4 flex flex-col justify-between shadow-2xs"
            >
              <div className="space-y-3">
                <div className="flex items-center gap-1 text-amber-400">
                  {Array.from({ length: rev.rating }).map((_, i) => (
                    <Star key={i} className="w-4 h-4 fill-amber-400 text-amber-400" />
                  ))}
                </div>
                <p className="text-xs text-neutral-600 dark:text-neutral-300 leading-relaxed italic">
                  &ldquo;{rev.review}&rdquo;
                </p>
              </div>

              <div className="pt-3 border-t border-neutral-100 dark:border-neutral-800">
                <strong className="block text-xs font-bold text-neutral-900 dark:text-white">{rev.name}</strong>
                <span className="text-[11px] text-neutral-500 block">{rev.role}</span>
                <span className="inline-block mt-1.5 rounded bg-emerald-50 text-emerald-800 text-[10px] font-bold px-2 py-0.5">
                  {rev.tag}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 11. Frequently Asked Questions (PrintMine Accordion FAQs) */}
      <section className="mx-auto max-w-4xl px-4 py-12 sm:px-8 border-t border-neutral-200 dark:border-neutral-800">
        <div className="text-center space-y-2 mb-8">
          <span className="text-xs font-bold uppercase tracking-wider text-neutral-500 flex items-center justify-center gap-1">
            <HelpCircle className="w-3.5 h-3.5 text-neutral-500" />
            Frequently Asked Questions
          </span>
          <h2 className="text-2xl sm:text-3xl font-black text-neutral-950 dark:text-white">
            Everything You Need to Know
          </h2>
          <p className="text-xs sm:text-sm text-neutral-500">
            Have questions about artwork, sample orders, or delivery timelines? We have answers.
          </p>
        </div>

        <div className="space-y-3">
          {FAQS.map((faq, index) => {
            const isOpen = openFaqIndex === index;
            return (
              <div
                key={faq.q}
                className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden transition-all shadow-xs"
              >
                <button
                  type="button"
                  onClick={() => setOpenFaqIndex(isOpen ? null : index)}
                  className="w-full flex items-center justify-between p-5 text-left text-xs sm:text-sm font-bold text-neutral-900 dark:text-white hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors cursor-pointer"
                  aria-expanded={isOpen}
                >
                  <span className="pr-4">{faq.q}</span>
                  <ChevronDown
                    className={`w-4 h-4 text-neutral-400 shrink-0 transition-transform duration-200 ${
                      isOpen ? "rotate-180 text-neutral-900 dark:text-white" : ""
                    }`}
                  />
                </button>
                {isOpen && (
                  <div className="px-5 pb-5 pt-0 text-xs text-neutral-600 dark:text-neutral-300 leading-relaxed border-t border-neutral-100 dark:border-neutral-800">
                    <div className="pt-3">{faq.a}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* 12. Floating Direct WhatsApp Help Bar (Above mobile bottom bar) */}
      <div className="fixed bottom-20 md:bottom-6 right-4 sm:right-6 z-40 flex items-center gap-2">
        <a
          href="https://wa.me/916262127724?text=Hi%20SamratFashion%2C%20I%20want%20to%20order%20custom%20logo%20printed%20t-shirts%20for%20my%20team"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-4 py-3 shadow-lg hover:shadow-xl transition-all cursor-pointer backdrop-blur-md active:scale-95"
          aria-label="Chat with our custom print specialist on WhatsApp"
        >
          <MessageCircle className="w-5 h-5 fill-white text-emerald-600" />
          <span className="hidden sm:inline">WhatsApp Print Specialist</span>
        </a>
      </div>

      {/* Bulk Quote Modal */}
      {selectedBulkItem && (
        <BulkQuoteModal
          isOpen={bulkModalOpen}
          onClose={() => setBulkModalOpen(false)}
          productName={selectedBulkItem.name}
          productId={selectedBulkItem.productId?._id}
          catalogItemId={selectedBulkItem._id}
          minQuantity={selectedBulkItem.minOrderQuantity || 2}
        />
      )}
    </main>
  );
}
