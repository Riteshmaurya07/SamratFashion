"use client";

import { usePathname, useRouter } from "next/navigation";
import { useAuthStore } from "@/store/useAuthStore";
import { api } from "@/lib/api";

interface AdminHeaderProps {
  onMenuToggle: () => void;
}

export function AdminHeader({ onMenuToggle }: AdminHeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuthStore();

  const handleLogout = async () => {
    try {
      await api.post("/auth/logout");
    } catch {
      // ignore
    }
    logout();
    router.push("/admin/login");
  };

  // Create a readable breadcrumb from pathname
  const getPageTitle = () => {
    if (pathname === "/admin") return "Dashboard";
    const parts = pathname.split("/").filter(Boolean);
    if (parts.length > 1) {
      const section = parts[1];
      return section.charAt(0).toUpperCase() + section.slice(1);
    }
    return "Admin";
  };

  return (
    <header className="fixed top-0 right-0 left-0 lg:left-64 z-40 flex justify-between items-center px-gutter h-16 bg-surface border-b border-outline-variant transition-all">
      <div className="flex items-center gap-4">
        {/* Mobile Menu Toggle */}
        <button
          onClick={onMenuToggle}
          className="lg:hidden p-2 text-on-surface-variant hover:bg-surface-container-low rounded-full transition-colors"
          aria-label="Open navigation menu"
        >
          <span className="material-symbols-outlined">menu</span>
        </button>

        <h2 className="font-headline-sm text-headline-sm font-bold text-primary tracking-tight hidden sm:block">
          STREET_OPS
        </h2>
        <div className="h-6 w-px bg-outline-variant mx-2 hidden sm:block" />
        <span className="font-label-caps text-label-caps text-on-surface-variant">{getPageTitle()}</span>
      </div>

      <div className="flex items-center gap-6">
        {/* Search Bar */}
        <div className="relative hidden md:block">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[18px]">
            search
          </span>
          <input
            type="text"
            placeholder="Search orders, SKUs..."
            className="w-64 bg-surface-container-low border border-outline-variant text-on-surface rounded-full py-2 pl-10 pr-4 font-body-sm text-body-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all placeholder:text-on-surface-variant/70"
          />
        </div>

        {/* Action Icons */}
        <div className="flex items-center gap-2">
          <button className="p-2 text-on-surface-variant hover:bg-surface-container-low rounded-full transition-colors relative">
            <span className="material-symbols-outlined">notifications</span>
          </button>
        </div>

        {/* Profile */}
        <div className="flex items-center gap-3 pl-4 border-l border-outline-variant">
          <div className="flex flex-col items-end hidden sm:flex">
            <span className="font-body-sm text-body-sm font-medium text-on-surface">
              {user?.name || "Admin User"}
            </span>
            <span className="font-label-caps text-label-caps text-on-surface-variant text-[10px]">
              {user?.role === "SUPER_ADMIN" ? "Super Admin" : "Admin"}
            </span>
          </div>
          <button
            onClick={handleLogout}
            className="p-1.5 text-on-surface-variant hover:text-error transition-colors ml-1"
            title="Logout"
          >
            <span className="material-symbols-outlined">logout</span>
          </button>
        </div>
      </div>
    </header>
  );
}
