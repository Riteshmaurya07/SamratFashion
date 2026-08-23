import Link from "next/link";
import { PackageX } from "lucide-react";

export default function NotFound() {
  return (
    <main className="flex-grow w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-24 flex flex-col items-center justify-center min-h-[60vh]">
      <div className="w-24 h-24 bg-surface-container rounded-full flex items-center justify-center mb-6">
        <PackageX className="w-12 h-12 text-on-surface-variant" />
      </div>
      <h1 className="font-display-lg text-on-surface mb-4">Product Not Found</h1>
      <p className="text-on-surface-variant mb-8 text-center max-w-md font-body-md leading-relaxed">
        The product you are looking for might have been removed, had its name changed, or is temporarily unavailable.
      </p>
      <Link href="/shop" className="px-8 py-3 bg-primary text-on-primary rounded font-label-caps font-bold transition-transform hover:scale-105 active:scale-95 shadow-md">
        CONTINUE SHOPPING
      </Link>
    </main>
  );
}
