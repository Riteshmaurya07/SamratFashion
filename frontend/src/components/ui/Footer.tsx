import Link from "next/link";
import { CategoryItem } from "@/lib/catalog";

export function Footer({ categories }: { categories?: CategoryItem[] }) {
  return (
    <footer className="bg-neutral-950 text-neutral-300 font-body-sm text-body-sm w-full border-t border-neutral-800 mt-20 pb-20 lg:pb-0">
      {/* Value Proposition Strip */}
      <div className="border-b border-neutral-800/80 py-8 px-margin-mobile md:px-margin-desktop">
        <div className="max-w-container-max mx-auto grid grid-cols-2 md:grid-cols-4 gap-6">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-md bg-neutral-900 border border-neutral-800 flex items-center justify-center text-primary shrink-0">
              <span className="material-symbols-outlined text-lg">local_shipping</span>
            </div>
            <div>
              <p className="font-mono text-xs uppercase font-bold text-neutral-100">Free Express Shipping</p>
              <p className="text-[12px] text-neutral-400">On all prepaid orders over ₹999</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-md bg-neutral-900 border border-neutral-800 flex items-center justify-center text-primary shrink-0">
              <span className="material-symbols-outlined text-lg">apparel</span>
            </div>
            <div>
              <p className="font-mono text-xs uppercase font-bold text-neutral-100">240+ GSM Cotton</p>
              <p className="text-[12px] text-neutral-400">Structured streetwear fit & feel</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-md bg-neutral-900 border border-neutral-800 flex items-center justify-center text-primary shrink-0">
              <span className="material-symbols-outlined text-lg">verified</span>
            </div>
            <div>
              <p className="font-mono text-xs uppercase font-bold text-neutral-100">HD DTF Prints</p>
              <p className="text-[12px] text-neutral-400">50+ wash-tested color lock</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-md bg-neutral-900 border border-neutral-800 flex items-center justify-center text-primary shrink-0">
              <span className="material-symbols-outlined text-lg">lock</span>
            </div>
            <div>
              <p className="font-mono text-xs uppercase font-bold text-neutral-100">Secure Payments</p>
              <p className="text-[12px] text-neutral-400">Razorpay verified encryption</p>
            </div>
          </div>
        </div>
      </div>

      <div className="w-full px-margin-mobile md:px-margin-desktop py-14 grid grid-cols-1 md:grid-cols-12 gap-8 max-w-container-max mx-auto">
        <div className="col-span-1 md:col-span-4 flex flex-col gap-4">
          <Link href="/" className="font-headline-lg text-2xl font-black text-white flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-primary rounded-xs rotate-45"></span>
            THREADVIBE
          </Link>
          <p className="text-neutral-400 max-w-sm text-xs leading-relaxed">
            Architectural men&apos;s streetwear engineered in India. Heavyweight dropped-shoulder tees, cyberpunk prints, and on-demand custom printing studio.
          </p>
          <div className="pt-2 font-mono text-[11px] text-neutral-500">
            <span>STUDIO &bull; SAMRAT FASHION &bull; NEW DELHI</span>
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
          <h3 className="font-mono text-xs uppercase text-neutral-100 font-bold tracking-wider mb-1">STUDIO</h3>
          <Link href="/custom-printing" className="text-neutral-400 hover:text-white transition-colors text-xs">Custom Printing</Link>
          <Link href="/account/designs" className="text-neutral-400 hover:text-white transition-colors text-xs">My Design Studio</Link>
          <Link href="/account/orders" className="text-neutral-400 hover:text-white transition-colors text-xs">Track Order</Link>
          <Link href="/support" className="text-neutral-400 hover:text-white transition-colors text-xs">Customer Support</Link>
        </div>

        <div className="col-span-1 md:col-span-4 flex flex-col gap-3">
          <h3 className="font-mono text-xs uppercase text-neutral-100 font-bold tracking-wider mb-1">EXCLUSIVE DROPS</h3>
          <p className="text-xs text-neutral-400 leading-relaxed">
            Join our private drop notifications. Be first in line for limited graphic batches and seasonal capsule releases.
          </p>
          <div className="flex max-w-sm mt-1">
            <input
              className="bg-neutral-900 border border-neutral-800 text-white font-body-sm text-xs px-3.5 py-2.5 rounded-l-md focus:outline-none focus:border-primary w-full placeholder:text-neutral-500"
              placeholder="Enter your email"
              type="email"
            />
            <button className="bg-primary text-white px-5 py-2.5 rounded-r-md font-mono text-xs font-bold uppercase tracking-wider hover:bg-primary/90 transition-colors shrink-0">
              JOIN
            </button>
          </div>
        </div>

        <div className="col-span-1 md:col-span-12 mt-8 pt-6 border-t border-neutral-800/80 flex flex-col md:flex-row justify-between items-center gap-4 text-xs text-neutral-400">
          <p className="font-mono text-[11px]">
            &copy; {new Date().getFullYear()} THREADVIBE &bull; SAMRAT FASHION. ALL RIGHTS RESERVED.
          </p>
          <div className="flex gap-6 font-mono text-[11px]">
            <Link href="/terms" className="hover:text-white transition-colors">Terms of Service</Link>
            <Link href="/terms" className="hover:text-white transition-colors">Privacy Policy</Link>
            <Link href="/support" className="hover:text-white transition-colors">Shipping &amp; Returns</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
