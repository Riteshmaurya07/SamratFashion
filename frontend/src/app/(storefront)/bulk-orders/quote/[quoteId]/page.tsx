import BulkQuotationClient from "@/components/catalog/BulkQuotationClient";

export const metadata = {
  title: "Bulk Quotation Inspection | SamratFashion B2B",
  description: "Review and approve your B2B volume quotation.",
};

export const dynamic = "force-dynamic";

export default async function BulkQuotationPage({ params }: { params: Promise<{ quoteId: string }> }) {
  const { quoteId } = await params;
  return <BulkQuotationClient quoteId={quoteId} />;
}
