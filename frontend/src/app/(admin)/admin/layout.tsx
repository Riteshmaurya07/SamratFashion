"use client";

import { useState } from "react";
import { Metadata } from "next";
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
      <div className="bg-background text-on-background font-body-md text-body-md min-h-screen flex">
        {/* SideNavBar */}
        <AdminSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

        {/* Main Workspace Area */}
        <div className="flex-1 flex flex-col lg:ml-64 relative">
          {/* TopNavBar */}
          <AdminHeader onMenuToggle={() => setSidebarOpen(true)} />

          {/* Main Content Canvas */}
          <main className="flex-1 mt-16 p-4 md:p-6 lg:p-margin-desktop bg-background">
            <div className="max-w-container-max mx-auto">
              {children}
            </div>
          </main>
        </div>
      </div>
    </ProtectedRoute>
  );
}
