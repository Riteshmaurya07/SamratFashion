import http from "http";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { app } from "../index";
import { connectSafeTestDb } from "./testHelpers";
import { getJwtAccessSecret } from "../config/env";
import { User, UserRole, UserStatus } from "../models/User";
import { Order } from "../models/Order";
import { AuditLog } from "../models/AuditLog";

let passed = 0;
let failed = 0;

function check(condition: boolean, description: string): void {
  if (condition) {
    console.log(`  PASS: ${description}`);
    passed++;
  } else {
    console.error(`  FAIL: ${description}`);
    failed++;
  }
}

function withResolvers<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function request(
  serverUrl: string,
  method: string,
  path: string,
  body?: unknown,
  token?: string
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: any }> {
  const { promise, resolve, reject } = withResolvers<{
    status: number;
    headers: http.IncomingHttpHeaders;
    body: any;
  }>();

  const url = new URL(path, serverUrl);
  const postData = body ? JSON.stringify(body) : "";

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (body) {
    headers["Content-Length"] = Buffer.byteLength(postData).toString();
  }
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const req = http.request(
    url,
    {
      method,
      headers,
    },
    (res) => {
      let raw = "";
      res.on("data", (chunk) => (raw += chunk));
      res.on("end", () => {
        let parsedBody = null;
        try {
          parsedBody = JSON.parse(raw);
        } catch {
          parsedBody = raw;
        }
        resolve({ status: res.statusCode || 500, headers: res.headers, body: parsedBody });
      });
    }
  );

  req.on("error", reject);
  if (body) {
    req.write(postData);
  }
  req.end();

  return promise;
}

async function runCustomerCancellationHttpTests(): Promise<void> {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║  Authenticated Customer Order Cancellation HTTP Test Suite     ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  await connectSafeTestDb();

  const server = http.createServer(app);
  const { promise: serverListening, resolve: resolveServer } = withResolvers<void>();
  server.listen(0, () => resolveServer());
  await serverListening;
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const jwtSecret = getJwtAccessSecret();
  const customerId = new mongoose.Types.ObjectId();
  const strangerId = new mongoose.Types.ObjectId();
  const productId = new mongoose.Types.ObjectId();
  const variantId = new mongoose.Types.ObjectId();

  const customerToken = jwt.sign(
    { sub: customerId.toString(), id: customerId.toString(), role: UserRole.CUSTOMER },
    jwtSecret,
    { algorithm: "HS256", expiresIn: "1h" }
  );
  const strangerToken = jwt.sign(
    { sub: strangerId.toString(), id: strangerId.toString(), role: UserRole.CUSTOMER },
    jwtSecret,
    { algorithm: "HS256", expiresIn: "1h" }
  );

  const cleanupOrderIds: mongoose.Types.ObjectId[] = [];
  const cleanupUserIds: mongoose.Types.ObjectId[] = [customerId, strangerId];

  try {
    await User.create({
      _id: customerId,
      name: "Owner Customer",
      email: `customer_${Date.now()}@example.com`,
      passwordHash: "hash123",
      role: UserRole.CUSTOMER,
      status: UserStatus.ACTIVE,
      emailVerified: true,
    });

    await User.create({
      _id: strangerId,
      name: "Stranger Customer",
      email: `stranger_${Date.now()}@example.com`,
      passwordHash: "hash123",
      role: UserRole.CUSTOMER,
      status: UserStatus.ACTIVE,
      emailVerified: true,
    });

    const activeOrder = await Order.create({
      orderNumber: `ORD-CANCEL-HTTP-${Date.now()}`,
      userId: customerId,
      items: [{
        productId,
        variantId,
        productName: "Cancellation Test Jacket",
        productImage: "https://example.com/jacket.jpg",
        selectedSize: "M",
        selectedColor: "NAVY",
        quantity: 1,
        unitPrice: 2000,
        lineTotal: 2000,
      }],
      shippingAddress: {
        fullName: "Owner Customer",
        phone: "9876543210",
        addressLine1: "123 Main St",
        city: "Bengaluru",
        state: "Karnataka",
        postalCode: "560001",
        country: "India",
        addressType: "HOME",
      },
      subtotal: 2000,
      discount: 0,
      shipping: 0,
      tax: 0,
      total: 2000,
      currency: "INR",
      status: "PENDING",
      paymentStatus: "PENDING",
    });
    cleanupOrderIds.push(activeOrder._id);

    // ─────────────────────────────────────────────────────────────────────────
    // 1. UNAUTHENTICATED CANCELLATION REQUEST MUST BE REJECTED (401)
    // ─────────────────────────────────────────────────────────────────────────
    const unauthRes = await request(
      baseUrl,
      "POST",
      `/api/orders/${activeOrder._id.toString()}/cancel`,
      { reason: "Attempt unauthenticated cancel" }
    );
    check(
      unauthRes.status === 401,
      "1. Unauthenticated cancellation request is rejected with HTTP 401"
    );

    // ─────────────────────────────────────────────────────────────────────────
    // 2. CROSS-USER ISOLATION: STRANGER CANNOT CANCEL ANOTHER USER'S ORDER (404)
    // ─────────────────────────────────────────────────────────────────────────
    const strangerRes = await request(
      baseUrl,
      "POST",
      `/api/orders/${activeOrder._id.toString()}/cancel`,
      { reason: "Malicious cancellation attempt" },
      strangerToken
    );
    check(
      strangerRes.status === 404,
      "2. Stranger cancellation request on owner's order is rejected with HTTP 404"
    );

    // Verify order was NOT cancelled by unauthorized attempts
    const orderBeforeOwnerCancel = await Order.findById(activeOrder._id);
    check(
      orderBeforeOwnerCancel?.status === "PENDING",
      "3. Order status remains PENDING after rejected unauthorized attempts"
    );

    // ─────────────────────────────────────────────────────────────────────────
    // 3. AUTHENTICATED CUSTOMER CANCELLATION SUCCEEDS (200)
    // ─────────────────────────────────────────────────────────────────────────
    const cancelRes = await request(
      baseUrl,
      "POST",
      `/api/orders/${activeOrder._id.toString()}/cancel`,
      { reason: "Found a better deal elsewhere" },
      customerToken
    );

    check(
      cancelRes.status === 200,
      "4. Authenticated customer cancellation returns HTTP 200"
    );

    const reloadedOrder = await Order.findById(activeOrder._id);
    check(
      reloadedOrder?.status === "CANCELLED",
      "5. Order status in database is updated to CANCELLED"
    );

    const auditLog = await AuditLog.findOne({
      entityId: activeOrder._id,
      action: "ORDER_CANCELLED",
    });
    check(
      Boolean(auditLog && auditLog.actorId?.toString() === customerId.toString()),
      "6. ORDER_CANCELLED audit log record is created with customer actor ID"
    );

    // ─────────────────────────────────────────────────────────────────────────
    // 4. ATTEMPTING TO CANCEL AN ALREADY CANCELLED ORDER IS REJECTED (400)
    // ─────────────────────────────────────────────────────────────────────────
    const repeatCancelRes = await request(
      baseUrl,
      "POST",
      `/api/orders/${activeOrder._id.toString()}/cancel`,
      { reason: "Cancelling again" },
      customerToken
    );
    check(
      repeatCancelRes.status === 400 &&
        repeatCancelRes.body?.message?.includes("cannot be cancelled"),
      "7. Cancelling an already CANCELLED order is rejected with HTTP 400"
    );

    // ─────────────────────────────────────────────────────────────────────────
    // 5. ATTEMPTING TO CANCEL A DELIVERED ORDER IS REJECTED (400)
    // ─────────────────────────────────────────────────────────────────────────
    const deliveredOrder = await Order.create({
      orderNumber: `ORD-DELIV-HTTP-${Date.now()}`,
      userId: customerId,
      items: [{
        productId,
        variantId,
        productName: "Delivered Test Jacket",
        productImage: "https://example.com/jacket.jpg",
        selectedSize: "M",
        selectedColor: "BLACK",
        quantity: 1,
        unitPrice: 2000,
        lineTotal: 2000,
      }],
      shippingAddress: {
        fullName: "Owner Customer",
        phone: "9876543210",
        addressLine1: "123 Main St",
        city: "Bengaluru",
        state: "Karnataka",
        postalCode: "560001",
        country: "India",
        addressType: "HOME",
      },
      subtotal: 2000,
      discount: 0,
      shipping: 0,
      tax: 0,
      total: 2000,
      currency: "INR",
      status: "DELIVERED",
      paymentStatus: "PAID",
      deliveredAt: new Date(),
    });
    cleanupOrderIds.push(deliveredOrder._id);

    const deliveredCancelRes = await request(
      baseUrl,
      "POST",
      `/api/orders/${deliveredOrder._id.toString()}/cancel`,
      { reason: "Trying to cancel delivered item" },
      customerToken
    );
    check(
      deliveredCancelRes.status === 400 &&
        deliveredCancelRes.body?.message?.includes("cannot be cancelled"),
      "8. Cancelling a DELIVERED order is rejected with HTTP 400"
    );

  } finally {
    server.close();
    if (cleanupOrderIds.length > 0) {
      await Order.deleteMany({ _id: { $in: cleanupOrderIds } });
      await AuditLog.deleteMany({ entityId: { $in: cleanupOrderIds } });
    }
    if (cleanupUserIds.length > 0) {
      await User.deleteMany({ _id: { $in: cleanupUserIds } });
    }
    await mongoose.disconnect();
  }

  console.log("\n════════════════════════════════════════════════════════════════");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log("════════════════════════════════════════════════════════════════\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runCustomerCancellationHttpTests().catch((err) => {
  console.error("Fatal test runner error:", err);
  process.exit(1);
});

