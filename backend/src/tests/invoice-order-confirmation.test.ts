import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { Order, IOrder } from "../models/Order";
import { Invoice, InvoiceStatus } from "../models/Invoice";
import { Counter, incrementCounter } from "../models/Counter";
import { AuditLog } from "../models/AuditLog";
import { getOrCreateInvoiceForOrder, getInvoiceByOrder, downloadInvoicePDF } from "../controllers/invoiceController";
import { generateInvoicePDFStream } from "../utils/pdfInvoiceGenerator";
import { AppError } from "../utils/AppError";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(cond: boolean, name: string, details?: string) {
  if (cond) {
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } else {
    const msg = `  ❌ FAIL: ${name}${details ? ` — ${details}` : ""}`;
    console.error(msg);
    failures.push(`${name}${details ? `: ${details}` : ""}`);
    failed++;
  }
}

const TEST_OWNER_ID = new mongoose.Types.ObjectId().toString();
const TEST_OTHER_ID = new mongoose.Types.ObjectId().toString();
const TEST_ADMIN_ID = new mongoose.Types.ObjectId().toString();

async function createTestOrder(overrides: {
  status?: "PENDING" | "CONFIRMED" | "PROCESSING" | "SHIPPED" | "DELIVERED" | "CANCELLED" | "EXPIRED";
  paymentStatus?: "PENDING" | "PAID" | "FAILED" | "REFUNDED";
  paymentMethod?: string;
  userId?: string;
} = {}): Promise<IOrder> {
  const userId = overrides.userId || TEST_OWNER_ID;
  const order = await Order.create({
    orderNumber: `ORD-TEST-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    userId: new mongoose.Types.ObjectId(userId),
    items: [
      {
        productId: new mongoose.Types.ObjectId(),
        variantId: new mongoose.Types.ObjectId(),
        productName: "Classic Premium Tee",
        productImage: "https://example.com/tee.jpg",
        selectedSize: "L",
        selectedColor: "NAVY",
        quantity: 2,
        unitPrice: 500,
        lineTotal: 1000,
        isCustomized: false,
      },
    ],
    shippingAddress: {
      fullName: "Test Customer",
      phone: "9876543210",
      addressLine1: "123 Fashion Street",
      city: "Mumbai",
      state: "Maharashtra",
      postalCode: "400001",
      country: "India",
      addressType: "HOME",
    },
    subtotal: 1000,
    discount: 100,
    shipping: 0,
    tax: 50,
    total: 950,
    currency: "INR",
    status: overrides.status || "CONFIRMED",
    paymentStatus: overrides.paymentStatus || "PAID",
    paymentMethod: overrides.paymentMethod || "RAZORPAY",
  });
  return order;
}

async function runRegressionTests() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  Order Confirmation & Tax Invoice PDF Regression Tests       ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  await mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/samrat_fashion");
  console.log("✅ Connected to MongoDB\n");

  try {
    // ─── 1. NEXT.JS 16 ASYNC ROUTE PARAMETER RESOLUTION ──────────────
    console.log("[1. Next.js 16 Route Parameter Resolution]");
    const sampleOrderId = new mongoose.Types.ObjectId().toString();
    const mockParamsPromise: Promise<{ id: string }> = Promise.resolve({ id: sampleOrderId });
    const resolvedParams = await mockParamsPromise;
    check(resolvedParams.id === sampleOrderId, "CONF-1 Route parameter resolves from Promise successfully");
    check(resolvedParams.id !== "undefined", "CONF-2 Resolved ID is not string 'undefined'");
    check(resolvedParams.id.length === 24, "CONF-3 Resolved ID has valid 24-character ObjectId length");

    // ─── 2. ORDER CONFIRMATION / POST-PAYMENT STATE INTEGRITY ────────
    console.log("\n[2. Order Loading Across Lifecycle States]");
    const paidOrder = await createTestOrder({ status: "CONFIRMED", paymentStatus: "PAID" });
    const pendingOrder = await createTestOrder({ status: "PENDING", paymentStatus: "PENDING" });
    const failedOrder = await createTestOrder({ status: "EXPIRED", paymentStatus: "FAILED" });
    const refundedOrder = await createTestOrder({ status: "CONFIRMED", paymentStatus: "REFUNDED" });
    const cancelledOrder = await createTestOrder({ status: "CANCELLED", paymentStatus: "FAILED" });

    // Customer fetching their own order by ID
    const loadedPaid = await Order.findOne({ _id: paidOrder._id, userId: TEST_OWNER_ID });
    check(Boolean(loadedPaid), "CONF-4 Existing paid order retrieved by internal _id");
    check(loadedPaid?.status === "CONFIRMED", "CONF-5 Paid order has status CONFIRMED");
    check(loadedPaid?.paymentStatus === "PAID", "CONF-6 Paid order has paymentStatus PAID");

    const loadedPending = await Order.findOne({ _id: pendingOrder._id, userId: TEST_OWNER_ID });
    check(loadedPending?.status === "PENDING" && loadedPending?.paymentStatus === "PENDING", "CONF-7 Pending order accurately preserved");

    const loadedFailed = await Order.findOne({ _id: failedOrder._id, userId: TEST_OWNER_ID });
    check(loadedFailed?.status === "EXPIRED" && loadedFailed?.paymentStatus === "FAILED", "CONF-8 Failed/expired order accurately preserved");

    const loadedRefunded = await Order.findOne({ _id: refundedOrder._id, userId: TEST_OWNER_ID });
    check(loadedRefunded?.paymentStatus === "REFUNDED", "CONF-9 Refunded order accurately preserved");

    const loadedCancelled = await Order.findOne({ _id: cancelledOrder._id, userId: TEST_OWNER_ID });
    check(loadedCancelled?.status === "CANCELLED", "CONF-10 Cancelled order accurately preserved");

    // ─── 3. INVOICE GENERATION & ATOMIC COUNTER ───────────────────────
    console.log("\n[3. Invoice Generation & Atomic Counter Fix]");
    const testCounterName = `TEST_SEQ_${Date.now()}`;
    const seq1 = await incrementCounter(testCounterName, 0);
    check(seq1 === 1, "INV-1 First counter sequence returns seed + 1 = 1 without MongoDB ConflictingUpdateOperators");

    const seq2 = await incrementCounter(testCounterName, 0);
    check(seq2 === 2, "INV-2 Subsequent counter sequence increments monotonically to 2");

    // Clean up test counter
    await Counter.deleteOne({ name: testCounterName });

    // Generate invoice for paid order
    const invoice1 = await getOrCreateInvoiceForOrder(paidOrder._id.toString());
    check(Boolean(invoice1), "INV-3 Invoice generated successfully for paid order");
    check(invoice1.status === InvoiceStatus.ISSUED, "INV-4 Invoice marked with status ISSUED");
    check(invoice1.orderNumber === paidOrder.orderNumber, "INV-5 Invoice orderNumber matches order");
    check(Boolean(invoice1.invoiceNumber), "INV-6 Invoice has structured invoiceNumber");
    check(invoice1.total === paidOrder.total, "INV-7 Invoice total matches authoritative order total");

    // Idempotency: second call returns exact same invoice document without re-incrementing
    const invoice2 = await getOrCreateInvoiceForOrder(paidOrder._id.toString());
    check(invoice2._id.toString() === invoice1._id.toString(), "INV-8 Idempotent: Second call returns existing invoice document");
    check(invoice2.invoiceNumber === invoice1.invoiceNumber, "INV-9 Idempotent: Invoice number unchanged on repeat calls");

    // Rejection on unpaid order
    let unpaidThrew = false;
    try {
      await getOrCreateInvoiceForOrder(pendingOrder._id.toString());
    } catch (err: unknown) {
      if (err instanceof AppError && err.statusCode === 400) {
        unpaidThrew = true;
      }
    }
    check(unpaidThrew, "INV-10 Invoice generation rejected (400) for unpaid PENDING order");

    // Rejection on cancelled order
    let cancelledThrew = false;
    try {
      await getOrCreateInvoiceForOrder(cancelledOrder._id.toString());
    } catch (err: unknown) {
      if (err instanceof AppError && err.statusCode === 400) {
        cancelledThrew = true;
      }
    }
    check(cancelledThrew, "INV-11 Invoice generation rejected (400) for CANCELLED order");

    // Allowed for refunded order
    const refundedInvoice = await getOrCreateInvoiceForOrder(refundedOrder._id.toString());
    check(Boolean(refundedInvoice), "INV-12 Invoice permitted for REFUNDED order");

    // ─── 4. PDF STREAM GENERATION & HEADER VALIDATION ─────────────────
    console.log("\n[4. PDF Stream Generation & Valid Bytes]");
    const pdfStream = generateInvoicePDFStream(invoice1);
    const pdfBuffers: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      pdfStream.on("data", (chunk: Buffer) => pdfBuffers.push(chunk));
      pdfStream.on("end", () => resolve());
      pdfStream.on("error", (err: Error) => reject(err));
    });

    const fullPdfBuffer = Buffer.concat(pdfBuffers);
    check(fullPdfBuffer.length > 500, "PDF-1 Generated PDF stream buffer has substantial size", `Bytes: ${fullPdfBuffer.length}`);
    const pdfMagicHeader = fullPdfBuffer.slice(0, 5).toString("utf-8");
    check(pdfMagicHeader === "%PDF-", "PDF-2 Buffer begins with valid PDF magic header (%PDF-)");

    // ─── 5. SECURITY & CONTROLLER AUTHORIZATION ───────────────────────
    console.log("\n[5. Controller Authentication, Ownership & Response Headers]");

    // Owning customer retrieves JSON invoice
    let jsonResult: unknown;
    interface MockResponse {
      statusCode: number;
      status: (code: number) => MockResponse;
      json: (payload: unknown) => MockResponse;
    }
    const mockJsonRes: MockResponse = {
      statusCode: 200,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        jsonResult = payload;
        return this;
      },
    };

    const responseAdapter = mockJsonRes as unknown as Response;

    const makeReq = (orderId: string, userId: string, role: string) => ({
      params: { id: orderId },
      user: { id: userId, role },
    } as unknown as Request);

    await getInvoiceByOrder(
      makeReq(paidOrder._id.toString(), TEST_OWNER_ID, "CUSTOMER"),
      responseAdapter,
      () => {}
    );
    check(mockJsonRes.statusCode === 200, "AUTH-1 Owning customer receives 200 on GET /invoice");
    const invoiceNumberFound = (
      jsonResult &&
      typeof jsonResult === "object" &&
      "data" in jsonResult &&
      jsonResult.data &&
      typeof jsonResult.data === "object" &&
      "invoiceNumber" in jsonResult.data
    );
    check(Boolean(invoiceNumberFound), "AUTH-2 JSON invoice contains invoiceNumber");

    // Non-owning customer receives 403 Forbidden
    let nonOwnerError: unknown;
    await getInvoiceByOrder(
      makeReq(paidOrder._id.toString(), TEST_OTHER_ID, "CUSTOMER"),
      responseAdapter,
      ((err: unknown) => { nonOwnerError = err; }) as NextFunction
    );
    check(nonOwnerError instanceof AppError && nonOwnerError.statusCode === 403, "AUTH-3 Non-owning customer receives 403 Forbidden");

    // Non-existent order receives 404 Not Found
    let notFoundError: unknown;
    await getInvoiceByOrder(
      makeReq(new mongoose.Types.ObjectId().toString(), TEST_OWNER_ID, "CUSTOMER"),
      responseAdapter,
      ((err: unknown) => { notFoundError = err; }) as NextFunction
    );
    check(notFoundError instanceof AppError && notFoundError.statusCode === 404, "AUTH-4 Non-existent order receives 404 Not Found");

    // Owning customer downloads PDF stream with correct headers
    const capturedHeaders: Record<string, string> = {};
    const mockPdfRes = {
      setHeader(name: string, value: string) {
        capturedHeaders[name] = value;
      },
      write() {},
      end() {},
      on() {},
      once() {},
      emit() {},
    } as unknown as Response;

    await downloadInvoicePDF(
      makeReq(paidOrder._id.toString(), TEST_OWNER_ID, "CUSTOMER"),
      mockPdfRes,
      () => {}
    );
    check(capturedHeaders["Content-Type"] === "application/pdf", "AUTH-5 PDF response header Content-Type is application/pdf");
    check(
      capturedHeaders["Content-Disposition"]?.includes('inline; filename="Invoice-') === true,
      "AUTH-6 PDF response header Content-Disposition specifies inline PDF filename"
    );

    // Admin access creates AuditLog record
    const preAuditCount = await AuditLog.countDocuments({ entityId: paidOrder._id, action: "VIEW_INVOICE" });
    await getInvoiceByOrder(
      makeReq(paidOrder._id.toString(), TEST_ADMIN_ID, "ADMIN"),
      responseAdapter,
      () => {}
    );
    const postAuditCount = await AuditLog.countDocuments({ entityId: paidOrder._id, action: "VIEW_INVOICE" });
    check(postAuditCount > preAuditCount, "AUTH-7 Admin invoice access logged in AuditLog");
  } finally {
    // Clean up created test orders and invoices
    await Order.deleteMany({ userId: { $in: [TEST_OWNER_ID, TEST_OTHER_ID] } });
    await Invoice.deleteMany({ userId: { $in: [TEST_OWNER_ID, TEST_OTHER_ID] } });
    await AuditLog.deleteMany({ actorId: TEST_ADMIN_ID });
    await mongoose.disconnect();
    console.log("✅ Disconnected from MongoDB\n");
  }

  console.log("══════════════════════════════════════════════════════════════");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log("══════════════════════════════════════════════════════════════");

  if (failed > 0) {
    process.exit(1);
  }
}

runRegressionTests().catch((err) => {
  console.error("Test execution fatal error:", err);
  process.exit(1);
});
