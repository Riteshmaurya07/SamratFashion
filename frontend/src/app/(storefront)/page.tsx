import Link from "next/link";
import Image from "next/image";
import { api } from "@/lib/api";
import { ProductCard, ProductCardProps } from "@/components/catalog/ProductCard";

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
  const data = await getHomepageData();
  const heroBanner = await getHeroBanner();
  const trendingProducts = data?.trendingProducts || data?.trending || [];

  const heroImage = heroBanner?.image || "https://images.unsplash.com/photo-1523381210434-271e8be1f52b?q=80&w=2070&auto=format&fit=crop";
  const heroTitle = heroBanner?.title || "Wear Your Vibe";
  const heroSubtitle = heroBanner?.subtitle || "India's Premium Destination for Oversized & Custom Graphic Tees. Crafted for comfort, designed for the streets.";
  const heroCtaLabel = heroBanner?.ctaLabel || "Shop T-Shirts";
  const heroCtaUrl = heroBanner?.ctaUrl || "/shop";

  return (
    <main className="w-full flex flex-col items-center">
      {/* Hero Section */}
      <section className="relative w-full h-[870px] min-h-[600px] flex items-center bg-surface-container overflow-hidden">
        <div 
          className="absolute inset-0 bg-cover bg-center mix-blend-multiply opacity-90 transition-all duration-700" 
          style={{ backgroundImage: `url('${heroImage}')` }}
        ></div>
        <div className="absolute inset-0 bg-black/40"></div>
        <div className="relative z-10 w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop">
          <div className="max-w-2xl">
            <h1 className="font-display-lg text-display-lg-mobile md:text-display-lg text-white font-black mb-6 uppercase drop-shadow-md tracking-tight">{heroTitle}</h1>
            <p className="font-headline-sm text-headline-sm text-white/90 mb-10 max-w-lg drop-shadow-md">
              {heroSubtitle}
            </p>
            <div className="flex flex-wrap gap-4">
              <Link href={heroCtaUrl} className="inline-flex items-center justify-center px-8 py-4 bg-primary text-on-primary rounded-lg font-headline-sm text-[16px] hover:bg-primary/90 transition-all duration-200 shadow-md">
                {heroCtaLabel}
              </Link>
              <Link href="/shop" className="inline-flex items-center justify-center px-8 py-4 border-2 border-white text-white rounded-lg font-headline-sm text-[16px] font-bold hover:bg-white hover:text-black transition-all duration-200 bg-white/10 backdrop-blur-sm">
                Explore Collections
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Category Shortcuts */}
      <section className="py-16 bg-surface-bright w-full flex justify-center">
        <div className="w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop overflow-x-auto pb-4 hide-scrollbar">
          <div className="flex gap-8 justify-between min-w-max md:min-w-0">
            <Link href="/shop?category=oversized" className="flex flex-col items-center gap-3 group">
              <div className="w-20 h-20 rounded-full bg-surface-container flex items-center justify-center group-hover:scale-105 transition-transform border border-outline-variant/20 overflow-hidden relative">
                <Image src="https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?q=80&w=200&auto=format&fit=crop" alt="Oversized" fill className="object-cover" />
              </div>
              <span className="font-label-caps text-label-caps text-on-surface-variant group-hover:text-primary transition-colors">OVERSIZED</span>
            </Link>
            <Link href="/shop?category=graphic" className="flex flex-col items-center gap-3 group">
              <div className="w-20 h-20 rounded-full bg-surface-container flex items-center justify-center group-hover:scale-105 transition-transform border border-outline-variant/20 overflow-hidden relative">
                <Image src="https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?q=80&w=200&auto=format&fit=crop" alt="Graphic" fill className="object-cover" />
              </div>
              <span className="font-label-caps text-label-caps text-on-surface-variant group-hover:text-primary transition-colors">GRAPHIC</span>
            </Link>
            <Link href="/shop?category=anime" className="flex flex-col items-center gap-3 group">
              <div className="w-20 h-20 rounded-full bg-surface-container flex items-center justify-center group-hover:scale-105 transition-transform border border-outline-variant/20 overflow-hidden relative">
                <Image src="https://images.unsplash.com/photo-1613376023733-0a73315d9b06?q=80&w=200&auto=format&fit=crop" alt="Anime" fill className="object-cover" />
              </div>
              <span className="font-label-caps text-label-caps text-on-surface-variant group-hover:text-primary transition-colors">ANIME</span>
            </Link>
            <Link href="/shop?category=gaming" className="flex flex-col items-center gap-3 group">
              <div className="w-20 h-20 rounded-full bg-surface-container flex items-center justify-center group-hover:scale-105 transition-transform border border-outline-variant/20 overflow-hidden relative">
                <Image src="https://images.unsplash.com/photo-1511512578047-dfb367046420?q=80&w=200&auto=format&fit=crop" alt="Gaming" fill className="object-cover" />
              </div>
              <span className="font-label-caps text-label-caps text-on-surface-variant group-hover:text-primary transition-colors">GAMING</span>
            </Link>
            <Link href="/shop?category=minimal" className="flex flex-col items-center gap-3 group">
              <div className="w-20 h-20 rounded-full bg-surface-container flex items-center justify-center group-hover:scale-105 transition-transform border border-outline-variant/20 overflow-hidden relative">
                <Image src="https://images.unsplash.com/photo-1581655353564-df123a1eb820?q=80&w=200&auto=format&fit=crop" alt="Minimal" fill className="object-cover" />
              </div>
              <span className="font-label-caps text-label-caps text-on-surface-variant group-hover:text-primary transition-colors">MINIMAL</span>
            </Link>
            <Link href="/shop?category=quotes" className="flex flex-col items-center gap-3 group">
              <div className="w-20 h-20 rounded-full bg-surface-container flex items-center justify-center group-hover:scale-105 transition-transform border border-outline-variant/20 overflow-hidden relative">
                <Image src="https://images.unsplash.com/photo-1529374255404-311a2a4f1fd9?q=80&w=200&auto=format&fit=crop" alt="Quotes" fill className="object-cover" />
              </div>
              <span className="font-label-caps text-label-caps text-on-surface-variant group-hover:text-primary transition-colors">QUOTES</span>
            </Link>
          </div>
        </div>
      </section>

      {/* Trending Products */}
      {trendingProducts.length > 0 && (
        <section className="py-section-gap bg-surface-container-lowest w-full flex justify-center">
          <div className="w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop">
            <div className="flex justify-between items-end mb-12">
              <h2 className="font-headline-lg text-headline-lg text-on-surface tracking-tight">TRENDING NOW</h2>
              <Link href="/shop" className="font-label-caps text-label-caps text-primary hover:underline underline-offset-4">VIEW ALL</Link>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-gutter">
              {trendingProducts.map((product: ProductCardProps) => (
                <ProductCard key={product._id} {...product} />
              ))}
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
