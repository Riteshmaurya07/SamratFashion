"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavItem {
  name: string;
  href: string;
  icon: string;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    title: "Overview",
    items: [
      { name: "Dashboard", href: "/admin", icon: "dashboard" }
    ]
  },
  {
    title: "Store Management",
    items: [
      { name: "Orders", href: "/admin/orders", icon: "shopping_bag" },
      { name: "Products", href: "/admin/products", icon: "inventory_2" },
      { name: "Categories", href: "/admin/categories", icon: "category" },
      { name: "Inventory", href: "/admin/inventory", icon: "warehouse" },
      { name: "Customers", href: "/admin/customers", icon: "group" },
      { name: "Returns", href: "/admin/returns", icon: "assignment_return" },
      { name: "Reviews", href: "/admin/reviews", icon: "star" },
      { name: "Support", href: "/admin/support", icon: "support_agent" }
    ]
  },
  {
    title: "Custom Printing & Production",
    items: [
      { name: "Print Catalog", href: "/admin/print-catalog", icon: "apparel" },
      { name: "Print Pricing", href: "/admin/print-pricing", icon: "payments" },
      { name: "Custom Orders", href: "/admin/custom-orders", icon: "palette" },
      { name: "Bulk Orders", href: "/admin/bulk-orders", icon: "view_in_ar" },
      { name: "Production Queue", href: "/admin/production", icon: "precision_manufacturing" }
    ]
  },
  {
    title: "Marketing & CMS",
    items: [
      { name: "Banners", href: "/admin/banners", icon: "view_carousel" },
      { name: "Campaigns & Offers", href: "/admin/campaigns", icon: "campaign" },
      { name: "Coupons", href: "/admin/coupons", icon: "sell" },
      { name: "Themes", href: "/admin/themes", icon: "auto_awesome" }
    ]
  },
  {
    title: "Operations & Reporting",
    items: [
      { name: "Invoice Register", href: "/admin/invoices", icon: "receipt_long" },
      { name: "Inventory Ledger", href: "/admin/inventory-ledger", icon: "history" },
      { name: "Notification Logs", href: "/admin/notifications", icon: "mail" },
      { name: "Payment Diagnostics", href: "/admin/payment-attempts", icon: "credit_card" },
      { name: "Audit Logs", href: "/admin/audit-logs", icon: "shield" },
      { name: "Webhook Monitor", href: "/admin/webhooks", icon: "sensors" },
      { name: "System Health", href: "/admin/system-health", icon: "monitor_heart" }
    ]
  }
];

interface AdminSidebarProps {
  open?: boolean;
  onClose?: () => void;
}

export function AdminSidebar({ open, onClose }: AdminSidebarProps) {
  const pathname = usePathname();


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
          <span className="font-mono text-[10px] uppercase tracking-widest text-primary font-bold">
            THREADVIBE // SAMRAT
          </span>
        </div>

        {/* Grouped Navigation */}
        <nav className="flex-1 overflow-y-auto px-2 space-y-5 custom-scrollbar">
          {navGroups.map((group) => (
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
                        flex items-center gap-2.5 rounded-lg px-3 py-1.5 mx-1
                        transition-all duration-200 group text-xs
                        ${active
                          ? "bg-neutral-900 text-white font-bold shadow-xs"
                          : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
                        }
                      `}
                    >
                      <span
                        className={`material-symbols-outlined text-[18px] transition-colors ${active ? "text-primary" : "text-neutral-500 group-hover:text-primary"}`}
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
          <Link
            href="/admin/products/new"
            onClick={onClose}
            className="w-full bg-primary text-white font-mono text-[11px] font-bold uppercase tracking-wider py-2.5 rounded-lg hover:bg-primary/90 transition-transform duration-200 active:scale-95 flex items-center justify-center gap-1.5 shadow-xs"
          >
            <span className="material-symbols-outlined text-[16px]">add</span>
            <span>New Product</span>
          </Link>
          <Link
            href="/admin/login"
            className="flex items-center justify-center gap-2 text-neutral-500 hover:text-error text-xs font-mono uppercase font-bold py-1.5 transition-colors"
          >
            <span className="material-symbols-outlined text-[16px]">logout</span>
            <span>Sign Out</span>
          </Link>
        </div>
      </aside>
    </>
  );
}
