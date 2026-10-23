import BulkOrderRequestClient from "@/components/catalog/BulkOrderRequestClient";

export const metadata = {
  title: "Corporate & Bulk Printing Orders | SamratFashion B2B",
  description: "Request volume discounts and corporate bulk apparel printing quotations.",
};

export const dynamic = "force-dynamic";

export default function BulkPrintingPage() {
  return <BulkOrderRequestClient />;
}
