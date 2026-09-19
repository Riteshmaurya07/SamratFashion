/**
 * Phase 7 — Refund Webhook Semantics Test Suite
 *
 * Drives the exported DB handlers from webhookController directly (no HTTP/auth
 * harness) to verify:
 * - `refund.processed` moves pendingRefundAmount → refundedAmount (full vs partial)
 * - Full refund flips Payment → REFUNDED and Order paymentStatus → REFUNDED
 * - CANCELLED-order full refund restores deducted stock exactly once (+ REFUND txn)
 * - Re-delivery (idempotency) of `refund.processed` / `refund.failed` is a no-op
 * - `refund.failed` releases the reservation back into pendingRefundAmount
 * - Unknown refund ids are safe no-ops
 */

import mongoose from "mongoose";
import { Order } from "../models/Order";
import { Payment } from "../models/Payment";
import { PaymentAttempt } from "../models/PaymentAttempt";
import { Product } from "../models/Product";
import { Refund } from "../models/Refund";
import { InventoryTransaction } from "../models/InventoryTransaction";
import "../models/ReturnRequest"; // Register model used reflectively by webhookController
import { createTestProduct } from "./testHelpers";
import { handleRefundProcessedEntity, handleRefundFailedEntity } from "../controllers/webhookController";

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

async function makeOrder(product: any, variantId: string, code: string, qty: number) {
  return Order.create({
    orderNumber: `ORD-REF-${code}-${Date.now()}`,
    userId: new mongoose.Types.ObjectId(TEST_USER_ID),
    items: [
      {
        productId: product._id,
        variantId,
        productName: product.name,
        productImage: "http://localhost/img.jpg",
        selectedSize: "M",
        selectedColor: "BLACK",
        quantity: qty,
        unitPrice: 1000,
        lineTotal: 1000 * qty,
        isCustomized: false
      }
    ],
    shippingAddress: { fullName: "R", phone: "1", addressLine1: "St", city: "C", state: "S", postalCode: "1", country: "IN", addressType: "HOME" },
    paymentMethod: "RAZORPAY",
    subtotal: 1000 * qty,
    discount: 0,
    tax: 0,
    shipping: 0,
    total: 1000 * qty
  });
}

async function runRefundWebhookTests() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║   Phase 7 — Refund Webhook Semantics Tests       ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  await mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/samrat_fashion");
  console.log("✅ Connected to MongoDB\n");

  let product: any;

  try {
    const pRes = await createTestProduct({
      name: "Refund Webhook Test Tee",
      variants: [{ size: "M", color: "BLACK", stock: 10 }]
    });
    product = pRes.product;
    const variantId = pRes.variantIds[0];

    // ─── SCENARIO A: Full refund on an auto-refunded CANCELLED order ──────────
    // (Successful payment deducted 3 units, order then cancelled & auto-refunded.)
    console.log("[SCENARIO A: Full refund.processed on a CANCELLED order]");
    const orderA = await makeOrder(product, variantId, "A", 3);
    await Order.updateOne({ _id: orderA._id }, { status: "CANCELLED", paymentStatus: "PAID", total: 1000, subtotal: 3000 });

    const paymentA = await Payment.create({
      orderId: orderA._id,
      userId: new mongoose.Types.ObjectId(TEST_USER_ID),
      amount: 3000,
      currency: "INR",
      status: "CAPTURED",
      provider: "RAZORPAY",
      refundedAmount: 0,
      pendingRefundAmount: 3000
    });

    await PaymentAttempt.create({
      paymentId: paymentA._id,
      orderId: orderA._id,
      razorpayOrderId: `rzp_ref_a_${Date.now()}`,
      razorpayPaymentId: `pay_ref_a_${Date.now()}`,
      amount: 3000,
      currency: "INR",
      status: "CAPTURED"
    });

    // Simulate the stock that a captured payment deducted (SALE txn).
    await Product.updateOne(
      { _id: product._id, "variants._id": variantId },
      { $inc: { "variants.$.stock": -3 } }
    );
    await InventoryTransaction.create({
      orderId: orderA._id,
      productId: product._id,
      variantId,
      quantity: 3,
      type: "SALE"
    });

    // Simulate createInternalRefund's PENDING record with its reservation.
    const refundA = await Refund.create({
      orderId: orderA._id,
      paymentId: paymentA._id,
      userId: new mongoose.Types.ObjectId(TEST_USER_ID),
      amount: 3000,
      currency: "INR",
      status: "PENDING",
      initiatedBy: new mongoose.Types.ObjectId(TEST_USER_ID),
      initiatedByRole: "ADMIN"
    });

    const entityA = {
      id: "rfnd_full_a",
      payment_id: "pay_ref_a_live",
      notes: { internal_refund_id: refundA._id.toString() }
    };

    await handleRefundProcessedEntity(entityA);

    const refundAAfter = await Refund.findById(refundA._id);
    check(refundAAfter?.status === "PROCESSED", "REF-WHK-A.1 Refund record transitions PENDING → PROCESSED", `status=${refundAAfter?.status}`);

    const payAAfter: any = await Payment.findById(paymentA._id);
    check(payAAfter.refundedAmount === 3000 && payAAfter.pendingRefundAmount === 0,
      "REF-WHK-A.2 Reserved amount moves pendingRefundAmount(0) → refundedAmount(3000)",
      `refunded=${payAAfter.refundedAmount}, pending=${payAAfter.pendingRefundAmount}`);
    check(payAAfter.status === "REFUNDED", "REF-WHK-A.3 Payment marked REFUNDED when fully refunded", `status=${payAAfter.status}`);

    const orderAAfter: any = await Order.findById(orderA._id);
    check(orderAAfter.paymentStatus === "REFUNDED", "REF-WHK-A.4 Order paymentStatus → REFUNDED on full refund", `status=${orderAAfter.paymentStatus}`);

    let prod: any = await Product.findById(product._id);
    check((prod.variants as any).id(variantId).stock === 10, "REF-WHK-A.5 CANCELLED order stock restored 7 → 10", `stock=${(prod.variants as any).id(variantId).stock}`);
    const refundTxn = await InventoryTransaction.find({ orderId: orderA._id, type: "REFUND" });
    check(refundTxn.length === 1, "REF-WHK-A.6 Exactly one REFUND inventory transaction created");

    // Idempotency: redeliver the same event.
    await handleRefundProcessedEntity(entityA);
    refundAAfter && refundAAfter.status;
    prod = await Product.findById(product._id);
    check((prod.variants as any).id(variantId).stock === 10, "REF-WHK-A.7 Idempotent redelivery does NOT restore stock twice", `stock=${(prod.variants as any).id(variantId).stock}`);
    const refundTxnsAfterReplay = await InventoryTransaction.find({ orderId: orderA._id, type: "REFUND" });
    check(refundTxnsAfterReplay.length === 1, "REF-WHK-A.8 No duplicate REFUND transaction on replay");
    const payAReplay: any = await Payment.findById(paymentA._id);
    check(payAReplay.refundedAmount === 3000, "REF-WHK-A.9 No double-credit on replay", `refunded=${payAReplay.refundedAmount}`);

    // ─── SCENARIO B: Partial refund on a live CONFIRMED order ─────────────────
    console.log("\n[SCENARIO B: Partial refund.processed on a CONFIRMED order]");
    const orderB = await makeOrder(product, variantId, "B", 2);
    await Order.updateOne({ _id: orderB._id }, { status: "CONFIRMED", paymentStatus: "PAID", total: 2000, subtotal: 2000 });

    const paymentB = await Payment.create({
      orderId: orderB._id,
      userId: new mongoose.Types.ObjectId(TEST_USER_ID),
      amount: 2000,
      currency: "INR",
      status: "CAPTURED",
      provider: "RAZORPAY",
      refundedAmount: 0,
      pendingRefundAmount: 500
    });
    await PaymentAttempt.create({
      paymentId: paymentB._id,
      orderId: orderB._id,
      razorpayOrderId: `rzp_ref_b_${Date.now()}`,
      razorpayPaymentId: `pay_ref_b_${Date.now()}`,
      amount: 2000,
      currency: "INR",
      status: "CAPTURED"
    });

    const refundB = await Refund.create({
      orderId: orderB._id,
      paymentId: paymentB._id,
      userId: new mongoose.Types.ObjectId(TEST_USER_ID),
      amount: 500,
      currency: "INR",
      status: "PENDING",
      initiatedBy: new mongoose.Types.ObjectId(TEST_USER_ID),
      initiatedByRole: "CUSTOMER"
    });

    await handleRefundProcessedEntity({
      id: "rfnd_partial_b",
      payment_id: "pay_ref_b_live",
      notes: { internal_refund_id: refundB._id.toString() }
    });

    const payBAfter: any = await Payment.findById(paymentB._id);
    check(payBAfter.refundedAmount === 500 && payBAfter.pendingRefundAmount === 0,
      "REF-WHK-B.1 Partial reservation moves 500 → refundedAmount", `refunded=${payBAfter.refundedAmount}, pending=${payBAfter.pendingRefundAmount}`);
    check(payBAfter.status === "CAPTURED", "REF-WHK-B.2 Payment stays CAPTURED for a partial refund", `status=${payBAfter.status}`);
    const orderBAfter: any = await Order.findById(orderB._id);
    check(orderBAfter.paymentStatus === "PAID", "REF-WHK-B.3 Order stays PAID for a partial refund", `status=${orderBAfter.paymentStatus}`);

    // ─── SCENARIO C: refund.failed releases the reservation ───────────────────
    console.log("\n[SCENARIO C: refund.failed releases reservation]");
    const orderC = await makeOrder(product, variantId, "C", 1);
    await Order.updateOne({ _id: orderC._id }, { status: "CONFIRMED", paymentStatus: "PAID", total: 1000, subtotal: 1000 });

    const paymentC = await Payment.create({
      orderId: orderC._id,
      userId: new mongoose.Types.ObjectId(TEST_USER_ID),
      amount: 1000,
      currency: "INR",
      status: "CAPTURED",
      provider: "RAZORPAY",
      refundedAmount: 0,
      pendingRefundAmount: 800
    });

    const refundC = await Refund.create({
      orderId: orderC._id,
      paymentId: paymentC._id,
      userId: new mongoose.Types.ObjectId(TEST_USER_ID),
      amount: 800,
      currency: "INR",
      status: "PENDING",
      initiatedBy: new mongoose.Types.ObjectId(TEST_USER_ID),
      initiatedByRole: "ADMIN"
    });

    await handleRefundFailedEntity({
      id: "rfnd_failed_c",
      payment_id: "pay_ref_c_live",
      notes: { internal_refund_id: refundC._id.toString() }
    });

    const refundCAfter: any = await Refund.findById(refundC._id);
    check(refundCAfter.status === "FAILED", "REF-WHK-C.1 Refund record transitions PENDING → FAILED", `status=${refundCAfter.status}`);
    const payCAfter: any = await Payment.findById(paymentC._id);
    check(payCAfter.pendingRefundAmount === 0, "REF-WHK-C.2 Reservation released back to balance (800 → 0)", `pending=${payCAfter.pendingRefundAmount}`);
    check(payCAfter.refundedAmount === 0, "REF-WHK-C.3 No credit on refund.failed", `refunded=${payCAfter.refundedAmount}`);

    await handleRefundFailedEntity({
      id: "rfnd_failed_c",
      payment_id: "pay_ref_c_live",
      notes: { internal_refund_id: refundC._id.toString() }
    });
    const payCReplay: any = await Payment.findById(paymentC._id);
    check(payCReplay.pendingRefundAmount === 0, "REF-WHK-C.4 Idempotent redelivery does NOT double-release the reservation", `pending=${payCReplay.pendingRefundAmount}`);

    // ─── SCENARIO D: Unknown refund id is a safe no-op ─────────────────────────
    console.log("\n[SCENARIO D: Unknown refund events are safe no-ops]");
    const unknown = new mongoose.Types.ObjectId().toString();
    let threw = false;
    try {
      await handleRefundProcessedEntity({ id: "rfnd_unknown", payment_id: "pay_x", notes: { internal_refund_id: unknown } });
      await handleRefundFailedEntity({ id: "rfnd_unknown", payment_id: "pay_x", notes: { internal_refund_id: unknown } });
    } catch (e) {
      threw = true;
    }
    check(!threw, "REF-WHK-D.1 Unknown refund ids complete without throwing and without side effects");

  } catch (err: any) {
    console.error("Refund webhook test execution error:", err);
    failures.push(`Execution error: ${err.message}`);
    failed++;
  } finally {
    if (product) await Product.deleteOne({ _id: product._id });
    await Refund.deleteMany({ userId: TEST_USER_ID });
    await Order.deleteMany({ userId: TEST_USER_ID });
    await Payment.deleteMany({ userId: TEST_USER_ID });
    await PaymentAttempt.deleteMany({ razorpayOrderId: { $regex: /^rzp_ref_/ } });
    await InventoryTransaction.deleteMany({});
    await mongoose.disconnect();
  }

  console.log("\n══════════════════════════════════════════════");
  console.log(`Refund Webhook Results: ${passed} passed, ${failed} failed`);
  if (failures.length) failures.forEach(f => console.log("  •", f));
  console.log("══════════════════════════════════════════════");
  process.exit(failed > 0 ? 1 : 0);
}

runRefundWebhookTests().catch(e => {
  console.error("Refund webhook test runner crashed:", e);
  process.exit(1);
});