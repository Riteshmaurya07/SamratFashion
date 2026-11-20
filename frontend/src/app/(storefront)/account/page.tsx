import AccountHubClient from "@/components/account/AccountHubClient";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "My Account Hub",
  description: "Customer account dashboard, orders, saved designs, addresses, and reviews.",
};

export const dynamic = "force-dynamic";

export default function AccountPage() {
  return (
    <main className="flex-grow w-full max-w-container-max mx-auto px-margin-mobile md:px-margin-desktop pt-4 sm:pt-6 md:pt-6 pb-12 sm:pb-16 lg:pb-10">
      <AccountHubClient />
    </main>
  );
}
