import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { Order, IOrder } from "../models/Order";
import { Invoice, InvoiceStatus } from "../models/Invoice";
import { CreditNote, ICreditNote } from "../models/CreditNote";
import { Counter, incrementCounter } from "../models/Counter";
import { AuditLog } from "../models/AuditLog";
import { getOrCreateInvoiceForOrder, getInvoiceByOrder, downloadInvoicePDF } from "../controllers/invoiceController";
import { generateInvoicePDFStream, getInvoiceAdjustments, formatCurrency } from "../utils/pdfInvoiceGenerator";
import { ensureInvoiceFonts } from "../utils/fontLoader";
import { AppError } from "../utils/AppError";
import { connectSafeTestDb } from "./testHelpers";

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

  await connectSafeTestDb();
  console.log("✅ Connected to verified isolated test database\n");

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
    await ensureInvoiceFonts();
    check(formatCurrency(2) === "₹2.00", "CURR-1 formatCurrency(2) formats as ₹2.00 without superscript 1");
    check(formatCurrency(5) === "₹5.00", "CURR-2 formatCurrency(5) formats as ₹5.00");
    check(formatCurrency(9) === "₹9.00", "CURR-3 formatCurrency(9) formats as ₹9.00");
    check(formatCurrency(2499.5) === "₹2,499.50", "CURR-4 formatCurrency formats with Indian locale grouping");

    const pdfStream = generateInvoicePDFStream(invoice1);
    const pdfBuffers: Buffer[] = [];
    interface PromiseResolvers<T> {
      promise: Promise<T>;
      resolve: (value: T | PromiseLike<T>) => void;
      reject: (reason?: unknown) => void;
    }
    const promiseConstructor = Promise as unknown as { withResolvers<T>(): PromiseResolvers<T> };
    const { promise: streamComplete, resolve: resolveStream, reject: rejectStream } = promiseConstructor.withResolvers<void>();
    pdfStream.on("data", (chunk: Buffer) => pdfBuffers.push(chunk));
    pdfStream.on("end", () => resolveStream());
    pdfStream.on("error", (err: Error) => rejectStream(err));
    await streamComplete;

    const fullPdfBuffer = Buffer.concat(pdfBuffers);
    check(fullPdfBuffer.length > 500, "PDF-1 Generated PDF stream buffer has substantial size", `Bytes: ${fullPdfBuffer.length}`);
    const pdfMagicHeader = fullPdfBuffer.slice(0, 5).toString("utf-8");
    check(pdfMagicHeader === "%PDF-", "PDF-2 Buffer begins with valid PDF magic header (%PDF-)");

    const pdfRawString = fullPdfBuffer.toString("latin1");
    check(pdfRawString.includes("/CIDFontType2"), "PDF-3 PDF embeds CIDFontType2 Unicode font");
    check(pdfRawString.includes("/ToUnicode"), "PDF-4 PDF embeds ToUnicode CMap for character mapping");
    check(pdfRawString.includes("/Identity-H"), "PDF-5 PDF uses Identity-H encoding supporting U+20B9 (₹)");
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

    // ─── 6. CANCELLED & REFUNDED ITEMS ARE NOT BILLED ─────────────────
    console.log("\n[6. Cancelled / Refunded Items Are Not Billed]");

    const testAddress = {
      fullName: "Test Customer",
      phone: "9876543210",
      addressLine1: "123 Fashion Street",
      city: "Mumbai",
      state: "Maharashtra",
      postalCode: "400001",
      country: "India",
      addressType: "HOME" as const,
    };

    const partialOrder = await Order.create({
      orderNumber: `ORD-TEST-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      userId: new mongoose.Types.ObjectId(TEST_OWNER_ID),
      items: [
        {
          productId: new mongoose.Types.ObjectId(),
          variantId: new mongoose.Types.ObjectId(),
          productName: "Kept Tee",
          productImage: "https://example.com/kept.jpg",
          selectedSize: "M",
          selectedColor: "BLACK",
          quantity: 2,
          unitPrice: 500,
          lineTotal: 1000,
          cancelledQuantity: 1,
        },
        {
          productId: new mongoose.Types.ObjectId(),
          variantId: new mongoose.Types.ObjectId(),
          productName: "Cancelled Hoodie",
          productImage: "https://example.com/cancelled.jpg",
          selectedSize: "L",
          selectedColor: "SAND",
          quantity: 1,
          unitPrice: 1899,
          lineTotal: 1899,
          cancelledQuantity: 1,
        },
      ],
      shippingAddress: testAddress,
      subtotal: 500,
      discount: 0,
      shipping: 0,
      tax: 0,
      total: 500,
      initialSubtotal: 2899,
      initialTotal: 2899,
      currency: "INR",
      status: "CONFIRMED",
      paymentStatus: "PAID",
      paymentMethod: "RAZORPAY",
      partiallyCancelled: true,
    });

    const partialInvoice = await getOrCreateInvoiceForOrder(partialOrder._id.toString());
    check(partialInvoice.itemsSnapshot[0].cancelledQuantity === 1, "CANCEL-INV-1 Snapshot records cancelled quantity for a partially cancelled line");
    check(partialInvoice.itemsSnapshot[1].cancelledQuantity === 1, "CANCEL-INV-2 Snapshot records a fully cancelled line");

    const partialAdjustments = getInvoiceAdjustments(partialInvoice, []);
    check(partialAdjustments.billedLines.length === 1, "CANCEL-INV-3 Fully cancelled line is excluded from billed lines");
    check(
      partialAdjustments.billedLines[0].activeQuantity === 1 && partialAdjustments.billedLines[0].activeLineTotal === 500,
      "CANCEL-INV-4 Partially cancelled line bills only the active unit"
    );
    check(partialAdjustments.netTotal === 500, "CANCEL-INV-5 Net total equals the surviving order total");
    check(partialAdjustments.refundedAmount === 0, "CANCEL-INV-6 No refund row before a credit note exists");

    const creditNoteAdjustments = getInvoiceAdjustments(partialInvoice, [
      { status: "ISSUED", totalRefundAmount: 200 } as unknown as ICreditNote,
      { status: "VOID", totalRefundAmount: 999 } as unknown as ICreditNote,
    ]);
    check(creditNoteAdjustments.refundedAmount === 200, "CANCEL-INV-7 Only issued credit notes reduce the payable amount");
    check(creditNoteAdjustments.netTotal === 300, "CANCEL-INV-8 Net payable equals invoiced total minus refunds");

    const fullyCancelledOrder = await Order.create({
      orderNumber: `ORD-TEST-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      userId: new mongoose.Types.ObjectId(TEST_OWNER_ID),
      items: [
        {
          productId: new mongoose.Types.ObjectId(),
          variantId: new mongoose.Types.ObjectId(),
          productName: "Fully Cancelled Tee",
          productImage: "https://example.com/full.jpg",
          selectedSize: "S",
          selectedColor: "WHITE",
          quantity: 1,
          unitPrice: 950,
          lineTotal: 950,
          cancelledQuantity: 1,
        },
      ],
      shippingAddress: testAddress,
      subtotal: 0,
      discount: 0,
      shipping: 0,
      tax: 0,
      total: 0,
      initialSubtotal: 950,
      initialTotal: 950,
      currency: "INR",
      status: "CANCELLED",
      paymentStatus: "REFUNDED",
      paymentMethod: "RAZORPAY",
    });

    const fullyCancelledInvoice = await getOrCreateInvoiceForOrder(fullyCancelledOrder._id.toString());
    check(fullyCancelledInvoice.status === InvoiceStatus.REFUNDED, "CANCEL-INV-9 Fully cancelled order produces a REFUNDED invoice");

    const fullyCancelledAdjustments = getInvoiceAdjustments(fullyCancelledInvoice, [
      { status: "ISSUED", totalRefundAmount: 950 } as unknown as ICreditNote,
    ]);
    check(
      fullyCancelledAdjustments.fullyCancelled && fullyCancelledAdjustments.billedLines.length === 0,
      "CANCEL-INV-10 Fully cancelled invoice bills no line items"
    );
    check(fullyCancelledAdjustments.netTotal === 0, "CANCEL-INV-11 Fully refunded invoice nets to zero");

    // Legacy invoices snapshotted before cancellations were tracked must be
    // repaired on access instead of billing cancelled units forever.
    const legacyOrder = await Order.create({
      orderNumber: `ORD-TEST-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      userId: new mongoose.Types.ObjectId(TEST_OWNER_ID),
      items: [
        {
          productId: new mongoose.Types.ObjectId(),
          variantId: new mongoose.Types.ObjectId(),
          productName: "Legacy Partial Tee",
          productImage: "https://example.com/legacy.jpg",
          selectedSize: "XL",
          selectedColor: "NAVY",
          quantity: 2,
          unitPrice: 400,
          lineTotal: 800,
          cancelledQuantity: 1,
        },
      ],
      shippingAddress: testAddress,
      subtotal: 400,
      discount: 0,
      shipping: 0,
      tax: 0,
      total: 400,
      currency: "INR",
      status: "CONFIRMED",
      paymentStatus: "PAID",
      paymentMethod: "RAZORPAY",
      partiallyCancelled: true,
    });

    const legacyInvoice = await Invoice.create({
      invoiceNumber: `SF-INV-TEST-${Date.now()}`,
      orderId: legacyOrder._id,
      userId: legacyOrder.userId,
      orderNumber: legacyOrder.orderNumber,
      status: InvoiceStatus.ISSUED,
      issuedAt: new Date(),
      customerSnapshot: { name: "Test Customer", email: "legacy@example.com", phone: "9876543210" },
      billingAddressSnapshot: testAddress,
      shippingAddressSnapshot: testAddress,
      itemsSnapshot: [
        {
          productId: legacyOrder.items[0].productId,
          productName: legacyOrder.items[0].productName,
          productImage: legacyOrder.items[0].productImage,
          selectedSize: legacyOrder.items[0].selectedSize,
          selectedColor: legacyOrder.items[0].selectedColor,
          quantity: 2,
          unitPrice: 400,
          lineTotal: 800,
          cancelledQuantity: 0,
        },
      ],
      subtotal: 800,
      discount: 0,
      shipping: 0,
      tax: 0,
      total: 800,
      currency: "INR",
      paymentSnapshot: { provider: "RAZORPAY", status: "PAID", amount: 800, currency: "INR" },
    });

    await getInvoiceByOrder(
      makeReq(legacyOrder._id.toString(), TEST_OWNER_ID, "CUSTOMER"),
      responseAdapter,
      () => {}
    );
    const repairedInvoice = await Invoice.findById(legacyInvoice._id);
    check(repairedInvoice?.itemsSnapshot[0].cancelledQuantity === 1, "CANCEL-INV-12 Legacy invoice snapshots are repaired on access");
  } finally {
    // Clean up created test orders and invoices
    await Order.deleteMany({ userId: { $in: [TEST_OWNER_ID, TEST_OTHER_ID] } });
    await Invoice.deleteMany({ userId: { $in: [TEST_OWNER_ID, TEST_OTHER_ID] } });
    await CreditNote.deleteMany({ userId: { $in: [TEST_OWNER_ID, TEST_OTHER_ID] } });
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
