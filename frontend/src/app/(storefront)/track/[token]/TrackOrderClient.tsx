"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import axios from "axios";
import {
  Package,
  Truck,
  CheckCircle2,
  Clock,
  Home,
  MapPin,
  ExternalLink,
  AlertCircle,
  ShieldAlert,
  ArrowRight,
  ShieldCheck,
  RefreshCw,
} from "lucide-react";
import { api } from "@/lib/api";

interface TrackingTimelineItem {
  stage: string;
  label: string;
  completed: boolean;
  timestamp?: string;
}

interface TrackingHistoryEvent {
  status: string;
  location?: string;
  description?: string;
  timestamp: string;
}

interface PublicTrackingData {
  orderNumber: string;
  status: string;
  createdAt: string;
  recipient: {
    maskedName: string;
    destinationCity: string;
    destinationState: string;
  };
  timeline: TrackingTimelineItem[];
  shipment?: {
    carrier: string;
    awbNumber: string;
    trackingUrl?: string;
    status: string;
    trackingHistory: TrackingHistoryEvent[];
  } | null;
  items: Array<{
    productName: string;
    productImage: string;
    selectedSize: string;
    selectedColor: string;
    quantity: number;
  }>;
}

interface TrackOrderClientProps {
  token: string;
}

export function TrackOrderClient({ token }: TrackOrderClientProps) {
  const [data, setData] = useState<PublicTrackingData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function fetchTracking() {
      setIsLoading(true);
      setErrorCode(null);
      setErrorMessage(null);

      // Validate 64-character hex format client-side before making request
      if (!token || !/^[a-f0-9]{64}$/i.test(token.trim())) {
        if (isMounted) {
          setErrorCode("INVALID_TOKEN");
          setErrorMessage("This tracking link is invalid or malformed.");
          setIsLoading(false);
        }
        return;
      }

      try {
        const res = await api.get(`/orders/public-track/${token.trim()}`);
        if (isMounted && res.data?.success && res.data.data) {
          setData(res.data.data);
        } else {
          throw new Error("Unable to retrieve tracking data.");
        }
      } catch (err: unknown) {
        if (!isMounted) return;
        if (axios.isAxiosError(err)) {
          const status = err.response?.status;
          const code = err.response?.data?.code;
          const msg = err.response?.data?.message;

          if (code === "TRACKING_REVOKED") {
            setErrorCode("REVOKED");
            setErrorMessage(msg || "This tracking link has been revoked by the purchaser.");
          } else if (code === "TRACKING_EXPIRED") {
            setErrorCode("EXPIRED");
            setErrorMessage(msg || "This tracking link has expired.");
          } else if (status === 429) {
            setErrorCode("RATE_LIMITED");
            setErrorMessage("Too many tracking requests. Please wait a moment and try again.");
          } else {
            setErrorCode("NOT_FOUND");
            setErrorMessage("Tracking information not found or link has expired.");
          }
        } else {
          setErrorCode("ERROR");
          setErrorMessage("An unexpected error occurred while loading delivery details.");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    fetchTracking();

    return () => {
      isMounted = false;
    };
  }, [token]);

  // Loading Skeleton State
  if (isLoading) {
    return (
      <main className="w-full max-w-4xl mx-auto px-4 py-16 flex flex-col items-center justify-center min-h-[60vh]">
        <div className="w-12 h-12 rounded-full bg-surface-container-high border border-outline-variant/40 flex items-center justify-center mb-4">
          <RefreshCw className="w-6 h-6 text-primary animate-spin" />
        </div>
        <h1 className="font-headline-sm text-xl font-black uppercase tracking-tight text-on-surface">
          Verifying Tracking Link...
        </h1>
        <p className="font-body-md text-xs sm:text-sm text-neutral-500 mt-1">
          Retrieving real-time dispatch and delivery status from courier network.
        </p>
      </main>
    );
  }

  // Error States (Invalid, Expired, Revoked, Not Found)
  if (errorCode || !data) {
    return (
      <main className="w-full max-w-xl mx-auto px-4 py-16 sm:py-24">
        <div className="bg-surface border border-outline-variant/40 rounded-2xl p-8 sm:p-10 shadow-lg text-center space-y-6">
          <div className="w-16 h-16 rounded-full mx-auto flex items-center justify-center bg-amber-500/10 text-amber-600">
            {errorCode === "REVOKED" ? (
              <ShieldAlert className="w-8 h-8" />
            ) : errorCode === "EXPIRED" ? (
              <Clock className="w-8 h-8" />
            ) : (
              <AlertCircle className="w-8 h-8" />
            )}
          </div>

          <div className="space-y-2">
            <h1 className="font-headline-sm text-2xl font-black uppercase tracking-tight text-on-surface">
              {errorCode === "REVOKED"
                ? "Tracking Access Revoked"
                : errorCode === "EXPIRED"
                ? "Tracking Link Expired"
                : errorCode === "RATE_LIMITED"
                ? "Rate Limit Reached"
                : "Tracking Link Not Found"}
            </h1>
            <p className="font-body-md text-xs sm:text-sm text-neutral-600 leading-relaxed max-w-md mx-auto">
              {errorMessage || "The tracking reference you requested is unavailable or has expired."}
            </p>
          </div>

          <div className="p-4 rounded-xl bg-surface-container-low border border-outline-variant/30 text-xs text-neutral-600 leading-relaxed text-left">
            <p className="font-bold text-on-surface mb-1 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>Security &amp; Privacy Policy</span>
            </p>
            Shareable tracking links automatically expire after 30 days and can be revoked at any time by the account owner who placed the order. If this is your order, please log in to view your complete order history.
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <Link
              href="/login"
              className="w-full sm:w-auto inline-flex items-center justify-center px-6 py-3 bg-neutral-950 text-white rounded-lg font-mono text-xs uppercase tracking-wider font-bold hover:bg-neutral-800 transition-colors"
            >
              Log In to Account
            </Link>
            <Link
              href="/shop"
              className="w-full sm:w-auto inline-flex items-center justify-center px-6 py-3 border border-outline-variant/80 text-on-surface rounded-lg font-mono text-xs uppercase tracking-wider font-bold hover:bg-neutral-100 transition-colors"
            >
              Continue Shopping
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const isDelivered = data.status === "DELIVERED" || data.shipment?.status === "DELIVERED";
  const isCancelled = data.status === "CANCELLED";

  return (
    <main className="w-full max-w-4xl mx-auto px-margin-mobile md:px-margin-desktop py-10 sm:py-16 space-y-8">
      {/* Header Banner */}
      <section className="bg-surface border border-outline-variant/30 rounded-2xl p-6 sm:p-8 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-outline-variant/20 pb-5">
          <div>
            <span className="font-mono text-[10px] sm:text-[11px] uppercase tracking-widest text-neutral-500 font-bold block mb-1">
              Live Order Tracking
            </span>
            <h1 className="font-headline-lg text-2xl sm:text-3xl font-black uppercase tracking-tight text-on-surface">
              Order #{data.orderNumber}
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full font-mono text-xs uppercase tracking-wider font-bold ${
                isDelivered
                  ? "bg-emerald-100 text-emerald-800"
                  : isCancelled
                  ? "bg-red-100 text-red-800"
                  : "bg-blue-100 text-blue-800"
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${isDelivered ? "bg-emerald-600" : isCancelled ? "bg-red-600" : "bg-blue-600 animate-pulse"}`}></span>
              <span>{data.status.replace(/_/g, " ")}</span>
            </span>
          </div>
        </div>

        {/* Destination & Privacy Mask */}
        <div className="flex flex-wrap items-center justify-between gap-4 text-xs font-mono">
          <div className="flex items-center gap-2 text-neutral-700">
            <MapPin className="w-4 h-4 text-neutral-500" />
            <span>
              Destination:{" "}
              <strong className="text-on-surface">
                {data.recipient.maskedName} • {data.recipient.destinationCity}, {data.recipient.destinationState}
              </strong>
            </span>
          </div>
          <span className="text-neutral-500">
            Ordered on: {new Date(data.createdAt).toLocaleDateString()}
          </span>
        </div>
      </section>

      {/* Delivery Progress Timeline */}
      {!isCancelled && (
        <section className="bg-surface border border-outline-variant/30 rounded-2xl p-6 sm:p-8 shadow-sm">
          <h2 className="font-headline-sm text-base font-black uppercase tracking-tight text-on-surface mb-6">
            Delivery Lifecycle
          </h2>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 relative">
            {data.timeline.map((step, idx) => {
              const Icon =
                idx === 0
                  ? CheckCircle2
                  : idx === 1
                  ? Clock
                  : idx === 2
                  ? Package
                  : idx === 3
                  ? Truck
                  : Home;

              return (
                <div key={step.stage} className="flex flex-col items-center text-center space-y-2">
                  <div
                    className={`w-11 h-11 rounded-full flex items-center justify-center transition-all ${
                      step.completed
                        ? "bg-neutral-950 text-white shadow-sm ring-4 ring-neutral-900/10"
                        : "bg-surface-container-high text-neutral-400 border border-outline-variant/60"
                    }`}
                  >
                    <Icon className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className={`font-mono text-xs uppercase font-bold tracking-wider ${
                      step.completed ? "text-on-surface" : "text-neutral-400"
                    }`}>
                      {step.label}
                    </h3>
                    {step.timestamp && (
                      <p className="font-mono text-[10px] text-neutral-500 mt-0.5">
                        {new Date(step.timestamp).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Courier & Waybill Information */}
      {data.shipment && (
        <section className="bg-surface border border-outline-variant/30 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-outline-variant/20 pb-5">
            <div>
              <span className="font-mono text-[10px] uppercase tracking-wider text-neutral-500 font-bold block mb-1">
                Logistics Partner
              </span>
              <h3 className="font-headline-sm text-lg font-black uppercase text-on-surface">
                {data.shipment.carrier}
              </h3>
              <p className="font-mono text-xs text-neutral-600 mt-0.5">
                AWB / Tracking No: <span className="font-bold text-neutral-950">{data.shipment.awbNumber}</span>
              </p>
            </div>

            {data.shipment.trackingUrl && (
              <a
                href={data.shipment.trackingUrl}
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="no-referrer"
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-neutral-950 hover:bg-neutral-800 text-white rounded-lg font-mono text-xs uppercase tracking-wider font-bold transition-colors"
              >
                <span>Track on Carrier Website</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>

          {/* Scanned Tracking Events (if available) */}
          {data.shipment.trackingHistory && data.shipment.trackingHistory.length > 0 && (
            <div className="space-y-3">
              <h4 className="font-mono text-xs uppercase tracking-wider font-bold text-neutral-500">
                Carrier Checkpoint Updates
              </h4>
              <div className="space-y-3 border-l-2 border-neutral-300 pl-4">
                {data.shipment.trackingHistory.slice(-5).reverse().map((evt, idx) => (
                  <div key={idx} className="relative pb-1">
                    <div className="flex items-center gap-2 font-mono text-xs font-bold text-on-surface">
                      <span>{evt.status.replace(/_/g, " ")}</span>
                      {evt.location && <span className="text-neutral-500 font-normal">({evt.location})</span>}
                    </div>
                    {evt.description && (
                      <p className="text-xs text-neutral-600 mt-0.5">{evt.description}</p>
                    )}
                    <span className="text-[10px] font-mono text-neutral-400">
                      {new Date(evt.timestamp).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Package Contents */}
      <section className="bg-surface border border-outline-variant/30 rounded-2xl overflow-hidden shadow-sm">
        <div className="px-6 py-4 bg-surface-container-low border-b border-outline-variant/30">
          <h2 className="font-headline-sm text-base font-black uppercase tracking-tight text-on-surface">
            Items in This Package ({data.items.length})
          </h2>
        </div>

        <div className="divide-y divide-outline-variant/20 p-6 space-y-4">
          {data.items.map((item, idx) => (
            <div key={idx} className="flex gap-4 sm:gap-6 items-center pt-3 first:pt-0">
              <div className="w-16 h-20 sm:w-20 sm:h-24 bg-surface-container-high rounded-lg overflow-hidden shrink-0 relative border border-outline-variant/40">
                <Image
                  src={item.productImage || "/placeholder.png"}
                  alt={item.productName}
                  fill
                  className="object-cover"
                />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-headline-sm text-sm sm:text-base font-bold text-on-surface truncate">
                  {item.productName}
                </h3>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-xs font-mono text-neutral-600">
                  <span>Size: <strong className="text-neutral-900">{item.selectedSize}</strong></span>
                  <span>Color: <strong className="text-neutral-900">{item.selectedColor}</strong></span>
                  <span>Qty: <strong className="text-neutral-900">{item.quantity}</strong></span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Footer Support Info */}
      <section className="p-6 rounded-2xl bg-surface-container-low border border-outline-variant/30 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          <h4 className="font-headline-sm text-sm font-bold text-on-surface">
            Have questions about this delivery?
          </h4>
          <p className="font-body-md text-xs text-neutral-500 mt-0.5">
            Our customer concierge team is available to assist with logistics inquiries.
          </p>
        </div>
        <Link
          href="/support"
          className="inline-flex items-center gap-1.5 font-mono text-xs font-bold uppercase tracking-wider text-primary hover:underline shrink-0"
        >
          <span>Contact Support</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </section>
    </main>
  );
}
