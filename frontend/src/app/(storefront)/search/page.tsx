import { redirect } from "next/navigation";

export default async function SearchRedirectPage(props: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const params = await props.searchParams;
  const query = typeof params.q === "string" ? params.q : typeof params.search === "string" ? params.search : "";

  if (query) {
    redirect(`/shop?search=${encodeURIComponent(query)}`);
  } else {
    redirect("/shop");
  }
}
