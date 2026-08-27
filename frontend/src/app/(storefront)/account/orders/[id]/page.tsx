import { OrderDetailsClient } from "@/components/account/OrderDetailsClient";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Order Details - Samrat Fashion",
};

export default async function OrderDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OrderDetailsClient orderId={id} />;
}
