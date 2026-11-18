"use client";

import { useState, useEffect } from "react";

interface ProductSizeGuideRow {
  size: string;
  chest?: number;
  length?: number;
  shoulder?: number;
  sleeve?: number;
}

interface SizeGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  sizeGuideTable?: ProductSizeGuideRow[];
  availableSizes?: string[];
  isSleeveless?: boolean;
}

const DEFAULT_INCH_MEASUREMENTS = [
  { size: "S", chest: 38, length: 26, shoulder: 16.5, sleeve: 7.5 },
  { size: "M", chest: 40, length: 27, shoulder: 17.5, sleeve: 8 },
  { size: "L", chest: 42, length: 28, shoulder: 18.5, sleeve: 8.5 },
  { size: "XL", chest: 44, length: 29, shoulder: 19.5, sleeve: 9 },
  { size: "2XL", chest: 46, length: 30, shoulder: 20.5, sleeve: 9.5 },
  { size: "3XL", chest: 48, length: 31, shoulder: 21.5, sleeve: 10 },
  { size: "4XL", chest: 50, length: 32, shoulder: 22.5, sleeve: 10.5 },
];

const normalizeSizeKey = (s: string) => {
  const up = s.trim().toUpperCase();
  if (up === "XXL") return "2XL";
  if (up === "XXXL") return "3XL";
  return up;
};

export default function SizeGuideModal({
  isOpen,
  onClose,
  sizeGuideTable,
  availableSizes,
  isSleeveless = false,
}: SizeGuideModalProps) {
  const [unit, setUnit] = useState<"in" | "cm">("in");

  // Handle ESC key press
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

  const hasCustomRows = Array.isArray(sizeGuideTable) && sizeGuideTable.length > 0;
  const availableSet =
    Array.isArray(availableSizes) && availableSizes.length > 0
      ? new Set(availableSizes.map(normalizeSizeKey))
      : null;

  const sourceRows: ProductSizeGuideRow[] = hasCustomRows
    ? sizeGuideTable.map((row) => ({ ...row, size: normalizeSizeKey(row.size) }))
    : DEFAULT_INCH_MEASUREMENTS.filter((row) =>
        availableSet ? availableSet.has(row.size) : ["S", "M", "L", "XL", "2XL"].includes(row.size)
      );

  const displayRows = sourceRows.length > 0 ? sourceRows : DEFAULT_INCH_MEASUREMENTS.slice(0, 5);
  const showSleeveColumn = !isSleeveless && displayRows.some((row) => typeof row.sleeve === "number" && row.sleeve > 0);

  const formatMeasurement = (val?: number) => {
    if (typeof val !== "number" || !Number.isFinite(val)) return "—";
    if (unit === "in") return `${val}"`;
    return `${Math.round(val * 2.54 * 2) / 2} cm`;
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="size-guide-title"
      className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-3xl bg-white p-6 md:p-8 shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 pb-4">
          <div>
            <h2 id="size-guide-title" className="text-xl font-black text-gray-900">
              Garment Size Guide &amp; Measurements
            </h2>
            <p className="text-xs text-gray-500 mt-1">
              {isSleeveless ? "Sleeveless Tailored Fit — Garment measurements" : "Standard Fit — Measurements taken flat"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="h-10 w-10 rounded-full bg-gray-100 text-gray-500 font-bold hover:bg-gray-200 flex items-center justify-center text-lg touch-target-base active:scale-95 transition-all"
            aria-label="Close size guide"
          >
            ✕
          </button>
        </div>

        {/* Unit Toggle Buttons */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-gray-700">Select Measurement Unit:</span>
          <div className="flex rounded-xl bg-gray-100 p-1">
            <button
              onClick={() => setUnit("in")}
              className={`rounded-lg px-4 py-1.5 text-xs font-bold transition-all ${
                unit === "in" ? "bg-black text-white shadow-xs" : "text-gray-600 hover:text-black"
              }`}
            >
              Inches (in)
            </button>
            <button
              onClick={() => setUnit("cm")}
              className={`rounded-lg px-4 py-1.5 text-xs font-bold transition-all ${
                unit === "cm" ? "bg-black text-white shadow-xs" : "text-gray-600 hover:text-black"
              }`}
            >
              Centimeters (cm)
            </button>
          </div>
        </div>

        {/* Measurement Table */}
        <div className="overflow-x-auto rounded-2xl border border-gray-200">
          <table className="w-full text-left text-xs">
            <thead className="bg-gray-50 font-extrabold text-gray-900 border-b border-gray-200">
              <tr>
                <th className="py-3 px-4">Size</th>
                <th className="py-3 px-4">Chest</th>
                <th className="py-3 px-4">Length</th>
                <th className="py-3 px-4">Shoulder</th>
                {showSleeveColumn && <th className="py-3 px-4">Sleeve Length</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-gray-700">
              {displayRows.map((row) => (
                <tr key={row.size} className="hover:bg-gray-50/80 transition-colors">
                  <td className="py-3 px-4 font-black text-black">{row.size}</td>
                  <td className="py-3 px-4">{formatMeasurement(row.chest)}</td>
                  <td className="py-3 px-4">{formatMeasurement(row.length)}</td>
                  <td className="py-3 px-4">{formatMeasurement(row.shoulder)}</td>
                  {showSleeveColumn && <td className="py-3 px-4">{formatMeasurement(row.sleeve)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* How to Measure Tip */}
        <div className="rounded-2xl bg-amber-50 p-4 border border-amber-200 text-amber-900 text-xs leading-relaxed space-y-1">
          <p className="font-bold">📐 How to measure correctly:</p>
          <p>
            <strong>Chest:</strong> Measure around the fullest part of your chest, keeping tape horizontal.<br />
            <strong>Length:</strong> Measure from the highest point of shoulder collar down to bottom hem.
          </p>
        </div>

        <button
          onClick={onClose}
          className="w-full rounded-2xl bg-black py-4 text-xs font-bold text-white hover:bg-zinc-800 active:scale-95 transition-all min-h-[44px]"
        >
          Got It, Return to Product Page
        </button>
      </div>
    </div>
  );
}
