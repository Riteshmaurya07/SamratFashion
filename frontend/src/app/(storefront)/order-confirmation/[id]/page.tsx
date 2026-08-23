import { OrderConfirmationClient } from "@/components/checkout/OrderConfirmationClient";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Order Confirmation - Samrat Fashion",
};

export default function OrderConfirmationPage({ params }: { params: { id: string } }) {
  return <OrderConfirmationClient orderId={params.id} />;
}
