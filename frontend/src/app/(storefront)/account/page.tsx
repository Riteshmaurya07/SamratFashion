import AccountHubClient from "@/components/account/AccountHubClient";

export const metadata = {
  title: "My Account Hub | SamratFashion",
  description: "Customer account dashboard, orders, saved designs, addresses, and reviews.",
};

export const dynamic = "force-dynamic";

export default function AccountPage() {
  return <AccountHubClient />;
}
