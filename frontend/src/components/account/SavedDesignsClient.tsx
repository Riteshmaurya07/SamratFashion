"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/useAuthStore";
import { useCartStore } from "@/store/useCartStore";

interface SavedDesign {
  _id: string;
  name: string;
  productId: {
    _id: string;
    name: string;
    slug: string;
    basePrice: number;
    images: string[];
  } | string;
  selectedVariantId: string;
  selectedColor: string;
  selectedSize: string;
  elements: any[];
  previewImage?: { front?: string; back?: string };
  printLocations: string[];
  status: "DRAFT" | "SAVED" | "ORDERED" | "ARCHIVED" | "SUBMITTED" | "PREVIEW_GENERATED" | "CUSTOMER_REVIEW" | "CUSTOMER_APPROVED" | "REVISION_REQUESTED" | "PRODUCTION_VALIDATION" | "PRODUCTION_READY" | "IN_PRODUCTION" | "COMPLETED";
  currentVersion: number;
  approvedVersion?: number;
  createdAt: string;
  updatedAt: string;
}

export default function SavedDesignsClient() {
  const router = useRouter();
  const { user } = useAuthStore();
  const { addItem } = useCartStore();

  const [designs, setDesigns] = useState<SavedDesign[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Action Loading & Toast States
  const [actionId, setActionId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; type: "success" | "error" } | null>(null);

  // Delete Confirmation Modal State
  const [deleteTarget, setDeleteTarget] = useState<SavedDesign | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Fetch designs on mount
  useEffect(() => {
    async function fetchDesigns() {
      setIsLoading(true);
      setError(null);
      try {
        const res = await api.get("/designs");
        if (res.data?.success) {
          setDesigns(res.data.data);
        }
      } catch (err: any) {
        if (err.response?.status === 401) {
          router.push("/login?redirect=/account/designs");
          return;
        }
        setError(err.response?.data?.message || "Failed to load saved designs.");
      } finally {
        setIsLoading(false);
      }
    }
    if (user) {
      fetchDesigns();
    } else {
      setIsLoading(false);
    }
  }, [user, router]);

  // Edit saved designs in the dedicated studio route.
  const handleEdit = (id: string) => {
    router.push(`/custom-designer?designId=${id}`);
  };

  // Handle Duplicate Action
  const handleDuplicate = async (id: string) => {
    setActionId(id);
    setToast(null);
    try {
      const res = await api.post(`/designs/${id}/duplicate`);
      if (res.data?.success) {
        setDesigns((prev) => [res.data.data, ...prev]);
        setToast({ text: "Design duplicated successfully!", type: "success" });
      }
    } catch (err: any) {
      setToast({ text: err.response?.data?.message || "Failed to duplicate design", type: "error" });
    } finally {
      setActionId(null);
    }
  };

  // Handle Delete Confirmation Action
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    setToast(null);
    try {
      const res = await api.delete(`/designs/${deleteTarget._id}`);
      if (res.data?.success) {
        setDesigns((prev) => prev.filter((d) => d._id !== deleteTarget._id));
        setToast({ text: "Design deleted successfully!", type: "success" });
      }
    } catch (err: any) {
      setToast({ text: err.response?.data?.message || "Failed to delete design", type: "error" });
    } finally {
      setIsDeleting(false);
      setDeleteTarget(null);
    }
  };

  // Handle Add to Cart Action
  const handleAddToCart = async (design: SavedDesign) => {
    const prodId = typeof design.productId === "object" ? design.productId._id : design.productId;
    if (!prodId || !design.selectedVariantId) {
      setToast({ text: "Product details unavailable for this design", type: "error" });
      return;
    }

    setActionId(design._id);
    setToast(null);

    try {
      await addItem(prodId, design.selectedVariantId, 1, design._id);
      setToast({ text: "Custom T-Shirt added to cart!", type: "success" });
      router.push("/cart");
    } catch (err: any) {
      setToast({ text: err.response?.data?.message || "Failed to add custom item to cart", type: "error" });
    } finally {
      setActionId(null);
    }
  };

  if (!user && !isLoading) {
    return (
      <div className="max-w-[1440px] mx-auto px-4 md:px-8 py-20 text-center">
        <h2 className="font-headline-lg text-2xl font-bold mb-4">Please Log In</h2>
        <p className="text-on-surface-variant mb-6">Log in to view and manage your saved custom T-shirt designs.</p>
        <Link href="/login?redirect=/account/designs" className="px-6 py-3 bg-primary text-on-primary font-bold rounded-lg">
          Log In to Account
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-on-background font-body-md pb-24">
      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed top-20 right-6 z-50 px-6 py-4 rounded-lg shadow-xl text-white font-medium transition-all ${
            toast.type === "success" ? "bg-emerald-600" : "bg-red-600"
          }`}
        >
          {toast.text}
        </div>
      )}

      {/* Main Content Area */}
      <main className="w-full max-w-[1440px] mx-auto px-4 md:px-8 py-10">
        {/* Header Section */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end mb-10 border-b border-outline-variant/10 pb-8">
          <div>
            <h1 className="font-display-lg text-3xl md:text-5xl font-black text-on-surface mb-3 tracking-tight">
              My Saved Designs
            </h1>
            <p className="font-body-md text-on-surface-variant max-w-lg">
              Save, edit, duplicate, and re-order your custom T-shirt designs. Build your personal archive of signature streetwear aesthetics.
            </p>
          </div>
          <div className="mt-6 md:mt-0 flex items-center gap-4">
            <span className="font-label-caps text-xs bg-surface-container-highest text-on-surface px-4 py-2 rounded-full uppercase tracking-widest font-bold">
              {designs.length} Saved Designs
            </span>
            <Link
              href="/custom-printing"
              className="bg-primary text-on-primary font-headline-sm text-sm font-bold px-6 py-3 rounded-lg hover:bg-primary-container transition-colors flex items-center gap-2 shadow-sm"
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              New Design
            </Link>
          </div>
        </div>

        {/* Loading Skeleton */}
        {isLoading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className="bg-surface-container-lowest rounded-xl p-4 border border-outline-variant/10 animate-pulse">
                <div className="aspect-[3/4] bg-surface-container rounded-lg mb-4" />
                <div className="h-5 bg-surface-container rounded w-3/4 mb-2" />
                <div className="h-4 bg-surface-container rounded w-1/2" />
              </div>
            ))}
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="p-6 bg-error-container text-on-error-container rounded-xl text-center mb-8">
            <p className="font-bold">{error}</p>
          </div>
        )}

        {/* Empty State (Stitch Screen Match) */}
        {!isLoading && !error && designs.length === 0 && (
          <div className="py-20 px-8 bg-surface-container-lowest border border-outline-variant/10 rounded-2xl flex flex-col items-center justify-center text-center max-w-2xl mx-auto shadow-sm">
            <div className="w-20 h-20 bg-surface-container-low rounded-full flex items-center justify-center mb-6">
              <span className="material-symbols-outlined text-outline text-4xl">inventory_2</span>
            </div>
            <h2 className="font-headline-lg text-2xl font-bold text-on-surface mb-3">No saved designs yet</h2>
            <p className="font-body-md text-on-surface-variant max-w-md mb-8">
              Your design library is empty. Start creating custom graphic T-shirts in our Custom Studio to save your creations.
            </p>
            <Link
              href="/custom-printing"
              className="bg-primary text-on-primary font-headline-sm text-sm font-bold px-8 py-4 rounded-xl hover:bg-primary-container transition-colors inline-flex items-center gap-2 shadow-md"
            >
              <span className="material-symbols-outlined text-[20px]">brush</span>
              Create Your First Design
            </Link>
          </div>
        )}

        {/* Bento Grid / Design Cards List */}
        {!isLoading && designs.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {designs.map((design) => {
              const productName = typeof design.productId === "object" ? design.productId.name : "Custom T-Shirt";
              const previewUrl =
                design.previewImage?.front ||
                (typeof design.productId === "object" && design.productId.images?.[0]) ||
                "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=500";

              return (
                <div
                  key={design._id}
                  className="group relative bg-surface-container-lowest rounded-xl overflow-hidden border border-outline-variant/10 hover:shadow-xl hover:scale-[1.01] transition-all duration-300 flex flex-col h-full"
                >
                  {/* Thumbnail Container */}
                  <div className="relative aspect-[3/4] bg-surface-container-low w-full overflow-hidden p-4 flex items-center justify-center">
                    <div className="absolute top-4 left-4 z-10">
                      <span className="bg-inverse-surface text-inverse-on-surface font-label-caps text-[10px] px-3 py-1 rounded-full uppercase tracking-wider font-bold">
                        {design.selectedColor} • {design.selectedSize}
                      </span>
                    </div>

                    {/* Artwork Preview */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={previewUrl}
                      alt={design.name}
                      className="w-full h-full object-cover rounded-lg group-hover:scale-105 transition-transform duration-500"
                    />

                    {/* Status Badge */}
                    <div className="absolute bottom-4 left-4 z-10">
                      <span
                        className={`font-label-caps text-[10px] px-2.5 py-0.5 rounded-md font-bold uppercase tracking-widest ${
                          design.status === "ORDERED"
                            ? "bg-emerald-600 text-white"
                            : "bg-primary text-on-primary"
                        }`}
                      >
                        {design.status}
                      </span>
                    </div>
                  </div>

                  {/* Card Info & Actions */}
                  <div className="p-5 flex flex-col flex-grow">
                    <h3 className="font-headline-sm text-base font-bold text-on-surface truncate mb-1">{design.name}</h3>
                    <p className="font-body-sm text-xs text-on-surface-variant mb-4 truncate">{productName}</p>
                    <p className="font-label-caps text-[10px] text-on-surface-variant mb-2 uppercase">
                      Updated {new Date(design.updatedAt).toLocaleDateString()}
                    </p>
                    <div className="flex flex-wrap gap-2 mb-4 font-mono text-[10px]">
                      <span className="bg-surface-container px-2 py-0.5 rounded text-on-surface-variant">v{design.currentVersion || 1}</span>
                      {design.approvedVersion && <span className="bg-green-100 px-2 py-0.5 rounded text-green-700 font-bold">Approved v{design.approvedVersion}</span>}
                    </div>

                    {/* Action Bar */}
                    <div className="mt-auto pt-4 border-t border-outline-variant/10 flex items-center justify-between gap-2">
                      <button
                        onClick={() => handleEdit(design._id)}
                        className="font-headline-sm text-xs font-bold text-primary hover:text-primary-container transition-colors flex items-center gap-1"
                      >
                        Edit <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                      </button>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleDuplicate(design._id)}
                          disabled={actionId === design._id}
                          className="p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors"
                          title="Duplicate Design"
                        >
                          <span className="material-symbols-outlined text-[18px]">content_copy</span>
                        </button>

                        <button
                          onClick={() => handleAddToCart(design)}
                          disabled={actionId === design._id}
                          className="p-1.5 rounded-lg text-primary hover:bg-primary/10 transition-colors"
                          title="Add to Cart"
                        >
                          <span className="material-symbols-outlined text-[18px]">shopping_bag</span>
                        </button>

                        <button
                          onClick={() => setDeleteTarget(design)}
                          className="p-1.5 rounded-lg text-red-500 hover:bg-red-500/10 transition-colors"
                          title="Delete Design"
                        >
                          <span className="material-symbols-outlined text-[18px]">delete</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Create New Card Variant */}
            <Link
              href="/custom-printing"
              className="group relative bg-surface-container-low rounded-xl border-2 border-dashed border-outline-variant/30 flex flex-col items-center justify-center h-full min-h-[360px] hover:bg-surface-container hover:border-primary transition-all cursor-pointer p-6 text-center"
            >
              <div className="w-14 h-14 bg-surface-container-lowest rounded-full flex items-center justify-center shadow-sm mb-4 group-hover:scale-110 transition-transform">
                <span className="material-symbols-outlined text-primary text-2xl">add</span>
              </div>
              <h3 className="font-headline-sm text-base font-bold text-on-surface mb-1">Create New</h3>
              <p className="font-body-sm text-xs text-on-surface-variant">Start a fresh T-shirt design in the Custom Studio.</p>
            </Link>
          </div>
        )}
      </main>

      {/* Delete Confirmation Modal Dialog (Stitch Screen Match) */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-on-surface/40 backdrop-blur-sm" onClick={() => setDeleteTarget(null)} />
          <div className="relative bg-surface-container-lowest rounded-2xl shadow-2xl max-w-md w-full p-6 border border-outline-variant/10 z-10 animate-in fade-in zoom-in duration-200">
            <button
              onClick={() => setDeleteTarget(null)}
              className="absolute top-4 right-4 text-on-surface-variant hover:text-on-surface p-1 rounded-full"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>

            <div className="flex flex-col items-center text-center mb-6">
              <div className="w-14 h-14 bg-red-100 text-red-600 rounded-full flex items-center justify-center mb-4">
                <span className="material-symbols-outlined text-3xl">delete</span>
              </div>
              <h3 className="font-headline-lg text-xl font-bold text-on-surface mb-2">Delete this design?</h3>
              <p className="font-body-md text-sm text-on-surface-variant">
                Are you sure you want to delete &quot;{deleteTarget.name}&quot;? This action will archive your custom design.
              </p>
            </div>

            <div className="flex gap-3 w-full">
              <button
                onClick={() => setDeleteTarget(null)}
                className="flex-1 py-2.5 border border-outline text-on-surface font-headline-sm text-sm font-bold rounded-xl hover:bg-surface-container-low transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={isDeleting}
                className="flex-1 py-2.5 bg-red-600 text-white font-headline-sm text-sm font-bold rounded-xl hover:bg-red-700 transition-colors shadow-md disabled:opacity-50"
              >
                {isDeleting ? "Deleting..." : "Delete Design"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
