"use client";

import { Truck, ShieldCheck, RefreshCw, Lock } from "lucide-react";

const TRUST_PILLARS = [
  {
    icon: Truck,
    title: "EXPRESS DISPATCH",
    description: "Pan-India fulfillment with complimentary delivery on prepaid orders above ₹999.",
  },
  {
    icon: ShieldCheck,
    title: "240+ GSM STANDARD",
    description: "Heavyweight 100% combed cotton with bio-washed pre-shrunk anti-sag collar tension.",
  },
  {
    icon: RefreshCw,
    title: "7-DAY EXCHANGES",
    description: "Hassle-free size exchanges and returns with direct doorstep pickup service.",
  },
  {
    icon: Lock,
    title: "ENCRYPTED CHECKOUT",
    description: "100% secure payments via Razorpay UPI, Credit/Debit cards, NetBanking & COD.",
  },
];

export function TrustPillarsBar({ className = "" }: { className?: string }) {
  return (
    <section
      aria-label="Customer Guarantees and Shipping Promises"
      className={`w-full py-10 sm:py-14 bg-surface border-y border-outline-variant/40 flex justify-center ${className}`}
    >
      <div className="w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 sm:gap-8">
          {TRUST_PILLARS.map((pillar, idx) => {
            const Icon = pillar.icon;
            return (
              <div
                key={idx}
                className="flex items-start gap-4 group"
              >
                <div className="w-10 h-10 rounded-md bg-surface-container-high/60 border border-outline-variant/60 flex items-center justify-center shrink-0 group-hover:bg-neutral-950 group-hover:text-white transition-colors duration-300">
                  <Icon className="w-4 h-4 text-on-surface group-hover:text-white transition-colors" />
                </div>
                <div className="space-y-1">
                  <h4 className="font-mono text-xs uppercase tracking-wider font-bold text-on-surface">
                    {pillar.title}
                  </h4>
                  <p className="text-on-surface-variant text-xs leading-relaxed">
                    {pillar.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
