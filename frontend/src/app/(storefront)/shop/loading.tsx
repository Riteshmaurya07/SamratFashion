import { ChevronRight } from "lucide-react";

export default function ShopLoading() {
  return (
    <main className="flex-grow w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop py-8 md:py-12 animate-pulse">
      {/* Breadcrumbs & Header Skeleton */}
      <div className="mb-12">
        <div className="flex gap-2 items-center mb-6">
          <div className="h-4 w-12 bg-surface-container rounded"></div>
          <ChevronRight className="w-4 h-4 text-surface-container" />
          <div className="h-4 w-12 bg-surface-container rounded"></div>
        </div>
        
        <div className="flex flex-col md:flex-row justify-between items-end gap-6 border-b border-outline-variant/20 pb-8">
          <div className="max-w-2xl w-full">
            <div className="h-12 w-3/4 bg-surface-container-highest rounded mb-4"></div>
            <div className="h-6 w-full bg-surface-container-highest rounded mb-2"></div>
            <div className="h-6 w-5/6 bg-surface-container-highest rounded"></div>
          </div>
          <div className="h-8 w-24 bg-surface-container rounded-full"></div>
        </div>

        {/* Subcategory Chips Skeleton */}
        <div className="flex gap-4 py-6 mt-2 overflow-hidden">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-10 w-24 bg-surface-container-highest rounded-full shrink-0"></div>
          ))}
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-gutter">
        {/* Mobile Filter Toggle Skeleton */}
        <div className="md:hidden flex justify-between items-center mb-6">
          <div className="h-10 w-24 bg-surface-container rounded"></div>
          <div className="h-10 w-24 bg-surface-container rounded"></div>
        </div>

        {/* Sidebar Filters Skeleton */}
        <aside className="hidden md:block w-full md:w-1/4 shrink-0 space-y-8 pr-4">
          <div className="flex justify-between items-center border-b border-outline-variant/20 pb-4">
            <div className="h-6 w-20 bg-surface-container rounded"></div>
            <div className="h-4 w-16 bg-surface-container rounded"></div>
          </div>
          
          {[1, 2, 3].map((i) => (
            <div key={i} className="border-b border-outline-variant/10 pb-6">
              <div className="h-5 w-24 bg-surface-container rounded mb-4"></div>
              <div className="space-y-3">
                <div className="h-4 w-full bg-surface-container-lowest rounded"></div>
                <div className="h-4 w-5/6 bg-surface-container-lowest rounded"></div>
                <div className="h-4 w-4/5 bg-surface-container-lowest rounded"></div>
              </div>
            </div>
          ))}
        </aside>

        {/* Product Grid Area Skeleton */}
        <div className="w-full md:w-3/4">
          {/* Toolbar Skeleton */}
          <div className="hidden md:flex justify-between items-center mb-6 bg-surface-container-lowest p-4 rounded-lg border border-outline-variant/10 h-16">
            <div className="h-4 w-40 bg-surface-container rounded"></div>
            <div className="h-4 w-48 bg-surface-container rounded"></div>
          </div>

          {/* Grid Skeleton */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 gap-y-12">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="flex flex-col gap-4">
                <div className="aspect-[3/4] w-full bg-surface-container-low rounded border border-outline-variant/10"></div>
                <div className="h-6 w-3/4 bg-surface-container-low rounded"></div>
                <div className="h-4 w-full bg-surface-container-low rounded"></div>
                <div className="h-6 w-1/4 bg-surface-container-low rounded mt-auto"></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
