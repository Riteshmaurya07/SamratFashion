import { OrdersClient } from "@/components/account/OrdersClient";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "My Orders - Samrat Fashion",
};

export default function OrdersPage() {
  return (
    <main className="flex-grow w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop pt-4 sm:pt-6 md:pt-8 pb-28 lg:pb-12">
      <OrdersClient />
    </main>
  );
}
