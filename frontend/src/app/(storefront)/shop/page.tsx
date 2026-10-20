import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { api } from "@/lib/api";
import { ShopCatalogLayout } from "@/components/catalog/ShopCatalogLayout";
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
    return { data: { items: [], total: 0 } };
  }
}

import { ShopSearchTracker } from "@/components/catalog/ShopSearchTracker";

export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const resolvedSearchParams = (await searchParams) || {};
  const resData = await getProducts(resolvedSearchParams);
  const products = resData?.data?.items || resData?.data?.products || [];
  const total = resData?.data?.total || 0;

  const activeQuery = typeof resolvedSearchParams.search === "string" ? resolvedSearchParams.search : typeof resolvedSearchParams.q === "string" ? resolvedSearchParams.q : "";
  const currentSort = typeof resolvedSearchParams.sort === "string" ? resolvedSearchParams.sort : "";

  return (
    <main className="flex-grow w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-8 md:py-12">
      <ShopSearchTracker query={activeQuery} totalResults={total} />
      {/* Breadcrumbs & Header Section */}
      <div className="mb-8">
        <nav aria-label="Breadcrumb" className="flex text-on-surface-variant font-mono text-xs mb-5 gap-2 items-center">
          <Link href="/" className="hover:text-primary transition-colors">Home</Link>
          <ChevronRight className="w-3.5 h-3.5 text-neutral-400" />
          <span className="text-on-surface font-bold uppercase">Streetwear Catalog</span>
        </nav>

        <div className="flex flex-col border-b border-outline-variant/30 pb-6">
          <div className="max-w-3xl flex flex-col items-start gap-2.5">
            <div className="flex items-center gap-3.5 flex-wrap">
              <h1 className="font-headline-lg text-2xl sm:text-3xl lg:text-4xl font-black text-on-surface tracking-tight uppercase">
                {activeQuery
                  ? `Search: "${activeQuery}"`
                  : resolvedSearchParams.category
                  ? `${String(resolvedSearchParams.category).toUpperCase()} COLLECTION`
                  : "MEN'S STREETWEAR & GRAPHIC TEES"}
              </h1>
              <span className="font-mono text-xs text-neutral-700 bg-surface-container-high py-1 px-3 rounded-full font-bold">
                {total} DROPS
              </span>
            </div>
            <p className="font-body-md text-xs sm:text-sm text-on-surface-variant leading-relaxed">
              {activeQuery
                ? `Showing authentic catalog drops matching query "${activeQuery}".`
                : "240+ GSM combed cotton jersey, engineered drop-shoulder silhouettes, and high-density precision prints."}
            </p>
          </div>
        </div>

        {/* Streetwear Collection Shortcuts */}
        <div className="flex gap-2.5 overflow-x-auto hide-scrollbar py-5">
          {[
            { slug: "", label: "ALL DROPS" },
            { slug: "oversized", label: "OVERSIZED TEES" },
            { slug: "graphic", label: "GRAPHIC STREET" },
            { slug: "anime", label: "ANIME & CYBER" },
            { slug: "minimal", label: "MINIMAL BOXY" },
          ].map(chip => {
            const isSelected = (!chip.slug && !resolvedSearchParams.category) || resolvedSearchParams.category === chip.slug;
            return (
              <Link
                key={chip.slug}
                href={chip.slug ? `/shop?category=${chip.slug}` : "/shop"}
                className={`shrink-0 px-4 py-2 rounded-md font-mono text-xs uppercase tracking-wider transition-colors ${
                  isSelected
                    ? "bg-neutral-900 text-white font-bold"
                    : "border border-outline-variant/60 bg-surface-container-lowest text-on-surface hover:border-neutral-900"
                }`}
              >
                {chip.label}
              </Link>
            );
          })}
        </div>
      </div>

      <Suspense fallback={<div className="h-96 w-full animate-pulse bg-surface-container-low rounded-2xl" />}>
        <ShopCatalogLayout
          products={products}
          total={total}
          currentSort={currentSort}
          activeQuery={activeQuery}
        />
      </Suspense>
    </main>
  );
}
