import AdminCustomOrderDetailClient from "@/components/admin/AdminCustomOrderDetailClient";

export const metadata = {
  title: "Admin Custom Order Detail | SamratFashion",
  description: "Inspect customer custom design, print specs, and export print sheet.",
};

export const dynamic = "force-dynamic";

export default async function AdminCustomOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  return <AdminCustomOrderDetailClient orderId={resolvedParams.id} />;
}
