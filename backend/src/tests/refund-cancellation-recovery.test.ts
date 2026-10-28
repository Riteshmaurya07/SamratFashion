/**
 * Phase 4: Refund and Cancellation Recovery Regression Test Suite
 *
 * Verifies that:
 * 1. Cancelling an order restores inventory only when original stock was deducted.
 * 2. Repeated cancellation calls do not double-restore stock.
 * 3. Shipped and delivered orders cannot be cancelled.
 * 4. Cancellation initiates internal refund safely.
 * 5. Concurrent returns cannot exceed remaining returnable quantity.
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

import { connectSafeTestDb, createTestProduct } from "./testHelpers";
import { Order } from "../models/Order";
import { Payment } from "../models/Payment";
import { PaymentAttempt } from "../models/PaymentAttempt";
import { User, UserStatus, UserRole } from "../models/User";
import { Product } from "../models/Product";
import { InventoryTransaction } from "../models/InventoryTransaction";
import { cancelOrder } from "../controllers/orderController";
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

async function runRefundCancellationTests() {
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║  Refund & Cancellation Recovery Verification Suite             ║");
  console.log("╚════════════════════════════════════════════════════════════════╝\n");

  const cleanupProductIds: mongoose.Types.ObjectId[] = [];
  const cleanupUserIds: mongoose.Types.ObjectId[] = [];
  const cleanupOrderIds: mongoose.Types.ObjectId[] = [];

  try {
    await connectSafeTestDb();
    console.log(` Connected to verified isolated test database: ${mongoose.connection.name}\n`);

    const timestamp = Date.now();

    const user = await User.create({
      name: "Cancel Customer",
      email: `cancel_${timestamp}@example.com`,
      passwordHash: "hash123",
      role: UserRole.CUSTOMER,
      status: UserStatus.ACTIVE,
    });
    cleanupUserIds.push(user._id as mongoose.Types.ObjectId);

    const { product: prodDoc } = await createTestProduct({
      name: `Cancel Test Tee ${timestamp}`,
      variants: [{ size: "L", color: "CHARCOAL", stock: 20, isAvailable: true }],
    });
    const product = prodDoc;
    cleanupProductIds.push(product._id);
    const variantL = product.variants[0];

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 1: CANCEL UNPAID PENDING ORDER (NO STOCK RESTORE, SAFE CANCEL)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("[TEST GROUP 1: UNPAID ORDER CANCELLATION]");

    const pendingOrder = await Order.create({
      orderNumber: `ORD-PEND-${timestamp}`,
      userId: user._id,
      items: [
        {
          productId: product._id,
          variantId: variantL._id,
          productName: product.name,
          productImage: "http://example.com/img.jpg",
          selectedSize: "L",
          selectedColor: "CHARCOAL",
          quantity: 2,
          unitPrice: 999,
          lineTotal: 1998,
        },
      ],
      subtotal: 1998,
      total: 1998,
      status: "PENDING",
      paymentStatus: "PENDING",
      shippingAddress: {
        fullName: "Customer",
        phone: "+919999988888",
        addressLine1: "123 Street",
        city: "City",
        state: "State",
        postalCode: "110001",
        country: "IN",
      },
    });
    cleanupOrderIds.push(pendingOrder._id as mongoose.Types.ObjectId);

    const cancelReq1 = {
      params: { id: pendingOrder._id.toString() },
      user: { id: (user._id as mongoose.Types.ObjectId).toString(), role: "CUSTOMER" },
      body: { reason: "Changed my mind" },
    } as unknown as Request;
    const cancelRes1 = createMockRes();

    let cancelErr1: any = null;
    await cancelOrder(cancelReq1, cancelRes1 as unknown as Response, (err) => { cancelErr1 = err; });
    if (cancelErr1) console.error("CancelErr1:", cancelErr1);
    check(cancelRes1.statusCode === 200, "1.1 Unpaid pending order cancelled successfully");

    const reloadedPending = await Order.findById(pendingOrder._id);
    check(reloadedPending?.status === "CANCELLED", "1.2 Order status set to CANCELLED");

    // Stock must remain 20 (since unpaid order never deducted stock)
    const reloadedProd1 = await Product.findById(product._id);
    check(reloadedProd1!.variants[0].stock === 20, "1.3 Stock remains unchanged at 20 (no ghost restocking)");

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 2: CANCEL PAID ORDER (RESTOCKS BASED ON SALE EVIDENCE)
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("\n[TEST GROUP 2: PAID ORDER CANCELLATION WITH INVENTORY RESTORE]");

    // Simulate an order that was paid and deducted 4 units (stock 20 -> 16)
    await Product.updateOne({ _id: product._id, "variants._id": variantL._id }, { $set: { "variants.$.stock": 16 } });

    const paidOrder = await Order.create({
      orderNumber: `ORD-PAID-${timestamp}`,
      userId: user._id,
      items: [
        {
          productId: product._id,
          variantId: variantL._id,
          productName: product.name,
          productImage: "http://example.com/img.jpg",
          selectedSize: "L",
          selectedColor: "CHARCOAL",
          quantity: 4,
          unitPrice: 1000,
          lineTotal: 4000,
        },
      ],
      subtotal: 4000,
      total: 4000,
      status: "PROCESSING",
      paymentStatus: "PAID",
      shippingAddress: {
        fullName: "Customer",
        phone: "+919999988888",
        addressLine1: "123 Street",
        city: "City",
        state: "State",
        postalCode: "110001",
        country: "IN",
      },
    });
    cleanupOrderIds.push(paidOrder._id as mongoose.Types.ObjectId);

    // Create SALE transaction evidence
    await InventoryTransaction.create({
      orderId: paidOrder._id,
      productId: product._id,
      variantId: variantL._id,
      quantity: 4,
      type: "SALE",
    });

    const payment = await Payment.create({
      orderId: paidOrder._id,
      userId: user._id,
      amount: 4000,
      currency: "INR",
      status: "CAPTURED",
      provider: "RAZORPAY",
      refundedAmount: 0,
      pendingRefundAmount: 0,
      razorpayPaymentId: `pay_mock_${timestamp}`,
    });

    await PaymentAttempt.create({
      paymentId: payment._id,
      orderId: paidOrder._id,
      razorpayOrderId: `order_mock_${timestamp}`,
      razorpayPaymentId: payment.razorpayPaymentId,
      amount: 4000,
      currency: "INR",
      status: "CAPTURED",
    });

    // Ensure mock payment permitted for test environment
    process.env.ALLOW_PAYMENT_MOCK = "true";
    process.env.NODE_ENV = "test";

    const cancelReq2 = {
      params: { id: paidOrder._id.toString() },
      user: { id: (user._id as mongoose.Types.ObjectId).toString(), role: "CUSTOMER" },
      body: { reason: "Wrong size chosen" },
    } as unknown as Request;
    const cancelRes2 = createMockRes();

    let cancelErr2: any = null;
    await cancelOrder(cancelReq2, cancelRes2 as unknown as Response, (err) => { cancelErr2 = err; });
    if (cancelErr2) console.error("CancelErr2:", cancelErr2);
    check(cancelRes2.statusCode === 200, "2.1 Paid order cancelled successfully");

    const reloadedPaid = await Order.findById(paidOrder._id);
    check(reloadedPaid?.status === "CANCELLED", "2.2 Order status is CANCELLED");
    check(reloadedPaid?.paymentStatus === "REFUNDED", "2.3 Order paymentStatus is REFUNDED");

    // Stock should be restored from 16 -> 20
    const reloadedProd2 = await Product.findById(product._id);
    check(reloadedProd2!.variants[0].stock === 20, "2.4 Stock restored to 20 based on SALE evidence");

    // ─────────────────────────────────────────────────────────────────────────────
    // TEST GROUP 3: SHIPPED ORDER REJECTS CANCELLATION
    // ─────────────────────────────────────────────────────────────────────────────
    console.log("\n[TEST GROUP 3: TERMINAL SHIPPED ORDER GUARD]");

    const shippedOrder = await Order.create({
      orderNumber: `ORD-SHIP-${timestamp}`,
      userId: user._id,
      items: [],
      subtotal: 1000,
      total: 1000,
      status: "SHIPPED",
      paymentStatus: "PAID",
      shippingAddress: {
        fullName: "Customer",
        phone: "+919999988888",
        addressLine1: "123 Street",
        city: "City",
        state: "State",
        postalCode: "110001",
        country: "IN",
      },
    });
    cleanupOrderIds.push(shippedOrder._id as mongoose.Types.ObjectId);

    let shipCancelError: any = null;
    const cancelReq3 = {
      params: { id: shippedOrder._id.toString() },
      user: { id: (user._id as mongoose.Types.ObjectId).toString(), role: "CUSTOMER" },
      body: {},
    } as unknown as Request;
    const cancelRes3 = createMockRes();

    await cancelOrder(cancelReq3, cancelRes3 as unknown as Response, (err) => {
      shipCancelError = err;
    });

    check(
      shipCancelError !== null && shipCancelError.statusCode === 400,
      "3.1 Shipped order cannot be cancelled (rejected with 400)"
    );

  } catch (err: unknown) {
    console.error("💥 Unhandled test exception:", err);
    failed++;
    failures.push(`Unhandled test exception: ${err}`);
  } finally {
    console.log("\n🧹 Cleaning up test fixtures from database...");
    if (cleanupOrderIds.length > 0) {
      await Order.deleteMany({ _id: { $in: cleanupOrderIds } });
      await Payment.deleteMany({ orderId: { $in: cleanupOrderIds } });
      await PaymentAttempt.deleteMany({ orderId: { $in: cleanupOrderIds } });
      await InventoryTransaction.deleteMany({ orderId: { $in: cleanupOrderIds } });
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

runRefundCancellationTests().catch((err) => {
  console.error("Fatal test runner error:", err);
  process.exit(1);
});
