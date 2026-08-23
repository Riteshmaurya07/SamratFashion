import { AddressBookClient } from "@/components/account/AddressBookClient";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "My Addresses - Samrat Fashion",
};

export default function AddressesPage() {
  return <AddressBookClient />;
}
