"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export default function CouponForm({ couponId }: { couponId?: string }) {
  const router = useRouter();
  const isEditing = !!couponId;

  const [formData, setFormData] = useState({
    code: "",
    description: "",
    discountType: "PERCENTAGE",
    discountValue: 10,
    minOrderValue: 0,
    maxDiscountAmount: 0,
    startsAt: "",
    expiresAt: "",
    usageLimit: 0,
    perUserUsageLimit: 1,
    status: "ACTIVE",
  });

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (couponId) {
      const fetchCoupon = async () => {
        try {
          const res = await api.get(`/admin/coupons/${couponId}`);
          const c = res.data.data;
          setFormData({
            code: c.code || "",
            description: c.description || "",
            discountType: c.discountType || "PERCENTAGE",
            discountValue: c.discountValue || 0,
            minOrderValue: c.minOrderValue || 0,
            maxDiscountAmount: c.maxDiscountAmount || 0,
            startsAt: c.startsAt ? new Date(c.startsAt).toISOString().slice(0, 16) : "",
            expiresAt: c.expiresAt ? new Date(c.expiresAt).toISOString().slice(0, 16) : "",
            usageLimit: c.usageLimit || 0,
            perUserUsageLimit: c.perUserUsageLimit || 1,
            status: c.status || "ACTIVE",
          });
        } catch (err) {
          setError("Failed to load coupon details");
        }
      };
      fetchCoupon();
    }
  }, [couponId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");

    const payload = {
      ...formData,
      code: formData.code.trim().toUpperCase(),
      discountValue: Number(formData.discountValue),
      minOrderValue: Number(formData.minOrderValue || 0),
      maxDiscountAmount: formData.maxDiscountAmount ? Number(formData.maxDiscountAmount) : undefined,
      usageLimit: formData.usageLimit ? Number(formData.usageLimit) : undefined,
      perUserUsageLimit: Number(formData.perUserUsageLimit || 1),
      startsAt: formData.startsAt ? new Date(formData.startsAt).toISOString() : undefined,
      expiresAt: formData.expiresAt ? new Date(formData.expiresAt).toISOString() : undefined,
    };

    try {
      if (isEditing) {
        await api.put(`/admin/coupons/${couponId}`, payload);
      } else {
        await api.post(`/admin/coupons`, payload);
      }
      router.push("/admin/coupons");
    } catch (err: any) {
      setError(err.response?.data?.message || "Failed to save coupon");
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col h-full relative pb-20 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-8 border-b border-outline-variant pb-4">
        <div>
          <h2 className="font-headline-lg text-headline-lg font-bold text-on-surface">
            {isEditing ? `Edit Coupon: ${formData.code}` : "Create New Coupon"}
          </h2>
          <p className="font-body-sm text-on-surface-variant mt-1">
            Configure discount values, validity periods, and usage limits.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="px-4 py-2 rounded border border-outline text-on-surface font-body-sm font-semibold hover:bg-surface-container-low transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded bg-primary text-on-primary font-body-sm font-bold hover:bg-primary-fixed-variant transition-colors flex items-center gap-2 disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[18px]">save</span>
            {saving ? "Saving..." : "Save Coupon"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-error-container/20 text-error border border-error/20 rounded-lg font-body-sm flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">error_outline</span>
          {error}
        </div>
      )}

      {/* Main Settings Card */}
      <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-6 space-y-6 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block font-label-caps text-label-caps text-on-surface-variant mb-2 uppercase">Coupon Code *</label>
            <input
              required
              type="text"
              placeholder="e.g. SUMMER30"
              className="w-full bg-surface font-mono font-bold text-primary uppercase border border-outline-variant rounded px-4 py-3 focus:outline-none focus:border-primary"
              value={formData.code}
              onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
            />
          </div>

          <div>
            <label className="block font-label-caps text-label-caps text-on-surface-variant mb-2 uppercase">Status</label>
            <select
              className="w-full bg-surface text-on-surface border border-outline-variant rounded px-4 py-3 focus:outline-none focus:border-primary"
              value={formData.status}
              onChange={(e) => setFormData({ ...formData, status: e.target.value })}
            >
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block font-label-caps text-label-caps text-on-surface-variant mb-2 uppercase">Description</label>
          <input
            type="text"
            placeholder="e.g. Summer Drop 30% discount on orders over ₹1,500"
            className="w-full bg-surface text-on-surface border border-outline-variant rounded px-4 py-3 focus:outline-none focus:border-primary"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          />
        </div>

        {/* Discount Details */}
        <div className="pt-6 border-t border-outline-variant/30 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <label className="block font-label-caps text-label-caps text-on-surface-variant mb-2 uppercase">Discount Type *</label>
            <select
              className="w-full bg-surface text-on-surface border border-outline-variant rounded px-4 py-3 focus:outline-none focus:border-primary"
              value={formData.discountType}
              onChange={(e) => setFormData({ ...formData, discountType: e.target.value })}
            >
              <option value="PERCENTAGE">Percentage (%)</option>
              <option value="FIXED">Fixed Amount (₹)</option>
            </select>
          </div>

          <div>
            <label className="block font-label-caps text-label-caps text-on-surface-variant mb-2 uppercase">Discount Value *</label>
            <input
              required
              type="number"
              min="0.01"
              step="any"
              className="w-full bg-surface text-on-surface border border-outline-variant rounded px-4 py-3 focus:outline-none focus:border-primary"
              value={formData.discountValue}
              onChange={(e) => setFormData({ ...formData, discountValue: Number(e.target.value) })}
            />
          </div>

          <div>
            <label className="block font-label-caps text-label-caps text-on-surface-variant mb-2 uppercase">Max Discount (₹) <span className="normal-case opacity-50">(Optional)</span></label>
            <input
              type="number"
              min="0"
              placeholder="e.g. 500"
              className="w-full bg-surface text-on-surface border border-outline-variant rounded px-4 py-3 focus:outline-none focus:border-primary"
              value={formData.maxDiscountAmount}
              onChange={(e) => setFormData({ ...formData, maxDiscountAmount: Number(e.target.value) })}
            />
          </div>
        </div>

        {/* Restrictions & Validity */}
        <div className="pt-6 border-t border-outline-variant/30 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block font-label-caps text-label-caps text-on-surface-variant mb-2 uppercase">Min Order Subtotal (₹)</label>
            <input
              type="number"
              min="0"
              className="w-full bg-surface text-on-surface border border-outline-variant rounded px-4 py-3 focus:outline-none focus:border-primary"
              value={formData.minOrderValue}
              onChange={(e) => setFormData({ ...formData, minOrderValue: Number(e.target.value) })}
            />
          </div>

          <div>
            <label className="block font-label-caps text-label-caps text-on-surface-variant mb-2 uppercase">Per-User Limit</label>
            <input
              type="number"
              min="1"
              className="w-full bg-surface text-on-surface border border-outline-variant rounded px-4 py-3 focus:outline-none focus:border-primary"
              value={formData.perUserUsageLimit}
              onChange={(e) => setFormData({ ...formData, perUserUsageLimit: Number(e.target.value) })}
            />
          </div>

          <div>
            <label className="block font-label-caps text-label-caps text-on-surface-variant mb-2 uppercase">Global Total Limit <span className="normal-case opacity-50">(0 = unlimited)</span></label>
            <input
              type="number"
              min="0"
              className="w-full bg-surface text-on-surface border border-outline-variant rounded px-4 py-3 focus:outline-none focus:border-primary"
              value={formData.usageLimit}
              onChange={(e) => setFormData({ ...formData, usageLimit: Number(e.target.value) })}
            />
          </div>

          <div>
            <label className="block font-label-caps text-label-caps text-on-surface-variant mb-2 uppercase">Expiry Date & Time <span className="normal-case opacity-50">(Optional)</span></label>
            <input
              type="datetime-local"
              className="w-full bg-surface text-on-surface border border-outline-variant rounded px-4 py-3 focus:outline-none focus:border-primary"
              value={formData.expiresAt}
              onChange={(e) => setFormData({ ...formData, expiresAt: e.target.value })}
            />
          </div>
        </div>
      </div>
    </form>
  );
}
