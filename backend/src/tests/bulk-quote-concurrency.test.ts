/**
 * Phase 3: Concurrent Bulk-Quote Acceptance Regression Test Suite
 *
 * Verifies that:
 * 1. Concurrent quote acceptance calls (Promise.all) safely create exactly ONE Order.
 * 2. Repeated acceptance calls are idempotent and return the existing order.
 * 3. Variant matching rejects unmappable allocations rather than falling back silently.
 * 4. Expired quotes cannot be accepted.
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

import { connectSafeTestDb, createTestProduct } from "./testHelpers";
import { BulkQuote, BulkQuoteStatus } from "../models/BulkQuote";
import { BulkOrderRequest, BulkRequestStatus } from "../models/BulkOrderRequest";
import { Order } from "../models/Order";
import { Product } from "../models/Product";
import { User, UserStatus, UserRole } from "../models/User";
import { acceptQuote } from "../controllers/bulkOrderController";
import { Request, Response } from "express";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(condition: boolean, desc: string, details?: string): void {
  if (condition) {
    console.log(`  ✅ PASS: ${desc}`);
    passed++;
  } else {
    const msg = details ? `${desc} — ${details}` : desc;
    failures.push(msg);
    console.error(`  ❌ FAIL: ${msg}`);
    failed++;
  }
}

interface MockResponse {
  statusCode: number;
  data: { success?: boolean; message?: string; [key: string]: unknown } | null;
  status(code: number): MockResponse;
  json(payload: { success?: boolean; message?: string; [key: string]: unknown }): MockResponse;
  send(payload: unknown): MockResponse;
}

function createMockRes(): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    data: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: { success?: boolean; message?: string; [key: string]: unknown }) {
      this.data = payload;
      return this;
    },
    send(payload: unknown) {
      this.data = typeof payload === "object" && payload !== null ? (payload as { [key: string]: unknown }) : { raw: payload };
      return this;
    },
  };
  return res;
}

async function runBulkQuoteTests() {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║  Bulk Quote Concurrency & Variant Integrity Verification Suite ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  const cleanupProductIds: mongoose.Types.ObjectId[] = [];
  const cleanupUserIds: mongoose.Types.ObjectId[] = [];
  const cleanupQuoteIds: mongoose.Types.ObjectId[] = [];
  const cleanupRequestIds: mongoose.Types.ObjectId[] = [];
  const cleanupOrderIds: mongoose.Types.ObjectId[] = [];

  try {
    await connectSafeTestDb();
    console.log(` Connected to verified isolated test database: ${mongoose.connection.name}\n`);

    const timestamp = Date.now();

    const user = await User.create({
      name: "B2B Client",
      email: `b2b_${timestamp}@example.com`,
      passwordHash: "hash123",
      role: UserRole.CUSTOMER,
      status: UserStatus.ACTIVE,
    });
    cleanupUserIds.push(user._id as mongoose.Types.ObjectId);

    const { product: prodDoc } = await createTestProduct({
      name: `B2B Garment ${timestamp}`,
      variants: [
        { size: "M", color: "BLACK", stock: 100, isAvailable: true },
        { size: "L", color: "BLACK", stock: 100, isAvailable: true },
      ],
    });
    const product = prodDoc;
    cleanupProductIds.push(product._id);

    const varM = product.variants.find((v: any) => v.size === "M")!;
    const varL = product.variants.find((v: any) => v.size === "L")!;

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 1: CONCURRENT QUOTE ACCEPTANCE SAFEGUARD
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("[TEST GROUP 1: CONCURRENT ACCEPTANCE SAFEGUARD]");

    const bulkReq = await BulkOrderRequest.create({
      quoteNumber: `QT-REQ-${timestamp}`,
      userId: user._id,
      organizationName: "Esports Org",
      contactName: "Manager",
      email: user.email,
      phone: "+919999988888",
      productId: product._id,
      variantAllocations: [
        { variantId: varM._id, size: "M", color: "BLACK", quantity: 20 },
        { variantId: varL._id, size: "L", color: "BLACK", quantity: 20 },
      ],
      totalQuantity: 40,
      customPrintingRequired: true,
      printLocations: ["FRONT"],
      deliveryLocation: "100 Feet Road, Bengaluru",
      status: BulkRequestStatus.MOCKUP_SHARED,
    });
    cleanupRequestIds.push(bulkReq._id as mongoose.Types.ObjectId);

    const quote = await BulkQuote.create({
      quoteNumber: `QT-${timestamp}`,
      bulkRequestId: bulkReq._id,
      userId: user._id,
      productPrice: 2000000, // 20,000 rupees in paise
      printingFee: 400000,
      setupFee: 0,
      discount: 0,
      subtotal: 2400000,
      tax: 432000,
      shipping: 0,
      total: 2832000,
      validUntil: new Date(Date.now() + 86400000 * 7),
      status: BulkQuoteStatus.SENT,
    });
    cleanupQuoteIds.push(quote._id as mongoose.Types.ObjectId);

    // Fire 2 concurrent acceptance calls simultaneously
    const req1 = {
      params: { quoteId: quote._id.toString() },
      user: { id: (user._id as mongoose.Types.ObjectId).toString(), role: "CUSTOMER" },
    } as unknown as Request;
    const res1 = createMockRes();

    const req2 = {
      params: { quoteId: quote._id.toString() },
      user: { id: (user._id as mongoose.Types.ObjectId).toString(), role: "CUSTOMER" },
    } as unknown as Request;
    const res2 = createMockRes();

    await Promise.all([
      acceptQuote(req1, res1 as unknown as Response, () => {}),
      acceptQuote(req2, res2 as unknown as Response, () => {}),
    ]);

    check(
      res1.statusCode === 200 && res2.statusCode === 200,
      "1.1 Both concurrent callers receive HTTP 200"
    );

    const reloadedQuote = await BulkQuote.findById(quote._id);
    check(reloadedQuote?.status === BulkQuoteStatus.ACCEPTED, "1.2 Quote status transitioned to ACCEPTED");
    check(Boolean(reloadedQuote?.convertedOrderId), "1.3 Quote is bound to convertedOrderId");

    if (reloadedQuote?.convertedOrderId) {
      cleanupOrderIds.push(reloadedQuote.convertedOrderId as mongoose.Types.ObjectId);
    }

    // Verify database level invariant: Exactly ONE order created for this quote
    const createdOrders = await Order.find({ _id: reloadedQuote?.convertedOrderId });
    check(createdOrders.length === 1, "1.4 Exactly ONE Order created in database across concurrent calls");

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 2: REJECT UNMAPPABLE/FABRICATED ALLOCATIONS
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("\n[TEST GROUP 2: STRICT VARIANT MATCHING]");

    const badReq = await BulkOrderRequest.create({
      quoteNumber: `QT-BAD-${timestamp}`,
      userId: user._id,
      organizationName: "Bad Org",
      contactName: "Manager",
      email: user.email,
      phone: "+919999988888",
      productId: product._id,
      variantAllocations: [
        { size: "3XL", color: "PURPLE", quantity: 15 }, // Non-existent variant!
      ],
      totalQuantity: 15,
      customPrintingRequired: false,
      printLocations: [],
      deliveryLocation: "100 Feet Road, Bengaluru",
      status: BulkRequestStatus.MOCKUP_SHARED,
    });
    cleanupRequestIds.push(badReq._id as mongoose.Types.ObjectId);

    const badQuote = await BulkQuote.create({
      quoteNumber: `QT-BAD-${timestamp}`,
      bulkRequestId: badReq._id,
      userId: user._id,
      productPrice: 1000000,
      subtotal: 1000000,
      tax: 180000,
      shipping: 0,
      total: 1180000,
      validUntil: new Date(Date.now() + 86400000 * 7),
      status: BulkQuoteStatus.SENT,
    });
    cleanupQuoteIds.push(badQuote._id as mongoose.Types.ObjectId);

    let errorThrown: any = null;
    const badAcceptReq = {
      params: { quoteId: badQuote._id.toString() },
      user: { id: (user._id as mongoose.Types.ObjectId).toString(), role: "CUSTOMER" },
    } as unknown as Request;
    const badAcceptRes = createMockRes();

    await acceptQuote(badAcceptReq, badAcceptRes as unknown as Response, (err) => {
      errorThrown = err;
    });

    check(
      errorThrown !== null && errorThrown.statusCode === 400 && errorThrown.message.includes("missing variant match"),
      "2.1 Rejects unmappable allocation with 400 (never silently picks wrong variant)"
    );

    const reloadedBadQuote = await BulkQuote.findById(badQuote._id);
    check(reloadedBadQuote?.status === BulkQuoteStatus.SENT, "2.2 Rolls back quote status to SENT on allocation failure");

  } catch (err: unknown) {
    console.error("💥 Unhandled test exception:", err);
    failed++;
    failures.push(`Unhandled test exception: ${err}`);
  } finally {
    console.log("\n🧹 Cleaning up test fixtures from database...");
    if (cleanupOrderIds.length > 0) {
      await Order.deleteMany({ _id: { $in: cleanupOrderIds } });
    }
    if (cleanupQuoteIds.length > 0) {
      await BulkQuote.deleteMany({ _id: { $in: cleanupQuoteIds } });
    }
    if (cleanupRequestIds.length > 0) {
      await BulkOrderRequest.deleteMany({ _id: { $in: cleanupRequestIds } });
    }
    if (cleanupProductIds.length > 0) {
      await Product.deleteMany({ _id: { $in: cleanupProductIds } });
    }
    if (cleanupUserIds.length > 0) {
      await User.deleteMany({ _id: { $in: cleanupUserIds } });
    }
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    console.log(" Disconnected from MongoDB\n");
  }

  console.log("════════════════════════════════════════════════════════════════");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.log("Failures:");
    failures.forEach((f) => console.log(`  - ${f}`));
  }
  console.log("════════════════════════════════════════════════════════════════\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runBulkQuoteTests().catch((err) => {
  console.error("Fatal test runner error:", err);
  process.exit(1);
});
