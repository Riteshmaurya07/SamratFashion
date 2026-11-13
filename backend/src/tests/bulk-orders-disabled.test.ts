import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

process.env.NODE_ENV = "test";
process.env.PORT = "5002";
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "test_jwt_access_secret_bulk_disable";
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "test_jwt_refresh_secret_bulk_disable";

import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { connectSafeTestDb } from "./testHelpers";
import { app } from "../index";
import { User, UserRole, UserStatus } from "../models/User";
import { BulkOrderRequest } from "../models/BulkOrderRequest";
import { BulkQuote } from "../models/BulkQuote";

let passed = 0;
let failed = 0;

function check(cond: boolean, description: string, details?: string): void {
  if (cond) {
    console.log(`  ✅ PASS: ${description}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${description} ${details ? `(${details})` : ""}`);
    failed++;
  }
}

async function request(method: string, urlPath: string, options: { token?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (options.token) headers["Authorization"] = `Bearer ${options.token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(`http://127.0.0.1:5002${urlPath}`, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json: json as Record<string, unknown> | null };
}

function readAccessToken(payload: unknown): string | undefined {
  if (payload && typeof payload === "object" && "data" in payload) {
    const inner = payload.data;
    if (inner && typeof inner === "object" && "accessToken" in inner) {
      return typeof inner.accessToken === "string" ? inner.accessToken : undefined;
    }
  }
  return undefined;
}

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function runBulkOrderDisablementSuite(): Promise<void> {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║  Bulk-Order Router Disablement & Isolation Test Suite          ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  await connectSafeTestDb();

  // Clean any prior flag
  delete process.env.ENABLE_BULK_ORDERS;

  const server = app.listen(5002);
  const listenGate = createDeferred<void>();
  server.on("listening", () => listenGate.resolve());
  await listenGate.promise;
  const initialRequestCount = await BulkOrderRequest.countDocuments();
  const initialQuoteCount = await BulkQuote.countDocuments();

  const testSuffix = Date.now().toString();
  const adminEmail = `bulk-admin-${testSuffix}@example.com`;
  const customerEmail = `bulk-customer-${testSuffix}@example.com`;
  const passwordHash = await bcrypt.hash("TestPass123!", 10);

  const adminUser = await User.create({
    name: "Bulk Admin",
    email: adminEmail,
    passwordHash,
    role: UserRole.ADMIN,
    status: UserStatus.ACTIVE,
  });

  const customerUser = await User.create({
    name: "Bulk Customer",
    email: customerEmail,
    passwordHash,
    role: UserRole.CUSTOMER,
    status: UserStatus.ACTIVE,
  });

  const loginCustomerRes = await request("POST", "/api/auth/login", {
    body: { email: customerEmail, password: "TestPass123!" },
  });
  const customerToken = readAccessToken(loginCustomerRes.json);

  const loginAdminRes = await request("POST", "/api/auth/login", {
    body: { email: adminEmail, password: "TestPass123!" },
  });
  const adminToken = readAccessToken(loginAdminRes.json);
  try {
    console.log("[GROUP 1: Customer Bulk-Order Public & Authenticated Endpoints]");

    const dummyId = new mongoose.Types.ObjectId().toString();

    // 1. POST /api/bulk-orders/request (unauthenticated guest or customer)
    const createReq = await request("POST", "/api/bulk-orders/request", {
      body: {
        contactName: "John Doe",
        email: "guest@example.com",
        phone: "9999999999",
        productId: dummyId,
        totalQuantity: 20,
      },
    });
    check(
      createReq.status === 503 && createReq.json?.code === "BULK_ORDERS_DISABLED",
      "1.1 POST /api/bulk-orders/request returns 503 BULK_ORDERS_DISABLED",
      `status=${createReq.status}, code=${createReq.json?.code}`
    );

    // 2. GET /api/bulk-orders (authenticated customer list)
    const listReq = await request("GET", "/api/bulk-orders", { token: customerToken });
    check(
      listReq.status === 503 && listReq.json?.code === "BULK_ORDERS_DISABLED",
      "1.2 GET /api/bulk-orders returns 503 BULK_ORDERS_DISABLED",
      `status=${listReq.status}, code=${listReq.json?.code}`
    );

    // 3. GET /api/bulk-orders/requests/:id
    const getByIdReq = await request("GET", `/api/bulk-orders/requests/${dummyId}`, { token: customerToken });
    check(
      getByIdReq.status === 503 && getByIdReq.json?.code === "BULK_ORDERS_DISABLED",
      "1.3 GET /api/bulk-orders/requests/:id returns 503 BULK_ORDERS_DISABLED",
      `status=${getByIdReq.status}, code=${getByIdReq.json?.code}`
    );

    // 4. GET /api/bulk-orders/quote/:quoteId
    const getQuoteReq = await request("GET", `/api/bulk-orders/quote/QT12345678`, { token: customerToken });
    check(
      getQuoteReq.status === 503 && getQuoteReq.json?.code === "BULK_ORDERS_DISABLED",
      "1.4 GET /api/bulk-orders/quote/:quoteId returns 503 BULK_ORDERS_DISABLED",
      `status=${getQuoteReq.status}, code=${getQuoteReq.json?.code}`
    );

    // 5. POST /api/bulk-orders/quote/:quoteId/accept
    const acceptQuoteReq = await request("POST", `/api/bulk-orders/quote/QT12345678/accept`, { token: customerToken });
    check(
      acceptQuoteReq.status === 503 && acceptQuoteReq.json?.code === "BULK_ORDERS_DISABLED",
      "1.5 POST /api/bulk-orders/quote/:quoteId/accept returns 503 BULK_ORDERS_DISABLED",
      `status=${acceptQuoteReq.status}, code=${acceptQuoteReq.json?.code}`
    );

    // 6. POST /api/bulk-orders/quote/:quoteId/reject
    const rejectQuoteReq = await request("POST", `/api/bulk-orders/quote/QT12345678/reject`, { token: customerToken });
    check(
      rejectQuoteReq.status === 503 && rejectQuoteReq.json?.code === "BULK_ORDERS_DISABLED",
      "1.6 POST /api/bulk-orders/quote/:quoteId/reject returns 503 BULK_ORDERS_DISABLED",
      `status=${rejectQuoteReq.status}, code=${rejectQuoteReq.json?.code}`
    );

    console.log("\n[GROUP 2: Admin Bulk-Order Endpoints]");

    // 7. GET /api/admin/bulk-orders
    const adminListReq = await request("GET", "/api/admin/bulk-orders", { token: adminToken });
    check(
      adminListReq.status === 503 && adminListReq.json?.code === "BULK_ORDERS_DISABLED",
      "2.1 GET /api/admin/bulk-orders returns 503 BULK_ORDERS_DISABLED",
      `status=${adminListReq.status}, code=${adminListReq.json?.code}`
    );

    // 8. GET /api/admin/bulk-orders/:id
    const adminGetReq = await request("GET", `/api/admin/bulk-orders/${dummyId}`, { token: adminToken });
    check(
      adminGetReq.status === 503 && adminGetReq.json?.code === "BULK_ORDERS_DISABLED",
      "2.2 GET /api/admin/bulk-orders/:id returns 503 BULK_ORDERS_DISABLED",
      `status=${adminGetReq.status}, code=${adminGetReq.json?.code}`
    );

    // 9. POST /api/admin/bulk-orders/:id/quote
    const adminQuoteReq = await request("POST", `/api/admin/bulk-orders/${dummyId}/quote`, {
      token: adminToken,
      body: { unitPrice: 400 },
    });
    check(
      adminQuoteReq.status === 503 && adminQuoteReq.json?.code === "BULK_ORDERS_DISABLED",
      "2.3 POST /api/admin/bulk-orders/:id/quote returns 503 BULK_ORDERS_DISABLED",
      `status=${adminQuoteReq.status}, code=${adminQuoteReq.json?.code}`
    );

    // 10. PATCH /api/admin/bulk-orders/:id/status
    const adminStatusReq = await request("PATCH", `/api/admin/bulk-orders/${dummyId}/status`, {
      token: adminToken,
      body: { status: "PROCESSING" },
    });
    check(
      adminStatusReq.status === 503 && adminStatusReq.json?.code === "BULK_ORDERS_DISABLED",
      "2.4 PATCH /api/admin/bulk-orders/:id/status returns 503 BULK_ORDERS_DISABLED",
      `status=${adminStatusReq.status}, code=${adminStatusReq.json?.code}`
    );

    console.log("\n[GROUP 3: Database Invariant]");
    const requestCount = await BulkOrderRequest.countDocuments();
    const quoteCount = await BulkQuote.countDocuments();
    check(requestCount === initialRequestCount, "3.1 Zero new BulkOrderRequest records created in database", `delta=${requestCount - initialRequestCount}`);
    check(quoteCount === initialQuoteCount, "3.2 Zero new BulkQuote records created in database", `delta=${quoteCount - initialQuoteCount}`);
  } finally {
    await User.deleteMany({ _id: { $in: [adminUser._id, customerUser._id] } });
    const closeGate = createDeferred<void>();
    server.close(() => closeGate.resolve());
    await closeGate.promise;
    await mongoose.disconnect();
  }

  console.log("\n════════════════════════════════════════════════════════════════");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log("════════════════════════════════════════════════════════════════\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runBulkOrderDisablementSuite().catch((err) => {
  console.error("Bulk order disablement test fatal error:", err);
  process.exit(1);
});
