import { create } from "zustand";
import { api } from "@/lib/api";
import { publish } from "@/lib/crossTabChannel";

interface WishlistVariant {
  _id?: string;
  sku?: string;
  color?: string;
  size?: string;
  images?: string[];
}

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
  variants?: WishlistVariant[];
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
  toggleWishlist: (productId: string, variantId?: string | null, selectedColor?: string | null) => Promise<void>;
  removeItem: (productId: string, variantId?: string | null) => Promise<void>;
  clearWishlist: () => Promise<void>;
  isInWishlist: (productId: string, variantId?: string | null, selectedColor?: string | null) => boolean;
}

/** Build the URL query string for variant-aware requests. */
function cleanId(id: unknown): string {
  if (typeof id === "string") {
    return id.includes("-") ? id.split("-")[0] : id;
  }
  if (id && typeof id === "object" && "_id" in id) {
    const candidate = String(id._id);
    return candidate.includes("-") ? candidate.split("-")[0] : candidate;
  }
  return String(id || "");
}

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
      const is401 = error && typeof error === "object" && "response" in error && error.response && typeof error.response === "object" && "status" in error.response && error.response.status === 401;
      if (!is401) {
        const errMessage = error && typeof error === "object" && "response" in error && error.response && typeof error.response === "object" && "data" in error.response && error.response.data && typeof error.response.data === "object" && "message" in error.response.data ? String(error.response.data.message) : "Failed to load wishlist";
        set({ error: errMessage });
      }
    } finally {
      set({ isLoading: false });
    }
  },

  toggleWishlist: async (productId, variantId = undefined, selectedColor = undefined) => {
    const targetProductId = cleanId(productId);
    const { items, isInWishlist } = get();
    const currentlyInWishlist = isInWishlist(targetProductId, variantId, selectedColor);

    // Find the specific item to remove if currently in wishlist
    const matchingItem = currentlyInWishlist
      ? items.find((item) => {
          if (!item.productId) return false;
          const itemProdId = cleanId(item.productId);
          if (itemProdId !== targetProductId) return false;

          if (variantId && item.variantId === variantId) return true;

          if (selectedColor && typeof item.productId === "object" && Array.isArray(item.productId.variants)) {
            if (item.variantId) {
              const mv = item.productId.variants.find(
                (v) => v._id?.toString() === item.variantId || v.sku === item.variantId
              );
              if (mv?.color && mv.color.trim().toLowerCase() === selectedColor.trim().toLowerCase()) {
                return true;
              }
            }
          }

          if (!variantId && !selectedColor) return true;
          return !item.variantId;
        })
      : null;

    const actualVariantIdToRemove = matchingItem?.variantId ?? variantId ?? null;

    // Optimistic update
    const previousItems = items;
    let nextItems: WishlistItem[];
    if (currentlyInWishlist) {
      nextItems = items.filter((item) => {
        const itemProdId = cleanId(item.productId);
        if (itemProdId !== targetProductId) return true;
        if (actualVariantIdToRemove) return item.variantId !== actualVariantIdToRemove;
        return false;
      });
    } else {
      nextItems = [
        ...items,
        {
          productId: { _id: targetProductId } as unknown as WishlistProduct,
          variantId: variantId ?? null,
          addedAt: new Date().toISOString(),
        },
      ];
    }

    set({ items: nextItems, isLoading: true, error: null });

    const qs = variantQuery(currentlyInWishlist ? actualVariantIdToRemove : (variantId ?? null));
    try {
      if (currentlyInWishlist) {
        const res = await api.delete(`/wishlist/items/${targetProductId}${qs}`);
        set({ items: res.data.data.items });
      } else {
        const res = await api.post(`/wishlist/items/${targetProductId}${qs}`);
        set({ items: res.data.data.items });
      }
      publish({ type: "wishlist-changed" });
    } catch (error: unknown) {
      set({ items: previousItems });
      const errMessage = error && typeof error === "object" && "response" in error && error.response && typeof error.response === "object" && "data" in error.response && error.response.data && typeof error.response.data === "object" && "message" in error.response.data ? String(error.response.data.message) : "Failed to update wishlist";
      set({ error: errMessage });
      throw error;
    } finally {
      set({ isLoading: false });
    }
  },

  removeItem: async (productId, variantId = null) => {
    const targetProductId = cleanId(productId);
    set({ isLoading: true, error: null });
    const qs = variantQuery(variantId);
    try {
      const res = await api.delete(`/wishlist/items/${targetProductId}${qs}`);
      set({ items: res.data.data.items });
      publish({ type: "wishlist-changed" });
    } catch (error: unknown) {
      const errMessage = error && typeof error === "object" && "response" in error && error.response && typeof error.response === "object" && "data" in error.response && error.response.data && typeof error.response.data === "object" && "message" in error.response.data ? String(error.response.data.message) : "Failed to remove item";
      set({ error: errMessage });
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
      publish({ type: "wishlist-changed" });
    } catch (error: unknown) {
      const errMessage = error && typeof error === "object" && "response" in error && error.response && typeof error.response === "object" && "data" in error.response && error.response.data && typeof error.response.data === "object" && "message" in error.response.data ? String(error.response.data.message) : "Failed to clear wishlist";
      set({ error: errMessage });
    } finally {
      set({ isLoading: false });
    }
  },

  isInWishlist: (productId, variantId = undefined, selectedColor = undefined) => {
    if (!productId) return false;
    const targetProductId = cleanId(productId);
    if (!targetProductId) return false;

    return get().items.some((item) => {
      if (!item.productId) return false;
      const itemProdId = cleanId(item.productId);
      if (itemProdId !== targetProductId) return false;

      // 1. Exact variant match
      if (variantId && item.variantId) {
        if (item.variantId === variantId) return true;
      }

      // 2. Colorway match (e.g. from shop page color-expanded cards)
      if (selectedColor && typeof item.productId === "object" && Array.isArray(item.productId.variants)) {
        if (item.variantId) {
          const matchingVar = item.productId.variants.find(
            (v) => v._id?.toString() === item.variantId || v.sku === item.variantId
          );
          if (matchingVar?.color && matchingVar.color.trim().toLowerCase() === selectedColor.trim().toLowerCase()) {
            return true;
          }
        }
      }

      // 3. Product-level wishlist item matches any variant/color query
      if (!item.variantId) return true;

      // 4. If caller only provided productId (no variantId, no selectedColor), any wishlisted variant counts
      if (variantId === undefined && !selectedColor) return true;

      // 5. If specific variant was requested, only match that variant
      if (variantId) return item.variantId === variantId;

      return false;
    });
  },
}));
