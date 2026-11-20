"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuthStore } from "@/store/useAuthStore";
import {
  AdminModule,
  AdminPermissionsData,
  fetchAdminPermissions,
  clearAdminPermissionsCache,
} from "@/lib/adminPermissions";

export interface NavItem {
  name: string;
  href: string;
  icon: string;
  module?: AdminModule;
  feature?: "customDesign" | "bulkOrders";
  superAdminOnly?: boolean;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export const navGroups: NavGroup[] = [
  {
    title: "Overview",
    items: [
      { name: "Dashboard", href: "/admin", icon: "dashboard", module: "dashboard" }
    ]
  },
  {
    title: "Store Management",
    items: [
      { name: "Orders", href: "/admin/orders", icon: "shopping_bag", module: "orders" },
      { name: "Products", href: "/admin/products", icon: "inventory_2", module: "products" },
      { name: "Categories", href: "/admin/categories", icon: "category", module: "categories" },
      { name: "Inventory", href: "/admin/inventory", icon: "warehouse", module: "inventory" },
      { name: "Customers", href: "/admin/customers", icon: "group", module: "customers" },
      { name: "Returns", href: "/admin/returns", icon: "assignment_return", module: "returns" },
      { name: "Reviews", href: "/admin/reviews", icon: "star", module: "reviews" },
      { name: "Support", href: "/admin/support", icon: "support_agent", module: "support" },
      { name: "Store Settings", href: "/admin/settings", icon: "settings", module: "settings" }
    ]
  },
  {
    title: "Custom Printing & Production",
    items: [
      { name: "Print Catalog", href: "/admin/print-catalog", icon: "apparel", module: "printCatalog", feature: "customDesign" },
      { name: "Print Pricing", href: "/admin/print-pricing", icon: "payments", module: "printPricing", feature: "customDesign" },
      { name: "Custom Orders", href: "/admin/custom-orders", icon: "palette", module: "customOrders", feature: "customDesign" },
      { name: "Bulk Orders", href: "/admin/bulk-orders", icon: "view_in_ar", module: "bulkOrders", feature: "bulkOrders" },
      { name: "Production Queue", href: "/admin/production", icon: "precision_manufacturing", module: "production", feature: "customDesign" }
    ]
  },
  {
    title: "Marketing & CMS",
    items: [
      { name: "Banners", href: "/admin/banners", icon: "view_carousel", module: "banners" },
      { name: "Campaigns & Offers", href: "/admin/campaigns", icon: "campaign", module: "campaigns" },
      { name: "Coupons", href: "/admin/coupons", icon: "sell", module: "coupons" },
      { name: "Themes", href: "/admin/themes", icon: "auto_awesome", module: "themes" }
    ]
  },
  {
    title: "Operations & Reporting",
    items: [
      { name: "Invoice Register", href: "/admin/invoices", icon: "receipt_long", module: "invoices" },
      { name: "Inventory Ledger", href: "/admin/inventory-ledger", icon: "history", module: "inventoryLedger" },
      { name: "Notification Logs", href: "/admin/notifications", icon: "mail", module: "notifications" },
      { name: "Payment Reconciliation", href: "/admin/payment-reconciliation", icon: "fact_check", module: "paymentReconciliation" },
      { name: "Payment Diagnostics", href: "/admin/payment-attempts", icon: "credit_card", module: "paymentDiagnostics" },
      { name: "Audit Logs", href: "/admin/audit-logs", icon: "shield", module: "auditLogs" },
      { name: "Webhook Monitor", href: "/admin/webhooks", icon: "sensors", module: "webhooks" },
      { name: "System Health", href: "/admin/system-health", icon: "monitor_heart", module: "systemHealth" },
      { name: "Team Management", href: "/admin/team", icon: "shield_person", superAdminOnly: true }
    ]
  }
];

interface AdminSidebarProps {
  open?: boolean;
  onClose?: () => void;
}

export function AdminSidebar({ open, onClose }: AdminSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { logout, user } = useAuthStore();
  const [permissionsData, setPermissionsData] = useState<AdminPermissionsData | null>(null);

  useEffect(() => {
    let active = true;
    fetchAdminPermissions()
      .then((data) => {
        if (active) setPermissionsData(data);
      })
      .catch(() => {
        // Fallback for network issues
      });
    return () => {
      active = false;
    };
  }, []);

  const visibleNavGroups = useMemo(() => {
    return navGroups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => {
          // 1. Super Admin only check
          if (item.superAdminOnly) {
            const isSuper = permissionsData?.isSuperAdmin || user?.role === "SUPER_ADMIN";
            return Boolean(isSuper);
          }

          // 2. Feature flag check
          if (item.feature && permissionsData) {
            if (!permissionsData.features[item.feature]) return false;
          }

          // 3. Permission level check
          if (item.module && permissionsData) {
            if (permissionsData.isSuperAdmin) return true;
            const level = permissionsData.permissions[item.module];
            return level === "view" || level === "manage";
          }

          return true;
        }),
      }))
      .filter((group) => group.items.length > 0);
  }, [permissionsData, user]);

  const canManageProducts = useMemo(() => {
    if (!permissionsData) return true;
    if (permissionsData.isSuperAdmin) return true;
    return permissionsData.permissions.products === "manage";
  }, [permissionsData]);

  const handleSignOut = async () => {
    onClose?.();
    clearAdminPermissionsCache();
    await logout();
    router.replace("/admin/login");
  };

  return (
    <>
      {/* Mobile overlay backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-on-background/30 z-40 lg:hidden backdrop-blur-sm"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed left-0 top-0 bottom-0 z-50 flex flex-col pt-4 pb-6
          bg-surface-container-lowest border-r border-outline-variant
          w-64 h-full transition-transform duration-300
          ${open ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0
        `}
      >
        {/* Header */}
        <div className="px-6 pb-4 border-b border-outline-variant/40 mb-3 flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <h1 className="font-headline-sm text-base font-black text-on-surface tracking-tight uppercase">
              Operations Hub
            </h1>
            {/* Mobile close button */}
            <button
              onClick={onClose}
              aria-label="Close admin menu"
              className="lg:hidden p-1 -mr-1 text-on-surface-variant hover:text-on-surface rounded transition-colors"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>
          <div className="flex items-center justify-between">
            <span className="font-mono text-[9px] uppercase tracking-widest text-neutral-400 font-bold">
              SAMRAT FASHION
            </span>
            {permissionsData?.roleName && (
              <span className="font-mono text-[9px] bg-neutral-100 text-neutral-600 px-1.5 py-0.5 rounded uppercase font-semibold truncate max-w-[100px]">
                {permissionsData.roleName}
              </span>
            )}
          </div>
        </div>

        {/* Grouped Navigation */}
        <nav className="flex-1 overflow-y-auto px-2 space-y-5 custom-scrollbar">
          {visibleNavGroups.map((group) => (
            <div key={group.title} className="space-y-1">
              <p className="px-4 text-[10px] font-mono uppercase tracking-[0.18em] text-neutral-400 font-bold">
                {group.title}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const active = pathname === item.href || (item.href !== "/admin" && pathname.startsWith(item.href));
                  return (
                    <Link
                      key={item.name}
                      href={item.href}
                      onClick={onClose}
                      className={`
                        flex items-center gap-2.5 rounded-lg px-3 py-2 mx-1
                        transition-all duration-150 group text-xs min-h-[38px]
                        ${active
                          ? "bg-neutral-900 text-white font-bold shadow-xs"
                          : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
                        }
                      `}
                    >
                      <span
                        className={`material-symbols-outlined text-[18px] transition-colors ${active ? "text-white" : "text-neutral-500 group-hover:text-neutral-900"}`}
                        style={{ fontVariationSettings: active ? "'FILL' 1" : "'FILL' 0" }}
                      >
                        {item.icon}
                      </span>
                      <span className="font-body-sm font-medium tracking-tight truncate">{item.name}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Action Button & Sign Out */}
        <div className="px-4 mt-3 pt-3 border-t border-outline-variant/30 space-y-2">
          {canManageProducts && (
            <Link
              href="/admin/products/new"
              onClick={onClose}
              className="w-full bg-neutral-950 text-white font-mono text-[11px] font-bold uppercase tracking-wider py-3 rounded-lg hover:bg-neutral-800 transition-colors flex items-center justify-center gap-1.5 shadow-xs min-h-[44px]"
            >
              <span className="material-symbols-outlined text-[16px]">add</span>
              <span>New Product</span>
            </Link>
          )}
          <button
            type="button"
            onClick={handleSignOut}
            className="w-full flex items-center justify-center gap-2 text-neutral-500 hover:text-error text-xs font-mono uppercase font-bold py-1.5 transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined text-[16px]">logout</span>
            <span>Sign Out</span>
          </button>
        </div>
      </aside>
    </>
  );
}
