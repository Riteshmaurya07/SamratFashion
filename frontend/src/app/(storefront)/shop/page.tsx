import Link from "next/link";
import { ChevronRight, SlidersHorizontal } from "lucide-react";
import { api } from "@/lib/api";
import { ProductCard, ProductCardProps } from "@/components/catalog/ProductCard";
import { ShopFilters, ShopToolbar, MobileFilters } from "@/components/catalog/ShopFilters";
import { Suspense } from "react";

export const dynamic = "force-dynamic";

async function getProducts(searchParams: { [key: string]: string | string[] | undefined }) {
  try {
    const params = new URLSearchParams();
    
    // Convert Next.js searchParams object to URLSearchParams for axios
    Object.entries(searchParams).forEach(([key, value]) => {
      if (typeof value === "string") {
        params.append(key, value);
      } else if (Array.isArray(value)) {
        value.forEach(v => params.append(key, v));
      }
    });

    const res = await api.get("/catalog/products", { params });
    return res.data;
  } catch (error) {
    console.error("Failed to fetch products", error);
    throw new Error("Failed to fetch products");
  }
}

export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const resolvedSearchParams = (await searchParams) || {};
  const { data } = await getProducts(resolvedSearchParams);
  const products = data?.products || [];
  const total = data?.total || 0;
  
  const currentSort = typeof resolvedSearchParams.sort === "string" ? resolvedSearchParams.sort : "";

  return (
    <main className="flex-grow w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-8 md:py-12">
      {/* Breadcrumbs & Header Section */}
      <div className="mb-12">
        <nav aria-label="Breadcrumb" className="flex text-on-surface-variant font-label-caps text-label-caps mb-6 gap-2 items-center">
          <Link href="/" className="hover:text-primary transition-colors">Home</Link>
          <ChevronRight className="w-4 h-4" />
          <span className="text-on-surface font-bold">Shop</span>
        </nav>
        
        <div className="flex flex-col md:flex-row justify-between items-end gap-6 border-b border-outline-variant/20 pb-8">
          <div className="max-w-2xl">
            <h1 className="font-display-lg-mobile md:font-display-lg text-display-lg-mobile md:text-display-lg text-on-surface mb-4">
              T-Shirts for Men & Women
            </h1>
            <p className="font-body-md text-body-md text-on-surface-variant">
              Premium heavy-weight cottons and oversized fits for the modern urban landscape. Engineered for comfort and style.
            </p>
          </div>
          <div className="text-right shrink-0 self-start md:self-end">
            <span className="font-label-caps text-label-caps text-on-surface-variant bg-surface-container py-2 px-4 rounded-full">
              {total} Products
            </span>
          </div>
        </div>

        {/* Subcategory Chips */}
        <div className="flex gap-4 overflow-x-auto hide-scrollbar py-6 mt-2">
          {["Oversized", "Graphic", "Anime", "Gaming", "Minimal", "Boxy Fit"].map(chip => (
            <Link 
              key={chip}
              href={`/shop?category=${chip.toLowerCase()}`}
              className={`shrink-0 px-6 py-2 rounded-full border font-label-caps text-label-caps transition-all shadow-sm hover:shadow-md ${
                resolvedSearchParams.category === chip.toLowerCase() 
                  ? "border-primary bg-primary text-on-primary font-bold" 
                  : "border-outline-variant/50 bg-surface-container-lowest text-on-surface hover:border-primary hover:text-primary"
              }`}
            >
              {chip}
            </Link>
          ))}
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-gutter">
        {/* Mobile Filter Toggle */}
        <div className="md:hidden flex justify-between items-center mb-6">
          <Suspense fallback={<button className="flex items-center gap-2 font-label-caps text-label-caps font-bold text-on-surface bg-surface-container-lowest px-4 py-2 rounded border border-outline-variant/20 shadow-sm"><SlidersHorizontal className="w-4 h-4" /> Filters</button>}>
            <MobileFilters />
          </Suspense>
          <div className="relative">
            {/* Simple mobile sort for now */}
            <select className="appearance-none bg-surface-container-lowest border border-outline-variant/20 text-on-surface font-label-caps text-label-caps py-2 px-4 rounded shadow-sm focus:ring-primary focus:border-primary">
              <option>Sort By</option>
            </select>
          </div>
        </div>

        {/* Sidebar Filters (25%) */}
        <Suspense fallback={<div className="hidden md:block w-full md:w-1/4 shrink-0 pr-4">Loading filters...</div>}>
          <ShopFilters />
        </Suspense>

        {/* Product Grid Area (75%) */}
        <div className="w-full md:w-3/4">
          <Suspense fallback={<div className="mb-6 h-14 bg-surface-container-lowest rounded-lg border border-outline-variant/10"></div>}>
            <ShopToolbar totalResults={total} currentSort={currentSort} />
          </Suspense>

          {/* Grid */}
          {products.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 gap-y-12">
              {products.map((product: ProductCardProps) => (
                <ProductCard key={product._id} {...product} />
              ))}
            </div>
          ) : (
            <div className="w-full py-20 flex flex-col items-center justify-center bg-surface-bright border border-outline-variant/20 rounded-lg">
              <p className="font-body-md text-on-surface-variant mb-4">No products found matching your filters.</p>
              <Link href="/shop" className="px-6 py-2 bg-primary text-on-primary rounded font-label-caps">CLEAR FILTERS</Link>
            </div>
          )}

          {/* Load More / Pagination */}
          {products.length > 0 && products.length < total && (
            <div className="mt-16 flex flex-col items-center justify-center border-t border-outline-variant/10 pt-12">
              <p className="font-body-sm text-body-sm text-on-surface-variant mb-4">
                You&apos;ve viewed {products.length} of {total} products
              </p>
              <div className="w-64 h-1 bg-surface-container-highest rounded-full mb-6 overflow-hidden">
                <div 
                  className="h-full bg-primary" 
                  style={{ width: `${(products.length / total) * 100}%` }}
                ></div>
              </div>
              <button className="px-8 py-3 bg-surface-container-lowest border border-outline-variant/50 text-on-surface font-body-md text-body-md font-bold rounded hover:border-primary hover:text-primary transition-all shadow-sm">
                Load More
              </button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
