import AdminBulkDetailClient from "@/components/admin/AdminBulkDetailClient";

export const metadata = {
  title: "Admin B2B Quotation Builder | SamratFashion",
  description: "Inspect bulk order details and issue official B2B quotation.",
};

export const dynamic = "force-dynamic";

export default async function AdminBulkDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdminBulkDetailClient requestId={id} />;
}
