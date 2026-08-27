import SavedDesignsClient from "@/components/account/SavedDesignsClient";

export const metadata = {
  title: "My Saved Designs | SamratFashion",
  description: "View and manage your saved custom graphic T-shirt designs.",
};

export const dynamic = "force-dynamic";

export default function AccountSavedDesignsPage() {
  return <SavedDesignsClient />;
}
