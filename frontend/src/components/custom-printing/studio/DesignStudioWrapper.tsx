"use client";

import React, { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { DesignStudio } from "./DesignStudio";
import { useCustomDesignStore } from "@/store/useCustomDesignStore";
import { api } from "@/lib/api";
import { Loader2 } from "lucide-react";

export function DesignStudioWrapper({ initialProducts }: { initialProducts: any[] }) {
  const searchParams = useSearchParams();
  const targetDesignId = searchParams.get("designId");
  const { loadDesign, productId, variantId, configurations, setBaseProduct } = useCustomDesignStore();
  const color = configurations[0]?.color || "Black";
  
  const [isInitializing, setIsInitializing] = useState(true);

  useEffect(() => {
    async function initializeStudio() {
      try {
        if (targetDesignId) {
          const res = await api.get(`/designs/${targetDesignId}`);
          if (res.data?.success && res.data.data) {
            const designData = res.data.data;
            loadDesign(designData); // Loads all state, including product, variant, colors, elements
            setIsInitializing(false);
            return;
          }
        }
        
        let products = initialProducts;

        // If no products passed from SSR or initialProducts was empty, fetch client side
        if ((!products || products.length === 0) && !productId) {
          try {
            const resCustom = await api.get("/catalog/customizable-products");
            if (resCustom.data?.success && Array.isArray(resCustom.data.data) && resCustom.data.data.length > 0) {
              products = resCustom.data.data;
            } else {
              const resAll = await api.get("/catalog/products?limit=10");
              if (resAll.data?.success) {
                products = resAll.data.data?.items || resAll.data.data?.products || (Array.isArray(resAll.data.data) ? resAll.data.data : []);
              }
            }
          } catch (e) {
            console.error("Client side product fetch error in Studio:", e);
          }
        }

        // Initialize with the first available product
        if (!productId && products && products.length > 0) {
          const p = products[0];
          const v = p.variants?.find((varItem: any) => varItem.isAvailable && varItem.stock > 0) || p.variants?.[0];
          if (v) {
            setBaseProduct(p._id, v._id, v.color || "Black", v.size || "L");
          }
        }
      } catch (err) {
        console.error("Failed to initialize design studio:", err);
      } finally {
        setIsInitializing(false);
      }
    }
    
    initializeStudio();
  }, [targetDesignId, initialProducts, loadDesign, productId, setBaseProduct]);

  if (isInitializing) {
    return (
      <div className="flex items-center justify-center min-h-[800px] w-full bg-white border border-gray-200 rounded-2xl">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-black" />
          <p className="text-sm font-medium text-gray-500">Loading Studio...</p>
        </div>
      </div>
    );
  }

  // Fallback if somehow product details couldn't be loaded
  if (!productId || !variantId) {
    return (
      <div className="flex items-center justify-center min-h-[800px] w-full bg-white border border-gray-200 rounded-2xl">
        <p className="text-sm font-medium text-red-500">Failed to load product configuration.</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[1600px] mx-auto p-4 md:p-6 lg:p-8">
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight">Custom Studio</h1>
          <p className="text-gray-500 mt-1">Design your premium apparel.</p>
        </div>
      </div>
      <DesignStudio productId={productId} variantId={variantId} initialColor={color} />
    </div>
  );
}
