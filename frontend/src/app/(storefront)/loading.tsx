export default function HomepageLoading() {
  return (
    <main className="w-full flex flex-col items-center animate-pulse">
      {/* Hero Section Skeleton */}
      <section className="relative w-full h-[870px] min-h-[600px] flex items-center bg-surface-container overflow-hidden">
        <div className="relative z-10 w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop">
          <div className="max-w-2xl">
            <div className="h-16 w-3/4 bg-surface-container-highest rounded mb-6"></div>
            <div className="h-8 w-full bg-surface-container-highest rounded mb-4"></div>
            <div className="h-8 w-5/6 bg-surface-container-highest rounded mb-10"></div>
            <div className="flex flex-wrap gap-4">
              <div className="h-14 w-40 bg-surface-container-highest rounded-lg"></div>
              <div className="h-14 w-40 bg-surface-container-highest rounded-lg"></div>
            </div>
          </div>
        </div>
      </section>

      {/* Category Shortcuts Skeleton */}
      <section className="py-16 bg-surface-bright w-full flex justify-center">
        <div className="w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop overflow-x-hidden">
          <div className="flex gap-8 justify-between w-full opacity-50">
            {[1, 2, 3, 4, 5, 6, 7].map((i) => (
              <div key={i} className="flex flex-col items-center gap-3">
                <div className="w-20 h-20 rounded-full bg-surface-container-highest"></div>
                <div className="h-4 w-16 bg-surface-container-highest rounded"></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Trending Products Skeleton */}
      <section className="py-section-gap bg-surface-container-lowest w-full flex justify-center">
        <div className="w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop">
          <div className="flex justify-between items-end mb-12">
            <div className="h-10 w-64 bg-surface-container rounded"></div>
            <div className="h-4 w-20 bg-surface-container rounded"></div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-gutter">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex flex-col gap-4">
                <div className="aspect-[3/4] w-full bg-surface-container-low rounded border border-outline-variant/10"></div>
                <div className="h-6 w-3/4 bg-surface-container-low rounded"></div>
                <div className="h-4 w-full bg-surface-container-low rounded"></div>
                <div className="h-6 w-1/4 bg-surface-container-low rounded mt-auto"></div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
