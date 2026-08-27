import CustomerReviewsClient from "@/components/account/CustomerReviewsClient";

export const metadata = {
  title: "My Reviews | SamratFashion",
  description: "View and write product reviews for your delivered orders.",
};

export const dynamic = "force-dynamic";

export default function CustomerReviewsPage() {
  return <CustomerReviewsClient />;
}
