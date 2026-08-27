import CustomerSupportClient from "@/components/support/CustomerSupportClient";

export const metadata = {
  title: "Customer Support Center | SamratFashion",
  description: "Get help with your orders, custom printing, payments, and returns.",
};

export const dynamic = "force-dynamic";

export default function CustomerSupportPage() {
  return <CustomerSupportClient />;
}
