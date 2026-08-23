"use client";

import Link from "next/link";
import { Search, User, Heart, ShoppingBag, Home } from "lucide-react";
import { useCartStore } from "@/store/useCartStore";
import { useWishlistStore } from "@/store/useWishlistStore";
import { useAuthStore } from "@/store/useAuthStore";
import { useEffect, useState } from "react";

export function Navbar() {
  const { isAuthenticated } = useAuthStore();
  const cartItems = useCartStore((state) => state.items);
  const wishlistItems = useWishlistStore((state) => state.items);
  
  // Hydration fix for counts
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);
  
  const cartCount = mounted && isAuthenticated ? cartItems.reduce((acc, item) => acc + item.quantity, 0) : 0;
  const wishlistCount = mounted && isAuthenticated ? wishlistItems.length : 0;
  return (
    <>
      {/* Announcement Bar */}
      <div className="bg-surface-container-high text-on-surface py-2 px-4 text-center font-label-caps text-label-caps tracking-widest hidden md:block">
        Free Shipping on orders above ₹999 | Limited Time: 10% OFF on first order | <Link href="/bulk-orders" className="underline hover:text-primary transition-colors">Bulk Orders</Link>
      </div>
      
      {/* TopNavBar */}
      <header className="bg-surface-container-lowest dark:bg-inverse-surface text-primary dark:text-inverse-primary font-body-md text-body-md sticky top-0 z-50 border-b border-outline-variant/10 dark:border-outline-variant/5 shadow-sm dark:shadow-none w-full">
        <div className="flex justify-between items-center w-full px-margin-mobile md:px-margin-desktop py-4 max-w-container-max mx-auto">
          {/* Brand */}
          <Link href="/" className="font-headline-lg text-headline-lg-mobile md:text-headline-lg font-extrabold tracking-tighter text-on-surface dark:text-inverse-on-surface flex items-center gap-2">
            <div className="w-5 h-5 bg-primary rounded-full"></div>
            THREADVIBE
          </Link>
          
          {/* Navigation Links (Desktop) */}
          <nav className="hidden md:flex gap-gutter items-center font-body-md text-body-md">
            <Link href="/" className="text-on-surface-variant dark:text-surface-variant hover:text-primary transition-colors dark:hover:text-inverse-primary transition-all font-bold text-primary dark:text-inverse-primary border-b-2 border-primary">Home</Link>
            <Link href="/shop" className="text-on-surface-variant dark:text-surface-variant hover:text-primary transition-colors dark:hover:text-inverse-primary transition-all">Men</Link>
            <Link href="/shop" className="text-on-surface-variant dark:text-surface-variant hover:text-primary transition-colors dark:hover:text-inverse-primary transition-all">Women</Link>
            <Link href="/shop" className="text-on-surface-variant dark:text-surface-variant hover:text-primary transition-colors dark:hover:text-inverse-primary transition-all">T-Shirts</Link>
            <Link href="/themes" className="text-on-surface-variant dark:text-surface-variant hover:text-primary transition-colors dark:hover:text-inverse-primary transition-all">Themes</Link>
            <Link href="/custom-designer" className="text-on-surface-variant dark:text-surface-variant hover:text-primary transition-colors dark:hover:text-inverse-primary transition-all">Custom Print</Link>
            <Link href="/bulk-orders" className="text-on-surface-variant dark:text-surface-variant hover:text-primary transition-colors dark:hover:text-inverse-primary transition-all">Bulk Orders</Link>
          </nav>
          
          {/* Actions */}
          <div className="flex items-center gap-element-gap text-primary dark:text-inverse-primary">
            <button aria-label="Search" className="transition-transform duration-200 active:scale-95 hover:text-primary dark:hover:text-inverse-primary transition-all text-on-surface-variant">
              <Search className="w-6 h-6" />
            </button>
            <Link href="/login" aria-label="person" className="transition-transform duration-200 active:scale-95 hover:text-primary dark:hover:text-inverse-primary transition-all hidden md:block text-on-surface-variant">
              <User className="w-6 h-6" />
            </Link>
            <Link href="/account/wishlist" aria-label="favorite" className="transition-transform duration-200 active:scale-95 hover:text-primary dark:hover:text-inverse-primary transition-all hidden md:block text-on-surface-variant relative">
              <Heart className="w-6 h-6" />
              {wishlistCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-secondary-container text-on-secondary w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold">
                  {wishlistCount > 99 ? '99+' : wishlistCount}
                </span>
              )}
            </Link>
            <Link href="/cart" aria-label="shopping_bag" className="transition-transform duration-200 active:scale-95 hover:text-primary dark:hover:text-inverse-primary transition-all relative text-on-surface-variant">
              <ShoppingBag className="w-6 h-6" />
              {cartCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-secondary-container text-on-secondary w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold">
                  {cartCount > 99 ? '99+' : cartCount}
                </span>
              )}
            </Link>
          </div>
        </div>
      </header>
      
      {/* BottomNavBar (Mobile only) */}
      <nav className="fixed bottom-0 left-0 w-full z-50 flex justify-around items-center px-4 py-3 pb-safe md:hidden bg-surface-container-lowest/90 dark:bg-inverse-surface/90 border-t border-outline-variant/20 backdrop-blur-md shadow-[0_-8px_24px_rgba(0,0,0,0.05)]">
        <Link href="/" className="flex flex-col items-center justify-center text-primary dark:text-inverse-primary font-bold active:bg-surface-container-high transition-all active:scale-90 duration-150 p-2 rounded-lg">
          <Home className="w-6 h-6 mb-1" />
          <span className="font-label-caps text-[10px]">Home</span>
        </Link>
        <Link href="/shop" className="flex flex-col items-center justify-center text-on-surface-variant/60 active:bg-surface-container-high transition-all active:scale-90 duration-150 p-2 rounded-lg">
          <ShoppingBag className="w-6 h-6 mb-1" />
          <span className="font-label-caps text-[10px]">Shop</span>
        </Link>
        <Link href="/search" className="flex flex-col items-center justify-center text-on-surface-variant/60 active:bg-surface-container-high transition-all active:scale-90 duration-150 p-2 rounded-lg">
          <Search className="w-6 h-6 mb-1" />
          <span className="font-label-caps text-[10px]">Search</span>
        </Link>
        <Link href="/account/wishlist" className="flex flex-col items-center justify-center text-on-surface-variant/60 active:bg-surface-container-high transition-all active:scale-90 duration-150 p-2 rounded-lg relative">
          <Heart className="w-6 h-6 mb-1" />
          <span className="font-label-caps text-[10px]">Wishlist</span>
          {wishlistCount > 0 && (
            <span className="absolute top-1 right-2 bg-secondary-container text-on-secondary w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold">
              {wishlistCount > 99 ? '99+' : wishlistCount}
            </span>
          )}
        </Link>
        <Link href="/account" className="flex flex-col items-center justify-center text-on-surface-variant/60 active:bg-surface-container-high transition-all active:scale-90 duration-150 p-2 rounded-lg">
          <User className="w-6 h-6 mb-1" />
          <span className="font-label-caps text-[10px]">Account</span>
        </Link>
      </nav>
    </>
  );
}
