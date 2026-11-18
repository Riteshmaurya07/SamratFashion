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
import { WorkerLock } from "../models/WorkerLock";
import { processPaymentSuccess } from "../services/payment/paymentProcessor";
import { razorpayProvider } from "../services/payment/RazorpayProvider";
import { assertReconciliationLinkage } from "../services/payment/paymentReconciliationGuard";
import { isStrictProductionOrStaging } from "../config/env";

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
  if (skipGatewayCheck && (isStrictProductionOrStaging() || process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging')) {
    fail("--skip-gateway-check is strictly prohibited in production and staging environments.");
  }
  if (shouldConfirm && skipGatewayCheck) {
    fail("--skip-gateway-check is allowed only for dry runs. Remove it before using --confirm.");
  }
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
    const client = razorpayProvider.getClient();
    const entity = (await client.payments.fetch(razorpayPaymentId)) as unknown as {
      id?: string;
      order_id?: string;
      amount?: number;
      status?: string;
      currency?: string;
    } | null;

    if (!entity || entity.id !== razorpayPaymentId) {
      fail(`Razorpay payment lookup did not return the requested payment id ${razorpayPaymentId}.`);
    }
    if (entity.status !== "captured") {
      fail(`Razorpay reports status "${entity.status}" (not captured). No money to reconcile; do not mark the order paid.`);
    }
    if (!entity.order_id || (razorpayOrderId && entity.order_id !== razorpayOrderId)) {
      fail(`Payment belongs to Razorpay order "${entity.order_id || "(missing)"}", not the supplied ${razorpayOrderId || "(no order id supplied)"}.`);
    }
    razorpayOrderId = entity.order_id;

    const expectedPaise = Math.round(order.total * 100);
    if (entity.amount !== expectedPaise) {
      fail(`Amount mismatch: gateway ${entity.amount} paise vs order ${expectedPaise} paise. Investigate manually.`);
    }
    if (order.currency !== "INR" || entity.currency !== "INR" || entity.currency !== order.currency) {
      fail(`Currency mismatch or unsupported currency: payment ${entity.currency || "(missing)"}, order ${order.currency || "(missing)"}. Reconciliation requires INR.`);
    }

    const gatewayOrder = (await client.orders.fetch(razorpayOrderId)) as unknown as {
      id?: string;
      amount?: number;
      currency?: string;
      notes?: Record<string, unknown>;
    } | null;
    if (!gatewayOrder || gatewayOrder.id !== razorpayOrderId) {
      fail(`Razorpay order lookup did not return the payment's exact order id ${razorpayOrderId}.`);
    }
    if (gatewayOrder.amount !== expectedPaise) {
      fail(`Razorpay order amount mismatch: gateway ${gatewayOrder.amount} paise vs order ${expectedPaise} paise.`);
    }
    if (order.currency !== "INR" || gatewayOrder.currency !== "INR" || gatewayOrder.currency !== order.currency) {
      fail(`Currency mismatch or unsupported currency: Razorpay order ${gatewayOrder.currency || "(missing)"}, internal order ${order.currency || "(missing)"}. Reconciliation requires INR.`);
    }
    if (gatewayOrder.notes?.internalOrderId !== order._id.toString()) {
      fail(`Razorpay order notes.internalOrderId does not match internal order ${order._id.toString()}.`);
    }

    console.log(`  payment ${entity.id}: status=${entity.status} order=${entity.order_id} amount=${entity.amount} ${entity.currency}`);
    console.log(`  order   ${gatewayOrder.id}: amount=${gatewayOrder.amount} ${gatewayOrder.currency} internalOrderId=${gatewayOrder.notes?.internalOrderId}`);
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

  const [existingLinkedPayment, existingLinkedAttempt] = await Promise.all([
    Payment.findOne({ razorpayPaymentId, orderId: { $ne: order._id } }),
    PaymentAttempt.findOne({ razorpayPaymentId, orderId: { $ne: order._id } }),
  ]);
  if (existingLinkedPayment) {
    fail(`Payment ${razorpayPaymentId} is already linked to another order ${existingLinkedPayment.orderId.toString()}. Refusing to apply.`);
  }
  if (existingLinkedAttempt) {
    fail(`Payment ${razorpayPaymentId} is already linked to another attempt on order ${existingLinkedAttempt.orderId.toString()}. Refusing to apply.`);
  }

  if (attempt.status === "CAPTURED" && attempt.razorpayPaymentId && attempt.razorpayPaymentId !== razorpayPaymentId) {
    fail(
      `Attempt is already CAPTURED with a different payment (${attempt.razorpayPaymentId}). ` +
        `This ${razorpayPaymentId} is a second capture and needs a refund, not a reconcile.`
    );
  }

  if (!shouldConfirm) {
    console.log(skipGatewayCheck ? "\n[DRY RUN - UNVERIFIED] Would perform:" : "\n[DRY RUN] Would perform:");
    if (order.paymentStatus !== "PENDING") console.log(`  - order.paymentStatus: ${order.paymentStatus} -> PENDING`);
    if (shouldRevive && (order.status === "EXPIRED" || order.status === "CANCELLED")) {
      console.log(`  - order.status: ${order.status} -> PENDING`);
    }
    if (attempt.status === "FAILED") console.log(`  - attempt ${attempt._id.toString()}: FAILED -> PENDING (clear failure fields)`);
    if (payment && payment.status !== "PENDING") console.log(`  - payment.status: ${payment.status} -> PENDING`);
    console.log(`  - processPaymentSuccess(${razorpayOrderId}, ${razorpayPaymentId})`);
    if (skipGatewayCheck) {
      console.log("\nGateway verification was skipped; this run is not eligible to apply. Re-run without --skip-gateway-check for a verified dry run.");
    } else {
      console.log("\nRe-run with --confirm to apply.");
    }
    return;
  }

  const lockName = `RECONCILIATION_ORDER_${order._id.toString()}`;
  const ownerId = `reconcile_script_${process.pid}_${Date.now()}`;
  const lockExpiresAt = new Date(Date.now() + 60_000);

  let lockAcquired = false;
  try {
    const lock = await WorkerLock.findOneAndUpdate(
      {
        lockName,
        $or: [
          { leaseExpiresAt: { $lt: new Date() } },
          { ownerId },
        ],
      },
      {
        $set: { ownerId, leaseExpiresAt: lockExpiresAt, lastAcquiredAt: new Date() },
        $inc: { fencingToken: 1 },
      },
      { returnDocument: 'after' }
    );
    if (!lock) {
      try {
        await WorkerLock.create({
          lockName,
          ownerId,
          fencingToken: 1,
          leaseExpiresAt: lockExpiresAt,
          lastAcquiredAt: new Date(),
        });
        lockAcquired = true;
      } catch (createErr: any) {
        if (createErr.code !== 11000) throw createErr;
      }
    } else {
      lockAcquired = true;
    }
  } catch (err) {
    console.warn('[RECONCILE] Lock acquisition error:', err);
  }
  if (!lockAcquired) {
    fail(`Could not acquire exclusive reconciliation lock for order ${order._id}. Another process may be reconciling this order.`);
  }

  let session: mongoose.ClientSession | null = null;
  let inTx = false;
  try {
    session = await mongoose.startSession();
    session.startTransaction();
    inTx = true;
  } catch {
    inTx = false;
  }

  try {
    console.log("\n[APPLY] Resetting records to a claimable state...");
    await Order.updateOne(
      { _id: order._id, paymentStatus: { $ne: "PAID" } },
      { $set: { paymentStatus: "PENDING" } },
      { session: inTx ? session! : undefined }
    );
    if (shouldRevive) {
      await Order.updateOne(
        { _id: order._id, status: { $in: ["CANCELLED", "EXPIRED"] } },
        { $set: { status: "PENDING" } },
        { session: inTx ? session! : undefined }
      );
    }
    if (attempt.status === "FAILED") {
      await PaymentAttempt.updateOne(
        { _id: attempt._id, status: "FAILED" },
        { $set: { status: "PENDING" }, $unset: { failureCode: 1, failureReason: 1 } },
        { session: inTx ? session! : undefined }
      );
    }
    if (payment && payment.status !== "CAPTURED") {
      await Payment.updateOne(
        { _id: payment._id },
        { $set: { status: "PENDING" } },
        { session: inTx ? session! : undefined }
      );
    }

    console.log("[APPLY] Running processPaymentSuccess...");
    let result: any = null;
    try {
      result = await processPaymentSuccess(razorpayOrderId, razorpayPaymentId, {
        session: inTx ? session! : undefined,
      });

      if (inTx && session) {
        if (!result || !result.success) {
          if (session.inTransaction()) {
            await session.abortTransaction().catch(() => {});
          }
          console.warn(`[APPLY] processPaymentSuccess indicated failure: ${result?.reason || 'UNKNOWN'}`);
        } else if (session.inTransaction()) {
          await session.commitTransaction();
        }
      }
    } catch (procErr) {
      if (inTx && session && session.inTransaction()) {
        await session.abortTransaction().catch(() => {});
      }
      console.error("[APPLY] processPaymentSuccess error:", procErr);
      throw procErr;
    }

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
  } catch (applyErr) {
    if (inTx && session) {
      await session.abortTransaction().catch(() => {});
    }
    throw applyErr;
  } finally {
    if (session) {
      await session.endSession().catch(() => {});
    }
    await WorkerLock.updateOne({ lockName, ownerId }, { $set: { leaseExpiresAt: new Date(0) } }).catch(() => {});
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
