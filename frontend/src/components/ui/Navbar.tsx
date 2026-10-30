"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import {
  Search,
  User,
  Heart,
  ShoppingBag,
  Home,
  ChevronDown,
  Menu,
  X,
  Sparkles,
  ArrowRight,
} from "lucide-react";
import { useCartStore } from "@/store/useCartStore";
import { useWishlistStore } from "@/store/useWishlistStore";
import { useAuthStore } from "@/store/useAuthStore";
import { useEffect, useState, useMemo } from "react";
import { CategoryItem, getActiveCategories } from "@/lib/catalog";
import { api } from "@/lib/api";
import { motion, AnimatePresence } from "motion/react";

export function Navbar({ categories = [] }: { categories?: CategoryItem[] }) {
  const { isAuthenticated } = useAuthStore();
  const cartItems = useCartStore((state) => state.items);
  const wishlistItems = useWishlistStore((state) => state.items);

  // Hydration fix for counts
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const cartCount = mounted && isAuthenticated ? cartItems.reduce((acc, item) => acc + item.quantity, 0) : 0;
  const wishlistCount = mounted && isAuthenticated ? wishlistItems.length : 0;
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const router = useRouter();
  const pathname = usePathname();
  const [categoryList, setCategoryList] = useState<CategoryItem[]>(categories);
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const [openMobileCategories, setOpenMobileCategories] = useState<string[]>([]);
  const [announcementBanner, setAnnouncementBanner] = useState<{ title: string; subtitle?: string; ctaUrl?: string } | null>(null);

  const toggleMobileCategory = (catId: string) => {
    setOpenMobileCategories((prev) =>
      prev.includes(catId) ? prev.filter((id) => id !== catId) : [...prev, catId]
    );
  };

  // Fetch active announcement bar banner
  useEffect(() => {
    async function fetchAnnouncement() {
      try {
        const res = await api.get("/catalog/banners?position=ANNOUNCEMENT_BAR");
        if (res.data?.success && Array.isArray(res.data?.data) && res.data.data.length > 0) {
          setAnnouncementBanner(res.data.data[0]);
        }
      } catch {
        // Silent fallback
      }
    }
    fetchAnnouncement();
  }, []);
  // Prevent background scroll when mobile drawer is open
  useEffect(() => {
    if (isMobileDrawerOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isMobileDrawerOpen]);

  // Auto close mobile drawer on route navigation
  useEffect(() => {
    setIsMobileDrawerOpen(false);
    setIsSearchOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (categories && categories.length > 0) {
      setCategoryList(categories);
    } else {
      getActiveCategories().then((res) => {
        if (res && res.length > 0) setCategoryList(res);
      });
    }
  }, [categories]);

  // Generic Hierarchy: Active Root Categories and Active Subcategories
  const { rootCategories, subcategoriesByParentId } = useMemo(() => {
    const roots = categoryList
      .filter((c) => {
        if (c.status !== "ACTIVE" || c.parentCategory) return false;
        const slug = (c.slug || "").toLowerCase();
        return !["custom-print", "custom-printing", "bulk-printing", "jersey", "corporate-jersey"].includes(slug);
      })
      .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));

    const childrenMap = new Map<string, CategoryItem[]>();

    for (const c of categoryList) {
      if (c.status === "ACTIVE" && c.parentCategory) {
        const childSlug = (c.slug || "").toLowerCase();
        if (["custom-print", "custom-printing", "bulk-printing", "jersey", "corporate-jersey"].includes(childSlug)) continue;
        const parentRef = c.parentCategory;
        const parentId = typeof parentRef === "object" && parentRef !== null ? parentRef._id : parentRef;
        const parentStatus = typeof parentRef === "object" && parentRef !== null ? parentRef.status : "ACTIVE";

        if (parentStatus !== "INACTIVE" && parentId) {
          const list = childrenMap.get(parentId.toString()) || [];
          list.push(c);
          childrenMap.set(parentId.toString(), list);
        }
      }
    }

    childrenMap.forEach((list) => list.sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0)));

    return { rootCategories: roots, subcategoriesByParentId: childrenMap };
  }, [categoryList]);

  // Generic URL Resolver
  const getCategoryHref = (cat: CategoryItem) => `/shop?category=${encodeURIComponent(cat.slug)}`;


  // Hide persistent bottom tabs on focused funnels & conversion pages
  const isPdpPage = pathname.startsWith("/shop/") && pathname !== "/shop";
  const isCheckoutPage = pathname.startsWith("/checkout");
  const isCartPage = pathname.startsWith("/cart");
  const hideBottomNav = isPdpPage || isCheckoutPage || isCartPage;

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    router.push(`/shop?search=${encodeURIComponent(searchQuery.trim())}`);
    setIsSearchOpen(false);
    setIsMobileDrawerOpen(false);
  };
  return (
    <>
      {/* Announcement Bar */}
      <div className="bg-neutral-950 text-neutral-300 py-2 px-4 text-center font-mono text-[11px] tracking-[0.2em] uppercase border-b border-neutral-800">
        <div className="max-w-container-max mx-auto flex justify-between items-center px-margin-mobile md:px-margin-desktop">
          <span className="hidden md:inline text-neutral-400">NEW DELHI // IN</span>
          {announcementBanner ? (
            <Link
              href={announcementBanner.ctaUrl || "/offers"}
              className="font-semibold text-neutral-100 mx-auto md:mx-0 hover:text-primary transition-colors flex items-center gap-1.5"
            >
              <span>{announcementBanner.title}</span>
              {announcementBanner.subtitle && (
                <span className="text-neutral-400 font-normal hidden sm:inline">&bull; {announcementBanner.subtitle}</span>
              )}
            </Link>
          ) : (
            <span className="font-semibold text-neutral-100 mx-auto md:mx-0">
              COMPLIMENTARY SHIPPING OVER ₹999 &bull; 240+ GSM COMBED COTTON
            </span>
          )}
          <span className="hidden md:inline text-neutral-400">DISPATCH IN 24H</span>
        </div>
      </div>

      {/* TopNavBar */}
      <header className="bg-surface/95 backdrop-blur-md text-on-surface sticky top-0 z-50 border-b border-outline-variant/30 w-full transition-colors">
        <div className="flex justify-between items-center w-full px-margin-mobile md:px-margin-desktop py-3.5 max-w-container-max mx-auto">
          <div className="flex items-center gap-2">
            {/* Mobile Hamburger Drawer Trigger */}
            <button
              type="button"
              onClick={() => setIsMobileDrawerOpen(true)}
              aria-label="Open mobile navigation menu"
              className="p-2 -ml-2 text-on-surface hover:bg-surface-container rounded-lg lg:hidden active:scale-95 transition-all flex items-center justify-center touch-target-base"
            >
              <Menu className="w-5 h-5" />
            </button>

            {/* Brand */}
            <Link href="/" className="flex flex-col group">
              <span className="font-headline-lg text-lg sm:text-xl md:text-2xl font-black tracking-[-0.04em] text-on-surface uppercase flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 bg-primary rounded-xs rotate-45 group-hover:rotate-90 transition-transform duration-300"></span>
                THREADVIBE
              </span>
              <span className="font-mono text-[8px] sm:text-[9px] tracking-[0.25em] text-on-surface-variant uppercase -mt-0.5">
                SAMRAT FASHION
              </span>
            </Link>
          </div>
          {/* Navigation Links (Desktop) */}
          <nav className="hidden lg:flex gap-7 items-center font-body-sm text-[13px] tracking-wide uppercase font-semibold">
            <Link
              href="/shop"
              className={`transition-colors py-1 hover:text-primary ${
                pathname === "/shop" && (!mounted || !window.location.search.includes("t-shirt"))
                  ? "text-primary border-b-2 border-primary"
                  : "text-on-surface-variant"
              }`}
            >
              Shop All
            </Link>

            {/* Generic Root Categories & Dropdowns */}
            {rootCategories.map((root) => {
              const children = subcategoriesByParentId.get(root._id) || [];
              const rootHref = getCategoryHref(root);
              const isOpen = openDropdownId === root._id;
              const isRootActive =
                pathname === "/shop" && mounted && window.location.search.includes(root.slug);

              if (children.length === 0) {
                return (
                  <Link
                    key={root._id}
                    href={rootHref}
                    className={`transition-colors py-1 hover:text-primary ${
                      isRootActive ? "text-primary border-b-2 border-primary" : "text-on-surface-variant"
                    }`}
                  >
                    {root.name}
                  </Link>
                );
              }

              return (
                <div
                  key={root._id}
                  className="relative group py-1"
                  onMouseEnter={() => setOpenDropdownId(root._id)}
                  onMouseLeave={() => setOpenDropdownId(null)}
                >
                  <Link
                    href={rootHref}
                    className={`transition-colors flex items-center gap-1 hover:text-primary ${
                      isRootActive ? "text-primary border-b-2 border-primary" : "text-on-surface-variant"
                    }`}
                  >
                    <span>{root.name}</span>
                    <ChevronDown className="w-3.5 h-3.5 opacity-70 group-hover:rotate-180 transition-transform duration-200" />
                  </Link>

                  <AnimatePresence>
                    {isOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: 8, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 6, scale: 0.98 }}
                        transition={{ duration: 0.18, ease: "easeOut" }}
                        className="absolute top-full left-0 mt-1 min-w-[210px] bg-surface-container-lowest border border-outline-variant/30 rounded-2xl shadow-xl p-2 z-50"
                      >
                        <Link
                          href={rootHref}
                          className="block px-3 py-2 text-xs font-bold text-primary hover:bg-surface-container-low rounded-xl transition-colors"
                        >
                          All {root.name} &rarr;
                        </Link>
                        <div className="my-1 border-t border-outline-variant/20" />
                        {children.map((sub) => (
                          <Link
                            key={sub._id}
                            href={getCategoryHref(sub)}
                            className="block px-3 py-2 text-xs font-medium text-on-surface hover:text-primary hover:bg-surface-container-low rounded-xl transition-colors"
                          >
                            {sub.name}
                          </Link>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
            {/* Offers & Discounts Link */}
            <Link
              href="/offers"
              className={`transition-colors py-1 hover:text-primary flex items-center gap-1.5 ${
                pathname.startsWith("/offers")
                  ? "text-primary border-b-2 border-primary font-bold"
                  : "text-on-surface-variant"
              }`}
            >
              <span className="px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-mono font-bold tracking-wider">
                OFFERS
              </span>
              Deals
            </Link>
          </nav>

          {/* Action Icons */}
          <div className="flex items-center gap-3 md:gap-4 text-on-surface">
            <button
              onClick={() => setIsSearchOpen(!isSearchOpen)}
              aria-label="Search catalog"
              className="p-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container rounded-lg transition-colors active:scale-95"
            >
              <Search className="w-5 h-5" />
            </button>
            <Link
              href={isAuthenticated ? "/account" : "/login"}
              aria-label="Account"
              className="p-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container rounded-lg transition-colors active:scale-95 hidden sm:flex"
            >
              <User className="w-5 h-5" />
            </Link>
            <Link
              href="/account/wishlist"
              aria-label="Wishlist"
              className="p-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container rounded-lg transition-colors active:scale-95 relative hidden sm:flex"
            >
              <Heart className="w-5 h-5" />
              {wishlistCount > 0 && (
                <span className="absolute top-1 right-1 bg-neutral-900 text-white min-w-4 h-4 px-1 rounded-full flex items-center justify-center font-mono text-[9px] font-bold">
                  {wishlistCount > 99 ? "99+" : wishlistCount}
                </span>
              )}
            </Link>
            <Link
              href="/cart"
              aria-label="Shopping Cart"
              className="p-2 text-on-surface hover:bg-surface-container rounded-lg transition-colors active:scale-95 relative flex items-center gap-2"
            >
              <ShoppingBag className="w-5 h-5" />
              {cartCount > 0 && (
                <span className="bg-primary text-white min-w-4 h-4 px-1 rounded-full flex items-center justify-center font-mono text-[10px] font-bold">
                  {cartCount > 99 ? "99+" : cartCount}
                </span>
              )}
            </Link>
          </div>
        </div>

        {/* Search Drawer */}
        <AnimatePresence>
          {isSearchOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              style={{ overflow: "hidden" }}
              className="bg-surface border-t border-outline-variant/30 py-5 px-margin-mobile md:px-margin-desktop"
            >
              <div className="max-w-2xl mx-auto space-y-3">
                <form onSubmit={handleSearchSubmit} className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search coti, t-shirts, jerseys, corporate apparel..."
                      autoFocus
                      className="w-full bg-surface-container-lowest border border-outline-variant/60 rounded-lg py-2.5 pl-10 pr-4 font-body-sm text-sm outline-none focus:border-primary text-on-surface placeholder:text-neutral-400"
                    />
                  </div>
                  <button
                    type="submit"
                    className="px-6 py-2.5 bg-neutral-900 text-white font-mono text-xs uppercase tracking-wider font-bold rounded-lg hover:bg-neutral-800 transition-colors"
                  >
                    Search
                  </button>
                </form>
                <div className="flex items-center gap-2 flex-wrap font-mono text-[11px] text-neutral-500 pt-1">
                  <span>POPULAR:</span>
                  {["Coti", "T-Shirt", "Jersey", "Corporate Jersey", "Polo Uniforms", "240 GSM"].map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => {
                        router.push(`/shop?search=${encodeURIComponent(tag)}`);
                        setIsSearchOpen(false);
                      }}
                      className="px-2.5 py-1 bg-surface-container-high rounded-sm hover:text-primary transition-colors text-neutral-700"
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      {/* ─── Mobile Slide-in Drawer Menu ───────────────────────────────── */}
      <AnimatePresence>
        {isMobileDrawerOpen && (
          <div className="fixed inset-0 z-[100] flex lg:hidden">
            {/* Backdrop Overlay */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-xs"
              onClick={() => setIsMobileDrawerOpen(false)}
              aria-hidden="true"
            />

            {/* Drawer Sheet */}
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="Navigation Menu"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              className="relative z-[101] w-[88%] max-w-sm bg-neutral-950 text-white h-full shadow-2xl flex flex-col border-r border-neutral-800"
            >
              {/* Drawer Header */}
              <div className="flex items-center justify-between px-6 py-5 border-b border-neutral-800">
                <Link
                  href="/"
                  onClick={() => setIsMobileDrawerOpen(false)}
                  className="flex flex-col"
                >
                  <span className="font-headline-lg text-xl font-black tracking-[-0.03em] text-white uppercase">
                    THREADVIBE
                  </span>
                  <span className="font-mono text-[9px] tracking-[0.25em] text-neutral-400 uppercase">
                    SAMRAT FASHION
                  </span>
                </Link>
                <button
                  type="button"
                  onClick={() => setIsMobileDrawerOpen(false)}
                  aria-label="Close navigation menu"
                  className="w-10 h-10 -mr-2 text-neutral-400 hover:text-white rounded-lg active:scale-95 transition-colors flex items-center justify-center cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Drawer Navigation Links */}
              <nav className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
                {/* Primary Curated Drops */}
                <div className="space-y-1">
                  <Link
                    href="/shop"
                    onClick={() => setIsMobileDrawerOpen(false)}
                    className="flex items-center justify-between py-3.5 border-b border-neutral-800 text-white hover:text-neutral-300 transition-colors group"
                  >
                    <span className="font-headline-sm text-lg sm:text-xl font-black uppercase tracking-tight">
                      ALL DROPS
                    </span>
                    <ArrowRight className="w-4 h-4 text-neutral-500 group-hover:text-white group-hover:translate-x-0.5 transition-all" />
                  </Link>

                  {/* Dynamic Categories */}
                  {rootCategories.map((root) => {
                    const children = subcategoriesByParentId.get(root._id) || [];
                    const rootHref = getCategoryHref(root);
                    const isOpen = openMobileCategories.includes(root._id);

                    if (children.length === 0) {
                      return (
                        <Link
                          key={root._id}
                          href={rootHref}
                          onClick={() => setIsMobileDrawerOpen(false)}
                          className="flex items-center justify-between py-3.5 border-b border-neutral-800 text-white hover:text-neutral-300 transition-colors group"
                        >
                          <span className="font-headline-sm text-lg sm:text-xl font-black uppercase tracking-tight">
                            {root.name}
                          </span>
                          <ArrowRight className="w-4 h-4 text-neutral-500 group-hover:text-white group-hover:translate-x-0.5 transition-all" />
                        </Link>
                      );
                    }

                    return (
                      <div key={root._id} className="border-b border-neutral-800">
                        <button
                          type="button"
                          onClick={() => toggleMobileCategory(root._id)}
                          className="w-full flex items-center justify-between py-3.5 text-white hover:text-neutral-300 transition-colors text-left cursor-pointer"
                        >
                          <span className="font-headline-sm text-lg sm:text-xl font-black uppercase tracking-tight">
                            {root.name}
                          </span>
                          <ChevronDown
                            className={`w-4 h-4 text-neutral-400 transition-transform duration-200 ${
                              isOpen ? "rotate-180" : ""
                            }`}
                          />
                        </button>

                        <AnimatePresence initial={false}>
                          {isOpen && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2, ease: "easeOut" }}
                              style={{ overflow: "hidden" }}
                              className="pb-3 pt-1 space-y-2 pl-3"
                            >
                              <Link
                                href={rootHref}
                                onClick={() => setIsMobileDrawerOpen(false)}
                                className="block font-mono text-xs uppercase font-bold text-neutral-300 hover:text-white py-1"
                              >
                                All {root.name} &rarr;
                              </Link>
                              {children.map((sub) => (
                                <Link
                                  key={sub._id}
                                  href={getCategoryHref(sub)}
                                  onClick={() => setIsMobileDrawerOpen(false)}
                                  className="block text-sm text-neutral-400 hover:text-white transition-colors py-1 pl-2 border-l border-neutral-800"
                                >
                                  {sub.name}
                                </Link>
                              ))}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })}


                  <Link
                    href="/offers"
                    onClick={() => setIsMobileDrawerOpen(false)}
                    className="flex items-center justify-between py-3.5 border-b border-neutral-800 text-white hover:text-neutral-300 transition-colors group"
                  >
                    <span className="font-headline-sm text-lg sm:text-xl font-black uppercase tracking-tight">
                      SPECIAL OFFERS
                    </span>
                    <span className="font-mono text-[9px] uppercase tracking-wider bg-white/10 text-white px-2 py-0.5 rounded font-bold">
                      DEALS
                    </span>
                  </Link>
                </div>

                {/* Secondary Customer Services */}
                <div className="pt-2 space-y-1">
                  <p className="font-mono text-[10px] text-neutral-500 uppercase tracking-widest mb-2 font-bold">
                    CUSTOMER CARE
                  </p>
                  <Link
                    href="/account/orders"
                    onClick={() => setIsMobileDrawerOpen(false)}
                    className="flex items-center justify-between py-2 text-xs font-mono uppercase text-neutral-400 hover:text-white transition-colors"
                  >
                    <span>Track My Order</span>
                    <ArrowRight className="w-3.5 h-3.5 text-neutral-600" />
                  </Link>
                  <Link
                    href="/account/wishlist"
                    onClick={() => setIsMobileDrawerOpen(false)}
                    className="flex items-center justify-between py-2 text-xs font-mono uppercase text-neutral-400 hover:text-white transition-colors"
                  >
                    <span>Saved Wishlist</span>
                    {wishlistCount > 0 && (
                      <span className="font-mono text-[10px] text-white bg-neutral-800 px-1.5 py-0.5 rounded-full font-bold">
                        {wishlistCount}
                      </span>
                    )}
                  </Link>
                  <Link
                    href="/support"
                    onClick={() => setIsMobileDrawerOpen(false)}
                    className="flex items-center justify-between py-2 text-xs font-mono uppercase text-neutral-400 hover:text-white transition-colors"
                  >
                    <span>Help &amp; Support</span>
                    <ArrowRight className="w-3.5 h-3.5 text-neutral-600" />
                  </Link>
                </div>
              </nav>

              {/* Drawer Auth Footer */}
              <div className="p-5 border-t border-neutral-800 bg-neutral-900/60 pb-safe">
                {isAuthenticated ? (
                  <div className="flex items-center justify-between">
                    <Link
                      href="/account"
                      onClick={() => setIsMobileDrawerOpen(false)}
                      className="flex items-center gap-2 text-xs font-mono uppercase font-bold text-white hover:text-neutral-300"
                    >
                      <User className="w-4 h-4 text-neutral-400" />
                      <span>My Account</span>
                    </Link>
                    <Link
                      href="/account/orders"
                      onClick={() => setIsMobileDrawerOpen(false)}
                      className="text-xs font-mono uppercase text-neutral-400 hover:text-white font-bold"
                    >
                      Orders &rarr;
                    </Link>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <Link
                      href="/login"
                      onClick={() => setIsMobileDrawerOpen(false)}
                      className="py-3 px-3 rounded-md bg-white text-neutral-950 text-center font-mono text-xs font-bold uppercase hover:bg-neutral-200 transition-colors"
                    >
                      Sign In
                    </Link>
                    <Link
                      href="/register"
                      onClick={() => setIsMobileDrawerOpen(false)}
                      className="py-3 px-3 rounded-md border border-neutral-700 text-center font-mono text-xs font-bold uppercase text-white hover:bg-white/10 transition-colors"
                    >
                      Register
                    </Link>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {!hideBottomNav && (
        <nav className="fixed bottom-0 left-0 w-full z-40 flex justify-around items-center px-1 py-1.5 pb-safe lg:hidden bg-surface/95 border-t border-outline-variant/30 backdrop-blur-lg shadow-[0_-8px_24px_rgba(0,0,0,0.06)]">
          <Link
            href="/"
            className={`min-w-[56px] min-h-[48px] flex flex-col items-center justify-center p-1 rounded-lg active:scale-95 transition-all ${
              pathname === "/" ? "text-primary font-bold" : "text-neutral-500 hover:text-neutral-900"
            }`}
          >
            <Home className="w-5 h-5" />
            <span className="font-mono text-[10px] uppercase mt-0.5">Home</span>
          </Link>

          <Link
            href="/shop"
            className={`min-w-[56px] min-h-[48px] flex flex-col items-center justify-center p-1 rounded-lg active:scale-95 transition-all ${
              pathname === "/shop" && (!mounted || !window.location.search.includes("t-shirt"))
                ? "text-primary font-bold"
                : "text-neutral-500 hover:text-neutral-900"
            }`}
          >
            <ShoppingBag className="w-5 h-5" />
            <span className="font-mono text-[10px] uppercase mt-0.5">Shop</span>
          </Link>

          <Link
            href="/offers"
            className={`min-w-[56px] min-h-[48px] flex flex-col items-center justify-center p-1 rounded-lg active:scale-95 transition-all ${
              pathname.startsWith("/offers")
                ? "text-primary font-bold"
                : "text-neutral-500 hover:text-neutral-900"
            }`}
          >
            <Sparkles className="w-5 h-5" />
            <span className="font-mono text-[10px] uppercase mt-0.5">Offers</span>
          </Link>
          <Link
            href="/account/wishlist"
            className={`min-w-[56px] min-h-[48px] flex flex-col items-center justify-center p-1 rounded-lg active:scale-95 transition-all relative ${
              pathname === "/account/wishlist" ? "text-primary font-bold" : "text-neutral-500 hover:text-neutral-900"
            }`}
          >
            <Heart className="w-5 h-5" />
            {wishlistCount > 0 && (
              <span className="absolute top-1 right-3 bg-neutral-900 text-white min-w-3.5 h-3.5 px-0.5 rounded-full flex items-center justify-center font-mono text-[8px] font-bold">
                {wishlistCount > 99 ? "99+" : wishlistCount}
              </span>
            )}
            <span className="font-mono text-[10px] uppercase mt-0.5">Wishlist</span>
          </Link>

          <Link
            href={isAuthenticated ? "/account" : "/login"}
            className={`min-w-[56px] min-h-[48px] flex flex-col items-center justify-center p-1 rounded-lg active:scale-95 transition-all ${
              pathname.startsWith("/account") && pathname !== "/account/wishlist"
                ? "text-primary font-bold"
                : "text-neutral-500 hover:text-neutral-900"
            }`}
          >
            <User className="w-5 h-5" />
            <span className="font-mono text-[10px] uppercase mt-0.5">Account</span>
          </Link>
        </nav>
      )}
    </>
  );
}
