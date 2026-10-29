import CustomerSupportClient from "@/components/support/CustomerSupportClient";

export const metadata = {
  title: "Customer Support Center | SamratFashion",
  description: "Get help with your orders, custom printing, payments, and returns.",
};

export const dynamic = "force-dynamic";

export default function CustomerSupportPage() {
  return (
    <main className="flex-grow w-full max-w-5xl mx-auto px-margin-mobile md:px-margin-desktop pt-4 sm:pt-6 md:pt-8 pb-28 lg:pb-12">
      <CustomerSupportClient />
    </main>
  );
}
