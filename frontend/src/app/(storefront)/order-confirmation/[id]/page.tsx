import { OrderConfirmationClient } from "@/components/checkout/OrderConfirmationClient";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Order Confirmation - Samrat Fashion",
};

export default async function OrderConfirmationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OrderConfirmationClient orderId={id} />;
}
