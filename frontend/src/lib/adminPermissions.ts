import { api } from "./api.ts";

export const ADMIN_MODULES = [
  // Overview
  "dashboard",
  // Store Management
  "orders",
  "products",
  "categories",
  "inventory",
  "customers",
  "returns",
  "reviews",
  "support",
  "settings",
  // Custom Printing & Production
  "printCatalog",
  "printPricing",
  "customOrders",
  "bulkOrders",
  "production",
  // Marketing & CMS
  "banners",
  "campaigns",
  "coupons",
  "themes",
  // Operations & Reporting
  "invoices",
  "inventoryLedger",
  "notifications",
  "paymentReconciliation",
  "paymentDiagnostics",
  "auditLogs",
  "webhooks",
  "systemHealth",
] as const;

export type AdminModule = (typeof ADMIN_MODULES)[number];
export type PermissionLevel = "none" | "view" | "manage";

export interface AdminPermissionsData {
  isSuperAdmin: boolean;
  roleName: string | null;
  permissions: Record<AdminModule, PermissionLevel>;
  sensitiveActions: {
    canRefund: boolean;
    canChangePrices: boolean;
    canManageCoupons: boolean;
    canSuspendUsers: boolean;
    canManageSettings: boolean;
    canManageWebhooks: boolean;
  };
  features: {
    customDesign: boolean;
    bulkOrders: boolean;
  };
}

export const MODULE_ROUTE_MAP: Record<AdminModule, string> = {
  dashboard: "/admin",
  orders: "/admin/orders",
  products: "/admin/products",
  categories: "/admin/categories",
  inventory: "/admin/inventory",
  customers: "/admin/customers",
  returns: "/admin/returns",
  reviews: "/admin/reviews",
  support: "/admin/support",
  settings: "/admin/settings",
  printCatalog: "/admin/print-catalog",
  printPricing: "/admin/print-pricing",
  customOrders: "/admin/custom-orders",
  bulkOrders: "/admin/bulk-orders",
  production: "/admin/production",
  banners: "/admin/banners",
  campaigns: "/admin/campaigns",
  coupons: "/admin/coupons",
  themes: "/admin/themes",
  invoices: "/admin/invoices",
  inventoryLedger: "/admin/inventory-ledger",
  notifications: "/admin/notifications",
  paymentReconciliation: "/admin/payment-reconciliation",
  paymentDiagnostics: "/admin/payment-attempts",
  auditLogs: "/admin/audit-logs",
  webhooks: "/admin/webhooks",
  systemHealth: "/admin/system-health",
};

// Route ordering for finding the first accessible module
export const ORDERED_MODULE_ROUTES: { module: AdminModule; href: string }[] = [
  { module: "dashboard", href: "/admin" },
  { module: "orders", href: "/admin/orders" },
  { module: "products", href: "/admin/products" },
  { module: "categories", href: "/admin/categories" },
  { module: "inventory", href: "/admin/inventory" },
  { module: "customers", href: "/admin/customers" },
  { module: "returns", href: "/admin/returns" },
  { module: "reviews", href: "/admin/reviews" },
  { module: "support", href: "/admin/support" },
  { module: "settings", href: "/admin/settings" },
  { module: "printCatalog", href: "/admin/print-catalog" },
  { module: "printPricing", href: "/admin/print-pricing" },
  { module: "customOrders", href: "/admin/custom-orders" },
  { module: "bulkOrders", href: "/admin/bulk-orders" },
  { module: "production", href: "/admin/production" },
  { module: "banners", href: "/admin/banners" },
  { module: "campaigns", href: "/admin/campaigns" },
  { module: "coupons", href: "/admin/coupons" },
  { module: "themes", href: "/admin/themes" },
  { module: "invoices", href: "/admin/invoices" },
  { module: "inventoryLedger", href: "/admin/inventory-ledger" },
  { module: "notifications", href: "/admin/notifications" },
  { module: "paymentReconciliation", href: "/admin/payment-reconciliation" },
  { module: "paymentDiagnostics", href: "/admin/payment-attempts" },
  { module: "auditLogs", href: "/admin/audit-logs" },
  { module: "webhooks", href: "/admin/webhooks" },
  { module: "systemHealth", href: "/admin/system-health" },
];

let cachedPermissions: AdminPermissionsData | null = null;
let inFlightPermissionsPromise: Promise<AdminPermissionsData> | null = null;

export function clearAdminPermissionsCache(): void {
  cachedPermissions = null;
  inFlightPermissionsPromise = null;
}

export async function fetchAdminPermissions(forceRefresh = false): Promise<AdminPermissionsData> {
  if (!forceRefresh && cachedPermissions) {
    return cachedPermissions;
  }
  if (!forceRefresh && inFlightPermissionsPromise) {
    return inFlightPermissionsPromise;
  }

  inFlightPermissionsPromise = api
    .get("/admin/me/permissions")
    .then((res) => {
      const data = res.data?.data as AdminPermissionsData;
      cachedPermissions = data;
      inFlightPermissionsPromise = null;
      return data;
    })
    .catch((err) => {
      inFlightPermissionsPromise = null;
      throw err;
    });

  return inFlightPermissionsPromise;
}

/**
 * Determine which admin module an URL path maps to.
 */
export function getModuleForPath(pathname: string): AdminModule | "team" | null {
  const cleanPath = pathname.split("?")[0].replace(/\/+$/, "") || "/admin";

  if (cleanPath === "/admin/team" || cleanPath.startsWith("/admin/team/")) {
    return "team";
  }

  // Exact match for dashboard
  if (cleanPath === "/admin") {
    return "dashboard";
  }

  // Match sub-routes
  for (const { module, href } of ORDERED_MODULE_ROUTES) {
    if (href === "/admin") continue;
    if (cleanPath === href || cleanPath.startsWith(href + "/")) {
      return module;
    }
  }

  return null;
}

/**
 * Checks whether the current user has permission to view the route.
 */
export function isRouteAllowed(pathname: string, permData: AdminPermissionsData | null): boolean {
  if (!permData) return false;
  if (permData.isSuperAdmin) return true;

  const targetModule = getModuleForPath(pathname);

  // Team page is strictly SUPER_ADMIN only
  if (targetModule === "team") {
    return permData.isSuperAdmin;
  }

  if (!targetModule) {
    // If not a recognized admin module route, allow by default
    return true;
  }

  const level = permData.permissions[targetModule];
  return level === "view" || level === "manage";
}

/**
 * Finds the first allowed module route for a staff member who lacks dashboard permission.
 */
export function getFirstAllowedRoute(permData: AdminPermissionsData | null): string | null {
  if (!permData) return null;
  if (permData.isSuperAdmin) return "/admin";

  for (const { module, href } of ORDERED_MODULE_ROUTES) {
    const level = permData.permissions[module];
    if (level === "view" || level === "manage") {
      return href;
    }
  }

  return null;
}
