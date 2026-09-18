import { create } from "zustand";
import { api } from "@/lib/api";

export interface CartItem {
  _id?: string;
  productId: {
    _id: string;
    name: string;
    slug: string;
    images: string[];
    basePrice: number;
  };
  variantId: string;
  variantDetails: {
    size: string;
    color: string;
    hexCode: string;
    sku: string;
    stock: number;
    image?: string;
  };
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  isAvailable: boolean;

  // Custom design fields
  isCustomized?: boolean;
  customConfigurations?: any[];
  customizationSnapshot?: {
    previewImage?: string;
    name?: string;
    printLocations?: string[];
    customFee?: number;
  };
  customDesignId?: string;
}

interface AppliedCoupon {
  id: string;
  code: string;
  description?: string;
  discountType: string;
  discountValue: number;
}

interface CartSummary {
  subtotal: number;
  discount: number;
  shipping: number;
  tax: number;
  total: number;
}

interface CartState {
  items: CartItem[];
  coupon: AppliedCoupon | null;
  summary: CartSummary;
  isLoading: boolean;
  error: string | null;
  
  fetchCart: () => Promise<void>;
  addItem: (productId: string, variantId: string, quantity: number, customDesignId?: string, isCustomized?: boolean, customConfigurations?: any[]) => Promise<void>;
  updateQuantity: (productId: string, variantId: string, quantity: number) => Promise<void>;
  removeItem: (productId: string, variantId: string) => Promise<void>;
  clearCart: () => Promise<void>;
  applyCoupon: (code: string) => Promise<void>;
  removeCoupon: () => Promise<void>;
}

export const useCartStore = create<CartState>((set) => ({
  items: [],
  coupon: null,
  summary: { subtotal: 0, discount: 0, shipping: 0, tax: 0, total: 0 },
  isLoading: false,
  error: null,

  fetchCart: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.get("/cart");
      set({
        items: res.data.data.items,
        coupon: res.data.data.coupon || null,
        summary: res.data.data.summary,
      });
    } catch (error: unknown) {
      const e = error as any;
      if (e.response?.status !== 401) {
        set({ error: e.response?.data?.message || "Failed to load cart" });
      }
    } finally {
      set({ isLoading: false });
    }
  },

  addItem: async (productId, variantId, quantity, customDesignId, isCustomized, customConfigurations) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.post("/cart/items", { productId, variantId, quantity, customDesignId, isCustomized, customConfigurations });
      set({
        items: res.data.data.items,
        coupon: res.data.data.coupon || null,
        summary: res.data.data.summary,
      });
    } catch (error: unknown) {
      const e = error as any;
      set({ error: e.response?.data?.message || "Failed to add item" });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  updateQuantity: async (productId, variantId, quantity) => {
    set({ isLoading: true, error: null });
    try {
      const itemId = `${productId}_${variantId}`;
      const res = await api.patch(`/cart/items/${itemId}`, { productId, variantId, quantity });
      set({
        items: res.data.data.items,
        coupon: res.data.data.coupon || null,
        summary: res.data.data.summary,
      });
    } catch (error: unknown) {
      const e = error as any;
      set({ error: e.response?.data?.message || "Failed to update quantity" });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  removeItem: async (productId, variantId) => {
    set({ isLoading: true, error: null });
    try {
      const itemId = `${productId}_${variantId}`;
      const res = await api.delete(`/cart/items/${itemId}`, { data: { productId, variantId } });
      set({
        items: res.data.data.items,
        coupon: res.data.data.coupon || null,
        summary: res.data.data.summary,
      });
    } catch (error: unknown) {
      const e = error as any;
      set({ error: e.response?.data?.message || "Failed to remove item" });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  clearCart: async () => {
    set({ isLoading: true, error: null });
    try {
      await api.delete("/cart");
      set({ items: [], coupon: null, summary: { subtotal: 0, discount: 0, shipping: 0, tax: 0, total: 0 } });
    } catch (error: unknown) {
      const e = error as any;
      set({ error: e.response?.data?.message || "Failed to clear cart" });
    } finally {
      set({ isLoading: false });
    }
  },

  applyCoupon: async (code: string) => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.post("/cart/apply-coupon", { code });
      set({
        items: res.data.data.items,
        coupon: res.data.data.coupon || null,
        summary: res.data.data.summary,
      });
    } catch (error: unknown) {
      const e = error as any;
      const msg = e.response?.data?.message || "Failed to apply coupon";
      set({ error: msg });
      throw new Error(msg);
    } finally {
      set({ isLoading: false });
    }
  },

  removeCoupon: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await api.post("/cart/remove-coupon");
      set({
        items: res.data.data.items,
        coupon: null,
        summary: res.data.data.summary,
      });
    } catch (error: unknown) {
      const e = error as any;
      set({ error: e.response?.data?.message || "Failed to remove coupon" });
    } finally {
      set({ isLoading: false });
    }
  },
}));
