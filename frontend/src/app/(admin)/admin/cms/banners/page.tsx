import AdminBannersClient from "@/components/admin/AdminBannersClient";

export const metadata = {
  title: "Admin CMS Banners | SamratFashion",
  description: "Manage storefront Hero banners and promotional tiles.",
};

export const dynamic = "force-dynamic";

export default function AdminCmsBannersPage() {
  return <AdminBannersClient />;
}
