"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useCallback, useEffect } from "react";
import { Minus, Grid, List, SlidersHorizontal, X } from "lucide-react";

export function ShopFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const currentCategory = searchParams.get("category") || "";
  const currentMaxPrice = searchParams.get("maxPrice") || "2499";
  
  // Local state for sliders so they don't block navigation on every tick
  const [price, setPrice] = useState(Number(currentMaxPrice));

  const updateFilters = useCallback((key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    // Always reset page to 1 on filter change
    params.delete("page");
    router.push(`/shop?${params.toString()}`);
  }, [router, searchParams]);

  const handlePriceChangeEnd = (val: number) => {
    updateFilters("maxPrice", val.toString());
  };

  const clearAll = () => {
    router.push("/shop");
  };

  return (
    <aside className="hidden md:block w-full md:w-1/4 shrink-0 space-y-8 pr-4">
      <div className="flex justify-between items-center border-b border-outline-variant/20 pb-4">
        <h2 className="font-headline-sm text-headline-sm text-on-surface">Filters</h2>
        <button onClick={clearAll} className="font-label-caps text-label-caps text-on-surface-variant underline hover:text-primary transition-colors">
          Clear All
        </button>
      </div>
      
      {/* Category Filter */}
      <div className="border-b border-outline-variant/10 pb-6">
        <h3 className="font-label-caps text-label-caps text-on-surface font-bold mb-4 flex justify-between items-center cursor-pointer">
          Category <Minus className="w-4 h-4" />
        </h3>
        <div className="space-y-3 font-body-sm text-body-sm text-on-surface-variant">
          {['Men', 'Women', 'Unisex'].map(cat => (
            <label key={cat} className="flex items-center gap-3 cursor-pointer group">
              <input 
                type="checkbox" 
                checked={currentCategory.toLowerCase() === cat.toLowerCase()}
                onChange={(e) => updateFilters("category", e.target.checked ? cat.toLowerCase() : null)}
                className="form-checkbox text-primary border-outline rounded focus:ring-primary h-4 w-4 transition-all" 
              />
              <span className="group-hover:text-primary transition-colors">{cat}</span>
            </label>
          ))}
        </div>
      </div>
      
      {/* Price Filter */}
      <div className="border-b border-outline-variant/10 pb-6">
        <h3 className="font-label-caps text-label-caps text-on-surface font-bold mb-4 flex justify-between items-center cursor-pointer">
          Price <Minus className="w-4 h-4" />
        </h3>
        <div className="px-2">
          <input 
            type="range" 
            min="499" 
            max="4999" 
            step="100"
            value={price}
            onChange={(e) => setPrice(Number(e.target.value))}
            onMouseUp={(e) => handlePriceChangeEnd(Number(e.currentTarget.value))}
            onTouchEnd={(e) => handlePriceChangeEnd(Number(e.currentTarget.value))}
            className="w-full h-1 bg-surface-container-highest rounded-lg appearance-none cursor-pointer accent-primary mb-4" 
          />
          <div className="flex justify-between font-mono text-[12px] text-on-surface-variant">
            <span>₹499</span>
            <span className="font-bold text-on-surface border-b border-primary">₹{price}</span>
            <span>₹4999</span>
          </div>
        </div>
      </div>
      
      {/* Size Filter */}
      <div className="border-b border-outline-variant/10 pb-6">
        <h3 className="font-label-caps text-label-caps text-on-surface font-bold mb-4 flex justify-between items-center cursor-pointer">
          Size <Minus className="w-4 h-4" />
        </h3>
        <div className="grid grid-cols-3 gap-2">
          {['S', 'M', 'L', 'XL', 'XXL', '3XL'].map(size => {
            const isSelected = searchParams.get("size") === size;
            return (
              <button 
                key={size}
                onClick={() => updateFilters("size", isSelected ? null : size)}
                className={`border rounded py-2 font-label-caps text-label-caps transition-colors shadow-sm ${
                  isSelected 
                    ? "border-primary bg-primary-container text-on-primary-container font-bold" 
                    : "border-outline-variant/50 text-on-surface hover:border-primary bg-surface-container-lowest"
                }`}
              >
                {size}
              </button>
            )
          })}
        </div>
      </div>
    </aside>
  );
}

export function ShopToolbar({ totalResults, currentSort }: { totalResults: number, currentSort: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleSortChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const params = new URLSearchParams(searchParams.toString());
    if (e.target.value) {
      params.set("sort", e.target.value);
    } else {
      params.delete("sort");
    }
    router.push(`/shop?${params.toString()}`);
  };

  return (
    <div className="hidden md:flex justify-between items-center mb-6 bg-surface-container-lowest p-4 rounded-lg border border-outline-variant/10 shadow-sm">
      <p className="font-body-sm text-body-sm text-on-surface-variant">Showing <span className="font-bold text-on-surface">{Math.min(12, totalResults)}</span> of {totalResults} results</p>
      <div className="flex items-center gap-4">
        <span className="font-label-caps text-label-caps text-on-surface-variant">Sort By:</span>
        <div className="relative">
          <select 
            value={currentSort} 
            onChange={handleSortChange}
            className="appearance-none bg-transparent border-none text-on-surface font-body-sm text-body-sm font-bold pr-6 focus:ring-0 cursor-pointer"
          >
            <option value="">Featured</option>
            <option value="-createdAt">Newest Arrivals</option>
            <option value="basePrice">Price: Low to High</option>
            <option value="-basePrice">Price: High to Low</option>
            <option value="-averageRating">Best Rating</option>
          </select>
        </div>
        <div className="flex gap-2 ml-4 border-l border-outline-variant/20 pl-4 text-on-surface-variant">
          <button className="text-primary transition-colors"><Grid className="w-5 h-5" /></button>
          <button className="hover:text-primary transition-colors"><List className="w-5 h-5" /></button>
        </div>
      </div>
    </div>
  );
}

export function MobileFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isOpen, setIsOpen] = useState(false);
  
  // Local state for all filters while sheet is open (so we don't apply immediately)
  const [localCategory, setLocalCategory] = useState(searchParams.get("category") || "");
  const [localSize, setLocalSize] = useState(searchParams.get("size") || "");
  const [localPrice, setLocalPrice] = useState(Number(searchParams.get("maxPrice") || "4999"));

  // Reset local state when opened
  useEffect(() => {
    if (isOpen) {
      setLocalCategory(searchParams.get("category") || "");
      setLocalSize(searchParams.get("size") || "");
      setLocalPrice(Number(searchParams.get("maxPrice") || "4999"));
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const applyFilters = () => {
    const params = new URLSearchParams(searchParams.toString());
    
    if (localCategory) params.set("category", localCategory);
    else params.delete("category");
    
    if (localSize) params.set("size", localSize);
    else params.delete("size");
    
    if (localPrice !== 4999) params.set("maxPrice", localPrice.toString());
    else params.delete("maxPrice");

    params.delete("page");
    router.push(`/shop?${params.toString()}`);
    setIsOpen(false);
  };

  const clearFilters = () => {
    setLocalCategory("");
    setLocalSize("");
    setLocalPrice(4999);
  };

  return (
    <>
      <button 
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-2 font-label-caps text-label-caps font-bold text-on-surface bg-surface-container-lowest px-4 py-2 rounded border border-outline-variant/20 shadow-sm"
      >
        <SlidersHorizontal className="w-4 h-4" /> Filters
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/50 backdrop-blur-sm md:hidden">
          <div className="bg-surface-container-lowest w-full max-h-[85vh] rounded-t-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-300">
            
            {/* Header */}
            <div className="flex justify-between items-center p-4 border-b border-outline-variant/20 bg-surface-container-lowest z-10">
              <h2 className="font-headline-sm text-on-surface">Filters</h2>
              <button onClick={() => setIsOpen(false)} className="p-2 text-on-surface hover:bg-surface-container rounded-full transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable Content */}
            <div className="flex-grow overflow-y-auto p-4 space-y-6 pb-24">
              
              {/* Category */}
              <div>
                <h3 className="font-label-caps text-on-surface font-bold mb-3">Category</h3>
                <div className="flex flex-wrap gap-2">
                  {['Men', 'Women', 'Unisex'].map(cat => {
                    const isSelected = localCategory.toLowerCase() === cat.toLowerCase();
                    return (
                      <button
                        key={cat}
                        onClick={() => setLocalCategory(isSelected ? "" : cat.toLowerCase())}
                        className={`px-4 py-2 rounded-full border font-label-caps transition-colors ${
                          isSelected 
                            ? "bg-primary text-on-primary border-primary font-bold" 
                            : "bg-surface-container border-outline-variant/50 text-on-surface"
                        }`}
                      >
                        {cat}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Price */}
              <div>
                <h3 className="font-label-caps text-on-surface font-bold mb-3">Price (Up to ₹{localPrice})</h3>
                <div className="px-2">
                  <input 
                    type="range" 
                    min="499" 
                    max="4999" 
                    step="100"
                    value={localPrice}
                    onChange={(e) => setLocalPrice(Number(e.target.value))}
                    className="w-full h-1 bg-surface-container-highest rounded-lg appearance-none cursor-pointer accent-primary mb-2" 
                  />
                  <div className="flex justify-between font-mono text-[12px] text-on-surface-variant">
                    <span>₹499</span>
                    <span>₹4999</span>
                  </div>
                </div>
              </div>

              {/* Size */}
              <div>
                <h3 className="font-label-caps text-on-surface font-bold mb-3">Size</h3>
                <div className="grid grid-cols-4 gap-2">
                  {['S', 'M', 'L', 'XL', 'XXL', '3XL'].map(size => {
                    const isSelected = localSize === size;
                    return (
                      <button 
                        key={size}
                        onClick={() => setLocalSize(isSelected ? "" : size)}
                        className={`border rounded py-2 font-label-caps text-label-caps transition-colors ${
                          isSelected 
                            ? "border-primary bg-primary-container text-on-primary-container font-bold" 
                            : "border-outline-variant/50 text-on-surface"
                        }`}
                      >
                        {size}
                      </button>
                    )
                  })}
                </div>
              </div>

            </div>

            {/* Footer */}
            <div className="absolute bottom-0 left-0 w-full p-4 bg-surface-container-lowest border-t border-outline-variant/20 flex gap-4">
              <button 
                onClick={clearFilters}
                className="flex-1 py-3 border border-outline-variant/50 text-on-surface font-label-caps font-bold rounded"
              >
                CLEAR
              </button>
              <button 
                onClick={applyFilters}
                className="flex-1 py-3 bg-primary text-on-primary font-label-caps font-bold rounded shadow-md"
              >
                APPLY
              </button>
            </div>
            
          </div>
        </div>
      )}
    </>
  );
}
