import type { Metadata } from "next";
import Link from "next/link";
import { SITE_CONFIG } from "@/lib/seo";
import { getServerStoreSettings } from "@/lib/storeSettingsServer";
import { formatFreeShippingRule } from "@/lib/storeSettingsDefaults";

export const metadata: Metadata = {
  title: "Shipping & Returns Policy",
  description:
    "Shipping timelines, delivery fees, 7-day return & size exchange rules, and refund timelines for Samrat Fashion orders across India.",
  alternates: {
    canonical: "/shipping-returns",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default async function ShippingReturnsPage() {
  const settings = await getServerStoreSettings();
  const freeShippingSummary = formatFreeShippingRule(settings.freeShippingThreshold);
  const standardFeeFormatted = `₹${Math.round(settings.standardShippingFee).toLocaleString("en-IN")}`;

  return (
    <div className="max-w-4xl mx-auto px-4 py-12 text-on-surface">
      <h1 className="text-3xl font-extrabold mb-3">Shipping &amp; Returns Policy</h1>
      <p className="text-sm text-on-surface-variant mb-8">
        Transparent Pan-India delivery timelines, shipping rates, and our 7-day return &amp; size exchange policy.
      </p>

      <div className="space-y-6 text-on-surface-variant leading-relaxed">
        <section id="shipping" className="space-y-2">
          <h2 className="text-xl font-bold text-on-surface">1. Shipping &amp; Delivery</h2>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>
              <strong>Dispatch Window:</strong> Ready-to-ship orders are processed and dispatched within 24–48 business hours via our trusted express courier partners.
            </li>
            <li>
              <strong>Estimated Transit:</strong> 3–5 business days across metro cities and 4–7 business days for non-metro locations across India.
            </li>
            <li>
              <strong>Shipping Charges:</strong> {freeShippingSummary}. Orders below the free-shipping threshold carry a flat shipping fee of {standardFeeFormatted}.
            </li>
            <li>
              <strong>Payment Methods:</strong> All orders are prepaid online via Razorpay (UPI, Credit/Debit Cards, NetBanking, and Wallets). Cash on Delivery (COD) is currently unavailable.
            </li>
          </ul>
        </section>

        <section id="returns" className="space-y-2">
          <h2 className="text-xl font-bold text-on-surface">2. 7-Day Returns &amp; Size Exchanges</h2>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>
              <strong>Eligibility:</strong> Standard catalog garments are eligible for return or size exchange within <strong>7 days of delivery</strong>, provided they are unworn, unwashed, and in original condition with all tags intact.
            </li>
            <li>
              <strong>How to Initiate:</strong> Visit{" "}
              <Link href="/account/orders" className="text-primary hover:underline font-medium">
                My Orders
              </Link>
              , open the delivered order, and submit a return or exchange request. Doorstep reverse pickup is scheduled for serviceable pincodes.
            </li>
            <li>
              <strong>Custom Apparel:</strong> Custom-printed or personalized garments are non-returnable and non-refundable unless delivered damaged, defective, or incorrect.
            </li>
          </ul>
        </section>

        <section id="refunds" className="space-y-2">
          <h2 className="text-xl font-bold text-on-surface">3. Cancellations &amp; Refunds</h2>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>
              <strong>Pre-Dispatch Cancellation:</strong> Orders may be cancelled before courier handoff directly from the Order Details page.
            </li>
            <li>
              <strong>Refund Method &amp; Timeline:</strong> Approved refunds (for pre-dispatch cancellations or verified returns) are credited back to the original Razorpay payment source within <strong>5–7 business days</strong>.
            </li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-xl font-bold text-on-surface">4. Need Help?</h2>
          <p>
            Contact our support team at{" "}
            <a href={`mailto:${SITE_CONFIG.email}`} className="text-primary hover:underline font-medium">
              {SITE_CONFIG.email}
            </a>{" "}
            or call{" "}
            <a href={`tel:${SITE_CONFIG.telephone.replace(/[^+\d]/g, "")}`} className="text-primary hover:underline font-medium">
              {SITE_CONFIG.telephone}
            </a>{" "}
            (Mon–Sat, 10:00 AM – 7:00 PM IST), or submit a ticket in our{" "}
            <Link href="/support" className="text-primary hover:underline font-medium">
              Help &amp; Support Center
            </Link>
            .
          </p>
        </section>

        <div className="mt-8 pt-6 border-t border-outline-variant/20 flex flex-wrap gap-6">
          <Link href="/" className="text-primary hover:underline font-bold">
            &larr; Back to Store
          </Link>
          <Link href="/terms" className="text-primary hover:underline font-medium">
            Terms &amp; Conditions
          </Link>
        </div>
      </div>
    </div>
  );
}
