import AdminTicketDetailClient from "@/components/admin/AdminTicketDetailClient";

export const metadata = {
  title: "Admin Ticket Inspection | SamratFashion",
  description: "Inspect customer ticket, reply, assign agent, and update status.",
};

export const dynamic = "force-dynamic";

export default async function AdminTicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = await params;
  return <AdminTicketDetailClient ticketId={resolvedParams.id} />;
}
