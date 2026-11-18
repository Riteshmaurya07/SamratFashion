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
import crypto from "crypto";

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
import {
  processPaymentSuccess,
  ProcessPaymentSuccessOptions,
  ProcessPaymentSuccessResult,
} from "../services/payment/paymentProcessor";
import { razorpayProvider } from "../services/payment/RazorpayProvider";
import { assertReconciliationLinkage } from "../services/payment/paymentReconciliationGuard";
import { isStrictProductionOrStaging } from "../config/env";
import { isTransactionSupported } from "../services/coupon/couponReservationService";
import {
  RecoveryCoordinatorService,
  WorkerLeaseHeartbeat,
  DEFAULT_LEASE_DURATION_MS,
} from "../services/recovery/recoveryCoordinatorService";
import { AppError } from "../utils/AppError";

export interface ReconcileCapturedPaymentOptions {
  orderRef?: string;
  razorpayPaymentId?: string;
  razorpayOrderId?: string;
  confirm?: boolean;
  revive?: boolean;
  skipGatewayCheck?: boolean;
  /** Skip mongoose.connect / disconnect when caller already manages the DB connection. */
  useExistingConnection?: boolean;
  /** Optional lock owner override (defaults to unique process/run identifier). */
  ownerId?: string;
  /** Optional WorkerLock lease duration in ms (defaults to DEFAULT_LEASE_DURATION_MS). */
  leaseDurationMs?: number;
  /** Optional heartbeat interval in ms. */
  heartbeatIntervalMs?: number;
  /** Injectable test hooks for deterministic failure-injection and concurrency testing. */
  hooks?: {
    startSession?: () => Promise<mongoose.ClientSession>;
    isTransactionSupportedFn?: (conn: mongoose.Connection) => boolean;
    processPaymentSuccessFn?: (
      razorpayOrderId: string,
      razorpayPaymentId?: string,
      options?: ProcessPaymentSuccessOptions
    ) => Promise<ProcessPaymentSuccessResult | null>;
    beforeTransactionStart?: () => Promise<void>;
    afterRecordReset?: (ctx: {
      session: mongoose.ClientSession;
      lockName: string;
      ownerId: string;
      fencingToken: number;
    }) => Promise<void>;
    beforeCommit?: (ctx: {
      session: mongoose.ClientSession;
      lockName: string;
      ownerId: string;
      fencingToken: number;
    }) => Promise<void>;
  };
}

export interface ReconcileCapturedPaymentResult {
  mode: "DRY_RUN" | "APPLY";
  idempotentNoOp?: boolean;
  committed?: boolean;
  orderId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  fencingToken?: number;
  processorResult?: ProcessPaymentSuccessResult | null;
}

export class ReconciliationAbortError extends AppError {
  constructor(message: string, code = "RECONCILIATION_ABORTED", statusCode = 400) {
    super(message, statusCode, code);
    this.name = "ReconciliationAbortError";
  }
}

function abort(message: string, code = "RECONCILIATION_ABORTED", statusCode = 400): never {
  throw new ReconciliationAbortError(message, code, statusCode);
}

export async function reconcileCapturedPayment(
  options: ReconcileCapturedPaymentOptions
): Promise<ReconcileCapturedPaymentResult> {
  const orderRef = options.orderRef;
  const razorpayPaymentId = options.razorpayPaymentId;
  let razorpayOrderId = options.razorpayOrderId;
  const shouldConfirm = Boolean(options.confirm);
  const shouldRevive = Boolean(options.revive);
  const skipGatewayCheck = Boolean(options.skipGatewayCheck);
  const leaseDurationMs = options.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
  const hooks = options.hooks ?? {};

  if (
    skipGatewayCheck &&
    (isStrictProductionOrStaging() ||
      process.env.NODE_ENV === "production" ||
      process.env.NODE_ENV === "staging")
  ) {
    abort(
      "--skip-gateway-check is strictly prohibited in production and staging environments.",
      "SKIP_GATEWAY_FORBIDDEN",
      403
    );
  }
  if (shouldConfirm && skipGatewayCheck) {
    abort(
      "--skip-gateway-check is allowed only for dry runs. Remove it before using --confirm.",
      "SKIP_GATEWAY_CONFIRM_FORBIDDEN",
      400
    );
  }
  if (!orderRef) {
    abort("Missing --order <orderNumber|ObjectId>. Nothing was changed.", "MISSING_ORDER_REF");
  }
  if (!razorpayPaymentId) {
    abort(
      "Missing --payment <pay_xxx>. The Razorpay payment id is required so the capture can be recorded.",
      "MISSING_PAYMENT_ID"
    );
  }

  let managedConnection = false;
  if (!options.useExistingConnection) {
    const uri = process.env.MONGODB_URI || process.env.Mongodb_URI;
    if (!uri) {
      abort(
        "MONGODB_URI / Mongodb_URI is not set. Export the production connection string before running this script.",
        "MISSING_MONGODB_URI",
        500
      );
    }
    const maskedUri = uri.replace(/\/\/([^:/@]+):([^@]+)@/, "//$1:***@");
    console.log(`[DB]     ${maskedUri}`);
    console.log(`[MODE]   ${shouldConfirm ? "APPLY (writes enabled)" : "DRY RUN (no writes)"}`);
    await mongoose.connect(uri);
    managedConnection = true;
  }

  try {
    const order = await Order.findOne(
      mongoose.Types.ObjectId.isValid(orderRef) ? { _id: orderRef } : { orderNumber: orderRef }
    );
    if (!order) abort(`Order not found for "${orderRef}".`, "ORDER_NOT_FOUND", 404);

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
      console.log(
        `  reconciliation    : ${
          payment.reconciliationRequired
            ? `REQUIRED (${payment.reconciliationReason || "no reason"})`
            : "no"
        }`
      );
    }

    console.log(`\n=== PAYMENT ATTEMPTS (${attempts.length}) ===`);
    for (const att of attempts) {
      console.log(
        `  ${att.razorpayOrderId} status=${att.status} pay=${att.razorpayPaymentId || "-"} ` +
          `code=${att.failureCode || "-"} reason=${att.failureReason || "-"} created=${
            att.createdAt?.toISOString?.() || "-"
          }`
      );
    }

    const refunds = await Refund.find({ orderId: order._id })
      .select("status amount reason razorpayRefundId")
      .lean();
    console.log(`\n=== REFUNDS (${refunds.length}) ===`);
    for (const refund of refunds) {
      console.log(
        `  ${refund.status} amount=${refund.amount} reason=${refund.reason || "-"} rzp=${
          refund.razorpayRefundId || "-"
        }`
      );
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
        abort(
          `Razorpay payment lookup did not return the requested payment id ${razorpayPaymentId}.`,
          "GATEWAY_PAYMENT_MISMATCH"
        );
      }
      if (entity.status !== "captured") {
        abort(
          `Razorpay reports status "${entity.status}" (not captured). No money to reconcile; do not mark the order paid.`,
          "GATEWAY_NOT_CAPTURED"
        );
      }
      if (!entity.order_id || (razorpayOrderId && entity.order_id !== razorpayOrderId)) {
        abort(
          `Payment belongs to Razorpay order "${entity.order_id || "(missing)"}", not the supplied ${
            razorpayOrderId || "(no order id supplied)"
          }.`,
          "GATEWAY_ORDER_MISMATCH"
        );
      }
      razorpayOrderId = entity.order_id;

      const expectedPaise = Math.round(order.total * 100);
      if (entity.amount !== expectedPaise) {
        abort(
          `Amount mismatch: gateway ${entity.amount} paise vs order ${expectedPaise} paise. Investigate manually.`,
          "GATEWAY_AMOUNT_MISMATCH"
        );
      }
      if (order.currency !== "INR" || entity.currency !== "INR" || entity.currency !== order.currency) {
        abort(
          `Currency mismatch or unsupported currency: payment ${entity.currency || "(missing)"}, order ${
            order.currency || "(missing)"
          }. Reconciliation requires INR.`,
          "GATEWAY_CURRENCY_MISMATCH"
        );
      }

      const gatewayOrder = (await client.orders.fetch(razorpayOrderId)) as unknown as {
        id?: string;
        amount?: number;
        currency?: string;
        notes?: Record<string, unknown>;
      } | null;
      if (!gatewayOrder || gatewayOrder.id !== razorpayOrderId) {
        abort(
          `Razorpay order lookup did not return the payment's exact order id ${razorpayOrderId}.`,
          "GATEWAY_ORDER_MISMATCH"
        );
      }
      if (gatewayOrder.amount !== expectedPaise) {
        abort(
          `Razorpay order amount mismatch: gateway ${gatewayOrder.amount} paise vs order ${expectedPaise} paise.`,
          "GATEWAY_AMOUNT_MISMATCH"
        );
      }
      if (
        order.currency !== "INR" ||
        gatewayOrder.currency !== "INR" ||
        gatewayOrder.currency !== order.currency
      ) {
        abort(
          `Currency mismatch or unsupported currency: Razorpay order ${
            gatewayOrder.currency || "(missing)"
          }, internal order ${order.currency || "(missing)"}. Reconciliation requires INR.`,
          "GATEWAY_CURRENCY_MISMATCH"
        );
      }
      if (gatewayOrder.notes?.internalOrderId !== order._id.toString()) {
        abort(
          `Razorpay order notes.internalOrderId does not match internal order ${order._id.toString()}.`,
          "GATEWAY_INTERNAL_ORDER_MISMATCH"
        );
      }

      console.log(
        `  payment ${entity.id}: status=${entity.status} order=${entity.order_id} amount=${entity.amount} ${entity.currency}`
      );
      console.log(
        `  order   ${gatewayOrder.id}: amount=${gatewayOrder.amount} ${gatewayOrder.currency} internalOrderId=${gatewayOrder.notes?.internalOrderId}`
      );
    } else {
      console.log("\n[WARN] Gateway verification skipped (--skip-gateway-check).");
    }

    if (!razorpayOrderId) {
      abort(
        "Could not determine the Razorpay order id. Pass --razorpay-order <order_xxx>.",
        "MISSING_RAZORPAY_ORDER_ID"
      );
    }

    // ── Webhook history for this Razorpay order ────────────────────────────────
    const events = await WebhookEvent.find({
      "payload.payload.payment.entity.order_id": razorpayOrderId,
    })
      .sort({ createdAt: 1 })
      .limit(20)
      .select("eventType status lastError processingAttempts createdAt")
      .lean();
    console.log(`\n=== WEBHOOK EVENTS for ${razorpayOrderId} (${events.length}) ===`);
    for (const evt of events) {
      console.log(
        `  ${evt.eventType} -> ${evt.status} attempts=${evt.processingAttempts} error=${
          evt.lastError || "-"
        }`
      );
    }

    // ── Guards ─────────────────────────────────────────────────────────────────
    // Load and validate PaymentAttempt and identity linkage BEFORE any already-PAID
    // short-circuit so a distinct second capture on an already-PAID order can never
    // be silently treated as an idempotent no-op.
    const attempt = await PaymentAttempt.findOne({ razorpayOrderId });
    if (!attempt) {
      abort(
        `No PaymentAttempt found for Razorpay order ${razorpayOrderId}. Refusing to invent payment state.`,
        "ATTEMPT_NOT_FOUND",
        404
      );
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
      abort(linkErr instanceof Error ? linkErr.message : String(linkErr), "LINKAGE_ERROR", 409);
    }

    const [existingLinkedPayment, existingLinkedAttempt] = await Promise.all([
      Payment.findOne({ razorpayPaymentId, orderId: { $ne: order._id } }),
      PaymentAttempt.findOne({ razorpayPaymentId, orderId: { $ne: order._id } }),
    ]);
    if (existingLinkedPayment) {
      abort(
        `Payment ${razorpayPaymentId} is already linked to another order ${existingLinkedPayment.orderId.toString()}. Refusing to apply.`,
        "PAYMENT_LINKED_ELSEWHERE",
        409
      );
    }
    if (existingLinkedAttempt) {
      abort(
        `Payment ${razorpayPaymentId} is already linked to another attempt on order ${existingLinkedAttempt.orderId.toString()}. Refusing to apply.`,
        "PAYMENT_LINKED_ELSEWHERE",
        409
      );
    }

    const isExactCapturedMatch = (
      orderDoc: { paymentStatus?: string; status?: string } | null,
      attemptDoc: { status?: string; razorpayPaymentId?: string } | null,
      paymentDoc: { status?: string; razorpayPaymentId?: string } | null,
      targetPaymentId: string
    ): boolean =>
      Boolean(
        orderDoc &&
          orderDoc.paymentStatus === "PAID" &&
          orderDoc.status !== "CANCELLED" &&
          orderDoc.status !== "EXPIRED" &&
          attemptDoc &&
          attemptDoc.status === "CAPTURED" &&
          attemptDoc.razorpayPaymentId === targetPaymentId &&
          paymentDoc &&
          paymentDoc.status === "CAPTURED" &&
          paymentDoc.razorpayPaymentId === targetPaymentId
      );

    // Detect distinct already-recorded capture BEFORE any already-PAID short-circuit.
    // Never overwrite the original payment identity and never return idempotentNoOp.
    const distinctAttemptPaymentId =
      attempt.razorpayPaymentId && attempt.razorpayPaymentId !== razorpayPaymentId
        ? attempt.razorpayPaymentId
        : undefined;
    const distinctPaymentRecordId =
      payment?.razorpayPaymentId && payment.razorpayPaymentId !== razorpayPaymentId
        ? payment.razorpayPaymentId
        : undefined;
    const originalRecordedPaymentId = distinctAttemptPaymentId || distinctPaymentRecordId;

    if (originalRecordedPaymentId) {
      const duplicateReason =
        `Duplicate capture ${razorpayPaymentId} detected for Razorpay order ${razorpayOrderId} ` +
        `on order ${order.orderNumber}; original captured payment ${originalRecordedPaymentId} preserved. ` +
        `Manual duplicate-capture refund/reconciliation required.`;

      if (shouldConfirm && payment) {
        const checkTxSupportForDup = hooks.isTransactionSupportedFn ?? isTransactionSupported;
        if (checkTxSupportForDup(mongoose.connection)) {
          const dupSession = await mongoose.startSession();
          try {
            dupSession.startTransaction({
              readConcern: { level: "snapshot" },
              writeConcern: { w: "majority" },
            });
            await Payment.updateOne(
              { _id: payment._id, reconciliationRequired: { $ne: true } },
              {
                $set: {
                  reconciliationRequired: true,
                  reconciliationReason: duplicateReason,
                },
              },
              { session: dupSession }
            );
            await dupSession.commitTransaction();
          } catch {
            if (dupSession.inTransaction()) {
              await dupSession.abortTransaction().catch(() => {});
            }
          } finally {
            await dupSession.endSession().catch(() => {});
          }
        }
      }

      abort(duplicateReason, "DUPLICATE_CAPTURE_DETECTED", 409);
    }

    if (order.paymentStatus === "PAID" && order.status !== "CANCELLED" && order.status !== "EXPIRED") {
      if (isExactCapturedMatch(order, attempt, payment, razorpayPaymentId)) {
        console.log(
          `\n[OK] Order is already PAID with exact CAPTURED payment ${razorpayPaymentId}. Nothing to do (idempotent no-op).`
        );
        return {
          mode: shouldConfirm ? "APPLY" : "DRY_RUN",
          idempotentNoOp: true,
          committed: false,
          orderId: order._id.toString(),
          razorpayOrderId,
          razorpayPaymentId,
        };
      }
      abort(
        `Order ${order.orderNumber} is already PAID, but stored Payment (${payment?.status || "missing"} / ${
          payment?.razorpayPaymentId || "none"
        }) and PaymentAttempt (${attempt.status} / ${
          attempt.razorpayPaymentId || "none"
        }) do not both confirm CAPTURED payment ${razorpayPaymentId}. Manual reconciliation required.`,
        "PAYMENT_RECONCILIATION_REQUIRED",
        409
      );
    }

    if (refunds.length > 0) {
      abort(
        "Refund records already exist for this order. Money may already be returned; resolve manually.",
        "REFUND_EXISTS",
        409
      );
    }
    if ((order.status === "CANCELLED" || order.status === "EXPIRED") && !shouldRevive) {
      abort(
        `Order is ${order.status}. If the customer should still receive the goods, re-run with --revive. ` +
          "Otherwise issue the refund instead of reviving the order.",
        "ORDER_CLOSED_REQUIRES_REVIVE",
        409
      );
    }

    // Dry-run mode MUST remain strictly read-only: no locks, no sessions, no DB writes.
    if (!shouldConfirm) {
      console.log(
        skipGatewayCheck ? "\n[DRY RUN - UNVERIFIED] Would perform:" : "\n[DRY RUN] Would perform:"
      );
      if (order.paymentStatus !== "PENDING") {
        console.log(`  - order.paymentStatus: ${order.paymentStatus} -> PENDING`);
      }
      if (shouldRevive && (order.status === "EXPIRED" || order.status === "CANCELLED")) {
        console.log(`  - order.status: ${order.status} -> PENDING`);
      }
      if (attempt.status === "FAILED") {
        console.log(
          `  - attempt ${attempt._id.toString()}: FAILED -> PENDING (clear failure fields)`
        );
      }
      if (payment && payment.status !== "PENDING") {
        console.log(`  - payment.status: ${payment.status} -> PENDING`);
      }
      console.log(`  - processPaymentSuccess(${razorpayOrderId}, ${razorpayPaymentId})`);
      if (skipGatewayCheck) {
        console.log(
          "\nGateway verification was skipped; this run is not eligible to apply. Re-run without --skip-gateway-check for a verified dry run."
        );
      } else {
        console.log("\nRe-run with --confirm to apply.");
      }
      return {
        mode: "DRY_RUN",
        committed: false,
        orderId: order._id.toString(),
        razorpayOrderId,
        razorpayPaymentId,
      };
    }

    // ── Fail-closed transaction requirement before ANY critical writes ─────────
    const checkTxSupport = hooks.isTransactionSupportedFn ?? isTransactionSupported;
    if (!checkTxSupport(mongoose.connection)) {
      abort(
        "RECONCILIATION_TRANSACTION_REQUIRED: --confirm mode strictly requires a MongoDB Replica Set or sharded cluster supporting multi-document transactions. Refusing non-transactional writes.",
        "RECONCILIATION_TRANSACTION_REQUIRED",
        503
      );
    }

    // ── Acquire exclusive fenced WorkerLock via existing coordinator architecture ──
    const lockName = `RECONCILIATION_ORDER_${order._id.toString()}`;
    const ownerId =
      options.ownerId || `reconcile_script_${process.pid}_${crypto.randomUUID().slice(0, 8)}`;

    const lease = await RecoveryCoordinatorService.acquireWorkerLease(
      lockName,
      ownerId,
      leaseDurationMs
    );
    if (!lease.acquired || typeof lease.fencingToken !== "number") {
      abort(
        `Could not acquire exclusive reconciliation lock for order ${order._id}. Another process may be reconciling this order.`,
        "LOCK_ACQUISITION_FAILED",
        409
      );
    }
    const fencingToken = lease.fencingToken;

    let session: mongoose.ClientSession | null = null;
    let inTx = false;
    let committed = false;
    let leaseLost = false;
    let heartbeat: WorkerLeaseHeartbeat | null = null;

    heartbeat = RecoveryCoordinatorService.startWorkerLeaseHeartbeat(
      lockName,
      ownerId,
      fencingToken,
      leaseDurationMs,
      {
        heartbeatIntervalMs: options.heartbeatIntervalMs,
        isTransactionActive: () => Boolean(session && session.inTransaction()),
        onLeaseLost: (reason) => {
          leaseLost = true;
          console.error(`[RECONCILE] ${reason}`);
        },
      }
    );

    const assertAndRenewFenceInTx = async (
      activeSession: mongoose.ClientSession,
      stageName: string
    ): Promise<void> => {
      if (leaseLost || heartbeat?.hasLostLease()) {
        leaseLost = true;
        throw new AppError(
          `Reconciliation worker lost lease ownership (${stageName}) for ${lockName}. Owner: ${ownerId}, Token: ${fencingToken}`,
          409,
          "WORKER_LEASE_FENCED_OUT"
        );
      }
      const renewStartedAt = Date.now();
      const renewed = await RecoveryCoordinatorService.renewWorkerLease(
        lockName,
        ownerId,
        fencingToken,
        leaseDurationMs,
        activeSession
      );
      if (!renewed) {
        leaseLost = true;
        heartbeat?.markLeaseLost(`Fenced out during ${stageName}`);
        throw new AppError(
          `Reconciliation worker lease fenced out or expired (${stageName}) for ${lockName}. Owner: ${ownerId}, Token: ${fencingToken}`,
          409,
          "WORKER_LEASE_FENCED_OUT"
        );
      }
      heartbeat?.extendLease(renewStartedAt + leaseDurationMs);
    };

    try {
      if (hooks.beforeTransactionStart) {
        await hooks.beforeTransactionStart();
      }

      if (leaseLost || heartbeat.hasLostLease()) {
        leaseLost = true;
        throw new AppError(
          `Reconciliation worker lost lease ownership before starting transaction for ${lockName}. Owner: ${ownerId}, Token: ${fencingToken}`,
          409,
          "WORKER_LEASE_FENCED_OUT"
        );
      }

      // Establish MongoDB session and transaction — MUST fail closed (never fall back).
      try {
        session = hooks.startSession
          ? await hooks.startSession()
          : await mongoose.startSession();
      } catch (sessionErr) {
        throw new ReconciliationAbortError(
          `TRANSACTION_SESSION_FAILED: Could not create MongoDB session for reconciliation: ${
            sessionErr instanceof Error ? sessionErr.message : String(sessionErr)
          }`,
          "TRANSACTION_SESSION_FAILED",
          500
        );
      }

      try {
        session.startTransaction({
          readConcern: { level: "snapshot" },
          writeConcern: { w: "majority" },
        });
        if (!session.inTransaction()) {
          throw new Error("Session did not enter an active transaction state");
        }
        inTx = true;
      } catch (txErr) {
        inTx = false;
        throw new ReconciliationAbortError(
          `TRANSACTION_STARTUP_FAILED: Could not start MongoDB transaction for reconciliation: ${
            txErr instanceof Error ? txErr.message : String(txErr)
          }`,
          "TRANSACTION_STARTUP_FAILED",
          500
        );
      }

      // Verify & touch WorkerLock inside transaction before any critical writes.
      await assertAndRenewFenceInTx(session, "transaction entry");

      // Re-check idempotency inside transaction snapshot in case another worker just committed.
      const [liveOrderInTx, liveAttemptInTx, livePaymentInTx] = await Promise.all([
        Order.findById(order._id).session(session),
        PaymentAttempt.findById(attempt._id).session(session),
        Payment.findOne({ orderId: order._id }).session(session),
      ]);
      const inTxDistinctId =
        (liveAttemptInTx?.razorpayPaymentId && liveAttemptInTx.razorpayPaymentId !== razorpayPaymentId
          ? liveAttemptInTx.razorpayPaymentId
          : undefined) ||
        (livePaymentInTx?.razorpayPaymentId && livePaymentInTx.razorpayPaymentId !== razorpayPaymentId
          ? livePaymentInTx.razorpayPaymentId
          : undefined);
      if (inTxDistinctId) {
        await session.abortTransaction().catch(() => {});
        inTx = false;
        abort(
          `Duplicate capture ${razorpayPaymentId} detected inside transaction for order ${order.orderNumber}; ` +
            `original payment ${inTxDistinctId} preserved. Manual reconciliation required.`,
          "DUPLICATE_CAPTURE_DETECTED",
          409
        );
      }
      if (
        liveOrderInTx &&
        liveOrderInTx.paymentStatus === "PAID" &&
        liveOrderInTx.status !== "CANCELLED" &&
        liveOrderInTx.status !== "EXPIRED"
      ) {
        await session.abortTransaction().catch(() => {});
        inTx = false;
        if (isExactCapturedMatch(liveOrderInTx, liveAttemptInTx, livePaymentInTx, razorpayPaymentId)) {
          console.log(
            `\n[OK] Order is already PAID with exact CAPTURED payment ${razorpayPaymentId} (verified in transaction). Idempotent no-op.`
          );
          return {
            mode: "APPLY",
            idempotentNoOp: true,
            committed: false,
            orderId: order._id.toString(),
            razorpayOrderId,
            razorpayPaymentId,
            fencingToken,
          };
        }
        abort(
          `Order ${order.orderNumber} became PAID inside transaction without matching CAPTURED Payment/PaymentAttempt for ${razorpayPaymentId}. Manual reconciliation required.`,
          "PAYMENT_RECONCILIATION_REQUIRED",
          409
        );
      }

      console.log("\n[APPLY] Resetting records to a claimable state...");
      await Order.updateOne(
        { _id: order._id, paymentStatus: { $ne: "PAID" } },
        { $set: { paymentStatus: "PENDING" } },
        { session }
      );
      if (shouldRevive) {
        await Order.updateOne(
          { _id: order._id, status: { $in: ["CANCELLED", "EXPIRED"] } },
          { $set: { status: "PENDING" } },
          { session }
        );
      }
      if (attempt.status === "FAILED") {
        await PaymentAttempt.updateOne(
          { _id: attempt._id, status: "FAILED" },
          { $set: { status: "PENDING" }, $unset: { failureCode: 1, failureReason: 1 } },
          { session }
        );
      }
      if (payment && payment.status !== "CAPTURED") {
        await Payment.updateOne(
          { _id: payment._id },
          { $set: { status: "PENDING" } },
          { session }
        );
      }

      if (hooks.afterRecordReset) {
        await hooks.afterRecordReset({ session, lockName, ownerId, fencingToken });
      }

      await assertAndRenewFenceInTx(session, "before processPaymentSuccess");

      console.log("[APPLY] Running processPaymentSuccess...");
      const runProcessor = hooks.processPaymentSuccessFn ?? processPaymentSuccess;
      const result = await runProcessor(razorpayOrderId, razorpayPaymentId, {
        session,
      });

      if (!result || !result.success) {
        if (session.inTransaction()) {
          await session.abortTransaction().catch(() => {});
        }
        inTx = false;
        console.warn(
          `[APPLY] processPaymentSuccess indicated failure: ${result?.reason || "UNKNOWN"}`
        );
      } else {
        if (hooks.beforeCommit) {
          await hooks.beforeCommit({ session, lockName, ownerId, fencingToken });
        }
        await assertAndRenewFenceInTx(session, "before commit");
        if (session.inTransaction()) {
          await session.commitTransaction();
          committed = true;
          inTx = false;
        } else {
          throw new ReconciliationAbortError(
            "TRANSACTION_NOT_ACTIVE_AT_COMMIT: Transaction was no longer active at commit time.",
            "TRANSACTION_NOT_ACTIVE_AT_COMMIT",
            500
          );
        }
      }

      const finalOrder = await Order.findById(order._id);
      const finalAttempt = await PaymentAttempt.findById(attempt._id);
      const finalPayment = await Payment.findOne({ orderId: order._id });
      const finalRefunds = await Refund.find({ orderId: order._id })
        .select("status amount reason")
        .lean();

      console.log("\n=== RESULT ===");
      console.log(
        `  success    : ${result ? String(result.success) : "null (attempt/order not found)"}`
      );
      console.log(`  reason     : ${result?.reason || "-"}`);
      console.log(`  order      : ${finalOrder?.status} / ${finalOrder?.paymentStatus}`);
      console.log(
        `  attempt    : ${finalAttempt?.status} (${
          finalAttempt?.razorpayPaymentId || "no payment id"
        })`
      );
      console.log(
        `  payment    : ${finalPayment?.status} (${
          finalPayment?.razorpayPaymentId || "no payment id"
        })`
      );
      console.log(`  refunds    : ${finalRefunds.length}`);

      if (finalOrder?.paymentStatus === "PAID" && finalOrder.status === "CONFIRMED") {
        console.log(
          "\n[OK] Payment reconciled. Order is CONFIRMED and invoice/notifications were scheduled."
        );
      } else if (result?.reason === "STOCK_UNAVAILABLE") {
        console.log(
          "\n[WARN] Stock was unavailable. A refund was created (see refunds above) and the order was cancelled."
        );
      } else {
        console.log(
          "\n[WARN] Order did not reach PAID/CONFIRMED. Re-run the dry run and inspect the values above."
        );
      }

      return {
        mode: "APPLY",
        committed,
        orderId: order._id.toString(),
        razorpayOrderId,
        razorpayPaymentId,
        fencingToken,
        processorResult: result,
      };
    } catch (applyErr) {
      if (inTx && session && session.inTransaction()) {
        await session.abortTransaction().catch(() => {});
        inTx = false;
      }
      throw applyErr;
    } finally {
      if (heartbeat) {
        heartbeat.stop();
        heartbeat = null;
      }
      if (session) {
        if (session.inTransaction()) {
          await session.abortTransaction().catch(() => {});
        }
        await session.endSession().catch(() => {});
      }
      if (!leaseLost) {
        await RecoveryCoordinatorService.releaseWorkerLease(
          lockName,
          ownerId,
          fencingToken
        ).catch(() => {});
      }
    }
  } finally {
    if (managedConnection) {
      await mongoose.disconnect().catch(() => undefined);
    }
  }
}

async function runCli(): Promise<void> {
  const argv = process.argv.slice(2);
  const hasFlag = (flag: string): boolean => argv.includes(flag);
  const flagValue = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    if (idx < 0) return undefined;
    const value = argv[idx + 1];
    return value && !value.startsWith("--") ? value : undefined;
  };

  try {
    await reconcileCapturedPayment({
      orderRef: flagValue("--order"),
      razorpayPaymentId: flagValue("--payment"),
      razorpayOrderId: flagValue("--razorpay-order"),
      confirm: hasFlag("--confirm"),
      revive: hasFlag("--revive"),
      skipGatewayCheck: hasFlag("--skip-gateway-check"),
      useExistingConnection: false,
    });
  } catch (err: unknown) {
    if (err instanceof ReconciliationAbortError) {
      console.error(`\n[ABORT] ${err.message}\n`);
      process.exitCode = 1;
      return;
    }
    console.error("\n[ERROR]", err instanceof Error ? err.message : err);
    if (err instanceof Error && err.stack) console.error(err.stack);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  runCli();
}
