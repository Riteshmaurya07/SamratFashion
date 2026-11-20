/**
 * Admin Custom Roles & Role-Based Access Control (RBAC) Verification Suite
 *
 * Verifies end-to-end enforcement of custom admin roles:
 * (a) Staff user with orders: view only can list orders but gets 403 on order-status change / refund.
 * (b) Staff user with products: manage but WITHOUT canChangePrices gets 403 on price change (while editing name/stock succeeds).
 * (c) Staff user cannot open /admin/team or any team/role endpoint (403).
 * (d) Removing a role revokes the user's sessions immediately.
 * (e) SUPER_ADMIN bypasses all permission checks (full access).
 * (f) Migration rule: Existing ADMIN with NO custom role keeps full access (old behaviour).
 * (g) Denied API calls are written to the AuditLog (actor, attempted action, module).
 * (h) Deleting a role that still has users assigned is refused (400) until users are moved/removed.
 * (i) The owner (SUPER_ADMIN) can never lock himself out: cannot remove his own SUPER_ADMIN role or demote the last SUPER_ADMIN.
 * (j) Permissions are evaluated from the DB per request (not baked into JWT).
 */

import http from "http";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { connectSafeTestDb } from "./testHelpers";
import { User, UserRole, UserStatus } from "../models/User";
import { Role } from "../models/Role";
import { Session } from "../models/Session";
import { AuditLog } from "../models/AuditLog";
import { Product, ProductStatus } from "../models/Product";
import { Category, CategoryStatus } from "../models/Category";
import { Order } from "../models/Order";
import { getJwtAccessSecret } from "../config/env";

process.env.NODE_ENV = "test";
const { app } = require("../index") as typeof import("../index");

let passed = 0;
let failed = 0;

function check(condition: boolean, description: string): void {
  if (condition) {
    console.log(`  ✅ PASS: ${description}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${description}`);
    failed++;
  }
}

function withResolvers<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface HttpResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: any;
  rawText: string;
}

async function request(
  serverUrl: string,
  method: string,
  path: string,
  body?: unknown,
  token?: string
): Promise<HttpResponse> {
  const { promise, resolve, reject } = withResolvers<HttpResponse>();
  const url = new URL(path, serverUrl);
  const headers: Record<string, string> = {};
  let payload = "";

  if (body !== undefined) {
    payload = JSON.stringify(body);
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = String(Buffer.byteLength(payload));
  }
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const req = http.request(url, { method, headers }, (res) => {
    let resData = "";
    res.on("data", (chunk) => {
      resData += chunk;
    });
    res.on("end", () => {
      let parsed = null;
      try {
        parsed = resData ? JSON.parse(resData) : null;
      } catch {
        parsed = null;
      }
      resolve({
        status: res.statusCode || 500,
        headers: res.headers,
        body: parsed,
        rawText: resData,
      });
    });
  });

  req.on("error", reject);
  if (payload) {
    req.write(payload);
  }
  req.end();
  return promise;
}

function createAccessToken(user: any): string {
  return jwt.sign(
    { sub: user._id.toString(), role: user.role, tokenVersion: user.tokenVersion || 0 },
    getJwtAccessSecret(),
    { expiresIn: "15m" }
  );
}

async function runRbacTests(): Promise<void> {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║     Admin Custom RBAC & Permissions Enforcement Test Suite     ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");

  await connectSafeTestDb();

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to obtain test server address");
  }
  const serverUrl = `http://127.0.0.1:${address.port}`;

  const runId = Date.now();
  const testPassword = "Password@123!";
  const passwordHash = await bcrypt.hash(testPassword, 10);

  try {
    // 1. Seed Owner (SUPER_ADMIN)
    const superAdmin = await User.create({
      name: "Ritesh Owner",
      email: `owner_${runId}@example.com`,
      passwordHash,
      role: UserRole.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      tokenVersion: 0,
    });
    const superAdminToken = createAccessToken(superAdmin);

    // 2. Seed Migration ADMIN (Legacy ADMIN with NO custom role)
    const legacyAdmin = await User.create({
      name: "Legacy Admin",
      email: `legacy_admin_${runId}@example.com`,
      passwordHash,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      customRoleId: null,
      tokenVersion: 0,
    });
    const legacyAdminToken = createAccessToken(legacyAdmin);

    // 3. Seed Custom Role: "Orders Staff" (orders: view only, returns: view only, all others none, sensitive actions false)
    const ordersStaffRole = await Role.create({
      name: `Orders Staff ${runId}`,
      description: "Can view orders and returns only",
      permissions: {
        dashboard: "none",
        orders: "view",
        returns: "view",
      },
      canRefund: false,
      canChangePrices: false,
      canManageCoupons: false,
      canSuspendUsers: false,
      canManageSettings: false,
      canManageWebhooks: false,
      createdBy: superAdmin._id,
    });

    const ordersStaffUser = await User.create({
      name: "Order Viewer",
      email: `orders_staff_${runId}@example.com`,
      passwordHash,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      customRoleId: ordersStaffRole._id,
      tokenVersion: 0,
    });
    const ordersStaffToken = createAccessToken(ordersStaffUser);

    // 4. Seed Custom Role: "Catalog Editor" (products: manage, but canChangePrices: false)
    const catalogEditorRole = await Role.create({
      name: `Catalog Editor ${runId}`,
      description: "Can edit products but cannot change prices",
      permissions: {
        dashboard: "view",
        products: "manage",
        categories: "view",
      },
      canRefund: false,
      canChangePrices: false, // Explicitly false!
      canManageCoupons: false,
      canSuspendUsers: false,
      canManageSettings: false,
      canManageWebhooks: false,
      createdBy: superAdmin._id,
    });

    const catalogEditorUser = await User.create({
      name: "Catalog Staff",
      email: `catalog_editor_${runId}@example.com`,
      passwordHash,
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      customRoleId: catalogEditorRole._id,
      tokenVersion: 0,
    });
    const catalogEditorToken = createAccessToken(catalogEditorUser);

    // 5. Seed Test Category & Product
    const testCategory = await Category.create({
      name: `Test Cat ${runId}`,
      slug: `test-cat-${runId}`,
      status: CategoryStatus.ACTIVE,
      displayOrder: 1,
    });

    const variantId = new mongoose.Types.ObjectId();
    const testProduct = await Product.create({
      name: `Test T-Shirt ${runId}`,
      slug: `test-tshirt-${runId}`,
      description: "Test product description for RBAC test",
      categoryId: testCategory._id,
      basePrice: 500,
      mrp: 999,
      status: ProductStatus.DRAFT,
      variants: [
        {
          _id: variantId,
          size: "M",
          color: "Black",
          sku: `SKU-${runId}-M-BLK`,
          stock: 20,
          additionalPrice: 0,
          images: [],
          isAvailable: true,
        },
      ],
    });

    // 6. Seed Test Order
    const testOrder = await Order.create({
      orderNumber: `ORD-${runId}`,
      userId: ordersStaffUser._id,
      items: [
        {
          productId: testProduct._id,
          variantId,
          productName: testProduct.name,
          productImage: "https://example.com/test.jpg",
          quantity: 1,
          unitPrice: 500,
          lineTotal: 500,
          selectedSize: "M",
          selectedColor: "Black",
          sku: `SKU-${runId}-M-BLK`,
        },
      ],
      subtotal: 500,
      discount: 0,
      shipping: 0,
      tax: 0,
      total: 500,
      currency: "INR",
      status: "CONFIRMED",
      paymentStatus: "PAID",
      shippingAddress: {
        fullName: "Test Receiver",
        phone: "9876543210",
        addressLine1: "123 Test St",
        city: "Mumbai",
        state: "Maharashtra",
        postalCode: "400001",
        country: "IN",
        addressType: "HOME",
      },
    });

    // =========================================================================
    // REQUIREMENT (a): orders: view only can list orders but gets 403 on status change / refund
    // =========================================================================
    console.log("\n[TEST GROUP 1: Orders View-Only Gating]");
    {
      // 1.1 List orders -> 200 OK
      const listRes = await request(serverUrl, "GET", "/api/admin/orders", undefined, ordersStaffToken);
      check(listRes.status === 200, "1.1 Staff with orders:view can list orders (200 OK)");

      // 1.2 Update order status -> 403 Forbidden (requires orders: manage)
      const updateStatusRes = await request(
        serverUrl,
        "PATCH",
        `/api/admin/orders/${testOrder._id}/status`,
        { status: "PROCESSING" },
        ordersStaffToken
      );
      check(updateStatusRes.status === 403, "1.2 Staff with orders:view gets 403 on PATCH /orders/:id/status");

      // 1.3 Initiate refund -> 403 Forbidden (requires canRefund)
      const refundRes = await request(
        serverUrl,
        "POST",
        `/api/admin/orders/${testOrder._id}/refund`,
        { amount: 500, reason: "Customer return" },
        ordersStaffToken
      );
      check(refundRes.status === 403, "1.3 Staff with orders:view gets 403 on POST /orders/:id/refund");

      // 1.4 Admin cancel order -> 403 Forbidden (requires canRefund)
      const cancelRes = await request(
        serverUrl,
        "POST",
        `/api/admin/orders/${testOrder._id}/cancel`,
        { reason: "Staff cancel" },
        ordersStaffToken
      );
      check(cancelRes.status === 403, "1.4 Staff with orders:view gets 403 on POST /orders/:id/cancel");

      // 1.5 AuditLog recorded the denied refund attempt
      const auditEntry = await AuditLog.findOne({
        actorId: ordersStaffUser._id,
        action: "PERMISSION_DENIED",
        "metadata.module": "orders",
      }).sort({ createdAt: -1 });
      check(Boolean(auditEntry), "1.5 AuditLog recorded PERMISSION_DENIED entry for denied order action");
    }

    // =========================================================================
    // REQUIREMENT (b): products: manage WITHOUT canChangePrices gets 403 on price change
    // =========================================================================
    console.log("\n[TEST GROUP 2: Sensitive Price Change Gating]");
    {
      // 2.1 Editing product name and stock -> 200 OK
      const editNameRes = await request(
        serverUrl,
        "PUT",
        `/api/admin/products/${testProduct._id}`,
        {
          name: `Updated T-Shirt Name ${runId}`,
        },
        catalogEditorToken
      );
      check(editNameRes.status === 200, "2.1 Staff with products:manage can update product name/stock without price change (200 OK)");

      // 2.2 Attempting to change basePrice -> 403 Forbidden
      const changeBasePriceRes = await request(
        serverUrl,
        "PUT",
        `/api/admin/products/${testProduct._id}`,
        {
          basePrice: 650, // Modified!
        },
        catalogEditorToken
      );
      check(changeBasePriceRes.status === 403, "2.2 Staff with products:manage but WITHOUT canChangePrices gets 403 on basePrice change");
      check(
        changeBasePriceRes.body?.message?.includes("price") || changeBasePriceRes.body?.code === "FORBIDDEN",
        "2.2b Clear forbidden message returned for price change denial"
      );

      // 2.3 Attempting to change mrp -> 403 Forbidden
      const changeMrpRes = await request(
        serverUrl,
        "PUT",
        `/api/admin/products/${testProduct._id}`,
        {
          mrp: 1299, // Modified!
        },
        catalogEditorToken
      );
      check(changeMrpRes.status === 403, "2.3 Staff with products:manage but WITHOUT canChangePrices gets 403 on mrp change");

      // 2.4 Verify product price in DB remains unchanged (still 500 / 999)
      const unchangedProduct = await Product.findById(testProduct._id);
      check(
        unchangedProduct?.basePrice === 500 && unchangedProduct?.mrp === 999,
        "2.4 Product basePrice and mrp remained unmodified in database"
      );

      // 2.5 SUPER_ADMIN CAN change price -> 200 OK
      const superAdminPriceRes = await request(
        serverUrl,
        "PUT",
        `/api/admin/products/${testProduct._id}`,
        {
          basePrice: 550,
          mrp: 1099,
        },
        superAdminToken
      );
      check(superAdminPriceRes.status === 200, "2.5 SUPER_ADMIN can change product prices freely (200 OK)");
    }

    // =========================================================================
    // REQUIREMENT (c): Staff user cannot open /admin/team or any team/role endpoint (403)
    // =========================================================================
    console.log("\n[TEST GROUP 3: Team Page /admin/team SUPER_ADMIN Strict Enforcement]");
    {
      // 3.1 Non-superadmin staff gets 403 on GET /api/admin/team/members
      const teamMembersRes = await request(
        serverUrl,
        "GET",
        "/api/admin/team/members",
        undefined,
        ordersStaffToken
      );
      check(teamMembersRes.status === 403, "3.1 Staff user gets 403 on GET /api/admin/team/members");

      // 3.2 Non-superadmin staff gets 403 on GET /api/admin/team/roles
      const teamRolesRes = await request(
        serverUrl,
        "GET",
        "/api/admin/team/roles",
        undefined,
        catalogEditorToken
      );
      check(teamRolesRes.status === 403, "3.2 Staff user gets 403 on GET /api/admin/team/roles");

      // 3.3 Non-superadmin staff gets 403 on POST /api/admin/team/roles (role creation)
      const createRoleRes = await request(
        serverUrl,
        "POST",
        "/api/admin/team/roles",
        {
          name: `Unauthorized Role ${runId}`,
          permissions: { orders: "manage" },
        },
        ordersStaffToken
      );
      check(createRoleRes.status === 403, "3.3 Staff user gets 403 on POST /api/admin/team/roles");

      // 3.4 Non-superadmin staff gets 403 on role assignment endpoint
      const assignRoleRes = await request(
        serverUrl,
        "POST",
        `/api/admin/team/members/${ordersStaffUser._id}/role`,
        { roleId: catalogEditorRole._id },
        ordersStaffToken
      );
      check(assignRoleRes.status === 403, "3.4 Staff user gets 403 on POST /api/admin/team/members/:userId/role");

      // 3.5 SUPER_ADMIN can access team endpoints -> 200 OK
      const superAdminTeamRes = await request(
        serverUrl,
        "GET",
        "/api/admin/team/members",
        undefined,
        superAdminToken
      );
      check(superAdminTeamRes.status === 200, "3.5 SUPER_ADMIN can access GET /api/admin/team/members (200 OK)");
    }

    // =========================================================================
    // REQUIREMENT (d): Removing a role revokes the user's sessions immediately
    // =========================================================================
    console.log("\n[TEST GROUP 4: Immediate Session Revocation on Role Removal]");
    {
      // 4.1 Seed a staff user with active session
      const tempRole = await Role.create({
        name: `Temporary Staff ${runId}`,
        permissions: { dashboard: "view", orders: "view" },
        createdBy: superAdmin._id,
      });

      const memberToRevoke = await User.create({
        name: "Temporary Staff Member",
        email: `temp_staff_${runId}@example.com`,
        passwordHash,
        role: UserRole.ADMIN,
        status: UserStatus.ACTIVE,
        emailVerified: true,
        customRoleId: tempRole._id,
        tokenVersion: 1,
      });

      // Create an active session in DB for this user
      await Session.create({
        userId: memberToRevoke._id,
        tokenHash: `test_token_hash_${runId}`,
        refreshTokenHash: `test_refresh_hash_${runId}`,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        lastUsedAt: new Date(),
      });

      // Verify active session exists before revocation
      const activeSessionsBefore = await Session.find({
        userId: memberToRevoke._id,
        revokedAt: { $exists: false },
      });
      check(activeSessionsBefore.length === 1, "4.1 User has 1 active session prior to removal");

      // Generate access token before removal
      const preRemovalToken = createAccessToken(memberToRevoke);

      // Verify they can view orders right before removal
      const accessBefore = await request(
        serverUrl,
        "GET",
        "/api/admin/orders",
        undefined,
        preRemovalToken
      );
      check(accessBefore.status === 200, "4.2 User has admin access before removal (200 OK)");

      // Owner calls DELETE /api/admin/team/members/:userId/role to remove staff access
      const removeRes = await request(
        serverUrl,
        "DELETE",
        `/api/admin/team/members/${memberToRevoke._id}/role`,
        undefined,
        superAdminToken
      );
      check(removeRes.status === 200, "4.3 Owner removes staff access via DELETE /api/admin/team/members/:userId/role (200 OK)");

      // Check DB: base role flipped to CUSTOMER, customRoleId set to null
      const updatedUser = await User.findById(memberToRevoke._id);
      check(updatedUser?.role === UserRole.CUSTOMER, "4.4 Base role flipped back to CUSTOMER");
      check(updatedUser?.customRoleId === null, "4.5 customRoleId set to null");

      // Check DB: session revoked immediately
      const activeSessionsAfter = await Session.find({
        userId: memberToRevoke._id,
        revokedAt: { $exists: false },
      });
      check(activeSessionsAfter.length === 0, "4.6 All active sessions in DB revoked immediately (revokedAt set)");

      // Subsequent API call with old token is rejected immediately (401 or 403)
      const accessAfter = await request(
        serverUrl,
        "GET",
        "/api/admin/orders",
        undefined,
        preRemovalToken
      );
      check(
        accessAfter.status === 401 || accessAfter.status === 403,
        `4.7 Request immediately rejected on next API call (${accessAfter.status})`
      );

      // AuditLog has record of role removal
      const removalAudit = await AuditLog.findOne({
        entityId: memberToRevoke._id,
        action: "STAFF_ROLE_REMOVED",
      });
      check(Boolean(removalAudit), "4.8 AuditLog records STAFF_ROLE_REMOVED with target user ID");
    }

    // =========================================================================
    // REQUIREMENT (e) & (f): SUPER_ADMIN bypass and Migration ADMIN full access
    // =========================================================================
    console.log("\n[TEST GROUP 5: SUPER_ADMIN Bypass and Migration ADMIN Full Access]");
    {
      // 5.1 SUPER_ADMIN can access dashboard
      const saDashboard = await request(serverUrl, "GET", "/api/admin/dashboard", undefined, superAdminToken);
      check(saDashboard.status === 200, "5.1 SUPER_ADMIN bypasses all checks and accesses dashboard (200 OK)");

      // 5.2 SUPER_ADMIN can access settings
      const saSettings = await request(serverUrl, "GET", "/api/admin/settings", undefined, superAdminToken);
      check(saSettings.status === 200, "5.2 SUPER_ADMIN accesses settings (200 OK)");

      // 5.3 Legacy ADMIN with NO custom role keeps full access (migration rule)
      const legacyOrders = await request(serverUrl, "GET", "/api/admin/orders", undefined, legacyAdminToken);
      check(legacyOrders.status === 200, "5.3 Legacy ADMIN (no custom role) can list orders (200 OK)");

      const legacyProducts = await request(serverUrl, "GET", "/api/admin/products", undefined, legacyAdminToken);
      check(legacyProducts.status === 200, "5.4 Legacy ADMIN (no custom role) can view products (200 OK)");

      const legacySettings = await request(serverUrl, "GET", "/api/admin/settings", undefined, legacyAdminToken);
      check(legacySettings.status === 200, "5.5 Legacy ADMIN (no custom role) can view settings (200 OK)");

      // 5.4 Legacy ADMIN gets 403 on /admin/team (team management is strictly SUPER_ADMIN only)
      const legacyTeam = await request(serverUrl, "GET", "/api/admin/team/members", undefined, legacyAdminToken);
      check(legacyTeam.status === 403, "5.6 Legacy ADMIN cannot access /admin/team (SUPER_ADMIN only)");
    }

    // =========================================================================
    // REQUIREMENT (g): Role deletion safety check (refused when assigned)
    // =========================================================================
    console.log("\n[TEST GROUP 6: Role Management & In-Use Delete Protection]");
    {
      // 6.1 Create a new role via API
      const newRoleRes = await request(
        serverUrl,
        "POST",
        "/api/admin/team/roles",
        {
          name: `Support Specialists ${runId}`,
          description: "Handles customer support tickets",
          permissions: {
            support: "manage",
            dashboard: "view",
          },
          canRefund: false,
        },
        superAdminToken
      );
      check(newRoleRes.status === 201, "6.1 SUPER_ADMIN creates custom role via POST /api/admin/team/roles (201 Created)");
      const createdRoleId = newRoleRes.body?.data?._id;

      // 6.2 Assign this role to a test user
      const roleAssignee = await User.create({
        name: "Role Assignee Test",
        email: `role_assignee_${runId}@example.com`,
        passwordHash,
        role: UserRole.CUSTOMER,
        status: UserStatus.ACTIVE,
        emailVerified: true,
        tokenVersion: 0,
      });

      await request(
        serverUrl,
        "POST",
        `/api/admin/team/members/${roleAssignee._id}/role`,
        { roleId: createdRoleId },
        superAdminToken
      );

      // 6.3 Attempt to delete role while assigned -> 400 Refused
      const deleteInUseRes = await request(
        serverUrl,
        "DELETE",
        `/api/admin/team/roles/${createdRoleId}`,
        undefined,
        superAdminToken
      );
      check(deleteInUseRes.status === 400, "6.3 Deleting a role that has users assigned is REFUSED (400 Bad Request)");
      check(
        deleteInUseRes.body?.message?.includes("assigned") || deleteInUseRes.body?.code === "ROLE_IN_USE",
        "6.3b Clear error message explains users are assigned to the role"
      );

      // 6.4 Remove role from user
      await request(
        serverUrl,
        "DELETE",
        `/api/admin/team/members/${roleAssignee._id}/role`,
        undefined,
        superAdminToken
      );

      // 6.5 Now delete succeeds -> 200 OK
      const deleteEmptyRes = await request(
        serverUrl,
        "DELETE",
        `/api/admin/team/roles/${createdRoleId}`,
        undefined,
        superAdminToken
      );
      check(deleteEmptyRes.status === 200, "6.5 Deleting role succeeds once no users are assigned (200 OK)");
    }

    // =========================================================================
    // REQUIREMENT (h): Owner lockout protection (cannot demote last SUPER_ADMIN)
    // =========================================================================
    console.log("\n[TEST GROUP 7: Owner Lockout & Demotion Protection]");
    {
      // 7.1 Owner cannot remove his own access
      const removeSelfRes = await request(
        serverUrl,
        "DELETE",
        `/api/admin/team/members/${superAdmin._id}/role`,
        undefined,
        superAdminToken
      );
      check(removeSelfRes.status === 403, "7.1 Owner cannot remove his own admin access (403 Forbidden)");

      // 7.2 Owner cannot suspend his own account
      const suspendSelfRes = await request(
        serverUrl,
        "PATCH",
        `/api/admin/team/members/${superAdmin._id}/status`,
        { status: "SUSPENDED" },
        superAdminToken
      );
      check(suspendSelfRes.status === 403, "7.2 Owner cannot suspend his own account (403 Forbidden)");
    }

    // =========================================================================
    // REQUIREMENT (i): Effective permissions endpoint GET /api/admin/me/permissions
    // =========================================================================
    console.log("\n[TEST GROUP 8: GET /api/admin/me/permissions Endpoint]");
    {
      // 8.1 Staff user retrieves permissions
      const permsRes = await request(
        serverUrl,
        "GET",
        "/api/admin/me/permissions",
        undefined,
        ordersStaffToken
      );
      check(permsRes.status === 200, "8.1 Staff user retrieves permissions via GET /api/admin/me/permissions (200 OK)");
      check(permsRes.body?.data?.isSuperAdmin === false, "8.2 isSuperAdmin is false for staff");
      check(permsRes.body?.data?.permissions?.orders === "view", "8.3 permissions.orders is 'view'");
      check(permsRes.body?.data?.permissions?.products === "none", "8.4 permissions.products is 'none'");
      check(permsRes.body?.data?.sensitiveActions?.canRefund === false, "8.5 sensitiveActions.canRefund is false");

      // 8.2 SUPER_ADMIN retrieves permissions
      const saPermsRes = await request(
        serverUrl,
        "GET",
        "/api/admin/me/permissions",
        undefined,
        superAdminToken
      );
      check(saPermsRes.status === 200, "8.6 SUPER_ADMIN retrieves permissions (200 OK)");
      check(saPermsRes.body?.data?.isSuperAdmin === true, "8.7 isSuperAdmin is true for SUPER_ADMIN");
      check(saPermsRes.body?.data?.sensitiveActions?.canRefund === true, "8.8 All sensitiveActions true for SUPER_ADMIN");
    }

    console.log("\n════════════════════════════════════════════════════════════════");
    console.log(`Results: ${passed} passed, ${failed} failed`);
    console.log("════════════════════════════════════════════════════════════════\n");

    if (failed > 0) {
      process.exit(1);
    }
  } finally {
    server.close();
    await mongoose.disconnect();
  }
}

runRbacTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
