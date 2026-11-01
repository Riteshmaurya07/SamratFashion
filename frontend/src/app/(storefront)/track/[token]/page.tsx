import { Metadata } from "next";
import { TrackOrderClient } from "./TrackOrderClient";

export const metadata: Metadata = {
  title: "Track Package Delivery | Samrat Fashion",
  description: "View real-time fulfillment and delivery progress for your Samrat Fashion package.",
  robots: {
    index: false,
    follow: false,
  },
  referrer: "no-referrer",
};

export default async function TrackOrderPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <TrackOrderClient token={token} />;
}
