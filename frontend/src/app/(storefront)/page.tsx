import { cache } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight } from "lucide-react";
import { api } from "@/lib/api";
import { getActiveCategories, CategoryItem } from "@/lib/catalog";
import * as motion from "motion/react-client";
import { HeroBannerSlider, HeroBannerItem } from "@/components/storefront/HeroBannerSlider";
import { MarqueeTicker } from "@/components/storefront/MarqueeTicker";
import { CategoryPillNav } from "@/components/storefront/CategoryPillNav";
import { TabbedDropsSection } from "@/components/storefront/TabbedDropsSection";
import { GarmentAnatomySection } from "@/components/storefront/GarmentAnatomySection";
import { InteractiveCampaignCards } from "@/components/storefront/InteractiveCampaignCards";
import { TrustPillarsBar } from "@/components/storefront/TrustPillarsBar";
import { ProductCardProps } from "@/components/catalog/ProductCard";
export const dynamic = "force-dynamic";
interface MemStore<T> {
  data: T;
  expires: number;
}
const homepageMemCache = new Map<string, MemStore<unknown>>();
const HP_TTL_MS = 60_000;
interface PromoBannerItem {
  _id?: string;
  title: string;
  subtitle?: string;
  image: string;
  ctaLabel?: string;
  ctaUrl?: string;
}

interface CampaignBannerRef {
  _id?: string;
  title?: string;
  subtitle?: string;
  image: string;
  mobileImage?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  textColor?: "LIGHT" | "DARK";
  textAlignment?: "LEFT" | "CENTER" | "RIGHT";
  overlayStrength?: "NONE" | "LIGHT" | "MEDIUM" | "HEAVY";
}

interface ActiveCampaignItem {
  _id?: string;
  name: string;
  slug?: string;
  description?: string;
  discountTag?: string;
  couponId?: {
    code?: string;
    discountValue?: number;
    discountType?: string;
  };
  bannerIds?: CampaignBannerRef[];
}

interface HomepageData {
  trendingProducts?: ProductCardProps[];
  trending?: ProductCardProps[];
  newArrivals?: ProductCardProps[];
  featuredThemes?: Array<{ _id?: string; name: string; slug: string; thumbnail?: string }>;
  categories?: CategoryItem[];
}

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
const getHomepageData = cache(async function getHomepageData(): Promise<HomepageData | null> {
  const cached = getHpCached<HomepageData>("homepageData");
  if (cached) return cached;
  try {
    const res = await api.get("/catalog/homepage");
    const data = (res.data?.data as HomepageData) || null;
    if (data) setHpCached("homepageData", data);
    return data;
  } catch (error) {
    console.error("Failed to fetch homepage data", error);
    return cached || null;
  }
});

const getHeroBanners = cache(async function getHeroBanners(): Promise<HeroBannerItem[]> {
  const cached = getHpCached<HeroBannerItem[]>("heroBanners");
  if (cached) return cached;
  try {
    const res = await api.get("/catalog/banners?position=HERO");
    if (res.data?.success && Array.isArray(res.data.data) && res.data.data.length > 0) {
      return setHpCached("heroBanners", res.data.data);
    }
    return setHpCached("heroBanners", []);
  } catch (error) {
    console.error("Failed to fetch CMS hero banners", error);
    return cached || [];
  }
});

const getPromotionalBanners = cache(async function getPromotionalBanners(): Promise<PromoBannerItem[]> {
  const cached = getHpCached<PromoBannerItem[]>("promotionalBanners");
  if (cached) return cached;
  try {
    const res = await api.get("/catalog/banners?position=PROMOTIONAL_TILE");
    if (res.data?.success && Array.isArray(res.data.data)) {
      return setHpCached("promotionalBanners", res.data.data as PromoBannerItem[]);
    }
    return [];
  } catch (error) {
    console.error("Failed to fetch promotional banners", error);
    return cached || [];
  }
});

const getFeaturedCampaigns = cache(async function getFeaturedCampaigns(): Promise<ActiveCampaignItem[]> {
  const cached = getHpCached<ActiveCampaignItem[]>("featuredCampaigns");
  if (cached) return cached;
  try {
    const res = await api.get("/catalog/campaigns/active");
    if (res.data?.success && Array.isArray(res.data.data)) {
      return setHpCached("featuredCampaigns", res.data.data as ActiveCampaignItem[]);
    }
    return [];
  } catch (error) {
    console.error("Failed to fetch active campaigns", error);
    return cached || [];
  }
});

export default async function Homepage() {
  const [data, heroBanners, categories, promoBanners, activeCampaigns] = await Promise.all([
    getHomepageData(),
    getHeroBanners(),
    getActiveCategories(),
    getPromotionalBanners(),
    getFeaturedCampaigns(),
  ]);
  const trendingProducts = data?.trendingProducts || data?.trending || [];
  const newArrivals = data?.newArrivals || [];
  const featuredThemes = data?.featuredThemes || [];

  const allCategories: CategoryItem[] = categories && categories.length > 0 ? categories : (data?.categories || []);
  const rootCategories = allCategories
    .filter((c: CategoryItem) => {
      if (c.status && c.status !== "ACTIVE") return false;
      if (c.parentCategory) {
        if (typeof c.parentCategory === "string" && c.parentCategory.trim().length > 0) return false;
        if (typeof c.parentCategory === "object" && c.parentCategory._id) return false;
      }
      const slug = (c.slug || "").toLowerCase();
      // Filter out custom printing, bulk printing, and related subcategories
      if (["custom-print", "custom-printing", "bulk-printing", "jersey", "corporate-jersey"].includes(slug)) return false;
      return true;
    })
    .sort((a: CategoryItem, b: CategoryItem) => (a.displayOrder || 0) - (b.displayOrder || 0));
  const firstCategory = rootCategories.length > 0 ? rootCategories[0] : null;

  const getRootCategoryHref = (cat: { slug: string }) => {
    return `/shop?category=${encodeURIComponent(cat.slug)}`;
  };

  return (
    <main className="w-full flex flex-col items-center pb-24 lg:pb-0">
      {/* Hero Section - Dynamic Auto-Sliding Editorial Streetwear Carousel */}
      {(() => {
        let displayHeroBanners: HeroBannerItem[] = Array.isArray(heroBanners) ? [...heroBanners] : [];

        // Synthesize banners from active campaigns if no explicit hero banners exist
        if (displayHeroBanners.length === 0 && Array.isArray(activeCampaigns)) {
          activeCampaigns.forEach((camp: ActiveCampaignItem) => {
            if (Array.isArray(camp.bannerIds)) {
              camp.bannerIds.forEach((b: CampaignBannerRef) => {
                if (b && typeof b === "object" && b.image) {
                  displayHeroBanners.push({
                    _id: b._id,
                    title: b.title || camp.name,
                    subtitle: b.subtitle || camp.description,
                    image: b.image,
                    mobileImage: b.mobileImage,
                    ctaLabel: b.ctaLabel || "EXPLORE CAMPAIGN",
                    ctaUrl: b.ctaUrl || `/shop?campaign=${encodeURIComponent(camp.slug || "")}`,
                    campaignTag: camp.discountTag || "SPECIAL DROP",
                    textColor: b.textColor || "LIGHT",
                    textAlignment: b.textAlignment || "LEFT",
                    overlayStrength: b.overlayStrength || "LIGHT",
                  });
                }
              });
            }
          });
        }

        // Fallback default slide if no banners exist in CMS
        if (displayHeroBanners.length === 0) {
          displayHeroBanners = [
            {
              _id: "default-streetwear-hero",
              image: "https://images.unsplash.com/photo-1552374196-1ab2a1c593e8?q=80&w=2000&auto=format&fit=crop",
              title: "HEAVYWEIGHT STREETWEAR · EDITION 2026",
              subtitle: "Engineered in 240+ GSM combed cotton with structured drop-shoulders and precision high-density prints.",
              ctaLabel: firstCategory ? `EXPLORE ${firstCategory.name.toUpperCase()}` : "EXPLORE DROPS",
              ctaUrl: firstCategory ? `/shop?category=${encodeURIComponent(firstCategory.slug)}` : "/shop",
              campaignTag: "EDITION 2026",
              textColor: "LIGHT",
              textAlignment: "LEFT",
              overlayStrength: "LIGHT",
            },
          ];
        }

        return <HeroBannerSlider banners={displayHeroBanners} />;
      })()}

      {/* Infinite Kinetic Streetwear Marquee Ticker */}
      <MarqueeTicker />

      {/* Quick Category Jump Navigation Bar */}
      <section className="w-full bg-surface border-b border-outline-variant/30 py-1">
        <CategoryPillNav categories={rootCategories} />
      </section>

      {/* Men's Streetwear Collections Grid */}
      <section className="py-12 md:py-20 bg-surface w-full border-b border-outline-variant/30 flex justify-center">
        <div className="w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop">
          <div className="flex flex-col md:flex-row md:items-end justify-between mb-6 sm:mb-10 gap-2 sm:gap-3">
            <div>
              <h2 className="font-headline-lg text-2xl md:text-4xl font-black text-on-surface uppercase tracking-tight">
                COLLECTIONS &amp; CAPSULES
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

      {/* Unified Tabbed Drops Showcase (Trending & New Arrivals) */}
      <TabbedDropsSection
        trendingProducts={trendingProducts}
        newArrivals={newArrivals}
      />

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

      {/* Craftsmanship & Garment Philosophy: The 240+ GSM Standard */}
      <GarmentAnatomySection />

      {/* Buyer Confidence & Guarantees Trust Bar */}
      <TrustPillarsBar />

      {/* Dynamic Offers & Promotional Discount Banners */}
      <section className="py-12 md:py-20 bg-surface w-full flex justify-center">
        <div className="w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop space-y-8">
          {/* 1-Click Interactive Campaigns Showcase */}
          <InteractiveCampaignCards campaigns={activeCampaigns} />

          {/* Promotional Banners Grid */}
          {promoBanners.length > 0 && (
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
          )}
        </div>
      </section>
    </main>
  );
}
