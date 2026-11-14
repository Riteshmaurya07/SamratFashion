import { CheckoutClient } from "@/components/checkout/CheckoutClient";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Checkout - Samrat Fashion",
  robots: {
    index: false,
    follow: false,
  },
};

export default function CheckoutPage() {
  return <CheckoutClient />;
}
