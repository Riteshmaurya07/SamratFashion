"use client";

import { useState, useEffect } from "react";

interface SizeGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const INCH_MEASUREMENTS = [
  { size: "S", chest: '38"', length: '26"', shoulder: '16.5"', sleeve: '7.5"' },
  { size: "M", chest: '40"', length: '27"', shoulder: '17.5"', sleeve: '8"' },
  { size: "L", chest: '42"', length: '28"', shoulder: '18.5"', sleeve: '8.5"' },
  { size: "XL", chest: '44"', length: '29"', shoulder: '19.5"', sleeve: '9"' },
  { size: "2XL", chest: '46"', length: '30"', shoulder: '20.5"', sleeve: '9.5"' },
  { size: "3XL", chest: '48"', length: '31"', shoulder: '21.5"', sleeve: '10"' },
  { size: "4XL", chest: '50"', length: '32"', shoulder: '22.5"', sleeve: '10.5"' },
];

const CM_MEASUREMENTS = [
  { size: "S", chest: "96 cm", length: "66 cm", shoulder: "42 cm", sleeve: "19 cm" },
  { size: "M", chest: "101 cm", length: "68 cm", shoulder: "44 cm", sleeve: "20 cm" },
  { size: "L", chest: "106 cm", length: "71 cm", shoulder: "47 cm", sleeve: "21.5 cm" },
  { size: "XL", chest: "111 cm", length: "73 cm", shoulder: "49 cm", sleeve: "23 cm" },
  { size: "2XL", chest: "116 cm", length: "76 cm", shoulder: "52 cm", sleeve: "24 cm" },
  { size: "3XL", chest: "122 cm", length: "78 cm", shoulder: "54 cm", sleeve: "25.5 cm" },
  { size: "4XL", chest: "127 cm", length: "81 cm", shoulder: "57 cm", sleeve: "26.5 cm" },
];

export default function SizeGuideModal({ isOpen, onClose }: SizeGuideModalProps) {
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

  const data = unit === "in" ? INCH_MEASUREMENTS : CM_MEASUREMENTS;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="size-guide-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-3xl bg-white p-6 md:p-8 shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 pb-4">
          <div>
            <h2 id="size-guide-title" className="text-xl font-black text-gray-900">
              Garment Size Guide & Measurements
            </h2>
            <p className="text-xs text-gray-500 mt-1">Regular Comfort Fit — Measurements taken flat</p>
          </div>
          <button
            onClick={onClose}
            className="h-9 w-9 rounded-full bg-gray-100 text-gray-500 font-bold hover:bg-gray-200 flex items-center justify-center text-lg"
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
                <th className="py-3 px-4">Chest Width</th>
                <th className="py-3 px-4">Length</th>
                <th className="py-3 px-4">Shoulder</th>
                <th className="py-3 px-4">Sleeve Length</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-gray-700">
              {data.map((row) => (
                <tr key={row.size} className="hover:bg-gray-50/80 transition-colors">
                  <td className="py-3 px-4 font-black text-black">{row.size}</td>
                  <td className="py-3 px-4">{row.chest}</td>
                  <td className="py-3 px-4">{row.length}</td>
                  <td className="py-3 px-4">{row.shoulder}</td>
                  <td className="py-3 px-4">{row.sleeve}</td>
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
          className="w-full rounded-2xl bg-black py-3.5 text-xs font-bold text-white hover:bg-zinc-800 transition-colors"
        >
          Got It, Return to Product Page
        </button>
      </div>
    </div>
  );
}
