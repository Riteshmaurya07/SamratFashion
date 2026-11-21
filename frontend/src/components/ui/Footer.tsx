"use client";

import Link from "next/link";
import { Mail, Phone, Clock, MapPin } from "lucide-react";
import { CategoryItem, filterStorefrontCategories } from "@/lib/catalog";
import { NewsletterForm } from "./NewsletterForm";
import { useStoreSettings } from "@/lib/useStoreSettings";
import { formatFreeShippingRule } from "@/lib/storeSettingsDefaults";
import { SITE_CONFIG } from "@/lib/seo";

export function Footer({ categories }: { categories?: CategoryItem[] }) {
  const { freeShippingThreshold } = useStoreSettings();
  const filteredCategories = filterStorefrontCategories(categories || []);

  return (
    <footer className="bg-neutral-950 text-neutral-300 font-body-sm text-body-sm w-full border-t border-neutral-800 mt-16 sm:mt-20 pb-28 lg:pb-10 pb-safe">
      {/* Value Proposition Strip */}
      <div className="border-b border-neutral-800/80 py-6 sm:py-8 px-margin-mobile md:px-margin-desktop">
        <div className="max-w-container-max mx-auto grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-6">
          <div className="flex items-start gap-2.5 sm:gap-3">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-md bg-neutral-900 border border-neutral-800 flex items-center justify-center text-white shrink-0 mt-0.5">
              <span className="material-symbols-outlined text-base sm:text-lg">local_shipping</span>
            </div>
            <div>
              <p className="font-mono text-[11px] sm:text-xs uppercase font-bold text-neutral-100 leading-tight">Free Express Shipping</p>
              <p className="text-[10px] sm:text-[12px] text-neutral-400 mt-0.5 leading-tight">{formatFreeShippingRule(freeShippingThreshold)}</p>
            </div>
          </div>
          <div className="flex items-start gap-2.5 sm:gap-3">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-md bg-neutral-900 border border-neutral-800 flex items-center justify-center text-white shrink-0 mt-0.5">
              <span className="material-symbols-outlined text-base sm:text-lg">apparel</span>
            </div>
            <div>
              <p className="font-mono text-[11px] sm:text-xs uppercase font-bold text-neutral-100 leading-tight">Tailored Craftsmanship</p>
              <p className="text-[10px] sm:text-[12px] text-neutral-400 mt-0.5 leading-tight">Structured fit &amp; breathable weaves</p>
            </div>
          </div>
          <div className="flex items-start gap-2.5 sm:gap-3">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-md bg-neutral-900 border border-neutral-800 flex items-center justify-center text-white shrink-0 mt-0.5">
              <span className="material-symbols-outlined text-base sm:text-lg">verified</span>
            </div>
            <div>
              <p className="font-mono text-[11px] sm:text-xs uppercase font-bold text-neutral-100 leading-tight">7-Day Easy Returns</p>
              <p className="text-[10px] sm:text-[12px] text-neutral-400 mt-0.5 leading-tight">Doorstep pickup &amp; easy returns</p>
            </div>
          </div>
          <div className="flex items-start gap-2.5 sm:gap-3">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-md bg-neutral-900 border border-neutral-800 flex items-center justify-center text-white shrink-0 mt-0.5">
              <span className="material-symbols-outlined text-base sm:text-lg">lock</span>
            </div>
            <div>
              <p className="font-mono text-[11px] sm:text-xs uppercase font-bold text-neutral-100 leading-tight">Secure Payments</p>
              <p className="text-[10px] sm:text-[12px] text-neutral-400 mt-0.5 leading-tight">Razorpay encrypted checkout</p>
            </div>
          </div>
        </div>
      </div>

      <div className="w-full px-margin-mobile md:px-margin-desktop py-14 grid grid-cols-1 md:grid-cols-12 gap-8 max-w-container-max mx-auto">
        <div className="col-span-1 md:col-span-4 flex flex-col gap-4">
          <Link href="/" className="font-headline-lg text-2xl font-black text-white flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-white rounded-xs rotate-45"></span>
            SAMRAT FASHION
          </Link>
          <p className="text-neutral-400 max-w-sm text-xs leading-relaxed">
            Contemporary Indian menswear crafted for festive, formal, and everyday wear. Structured Nehru jackets, coti, and timeless wardrobe essentials.
          </p>
          <div className="pt-2 space-y-2 text-xs text-neutral-300">
            <a
              href={`mailto:${SITE_CONFIG.email}`}
              className="flex items-center gap-2 hover:text-white transition-colors"
            >
              <Mail className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
              <span>{SITE_CONFIG.email}</span>
            </a>
            <a
              href={`tel:${SITE_CONFIG.telephone.replace(/[^+\d]/g, "")}`}
              className="flex items-center gap-2 hover:text-white transition-colors"
            >
              <Phone className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
              <span>{SITE_CONFIG.telephone}</span>
            </a>
            <p className="flex items-center gap-2 text-neutral-400">
              <Clock className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
              <span>Mon–Sat, 10:00 AM – 7:00 PM IST</span>
            </p>
            <p className="flex items-center gap-2 text-neutral-500 font-mono text-[11px]">
              <MapPin className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
              <span>SAMRAT FASHION &bull; NEW DELHI, INDIA</span>
            </p>
          </div>
        </div>

        <div className="col-span-1 md:col-span-2 flex flex-col gap-2.5">
          <h3 className="font-mono text-xs uppercase text-neutral-100 font-bold tracking-wider mb-1">COLLECTIONS</h3>
          {filteredCategories.length > 0 ? (
            filteredCategories.slice(0, 5).map((cat) => (
              <Link
                key={cat._id}
                href={`/shop?category=${encodeURIComponent(cat.slug)}`}
                className="text-neutral-400 hover:text-white transition-colors text-xs"
              >
                {cat.name}
              </Link>
            ))
          ) : null}
          <Link href="/shop" className="text-neutral-400 hover:text-white transition-colors text-xs">All Collections</Link>
        </div>
        <div className="col-span-1 md:col-span-2 flex flex-col gap-2.5">
          <h3 className="font-mono text-xs uppercase text-neutral-100 font-bold tracking-wider mb-1">CUSTOMER CARE</h3>
          <Link href="/offers" className="text-neutral-400 hover:text-white transition-colors text-xs">Special Offers &amp; Deals</Link>
          <Link href="/account/orders" className="text-neutral-400 hover:text-white transition-colors text-xs">My Orders</Link>
          <Link href="/account/wishlist" className="text-neutral-400 hover:text-white transition-colors text-xs">Saved Wishlist</Link>
          <Link href="/support" className="text-neutral-400 hover:text-white transition-colors text-xs">Customer Support</Link>
        </div>
        <div className="col-span-1 md:col-span-4 flex flex-col gap-3">
          <h3 className="font-mono text-xs uppercase text-neutral-100 font-bold tracking-wider mb-1">STAY UPDATED</h3>
          <p className="text-xs text-neutral-400 leading-relaxed">
            Join our mailing list for new arrivals, festive edits, and seasonal offers from Samrat Fashion.
          </p>
          <NewsletterForm />
          <p className="text-[11px] text-neutral-500">
            By subscribing, you agree to our{" "}
            <Link href="/privacy" className="underline hover:text-neutral-300 transition-colors">
              Privacy Policy
            </Link>
            .
          </p>
        </div>
        <div className="col-span-1 md:col-span-12 mt-8 pt-6 border-t border-neutral-800/80 flex flex-col md:flex-row justify-between items-center gap-4 text-xs text-neutral-400">
          <p className="font-mono text-[11px]">
            &copy; {new Date().getFullYear()} SAMRAT FASHION. ALL RIGHTS RESERVED.
          </p>
          <div className="flex flex-wrap gap-4 sm:gap-6 font-mono text-[11px]">
            <Link href="/terms" className="hover:text-white transition-colors">Terms of Service</Link>
            <Link href="/privacy" className="hover:text-white transition-colors">Privacy Policy</Link>
            <Link href="/shipping-returns" className="hover:text-white transition-colors">Shipping &amp; Returns</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
