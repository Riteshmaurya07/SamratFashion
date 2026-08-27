"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";

interface NavItem {
  name: string;
  href: string;
  icon: string;
}

const navItems: NavItem[] = [
  { name: "Dashboard", href: "/admin", icon: "dashboard" },
  { name: "Orders", href: "/admin/orders", icon: "shopping_bag" },
  { name: "Custom Orders", href: "/admin/custom-orders", icon: "print" },
  { name: "Production", href: "/admin/production", icon: "precision_manufacturing" },
  { name: "Returns", href: "/admin/returns", icon: "assignment_return" },
  { name: "Products", href: "/admin/products", icon: "inventory_2" },
  { name: "Categories", href: "/admin/categories", icon: "category" },
  { name: "Inventory", href: "/admin/inventory", icon: "warehouse" },
  { name: "Customers", href: "/admin/customers", icon: "group" },
  { name: "Bulk Orders", href: "/admin/bulk-orders", icon: "inventory" },
  { name: "Reviews", href: "/admin/reviews", icon: "star" },
  { name: "Support", href: "/admin/support", icon: "support_agent" },
  { name: "CMS Banners", href: "/admin/cms/banners", icon: "view_carousel" },
  { name: "Campaigns", href: "/admin/campaigns", icon: "campaign" },
  { name: "Themes", href: "/admin/themes", icon: "palette" },
  { name: "Coupons", href: "/admin/coupons", icon: "sell" },
];

interface AdminSidebarProps {
  open?: boolean;
  onClose?: () => void;
}

export function AdminSidebar({ open, onClose }: AdminSidebarProps) {
  const pathname = usePathname();

  const isActive = (item: NavItem) =>
    pathname === item.href || (item.href !== "/admin" && pathname.startsWith(item.href));

  return (
    <>
      {/* Mobile overlay backdrop */}
      {open && (
        <div
          className="fixed inset-0 bg-on-background/30 z-40 lg:hidden backdrop-blur-sm"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed left-0 top-0 bottom-0 z-50 flex flex-col pt-4 pb-8
          bg-surface-container-lowest border-r border-outline-variant
          w-64 h-full transition-transform duration-300
          ${open ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0
        `}
      >
        {/* Header */}
        <div className="px-6 pb-6 border-b border-outline-variant/50 mb-6 flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <h1 className="font-headline-sm text-headline-sm font-bold text-on-surface tracking-tight">
              Operations
            </h1>
            {/* Mobile close button */}
            <button
              onClick={onClose}
              className="lg:hidden p-1 -mr-1 text-on-surface-variant hover:text-on-surface rounded transition-colors"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>
          <span className="font-label-caps text-label-caps text-on-surface-variant">Global Admin</span>
        </div>

        {/* Main Navigation */}
        <nav className="flex-1 overflow-y-auto px-2 space-y-1" style={{ scrollbarWidth: "none" }}>
          {navItems.map((item) => {
            const active = isActive(item);
            return (
              <Link
                key={item.name}
                href={item.href}
                onClick={onClose}
                className={`
                  flex items-center gap-3 rounded-lg px-4 py-2 mx-2
                  transition-all duration-200 group
                  ${active
                    ? "bg-primary-container text-on-primary-container translate-x-1"
                    : "text-on-surface-variant hover:bg-surface-container-high hover:translate-x-1"
                  }
                `}
              >
                <span
                  className={`material-symbols-outlined text-[20px] transition-colors ${active ? "" : "group-hover:text-primary"}`}
                  style={{ fontVariationSettings: active ? "'FILL' 1" : "'FILL' 0" }}
                >
                  {item.icon}
                </span>
                <span className="font-label-caps text-label-caps mt-0.5">{item.name}</span>
              </Link>
            );
          })}
        </nav>

        {/* CTA Button */}
        <div className="px-4 mt-6">
          <Link
            href="/admin/products/new"
            onClick={onClose}
            className="w-full bg-primary text-on-primary font-label-caps text-label-caps py-3 rounded-lg hover:bg-primary/90 transition-transform duration-200 active:scale-95 flex items-center justify-center gap-2"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            Add Product
          </Link>
        </div>

        {/* Footer Nav */}
        <div className="mt-4 px-2 space-y-1 border-t border-outline-variant/50 pt-4">
          <Link
            href="/admin/login"
            className="flex items-center gap-3 text-error hover:bg-error-container/20 rounded-lg px-4 py-2 mx-2 transition-all duration-200"
          >
            <span className="material-symbols-outlined text-[20px]">logout</span>
            <span className="font-label-caps text-label-caps mt-0.5">Sign Out</span>
          </Link>
        </div>
      </aside>
    </>
  );
}
