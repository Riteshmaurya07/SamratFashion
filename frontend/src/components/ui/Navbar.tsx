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
  ChevronRight,
  Shirt,
  Menu,
  X,
  Sparkles,
  Layers,
  HelpCircle,
  Compass,
} from "lucide-react";
import { useCartStore } from "@/store/useCartStore";
import { useWishlistStore } from "@/store/useWishlistStore";
import { useAuthStore } from "@/store/useAuthStore";
import { useEffect, useState, useMemo } from "react";
import { CategoryItem, getActiveCategories } from "@/lib/catalog";

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
  const [isTshirtDropdownOpen, setIsTshirtDropdownOpen] = useState(false);
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);
  const [isMobileTshirtsOpen, setIsMobileTshirtsOpen] = useState(true);

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

  // Backend-managed T-Shirts Section from Admin Panel
  const tshirtCategory = useMemo(() => {
    return categoryList.find(
      (c: CategoryItem) =>
        c.status === "ACTIVE" &&
        (c.slug === "t-shirts" ||
          c.slug === "t-shirt" ||
          c.slug === "tshirt" ||
          c.name.toLowerCase().includes("t-shirt") ||
          c.name.toLowerCase() === "t-shirts" ||
          c.name.toLowerCase() === "tshirts")
    );
  }, [categoryList]);

  // Subcategories whose parentCategory matches the active T-Shirts category
  const tshirtSubcategories = useMemo(() => {
    if (!tshirtCategory) return [];
    return categoryList.filter((c: CategoryItem) => {
      if (c.status !== "ACTIVE" || c._id === tshirtCategory._id) return false;
      const parentId =
        typeof c.parentCategory === "object" && c.parentCategory !== null
          ? c.parentCategory._id
          : c.parentCategory;
      const parentSlug =
        typeof c.parentCategory === "object" && c.parentCategory !== null
          ? c.parentCategory.slug
          : undefined;
      return (
        (parentId && parentId.toString() === tshirtCategory._id.toString()) ||
        parentSlug === tshirtCategory.slug
      );
    });
  }, [categoryList, tshirtCategory]);


  // Hide persistent bottom tabs on focused funnels & conversion pages
  const isPdpPage = pathname.startsWith("/shop/") && pathname !== "/shop";
  const isCustomPrintDetailPage = pathname.startsWith("/custom-printing/") && pathname !== "/custom-printing";
  const isDesignerPage = pathname.startsWith("/custom-designer");
  const isCheckoutPage = pathname.startsWith("/checkout");
  const isCartPage = pathname.startsWith("/cart");
  const hideBottomNav = isPdpPage || isCustomPrintDetailPage || isDesignerPage || isCheckoutPage || isCartPage;

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
          <span className="font-semibold text-neutral-100 mx-auto md:mx-0">
            COMPLIMENTARY SHIPPING OVER ₹999 &bull; 240+ GSM COMBED COTTON
          </span>
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

            {/* Backend-Managed T-Shirts Section */}
            {tshirtCategory && (
              <div
                className="relative group py-1"
                onMouseEnter={() => setIsTshirtDropdownOpen(true)}
                onMouseLeave={() => setIsTshirtDropdownOpen(false)}
              >
                <Link
                  href={`/shop?category=${encodeURIComponent(tshirtCategory.slug)}`}
                  className={`transition-colors flex items-center gap-1 hover:text-primary ${
                    pathname === "/shop" &&
                    (mounted &&
                      (window.location.search.includes(tshirtCategory.slug) ||
                        tshirtSubcategories.some((s) => window.location.search.includes(s.slug))))
                      ? "text-primary border-b-2 border-primary"
                      : "text-on-surface-variant"
                  }`}
                >
                  <span>{tshirtCategory.name}</span>
                  {tshirtSubcategories.length > 0 && (
                    <ChevronDown className="w-3.5 h-3.5 opacity-70 group-hover:rotate-180 transition-transform duration-200" />
                  )}
                </Link>

                {/* Subcategories Dropdown Menu */}
                {tshirtSubcategories.length > 0 && (
                  <div
                    className={`absolute top-full left-0 mt-1 min-w-[210px] bg-surface-container-lowest border border-outline-variant/30 rounded-2xl shadow-xl p-2 z-50 transition-all duration-200 ${
                      isTshirtDropdownOpen
                        ? "opacity-100 visible translate-y-0"
                        : "opacity-0 invisible -translate-y-2 pointer-events-none"
                    }`}
                  >
                    <Link
                      href={`/shop?category=${encodeURIComponent(tshirtCategory.slug)}`}
                      className="block px-3 py-2 text-xs font-bold text-primary hover:bg-surface-container-low rounded-xl transition-colors"
                    >
                      All {tshirtCategory.name} &rarr;
                    </Link>
                    <div className="my-1 border-t border-outline-variant/20" />
                    {tshirtSubcategories.map((sub) => (
                      <Link
                        key={sub._id}
                        href={`/shop?category=${encodeURIComponent(sub.slug)}`}
                        className="block px-3 py-2 text-xs font-medium text-on-surface hover:text-primary hover:bg-surface-container-low rounded-xl transition-colors"
                      >
                        {sub.name}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}

            <Link
              href="/custom-printing"
              className={`transition-colors py-1 hover:text-primary flex items-center gap-1.5 ${
                pathname.startsWith("/custom-printing")
                  ? "text-primary border-b-2 border-primary"
                  : "text-on-surface-variant"
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
              Custom Print
            </Link>

            <Link
              href="/account/designs"
              className={`transition-colors py-1 hover:text-primary ${
                pathname.startsWith("/account/designs")
                  ? "text-primary border-b-2 border-primary"
                  : "text-on-surface-variant"
              }`}
            >
              My Studio
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
        {isSearchOpen && (
          <div className="bg-surface border-t border-outline-variant/30 py-5 px-margin-mobile md:px-margin-desktop animate-in slide-in-from-top-2 duration-200">
            <div className="max-w-2xl mx-auto space-y-3">
              <form onSubmit={handleSearchSubmit} className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search oversized, anime, cyber neon, heavy cotton tees..."
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
                {["Oversized", "Cyberpunk", "Tokyo Mecha", "Acid Wash", "Heavyweight 240 GSM"].map((tag) => (
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
          </div>
        )}
      </header>

      {/* ─── Mobile Slide-in Drawer Menu ───────────────────────────────── */}
      {isMobileDrawerOpen && (
        <div className="fixed inset-0 z-[100] flex lg:hidden">
          {/* Backdrop Overlay */}
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
            onClick={() => setIsMobileDrawerOpen(false)}
            aria-hidden="true"
          />

          {/* Drawer Sheet */}
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Navigation Menu"
            className="relative z-[101] w-[85%] max-w-sm bg-surface-container-lowest h-full shadow-2xl flex flex-col border-r border-outline-variant/30 animate-in slide-in-from-left duration-300"
          >
            {/* Drawer Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-outline-variant/20 bg-surface">
              <Link
                href="/"
                onClick={() => setIsMobileDrawerOpen(false)}
                className="flex flex-col"
              >
                <span className="font-headline-lg text-lg font-black tracking-tight text-on-surface uppercase flex items-center gap-1.5">
                  <span className="w-2 h-2 bg-primary rounded-xs rotate-45"></span>
                  THREADVIBE
                </span>
                <span className="font-mono text-[8px] tracking-[0.25em] text-on-surface-variant uppercase">
                  SAMRAT FASHION STUDIO
                </span>
              </Link>
              <button
                type="button"
                onClick={() => setIsMobileDrawerOpen(false)}
                aria-label="Close navigation menu"
                className="p-2 -mr-2 text-on-surface-variant hover:text-on-surface rounded-lg active:scale-95 transition-all touch-target-base flex items-center justify-center"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Drawer Search */}
            <div className="p-4 border-b border-outline-variant/20 bg-surface-container-lowest">
              <form onSubmit={handleSearchSubmit} className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search drops, oversized, anime..."
                  className="w-full bg-surface-container-low border border-outline-variant/50 rounded-lg py-2 pl-9 pr-3 font-body-sm text-xs outline-none focus:border-primary text-on-surface placeholder:text-neutral-400"
                />
              </form>
            </div>

            {/* Drawer Scrollable Navigation */}
            <nav className="flex-1 overflow-y-auto px-4 py-4 space-y-5 font-mono text-xs">
              {/* Collections & Streetwear */}
              <div>
                <p className="font-mono text-[10px] text-neutral-400 uppercase tracking-widest px-2 mb-2 font-bold">
                  COLLECTIONS
                </p>
                <div className="space-y-1">
                  <Link
                    href="/shop"
                    onClick={() => setIsMobileDrawerOpen(false)}
                    className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-surface-container-low text-on-surface font-semibold text-[13px] transition-colors"
                  >
                    <span className="flex items-center gap-2.5">
                      <Compass className="w-4 h-4 text-primary" />
                      Shop All Drops
                    </span>
                    <ChevronRight className="w-4 h-4 text-neutral-400" />
                  </Link>

                  {/* T-Shirts Accordion */}
                  {tshirtCategory && (
                    <div className="rounded-lg bg-surface-container-lowest border border-outline-variant/20 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setIsMobileTshirtsOpen(!isMobileTshirtsOpen)}
                        className="w-full flex items-center justify-between px-3 py-2.5 text-on-surface font-semibold text-[13px] hover:bg-surface-container-low transition-colors"
                      >
                        <span className="flex items-center gap-2.5">
                          <Shirt className="w-4 h-4 text-primary" />
                          {tshirtCategory.name}
                        </span>
                        <ChevronDown
                          className={`w-4 h-4 text-neutral-400 transition-transform duration-200 ${
                            isMobileTshirtsOpen ? "rotate-180" : ""
                          }`}
                        />
                      </button>

                      {isMobileTshirtsOpen && (
                        <div className="bg-surface-container-low/50 px-3 py-2 space-y-1 border-t border-outline-variant/20">
                          <Link
                            href={`/shop?category=${encodeURIComponent(tshirtCategory.slug)}`}
                            onClick={() => setIsMobileDrawerOpen(false)}
                            className="block px-3 py-2 text-xs font-bold text-primary hover:underline"
                          >
                            All {tshirtCategory.name} &rarr;
                          </Link>
                          {tshirtSubcategories.map((sub) => (
                            <Link
                              key={sub._id}
                              href={`/shop?category=${encodeURIComponent(sub.slug)}`}
                              onClick={() => setIsMobileDrawerOpen(false)}
                              className="block px-3 py-1.5 text-xs text-on-surface hover:text-primary transition-colors"
                            >
                              {sub.name}
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Other Categories */}
                  {categoryList
                    .filter(
                      (c) =>
                        c.status === "ACTIVE" &&
                        !c.parentCategory &&
                        c._id !== tshirtCategory?._id
                    )
                    .slice(0, 6)
                    .map((cat) => (
                      <Link
                        key={cat._id}
                        href={`/shop?category=${encodeURIComponent(cat.slug)}`}
                        onClick={() => setIsMobileDrawerOpen(false)}
                        className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-surface-container-low text-on-surface font-semibold text-[13px] transition-colors"
                      >
                        <span className="flex items-center gap-2.5">
                          <Layers className="w-4 h-4 text-neutral-400" />
                          {cat.name}
                        </span>
                        <ChevronRight className="w-4 h-4 text-neutral-400" />
                      </Link>
                    ))}
                </div>
              </div>

              {/* Studio & Custom Printing */}
              <div>
                <p className="font-mono text-[10px] text-neutral-400 uppercase tracking-widest px-2 mb-2 font-bold">
                  STUDIO &amp; LAB
                </p>
                <div className="space-y-1">
                  <Link
                    href="/custom-printing"
                    onClick={() => setIsMobileDrawerOpen(false)}
                    className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-primary/5 border border-primary/20 text-on-surface font-semibold text-[13px] hover:bg-primary/10 transition-colors"
                  >
                    <span className="flex items-center gap-2.5">
                      <Sparkles className="w-4 h-4 text-primary" />
                      Custom Printing Studio
                    </span>
                    <span className="font-mono text-[9px] bg-primary text-white px-2 py-0.5 rounded-full font-bold">
                      HOT
                    </span>
                  </Link>
                  <Link
                    href="/custom-designer"
                    onClick={() => setIsMobileDrawerOpen(false)}
                    className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-surface-container-low text-on-surface font-semibold text-[13px] transition-colors"
                  >
                    <span>2D Studio Designer</span>
                    <ChevronRight className="w-4 h-4 text-neutral-400" />
                  </Link>
                  <Link
                    href="/account/designs"
                    onClick={() => setIsMobileDrawerOpen(false)}
                    className="flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-surface-container-low text-on-surface font-semibold text-[13px] transition-colors"
                  >
                    <span>My Saved Designs</span>
                    <ChevronRight className="w-4 h-4 text-neutral-400" />
                  </Link>
                </div>
              </div>

              {/* Support & Account shortcuts */}
              <div>
                <p className="font-mono text-[10px] text-neutral-400 uppercase tracking-widest px-2 mb-2 font-bold">
                  SERVICE
                </p>
                <div className="space-y-1">
                  <Link
                    href="/account/orders"
                    onClick={() => setIsMobileDrawerOpen(false)}
                    className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-surface-container-low text-on-surface transition-colors"
                  >
                    <span>Track My Order</span>
                    <ChevronRight className="w-4 h-4 text-neutral-400" />
                  </Link>
                  <Link
                    href="/support"
                    onClick={() => setIsMobileDrawerOpen(false)}
                    className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-surface-container-low text-on-surface transition-colors"
                  >
                    <span className="flex items-center gap-2">
                      <HelpCircle className="w-4 h-4 text-neutral-400" />
                      Customer Support
                    </span>
                    <ChevronRight className="w-4 h-4 text-neutral-400" />
                  </Link>
                </div>
              </div>
            </nav>

            {/* Drawer Bottom Bar: User Auth */}
            <div className="p-4 border-t border-outline-variant/20 bg-surface pb-safe">
              {isAuthenticated ? (
                <div className="flex items-center justify-between">
                  <Link
                    href="/account"
                    onClick={() => setIsMobileDrawerOpen(false)}
                    className="flex items-center gap-2.5 text-xs font-bold text-on-surface hover:text-primary transition-colors"
                  >
                    <div className="w-8 h-8 rounded-full bg-neutral-900 text-white flex items-center justify-center font-bold text-xs">
                      <User className="w-4 h-4" />
                    </div>
                    <span>My Account</span>
                  </Link>
                  <Link
                    href="/account/orders"
                    onClick={() => setIsMobileDrawerOpen(false)}
                    className="text-xs text-primary font-bold hover:underline"
                  >
                    Orders &rarr;
                  </Link>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <Link
                    href="/login"
                    onClick={() => setIsMobileDrawerOpen(false)}
                    className="py-2.5 px-3 rounded-lg border border-outline-variant/60 text-center font-mono text-xs font-bold uppercase text-on-surface hover:bg-surface-container transition-colors"
                  >
                    Sign In
                  </Link>
                  <Link
                    href="/register"
                    onClick={() => setIsMobileDrawerOpen(false)}
                    className="py-2.5 px-3 rounded-lg bg-neutral-900 text-center font-mono text-xs font-bold uppercase text-white hover:bg-neutral-800 transition-colors"
                  >
                    Register
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── Bottom Navigation (Mobile Viewports) ───────────────────────── */}
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
            href="/custom-printing"
            className={`min-w-[56px] min-h-[48px] flex flex-col items-center justify-center p-1 rounded-lg active:scale-95 transition-all ${
              pathname.startsWith("/custom-printing")
                ? "text-primary font-bold"
                : "text-neutral-500 hover:text-neutral-900"
            }`}
          >
            <div className="w-5 h-5 flex items-center justify-center font-mono font-black text-xs border border-current rounded-xs">
              C
            </div>
            <span className="font-mono text-[10px] uppercase mt-0.5">Custom</span>
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
