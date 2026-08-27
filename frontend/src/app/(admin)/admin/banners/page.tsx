import AdminBannersClient from "@/components/admin/AdminBannersClient";

export const metadata = {
  title: "Admin Banners Management | SamratFashion",
  description: "Manage storefront Hero banners, promotional tiles, and announcement bars.",
};

export const dynamic = "force-dynamic";

export default function AdminBannersPage() {
  return <AdminBannersClient />;
}
