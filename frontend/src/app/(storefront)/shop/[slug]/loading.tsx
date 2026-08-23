export default function ProductLoading() {
  return (
    <div className="flex flex-col lg:flex-row gap-12 max-w-container-max mx-auto w-full animate-pulse pb-16">
      
      {/* Image Gallery Skeleton */}
      <div className="w-full lg:w-1/2 flex flex-col md:flex-row-reverse gap-4">
        {/* Main Image */}
        <div className="w-full relative aspect-[3/4] bg-surface-container rounded-lg overflow-hidden border border-outline-variant/10"></div>
        
        {/* Thumbnails */}
        <div className="flex md:flex-col gap-4 overflow-hidden w-full md:w-20 shrink-0">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="relative w-20 aspect-[3/4] shrink-0 rounded bg-surface-container"></div>
          ))}
        </div>
      </div>

      {/* Product Details Skeleton */}
      <div className="w-full lg:w-1/2 flex flex-col pt-2 lg:pt-8 pr-4">
        {/* Breadcrumbs */}
        <div className="h-3 w-48 bg-surface-container rounded mb-4"></div>

        {/* Title */}
        <div className="h-10 w-3/4 bg-surface-container-highest rounded mb-4"></div>
        <div className="h-10 w-1/2 bg-surface-container-highest rounded mb-6"></div>
        
        {/* Rating */}
        <div className="flex items-center gap-4 mb-6">
          <div className="h-5 w-16 bg-surface-container rounded"></div>
          <div className="h-5 w-24 bg-surface-container rounded"></div>
        </div>

        {/* Price */}
        <div className="h-12 w-48 bg-surface-container-highest rounded mb-8"></div>

        {/* Offers Bento Box */}
        <div className="h-28 w-full bg-surface-container-low rounded-lg mb-8"></div>

        <hr className="border-outline-variant/20 mb-8" />

        {/* Color Selection */}
        <div className="mb-8">
          <div className="h-5 w-24 bg-surface-container rounded mb-4"></div>
          <div className="flex flex-wrap gap-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="w-12 h-12 rounded-full bg-surface-container"></div>
            ))}
          </div>
        </div>

        {/* Size Selection */}
        <div className="mb-8">
          <div className="flex justify-between items-center mb-4">
            <div className="h-5 w-20 bg-surface-container rounded"></div>
            <div className="h-4 w-24 bg-surface-container rounded"></div>
          </div>
          <div className="grid grid-cols-4 md:grid-cols-6 gap-3">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="h-12 w-full bg-surface-container rounded"></div>
            ))}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 mb-10">
          <div className="h-14 w-full sm:w-32 bg-surface-container rounded"></div>
          <div className="h-14 flex-1 bg-surface-container rounded"></div>
          <div className="h-14 flex-1 bg-surface-container-highest rounded"></div>
        </div>

        {/* Pincode Check */}
        <div className="h-32 w-full bg-surface-bright rounded-lg mb-8"></div>

        {/* Description */}
        <div>
          <div className="h-6 w-48 bg-surface-container rounded mb-4"></div>
          <div className="space-y-2">
            <div className="h-4 w-full bg-surface-container rounded"></div>
            <div className="h-4 w-full bg-surface-container rounded"></div>
            <div className="h-4 w-3/4 bg-surface-container rounded"></div>
            <div className="h-4 w-5/6 bg-surface-container rounded"></div>
          </div>
        </div>
      </div>
    </div>
  );
}
