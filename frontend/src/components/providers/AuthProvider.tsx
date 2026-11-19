"use client";

import { useEffect } from "react";
import { useAuthStore } from "@/store/useAuthStore";
import { api } from "@/lib/api";
import { useCartStore } from "@/store/useCartStore";
import { useWishlistStore } from "@/store/useWishlistStore";
import { initCrossTabSync } from "@/lib/crossTabSync";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { setUser, setLoading, logout } = useAuthStore();

  useEffect(() => {
    // Live cart/wishlist sync across tabs (idempotent per tab).
    initCrossTabSync();
    const initAuth = async () => {
      try {
        const { data } = await api.get("/auth/me", {
          timeout: 20000,
          headers: { "x-skip-auth-expired": "true" },
        });
        setUser(data.data.user);
        // Fetch cart and wishlist in background asynchronously
        Promise.all([
          useCartStore.getState().fetchCart().catch(() => {}),
          useWishlistStore.getState().fetchWishlist().catch(() => {}),
        ]);
      } catch (error: any) {
        const status = error?.response?.status;
        if (status === 401 || status === 403) {
          setUser(null);
        } else {
          // Transient error (e.g. cold-start timeout): retry once before giving up
          try {
            const { data } = await api.get("/auth/me", {
              timeout: 25000,
              headers: { "x-skip-auth-expired": "true" },
            });
            setUser(data.data.user);
            Promise.all([
              useCartStore.getState().fetchCart().catch(() => {}),
              useWishlistStore.getState().fetchWishlist().catch(() => {}),
            ]);
          } catch {
            setUser(null);
          }
        }
      } finally {
        setLoading(false);
      }
    };

    initAuth();

    const handleAuthExpired = () => {
      const wasAuthenticated = useAuthStore.getState().isAuthenticated;
      logout();

      if (typeof window === "undefined") return;

      const pathname = window.location.pathname;

      // Do not redirect if already on an authentication page (prevents infinite refresh loop)
      const isAuthPage =
        pathname === "/login" ||
        pathname.startsWith("/login") ||
        pathname === "/register" ||
        pathname.startsWith("/register") ||
        pathname === "/forgot-password" ||
        pathname === "/reset-password" ||
        pathname.startsWith("/admin/login") ||
        pathname.startsWith("/verify-email");

      if (isAuthPage) {
        return;
      }

      // Only redirect if user was actively authenticated or is on a protected route
      const isProtectedRoute =
        pathname.startsWith("/account") ||
        pathname.startsWith("/admin") ||
        pathname.startsWith("/checkout");

      if (wasAuthenticated || isProtectedRoute) {
        const isAdminRoute = pathname.startsWith("/admin");
        const loginTarget = isAdminRoute ? "/admin/login?expired=true" : "/login?expired=true";
        window.location.href = loginTarget;
      }
    };

    window.addEventListener("auth-expired", handleAuthExpired);
    return () => window.removeEventListener("auth-expired", handleAuthExpired);
  }, [setUser, setLoading, logout]);

  return <>{children}</>;
}
