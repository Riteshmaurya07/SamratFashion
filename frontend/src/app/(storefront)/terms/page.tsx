import type { Metadata } from "next";
import Link from "next/link";
import { SITE_CONFIG } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Terms & Conditions",
  description:
    "Review the terms of service, ordering guidelines, shipping, returns, refunds, and custom printing policy for Samrat Fashion.",
  alternates: {
    canonical: "/terms",
  },
  robots: {
    index: true,
    follow: true,
  },
};


export default function TermsPage() {
  return (
    <div className="max-w-4xl mx-auto px-4 py-12 text-on-surface">
      <h1 className="text-3xl font-extrabold mb-6">Terms &amp; Conditions</h1>
      <div className="space-y-4 text-on-surface-variant leading-relaxed">
        <p>Welcome to <strong>Samrat Fashion</strong>.</p>
        <h2 className="text-xl font-bold text-on-surface mt-6">1. Orders &amp; Pricing</h2>
        <p>All prices are listed in Indian Rupees (INR) including applicable GST. All orders are prepaid online via Razorpay (UPI, Credit/Debit Cards, NetBanking, and Wallets). We reserve the right to decline orders in case of pricing errors or inventory unavailability.</p>
        <h2 className="text-xl font-bold text-on-surface mt-6">2. Custom Apparel Policy</h2>
        <p>Custom printed T-shirts and customer-submitted designs are non-returnable and non-refundable unless received damaged, defective, or incorrect.</p>
        <h2 id="shipping" className="text-xl font-bold text-on-surface mt-6">3. Shipping &amp; Delivery</h2>
        <p>Ready-to-ship orders are dispatched within 24–48 business hours via our express courier partners, with estimated delivery in 3–5 business days for metro cities and 4–7 business days elsewhere across India. Applicable shipping charges and free-shipping eligibility are displayed clearly at checkout.</p>
        <h2 id="returns" className="text-xl font-bold text-on-surface mt-6">4. Returns &amp; Refunds</h2>
        <p>Standard catalog garments may be returned within <strong>7 days of delivery</strong>, provided they are unworn, unwashed, and have all original tags attached. A direct size exchange can be arranged manually via a support ticket. Orders cancelled before dispatch or approved after return quality inspection are refunded to the original payment method within <strong>5–7 business days</strong>. See our full{" "}
          <Link href="/shipping-returns" className="text-primary hover:underline font-medium">
            Shipping &amp; Returns Policy
          </Link>{" "}
          for complete details.
        </p>
        <h2 className="text-xl font-bold text-on-surface mt-6">5. Contact Us</h2>
        <p>
          Questions about orders, pricing, or returns? Reach us at{" "}
          <a href={`mailto:${SITE_CONFIG.email}`} className="text-primary hover:underline font-medium">
            {SITE_CONFIG.email}
          </a>{" "}
          or call{" "}
          <a href={`tel:${SITE_CONFIG.telephone.replace(/[^+\d]/g, "")}`} className="text-primary hover:underline font-medium">
            {SITE_CONFIG.telephone}
          </a>{" "}
          (Mon–Sat, 10:00 AM – 7:00 PM IST).
        </p>
        <div className="mt-8 pt-6 border-t border-outline-variant/20">
          <Link href="/" className="text-primary hover:underline font-bold">← Back to Store</Link>
        </div>
      </div>
    </div>
  );
}
