import type { Metadata } from "next";
import CustomerSupportClient from "@/components/support/CustomerSupportClient";
import { getBreadcrumbJsonLd, getFaqPageJsonLd } from "@/lib/seo";
import { JsonLd } from "@/components/seo/JsonLd";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Customer Support Center & FAQs",
  description:
    "Get instant help with order tracking, size exchanges, returns, payments, and Nehru jacket & menswear care at Samrat Fashion. Express Pan-India support.",
  alternates: {
    canonical: "/support",
  },
  openGraph: {
    title: "Customer Support & FAQs | Samrat Fashion",
    description:
      "Get instant help with your Samrat Fashion orders, delivery tracking, size exchanges, and garment care.",
    url: "/support",
    type: "website",
  },
};

const SUPPORT_FAQS = [
  {
    q: "How do I track my order delivery?",
    a: "All orders are dispatched within 24–48 hours via our trusted express courier partners. You can view real-time tracking milestones in your 'Orders' section or through the tracking link sent via email.",
  },
  {
    q: "What is the size exchange and return policy?",
    a: "We offer a 7-day doorstep size exchange and return policy for unworn, unwashed garments with original tags intact. Simply initiate an exchange from your Order Details page.",
  },
  {
    q: "How do I choose the right Nehru jacket size?",
    a: "Measure around the fullest part of your chest over a shirt or kurta and match it with the Size Guide on the product page (sizes S to 2XL). If you prefer a relaxed fit for layering, consider sizing up.",
  },
  {
    q: "What payment methods do you support?",
    a: "We support 100% encrypted prepaid online checkout via Razorpay: UPI (Google Pay, PhonePe, Paytm, BHIM), all major Credit & Debit cards (Visa, MasterCard, RuPay), NetBanking, and Wallets.",
  },
  {
    q: "How do I care for my Nehru jacket and tailored menswear?",
    a: "Dry clean recommended to preserve collar structure and woven texture, or gently hand wash cold with mild detergent. Dry in shade and warm iron on the reverse side.",
  },
];
export default function CustomerSupportPage() {
  return (
    <main className="flex-grow w-full max-w-5xl mx-auto px-margin-mobile md:px-margin-desktop pt-4 sm:pt-6 md:pt-8 pb-28 lg:pb-12">
      <JsonLd
        id="support-breadcrumbs-jsonld"
        data={getBreadcrumbJsonLd([
          { name: "Home", url: "/" },
          { name: "Support", url: "/support" },
        ])}
      />
      <JsonLd id="support-faq-jsonld" data={getFaqPageJsonLd(SUPPORT_FAQS)} />
      <CustomerSupportClient />
    </main>
  );
}
