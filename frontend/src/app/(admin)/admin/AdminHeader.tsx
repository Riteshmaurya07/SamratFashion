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
    <header className="fixed top-0 right-0 left-0 lg:left-64 z-40 flex justify-between items-center px-3 sm:px-6 h-16 bg-surface border-b border-outline-variant transition-all">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        {/* Mobile Menu Toggle */}
        <button
          onClick={onMenuToggle}
          className="lg:hidden p-2 text-on-surface-variant hover:bg-surface-container-low rounded-lg transition-colors touch-target-base flex items-center justify-center shrink-0"
          aria-label="Open navigation menu"
        >
          <span className="material-symbols-outlined text-[22px]">menu</span>
        </button>

        <h2 className="font-headline-sm text-sm font-black text-on-surface tracking-tight hidden sm:block shrink-0">
          THREADVIBE OPS
        </h2>
        <div className="h-4 w-px bg-outline-variant/60 mx-1 hidden sm:block shrink-0" />
        <span className="font-mono text-xs text-on-surface-variant truncate font-bold uppercase">{getPageTitle()}</span>
      </div>

      <div className="flex items-center gap-2 sm:gap-4 shrink-0">
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
        <div className="flex items-center gap-2 sm:gap-3 pl-2 sm:pl-3 border-l border-outline-variant/40">
          <div className="flex flex-col items-end hidden sm:flex">
            <span className="font-body-sm text-xs font-bold text-on-surface truncate max-w-[120px]">
              {user?.name || "Admin"}
            </span>
            <span className="font-mono text-[9px] text-on-surface-variant uppercase">
              {user?.role === "SUPER_ADMIN" ? "Super Admin" : "Admin"}
            </span>
          </div>
          <button
            onClick={handleLogout}
            className="p-2 text-on-surface-variant hover:text-red-600 transition-colors rounded-lg hover:bg-surface-container-low"
            title="Logout"
            aria-label="Logout"
          >
            <span className="material-symbols-outlined text-[20px]">logout</span>
          </button>
        </div>
      </div>
    </header>
  );
}
