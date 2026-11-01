"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import {
  Truck,
  CheckCircle2,
  AlertCircle,
  Save,
  RotateCcw,
  ShieldAlert,
  Info,
} from "lucide-react";

interface ShippingSettings {
  globalFreeShippingThreshold: number;
  standardShippingFee: number;
  isGlobalFreeShippingActive: boolean;
  updatedAt?: string;
  updatedBy?: string;
}

function extractErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "response" in err) {
    const res = (err as Record<string, unknown>).response;
    if (res && typeof res === "object" && "data" in res) {
      const data = (res as Record<string, unknown>).data;
      if (data && typeof data === "object" && "message" in data && typeof (data as Record<string, unknown>).message === "string") {
        return (data as Record<string, unknown>).message as string;
      }
    }
  }
  if (err instanceof Error) {
    return err.message;
  }
  return fallback;
}

export default function AdminShippingSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<ShippingSettings>({
    globalFreeShippingThreshold: 999,
    standardShippingFee: 100,
    isGlobalFreeShippingActive: true,
  });
  const [savedSnapshot, setSavedSnapshot] = useState<ShippingSettings | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const fetchSettings = async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const res = await api.get("/admin/settings/shipping");
      if (res.data?.success && res.data?.data) {
        const data = res.data.data;
        const config: ShippingSettings = {
          globalFreeShippingThreshold: Number(data.globalFreeShippingThreshold ?? 999),
          standardShippingFee: Number(data.standardShippingFee ?? 100),
          isGlobalFreeShippingActive: Boolean(data.isGlobalFreeShippingActive ?? true),
          updatedAt: data.updatedAt,
          updatedBy: data.updatedBy,
        };
        setSettings(config);
        setSavedSnapshot(config);
      }
    } catch (err: unknown) {
      const errorMsg = extractErrorMessage(err, "Failed to load shipping settings");
      setFeedback({ type: "error", message: errorMsg });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    // Validation
    if (settings.globalFreeShippingThreshold < 0) {
      setFeedback({ type: "error", message: "Global free shipping threshold cannot be negative." });
      return;
    }
    if (settings.standardShippingFee < 0) {
      setFeedback({ type: "error", message: "Standard shipping fee cannot be negative." });
      return;
    }

    setSaving(true);
    try {
      const payload = {
        globalFreeShippingThreshold: Math.round(Number(settings.globalFreeShippingThreshold)),
        standardShippingFee: Math.round(Number(settings.standardShippingFee)),
        isGlobalFreeShippingActive: Boolean(settings.isGlobalFreeShippingActive),
      };

      const res = await api.put("/admin/settings/shipping", payload);
      if (res.data?.success && res.data?.data) {
        const updated = res.data.data;
        const newConfig: ShippingSettings = {
          globalFreeShippingThreshold: Number(updated.globalFreeShippingThreshold),
          standardShippingFee: Number(updated.standardShippingFee),
          isGlobalFreeShippingActive: Boolean(updated.isGlobalFreeShippingActive),
          updatedAt: updated.updatedAt,
          updatedBy: updated.updatedBy,
        };
        setSettings(newConfig);
        setSavedSnapshot(newConfig);
        setFeedback({
          type: "success",
          message: "Shipping settings updated successfully and logged in AuditLog.",
        });
      }
    } catch (err: unknown) {
      const errorMsg = extractErrorMessage(err, "Failed to save shipping settings");
      setFeedback({ type: "error", message: errorMsg });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (savedSnapshot) {
      setSettings(savedSnapshot);
      setFeedback(null);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-outline-variant/30 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="p-2 rounded-lg bg-primary/10 text-primary">
              <Truck className="w-5 h-5" />
            </span>
            <h1 className="text-xl sm:text-2xl font-black text-on-surface uppercase tracking-tight">
              Global Shipping Settings
            </h1>
          </div>
          <p className="text-xs sm:text-sm text-neutral-500 mt-1">
            Configure server-authoritative delivery rules, minimum order values, and standard delivery charges.
          </p>
        </div>

        {savedSnapshot && (
          <div className="text-left sm:text-right font-mono text-[11px] text-neutral-400">
            <span>Last Modified: </span>
            <span className="text-on-surface font-semibold">
              {savedSnapshot.updatedAt ? new Date(savedSnapshot.updatedAt).toLocaleString("en-IN") : "Default Configuration"}
            </span>
          </div>
        )}
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          role="alert"
          className={`p-4 rounded-xl flex items-start gap-3 text-xs sm:text-sm border ${
            feedback.type === "success"
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
              : "bg-red-500/10 border-red-500/30 text-red-400"
          }`}
        >
          {feedback.type === "success" ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-400" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
          )}
          <span className="leading-relaxed font-medium">{feedback.message}</span>
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center text-xs font-mono text-neutral-500">
          Loading shipping configuration...
        </div>
      ) : (
        <form onSubmit={handleSave} className="space-y-6">
          {/* Main Card */}
          <div className="bg-surface-container-low border border-outline-variant/40 rounded-2xl p-5 sm:p-7 space-y-6">
            <h2 className="font-mono text-xs uppercase tracking-wider font-bold text-primary flex items-center gap-2">
              <Info className="w-4 h-4 text-primary" />
              <span>Standard Delivery Policy</span>
            </h2>

            {/* Toggle: Enable Global Free Delivery */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-surface-container border border-outline-variant/30">
              <div className="space-y-1">
                <label htmlFor="toggle-free-shipping" className="text-sm font-bold text-on-surface block cursor-pointer">
                  Global Free Delivery Program
                </label>
                <p className="text-xs text-neutral-500 max-w-lg leading-relaxed">
                  When enabled, customers whose gross merchandise subtotal meets or exceeds the threshold receive ₹0 standard delivery.
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  id="toggle-free-shipping"
                  type="checkbox"
                  checked={settings.isGlobalFreeShippingActive}
                  onChange={(e) =>
                    setSettings({ ...settings, isGlobalFreeShippingActive: e.target.checked })
                  }
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-neutral-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-neutral-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
              </label>
            </div>

            {/* Threshold & Fee Inputs */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6">
              {/* Threshold */}
              <div className="space-y-2">
                <label
                  htmlFor="free-shipping-threshold"
                  className="block text-xs font-mono font-bold uppercase tracking-wider text-on-surface"
                >
                  Free Delivery Threshold (₹)
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-mono text-xs text-neutral-500">
                    ₹
                  </span>
                  <input
                    id="free-shipping-threshold"
                    type="number"
                    min="0"
                    step="1"
                    disabled={!settings.isGlobalFreeShippingActive}
                    value={settings.globalFreeShippingThreshold}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        globalFreeShippingThreshold: Number(e.target.value),
                      })
                    }
                    className="w-full bg-surface-container-lowest border border-outline-variant/60 rounded-xl py-2.5 pl-8 pr-4 text-sm font-mono text-on-surface focus:outline-none focus:border-primary disabled:opacity-50"
                  />
                </div>
                <p className="text-[11px] text-neutral-500 leading-relaxed">
                  Calculated against Gross Merchandise Subtotal before coupon discounts.
                </p>
              </div>

              {/* Standard Delivery Charge */}
              <div className="space-y-2">
                <label
                  htmlFor="standard-shipping-fee"
                  className="block text-xs font-mono font-bold uppercase tracking-wider text-on-surface"
                >
                  Standard Delivery Fee (₹)
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-mono text-xs text-neutral-500">
                    ₹
                  </span>
                  <input
                    id="standard-shipping-fee"
                    type="number"
                    min="0"
                    step="1"
                    value={settings.standardShippingFee}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        standardShippingFee: Number(e.target.value),
                      })
                    }
                    className="w-full bg-surface-container-lowest border border-outline-variant/60 rounded-xl py-2.5 pl-8 pr-4 text-sm font-mono text-on-surface focus:outline-none focus:border-primary"
                  />
                </div>
                <p className="text-[11px] text-neutral-500 leading-relaxed">
                  Fee charged on orders that do not qualify for free shipping.
                </p>
              </div>
            </div>

            {/* Policy Notes */}
            <div className="p-4 rounded-xl bg-surface-container/60 border border-outline-variant/30 space-y-2">
              <div className="flex items-center gap-2 text-primary font-mono text-xs font-bold uppercase">
                <ShieldAlert className="w-4 h-4 text-primary" />
                <span>Authoritative Enforcement Invariants</span>
              </div>
              <ul className="text-xs text-neutral-400 space-y-1 list-disc pl-4 leading-relaxed">
                <li>Server evaluates Gross Merchandise Subtotal before coupon discounts.</li>
                <li>Applying a discount coupon never revokes an earned free-delivery qualification.</li>
                <li>If configuration read fails, non-zero defaults (₹100 fee / ₹999 MOV) are enforced safely.</li>
              </ul>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={handleReset}
              disabled={saving}
              className="px-4 py-2.5 rounded-xl border border-outline-variant/50 hover:bg-surface-container font-mono text-xs uppercase tracking-wider font-bold text-neutral-400 hover:text-white transition-colors flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-white font-mono text-xs uppercase tracking-wider font-bold transition-all shadow-md active:scale-95 flex items-center gap-2 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              <span>{saving ? "Saving..." : "Save Settings"}</span>
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
