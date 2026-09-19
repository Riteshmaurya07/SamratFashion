import { create } from "zustand";
import { api } from "@/lib/api";
import { useCartStore } from "@/store/useCartStore";
import { useWishlistStore } from "@/store/useWishlistStore";

export interface User {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: string;
  status: string;
  avatar?: string;
  emailVerified: boolean;
  phoneVerified: boolean;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  setUser: (user: User | null) => void;
  setLoading: (isLoading: boolean) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true, // starts loading until initialization completes
  setUser: (user) => set({ user, isAuthenticated: !!user }),
  setLoading: (isLoading) => set({ isLoading }),
  logout: () => {
    if (typeof window !== "undefined") {
      // Best-effort server-side session revocation; still clear local state if it fails.
      api.post("/auth/logout").catch(() => {});
      localStorage.removeItem("accessToken");
      api.defaults.headers.common.Authorization = undefined;
      window.dispatchEvent(new Event("auth-logged-out"));
    }
    // Wipe any per-user local data so it never leaks to the next account on this device.
    useCartStore.setState({
      items: [],
      coupon: null,
      summary: { subtotal: 0, discount: 0, shipping: 0, tax: 0, total: 0 },
      error: null,
    });
    useWishlistStore.setState({ items: [], error: null });
    set({ user: null, isAuthenticated: false });
  },
}));
