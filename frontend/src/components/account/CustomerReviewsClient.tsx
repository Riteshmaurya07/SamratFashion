"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

interface ReviewedItem {
  _id: string;
  rating: number;
  title?: string;
  body: string;
  photos: string[];
  status: string;
  createdAt: string;
  productId?: {
    _id: string;
    name: string;
    images: string[];
    slug: string;
  };
}

interface UnreviewedItem {
  orderId: string;
  orderNumber: string;
  orderItemId: string;
  productId: string;
  productName: string;
  productImage: string;
  deliveredAt: string;
}

export default function CustomerReviewsClient() {
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<"TO_REVIEW" | "REVIEWED">("TO_REVIEW");
  const [reviews, setReviews] = useState<ReviewedItem[]>([]);
  const [unreviewedItems, setUnreviewedItems] = useState<UnreviewedItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal Review Composer State
  const [selectedItem, setSelectedItem] = useState<UnreviewedItem | null>(null);
  const [rating, setRating] = useState(5);
  const [hoverRating, setHoverRating] = useState(0);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState<{ text: string; type: "success" | "error" } | null>(null);

  // Fetch Customer Reviews
  useEffect(() => {
    async function fetchReviews() {
      setIsLoading(true);
      setError(null);
      try {
        const res = await api.get("/reviews/my-reviews");
        if (res.data?.success) {
          setReviews(res.data.data.reviews || []);
          setUnreviewedItems(res.data.data.unreviewedItems || []);
        }
      } catch (err: any) {
        if (err.response?.status === 401) {
          router.push("/login?redirect=/account/reviews");
          return;
        }
        setError(err.response?.data?.message || "Failed to load reviews.");
      } finally {
        setIsLoading(false);
      }
    }
    fetchReviews();
  }, [router]);

  const handleAddPhoto = () => {
    if (!photoUrl.trim() || photos.length >= 4) return;
    setPhotos([...photos, photoUrl.trim()]);
    setPhotoUrl("");
  };

  const handleRemovePhoto = (idx: number) => {
    setPhotos(photos.filter((_, i) => i !== idx));
  };

  // Submit Review
  const handleSubmitReview = async () => {
    if (!selectedItem || !body.trim() || body.trim().length < 10) return;
    setIsSubmitting(true);
    setToast(null);

    try {
      const res = await api.post("/reviews", {
        productId: selectedItem.productId,
        orderId: selectedItem.orderId,
        orderItemId: selectedItem.orderItemId,
        rating,
        title: title.trim() || undefined,
        body: body.trim(),
        photos,
      });

      if (res.data?.success) {
        setUnreviewedItems((prev) =>
          prev.filter(
            (item) =>
              !(item.orderId === selectedItem.orderId && item.orderItemId === selectedItem.orderItemId)
          )
        );
        setReviews([res.data.data, ...reviews]);
        setSelectedItem(null);
        setRating(5);
        setTitle("");
        setBody("");
        setPhotos([]);
        setToast({ text: "Thank you! Your review has been submitted for moderation.", type: "success" });
      }
    } catch (err: any) {
      setToast({ text: err.response?.data?.message || "Failed to submit review.", type: "error" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex-1 bg-background text-on-background min-h-screen p-6 md:p-12 font-body-md pb-24">
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

      {/* Header */}
      <header className="mb-10 border-b border-outline-variant/10 pb-6 flex justify-between items-end">
        <div>
          <h1 className="font-display-lg text-3xl md:text-5xl font-extrabold text-on-background mb-2">My Reviews</h1>
          <p className="font-body-md text-on-surface-variant flex items-center gap-2">
            <span className="material-symbols-outlined text-amber-500 text-lg">star</span>
            {reviews.length} Published & Pending Reviews
          </p>
        </div>
      </header>

      {/* Tabs */}
      <div className="flex gap-8 mb-10 border-b border-outline-variant/10">
        <button
          onClick={() => setActiveTab("TO_REVIEW")}
          className={`pb-4 font-headline-sm text-base md:text-lg transition-colors font-bold ${
            activeTab === "TO_REVIEW" ? "text-primary border-b-2 border-primary" : "text-on-surface-variant hover:text-on-surface"
          }`}
        >
          To Review <span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-xs ml-2">{unreviewedItems.length}</span>
        </button>
        <button
          onClick={() => setActiveTab("REVIEWED")}
          className={`pb-4 font-headline-sm text-base md:text-lg transition-colors font-bold ${
            activeTab === "REVIEWED" ? "text-primary border-b-2 border-primary" : "text-on-surface-variant hover:text-on-surface"
          }`}
        >
          Reviewed <span className="bg-surface-container-high text-on-surface-variant rounded-full px-2 py-0.5 text-xs ml-2">{reviews.length}</span>
        </button>
      </div>

      {isLoading && (
        <div className="p-8 text-center font-bold text-on-surface-variant">Loading your reviews...</div>
      )}

      {error && (
        <div className="p-4 bg-error-container text-on-error-container rounded-xl text-center font-bold mb-6">{error}</div>
      )}

      {/* Unreviewed Products Grid (To Review Tab) */}
      {!isLoading && !error && activeTab === "TO_REVIEW" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {unreviewedItems.length === 0 ? (
            <div className="col-span-2 p-12 text-center bg-surface-container-lowest rounded-2xl border border-outline-variant/20">
              <span className="material-symbols-outlined text-4xl text-outline mb-2">rate_review</span>
              <p className="font-bold text-on-surface">No pending items to review.</p>
              <p className="text-xs text-on-surface-variant mt-1">Items from your delivered orders will appear here for reviews.</p>
            </div>
          ) : (
            unreviewedItems.map((item) => (
              <div
                key={`${item.orderId}_${item.orderItemId}`}
                className="bg-surface-container-lowest border border-outline-variant/20 rounded-2xl overflow-hidden shadow-sm flex flex-col sm:flex-row hover:shadow-md transition-shadow"
              >
                <div className="w-full sm:w-44 aspect-square bg-surface-container-low relative flex-shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={item.productImage || "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=500"} alt={item.productName} className="w-full h-full object-cover" />
                </div>
                <div className="p-6 flex flex-col justify-between flex-1">
                  <div>
                    <h3 className="font-bold text-lg text-on-surface mb-1">{item.productName}</h3>
                    <p className="text-xs text-on-surface-variant font-label-caps mb-4">
                      Order #{item.orderNumber} • Delivered
                    </p>
                  </div>
                  <button
                    onClick={() => setSelectedItem(item)}
                    className="w-full py-3 bg-primary text-on-primary font-label-caps text-xs font-bold rounded-xl hover:bg-primary-container transition-colors flex items-center justify-center gap-2"
                  >
                    <span className="material-symbols-outlined text-[18px]">edit_document</span>
                    Write a Review
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Reviewed List (Reviewed Tab) */}
      {!isLoading && !error && activeTab === "REVIEWED" && (
        <div className="grid grid-cols-1 gap-6">
          {reviews.length === 0 ? (
            <div className="p-12 text-center bg-surface-container-lowest rounded-2xl border border-outline-variant/20">
              <p className="font-bold text-on-surface">You haven't written any reviews yet.</p>
            </div>
          ) : (
            reviews.map((rev) => (
              <div key={rev._id} className="bg-surface-container-lowest border border-outline-variant/20 rounded-2xl p-6 shadow-sm flex flex-col gap-3">
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="font-bold text-base text-on-surface">{rev.productId?.name || "Product"}</h4>
                    <div className="flex items-center gap-1 mt-1">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <span
                          key={star}
                          className={`material-symbols-outlined text-sm ${star <= rev.rating ? "text-amber-500" : "text-outline"}`}
                        >
                          star
                        </span>
                      ))}
                      <span className="text-xs text-on-surface-variant font-label-caps ml-2">
                        {new Date(rev.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${
                      rev.status === "APPROVED"
                        ? "bg-emerald-100 text-emerald-800"
                        : rev.status === "REJECTED"
                        ? "bg-red-100 text-red-800"
                        : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {rev.status}
                  </span>
                </div>

                {rev.title && <h5 className="font-bold text-sm text-on-surface mt-1">{rev.title}</h5>}
                <p className="text-sm text-on-surface-variant">{rev.body}</p>

                {/* Photos */}
                {rev.photos && rev.photos.length > 0 && (
                  <div className="flex gap-3 mt-2">
                    {rev.photos.map((photo, i) => (
                      <div key={i} className="w-16 h-16 rounded-lg overflow-hidden border border-outline-variant">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={photo} alt="Review attachment" className="w-full h-full object-cover" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Review Composer Modal (Stitch Screen Match) */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-on-background/50 backdrop-blur-sm">
          <div className="bg-surface-container-lowest w-full max-w-lg rounded-2xl shadow-2xl border border-outline-variant/20 overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-6 border-b border-outline-variant/10 flex justify-between items-center bg-surface-container-low">
              <div>
                <h3 className="font-bold text-lg text-on-surface">Review Your Purchase</h3>
                <p className="text-xs text-on-surface-variant font-label-caps">{selectedItem.productName}</p>
              </div>
              <button onClick={() => setSelectedItem(null)} className="p-2 hover:bg-surface-container rounded-full text-on-surface-variant">
                <span className="material-symbols-outlined text-lg">close</span>
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-6 flex-1">
              {/* Star Selector */}
              <div className="flex flex-col items-center py-2">
                <p className="text-sm font-bold text-on-surface mb-2">How would you rate this product?</p>
                <div className="flex gap-2">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      onMouseEnter={() => setHoverRating(star)}
                      onMouseLeave={() => setHoverRating(0)}
                      onClick={() => setRating(star)}
                      className="p-1 text-amber-500 hover:scale-110 transition-transform"
                    >
                      <span className="material-symbols-outlined text-3xl">
                        {(hoverRating || rating) >= star ? "star" : "star_outline"}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Title & Body */}
              <div>
                <label className="block text-xs font-label-caps uppercase text-on-surface mb-1">Headline / Summary (Optional)</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-3 text-sm focus:outline-none focus:border-primary"
                  placeholder="e.g. Amazing fit & high-quality heavyweight cotton!"
                />
              </div>

              <div>
                <label className="block text-xs font-label-caps uppercase text-on-surface mb-1">Detailed Review (Min 10 chars)</label>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={4}
                  className="w-full bg-surface-container-low border border-outline-variant rounded-xl p-3 text-sm focus:outline-none focus:border-primary resize-none"
                  placeholder="Tell other buyers about fit, fabric quality, color accuracy, and overall experience..."
                />
              </div>

              {/* Photo Attachments */}
              <div>
                <label className="block text-xs font-label-caps uppercase text-on-surface mb-1">Attach Customer Photos (Max 4)</label>
                <div className="flex gap-2 mb-3">
                  <input
                    type="text"
                    value={photoUrl}
                    onChange={(e) => setPhotoUrl(e.target.value)}
                    className="flex-1 bg-surface-container-low border border-outline-variant rounded-xl px-3 py-2 text-xs outline-none focus:border-primary"
                    placeholder="Paste Image URL or Base64 data..."
                  />
                  <button
                    onClick={handleAddPhoto}
                    disabled={photos.length >= 4 || !photoUrl.trim()}
                    className="px-4 py-2 bg-surface-container-high font-label-caps text-xs font-bold rounded-xl hover:bg-surface-variant disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>

                {photos.length > 0 && (
                  <div className="flex gap-3">
                    {photos.map((url, i) => (
                      <div key={i} className="w-16 h-16 rounded-lg border border-outline-variant overflow-hidden relative">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt="Preview" className="w-full h-full object-cover" />
                        <button
                          onClick={() => handleRemovePhoto(i)}
                          className="absolute top-0.5 right-0.5 bg-red-600 text-white rounded-full p-0.5"
                        >
                          <span className="material-symbols-outlined text-[12px]">close</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="p-6 border-t border-outline-variant/10 bg-surface-container-low flex justify-end gap-3">
              <button
                onClick={() => setSelectedItem(null)}
                className="px-5 py-2.5 border border-outline-variant font-label-caps text-xs font-bold rounded-xl text-on-surface-variant hover:bg-surface-container transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitReview}
                disabled={isSubmitting || body.trim().length < 10}
                className="px-6 py-2.5 bg-primary text-on-primary font-label-caps text-xs font-bold rounded-xl hover:bg-primary-container transition-colors shadow-md disabled:opacity-50"
              >
                {isSubmitting ? "Submitting..." : "Submit Review"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
