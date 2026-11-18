"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Layers, ShieldCheck, Scissors, Sparkles } from "lucide-react";

interface GarmentFeature {
  id: string;
  title: string;
  spec: string;
  badge: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  metric: string;
  metricLabel: string;
}

const GARMENT_FEATURES: GarmentFeature[] = [
  {
    id: "fabric",
    title: "Breathable Woven Fabrics",
    spec: "Selected Cotton & Tailored Blends",
    badge: "FABRIC QUALITY",
    description:
      "Chosen for all-day comfort in Indian climates with a crisp, structured drape that resists creasing and keeps its tailored silhouette wear after wear.",
    icon: Layers,
    metric: "100%",
    metricLabel: "Quality Inspected",
  },
  {
    id: "collar",
    title: "Structured Mandarin Collar",
    spec: "Reinforced Collar Interlining",
    badge: "COLLAR CONSTRUCTION",
    description:
      "Precision-stitched standing collars with balanced interlining so the neckline stays crisp and upright over kurtas, shirts, and festive ensembles.",
    icon: ShieldCheck,
    metric: "4-Pocket",
    metricLabel: "Functional Layout",
  },
  {
    id: "silhouette",
    title: "Tailored Indian Fit",
    spec: "Balanced Shoulder & Chest Taper",
    badge: "PATTERN CUT",
    description:
      "Graded across Indian menswear proportions from S to 2XL so layers sit smoothly over shirts or kurtas without pulling at the shoulders or hem.",
    icon: Scissors,
    metric: "S–2XL",
    metricLabel: "Size Range",
  },
  {
    id: "treatment",
    title: "Clean Seam Finishing",
    spec: "Double-Checked Stitching & Lining",
    badge: "CRAFTSMANSHIP",
    description:
      "Finished with neat internal seams, secure button shanks, and soft breathable lining built for repeated festive and formal wear.",
    icon: Sparkles,
    metric: "7-Day",
    metricLabel: "Size Exchanges",
  },
];

export function GarmentAnatomySection({ className = "" }: { className?: string }) {
  const [selectedFeature, setSelectedFeature] = useState<string>("fabric");

  return (
    <section
      className={`py-16 md:py-24 bg-neutral-950 text-white w-full flex justify-center border-b border-neutral-800 ${className}`}
    >
      <div className="w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop">
        {/* Section Header */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between mb-12 sm:mb-16 gap-6">
          <div className="max-w-2xl space-y-3">
            <div className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-neutral-400 font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-primary-fixed-dim"></span>
              <span>SAMRAT FASHION // GARMENT CRAFT</span>
            </div>
            <h2 className="font-headline-lg text-3xl sm:text-4xl lg:text-5xl font-black uppercase tracking-tight leading-[1.05]">
              TAILORED FIT. CRISP STRUCTURE. MADE TO LAST.
            </h2>
            <p className="text-neutral-400 text-sm sm:text-base leading-relaxed pt-1">
              Every Samrat Fashion piece is cut from breathable woven fabrics with structured collars and clean internal finishing, designed for effortless festive and everyday layering.
            </p>
          </div>

          <Link
            href="/shop"
            className="inline-flex items-center gap-2 font-mono text-xs uppercase font-bold tracking-wider text-white hover:text-neutral-300 transition-colors border-b border-white pb-1 self-start lg:self-auto"
          >
            <span>Explore Collection</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>

        {/* Feature Grid / Architectural Anatomy Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          {GARMENT_FEATURES.map((feature) => {
            const Icon = feature.icon;
            const isSelected = selectedFeature === feature.id;

            return (
              <div
                key={feature.id}
                onClick={() => setSelectedFeature(feature.id)}
                className={`group relative p-6 sm:p-7 rounded-xl border transition-all duration-300 cursor-pointer flex flex-col justify-between min-h-[280px] sm:min-h-[320px] ${
                  isSelected
                    ? "bg-neutral-900/90 border-neutral-600 shadow-lg shadow-black/40"
                    : "bg-neutral-950/80 border-neutral-800 hover:border-neutral-700 hover:bg-neutral-900/50"
                }`}
              >
                {/* Card Top: Spec & Icon */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-neutral-400 font-bold">
                      {feature.badge}
                    </span>
                    <div
                      className={`w-9 h-9 rounded-md flex items-center justify-center transition-colors ${
                        isSelected
                          ? "bg-white text-neutral-950"
                          : "bg-neutral-900 text-neutral-400 group-hover:text-white"
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <h3 className="font-headline-sm text-lg font-bold uppercase tracking-tight text-white">
                      {feature.title}
                    </h3>
                    <p className="font-mono text-xs text-neutral-400 font-semibold">
                      {feature.spec}
                    </p>
                  </div>

                  <p className="text-neutral-400 text-xs leading-relaxed line-clamp-4">
                    {feature.description}
                  </p>
                </div>

                {/* Card Bottom: Metric Box */}
                <div className="pt-6 mt-6 border-t border-neutral-800/80 flex items-baseline justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">
                    {feature.metricLabel}
                  </span>
                  <span className="font-mono text-2xl font-black text-white">
                    {feature.metric}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Technical Guarantee Blueprint Strip */}
        <div className="mt-8 sm:mt-12 p-4 sm:p-6 rounded-xl bg-neutral-900 border border-neutral-800 flex flex-wrap items-center justify-between gap-4 font-mono text-[11px] sm:text-xs uppercase text-neutral-300">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            <span className="text-white font-bold">50+ WASH ZERO-FADE TESTED</span>
          </div>
          <div className="hidden md:block text-neutral-700">/</div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            <span className="text-white font-bold">100% COMBED LONG-STAPLE COTTON</span>
          </div>
          <div className="hidden md:block text-neutral-700">/</div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            <span className="text-white font-bold">DOUBLE-NEEDLE COLLAR REINFORCEMENT</span>
          </div>
          <div className="hidden md:block text-neutral-700">/</div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            <span className="text-white font-bold">ENZYME WASH ZERO-ITCH FINISH</span>
          </div>
        </div>
      </div>
    </section>
  );
}
