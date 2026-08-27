import AdminCustomOrdersClient from "@/components/admin/AdminCustomOrdersClient";

export const metadata = {
  title: "Admin Custom Orders | SamratFashion",
  description: "Manage paid customer custom T-shirt print production workflows.",
};

export const dynamic = "force-dynamic";

export default function AdminCustomOrdersPage() {
  return <AdminCustomOrdersClient />;
}
