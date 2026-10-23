import Link from "next/link";
import Image from "next/image";
import { api } from "@/lib/api";
import { ProductCard, ProductCardProps } from "@/components/catalog/ProductCard";
import { getActiveCategories } from "@/lib/catalog";
export const dynamic = "force-dynamic";

// Server component data fetching
async function getHomepageData() {
  try {
    const res = await api.get("/catalog/homepage");
    return res.data?.data || null;
  } catch (error) {
    console.error("Failed to fetch homepage data", error);
    return null;
  }
}

async function getHeroBanner() {
  try {
    const res = await api.get("/catalog/banners?position=HERO");
    if (res.data?.success && res.data.data?.length > 0) {
      return res.data.data[0];
    }
    return null;
  } catch (error) {
    console.error("Failed to fetch CMS hero banner", error);
    return null;
  }
}

export default async function Homepage() {
  const [data, heroBanner, categories] = await Promise.all([
    getHomepageData(),
    getHeroBanner(),
    getActiveCategories(),
  ]);
  const trendingProducts = data?.trendingProducts || data?.trending || [];
  const newArrivals = data?.newArrivals || [];
  const featuredThemes = data?.featuredThemes || [];

  const heroImage = heroBanner?.image || "https://images.unsplash.com/photo-1552374196-1ab2a1c593e8?q=80&w=2000&auto=format&fit=crop";
  const heroTitle = heroBanner?.title || "HEAVYWEIGHT STREETWEAR // EDITION 2026";
  const heroSubtitle = heroBanner?.subtitle || "Engineered in 240+ GSM combed cotton with structured drop-shoulders and high-density precision prints. Designed for contemporary urban culture.";
  const firstCategory = categories.length > 0 ? categories[0] : null;
  const heroCtaLabel = heroBanner?.ctaLabel || (firstCategory ? `EXPLORE ${firstCategory.name.toUpperCase()}` : "EXPLORE DROPS");
  const heroCtaUrl = heroBanner?.ctaUrl || (firstCategory ? `/shop?category=${encodeURIComponent(firstCategory.slug)}` : "/shop");

  return (
    <main className="w-full flex flex-col items-center pb-16 lg:pb-0">
      {/* Hero Section - Contemporary Editorial Streetwear */}
      <section className="relative w-full min-h-[500px] sm:min-h-[580px] lg:h-[720px] flex items-center bg-neutral-950 overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center opacity-45 scale-[1.02] transition-transform duration-1000"
          style={{ backgroundImage: `url('${heroImage}')` }}
        ></div>
        <div className="absolute inset-0 bg-gradient-to-t from-neutral-950 via-neutral-950/40 to-transparent"></div>
        <div className="absolute inset-0 bg-radial from-transparent via-neutral-950/60 to-neutral-950/90"></div>

        <div className="relative z-10 w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-12 sm:py-16">
          <div className="max-w-3xl space-y-4 sm:space-y-6">
            <div className="inline-flex items-center gap-2.5 px-3 py-1 rounded-sm bg-neutral-900/90 border border-neutral-700/80 backdrop-blur-md">
              <span className="w-2 h-2 rounded-full bg-primary animate-ping"></span>
              <span className="font-mono text-[11px] tracking-[0.2em] uppercase text-neutral-300 font-semibold">
                DROP 01 // 240+ GSM COMBED COTTON
              </span>
            </div>

            <h1 className="font-headline-lg text-2xl sm:text-4xl lg:text-6xl font-black text-white uppercase tracking-[-0.04em] leading-[1.1]">
              {heroTitle}
            </h1>

            <p className="font-body-md text-xs sm:text-base text-neutral-300 max-w-xl leading-relaxed">
              {heroSubtitle}
            </p>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4 pt-1 sm:pt-2">
              <Link
                href={heroCtaUrl}
                className="w-full sm:w-auto inline-flex items-center justify-center px-6 sm:px-8 py-3.5 sm:py-4 bg-primary text-white rounded-md font-mono text-xs uppercase tracking-[0.15em] font-bold hover:bg-primary/90 transition-all shadow-[0_10px_30px_rgba(15,76,217,0.3)] active:scale-95 text-center min-h-[44px]"
              >
                {heroCtaLabel}
              </Link>
              <Link
                href="/custom-printing"
                className="w-full sm:w-auto inline-flex items-center justify-center px-6 sm:px-8 py-3.5 sm:py-4 bg-neutral-900/80 border border-neutral-700 text-white rounded-md font-mono text-xs uppercase tracking-[0.15em] font-bold hover:bg-white hover:text-neutral-950 transition-all backdrop-blur-md active:scale-95 text-center min-h-[44px]"
              >
                CUSTOM PRINT STUDIO
              </Link>
            </div>

            {/* Micro Garment Specs */}
            <div className="pt-4 sm:pt-6 border-t border-neutral-800/80 flex flex-wrap items-center gap-x-3 gap-y-1.5 sm:gap-6 text-neutral-400 font-mono text-[10px] sm:text-[11px]">
              <span>PRE-SHRUNK FABRIC</span>
              <span>&bull;</span>
              <span>DROP-SHOULDER CUT</span>
              <span>&bull;</span>
              <span>HIGH-DENSITY DTF</span>
            </div>
          </div>
        </div>
      </section>

      {/* Men's Streetwear Collections Grid */}
      <section className="py-12 md:py-20 bg-surface w-full border-b border-outline-variant/30 flex justify-center">
        <div className="w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop">
          <div className="flex flex-col md:flex-row md:items-end justify-between mb-6 sm:mb-10 gap-2 sm:gap-3">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary font-bold mb-1.5">CURATED ARCHITECTURE</p>
              <h2 className="font-headline-lg text-2xl md:text-3xl font-black text-on-surface uppercase tracking-tight">
                MEN&apos;S STREETWEAR CAPSULES
              </h2>
            </div>
            <Link href="/shop" className="font-mono text-xs text-on-surface-variant hover:text-primary transition-colors flex items-center gap-1 uppercase tracking-wider">
              View Full Catalog &rarr;
            </Link>
          </div>

          {categories.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 md:gap-6">
              {categories.map((cat) => {
                const hasValidImage = Boolean(cat.image && (cat.image.startsWith("http://") || cat.image.startsWith("https://") || cat.image.startsWith("/")));
                return (
                  <Link
                    key={cat._id}
                    href={`/shop?category=${encodeURIComponent(cat.slug)}`}
                    className="group relative h-60 sm:h-80 md:h-96 rounded-lg overflow-hidden border border-outline-variant/40 bg-neutral-900 flex flex-col justify-end p-3.5 sm:p-6 streetwear-card"
                  >
                    {hasValidImage ? (
                      <Image
                        src={cat.image as string}
                        alt={cat.name}
                        fill
                        sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                        className="object-cover object-center opacity-70 group-hover:scale-105 group-hover:opacity-85 transition-all duration-500"
                      />
                    ) : (
                      <div className="absolute inset-0 bg-gradient-to-br from-neutral-900 via-neutral-950 to-neutral-900 flex flex-col items-center justify-center p-6 border border-neutral-800">
                        <div className="w-12 h-12 rounded-xs border border-primary/40 bg-primary/10 flex items-center justify-center mb-3">
                          <span className="font-mono text-sm font-bold text-primary">
                            {cat.name.slice(0, 2).toUpperCase()}
                          </span>
                        </div>
                        <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-neutral-500">
                          THREADVIBE // EDITION
                        </span>
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-neutral-950 via-neutral-950/30 to-transparent"></div>
                    <div className="relative z-10 space-y-1">
                      <span className="font-mono text-[10px] tracking-widest uppercase text-primary font-bold">
                        {typeof cat.productCount === "number" && cat.productCount > 0 ? `${cat.productCount} DROPS` : "CAPSULE"}
                      </span>
                      <h3 className="font-headline-sm text-lg md:text-xl font-bold text-white uppercase tracking-tight">
                        {cat.name}
                      </h3>
                      {cat.description && (
                        <p className="text-xs text-neutral-300 line-clamp-1">{cat.description}</p>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="py-12 px-6 text-center border border-dashed border-outline-variant/40 rounded-xl bg-surface-container-low max-w-xl mx-auto">
              <p className="font-mono text-xs uppercase tracking-widest text-primary font-bold mb-1">CAPSULES IN PREPARATION</p>
              <p className="font-body-md text-xs sm:text-sm text-neutral-400">
                New streetwear collections are currently being curated. Explore our full catalog below.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Trending Streetwear Drops (Best Sellers) */}
      {trendingProducts.length > 0 && (
        <section className="py-12 md:py-24 bg-surface-container-lowest w-full flex justify-center border-b border-outline-variant/30">
          <div className="w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop">
            <div className="flex flex-col md:flex-row md:items-end justify-between mb-6 sm:mb-10 gap-2 sm:gap-3">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary font-bold mb-1.5">HIGH-DEMAND STREET EDITIONS</p>
                <h2 className="font-headline-lg text-2xl md:text-3xl font-black text-on-surface uppercase tracking-tight">
                  TRENDING DROPS
                </h2>
              </div>
              <Link href="/shop" className="font-mono text-xs text-on-surface-variant hover:text-primary transition-colors flex items-center gap-1 uppercase tracking-wider">
                Explore All Drops &rarr;
              </Link>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 md:gap-6">
              {trendingProducts.slice(0, 8).map((product: ProductCardProps) => (
                <ProductCard key={product._id} {...product} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Featured Theme Drops (Cyberpunk & Tokyo Underground) */}
      {featuredThemes.length > 0 && (
        <section className="py-12 md:py-20 bg-neutral-950 text-white w-full flex justify-center border-b border-neutral-800">
          <div className="w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop">
            <div className="max-w-2xl mb-8 sm:mb-12">
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary font-bold mb-2">LIMITED CAPSULES</p>
              <h2 className="font-headline-lg text-2xl md:text-4xl font-black uppercase tracking-tight">
                THEMATIC DESIGN DROPS
              </h2>
              <p className="text-neutral-400 text-sm mt-2 leading-relaxed">
                Curated capsule collections exploring dystopian cyberpunk themes, Tokyo night street culture, and retro-futuristic streetwear.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
              {featuredThemes.map((theme: { _id?: string; name: string; slug: string; thumbnail?: string }) => (
                <Link
                  key={theme.slug}
                  href={`/shop?theme=${theme.slug}`}
                  className="group relative h-64 sm:h-80 md:h-96 rounded-lg overflow-hidden border border-neutral-800 bg-neutral-900 flex flex-col justify-end p-5 sm:p-8"
                >
                  {theme.thumbnail && (
                    <Image
                      src={theme.thumbnail}
                      alt={theme.name}
                      fill
                      className="object-cover opacity-60 group-hover:scale-105 group-hover:opacity-75 transition-all duration-700"
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-neutral-950 via-neutral-950/40 to-transparent"></div>
                  <div className="relative z-10 space-y-2">
                    <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary font-bold">CAPSULE RELEASE</span>
                    <h3 className="font-headline-sm text-2xl font-black uppercase text-white tracking-tight">{theme.name}</h3>
                    <span className="inline-flex items-center gap-1 font-mono text-xs text-neutral-300 group-hover:text-primary transition-colors uppercase pt-1">
                      Shop Collection &rarr;
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* New Arrivals Section */}
      {newArrivals.length > 0 && (
        <section className="py-12 md:py-24 bg-surface w-full flex justify-center border-b border-outline-variant/30">
          <div className="w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop">
            <div className="flex flex-col md:flex-row md:items-end justify-between mb-6 sm:mb-10 gap-2 sm:gap-3">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary font-bold mb-1.5">JUST UNBOXED</p>
                <h2 className="font-headline-lg text-2xl md:text-3xl font-black text-on-surface uppercase tracking-tight">
                  NEW STREET ARRIVALS
                </h2>
              </div>
              <Link href="/shop" className="font-mono text-xs text-on-surface-variant hover:text-primary transition-colors flex items-center gap-1 uppercase tracking-wider">
                View All New Items &rarr;
              </Link>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 md:gap-6">
              {newArrivals.slice(0, 8).map((product: ProductCardProps) => (
                <ProductCard key={product._id} {...product} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Craftsmanship & Garment Philosophy */}
      <section className="py-12 md:py-24 bg-neutral-900 text-white w-full flex justify-center">
        <div className="w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
            <div className="lg:col-span-5 space-y-4">
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-primary font-bold">MATERIAL INTEGRITY</p>
              <h2 className="font-headline-lg text-3xl md:text-4xl font-black uppercase tracking-tight leading-tight">
                NOT JUST CLOTHING. STRUCTURED STREET ARCHITECTURE.
              </h2>
              <p className="text-neutral-300 text-sm leading-relaxed pt-2">
                Every Threadvibe piece is cut from high-density 240+ GSM combed cotton with pre-washed shrinkage control. Designed to maintain its boxy silhouette and collar tension wear after wear.
              </p>
              <div className="pt-4">
                <Link
                  href="/shop"
                  className="inline-flex items-center gap-2 font-mono text-xs uppercase font-bold text-primary hover:text-white transition-colors"
                >
                  DISCOVER THE COLLECTION &rarr;
                </Link>
              </div>
            </div>

            <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-neutral-950 p-6 rounded-lg border border-neutral-800 space-y-2">
                <span className="font-mono text-2xl font-black text-primary">240+</span>
                <h4 className="font-mono text-xs uppercase font-bold text-neutral-100">GSM Heavy Cotton</h4>
                <p className="text-neutral-400 text-xs leading-relaxed">Dense 100% combed cotton jersey for crisp, structured drape.</p>
              </div>
              <div className="bg-neutral-950 p-6 rounded-lg border border-neutral-800 space-y-2">
                <span className="font-mono text-2xl font-black text-primary">0%</span>
                <h4 className="font-mono text-xs uppercase font-bold text-neutral-100">Shrinkage Treated</h4>
                <p className="text-neutral-400 text-xs leading-relaxed">Bio-washed and pre-shrunk so your fit stays identical wash after wash.</p>
              </div>
              <div className="bg-neutral-950 p-6 rounded-lg border border-neutral-800 space-y-2">
                <span className="font-mono text-2xl font-black text-primary">50+</span>
                <h4 className="font-mono text-xs uppercase font-bold text-neutral-100">Wash Durability</h4>
                <p className="text-neutral-400 text-xs leading-relaxed">Direct-to-Film print cure tested against cracking and fading.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Custom Print Studio Callout */}
      <section className="py-12 md:py-20 bg-surface w-full flex justify-center">
        <div className="w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop">
          <div className="bg-gradient-to-br from-neutral-950 via-neutral-900 to-neutral-950 rounded-xl p-6 sm:p-8 md:p-14 border border-neutral-800 text-white relative overflow-hidden flex flex-col md:flex-row items-start md:items-center justify-between gap-6 md:gap-8">
            <div className="space-y-3 max-w-xl z-10">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-xs bg-primary/20 text-primary border border-primary/30 font-mono text-[10px] uppercase font-bold">
                CUSTOM PRINTING STUDIO
              </div>
              <h3 className="font-headline-lg text-2xl md:text-3xl font-black uppercase tracking-tight">
                CREATE YOUR OWN STREETWEAR GRAPHICS
              </h3>
              <p className="text-neutral-300 text-xs sm:text-sm leading-relaxed">
                Upload your artwork, select front, back, or sleeve placements on premium heavyweight blanks, and approve high-resolution staff mockups before production.
              </p>
            </div>
            <div className="z-10 w-full sm:w-auto shrink-0">
              <Link
                href="/custom-printing"
                className="w-full sm:w-auto px-6 sm:px-8 py-3.5 sm:py-4 bg-primary text-white font-mono text-xs uppercase font-bold tracking-wider rounded-md hover:bg-primary/90 transition-colors inline-flex items-center justify-center shadow-lg active:scale-95 text-center min-h-[44px]"
              >
                START CUSTOM PRINT &rarr;
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
