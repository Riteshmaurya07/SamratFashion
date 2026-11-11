"use client";

import { useState } from "react";
import axios from "axios";
import { Share2, Copy, Check, MessageCircle, X, ShieldAlert, RefreshCw, ExternalLink } from "lucide-react";
import { api } from "@/lib/api";

interface ShareTrackingModalProps {
  orderId: string;
  orderNumber: string;
  initialToken?: string;
  isOpen: boolean;
  onClose: () => void;
}

export function ShareTrackingModal({
  orderId,
  orderNumber,
  initialToken,
  isOpen,
  onClose,
}: ShareTrackingModalProps) {
  const [token, setToken] = useState<string | null>(initialToken || null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRevoking, setIsRevoking] = useState(false);
  const [revoked, setRevoked] = useState(false);

  if (!isOpen) return null;

  const getBaseUrl = () => {
    if (typeof window !== "undefined") {
      return window.location.origin;
    }
    return process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  };

  const shareUrl = token ? `${getBaseUrl()}/track/${token}` : "";
  const shareText = `Track delivery progress for Samrat Fashion Order #${orderNumber} here: ${shareUrl}`;

  const fetchOrRegenerateToken = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.post(`/orders/${orderId}/tracking-token/regenerate`);
      const payload = res.data;
      const trackingToken = payload?.data?.trackingToken;

      // Responses across the API are not uniform: some use `success: true`,
      // others `status: "success"`. The token itself is the reliable signal.
      if (typeof trackingToken === "string" && trackingToken.length > 0) {
        setToken(trackingToken);
        setRevoked(false);
      } else {
        setError(
          typeof payload?.message === "string"
            ? payload.message
            : "Unable to create tracking link. Please try again."
        );
      }
    } catch (err: unknown) {
      let msg = "Unable to create tracking link. Please try again.";
      if (axios.isAxiosError(err)) {
        const serverMsg = err.response?.data?.message;
        if (typeof serverMsg === "string") msg = serverMsg;
      } else if (err instanceof Error) {
        msg = err.message;
      }
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyLink = async () => {
    if (!shareUrl) {
      await fetchOrRegenerateToken();
      return;
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2500);
    } catch {
      setError("Failed to copy link to clipboard.");
    }
  };

  const handleNativeShare = async () => {
    if (!token) {
      await fetchOrRegenerateToken();
      return;
    }
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: `Track Order #${orderNumber} | Samrat Fashion`,
          text: `Track the delivery progress of order #${orderNumber}:`,
          url: shareUrl,
        });
      } catch (err: unknown) {
        // User cancelled or share failed — fallback to copy
        if (!(err instanceof Error && err.name === "AbortError")) {
          handleCopyLink();
        }
      }
    } else {
      handleCopyLink();
    }
  };

  const handleWhatsAppShare = () => {
    if (!shareUrl) return;
    const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}`;
    window.open(waUrl, "_blank", "noopener,noreferrer");
  };

  const handleRevoke = async () => {
    if (!confirm("Are you sure you want to revoke this tracking link? Anyone with this link will no longer be able to track the package.")) {
      return;
    }
    setIsRevoking(true);
    setError(null);
    try {
      await api.post(`/orders/${orderId}/tracking-token/revoke`);
      setRevoked(true);
      setToken(null);
    } catch {
      setError("Failed to revoke tracking link. Please try again.");
    } finally {
      setIsRevoking(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="w-full max-w-md bg-surface border border-outline-variant/40 rounded-2xl p-6 shadow-2xl space-y-6 relative"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-tracking-title"
      >
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center text-primary">
              <Share2 className="w-5 h-5" />
            </div>
            <div>
              <h2 id="share-tracking-title" className="font-headline-sm text-lg font-black uppercase tracking-tight text-on-surface">
                Share Order Tracking
              </h2>
              <p className="font-mono text-xs text-on-surface-variant font-bold">
                Order #{orderNumber}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Privacy Note */}
        <div className="p-3.5 rounded-xl bg-surface-container-low border border-outline-variant/30 text-xs text-on-surface-variant leading-relaxed">
          <p className="font-bold text-on-surface mb-0.5">🔒 Privacy Protected</p>
          Recipients can view the live courier timeline and items in this package, but your private contact details, full address, and billing information are strictly hidden.
        </div>

        {/* Error State */}
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 font-mono">
            {error}
          </div>
        )}

        {/* Link Presentation or Generate Action */}
        {revoked ? (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-center space-y-3">
            <ShieldAlert className="w-8 h-8 text-amber-600 mx-auto" />
            <p className="text-xs text-amber-900 font-bold">Previous tracking link has been revoked.</p>
            <p className="text-xs text-amber-700">Need to share again? You can generate a new tracking link anytime.</p>
            <button
              type="button"
              disabled={isLoading}
              onClick={fetchOrRegenerateToken}
              className="inline-flex items-center gap-2 px-4 py-2 bg-neutral-950 text-white rounded-md font-mono text-xs uppercase font-bold hover:bg-neutral-800 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
              <span>Generate New Link</span>
            </button>
          </div>
        ) : shareUrl ? (
          <div className="space-y-4">
            <div>
              <label className="block font-mono text-[10px] text-neutral-500 uppercase tracking-wider font-bold mb-1.5">
                Public Tracking Link
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={shareUrl}
                  className="flex-1 bg-surface-container-low border border-outline-variant/60 rounded-lg px-3 py-2 text-xs font-mono text-on-surface select-all focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="px-3.5 py-2 bg-neutral-950 hover:bg-neutral-800 text-white rounded-lg font-mono text-xs uppercase font-bold flex items-center gap-1.5 transition-colors shrink-0"
                >
                  {isCopied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Quick Share Buttons */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
              <button
                type="button"
                onClick={handleWhatsAppShare}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-[#25D366] hover:bg-[#20ba59] text-white rounded-xl font-mono text-xs uppercase tracking-wider font-bold transition-all shadow-sm"
              >
                <MessageCircle className="w-4 h-4" />
                <span>Share via WhatsApp</span>
              </button>

              <button
                type="button"
                onClick={handleNativeShare}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-surface-container border border-outline-variant/60 hover:bg-surface-container-high text-on-surface rounded-xl font-mono text-xs uppercase tracking-wider font-bold transition-all"
              >
                <Share2 className="w-4 h-4" />
                <span>More Options</span>
              </button>
            </div>

            {/* Footer controls: Open link / Revoke */}
            <div className="pt-2 border-t border-outline-variant/20 flex items-center justify-between text-xs">
              <a
                href={shareUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[11px] text-neutral-600 hover:text-neutral-950 flex items-center gap-1 font-bold"
              >
                <span>Preview Page</span>
                <ExternalLink className="w-3 h-3" />
              </a>

              <button
                type="button"
                disabled={isRevoking}
                onClick={handleRevoke}
                className="font-mono text-[11px] text-red-600 hover:text-red-700 underline font-semibold disabled:opacity-50"
              >
                {isRevoking ? "Revoking..." : "Revoke Link"}
              </button>
            </div>
          </div>
        ) : (
          <div className="text-center py-6 space-y-4">
            <p className="font-body-md text-xs sm:text-sm text-neutral-600">
              Generate a shareable public tracking link valid for 30 days.
            </p>
            <button
              type="button"
              disabled={isLoading}
              onClick={fetchOrRegenerateToken}
              className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-neutral-950 hover:bg-neutral-800 text-white rounded-xl font-mono text-xs uppercase tracking-wider font-bold transition-all"
            >
              {isLoading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Generating Link...</span>
                </>
              ) : (
                <>
                  <Share2 className="w-4 h-4" />
                  <span>Create Shareable Link</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
