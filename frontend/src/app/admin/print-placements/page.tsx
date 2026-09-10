import { Metadata } from "next";
import PrintPlacementListClient from "@/components/admin/print-placements/PrintPlacementListClient";

export const metadata: Metadata = {
  title: "Manage Print Placements | Admin | Samrat Fashion",
};

export default function AdminPrintPlacementsPage() {
  return <PrintPlacementListClient />;
}
