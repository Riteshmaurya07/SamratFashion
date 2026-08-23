import { OrdersClient } from "@/components/account/OrdersClient";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "My Orders - Samrat Fashion",
};

export default function OrdersPage() {
  return <OrdersClient />;
}
