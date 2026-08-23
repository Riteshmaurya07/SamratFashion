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
  addedAt: string;
}

interface WishlistState {
  items: WishlistItem[];
  isLoading: boolean;
  error: string | null;
  
  fetchWishlist: () => Promise<void>;
  toggleWishlist: (productId: string) => Promise<void>;
  removeItem: (productId: string) => Promise<void>;
  clearWishlist: () => Promise<void>;
  isInWishlist: (productId: string) => boolean;
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

  toggleWishlist: async (productId) => {
    const { items, isInWishlist } = get();
    const currentlyInWishlist = isInWishlist(productId);

    // Optimistic UI update could go here, but for simplicity we'll just await the API
    // since we need the full product details from the response if adding.
    set({ isLoading: true, error: null });
    
    try {
      if (currentlyInWishlist) {
        const res = await api.delete(`/wishlist/items/${productId}`);
        set({ items: res.data.data.items });
      } else {
        const res = await api.post(`/wishlist/items/${productId}`);
        set({ items: res.data.data.items });
      }
    } catch (error: unknown) {
      const e = error as any;
      set({ error: e.response?.data?.message || "Failed to update wishlist" });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  removeItem: async (productId) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.delete(`/wishlist/items/${productId}`);
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

  isInWishlist: (productId) => {
    return get().items.some(item => item.productId && item.productId._id === productId);
  },
}));
