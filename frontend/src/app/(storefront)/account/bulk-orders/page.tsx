import CustomerBulkOrdersClient from "@/components/account/CustomerBulkOrdersClient";

export const metadata = {
  title: "Bulk Inquiries & Quotes | My Account | SamratFashion",
  description: "View and track your B2B corporate bulk apparel inquiries and official quotations.",
};

export const dynamic = "force-dynamic";

export default function AccountBulkOrdersPage() {
  return <CustomerBulkOrdersClient />;
}
