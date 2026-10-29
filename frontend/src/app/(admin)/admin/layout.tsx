"use client";

import { useState } from "react";
import { ProtectedRoute } from "@/components/providers/ProtectedRoute";
import { AdminSidebar } from "./AdminSidebar";
import { AdminHeader } from "./AdminHeader";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

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
