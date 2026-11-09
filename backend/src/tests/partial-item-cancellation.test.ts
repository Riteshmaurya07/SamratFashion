import http from "http";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { app } from "../index";
import { connectSafeTestDb, TEST_CATEGORY_ID } from "./testHelpers";
import { getJwtAccessSecret } from "../config/env";
import { User, UserRole, UserStatus } from "../models/User";
import { Order } from "../models/Order";
import { Product } from "../models/Product";
import { InventoryTransaction } from "../models/InventoryTransaction";
import { PrintJob, PrintJobStatus, PrintJobPriority } from "../models/PrintJob";
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

async function runPartialItemCancellationTests(): Promise<void> {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║  Partial-Item Order Cancellation & Inventory Test Suite        ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  await connectSafeTestDb();

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const serverUrl = `http://127.0.0.1:${port}`;

  try {
    const testSuffix = new mongoose.Types.ObjectId().toString();

    // 1. Create Customer & Admin Users
    const customerUser = await User.create({
      name: "Partial Cancel Customer",
      email: `customer-partial-${testSuffix}@example.com`,
      passwordHash: "dummyhash",
      role: UserRole.CUSTOMER,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });

    const adminUser = await User.create({
      name: "Partial Cancel Admin",
      email: `admin-partial-${testSuffix}@example.com`,
      passwordHash: "dummyhash",
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });

    const jwtSecret = getJwtAccessSecret();
    const customerToken = jwt.sign(
      { sub: customerUser._id.toString(), id: customerUser._id.toString(), role: customerUser.role },
      jwtSecret,
      { expiresIn: "1h" }
    );
    const adminToken = jwt.sign(
      { sub: adminUser._id.toString(), id: adminUser._id.toString(), role: adminUser.role },
      jwtSecret,
      { expiresIn: "1h" }
    );

    // 2. Create Test Product with variants
    const variant1Id = new mongoose.Types.ObjectId();
    const variant2Id = new mongoose.Types.ObjectId();
    const product = await Product.create({
      name: "Test Partial Cancel Tee",
      slug: `test-partial-cancel-tee-${testSuffix}`,
      description: "A test shirt for partial cancellation",
      categoryId: TEST_CATEGORY_ID,
      basePrice: 500,
      variants: [
        {
          _id: variant1Id,
          sku: `SKU-P1-${testSuffix}`,
          size: "M",
          color: "Navy",
          stock: 10,
        },
        {
          _id: variant2Id,
          sku: `SKU-P2-${testSuffix}`,
          size: "L",
          color: "Black",
          stock: 10,
        },
      ],
      isCustomizable: true,
    });

    const item1Id = new mongoose.Types.ObjectId();
    const item2Id = new mongoose.Types.ObjectId();

    // 3. Create Multi-item Order (Item 1: qty 2 x 500 = 1000, Item 2: qty 1 x 500 = 500, Discount: 150, Shipping: 50, Total: 1400)
    const order = await Order.create({
      orderNumber: `SF-TEST-PARTIAL-${testSuffix.slice(-6)}`,
      userId: customerUser._id,
      items: [
        {
          _id: item1Id,
          productId: product._id,
          variantId: variant1Id,
          productName: "Test Partial Cancel Tee - M",
          productImage: "/placeholder.png",
          selectedSize: "M",
          selectedColor: "Navy",
          quantity: 2,
          unitPrice: 500,
          lineTotal: 1000,
          cancelledQuantity: 0,
        },
        {
          _id: item2Id,
          productId: product._id,
          variantId: variant2Id,
          productName: "Test Partial Cancel Tee - L",
          productImage: "/placeholder.png",
          selectedSize: "L",
          selectedColor: "Black",
          quantity: 1,
          unitPrice: 500,
          lineTotal: 500,
          cancelledQuantity: 0,
        },
      ],
      subtotal: 1500,
      discount: 150,
      shipping: 50,
      tax: 0,
      total: 1400,
      currency: "INR",
      status: "CONFIRMED",
      paymentStatus: "PENDING",
      shippingAddress: {
        fullName: "Test Customer",
        phone: "9876543210",
        addressLine1: "123 Test Street",
        city: "Mumbai",
        state: "Maharashtra",
        postalCode: "400001",
        country: "India",
        addressType: "HOME",
      },
    });

    // Create SALE inventory transactions for the order to emulate checkout allocation
    await InventoryTransaction.create([
      {
        orderId: order._id,
        productId: product._id,
        variantId: variant1Id,
        quantity: 2,
        type: "SALE",
        status: "COMPLETED",
      },
      {
        orderId: order._id,
        productId: product._id,
        variantId: variant2Id,
        quantity: 1,
        type: "SALE",
        status: "COMPLETED",
      },
    ]);

    // Track baseline stock
    const prodBefore = await Product.findById(product._id);
    const v1StockBefore = prodBefore?.variants.find((v: any) => v._id.equals(variant1Id))?.stock || 0;

    console.log("Scenario 1: Customer partial cancellation (cancelling 1 of 2 units of Item 1)");
    const cancelRes = await request(
      serverUrl,
      "POST",
      `/api/orders/${order._id}/cancel-items`,
      {
        items: [{ itemId: item1Id.toString(), quantity: 1 }],
        reason: "Ordered too many units",
      },
      customerToken
    );

    check(cancelRes.status === 200, `Endpoint returns 200 (got ${cancelRes.status})`);
    check(cancelRes.body?.data?.partiallyCancelled === true, "Order is marked partiallyCancelled: true");
    check(cancelRes.body?.data?.status === "CONFIRMED", "Order lifecycle status remains CONFIRMED");

    const item1Cancelled = cancelRes.body?.data?.items?.find((it: any) => it._id === item1Id.toString());
    check(item1Cancelled?.cancelledQuantity === 1, "Item 1 has cancelledQuantity: 1");
    check(item1Cancelled?.cancellationReason === "Ordered too many units", "Cancellation reason recorded on item");

    // Check inventory restoration for Item 1
    const prodAfter = await Product.findById(product._id);
    const v1StockAfter = prodAfter?.variants.find((v: any) => v._id.equals(variant1Id))?.stock || 0;
    check(v1StockAfter === v1StockBefore + 1, `Inventory restored by 1 (before: ${v1StockBefore}, after: ${v1StockAfter})`);

    const restockTx = await InventoryTransaction.findOne({
      orderId: order._id,
      variantId: variant1Id,
      type: "RESTOCK",
    });
    check(Boolean(restockTx), "RESTOCK inventory transaction recorded for cancelled quantity");
    check(restockTx?.quantity === 1, "RESTOCK transaction quantity is 1");

    console.log("\nScenario 2: Idempotent replay of cancellation with same operationId");
    const opId = cancelRes.body?.operationId;
    const replayRes = await request(
      serverUrl,
      "POST",
      `/api/orders/${order._id}/cancel-items`,
      {
        operationId: opId,
        items: [{ itemId: item1Id.toString(), quantity: 1 }],
      },
      customerToken
    );
    check(replayRes.status === 200, `Replay returns 200 (got ${replayRes.status})`);
    const prodAfterReplay = await Product.findById(product._id);
    const v1StockReplay = prodAfterReplay?.variants.find((v: any) => v._id.equals(variant1Id))?.stock || 0;
    check(v1StockReplay === v1StockAfter, "Stock was not double-incremented on replay");

    console.log("\nScenario 3: Customer custom-print lock enforcement");
    // Create a confirmed print job for item 2
    await PrintJob.create({
      orderId: order._id,
      orderItemId: item2Id.toString(),
      status: PrintJobStatus.READY_FOR_PRINT,
      priority: PrintJobPriority.MEDIUM,
    });

    const printLockedRes = await request(
      serverUrl,
      "POST",
      `/api/orders/${order._id}/cancel-items`,
      {
        items: [{ itemId: item2Id.toString(), quantity: 1 }],
      },
      customerToken
    );
    check(printLockedRes.status === 400, "Customer cancellation blocked for confirmed custom-printed item (status 400)");

    console.log("\nScenario 4: Admin cancel override on custom-printed item");
    const adminCancelRes = await request(
      serverUrl,
      "POST",
      `/api/admin/orders/${order._id}/cancel-items`,
      {
        items: [{ itemId: item2Id.toString(), quantity: 1 }],
        reason: "Customer called support to cancel custom item",
      },
      adminToken
    );
    check(adminCancelRes.status === 200, "Admin can cancel custom-printed item (status 200)");
    const item2Cancelled = adminCancelRes.body?.data?.items?.find((it: any) => it._id === item2Id.toString());
    check(item2Cancelled?.cancelledQuantity === 1, "Item 2 is now cancelled");

    console.log("\nScenario 5: Cancelling remaining items auto-transitions order to CANCELLED");
    // Cancel the 1 remaining unit of Item 1
    const lastItemRes = await request(
      serverUrl,
      "POST",
      `/api/orders/${order._id}/cancel-items`,
      {
        items: [{ itemId: item1Id.toString(), quantity: 1 }],
      },
      customerToken
    );
    check(lastItemRes.status === 200, "Remaining item cancellation returns 200");
    check(lastItemRes.body?.data?.status === "CANCELLED", "Order status automatically transitioned to CANCELLED");
    check(lastItemRes.body?.data?.partiallyCancelled === false, "partiallyCancelled is now false (fully cancelled)");
    check(lastItemRes.body?.fullyCancelled === true, "fullyCancelled flag is true");

    console.log("\nScenario 6: Audit log verification");
    const itemLogs = await AuditLog.find({
      entityId: order._id,
      action: { $in: ["ORDER_ITEMS_CANCELLED", "ADMIN_ORDER_ITEMS_CANCELLED", "ORDER_CANCELLED"] },
    });
    check(itemLogs.length >= 3, `Audit logs created for partial and final cancellations (found ${itemLogs.length})`);

  } finally {
    server.close();
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

runPartialItemCancellationTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("Test execution failed:", err);
    process.exit(1);
  });
