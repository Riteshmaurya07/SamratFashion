"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { invalidateStoreSettingsCache } from "@/lib/useStoreSettings";
import { IndianRupee, Truck, RotateCcw, Info } from "lucide-react";

interface StoreSettings {
  freeShippingThreshold: number;
  standardShippingFee: number;
  currency?: string;
}

const DEFAULT_SETTINGS: StoreSettings = {
  freeShippingThreshold: 999,
  standardShippingFee: 100,
};

function formatRupees(value: number): string {
  return `₹${Number(value || 0).toLocaleString("en-IN")}`;
}

export default function AdminStoreSettingsPage() {
  const [savedSettings, setSavedSettings] = useState<StoreSettings>(DEFAULT_SETTINGS);
  const [threshold, setThreshold] = useState(String(DEFAULT_SETTINGS.freeShippingThreshold));
  const [fee, setFee] = useState(String(DEFAULT_SETTINGS.standardShippingFee));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.get("/admin/settings");
      const data = res.data?.data;
      if (data && typeof data.freeShippingThreshold === "number") {
        const next = {
          freeShippingThreshold: data.freeShippingThreshold,
          standardShippingFee: data.standardShippingFee,
        };
        setSavedSettings(next);
        setThreshold(String(next.freeShippingThreshold));
        setFee(String(next.standardShippingFee));
      }
    } catch (err: any) {
      setError(err.response?.data?.message || "Failed to load store settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const parsedThreshold = threshold.trim() === "" ? Number.NaN : Number(threshold);
  const parsedFee = fee.trim() === "" ? Number.NaN : Number(fee);
  const thresholdValid = Number.isFinite(parsedThreshold) && parsedThreshold >= 0;
  const feeValid = Number.isFinite(parsedFee) && parsedFee >= 0;
  const formValid = thresholdValid && feeValid;
  const isDirty =
    parsedThreshold !== savedSettings.freeShippingThreshold ||
    parsedFee !== savedSettings.standardShippingFee;

  const previewThreshold = thresholdValid ? parsedThreshold : savedSettings.freeShippingThreshold;
  const previewFee = feeValid ? parsedFee : savedSettings.standardShippingFee;

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (!thresholdValid || !feeValid) {
      setError("Both amounts must be valid non-negative numbers.");
      return;
    }

    setSaving(true);
    try {
      const res = await api.put("/admin/settings", {
        freeShippingThreshold: parsedThreshold,
        standardShippingFee: parsedFee,
      });
      const data = res.data?.data;
      const next = {
        freeShippingThreshold:
          typeof data?.freeShippingThreshold === "number"
            ? data.freeShippingThreshold
            : parsedThreshold,
        standardShippingFee:
          typeof data?.standardShippingFee === "number" ? data.standardShippingFee : parsedFee,
      };
      setSavedSettings(next);
      setThreshold(String(next.freeShippingThreshold));
      setFee(String(next.standardShippingFee));
      invalidateStoreSettingsCache();
      setSuccess("Delivery settings saved. New carts and checkouts use these values immediately.");
    } catch (err: any) {
      setError(err.response?.data?.message || "Failed to save store settings.");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setThreshold(String(savedSettings.freeShippingThreshold));
    setFee(String(savedSettings.standardShippingFee));
    setError("");
    setSuccess("");
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-outline-variant/20 pb-5">
        <div>
          <h1 className="font-headline-lg text-2xl sm:text-3xl font-black text-on-surface uppercase tracking-tight">
            Store Settings
          </h1>
          <p className="font-body-sm text-xs text-on-surface-variant mt-1">
            Manage delivery charges and the free-delivery threshold applied across the storefront.
          </p>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 text-red-600 border border-red-200 rounded-lg text-xs font-mono flex items-start gap-2">
          <span className="material-symbols-outlined text-[18px] shrink-0">error</span>
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="p-4 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg text-xs font-mono flex items-start gap-2">
          <span className="material-symbols-outlined text-[18px] shrink-0">check_circle</span>
          <span>{success}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        {/* Settings form */}
        <form
          onSubmit={handleSave}
          className="lg:col-span-2 bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-4 sm:p-6 shadow-xs space-y-6"
        >
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Truck className="w-4 h-4" />
            </span>
            <div>
              <h2 className="font-headline-sm text-[16px] font-bold text-on-surface">
                Delivery &amp; Shipping
              </h2>
              <p className="font-body-sm text-[11px] text-on-surface-variant">
                Applied to every cart summary and checkout total.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="free-shipping-threshold"
                className="block font-label-caps text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1.5"
              >
                Free delivery minimum order value
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-sm">
                  <IndianRupee className="w-3.5 h-3.5" />
                </span>
                <input
                  id="free-shipping-threshold"
                  type="number"
                  min={0}
                  step="1"
                  inputMode="numeric"
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                  disabled={loading || saving}
                  className="w-full min-h-[42px] pl-9 pr-3 py-2 bg-surface-bright border border-outline-variant/40 rounded-lg font-mono text-sm text-on-surface focus:outline-none focus:border-primary disabled:opacity-50"
                />
              </div>
              <p className="font-body-sm text-[11px] text-on-surface-variant mt-1.5 leading-relaxed">
                Orders at or above this value get free delivery. Set to{" "}
                <span className="font-mono font-bold">0</span> to make every order free.
              </p>
            </div>

            <div>
              <label
                htmlFor="standard-shipping-fee"
                className="block font-label-caps text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1.5"
              >
                Standard delivery fee
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-sm">
                  <IndianRupee className="w-3.5 h-3.5" />
                </span>
                <input
                  id="standard-shipping-fee"
                  type="number"
                  min={0}
                  step="1"
                  inputMode="numeric"
                  value={fee}
                  onChange={(e) => setFee(e.target.value)}
                  disabled={loading || saving}
                  className="w-full min-h-[42px] pl-9 pr-3 py-2 bg-surface-bright border border-outline-variant/40 rounded-lg font-mono text-sm text-on-surface focus:outline-none focus:border-primary disabled:opacity-50"
                />
              </div>
              <p className="font-body-sm text-[11px] text-on-surface-variant mt-1.5 leading-relaxed">
                Charged when the order value is below the free-delivery threshold. Set to{" "}
                <span className="font-mono font-bold">0</span> to never charge delivery.
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-outline-variant/30 bg-surface-container-low/50 p-3.5 sm:p-4">
            <p className="font-label-caps text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">
              Live preview
            </p>
            <p className="font-body-sm text-[13px] text-on-surface leading-relaxed">
              Orders of <span className="font-bold">{formatRupees(previewThreshold)}</span> or more
              ship <span className="text-emerald-700 font-bold">free</span>. Orders below that are
              charged <span className="font-bold">{formatRupees(previewFee)}</span> delivery.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 pt-1">
            <button
              type="submit"
              disabled={loading || saving || !formValid || !isDirty}
              className="min-h-[42px] px-5 py-2.5 bg-neutral-950 text-white rounded-lg font-mono text-[11px] uppercase font-bold tracking-wider hover:bg-neutral-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <span
                className={`material-symbols-outlined text-[16px] ${saving ? "animate-spin" : ""}`}
              >
                {saving ? "sync" : "save"}
              </span>
              {saving ? "Saving..." : "Save Settings"}
            </button>

            <button
              type="button"
              onClick={handleReset}
              disabled={loading || saving || !isDirty}
              className="min-h-[42px] px-4 py-2.5 bg-surface-container-high border border-outline-variant/30 text-on-surface rounded-lg font-mono text-[11px] uppercase font-bold tracking-wider hover:bg-surface-container transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset
            </button>

            {isDirty && formValid && (
              <span className="font-mono text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5 text-center sm:ml-auto">
                Unsaved changes
              </span>
            )}
          </div>
        </form>

        {/* How it works */}
        <aside className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-4 sm:p-6 shadow-xs h-fit space-y-4">
          <div className="flex items-center gap-2 text-on-surface">
            <Info className="w-4 h-4 text-primary" />
            <h2 className="font-headline-sm text-[15px] font-bold">How it is applied</h2>
          </div>

          <ul className="space-y-3 font-body-sm text-[12px] text-on-surface-variant leading-relaxed">
            <li className="flex gap-2">
              <span className="material-symbols-outlined text-[16px] text-primary shrink-0">
                check
              </span>
              <span>
                The cart page and checkout read the same server-side rule, so the displayed total is
                always the amount charged.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="material-symbols-outlined text-[16px] text-primary shrink-0">
                check
              </span>
              <span>
                Coupon discounts reduce the order value before the free-delivery threshold is
                checked.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="material-symbols-outlined text-[16px] text-primary shrink-0">
                check
              </span>
              <span>
                Existing orders keep the shipping amount they were placed with; changes only affect
                new checkouts.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="material-symbols-outlined text-[16px] text-primary shrink-0">
                check
              </span>
              <span>
                Products marked <span className="font-mono font-bold">Free Delivery</span> ship
                free when the cart contains only free-delivery pieces. Mixed carts use the
                order-value rule above.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="material-symbols-outlined text-[16px] text-primary shrink-0">
                check
              </span>
              <span>
                Storefront copy (product pages and offer cards) updates automatically from this
                setting.
              </span>
            </li>
          </ul>

          {loading && (
            <p className="font-mono text-[10px] text-on-surface-variant animate-pulse">
              Loading current settings...
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
