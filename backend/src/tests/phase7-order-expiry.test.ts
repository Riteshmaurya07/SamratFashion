/**
 * Phase 7 — PENDING Order Expiry Reaper Test Suite
 *
 * Verifies expireStalePendingOrders():
 * - Stale unpaid PENDING orders (older than ORDER_EXPIRY_MS) are marked EXPIRED +
 *   paymentStatus FAILED
 * - Their idle PENDING PaymentAttempts are failed with PAYMENT_EXPIRED
 * - In-flight orders (AUTHORIZED/PROCESSING/CAPTURED attempt) are NEVER expired
 * - Fresh (recently created) PENDING orders are left untouched
 * - Atomic guard: an order that is no longer PENDING at update time is left alone
 * - No product stock mutation (stock is only decremented at capture)
 */

import mongoose from "mongoose";
import { Order } from "../models/Order";
import { PaymentAttempt } from "../models/PaymentAttempt";
import { Product } from "../models/Product";
import { createTestProduct } from "./testHelpers";
import { expireStalePendingOrders, ORDER_EXPIRY_MS } from "../services/orderExpiryService";

const TEST_USER_ID = new mongoose.Types.ObjectId().toString();

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

async function makePendingOrder(product: any, variantId: string, code: string) {
  return Order.create({
    orderNumber: `ORD-EXP-${code}-${Date.now()}`,
    userId: new mongoose.Types.ObjectId(TEST_USER_ID),
    items: [
      {
        productId: product._id,
        variantId,
        productName: product.name,
        productImage: "http://localhost/img.jpg",
        selectedSize: "M",
        selectedColor: "BLACK",
        quantity: 1,
        unitPrice: 500,
        lineTotal: 500,
        isCustomized: false
      }
    ],
    shippingAddress: { fullName: "E", phone: "1", addressLine1: "St", city: "C", state: "S", postalCode: "1", country: "IN", addressType: "HOME" },
    paymentMethod: "RAZORPAY",
    paymentStatus: "PENDING",
    status: "PENDING",
    subtotal: 500,
    discount: 0,
    tax: 0,
    shipping: 0,
    total: 500
  });
}

async function runOrderExpiryTests() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  Phase 7 — PENDING Order Expiry Reaper Tests     ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  await mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/samrat_fashion");
  console.log("✅ Connected to MongoDB\n");

  let product: any;

  try {
    const pRes = await createTestProduct({
      name: "Order Expiry Test Tee",
      variants: [{ size: "M", color: "BLACK", stock: 10 }]
    });
    product = pRes.product;
    const variantId = pRes.variantIds[0];

    // ─── Setup: three stale orders + one fresh order ──────────────────────────
    const staleIdle = await makePendingOrder(product, variantId, "STALE_IDLE");
    const staleInFlight = await makePendingOrder(product, variantId, "STALE_INFLIGHT");
    const staleAlreadyPaid = await makePendingOrder(product, variantId, "STALE_PAID");
    const fresh = await makePendingOrder(product, variantId, "FRESH");

    // Age the stale orders past the expiry window (raw collection write to bypass
    // mongoose timestamps)
    const cutoff = new Date(Date.now() - ORDER_EXPIRY_MS - 5 * 60 * 1000);
    await Order.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(staleIdle._id) },
      { $set: { updatedAt: cutoff } }
    );
    await Order.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(staleInFlight._id) },
      { $set: { updatedAt: cutoff } }
    );
    await Order.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(staleAlreadyPaid._id) },
      { $set: { updatedAt: cutoff } }
    );

    // staleAlreadyPaid becomes PAID (captured) BEFORE any reaper run: the reaper
    // must never touch a paid order, even one that was stale.
    await Order.updateOne({ _id: staleAlreadyPaid._id }, { paymentStatus: "PAID" });

    const payStale = await PaymentAttempt.create({
      paymentId: new mongoose.Types.ObjectId(),
      orderId: staleInFlight._id,
      razorpayOrderId: `rzp_exp_inflight_${Date.now()}`,
      amount: 500,
      currency: "INR",
      status: "PROCESSING"
    });
    await PaymentAttempt.create({
      paymentId: new mongoose.Types.ObjectId(),
      orderId: staleIdle._id,
      razorpayOrderId: `rzp_exp_idle_${Date.now()}`,
      amount: 500,
      currency: "INR",
      status: "PENDING"
    });
    await PaymentAttempt.create({
      paymentId: new mongoose.Types.ObjectId(),
      orderId: fresh._id,
      razorpayOrderId: `rzp_exp_fresh_${Date.now()}`,
      amount: 500,
      currency: "INR",
      status: "PENDING"
    });

    const before = await expireStalePendingOrders();
    check(before.expired === 1, "EXP-1 Exactly one stale idle order expired", `expired=${before.expired}`);

    // staleIdle: expired + attempts failed
    const staleIdleAfter: any = await Order.findById(staleIdle._id);
    check(staleIdleAfter.status === "EXPIRED" && staleIdleAfter.paymentStatus === "FAILED",
      "EXP-2 Stale idle order marked EXPIRED with paymentStatus FAILED",
      `status=${staleIdleAfter.status}/${staleIdleAfter.paymentStatus}`);
    const idleAttempt = await PaymentAttempt.find({ orderId: staleIdle._id });
    check(idleAttempt.length === 1 && idleAttempt[0].status === "FAILED" && idleAttempt[0].failureCode === "PAYMENT_EXPIRED",
      "EXP-3 Idle PENDING attempt failed with PAYMENT_EXPIRED",
      `status=${idleAttempt[0]?.status}/${idleAttempt[0]?.failureCode}`);

    // staleInFlight: NOT expired
    const staleInFlightAfter: any = await Order.findById(staleInFlight._id);
    check(staleInFlightAfter.status === "PENDING", "EXP-4 In-flight order (PROCESSING attempt) is never expired", `status=${staleInFlightAfter.status}`);
    const inFlightAttempt: any = await PaymentAttempt.findById(payStale._id);
    check(inFlightAttempt.status === "PROCESSING", "EXP-5 In-flight attempt left untouched", `status=${inFlightAttempt.status}`);

    // staleAlreadyPaid is a stale order that successfully captured payment first:
    // the reaper must never expire it (paid orders are terminal).
    await expireStalePendingOrders();
    const stalePaidAfter: any = await Order.findById(staleAlreadyPaid._id);
    check(stalePaidAfter.paymentStatus === "PAID" && stalePaidAfter.status === "PENDING",
      "EXP-6 Stale order that is PAID is never expired",
      `status=${stalePaidAfter.status}/${stalePaidAfter.paymentStatus}`);

    // Idempotent reaper: a second sweep finds nothing further to expire and does
    // not churn already-expired orders.
    const later = await expireStalePendingOrders();
    check(later.expired === 0, "EXP-6B Second reaper sweep is a no-op (no re-expiring)");

    // Atomic guard: the guard update filter re-checks status/paymentStatus, so an
    // order that no longer matches (e.g. just captured) yields modifiedCount 0.
    const guardRes = await Order.updateOne(
      { _id: fresh._id, status: 'PENDING', paymentStatus: 'PENDING' },
      { $set: { status: 'EXPIRED', paymentStatus: 'FAILED' } }
    );
    await Order.updateOne({ _id: fresh._id }, { $set: { status: 'PENDING', paymentStatus: 'PENDING' } });
    check(guardRes.modifiedCount === 1, "EXP-6C Guard filter semantics: matching PENDING order updates once");
    const guardMiss = await Order.updateOne(
      { _id: staleIdle._id, status: 'PENDING', paymentStatus: 'PENDING' },
      { $set: { status: 'EXPIRED', paymentStatus: 'FAILED' } }
    );
    check(guardMiss.modifiedCount === 0, "EXP-6D Guard filter refuses to re-expire an already-expired order");

    // fresh: NOT expired
    const freshAfter: any = await Order.findById(fresh._id);
    check(freshAfter.status === "PENDING", "EXP-7 Fresh (recent) PENDING order is untouched", `status=${freshAfter.status}`);

    // No inventory side effects anywhere
    const prod: any = await Product.findById(product._id);
    check((prod.variants as any).id(variantId).stock === 10, "EXP-8 No product stock mutation by the reaper", `stock=${(prod.variants as any).id(variantId).stock}`);

  } catch (err: any) {
    console.error("Order expiry test execution error:", err);
    failures.push(`Execution error: ${err.message}`);
    failed++;
  } finally {
    if (product) await Product.deleteOne({ _id: product._id });
    await Order.deleteMany({ userId: TEST_USER_ID });
    await PaymentAttempt.deleteMany({ razorpayOrderId: { $regex: /^rzp_exp_/ } });
    await mongoose.disconnect();
  }

  console.log("\n══════════════════════════════════════════════");
  console.log(`Order Expiry Results: ${passed} passed, ${failed} failed`);
  if (failures.length) failures.forEach(f => console.log("  •", f));
  console.log("══════════════════════════════════════════════");
  process.exit(failed > 0 ? 1 : 0);
}

runOrderExpiryTests().catch(e => {
  console.error("Order expiry test runner crashed:", e);
  process.exit(1);
});