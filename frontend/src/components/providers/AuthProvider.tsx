"use client";

import { useEffect } from "react";
import { useAuthStore } from "@/store/useAuthStore";
import { api } from "@/lib/api";
import { useCartStore } from "@/store/useCartStore";
import { useWishlistStore } from "@/store/useWishlistStore";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { setUser, setLoading, logout } = useAuthStore();

  useEffect(() => {
    const initAuth = async () => {
      const hasToken = typeof window !== "undefined" && !!localStorage.getItem("accessToken");
      
      if (!hasToken) {
        setUser(null);
        setLoading(false);
        return;
      }

      try {
        const { data } = await api.get("/auth/me");
        setUser(data.data.user);
        // Fetch cart and wishlist in background asynchronously
        Promise.all([
          useCartStore.getState().fetchCart().catch(() => {}),
          useWishlistStore.getState().fetchWishlist().catch(() => {}),
        ]);
      } catch (_error) {
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    initAuth();

    const handleAuthExpired = () => {
      logout();
      const isAdminRoute = window.location.pathname.startsWith("/admin");
      const loginTarget = isAdminRoute ? "/admin/login?expired=true" : "/login?expired=true";
      window.location.href = loginTarget;
    };

    window.addEventListener("auth-expired", handleAuthExpired);
    return () => window.removeEventListener("auth-expired", handleAuthExpired);
  }, [setUser, setLoading, logout]);

  return <>{children}</>;
}
