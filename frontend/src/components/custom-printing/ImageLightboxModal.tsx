"use client";

import React, { useEffect } from "react";

interface ImageLightboxModalProps {
  isOpen: boolean;
  onClose: () => void;
  images: string[];
  currentIndex: number;
  onIndexChange: (idx: number) => void;
}

export default function ImageLightboxModal({
  isOpen,
  onClose,
  images,
  currentIndex,
  onIndexChange,
}: ImageLightboxModalProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && currentIndex > 0) onIndexChange(currentIndex - 1);
      if (e.key === "ArrowRight" && currentIndex < images.length - 1) onIndexChange(currentIndex + 1);
    };
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "unset";
    };
  }, [isOpen, currentIndex, images.length, onClose, onIndexChange]);

  if (!isOpen || images.length === 0) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Garment image zoom modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 backdrop-blur-md animate-in fade-in duration-200"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-6 right-6 h-11 w-11 rounded-full bg-white/20 text-white hover:bg-white/40 flex items-center justify-center text-xl font-bold transition-all z-10"
        aria-label="Close image zoom"
      >
        ✕
      </button>

      {/* Prev button */}
      {images.length > 1 && currentIndex > 0 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onIndexChange(currentIndex - 1);
          }}
          className="absolute left-6 h-12 w-12 rounded-full bg-white/20 text-white hover:bg-white/40 flex items-center justify-center text-2xl font-bold transition-all z-10"
          aria-label="Previous image"
        >
          ‹
        </button>
      )}

      {/* Main Image */}
      <div className="relative max-h-[85vh] max-w-[85vw] overflow-hidden rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <img
          src={images[currentIndex]}
          alt={`Garment view ${currentIndex + 1}`}
          className="max-h-[85vh] max-w-[85vw] object-contain drop-shadow-2xl"
        />
      </div>

      {/* Next button */}
      {images.length > 1 && currentIndex < images.length - 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onIndexChange(currentIndex + 1);
          }}
          className="absolute right-6 h-12 w-12 rounded-full bg-white/20 text-white hover:bg-white/40 flex items-center justify-center text-2xl font-bold transition-all z-10"
          aria-label="Next image"
        >
          ›
        </button>
      )}

      {/* Indicator */}
      <div className="absolute bottom-6 rounded-full bg-black/60 px-4 py-1.5 text-xs text-white backdrop-blur-sm font-bold">
        {currentIndex + 1} / {images.length}
      </div>
    </div>
  );
}
