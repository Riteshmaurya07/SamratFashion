/**
 * Reconcile a Razorpay payment that was CAPTURED at the gateway but never
 * applied to the order (order still PENDING / paymentStatus FAILED).
 *
 * Typical cause: a `payment.failed` event for an earlier attempt on the same
 * Razorpay order marked the PaymentAttempt FAILED before the capture was
 * processed. processPaymentSuccess can only claim attempts in PENDING state
 * (paymentProcessor.ts), so the capture is never applied and the money stays
 * captured at Razorpay.
 *
 * The script NEVER invents state: it re-uses the real, idempotent
 * processPaymentSuccess path, which deducts stock, issues the invoice, sends
 * notifications, and auto-refunds when stock is unavailable.
 *
 * Usage (from the `backend/` directory, with the production MONGODB_URI set):
 *
 *   # 1. Dry run — prints everything, changes nothing
 *   npx ts-node src/scripts/reconcileCapturedPayment.ts \
 *     --order SF-2026-350853 --payment pay_U0II93NOokdQXk
 *
 *   # 2. Apply (order is only revived if it was closed by the expiry reaper)
 *   npx ts-node src/scripts/reconcileCapturedPayment.ts \
 *     --order SF-2026-350853 --payment pay_U0II93NOokdQXk --confirm
 *
 * Flags:
 *   --order <orderNumber|ObjectId>  required, internal order
 *   --payment <pay_xxx>             required, Razorpay payment id
 *   --razorpay-order <order_xxx>    optional, cross-checked against Razorpay
 *   --revive                        allow EXPIRED/CANCELLED orders to be revived
 *   --skip-gateway-check            do not call Razorpay (offline dry runs only)
 *   --confirm                       actually write changes
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import mongoose from "mongoose";
import { Order } from "../models/Order";
import { Payment } from "../models/Payment";
import { PaymentAttempt } from "../models/PaymentAttempt";
import { Refund } from "../models/Refund";
import { WebhookEvent } from "../models/WebhookEvent";
import { processPaymentSuccess } from "../services/payment/paymentProcessor";
import { razorpayProvider } from "../services/payment/RazorpayProvider";
import { assertReconciliationLinkage } from "../services/payment/paymentReconciliationGuard";

const argv = process.argv.slice(2);

const hasFlag = (flag: string): boolean => argv.includes(flag);
const flagValue = (flag: string): string | undefined => {
  const idx = argv.indexOf(flag);
  if (idx < 0) return undefined;
  const value = argv[idx + 1];
  return value && !value.startsWith("--") ? value : undefined;
};

const orderRef = flagValue("--order");
const razorpayPaymentId = flagValue("--payment");
let razorpayOrderId = flagValue("--razorpay-order");
const shouldConfirm = hasFlag("--confirm");
const shouldRevive = hasFlag("--revive");
const skipGatewayCheck = hasFlag("--skip-gateway-check");

function fail(message: string): never {
  console.error(`\n[ABORT] ${message}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  if (!orderRef) {
    fail("Missing --order <orderNumber|ObjectId>. Nothing was changed.");
  }
  if (!razorpayPaymentId) {
    fail("Missing --payment <pay_xxx>. The Razorpay payment id is required so the capture can be recorded.");
  }

  const uri = process.env.MONGODB_URI || process.env.Mongodb_URI;
  if (!uri) {
    fail("MONGODB_URI / Mongodb_URI is not set. Export the production connection string before running this script.");
  }
  const maskedUri = uri.replace(/\/\/([^:/@]+):([^@]+)@/, "//$1:***@");
  console.log(`[DB]     ${maskedUri}`);
  console.log(`[MODE]   ${shouldConfirm ? "APPLY (writes enabled)" : "DRY RUN (no writes)"}`);

  await mongoose.connect(uri);

  const order = await Order.findOne(
    mongoose.Types.ObjectId.isValid(orderRef) ? { _id: orderRef } : { orderNumber: orderRef }
  );
  if (!order) fail(`Order not found for "${orderRef}".`);

  const payment = await Payment.findOne({ orderId: order._id });
  const attempts = await PaymentAttempt.find({ orderId: order._id }).sort({ createdAt: 1 });

  console.log(`\n=== ORDER ${order.orderNumber} (${order._id.toString()}) ===`);
  console.log(`  status         : ${order.status}`);
  console.log(`  paymentStatus  : ${order.paymentStatus}`);
  console.log(`  total          : ${order.total} ${order.currency || "INR"}`);
  console.log(`  createdAt      : ${order.createdAt?.toISOString?.() || "-"}`);
  console.log(`  updatedAt      : ${order.updatedAt?.toISOString?.() || "-"}`);

  console.log(`\n=== PAYMENT RECORD ===`);
  if (!payment) {
    console.log("  (missing)");
  } else {
    console.log(`  status            : ${payment.status}`);
    console.log(`  razorpayPaymentId : ${payment.razorpayPaymentId || "(none)"}`);
    console.log(`  reconciliation    : ${payment.reconciliationRequired ? `REQUIRED (${payment.reconciliationReason || "no reason"})` : "no"}`);
  }

  console.log(`\n=== PAYMENT ATTEMPTS (${attempts.length}) ===`);
  for (const att of attempts) {
    console.log(
      `  ${att.razorpayOrderId} status=${att.status} pay=${att.razorpayPaymentId || "-"} ` +
        `code=${att.failureCode || "-"} reason=${att.failureReason || "-"} created=${att.createdAt?.toISOString?.() || "-"}`
    );
  }

  const refunds = await Refund.find({ orderId: order._id }).select("status amount reason razorpayRefundId").lean();
  console.log(`\n=== REFUNDS (${refunds.length}) ===`);
  for (const refund of refunds) {
    console.log(`  ${refund.status} amount=${refund.amount} reason=${refund.reason || "-"} rzp=${refund.razorpayRefundId || "-"}`);
  }

  // ── Gateway verification ───────────────────────────────────────────────────
  if (!skipGatewayCheck) {
    console.log("\n=== RAZORPAY VERIFICATION ===");
    const entity = (await razorpayProvider.getClient().payments.fetch(razorpayPaymentId)) as unknown as {
      id: string;
      order_id: string;
      amount: number;
      status: string;
      currency: string;
    };
    console.log(`  payment ${entity.id}: status=${entity.status} order=${entity.order_id} amount=${entity.amount} ${entity.currency}`);

    if (entity.status !== "captured") {
      fail(`Razorpay reports status "${entity.status}" (not captured). No money to reconcile; do not mark the order paid.`);
    }
    if (razorpayOrderId && entity.order_id !== razorpayOrderId) {
      fail(`Payment belongs to Razorpay order ${entity.order_id}, not the supplied ${razorpayOrderId}.`);
    }
    razorpayOrderId = entity.order_id;

    const expectedPaise = Math.round(order.total * 100);
    if (entity.amount !== expectedPaise) {
      fail(`Amount mismatch: gateway ${entity.amount} paise vs order ${expectedPaise} paise. Investigate manually.`);
    }
  } else {
    console.log("\n[WARN] Gateway verification skipped (--skip-gateway-check).");
  }

  if (!razorpayOrderId) {
    fail("Could not determine the Razorpay order id. Pass --razorpay-order <order_xxx>.");
  }

  // ── Webhook history for this Razorpay order ────────────────────────────────
  const events = await WebhookEvent.find({ "payload.payload.payment.entity.order_id": razorpayOrderId })
    .sort({ createdAt: 1 })
    .limit(20)
    .select("eventType status lastError processingAttempts createdAt")
    .lean();
  console.log(`\n=== WEBHOOK EVENTS for ${razorpayOrderId} (${events.length}) ===`);
  for (const evt of events) {
    console.log(`  ${evt.eventType} -> ${evt.status} attempts=${evt.processingAttempts} error=${evt.lastError || "-"}`);
  }

  // ── Guards ─────────────────────────────────────────────────────────────────
  if (order.paymentStatus === "PAID" && order.status !== "CANCELLED" && order.status !== "EXPIRED") {
    console.log("\n[OK] Order is already PAID. Nothing to do (idempotent no-op).");
    return;
  }
  if (refunds.length > 0) {
    fail("Refund records already exist for this order. Money may already be returned; resolve manually.");
  }
  if ((order.status === "CANCELLED" || order.status === "EXPIRED") && !shouldRevive) {
    fail(
      `Order is ${order.status}. If the customer should still receive the goods, re-run with --revive. ` +
        "Otherwise issue the refund instead of reviving the order."
    );
  }

  const attempt = await PaymentAttempt.findOne({ razorpayOrderId });
  if (!attempt) {
    fail(`No PaymentAttempt found for Razorpay order ${razorpayOrderId}. Refusing to invent payment state.`);
  }

  // Identity linkage: never apply captured money to the wrong internal order.
  try {
    assertReconciliationLinkage({
      order,
      attempt: {
        _id: attempt._id,
        orderId: attempt.orderId,
        paymentId: attempt.paymentId,
        razorpayOrderId: attempt.razorpayOrderId,
      },
      payment,
      gatewayOrderId: razorpayOrderId,
    });
  } catch (linkErr) {
    fail(linkErr instanceof Error ? linkErr.message : String(linkErr));
  }

  if (attempt.status === "CAPTURED" && attempt.razorpayPaymentId && attempt.razorpayPaymentId !== razorpayPaymentId) {
    fail(
      `Attempt is already CAPTURED with a different payment (${attempt.razorpayPaymentId}). ` +
        `This ${razorpayPaymentId} is a second capture and needs a refund, not a reconcile.`
    );
  }

  if (!shouldConfirm) {
    console.log("\n[DRY RUN] Would perform:");
    if (order.paymentStatus !== "PENDING") console.log(`  - order.paymentStatus: ${order.paymentStatus} -> PENDING`);
    if (shouldRevive && (order.status === "EXPIRED" || order.status === "CANCELLED")) {
      console.log(`  - order.status: ${order.status} -> PENDING`);
    }
    if (attempt.status === "FAILED") console.log(`  - attempt ${attempt._id.toString()}: FAILED -> PENDING (clear failure fields)`);
    if (payment && payment.status !== "PENDING") console.log(`  - payment.status: ${payment.status} -> PENDING`);
    console.log(`  - processPaymentSuccess(${razorpayOrderId}, ${razorpayPaymentId})`);
    console.log("\nRe-run with --confirm to apply.");
    return;
  }

  console.log("\n[APPLY] Resetting records to a claimable state...");
  await Order.updateOne(
    { _id: order._id, paymentStatus: { $ne: "PAID" } },
    { $set: { paymentStatus: "PENDING" } }
  );
  if (shouldRevive) {
    await Order.updateOne(
      { _id: order._id, status: { $in: ["CANCELLED", "EXPIRED"] } },
      { $set: { status: "PENDING" } }
    );
  }
  if (attempt.status === "FAILED") {
    await PaymentAttempt.updateOne(
      { _id: attempt._id, status: "FAILED" },
      { $set: { status: "PENDING" }, $unset: { failureCode: 1, failureReason: 1 } }
    );
  }
  if (payment && payment.status !== "CAPTURED") {
    await Payment.updateOne({ _id: payment._id }, { $set: { status: "PENDING" } });
  }

  console.log("[APPLY] Running processPaymentSuccess...");
  const result = await processPaymentSuccess(razorpayOrderId, razorpayPaymentId);

  const finalOrder = await Order.findById(order._id);
  const finalAttempt = await PaymentAttempt.findById(attempt._id);
  const finalPayment = await Payment.findOne({ orderId: order._id });
  const finalRefunds = await Refund.find({ orderId: order._id }).select("status amount reason").lean();

  console.log("\n=== RESULT ===");
  console.log(`  success    : ${result ? String(result.success) : "null (attempt/order not found)"}`);
  console.log(`  reason     : ${result?.reason || "-"}`);
  console.log(`  order      : ${finalOrder?.status} / ${finalOrder?.paymentStatus}`);
  console.log(`  attempt    : ${finalAttempt?.status} (${finalAttempt?.razorpayPaymentId || "no payment id"})`);
  console.log(`  payment    : ${finalPayment?.status} (${finalPayment?.razorpayPaymentId || "no payment id"})`);
  console.log(`  refunds    : ${finalRefunds.length}`);

  if (finalOrder?.paymentStatus === "PAID" && finalOrder.status === "CONFIRMED") {
    console.log("\n[OK] Payment reconciled. Order is CONFIRMED and invoice/notifications were scheduled.");
  } else if (result?.reason === "STOCK_UNAVAILABLE") {
    console.log("\n[WARN] Stock was unavailable. A refund was created (see refunds above) and the order was cancelled.");
  } else {
    console.log("\n[WARN] Order did not reach PAID/CONFIRMED. Re-run the dry run and inspect the values above.");
  }
}

main()
  .catch((err: unknown) => {
    console.error("\n[ERROR]", err instanceof Error ? err.message : err);
    if (err instanceof Error && err.stack) console.error(err.stack);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect().catch(() => undefined);
  });
