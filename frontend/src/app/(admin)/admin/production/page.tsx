import AdminProductionQueueClient from "@/components/admin/AdminProductionQueueClient";

export const metadata = {
  title: "Admin Production Queue & Analytics | SamratFashion",
  description: "Shop floor print production queue, aggregated KPIs, and high-res batch artwork exporter.",
};

export const dynamic = "force-dynamic";

export default function AdminProductionPage() {
  return <AdminProductionQueueClient />;
}
