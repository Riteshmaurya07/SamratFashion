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

    const previousItems = items;
    let nextItems: WishlistItem[];
    if (currentlyInWishlist) {
      nextItems = items.filter((item) => {
        const id = typeof item.productId === "object" ? item.productId._id : item.productId;
        return id?.toString() !== productId?.toString();
      });
    } else {
      nextItems = [
        ...items,
        {
          productId: { _id: productId } as any,
          addedAt: new Date().toISOString(),
        },
      ];
    }

    set({ items: nextItems, isLoading: true, error: null });

    try {
      if (currentlyInWishlist) {
        const res = await api.delete(`/wishlist/items/${productId}`);
        set({ items: res.data.data.items });
      } else {
        const res = await api.post(`/wishlist/items/${productId}`);
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
    if (!productId) return false;
    return get().items.some((item) => {
      if (!item.productId) return false;
      const id = typeof item.productId === "object" ? item.productId._id : item.productId;
      return id?.toString() === productId?.toString();
    });
  },
}));
