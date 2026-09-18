"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { api } from "@/lib/api";
import { trackEvent } from "@/lib/analytics";
import CustomPrintCatalogCard, { type CatalogItem } from "./CustomPrintCatalogCard";

function CatalogSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="overflow-hidden rounded-2xl border border-outline-variant/30 bg-surface-container-lowest">
          <div className="aspect-[4/5] w-full animate-pulse bg-surface-container" />
          <div className="space-y-3 p-5">
            <div className="h-4 w-3/4 animate-pulse rounded-lg bg-surface-container" />
            <div className="h-3 w-full animate-pulse rounded-lg bg-surface-container" />
            <div className="h-3 w-2/3 animate-pulse rounded-lg bg-surface-container" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function CustomPrintCatalogPage() {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    trackEvent("custom_print_catalog_view");

    api.get("/custom-print-catalog")
      .then(({ data }) => {
        setItems(data?.data || []);
      })
      .catch(() => setError("We couldn't load the custom printing catalog. Please try again."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="min-h-screen bg-background text-on-background pb-24">
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-outline-variant/20 bg-surface-container-low px-4 pb-14 pt-14 md:px-8 md:pb-16 md:pt-16">
        {/* Decorative background gradient */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent" aria-hidden="true" />
        <div className="relative mx-auto max-w-6xl">
          <p className="font-label-caps text-xs uppercase tracking-[0.2em] text-secondary">Custom Printing</p>
          <div className="mt-4 flex flex-col justify-between gap-8 md:flex-row md:items-center">
            <div className="max-w-2xl">
              <h1 className="font-display-lg text-4xl font-black tracking-tight md:text-5xl lg:text-6xl">
                Your Logo. Your Way.
              </h1>
              <p className="mt-5 text-lg leading-relaxed text-on-surface-variant">
                Browse our custom printing options below. Each offering shows exactly where your logo will be placed — no surprises.
              </p>
              <div className="mt-8 flex items-center gap-3 flex-shrink-0">
                <Link
                  href="/custom-designer"
                  className="inline-flex min-h-12 items-center justify-center whitespace-nowrap rounded-xl border border-outline-variant bg-surface-container-lowest px-5 font-bold text-on-surface shadow-sm hover:bg-surface-container transition-colors"
                >
                  Design it yourself →
                </Link>
              </div>
            </div>
            <div className="w-full md:w-[450px] aspect-square relative rounded-2xl overflow-hidden border border-outline-variant/30 shadow-lg shrink-0">
              <Image 
                src="/images/custom_print_hero.png" 
                alt="Custom Printed T-Shirts" 
                fill 
                className="object-cover" 
                priority 
              />
            </div>
          </div>
        </div>
      </section>

      {/* Catalog Grid */}
      <section aria-label="Custom print catalog" className="mx-auto max-w-6xl px-4 py-10 md:px-8">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-on-surface">Choose Your Custom Print</h2>
            <p className="mt-1 text-sm text-on-surface-variant">Click any item to see the full detail and upload your logo.</p>
          </div>
          {!loading && items.length > 0 && (
            <span className="text-sm text-on-surface-variant">{items.length} {items.length === 1 ? "option" : "options"} available</span>
          )}
        </div>

        {loading ? (
          <CatalogSkeleton />
        ) : error ? (
          <div className="rounded-2xl border border-error/30 bg-error-container p-10 text-center text-on-error-container" role="alert">
            <p className="font-bold">{error}</p>
            <button
              onClick={() => { setError(null); setLoading(true); api.get("/custom-print-catalog").then(({ data }) => setItems(data?.data || [])).finally(() => setLoading(false)); }}
              className="mt-4 rounded-xl bg-primary px-5 py-2 text-sm font-bold text-on-primary"
            >
              Try again
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-outline-variant bg-surface-container-lowest p-16 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-surface-container" aria-hidden="true">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-on-surface-variant">
                <path d="M9 12h6M9 16h6M7 4H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2h-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                <path d="M9 4h6a1 1 0 001-1V3a1 1 0 00-1-1H9a1 1 0 00-1 1v0a1 1 0 001 1z" stroke="currentColor" strokeWidth="2"/>
              </svg>
            </div>
            <h3 className="text-lg font-bold text-on-surface">No custom printing designs are currently available.</h3>
            <p className="mt-2 text-sm text-on-surface-variant">Check back soon or contact us for custom requirements.</p>
            <a href="mailto:info@samratfashion.com" className="mt-6 inline-block rounded-xl bg-primary px-6 py-3 font-bold text-on-primary">
              Contact Us
            </a>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-3">
            {items.map((item) => (
              <CustomPrintCatalogCard key={item._id} item={item} />
            ))}
          </div>
        )}
      </section>

      {/* How it works section */}
      {!loading && items.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 pb-10 md:px-8">
          <div className="rounded-3xl border border-outline-variant/20 bg-surface-container-lowest p-8 md:p-10">
            <h2 className="text-xl font-bold text-on-surface mb-6">How It Works</h2>
            <div className="grid gap-6 sm:grid-cols-3">
              {[
                { step: "01", title: "Choose a Design", desc: "Pick a placement style from our catalog — chest, back, sleeve, or more." },
                { step: "02", title: "Upload Your Logo", desc: "Upload your artwork or let our team help you create one." },
                { step: "03", title: "We Handle the Rest", desc: "We confirm details, print, and deliver. No upfront payment required." },
              ].map(({ step, title, desc }) => (
                <div key={step} className="flex gap-4">
                  <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary text-sm font-black text-on-primary">{step}</span>
                  <div>
                    <h3 className="font-bold text-on-surface">{title}</h3>
                    <p className="mt-1 text-sm text-on-surface-variant leading-relaxed">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
