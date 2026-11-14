import type { Metadata } from "next";
import CustomerSupportClient from "@/components/support/CustomerSupportClient";
import { getBreadcrumbJsonLd, getFaqPageJsonLd } from "@/lib/seo";
import { JsonLd } from "@/components/seo/JsonLd";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Customer Support Center & FAQs | Samrat Fashion",
  description:
    "Get instant help with order tracking, size exchanges, returns, custom DTF printing, payments, and 240+ GSM garment care. Express Pan-India support.",
  alternates: {
    canonical: "/support",
  },
  openGraph: {
    title: "Customer Support & FAQs | Samrat Fashion",
    description:
      "Get instant help with your orders, tracking, exchanges, and custom printing inquiries.",
    url: "/support",
    type: "website",
  },
};

const SUPPORT_FAQS = [
  {
    q: "How do I track my order delivery?",
    a: "All orders are dispatched within 24–48 hours from New Delhi via Delhivery Express. You can view real-time tracking milestones in your 'Orders' section or through the tracking link sent via SMS and email.",
  },
  {
    q: "What is the size exchange and return policy?",
    a: "We offer a 7-day doorstep size exchange and return policy for unworn, unwashed garments with original tags intact. Simply initiate an exchange from your Order Details page.",
  },
  {
    q: "How long does custom Direct-to-Film (DTF) printing take?",
    a: "Custom apparel orders undergo digital proof verification by our studio within 24 hours. Once confirmed, high-density DTF printing and heat curing take 2 business days before express dispatch.",
  },
  {
    q: "What payment methods do you support?",
    a: "We support 100% encrypted checkout via Razorpay: UPI (Google Pay, PhonePe, Paytm, BHIM), all major Credit & Debit cards (Visa, MasterCard, RuPay), NetBanking, and Cash on Delivery where serviceable.",
  },
  {
    q: "How do I care for 240+ GSM heavyweight cotton garments?",
    a: "Machine wash cold inside-out with mild detergent. Avoid bleach or heavy tumble drying. For custom graphic tees, do not iron directly on the print to ensure 50+ wash durability.",
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
