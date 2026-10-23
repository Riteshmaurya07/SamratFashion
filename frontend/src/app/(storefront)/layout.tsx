import { Navbar } from "@/components/ui/Navbar";
import { Footer } from "@/components/ui/Footer";
import { getActiveCategories } from "@/lib/catalog";
import { MotionProvider } from "@/components/providers/MotionProvider";

export const dynamic = "force-dynamic";

export default async function StorefrontLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const categories = await getActiveCategories();

  return (
    <MotionProvider>
      <Navbar categories={categories} />
      <div className="flex-grow w-full flex flex-col items-center overflow-x-hidden min-w-0">
        {children}
      </div>
      <Footer categories={categories} />
    </MotionProvider>
  );
}
