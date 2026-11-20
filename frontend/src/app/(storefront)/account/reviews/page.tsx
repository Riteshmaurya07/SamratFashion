import CustomerReviewsClient from "@/components/account/CustomerReviewsClient";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "My Reviews",
  description: "View and write product reviews for your delivered orders.",
};

export const dynamic = "force-dynamic";

export default function CustomerReviewsPage() {
  return (
    <main className="flex-grow w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop pt-4 sm:pt-6 md:pt-6 pb-12 sm:pb-16 lg:pb-10">
      <CustomerReviewsClient />
    </main>
  );
}
