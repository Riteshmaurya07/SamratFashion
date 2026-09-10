import BulkOrderRequestClient from "@/components/catalog/BulkOrderRequestClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Request a Bulk Quote | SamratFashion B2B",
  description: "Tell SamratFashion about your bulk apparel, customization, and delivery requirements.",
};

export default function BulkOrderRequestPage() {
  return <BulkOrderRequestClient />;
}
