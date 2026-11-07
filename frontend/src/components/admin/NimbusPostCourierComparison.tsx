"use client";

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";

export interface CourierOption {
  courierId: string;
  courierCode: string;
  courierName: string;
  courierDisplayName?: string;
  courierType?: string;
  tatDays?: number;
  zone?: string;
  zoneLabel?: string;
  chargeableWeightGrams: number;
  forwardRatePaise: number;
  codChargesPaise: number;
  surchargesPaise: number;
  totalRatePaise: number;
  totalRateRupees: number;
  autoPickup?: boolean;
}

export interface ExcludedCourierOption {
  courierId?: string;
  courierCode?: string;
  courierName: string;
  courierDisplayName?: string;
  reason: string;
  detail?: string;
}

export interface CourierQuoteData {
  quoteId: string;
  orderId: string;
  orderNumber: string;
  provider: string;
  originPostalCode: string;
  destinationPostalCode: string;
  paymentMode: "prepaid" | "cod";
  orderValuePaise: number;
  packageDetails: {
    weightGrams: number;
    lengthCm: number;
    widthCm: number;
    heightCm: number;
  };
  packageFingerprint: string;
  availableCouriers: CourierOption[];
  excludedCouriers: ExcludedCourierOption[];
  expiresAt: string;
  isExpired: boolean;
  isStale?: boolean;
  isPackageStale?: boolean;
  isFulfillmentReady?: boolean;
  staleReason?: string;
  createdAt?: string;
}

interface PackageDetails {
  weightGrams?: number;
  lengthCm?: number;
  widthCm?: number;
  heightCm?: number;
  isConfirmed?: boolean;
  confirmedAt?: string | Date;
}

interface FulfillmentData {
  _id?: string;
  status: string;
  packageDetails?: PackageDetails;
}

interface NimbusPostCourierComparisonProps {
  orderId: string;
  destinationPostalCode?: string;
  fulfillment?: FulfillmentData | null;
  onPackageConfirmed?: () => void;
}

const INITIAL_COURIER_COUNT = 4;

function sortCouriersByRate(couriers: CourierOption[] = []): CourierOption[] {
  return [...couriers].sort((a, b) => a.totalRatePaise - b.totalRatePaise);
}

export function NimbusPostCourierComparison({
  orderId,
  destinationPostalCode,
  fulfillment,
  onPackageConfirmed,
}: NimbusPostCourierComparisonProps) {
  // Package confirmation form state (empty by default to prevent treating model defaults as confirmed)
  const isInitiallyConfirmed = Boolean(fulfillment?.packageDetails?.isConfirmed);
  const [isEditingPackage, setIsEditingPackage] = useState(!isInitiallyConfirmed);

  const [inputWeight, setInputWeight] = useState(
    isInitiallyConfirmed ? String(fulfillment?.packageDetails?.weightGrams || "") : ""
  );
  const [inputLength, setInputLength] = useState(
    isInitiallyConfirmed ? String(fulfillment?.packageDetails?.lengthCm || "") : ""
  );
  const [inputWidth, setInputWidth] = useState(
    isInitiallyConfirmed ? String(fulfillment?.packageDetails?.widthCm || "") : ""
  );
  const [inputHeight, setInputHeight] = useState(
    isInitiallyConfirmed ? String(fulfillment?.packageDetails?.heightCm || "") : ""
  );

  const [packageSaving, setPackageSaving] = useState(false);
  const [packageError, setPackageError] = useState<string | null>(null);

  // Quote state
  const [loading, setLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quote, setQuote] = useState<CourierQuoteData | null>(null);
  const [selectedCourierId, setSelectedCourierId] = useState<string | null>(null);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [showExcluded, setShowExcluded] = useState(false);
  const [showAllCouriers, setShowAllCouriers] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);
  // Sync package fields when fulfillment prop updates
  useEffect(() => {
    if (fulfillment?.packageDetails?.isConfirmed) {
      setInputWeight(String(fulfillment.packageDetails.weightGrams || ""));
      setInputLength(String(fulfillment.packageDetails.lengthCm || ""));
      setInputWidth(String(fulfillment.packageDetails.widthCm || ""));
      setInputHeight(String(fulfillment.packageDetails.heightCm || ""));
      setIsEditingPackage(false);
    } else {
      setIsEditingPackage(true);
    }
  }, [fulfillment]);

  // Countdown timer for quote expiration
  useEffect(() => {
    if (!quote?.expiresAt) {
      setSecondsRemaining(null);
      return;
    }

    const updateTimer = () => {
      const now = Date.now();
      const expires = new Date(quote.expiresAt).getTime();
      const diff = Math.max(0, Math.floor((expires - now) / 1000));
      setSecondsRemaining(diff);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [quote]);

  // Load latest quote for this order
  const loadLatestQuote = useCallback(async () => {
    try {
      const res = await api.get<{ success: boolean; data: CourierQuoteData | null }>(
        `/admin/orders/${orderId}/courier-quotes/latest`
      );
      if (res.data?.success && res.data.data) {
        setQuote({
          ...res.data.data,
          availableCouriers: sortCouriersByRate(res.data.data.availableCouriers),
        });
      }
    } catch {
      // Ignore background latest quote lookup error
    }
  }, [orderId]);

  useEffect(() => {
    loadLatestQuote();
  }, [loadLatestQuote]);

  // Handle explicit package confirmation
  const handleConfirmPackageDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    const w = Number(inputWeight);
    const l = Number(inputLength);
    const wi = Number(inputWidth);
    const h = Number(inputHeight);

    if (!w || w <= 0) {
      setPackageError("Please enter a valid packed weight greater than 0 grams.");
      return;
    }
    if (!l || l <= 0 || !wi || wi <= 0 || !h || h <= 0) {
      setPackageError("Please enter valid parcel dimensions (length, width, height) greater than 0 cm.");
      return;
    }

    setPackageSaving(true);
    setPackageError(null);

    try {
      await api.post(`/admin/orders/${orderId}/fulfillment/package-details`, {
        weightGrams: w,
        lengthCm: l,
        widthCm: wi,
        heightCm: h,
      });

      setIsEditingPackage(false);
      if (onPackageConfirmed) {
        onPackageConfirmed();
      }
    } catch (err: unknown) {
      const errObj = err && typeof err === "object" ? (err as Record<string, unknown>) : {};
      const response = errObj.response && typeof errObj.response === "object" ? (errObj.response as Record<string, unknown>) : undefined;
      const data = response?.data && typeof response.data === "object" ? (response.data as Record<string, unknown>) : undefined;
      const msg = typeof data?.message === "string" ? data.message : "Failed to confirm package details.";
      setPackageError(msg);
    } finally {
      setPackageSaving(false);
    }
  };

  // Fetch live rates: Backend loads the database-confirmed package details
  const handleFetchQuotes = async () => {
    setLoading(true);
    setQuoteError(null);

    try {
      const res = await api.post<{ success: boolean; data: CourierQuoteData }>(
        `/admin/orders/${orderId}/courier-quotes`,
        {
          provider: "nimbuspost",
        }
      );

      if (res.data?.success && res.data.data) {
        const sortedCouriers = sortCouriersByRate(res.data.data.availableCouriers);
        setQuote({ ...res.data.data, availableCouriers: sortedCouriers });
        if (sortedCouriers.length > 0) {
          setSelectedCourierId(sortedCouriers[0].courierId);
        }
      }
    } catch (err: unknown) {
      const errObj = err && typeof err === "object" ? (err as Record<string, unknown>) : {};
      const response = errObj.response && typeof errObj.response === "object" ? (errObj.response as Record<string, unknown>) : undefined;
      const data = response?.data && typeof response.data === "object" ? (response.data as Record<string, unknown>) : undefined;
      const msg = typeof data?.message === "string" ? data.message : "Failed to fetch NimbusPost courier rates.";
      setQuoteError(msg);
    } finally {
      setLoading(false);
    }
  };
  // Handle booking shipment via NimbusPost
  const handleBookShipment = async () => {
    if (!selectedCourierId) return;
    setBookingLoading(true);
    setBookingError(null);

    try {
      await api.post(`/admin/orders/${orderId}/shipment`, {
        mode: "PROVIDER",
        provider: "nimbuspost",
        courierId: selectedCourierId,
        weightGrams: Number(fulfillment?.packageDetails?.weightGrams) || 500,
        lengthCm: Number(fulfillment?.packageDetails?.lengthCm) || 30,
        widthCm: Number(fulfillment?.packageDetails?.widthCm) || 25,
        heightCm: Number(fulfillment?.packageDetails?.heightCm) || 5,
      });

      if (onPackageConfirmed) {
        onPackageConfirmed();
      }
    } catch (err: unknown) {
      const errObj = err && typeof err === "object" ? (err as Record<string, unknown>) : {};
      const response = errObj.response && typeof errObj.response === "object" ? (errObj.response as Record<string, unknown>) : undefined;
      const data = response?.data && typeof response.data === "object" ? (response.data as Record<string, unknown>) : undefined;
      const msg = typeof data?.message === "string" ? data.message : "Failed to book shipment with NimbusPost.";
      setBookingError(msg);
    } finally {
      setBookingLoading(false);
    }
  };

  const selectedCourier = quote?.availableCouriers.find((c) => c.courierId === selectedCourierId);
  const isExpired = secondsRemaining !== null && secondsRemaining <= 0;
  const isConfirmed = Boolean(fulfillment?.packageDetails?.isConfirmed);

  const allCouriers = quote?.availableCouriers ?? [];
  const visibleCouriers = showAllCouriers
    ? allCouriers
    : allCouriers.slice(0, INITIAL_COURIER_COUNT);
  const hasMoreCouriers = allCouriers.length > INITIAL_COURIER_COUNT;

  const handleToggleCouriers = () => {
    if (showAllCouriers) {
      // Collapsing hides the extra options; keep the dispatch selection visible.
      const collapsedCouriers = allCouriers.slice(0, INITIAL_COURIER_COUNT);
      if (
        selectedCourierId &&
        !collapsedCouriers.some((courier) => courier.courierId === selectedCourierId)
      ) {
        setSelectedCourierId(collapsedCouriers[0]?.courierId ?? null);
      }
    }
    setShowAllCouriers((current) => !current);
  };

  return (
    <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-2xl p-4 sm:p-6 shadow-sm space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-outline-variant/20">
        <div>
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[22px]">compare_arrows</span>
            <h3 className="font-headline-sm text-base font-bold text-on-surface uppercase tracking-wide">
              Multi-Courier Rate Comparison
            </h3>
            <span className="px-2 py-0.5 bg-primary/10 text-primary border border-primary/20 rounded font-mono text-[10px] font-bold uppercase">
              NimbusPost V2
            </span>
          </div>
          <p className="font-body-sm text-xs text-on-surface-variant mt-1">
            Compare live freight rates and estimated delivery windows across integrated couriers before dispatching.
          </p>
        </div>

        {quote && !loading && isConfirmed && (
          <div className="flex items-center gap-2">
            {isExpired ? (
              <span className="px-2.5 py-1 bg-red-100 text-red-700 border border-red-200 rounded-md font-mono text-xs font-bold flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">timer_off</span>
                Quote Expired
              </span>
            ) : quote.isPackageStale ? (
              <span className="px-2.5 py-1 bg-amber-100 text-amber-900 border border-amber-300 rounded-md font-mono text-xs font-bold flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">update</span>
                Measurements Changed
              </span>
            ) : (
              <span className="px-2.5 py-1 bg-amber-50 text-amber-800 border border-amber-200 rounded-md font-mono text-xs font-semibold flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">schedule</span>
                Expires in {Math.floor((secondsRemaining || 0) / 60)}:
                {String((secondsRemaining || 0) % 60).padStart(2, "0")}
              </span>
            )}
            <button
              type="button"
              onClick={handleFetchQuotes}
              disabled={loading}
              className="px-3 py-1 bg-surface-container-high border border-outline-variant/30 text-on-surface rounded-lg font-mono text-xs font-bold hover:bg-surface-container transition-colors cursor-pointer"
            >
              Refresh Rates
            </button>
          </div>
        )}
      </div>

      {/* Package Confirmation Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="font-mono text-xs font-bold text-on-surface uppercase tracking-wide flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[18px]">inventory_2</span>
            <span>1. Packed Parcel Measurements</span>
          </h4>
          {isConfirmed && !isEditingPackage && (
            <button
              type="button"
              onClick={() => setIsEditingPackage(true)}
              className="text-xs font-mono font-bold text-primary hover:underline flex items-center gap-1 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[14px]">edit</span>
              Edit Measurements
            </button>
          )}
        </div>

        {/* If confirmed and not currently editing: show confirmed measurements banner */}
        {isConfirmed && !isEditingPackage ? (
          <div className="p-4 bg-surface-container-low/60 rounded-xl border border-outline-variant/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-green-600 text-[24px]">verified</span>
              <div>
                <p className="font-mono font-bold text-xs text-on-surface">
                  Confirmed: {fulfillment?.packageDetails?.weightGrams}g | {fulfillment?.packageDetails?.lengthCm} × {fulfillment?.packageDetails?.widthCm} × {fulfillment?.packageDetails?.heightCm} cm
                </p>
                <p className="text-[11px] text-neutral-500 font-mono mt-0.5">
                  Actual packed measurements verified in warehouse fulfillment record.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleFetchQuotes}
              disabled={loading}
              className="px-4 py-2 bg-neutral-900 text-white rounded-lg font-mono text-xs uppercase font-bold hover:bg-neutral-800 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer shadow-xs"
            >
              {loading ? (
                <>
                  <span className="material-symbols-outlined animate-spin text-[16px]">sync</span>
                  <span>Fetching Rates...</span>
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[16px]">search</span>
                  <span>Fetch Live Rates</span>
                </>
              )}
            </button>
          </div>
        ) : (
          /* Package Confirmation Form */
          <form onSubmit={handleConfirmPackageDetails} className="space-y-3 bg-surface-container-low/40 p-4 rounded-xl border border-outline-variant/30">
            <p className="text-[11px] text-on-surface-variant font-mono">
              Enter the exact, physical measurements of the packed parcel. Default values are not accepted for courier rate calculations.
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
              <div>
                <label className="block font-mono text-[11px] font-bold text-on-surface uppercase mb-1">
                  Weight (Grams) *
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  min="1"
                  max="50000"
                  value={inputWeight}
                  onChange={(e) => setInputWeight(e.target.value)}
                  disabled={packageSaving}
                  placeholder="e.g. 650"
                  className="w-full px-3 py-2 text-xs font-mono bg-surface-container-lowest border border-outline-variant/40 rounded-lg focus:outline-none focus:border-primary text-on-surface min-h-[40px]"
                  required
                />
              </div>
              <div>
                <label className="block font-mono text-[11px] font-bold text-on-surface uppercase mb-1">
                  Length (cm) *
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.5"
                  min="0.5"
                  max="200"
                  value={inputLength}
                  onChange={(e) => setInputLength(e.target.value)}
                  disabled={packageSaving}
                  placeholder="e.g. 30"
                  className="w-full px-3 py-2 text-xs font-mono bg-surface-container-lowest border border-outline-variant/40 rounded-lg focus:outline-none focus:border-primary text-on-surface min-h-[40px]"
                  required
                />
              </div>
              <div>
                <label className="block font-mono text-[11px] font-bold text-on-surface uppercase mb-1">
                  Width (cm) *
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.5"
                  min="0.5"
                  max="200"
                  value={inputWidth}
                  onChange={(e) => setInputWidth(e.target.value)}
                  disabled={packageSaving}
                  placeholder="e.g. 25"
                  className="w-full px-3 py-2 text-xs font-mono bg-surface-container-lowest border border-outline-variant/40 rounded-lg focus:outline-none focus:border-primary text-on-surface min-h-[40px]"
                  required
                />
              </div>
              <div>
                <label className="block font-mono text-[11px] font-bold text-on-surface uppercase mb-1">
                  Height (cm) *
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.5"
                  min="0.5"
                  max="200"
                  value={inputHeight}
                  onChange={(e) => setInputHeight(e.target.value)}
                  disabled={packageSaving}
                  placeholder="e.g. 8"
                  className="w-full px-3 py-2 text-xs font-mono bg-surface-container-lowest border border-outline-variant/40 rounded-lg focus:outline-none focus:border-primary text-on-surface min-h-[40px]"
                  required
                />
              </div>
            </div>

            {packageError && (
              <p className="text-xs text-red-600 font-mono flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">error</span>
                {packageError}
              </p>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              {isConfirmed && (
                <button
                  type="button"
                  onClick={() => setIsEditingPackage(false)}
                  disabled={packageSaving}
                  className="px-3 py-1.5 text-xs font-mono font-bold text-neutral-600 hover:text-black cursor-pointer"
                >
                  Cancel
                </button>
              )}
              <button
                type="submit"
                disabled={packageSaving}
                className="px-4 py-1.5 bg-primary text-on-primary rounded-lg font-mono text-xs uppercase font-bold hover:opacity-90 transition-opacity flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
              >
                {packageSaving ? "Saving..." : "Confirm Parcel Measurements"}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Quote Error Message */}
      {quoteError && (
        <div className="p-3 bg-red-50 text-red-700 border border-red-200 rounded-xl text-xs font-mono flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">error</span>
          <span>{quoteError}</span>
        </div>
      )}

      {/* Stale Quote Alert */}
      {quote && quote.isPackageStale && (
        <div className="p-3.5 bg-amber-50 text-amber-900 border border-amber-300 rounded-xl text-xs font-mono flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-amber-700">update</span>
            <span>Package measurements have changed since this quote was calculated. Please refresh rates.</span>
          </div>
          <button
            type="button"
            onClick={handleFetchQuotes}
            disabled={loading}
            className="px-3 py-1 bg-amber-200 text-amber-900 font-bold rounded hover:bg-amber-300 transition-colors cursor-pointer text-[11px]"
          >
            Refresh Now
          </button>
        </div>
      )}

      {/* Available Couriers List */}
      {quote && !quote.isPackageStale && (
        <div className="space-y-4 pt-2">
          <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <h4 className="font-mono text-xs font-bold text-on-surface uppercase tracking-wide">
              Available Couriers ({quote.availableCouriers.length})
              {hasMoreCouriers && !showAllCouriers && (
                <span className="ml-2 normal-case tracking-normal text-[10px] font-semibold text-neutral-500">
                  showing top {visibleCouriers.length}
                </span>
              )}
            </h4>
            <span className="text-[11px] text-neutral-500 font-mono break-words">
              Mode: PREPAID | Destination: {quote.destinationPostalCode} | Pickup: {quote.originPostalCode}
            </span>
          </div>

          {quote.availableCouriers.length === 0 ? (
            <div className="p-6 bg-surface-container-low rounded-xl border border-outline-variant/30 text-center space-y-2">
              <span className="material-symbols-outlined text-neutral-400 text-[32px]">local_shipping</span>
              <p className="font-mono text-xs font-bold text-neutral-700">No Serviceable Couriers Found</p>
              <p className="text-[11px] text-neutral-500 max-w-md mx-auto">
                No courier partners on your NimbusPost account service the route from {quote.originPostalCode} to{" "}
                {quote.destinationPostalCode} for prepaid mode.
              </p>
            </div>
          ) : (
            <div id="courier-options-list" className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-3 sm:gap-3.5">
              {visibleCouriers.map((courier) => {
                const isSelected = selectedCourierId === courier.courierId;
                const isAir = courier.courierType?.toLowerCase() === "air";
                return (
                  <div
                    key={courier.courierId}
                    onClick={() => setSelectedCourierId(courier.courierId)}
                    className={`p-3.5 sm:p-4 rounded-xl border transition-all cursor-pointer flex flex-col justify-between space-y-3 relative active:scale-[0.99] ${
                      isSelected
                        ? "border-primary bg-primary/[0.04] ring-2 ring-primary shadow-sm"
                        : "border-outline-variant/40 bg-surface-container-lowest hover:border-outline-variant/80 hover:bg-surface-container-low/30"
                    }`}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div className="pr-2 min-w-0 flex-1">
                          <p className="font-mono font-bold text-xs text-on-surface leading-tight truncate">
                            {courier.courierDisplayName || courier.courierName}
                          </p>
                          <p className="text-[10px] text-neutral-400 font-mono mt-0.5 truncate">
                            Code: {courier.courierCode}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {isAir ? (
                            <span className="px-2 py-0.5 bg-sky-50 text-sky-700 border border-sky-200 rounded font-mono text-[9px] uppercase font-bold flex items-center gap-1">
                              <span className="material-symbols-outlined text-[12px]">flight</span>Air
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 bg-neutral-100 text-neutral-700 border border-neutral-200 rounded font-mono text-[9px] uppercase font-bold flex items-center gap-1">
                              <span className="material-symbols-outlined text-[12px]">local_shipping</span>Surface
                            </span>
                          )}
                          {isSelected && (
                            <span className="material-symbols-outlined text-primary text-[18px]">check_circle</span>
                          )}
                        </div>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] font-mono text-neutral-600">
                        <div>
                          <span className="text-neutral-400 text-[10px] block">Est. Delivery</span>
                          <span className="font-semibold text-on-surface">
                            {courier.tatDays !== undefined ? `${courier.tatDays} Days` : "Standard"}
                          </span>
                        </div>
                        <div>
                          <span className="text-neutral-400 text-[10px] block">Zone</span>
                          <span className="font-semibold text-on-surface">
                            {courier.zoneLabel || courier.zone || "National"}
                          </span>
                        </div>
                      </div>
                    </div>
                  <div className="pt-3 border-t border-outline-variant/20 flex items-end justify-between">
                    <div className="text-[10px] font-mono text-neutral-500">
                      <span>Fwd: ₹{(courier.forwardRatePaise / 100).toFixed(2)}</span>
                      {courier.codChargesPaise > 0 && (
                        <span className="ml-1.5">COD: ₹{(courier.codChargesPaise / 100).toFixed(2)}</span>
                      )}
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] font-mono text-neutral-400 block uppercase">Courier Freight</span>
                      <span className="font-mono font-bold text-sm text-neutral-900">
                        ₹{courier.totalRateRupees.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

          {/* Expand / collapse courier list */}
          {quote.availableCouriers.length > INITIAL_COURIER_COUNT && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={handleToggleCouriers}
                aria-expanded={showAllCouriers}
                aria-controls="courier-options-list"
                className="w-full sm:w-auto px-5 py-2.5 min-h-[44px] bg-surface-container-low border border-outline-variant/40 text-on-surface rounded-xl font-mono text-xs font-bold uppercase tracking-wide flex items-center justify-center gap-2 hover:bg-surface-container transition-colors cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px] text-primary">
                  {showAllCouriers ? "expand_less" : "expand_more"}
                </span>
                {showAllCouriers
                  ? "Show fewer couriers"
                  : `See all ${quote.availableCouriers.length} couriers`}
              </button>
            </div>
          )}

          {/* Dispatch Action Section */}
          {selectedCourier && (
            <div className="p-4 bg-surface-container-low rounded-xl border border-outline-variant/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <p className="font-mono font-bold text-xs text-on-surface">
                  Ready to Dispatch via {selectedCourier.courierDisplayName || selectedCourier.courierName}
                </p>
                <p className="text-[11px] text-neutral-500 font-mono mt-0.5">
                  Freight: ₹{selectedCourier.totalRateRupees.toFixed(2)} | Delivery: {selectedCourier.tatDays ?? 3} Days | Mode: {(selectedCourier.courierType || "Surface").toUpperCase()}
                </p>
              </div>

              <button
                type="button"
                onClick={handleBookShipment}
                disabled={bookingLoading || isExpired || quote.isPackageStale}
                className="px-5 py-2.5 bg-primary text-on-primary rounded-lg font-mono text-xs uppercase font-bold hover:opacity-90 transition-opacity flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer shadow-sm shrink-0"
              >
                {bookingLoading ? (
                  <>
                    <span className="material-symbols-outlined animate-spin text-[16px]">sync</span>
                    <span>Booking via NimbusPost...</span>
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-[16px]">local_shipping</span>
                    <span>Book &amp; Dispatch ({selectedCourier.courierName})</span>
                  </>
                )}
              </button>
            </div>
          )}

          {bookingError && (
            <div className="p-3.5 bg-red-50 text-red-700 border border-red-200 rounded-xl text-xs font-mono flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[20px] text-red-600 shrink-0">account_balance_wallet</span>
                <span>{bookingError}</span>
              </div>
              {bookingError.toLowerCase().includes("wallet") && (
                <a
                  href="https://dashboard.nimbuspost.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 bg-red-600 text-white font-bold rounded-lg hover:bg-red-700 transition-colors shrink-0 text-center uppercase tracking-wider text-[11px]"
                >
                  Recharge Wallet ↗
                </a>
              )}
            </div>
          )}

          {/* Excluded Couriers Accordion */}
          {quote.excludedCouriers.length > 0 && (
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setShowExcluded(!showExcluded)}
                className="w-full py-2 px-3 bg-surface-container-low text-on-surface rounded-xl border border-outline-variant/30 font-mono text-xs flex items-center justify-between hover:bg-surface-container transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px] text-neutral-500">info</span>
                  <span>Excluded Ineligible Couriers ({quote.excludedCouriers.length})</span>
                </span>
                <span className="material-symbols-outlined text-[18px]">
                  {showExcluded ? "expand_less" : "expand_more"}
                </span>
              </button>

              {showExcluded && (
                <div className="mt-2 divide-y divide-outline-variant/20 border border-outline-variant/30 rounded-xl overflow-hidden bg-surface-container-lowest">
                  {quote.excludedCouriers.map((excluded, idx) => (
                    <div key={idx} className="p-3 text-xs font-mono flex items-start justify-between gap-3">
                      <div>
                        <p className="font-bold text-neutral-800">{excluded.courierName}</p>
                        {excluded.detail && (
                          <p className="text-[11px] text-neutral-500 mt-0.5">{excluded.detail}</p>
                        )}
                      </div>
                      <span className="px-2 py-0.5 bg-neutral-100 text-neutral-600 rounded text-[10px] font-bold uppercase shrink-0">
                        {excluded.reason}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Operational notice */}
          <div className="p-3 bg-surface-container-low text-neutral-600 border border-outline-variant/30 rounded-xl text-xs font-mono flex items-center gap-2">
            <span className="material-symbols-outlined text-[18px] text-primary">verified</span>
            <span>
              <strong>Integrated NimbusPost Fulfillment:</strong> Selecting a courier partner automatically books the shipment, captures the official carrier AWB, and generates the thermal shipping label.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
