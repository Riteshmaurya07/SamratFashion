"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ProtectedRoute } from "@/components/providers/ProtectedRoute";
import { AdminSidebar } from "./AdminSidebar";
import { AdminHeader } from "./AdminHeader";
import {
  AdminPermissionsData,
  fetchAdminPermissions,
  isRouteAllowed,
  getFirstAllowedRoute,
} from "@/lib/adminPermissions";
import { Loader2, ShieldAlert } from "lucide-react";

export default function AdminClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [permissions, setPermissions] = useState<AdminPermissionsData | null>(null);
  const [loadingPermissions, setLoadingPermissions] = useState(true);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    let active = true;
    fetchAdminPermissions()
      .then((data) => {
        if (active) {
          setPermissions(data);
          setLoadingPermissions(false);
        }
      })
      .catch(() => {
        if (active) {
          setLoadingPermissions(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const allowed = permissions ? isRouteAllowed(pathname, permissions) : true;

  useEffect(() => {
    if (loadingPermissions || !permissions) return;

    if (!allowed) {
      if (pathname === "/admin") {
        // Staff user has no dashboard permission: land on the first module they DO have
        const firstRoute = getFirstAllowedRoute(permissions);
        if (firstRoute && firstRoute !== "/admin") {
          router.replace(firstRoute);
        }
      } else {
        // Redirect directly back to /admin (dashboard) — do not render the page and then fail
        router.replace("/admin");
      }
    }
  }, [loadingPermissions, permissions, allowed, pathname, router]);

  // While checking permissions on initial load
  if (loadingPermissions) {
    return (
      <ProtectedRoute allowedRoles={["ADMIN", "SUPER_ADMIN"]}>
        <div className="min-h-screen flex flex-col items-center justify-center bg-surface-container-lowest gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <span className="font-mono text-xs uppercase tracking-wider text-neutral-500">
            Checking Permissions...
          </span>
        </div>
      </ProtectedRoute>
    );
  }

  // If user opened a forbidden URL (while redirect is in flight)
  if (!allowed) {
    // If user has no dashboard permission AND no other allowed module exists
    if (pathname === "/admin" && !getFirstAllowedRoute(permissions)) {
      return (
        <ProtectedRoute allowedRoles={["ADMIN", "SUPER_ADMIN"]}>
          <div className="bg-background text-on-background font-body-md text-body-md min-h-screen flex w-full">
            <AdminSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
            <div className="flex-1 flex flex-col lg:ml-64 relative min-w-0 w-full">
              <AdminHeader onMenuToggle={() => setSidebarOpen(true)} />
              <main className="flex-1 mt-16 p-6 lg:p-12 flex items-center justify-center">
                <div className="max-w-md w-full bg-white border border-neutral-200 rounded-xl p-8 text-center shadow-xs">
                  <div className="w-12 h-12 rounded-full bg-neutral-100 flex items-center justify-center mx-auto mb-4 text-neutral-600">
                    <ShieldAlert className="w-6 h-6" />
                  </div>
                  <h2 className="text-lg font-bold text-neutral-900 mb-2">No Dashboard Access</h2>
                  <p className="text-sm text-neutral-600 mb-6">
                    Your staff account does not have access to view this section. Please contact your store owner (SUPER_ADMIN) to update your role permissions.
                  </p>
                </div>
              </main>
            </div>
          </div>
        </ProtectedRoute>
      );
    }

    // Redirecting back to /admin or first allowed route
    return (
      <ProtectedRoute allowedRoles={["ADMIN", "SUPER_ADMIN"]}>
        <div className="min-h-screen flex flex-col items-center justify-center bg-surface-container-lowest gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <span className="font-mono text-xs uppercase tracking-wider text-neutral-500">
            Redirecting...
          </span>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute allowedRoles={["ADMIN", "SUPER_ADMIN"]}>
      <div className="bg-background text-on-background font-body-md text-body-md min-h-screen flex w-full overflow-x-hidden">
        {/* SideNavBar */}
        <AdminSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

        {/* Main Workspace Area */}
        <div className="flex-1 flex flex-col lg:ml-64 relative min-w-0 w-full overflow-x-hidden">
          {/* TopNavBar */}
          <AdminHeader onMenuToggle={() => setSidebarOpen(true)} />

          {/* Main Content Canvas */}
          <main className="flex-1 mt-16 p-3.5 sm:p-4 md:p-6 lg:p-8 bg-background min-w-0 w-full">
            <div className="max-w-container-max mx-auto min-w-0 w-full">
              {children}
            </div>
          </main>
        </div>
      </div>
    </ProtectedRoute>
  );
}
