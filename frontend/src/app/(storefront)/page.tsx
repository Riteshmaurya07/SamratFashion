import { cache } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight } from "lucide-react";
import { api } from "@/lib/api";
import { ProductCard, ProductCardProps } from "@/components/catalog/ProductCard";
import { getActiveCategories, CategoryItem } from "@/lib/catalog";
import * as motion from "motion/react-client";
import { BannerTracker } from "@/components/storefront/BannerTracker";
export const dynamic = "force-dynamic";
interface MemStore<T> {
  data: T;
  expires: number;
}
const homepageMemCache = new Map<string, MemStore<unknown>>();
const HP_TTL_MS = 60_000;

function getHpCached<T>(key: string): T | null {
  const c = homepageMemCache.get(key);
  if (c && c.expires > Date.now()) return c.data as T;
  return null;
}

function setHpCached<T>(key: string, data: T): T {
  homepageMemCache.set(key, { data, expires: Date.now() + HP_TTL_MS });
  return data;
}

// Server component data fetching
const getHomepageData = cache(async function getHomepageData() {
  const cached = getHpCached<any>("homepageData");
  if (cached) return cached;
  try {
    const res = await api.get("/catalog/homepage");
    const data = res.data?.data || null;
    if (data) setHpCached("homepageData", data);
    return data;
  } catch (error) {
    console.error("Failed to fetch homepage data", error);
    return cached || null;
  }
});

const getHeroBanner = cache(async function getHeroBanner() {
  const cached = getHpCached<any>("heroBanner");
  if (cached !== null && cached !== undefined) return cached;
  try {
    const res = await api.get("/catalog/banners?position=HERO");
    if (res.data?.success && res.data.data?.length > 0) {
      return setHpCached("heroBanner", res.data.data[0]);
    }
    return setHpCached("heroBanner", null);
  } catch (error) {
    console.error("Failed to fetch CMS hero banner", error);
    return cached ?? null;
  }
});

const getPromotionalBanners = cache(async function getPromotionalBanners() {
  const cached = getHpCached<any[]>("promotionalBanners");
  if (cached) return cached;
  try {
    const res = await api.get("/catalog/banners?position=PROMOTIONAL_TILE");
    if (res.data?.success && Array.isArray(res.data.data)) {
      return setHpCached("promotionalBanners", res.data.data);
    }
    return [];
  } catch (error) {
    console.error("Failed to fetch promotional banners", error);
    return cached || [];
  }
});

const getFeaturedCampaigns = cache(async function getFeaturedCampaigns() {
  const cached = getHpCached<any[]>("featuredCampaigns");
  if (cached) return cached;
  try {
    const res = await api.get("/catalog/campaigns/active");
    if (res.data?.success && Array.isArray(res.data.data)) {
      return setHpCached("featuredCampaigns", res.data.data);
    }
    return [];
  } catch (error) {
    console.error("Failed to fetch active campaigns", error);
    return cached || [];
  }
});

export default async function Homepage() {
  const [data, heroBanner, categories, promoBanners, activeCampaigns] = await Promise.all([
    getHomepageData(),
    getHeroBanner(),
    getActiveCategories(),
    getPromotionalBanners(),
    getFeaturedCampaigns(),
  ]);
  const trendingProducts = data?.trendingProducts || data?.trending || [];
  const newArrivals = data?.newArrivals || [];
  const featuredThemes = data?.featuredThemes || [];

  const heroImage = heroBanner?.image || "https://images.unsplash.com/photo-1552374196-1ab2a1c593e8?q=80&w=2000&auto=format&fit=crop";
  const heroTitle = heroBanner?.title ? heroBanner.title.replace(/\s*\/\/\s*/g, " · ") : "HEAVYWEIGHT STREETWEAR · EDITION 2026";
  const heroSubtitle = heroBanner?.subtitle || "Engineered in 240+ GSM combed cotton with structured drop-shoulders and high-density precision prints. Designed for contemporary urban culture.";
  const allCategories: CategoryItem[] = categories && categories.length > 0 ? categories : (data?.categories || []);
  const rootCategories = allCategories
    .filter((c: CategoryItem) => {
      if (c.status && c.status !== "ACTIVE") return false;
      if (c.parentCategory) {
        if (typeof c.parentCategory === "string" && c.parentCategory.trim().length > 0) return false;
        if (typeof c.parentCategory === "object" && c.parentCategory._id) return false;
      }
      const slug = (c.slug || "").toLowerCase();
      // Jersey and Corporate Jersey are subcategories under Custom Print and must not appear as root category cards
      if (slug === "jersey" || slug === "corporate-jersey") return false;
      return true;
    })
    .sort((a: CategoryItem, b: CategoryItem) => (a.displayOrder || 0) - (b.displayOrder || 0));
  const firstCategory = rootCategories.length > 0 ? rootCategories[0] : null;
  const heroCtaLabel = heroBanner?.ctaLabel || (firstCategory ? `EXPLORE ${firstCategory.name.toUpperCase()}` : "EXPLORE DROPS");
  const heroCtaUrl = heroBanner?.ctaUrl || (firstCategory ? `/shop?category=${encodeURIComponent(firstCategory.slug)}` : "/shop");

  const getRootCategoryHref = (cat: { slug: string }) => {
    if (cat.slug === "custom-print" || cat.slug === "custom-printing") {
      return "/custom-printing";
    }
    return `/shop?category=${encodeURIComponent(cat.slug)}`;
  };

  return (
    <main className="w-full flex flex-col items-center pb-24 lg:pb-0">
      {/* Hero Section - Contemporary Editorial Streetwear */}
      <section className="relative w-full min-h-[500px] sm:min-h-[580px] lg:h-[720px] flex items-center bg-neutral-950 overflow-hidden">
        <BannerTracker bannerId={heroBanner?._id} className="w-full h-full flex items-center">
          <div
            className="absolute inset-0 bg-cover bg-center opacity-45 scale-[1.02] transition-transform duration-1000"
            style={{ backgroundImage: `url('${heroImage}')` }}
          ></div>
          {/* Dynamic Gradient Overlay */}
          {heroBanner?.overlayStrength === "NONE" ? null : (
            <div
              className={`absolute inset-0 transition-opacity ${
                heroBanner?.textColor === "DARK"
                  ? heroBanner?.overlayStrength === "LIGHT"
                    ? "bg-gradient-to-t from-white/40 via-white/15 to-transparent"
                    : heroBanner?.overlayStrength === "HEAVY"
                    ? "bg-gradient-to-t from-white/95 via-white/70 to-white/30"
                    : "bg-gradient-to-t from-white/85 via-white/40 to-transparent"
                  : heroBanner?.overlayStrength === "LIGHT"
                  ? "bg-gradient-to-t from-neutral-950/40 via-neutral-950/15 to-transparent"
                  : heroBanner?.overlayStrength === "HEAVY"
                  ? "bg-gradient-to-t from-neutral-950/95 via-neutral-950/70 to-neutral-950/30"
                  : "bg-gradient-to-t from-neutral-950 via-neutral-950/40 to-transparent"
              }`}
            />
          )}
          <div className="absolute inset-0 bg-radial from-transparent via-neutral-950/60 to-neutral-950/90 pointer-events-none"></div>

          <div className="relative z-10 w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-12 sm:py-16">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className={`max-w-3xl space-y-4 sm:space-y-6 ${
                heroBanner?.textAlignment === "CENTER"
                  ? "mx-auto text-center flex flex-col items-center"
                  : heroBanner?.textAlignment === "RIGHT"
                  ? "ml-auto text-right flex flex-col items-end"
                  : "text-left"
              }`}
            >
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/20 backdrop-blur-md">
                <span className="w-1.5 h-1.5 rounded-full bg-white/80"></span>
                <span className="font-mono text-[11px] tracking-[0.18em] uppercase text-white/90 font-semibold">
                  EDITION 2026 · APPAREL &amp; CUSTOM STUDIO
                </span>
              </div>

              <h1 className={`font-headline-lg text-3xl sm:text-5xl lg:text-7xl font-black uppercase tracking-[-0.035em] leading-[0.98] ${heroBanner?.textColor === "DARK" ? "text-neutral-900" : "text-white"}`}>
                {heroTitle}
              </h1>

              <p className={`font-body-md text-sm sm:text-base max-w-xl leading-relaxed ${heroBanner?.textColor === "DARK" ? "text-neutral-700" : "text-neutral-300"}`}>
                {heroSubtitle}
              </p>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4 pt-1 sm:pt-2">
                <Link
                  href={heroCtaUrl}
                  className="w-full sm:w-auto inline-flex items-center justify-center px-8 py-3.5 sm:py-4 bg-white text-neutral-950 rounded-md font-mono text-xs uppercase tracking-[0.15em] font-bold hover:bg-neutral-200 transition-colors text-center min-h-[44px]"
                >
                  {heroCtaLabel}
                </Link>
                <Link
                  href="/offers"
                  className="w-full sm:w-auto inline-flex items-center justify-center px-8 py-3.5 sm:py-4 bg-white/10 border border-white/25 text-white rounded-md font-mono text-xs uppercase tracking-[0.15em] font-bold hover:bg-white hover:text-neutral-950 transition-all backdrop-blur-md text-center min-h-[44px]"
                >
                  VIEW SPECIAL OFFERS
                </Link>
              </div>

              {/* Micro Garment Specs */}
              <div className="pt-4 sm:pt-6 border-t border-neutral-800/80 flex flex-wrap items-center gap-x-4 gap-y-2 text-neutral-400 font-mono text-[10px] sm:text-[11px]">
                <span className="text-neutral-200 font-semibold">240+ GSM COMBED COTTON</span>
                <span className="text-neutral-600">/</span>
                <span className="text-neutral-200 font-semibold">BIO-WASHED PRE-SHRUNK</span>
                <span className="text-neutral-600">/</span>
                <span className="text-neutral-200 font-semibold">PAN-INDIA EXPRESS DISPATCH</span>
              </div>
            </motion.div>
          </div>
        </BannerTracker>
      </section>

      {/* Men's Streetwear Collections Grid */}
      <section className="py-12 md:py-20 bg-surface w-full border-b border-outline-variant/30 flex justify-center">
        <div className="w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop">
          <div className="flex flex-col md:flex-row md:items-end justify-between mb-6 sm:mb-10 gap-2 sm:gap-3">
            <div>
              <h2 className="font-headline-lg text-2xl md:text-4xl font-black text-on-surface uppercase tracking-tight">
                COLLECTIONS &amp; CUSTOM APPAREL
              </h2>
            </div>
            <Link href="/shop" className="font-mono text-xs text-on-surface hover:text-neutral-600 font-bold transition-colors flex items-center gap-1.5 uppercase tracking-wider">
              <span>View Full Catalog</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {rootCategories.length > 0 ? (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 md:gap-6">
              {rootCategories.map((cat) => {
                const hasValidImage = Boolean(cat.image && (cat.image.startsWith("http://") || cat.image.startsWith("https://") || cat.image.startsWith("/")));
                const href = getRootCategoryHref(cat);
                return (
                  <motion.div
                    key={cat._id}
                    whileHover={{ y: -4 }}
                    transition={{ type: "spring", stiffness: 400, damping: 25 }}
                    className="h-full"
                  >
                    <Link
                      href={href}
                      className="group relative h-60 sm:h-80 md:h-96 rounded-lg overflow-hidden border border-outline-variant/40 bg-neutral-900 flex flex-col justify-end p-3.5 sm:p-6 streetwear-card block"
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
                  </motion.div>
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
            <div className="flex flex-col md:flex-row md:items-end justify-between mb-8 sm:mb-12 gap-3">
              <div>
                <h2 className="font-headline-lg text-2xl md:text-4xl font-black text-on-surface uppercase tracking-tight">
                  TRENDING DROPS
                </h2>
              </div>
              <Link href="/shop" className="font-mono text-xs text-on-surface hover:text-neutral-600 font-bold transition-colors flex items-center gap-1.5 uppercase tracking-wider">
                <span>Explore All Drops</span>
                <ArrowRight className="w-3.5 h-3.5" />
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
              <h2 className="font-headline-lg text-2xl md:text-4xl font-black uppercase tracking-tight text-white">
                THEMATIC CAPSULES
              </h2>
              <p className="text-neutral-400 text-xs sm:text-sm mt-2 leading-relaxed">
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
                    <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-neutral-400 font-semibold">CAPSULE RELEASE</span>
                    <h3 className="font-headline-sm text-2xl font-black uppercase text-white tracking-tight">{theme.name}</h3>
                    <span className="inline-flex items-center gap-1 font-mono text-xs text-neutral-300 group-hover:text-white transition-colors uppercase pt-1 font-bold">
                      <span>Shop Collection</span>
                      <ArrowRight className="w-3.5 h-3.5" />
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
            <div className="flex flex-col md:flex-row md:items-end justify-between mb-8 sm:mb-12 gap-3">
              <div>
                <h2 className="font-headline-lg text-2xl md:text-4xl font-black text-on-surface uppercase tracking-tight">
                  NEW ARRIVALS
                </h2>
              </div>
              <Link href="/shop" className="font-mono text-xs text-on-surface hover:text-neutral-600 font-bold transition-colors flex items-center gap-1.5 uppercase tracking-wider">
                <span>View All New</span>
                <ArrowRight className="w-3.5 h-3.5" />
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
      <section className="py-16 md:py-24 bg-neutral-950 text-white w-full flex justify-center border-b border-neutral-800">
        <div className="w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-16 items-start">
            <div className="lg:col-span-5 space-y-4">
              <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-neutral-400 font-semibold">
                THE 240+ GSM STANDARD
              </span>
              <h2 className="font-headline-lg text-3xl sm:text-4xl lg:text-5xl font-black uppercase tracking-tight leading-[1.05]">
                BUILT HEAVY. CUT BOXY. MADE TO LAST.
              </h2>
              <p className="text-neutral-300 text-sm sm:text-base leading-relaxed pt-1">
                Every Threadvibe piece is cut from high-density 240+ GSM combed cotton jersey with pre-washed shrinkage control. Designed to maintain its structured drop-shoulder silhouette and collar tension wear after wear.
              </p>
              <div className="pt-2">
                <Link
                  href="/shop"
                  className="inline-flex items-center gap-2 font-mono text-xs uppercase font-bold tracking-wider text-white hover:text-neutral-300 transition-colors"
                >
                  <span>Explore Garment Collection</span>
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>

            <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-3 gap-px bg-neutral-800 border border-neutral-800 rounded-xl overflow-hidden">
              <div className="bg-neutral-950 p-6 sm:p-8 flex flex-col justify-between space-y-4">
                <span className="font-mono text-3xl font-black text-white">240+</span>
                <div>
                  <h4 className="font-mono text-xs uppercase font-bold text-white tracking-wider">Heavyweight Jersey</h4>
                  <p className="text-neutral-400 text-xs leading-relaxed mt-1">100% combed cotton with structured drape and zero cling.</p>
                </div>
              </div>
              <div className="bg-neutral-950 p-6 sm:p-8 flex flex-col justify-between space-y-4">
                <span className="font-mono text-3xl font-black text-white">0%</span>
                <div>
                  <h4 className="font-mono text-xs uppercase font-bold text-white tracking-wider">Shrinkage Treated</h4>
                  <p className="text-neutral-400 text-xs leading-relaxed mt-1">Bio-washed fabric retains collar shape and drop-shoulder dimensions.</p>
                </div>
              </div>
              <div className="bg-neutral-950 p-6 sm:p-8 flex flex-col justify-between space-y-4">
                <span className="font-mono text-3xl font-black text-white">50+</span>
                <div>
                  <h4 className="font-mono text-xs uppercase font-bold text-white tracking-wider">Wash Durability</h4>
                  <p className="text-neutral-400 text-xs leading-relaxed mt-1">High-density Direct-to-Film prints cured against cracking or fading.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Dynamic Offers & Promotional Discount Banners */}
      <section className="py-12 md:py-20 bg-surface w-full flex justify-center">
        <div className="w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop space-y-8">
          {/* Active Campaigns Showcase */}
          {activeCampaigns.length > 0 ? (
            <div className="space-y-6">
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
                <div>
                  <h3 className="font-headline-lg text-2xl md:text-3xl font-black text-on-surface uppercase tracking-tight">
                    ACTIVE OFFERS &amp; DROPS
                  </h3>
                </div>
                <Link
                  href="/offers"
                  className="font-mono text-xs text-on-surface hover:text-neutral-600 font-bold uppercase tracking-wider flex items-center gap-1.5"
                >
                  <span>View All Deals</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                {activeCampaigns.slice(0, 2).map((camp: { _id?: string; name: string; discountTag?: string; description?: string; couponId?: { code?: string; discountValue?: number; discountType?: string } }) => (
                  <div
                    key={camp._id || camp.name}
                    className="bg-neutral-950 text-white p-6 sm:p-8 rounded-2xl border border-neutral-800 relative overflow-hidden flex flex-col justify-between"
                  >
                    <div className="space-y-3 z-10">
                      {camp.discountTag && (
                        <span className="inline-block px-3 py-1 rounded bg-neutral-900 border border-neutral-700 text-white font-mono text-xs uppercase font-extrabold tracking-wider">
                          {camp.discountTag}
                        </span>
                      )}
                      <h4 className="font-headline-lg text-xl sm:text-2xl font-black uppercase text-white tracking-tight">
                        {camp.name}
                      </h4>
                      {camp.description && (
                        <p className="text-neutral-400 text-xs sm:text-sm leading-relaxed max-w-lg">
                          {camp.description}
                        </p>
                      )}
                    </div>

                    <div className="pt-6 mt-6 border-t border-neutral-800 flex flex-wrap items-center justify-between gap-4 z-10">
                      {camp.couponId?.code ? (
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-neutral-400 uppercase">CODE:</span>
                          <span className="px-3 py-1 rounded border border-dashed border-neutral-600 text-white font-mono text-xs font-bold uppercase tracking-wider bg-white/5">
                            {camp.couponId.code}
                          </span>
                        </div>
                      ) : (
                        <span className="font-mono text-xs text-neutral-400 uppercase">STOREWIDE PROMOTION</span>
                      )}

                      <Link
                        href="/offers"
                        className="px-6 py-3 bg-white text-neutral-950 font-mono text-xs uppercase font-bold rounded-md hover:bg-neutral-200 transition-colors"
                      >
                        CLAIM OFFER &rarr;
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Promotional Banners Grid */}
          {promoBanners.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
              {promoBanners.slice(0, 3).map((b: { _id?: string; title: string; subtitle?: string; image: string; ctaLabel?: string; ctaUrl?: string }) => (
                <div
                  key={b._id || b.title}
                  className="group relative h-64 sm:h-72 rounded-2xl overflow-hidden border border-neutral-800 bg-neutral-900 flex flex-col justify-end p-6"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={b.image}
                    alt={b.title}
                    className="absolute inset-0 w-full h-full object-cover opacity-60 group-hover:scale-105 group-hover:opacity-75 transition-all duration-700"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-neutral-950 via-neutral-950/40 to-transparent"></div>
                  <div className="relative z-10 space-y-2">
                    <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-neutral-400 font-semibold">
                      FEATURED PROMO
                    </span>
                    <h4 className="font-headline-sm text-xl font-black uppercase text-white tracking-tight">
                      {b.title}
                    </h4>
                    {b.subtitle && (
                      <p className="text-neutral-300 text-xs line-clamp-2">{b.subtitle}</p>
                    )}
                    <Link
                      href={b.ctaUrl || "/shop"}
                      className="inline-flex items-center gap-1 font-mono text-xs text-neutral-300 group-hover:text-white transition-colors uppercase pt-2 font-bold"
                    >
                      <span>{b.ctaLabel || "SHOP DROP"}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* Default Offers Showcase when no promotional banners configured */
            <div className="bg-gradient-to-br from-neutral-950 via-neutral-900 to-neutral-950 rounded-2xl p-6 sm:p-8 md:p-12 border border-neutral-800 text-white relative overflow-hidden flex flex-col md:flex-row items-start md:items-center justify-between gap-6 md:gap-8">
              <div className="space-y-3 max-w-xl z-10">
                <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-neutral-400 font-semibold">
                  LIMITED CAPSULES &amp; VOUCHERS
                </span>
                <h3 className="font-headline-lg text-2xl md:text-3xl font-black uppercase tracking-tight">
                  SEASON OFFERS &amp; DISCOUNTS
                </h3>
                <p className="text-neutral-300 text-xs sm:text-sm leading-relaxed">
                  Explore exclusive promotional codes, seasonal discounts, and free shipping over ₹999 on all heavyweight 240+ GSM streetwear capsules.
                </p>
              </div>
              <div className="z-10 w-full sm:w-auto shrink-0 flex flex-col sm:flex-row gap-3">
                <Link
                  href="/offers"
                  className="w-full sm:w-auto px-8 py-4 bg-white text-neutral-950 font-mono text-xs uppercase font-bold tracking-wider rounded-md hover:bg-neutral-200 transition-colors inline-flex items-center justify-center text-center min-h-[44px]"
                >
                  EXPLORE OFFERS &rarr;
                </Link>
                <Link
                  href="/shop"
                  className="w-full sm:w-auto px-8 py-4 bg-neutral-900 border border-neutral-700 text-white font-mono text-xs uppercase font-bold tracking-wider rounded-md hover:bg-white hover:text-neutral-950 transition-colors inline-flex items-center justify-center text-center min-h-[44px]"
                >
                  SHOP DROPS
                </Link>
              </div>
            </div>
          )}
        </div>
      </section>

    </main>
  );
}
