import mongoose from 'mongoose';
import { Order } from '../models/Order';
import { Payment } from '../models/Payment';
import { PaymentAttempt } from '../models/PaymentAttempt';
import { InventoryTransaction } from '../models/InventoryTransaction';
import { releaseCouponReservation, isTransactionSupported } from './coupon/couponReservationService';
import { InventoryAllocationService } from './inventory/inventoryAllocationService';
import { isMockPaymentPermitted, razorpayProvider } from './payment/RazorpayProvider';

export const ORDER_EXPIRY_MS = Number(process.env.ORDER_EXPIRY_MS) || 15 * 60 * 1000;
export const ORDER_EXPIRY_INTERVAL_MS =
  Number(process.env.ORDER_EXPIRY_INTERVAL_MS) || 5 * 60 * 1000;

const IN_FLIGHT_STATUSES = ['AUTHORIZED', 'PROCESSING', 'CAPTURED'];
const DEFAULT_BATCH_LIMIT = 50;
const MAX_BATCH_LIMIT = 100;

/**
 * Authoritative gateway view of an order's payment state.
 *
 * - UNPAID: the gateway has no captured or in-flight payment; expiry is safe.
 * - IN_FLIGHT: an authorized/processing payment exists; leave the order alone.
 * - CAPTURED: money was captured; never expire the order.
 * - UNKNOWN: the gateway could not be verified; fail closed and retry later.
 */
export type GatewayPaymentState = 'UNPAID' | 'IN_FLIGHT' | 'CAPTURED' | 'UNKNOWN';

export interface GatewayPaymentVerification {
  state: GatewayPaymentState;
  razorpayOrderIds: string[];
  reason?: string;
}

export type GatewayPaymentVerifier = (params: {
  orderId: string;
  razorpayOrderIds: string[];
  razorpayPaymentIds: string[];
}) => Promise<GatewayPaymentVerification>;

export interface ExpireStalePendingOrdersOptions {
  /** Reference time, defaults to now. */
  now?: Date;
  /** Maximum candidates inspected in a single invocation (bounded 1..100). */
  batchLimit?: number;
  /** Distributed recovery lease check; abort the sweep when it returns false. */
  leaseGuard?: () => Promise<boolean> | boolean;
  /** Fenced transaction wrapper provided by RecoveryCoordinatorService. */
  withFence?: <T>(fn: (session: mongoose.ClientSession) => Promise<T>) => Promise<T>;
  /** Injectable gateway verifier for tests and incident rehearsal. */
  verifyGatewayPaymentState?: GatewayPaymentVerifier;
  /** Optional test hook fired after gateway check, immediately before atomic expiry transition. */
  onBeforeAtomicExpiry?: (orderId: string) => Promise<void>;
}

export interface ExpireStalePendingOrdersResult {
  expired: number;
  skippedCaptured: number;
  skippedInFlight: number;
  skippedUnverified: number;
  inventoryRestoredCount: number;
  errors: string[];
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Reads the authoritative Razorpay state for every gateway order referenced by
 * an order's payment attempts. Any transport failure is reported as UNKNOWN so
 * the caller fails closed rather than expiring an order that may hold money.
 */
async function verifyGatewayPaymentStateWithRazorpay(params: {
  orderId: string;
  razorpayOrderIds: string[];
  razorpayPaymentIds: string[];
}): Promise<GatewayPaymentVerification> {
  const { razorpayOrderIds } = params;
  const razorpayPaymentIds = Array.from(
    new Set(
      (params.razorpayPaymentIds || []).filter(
        (value): value is string => typeof value === 'string' && value.length > 0
      )
    )
  );

  if (razorpayOrderIds.length === 0 && razorpayPaymentIds.length === 0) {
    return { state: 'UNPAID', razorpayOrderIds };
  }

  let sawInFlight = false;

  // A payment identifier is the strongest local evidence that money moved. Read
  // it directly from the gateway before trusting any order-level summary.
  for (const razorpayPaymentId of razorpayPaymentIds) {
    if (razorpayPaymentId.startsWith('pay_mock_') || razorpayPaymentId.startsWith('order_mock_')) {
      if (!isMockPaymentPermitted()) {
        return {
          state: 'UNKNOWN',
          razorpayOrderIds,
          reason: `Mock payment identifier ${razorpayPaymentId} cannot be trusted outside mock mode`,
        };
      }
      continue;
    }

    let gatewayPayment;
    try {
      gatewayPayment = await razorpayProvider.fetchPayment(razorpayPaymentId);
    } catch (err: unknown) {
      return {
        state: 'UNKNOWN',
        razorpayOrderIds,
        reason: `Razorpay payment ${razorpayPaymentId} could not be verified: ${errorMessage(err)}`,
      };
    }

    if (gatewayPayment?.status === 'captured' || gatewayPayment?.captured === true) {
      return {
        state: 'CAPTURED',
        razorpayOrderIds,
        reason: `Razorpay payment ${razorpayPaymentId} is captured`,
      };
    }
    if (gatewayPayment?.status === 'authorized' || gatewayPayment?.status === 'created') {
      sawInFlight = true;
    }
  }

  for (const razorpayOrderId of razorpayOrderIds) {
    if (!razorpayOrderId) continue;

    // Mock gateway identifiers cannot be verified against Razorpay. They may
    // only be treated as unpaid in an explicit non-production mock environment.
    if (razorpayOrderId.startsWith('order_mock_') || razorpayOrderId.startsWith('pay_mock_')) {
      if (!isMockPaymentPermitted()) {
        return {
          state: 'UNKNOWN',
          razorpayOrderIds,
          reason: `Mock gateway identifier ${razorpayOrderId} cannot be trusted outside mock mode`,
        };
      }
      continue;
    }

    let gatewayOrder;
    try {
      gatewayOrder = await razorpayProvider.fetchOrder(razorpayOrderId);
    } catch (err: unknown) {
      return {
        state: 'UNKNOWN',
        razorpayOrderIds,
        reason: `Razorpay order ${razorpayOrderId} could not be verified: ${errorMessage(err)}`,
      };
    }

    if (gatewayOrder?.status === 'paid' || Number(gatewayOrder?.amount_paid) > 0) {
      return {
        state: 'CAPTURED',
        razorpayOrderIds,
        reason: `Razorpay order ${razorpayOrderId} is ${gatewayOrder?.status || 'paid'} with amount_paid=${gatewayOrder?.amount_paid ?? 'unknown'}`,
      };
    }

    let payments;
    try {
      payments = await razorpayProvider.fetchOrderPayments(razorpayOrderId);
    } catch (err: unknown) {
      return {
        state: 'UNKNOWN',
        razorpayOrderIds,
        reason: `Payments for Razorpay order ${razorpayOrderId} could not be verified: ${errorMessage(err)}`,
      };
    }

    const items = Array.isArray(payments?.items) ? payments.items : [];
    for (const payment of items) {
      if (payment?.status === 'captured' || payment?.captured === true) {
        return {
          state: 'CAPTURED',
          razorpayOrderIds,
          reason: `Razorpay payment ${payment.id} for order ${razorpayOrderId} is captured`,
        };
      }
      if (payment?.status === 'authorized' || payment?.status === 'created') {
        sawInFlight = true;
      }
    }

    // `attempted` with no payment rows still means a checkout attempt exists;
    // refuse to expire until the gateway reports a terminal failed state.
    if (gatewayOrder?.status === 'attempted' && items.length === 0) {
      sawInFlight = true;
    }
  }

  return { state: sawInFlight ? 'IN_FLIGHT' : 'UNPAID', razorpayOrderIds };
}

/**
 * Marks a locally-pending payment for reconciliation when the gateway shows
 * money captured but the order was never moved to PAID. This is an idempotent
 * safety flag only; it never refunds or changes payment amounts.
 */
async function flagCapturedPaymentForReconciliation(
  orderId: mongoose.Types.ObjectId,
  reason: string
): Promise<void> {
  await Payment.updateOne(
    { orderId, reconciliationRequired: { $ne: true } },
    { $set: { reconciliationRequired: true, reconciliationReason: reason } }
  );
}

/**
 * Expire PENDING orders older than ORDER_EXPIRY_MS after verifying the
 * authoritative gateway state.
 *
 * Design notes:
 * - Unpaid PENDING orders hold NO inventory reservation: stock is only
 *   decremented at capture. The reaper therefore does not touch product stock
 *   unless a SALE ledger row proves a partial capture residue exists, in which
 *   case the idempotent restoration path releases it exactly once.
 * - A captured (or authorized/processing) gateway payment always wins over
 *   expiry. Gateway transport failures fail closed as UNKNOWN.
 * - Orders with an in-flight PaymentAttempt (AUTHORIZED / PROCESSING / CAPTURED)
 *   are left alone, as are orders already paid or confirmed.
 * - Pending attempts are atomically failed before the order update, preventing a
 *   concurrent PENDING -> in-flight transition; the order update also re-checks
 *   status, paymentStatus, and age.
 */
export async function expireStalePendingOrders(
  options: ExpireStalePendingOrdersOptions = {}
): Promise<ExpireStalePendingOrdersResult> {
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - ORDER_EXPIRY_MS);
  const batchLimit = Math.min(
    Math.max(Math.trunc(options.batchLimit ?? DEFAULT_BATCH_LIMIT), 1),
    MAX_BATCH_LIMIT
  );
  const verifier = options.verifyGatewayPaymentState ?? verifyGatewayPaymentStateWithRazorpay;

  const result: ExpireStalePendingOrdersResult = {
    expired: 0,
    skippedCaptured: 0,
    skippedInFlight: 0,
    skippedUnverified: 0,
    inventoryRestoredCount: 0,
    errors: [],
  };

  const candidates = await Order.aggregate([
    { $match: { status: 'PENDING', paymentStatus: 'PENDING', updatedAt: { $lte: cutoff } } },
    {
      $lookup: {
        from: 'paymentattempts',
        localField: '_id',
        foreignField: 'orderId',
        as: 'attempts',
      },
    },
    {
      $match: {
        attempts: { $not: { $elemMatch: { status: { $in: IN_FLIGHT_STATUSES } } } },
      },
    },
    { $sort: { updatedAt: 1 } },
    { $project: { _id: 1 } },
    { $limit: batchLimit },
  ]);

  for (const candidate of candidates) {
    if (options.leaseGuard) {
      const validLease = await options.leaseGuard();
      if (!validLease) {
        result.errors.push(
          'Order expiry aborted: distributed recovery lease is no longer held'
        );
        break;
      }
    }

    const orderId = candidate._id as mongoose.Types.ObjectId;
    const attempts = await PaymentAttempt.find({ orderId }).lean();
    const razorpayOrderIds = Array.from(
      new Set(
        attempts
          .map((attempt) => attempt.razorpayOrderId)
          .filter((value): value is string => typeof value === 'string' && value.length > 0)
      )
    );

    // A capture can win the race after candidate selection but before this
    // point. Re-check the local in-flight state before asking the gateway.
    if (attempts.some((attempt) => IN_FLIGHT_STATUSES.includes(attempt.status))) {
      result.skippedInFlight += 1;
      continue;
    }

    const payment = await Payment.findOne({ orderId })
      .select('status reconciliationRequired razorpayPaymentId')
      .lean();

    const razorpayPaymentIds = Array.from(
      new Set(
        [
          ...attempts.map((attempt) => attempt.razorpayPaymentId),
          payment?.razorpayPaymentId,
        ].filter((value): value is string => typeof value === 'string' && value.length > 0)
      )
    );

    if (payment?.status === 'CAPTURED' || payment?.status === 'AUTHORIZED') {
      if (payment.status === 'CAPTURED') {
        result.skippedCaptured += 1;
        await flagCapturedPaymentForReconciliation(
          orderId,
          'Payment is CAPTURED locally while the order is still PENDING; expiry refused and reconciliation required'
        );
      } else {
        result.skippedInFlight += 1;
      }
      continue;
    }

    let verification: GatewayPaymentVerification;
    try {
      verification = await verifier({
        orderId: orderId.toString(),
        razorpayOrderIds,
        razorpayPaymentIds,
      });
    } catch (err: unknown) {
      verification = {
        state: 'UNKNOWN',
        razorpayOrderIds,
        reason: `Gateway verification threw: ${errorMessage(err)}`,
      };
    }

    if (verification.state === 'CAPTURED') {
      result.skippedCaptured += 1;
      await flagCapturedPaymentForReconciliation(
        orderId,
        `Razorpay reports a captured payment for pending order ${orderId}: ${verification.reason || 'capture detected'}`
      ).catch((flagErr: unknown) => {
        result.errors.push(
          `Could not flag captured pending order ${orderId} for reconciliation: ${errorMessage(flagErr)}`
        );
      });
      continue;
    }

    if (verification.state === 'IN_FLIGHT') {
      result.skippedInFlight += 1;
      continue;
    }

    if (verification.state === 'UNKNOWN') {
      result.skippedUnverified += 1;
      result.errors.push(
        `Order ${orderId} was not expired because the Razorpay payment state could not be verified: ${
          verification.reason || 'gateway state unknown'
        }`
      );
      continue;
    }

    if (options.onBeforeAtomicExpiry) {
      await options.onBeforeAtomicExpiry(orderId.toString());
    }

    // Re-check distributed lease ownership AFTER the potentially slow gateway call
    // and BEFORE performing any state-changing writes.
    if (options.leaseGuard) {
      const validLeaseAfterVerify = await options.leaseGuard();
      if (!validLeaseAfterVerify) {
        result.errors.push(
          'Order expiry aborted: distributed recovery lease is no longer held after gateway verification'
        );
        break;
      }
    }

    type AtomicExpiryOutcome = 'EXPIRED' | 'IN_FLIGHT' | 'CAPTURED' | 'SKIPPED';

    const expireOrderAtomically = async (
      session?: mongoose.ClientSession
    ): Promise<AtomicExpiryOutcome> => {
      const inFlightAttempt = await PaymentAttempt.exists({
        orderId,
        status: { $in: IN_FLIGHT_STATUSES },
      } as any).session(session || null);
      if (inFlightAttempt) {
        return 'IN_FLIGHT';
      }

      const livePayment = await Payment.findOne({ orderId })
        .select('status')
        .session(session || null)
        .lean();
      if (livePayment?.status === 'CAPTURED') {
        return 'CAPTURED';
      }
      if (livePayment?.status === 'AUTHORIZED') {
        return 'IN_FLIGHT';
      }

      const updateRes = await Order.updateOne(
        {
          _id: orderId,
          status: 'PENDING',
          paymentStatus: 'PENDING',
          updatedAt: { $lte: cutoff },
          $or: [
            { paymentAttemptLockExpiresAt: { $exists: false } },
            { paymentAttemptLockExpiresAt: null },
            { paymentAttemptLockExpiresAt: { $lte: now } },
          ],
        },
        {
          $set: {
            status: 'EXPIRED',
            paymentStatus: 'FAILED',
            expiryCleanup: {
              inventoryRestored: false,
              couponReleased: false,
              cleanupRequired: true,
              lastAttemptAt: new Date(),
            },
          },
        },
        { session: session || undefined }
      );
      if (updateRes.modifiedCount !== 1) {
        return 'SKIPPED';
      }

      // Only fail attempts that are STILL PENDING after the Order transition succeeded;
      // never overwrite PROCESSING, AUTHORIZED, or CAPTURED attempts.
      await PaymentAttempt.updateMany(
        { orderId, status: 'PENDING' },
        {
          $set: {
            status: 'FAILED',
            failureCode: 'PAYMENT_EXPIRED',
            failureReason: 'Order expired after 15 minutes without payment',
          },
        },
        { session: session || undefined }
      );

      return 'EXPIRED';
    };

    let atomicOutcome: AtomicExpiryOutcome = 'SKIPPED';
    try {
      if (options.withFence) {
        atomicOutcome = await options.withFence(async (session) => expireOrderAtomically(session));
      } else if (isTransactionSupported(mongoose.connection)) {
        const session = await mongoose.startSession();
        try {
          session.startTransaction({
            readConcern: { level: 'snapshot' },
            writeConcern: { w: 'majority' },
          });
          atomicOutcome = await expireOrderAtomically(session);
          if (atomicOutcome === 'EXPIRED' && session.inTransaction()) {
            await session.commitTransaction();
          } else if (session.inTransaction()) {
            await session.abortTransaction().catch(() => {});
          }
        } catch (txErr: unknown) {
          if (session.inTransaction()) {
            await session.abortTransaction().catch(() => {});
          }
          throw txErr;
        } finally {
          await session.endSession().catch(() => {});
        }
      } else {
        atomicOutcome = await expireOrderAtomically();
      }
    } catch (atomicErr: unknown) {
      const errCode =
        atomicErr && typeof atomicErr === 'object' && 'code' in atomicErr
          ? (atomicErr as { code?: unknown }).code
          : undefined;
      if (errCode === 'WORKER_LEASE_FENCED_OUT') {
        result.errors.push(
          `Order expiry aborted: ${errorMessage(atomicErr)}`
        );
        break;
      }
      // WriteConflict (code 112) means a concurrent worker/payment modified this order or attempt;
      // fail closed for this candidate without failing the rest of the batch.
      if (errCode === 112) {
        result.skippedInFlight += 1;
        continue;
      }
      result.errors.push(
        `Order expiry transition failed for order ${orderId}: ${errorMessage(atomicErr)}`
      );
      continue;
    }

    if (atomicOutcome === 'IN_FLIGHT') {
      result.skippedInFlight += 1;
      continue;
    }
    if (atomicOutcome === 'CAPTURED') {
      result.skippedCaptured += 1;
      await flagCapturedPaymentForReconciliation(
        orderId,
        'Payment became CAPTURED concurrently while expiring order; expiry refused and reconciliation required'
      ).catch((flagErr: unknown) => {
        result.errors.push(
          `Could not flag captured pending order ${orderId} for reconciliation: ${errorMessage(flagErr)}`
        );
      });
      continue;
    }
    if (atomicOutcome !== 'EXPIRED') {
      continue;
    }

    result.expired += 1;

    // Release inventory only when a SALE ledger row proves stock was already
    // decremented (partial-capture residue). The restoration path is idempotent
    // and keyed by the order so a repeated sweep cannot double-restore.
    let inventoryRestored = false;
    let inventoryError: string | undefined;
    try {
      const hasSaleLedgerEntry = await InventoryTransaction.exists({
        orderId,
        type: 'SALE',
      } as any);
      if (hasSaleLedgerEntry) {
        const restoreRes = await InventoryAllocationService.restoreCancelledOrderInventory(
          orderId,
          { reason: 'ORDER_EXPIRED' }
        );
        result.inventoryRestoredCount += restoreRes.restoredCount;
      }
      inventoryRestored = true;
    } catch (restoreErr: unknown) {
      inventoryError = errorMessage(restoreErr);
      result.errors.push(
        `Inventory restoration failed for expired order ${orderId}: ${inventoryError}`
      );
    }

    let couponReleased = false;
    let couponError: string | undefined;
    try {
      await releaseCouponReservation(orderId, 'ORDER_EXPIRED');
      couponReleased = true;
    } catch (releaseErr: unknown) {
      couponError = errorMessage(releaseErr);
      result.errors.push(
        `Coupon reservation release failed for expired order ${orderId}: ${couponError}`
      );
      console.error(JSON.stringify({
        level: 'ERROR',
        event: 'COUPON_RELEASE_FAILURE',
        orderId: orderId.toString(),
        reason: 'ORDER_EXPIRED',
        message: couponError,
      }));
    }

    const allClean = inventoryRestored && couponReleased;
    const lastError = [inventoryError, couponError].filter(Boolean).join('; ') || undefined;
    await Order.updateOne(
      { _id: orderId },
      {
        $set: {
          'expiryCleanup.inventoryRestored': inventoryRestored,
          'expiryCleanup.couponReleased': couponReleased,
          'expiryCleanup.cleanupRequired': !allClean,
          'expiryCleanup.lastAttemptAt': new Date(),
          ...(lastError ? { 'expiryCleanup.lastError': lastError } : {}),
          ...(allClean ? { 'expiryCleanup.completedAt': new Date() } : {}),
        },
      }
    );
  }

  return result;
}

export interface ReconcilePendingExpiryCleanupsOptions {
  batchLimit?: number;
  leaseGuard?: () => Promise<boolean> | boolean;
  withFence?: <T>(fn: (session: mongoose.ClientSession) => Promise<T>) => Promise<T>;
}

export interface ReconcilePendingExpiryCleanupsResult {
  inspectedCount: number;
  cleanedCount: number;
  errors: string[];
}

/**
 * Sweeps and completes any unfinished inventory restoration or coupon release
 * for orders that were marked EXPIRED. Independent of PENDING orders.
 */
export async function reconcilePendingExpiryCleanups(
  options: ReconcilePendingExpiryCleanupsOptions = {}
): Promise<ReconcilePendingExpiryCleanupsResult> {
  const batchLimit = Math.min(Math.max(Math.trunc(options.batchLimit ?? DEFAULT_BATCH_LIMIT), 1), MAX_BATCH_LIMIT);
  const result: ReconcilePendingExpiryCleanupsResult = {
    inspectedCount: 0,
    cleanedCount: 0,
    errors: [],
  };

  const pendingOrders = await Order.find({
    status: 'EXPIRED',
    'expiryCleanup.cleanupRequired': true,
  })
    .sort({ 'expiryCleanup.lastAttemptAt': 1 })
    .limit(batchLimit);

  for (const order of pendingOrders) {
    if (options.leaseGuard && !(await options.leaseGuard())) {
      result.errors.push('Expiry cleanup reconciliation aborted: lease guard failed');
      break;
    }

    result.inspectedCount += 1;
    let inventoryRestored = Boolean(order.expiryCleanup?.inventoryRestored);
    let couponReleased = Boolean(order.expiryCleanup?.couponReleased);
    let inventoryError: string | undefined;
    let couponError: string | undefined;

    if (!inventoryRestored) {
      try {
        const hasSaleLedgerEntry = await InventoryTransaction.exists({
          orderId: order._id,
          type: 'SALE',
        } as any);
        if (hasSaleLedgerEntry) {
          await InventoryAllocationService.restoreCancelledOrderInventory(order._id, {
            reason: 'ORDER_EXPIRED_RECOVERY',
          });
        }
        inventoryRestored = true;
      } catch (err: unknown) {
        inventoryError = errorMessage(err);
        result.errors.push(`Recovery inventory restoration failed for order ${order._id}: ${inventoryError}`);
      }
    }

    if (!couponReleased) {
      try {
        await releaseCouponReservation(order._id, 'ORDER_EXPIRED_RECOVERY');
        couponReleased = true;
      } catch (err: unknown) {
        couponError = errorMessage(err);
        result.errors.push(`Recovery coupon release failed for order ${order._id}: ${couponError}`);
      }
    }

    const allClean = inventoryRestored && couponReleased;
    const lastError = [inventoryError, couponError].filter(Boolean).join('; ') || undefined;

    const performUpdate = async (session?: mongoose.ClientSession) => {
      await Order.updateOne(
        { _id: order._id },
        {
          $set: {
            'expiryCleanup.inventoryRestored': inventoryRestored,
            'expiryCleanup.couponReleased': couponReleased,
            'expiryCleanup.cleanupRequired': !allClean,
            'expiryCleanup.lastAttemptAt': new Date(),
            ...(lastError ? { 'expiryCleanup.lastError': lastError } : {}),
            ...(allClean ? { 'expiryCleanup.completedAt': new Date() } : {}),
          },
        },
        { session: session || undefined }
      );
    };

    try {
      if (options.withFence) {
        await options.withFence(performUpdate);
      } else {
        await performUpdate();
      }
      if (allClean) {
        result.cleanedCount += 1;
      }
    } catch (writeErr: unknown) {
      result.errors.push(`Failed to update expiry cleanup state for order ${order._id}: ${errorMessage(writeErr)}`);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Scheduler (not started under NODE_ENV=test so suites drive the reaper directly)
// ---------------------------------------------------------------------------

let schedulerTimer: NodeJS.Timeout | null = null;

function isExternalRecoveryEnabled(): boolean {
  return process.env.DISABLE_EMBEDDED_RECOVERY === 'true';
}

function isServerlessHost(): boolean {
  return Boolean(
    process.env.VERCEL ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.NETLIFY ||
    process.env.CF_PAGES
  );
}

export function startOrderExpiryScheduler(): void {
  if (schedulerTimer) return;
  if (process.env.NODE_ENV === 'test') return;

  // When recovery is delegated to an external scheduler, order expiry is part
  // of the coordinated cycle at GET/POST /api/ops/recovery/run. Starting an
  // in-process timer here would silently create a second recovery architecture.
  if (isExternalRecoveryEnabled()) {
    console.log(
      '[ORDER_EXPIRY] DISABLE_EMBEDDED_RECOVERY=true: order expiry runs inside the external coordinated recovery cycle.'
    );
    return;
  }

  if (isServerlessHost()) {
    console.warn(
      '[ORDER_EXPIRY] Serverless host detected; the in-process expiry timer is frozen between requests. Schedule /api/ops/recovery/run externally instead.'
    );
    return;
  }

  const run = async (): Promise<void> => {
    try {
      const { expired } = await expireStalePendingOrders();
      if (expired > 0) {
        console.warn(`[ORDER_EXPIRY] Expired ${expired} stale pending order(s)`);
      }
    } catch (err) {
      console.error('[ORDER_EXPIRY] Reaper run failed:', err);
    }
  };

  run();
  schedulerTimer = setInterval(run, ORDER_EXPIRY_INTERVAL_MS);
  if (typeof (schedulerTimer as any).unref === 'function') {
    (schedulerTimer as any).unref();
  }
}

export function stopOrderExpiryScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}
