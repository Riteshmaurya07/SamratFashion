import http from "http";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { app } from "../index";
import { connectSafeTestDb, TEST_CATEGORY_ID } from "./testHelpers";
import { getJwtAccessSecret } from "../config/env";
import { User, UserRole, UserStatus } from "../models/User";
import { Order } from "../models/Order";
import { Product } from "../models/Product";
import { Payment } from "../models/Payment";
import { Refund } from "../models/Refund";
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

async function request(
  serverUrl: string,
  method: string,
  path: string,
  body?: unknown,
  token?: string
): Promise<{ status: number; body: any }> {
  const { promise, resolve, reject } = withResolvers<{ status: number; body: any }>();
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

  const req = http.request(
    url,
    {
      method,
      headers,
    },
    (res) => {
      let resData = "";
      res.on("data", (chunk) => {
        resData += chunk;
      });
      res.on("end", () => {
        try {
          const parsed = resData ? JSON.parse(resData) : null;
          resolve({ status: res.statusCode || 500, body: parsed });
        } catch {
          resolve({ status: res.statusCode || 500, body: resData });
        }
      });
    }
  );

  req.on("error", reject);
  if (payload) {
    req.write(payload);
  }
  req.end();
  return promise;
}

async function runHardeningTests(): Promise<void> {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║  Admin Orders Dashboard Security & Logic Hardening Suite       ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");

  await connectSafeTestDb();
  const testSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const secret = getJwtAccessSecret();

  const server = http.createServer(app);
  await new Promise<void>((resolve) => { server.listen(0, () => resolve()); });
  const port = (server.address() as any).port;
  const serverUrl = `http://127.0.0.1:${port}`;

  try {
    const adminUser = await new User({
      name: "Super Admin Hardening",
      email: `admin_dash_${testSuffix}@example.com`,
      passwordHash: "Password123!",
      role: UserRole.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
    }).save();
    const adminToken = jwt.sign(
      { sub: adminUser._id.toString(), id: adminUser._id.toString(), role: UserRole.SUPER_ADMIN, email: adminUser.email },
      secret,
      { expiresIn: "1h" }
    );

    const testPhone = "8" + Math.floor(100000000 + Math.random() * 900000000).toString();
    const customerUser = await new User({
      name: "Ritesh Maurya",
      email: `ritesh_test_${testSuffix}@example.com`,
      phone: testPhone,
      passwordHash: "Password123!",
      role: UserRole.CUSTOMER,
      status: UserStatus.ACTIVE,
    }).save();
    const customerToken = jwt.sign(
      { sub: customerUser._id.toString(), id: customerUser._id.toString(), role: UserRole.CUSTOMER, email: customerUser.email },
      secret,
      { expiresIn: "1h" }
    );

    const testProd = await Product.create({
      name: "Hardening Test Product",
      slug: `hard-prod-${testSuffix}`,
      description: "Testing dashboard hardening",
      categoryId: TEST_CATEGORY_ID,
      basePrice: 500,
      variants: [
        { _id: new mongoose.Types.ObjectId(), sku: `SKU-HD-${testSuffix}`, size: "M", color: "BLACK", stock: 10 },
      ],
    });

    const createOrderFixture = async (overrides: Record<string, unknown> = {}) => {
      const orderNum = `ORD-HD-${testSuffix}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
      return await Order.create({
        orderNumber: orderNum,
        userId: customerUser._id,
        items: [
          {
            productId: testProd._id,
            variantId: testProd.variants[0]._id,
            productName: testProd.name,
            productImage: "https://example.com/test.jpg",
            selectedSize: "M",
            selectedColor: "BLACK",
            quantity: 1,
            unitPrice: 500,
            lineTotal: 500,
          },
        ],
        shippingAddress: {
          fullName: "Ritesh Maurya",
          phone: testPhone,
          addressLine1: "101/2 Harpur Halla",
          city: "Raebareli",
          state: "Uttar Pradesh",
          postalCode: "229402",
          country: "India",
          addressType: "HOME",
        },
        subtotal: 500,
        discount: 0,
        shipping: 0,
        tax: 0,
        total: 500,
        initialSubtotal: 500,
        initialDiscount: 0,
        initialShipping: 0,
        initialTotal: 500,
        currency: "INR",
        status: "PENDING",
        paymentStatus: "PAID",
        paymentMethod: "RAZORPAY",
        cancellationVersion: 0,
        ...overrides,
      });
    };

    console.log("\n[TEST 1] Valid Bulk Confirmation (PENDING -> CONFIRMED)");
    const order1A = await createOrderFixture({ status: "PENDING" });
    const order1B = await createOrderFixture({ status: "PENDING" });

    const bulkConfirmRes = await request(
      serverUrl,
      "PATCH",
      "/api/admin/orders/bulk-status",
      { orderIds: [order1A._id.toString(), order1B._id.toString()], status: "CONFIRMED" },
      adminToken
    );
    check(bulkConfirmRes.status === 200, "Bulk confirm returns HTTP 200");
    check(bulkConfirmRes.body?.data?.updatedCount === 2, "Bulk confirm successfully updated 2 orders");
    const updated1A = await Order.findById(order1A._id);
    const updated1B = await Order.findById(order1B._id);
    check(updated1A?.status === "CONFIRMED" && updated1B?.status === "CONFIRMED", "Both orders updated to CONFIRMED");

    const auditCount1 = await AuditLog.countDocuments({
      action: "ADMIN_ORDER_STATUS_CHANGED",
      "metadata.source": "BULK_STATUS_UPDATE",
      entityId: { $in: [order1A._id, order1B._id] },
    });
    check(auditCount1 === 2, "Individual AuditLog created for each confirmed order");

    console.log("\n[TEST 2] Invalid Order State Transitions (SHIPPED -> PROCESSING & PENDING -> PROCESSING)");
    const order2Shipped = await createOrderFixture({ status: "SHIPPED" });
    const order2Pending = await createOrderFixture({ status: "PENDING" });

    const bulkInvalidRes = await request(
      serverUrl,
      "PATCH",
      "/api/admin/orders/bulk-status",
      { orderIds: [order2Shipped._id.toString(), order2Pending._id.toString()], status: "PROCESSING" },
      adminToken
    );
    check(bulkInvalidRes.status === 200, "Bulk update handles invalid transitions without crashing (HTTP 200)");
    check(bulkInvalidRes.body?.data?.updatedCount === 0, "No invalid transitions were permitted");
    check(bulkInvalidRes.body?.data?.rejectedCount === 2, "Both invalid transitions were rejected");
    check(
      bulkInvalidRes.body?.data?.failures?.some((f: any) => f.reason.includes("CONFIRMED")),
      "Failure reasons clearly explain state machine restriction"
    );

    console.log("\n[TEST 3] Attempted Direct Delivery Without Delivery Confirmation");
    const bulkDeliverRes = await request(
      serverUrl,
      "PATCH",
      "/api/admin/orders/bulk-status",
      { orderIds: [order1A._id.toString()], status: "DELIVERED" },
      adminToken
    );
    check(bulkDeliverRes.status === 400, "Direct bulk update to DELIVERED is rejected with HTTP 400");
    check(
      Boolean(bulkDeliverRes.body?.message?.includes("carrier tracking scans")),
      "Rejection message explains delivery verification requirement"
    );

    console.log("\n[TEST 4] Attempted Shipment Update Without Courier Dispatch Workflow");
    const bulkShipRes = await request(
      serverUrl,
      "PATCH",
      "/api/admin/orders/bulk-status",
      { orderIds: [order1A._id.toString()], status: "SHIPPED" },
      adminToken
    );
    check(bulkShipRes.status === 400, "Direct bulk update to SHIPPED is rejected with HTTP 400");
    check(
      Boolean(bulkShipRes.body?.message?.includes("courier shipment")),
      "Rejection message explains courier shipment workflow requirement"
    );

    console.log("\n[TEST 5] Cancelled and Refunded Order Protection");
    const orderCancelled = await createOrderFixture({ status: "CANCELLED" });
    const orderRefunded = await createOrderFixture({ status: "PENDING", paymentStatus: "REFUNDED" });

    const bulkProtectedRes = await request(
      serverUrl,
      "PATCH",
      "/api/admin/orders/bulk-status",
      { orderIds: [orderCancelled._id.toString(), orderRefunded._id.toString()], status: "CONFIRMED" },
      adminToken
    );
    check(bulkProtectedRes.body?.data?.updatedCount === 0, "Zero protected orders updated");
    check(bulkProtectedRes.body?.data?.rejectedCount === 2, "Cancelled and refunded orders rejected in bulk update");
    const cancelledStillCancelled = await Order.findById(orderCancelled._id);
    check(cancelledStillCancelled?.status === "CANCELLED", "Cancelled order status remains strictly CANCELLED");

    console.log("\n[TEST 6] Custom Print Mockup Approval Restrictions");
    const orderCustomUnapproved = await createOrderFixture({
      status: "CONFIRMED",
      items: [
        {
          productId: testProd._id,
          variantId: testProd.variants[0]._id,
          productName: "Custom Hoodie",
          productImage: "https://example.com/custom.jpg",
          selectedSize: "L",
          selectedColor: "BLACK",
          quantity: 1,
          unitPrice: 800,
          lineTotal: 800,
          isCustomized: true,
          approvalStatus: "mockup_sent",
        },
      ],
    });

    const bulkCustomRes = await request(
      serverUrl,
      "PATCH",
      "/api/admin/orders/bulk-status",
      { orderIds: [orderCustomUnapproved._id.toString()], status: "PROCESSING" },
      adminToken
    );
    check(bulkCustomRes.body?.data?.updatedCount === 0, "Unapproved custom item order blocked from moving to PROCESSING");
    check(
      bulkCustomRes.body?.data?.failures?.[0]?.reason.includes("design approval"),
      "Failure reason specifies customer mockup design approval requirement"
    );

    console.log("\n[TEST 7] Customer Search Across Name, Email and Phone");
    const searchNameRes = await request(serverUrl, "GET", `/api/admin/orders?search=Ritesh`, undefined, adminToken);
    check(searchNameRes.status === 200, "Search by name returns 200");
    check(searchNameRes.body?.data?.items?.length > 0, "Search by customer name finds matching orders");

    const searchEmailRes = await request(serverUrl, "GET", `/api/admin/orders?search=${customerUser.email}`, undefined, adminToken);
    check(searchEmailRes.body?.data?.items?.length > 0, "Search by customer email finds matching orders");

    const searchPhoneRes = await request(serverUrl, "GET", `/api/admin/orders?search=${testPhone}`, undefined, adminToken);
    check(searchPhoneRes.body?.data?.items?.length > 0, "Search by 10-digit phone number finds matching orders");

    const searchCityRes = await request(serverUrl, "GET", `/api/admin/orders?search=Raebareli`, undefined, adminToken);
    check(searchCityRes.body?.data?.items?.length > 0, "Search by destination city finds matching orders");

    console.log("\n[TEST 8] Special Characters in Search Input (ReDoS & Regex Escaping)");
    const specialChars = ".*+?^${}()|[]\\/\"'@#%&!";
    const specialSearchRes = await request(
      serverUrl,
      "GET",
      `/api/admin/orders?search=${encodeURIComponent(specialChars)}`,
      undefined,
      adminToken
    );
    check(specialSearchRes.status === 200, "Search with regex metacharacters does not crash server (HTTP 200)");
    check(Array.isArray(specialSearchRes.body?.data?.items), "Special characters search returns clean items array");

    console.log("\n[TEST 9] Search Pagination & Total Counts");
    const paginatedRes = await request(serverUrl, "GET", `/api/admin/orders?limit=2&page=1`, undefined, adminToken);
    check(paginatedRes.status === 200, "Paginated request returns HTTP 200");
    check(paginatedRes.body?.data?.items?.length <= 2, "Pagination limit respected (max 2 items)");
    check(paginatedRes.body?.data?.totalPages >= 1, "totalPages calculated accurately");
    check(paginatedRes.body?.data?.total >= 2, "total documents count returned");

    console.log("\n[TEST 10] Multiple Partial Refunds Financial Transparency");
    const orderRefundTransparency = await createOrderFixture({
      status: "CONFIRMED",
      subtotal: 1000,
      total: 600, // Remaining active total
      initialTotal: 1000, // Authoritative initial paid
      partiallyCancelled: true,
    });
    const paymentTrans = await Payment.create({
      orderId: orderRefundTransparency._id,
      userId: customerUser._id,
      amount: 1000,
      currency: "INR",
      status: "CAPTURED",
      provider: "RAZORPAY",
      razorpayPaymentId: `pay_mock_trans_${testSuffix}`,
      refundedAmount: 400,
      pendingRefundAmount: 0,
      refundReservations: [],
    });

    // Create 2 partial refunds: 1 settled (₹250), 1 settled (₹150) = ₹400
    await Refund.create({
      orderId: orderRefundTransparency._id,
      paymentId: paymentTrans._id,
      userId: customerUser._id,
      initiatedBy: customerUser._id,
      initiatedByRole: "CUSTOMER",
      amount: 250,
      currency: "INR",
      status: "PROCESSED",
      submissionState: "CONFIRMED",
    });
    await Refund.create({
      orderId: orderRefundTransparency._id,
      paymentId: paymentTrans._id,
      userId: customerUser._id,
      initiatedBy: customerUser._id,
      initiatedByRole: "CUSTOMER",
      amount: 150,
      currency: "INR",
      status: "PROCESSED",
      submissionState: "CONFIRMED",
    });

    const getRefundTransRes = await request(
      serverUrl,
      "GET",
      `/api/admin/orders?search=${orderRefundTransparency.orderNumber}`,
      undefined,
      adminToken
    );
    const itemFin = getRefundTransRes.body?.data?.items?.[0]?.financialSummary;
    check(Boolean(itemFin), "Order row exposes authoritative financialSummary");
    check(itemFin?.originalPaid === 1000, "originalPaid matches payment amount exactly (₹1000)");
    check(itemFin?.activeOrderTotal === 600, "activeOrderTotal matches current order total (₹600)");
    check(itemFin?.refundSettled === 400, "Multiple partial refunds aggregated correctly to ₹400 (250 + 150)");

    console.log("\n[TEST 11] Pending vs Settled Refund Status Differentiation");
    // Add a pending refund of ₹100
    await Refund.create({
      orderId: orderRefundTransparency._id,
      paymentId: paymentTrans._id,
      userId: customerUser._id,
      initiatedBy: customerUser._id,
      initiatedByRole: "CUSTOMER",
      amount: 100,
      currency: "INR",
      status: "PENDING",
      submissionState: "RESPONSE_RECEIVED",
    });

    const getPendingDiffRes = await request(
      serverUrl,
      "GET",
      `/api/admin/orders?search=${orderRefundTransparency.orderNumber}`,
      undefined,
      adminToken
    );
    const itemFinDiff = getPendingDiffRes.body?.data?.items?.[0]?.financialSummary;
    check(itemFinDiff?.refundSettled === 400, "Settled refunds remain ₹400 (not mixed with pending)");
    check(itemFinDiff?.refundPending === 100, "Pending refund recorded separately as ₹100");
    check(itemFinDiff?.hasPendingRefund === true, "hasPendingRefund flag is true");

    console.log("\n[TEST 12] Bulk Operation Partial Failure Reporting");
    const order12Valid = await createOrderFixture({ status: "PENDING" });
    const fakeId = new mongoose.Types.ObjectId().toString();

    const partialFailureRes = await request(
      serverUrl,
      "PATCH",
      "/api/admin/orders/bulk-status",
      { orderIds: [order12Valid._id.toString(), fakeId, orderCancelled._id.toString()], status: "CONFIRMED" },
      adminToken
    );
    check(partialFailureRes.status === 200, "Partial failure returns HTTP 200 with structured report");
    check(partialFailureRes.body?.data?.updatedCount === 1, "Valid order was updated");
    check(partialFailureRes.body?.data?.rejectedCount === 2, "Both invalid orders were rejected");
    check(partialFailureRes.body?.data?.updated?.[0]?.orderId === order12Valid._id.toString(), "Updated array identifies success");
    check(partialFailureRes.body?.data?.failures?.length === 2, "Failures array contains both rejected orders with reasons");

    console.log("\n[TEST 13] Unauthorized Customer & Unauthenticated Bulk Access");
    const unauthRes = await request(
      serverUrl,
      "PATCH",
      "/api/admin/orders/bulk-status",
      { orderIds: [order12Valid._id.toString()], status: "CONFIRMED" }
    );
    check(unauthRes.status === 401, "Unauthenticated bulk update rejected with HTTP 401");

    const customerBulkRes = await request(
      serverUrl,
      "PATCH",
      "/api/admin/orders/bulk-status",
      { orderIds: [order12Valid._id.toString()], status: "CONFIRMED" },
      customerToken
    );
    check(customerBulkRes.status === 403, "Customer role rejected with HTTP 403 Forbidden");

    console.log("\n[TEST 14] Concurrent Status Update Serialization");
    const order14Concurrent = await createOrderFixture({ status: "PENDING" });
    const [c1, c2] = await Promise.all([
      request(
        serverUrl,
        "PATCH",
        "/api/admin/orders/bulk-status",
        { orderIds: [order14Concurrent._id.toString()], status: "CONFIRMED" },
        adminToken
      ),
      request(
        serverUrl,
        "PATCH",
        "/api/admin/orders/bulk-status",
        { orderIds: [order14Concurrent._id.toString()], status: "CONFIRMED" },
        adminToken
      ),
    ]);
    const totalSuccessfulUpdates = (c1.body?.data?.updatedCount || 0) + (c2.body?.data?.updatedCount || 0);
    check(totalSuccessfulUpdates === 1, "Only one concurrent request can transition order status (atomic check-and-set)");

    console.log("\n[TEST 15] Dashboard KPI Count Accuracy Via Aggregation Pipeline");
    const kpiRes = await request(serverUrl, "GET", "/api/admin/orders", undefined, adminToken);
    const summaryData = kpiRes.body?.data?.summary;
    check(typeof summaryData?.totalOrders === "number" && summaryData.totalOrders > 0, "KPI totalOrders is an accurate number");
    check(typeof summaryData?.todayOrders === "number", "KPI todayOrders is an accurate number");
    check(typeof summaryData?.processingOrders === "number", "KPI processingOrders is an accurate number");
    check(typeof summaryData?.awaitingPaymentOrders === "number", "KPI awaitingPaymentOrders is an accurate number");
    check(typeof summaryData?.shippedOrders === "number", "KPI shippedOrders is an accurate number");

  } finally {
    server.close();
    await mongoose.disconnect();
  }

  console.log(`\nHardening Test Suite Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

runHardeningTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
