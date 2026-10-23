"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Package, X, Sparkles, MessageSquare } from "lucide-react";

interface BulkQuoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  productName: string;
  productId?: string;
  catalogItemId?: string;
  minQuantity?: number;
  customerRequirements?: string;
  selectedColor?: string;
}

export default function BulkQuoteModal({
  isOpen,
  onClose,
  productName,
  productId,
  catalogItemId,
  minQuantity = 10,
  customerRequirements,
  selectedColor,
}: BulkQuoteModalProps) {
  const router = useRouter();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "unset";
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleProceed = () => {
    onClose();
    const params = new URLSearchParams();
    if (productId) params.set("productId", productId);
    if (catalogItemId) params.set("catalogItemId", catalogItemId);
    if (selectedColor) params.set("color", selectedColor);
    if (customerRequirements && customerRequirements.trim()) {
      params.set("note", customerRequirements.trim());
    }
    const queryStr = params.toString();
    router.push(queryStr ? `/bulk-orders/request?${queryStr}` : "/bulk-orders/request");
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="bulk-quote-title"
      className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-surface-container-lowest p-6 md:p-8 shadow-2xl space-y-6 border border-outline-variant/30"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-outline-variant/20 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Package className="h-5 w-5" />
            </div>
            <div>
              <h2 id="bulk-quote-title" className="font-headline-sm text-lg font-bold text-on-surface">
                Corporate & Team Bulk Orders
              </h2>
              <p className="font-label-caps text-xs text-on-surface-variant">
                Minimum {minQuantity} units · Dedicated B2B Volume Pricing
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="h-10 w-10 rounded-full bg-surface-container-low text-on-surface-variant hover:text-on-surface flex items-center justify-center transition-colors cursor-pointer touch-target-base active:scale-95"
            aria-label="Close dialog"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 text-sm font-body-sm text-on-surface-variant">
          <p className="leading-relaxed">
            Planning a bulk printing run for <strong className="text-on-surface font-bold">{productName}</strong>? Our B2B production line offers tiered volume discounts, direct-to-film logo printing, and pre-production proofing.
          </p>

          <div className="rounded-xl border border-outline-variant/30 bg-surface-container-low p-4 space-y-2.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-bold text-on-surface">Minimum Order:</span>
              <span className="font-mono text-primary font-bold">{minQuantity} Units</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-bold text-on-surface">Artwork Formats:</span>
              <span>PNG, SVG, or Vector (300 DPI)</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-bold text-on-surface">Pre-Press Proofing:</span>
              <span className="text-emerald-700 font-bold flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5" />
                Digital Proof Included
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-bold text-on-surface">Formal Quote:</span>
              <span>Issued within 24 business hours</span>
            </div>
          </div>

          {customerRequirements && customerRequirements.trim() && (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-3.5 text-xs space-y-1.5">
              <div className="flex items-center gap-1.5 font-bold text-primary">
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Your Instructions Attached:</span>
              </div>
              <p className="text-on-surface line-clamp-3 italic">
                &ldquo;{customerRequirements.trim()}&rdquo;
              </p>
            </div>
          )}

          <p className="text-xs text-on-surface-variant">
            You will be guided to our canonical bulk inquiry form to specify exact size breakdowns, contact details, and upload high-resolution artwork files.
          </p>
        </div>

        <div className="flex flex-col-reverse sm:flex-row items-center justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto px-5 py-2.5 rounded-lg border border-outline-variant/40 font-label-caps text-xs text-on-surface hover:bg-surface-container-low transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleProceed}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-2.5 rounded-lg bg-neutral-900 font-label-caps text-xs text-white hover:bg-neutral-800 transition-colors shadow-sm cursor-pointer font-bold"
          >
            <span>Continue to Bulk Request</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
