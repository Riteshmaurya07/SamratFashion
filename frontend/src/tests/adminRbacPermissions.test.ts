import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  ADMIN_MODULES,
  type AdminPermissionsData,
  getModuleForPath,
  isRouteAllowed,
  getFirstAllowedRoute,
} from "../lib/adminPermissions.ts";

test("adminRbac: ADMIN_MODULES matches exactly the 27 specified modules", () => {
  assert.strictEqual(ADMIN_MODULES.length, 27);
  const expectedModules = [
    // Overview
    "dashboard",
    // Store Management
    "orders", "products", "categories", "inventory", "customers", "returns", "reviews", "support", "settings",
    // Custom Printing & Production
    "printCatalog", "printPricing", "customOrders", "bulkOrders", "production",
    // Marketing & CMS
    "banners", "campaigns", "coupons", "themes",
    // Operations & Reporting
    "invoices", "inventoryLedger", "notifications", "paymentReconciliation", "paymentDiagnostics", "auditLogs", "webhooks", "systemHealth"
  ];
  for (const mod of expectedModules) {
    assert.ok(ADMIN_MODULES.includes(mod as any), `Missing module: ${mod}`);
  }
});

test("adminRbac: getModuleForPath correctly maps URL paths to admin modules", () => {
  assert.strictEqual(getModuleForPath("/admin"), "dashboard");
  assert.strictEqual(getModuleForPath("/admin/orders"), "orders");
  assert.strictEqual(getModuleForPath("/admin/orders/12345"), "orders");
  assert.strictEqual(getModuleForPath("/admin/products/new"), "products");
  assert.strictEqual(getModuleForPath("/admin/products/123/edit"), "products");
  assert.strictEqual(getModuleForPath("/admin/coupons"), "coupons");
  assert.strictEqual(getModuleForPath("/admin/team"), "team");
  assert.strictEqual(getModuleForPath("/admin/team/roles"), "team");
  assert.strictEqual(getModuleForPath("/admin/webhooks"), "webhooks");
  assert.strictEqual(getModuleForPath("/admin/system-health"), "systemHealth");
});

test("adminRbac: isRouteAllowed allows SUPER_ADMIN everywhere including team", () => {
  const superAdminPerms: AdminPermissionsData = {
    isSuperAdmin: true,
    roleName: "SUPER_ADMIN",
    permissions: {} as any,
    sensitiveActions: {
      canRefund: true,
      canChangePrices: true,
      canManageCoupons: true,
      canSuspendUsers: true,
      canManageSettings: true,
      canManageWebhooks: true,
    },
    features: { customDesign: true, bulkOrders: true },
  };

  assert.strictEqual(isRouteAllowed("/admin", superAdminPerms), true);
  assert.strictEqual(isRouteAllowed("/admin/team", superAdminPerms), true);
  assert.strictEqual(isRouteAllowed("/admin/orders", superAdminPerms), true);
  assert.strictEqual(isRouteAllowed("/admin/settings", superAdminPerms), true);
});

test("adminRbac: isRouteAllowed strictly forbids /admin/team for non-superadmin staff", () => {
  const staffPerms: AdminPermissionsData = {
    isSuperAdmin: false,
    roleName: "Orders Staff",
    permissions: {
      dashboard: "view",
      orders: "manage",
      products: "none",
      categories: "none",
      inventory: "none",
      customers: "none",
      returns: "view",
      reviews: "none",
      support: "none",
      settings: "none",
      printCatalog: "none",
      printPricing: "none",
      customOrders: "none",
      bulkOrders: "none",
      production: "none",
      banners: "none",
      campaigns: "none",
      coupons: "none",
      themes: "none",
      invoices: "none",
      inventoryLedger: "none",
      notifications: "none",
      paymentReconciliation: "none",
      paymentDiagnostics: "none",
      auditLogs: "none",
      webhooks: "none",
      systemHealth: "none",
    },
    sensitiveActions: {
      canRefund: false,
      canChangePrices: false,
      canManageCoupons: false,
      canSuspendUsers: false,
      canManageSettings: false,
      canManageWebhooks: false,
    },
    features: { customDesign: false, bulkOrders: false },
  };

  assert.strictEqual(isRouteAllowed("/admin/team", staffPerms), false);
  assert.strictEqual(isRouteAllowed("/admin/orders", staffPerms), true);
  assert.strictEqual(isRouteAllowed("/admin/returns", staffPerms), true);
  assert.strictEqual(isRouteAllowed("/admin/products", staffPerms), false);
  assert.strictEqual(isRouteAllowed("/admin/coupons", staffPerms), false);
});

test("adminRbac: getFirstAllowedRoute finds the first permitted module when dashboard is none", () => {
  const noDashboardPerms: AdminPermissionsData = {
    isSuperAdmin: false,
    roleName: "Support Staff",
    permissions: {
      dashboard: "none",
      orders: "none",
      products: "none",
      categories: "none",
      inventory: "none",
      customers: "none",
      returns: "none",
      reviews: "view",
      support: "manage",
      settings: "none",
      printCatalog: "none",
      printPricing: "none",
      customOrders: "none",
      bulkOrders: "none",
      production: "none",
      banners: "none",
      campaigns: "none",
      coupons: "none",
      themes: "none",
      invoices: "none",
      inventoryLedger: "none",
      notifications: "none",
      paymentReconciliation: "none",
      paymentDiagnostics: "none",
      auditLogs: "none",
      webhooks: "none",
      systemHealth: "none",
    },
    sensitiveActions: {
      canRefund: false,
      canChangePrices: false,
      canManageCoupons: false,
      canSuspendUsers: false,
      canManageSettings: false,
      canManageWebhooks: false,
    },
    features: { customDesign: false, bulkOrders: false },
  };

  assert.strictEqual(getFirstAllowedRoute(noDashboardPerms), "/admin/reviews");
});

test("adminRbac: AdminSidebar source verifies Team Management and permission gating", () => {
  const sidebarPath = path.resolve(
    import.meta.dirname,
    "../app/(admin)/admin/AdminSidebar.tsx"
  );
  const source = fs.readFileSync(sidebarPath, "utf-8");

  // Verify Team Management is configured as superAdminOnly
  assert.match(
    source,
    /name:\s*"Team Management",\s*href:\s*"\/admin\/team",\s*icon:\s*"shield_person",\s*superAdminOnly:\s*true/,
    "AdminSidebar must declare Team Management with superAdminOnly: true"
  );

  // Verify module-based filtering
  assert.match(
    source,
    /permissionsData\.permissions\[item\.module\]/,
    "AdminSidebar must check permissionsData.permissions for module visibility"
  );

  // Verify New Product creation is guarded by products manage permission
  assert.match(
    source,
    /canManageProducts/,
    "AdminSidebar must guard New Product button with canManageProducts"
  );
});
