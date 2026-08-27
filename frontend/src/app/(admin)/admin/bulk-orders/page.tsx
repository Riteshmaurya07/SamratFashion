import AdminBulkQueueClient from "@/components/admin/AdminBulkQueueClient";

export const metadata = {
  title: "Admin Bulk Orders & B2B Queue | SamratFashion",
  description: "Manage B2B volume requests and issue official quotations.",
};

export const dynamic = "force-dynamic";

export default function AdminBulkQueuePage() {
  return <AdminBulkQueueClient />;
}
