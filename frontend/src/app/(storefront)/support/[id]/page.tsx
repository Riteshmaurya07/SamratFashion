import CustomerTicketDetailClient from "@/components/support/CustomerTicketDetailClient";

export const metadata = {
  title: "Support Ticket Detail | SamratFashion",
  description: "View ticket status and support conversation history.",
};

export const dynamic = "force-dynamic";

export default async function CustomerTicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  return <CustomerTicketDetailClient ticketId={resolvedParams.id} />;
}
