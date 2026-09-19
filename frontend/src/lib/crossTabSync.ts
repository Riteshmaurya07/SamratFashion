"use client";

import { useCartStore } from "@/store/useCartStore";
import { useWishlistStore } from "@/store/useWishlistStore";
import { subscribeToSync, publish } from "@/lib/crossTabChannel";

const EMPTY_SUMMARY = { subtotal: 0, discount: 0, shipping: 0, tax: 0, total: 0 };

let initialized = false;

/**
 * Start live cross-tab sync. Call once per tab (idempotent).
 *
 * Loop safety: a tab only PUBLISHES after a user-initiated local mutation (see the
 * stores); when it RECEIVES a message it silently re-fetches from the server — the
 * single source of truth — and never republishes, so there is no feedback loop.
 */
export function initCrossTabSync(): void {
  if (initialized) return;
  initialized = true;

  subscribeToSync((message) => {
    switch (message?.type) {
      case "cart-changed":
        void useCartStore.getState().fetchCart();
        break;
      case "wishlist-changed":
        void useWishlistStore.getState().fetchWishlist();
        break;
      case "auth-logged-out":
        // Wipe per-user local state in this tab (the originating tab clears the
        // server session; sibling tabs only need their local state cleared).
        useCartStore.setState({ items: [], coupon: null, summary: EMPTY_SUMMARY, error: null });
        useWishlistStore.setState({ items: [], error: null });
        break;
    }
  });

  if (typeof window !== "undefined") {
    // Propagate a local logout to sibling tabs.
    window.addEventListener("auth-logged-out", () => publish({ type: "auth-logged-out" }));
  }
}