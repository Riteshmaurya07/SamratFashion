"use client";

import { useState } from "react";
import { api } from "@/lib/api";

export interface CourierOption {
  courierId: string;
  courierCode: string;
  courierName: string;
  courierDisplayName?: string;
  courierType?: string;
  tatDays?: number;
  zone?: string;
  totalRateRupees: number;
  totalRatePaise: number;
}

export interface ReverseShipmentData {
  _id?: string;
  awbNumber: string;
  carrier: string;
  courierId?: string;
  provider: string;
  mode: "NIMBUSPOST" | "MANUAL";
  status: string;
  trackingUrl?: string;
  bookedAt?: string;
  pickupAddress?: {
    fullName: string;
    phone: string;
    addressLine1: string;
    city: string;
    state: string;
    postalCode: string;
  };
  trackingHistory?: Array<{
    status: string;
    location?: string;
    description: string;
    timestamp: string;
  }>;
}

interface ReverseShippingManagerProps {
  returnId: string;
  orderId: string;
  returnStatus: string;
  defaultPickupAddress?: {
    fullName?: string;
    phone?: string;
    alternatePhone?: string;
    addressLine1?: string;
    addressLine2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
  };
  existingReverseShipment?: ReverseShipmentData | null;
  onRefresh: () => void;
}

export function ReverseShippingManager({
  returnId,
  returnStatus,
  defaultPickupAddress,
  existingReverseShipment,
  onRefresh,
}: ReverseShippingManagerProps) {
  const [shippingMode, setShippingMode] = useState<"NIMBUSPOST" | "MANUAL">("NIMBUSPOST");

  // Address inputs (allows confirmation / edit if customer is at a different location)
  const [fullName, setFullName] = useState(defaultPickupAddress?.fullName || "");
  const [phone, setPhone] = useState(defaultPickupAddress?.phone || "");
  const [addressLine1, setAddressLine1] = useState(defaultPickupAddress?.addressLine1 || "");
  const [city, setCity] = useState(defaultPickupAddress?.city || "");
  const [state, setState] = useState(defaultPickupAddress?.state || "");
  const [postalCode, setPostalCode] = useState(defaultPickupAddress?.postalCode || "");

  // Package measurement inputs
  const [weightGrams, setWeightGrams] = useState("500");
  const [lengthCm, setLengthCm] = useState("25");
  const [widthCm, setWidthCm] = useState("20");
  const [heightCm, setHeightCm] = useState("10");

  // Quotes and selection state
  const [quotesLoading, setQuotesLoading] = useState(false);
  const [quotesError, setQuotesError] = useState<string | null>(null);
  const [couriers, setCouriers] = useState<CourierOption[]>([]);
  const [selectedCourierId, setSelectedCourierId] = useState<string | null>(null);

  // Booking state
  const [bookingLoading, setBookingLoading] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);

  // Manual shipping inputs
  const [manualCarrier, setManualCarrier] = useState("");
  const [manualAwb, setManualAwb] = useState("");
  const [manualNote, setManualNote] = useState("");

  // 1. Fetch live reverse rates via NimbusPost V2
  const handleFetchReverseQuotes = async () => {
    const w = Number(weightGrams);
    const l = Number(lengthCm);
    const wi = Number(widthCm);
    const h = Number(heightCm);

    if (!postalCode || postalCode.trim().length !== 6) {
      setQuotesError("Please enter a valid 6-digit customer pickup PIN code.");
      return;
    }
    if (!w || w <= 0 || !l || l <= 0 || !wi || wi <= 0 || !h || h <= 0) {
      setQuotesError("Please enter valid parcel measurements (weight > 0g, dimensions > 0cm).");
      return;
    }

    setQuotesLoading(true);
    setQuotesError(null);

    try {
      const res = await api.post<{ success: boolean; data: { available: CourierOption[] } }>(
        `/admin/returns/${returnId}/reverse-quotes`,
        {
          pickupAddress: { postalCode: postalCode.trim() },
          packageDetails: { weightGrams: w, lengthCm: l, widthCm: wi, heightCm: h },
        }
      );

      if (res.data?.success) {
        const available = res.data.data.available || [];
        setCouriers(available);
        if (available.length > 0) {
          setSelectedCourierId(available[0].courierId);
        }
      }
    } catch (err: unknown) {
      const errObj = err && typeof err === "object" ? (err as Record<string, unknown>) : {};
      const response = errObj.response && typeof errObj.response === "object" ? (errObj.response as Record<string, unknown>) : undefined;
      const data = response?.data && typeof response.data === "object" ? (response.data as Record<string, unknown>) : undefined;
      const msg = typeof data?.message === "string" ? data.message : "Failed to query reverse courier rates.";
      setQuotesError(msg);
    } finally {
      setQuotesLoading(false);
    }
  };

  // 2. Book reverse pickup via NimbusPost V2
  const handleBookReversePickup = async () => {
    if (!fullName.trim() || !phone.trim() || !addressLine1.trim() || !city.trim() || !state.trim() || !postalCode.trim()) {
      setBookingError("All customer pickup address fields are required.");
      return;
    }

    const confirmed = window.confirm(
      "Confirm reverse courier booking with NimbusPost? This will dispatch a courier pickup to the customer's address and debit freight from your seller wallet."
    );
    if (!confirmed) return;

    setBookingLoading(true);
    setBookingError(null);

    try {
      await api.post(`/admin/returns/${returnId}/book-reverse-pickup`, {
        courierId: selectedCourierId || undefined,
        pickupAddress: {
          fullName: fullName.trim(),
          phone: phone.trim(),
          addressLine1: addressLine1.trim(),
          city: city.trim(),
          state: state.trim(),
          postalCode: postalCode.trim(),
          country: "India",
        },
        packageDetails: {
          weightGrams: Number(weightGrams) || 500,
          lengthCm: Number(lengthCm) || 25,
          widthCm: Number(widthCm) || 20,
          heightCm: Number(heightCm) || 10,
        },
      });

      onRefresh();
    } catch (err: unknown) {
      const errObj = err && typeof err === "object" ? (err as Record<string, unknown>) : {};
      const response = errObj.response && typeof errObj.response === "object" ? (errObj.response as Record<string, unknown>) : undefined;
      const data = response?.data && typeof response.data === "object" ? (response.data as Record<string, unknown>) : undefined;
      const msg = typeof data?.message === "string" ? data.message : "Failed to book reverse pickup with NimbusPost.";
      setBookingError(msg);
    } finally {
      setBookingLoading(false);
    }
  };

  // 3. Save manual / customer-arranged shipping
  const handleSaveManualShipping = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCarrier.trim()) {
      setBookingError("Carrier name is required.");
      return;
    }
    if (!manualAwb.trim()) {
      setBookingError("Tracking / AWB Number is required.");
      return;
    }

    setBookingLoading(true);
    setBookingError(null);

    try {
      await api.post(`/admin/returns/${returnId}/manual-shipping`, {
        carrier: manualCarrier.trim(),
        trackingNumber: manualAwb.trim(),
        adminNote: manualNote.trim() || undefined,
      });

      onRefresh();
    } catch (err: unknown) {
      const errObj = err && typeof err === "object" ? (err as Record<string, unknown>) : {};
      const response = errObj.response && typeof errObj.response === "object" ? (errObj.response as Record<string, unknown>) : undefined;
      const data = response?.data && typeof response.data === "object" ? (response.data as Record<string, unknown>) : undefined;
      const msg = typeof data?.message === "string" ? data.message : "Failed to save manual shipping details.";
      setBookingError(msg);
    } finally {
      setBookingLoading(false);
    }
  };

  const selectedCourier = couriers.find((c) => c.courierId === selectedCourierId);

  // If a reverse shipment already exists: display tracking information
  if (existingReverseShipment) {
    return (
      <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-outline-variant/20">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[20px]">local_shipping</span>
            <h3 className="font-headline-sm text-sm font-bold text-on-surface uppercase tracking-wide">
              Reverse Shipment (Active)
            </h3>
          </div>
          <span className="px-2.5 py-0.5 bg-primary/10 text-primary border border-primary/20 rounded font-mono text-[10px] font-bold uppercase">
            {existingReverseShipment.mode}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono">
          <div>
            <span className="text-neutral-400 block text-[10px] uppercase">Carrier</span>
            <span className="font-bold text-on-surface">{existingReverseShipment.carrier}</span>
          </div>
          <div>
            <span className="text-neutral-400 block text-[10px] uppercase">Reverse AWB</span>
            <span className="font-bold text-primary">{existingReverseShipment.awbNumber}</span>
          </div>
          <div>
            <span className="text-neutral-400 block text-[10px] uppercase">Transit Status</span>
            <span className="font-bold text-on-surface">{existingReverseShipment.status}</span>
          </div>
          <div>
            <span className="text-neutral-400 block text-[10px] uppercase">Destination</span>
            <span className="text-on-surface">Raebareli Warehouse (229402)</span>
          </div>
        </div>

        {existingReverseShipment.trackingUrl && (
          <div className="pt-2">
            <a
              href={existingReverseShipment.trackingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-mono font-bold text-primary hover:underline"
            >
              <span className="material-symbols-outlined text-[15px]">open_in_new</span>
              <span>Track Return Shipment via Courier</span>
            </a>
          </div>
        )}
      </div>
    );
  }

  // Only render booking configuration if return is in APPROVED status
  if (returnStatus !== "APPROVED") {
    return null;
  }

  return (
    <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl p-5 shadow-xs space-y-5">
      <div className="flex items-center justify-between pb-3 border-b border-outline-variant/20">
        <div>
          <h3 className="font-headline-sm text-sm font-bold text-on-surface uppercase tracking-wide flex items-center gap-1.5">
            <span className="material-symbols-outlined text-primary text-[20px]">swap_horizontal_circle</span>
            <span>Return Shipping Dispatch</span>
          </h3>
          <p className="text-[11px] text-neutral-500 font-mono mt-0.5">
            Book an automated courier pickup from the customer or record manual customer shipping.
          </p>
        </div>
      </div>

      {/* Mode Selector */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => { setShippingMode("NIMBUSPOST"); setBookingError(null); }}
          className={`py-2 px-3 text-xs font-mono font-bold uppercase rounded-lg border text-center transition-all cursor-pointer ${
            shippingMode === "NIMBUSPOST"
              ? "bg-neutral-900 text-white border-neutral-900 shadow-xs"
              : "bg-surface-container-low text-on-surface border-outline-variant/50 hover:bg-surface-container"
          }`}
        >
          Arrange Reverse Pickup (NimbusPost)
        </button>
        <button
          type="button"
          onClick={() => { setShippingMode("MANUAL"); setBookingError(null); }}
          className={`py-2 px-3 text-xs font-mono font-bold uppercase rounded-lg border text-center transition-all cursor-pointer ${
            shippingMode === "MANUAL"
              ? "bg-neutral-900 text-white border-neutral-900 shadow-xs"
              : "bg-surface-container-low text-on-surface border-outline-variant/50 hover:bg-surface-container"
          }`}
        >
          Customer Ships Product (Manual)
        </button>
      </div>

      {/* Option A: NimbusPost Reverse Courier Booking */}
      {shippingMode === "NIMBUSPOST" ? (
        <div className="space-y-4">
          {/* Customer Pickup Address Form */}
          <div className="space-y-2.5 p-3.5 bg-surface-container-low/40 rounded-xl border border-outline-variant/30">
            <h4 className="font-mono text-xs font-bold text-on-surface uppercase tracking-wider flex items-center gap-1">
              <span className="material-symbols-outlined text-[16px]">home_pin</span>
              <span>1. Customer Pickup Address</span>
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs font-mono">
              <div>
                <label className="text-[10px] text-neutral-500 uppercase block mb-1">Contact Name *</label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full px-3 py-1.5 bg-surface-container-lowest border border-outline-variant/40 rounded-lg text-on-surface"
                  required
                />
              </div>
              <div>
                <label className="text-[10px] text-neutral-500 uppercase block mb-1">Phone Number (10 digits) *</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-3 py-1.5 bg-surface-container-lowest border border-outline-variant/40 rounded-lg text-on-surface"
                  required
                />
              </div>
              <div className="sm:col-span-2">
                <label className="text-[10px] text-neutral-500 uppercase block mb-1">Address Line *</label>
                <input
                  type="text"
                  value={addressLine1}
                  onChange={(e) => setAddressLine1(e.target.value)}
                  className="w-full px-3 py-1.5 bg-surface-container-lowest border border-outline-variant/40 rounded-lg text-on-surface"
                  required
                />
              </div>
              <div>
                <label className="text-[10px] text-neutral-500 uppercase block mb-1">City &amp; State *</label>
                <input
                  type="text"
                  value={`${city}, ${state}`}
                  onChange={(e) => {
                    const parts = e.target.value.split(",");
                    setCity(parts[0]?.trim() || "");
                    if (parts[1]) setState(parts[1]?.trim() || "");
                  }}
                  className="w-full px-3 py-1.5 bg-surface-container-lowest border border-outline-variant/40 rounded-lg text-on-surface"
                  required
                />
              </div>
              <div>
                <label className="text-[10px] text-neutral-500 uppercase block mb-1">Postal PIN Code *</label>
                <input
                  type="text"
                  maxLength={6}
                  value={postalCode}
                  onChange={(e) => setPostalCode(e.target.value)}
                  className="w-full px-3 py-1.5 bg-surface-container-lowest border border-outline-variant/40 rounded-lg text-on-surface"
                  required
                />
              </div>
            </div>
          </div>

          {/* Return Parcel Measurements */}
          <div className="space-y-2.5 p-3.5 bg-surface-container-low/40 rounded-xl border border-outline-variant/30">
            <h4 className="font-mono text-xs font-bold text-on-surface uppercase tracking-wider flex items-center gap-1">
              <span className="material-symbols-outlined text-[16px]">inventory_2</span>
              <span>2. Return Parcel Measurements</span>
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
              <div>
                <label className="text-[10px] text-neutral-500 uppercase block mb-1">Weight (g) *</label>
                <input
                  type="number"
                  min="1"
                  value={weightGrams}
                  onChange={(e) => setWeightGrams(e.target.value)}
                  className="w-full px-3 py-1.5 bg-surface-container-lowest border border-outline-variant/40 rounded-lg text-on-surface"
                  required
                />
              </div>
              <div>
                <label className="text-[10px] text-neutral-500 uppercase block mb-1">L (cm) *</label>
                <input
                  type="number"
                  min="1"
                  value={lengthCm}
                  onChange={(e) => setLengthCm(e.target.value)}
                  className="w-full px-3 py-1.5 bg-surface-container-lowest border border-outline-variant/40 rounded-lg text-on-surface"
                  required
                />
              </div>
              <div>
                <label className="text-[10px] text-neutral-500 uppercase block mb-1">W (cm) *</label>
                <input
                  type="number"
                  min="1"
                  value={widthCm}
                  onChange={(e) => setWidthCm(e.target.value)}
                  className="w-full px-3 py-1.5 bg-surface-container-lowest border border-outline-variant/40 rounded-lg text-on-surface"
                  required
                />
              </div>
              <div>
                <label className="text-[10px] text-neutral-500 uppercase block mb-1">H (cm) *</label>
                <input
                  type="number"
                  min="1"
                  value={heightCm}
                  onChange={(e) => setHeightCm(e.target.value)}
                  className="w-full px-3 py-1.5 bg-surface-container-lowest border border-outline-variant/40 rounded-lg text-on-surface"
                  required
                />
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={handleFetchReverseQuotes}
                disabled={quotesLoading}
                className="px-4 py-1.5 bg-surface-container-high text-on-surface rounded-lg font-mono text-xs font-bold hover:bg-surface-container transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
              >
                {quotesLoading ? "Querying Couriers..." : "Check Reverse Courier Rates"}
              </button>
            </div>
          </div>

          {quotesError && (
            <p className="text-xs text-red-600 font-mono flex items-center gap-1">
              <span className="material-symbols-outlined text-[14px]">error</span>
              <span>{quotesError}</span>
            </p>
          )}

          {/* Reverse Couriers List */}
          {couriers.length > 0 && (
            <div className="space-y-3">
              <h4 className="font-mono text-xs font-bold text-on-surface uppercase tracking-wide">
                Available Reverse Couriers ({couriers.length})
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {couriers.map((courier) => {
                  const isSelected = selectedCourierId === courier.courierId;
                  return (
                    <div
                      key={courier.courierId}
                      onClick={() => setSelectedCourierId(courier.courierId)}
                      className={`p-3 rounded-xl border transition-all cursor-pointer flex justify-between items-center ${
                        isSelected
                          ? "border-primary bg-primary/[0.04] ring-1 ring-primary"
                          : "border-outline-variant/40 bg-surface-container-lowest hover:border-outline-variant"
                      }`}
                    >
                      <div>
                        <p className="font-mono font-bold text-xs text-on-surface">
                          {courier.courierDisplayName || courier.courierName}
                        </p>
                        <p className="text-[10px] text-neutral-500 font-mono">
                          Est. Transit: {courier.tatDays ? `${courier.tatDays} Days` : "Standard"}
                        </p>
                      </div>
                      <span className="font-mono font-bold text-xs text-on-surface">
                        ₹{courier.totalRateRupees.toFixed(2)}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Booking Confirmation Action */}
              <div className="p-4 bg-surface-container-low rounded-xl border border-outline-variant/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-3">
                <div>
                  <p className="font-mono font-bold text-xs text-on-surface">
                    Confirm Pickup with {selectedCourier?.courierDisplayName || selectedCourier?.courierName || "NimbusPost"}
                  </p>
                  <p className="text-[11px] text-neutral-500 font-mono mt-0.5">
                    Rate: ₹{(selectedCourier?.totalRateRupees || 0).toFixed(2)} | Destination: Raebareli Warehouse (229402)
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleBookReversePickup}
                  disabled={bookingLoading}
                  className="px-5 py-2 bg-primary text-on-primary rounded-lg font-mono text-xs uppercase font-bold hover:opacity-90 transition-opacity disabled:opacity-50 cursor-pointer shadow-xs shrink-0 flex items-center justify-center gap-1.5"
                >
                  {bookingLoading ? (
                    <>
                      <span className="material-symbols-outlined animate-spin text-[16px]">sync</span>
                      <span>Booking Pickup...</span>
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-[16px]">swap_horizontal_circle</span>
                      <span>Confirm &amp; Book Reverse Pickup</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {bookingError && (
            <div className="p-3 bg-red-50 text-red-700 border border-red-200 rounded-xl text-xs font-mono flex items-center gap-2">
              <span className="material-symbols-outlined text-[18px]">error</span>
              <span>{bookingError}</span>
            </div>
          )}
        </div>
      ) : (
        /* Option B: Manual Customer Shipping */
        <form onSubmit={handleSaveManualShipping} className="space-y-3.5 p-3.5 bg-surface-container-low/40 rounded-xl border border-outline-variant/30">
          <p className="text-[11px] text-neutral-600 font-mono">
            Use this option when the customer arranges return shipping themselves (e.g. via India Post / Speed Post or local courier).
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono">
            <div>
              <label className="text-[10px] text-neutral-500 uppercase block mb-1">Courier / Carrier Name *</label>
              <input
                type="text"
                value={manualCarrier}
                onChange={(e) => setManualCarrier(e.target.value)}
                placeholder="e.g. Speed Post, DTDC, Professional"
                className="w-full px-3 py-1.5 bg-surface-container-lowest border border-outline-variant/40 rounded-lg text-on-surface"
                required
              />
            </div>
            <div>
              <label className="text-[10px] text-neutral-500 uppercase block mb-1">Tracking / AWB Number *</label>
              <input
                type="text"
                value={manualAwb}
                onChange={(e) => setManualAwb(e.target.value)}
                placeholder="e.g. SP123456789IN"
                className="w-full px-3 py-1.5 bg-surface-container-lowest border border-outline-variant/40 rounded-lg text-on-surface"
                required
              />
            </div>
            <div className="sm:col-span-2">
              <label className="text-[10px] text-neutral-500 uppercase block mb-1">Admin Notes (Optional)</label>
              <input
                type="text"
                value={manualNote}
                onChange={(e) => setManualNote(e.target.value)}
                placeholder="e.g. Customer provided receipt via WhatsApp"
                className="w-full px-3 py-1.5 bg-surface-container-lowest border border-outline-variant/40 rounded-lg text-on-surface"
              />
            </div>
          </div>

          <div className="flex justify-end pt-1">
            <button
              type="submit"
              disabled={bookingLoading}
              className="px-4 py-2 bg-neutral-900 text-white rounded-lg font-mono text-xs uppercase font-bold hover:bg-neutral-800 transition-colors disabled:opacity-50 cursor-pointer"
            >
              {bookingLoading ? "Saving..." : "Save Manual Return Shipping"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
