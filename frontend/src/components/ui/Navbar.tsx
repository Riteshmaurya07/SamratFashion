"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { Search, User, Heart, ShoppingBag, Home, Menu, X } from "lucide-react";
import { useCartStore } from "@/store/useCartStore";
import { useWishlistStore } from "@/store/useWishlistStore";
import { useAuthStore } from "@/store/useAuthStore";
import { useEffect, useState } from "react";
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
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryList, setCategoryList] = useState<CategoryItem[]>(categories);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (categories && categories.length > 0) {
      setCategoryList(categories);
    } else {
      getActiveCategories().then((res) => {
        if (res.length > 0) setCategoryList(res);
      });
    }
  }, [categories]);
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    router.push(`/shop?search=${encodeURIComponent(searchQuery.trim())}`);
    setIsSearchOpen(false);
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
          {/* Brand */}
          <Link href="/" className="flex flex-col group">
            <span className="font-headline-lg text-xl md:text-2xl font-black tracking-[-0.04em] text-on-surface uppercase flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 bg-primary rounded-xs rotate-45 group-hover:rotate-90 transition-transform duration-300"></span>
              THREADVIBE
            </span>
            <span className="font-mono text-[9px] tracking-[0.25em] text-on-surface-variant uppercase -mt-0.5">
              SAMRAT FASHION
            </span>
          </Link>

          {/* Navigation Links (Desktop) - Backend-Driven Categories */}
          <nav className="hidden lg:flex gap-6 items-center font-body-sm text-[13px] tracking-wide uppercase font-semibold">
            {categoryList.map((cat) => {
              const isSelected = mounted && pathname === "/shop" && window.location.search.includes(`category=${cat.slug}`);
              return (
                <Link
                  key={cat._id}
                  href={`/shop?category=${encodeURIComponent(cat.slug)}`}
                  className={`transition-colors py-1 hover:text-primary ${isSelected ? "text-primary border-b-2 border-primary" : "text-on-surface-variant"}`}
                >
                  {cat.name}
                </Link>
              );
            })}
            <Link
              href="/shop"
              className={`transition-colors py-1 hover:text-primary ${pathname === "/shop" && (!mounted || !window.location.search.includes("category=")) ? "text-primary border-b-2 border-primary" : "text-on-surface-variant"}`}
            >
              All Drops
            </Link>
            <Link
              href="/custom-printing"
              className={`transition-colors py-1 hover:text-primary flex items-center gap-1.5 ${pathname === "/custom-printing" ? "text-primary border-b-2 border-primary" : "text-on-surface-variant"}`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
              Custom Print
            </Link>
            <Link
              href="/account/designs"
              className={`transition-colors py-1 hover:text-primary ${pathname === "/account/designs" ? "text-primary border-b-2 border-primary" : "text-on-surface-variant"}`}
            >
              My Studio
            </Link>
          </nav>
          {/* Actions */}
          <div className="flex items-center gap-3 md:gap-4 text-on-surface">
            {/* Mobile Category Menu Toggle */}
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              aria-label={isMobileMenuOpen ? "Close category navigation" : "Open category navigation"}
              className="p-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container rounded-lg transition-colors active:scale-95 lg:hidden"
            >
              {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
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
                  {wishlistCount > 99 ? '99+' : wishlistCount}
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
                  {cartCount > 99 ? '99+' : cartCount}
                </span>
              )}
            </Link>
          </div>
        </div>

        {/* Modern Streetwear Search Drawer */}
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
                {(categoryList.length > 0 ? categoryList.slice(0, 5).map(c => c.name) : ["Oversized", "Cyberpunk", "Tokyo Mecha", "Acid Wash", "Heavyweight 240 GSM"]).map((tag) => (
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

      {/* Mobile Category Drawer Menu (Opens from header hamburger) */}
      {isMobileMenuOpen && (
        <div className="lg:hidden bg-surface border-b border-outline-variant/30 py-4 px-margin-mobile animate-in slide-in-from-top-2 duration-200">
          <div className="space-y-4">
            <p className="font-mono text-[11px] uppercase tracking-wider text-neutral-400 font-bold">
              CATEGORIES
            </p>
            <div className="grid grid-cols-2 gap-2">
              {categoryList.map((cat) => (
                <Link
                  key={cat._id}
                  href={`/shop?category=${encodeURIComponent(cat.slug)}`}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="p-2.5 rounded-lg bg-surface-container-low border border-outline-variant/30 font-body-sm text-xs font-semibold text-on-surface hover:border-primary transition-colors"
                >
                  {cat.name}
                </Link>
              ))}
            </div>
            <div className="pt-2 border-t border-outline-variant/20 flex flex-col gap-2 font-mono text-xs uppercase">
              <Link
                href="/shop"
                onClick={() => setIsMobileMenuOpen(false)}
                className="py-1 text-on-surface-variant hover:text-primary transition-colors"
              >
                All Drops &rarr;
              </Link>
              <Link
                href="/custom-printing"
                onClick={() => setIsMobileMenuOpen(false)}
                className="py-1 text-on-surface-variant hover:text-primary transition-colors flex items-center gap-1.5"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
                Custom Print Studio
              </Link>
              <Link
                href="/account/designs"
                onClick={() => setIsMobileMenuOpen(false)}
                className="py-1 text-on-surface-variant hover:text-primary transition-colors"
              >
                My Saved Designs
              </Link>
            </div>
          </div>
        </div>
      )}
      {/* Bottom Navigation (Mobile Viewports) */}
      <nav className="fixed bottom-0 left-0 w-full z-50 flex justify-around items-center px-2 py-2.5 pb-safe lg:hidden bg-surface/95 border-t border-outline-variant/30 backdrop-blur-lg shadow-[0_-8px_24px_rgba(0,0,0,0.06)]">
        <Link href="/" className={`flex flex-col items-center justify-center p-1.5 rounded-md transition-colors ${pathname === "/" ? "text-primary font-bold" : "text-neutral-500 hover:text-neutral-900"}`}>
          <Home className="w-5 h-5" />
          <span className="font-mono text-[10px] uppercase mt-1">Home</span>
        </Link>
        <Link href="/shop" className={`flex flex-col items-center justify-center p-1.5 rounded-md transition-colors ${pathname === "/shop" ? "text-primary font-bold" : "text-neutral-500 hover:text-neutral-900"}`}>
          <ShoppingBag className="w-5 h-5" />
          <span className="font-mono text-[10px] uppercase mt-1">Catalog</span>
        </Link>
        <Link href="/custom-printing" className={`flex flex-col items-center justify-center p-1.5 rounded-md transition-colors ${pathname === "/custom-printing" ? "text-primary font-bold" : "text-neutral-500 hover:text-neutral-900"}`}>
          <div className="w-5 h-5 flex items-center justify-center font-mono font-black text-xs border border-current rounded-xs">
            C
          </div>
          <span className="font-mono text-[10px] uppercase mt-1">Custom</span>
        </Link>
        <Link href="/account/wishlist" className={`flex flex-col items-center justify-center p-1.5 rounded-md transition-colors relative ${pathname === "/account/wishlist" ? "text-primary font-bold" : "text-neutral-500 hover:text-neutral-900"}`}>
          <Heart className="w-5 h-5" />
          <span className="font-mono text-[10px] uppercase mt-1">Wishlist</span>
          {wishlistCount > 0 && (
            <span className="absolute top-0 right-1 bg-neutral-900 text-white min-w-3.5 h-3.5 px-0.5 rounded-full flex items-center justify-center font-mono text-[8px] font-bold">
              {wishlistCount > 99 ? '99+' : wishlistCount}
            </span>
          )}
        </Link>
        <Link href={isAuthenticated ? "/account" : "/login"} className={`flex flex-col items-center justify-center p-1.5 rounded-md transition-colors ${pathname.startsWith("/account") && pathname !== "/account/wishlist" ? "text-primary font-bold" : "text-neutral-500 hover:text-neutral-900"}`}>
          <User className="w-5 h-5" />
          <span className="font-mono text-[10px] uppercase mt-1">Account</span>
        </Link>
      </nav>
    </>
  );
}
