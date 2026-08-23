import { OrderDetailsClient } from "@/components/account/OrderDetailsClient";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Order Details - Samrat Fashion",
};

export default function OrderDetailsPage({ params }: { params: { id: string } }) {
  return <OrderDetailsClient orderId={params.id} />;
}
