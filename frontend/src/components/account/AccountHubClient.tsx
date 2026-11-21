"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/store/useAuthStore";
import { useWishlistStore } from "@/store/useWishlistStore";
import { useAddressStore } from "@/store/useAddressStore";
import { SignInRequiredState } from "@/components/auth/SignInRequiredState";
import { AccountNav } from "@/components/account/AccountNav";
import { api } from "@/lib/api";

export default function AccountHubClient() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading: authLoading, logout } = useAuthStore();
  const wishlistItems = useWishlistStore((state) => state.items);
  const { addresses, fetchAddresses } = useAddressStore();

  const [ordersCount, setOrdersCount] = useState<number>(0);
  const [reviewsCount, setReviewsCount] = useState<number>(0);
  const [isDataLoading, setIsDataLoading] = useState(true);

  // Profile Edit State
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [editError, setEditError] = useState("");
  const [editSuccess, setEditSuccess] = useState("");

  const handleOpenEditModal = () => {
    setEditName(user?.name || "");
    setEditPhone(user?.phone || "");
    setEditError("");
    setEditSuccess("");
    setIsEditModalOpen(true);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editName.trim()) {
      setEditError("Name is required");
      return;
    }

    setIsSavingProfile(true);
    setEditError("");
    setEditSuccess("");

    try {
      const res = await api.patch("/auth/profile", {
        name: editName.trim(),
        phone: editPhone.trim() || undefined,
      });

      if (res.data?.success && res.data?.data?.user) {
        useAuthStore.getState().setUser(res.data.data.user);
        setEditSuccess("Profile updated successfully!");
        setTimeout(() => {
          setIsEditModalOpen(false);
          setEditSuccess("");
        }, 600);
      }
    } catch (err: any) {
      setEditError(
        err.response?.data?.message || "Failed to update profile. Please try again."
      );
    } finally {
      setIsSavingProfile(false);
    }
  };

  // Fetch Account Summary Data
  useEffect(() => {
    async function fetchAccountData() {
      if (!isAuthenticated) return;
      setIsDataLoading(true);
      fetchAddresses();
      try {
        const [ordersRes, reviewsRes] = await Promise.allSettled([
          api.get("/orders"),
          api.get("/reviews/my-reviews"),
        ]);

        if (
          ordersRes.status === "fulfilled" &&
          (ordersRes.value.data?.success || ordersRes.value.data?.status === "success")
        ) {
          const ords = ordersRes.value.data.data;
          setOrdersCount(Array.isArray(ords) ? ords.length : 0);
        }
        if (
          reviewsRes.status === "fulfilled" &&
          (reviewsRes.value.data?.success || reviewsRes.value.data?.status === "success")
        ) {
          const rvs = reviewsRes.value.data.data;
          const count = Array.isArray(rvs)
            ? rvs.length
            : Array.isArray(rvs?.reviews)
            ? rvs.reviews.length
            : 0;
          setReviewsCount(count);
        }

      } catch (err) {
        console.error("Failed to load account summary stats", err);
      } finally {
        setIsDataLoading(false);
      }
    }
    fetchAccountData();
  }, [isAuthenticated]);

  if (authLoading) {
    return (
      <div className="flex-1 p-10 bg-background text-on-background min-h-[60vh] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <SignInRequiredState context="account" redirectPath="/account" />;
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
    <div className="w-full max-w-5xl mx-auto flex flex-col space-y-6 sm:space-y-8 pb-8 sm:pb-12 lg:pb-8">
      <AccountNav currentTab="overview" />
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
              <div className="text-xs text-on-surface-variant font-label-caps mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="flex items-center gap-1">
                  <span className="material-symbols-outlined text-[15px]">mail</span>
                  {user?.email}
                </span>

                {user?.phone ? (
                  <span className="flex items-center gap-1 font-mono font-medium text-on-surface">
                    <span className="material-symbols-outlined text-[15px]">call</span>
                    {user.phone}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={handleOpenEditModal}
                    className="text-primary hover:underline flex items-center gap-1 font-semibold cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[15px]">add_call</span>
                    + Add Mobile Number
                  </button>
                )}

                {user?.emailVerified ? (
                  <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase">
                    Verified Account
                  </span>
                ) : user?.email?.toLowerCase().endsWith(".local") ? (
                  <span className="bg-neutral-100 text-neutral-700 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase">
                    Internal Account
                  </span>
                ) : (
                  <Link
                    href={`/verify-email?email=${encodeURIComponent(user?.email || "")}`}
                    className="bg-amber-100 text-amber-800 hover:bg-amber-200 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase transition-colors"
                  >
                    Unverified — Verify Now
                  </Link>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 w-full md:w-auto">
            <button
              type="button"
              onClick={handleOpenEditModal}
              className="flex-1 md:flex-initial px-4 py-2.5 bg-neutral-900 text-white font-label-caps text-xs font-bold rounded-xl hover:bg-neutral-800 transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-xs"
            >
              <span className="material-symbols-outlined text-base">edit</span>
              Edit Profile
            </button>

            <button
              type="button"
              onClick={() => {
                logout();
                router.push("/login");
              }}
              className="flex-1 md:flex-initial px-4 py-2.5 border border-outline-variant text-error font-label-caps text-xs font-bold rounded-xl hover:bg-error-container/10 transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              <span className="material-symbols-outlined text-base">logout</span>
              Sign Out
            </button>
          </div>
        </div>

        {/* Edit Profile Modal */}
        {isEditModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
            <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-2xl w-full max-w-md p-6 sm:p-8 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
              <div className="flex justify-between items-start mb-5">
                <div>
                  <h2 className="text-xl font-headline-sm font-bold text-on-surface">Edit Profile Details</h2>
                  <p className="text-xs text-on-surface-variant mt-1">
                    Update your full name and mobile number.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="p-1.5 text-on-surface-variant hover:text-on-surface hover:bg-surface-container rounded-lg transition-colors cursor-pointer"
                  title="Close"
                >
                  <span className="material-symbols-outlined text-xl">close</span>
                </button>
              </div>

              {editError && (
                <div className="mb-4 p-3 rounded-lg bg-error-container/20 border border-error/30 text-error text-xs flex items-center gap-2">
                  <span className="material-symbols-outlined text-base shrink-0">error</span>
                  <span>{editError}</span>
                </div>
              )}

              {editSuccess && (
                <div className="mb-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
                  <span className="material-symbols-outlined text-base shrink-0">check_circle</span>
                  <span>{editSuccess}</span>
                </div>
              )}

              <form onSubmit={handleSaveProfile} className="space-y-4">
                <div>
                  <label className="block text-xs font-label-caps font-bold text-on-surface-variant uppercase mb-1.5">
                    Full Name <span className="text-error">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="e.g. Rahul Sharma"
                    className="w-full px-4 py-2.5 rounded-xl border border-outline-variant bg-surface text-on-surface font-body-sm text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  />
                </div>

                <div>
                  <label className="block text-xs font-label-caps font-bold text-on-surface-variant uppercase mb-1.5">
                    Mobile Number
                  </label>
                  <div className="relative flex items-center">
                    <span className="absolute left-3.5 text-on-surface-variant text-sm font-mono font-medium">
                      +91
                    </span>
                    <input
                      type="tel"
                      value={editPhone.replace(/^\+91/, "").trim()}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, "").slice(0, 10);
                        setEditPhone(val ? `+91${val}` : "");
                      }}
                      placeholder="9876543210"
                      maxLength={10}
                      className="w-full pl-12 pr-4 py-2.5 rounded-xl border border-outline-variant bg-surface text-on-surface font-body-sm text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                    />
                  </div>
                  <p className="text-[11px] text-on-surface-variant mt-1">
                    Used for order dispatch SMS and courier delivery updates.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-label-caps font-bold text-on-surface-variant uppercase mb-1.5">
                    Email Address
                  </label>
                  <input
                    type="email"
                    disabled
                    value={user?.email || ""}
                    className="w-full px-4 py-2.5 rounded-xl border border-outline-variant/50 bg-surface-container-low text-on-surface-variant font-body-sm text-sm cursor-not-allowed opacity-80"
                  />
                  <p className="text-[10px] text-on-surface-variant mt-1">
                    Email cannot be changed directly for security and order verification.
                  </p>
                </div>

                <div className="flex items-center justify-end gap-3 pt-3">
                  <button
                    type="button"
                    onClick={() => setIsEditModalOpen(false)}
                    disabled={isSavingProfile}
                    className="px-4 py-2 border border-outline-variant text-on-surface font-label-caps text-xs font-bold rounded-xl hover:bg-surface-container transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingProfile}
                    className="px-5 py-2 bg-primary text-on-primary font-label-caps text-xs font-bold rounded-xl hover:bg-primary-fixed-variant transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    {isSavingProfile ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Saving...
                      </>
                    ) : (
                      "Save Changes"
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Quick Stats Grid: 2 cols on mobile, 4 cols on desktop */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <Link href="/account/orders" className="bg-surface-container-lowest p-4 sm:p-5 rounded-2xl border border-outline-variant/20 shadow-sm hover:border-neutral-900 transition-colors group">
            <p className="text-xs font-label-caps text-on-surface-variant uppercase font-bold mb-1">Orders</p>
            <div className="text-2xl font-extrabold text-on-surface group-hover:text-neutral-900 transition-colors">
              {isDataLoading ? (
                <span className="inline-block h-7 w-10 rounded bg-surface-container-high animate-pulse align-middle" aria-label="Loading orders count" />
              ) : (
                ordersCount
              )}
            </div>
          </Link>

          <Link href="/account/addresses" className="bg-surface-container-lowest p-4 sm:p-5 rounded-2xl border border-outline-variant/20 shadow-sm hover:border-neutral-900 transition-colors group">
            <p className="text-xs font-label-caps text-on-surface-variant uppercase font-bold mb-1">Addresses</p>
            <p className="text-2xl font-extrabold text-on-surface group-hover:text-neutral-900 transition-colors">
              {addresses.length}
            </p>
          </Link>

          <Link href="/account/wishlist" className="bg-surface-container-lowest p-4 sm:p-5 rounded-2xl border border-outline-variant/20 shadow-sm hover:border-neutral-900 transition-colors group">
            <p className="text-xs font-label-caps text-on-surface-variant uppercase font-bold mb-1">Wishlist</p>
            <p className="text-2xl font-extrabold text-on-surface group-hover:text-neutral-900 transition-colors">
              {wishlistItems.length}
            </p>
          </Link>

          <Link href="/account/reviews" className="bg-surface-container-lowest p-4 sm:p-5 rounded-2xl border border-outline-variant/20 shadow-sm hover:border-neutral-900 transition-colors group">
            <p className="text-xs font-label-caps text-on-surface-variant uppercase font-bold mb-1">Reviews</p>
            <p className="text-2xl font-extrabold text-on-surface group-hover:text-neutral-900 transition-colors">
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
                <p className="text-xs text-on-surface-variant mt-1">View saved tailored menswear, Nehru jackets, and kurta pieces.</p>
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
  );
}
