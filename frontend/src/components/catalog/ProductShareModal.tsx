"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { Check, Copy, Link2, Mail, Share2, X } from "lucide-react";

interface ProductShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  productName: string;
  productUrl: string;
  price: number;
  image?: string;
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
    </svg>
  );
}

function TelegramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
    </svg>
  );
}

function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073Z" />
    </svg>
  );
}

export function ProductShareModal({
  isOpen,
  onClose,
  productName,
  productUrl,
  price,
  image,
}: ProductShareModalProps) {
  const [isCopied, setIsCopied] = useState(false);
  const [canNativeShare, setCanNativeShare] = useState(false);

  const formattedPrice = price.toLocaleString("en-IN");
  const shareText = `Check out ${productName} at Samrat Fashion — ₹${formattedPrice}`;
  const shareMessage = `${shareText}\n${productUrl}`;

  useEffect(() => {
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      setCanNativeShare(true);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    setIsCopied(false);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  const openShareWindow = useCallback((url: string) => {
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  const copyLink = useCallback(async () => {
    if (!productUrl) return;

    try {
      await navigator.clipboard.writeText(productUrl);
    } catch {
      // Fallback for browsers/contexts without the async clipboard API.
      const textarea = document.createElement("textarea");
      textarea.value = productUrl;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }

    setIsCopied(true);
    window.setTimeout(() => setIsCopied(false), 2500);
  }, [productUrl]);

  const handleNativeShare = async () => {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: `${productName} | Samrat Fashion`,
          text: shareText,
          url: productUrl,
        });
      } catch (error: unknown) {
        if (!(error instanceof Error && error.name === "AbortError")) {
          copyLink();
        }
      }
    } else {
      copyLink();
    }
  };

  const shareTargets = [
    {
      label: "WhatsApp",
      icon: <WhatsAppIcon className="w-6 h-6" />,
      className: "bg-[#25D366] group-hover:bg-[#20ba59]",
      onClick: () =>
        openShareWindow(`https://api.whatsapp.com/send?text=${encodeURIComponent(shareMessage)}`),
    },
    {
      label: "Telegram",
      icon: <TelegramIcon className="w-6 h-6" />,
      className: "bg-[#229ED9] group-hover:bg-[#1d8dbf]",
      onClick: () =>
        openShareWindow(
          `https://t.me/share/url?url=${encodeURIComponent(productUrl)}&text=${encodeURIComponent(shareText)}`
        ),
    },
    {
      label: "Facebook",
      icon: <FacebookIcon className="w-6 h-6" />,
      className: "bg-[#1877F2] group-hover:bg-[#0f66d8]",
      onClick: () =>
        openShareWindow(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(productUrl)}`),
    },
    {
      label: "X",
      icon: <XIcon className="w-5 h-5" />,
      className: "bg-neutral-950 group-hover:bg-neutral-800",
      onClick: () =>
        openShareWindow(
          `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(productUrl)}`
        ),
    },
    {
      label: "Email",
      icon: <Mail className="w-5 h-5" />,
      className: "bg-surface-container-high text-on-surface group-hover:bg-surface-container border border-outline-variant/50",
      onClick: () =>
        openShareWindow(
          `mailto:?subject=${encodeURIComponent(`${productName} | Samrat Fashion`)}&body=${encodeURIComponent(shareMessage)}`
        ),
    },
    {
      label: isCopied ? "Copied" : "Copy link",
      icon: isCopied ? <Check className="w-5 h-5" /> : <Link2 className="w-5 h-5" />,
      className: isCopied
        ? "bg-emerald-600 text-white"
        : "bg-surface-container-high text-on-surface group-hover:bg-surface-container border border-outline-variant/50",
      onClick: copyLink,
    },
  ];

  if (!isOpen || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-product-title"
        onClick={(event) => event.stopPropagation()}
        className="w-full sm:max-w-md max-h-[92vh] overflow-y-auto bg-surface border border-outline-variant/40 rounded-t-2xl sm:rounded-2xl p-5 sm:p-6 shadow-2xl space-y-5 animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200"
      >
        {/* Mobile grab handle */}
        <div className="mx-auto -mt-1 mb-1 h-1 w-10 rounded-full bg-outline-variant/60 sm:hidden" />

        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center text-primary shrink-0">
              <Share2 className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2
                id="share-product-title"
                className="font-headline-sm text-lg font-black uppercase tracking-tight text-on-surface"
              >
                Share this product
              </h2>
              <p className="font-mono text-xs text-on-surface-variant font-bold truncate">
                {productName}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 transition-colors shrink-0"
            aria-label="Close share options"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Product Preview */}
        {image && (
          <div className="flex items-center gap-3 p-2.5 rounded-xl border border-outline-variant/30 bg-surface-container-lowest">
            <div className="relative w-12 h-14 rounded-md overflow-hidden bg-surface-container shrink-0">
              <Image
                src={image}
                alt={productName}
                fill
                sizes="48px"
                className="object-cover"
              />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold text-on-surface line-clamp-2 leading-snug">
                {productName}
              </p>
              <p className="font-mono text-sm font-black text-on-surface mt-0.5">
                ₹{formattedPrice}
              </p>
            </div>
          </div>
        )}

        {/* Share Targets */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-x-2 gap-y-4">
          {shareTargets.map((target) => (
            <button
              key={target.label}
              type="button"
              onClick={target.onClick}
              className="group flex flex-col items-center gap-1.5 focus:outline-none"
            >
              <span
                className={`w-12 h-12 rounded-full flex items-center justify-center text-white shadow-sm transition-all group-hover:scale-105 group-active:scale-95 group-focus-visible:ring-2 group-focus-visible:ring-primary group-focus-visible:ring-offset-2 ${target.className}`}
              >
                {target.icon}
              </span>
              <span className="font-mono text-[10px] uppercase tracking-wider font-bold text-on-surface-variant text-center leading-none">
                {target.label}
              </span>
            </button>
          ))}
        </div>

        {/* Link Preview + Copy */}
        <div className="space-y-1.5">
          <label className="block font-mono text-[10px] text-neutral-500 uppercase tracking-wider font-bold">
            Product link
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={productUrl}
              onFocus={(event) => event.currentTarget.select()}
              aria-label="Product share link"
              className="flex-1 min-w-0 bg-surface-container-low border border-outline-variant/60 rounded-lg px-3 py-2 text-xs font-mono text-on-surface select-all focus:outline-none focus:border-neutral-900"
            />
            <button
              type="button"
              onClick={copyLink}
              className={`px-3.5 py-2 rounded-lg font-mono text-xs uppercase font-bold flex items-center gap-1.5 transition-colors shrink-0 ${
                isCopied
                  ? "bg-emerald-600 text-white"
                  : "bg-neutral-950 hover:bg-neutral-800 text-white"
              }`}
            >
              {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{isCopied ? "Copied" : "Copy"}</span>
            </button>
          </div>
        </div>

        {/* Native device share (mobile browsers) */}
        {canNativeShare && (
          <button
            type="button"
            onClick={handleNativeShare}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-surface-container border border-outline-variant/60 hover:bg-surface-container-high text-on-surface rounded-xl font-mono text-xs uppercase tracking-wider font-bold transition-all"
          >
            <Share2 className="w-4 h-4" />
            <span>More sharing options</span>
          </button>
        )}
      </div>
    </div>,
    document.body
  );
}
