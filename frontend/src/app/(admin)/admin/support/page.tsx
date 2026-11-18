import AdminSupportQueueClient from "@/components/admin/AdminSupportQueueClient";

export const metadata = {
  title: "Admin Support Queue",
  description: "Manage customer support ticket queue and issue resolution.",
};

export const dynamic = "force-dynamic";

export default function AdminSupportQueuePage() {
  return <AdminSupportQueueClient />;
}
