import AdminCampaignsClient from "@/components/admin/AdminCampaignsClient";

export const metadata = {
  title: "Admin Marketing Campaigns | SamratFashion",
  description: "Create and manage promotional campaigns across the storefront.",
};

export const dynamic = "force-dynamic";

export default function AdminCampaignsPage() {
  return <AdminCampaignsClient />;
}
