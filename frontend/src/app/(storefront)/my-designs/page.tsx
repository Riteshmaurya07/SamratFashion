import { redirect } from "next/navigation";

export default function MyDesignsRedirectPage() {
  redirect("/account/designs");
}
