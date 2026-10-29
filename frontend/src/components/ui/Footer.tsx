import Link from "next/link";
import { CategoryItem } from "@/lib/catalog";
import { NewsletterForm } from "./NewsletterForm";

export function Footer({ categories }: { categories?: CategoryItem[] }) {
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
              <p className="text-[10px] sm:text-[12px] text-neutral-400 mt-0.5 leading-tight">Prepaid orders over ₹999</p>
            </div>
          </div>
          <div className="flex items-start gap-2.5 sm:gap-3">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-md bg-neutral-900 border border-neutral-800 flex items-center justify-center text-white shrink-0 mt-0.5">
              <span className="material-symbols-outlined text-base sm:text-lg">apparel</span>
            </div>
            <div>
              <p className="font-mono text-[11px] sm:text-xs uppercase font-bold text-neutral-100 leading-tight">240+ GSM Cotton</p>
              <p className="text-[10px] sm:text-[12px] text-neutral-400 mt-0.5 leading-tight">Heavy boxy streetwear fit</p>
            </div>
          </div>
          <div className="flex items-start gap-2.5 sm:gap-3">
            <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-md bg-neutral-900 border border-neutral-800 flex items-center justify-center text-white shrink-0 mt-0.5">
              <span className="material-symbols-outlined text-base sm:text-lg">verified</span>
            </div>
            <div>
              <p className="font-mono text-[11px] sm:text-xs uppercase font-bold text-neutral-100 leading-tight">HD DTF Prints</p>
              <p className="text-[10px] sm:text-[12px] text-neutral-400 mt-0.5 leading-tight">50+ wash-tested cure</p>
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
            THREADVIBE
          </Link>
          <p className="text-neutral-400 max-w-sm text-xs leading-relaxed">
            Architectural men&apos;s streetwear engineered in India. Heavyweight dropped-shoulder tees, cyberpunk graphic art, and structured contemporary capsules.
          </p>
          <div className="pt-2 font-mono text-[11px] text-neutral-500">
            <span>SAMRAT FASHION &bull; NEW DELHI</span>
          </div>
        </div>

        <div className="col-span-1 md:col-span-2 flex flex-col gap-2.5">
          <h3 className="font-mono text-xs uppercase text-neutral-100 font-bold tracking-wider mb-1">STREETWEAR</h3>
          {categories && categories.length > 0 ? (
            categories.slice(0, 5).map((cat) => (
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
          <Link href="/account/orders" className="text-neutral-400 hover:text-white transition-colors text-xs">Track My Order</Link>
          <Link href="/account/wishlist" className="text-neutral-400 hover:text-white transition-colors text-xs">Saved Wishlist</Link>
          <Link href="/support" className="text-neutral-400 hover:text-white transition-colors text-xs">Customer Support</Link>
        </div>
        <div className="col-span-1 md:col-span-4 flex flex-col gap-3">
          <h3 className="font-mono text-xs uppercase text-neutral-100 font-bold tracking-wider mb-1">EXCLUSIVE DROPS</h3>
          <p className="text-xs text-neutral-400 leading-relaxed">
            Join our private drop notifications. Be first in line for limited graphic batches and seasonal capsule releases.
          </p>
          <NewsletterForm />
        </div>
        <div className="col-span-1 md:col-span-12 mt-8 pt-6 border-t border-neutral-800/80 flex flex-col md:flex-row justify-between items-center gap-4 text-xs text-neutral-400">
          <p className="font-mono text-[11px]">
            &copy; {new Date().getFullYear()} THREADVIBE &bull; SAMRAT FASHION. ALL RIGHTS RESERVED.
          </p>
          <div className="flex flex-wrap gap-4 sm:gap-6 font-mono text-[11px]">
            <Link href="/terms" className="hover:text-white transition-colors">Terms of Service</Link>
            <Link href="/terms" className="hover:text-white transition-colors">Privacy Policy</Link>
            <Link href="/support" className="hover:text-white transition-colors">Shipping &amp; Returns</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
