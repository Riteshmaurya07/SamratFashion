"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { api } from "@/lib/api";

export interface HeroBannerItem {
  _id?: string;
  title?: string;
  subtitle?: string;
  image: string;
  mobileImage?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  position?: string;
  displayOrder?: number;
  status?: string;
  textColor?: "LIGHT" | "DARK";
  textAlignment?: "LEFT" | "CENTER" | "RIGHT";
  overlayStrength?: "NONE" | "LIGHT" | "MEDIUM" | "HEAVY";
  targetAudience?: "ALL" | "RETAIL" | "B2B_CUSTOM";
  campaignTag?: string;
}

interface HeroBannerSliderProps {
  banners: HeroBannerItem[];
  autoplayIntervalMs?: number;
  className?: string;
}

export function HeroBannerSlider({
  banners = [],
  autoplayIntervalMs = 5500,
  className = "",
}: HeroBannerSliderProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [isPaused, setIsPaused] = useState(false);

  const slideCount = banners.length;
  const touchStartX = useRef<number | null>(null);
  const touchEndX = useRef<number | null>(null);
  const trackedBannerIds = useRef<Set<string>>(new Set());

  // Track impressions per active slide once per session
  useEffect(() => {
    if (slideCount === 0) return;
    const currentBanner = banners[currentIndex];
    if (currentBanner?._id && !trackedBannerIds.current.has(currentBanner._id)) {
      trackedBannerIds.current.add(currentBanner._id);
      api.post(`/catalog/banners/${currentBanner._id}/impression`).catch(() => {});
    }
  }, [currentIndex, banners, slideCount]);

  const handleBannerClick = (bannerId?: string) => {
    if (bannerId) {
      api.post(`/catalog/banners/${bannerId}/click`).catch(() => {});
    }
  };

  const handleNext = useCallback(() => {
    if (slideCount <= 1) return;
    setDirection(1);
    setCurrentIndex((prev) => (prev === slideCount - 1 ? 0 : prev + 1));
  }, [slideCount]);

  const handlePrev = useCallback(() => {
    if (slideCount <= 1) return;
    setDirection(-1);
    setCurrentIndex((prev) => (prev === 0 ? slideCount - 1 : prev - 1));
  }, [slideCount]);

  const handleDotClick = (idx: number) => {
    if (idx === currentIndex) return;
    setDirection(idx > currentIndex ? 1 : -1);
    setCurrentIndex(idx);
  };

  // Autoplay timer
  useEffect(() => {
    if (slideCount <= 1 || isPaused) return;
    const timer = setInterval(() => {
      handleNext();
    }, autoplayIntervalMs);

    return () => clearInterval(timer);
  }, [slideCount, isPaused, autoplayIntervalMs, handleNext]);

  // Touch handlers for mobile horizontal swipe
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.targetTouches[0].clientX;
    setIsPaused(true);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    touchEndX.current = e.targetTouches[0].clientX;
  };

  const onTouchEnd = () => {
    if (touchStartX.current !== null && touchEndX.current !== null) {
      const distance = touchStartX.current - touchEndX.current;
      const minSwipeDistance = 45;
      if (distance > minSwipeDistance) {
        handleNext();
      } else if (distance < -minSwipeDistance) {
        handlePrev();
      }
    }
    touchStartX.current = null;
    touchEndX.current = null;
    setIsPaused(false);
  };

  if (slideCount === 0) {
    return null;
  }

  const currentBanner = banners[currentIndex];
  const isDarkText = currentBanner.textColor === "DARK";
  const hasContent = Boolean(
    currentBanner.title ||
    currentBanner.subtitle ||
    currentBanner.ctaLabel ||
    currentBanner.campaignTag
  );

  // Overlay gradient computation: kept directional (bottom-to-top) so upper portion of banner artwork remains visible
  const getOverlayClass = () => {
    if (currentBanner.overlayStrength === "NONE") return null;

    if (isDarkText) {
      switch (currentBanner.overlayStrength) {
        case "LIGHT":
          return "bg-gradient-to-t from-white/70 via-white/25 to-transparent";
        case "HEAVY":
          return "bg-gradient-to-t from-white/95 via-white/60 to-white/15";
        default: // MEDIUM
          return "bg-gradient-to-t from-white/85 via-white/40 to-transparent";
      }
    }

    switch (currentBanner.overlayStrength) {
      case "LIGHT":
        return "bg-gradient-to-t from-neutral-950/75 via-neutral-950/25 to-transparent";
      case "HEAVY":
        return "bg-gradient-to-t from-neutral-950/95 via-neutral-950/65 to-neutral-950/20";
      default: // MEDIUM
        return "bg-gradient-to-t from-neutral-950/85 via-neutral-950/45 to-transparent";
    }
  };

  const overlayClass = getOverlayClass();

  return (
    <section
      aria-label="Hero Highlights and Campaigns Carousel"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      className={`relative w-full min-h-[500px] sm:min-h-[560px] md:min-h-[600px] lg:h-[700px] bg-neutral-950 overflow-hidden group ${className}`}
    >
      {/* Animated Slide Canvas */}
      <AnimatePresence initial={false} custom={direction}>
        <motion.div
          key={currentIndex}
          custom={direction}
          variants={{
            enter: (dir: number) => ({
              opacity: 0,
              x: dir > 0 ? 30 : -30,
            }),
            center: {
              zIndex: 1,
              opacity: 1,
              x: 0,
            },
            exit: (dir: number) => ({
              zIndex: 0,
              opacity: 0,
              x: dir > 0 ? -30 : 30,
            }),
          }}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{
            opacity: { duration: 0.45, ease: "easeInOut" },
            x: { duration: 0.45, ease: "easeOut" },
          }}
          className="absolute inset-0 w-full h-full"
        >
          {/* 1. Background Image (Absolute fill) */}
          <div className="absolute inset-0 w-full h-full">
            {currentBanner.mobileImage ? (
              <>
                <div className="relative w-full h-full hidden sm:block">
                  <Image
                    src={currentBanner.image}
                    alt={currentBanner.title || "Streetwear Banner"}
                    fill
                    priority={currentIndex === 0}
                    sizes="100vw"
                    className="object-cover object-center"
                  />
                </div>
                <div className="relative w-full h-full block sm:hidden">
                  <Image
                    src={currentBanner.mobileImage}
                    alt={currentBanner.title || "Streetwear Banner"}
                    fill
                    priority={currentIndex === 0}
                    sizes="100vw"
                    className="object-cover object-center"
                  />
                </div>
              </>
            ) : (
              <div className="relative w-full h-full">
                <Image
                  src={currentBanner.image}
                  alt={currentBanner.title || "Streetwear Banner"}
                  fill
                  priority={currentIndex === 0}
                  sizes="100vw"
                  className="object-cover object-center"
                />
              </div>
            )}
          </div>

          {/* 2. Focused Scrim: protects text readability without darkening entire image */}
          {overlayClass && (
            <div className={`absolute inset-0 pointer-events-none transition-opacity ${overlayClass}`} />
          )}

          {/* 3. Foreground Content: Title, Subtitle, Shop Now & Offers Buttons */}
          {hasContent && (
            <div className="absolute inset-0 z-10 w-full h-full flex flex-col justify-end pointer-events-none">
              <div className="w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop pb-14 sm:pb-16 md:pb-20">
                <motion.div
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.08, ease: "easeOut" }}
                  className={`pointer-events-auto max-w-3xl space-y-3 sm:space-y-4 ${
                    currentBanner.textAlignment === "CENTER"
                      ? "mx-auto text-center flex flex-col items-center"
                      : currentBanner.textAlignment === "RIGHT"
                      ? "ml-auto text-right flex flex-col items-end"
                      : "text-left"
                  }`}
                >
                  {/* Campaign / Drop Tag */}
                  {currentBanner.campaignTag && (
                    <div
                      className={`inline-flex items-center gap-2 px-3 py-1 rounded-full backdrop-blur-md ${
                        isDarkText
                          ? "bg-neutral-900/10 border border-neutral-900/20 text-neutral-900"
                          : "bg-white/10 border border-white/20 text-white"
                      }`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                      <span className="font-mono text-[10px] sm:text-[11px] tracking-[0.16em] uppercase font-bold">
                        {currentBanner.campaignTag}
                      </span>
                    </div>
                  )}

                  {/* Banner Title */}
                  {currentBanner.title && (
                    <h1
                      className={`font-headline-lg text-3xl sm:text-5xl lg:text-6xl font-black uppercase tracking-[-0.03em] leading-[1.02] drop-shadow-[0_2px_8px_rgba(0,0,0,0.5)] ${
                        isDarkText ? "text-neutral-950 drop-shadow-none" : "text-white"
                      }`}
                    >
                      {currentBanner.title.replace(/\s*\/\/\s*/g, " · ")}
                    </h1>
                  )}

                  {/* Banner Subtitle */}
                  {currentBanner.subtitle && (
                    <p
                      className={`font-body-md text-sm sm:text-base md:text-lg max-w-xl line-clamp-2 leading-relaxed drop-shadow-[0_1px_4px_rgba(0,0,0,0.6)] ${
                        isDarkText ? "text-neutral-800 drop-shadow-none" : "text-neutral-200"
                      }`}
                    >
                      {currentBanner.subtitle}
                    </p>
                  )}

                  {/* Shop Now & View Offers Buttons */}
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-2 sm:pt-3">
                    <Link
                      href={currentBanner.ctaUrl || "/shop"}
                      onClick={() => handleBannerClick(currentBanner._id)}
                      className={`inline-flex items-center justify-center gap-2 px-8 py-3.5 sm:py-4 rounded-md font-mono text-xs uppercase tracking-[0.15em] font-bold transition-all shadow-lg min-h-[44px] ${
                        isDarkText
                          ? "bg-neutral-950 text-white hover:bg-neutral-800"
                          : "bg-white text-neutral-950 hover:bg-neutral-200"
                      }`}
                    >
                      <span>{currentBanner.ctaLabel || "SHOP NOW"}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                    <Link
                      href="/offers"
                      className={`inline-flex items-center justify-center gap-2 px-8 py-3.5 sm:py-4 rounded-md font-mono text-xs uppercase tracking-[0.15em] font-bold transition-all backdrop-blur-md min-h-[44px] border ${
                        isDarkText
                          ? "bg-neutral-950/10 border-neutral-950/20 text-neutral-950 hover:bg-neutral-950/20"
                          : "bg-white/10 border-white/25 text-white hover:bg-white hover:text-neutral-950"
                      }`}
                    >
                      <span>VIEW SPECIAL OFFERS</span>
                    </Link>
                  </div>
                </motion.div>
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Manual Navigation Controls (Desktop hover or focus) */}
      {slideCount > 1 && (
        <>
          <button
            type="button"
            onClick={handlePrev}
            aria-label="Previous Slide"
            className="hidden md:flex absolute left-4 lg:left-6 top-1/2 -translate-y-1/2 z-20 w-11 h-11 items-center justify-center rounded-full bg-neutral-950/40 hover:bg-neutral-950/80 text-white/80 hover:text-white border border-white/15 backdrop-blur-md opacity-0 group-hover:opacity-100 transition-all duration-200 shadow-lg focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-white/50"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={handleNext}
            aria-label="Next Slide"
            className="hidden md:flex absolute right-4 lg:left-auto lg:right-6 top-1/2 -translate-y-1/2 z-20 w-11 h-11 items-center justify-center rounded-full bg-neutral-950/40 hover:bg-neutral-950/80 text-white/80 hover:text-white border border-white/15 backdrop-blur-md opacity-0 group-hover:opacity-100 transition-all duration-200 shadow-lg focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-white/50"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </>
      )}

      {/* Slide Indicators / Pagination Progress Dots */}
      {slideCount > 1 && (
        <div className="absolute bottom-5 sm:bottom-6 right-5 sm:right-8 md:right-12 z-20 flex items-center gap-1.5 sm:gap-2">
          {banners.map((_, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => handleDotClick(idx)}
              aria-label={`Go to slide ${idx + 1}`}
              className={`h-1.5 rounded-full transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-white/50 ${
                idx === currentIndex
                  ? "w-7 sm:w-8 bg-white shadow-sm"
                  : "w-2 bg-white/40 hover:bg-white/75"
              }`}
            />
          ))}
        </div>
      )}
    </section>
  );
}
