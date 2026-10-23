"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/useAuthStore";
import { useWishlistStore } from "@/store/useWishlistStore";
import { api } from "@/lib/api";

export default function AccountHubClient() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading, logout } = useAuthStore();
  const wishlistItems = useWishlistStore((state) => state.items);

  const [ordersCount, setOrdersCount] = useState<number>(0);
  const [reviewsCount, setReviewsCount] = useState<number>(0);
  const [bulkCount, setBulkCount] = useState<number>(0);
  const [isDataLoading, setIsDataLoading] = useState(true);

  // Authentication Guard
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push("/login?redirect=/account");
    }
  }, [authLoading, isAuthenticated, router]);

  // Fetch Account Summary Data
  useEffect(() => {
    async function fetchAccountData() {
      if (!isAuthenticated) return;
      setIsDataLoading(true);
      try {
        const [ordersRes, reviewsRes, bulkRes] = await Promise.allSettled([
          api.get("/orders"),
          api.get("/reviews/my-reviews"),
          api.get("/bulk-orders"),
        ]);

        if (ordersRes.status === "fulfilled" && ordersRes.value.data?.success) {
          const ords = ordersRes.value.data.data;
          setOrdersCount(Array.isArray(ords) ? ords.length : 0);
        }
        if (reviewsRes.status === "fulfilled" && reviewsRes.value.data?.success) {
          const rvs = reviewsRes.value.data.data;
          setReviewsCount(Array.isArray(rvs) ? rvs.length : 0);
        }

        if (bulkRes.status === "fulfilled" && bulkRes.value.data?.success) {
          const reqs = bulkRes.value.data.data?.requests;
          const qts = bulkRes.value.data.data?.quotes;
          const totalBulk = (Array.isArray(reqs) ? reqs.length : 0) + (Array.isArray(qts) ? qts.length : 0);
          setBulkCount(totalBulk);
        }
      } catch (err) {
        console.error("Failed to load account summary stats", err);
      } finally {
        setIsDataLoading(false);
      }
    }
    fetchAccountData();
  }, [isAuthenticated]);

  if (authLoading || (!isAuthenticated && !authLoading)) {
    return (
      <div className="flex-1 p-10 bg-background text-on-background min-h-screen flex items-center justify-center">
        <div className="text-center font-bold text-on-surface-variant">Loading customer account...</div>
      </div>
    );
  }

  const initials = user?.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "CU";

  return (
    <div className="flex-1 bg-background text-on-background min-h-screen p-4 sm:p-6 md:p-12 font-body-md pb-28 lg:pb-24">
      <div className="max-w-container-max mx-auto space-y-8">
        {/* Header Profile Summary Card (Stitch Match) */}
        <div className="bg-surface-container-lowest border border-outline-variant/20 rounded-2xl p-6 md:p-8 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div className="flex items-center gap-5">
            <div className="w-16 h-16 rounded-full bg-primary text-on-primary font-display-lg text-2xl font-bold flex items-center justify-center shadow-md flex-shrink-0">
              {initials}
            </div>
            <div>
              <h1 className="font-headline-lg text-2xl md:text-3xl font-extrabold text-on-surface">
                Welcome back, {user?.name || "Customer"}!
              </h1>
              <p className="text-xs text-on-surface-variant font-label-caps mt-1 flex items-center gap-2">
                <span>{user?.email}</span>
                {user?.emailVerified && (
                  <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase">
                    Verified Account
                  </span>
                )}
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              logout();
              router.push("/login");
            }}
            className="px-5 py-2.5 border border-outline-variant text-error font-label-caps text-xs font-bold rounded-xl hover:bg-error-container/10 transition-colors flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-base">logout</span>
            Sign Out
          </button>
        </div>

        {/* Quick Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 sm:gap-4">
          <Link href="/account/orders" className="bg-surface-container-lowest p-4 sm:p-5 rounded-2xl border border-outline-variant/20 shadow-sm hover:border-primary/50 transition-colors group">
            <p className="text-xs font-label-caps text-on-surface-variant uppercase font-bold mb-1">Orders</p>
            <p className="text-2xl font-extrabold text-on-surface group-hover:text-primary transition-colors">
              {isDataLoading ? "..." : ordersCount}
            </p>
          </Link>

          <Link href="/offers" className="bg-surface-container-lowest p-4 sm:p-5 rounded-2xl border border-outline-variant/20 shadow-sm hover:border-primary/50 transition-colors group">
            <p className="text-xs font-label-caps text-on-surface-variant uppercase font-bold mb-1">Store Offers</p>
            <p className="text-2xl font-extrabold text-on-surface group-hover:text-primary transition-colors flex items-center gap-1">
              <span className="material-symbols-outlined text-primary text-2xl">local_offer</span>
              <span className="text-xs font-mono font-bold bg-primary/10 text-primary px-2 py-0.5 rounded-full">ACTIVE</span>
            </p>
          </Link>
          <Link href="/account/bulk-orders" className="bg-surface-container-lowest p-4 sm:p-5 rounded-2xl border border-outline-variant/20 shadow-sm hover:border-primary/50 transition-colors group">
            <p className="text-xs font-label-caps text-on-surface-variant uppercase font-bold mb-1">Bulk Quotes</p>
            <p className="text-2xl font-extrabold text-on-surface group-hover:text-primary transition-colors">
              {isDataLoading ? "..." : bulkCount}
            </p>
          </Link>


          <Link href="/account/wishlist" className="bg-surface-container-lowest p-4 sm:p-5 rounded-2xl border border-outline-variant/20 shadow-sm hover:border-primary/50 transition-colors group">
            <p className="text-xs font-label-caps text-on-surface-variant uppercase font-bold mb-1">Wishlist Items</p>
            <p className="text-2xl font-extrabold text-on-surface group-hover:text-primary transition-colors">
              {wishlistItems.length}
            </p>
          </Link>

          <Link href="/account/reviews" className="col-span-2 md:col-span-1 bg-surface-container-lowest p-4 sm:p-5 rounded-2xl border border-outline-variant/20 shadow-sm hover:border-primary/50 transition-colors group">
            <p className="text-xs font-label-caps text-on-surface-variant uppercase font-bold mb-1">My Reviews</p>
            <p className="text-2xl font-extrabold text-on-surface group-hover:text-primary transition-colors">
              {isDataLoading ? "..." : reviewsCount}
            </p>
          </Link>
        </div>

        {/* Account Dashboard Navigation Cards */}
        <div>
          <h2 className="font-headline-sm text-xl font-bold text-on-surface mb-6">Account Services</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* My Orders */}
            <Link
              href="/account/orders"
              className="bg-surface-container-lowest border border-outline-variant/20 rounded-2xl p-6 shadow-sm hover:shadow-md hover:border-primary/40 transition-all flex items-start gap-4 group"
            >
              <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center flex-shrink-0 group-hover:bg-primary group-hover:text-on-primary transition-colors">
                <span className="material-symbols-outlined text-2xl">package_2</span>
              </div>
              <div>
                <h3 className="font-bold text-base text-on-surface group-hover:text-primary transition-colors">My Orders</h3>
                <p className="text-xs text-on-surface-variant mt-1">Track active shipments, view invoice receipts, and request returns.</p>
              </div>
            </Link>

            {/* Special Offers & Coupons */}
            <Link
              href="/offers"
              className="bg-surface-container-lowest border border-outline-variant/20 rounded-2xl p-6 shadow-sm hover:shadow-md hover:border-primary/40 transition-all flex items-start gap-4 group"
            >
              <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center flex-shrink-0 group-hover:bg-primary group-hover:text-on-primary transition-colors">
                <span className="material-symbols-outlined text-2xl">local_offer</span>
              </div>
              <div>
                <h3 className="font-bold text-base text-on-surface group-hover:text-primary transition-colors">Offers &amp; Discounts</h3>
                <p className="text-xs text-on-surface-variant mt-1">Discover active discount campaigns, promotional vouchers, and member savings.</p>
              </div>
            </Link>
            {/* Bulk Orders & Quotes */}
            <Link
              href="/account/bulk-orders"
              className="bg-surface-container-lowest border border-outline-variant/20 rounded-2xl p-6 shadow-sm hover:shadow-md hover:border-primary/40 transition-all flex items-start gap-4 group"
            >
              <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center flex-shrink-0 group-hover:bg-primary group-hover:text-on-primary transition-colors">
                <span className="material-symbols-outlined text-2xl">receipt_long</span>
              </div>
              <div>
                <h3 className="font-bold text-base text-on-surface group-hover:text-primary transition-colors">Bulk Orders & Quotes</h3>
                <p className="text-xs text-on-surface-variant mt-1">Track corporate production inquiries, review issued quotations, and approve orders.</p>
              </div>
            </Link>


            {/* Address Book */}
            <Link
              href="/account/addresses"
              className="bg-surface-container-lowest border border-outline-variant/20 rounded-2xl p-6 shadow-sm hover:shadow-md hover:border-primary/40 transition-all flex items-start gap-4 group"
            >
              <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center flex-shrink-0 group-hover:bg-primary group-hover:text-on-primary transition-colors">
                <span className="material-symbols-outlined text-2xl">location_on</span>
              </div>
              <div>
                <h3 className="font-bold text-base text-on-surface group-hover:text-primary transition-colors">Address Book</h3>
                <p className="text-xs text-on-surface-variant mt-1">Manage saved shipping addresses for faster 1-click checkout.</p>
              </div>
            </Link>

            {/* My Reviews */}
            <Link
              href="/account/reviews"
              className="bg-surface-container-lowest border border-outline-variant/20 rounded-2xl p-6 shadow-sm hover:shadow-md hover:border-primary/40 transition-all flex items-start gap-4 group"
            >
              <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center flex-shrink-0 group-hover:bg-primary group-hover:text-on-primary transition-colors">
                <span className="material-symbols-outlined text-2xl">rate_review</span>
              </div>
              <div>
                <h3 className="font-bold text-base text-on-surface group-hover:text-primary transition-colors">My Reviews</h3>
                <p className="text-xs text-on-surface-variant mt-1">Write product reviews for delivered purchases and upload photo showcases.</p>
              </div>
            </Link>

            {/* Wishlist */}
            <Link
              href="/account/wishlist"
              className="bg-surface-container-lowest border border-outline-variant/20 rounded-2xl p-6 shadow-sm hover:shadow-md hover:border-primary/40 transition-all flex items-start gap-4 group"
            >
              <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center flex-shrink-0 group-hover:bg-primary group-hover:text-on-primary transition-colors">
                <span className="material-symbols-outlined text-2xl">favorite</span>
              </div>
              <div>
                <h3 className="font-bold text-base text-on-surface group-hover:text-primary transition-colors">Saved Wishlist</h3>
                <p className="text-xs text-on-surface-variant mt-1">View saved favorite graphic tees and move items to cart.</p>
              </div>
            </Link>

            {/* Support Center */}
            <Link
              href="/support"
              className="bg-surface-container-lowest border border-outline-variant/20 rounded-2xl p-6 shadow-sm hover:shadow-md hover:border-primary/40 transition-all flex items-start gap-4 group"
            >
              <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center flex-shrink-0 group-hover:bg-primary group-hover:text-on-primary transition-colors">
                <span className="material-symbols-outlined text-2xl">help_center</span>
              </div>
              <div>
                <h3 className="font-bold text-base text-on-surface group-hover:text-primary transition-colors">Customer Support</h3>
                <p className="text-xs text-on-surface-variant mt-1">Submit support tickets, view inquiry status, and get help from customer care.</p>
              </div>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
