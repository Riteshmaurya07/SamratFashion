import AdminReviewsClient from "@/components/admin/AdminReviewsClient";

export const metadata = {
  title: "Admin Review Moderation | SamratFashion",
  description: "Moderate customer product ratings, verify photos, and approve or reject submissions.",
};

export const dynamic = "force-dynamic";

export default function AdminReviewsPage() {
  return <AdminReviewsClient />;
}
