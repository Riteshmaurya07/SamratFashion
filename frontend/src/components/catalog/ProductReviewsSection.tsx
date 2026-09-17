"use client";

import React, { useState, useEffect } from "react";
import { api } from "@/lib/api";

interface PublicReview {
  _id: string;
  rating: number;
  title?: string;
  body: string;
  photos: string[];
  isVerifiedPurchase: boolean;
  createdAt: string;
  userId?: {
    name: string;
  };
}

interface CustomerPhoto {
  url: string;
  rating: number;
  author: string;
  createdAt: string;
}

interface ReviewSummary {
  averageRating: number;
  totalReviews: number;
  histogram: Record<number, number>;
}

export default function ProductReviewsSection({ productId }: { productId: string }) {
  const [reviews, setReviews] = useState<PublicReview[]>([]);
  const [summary, setSummary] = useState<ReviewSummary>({ averageRating: 0, totalReviews: 0, histogram: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } });
  const [photos, setPhotos] = useState<CustomerPhoto[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchReviews() {
      setIsLoading(true);
      try {
        const res = await api.get(`/reviews/product/${productId}`);
        if (res.data?.success) {
          setReviews(res.data.data.reviews || []);
          setSummary(res.data.data.summary || { averageRating: 0, totalReviews: 0, histogram: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } });
          setPhotos(res.data.data.customerPhotos || []);
        }
      } catch (err) {
        console.error("Failed to load product reviews:", err);
      } finally {
        setIsLoading(false);
      }
    }
    if (productId) fetchReviews();
  }, [productId]);

  if (isLoading) {
    return <div className="py-12 text-center text-on-surface-variant font-bold">Loading product reviews...</div>;
  }

  const { averageRating, totalReviews, histogram } = summary;

  return (
    <section id="reviews" className="py-12 border-t border-outline-variant/10">
      <h2 className="font-headline-lg text-2xl md:text-3xl font-extrabold text-on-surface mb-8">
        Customer Reviews & Ratings
      </h2>

      {/* Summary Bento Header (Stitch Screen Match) */}
      {totalReviews > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 mb-12 bg-surface-container-lowest p-6 md:p-8 rounded-2xl border border-outline-variant/20 shadow-sm">
          {/* Left Rating Overview */}
          <div className="md:col-span-4 flex flex-col justify-center items-center text-center border-b md:border-b-0 md:border-r border-outline-variant/20 pb-6 md:pb-0 md:pr-6">
            <span className="font-display-lg text-5xl font-black text-on-surface">{averageRating > 0 ? averageRating.toFixed(1) : "0.0"}</span>
            <div className="flex items-center gap-1 my-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <span
                  key={star}
                  className={`material-symbols-outlined text-lg ${star <= Math.round(averageRating) ? "text-amber-500" : "text-outline"}`}
                >
                  star
                </span>
              ))}
            </div>
            <p className="font-body-sm text-sm text-on-surface-variant">Based on {totalReviews} verified reviews</p>
          </div>

          {/* Right Star Histogram */}
          <div className="md:col-span-8 flex flex-col justify-center gap-2">
            {[5, 4, 3, 2, 1].map((star) => {
              const count = histogram[star] || 0;
              const percentage = totalReviews > 0 ? Math.round((count / totalReviews) * 100) : 0;

              return (
                <div key={star} className="flex items-center gap-4 text-xs font-label-caps">
                  <span className="w-12 text-on-surface font-bold">{star} Stars</span>
                  <div className="flex-1 h-2.5 bg-surface-container-low rounded-full overflow-hidden">
                    <div className="h-full bg-amber-500 rounded-full transition-all duration-500" style={{ width: `${percentage}%` }} />
                  </div>
                  <span className="w-10 text-right text-on-surface-variant font-bold">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Customer Photo Showcase Gallery (Stitch Screen Match) */}
      {photos.length > 0 && (
        <div className="mb-12">
          <h3 className="font-headline-sm text-lg font-bold text-on-surface mb-4 flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-xl">photo_camera</span>
            Customer Photos ({photos.length})
          </h3>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
            {photos.map((item, idx) => (
              <div key={idx} className="aspect-square rounded-xl overflow-hidden border border-outline-variant/30 group relative bg-surface-container-low cursor-pointer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.url} alt="Customer photo" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity p-2 flex flex-col justify-end text-white text-[10px] font-label-caps">
                  <span>{item.author}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Public Reviews List */}
      <div className="space-y-6">
        {reviews.length === 0 ? (
          <div className="p-8 text-center text-on-surface-variant italic bg-surface-container-low rounded-xl">
            No customer reviews published yet. Be the first to review this product!
          </div>
        ) : (
          reviews.map((rev) => (
            <div key={rev._id} className="bg-surface-container-lowest p-6 rounded-2xl border border-outline-variant/20 shadow-sm">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-on-surface text-sm">{rev.userId?.name || "Verified Customer"}</span>
                    {rev.isVerifiedPurchase && (
                      <span className="bg-emerald-100 text-emerald-800 font-label-caps text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                        <span className="material-symbols-outlined text-[12px]">verified</span> Verified Purchase
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 mt-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <span key={star} className={`material-symbols-outlined text-xs ${star <= rev.rating ? "text-amber-500" : "text-outline"}`}>
                        star
                      </span>
                    ))}
                    <span className="text-xs text-on-surface-variant font-label-caps ml-2">
                      {new Date(rev.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </div>

              {rev.title && <h4 className="font-bold text-sm text-on-surface mt-2">{rev.title}</h4>}
              <p className="text-sm text-on-surface-variant mt-1 leading-relaxed">{rev.body}</p>

              {rev.photos && rev.photos.length > 0 && (
                <div className="flex gap-3 mt-3">
                  {rev.photos.map((p, i) => (
                    <div key={i} className="w-16 h-16 rounded-lg overflow-hidden border border-outline-variant">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p} alt="Customer photo" className="w-full h-full object-cover" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
