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
import { PaymentAttempt } from "../models/PaymentAttempt";
import { Refund } from "../models/Refund";
import { PrintJob, PrintJobStatus, PrintJobPriority } from "../models/PrintJob";
import { Invoice, InvoiceStatus } from "../models/Invoice";
import { CreditNote } from "../models/CreditNote";
import { AuditLog } from "../models/AuditLog";
import { ReturnRequest } from "../models/ReturnRequest";
import { acceptReturn } from "../controllers/returnController";
import { saveStoreSettings } from "../services/storeSettingsService";
import { getOrCreateInvoiceForOrder } from "../controllers/invoiceController";
import {
  cancelOrderItemsWithRefund,
  reconcilePendingCancellationOperations,
} from "../services/orderCancellationService";
import { razorpayProvider } from "../services/payment/RazorpayProvider";
import { RecoveryCoordinatorService } from "../services/recovery/recoveryCoordinatorService";

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

async function runProductionReadinessAuditTests(): Promise<void> {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║  Production-Readiness Partial Cancellation & Refund Audit Suite ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  await connectSafeTestDb();

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const serverUrl = `http://127.0.0.1:${port}`;

  try {
    const testSuffix = new mongoose.Types.ObjectId().toString();

    // Setup Users
    const customer = await User.create({
      name: "Audit Customer 1",
      email: `audit-cust1-${testSuffix}@example.com`,
      passwordHash: "dummyhash",
      role: UserRole.CUSTOMER,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });

    const unauthorizedCustomer = await User.create({
      name: "Audit Customer 2 (Attacker)",
      email: `audit-cust2-${testSuffix}@example.com`,
      passwordHash: "dummyhash",
      role: UserRole.CUSTOMER,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });

    const admin = await User.create({
      name: "Audit Admin",
      email: `audit-admin-${testSuffix}@example.com`,
      passwordHash: "dummyhash",
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerified: true,
      phoneVerified: true,
    });

    const jwtSecret = getJwtAccessSecret();
    const customerToken = jwt.sign(
      { sub: customer._id.toString(), id: customer._id.toString(), role: customer.role },
      jwtSecret,
      { expiresIn: "1h" }
    );
    const unauthorizedToken = jwt.sign(
      { sub: unauthorizedCustomer._id.toString(), id: unauthorizedCustomer._id.toString(), role: unauthorizedCustomer.role },
      jwtSecret,
      { expiresIn: "1h" }
    );
    const adminToken = jwt.sign(
      { sub: admin._id.toString(), id: admin._id.toString(), role: admin.role },
      jwtSecret,
      { expiresIn: "1h" }
    );

    // Setup Products
    const varAId = new mongoose.Types.ObjectId();
    const varBId = new mongoose.Types.ObjectId();
    const varCId = new mongoose.Types.ObjectId();

    const productA = await Product.create({
      name: "Audit Product A",
      slug: `audit-prod-a-${testSuffix}`,
      description: "Audit item A",
      categoryId: TEST_CATEGORY_ID,
      basePrice: 100,
      variants: [{ _id: varAId, sku: `SKU-A-${testSuffix}`, size: "M", color: "Red", stock: 20 }],
    });

    const productB = await Product.create({
      name: "Audit Product B",
      slug: `audit-prod-b-${testSuffix}`,
      description: "Audit item B",
      categoryId: TEST_CATEGORY_ID,
      basePrice: 200,
      variants: [{ _id: varBId, sku: `SKU-B-${testSuffix}`, size: "L", color: "Blue", stock: 20 }],
    });

    const productC = await Product.create({
      name: "Audit Product C",
      slug: `audit-prod-c-${testSuffix}`,
      description: "Audit item C",
      categoryId: TEST_CATEGORY_ID,
      basePrice: 300,
      variants: [{ _id: varCId, sku: `SKU-C-${testSuffix}`, size: "XL", color: "Green", stock: 20 }],
    });

    const itemAId = new mongoose.Types.ObjectId();
    const itemBId = new mongoose.Types.ObjectId();
    const itemCId = new mongoose.Types.ObjectId();

    // Order 1: Subtotal ₹1000 (A: 3x100 = 300, B: 2x200 = 400, C: 1x300 = 300), Discount: ₹200 (20%), Shipping: ₹50, Total: ₹850
    const order1 = await Order.create({
      orderNumber: `SF-AUDIT-1-${testSuffix.slice(-6)}`,
      userId: customer._id,
      items: [
        {
          _id: itemAId,
          productId: productA._id,
          variantId: varAId,
          productName: productA.name,
          productImage: "https://example.com/a.jpg",
          selectedSize: "M",
          selectedColor: "Red",
          quantity: 3,
          unitPrice: 100,
          lineTotal: 300,
          cancelledQuantity: 0,
        },
        {
          _id: itemBId,
          productId: productB._id,
          variantId: varBId,
          productName: productB.name,
          productImage: "https://example.com/b.jpg",
          selectedSize: "L",
          selectedColor: "Blue",
          quantity: 2,
          unitPrice: 200,
          lineTotal: 400,
          cancelledQuantity: 0,
        },
        {
          _id: itemCId,
          productId: productC._id,
          variantId: varCId,
          productName: productC.name,
          productImage: "https://example.com/c.jpg",
          selectedSize: "XL",
          selectedColor: "Green",
          quantity: 1,
          unitPrice: 300,
          lineTotal: 300,
          cancelledQuantity: 0,
        },
      ],
      shippingAddress: {
        fullName: "Test Customer",
        phone: "9876543210",
        addressLine1: "123 Test St",
        city: "Mumbai",
        state: "Maharashtra",
        postalCode: "400001",
        country: "India",
        addressType: "HOME",
      },
      subtotal: 1000,
      discount: 200,
      shipping: 50,
      tax: 0,
      total: 850,
      initialSubtotal: 1000,
      initialDiscount: 200,
      initialTotal: 850,
      currency: "INR",
      status: "CONFIRMED",
      paymentStatus: "PAID",
      partiallyCancelled: false,
      cancellationVersion: 0,
      cancellationOperations: [],
    });

    // Create Payment doc for Order 1
    const payment1 = await Payment.create({
      orderId: order1._id,
      userId: customer._id,
      amount: 850,
      currency: "INR",
      status: "CAPTURED",
      provider: "RAZORPAY",
      razorpayPaymentId: `pay_mock_${testSuffix}_1`,
      refundedAmount: 0,
      pendingRefundAmount: 0,
      refundReservations: [],
    });

    await PaymentAttempt.create({
      paymentId: payment1._id,
      orderId: order1._id,
      razorpayOrderId: `order_mock_${testSuffix}_1`,
      razorpayPaymentId: payment1.razorpayPaymentId,
      amount: 850,
      currency: "INR",
      status: "CAPTURED",
    });

    // Generate Invoice for Order 1
    const invoice1 = await getOrCreateInvoiceForOrder(order1._id.toString());
    const originalInvoiceTotal = invoice1.total;
    const originalInvoiceSubtotal = invoice1.subtotal;
    const originalInvoiceDiscount = invoice1.discount;

    console.log("Audit Scenario 1: Multiple Sequential Partial Cancellations & Invariant Discount Allocation");
    // Cancel 1 unit of Item A (line = 300, 20% discount = 60, net = 240, 3 units => ₹80 per unit)
    const op1Id = `op_audit_1_${testSuffix}`;
    const cancel1Res = await request(
      serverUrl,
      "POST",
      `/api/orders/${order1._id}/cancel-items`,
      {
        operationId: op1Id,
        items: [{ itemId: itemAId.toString(), quantity: 1 }],
        reason: "Cancelled 1 unit of A",
      },
      customerToken
    );

    check(cancel1Res.status === 200, "First partial cancellation returns 200");
    check(cancel1Res.body?.refundAmount === 80, `First refund amount is exactly ₹80 (got ${cancel1Res.body?.refundAmount})`);

    // Verify database state after first cancellation
    const orderAfter1 = await Order.findById(order1._id);
    check(orderAfter1?.partiallyCancelled === true, "Order is partiallyCancelled: true");
    check(orderAfter1?.subtotal === 900, `Remaining subtotal is ₹900 (got ${orderAfter1?.subtotal})`);
    check(orderAfter1?.discount === 180, `Remaining discount is ₹180 (got ${orderAfter1?.discount})`);
    check(orderAfter1?.total === 770, `Remaining total is ₹770 (got ${orderAfter1?.total})`);

    // Cancel 1 unit of Item B (line = 400, 20% discount = 80, net = 320, 2 units => ₹160 per unit)
    const op2Id = `op_audit_2_${testSuffix}`;
    const cancel2Res = await request(
      serverUrl,
      "POST",
      `/api/orders/${order1._id}/cancel-items`,
      {
        operationId: op2Id,
        items: [{ itemId: itemBId.toString(), quantity: 1 }],
        reason: "Cancelled 1 unit of B",
      },
      customerToken
    );

    check(cancel2Res.status === 200, "Second partial cancellation returns 200");
    check(cancel2Res.body?.refundAmount === 160, `Second refund amount is exactly ₹160 (got ${cancel2Res.body?.refundAmount})`);

    const orderAfter2 = await Order.findById(order1._id);
    check(orderAfter2?.subtotal === 700, `Remaining subtotal after 2nd cancel is ₹700 (got ${orderAfter2?.subtotal})`);
    check(orderAfter2?.discount === 140, `Remaining discount after 2nd cancel is ₹140 (got ${orderAfter2?.discount})`);
    check(orderAfter2?.total === 610, `Remaining total after 2nd cancel is ₹610 (got ${orderAfter2?.total})`);

    console.log("\nAudit Scenario 2: Invoice Immutability & Credit Note Generation");
    // Verify invoice fields were NOT mutated
    const invoiceAfterCancel = await Invoice.findById(invoice1._id);
    check(invoiceAfterCancel?.total === originalInvoiceTotal, `Invoice total preserved as immutable (was ${originalInvoiceTotal}, now ${invoiceAfterCancel?.total})`);
    check(invoiceAfterCancel?.subtotal === originalInvoiceSubtotal, `Invoice subtotal preserved as immutable (was ${originalInvoiceSubtotal}, now ${invoiceAfterCancel?.subtotal})`);
    check(invoiceAfterCancel?.discount === originalInvoiceDiscount, `Invoice discount preserved as immutable (was ${originalInvoiceDiscount}, now ${invoiceAfterCancel?.discount})`);

    // Verify CreditNotes were issued
    const creditNotes = await CreditNote.find({ orderId: order1._id }).sort({ createdAt: 1 });
    check(creditNotes.length === 2, `Exactly 2 CreditNotes issued (found ${creditNotes.length})`);
    check(creditNotes[0]?.creditNoteNumber.startsWith("SF-CN-"), `CN 1 number format valid: ${creditNotes[0]?.creditNoteNumber}`);
    check(creditNotes[0]?.totalRefundAmount === 80, `CN 1 refund amount matches: ₹80 (got ${creditNotes[0]?.totalRefundAmount})`);
    check(creditNotes[1]?.totalRefundAmount === 160, `CN 2 refund amount matches: ₹160 (got ${creditNotes[1]?.totalRefundAmount})`);

    console.log("\nAudit Scenario 3: Idempotent Replay with Operation ID");
    // Replay op2
    const replayRes = await request(
      serverUrl,
      "POST",
      `/api/orders/${order1._id}/cancel-items`,
      {
        operationId: op2Id,
        items: [{ itemId: itemBId.toString(), quantity: 1 }],
      },
      customerToken
    );

    check(replayRes.status === 200, "Replay returns 200");
    check(replayRes.body?.refundAmount === 160, "Replay returns original refund amount ₹160");
    const creditNotesAfterReplay = await CreditNote.countDocuments({ orderId: order1._id });
    check(creditNotesAfterReplay === 2, "No duplicate CreditNotes generated on replay");

    console.log("\nAudit Scenario 4: Partial Cancellation Followed by Full Cancellation");
    // Full cancel remaining items on Order 1
    const fullCancelRes = await request(
      serverUrl,
      "POST",
      `/api/orders/${order1._id}/cancel`,
      {
        reason: "Customer cancelled rest of order",
      },
      customerToken
    );

    check(fullCancelRes.status === 200, "Whole order cancel returns 200");
    const orderFinal = await Order.findById(order1._id);
    check(orderFinal?.status === "CANCELLED", "Order status transitioned to CANCELLED");
    check(orderFinal?.partiallyCancelled === false, "partiallyCancelled is false after full cancellation");

    // Total refunds sum across all partial + final cancel
    const totalRefunds = await Refund.find({ orderId: order1._id });
    const totalRefundedSum = totalRefunds.reduce((s, r) => s + r.amount, 0);
    check(totalRefundedSum === 850, `Sum of all refunds matches total order paid amount exactly: ₹${totalRefundedSum} === ₹850`);

    console.log("\nAudit Scenario 5: Integer Paise Math & Zero Paise Drift Under Fractional Allocation");
    // Create an order where division leaves odd paise:
    // 3 units @ ₹100 = ₹300 subtotal, ₹50 discount, ₹0 shipping. Net = ₹250.
    // 250 / 3 = 83.3333333... paise.
    const varOddId = new mongoose.Types.ObjectId();
    const productOdd = await Product.create({
      name: "Odd Paise Product",
      slug: `odd-prod-${testSuffix}`,
      description: "Fractional paise test",
      categoryId: TEST_CATEGORY_ID,
      basePrice: 100,
      variants: [{ _id: varOddId, sku: `SKU-ODD-${testSuffix}`, size: "M", color: "White", stock: 10 }],
    });

    const itemOddId = new mongoose.Types.ObjectId();
    const orderOdd = await Order.create({
      orderNumber: `SF-ODD-${testSuffix.slice(-6)}`,
      userId: customer._id,
      items: [
        {
          _id: itemOddId,
          productId: productOdd._id,
          variantId: varOddId,
          productName: productOdd.name,
          productImage: "https://example.com/odd.jpg",
          selectedSize: "M",
          selectedColor: "White",
          quantity: 3,
          unitPrice: 100,
          lineTotal: 300,
          cancelledQuantity: 0,
        },
      ],
      shippingAddress: {
        fullName: "Test",
        phone: "9876543210",
        addressLine1: "123 Test St",
        city: "Mumbai",
        state: "Maharashtra",
        postalCode: "400001",
        country: "India",
        addressType: "HOME",
      },
      subtotal: 300,
      discount: 50,
      shipping: 0,
      tax: 0,
      total: 250,
      initialSubtotal: 300,
      initialDiscount: 50,
      initialTotal: 250,
      currency: "INR",
      status: "CONFIRMED",
      paymentStatus: "PAID",
      partiallyCancelled: false,
      cancellationVersion: 0,
      cancellationOperations: [],
    });

    const paymentOdd = await Payment.create({
      orderId: orderOdd._id,
      userId: customer._id,
      amount: 250,
      currency: "INR",
      status: "CAPTURED",
      provider: "RAZORPAY",
      razorpayPaymentId: `pay_mock_${testSuffix}_odd`,
      refundedAmount: 0,
      pendingRefundAmount: 0,
    });

    await PaymentAttempt.create({
      paymentId: paymentOdd._id,
      orderId: orderOdd._id,
      razorpayOrderId: `order_mock_${testSuffix}_odd`,
      razorpayPaymentId: `pay_mock_${testSuffix}_odd`,
      amount: 250,
      currency: "INR",
      status: "CAPTURED",
    });

    // Step 1: cancel unit 1 of 3
    const odd1 = await cancelOrderItemsWithRefund({
      orderId: orderOdd._id.toString(),
      items: [{ itemId: itemOddId.toString(), quantity: 1 }],
      source: "CUSTOMER",
    });
    check(odd1.refundAmount === 83.33, `Unit 1 refund is ₹83.33 (got ₹${odd1.refundAmount})`);

    // Step 2: cancel unit 2 of 3
    const odd2 = await cancelOrderItemsWithRefund({
      orderId: orderOdd._id.toString(),
      items: [{ itemId: itemOddId.toString(), quantity: 1 }],
      source: "CUSTOMER",
    });
    check(odd2.refundAmount === 83.33, `Unit 2 refund is ₹83.33 (got ₹${odd2.refundAmount})`);

    // Step 3: cancel unit 3 of 3 (final unit receives remaining 1 paise)
    const odd3 = await cancelOrderItemsWithRefund({
      orderId: orderOdd._id.toString(),
      items: [{ itemId: itemOddId.toString(), quantity: 1 }],
      source: "CUSTOMER",
    });
    check(odd3.refundAmount === 83.34, `Final unit 3 receives remainder paise: ₹83.34 (got ₹${odd3.refundAmount})`);
    const oddSum = Math.round((odd1.refundAmount + odd2.refundAmount + odd3.refundAmount) * 100) / 100;
    check(oddSum === 250, `Sum of fractional refunds is exact to the paise: ₹${oddSum} === ₹250.00`);

    console.log("\nAudit Scenario 6: Input Validation & Over-cancellation Prevention");
    // Negative quantity
    const negRes = await request(
      serverUrl,
      "POST",
      `/api/orders/${orderOdd._id}/cancel-items`,
      {
        items: [{ itemId: itemOddId.toString(), quantity: -1 }],
      },
      customerToken
    );
    check(negRes.status === 400, "Negative cancellation quantity rejected with 400");

    // Non-integer quantity
    const floatRes = await request(
      serverUrl,
      "POST",
      `/api/orders/${orderOdd._id}/cancel-items`,
      {
        items: [{ itemId: itemOddId.toString(), quantity: 1.5 }],
      },
      customerToken
    );
    check(floatRes.status === 400, "Float cancellation quantity rejected with 400");

    // Over-cancellation (orderOdd is already fully cancelled)
    const overRes = await request(
      serverUrl,
      "POST",
      `/api/orders/${orderOdd._id}/cancel-items`,
      {
        items: [{ itemId: itemOddId.toString(), quantity: 1 }],
      },
      customerToken
    );
    check(overRes.status === 400, "Cancelling already cancelled item rejected with 400");

    console.log("\nAudit Scenario 7: Unauthorized Cancellation Attempts Blocked");
    // Customer 2 attempts to cancel Customer 1's order
    const unauthRes = await request(
      serverUrl,
      "POST",
      `/api/orders/${order1._id}/cancel-items`,
      {
        items: [{ itemId: itemAId.toString(), quantity: 1 }],
      },
      unauthorizedToken
    );
    check(unauthRes.status === 404, `Unauthorized customer cannot access order (status ${unauthRes.status})`);

    console.log("\nAudit Scenario 8: Custom-Print Lock Protection");
    // Create new order with custom print job
    const customVarId = new mongoose.Types.ObjectId();
    const customProduct = await Product.create({
      name: "Custom Tee",
      slug: `custom-tee-${testSuffix}`,
      description: "Custom t-shirt",
      categoryId: TEST_CATEGORY_ID,
      basePrice: 500,
      variants: [{ _id: customVarId, sku: `SKU-CUST-${testSuffix}`, size: "M", color: "Black", stock: 10 }],
    });
    const customItemId = new mongoose.Types.ObjectId();
    const customOrder = await Order.create({
      orderNumber: `SF-CUST-${testSuffix.slice(-6)}`,
      userId: customer._id,
      items: [
        {
          _id: customItemId,
          productId: customProduct._id,
          variantId: customVarId,
          productName: customProduct.name,
          productImage: "https://example.com/c.jpg",
          selectedSize: "M",
          selectedColor: "Black",
          quantity: 1,
          unitPrice: 500,
          lineTotal: 500,
          cancelledQuantity: 0,
        },
      ],
      shippingAddress: {
        fullName: "Test",
        phone: "9876543210",
        addressLine1: "123 Test St",
        city: "Mumbai",
        state: "Maharashtra",
        postalCode: "400001",
        country: "India",
        addressType: "HOME",
      },
      subtotal: 500,
      discount: 0,
      shipping: 0,
      tax: 0,
      total: 500,
      currency: "INR",
      status: "PROCESSING",
      paymentStatus: "PAID",
      partiallyCancelled: false,
    });

    const paymentCustom = await Payment.create({
      orderId: customOrder._id,
      userId: customer._id,
      amount: 500,
      currency: "INR",
      status: "CAPTURED",
      provider: "RAZORPAY",
      razorpayPaymentId: `pay_mock_${testSuffix}_cust`,
      refundedAmount: 0,
      pendingRefundAmount: 0,
    });
    await PaymentAttempt.create({
      paymentId: paymentCustom._id,
      orderId: customOrder._id,
      razorpayOrderId: `order_mock_${testSuffix}_cust`,
      razorpayPaymentId: `pay_mock_${testSuffix}_cust`,
      amount: 500,
      currency: "INR",
      status: "CAPTURED",
    });

    await PrintJob.create({
      orderId: customOrder._id,
      orderItemId: customItemId.toString(),
      status: PrintJobStatus.READY_FOR_PRINT,
      priority: PrintJobPriority.HIGH,
    });

    // Customer cancellation should be blocked
    const custLockRes = await request(
      serverUrl,
      "POST",
      `/api/orders/${customOrder._id}/cancel-items`,
      {
        items: [{ itemId: customItemId.toString(), quantity: 1 }],
      },
      customerToken
    );
    check(custLockRes.status === 400, "Customer cancellation blocked when custom-print is READY_FOR_PRINT");

    // Admin cancellation should be permitted
    const adminLockRes = await request(
      serverUrl,
      "POST",
      `/api/admin/orders/${customOrder._id}/cancel-items`,
      {
        items: [{ itemId: customItemId.toString(), quantity: 1 }],
        reason: "Admin override for customer support",
      },
      adminToken
    );
    check(adminLockRes.status === 200, "Admin can cancel custom-print item with override");

    console.log("\nAudit Scenario 9: Credit Note API Retrieval Endpoint");
    const cnApiRes = await request(
      serverUrl,
      "GET",
      `/api/orders/${order1._id}/credit-notes`,
      undefined,
      customerToken
    );
    check(cnApiRes.status === 200, "GET /api/orders/:id/credit-notes returns 200 for owner");
    check(Array.isArray(cnApiRes.body?.data) && cnApiRes.body?.data.length >= 2, `Customer can view their credit notes (found ${cnApiRes.body?.data?.length})`);

    const cnAdminRes = await request(
      serverUrl,
      "GET",
      `/api/admin/orders/${order1._id}/credit-notes`,
      undefined,
      adminToken
    );
    check(cnAdminRes.status === 200, "GET /api/admin/orders/:id/credit-notes returns 200 for admin");

    console.log("\nAudit Scenario 10: Razorpay Gateway Idempotency Key Invariance Across Retries");
    const originalCreateRefund = razorpayProvider.createRefund;
    const capturedGatewayKeys: string[] = [];
    const capturedAmounts: number[] = [];

    // Order 10 for retry key invariance
    const testProd10 = await Product.create({
      name: "Retry Key Test Kurta",
      slug: `retry-key-kurta-${testSuffix}`,
      description: "Testing gateway idempotency key stability",
      categoryId: TEST_CATEGORY_ID,
      basePrice: 500,
      freeDelivery: true,
      variants: [
        {
          _id: new mongoose.Types.ObjectId(),
          sku: `SKU-RET10-${testSuffix}`,
          size: "L",
          color: "WHITE",
          stock: 10,
        },
      ],
    });
    const item10 = {
      _id: new mongoose.Types.ObjectId(),
      productId: testProd10._id,
      variantId: testProd10.variants[0]._id,
      productName: testProd10.name,
      productImage: "https://example.com/kurta10.jpg",
      selectedSize: "L",
      selectedColor: "WHITE",
      quantity: 2,
      unitPrice: 500,
      lineTotal: 1000,
      cancelledQuantity: 0,
    };
    const order10 = await Order.create({
      orderNumber: `ORD-AUDIT-${testSuffix}-10`,
      userId: customer._id,
      items: [item10],
      shippingAddress: {
        fullName: "Audit Customer",
        phone: "9876543210",
        addressLine1: "10 Idempotency Way",
        city: "Mumbai",
        state: "Maharashtra",
        postalCode: "400001",
        country: "India",
        addressType: "HOME",
      },
      subtotal: 1000,
      discount: 0,
      shipping: 0,
      tax: 0,
      total: 1000,
      initialSubtotal: 1000,
      initialDiscount: 0,
      initialTotal: 1000,
      currency: "INR",
      status: "CONFIRMED",
      paymentStatus: "PAID",
      paymentMethod: "RAZORPAY",
      cancellationVersion: 0,
      cancellationOperations: [],
    });
    const payment10 = await Payment.create({
      orderId: order10._id,
      userId: customer._id,
      amount: 1000,
      currency: "INR",
      status: "CAPTURED",
      provider: "RAZORPAY",
      razorpayPaymentId: `pay_mock_retry_${Date.now()}`,
      refundedAmount: 0,
      pendingRefundAmount: 0,
      refundReservations: [],
    });
    await PaymentAttempt.create({
      paymentId: payment10._id,
      orderId: order10._id,
      razorpayOrderId: `order_audit_10_${Date.now()}`,
      razorpayPaymentId: payment10.razorpayPaymentId,
      amount: 1000,
      currency: "INR",
      status: "CAPTURED",
    });

    let attemptCount = 0;
    razorpayProvider.createRefund = async (
      paymentId: string,
      amountInPaise: number,
      notes: Record<string, string | number> = {},
      idempotencyKey?: string
    ) => {
      attemptCount++;
      capturedGatewayKeys.push(idempotencyKey || "");
      capturedAmounts.push(amountInPaise);
      if (attemptCount === 1) {
        throw {
          statusCode: 400,
          error: { code: "BAD_REQUEST_ERROR", description: "Simulated initial gateway failure" },
        };
      }
      return {
        id: `rfnd_mock_ret_${Date.now()}`,
        entity: "refund",
        amount: amountInPaise,
        status: "processed",
        notes,
      };
    };

    const opId10 = `retry_op_${Date.now()}`;
    const outcome1 = await cancelOrderItemsWithRefund({
      orderId: order10._id.toString(),
      items: [{ itemId: item10._id.toString(), quantity: 1 }],
      actorId: customer._id.toString(),
      actorRole: "CUSTOMER",
      source: "CUSTOMER",
      operationId: opId10,
    });
    check(Boolean(outcome1.refundError), "Attempt 1 failed at gateway and recorded refundError");

    const retryOutcome = await cancelOrderItemsWithRefund({
      orderId: order10._id.toString(),
      items: [{ itemId: item10._id.toString(), quantity: 1 }],
      actorId: customer._id.toString(),
      actorRole: "CUSTOMER",
      source: "CUSTOMER",
      operationId: opId10,
    });
    check(Boolean(retryOutcome.refund), "Attempt 2 succeeded upon retry");
    check(capturedGatewayKeys.length === 2, "Exactly 2 gateway calls made across retries");
    check(
      capturedGatewayKeys[0] === capturedGatewayKeys[1] && Boolean(capturedGatewayKeys[0]),
      `Gateway idempotency key is IDENTICAL across retries (${capturedGatewayKeys[0]} === ${capturedGatewayKeys[1]})`
    );
    check(
      !/(_a\d+|_att\d+)/.test(capturedGatewayKeys[0]),
      `Gateway key does NOT contain retry attempt number (${capturedGatewayKeys[0]})`
    );
    check(
      capturedGatewayKeys[0].length <= 40,
      `Gateway key satisfies Razorpay length limit <= 40 chars (${capturedGatewayKeys[0].length} chars)`
    );
    check(
      capturedAmounts[0] === capturedAmounts[1] && capturedAmounts[0] === 50000,
      `Payload amount in paise is identical across attempts (${capturedAmounts[0]} === ${capturedAmounts[1]})`
    );

    razorpayProvider.createRefund = originalCreateRefund;

    console.log("\nAudit Scenario 11: Ambiguous Network Timeout Reconciliation Before Retrying");
    const order11 = await Order.create({
      orderNumber: `ORD-AUDIT-${testSuffix}-11`,
      userId: customer._id,
      items: [item10],
      shippingAddress: order10.shippingAddress,
      subtotal: 1000,
      discount: 0,
      shipping: 0,
      tax: 0,
      total: 1000,
      initialSubtotal: 1000,
      initialDiscount: 0,
      initialTotal: 1000,
      currency: "INR",
      status: "CONFIRMED",
      paymentStatus: "PAID",
      paymentMethod: "RAZORPAY",
      cancellationVersion: 0,
      cancellationOperations: [],
    });
    const payment11 = await Payment.create({
      orderId: order11._id,
      userId: customer._id,
      amount: 1000,
      currency: "INR",
      status: "CAPTURED",
      provider: "RAZORPAY",
      razorpayPaymentId: `pay_mock_unk_${Date.now()}`,
      refundedAmount: 0,
      pendingRefundAmount: 0,
      refundReservations: [],
    });
    await PaymentAttempt.create({
      paymentId: payment11._id,
      orderId: order11._id,
      razorpayOrderId: `order_audit_11_${Date.now()}`,
      razorpayPaymentId: payment11.razorpayPaymentId,
      amount: 1000,
      currency: "INR",
      status: "CAPTURED",
    });

    razorpayProvider.createRefund = async () => {
      throw {
        statusCode: 502,
        error: { code: "GATEWAY_TIMEOUT", description: "Gateway network timed out" },
      };
    };

    const opId11 = `unk_op_${Date.now()}`;
    const outcome11 = await cancelOrderItemsWithRefund({
      orderId: order11._id.toString(),
      items: [{ itemId: item10._id.toString(), quantity: 1 }],
      actorId: customer._id.toString(),
      actorRole: "CUSTOMER",
      source: "CUSTOMER",
      operationId: opId11,
    });
    check(
      Boolean(outcome11.refundError && (outcome11.refundError.includes("uncertain") || outcome11.refundError.includes("UNKNOWN") || outcome11.refundError.includes("502"))),
      "Network timeout resulted in refundError with uncertain/UNKNOWN status"
    );

    const unkRefundDoc = await Refund.findOne({ orderId: order11._id });
    check(unkRefundDoc?.status === "UNKNOWN", "Refund document correctly holds UNKNOWN status holding reservation");

    razorpayProvider.createRefund = originalCreateRefund;

    console.log("\nAudit Scenario 12: Simulated Server Crash & Standalone MongoDB Recovery");
    const testProd12 = await Product.create({
      name: "Crash Recovery Test Shirt",
      slug: `crash-recovery-shirt-${testSuffix}`,
      description: "Testing crash recovery between order and inventory/credit note",
      categoryId: TEST_CATEGORY_ID,
      basePrice: 600,
      variants: [
        {
          _id: new mongoose.Types.ObjectId(),
          sku: `SKU-CRASH12-${testSuffix}`,
          size: "XL",
          color: "BLACK",
          stock: 10,
        },
      ],
    });
    const item12 = {
      _id: new mongoose.Types.ObjectId(),
      productId: testProd12._id,
      variantId: testProd12.variants[0]._id,
      productName: testProd12.name,
      productImage: "https://example.com/shirt12.jpg",
      selectedSize: "XL",
      selectedColor: "BLACK",
      quantity: 2,
      unitPrice: 600,
      lineTotal: 1200,
      cancelledQuantity: 0,
    };
    const opCrashId = `crash_sim_op_${Date.now()}`;
    const order12 = await Order.create({
      orderNumber: `ORD-AUDIT-${testSuffix}-12`,
      userId: customer._id,
      items: [
        {
          ...item12,
          cancelledQuantity: 1,
        },
      ],
      shippingAddress: order10.shippingAddress,
      subtotal: 600,
      discount: 0,
      shipping: 0,
      tax: 0,
      total: 600,
      initialSubtotal: 1200,
      initialDiscount: 0,
      initialTotal: 1200,
      currency: "INR",
      status: "CONFIRMED",
      paymentStatus: "PAID",
      paymentMethod: "RAZORPAY",
      partiallyCancelled: true,
      cancellationVersion: 1,
      cancellationOperations: [
        {
          operationId: opCrashId,
          itemIds: [item12._id],
          items: [
            {
              itemId: item12._id,
              productId: item12.productId,
              variantId: item12.variantId,
              quantity: 1,
              refundAmount: 600,
            },
          ],
          refundAmount: 600,
          fullyCancelled: false,
          source: "CUSTOMER",
          reason: "Simulated crash pending operation",
          actorId: customer._id,
          status: "PENDING",
          inventoryRestored: false,
          creditNoteIssued: false,
          createdAt: new Date(),
        },
      ],
    });
    await Invoice.create({
      invoiceNumber: `SF-INV-AUDIT-${testSuffix}-12`,
      orderId: order12._id,
      userId: customer._id,
      orderNumber: order12.orderNumber,
      status: InvoiceStatus.ISSUED,
      customerSnapshot: {
        name: "Audit Customer",
        email: customer.email,
        phone: "9876543210",
      },
      billingAddressSnapshot: order10.shippingAddress,
      shippingAddressSnapshot: order10.shippingAddress,
      itemsSnapshot: [
        {
          productId: item12.productId,
          productName: item12.productName,
          selectedSize: item12.selectedSize,
          selectedColor: item12.selectedColor,
          quantity: 2,
          unitPrice: 600,
          lineTotal: 1200,
          cancelledQuantity: 0,
        },
      ],
      subtotal: 1200,
      tax: 0,
      shipping: 0,
      discount: 0,
      total: 1200,
      currency: "INR",
      paymentSnapshot: {
        provider: "RAZORPAY",
        status: "PAID",
        amount: 1200,
        currency: "INR",
      },
    });
    const payment12 = await Payment.create({
      orderId: order12._id,
      userId: customer._id,
      amount: 1200,
      currency: "INR",
      status: "CAPTURED",
      provider: "RAZORPAY",
      razorpayPaymentId: `pay_mock_crash_${Date.now()}`,
      refundedAmount: 0,
      pendingRefundAmount: 0,
      refundReservations: [],
    });
    await PaymentAttempt.create({
      paymentId: payment12._id,
      orderId: order12._id,
      razorpayOrderId: `order_audit_12_${Date.now()}`,
      razorpayPaymentId: payment12.razorpayPaymentId,
      amount: 1200,
      currency: "INR",
      status: "CAPTURED",
    });

    const preProd12 = await Product.findById(testProd12._id);
    check(preProd12?.variants[0].stock === 10, "Pre-recovery stock is still 10 (unrestored)");
    const preCn12 = await CreditNote.findOne({ operationId: opCrashId });
    check(!preCn12, "Pre-recovery credit note does not exist");

    const sweepRes = await reconcilePendingCancellationOperations(order12._id.toString());
    check(sweepRes.inspectedCount === 1, "Recovery sweep inspected 1 pending operation");
    check(sweepRes.recoveredCount === 1, "Recovery sweep successfully completed 1 operation");

    const postProd12 = await Product.findById(testProd12._id);
    check(postProd12?.variants[0].stock === 11, "Post-recovery stock restored to 11");
    const postCn12 = await CreditNote.findOne({ operationId: opCrashId });
    check(Boolean(postCn12), "Post-recovery credit note was issued");
    check(postCn12?.status === "ISSUED", "Credit note status is ISSUED");

    const postOrder12 = await Order.findById(order12._id);
    const postOp12 = postOrder12?.cancellationOperations?.find((o) => o.operationId === opCrashId);
    check(postOp12?.status === "COMPLETED", "Operation status transitioned to COMPLETED");
    check(postOp12?.inventoryRestored === true, "Operation inventoryRestored is true");
    check(postOp12?.creditNoteIssued === true, "Operation creditNoteIssued is true");

    const sweepRes2 = await reconcilePendingCancellationOperations(order12._id.toString());
    check(sweepRes2.inspectedCount === 0, "Second recovery sweep inspected 0 operations (all completed)");
    const postProd12Again = await Product.findById(testProd12._id);
    check(postProd12Again?.variants[0].stock === 11, "Stock was not double-incremented on second sweep (still 11)");
    const cnCount12 = await CreditNote.countDocuments({ operationId: opCrashId });
    check(cnCount12 === 1, "No duplicate credit note created on second sweep (exactly 1)");

    console.log("\nAudit Scenario 13: Credit Note Unique Index & Duplicate Rejection");
    let cnDupError: any = null;
    try {
      await CreditNote.create({
        creditNoteNumber: `SF-CN-2026-DUP999`,
        invoiceId: postCn12!.invoiceId,
        invoiceNumber: postCn12!.invoiceNumber,
        orderId: order12._id,
        orderNumber: order12.orderNumber,
        userId: customer._id,
        operationId: opCrashId,
        status: "ISSUED",
        items: postCn12!.items,
        subtotalRefunded: 600,
        discountAdjusted: 0,
        taxRefunded: 0,
        totalRefundAmount: 600,
        currency: "INR",
      });
    } catch (err: any) {
      cnDupError = err;
    }
    check(cnDupError && cnDupError.code === 11000, "Duplicate credit note insertion strictly rejected by unique index (E11000)");

    const invoiceAfterAll = await Invoice.findOne({ orderId: order12._id });
    check(invoiceAfterAll?.total === 1200, "Original invoice total preserved as immutable (₹1200)");

    console.log("\nAudit Scenario 14: Automated Recovery Coordinator Cycle & Definitively Failed Refund Handling");
    // 14A: Verify RecoveryCoordinatorService executes reconcilePendingCancellationOperations
    const var14Id = new mongoose.Types.ObjectId();
    const product14: any = await Product.create({
      name: "Recovery Coordinator Test Product",
      slug: `recovery-coord-test-${testSuffix}`,
      description: "Testing recovery coordinator execution",
      categoryId: TEST_CATEGORY_ID,
      basePrice: 500,
      variants: [
        {
          _id: var14Id,
          sku: `sku-14-${testSuffix}`,
          size: "M",
          color: "Blue",
          price: 500,
          stock: 10,
        },
      ],
    });

    const item14Id = new mongoose.Types.ObjectId();
    const order14 = await Order.create({
      userId: customer._id,
      items: [
        {
          _id: item14Id,
          productId: product14._id,
          variantId: var14Id,
          productName: "Recovery Coordinator Test Product",
          productImage: "https://example.com/p14.jpg",
          selectedSize: "M",
          selectedColor: "Blue",
          quantity: 2,
          unitPrice: 500,
          lineTotal: 1000,
          cancelledQuantity: 1,
        },
      ],
      shippingAddress: {
        fullName: "Test Customer",
        phone: "9876543210",
        addressLine1: "14 Leader Road",
        city: "Mumbai",
        state: "Maharashtra",
        postalCode: "400001",
        country: "India",
      },
      paymentMethod: "RAZORPAY",
      paymentStatus: "PAID",
      total: 1000,
      subtotal: 1000,
      shipping: 0,
      tax: 0,
      status: "CONFIRMED",
      orderNumber: `ORD-SCENARIO-14-${testSuffix}`,
      cancellationOperations: [
        {
          operationId: `op-coord-recovery-1-${testSuffix}`,
          items: [
            {
              itemId: item14Id,
              productId: product14._id,
              variantId: var14Id,
              quantity: 1,
              refundAmount: 500,
            },
          ],
          refundAmount: 500,
          reason: "Simulated worker interruption",
          actorId: customer._id,
          source: "CUSTOMER",
          createdAt: new Date(),
          status: "PENDING",
          inventoryRestored: false,
          creditNoteIssued: false,
        },
      ],
    });

    const payment14: any = await Payment.create({
      orderId: order14._id,
      userId: customer._id,
      amount: 1000,
      currency: "INR",
      status: "CAPTURED",
      provider: "RAZORPAY",
      razorpayPaymentId: `pay_mock_14_${Date.now()}`,
      refundedAmount: 0,
      pendingRefundAmount: 0,
      refundReservations: [],
    });

    await PaymentAttempt.create({
      paymentId: payment14._id,
      orderId: order14._id,
      razorpayOrderId: `order_mock_14_${testSuffix}`,
      razorpayPaymentId: payment14.razorpayPaymentId,
      amount: 1000,
      currency: "INR",
      status: "CAPTURED",
    });

    await getOrCreateInvoiceForOrder(order14._id.toString());

    const report14 = await RecoveryCoordinatorService.executeCoordinatedRecoveryCycle();
    check(report14.executed, "Coordinated recovery cycle executed under worker leader lease");
    check(Number(report14.cancellationsRecoveredCount) >= 1, `Recovery cycle reported cancellations recovered (got ${report14.cancellationsRecoveredCount})`);

    const product14After = await Product.findById(product14._id);
    check(product14After?.variants[0].stock === 11, "Stock restored by coordinated recovery cycle (10 -> 11)");

    const order14After = await Order.findById(order14._id);
    const op14After = order14After?.cancellationOperations?.find((o) => o.operationId === `op-coord-recovery-1-${testSuffix}`);
    check(op14After?.status === "COMPLETED", "Interrupted cancellation operation transitioned to COMPLETED");
    check(op14After?.inventoryRestored === true, "Operation marked inventoryRestored: true");
    check(op14After?.creditNoteIssued === true, "Operation marked creditNoteIssued: true");

    // 14B: Verify definitively failed refund sets operation status to FAILED and is not blindly resubmitted
    const item14BId = new mongoose.Types.ObjectId();
    const order14B = await Order.create({
      userId: customer._id,
      items: [
        {
          _id: item14BId,
          productId: product14._id,
          variantId: var14Id,
          productName: "Recovery Failed Test Product",
          productImage: "https://example.com/p14b.jpg",
          selectedSize: "M",
          selectedColor: "Blue",
          quantity: 2,
          unitPrice: 500,
          lineTotal: 1000,
          cancelledQuantity: 1,
        },
      ],
      shippingAddress: {
        fullName: "Test Customer",
        phone: "9876543210",
        addressLine1: "14 Leader Road",
        city: "Mumbai",
        state: "Maharashtra",
        postalCode: "400001",
        country: "India",
      },
      paymentMethod: "RAZORPAY",
      paymentStatus: "PAID",
      total: 1000,
      subtotal: 1000,
      shipping: 0,
      tax: 0,
      status: "CONFIRMED",
      orderNumber: `ORD-SCENARIO-14B-${testSuffix}`,
      cancellationOperations: [
        {
          operationId: `op-coord-recovery-fail-${testSuffix}`,
          items: [
            {
              itemId: item14BId,
              productId: product14._id,
              variantId: var14Id,
              quantity: 1,
              refundAmount: 500,
            },
          ],
          refundAmount: 500,
          reason: "Simulated gateway definitive failure",
          actorId: customer._id,
          source: "CUSTOMER",
          createdAt: new Date(),
          status: "PENDING",
          inventoryRestored: true,
          creditNoteIssued: true,
        },
      ],
    });

    const failedRefund = await Refund.create({
      orderId: order14B._id,
      paymentId: new mongoose.Types.ObjectId(),
      userId: customer._id,
      initiatedBy: customer._id,
      initiatedByRole: "CUSTOMER",
      amount: 500,
      currency: "INR",
      status: "FAILED",
      submissionState: "CONFIRMED",
      gatewayIdempotencyKey: `rfnd_op_coord_fail_${testSuffix}`,
      failureReason: "Gateway definitively rejected refund (Card expired / Account closed)",
    });

    // Link refundId to op so reconcilePendingCancellationOperations finds it immediately
    await Order.updateOne(
      { _id: order14B._id, "cancellationOperations.operationId": `op-coord-recovery-fail-${testSuffix}` },
      { $set: { "cancellationOperations.$.refundId": failedRefund._id } }
    );

    const sweepResFail = await reconcilePendingCancellationOperations(order14B._id.toString());
    check(sweepResFail.recoveredCount === 1, "Recovery sweep processed failed refund cancellation");

    const order14BAfter = await Order.findById(order14B._id);
    const op14BAfter = order14BAfter?.cancellationOperations?.find((o) => o.operationId === `op-coord-recovery-fail-${testSuffix}`);
    check(op14BAfter?.status === "FAILED", "Cancellation operation with definitively failed refund is marked FAILED");
    check(op14BAfter?.refundId?.toString() === failedRefund._id.toString(), "Cancellation operation links to failed refund record");

    // Second recovery sweep does not touch or resubmit FAILED operation
    const sweepResFail2 = await reconcilePendingCancellationOperations(order14B._id.toString());
    check(sweepResFail2.inspectedCount === 0, "Second recovery sweep ignores FAILED cancellation operation (0 inspected)");

    console.log("\nAudit Scenario 15: Free Delivery Threshold Safeguard (Option C)");
    const prod15A = await Product.create({
      name: "Threshold Product A",
      slug: `threshold-prod-a-${testSuffix}`,
      description: "Testing threshold protection product A",
      categoryId: TEST_CATEGORY_ID,
      basePrice: 600,
      freeDelivery: false,
      variants: [{ _id: new mongoose.Types.ObjectId(), sku: `SKU-15A-${testSuffix}`, size: "M", color: "BLACK", stock: 10 }],
    });
    const prod15B = await Product.create({
      name: "Threshold Product B",
      slug: `threshold-prod-b-${testSuffix}`,
      description: "Testing threshold protection product B",
      categoryId: TEST_CATEGORY_ID,
      basePrice: 600,
      freeDelivery: false,
      variants: [{ _id: new mongoose.Types.ObjectId(), sku: `SKU-15B-${testSuffix}`, size: "L", color: "WHITE", stock: 10 }],
    });
    const item15A = {
      _id: new mongoose.Types.ObjectId(),
      productId: prod15A._id,
      variantId: prod15A.variants[0]._id,
      productName: prod15A.name,
      productImage: "https://example.com/15a.jpg",
      selectedSize: "M",
      selectedColor: "BLACK",
      quantity: 1,
      unitPrice: 600,
      lineTotal: 600,
      cancelledQuantity: 0,
    };
    const item15B = {
      _id: new mongoose.Types.ObjectId(),
      productId: prod15B._id,
      variantId: prod15B.variants[0]._id,
      productName: prod15B.name,
      productImage: "https://example.com/15b.jpg",
      selectedSize: "L",
      selectedColor: "WHITE",
      quantity: 1,
      unitPrice: 600,
      lineTotal: 600,
      cancelledQuantity: 0,
    };

    const order15 = await Order.create({
      orderNumber: `ORD-AUDIT-${testSuffix}-15`,
      userId: customer._id,
      items: [item15A, item15B],
      shippingAddress: order10.shippingAddress,
      subtotal: 1200,
      discount: 0,
      shipping: 0,
      tax: 0,
      total: 1200,
      initialSubtotal: 1200,
      initialDiscount: 0,
      initialShipping: 0,
      initialTotal: 1200,
      freeShippingThresholdSnapshot: 999,
      shippingFeeSnapshot: 100,
      qualifiedForFreeShipping: true,
      freeShippingReason: "THRESHOLD",
      currency: "INR",
      status: "CONFIRMED",
      paymentStatus: "PAID",
      paymentMethod: "RAZORPAY",
      cancellationVersion: 0,
      cancellationOperations: [],
    });

    const payment15 = await Payment.create({
      orderId: order15._id,
      userId: customer._id,
      amount: 1200,
      currency: "INR",
      status: "CAPTURED",
      provider: "RAZORPAY",
      razorpayPaymentId: `pay_mock_15_${Date.now()}`,
      refundedAmount: 0,
      pendingRefundAmount: 0,
      refundReservations: [],
    });
    await PaymentAttempt.create({
      paymentId: payment15._id,
      orderId: order15._id,
      razorpayOrderId: `order_audit_15_${Date.now()}`,
      razorpayPaymentId: payment15.razorpayPaymentId,
      amount: 1200,
      currency: "INR",
      status: "CAPTURED",
    });

    // 15A: Customer partial cancellation drops active order to ₹600 (< ₹999 threshold) -> BLOCKED
    const custBelowThresholdRes = await request(
      serverUrl,
      "POST",
      `/api/orders/${order15._id}/cancel-items`,
      {
        items: [{ itemId: item15A._id.toString(), quantity: 1 }],
        reason: "Customer partial cancel below threshold",
      },
      customerToken
    );
    check(custBelowThresholdRes.status === 400, "Customer partial cancellation below threshold is blocked (HTTP 400)");
    check(
      custBelowThresholdRes.body?.code === "PARTIAL_CANCELLATION_BELOW_THRESHOLD" ||
      Boolean(custBelowThresholdRes.body?.message?.includes("free delivery threshold")),
      "Error response clarifies order falls below free delivery threshold"
    );

    const adminNoOverrideRes = await request(
      serverUrl,
      "POST",
      `/api/admin/orders/${order15._id}/cancel-items`,
      {
        items: [{ itemId: item15A._id.toString(), quantity: 1 }],
        reason: "Admin cancel without override flag",
      },
      adminToken
    );
    check(adminNoOverrideRes.status === 400, "Admin cancellation without override defaults to BLOCKED (HTTP 400)");

    // 15C: Admin cancellation with non-boolean override is rejected
    const adminNonBoolRes = await request(
      serverUrl,
      "POST",
      `/api/admin/orders/${order15._id}/cancel-items`,
      {
        items: [{ itemId: item15A._id.toString(), quantity: 1 }],
        allowBelowThreshold: "true" as any,
        reason: "Invalid override type",
      },
      adminToken
    );
    check(adminNonBoolRes.status === 400, "Admin cancellation with non-boolean allowBelowThreshold is rejected (HTTP 400)");

    // 15D: Admin cancellation with allowBelowThreshold: true but missing reason is rejected
    const adminMissingReasonRes = await request(
      serverUrl,
      "POST",
      `/api/admin/orders/${order15._id}/cancel-items`,
      {
        items: [{ itemId: item15A._id.toString(), quantity: 1 }],
        allowBelowThreshold: true,
        reason: "   ",
        overrideReason: "   ",
      },
      adminToken
    );
    check(adminMissingReasonRes.status === 400, "Admin cancellation with allowBelowThreshold: true but missing reason is rejected (HTTP 400)");

    // 15E: Admin cancellation with allowBelowThreshold: true and valid reason succeeds and writes AuditLog
    const adminValidOverrideRes = await request(
      serverUrl,
      "POST",
      `/api/admin/orders/${order15._id}/cancel-items`,
      {
        items: [{ itemId: item15A._id.toString(), quantity: 1 }],
        allowBelowThreshold: true,
        overrideReason: "Stock inspection damaged - approved admin exception",
      },
      adminToken
    );
    check(adminValidOverrideRes.status === 200, "Admin can perform partial cancellation below threshold with validated override");

    const overrideAuditLog = await AuditLog.findOne({
      action: "ADMIN_OVERRIDE_FREE_SHIPPING_THRESHOLD",
      entityId: order15._id,
    });
    check(Boolean(overrideAuditLog), "AuditLog record created for admin threshold override");
    check(
      overrideAuditLog?.metadata?.overrideReason === "Stock inspection damaged - approved admin exception",
      "AuditLog contains the exact admin override reason"
    );

    // 15F: Customer can cancel the remaining entire order cleanly
    const custFullCancelRes = await request(
      serverUrl,
      "POST",
      `/api/orders/${order15._id}/cancel`,
      { reason: "Customer cancelled remaining entire order" },
      customerToken
    );
    check(custFullCancelRes.status === 200, "Customer can cancel remaining entire order");
    const order15Final = await Order.findById(order15._id);
    check(order15Final?.status === "CANCELLED", "Order successfully transitioned to CANCELLED");

    console.log("\nAudit Scenario 16: Exact Production Setting (₹7 Threshold & ₹40 Shipping Fee)");
    await saveStoreSettings({ freeShippingThreshold: 7, standardShippingFee: 40 });

    const prod2Rs = await Product.create({
      name: "₹2 Coti Kurta",
      slug: `coti-2rs-${testSuffix}`,
      description: "Testing exact production scenario 2 rupees",
      categoryId: TEST_CATEGORY_ID,
      basePrice: 2,
      freeDelivery: false,
      variants: [
        { _id: new mongoose.Types.ObjectId(), sku: `SKU-2RS-S-${testSuffix}`, size: "S", color: "GREEN", stock: 10 },
        { _id: new mongoose.Types.ObjectId(), sku: `SKU-2RS-M-${testSuffix}`, size: "M", color: "GREEN", stock: 10 },
        { _id: new mongoose.Types.ObjectId(), sku: `SKU-2RS-L-${testSuffix}`, size: "L", color: "GREEN", stock: 10 },
      ],
    });
    const prod5Rs = await Product.create({
      name: "₹5 Coti Kurta",
      slug: `coti-5rs-${testSuffix}`,
      description: "Testing exact production scenario 5 rupees",
      categoryId: TEST_CATEGORY_ID,
      basePrice: 5,
      freeDelivery: false,
      variants: [
        { _id: new mongoose.Types.ObjectId(), sku: `SKU-5RS-S-${testSuffix}`, size: "S", color: "BEIGE", stock: 10 },
      ],
    });

    const item2S = {
      _id: new mongoose.Types.ObjectId(),
      productId: prod2Rs._id,
      variantId: prod2Rs.variants[0]._id,
      productName: "4 pocket Coti S",
      productImage: "https://example.com/2s.jpg",
      selectedSize: "S",
      selectedColor: "GREEN",
      quantity: 1,
      unitPrice: 2,
      lineTotal: 2,
      cancelledQuantity: 0,
    };
    const item2M = {
      _id: new mongoose.Types.ObjectId(),
      productId: prod2Rs._id,
      variantId: prod2Rs.variants[1]._id,
      productName: "4 pocket Coti M",
      productImage: "https://example.com/2m.jpg",
      selectedSize: "M",
      selectedColor: "GREEN",
      quantity: 1,
      unitPrice: 2,
      lineTotal: 2,
      cancelledQuantity: 0,
    };
    const item2L = {
      _id: new mongoose.Types.ObjectId(),
      productId: prod2Rs._id,
      variantId: prod2Rs.variants[2]._id,
      productName: "4 pocket Coti L",
      productImage: "https://example.com/2l.jpg",
      selectedSize: "L",
      selectedColor: "GREEN",
      quantity: 1,
      unitPrice: 2,
      lineTotal: 2,
      cancelledQuantity: 0,
    };
    const item5S = {
      _id: new mongoose.Types.ObjectId(),
      productId: prod5Rs._id,
      variantId: prod5Rs.variants[0]._id,
      productName: "4 pocket Coti 5S",
      productImage: "https://example.com/5s.jpg",
      selectedSize: "S",
      selectedColor: "BEIGE",
      quantity: 1,
      unitPrice: 5,
      lineTotal: 5,
      cancelledQuantity: 0,
    };

    const order16 = await Order.create({
      orderNumber: `ORD-AUDIT-${testSuffix}-16`,
      userId: customer._id,
      items: [item2S, item2M, item2L, item5S],
      shippingAddress: order10.shippingAddress,
      subtotal: 11,
      discount: 0,
      shipping: 0,
      tax: 0,
      total: 11,
      initialSubtotal: 11,
      initialDiscount: 0,
      initialShipping: 0,
      initialTotal: 11,
      freeShippingThresholdSnapshot: 7,
      shippingFeeSnapshot: 40,
      qualifiedForFreeShipping: true,
      freeShippingReason: "THRESHOLD",
      currency: "INR",
      status: "CONFIRMED",
      paymentStatus: "PAID",
      paymentMethod: "RAZORPAY",
      cancellationVersion: 0,
      cancellationOperations: [],
    });

    const payment16 = await Payment.create({
      orderId: order16._id,
      userId: customer._id,
      amount: 11,
      currency: "INR",
      status: "CAPTURED",
      provider: "RAZORPAY",
      razorpayPaymentId: `pay_mock_16_${Date.now()}`,
      refundedAmount: 0,
      pendingRefundAmount: 0,
      refundReservations: [],
    });
    await PaymentAttempt.create({
      paymentId: payment16._id,
      orderId: order16._id,
      razorpayOrderId: `order_audit_16_${Date.now()}`,
      razorpayPaymentId: payment16.razorpayPaymentId,
      amount: 11,
      currency: "INR",
      status: "CAPTURED",
    });

    // Cancelling 3 items of ₹2 each leaves 1 item of ₹5 (< ₹7 threshold) -> BLOCKED
    const custCancel3ItemsRes = await request(
      serverUrl,
      "POST",
      `/api/orders/${order16._id}/cancel-items`,
      {
        items: [
          { itemId: item2S._id.toString(), quantity: 1 },
          { itemId: item2M._id.toString(), quantity: 1 },
          { itemId: item2L._id.toString(), quantity: 1 },
        ],
        reason: "Customer cancelling 3 items dropping below ₹7 threshold",
      },
      customerToken
    );
    check(custCancel3ItemsRes.status === 400, "Cancelling 3 items dropping subtotal from ₹11 to ₹5 is BLOCKED (HTTP 400)");
    check(
      custCancel3ItemsRes.body?.code === "PARTIAL_CANCELLATION_BELOW_THRESHOLD",
      "Error code is PARTIAL_CANCELLATION_BELOW_THRESHOLD"
    );

    console.log("\nAudit Scenario 17: Threshold Equality & Sequential Cancellations");
    // Cancelling exactly 2 items of ₹2 each leaves ₹7, which EQUALS the ₹7 threshold -> MUST SUCCEED
    const custCancel2ItemsRes = await request(
      serverUrl,
      "POST",
      `/api/orders/${order16._id}/cancel-items`,
      {
        items: [
          { itemId: item2S._id.toString(), quantity: 1 },
          { itemId: item2M._id.toString(), quantity: 1 },
        ],
        reason: "Customer cancelling 2 items meeting threshold equality",
      },
      customerToken
    );
    check(custCancel2ItemsRes.status === 200, "Cancelling 2 items leaving exactly ₹7 (threshold equality) SUCCEEDS (HTTP 200)");
    check(custCancel2ItemsRes.body?.data?.subtotal === 7, "Remaining subtotal is exactly ₹7");
    check(custCancel2ItemsRes.body?.data?.total === 7, "Remaining total is exactly ₹7");
    check(custCancel2ItemsRes.body?.data?.shipping === 0, "Remaining order retains Free Shipping (₹0)");
    check(custCancel2ItemsRes.body?.refund?.amount === 4, "Refund amount is exactly ₹4 for the 2 cancelled items");

    // Subsequent sequential cancellation: now attempt to cancel the remaining 1 item of ₹2 (would leave ₹5 < ₹7)
    const custSubsequentCancelRes = await request(
      serverUrl,
      "POST",
      `/api/orders/${order16._id}/cancel-items`,
      {
        items: [{ itemId: item2L._id.toString(), quantity: 1 }],
        reason: "Customer cancelling 3rd item dropping remaining below threshold",
      },
      customerToken
    );
    check(custSubsequentCancelRes.status === 400, "Subsequent cancellation dropping remaining from ₹7 to ₹5 is BLOCKED (HTTP 400)");

    console.log("\nAudit Scenario 18: Standalone freeDelivery Exemption & Paid Shipping Exemption");
    const prodFreeShipping = await Product.create({
      name: "Exempt Free Delivery Product",
      slug: `exempt-prod-${testSuffix}`,
      description: "Testing freeDelivery flag exemption",
      categoryId: TEST_CATEGORY_ID,
      basePrice: 3,
      freeDelivery: true,
      variants: [{ _id: new mongoose.Types.ObjectId(), sku: `SKU-EX-${testSuffix}`, size: "M", color: "BLUE", stock: 10 }],
    });
    const itemFree = {
      _id: new mongoose.Types.ObjectId(),
      productId: prodFreeShipping._id,
      variantId: prodFreeShipping.variants[0]._id,
      productName: "Exempt Product",
      productImage: "https://example.com/ex.jpg",
      selectedSize: "M",
      selectedColor: "BLUE",
      quantity: 1,
      unitPrice: 3,
      lineTotal: 3,
      cancelledQuantity: 0,
    };
    const itemNonFree = {
      _id: new mongoose.Types.ObjectId(),
      productId: prod2Rs._id,
      variantId: prod2Rs.variants[0]._id,
      productName: "Non-Free Product",
      productImage: "https://example.com/nonfree.jpg",
      selectedSize: "S",
      selectedColor: "GREEN",
      quantity: 1,
      unitPrice: 2,
      lineTotal: 2,
      cancelledQuantity: 0,
    };

    const order18 = await Order.create({
      orderNumber: `ORD-AUDIT-${testSuffix}-18`,
      userId: customer._id,
      items: [itemFree, itemNonFree],
      shippingAddress: order10.shippingAddress,
      subtotal: 5,
      discount: 0,
      shipping: 0,
      tax: 0,
      total: 5,
      initialSubtotal: 5,
      initialDiscount: 0,
      initialShipping: 0,
      initialTotal: 5,
      freeShippingThresholdSnapshot: 7,
      qualifiedForFreeShipping: true,
      freeShippingReason: "ALL_ITEMS_FREE",
      currency: "INR",
      status: "CONFIRMED",
      paymentStatus: "PAID",
      paymentMethod: "RAZORPAY",
      cancellationVersion: 0,
      cancellationOperations: [],
    });

    const payment18 = await Payment.create({
      orderId: order18._id,
      userId: customer._id,
      amount: 5,
      currency: "INR",
      status: "CAPTURED",
      provider: "RAZORPAY",
      razorpayPaymentId: `pay_mock_18_${Date.now()}`,
      refundedAmount: 0,
      pendingRefundAmount: 0,
      refundReservations: [],
    });
    await PaymentAttempt.create({
      paymentId: payment18._id,
      orderId: order18._id,
      razorpayOrderId: `order_audit_18_${Date.now()}`,
      razorpayPaymentId: payment18.razorpayPaymentId,
      amount: 5,
      currency: "INR",
      status: "CAPTURED",
    });

    // Cancelling non-free item leaves the freeDelivery product -> SUCCEEDS even though ₹3 < ₹7 threshold
    const custFreeExemptRes = await request(
      serverUrl,
      "POST",
      `/api/orders/${order18._id}/cancel-items`,
      {
        items: [{ itemId: itemNonFree._id.toString(), quantity: 1 }],
        reason: "Cancelling non-free item",
      },
      customerToken
    );
    check(custFreeExemptRes.status === 200, "Cancelling item leaving standalone freeDelivery product SUCCEEDS (HTTP 200)");

    // Paid Shipping Exemption: Customer initially paid shipping fee (initialShipping = 40)
    const orderPaidShipping = await Order.create({
      orderNumber: `ORD-AUDIT-${testSuffix}-18B`,
      userId: customer._id,
      items: [itemNonFree],
      shippingAddress: order10.shippingAddress,
      subtotal: 4,
      discount: 0,
      shipping: 40,
      tax: 0,
      total: 44,
      initialSubtotal: 4,
      initialDiscount: 0,
      initialShipping: 40,
      initialTotal: 44,
      freeShippingThresholdSnapshot: 7,
      qualifiedForFreeShipping: false,
      freeShippingReason: "NONE",
      currency: "INR",
      status: "CONFIRMED",
      paymentStatus: "PAID",
      paymentMethod: "RAZORPAY",
      cancellationVersion: 0,
      cancellationOperations: [],
    });
    const paymentPaidShipping = await Payment.create({
      orderId: orderPaidShipping._id,
      userId: customer._id,
      amount: 44,
      currency: "INR",
      status: "CAPTURED",
      provider: "RAZORPAY",
      razorpayPaymentId: `pay_mock_paidship_${Date.now()}`,
      refundedAmount: 0,
      pendingRefundAmount: 0,
      refundReservations: [],
    });
    await PaymentAttempt.create({
      paymentId: paymentPaidShipping._id,
      orderId: orderPaidShipping._id,
      razorpayOrderId: `order_audit_paidship_${Date.now()}`,
      razorpayPaymentId: paymentPaidShipping.razorpayPaymentId,
      amount: 44,
      currency: "INR",
      status: "CAPTURED",
    });
    const paidShippingCancelRes = await cancelOrderItemsWithRefund({
      orderId: orderPaidShipping._id.toString(),
      items: [{ itemId: itemNonFree._id.toString(), quantity: 1 }],
      source: "CUSTOMER",
      reason: "Cancelling item on paid shipping order",
    });
    check(paidShippingCancelRes.order.status === "CANCELLED", "Paid shipping order item cancellation succeeds without threshold block");

    console.log("\nAudit Scenario 19: System-Initiated Cancellations and Returns are Never Blocked");
    const systemCancelRes = await cancelOrderItemsWithRefund({
      orderId: order16._id.toString(),
      items: [{ itemId: item2L._id.toString(), quantity: 1 }],
      source: "SYSTEM",
      reason: "Automated warehouse inventory stockout cancellation",
    });
    check(Boolean(systemCancelRes.order), "System-initiated cancellation succeeds even below threshold");
    check(systemCancelRes.order.subtotal === 5, "Subtotal after system cancellation is ₹5");

    // Return request workflow: Order with ₹9 subtotal (above ₹7 threshold) delivered to customer
    const orderReturnTest = await Order.create({
      orderNumber: `ORD-AUDIT-${testSuffix}-RET`,
      userId: customer._id,
      items: [item2S, item2M, item5S],
      shippingAddress: order10.shippingAddress,
      subtotal: 9,
      discount: 0,
      shipping: 0,
      tax: 0,
      total: 9,
      initialSubtotal: 9,
      initialDiscount: 0,
      initialShipping: 0,
      initialTotal: 9,
      freeShippingThresholdSnapshot: 7,
      qualifiedForFreeShipping: true,
      freeShippingReason: "THRESHOLD",
      currency: "INR",
      status: "DELIVERED",
      paymentStatus: "PAID",
      paymentMethod: "RAZORPAY",
      deliveredAt: new Date(),
    });
    const paymentReturn = await Payment.create({
      orderId: orderReturnTest._id,
      userId: customer._id,
      amount: 9,
      currency: "INR",
      status: "CAPTURED",
      provider: "RAZORPAY",
      razorpayPaymentId: `pay_mock_ret_${Date.now()}`,
      refundedAmount: 0,
      pendingRefundAmount: 0,
      refundReservations: [],
    });
    await PaymentAttempt.create({
      paymentId: paymentReturn._id,
      orderId: orderReturnTest._id,
      razorpayOrderId: `order_audit_ret_${Date.now()}`,
      razorpayPaymentId: paymentReturn.razorpayPaymentId,
      amount: 9,
      currency: "INR",
      status: "CAPTURED",
    });

    // Customer returns item5S (₹5), which leaves ₹4 (< ₹7 threshold)
    const returnReq = await new ReturnRequest({
      orderId: orderReturnTest._id,
      userId: customer._id,
      items: [{ productId: item5S.productId, variantId: item5S.variantId, quantity: 1, reason: "DEFECTIVE" }],
      status: "INSPECTING",
    }).save();

    const mockAcceptReq: any = {
      params: { id: returnReq._id.toString() },
      body: { adminNote: "Inspected and accepted" },
      user: { id: admin._id.toString(), role: "ADMIN" },
    };
    const mockAcceptRes: any = {
      statusCode: 200,
      status(code: number) { this.statusCode = code; return this; },
      json(data: any) { this.data = data; return this; },
    };

    await acceptReturn(mockAcceptReq, mockAcceptRes, () => {});
    check(mockAcceptRes.statusCode === 200, "Legitimate return acceptance succeeds even when retained order < threshold");
    const updatedRet = await ReturnRequest.findById(returnReq._id);
    check(updatedRet?.status === "ACCEPTED" || updatedRet?.status === "COMPLETED", "ReturnRequest status transitioned to ACCEPTED or COMPLETED");
    check(Boolean(updatedRet?.refundId), "Return refund was initiated successfully");

    console.log("\nAudit Scenario 20: Concurrency & Optimistic Lock Protection");
    // Dispatch two concurrent cancellations for the same item5S
    const [concurrent1, concurrent2] = await Promise.all([
      request(
        serverUrl,
        "POST",
        `/api/orders/${order16._id}/cancel-items`,
        { items: [{ itemId: item5S._id.toString(), quantity: 1 }] },
        customerToken
      ),
      request(
        serverUrl,
        "POST",
        `/api/orders/${order16._id}/cancel-items`,
        { items: [{ itemId: item5S._id.toString(), quantity: 1 }] },
        customerToken
      ),
    ]);
    const statuses = [concurrent1.status, concurrent2.status];
    check(
      (statuses.includes(200) && (statuses.includes(400) || statuses.includes(409))),
      `Concurrent cancellation requests safely serialized (statuses: ${statuses.join(", ")})`
    );

    // Restore store settings to standard defaults for subsequent suites
    await saveStoreSettings({ freeShippingThreshold: 999, standardShippingFee: 100 });

  } finally {
    server.close();
    await mongoose.disconnect();
  }

  console.log(`\nAudit Test Suite Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

runProductionReadinessAuditTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
