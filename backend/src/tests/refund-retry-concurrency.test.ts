/**
 * Regression suite: retried FAILED operation-scoped refunds.
 *
 * Scenario 1 (concurrency): two concurrent retries with the same operationId must create
 * exactly one reservation for the new attempt and let exactly one caller own the retry
 * claim. Prior to the fix, both replays pushed an identical `_attN` reservation and both
 * incremented pendingRefundAmount, silently over-reserving the refundable balance.
 *
 * Scenarios 2 and 3 (settlement): a retry that the gateway queues (`pending`) holds an
 * attempt-scoped `${refundId}_attN` reservation. The later refund.processed / refund.failed
 * webhook must settle that reservation rather than assume the initial `${refundId}` id.
 * Prior to the fix, retries stayed PENDING forever and forced manual reconciliation.
 */

process.env.NODE_ENV = 'test';
process.env.RAZORPAY_KEY_ID = 'rzp_test_mock';
process.env.RAZORPAY_KEY_SECRET = 'mock_secret_test';
process.env.RAZORPAY_WEBHOOK_SECRET = 'mock_webhook_secret_test';
process.env.ALLOW_PAYMENT_MOCK = 'true';

import crypto from 'crypto';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();
import { connectSafeTestDb } from './testHelpers';
import { Order } from '../models/Order';
import { Payment } from '../models/Payment';
import { PaymentAttempt } from '../models/PaymentAttempt';
import { Refund } from '../models/Refund';
import { createInternalRefund } from '../services/payment/refundService';
import { handleRefundProcessedEntity, handleRefundFailedEntity } from '../controllers/webhookController';
import { razorpayProvider } from '../services/payment/RazorpayProvider';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(condition: boolean, desc: string, detail?: string): void {
  if (condition) {
    passed++;
    console.log(`  ✅ PASS: ${desc}`);
  } else {
    failed++;
    const msg = detail ? `${desc} — ${detail}` : desc;
    failures.push(msg);
    console.error(`  ❌ FAIL: ${msg}`);
  }
}

const defaultShippingAddress = {
  fullName: 'Customer',
  phone: '9876543210',
  addressLine1: 'Park St',
  city: 'Kolkata',
  state: 'WB',
  postalCode: '700016',
  country: 'India',
};

function operationHash(orderId: string, operationId: string): string {
  return crypto.createHash('sha256').update(`${orderId}_${operationId}`).digest('hex').slice(0, 24);
}

async function run(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║   Refund FAILED-retry concurrency regression suite                    ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

  try {
    await connectSafeTestDb();
    console.log(`Connected to verified isolated test database: "${mongoose.connection.name}"\n`);

    const userId = new mongoose.Types.ObjectId();
    const adminId = new mongoose.Types.ObjectId();
    const now = Date.now();

    const order: any = await Order.create({
      orderNumber: `ORD-RETRY-RACE-${now}`,
      userId,
      items: [],
      subtotal: 1000,
      total: 1000,
      currency: 'INR',
      status: 'CANCELLED',
      paymentStatus: 'PAID',
      shippingAddress: defaultShippingAddress,
    });

    const gatewayPaymentId = `pay_retry_race_${now}`;
    const payment: any = await Payment.create({
      orderId: order._id,
      userId,
      amount: 1000,
      currency: 'INR',
      status: 'CAPTURED',
      provider: 'RAZORPAY',
      razorpayPaymentId: gatewayPaymentId,
      refundedAmount: 0,
      pendingRefundAmount: 0,
      refundReservations: [],
    });

    await PaymentAttempt.create({
      paymentId: payment._id,
      orderId: order._id,
      razorpayOrderId: `order_retry_race_${now}`,
      razorpayPaymentId: gatewayPaymentId,
      amount: 1000,
      currency: 'INR',
      status: 'CAPTURED',
    });

    const operationId = `op_retry_race_${now}`;
    const opHash = operationHash(order._id.toString(), operationId);
    const refundAmount = 300;

    // Simulate a definitive rejection: FAILED refund with its reservation already released.
    const failedRefund: any = await Refund.create({
      orderId: order._id,
      paymentId: payment._id,
      userId,
      attemptNumber: 1,
      idempotencyKey: `rfnd_op_${opHash}`,
      gatewayIdempotencyKey: `rfnd_op_${opHash}`,
      amount: refundAmount,
      currency: 'INR',
      status: 'FAILED',
      submissionState: 'CONFIRMED',
      accountingSettlementStatus: 'COMPLETED',
      failureReason: 'Gateway rejected refund',
      razorpayPaymentId: gatewayPaymentId,
      initiatedBy: adminId,
      initiatedByRole: 'ADMIN',
    });

    let gatewayDispatches = 0;
    razorpayProvider.createRefund = async (_paymentId: string, amountInPaise: number) => {
      gatewayDispatches++;
      return {
        id: `rfnd_retry_race_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        entity: 'refund',
        amount: amountInPaise,
        status: 'processed',
      } as any;
    };

    // Deterministically interleave the two callers: both must read the FAILED refund
    // before either can reserve or claim it.
    const originalFindOne = Refund.findOne.bind(Refund);
    const barrierWaiters: Array<() => void> = [];
    (Refund as any).findOne = (filter: any, ...args: any[]) => {
      const isOperationLookup = Boolean(
        filter &&
          Array.isArray(filter.$or) &&
          filter.$or.some((clause: any) => {
            if (typeof clause?.gatewayIdempotencyKey === 'string' && clause.gatewayIdempotencyKey.startsWith('rfnd_op_')) return true;
            if (clause?.idempotencyKey instanceof RegExp && clause.idempotencyKey.source.startsWith('^rfnd_op_')) return true;
            return false;
          })
      );
      if (!isOperationLookup) {
        return originalFindOne(filter, ...args);
      }
      const awaitBarrier = () =>
        new Promise((resolve, reject) => {
          barrierWaiters.push(() => {
            originalFindOne(filter, ...args)
              .sort({ attemptNumber: -1, createdAt: -1 })
              .then(resolve, reject);
          });
          if (barrierWaiters.length >= 2) {
            const runnable = barrierWaiters.splice(0);
            runnable.forEach((fn) => fn());
          }
        });
      return { sort: awaitBarrier };
    };

    let results: PromiseSettledResult<any>[];
    try {
      results = await Promise.allSettled([
        createInternalRefund({
          orderId: order._id.toString(),
          operationId,
          amount: refundAmount,
          reason: 'Concurrent retry A',
          actorId: adminId.toString(),
          actorRole: 'ADMIN',
        }),
        createInternalRefund({
          orderId: order._id.toString(),
          operationId,
          amount: refundAmount,
          reason: 'Concurrent retry B',
          actorId: adminId.toString(),
          actorRole: 'ADMIN',
        }),
      ]);
    } finally {
      (Refund as any).findOne = originalFindOne;
    }

    const finalPayment: any = await Payment.findById(payment._id);
    const finalRefund: any = await Refund.findById(failedRefund._id);
    const refundDocs = await Refund.find({ orderId: order._id });

    const retryReservations = (finalPayment?.refundReservations || []).filter(
      (r: any) => r.reservationId === `${failedRefund._id}_att2`
    );
    const pendingRetryReservations = retryReservations.filter((r: any) => r.status === 'PENDING');
    const totalCommitted = (finalPayment?.refundedAmount || 0) + (finalPayment?.pendingRefundAmount || 0);
    const fulfilled = results.filter((r) => r.status === 'fulfilled').length;

    check(finalRefund?.attemptNumber === 2, 'R1: FAILED refund advanced to attempt 2');
    check(refundDocs.length === 1, 'R2: No duplicate Refund document was created for the same operation', `count = ${refundDocs.length}`);
    check(
      retryReservations.length === 1,
      'R3: Exactly one reservation exists for the retry attempt',
      `count = ${retryReservations.length}`
    );
    check(
      pendingRetryReservations.length === 0,
      'R4: Retry reservation was settled (no orphan PENDING reservation remains)',
      `pending = ${pendingRetryReservations.length}`
    );
    check(
      finalPayment?.pendingRefundAmount === 0,
      'R5: pendingRefundAmount fully released after settlement',
      `pending = ${finalPayment?.pendingRefundAmount}`
    );
    check(
      finalPayment?.refundedAmount === refundAmount,
      'R6: refundedAmount credited exactly once',
      `refunded = ${finalPayment?.refundedAmount}`
    );
    check(
      totalCommitted === refundAmount,
      'R7: Total committed amount equals the single refund',
      `committed = ${totalCommitted}`
    );
    check(
      finalPayment?.reconciliationRequired !== true,
      'R8: Payment did not require reconciliation',
      `reason = ${finalPayment?.reconciliationReason || 'none'}`
    );
    check(fulfilled >= 1, 'R9: At least one concurrent retry completed', `fulfilled = ${fulfilled}`);
    check(gatewayDispatches === 1, 'R10: Gateway received exactly one refund submission', `dispatches = ${gatewayDispatches}`);

    // -----------------------------------------------------------------------
    // Scenario 2: a retried refund queued by the gateway (`pending`) must be
    // settled by the later refund.processed webhook. Retry reservations carry a
    // `${refundId}_attN` id; settlement must target that actual reservation, not
    // the initial attempt's `${refundId}` id.
    // -----------------------------------------------------------------------
    const retryOrder: any = await Order.create({
      orderNumber: `ORD-RETRY-HOOK-${now}`,
      userId,
      items: [],
      subtotal: 1000,
      total: 1000,
      currency: 'INR',
      status: 'CANCELLED',
      paymentStatus: 'PAID',
      shippingAddress: defaultShippingAddress,
    });

    const retryGatewayPaymentId = `pay_retry_hook_${now}`;
    const retryPayment: any = await Payment.create({
      orderId: retryOrder._id,
      userId,
      amount: 1000,
      currency: 'INR',
      status: 'CAPTURED',
      provider: 'RAZORPAY',
      razorpayPaymentId: retryGatewayPaymentId,
      refundedAmount: 0,
      pendingRefundAmount: 0,
      refundReservations: [],
    });

    await PaymentAttempt.create({
      paymentId: retryPayment._id,
      orderId: retryOrder._id,
      razorpayOrderId: `order_retry_hook_${now}`,
      razorpayPaymentId: retryGatewayPaymentId,
      amount: 1000,
      currency: 'INR',
      status: 'CAPTURED',
    });

    const retryOperationId = `op_retry_hook_${now}`;
    const retryOpHash = operationHash(retryOrder._id.toString(), retryOperationId);

    const retryFailedRefund: any = await Refund.create({
      orderId: retryOrder._id,
      paymentId: retryPayment._id,
      userId,
      attemptNumber: 1,
      idempotencyKey: `rfnd_op_${retryOpHash}`,
      gatewayIdempotencyKey: `rfnd_op_${retryOpHash}`,
      amount: refundAmount,
      currency: 'INR',
      status: 'FAILED',
      submissionState: 'CONFIRMED',
      accountingSettlementStatus: 'COMPLETED',
      failureReason: 'Gateway rejected refund',
      razorpayPaymentId: retryGatewayPaymentId,
      initiatedBy: adminId,
      initiatedByRole: 'ADMIN',
    });

    const gatewayRefundId = `rfnd_retry_hook_${now}`;
    razorpayProvider.createRefund = async (_paymentId: string, amountInPaise: number) => ({
      id: gatewayRefundId,
      entity: 'refund',
      amount: amountInPaise,
      status: 'pending',
    } as any);

    const queuedRefund: any = await createInternalRefund({
      orderId: retryOrder._id.toString(),
      operationId: retryOperationId,
      amount: refundAmount,
      reason: 'Retry queued by gateway',
      actorId: adminId.toString(),
      actorRole: 'ADMIN',
    });

    const afterQueue: any = await Payment.findById(retryPayment._id);
    const retryReservationId = `${retryFailedRefund._id}_att2`;
    const queuedReservation = (afterQueue?.refundReservations || []).find(
      (r: any) => r.reservationId === retryReservationId
    );

    check(queuedRefund?.status === 'PENDING', 'S1: Gateway-queued retry refund is PENDING', `status = ${queuedRefund?.status}`);
    check(
      queuedRefund?.attemptNumber === 2 && Boolean(queuedReservation) && queuedReservation.status === 'PENDING',
      'S2: Retry reservation uses the attempt-scoped id and is still PENDING before the webhook',
      `attempt = ${queuedRefund?.attemptNumber}, reservation = ${queuedReservation?.reservationId || 'missing'}/${queuedReservation?.status || 'missing'}`
    );
    check(
      afterQueue?.pendingRefundAmount === refundAmount,
      'S3: Queued retry holds exactly one pending reservation',
      `pending = ${afterQueue?.pendingRefundAmount}`
    );

    const hookRes = await handleRefundProcessedEntity({
      id: gatewayRefundId,
      payment_id: retryGatewayPaymentId,
      amount: Math.round(refundAmount * 100),
      currency: 'INR',
      notes: { internal_refund_id: queuedRefund._id.toString() },
    });

    const settledPayment: any = await Payment.findById(retryPayment._id);
    const settledRefund: any = await Refund.findById(queuedRefund._id);
    const settledReservation = (settledPayment?.refundReservations || []).find(
      (r: any) => r.reservationId === retryReservationId
    );
    const settledLedger = (settledPayment?.settledRefunds || []).filter(
      (s: any) => s.refundId?.toString() === queuedRefund._id.toString()
    );

    check(hookRes.outcome === 'PROCESSED', 'S4: refund.processed webhook settles the queued retry', `outcome = ${hookRes.outcome} (${hookRes.reason || 'no reason'})`);
    check(
      settledReservation?.status === 'CONSUMED',
      'S5: Attempt-scoped retry reservation transitioned to CONSUMED',
      `status = ${settledReservation?.status || 'missing'}`
    );
    check(
      settledPayment?.pendingRefundAmount === 0,
      'S6: pendingRefundAmount released after retry settlement',
      `pending = ${settledPayment?.pendingRefundAmount}`
    );
    check(
      settledPayment?.refundedAmount === refundAmount,
      'S7: refundedAmount credited exactly once',
      `refunded = ${settledPayment?.refundedAmount}`
    );
    check(
      settledLedger.length === 1,
      'S8: Exactly one settlement ledger entry recorded',
      `entries = ${settledLedger.length}`
    );
    check(
      settledPayment?.reconciliationRequired !== true,
      'S9: Retry settlement did not require reconciliation',
      `reason = ${settledPayment?.reconciliationReason || 'none'}`
    );
    check(
      settledRefund?.status === 'PROCESSED' && settledRefund?.accountingSettlementStatus === 'COMPLETED',
      'S10: Retry Refund is PROCESSED and accounting-complete',
      `status = ${settledRefund?.status}, accounting = ${settledRefund?.accountingSettlementStatus}`
    );

    const replayRes = await handleRefundProcessedEntity({
      id: gatewayRefundId,
      payment_id: retryGatewayPaymentId,
      amount: Math.round(refundAmount * 100),
      currency: 'INR',
      notes: { internal_refund_id: queuedRefund._id.toString() },
    });
    const afterReplay: any = await Payment.findById(retryPayment._id);
    check(
      replayRes.outcome === 'PROCESSED' &&
        afterReplay?.refundedAmount === refundAmount &&
        (afterReplay?.settledRefunds || []).filter(
          (s: any) => s.refundId?.toString() === queuedRefund._id.toString()
        ).length === 1,
      'S11: Replayed retry webhook is idempotent (no double credit)',
      `outcome = ${replayRes.outcome}, refunded = ${afterReplay?.refundedAmount}`
    );

    // -----------------------------------------------------------------------
    // Scenario 3: the symmetric path — a queued retry that the provider reports
    // as failed must release its attempt-scoped reservation (not strand it).
    // -----------------------------------------------------------------------
    const failedOrder: any = await Order.create({
      orderNumber: `ORD-RETRY-FAIL-${now}`,
      userId,
      items: [],
      subtotal: 1000,
      total: 1000,
      currency: 'INR',
      status: 'CANCELLED',
      paymentStatus: 'PAID',
      shippingAddress: defaultShippingAddress,
    });

    const failedGatewayPaymentId = `pay_retry_fail_${now}`;
    const failedPayment: any = await Payment.create({
      orderId: failedOrder._id,
      userId,
      amount: 1000,
      currency: 'INR',
      status: 'CAPTURED',
      provider: 'RAZORPAY',
      razorpayPaymentId: failedGatewayPaymentId,
      refundedAmount: 0,
      pendingRefundAmount: 0,
      refundReservations: [],
    });

    await PaymentAttempt.create({
      paymentId: failedPayment._id,
      orderId: failedOrder._id,
      razorpayOrderId: `order_retry_fail_${now}`,
      razorpayPaymentId: failedGatewayPaymentId,
      amount: 1000,
      currency: 'INR',
      status: 'CAPTURED',
    });

    const failedOperationId = `op_retry_fail_${now}`;
    const failedOpHash = operationHash(failedOrder._id.toString(), failedOperationId);

    const failedAgainRefund: any = await Refund.create({
      orderId: failedOrder._id,
      paymentId: failedPayment._id,
      userId,
      attemptNumber: 1,
      idempotencyKey: `rfnd_op_${failedOpHash}`,
      gatewayIdempotencyKey: `rfnd_op_${failedOpHash}`,
      amount: refundAmount,
      currency: 'INR',
      status: 'FAILED',
      submissionState: 'CONFIRMED',
      accountingSettlementStatus: 'COMPLETED',
      failureReason: 'Gateway rejected refund',
      razorpayPaymentId: failedGatewayPaymentId,
      initiatedBy: adminId,
      initiatedByRole: 'ADMIN',
    });

    const failedGatewayRefundId = `rfnd_retry_fail_${now}`;
    razorpayProvider.createRefund = async (_paymentId: string, amountInPaise: number) => ({
      id: failedGatewayRefundId,
      entity: 'refund',
      amount: amountInPaise,
      status: 'pending',
    } as any);

    const queuedFailRefund: any = await createInternalRefund({
      orderId: failedOrder._id.toString(),
      operationId: failedOperationId,
      amount: refundAmount,
      reason: 'Retry queued then failed',
      actorId: adminId.toString(),
      actorRole: 'ADMIN',
    });

    const failHookRes = await handleRefundFailedEntity({
      id: failedGatewayRefundId,
      payment_id: failedGatewayPaymentId,
      amount: Math.round(refundAmount * 100),
      currency: 'INR',
      notes: { internal_refund_id: queuedFailRefund._id.toString() },
      error_description: 'Provider declined the refund',
    });

    const releasedPayment: any = await Payment.findById(failedPayment._id);
    const releasedRefund: any = await Refund.findById(queuedFailRefund._id);
    const releasedReservation = (releasedPayment?.refundReservations || []).find(
      (r: any) => r.reservationId === `${failedAgainRefund._id}_att2`
    );

    check(failHookRes.outcome === 'PROCESSED', 'F1: refund.failed webhook processes the queued retry', `outcome = ${failHookRes.outcome} (${failHookRes.reason || 'no reason'})`);
    check(
      releasedReservation?.status === 'RELEASED',
      'F2: Attempt-scoped retry reservation transitioned to RELEASED',
      `status = ${releasedReservation?.status || 'missing'}`
    );
    check(
      releasedPayment?.pendingRefundAmount === 0,
      'F3: pendingRefundAmount released after retry failure',
      `pending = ${releasedPayment?.pendingRefundAmount}`
    );
    check(
      releasedPayment?.refundedAmount === 0,
      'F4: No refund was credited for the failed retry',
      `refunded = ${releasedPayment?.refundedAmount}`
    );
    check(
      releasedPayment?.reconciliationRequired !== true,
      'F5: Retry failure release did not require reconciliation',
      `reason = ${releasedPayment?.reconciliationReason || 'none'}`
    );
    check(
      releasedRefund?.status === 'FAILED' && releasedRefund?.accountingSettlementStatus === 'COMPLETED',
      'F6: Retry Refund is FAILED and accounting-complete',
      `status = ${releasedRefund?.status}, accounting = ${releasedRefund?.accountingSettlementStatus}`
    );

    // -----------------------------------------------------------------------
    // Scenario 4: process termination immediately AFTER the attempt-2 Payment
    // reservation is written, but BEFORE the Refund FAILED→PROCESSING claim.
    // A restart with the same operationId must adopt the existing reservation
    // (not throw, not duplicate), then exactly one caller may dispatch.
    // -----------------------------------------------------------------------
    const crashOrder: any = await Order.create({
      orderNumber: `ORD-RETRY-CRASH-${now}`,
      userId,
      items: [],
      subtotal: 1000,
      total: 1000,
      currency: 'INR',
      status: 'CANCELLED',
      paymentStatus: 'PAID',
      shippingAddress: defaultShippingAddress,
    });

    const crashGatewayPaymentId = `pay_retry_crash_${now}`;
    const crashPayment: any = await Payment.create({
      orderId: crashOrder._id,
      userId,
      amount: 1000,
      currency: 'INR',
      status: 'CAPTURED',
      provider: 'RAZORPAY',
      razorpayPaymentId: crashGatewayPaymentId,
      refundedAmount: 0,
      pendingRefundAmount: 0,
      refundReservations: [],
    });

    await PaymentAttempt.create({
      paymentId: crashPayment._id,
      orderId: crashOrder._id,
      razorpayOrderId: `order_retry_crash_${now}`,
      razorpayPaymentId: crashGatewayPaymentId,
      amount: 1000,
      currency: 'INR',
      status: 'CAPTURED',
    });

    const crashOperationId = `op_retry_crash_${now}`;
    const crashOpHash = operationHash(crashOrder._id.toString(), crashOperationId);

    const crashFailedRefund: any = await Refund.create({
      orderId: crashOrder._id,
      paymentId: crashPayment._id,
      userId,
      attemptNumber: 1,
      idempotencyKey: `rfnd_op_${crashOpHash}`,
      gatewayIdempotencyKey: `rfnd_op_${crashOpHash}`,
      amount: refundAmount,
      currency: 'INR',
      status: 'FAILED',
      submissionState: 'CONFIRMED',
      accountingSettlementStatus: 'COMPLETED',
      failureReason: 'Gateway rejected refund',
      razorpayPaymentId: crashGatewayPaymentId,
      initiatedBy: adminId,
      initiatedByRole: 'ADMIN',
    });

    let crashGatewayDispatches = 0;
    const crashGatewayRefundId = `rfnd_retry_crash_${now}`;
    razorpayProvider.createRefund = async (_paymentId: string, amountInPaise: number) => {
      crashGatewayDispatches++;
      return {
        id: `${crashGatewayRefundId}_${crashGatewayDispatches}`,
        entity: 'refund',
        amount: amountInPaise,
        status: 'processed',
      } as any;
    };

    // Simulate a hard process kill at the exact boundary: the Payment reservation
    // update has committed, but the Refund claim must never run.
    const crashSentinel = new Error('SIMULATED_PROCESS_TERMINATION_AFTER_RESERVATION');
    const originalRefundFindOneAndUpdate = Refund.findOneAndUpdate.bind(Refund);
    const crashSession = await mongoose.startSession();
    let crashError: unknown;
    try {
      (Refund as any).findOneAndUpdate = (filter: any, ...args: any[]) => {
        const isRetryClaim = Boolean(
          filter && filter.status === 'FAILED' && typeof filter.attemptNumber === 'number'
        );
        if (isRetryClaim) {
          return Promise.reject(crashSentinel);
        }
        return originalRefundFindOneAndUpdate(filter, ...args);
      };
      await createInternalRefund({
        orderId: crashOrder._id.toString(),
        operationId: crashOperationId,
        amount: refundAmount,
        reason: 'Crash-after-reservation retry',
        actorId: adminId.toString(),
        actorRole: 'ADMIN',
        session: crashSession,
      });
    } catch (err: unknown) {
      crashError = err;
    } finally {
      (Refund as any).findOneAndUpdate = originalRefundFindOneAndUpdate;
      await crashSession.endSession().catch(() => undefined);
    }

    const afterCrashPayment: any = await Payment.findById(crashPayment._id);
    const afterCrashRefund: any = await Refund.findById(crashFailedRefund._id);
    const afterCrashReservationId = `${crashFailedRefund._id}_att2`;
    const afterCrashReservations = (afterCrashPayment?.refundReservations || []).filter(
      (r: any) => r.reservationId === afterCrashReservationId
    );

    check(crashError === crashSentinel, 'C1: Simulated termination interrupted the retry before the Refund claim', `error = ${crashError instanceof Error ? crashError.message : String(crashError)}`);
    check(
      afterCrashRefund?.status === 'FAILED' && afterCrashRefund?.attemptNumber === 1,
      'C2: Refund was not advanced by the crashed call',
      `status = ${afterCrashRefund?.status}, attempt = ${afterCrashRefund?.attemptNumber}`
    );
    check(
      afterCrashReservations.length === 1 && afterCrashReservations[0].status === 'PENDING',
      'C3: Exactly one PENDING attempt-2 reservation survived the crash',
      `count = ${afterCrashReservations.length}, status = ${afterCrashReservations[0]?.status || 'missing'}`
    );
    check(
      afterCrashPayment?.pendingRefundAmount === refundAmount,
      'C4: Crash left pendingRefundAmount incremented exactly once',
      `pending = ${afterCrashPayment?.pendingRefundAmount}`
    );
    check(
      crashGatewayDispatches === 0,
      'C5: No gateway submission occurred before the crash',
      `dispatches = ${crashGatewayDispatches}`
    );

    // Restart recovery: two concurrent replays of the same operationId.
    const recoveryResults = await Promise.allSettled([
      createInternalRefund({
        orderId: crashOrder._id.toString(),
        operationId: crashOperationId,
        amount: refundAmount,
        reason: 'Crash recovery A',
        actorId: adminId.toString(),
        actorRole: 'ADMIN',
      }),
      createInternalRefund({
        orderId: crashOrder._id.toString(),
        operationId: crashOperationId,
        amount: refundAmount,
        reason: 'Crash recovery B',
        actorId: adminId.toString(),
        actorRole: 'ADMIN',
      }),
    ]);

    const recoveredCrashPayment: any = await Payment.findById(crashPayment._id);
    const recoveredCrashRefund: any = await Refund.findById(crashFailedRefund._id);
    const recoveredCrashReservations = (recoveredCrashPayment?.refundReservations || []).filter(
      (r: any) => r.reservationId === afterCrashReservationId
    );
    const recoveredCrashLedger = (recoveredCrashPayment?.settledRefunds || []).filter(
      (s: any) => s.refundId?.toString() === crashFailedRefund._id.toString()
    );
    const fulfilledRecoveries = recoveryResults.filter((r) => r.status === 'fulfilled').length;

    check(
      recoveredCrashReservations.length === 1,
      'C6: Concurrent recovery adopted the existing reservation without duplicating it',
      `count = ${recoveredCrashReservations.length}`
    );
    check(
      crashGatewayDispatches === 1,
      'C7: Exactly one gateway submission occurred after the successful claim',
      `dispatches = ${crashGatewayDispatches}`
    );
    check(
      recoveredCrashPayment?.pendingRefundAmount === 0,
      'C8: pendingRefundAmount fully released after crash-recovery settlement',
      `pending = ${recoveredCrashPayment?.pendingRefundAmount}`
    );
    check(
      recoveredCrashPayment?.refundedAmount === refundAmount,
      'C9: refundedAmount credited exactly once',
      `refunded = ${recoveredCrashPayment?.refundedAmount}`
    );
    check(
      recoveredCrashLedger.length === 1,
      'C10: Exactly one settlement ledger entry recorded',
      `entries = ${recoveredCrashLedger.length}`
    );
    check(
      recoveredCrashRefund?.status === 'PROCESSED' &&
        recoveredCrashRefund?.attemptNumber === 2 &&
        recoveredCrashRefund?.accountingSettlementStatus === 'COMPLETED',
      'C11: Refund advanced to PROCESSED attempt 2 and accounting-complete',
      `status = ${recoveredCrashRefund?.status}, attempt = ${recoveredCrashRefund?.attemptNumber}, accounting = ${recoveredCrashRefund?.accountingSettlementStatus}`
    );
    check(
      recoveredCrashPayment?.reconciliationRequired !== true,
      'C12: Crash-recovered settlement did not require reconciliation',
      `reason = ${recoveredCrashPayment?.reconciliationReason || 'none'}`
    );
    check(fulfilledRecoveries >= 1, 'C13: At least one crash-recovery caller completed', `fulfilled = ${fulfilledRecoveries}`);

    // Cleanup
    await Refund.deleteMany({ orderId: order._id });
    await PaymentAttempt.deleteMany({ orderId: order._id });
    await Payment.deleteOne({ _id: payment._id });
    await Order.deleteOne({ _id: order._id });

    await Refund.deleteMany({ orderId: retryOrder._id });
    await PaymentAttempt.deleteMany({ orderId: retryOrder._id });
    await Payment.deleteOne({ _id: retryPayment._id });
    await Order.deleteOne({ _id: retryOrder._id });

    await Refund.deleteMany({ orderId: failedOrder._id });
    await PaymentAttempt.deleteMany({ orderId: failedOrder._id });
    await Payment.deleteOne({ _id: failedPayment._id });
    await Order.deleteOne({ _id: failedOrder._id });

    await Refund.deleteMany({ orderId: crashOrder._id });
    await PaymentAttempt.deleteMany({ orderId: crashOrder._id });
    await Payment.deleteOne({ _id: crashPayment._id });
    await Order.deleteOne({ _id: crashOrder._id });
  } catch (err: unknown) {
    failed++;
    failures.push(`Suite error: ${err instanceof Error ? err.stack || err.message : String(err)}`);
    console.error('Suite error:', err);
  } finally {
    await mongoose.disconnect().catch(() => undefined);
  }

  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error('Failures:');
    failures.forEach((f) => console.error(` - ${f}`));
    process.exitCode = 1;
  }
  console.log('══════════════════════════════════════════════════════════════════════');
}

run();
