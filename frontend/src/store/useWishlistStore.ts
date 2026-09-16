import { create } from "zustand";
import { api } from "@/lib/api";

interface WishlistProduct {
  _id: string;
  name: string;
  slug: string;
  basePrice: number;
  mrp?: number;
  discount?: number;
  images: string[];
  isNewArrival: boolean;
  isBestSeller: boolean;
  status: string;
}

interface WishlistItem {
  productId: WishlistProduct;
  /** The specific variant (color/size) the user wishlisted. null = product-level. */
  variantId?: string | null;
  addedAt: string;
}

interface WishlistState {
  items: WishlistItem[];
  isLoading: boolean;
  error: string | null;

  fetchWishlist: () => Promise<void>;
  /**
   * Toggle wishlist for a specific product+variant combination.
   * @param productId  The product's _id.
   * @param variantId  The currently selected variant's _id or SKU. Pass null for product-level.
   */
  toggleWishlist: (productId: string, variantId?: string | null) => Promise<void>;
  removeItem: (productId: string, variantId?: string | null) => Promise<void>;
  clearWishlist: () => Promise<void>;
  /**
   * Returns true if this exact product+variant combination is in the wishlist.
   * @param productId  The product's _id.
   * @param variantId  The variant to check. Pass null/undefined to check product-level.
   */
  isInWishlist: (productId: string, variantId?: string | null) => boolean;
}

/** Build the URL query string for variant-aware requests. */
function variantQuery(variantId?: string | null): string {
  return variantId ? `?variantId=${encodeURIComponent(variantId)}` : "";
}

export const useWishlistStore = create<WishlistState>((set, get) => ({
  items: [],
  isLoading: false,
  error: null,

  fetchWishlist: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.get("/wishlist");
      set({ items: res.data.data.items });
    } catch (error: unknown) {
      const e = error as any;
      if (e.response?.status !== 401) {
        set({ error: e.response?.data?.message || "Failed to load wishlist" });
      }
    } finally {
      set({ isLoading: false });
    }
  },

  toggleWishlist: async (productId, variantId = null) => {
    const { items, isInWishlist } = get();
    const currentlyInWishlist = isInWishlist(productId, variantId);

    // Optimistic update
    const previousItems = items;
    let nextItems: WishlistItem[];
    if (currentlyInWishlist) {
      nextItems = items.filter((item) => {
        const id = typeof item.productId === "object" ? item.productId._id : item.productId;
        if (id?.toString() !== productId?.toString()) return true;
        // Keep entries for other variants of the same product
        if (variantId) return item.variantId !== variantId;
        return !!item.variantId; // keep variant-specific items; remove product-level
      });
    } else {
      nextItems = [
        ...items,
        {
          productId: { _id: productId } as any,
          variantId: variantId ?? null,
          addedAt: new Date().toISOString(),
        },
      ];
    }

    set({ items: nextItems, isLoading: true, error: null });

    const qs = variantQuery(variantId);
    try {
      if (currentlyInWishlist) {
        const res = await api.delete(`/wishlist/items/${productId}${qs}`);
        set({ items: res.data.data.items });
      } else {
        const res = await api.post(`/wishlist/items/${productId}${qs}`);
        set({ items: res.data.data.items });
      }
    } catch (error: unknown) {
      set({ items: previousItems });
      const e = error as any;
      set({ error: e.response?.data?.message || "Failed to update wishlist" });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  removeItem: async (productId, variantId = null) => {
    set({ isLoading: true, error: null });
    const qs = variantQuery(variantId);
    try {
      const res = await api.delete(`/wishlist/items/${productId}${qs}`);
      set({ items: res.data.data.items });
    } catch (error: unknown) {
      const e = error as any;
      set({ error: e.response?.data?.message || "Failed to remove item" });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  clearWishlist: async () => {
    set({ isLoading: true, error: null });
    try {
      await api.delete("/wishlist");
      set({ items: [] });
    } catch (error: unknown) {
      const e = error as any;
      set({ error: e.response?.data?.message || "Failed to clear wishlist" });
    } finally {
      set({ isLoading: false });
    }
  },

  isInWishlist: (productId, variantId = undefined) => {
    if (!productId) return false;
    return get().items.some((item) => {
      if (!item.productId) return false;
      const id = typeof item.productId === "object" ? item.productId._id : item.productId;
      if (id?.toString() !== productId?.toString()) return false;
      
      if (variantId === undefined) return true;
      
      if (variantId) return item.variantId === variantId;
      return !item.variantId;
    });
  },
}));
