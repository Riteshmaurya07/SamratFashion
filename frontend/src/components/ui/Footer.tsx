import Link from "next/link";
import { Globe } from "lucide-react";

export function Footer() {
  return (
    <footer className="bg-surface-container-lowest dark:bg-inverse-surface text-on-surface dark:text-inverse-on-surface font-body-sm text-body-sm w-full border-t border-outline-variant/10 mt-section-gap pb-20 md:pb-0">
      <div className="w-full px-margin-mobile md:px-margin-desktop py-16 grid grid-cols-1 md:grid-cols-4 gap-gutter max-w-container-max mx-auto">
        <div className="col-span-1 md:col-span-1 flex flex-col gap-4">
          <Link href="/" className="font-headline-lg text-headline-lg font-black text-on-surface dark:text-inverse-on-surface flex items-center gap-2">
            <div className="w-5 h-5 bg-primary rounded-full"></div>
            THREADVIBE
          </Link>
          <p className="text-on-surface-variant max-w-xs mt-2">
            Premium streetwear and custom apparel. Wear your vibe, loud and clear.
          </p>
        </div>
        <div className="col-span-1 flex flex-col gap-3">
          <h3 className="font-label-caps text-label-caps mb-2 text-on-surface font-bold">SUPPORT</h3>
          <Link href="/account/orders" className="text-on-surface-variant hover:text-primary hover:text-secondary transition-colors duration-200">Track Order</Link>
          <Link href="/support/returns" className="text-on-surface-variant hover:text-primary hover:text-secondary transition-colors duration-200">Returns</Link>
          <Link href="/support/size-guide" className="text-on-surface-variant hover:text-primary hover:text-secondary transition-colors duration-200">Size Guide</Link>
        </div>
        <div className="col-span-1 flex flex-col gap-3">
          <h3 className="font-label-caps text-label-caps mb-2 text-on-surface font-bold font-mono">COMPANY</h3>
          <Link href="/shop" className="text-on-surface-variant hover:text-primary hover:text-secondary transition-colors duration-200">Catalog</Link>
          <Link href="/custom-printing" className="text-on-surface-variant hover:text-primary hover:text-secondary transition-colors duration-200">Custom Printing</Link>
          <Link href="/privacy" className="text-on-surface-variant hover:text-primary hover:text-secondary transition-colors duration-200">Privacy Policy</Link>
        </div>
        <div className="col-span-1 flex flex-col gap-3">
          <h3 className="font-label-caps text-label-caps mb-2 text-on-surface font-bold">JOIN THE CLUB</h3>
          <p className="font-body-sm text-body-sm text-on-surface-variant">Subscribe for exclusive drops and 10% off your first order.</p>
          <div className="flex">
            <input className="bg-surface border border-outline-variant/50 text-on-surface font-body-sm text-body-sm px-4 py-2 rounded-l focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary w-full" placeholder="Email Address" type="email" />
            <button className="bg-primary text-on-primary px-4 py-2 rounded-r font-label-caps text-label-caps font-bold hover:bg-primary/90 transition-colors">JOIN</button>
          </div>
        </div>
        <div className="col-span-1 md:col-span-4 mt-12 pt-8 border-t border-outline-variant/10 text-center flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="font-label-caps text-label-caps text-on-surface-variant">© {new Date().getFullYear()} Threadvibe Clothing India. All rights reserved.</p>
          <div className="flex gap-4">
            <a href="#" className="text-on-surface-variant hover:text-primary transition-colors"><Globe className="w-5 h-5" /></a>
          </div>
        </div>
      </div>
    </footer>
  );
}
