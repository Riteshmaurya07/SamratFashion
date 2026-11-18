import { Navbar } from "@/components/ui/Navbar";
import { Footer } from "@/components/ui/Footer";
import { getActiveCategories, filterStorefrontCategories } from "@/lib/catalog";
import { getServerStoreSettings } from "@/lib/storeSettingsServer";
import { MotionProvider } from "@/components/providers/MotionProvider";
import { StoreSettingsProvider } from "@/components/providers/StoreSettingsProvider";

export const revalidate = 60;

export default async function StorefrontLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [rawCategories, storeSettings] = await Promise.all([
    getActiveCategories(),
    getServerStoreSettings(),
  ]);
  const categories = filterStorefrontCategories(rawCategories || []);

  return (
    <MotionProvider>
      <StoreSettingsProvider initialSettings={storeSettings}>
        <Navbar categories={categories} />
        <div className="flex-grow w-full flex flex-col items-center overflow-x-hidden min-w-0">
          {children}
        </div>
        <Footer categories={categories} />
      </StoreSettingsProvider>
    </MotionProvider>
  );
}
