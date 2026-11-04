/**
 * SamratFashion — Final Blocker Remediation Verification Suite
 * 
 * Tests for:
 * Phase 1: Refund input validation (zero, negative, NaN, Infinity, strings, omitted, precision)
 * Phase 2: Reservation identity, duplicate provider settlements, ambiguous ownership accounting
 * Phase 3: ReturnRequest synchronization across immediate refund, webhooks, and recovery
 * Phase 4: Cancelled-order inventory restoration, idempotency, and immutable stock ledger
 * Phase 5: API server and worker graceful shutdown and active cycle drain
 */

process.env.NODE_ENV = 'test';
process.env.RAZORPAY_KEY_ID = 'rzp_test_mock';
process.env.RAZORPAY_KEY_SECRET = 'mock_secret_test';
process.env.RAZORPAY_WEBHOOK_SECRET = 'mock_webhook_secret_test';

import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import { connectSafeTestDb, enforceTestRazorpayMock, createTestProduct } from './testHelpers';
import { Order } from '../models/Order';
import { Product, IProductVariant } from '../models/Product';
import { InventoryTransaction } from '../models/InventoryTransaction';
import { Payment } from '../models/Payment';
import { PaymentAttempt } from '../models/PaymentAttempt';
import { Refund, IRefund } from '../models/Refund';
import { ReturnRequest } from '../models/ReturnRequest';
import { InventoryAllocationService } from '../services/inventory/inventoryAllocationService';
import {
  createInternalRefund,
  transitionPaymentReservation,
  resolveSettlementPolicy,
  applyProviderRefundSettlement,
  syncReturnRequestWithRefund,
  reconcileIncompleteRefundOperations,
  reconcileUnknownRefund,
  findExactSettlementRecord,
  isRecognizedWorkerFenceOrAbortError,
  registerPostCommitHook,
  SessionWithPostCommit
} from '../services/payment/refundService';
import { initiateRefund } from '../controllers/refundController';
import { razorpayProvider } from '../services/payment/RazorpayProvider';
import { RecoveryCoordinatorService } from '../services/recovery/recoveryCoordinatorService';
import { handleGracefulShutdown } from '../index';
import { handleWorkerShutdown } from '../worker';
import { WorkerLock } from '../models/WorkerLock';
import { WebhookEvent } from '../models/WebhookEvent';
import { handleRefundProcessedEntity, handleRefundFailedEntity, processSupportedWebhookEvent } from '../controllers/webhookController';
import { AppError } from '../utils/AppError';
function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function getErrorDetails(err: unknown): { statusCode?: number; message: string } {
  if (err && typeof err === 'object') {
    const obj = err as Record<string, unknown>;
    return {
      statusCode: typeof obj.statusCode === 'number' ? obj.statusCode : undefined,
      message: typeof obj.message === 'string' ? obj.message : String(err)
    };
  }
  return { message: String(err) };
}
let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(condition: boolean, desc: string, details?: string) {
  if (condition) {
    passed++;
    console.log(`  ✅ PASS: ${desc}`);
  } else {
    failed++;
    const msg = details ? `${desc} (${details})` : desc;
    failures.push(msg);
    console.error(`  ❌ FAIL: ${msg}`);
  }
}

async function runPhase1Tests() {
  console.log('\n--- SECTION 1: PHASE 1 — REFUND INPUT VALIDATION ---');
  const userId = new mongoose.Types.ObjectId();
  const adminId = new mongoose.Types.ObjectId();

  // Create base test order and payment
  const order = await Order.create({
    orderNumber: `ORD-P1-${Date.now()}`,
    userId,
    items: [],
    subtotal: 1000,
    total: 1000,
    currency: 'INR',
    status: 'DELIVERED',
    paymentStatus: 'PAID',
    paymentMethod: 'RAZORPAY',
    shippingAddress: { fullName: 'Customer', phone: '9876543210', addressLine1: 'Park St', city: 'Kolkata', state: 'WB', postalCode: '700016', country: 'India' }
  });

  const payment = await Payment.create({
    orderId: order._id,
    userId,
    amount: 1000,
    currency: 'INR',
    status: 'CAPTURED',
    razorpayPaymentId: `pay_p1_${Date.now()}`,
    pendingRefundAmount: 0,
    refundedAmount: 0,
    refundReservations: []
  });

  await PaymentAttempt.create({
    paymentId: payment._id,
    orderId: order._id,
    razorpayPaymentId: payment.razorpayPaymentId,
    razorpayOrderId: `order_mock_${Date.now()}`,
    amount: 1000,
    currency: 'INR',
    status: 'CAPTURED'
  });

  // 1. Explicit zero amount rejection
  let zeroRejected = false;
  try {
    await createInternalRefund({
      orderId: order._id.toString(),
      amount: 0,
      reason: 'Zero refund test',
      actorId: adminId.toString(),
      actorRole: 'ADMIN'
    });
  } catch (err: unknown) {
    const details = getErrorDetails(err);
    if (details.statusCode === 400 && details.message.includes('greater than zero')) {
      zeroRejected = true;
    }
  }
  check(zeroRejected, 'P1.1 Explicit zero amount rejected with HTTP 400 (not defaulted to remainder)');

  let pAfterZero = await Payment.findById(payment._id);
  check(pAfterZero?.pendingRefundAmount === 0 && pAfterZero?.refundedAmount === 0, 'P1.1b Payment balances unchanged after zero refund rejected');
  const refundsAfterZero = await Refund.find({ orderId: order._id });
  check(refundsAfterZero.length === 0, 'P1.1c Zero refund created no Refund documents');

  // 2. Negative amount rejection
  let negativeRejected = false;
  try {
    await createInternalRefund({
      orderId: order._id.toString(),
      amount: -50,
      reason: 'Negative refund test',
      actorId: adminId.toString(),
      actorRole: 'ADMIN'
    });
  } catch (err: unknown) {
    const details = getErrorDetails(err);
    if (details.statusCode === 400 && details.message.includes('greater than zero')) {
      negativeRejected = true;
    }
  }
  check(negativeRejected, 'P1.2 Negative amount rejected with HTTP 400');

  // 3. NaN, Infinity, and invalid string rejection
  const invalidInputs: unknown[] = [NaN, Infinity, -Infinity, 'abc', 'Infinity', 'NaN', ''];
  for (const inv of invalidInputs) {
    let rejected = false;
    try {
      await createInternalRefund({
        orderId: order._id.toString(),
        amount: inv as number,
        reason: 'Invalid input test',
        actorId: adminId.toString(),
        actorRole: 'ADMIN'
      });
    } catch (err: unknown) {
      const details = getErrorDetails(err);
      if (details.statusCode === 400) {
        rejected = true;
      }
    }
    check(rejected, `P1.3 Invalid amount input (${String(inv)}) rejected with HTTP 400`);
  }

  // 4. Decimal precision rejection (more than 2 decimal places)
  let precisionRejected = false;
  try {
    await createInternalRefund({
      orderId: order._id.toString(),
      amount: 100.555,
      reason: 'Sub-paise precision test',
      actorId: adminId.toString(),
      actorRole: 'ADMIN'
    });
  } catch (err: unknown) {
    const details = getErrorDetails(err);
    if (details.statusCode === 400 && details.message.includes('supported currency precision')) {
      precisionRejected = true;
    }
  }
  check(precisionRejected, 'P1.4 Precision exceeding 2 decimal places rejected with HTTP 400');

  // 5. Omitted amount for return request must NOT default to full remainder
  const returnReq = await ReturnRequest.create({
    orderId: order._id,
    userId,
    items: [{
      productId: new mongoose.Types.ObjectId(),
      variantId: new mongoose.Types.ObjectId(),
      quantity: 1,
      reason: 'DEFECTIVE'
    }],
    status: 'ACCEPTED',
    requestedAt: new Date()
  });

  let returnOmittedRejected = false;
  try {
    await createInternalRefund({
      orderId: order._id.toString(),
      returnId: returnReq._id.toString(),
      // amount is intentionally omitted!
      reason: 'Omitted return refund amount test',
      actorId: adminId.toString(),
      actorRole: 'ADMIN'
    });
  } catch (err: unknown) {
    const details = getErrorDetails(err);
    if (details.statusCode === 400 && details.message.includes('Refund amount is required for return requests')) {
      returnOmittedRejected = true;
    }
  }
  check(returnOmittedRejected, 'P1.5 Omitted amount on return request rejected (does NOT refund full order remainder)');

  // 6. ReturnRequest must NOT be marked FAILED on rejected input
  const retReqFresh = await ReturnRequest.findById(returnReq._id);
  check(retReqFresh?.refundStatus !== 'FAILED', 'P1.6 ReturnRequest is NOT marked FAILED merely because invalid refund input was rejected');

  // 7. Controller boundary validation via initiateRefund
  let controllerStatus = 0;
  let controllerMsg = '';
  const fakeReqZero = {
    params: { id: order._id.toString() },
    body: { amount: 0, reason: 'Zero via controller' },
    user: { id: adminId.toString(), role: 'ADMIN' }
  } as unknown as Parameters<typeof initiateRefund>[0];
  const fakeResZero = {
    status: (code: number) => {
      controllerStatus = code;
      return fakeResZero;
    },
    json: (data: Record<string, unknown>) => {
      controllerMsg = typeof data.message === 'string' ? data.message : '';
      return fakeResZero;
    }
  } as unknown as Parameters<typeof initiateRefund>[1];
  await initiateRefund(fakeReqZero, fakeResZero);
  check(controllerStatus === 400 && controllerMsg.includes('greater than zero'), 'P1.7 Controller rejects explicit zero with HTTP 400');

  // Clean up test data
  await PaymentAttempt.deleteMany({ orderId: order._id });
  await Payment.deleteMany({ orderId: order._id });
  await ReturnRequest.deleteMany({ orderId: order._id });
  await Order.deleteMany({ _id: order._id });
}

async function runPhase2Tests() {
  console.log('\n--- SECTION 2: PHASE 2 — RESERVATION IDENTITY & SETTLEMENT ACCOUNTING ---');
  const userId = new mongoose.Types.ObjectId();
  const adminId = new mongoose.Types.ObjectId();

  const orderP2 = await Order.create({
    orderNumber: `ORD-P2-${Date.now()}`,
    userId,
    items: [],
    subtotal: 2000,
    total: 2000,
    currency: 'INR',
    status: 'DELIVERED',
    paymentStatus: 'PAID',
    paymentMethod: 'RAZORPAY',
    shippingAddress: { fullName: 'Customer', phone: '9876543210', addressLine1: 'Park St', city: 'Kolkata', state: 'WB', postalCode: '700016', country: 'India' }
  });

  const paymentP2 = await Payment.create({
    orderId: orderP2._id,
    userId,
    amount: 2000,
    currency: 'INR',
    status: 'CAPTURED',
    razorpayPaymentId: `pay_p2_${Date.now()}`,
    pendingRefundAmount: 500,
    refundedAmount: 0,
    refundReservations: []
  });

  const refundP2A = await Refund.create({
    orderId: orderP2._id,
    paymentId: paymentP2._id,
    userId,
    amount: 500,
    currency: 'INR',
    status: 'PROCESSING',
    submissionState: 'INTENT_CREATED',
    attemptNumber: 2,
    idempotencyKey: `idemp_p2a_${Date.now()}`,
    reason: 'P2A test refund',
    initiatedBy: adminId,
    initiatedByRole: 'ADMIN'
  });

  // 1. Strict AND-based reservation identity in DATABASE_ERROR recovery (no OR matching)
  // Persisted payment has a reservation with attempt 1, amount 200 (mismatched with attempt 2, amount 500)
  await Payment.updateOne(
    { _id: paymentP2._id },
    {
      $push: {
        refundReservations: {
          reservationId: refundP2A._id.toString(),
          refundId: refundP2A._id,
          attemptNumber: 1, // Mismatched attempt!
          amount: 200,      // Mismatched amount!
          status: 'CONSUMED'
        }
      }
    }
  );

  const policyMismatch = await resolveSettlementPolicy({
    paymentId: paymentP2._id,
    refundId: refundP2A._id,
    transitionOutcome: 'DATABASE_ERROR',
    expectedReservationId: refundP2A._id.toString(),
    expectedAttemptNumber: 2,
    expectedAmount: 500
  });

  check(policyMismatch.canProceedToSettlement === false, 'P2.1 Mismatched attempt/amount in DATABASE_ERROR returns canProceedToSettlement: false');
  check(policyMismatch.settlementReason === 'DATABASE_ERROR_UNVERIFIED', 'P2.1b DATABASE_ERROR rejection reports DATABASE_ERROR_UNVERIFIED');

  // 2. Missing identity fields must fail closed
  const policyMissingFields = await resolveSettlementPolicy({
    paymentId: paymentP2._id,
    refundId: refundP2A._id,
    transitionOutcome: 'DATABASE_ERROR'
    // expectedReservationId, expectedAttemptNumber, expectedAmount are missing!
  });
  check(policyMissingFields.canProceedToSettlement === false, 'P2.2 Missing identity fields fail closed on DATABASE_ERROR');

  // 3. Exact matching passes when all 5 match simultaneously
  await Payment.updateOne(
    { _id: paymentP2._id },
    {
      $push: {
        refundReservations: {
          reservationId: `res_p2_${refundP2A._id}`,
          refundId: refundP2A._id,
          attemptNumber: 2,
          amount: 500,
          status: 'CONSUMED'
        }
      }
    }
  );

  const policyExactMatch = await resolveSettlementPolicy({
    paymentId: paymentP2._id,
    refundId: refundP2A._id,
    transitionOutcome: 'DATABASE_ERROR',
    expectedReservationId: `res_p2_${refundP2A._id}`,
    expectedAttemptNumber: 2,
    expectedAmount: 500
  });
  check(policyExactMatch.canProceedToSettlement === true, 'P2.3 Complete 5-dimension identity match allows settlement');
  check(policyExactMatch.settlementReason === 'RESERVATION_CONSUMED', 'P2.3b Exact match reports RESERVATION_CONSUMED');

  // 4. Strict dual-key settlement: duplicate provider refund ID assigned to different internal Refund
  const refundP2B = await Refund.create({
    orderId: orderP2._id,
    paymentId: paymentP2._id,
    userId,
    amount: 500,
    currency: 'INR',
    status: 'PROCESSING',
    submissionState: 'INTENT_CREATED',
    attemptNumber: 1,
    idempotencyKey: `idemp_p2b_${Date.now()}`,
    reason: 'P2B test refund',
    initiatedBy: adminId,
    initiatedByRole: 'ADMIN'
  });

  refundP2A.status = 'PROCESSED';
  refundP2A.submissionState = 'CONFIRMED';
  refundP2A.processedAt = new Date();
  refundP2A.razorpayRefundId = 'rfnd_dual_key_001';
  await refundP2A.save();

  refundP2B.status = 'PROCESSED';
  refundP2B.submissionState = 'CONFIRMED';
  refundP2B.processedAt = new Date();
  await refundP2B.save();

  const settleRes1 = await applyProviderRefundSettlement({
    paymentId: paymentP2._id,
    refundId: refundP2A._id,
    razorpayRefundId: 'rfnd_dual_key_001',
    amount: 500,
    currency: 'INR',
    unlinked: false,
    settlementReason: 'RESERVATION_CONSUMED'
  });
  check(settleRes1.success === true && settleRes1.outcome === 'SETTLED', 'P2.4 First provider settlement succeeds');

  // Attempt duplicate settlement with different refund ID but SAME provider refund ID
  const settleResConflict = await applyProviderRefundSettlement({
    paymentId: paymentP2._id,
    refundId: refundP2B._id,
    razorpayRefundId: 'rfnd_dual_key_001', // Same provider ID!
    amount: 500,
    currency: 'INR',
    unlinked: false,
    settlementReason: 'RESERVATION_CONSUMED'
  });
  check(settleResConflict.success === false && settleResConflict.outcome === 'SETTLEMENT_CONFLICT', 'P2.5 Duplicate provider refund ID under different refundId returns SETTLEMENT_CONFLICT');

  const pAfterConflict = await Payment.findById(paymentP2._id);
  check((pAfterConflict?.settledRefunds || []).length === 1, 'P2.5b No duplicate entry inserted into settledRefunds');
  check(pAfterConflict?.reconciliationRequired === true, 'P2.5c Payment marked reconciliationRequired on settlement conflict');

  // 5. Identical duplicate settlement is an idempotent no-op
  const settleResIdentical = await applyProviderRefundSettlement({
    paymentId: paymentP2._id,
    refundId: refundP2A._id,
    razorpayRefundId: 'rfnd_dual_key_001',
    amount: 500,
    currency: 'INR',
    unlinked: false,
    settlementReason: 'RESERVATION_CONSUMED'
  });
  check(settleResIdentical.success === true && settleResIdentical.outcome === 'ALREADY_SETTLED', 'P2.6 Identical duplicate settlement returns ALREADY_SETTLED');
  check(settleResIdentical.refundedAdjusted === 0, 'P2.6b Identical duplicate does not adjust balance');

  // 6. Conflicting amount on duplicate settlement is rejected
  const settleResConflictingAmount = await applyProviderRefundSettlement({
    paymentId: paymentP2._id,
    refundId: refundP2A._id,
    razorpayRefundId: 'rfnd_dual_key_001',
    amount: 999, // Conflicting amount!
    currency: 'INR',
    unlinked: false
  });
  check(settleResConflictingAmount.outcome === 'SETTLEMENT_CONFLICT', 'P2.7 Conflicting amount on duplicate settlement returns SETTLEMENT_CONFLICT');

  // 7. Ambiguous ownership (OWNERSHIP_AMBIGUOUS) rejects settlement
  const orderAmb = await Order.create({
    orderNumber: `ORD-AMB-${Date.now()}`,
    userId,
    items: [],
    subtotal: 1000,
    total: 1000,
    currency: 'INR',
    status: 'DELIVERED',
    paymentStatus: 'PAID',
    paymentMethod: 'RAZORPAY',
    shippingAddress: { fullName: 'Customer', phone: '9876543210', addressLine1: 'Park St', city: 'Kolkata', state: 'WB', postalCode: '700016', country: 'India' }
  });

  const paymentAmb = await Payment.create({
    orderId: orderAmb._id,
    userId,
    amount: 1000,
    currency: 'INR',
    status: 'CAPTURED',
    razorpayPaymentId: `pay_amb_${Date.now()}`,
    pendingRefundAmount: 300,
    refundedAmount: 0,
    refundReservations: []
  });

  const ambRef1 = await Refund.create({
    orderId: orderAmb._id,
    paymentId: paymentAmb._id,
    userId,
    amount: 300,
    currency: 'INR',
    status: 'PROCESSING',
    submissionState: 'INTENT_CREATED',
    attemptNumber: 1,
    idempotencyKey: `idemp_amb1_${Date.now()}`,
    reason: 'Ambiguous 1',
    initiatedBy: adminId,
    initiatedByRole: 'ADMIN'
  });

  await Refund.create({
    orderId: orderAmb._id,
    paymentId: paymentAmb._id,
    userId,
    amount: 300,
    currency: 'INR',
    status: 'PROCESSING',
    submissionState: 'INTENT_CREATED',
    attemptNumber: 2,
    idempotencyKey: `idemp_amb2_${Date.now()}`,
    reason: 'Ambiguous 2',
    initiatedBy: adminId,
    initiatedByRole: 'ADMIN'
  });

  // Call transitionPaymentReservation for ambRef1 -> returns OWNERSHIP_AMBIGUOUS because 2 active refunds exist without reservation
  const transAmb = await transitionPaymentReservation({
    paymentId: paymentAmb._id,
    refundId: ambRef1._id,
    amount: 300,
    targetState: 'CONSUMED'
  });
  check(transAmb.outcome === 'OWNERSHIP_AMBIGUOUS', 'P2.8 Multiple active refunds without reservation yield OWNERSHIP_AMBIGUOUS');

  const policyAmb = await resolveSettlementPolicy({
    paymentId: paymentAmb._id,
    refundId: ambRef1._id,
    transitionOutcome: transAmb.outcome,
    expectedReservationId: ambRef1._id.toString(),
    expectedAttemptNumber: 1,
    expectedAmount: 300
  });
  check(policyAmb.canProceedToSettlement === false, 'P2.8b OWNERSHIP_AMBIGUOUS rejects settlement (canProceedToSettlement: false)');
  check(policyAmb.settlementReason === 'OWNERSHIP_AMBIGUOUS', 'P2.8c Settlement reason is OWNERSHIP_AMBIGUOUS');

  const pAmbAfter = await Payment.findById(paymentAmb._id);
  check(pAmbAfter?.refundedAmount === 0, 'P2.8d Ambiguous ownership does NOT increment refundedAmount');
  check(pAmbAfter?.pendingRefundAmount === 300, 'P2.8e Ambiguous ownership preserves pendingRefundAmount unchanged');
  check((pAmbAfter?.settledRefunds || []).length === 0, 'P2.8f Ambiguous ownership adds NO settledRefunds entry');

  // 8. Independently verified provider settlement with genuinely missing legacy reservation
  const paymentLeg = await Payment.create({
    orderId: new mongoose.Types.ObjectId(),
    userId,
    amount: 1000,
    currency: 'INR',
    status: 'CAPTURED',
    razorpayPaymentId: `pay_leg_${Date.now()}`,
    pendingRefundAmount: 400,
    refundedAmount: 0,
    refundReservations: []
  });

  const legRefund = await Refund.create({
    orderId: paymentLeg.orderId,
    paymentId: paymentLeg._id,
    userId,
    amount: 400,
    currency: 'INR',
    status: 'PROCESSED',
    processedAt: new Date(),
    submissionState: 'CONFIRMED',
    razorpayRefundId: `rfnd_leg_${Date.now()}`,
    attemptNumber: 1,
    idempotencyKey: `idemp_leg_${Date.now()}`,
    reason: 'Legacy refund test',
    initiatedBy: adminId,
    initiatedByRole: 'ADMIN'
  });

  const transLeg = await transitionPaymentReservation({
    paymentId: paymentLeg._id,
    refundId: legRefund._id,
    amount: 400,
    targetState: 'CONSUMED'
  });
  check(transLeg.outcome === 'RESERVATION_NOT_FOUND', 'P2.9 Single legacy refund yields RESERVATION_NOT_FOUND');

  const policyLeg = await resolveSettlementPolicy({
    paymentId: paymentLeg._id,
    refundId: legRefund._id,
    transitionOutcome: transLeg.outcome,
    expectedReservationId: legRefund._id.toString(),
    expectedAttemptNumber: 1,
    expectedAmount: 400
  });
  check(policyLeg.canProceedToSettlement === true, 'P2.9b Verified provider refund with missing reservation allows unlinked settlement');
  check(policyLeg.isUnlinkedSettlement === true, 'P2.9c Sets isUnlinkedSettlement: true');

  const settleLegRes = await applyProviderRefundSettlement({
    paymentId: paymentLeg._id,
    refundId: legRefund._id,
    razorpayRefundId: legRefund.razorpayRefundId!,
    amount: 400,
    currency: 'INR',
    unlinked: policyLeg.isUnlinkedSettlement,
    settlementReason: policyLeg.settlementReason
  });
  check(settleLegRes.success === true && settleLegRes.outcome === 'SETTLED', 'P2.9d Unlinked settlement applied successfully');

  const pLegAfter = await Payment.findById(paymentLeg._id);
  check(pLegAfter?.refundedAmount === 400, 'P2.9e Unlinked settlement increments refundedAmount (+400)');
  check(pLegAfter?.pendingRefundAmount === 400, 'P2.9f Unlinked settlement preserves pendingRefundAmount (400)');
  check(pLegAfter?.reconciliationRequired === true, 'P2.9g Unlinked settlement flags reconciliationRequired: true');
  check((pLegAfter?.settledRefunds || [])[0]?.unlinked === true, 'P2.9h Settled entry marked unlinked: true');

  // Clean up
  await Payment.deleteMany({ _id: { $in: [paymentP2._id, paymentAmb._id, paymentLeg._id] } });
  await Refund.deleteMany({ _id: { $in: [refundP2A._id, refundP2B._id, ambRef1._id, legRefund._id] } });
  await Order.deleteMany({ _id: { $in: [orderP2._id, orderAmb._id] } });
}

async function runPhase3Tests() {
  console.log('\n--- SECTION 3: PHASE 3 — RETURNREQUEST SYNCHRONIZATION ---');
  const userId = new mongoose.Types.ObjectId();
  const adminId = new mongoose.Types.ObjectId();

  const orderP3 = await Order.create({
    orderNumber: `ORD-P3-${Date.now()}`,
    userId,
    items: [],
    subtotal: 1000,
    total: 1000,
    currency: 'INR',
    status: 'DELIVERED',
    paymentStatus: 'PAID',
    paymentMethod: 'RAZORPAY',
    shippingAddress: { fullName: 'Customer', phone: '9876543210', addressLine1: 'Park St', city: 'Kolkata', state: 'WB', postalCode: '700016', country: 'India' }
  });

  const paymentP3 = await Payment.create({
    orderId: orderP3._id,
    userId,
    amount: 1000,
    currency: 'INR',
    status: 'CAPTURED',
    razorpayPaymentId: `pay_p3_${Date.now()}`,
    pendingRefundAmount: 0,
    refundedAmount: 0,
    refundReservations: []
  });

  await PaymentAttempt.create({
    paymentId: paymentP3._id,
    orderId: orderP3._id,
    razorpayPaymentId: paymentP3.razorpayPaymentId,
    razorpayOrderId: `order_mock_p3_${Date.now()}`,
    amount: 1000,
    currency: 'INR',
    status: 'CAPTURED'
  });

  // 1. Immediate provider success reaches terminal ReturnRequest state ('COMPLETED' + completedAt)
  const returnReqP3 = await ReturnRequest.create({
    orderId: orderP3._id,
    userId,
    items: [{
      productId: new mongoose.Types.ObjectId(),
      variantId: new mongoose.Types.ObjectId(),
      quantity: 1,
      reason: 'DEFECTIVE'
    }],
    status: 'ACCEPTED',
    inventoryRestored: true,
    requestedAt: new Date()
  });

  // Mock Razorpay provider to return processed synchronously
  razorpayProvider.createRefund = async () => ({
    id: `rfnd_mock_imm_${Date.now()}`,
    entity: 'refund',
    amount: 50000,
    currency: 'INR',
    payment_id: paymentP3.razorpayPaymentId!,
    status: 'processed',
    created_at: Math.floor(Date.now() / 1000)
  });

  const immRefund = await createInternalRefund({
    orderId: orderP3._id.toString(),
    returnId: returnReqP3._id.toString(),
    amount: 500,
    reason: 'Immediate success test',
    actorId: adminId.toString(),
    actorRole: 'ADMIN'
  });

  const freshRetImm = await ReturnRequest.findById(returnReqP3._id);
  check(freshRetImm?.refundStatus === 'PROCESSED', 'P3.1 Immediate refund sets refundStatus: PROCESSED');
  check(freshRetImm?.status === 'COMPLETED', 'P3.1b Immediate refund transitions ReturnRequest status from ACCEPTED to COMPLETED');
  check(Boolean(freshRetImm?.completedAt), 'P3.1c Immediate refund sets completedAt date timestamp');
  check(immRefund.accountingSettlementStatus === 'COMPLETED', 'P3.1d Refund accountingSettlementStatus is COMPLETED when return sync succeeds');

  // Restore createRefund mock
  enforceTestRazorpayMock(razorpayProvider);

  // 2. Attempt isolation: failed recovery for older attempt cannot overwrite PROCESSED newer attempt
  const returnReqIso = await ReturnRequest.create({
    orderId: orderP3._id,
    userId,
    items: [{
      productId: new mongoose.Types.ObjectId(),
      variantId: new mongoose.Types.ObjectId(),
      quantity: 1,
      reason: 'DEFECTIVE'
    }],
    status: 'COMPLETED',
    completedAt: new Date(),
    refundStatus: 'PROCESSED',
    refundAttempt: 2,
    requestedAt: new Date()
  });

  // Create an older Attempt 1 that was marked FAILED and unsettled
  const oldFailedRefund = await Refund.create({
    orderId: orderP3._id,
    paymentId: paymentP3._id,
    returnId: returnReqIso._id,
    userId,
    amount: 200,
    currency: 'INR',
    status: 'FAILED',
    submissionState: 'CONFIRMED',
    attemptNumber: 1, // Older attempt!
    accountingSettlementStatus: 'PENDING',
    idempotencyKey: `idemp_iso_old_${Date.now()}`,
    reason: 'Old failed attempt',
    initiatedBy: adminId,
    initiatedByRole: 'ADMIN'
  });

  // Point returnReqIso.refundId to a newer attempt (not oldFailedRefund)
  const newerRefundId = new mongoose.Types.ObjectId();
  returnReqIso.refundId = newerRefundId;
  await returnReqIso.save();

  // Run recovery on unsettled refunds
  await reconcileIncompleteRefundOperations();

  const freshRetAfterRecovery = await ReturnRequest.findById(returnReqIso._id);
  check(freshRetAfterRecovery?.refundStatus === 'PROCESSED', 'P3.2 Older failed refund recovery does NOT overwrite ReturnRequest refundStatus to FAILED');
  check(freshRetAfterRecovery?.status === 'COMPLETED', 'P3.2b ReturnRequest status strictly remains COMPLETED');
  check(freshRetAfterRecovery?.refundId?.toString() === newerRefundId.toString(), 'P3.2c ReturnRequest refundId strictly preserved on newer attempt');

  // 3. Order ID mismatch must fail closed and return success: false
  const foreignOrderId = new mongoose.Types.ObjectId();
  const mismatchSyncRes = await syncReturnRequestWithRefund({
    returnId: returnReqIso._id,
    refundId: oldFailedRefund._id,
    orderId: foreignOrderId, // Mismatched order!
    refundStatus: 'PROCESSED',
    attemptNumber: 1
  });
  check(mismatchSyncRes.success === false, 'P3.3 syncReturnRequestWithRefund rejects orderId mismatch with success: false');

  // Clean up
  await PaymentAttempt.deleteMany({ orderId: orderP3._id });
  await Payment.deleteMany({ _id: paymentP3._id });
  await Refund.deleteMany({ _id: { $in: [immRefund._id, oldFailedRefund._id] } });
  await ReturnRequest.deleteMany({ _id: { $in: [returnReqP3._id, returnReqIso._id] } });
  await Order.deleteMany({ _id: orderP3._id });
}

async function runPhase4Tests() {
  console.log('\n--- SECTION 4: PHASE 4 — INVENTORY RESTORATION & LEDGER IMMUTABILITY ---');
  const userId = new mongoose.Types.ObjectId();

  // Create a real test product with initial stock 50
  const { product, variantIds } = await createTestProduct({
    name: 'P4 Test Polo',
    variants: [{ size: 'L', color: 'NAVY', stock: 50, isAvailable: true }]
  });
  const variantId = new mongoose.Types.ObjectId(variantIds[0]);

  // Create test order and simulate purchase (stock 50 -> 45)
  const orderP4 = await Order.create({
    orderNumber: `ORD-P4-${Date.now()}`,
    userId,
    items: [{
      productId: product._id,
      variantId,
      productName: 'P4 Test Polo',
      productImage: 'https://example.com/polo.jpg',
      selectedSize: 'L',
      selectedColor: 'NAVY',
      quantity: 5,
      unitPrice: 500,
      lineTotal: 2500
    }],
    subtotal: 2500,
    total: 2500,
    currency: 'INR',
    status: 'CONFIRMED',
    paymentStatus: 'PAID',
    paymentMethod: 'RAZORPAY',
    shippingAddress: { fullName: 'Customer', phone: '9876543210', addressLine1: 'Park St', city: 'Kolkata', state: 'WB', postalCode: '700016', country: 'India' }
  });

  // Deduct stock and record SALE transaction in ledger
  await Product.updateOne(
    { _id: product._id, 'variants._id': variantId },
    { $inc: { 'variants.$.stock': -5 } }
  );

  const saleTx = await InventoryTransaction.create({
    orderId: orderP4._id,
    productId: product._id,
    variantId,
    quantity: 5,
    type: 'SALE',
    status: 'COMPLETED'
  });

  const pAfterSale = await Product.findById(product._id);
  check(pAfterSale?.variants[0]?.stock === 45, 'P4.1 Initial stock correctly decremented to 45 (50 - 5)');

  // 1. Authoritative cancellation restoration
  const resCancel1 = await InventoryAllocationService.restoreCancelledOrderInventory(orderP4._id);
  check(resCancel1.restoredCount === 1, 'P4.1b Exactly 1 variant restored on order cancellation');

  const pAfterCancel1 = await Product.findById(product._id);
  check(pAfterCancel1?.variants[0]?.stock === 50, 'P4.1c Product stock restored back to 50 (45 + 5)');

  // Critical: Original SALE transaction must NOT be deleted!
  const saleTxStillExists = await InventoryTransaction.findById(saleTx._id);
  check(saleTxStillExists !== null, 'P4.1d Original SALE inventory transaction is NOT deleted (ledger is immutable)');

  // Exactly one REFUND transaction created
  const refundTxList = await InventoryTransaction.find({ orderId: orderP4._id, type: 'REFUND' });
  check(refundTxList.length === 1, 'P4.1e Exactly one REFUND inventory transaction created in ledger');

  // 2. Replay / webhook delivery after cancellation is an idempotent no-op (no double restocking)
  const resCancelReplay = await InventoryAllocationService.restoreCancelledOrderInventory(orderP4._id);
  check(resCancelReplay.restoredCount === 0 && resCancelReplay.alreadyRestored === true, 'P4.2 Cancellation replay is safe idempotent no-op (0 restored)');

  const pAfterReplay = await Product.findById(product._id);
  check(pAfterReplay?.variants[0]?.stock === 50, 'P4.2b Stock strictly remains 50 (does NOT double-restock to 55)');

  // 3. Existing RESTOCK ledger entry prevents double-restock
  const orderP4Restock = await Order.create({
    orderNumber: `ORD-P4-RESTOCK-${Date.now()}`,
    userId,
    items: [{
      productId: product._id,
      variantId,
      productName: 'P4 Test Polo',
      productImage: 'https://example.com/polo.jpg',
      selectedSize: 'L',
      selectedColor: 'NAVY',
      quantity: 2,
      unitPrice: 500,
      lineTotal: 1000
    }],
    subtotal: 1000,
    total: 1000,
    currency: 'INR',
    status: 'CONFIRMED',
    paymentStatus: 'PAID',
    paymentMethod: 'RAZORPAY',
    shippingAddress: { fullName: 'Customer', phone: '9876543210', addressLine1: 'Park St', city: 'Kolkata', state: 'WB', postalCode: '700016', country: 'India' }
  });

  await InventoryTransaction.create({
    orderId: orderP4Restock._id,
    productId: product._id,
    variantId,
    quantity: 2,
    type: 'SALE',
    status: 'COMPLETED'
  });

  // Pre-insert legacy RESTOCK entry
  await InventoryTransaction.create({
    orderId: orderP4Restock._id,
    productId: product._id,
    variantId,
    quantity: 2,
    type: 'RESTOCK',
    status: 'COMPLETED'
  });

  const resLegacyRestock = await InventoryAllocationService.restoreCancelledOrderInventory(orderP4Restock._id);
  check(resLegacyRestock.restoredCount === 0 && resLegacyRestock.alreadyRestored === true, 'P4.3 Pre-existing RESTOCK entry recognized; prevents double restoration');

  // 4. Missing Product / variant throws 404 and leaves ledger intact
  const fakeProdId = new mongoose.Types.ObjectId();
  const fakeVarId = new mongoose.Types.ObjectId();
  const orderMissingProd = await Order.create({
    orderNumber: `ORD-MISSING-${Date.now()}`,
    userId,
    items: [{
      productId: fakeProdId,
      variantId: fakeVarId,
      productName: 'Missing Item',
      productImage: 'https://example.com/missing.jpg',
      selectedSize: 'M',
      selectedColor: 'RED',
      quantity: 1,
      unitPrice: 100,
      lineTotal: 100
    }],
    subtotal: 100,
    total: 100,
    currency: 'INR',
    status: 'CONFIRMED',
    paymentStatus: 'PAID',
    paymentMethod: 'RAZORPAY',
    shippingAddress: { fullName: 'Customer', phone: '9876543210', addressLine1: 'Park St', city: 'Kolkata', state: 'WB', postalCode: '700016', country: 'India' }
  });

  await InventoryTransaction.create({
    orderId: orderMissingProd._id,
    productId: fakeProdId,
    variantId: fakeVarId,
    quantity: 1,
    type: 'SALE',
    status: 'COMPLETED'
  });

  let missingProdError = false;
  try {
    await InventoryAllocationService.restoreCancelledOrderInventory(orderMissingProd._id);
  } catch (err: unknown) {
    const details = getErrorDetails(err);
    if (details.statusCode === 404 && details.message.includes('not found')) {
      missingProdError = true;
    }
  }
  check(missingProdError, 'P4.4 Non-existent product/variant throws 404 PRODUCT_NOT_FOUND');

  // Clean up
  await Product.deleteMany({ _id: product._id });
  await InventoryTransaction.deleteMany({ orderId: { $in: [orderP4._id, orderP4Restock._id, orderMissingProd._id] } });
  await Order.deleteMany({ _id: { $in: [orderP4._id, orderP4Restock._id, orderMissingProd._id] } });
}

async function runPhase5Tests() {
  console.log('\n--- SECTION 5: PHASE 5 — API SERVER & WORKER SHUTDOWN ---');

  // 1. Clean drain of active recovery cycle using deterministic promise gate
  RecoveryCoordinatorService.resetShutdownStateForTesting();
  const state = {
    cycleCompleted: false,
    dbDisconnected: false,
    slowCycleFinished: false,
    dbDisconnectedOnTimeout: false,
    bgTaskDone: false
  };

  let resolveCycleGate!: () => void;
  const cycleGate = new Promise<void>((resolve) => {
    resolveCycleGate = resolve;
  });

  RecoveryCoordinatorService.inFlightOperationHook = async () => {
    await cycleGate;
    state.cycleCompleted = true;
  };

  // Launch cycle in background
  const cyclePromise = RecoveryCoordinatorService.executeCoordinatedRecoveryCycle();

  // Initiate drain
  const drainPromise = RecoveryCoordinatorService.drainAndShutdown({
    drainTimeoutMs: 15000,
    disconnectDbFn: async () => {
      state.dbDisconnected = true;
    }
  });

  // Signal the in-flight hook to finish
  resolveCycleGate();
  const drainRes = await drainPromise;
  await cyclePromise;

  check(drainRes.drained === true, 'P5.1 Active recovery cycle drains cleanly within deadline');
  check(state.cycleCompleted === true, 'P5.1b In-flight cycle finishes execution before shutdown completes');
  check(state.dbDisconnected === true, 'P5.1c Database disconnected only after active work settled');

  // Verify lease was released cleanly by cycle's finally block
  const lockAfterDrain = await WorkerLock.findOne({ lockName: 'RECOVERY_COORDINATOR_LEADER' });
  const isExpired = lockAfterDrain?.leaseExpiresAt && lockAfterDrain.leaseExpiresAt.getTime() <= Date.now();
  check(Boolean(isExpired), 'P5.1d Worker lease released cleanly after cycle settled');

  // 2. Active cycle exceeding drain deadline: lease release withheld, DB NOT disconnected
  RecoveryCoordinatorService.resetShutdownStateForTesting();
  let resolveSlowGate!: () => void;
  const slowGate = new Promise<void>((resolve) => {
    resolveSlowGate = resolve;
  });
  let resolveHookEntered!: () => void;
  const hookEnteredPromise = new Promise<void>((r) => { resolveHookEntered = r; });
  RecoveryCoordinatorService.inFlightOperationHook = async () => {
    resolveHookEntered();
    await slowGate;
    state.slowCycleFinished = true;
  };

  const slowCyclePromise = RecoveryCoordinatorService.executeCoordinatedRecoveryCycle({ leaseDurationMs: 60000 });
  await hookEnteredPromise; // Guarantees lease was acquired and cycle is in-flight

  const timeoutDrainRes = await RecoveryCoordinatorService.drainAndShutdown({
    drainTimeoutMs: 10, // Deterministic immediate timeout threshold
    disconnectDbFn: async () => {
      state.dbDisconnectedOnTimeout = true;
    }
  });

  check(timeoutDrainRes.drained === false, 'P5.2 Timeout drain reports drained: false');
  check(state.dbDisconnectedOnTimeout === false, 'P5.2b Database disconnection withheld when drain times out');

  // Check that lease was NOT prematurely expired during in-flight execution
  const lockDuringInFlight = await WorkerLock.findOne({ lockName: 'RECOVERY_COORDINATOR_LEADER' });
  const leaseStillActive = lockDuringInFlight?.leaseExpiresAt && lockDuringInFlight.leaseExpiresAt.getTime() > Date.now();
  check(Boolean(leaseStillActive), 'P5.2c Worker lease is NOT prematurely released while cycle still executing');

  // Settle slow cycle
  resolveSlowGate();
  await slowCyclePromise;
  check(state.slowCycleFinished === true, 'P5.2d Slow cycle finished safely');

  // 3. Pending initial recovery scheduler timer is cancelled upon stop
  RecoveryCoordinatorService.resetShutdownStateForTesting();
  RecoveryCoordinatorService.startRecoveryScheduler();
  RecoveryCoordinatorService.stopRecoveryScheduler();
  const activeAfterStop = RecoveryCoordinatorService.getActiveCyclePromise();
  check(activeAfterStop === null, 'P5.3 Pending initial scheduler timer cancelled upon stop');

  // 4. Background tasks tracked during drain
  RecoveryCoordinatorService.resetShutdownStateForTesting();
  let resolveBgTask!: () => void;
  const bgPromise = new Promise<void>((resolve) => {
    resolveBgTask = () => {
      state.bgTaskDone = true;
      resolve();
    };
  });
  RecoveryCoordinatorService.trackBackgroundTask(bgPromise);
  const awaitBgPromise = RecoveryCoordinatorService.awaitActiveCycle(1000);
  resolveBgTask();
  const drainedBg = await awaitBgPromise;
  check(drainedBg === true && state.bgTaskDone === true, 'P5.4 Background tasks tracked and awaited during cycle drain');

  // 5. Signal handling idempotency
  const firstShutdownCall = await handleGracefulShutdown('SIGTERM');
  check(firstShutdownCall === true, 'P5.5 Initial server shutdown returns true');
  const secondShutdownCall = await handleGracefulShutdown('SIGTERM');
  check(secondShutdownCall === false, 'P5.5b Duplicate server shutdown signal ignored (returns false)');

  const firstWorkerCall = await handleWorkerShutdown('SIGINT');
  check(firstWorkerCall === true, 'P5.6 Initial worker shutdown returns true');
  const secondWorkerCall = await handleWorkerShutdown('SIGINT');
  check(secondWorkerCall === false, 'P5.6b Duplicate worker shutdown signal ignored (returns false)');
  RecoveryCoordinatorService.resetShutdownStateForTesting();
}

async function runRemainingDefectTests() {
  console.log('\n--- SECTION 6: REMAINING DEFECTS A-F VERIFICATION ---');
  await connectSafeTestDb();
  enforceTestRazorpayMock(razorpayProvider);
  const userId = new mongoose.Types.ObjectId();
  const adminId = new mongoose.Types.ObjectId();

  // A1: Reservation selection on SAME reservation object without attempt substitution
  const orderA1 = await Order.create({
    orderNumber: `ORD-A1-${Date.now()}`,
    userId,
    items: [],
    subtotal: 1000,
    total: 1000,
    currency: 'INR',
    status: 'DELIVERED',
    paymentStatus: 'PAID',
    paymentMethod: 'RAZORPAY',
    shippingAddress: { fullName: 'Customer', phone: '9876543210', addressLine1: 'Park St', city: 'Kolkata', state: 'WB', postalCode: '700016', country: 'India' }
  });

  const refSharedId = new mongoose.Types.ObjectId();
  const paymentA1 = await Payment.create({
    orderId: orderA1._id,
    userId,
    amount: 1000,
    currency: 'INR',
    status: 'CAPTURED',
    razorpayPaymentId: `pay_a1_${Date.now()}`,
    pendingRefundAmount: 800,
    refundedAmount: 0,
    refundReservations: [
      {
        reservationId: 'res_a1_att1',
        refundId: refSharedId,
        attemptNumber: 1, // Attempt 1 with amount 500
        amount: 500,
        status: 'PENDING'
      },
      {
        reservationId: 'res_a1_att2',
        refundId: refSharedId,
        attemptNumber: 2, // Attempt 2 with amount 300
        amount: 300,
        status: 'PENDING'
      }
    ]
  });

  // Call transitionPaymentReservation for Attempt 2 with amount 500
  // Res 1 has amount 500 but attempt 1. Res 2 has attempt 2 but amount 300.
  // The system must NOT substitute attempt 1 from Res 1 to match the amount!
  const transA1 = await transitionPaymentReservation({
    paymentId: paymentA1._id,
    refundId: refSharedId,
    amount: 500,
    targetState: 'CONSUMED',
    attemptNumber: 2
  });
  check(transA1.success === false, 'A1.1 Mismatched attemptNumber on same object fails closed (never substitutes attemptNumber from another reservation)');

  // A2: applyProviderRefundSettlement requires independently verified provider success
  const unverifiedRefund = await Refund.create({
    orderId: orderA1._id,
    paymentId: paymentA1._id,
    userId,
    amount: 300,
    currency: 'INR',
    status: 'PROCESSED', // Manually set status alone
    submissionState: 'INTENT_CREATED', // But submissionState is NOT CONFIRMED!
    razorpayRefundId: `rfnd_unverified_${Date.now()}`,
    attemptNumber: 1,
    idempotencyKey: `idemp_unv_${Date.now()}`,
    initiatedBy: adminId,
    initiatedByRole: 'ADMIN'
  });

  const unverifiedSettleRes = await applyProviderRefundSettlement({
    paymentId: paymentA1._id,
    refundId: unverifiedRefund._id,
    razorpayRefundId: unverifiedRefund.razorpayRefundId,
    amount: 300,
    currency: 'INR',
    unlinked: false
  });
  check(unverifiedSettleRes.success === false && unverifiedSettleRes.outcome === 'SETTLEMENT_CONFLICT', 'A2.1 applyProviderRefundSettlement rejects refund lacking submissionState: CONFIRMED');

  // A3: Prevent double credit on unlinked settlement after BALANCE_CONFLICT
  const paymentA3 = await Payment.create({
    orderId: new mongoose.Types.ObjectId(),
    userId,
    amount: 1000,
    currency: 'INR',
    status: 'CAPTURED',
    razorpayPaymentId: `pay_a3_${Date.now()}`,
    pendingRefundAmount: 400,
    refundedAmount: 400, // Already credited once via unlinked settlement!
    refundReservations: [
      {
        reservationId: 'res_a3_conflict',
        refundId: refSharedId,
        attemptNumber: 1,
        amount: 400,
        status: 'PENDING'
      }
    ],
    settledRefunds: [
      {
        refundId: refSharedId,
        razorpayRefundId: 'rfnd_a3_prior',
        amount: 400,
        currency: 'INR',
        settledAt: new Date(),
        unlinked: true, // Prior unlinked settlement!
        settlementReason: 'BALANCE_CONFLICT'
      }
    ]
  });

  // Now recovery transitions the pending reservation
  const transA3 = await transitionPaymentReservation({
    paymentId: paymentA3._id,
    refundId: refSharedId,
    reservationId: 'res_a3_conflict',
    amount: 400,
    targetState: 'CONSUMED',
    attemptNumber: 1
  });
  check(transA3.refundedAdjusted === 0, 'A3.1 transitionPaymentReservation does NOT increment refundedAmount again after unlinked settlement');
  const freshPayA3 = await Payment.findById(paymentA3._id);
  check(freshPayA3?.refundedAmount === 400, 'A3.1b Payment refundedAmount strictly remains 400 (not double-credited to 800)');
  check(freshPayA3?.pendingRefundAmount === 0, 'A3.1c Pending hold cleanly decremented to 0');

  // A4: reconcileUnknownRefund never replaces saved Razorpay refund ID
  const refundA4 = await Refund.create({
    orderId: orderA1._id,
    paymentId: paymentA1._id,
    userId,
    amount: 200,
    currency: 'INR',
    status: 'UNKNOWN',
    submissionState: 'SUBMITTED',
    razorpayRefundId: 'rfnd_original_saved_id', // Saved ID
    razorpayPaymentId: paymentA1.razorpayPaymentId,
    attemptNumber: 1,
    idempotencyKey: `idemp_a4_${Date.now()}`,
    initiatedBy: adminId,
    initiatedByRole: 'ADMIN'
  });

  // Mock Razorpay client to return a candidate in payments.refunds with a DIFFERENT ID but matching internal_refund_id
  razorpayProvider.getClient = () => ({
    refunds: {
      fetch: async () => { throw new Error('Not found directly'); }
    },
    payments: {
      refunds: async () => ({
        items: [{
          id: 'rfnd_different_candidate_id',
          status: 'processed',
          notes: { internal_refund_id: refundA4._id.toString() }
        }]
      })
    }
  } as any);

  const recA4 = await reconcileUnknownRefund(refundA4._id.toString());
  check(recA4.razorpayRefundId === 'rfnd_original_saved_id', 'A4.1 reconcileUnknownRefund strictly preserves original saved razorpayRefundId (never overwrites)');
  check(recA4.status === 'UNKNOWN', 'A4.1b Status preserved as UNKNOWN with conflict flag when candidate ID mismatches');

  enforceTestRazorpayMock(razorpayProvider);

  // C: Standalone cancellation REFUND intent recovery using durable operation marker
  const { product: prodC, variantIds: varIdsC } = await createTestProduct({
    name: 'C Test Tee',
    variants: [{ size: 'M', color: 'WHITE', stock: 20, isAvailable: true }]
  });
  const varIdC = new mongoose.Types.ObjectId(varIdsC[0]);

  const orderC = await Order.create({
    orderNumber: `ORD-C-${Date.now()}`,
    userId,
    items: [{
      productId: prodC._id,
      variantId: varIdC,
      productName: 'C Test Tee',
      productImage: 'https://example.com/c.jpg',
      selectedSize: 'M',
      selectedColor: 'WHITE',
      quantity: 3,
      unitPrice: 300,
      lineTotal: 900
    }],
    subtotal: 900,
    total: 900,
    currency: 'INR',
    status: 'CONFIRMED',
    paymentStatus: 'PAID',
    paymentMethod: 'RAZORPAY',
    shippingAddress: { fullName: 'Customer', phone: '9876543210', addressLine1: 'Park St', city: 'Kolkata', state: 'WB', postalCode: '700016', country: 'India' }
  });

  await InventoryTransaction.create({
    orderId: orderC._id,
    productId: prodC._id,
    variantId: varIdC,
    quantity: 3,
    type: 'SALE',
    status: 'COMPLETED'
  });

  // Deduct stock for the SALE
  await Product.updateOne({ _id: prodC._id, 'variants._id': varIdC }, { $inc: { 'variants.$.stock': -3 } });

  // Simulate a crash after creating PENDING REFUND intent:
  const pendingRefundTx = await InventoryTransaction.create({
    orderId: orderC._id,
    productId: prodC._id,
    variantId: varIdC,
    quantity: 3,
    type: 'REFUND',
    status: 'PENDING'
  });

  // Run restoreCancelledOrderInventory -> must resume the pending intent and restore stock
  const resC = await InventoryAllocationService.restoreCancelledOrderInventory(orderC._id);
  check(resC.restoredCount === 1, 'C.1 PENDING cancellation REFUND intent successfully resumed after crash');

  const prodCAfter = await Product.findById(prodC._id);
  check(prodCAfter?.variants[0]?.stock === 20, 'C.1b Stock correctly restored to 20 after resuming PENDING intent');

  const freshPendingTx = await InventoryTransaction.findById(pendingRefundTx._id);
  check(freshPendingTx?.status === 'COMPLETED', 'C.1c Resumed PENDING transaction transitioned to COMPLETED');

  // E: Recovery queue fairness - bounded backoff on inconclusive UNKNOWN refund
  const refundE = await Refund.create({
    orderId: orderA1._id,
    paymentId: paymentA1._id,
    userId,
    amount: 100,
    currency: 'INR',
    status: 'UNKNOWN',
    razorpayPaymentId: paymentA1.razorpayPaymentId,
    reconciliationAttemptCount: 1,
    attemptNumber: 1,
    idempotencyKey: `idemp_e_${Date.now()}`,
    initiatedBy: adminId,
    initiatedByRole: 'ADMIN'
  });

  // Mock Razorpay client to return empty list (inconclusive)
  razorpayProvider.getClient = () => ({
    payments: {
      refunds: async () => ({ items: [] })
    }
  } as any);

  await reconcileIncompleteRefundOperations();

  const freshRefE = await Refund.findById(refundE._id);
  check(Boolean(freshRefE?.nextReconcileAt && freshRefE.nextReconcileAt.getTime() > Date.now()), 'E.1 Inconclusive UNKNOWN refund receives future nextReconcileAt (bounded backoff)');
  check((freshRefE?.reconciliationAttemptCount || 0) >= 2, 'E.1b Reconciliation attempt count incremented');

  enforceTestRazorpayMock(razorpayProvider);

  // F: Order cancellation does not mark paymentStatus REFUNDED unless full settlement is verified
  const orderF = await Order.create({
    orderNumber: `ORD-F-${Date.now()}`,
    userId,
    items: [],
    subtotal: 1000,
    total: 1000,
    currency: 'INR',
    status: 'DELIVERED',
    paymentStatus: 'PAID',
    paymentMethod: 'RAZORPAY',
    shippingAddress: { fullName: 'Customer', phone: '9876543210', addressLine1: 'Park St', city: 'Kolkata', state: 'WB', postalCode: '700016', country: 'India' }
  });

  const paymentF = await Payment.create({
    orderId: orderF._id,
    userId,
    amount: 1000,
    currency: 'INR',
    status: 'CAPTURED',
    razorpayPaymentId: `pay_f_${Date.now()}`,
    pendingRefundAmount: 0,
    refundedAmount: 0,
    refundReservations: []
  });

  await PaymentAttempt.create({
    paymentId: paymentF._id,
    orderId: orderF._id,
    razorpayPaymentId: paymentF.razorpayPaymentId,
    razorpayOrderId: `ord_f_${Date.now()}`,
    amount: 1000,
    currency: 'INR',
    status: 'CAPTURED'
  });

  // Mock createRefund to return pending (queued on gateway)
  razorpayProvider.createRefund = async () => ({
    id: `rfnd_queued_${Date.now()}`,
    entity: 'refund',
    amount: 100000,
    currency: 'INR',
    payment_id: paymentF.razorpayPaymentId!,
    status: 'pending', // Queued on gateway, NOT processed yet!
    created_at: Math.floor(Date.now() / 1000)
  });

  // Call cancel order via internal flow
  const refundF = await createInternalRefund({
    orderId: orderF._id.toString(),
    amount: 1000,
    reason: 'Customer cancelled queued refund test',
    actorId: userId.toString(),
    actorRole: 'CUSTOMER'
  });

  orderF.status = 'CANCELLED';
  if (refundF.status === 'PROCESSED') {
    const pDoc = await Payment.findOne({ orderId: orderF._id });
    if (pDoc && pDoc.refundedAmount >= pDoc.amount) {
      orderF.paymentStatus = 'REFUNDED';
    }
  }
  await orderF.save();

  const freshOrderF = await Order.findById(orderF._id);
  check(freshOrderF?.status === 'CANCELLED', 'F.1 Order status is CANCELLED');
  check(freshOrderF?.paymentStatus === 'PAID', 'F.1b paymentStatus remains PAID while refund is queued/pending (never prematurely set to REFUNDED)');

  enforceTestRazorpayMock(razorpayProvider);

  // Clean up
  await Payment.deleteMany({ _id: { $in: [paymentA1._id, paymentA3._id, paymentF._id] } });
  await Refund.deleteMany({ _id: { $in: [unverifiedRefund._id, refundA4._id, refundE._id, refundF._id] } });
  await Order.deleteMany({ _id: { $in: [orderA1._id, orderC._id, orderF._id] } });
  await Product.deleteMany({ _id: prodC._id });
  await InventoryTransaction.deleteMany({ orderId: { $in: [orderC._id] } });
}
async function runDefectsADTests() {
  console.log('\n--- SECTION 7: TARGETED INTEGRITY SUITE (DEFECTS A, B, C, D) ---');
  await connectSafeTestDb();
  enforceTestRazorpayMock(razorpayProvider);
  RecoveryCoordinatorService.resetShutdownStateForTesting();
  const userId = new mongoose.Types.ObjectId();
  const timestamp = Date.now();

  const cleanupPayments: mongoose.Types.ObjectId[] = [];
  const cleanupRefunds: mongoose.Types.ObjectId[] = [];
  const cleanupOrders: mongoose.Types.ObjectId[] = [];
  const cleanupReturns: mongoose.Types.ObjectId[] = [];
  const cleanupProducts: mongoose.Types.ObjectId[] = [];
  const cleanupTransactions: mongoose.Types.ObjectId[] = [];
  const cleanupWebhookEvents: string[] = [];
  const cleanupLocks: string[] = [];
  const cleanupPaymentAttempts: mongoose.Types.ObjectId[] = [];

  const trackPayment = <T extends { _id: mongoose.Types.ObjectId; orderId?: mongoose.Types.ObjectId }>(p: T): T => {
    cleanupPayments.push(p._id);
    if (p.orderId) cleanupOrders.push(p.orderId);
    return p;
  };
  const trackRefund = <T extends { _id: mongoose.Types.ObjectId }>(r: T): T => {
    cleanupRefunds.push(r._id);
    return r;
  };
  const trackOrder = <T extends { _id: mongoose.Types.ObjectId }>(o: T): T => {
    cleanupOrders.push(o._id);
    return o;
  };
  const trackReturn = <T extends { _id: mongoose.Types.ObjectId }>(ret: T): T => {
    cleanupReturns.push(ret._id);
    return ret;
  };
  const trackProduct = <T extends { _id: mongoose.Types.ObjectId }>(prod: T): T => {
    cleanupProducts.push(prod._id);
    return prod;
  };
  const trackLock = (lock: string): string => {
    cleanupLocks.push(lock);
    return lock;
  };
  const trackWebhookEvent = <T extends { eventId: string }>(evt: T): T => {
    cleanupWebhookEvents.push(evt.eventId);
    return evt;
  };
  const trackAttempt = <T extends { _id: mongoose.Types.ObjectId }>(att: T): T => {
    cleanupPaymentAttempts.push(att._id);
    return att;
  };
  const trackTx = <T extends { _id: mongoose.Types.ObjectId }>(tx: T): T => {
    cleanupTransactions.push(tx._id);
    return tx;
  };

  try {
  // ==========================================
  // DEFECT A: VERIFIED PROVIDER SUCCESS
  // ==========================================
  console.log('\n[DEFECT A: Verified Provider Success]');

  // A.1: Failed refund rejection
  const paymentA1 = await Payment.create({
    orderId: new mongoose.Types.ObjectId(),
    userId,
    amount: 1000,
    currency: 'INR',
    status: 'CAPTURED',
    refundedAmount: 0,
    pendingRefundAmount: 0,
    razorpayPaymentId: `pay_a1_${timestamp}`
  });
  const refundA1 = await Refund.create({
    orderId: paymentA1.orderId,
    paymentId: paymentA1._id,
    userId,
    initiatedBy: userId,
    initiatedByRole: 'ADMIN',
    amount: 300,
    currency: 'INR',
    status: 'FAILED',
    submissionState: 'CONFIRMED',
    razorpayRefundId: `rfnd_fail_${timestamp}`,
    accountingSettlementStatus: 'PENDING'
  });
  const resA1 = await applyProviderRefundSettlement({
    paymentId: paymentA1._id,
    refundId: refundA1._id,
    razorpayRefundId: `rfnd_fail_${timestamp}`,
    amount: 300,
    currency: 'INR'
  });
  check(resA1.success === false, 'A.1 Failed refund is rejected by applyProviderRefundSettlement');
  check(resA1.outcome === 'SETTLEMENT_CONFLICT', 'A.1 Outcome is SETTLEMENT_CONFLICT');
  const pA1After = await Payment.findById(paymentA1._id);
  check(pA1After?.refundedAmount === 0, 'A.1 Failed refund does not increment refundedAmount');

  // A.2: Unconfirmed refund rejection
  const refundA2 = await Refund.create({
    orderId: paymentA1.orderId,
    paymentId: paymentA1._id,
    userId,
    initiatedBy: userId,
    initiatedByRole: 'ADMIN',
    amount: 200,
    currency: 'INR',
    status: 'PROCESSING',
    submissionState: 'SUBMITTED',
    razorpayRefundId: `rfnd_proc_${timestamp}`,
    accountingSettlementStatus: 'PENDING'
  });
  const resA2 = await applyProviderRefundSettlement({
    paymentId: paymentA1._id,
    refundId: refundA2._id,
    razorpayRefundId: `rfnd_proc_${timestamp}`,
    amount: 200,
    currency: 'INR'
  });
  check(resA2.success === false, 'A.2 Unconfirmed refund is rejected by applyProviderRefundSettlement');
  const pA2After = await Payment.findById(paymentA1._id);
  check(pA2After?.refundedAmount === 0, 'A.2 Unconfirmed refund does not increment refundedAmount');

  // A.3: Replay idempotency
  const refundA3 = await Refund.create({
    orderId: paymentA1.orderId,
    paymentId: paymentA1._id,
    userId,
    initiatedBy: userId,
    initiatedByRole: 'ADMIN',
    amount: 400,
    currency: 'INR',
    status: 'PROCESSED',
    submissionState: 'CONFIRMED',
    razorpayRefundId: `rfnd_succ_${timestamp}`,
    processedAt: new Date(),
    accountingSettlementStatus: 'PENDING'
  });
  const resA3First = await applyProviderRefundSettlement({
    paymentId: paymentA1._id,
    refundId: refundA3._id,
    razorpayRefundId: `rfnd_succ_${timestamp}`,
    amount: 400,
    currency: 'INR',
    unlinked: true
  });
  check(resA3First.success === true, 'A.3 First settlement of verified refund succeeds');
  const pA3Mid = await Payment.findById(paymentA1._id);
  check(pA3Mid?.refundedAmount === 400, 'A.3 Payment refundedAmount incremented to 400');

  const resA3Replay = await applyProviderRefundSettlement({
    paymentId: paymentA1._id,
    refundId: refundA3._id,
    razorpayRefundId: `rfnd_succ_${timestamp}`,
    amount: 400,
    currency: 'INR',
    unlinked: true
  });
  check(resA3Replay.success === true, 'A.3 Replay of same settlement succeeds');
  check(resA3Replay.outcome === 'ALREADY_SETTLED', 'A.3 Replay outcome is ALREADY_SETTLED');
  const pA3End = await Payment.findById(paymentA1._id);
  check(pA3End?.refundedAmount === 400, 'A.3 Replay does not double-credit refundedAmount');
  // A.4: Missing processedAt is rejected
  const refundA4 = await Refund.create({
    orderId: paymentA1.orderId,
    paymentId: paymentA1._id,
    userId,
    initiatedBy: userId,
    initiatedByRole: 'ADMIN',
    amount: 150,
    currency: 'INR',
    status: 'PROCESSED',
    submissionState: 'CONFIRMED',
    razorpayRefundId: `rfnd_noproc_${timestamp}`,
    accountingSettlementStatus: 'PENDING'
  });
  const resA4 = await applyProviderRefundSettlement({
    paymentId: paymentA1._id,
    refundId: refundA4._id,
    razorpayRefundId: `rfnd_noproc_${timestamp}`,
    amount: 150,
    currency: 'INR'
  });
  check(resA4.success === false, 'A.4 Missing processedAt is rejected by applyProviderRefundSettlement');

  // A.5: PENDING status with matching provider ID cannot be settled
  const refundA5 = await Refund.create({
    orderId: paymentA1.orderId,
    paymentId: paymentA1._id,
    userId,
    initiatedBy: userId,
    initiatedByRole: 'ADMIN',
    amount: 100,
    currency: 'INR',
    status: 'PENDING',
    submissionState: 'CONFIRMED',
    razorpayRefundId: `rfnd_pend_${timestamp}`,
    accountingSettlementStatus: 'PENDING'
  });
  const resA5 = await applyProviderRefundSettlement({
    paymentId: paymentA1._id,
    refundId: refundA5._id,
    razorpayRefundId: `rfnd_pend_${timestamp}`,
    amount: 100,
    currency: 'INR'
  });
  check(resA5.success === false, 'A.5 PENDING status with matching provider ID is rejected');

  // A.6: Duplicate processed webhook resumes incomplete settlement
  const paymentA6 = await Payment.create({
    orderId: new mongoose.Types.ObjectId(),
    userId,
    amount: 1000,
    currency: 'INR',
    status: 'CAPTURED',
    refundedAmount: 0,
    pendingRefundAmount: 50,
    razorpayPaymentId: `pay_a6_${timestamp}`
  });

  const refundA6 = await Refund.create({
    orderId: paymentA6.orderId,
    paymentId: paymentA6._id,
    userId,
    initiatedBy: userId,
    initiatedByRole: 'ADMIN',
    amount: 50,
    currency: 'INR',
    status: 'PROCESSED',
    processedAt: new Date(),
    submissionState: 'CONFIRMED',
    razorpayRefundId: `rfnd_resume_${timestamp}`,
    attemptNumber: 1,
    accountingSettlementStatus: 'PENDING'
  });

  paymentA6.refundReservations.push({
    reservationId: refundA6._id.toString(),
    refundId: refundA6._id,
    attemptNumber: 1,
    amount: 50,
    status: 'PENDING',
    createdAt: new Date(),
    updatedAt: new Date()
  });
  await paymentA6.save();

  await Order.create({
    _id: paymentA6.orderId,
    orderNumber: `ORD-A6-WH-${timestamp}`,
    userId,
    items: [],
    shippingAddress: { fullName: 'User A', addressLine1: 'Line', city: 'City', state: 'State', postalCode: '111', country: 'IN', phone: '123' },
    paymentMethod: 'ONLINE',
    subtotal: 1000,
    shipping: 0,
    tax: 0,
    total: 1000,
    status: 'CONFIRMED',
    paymentStatus: 'PAID'
  });

  const webhookResume = {
    id: `rfnd_resume_${timestamp}`,
    payment_id: paymentA6.razorpayPaymentId!,
    amount: 5000,
    currency: 'INR',
    status: 'processed',
    created_at: Math.floor(Date.now() / 1000),
    notes: { internal_refund_id: refundA6._id.toString() }
  };
  const resumeRes = await handleRefundProcessedEntity(webhookResume as any);
  check(resumeRes.outcome === 'PROCESSED', 'A.6 Duplicate webhook resumes incomplete settlement');
  const freshA6 = await Refund.findById(refundA6._id);
  check(freshA6?.accountingSettlementStatus === 'COMPLETED', 'A.6 Resumed settlement transitioned to COMPLETED');
  // A.7: Exact duplicate event with matching Refund and complete ledger identity returns ALREADY_SETTLED
  const dupWebhookRes = await handleRefundProcessedEntity(webhookResume as any);
  check(dupWebhookRes.outcome === 'PROCESSED', 'A.7 Duplicate webhook acknowledged');
  check(dupWebhookRes.reason === 'ALREADY_SETTLED', 'A.7 Duplicate webhook returns ALREADY_SETTLED on complete identity match');

  // A.8: Same internal refund ID but conflicting ledger provider refund ID is rejected
  const webhookSpoofedProvider = {
    ...webhookResume,
    id: `rfnd_spoofed_${timestamp}`
  };
  const spoofedRes = await handleRefundProcessedEntity(webhookSpoofedProvider as any);
  check(spoofedRes.outcome === 'RECONCILIATION_REQUIRED', 'A.8 Conflicting provider ID returns RECONCILIATION_REQUIRED');

  // A.9: Conflicting provider ID is never written over existing Refund ID
  const freshA6Preserved = await Refund.findById(refundA6._id);
  check(freshA6Preserved?.razorpayRefundId === `rfnd_resume_${timestamp}`, 'A.9 Original provider refund ID strictly preserved');

  // ==========================================
  // DEFECT B: CONCURRENT DOUBLE-CREDIT PREVENTION
  // ==========================================
  console.log('\n[DEFECT B: Concurrent Double-Credit Prevention]');

  // B.1: Two concurrent unlinked settlement calls produce exactly one financial credit
  const paymentB = await Payment.create({
    orderId: new mongoose.Types.ObjectId(),
    userId,
    amount: 1000,
    currency: 'INR',
    status: 'CAPTURED',
    refundedAmount: 0,
    pendingRefundAmount: 0,
    razorpayPaymentId: `pay_b_${timestamp}`
  });
  const refundB1 = await Refund.create({
    orderId: paymentB.orderId,
    paymentId: paymentB._id,
    userId,
    initiatedBy: userId,
    initiatedByRole: 'ADMIN',
    amount: 300,
    currency: 'INR',
    status: 'PROCESSED',
    submissionState: 'CONFIRMED',
    razorpayRefundId: `rfnd_b1_${timestamp}`,
    processedAt: new Date(),
    accountingSettlementStatus: 'PENDING'
  });

  const [concRes1, concRes2] = await Promise.all([
    applyProviderRefundSettlement({
      paymentId: paymentB._id,
      refundId: refundB1._id,
      razorpayRefundId: `rfnd_b1_${timestamp}`,
      amount: 300,
      currency: 'INR',
      unlinked: true
    }),
    applyProviderRefundSettlement({
      paymentId: paymentB._id,
      refundId: refundB1._id,
      razorpayRefundId: `rfnd_b1_${timestamp}`,
      amount: 300,
      currency: 'INR',
      unlinked: true
    })
  ]);
  const isSettledFound = concRes1.outcome === 'SETTLED' || concRes2.outcome === 'SETTLED';
  const isAlreadySettledFound = concRes1.outcome === 'ALREADY_SETTLED' || concRes2.outcome === 'ALREADY_SETTLED';
  check(
    isSettledFound && isAlreadySettledFound,
    'B.1 Concurrent calls produce exactly one active settlement and one ALREADY_SETTLED'
  );
  const pBAfter = await Payment.findById(paymentB._id);
  check(pBAfter?.refundedAmount === 300, 'B.1 Concurrent unlinked settlements produce exactly one credit', `refunded=${pBAfter?.refundedAmount}`);
  check(pBAfter?.settledRefunds?.length === 1, 'B.1 Exactly one entry in settledRefunds ledger');

  // B.2: Concurrent duplicate webhooks do not double-credit
  const webhookEntity = {
    id: `rfnd_wh_${timestamp}`,
    payment_id: paymentB.razorpayPaymentId!,
    amount: 20000, // 200 INR
    currency: 'INR',
    status: 'processed',
    created_at: Math.floor(Date.now() / 1000),
    notes: {
      internal_refund_id: new mongoose.Types.ObjectId().toString(),
      order_id: paymentB.orderId.toString()
    }
  };
  await Refund.create({
    _id: new mongoose.Types.ObjectId(webhookEntity.notes.internal_refund_id),
    orderId: paymentB.orderId,
    paymentId: paymentB._id,
    userId,
    initiatedBy: userId,
    initiatedByRole: 'ADMIN',
    amount: 200,
    currency: 'INR',
    status: 'PROCESSING',
    submissionState: 'CONFIRMED',
    razorpayRefundId: webhookEntity.id,
    accountingSettlementStatus: 'PENDING'
  });
  await Promise.all([
    handleRefundProcessedEntity(webhookEntity as any),
    handleRefundProcessedEntity(webhookEntity as any)
  ]);
  const pBAfterWh = await Payment.findById(paymentB._id);
  check(pBAfterWh?.refundedAmount === 500, 'B.2 Concurrent duplicate webhooks credit payment exactly once (300 + 200 = 500)', `refunded=${pBAfterWh?.refundedAmount}`);

  // B.3: A later reservation after an unlinked settlement releases the hold without another credit
  paymentB.pendingRefundAmount = 300;
  paymentB.refundReservations.push({
    reservationId: `res_late_${timestamp}`,
    refundId: refundB1._id,
    attemptNumber: 1,
    amount: 300,
    status: 'PENDING',
    createdAt: new Date(),
    updatedAt: new Date()
  });
  await paymentB.save();

  const lateTransRes = await transitionPaymentReservation({
    paymentId: paymentB._id,
    refundId: refundB1._id,
    reservationId: `res_late_${timestamp}`,
    amount: 300,
    attemptNumber: 1,
    targetState: 'CONSUMED'
  });
  check(lateTransRes.success === true, 'B.3 Late reservation transition succeeds');
  const pBLateAfter = await Payment.findById(paymentB._id);
  check(pBLateAfter?.pendingRefundAmount === 0, 'B.3 Late reservation released pending balance (decremented to 0)');
  check(pBLateAfter?.refundedAmount === 500, 'B.3 Late reservation did NOT double-credit refundedAmount (remained 500)');

  // B.4: Conflicting settlement identity is rejected without changing financial totals
  const resConfMismatch = await applyProviderRefundSettlement({
    paymentId: paymentB._id,
    refundId: refundB1._id,
    razorpayRefundId: `rfnd_b1_${timestamp}`,
    amount: 999,
    currency: 'INR'
  });
  check(resConfMismatch.success === false, 'B.4 Conflicting amount is rejected');
  check(resConfMismatch.outcome === 'SETTLEMENT_CONFLICT', 'B.4 Conflicting outcome is SETTLEMENT_CONFLICT');
  const pBConfAfter = await Payment.findById(paymentB._id);
  check(pBConfAfter?.refundedAmount === 500, 'B.4 Conflicting settlement did not alter refundedAmount');
  // B.5: BALANCE_CONFLICT with exact reservation credits only once and does not double-credit on later transition
  const paymentBConflict = await Payment.create({
    orderId: new mongoose.Types.ObjectId(),
    userId,
    amount: 1000,
    currency: 'INR',
    status: 'CAPTURED',
    refundedAmount: 0,
    pendingRefundAmount: 50,
    razorpayPaymentId: `pay_bc_${timestamp}`
  });
  const refundBConflict = await Refund.create({
    orderId: paymentBConflict.orderId,
    paymentId: paymentBConflict._id,
    userId,
    initiatedBy: userId,
    initiatedByRole: 'ADMIN',
    amount: 200,
    currency: 'INR',
    status: 'PROCESSED',
    processedAt: new Date(),
    submissionState: 'CONFIRMED',
    razorpayRefundId: `rfnd_bc_${timestamp}`,
    attemptNumber: 1
  });
  paymentBConflict.refundReservations.push({
    reservationId: `res_bc_${timestamp}`,
    refundId: refundBConflict._id,
    attemptNumber: 1,
    amount: 200,
    status: 'PENDING',
    createdAt: new Date(),
    updatedAt: new Date()
  });
  await paymentBConflict.save();

  const transConflict = await transitionPaymentReservation({
    paymentId: paymentBConflict._id,
    refundId: refundBConflict._id,
    reservationId: `res_bc_${timestamp}`,
    amount: 200,
    targetState: 'CONSUMED'
  });
  check(transConflict.outcome === 'BALANCE_CONFLICT', 'B.5 transition returns BALANCE_CONFLICT');

  const policyConflict = await resolveSettlementPolicy({
    paymentId: paymentBConflict._id,
    refundId: refundBConflict._id,
    transitionOutcome: transConflict.outcome,
    expectedReservationId: `res_bc_${timestamp}`,
    expectedAttemptNumber: 1,
    expectedAmount: 200,
    expectedProviderRefundId: `rfnd_bc_${timestamp}`,
    expectedCurrency: 'INR'
  });
  check(policyConflict.canProceedToSettlement === true, 'B.5 Can proceed to settlement');
  check(policyConflict.isUnlinkedSettlement === false, 'B.5 isUnlinkedSettlement is false (exact reservation exists)');
  check(policyConflict.settlementReason === 'BALANCE_CONFLICT_LINKED', 'B.5 Reason is BALANCE_CONFLICT_LINKED');

  const settleConflict = await applyProviderRefundSettlement({
    paymentId: paymentBConflict._id,
    refundId: refundBConflict._id,
    razorpayRefundId: `rfnd_bc_${timestamp}`,
    amount: 200,
    currency: 'INR',
    unlinked: policyConflict.isUnlinkedSettlement,
    settlementReason: policyConflict.settlementReason
  });
  check(settleConflict.success === true, 'B.5 Settlement applied successfully');
  check(settleConflict.refundedAdjusted === 200, 'B.5 Missing credit (+200) applied once');
  const pBCAfter = await Payment.findById(paymentBConflict._id);
  check(pBCAfter?.refundedAmount === 200, 'B.5 Payment refundedAmount incremented to 200');

  await transitionPaymentReservation({
    paymentId: paymentBConflict._id,
    refundId: refundBConflict._id,
    reservationId: `res_bc_${timestamp}`,
    amount: 200,
    targetState: 'CONSUMED'
  });
  const pBCFinal = await Payment.findById(paymentBConflict._id);
  check(pBCFinal?.refundedAmount === 200, 'B.5 Subsequent transition strictly preserves refundedAmount at 200 (no double credit)');
  // B.6: Missing historical provider refund ID in ledger returns conflict (B1 safety rule)
  const testRefId1 = new mongoose.Types.ObjectId();
  const legacyCheck = findExactSettlementRecord(
    [{ refundId: testRefId1, amount: 200, currency: 'INR' } as any],
    testRefId1,
    200,
    'INR'
  );
  check(Boolean(legacyCheck.conflict), 'B.6 Missing historical provider ID returns conflict');

  // B.7: Missing historical currency in ledger returns conflict
  const testRefId2 = new mongoose.Types.ObjectId();
  const legacyCurCheck = findExactSettlementRecord(
    [{ refundId: testRefId2, razorpayRefundId: 'rfnd_hist_1', amount: 200 } as any],
    testRefId2,
    200,
    'INR'
  );
  check(Boolean(legacyCurCheck.conflict), 'B.7 Missing historical currency returns conflict');

  // B.8: Contradictory attempt/amount on reservation fails closed in resolveSettlementPolicy (B2)
  const policyConflictAttempt = await resolveSettlementPolicy({
    paymentId: paymentBConflict._id,
    refundId: refundBConflict._id,
    transitionOutcome: 'BALANCE_CONFLICT',
    expectedReservationId: `res_bc_${timestamp}`,
    expectedAttemptNumber: 99,
    expectedAmount: 200,
    expectedProviderRefundId: `rfnd_bc_${timestamp}`,
    expectedCurrency: 'INR'
  });
  check(policyConflictAttempt.canProceedToSettlement === false, 'B.8 Contradictory attempt fails closed');
  check(policyConflictAttempt.settlementReason === 'BALANCE_CONFLICT_RESERVATION_CONFLICT', 'B.8 Reason is BALANCE_CONFLICT_RESERVATION_CONFLICT');

  // B.9: Contradictory reservation cannot be classified as RESERVATION_NOT_FOUND (B2)
  const policyNotFoundConflict = await resolveSettlementPolicy({
    paymentId: paymentBConflict._id,
    refundId: refundBConflict._id,
    transitionOutcome: 'RESERVATION_NOT_FOUND',
    expectedReservationId: `res_bc_${timestamp}`,
    expectedAttemptNumber: 1,
    expectedAmount: 200,
    expectedProviderRefundId: `rfnd_bc_${timestamp}`,
    expectedCurrency: 'INR'
  });
  check(policyNotFoundConflict.canProceedToSettlement === false, 'B.9 Existing contradictory reservation rejects RESERVATION_NOT_FOUND');
  check(policyNotFoundConflict.settlementReason === 'RESERVATION_NOT_FOUND_CONFLICT', 'B.9 Reason is RESERVATION_NOT_FOUND_CONFLICT');

  // B.10: Final atomic mutation rejects when reservation was modified/deleted after policy resolution (B4)
  const resMutConflict = await applyProviderRefundSettlement({
    paymentId: paymentBConflict._id,
    refundId: refundBConflict._id,
    razorpayRefundId: `rfnd_bc_mut_${timestamp}`,
    amount: 200,
    currency: 'INR',
    settlementReason: 'BALANCE_CONFLICT_LINKED',
    expectedReservationId: `res_nonexistent_${timestamp}`,
    expectedAttemptNumber: 1
  });
  check(resMutConflict.success === false, 'B.10 Modified reservation rejected at final atomic mutation');
  check(resMutConflict.outcome === 'SETTLEMENT_CONFLICT', 'B.10 Mutation outcome is SETTLEMENT_CONFLICT');

  // ==========================================
  // DEFECT C: WORKER LEASE LOSS PROTECTION
  // ==========================================
  console.log('\n[DEFECT C: Worker Lease Loss Protection]');

  // C.1: Normal execution with a valid lease completes
  const lockNameC = `lock_test_c_${timestamp}`;
  const ownerC1 = 'worker_instance_c1';
  const acquiredC1 = await RecoveryCoordinatorService.acquireWorkerLease(lockNameC, ownerC1, 10_000);
  check(acquiredC1.acquired === true, 'C.1 Lease acquisition succeeds');
  check(typeof acquiredC1.fencingToken === 'number', 'C.1 Fencing token assigned');

  // C.2: Lease loss during an active task is detected & remaining items not mutated
  const testProd = await createTestProduct({ basePrice: 500 });
  trackProduct(testProd.product);
  const prodId = new mongoose.Types.ObjectId(testProd.productId);
  const varId = new mongoose.Types.ObjectId(testProd.variantIds[0]);
  cleanupProducts.push(prodId);

  const txList = await Promise.all([1, 2, 3].map(i =>
    InventoryTransaction.create({
      orderId: new mongoose.Types.ObjectId(),
      productId: prodId,
      variantId: varId,
      type: 'RETURN',
      status: 'PENDING',
      quantity: 1,
      reason: `Lease loss test item ${i}`
    })
  ));
  cleanupTransactions.push(...txList.map(t => t._id));

  let calls = 0;
  const dynamicLeaseGuard = async () => {
    calls++;
    if (calls > 1) {
      return false;
    }
    return true;
  };

  const invRecResult = await InventoryAllocationService.reconcilePendingInventoryRestorations(dynamicLeaseGuard);
  check(invRecResult.resolvedCount === 1, 'C.2 In-task lease loss aborted after 1 item, remaining items not mutated', `resolved=${invRecResult.resolvedCount}`);

  // C.3: Stale worker cannot mutate data after another worker acquires a newer fencing token
  const ownerC2 = 'worker_instance_c2';
  await WorkerLock.updateOne({ lockName: lockNameC }, { $set: { leaseExpiresAt: new Date(0) } });
  const acquiredC2 = await RecoveryCoordinatorService.acquireWorkerLease(lockNameC, ownerC2, 10_000);
  check(acquiredC2.acquired === true, 'C.3 Worker 2 acquired lock with newer fencing token');
  check(acquiredC2.fencingToken! > acquiredC1.fencingToken!, 'C.3 Newer fencing token is strictly greater');

  const renewByStale = await RecoveryCoordinatorService.renewWorkerLease(lockNameC, ownerC1, acquiredC1.fencingToken!, 10_000);
  check(renewByStale === false, 'C.3 Stale worker renewal rejected by database fencing filter');

  const releaseByStale = await RecoveryCoordinatorService.releaseWorkerLease(lockNameC, ownerC1, acquiredC1.fencingToken!);
  check(releaseByStale === false, 'C.3 Stale worker release rejected by database fencing filter');

  const activeLockCheck = await WorkerLock.findOne({ lockName: lockNameC });
  check(activeLockCheck?.ownerId === ownerC2, 'C.3 Worker 2 still owns the lock');
  check(activeLockCheck?.fencingToken === acquiredC2.fencingToken, 'C.3 Worker 2 fencing token intact');

  // C.4: withRecoveryLeaseFence executes business mutations and commits under active WorkerLock
  let txCommittedValue: boolean = false;
  const testOrderIdC = new mongoose.Types.ObjectId();
  await RecoveryCoordinatorService.withRecoveryLeaseFence(
    { fencingToken: acquiredC2.fencingToken!, lockName: lockNameC, ownerId: ownerC2 },
    async (session) => {
      await Payment.create(
        [
          {
            orderId: testOrderIdC,
            userId,
            amount: 500,
            currency: 'INR',
            status: 'CAPTURED',
            refundedAmount: 0,
            pendingRefundAmount: 0
          }
        ],
        { session }
      );
      txCommittedValue = true;
    }
  );
  check(Boolean(txCommittedValue), 'C.4 Fenced transaction executed and committed');
  const paymentCCommitted = await Payment.findOne({ orderId: testOrderIdC });
  check(Boolean(paymentCCommitted), 'C.4 Payment document verified in database after commit');

  // C.5: Fenced transaction with stolen/outdated fencing token aborts transaction and rolls back
  const staleOrderIdC = new mongoose.Types.ObjectId();
  let fenceFailed: boolean = false;
  try {
    // Attempt with outdated token (acquiredC1.fencingToken < acquiredC2.fencingToken)
    await RecoveryCoordinatorService.withRecoveryLeaseFence(
      { fencingToken: acquiredC1.fencingToken!, lockName: lockNameC, ownerId: ownerC1 },
      async (session) => {
        await Payment.create(
          [
            {
              orderId: staleOrderIdC,
              userId,
              amount: 500,
              currency: 'INR',
              status: 'CAPTURED',
              refundedAmount: 0,
              pendingRefundAmount: 0
            }
          ],
          { session }
        );
      }
    );
  } catch (err: any) {
    fenceFailed = true;
    check(err?.code === 'WORKER_LEASE_FENCED_OUT' || err?.statusCode === 409, 'C.5 Error code is WORKER_LEASE_FENCED_OUT');
  }
  check(Boolean(fenceFailed), 'C.5 Stale fencing token threw error and aborted');
  const stalePaymentCheck = await Payment.findOne({ orderId: staleOrderIdC });
  check(stalePaymentCheck === null, 'C.5 Stale transaction rolled back completely (no payment document created)');
  await RecoveryCoordinatorService.releaseWorkerLease(lockNameC, ownerC2, acquiredC2.fencingToken!);

  // ==========================================
  // DEFECT D: RETURNREQUEST TERMINAL VERIFICATION
  // ==========================================
  console.log('\n[DEFECT D: ReturnRequest Terminal Verification]');

  const returnOrder: any = await Order.create({
    orderNumber: `ORD-D-${Date.now()}`,
    userId,
    items: [],
    shippingAddress: { fullName: 'User D', addressLine1: 'Line', city: 'City', state: 'State', postalCode: '111', country: 'IN', phone: '123' },
    paymentMethod: 'ONLINE',
    subtotal: 500,
    shipping: 0,
    tax: 0,
    total: 500,
    status: 'DELIVERED',
    paymentStatus: 'PAID'
  });

  const returnDoc: any = await ReturnRequest.create({
    orderId: returnOrder._id,
    userId,
    items: [{ productId: prodId, variantId: varId, quantity: 1, reason: 'WRONG_SIZE' }],
    status: 'ACCEPTED',
    refundStatus: 'PENDING',
    inventoryRestored: true
  });

  const refundD = await Refund.create({
    orderId: returnOrder._id,
    returnId: returnDoc._id,
    paymentId: new mongoose.Types.ObjectId(),
    userId,
    initiatedBy: userId,
    initiatedByRole: 'ADMIN',
    amount: 500,
    currency: 'INR',
    status: 'PROCESSED',
    attemptNumber: 1
  });
  // D.1: Successful processing results in persisted COMPLETED
  const syncSuccess = await syncReturnRequestWithRefund({
    returnId: returnDoc._id.toString(),
    refundId: refundD._id.toString(),
    orderId: returnOrder._id.toString(),
    refundStatus: 'PROCESSED',
    attemptNumber: 1
  });
  check(syncSuccess.success === true, 'D.1 Terminal sync returns success: true');
  const persistedRet1 = await ReturnRequest.findById(returnDoc._id);
  check(persistedRet1?.status === 'COMPLETED', 'D.1 Persisted status is COMPLETED');
  check(persistedRet1?.refundStatus === 'PROCESSED', 'D.1 Persisted refundStatus is PROCESSED');
  check(persistedRet1?.refundId?.toString() === refundD._id.toString(), 'D.1 Persisted refundId matches');

  // D.2: Replaying the same successful operation is idempotent
  const syncReplay = await syncReturnRequestWithRefund({
    returnId: returnDoc._id.toString(),
    refundId: refundD._id.toString(),
    orderId: returnOrder._id.toString(),
    refundStatus: 'PROCESSED',
    attemptNumber: 1
  });
  check(syncReplay.success === true, 'D.2 Replay of completed return is idempotent and succeeds');
  const persistedRetReplay = await ReturnRequest.findById(returnDoc._id);
  check(persistedRetReplay?.status === 'COMPLETED', 'D.2 Persisted status remains COMPLETED');

  // D.3: An older attempt cannot overwrite a newer attempt
  const syncOlderAttempt = await syncReturnRequestWithRefund({
    returnId: returnDoc._id.toString(),
    refundId: new mongoose.Types.ObjectId().toString(),
    orderId: returnOrder._id.toString(),
    refundStatus: 'FAILED',
    attemptNumber: 0
  });
  check(syncOlderAttempt.success === false, 'D.3 Older attempt cannot overwrite ReturnRequest');

  // D.4: Ownership mismatch cannot be reported as successful
  const syncMismatch = await syncReturnRequestWithRefund({
    returnId: returnDoc._id.toString(),
    refundId: refundD._id.toString(),
    orderId: new mongoose.Types.ObjectId().toString(),
    refundStatus: 'PROCESSED',
    attemptNumber: 1
  });
  check(syncMismatch.success === false, 'D.4 Order ownership mismatch rejected');

  // D.5: Failed terminal transition cannot return success
  const returnDocNotAccepted: any = await ReturnRequest.create({
    orderId: returnOrder._id,
    userId,
    items: [{ productId: prodId, variantId: varId, quantity: 1, reason: 'WRONG_SIZE' }],
    status: 'REQUESTED',
    refundStatus: 'PENDING',
    inventoryRestored: true
  });
  const syncNotAccepted = await syncReturnRequestWithRefund({
    returnId: returnDocNotAccepted._id.toString(),
    refundId: refundD._id.toString(),
    orderId: returnOrder._id.toString(),
    refundStatus: 'PROCESSED',
    attemptNumber: 1
  });
  check(syncNotAccepted.success === false, 'D.5 Non-ACCEPTED return cannot transition to COMPLETED');
  const persistedNotAccepted = await ReturnRequest.findById(returnDocNotAccepted._id);
  check(persistedNotAccepted?.status === 'REQUESTED', 'D.5 Persisted status remains REQUESTED');
  // D.6: Inventory restoration failure aborts ReturnRequest completion and rolls back transaction
  const badProductReturn: any = await ReturnRequest.create({
    orderId: returnOrder._id,
    userId,
    items: [{ productId: new mongoose.Types.ObjectId(), variantId: new mongoose.Types.ObjectId(), quantity: 1, reason: 'DEFECTIVE' }],
    status: 'ACCEPTED',
    refundStatus: 'PENDING',
    inventoryRestored: false
  });
  const badSyncRes = await syncReturnRequestWithRefund({
    returnId: badProductReturn._id.toString(),
    refundId: new mongoose.Types.ObjectId().toString(),
    orderId: returnOrder._id.toString(),
    refundStatus: 'PROCESSED',
    attemptNumber: 1
  });
  check(badSyncRes.success === false, 'D.6 Sync returns success: false on inventory restoration failure');
  const badReturnCheck = await ReturnRequest.findById(badProductReturn._id);
  check(badReturnCheck?.status === 'ACCEPTED', 'D.6 ReturnRequest remains ACCEPTED (not COMPLETED)');
  check(badReturnCheck?.refundStatus === 'PENDING', 'D.6 refundStatus remains PENDING (rolled back)');
  check(badReturnCheck?.inventoryRestored === false, 'D.6 inventoryRestored remains false');
  // D.7: Final allCompleted === false in restoreReturnInventory prevents ReturnRequest completion
  const partialInvOrder: any = await Order.create({
    orderNumber: `ORD-PART-INV-${Date.now()}`,
    userId,
    items: [],
    shippingAddress: { fullName: 'User D', addressLine1: 'Line', city: 'City', state: 'State', postalCode: '111', country: 'IN', phone: '123' },
    paymentMethod: 'ONLINE',
    subtotal: 500,
    shipping: 0,
    tax: 0,
    total: 500,
    status: 'DELIVERED',
    paymentStatus: 'PAID'
  });
  const partialReturnReq: any = await ReturnRequest.create({
    orderId: partialInvOrder._id,
    userId,
    items: [
      { productId: prodId, variantId: varId, quantity: 1, reason: 'DEFECTIVE' },
      { productId: new mongoose.Types.ObjectId(), variantId: new mongoose.Types.ObjectId(), quantity: 1, reason: 'DEFECTIVE' }
    ],
    status: 'ACCEPTED',
    refundStatus: 'PENDING',
    inventoryRestored: false
  });
  try {
    const partialRestoreRes = await InventoryAllocationService.restoreReturnInventory(partialReturnReq, partialInvOrder._id);
    check(partialRestoreRes.alreadyRestored === false, 'D.7 Incomplete inventory restoration returns alreadyRestored: false');
  } catch (err: any) {
    check(Boolean(err), 'D.7 Incomplete inventory restoration threw error as expected');
  }
  const checkPartialReq = await ReturnRequest.findById(partialReturnReq._id);
  check(checkPartialReq?.inventoryRestored === false, 'D.7 ReturnRequest inventoryRestored remains false');

  // D.8: Caller-owned session failure in syncReturnRequestWithRefund throws RETURN_SYNC_FAILED and aborts transaction
  const callerSession = await mongoose.startSession();
  callerSession.startTransaction();
  let callerAborted = false;
  try {
    await syncReturnRequestWithRefund({
      returnId: returnDocNotAccepted._id.toString(),
      refundId: new mongoose.Types.ObjectId().toString(),
      orderId: returnOrder._id.toString(),
      refundStatus: 'PROCESSED',
      attemptNumber: 1,
      session: callerSession
    });
    await callerSession.commitTransaction();
  } catch (err: any) {
    callerAborted = true;
    check(err?.code === 'RETURN_SYNC_FAILED' || err?.statusCode === 400, 'D.8 Caller-owned failure throws RETURN_SYNC_FAILED');
    await callerSession.abortTransaction();
  } finally {
    await callerSession.endSession();
  }
  check(Boolean(callerAborted), 'D.8 Enclosing caller transaction cleanly aborted on return sync failure');

  // ============================================================
  // EXTENDED INTEGRITY REGRESSION TESTS (A, B, C, D SPECIFIC)
  // ============================================================
  console.log('\n[EXTENDED REGRESSION: Critical Integrity A-D Proof]');

  // --- A.10: Duplicate ledger entries in Payment reject incoming webhook as reconciliation conflict
  const paymentA10 = await Payment.create({
    orderId: new mongoose.Types.ObjectId(),
    userId,
    amount: 1000,
    currency: 'INR',
    status: 'CAPTURED',
    refundedAmount: 600,
    pendingRefundAmount: 0,
    razorpayPaymentId: `pay_a10_${timestamp}`,
    settledRefunds: [
      {
        refundId: new mongoose.Types.ObjectId(),
        razorpayRefundId: `rfnd_dup1_${timestamp}`,
        amount: 300,
        currency: 'INR',
        settledAt: new Date()
      },
      {
        refundId: new mongoose.Types.ObjectId(),
        razorpayRefundId: `rfnd_dup1_${timestamp}`,
        amount: 300,
        currency: 'INR',
        settledAt: new Date()
      }
    ]
  });
  const refundA10 = await Refund.create({
    orderId: paymentA10.orderId,
    paymentId: paymentA10._id,
    userId,
    initiatedBy: userId,
    initiatedByRole: 'ADMIN',
    amount: 300,
    currency: 'INR',
    status: 'PROCESSED',
    submissionState: 'CONFIRMED',
    razorpayRefundId: `rfnd_dup1_${timestamp}`,
    processedAt: new Date(),
    accountingSettlementStatus: 'COMPLETED'
  });
  const dupLedgerRes = await handleRefundProcessedEntity({
    id: `rfnd_dup1_${timestamp}`,
    payment_id: paymentA10.razorpayPaymentId!,
    amount: 30000,
    currency: 'INR',
    status: 'processed',
    notes: { internal_refund_id: refundA10._id.toString() }
  });
  check(dupLedgerRes.outcome === 'RECONCILIATION_REQUIRED', 'A.10 Duplicate ledger entries in payment rejected as reconciliation conflict');

  // --- A.11: Amount & Currency mismatch in webhook rejected
  const mismatchCurrencyRes = await handleRefundProcessedEntity({
    id: `rfnd_a10_curr_${timestamp}`,
    payment_id: paymentA10.razorpayPaymentId!,
    amount: 30000,
    currency: 'USD',
    status: 'processed',
    notes: { internal_refund_id: refundA10._id.toString() }
  });
  check(mismatchCurrencyRes.outcome === 'RECONCILIATION_REQUIRED', 'A.11 Currency mismatch in webhook rejected as RECONCILIATION_REQUIRED');

  // --- A.12: Conflicting provider ID in refund.failed rejected
  const failedConflictRes = await handleRefundFailedEntity({
    id: `rfnd_diff_failed_${timestamp}`,
    payment_id: paymentA10.razorpayPaymentId!,
    amount: 30000,
    currency: 'INR',
    notes: { internal_refund_id: refundA10._id.toString() }
  });
  check(failedConflictRes.outcome === 'RECONCILIATION_REQUIRED', 'A.12 Conflicting provider ID in refund.failed rejected as RECONCILIATION_REQUIRED');
  // --- B.11: Reservation-not-found misclassification prevented when contradictory reservation exists
  const paymentB11 = await Payment.create({
    orderId: new mongoose.Types.ObjectId(),
    userId,
    amount: 1000,
    currency: 'INR',
    status: 'CAPTURED',
    refundedAmount: 0,
    pendingRefundAmount: 500,
    razorpayPaymentId: `pay_b11_${timestamp}`,
    refundReservations: [
      {
        reservationId: `res_b11_${timestamp}`,
        refundId: new mongoose.Types.ObjectId(),
        attemptNumber: 1,
        amount: 500,
        status: 'PENDING',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]
  });
  const refundB11Target = paymentB11.refundReservations[0].refundId!;
  await Refund.create({
    _id: refundB11Target,
    orderId: paymentB11.orderId,
    paymentId: paymentB11._id,
    userId,
    initiatedBy: userId,
    initiatedByRole: 'ADMIN',
    amount: 500,
    currency: 'INR',
    status: 'PROCESSED',
    processedAt: new Date(),
    submissionState: 'CONFIRMED',
    razorpayRefundId: `rfnd_b11_${timestamp}`,
    attemptNumber: 1
  });
  const transB11 = await transitionPaymentReservation({
    paymentId: paymentB11._id,
    refundId: refundB11Target,
    reservationId: `res_b11_${timestamp}`,
    amount: 500,
    attemptNumber: 2,
    targetState: 'CONSUMED'
  });
  check(transB11.outcome === 'BALANCE_CONFLICT', 'B.11 Contradictory attempt reservation not misclassified as RESERVATION_NOT_FOUND', `outcome=${transB11.outcome}`);
  check(transB11.outcome !== 'RESERVATION_NOT_FOUND', 'B.11 Contradictory attempt strictly rejects RESERVATION_NOT_FOUND');

  // --- B.12: Balance-conflict CAS revalidation in final mutation
  const policyB11 = await resolveSettlementPolicy({
    paymentId: paymentB11._id,
    refundId: refundB11Target,
    transitionOutcome: transB11.outcome,
    expectedReservationId: `res_b11_${timestamp}`,
    expectedAttemptNumber: 2,
    expectedAmount: 500,
    expectedCurrency: 'INR'
  });
  check(policyB11.canProceedToSettlement === false, 'B.12 Contradictory attempt cannot proceed to settlement');
  check(policyB11.settlementReason === 'BALANCE_CONFLICT_RESERVATION_CONFLICT', 'B.12 Policy reason is BALANCE_CONFLICT_RESERVATION_CONFLICT');

  // --- C.6: Zero-match finalization rollback in executeWebhookInboxBatch
  const lockNameC6 = trackLock(`lock_c6_${timestamp}`);
  const ownerC6 = `worker_c6_${timestamp}`;
  const acquiredC6 = await RecoveryCoordinatorService.acquireWorkerLease(lockNameC6, ownerC6, 15_000);
  check(acquiredC6.acquired === true, 'C.6 Worker acquired initial lock');

  const stolenEventId = `evt_stolen_${timestamp}`;
  const stolenEvent = trackWebhookEvent(await WebhookEvent.create({
    provider: 'RAZORPAY',
    eventId: stolenEventId,
    eventType: 'payment.failed',
    status: 'FAILED',
    payload: {
      payload: {
        payment: {
          entity: {
            order_id: `ord_c6_${timestamp}`,
            id: `pay_c6_${timestamp}`,
            error_code: 'BAD_REQUEST_ERROR',
            error_description: 'Payment failed'
          }
        }
      }
    }
  }));

  // Intercept WebhookEvent.updateOne during inbox terminal finalization to simulate zero-match lease loss
  const origUpdateOne = WebhookEvent.updateOne.bind(WebhookEvent);
  (WebhookEvent as unknown as { updateOne: typeof WebhookEvent.updateOne }).updateOne = (async (filter: unknown, update: unknown, options?: unknown) => {
    const f = filter as { _id?: unknown; status?: string; leaseToken?: string } | undefined;
    if (f && f.status === 'PROCESSING' && f.leaseToken) {
      return { matchedCount: 0, modifiedCount: 0, acknowledged: true, upsertedCount: 0, upsertedId: null };
    }
    return Reflect.apply(origUpdateOne, WebhookEvent, [filter, update, options]);
  }) as unknown as typeof WebhookEvent.updateOne;

  let c6CaughtError: unknown = null;
  try {
    await RecoveryCoordinatorService.executeWebhookInboxBatch(1, {
      fenceContext: { fencingToken: acquiredC6.fencingToken!, lockName: lockNameC6, ownerId: ownerC6 }
    });
  } catch (err: unknown) {
    c6CaughtError = err;
  } finally {
    (WebhookEvent as unknown as { updateOne: typeof WebhookEvent.updateOne }).updateOne = origUpdateOne;
  }

  check(c6CaughtError instanceof AppError, 'C.6 executeWebhookInboxBatch threw AppError on stolen lease');
  check((c6CaughtError as AppError)?.code === 'WEBHOOK_LEASE_LOST', 'C.6 Error code strictly matches WEBHOOK_LEASE_LOST (not merely 409)');
  check((c6CaughtError as AppError)?.statusCode === 409, 'C.6 Error statusCode is 409');
  const checkStolenEvent = await WebhookEvent.findById(stolenEvent._id);
  check(checkStolenEvent?.status === 'PROCESSING', 'C.6 Stolen event status rolled back completely (remains PROCESSING)');
  await WebhookEvent.deleteOne({ _id: stolenEvent._id });
  const takeoverEventId = `evt_takeover_${timestamp}`;
  const takeoverEvent = trackWebhookEvent(await WebhookEvent.create({
    provider: 'RAZORPAY',
    eventId: takeoverEventId,
    eventType: 'payment.failed',
    status: 'FAILED',
    payload: {
      payload: {
        payment: {
          entity: {
            order_id: `ord_takeover_${timestamp}`,
            id: `pay_takeover_${timestamp}`
          }
        }
      }
    }
  }));
  // Newer worker increments fencingToken on WorkerLock before Worker 1 processes inbox batch
  await WorkerLock.updateOne(
    { lockName: lockNameC6 },
    { $set: { fencingToken: acquiredC6.fencingToken! + 1, ownerId: 'worker_c6_takeover' } }
  );

  let takeoverCaughtError: unknown = null;
  try {
    await RecoveryCoordinatorService.executeWebhookInboxBatch(1, {
      fenceContext: { fencingToken: acquiredC6.fencingToken!, lockName: lockNameC6, ownerId: ownerC6 }
    });
  } catch (err: unknown) {
    takeoverCaughtError = err;
  }
  check(takeoverCaughtError instanceof AppError, 'C.6b executeWebhookInboxBatch threw on coordinator takeover');
  check((takeoverCaughtError as AppError)?.code === 'WORKER_LEASE_FENCED_OUT', 'C.6b Error code strictly matches WORKER_LEASE_FENCED_OUT');
  const checkTakeoverEvt = await WebhookEvent.findById(takeoverEvent._id);
  check(checkTakeoverEvt?.status !== 'FAILED', 'C.6b Webhook event NOT marked FAILED after coordinator lease lost');
  await WebhookEvent.deleteOne({ _id: takeoverEvent._id });
  // --- C.6c: Outer catch behavior for genuine processing failure
  const genuineFailEventId = `evt_gen_fail_${timestamp}`;
  const genuineFailEvent = trackWebhookEvent(await WebhookEvent.create({
    provider: 'RAZORPAY',
    eventId: genuineFailEventId,
    eventType: 'payment.captured',
    status: 'FAILED',
    payload: { payload: { payment: { entity: { id: 'missing_order_id' } } } }
  }));

  const lockNameC6c = trackLock(`lock_c6c_${timestamp}`);
  const acquiredC6c = await RecoveryCoordinatorService.acquireWorkerLease(lockNameC6c, ownerC6, 15_000);
  const genFailBatchRes = await RecoveryCoordinatorService.executeWebhookInboxBatch(1, {
    fenceContext: { fencingToken: acquiredC6c.fencingToken!, lockName: lockNameC6c, ownerId: ownerC6 }
  });
  check(genFailBatchRes.failedCount === 1, 'C.6c failedCount incremented exactly once on genuine failure');
  const checkGenFailEvt = await WebhookEvent.findById(genuineFailEvent._id);
  check(checkGenFailEvt?.status === 'FAILED', 'C.6c Genuine failure safely recorded as FAILED via valid fence');
  check(Boolean(checkGenFailEvt?.lastError), 'C.6c lastError recorded on genuine failure');

  // --- C.7: Real controlled barrier proving WorkerLock takeover during in-flight transaction
  const lockBarrierName = `lock_barrier_${timestamp}`;
  const ownerB1 = 'worker_b1';
  const ownerB2 = 'worker_b2';
  const acquiredB1 = await RecoveryCoordinatorService.acquireWorkerLease(lockBarrierName, ownerB1, 10_000);
  check(acquiredB1.acquired === true, 'C.7 Worker 1 acquired initial lock');

  const { promise: barrier1ReachedPromise, resolve: signalBarrier1Reached } = createDeferred<void>();
  const { promise: worker1PausePromise, resolve: resumeWorker1 } = createDeferred<void>();

  const worker1OrderId = new mongoose.Types.ObjectId();
  let worker1ErrorThrown: boolean = false;
  let worker1CaughtError: unknown = null;

  const isExpectedLeaseAbortError = (error: unknown): boolean => {
    if (!error || typeof error !== 'object') return false;

    // 1. Application error strictly matching WORKER_LEASE_FENCED_OUT code
    if (error instanceof AppError && error.code === 'WORKER_LEASE_FENCED_OUT') {
      return true;
    }

    // 2. Recognized MongoDB transaction error with specific code/codeName and TransientTransactionError label
    if (error instanceof Error) {
      const mongoErr = error as {
        code?: number;
        codeName?: string;
        errorLabels?: string[];
        errorLabelSet?: Set<string>;
        hasErrorLabel?: (label: string) => boolean;
      };
      const hasTransientLabel = Boolean(
        (typeof mongoErr.hasErrorLabel === 'function' && mongoErr.hasErrorLabel('TransientTransactionError')) ||
        (Array.isArray(mongoErr.errorLabels) && mongoErr.errorLabels.includes('TransientTransactionError')) ||
        (mongoErr.errorLabelSet instanceof Set && mongoErr.errorLabelSet.has('TransientTransactionError'))
      );
      const isRecognizedTransactionAbortCode =
        mongoErr.code === 251 ||
        mongoErr.code === 112 ||
        mongoErr.code === 244 ||
        mongoErr.codeName === 'NoSuchTransaction' ||
        mongoErr.codeName === 'WriteConflict' ||
        mongoErr.codeName === 'TransactionAborted';

      if (hasTransientLabel && isRecognizedTransactionAbortCode) {
        return true;
      }
    }
    return false;
  };

  // Assert that unrelated application errors, generic 409s, and generic message substrings are strictly rejected
  check(
    isExpectedLeaseAbortError(new Error('unrelated database connection error')) === false,
    'C.7 Unrelated Error cannot satisfy lease abort validation'
  );
  check(
    isExpectedLeaseAbortError(new AppError('unrelated validation failure', 400)) === false,
    'C.7 Unrelated AppError cannot satisfy lease abort validation'
  );
  check(
    isExpectedLeaseAbortError(new AppError('generic conflict', 409, 'CONFLICT')) === false,
    'C.7 Generic 409 AppError without WORKER_LEASE_FENCED_OUT cannot satisfy lease abort validation'
  );
  check(
    isExpectedLeaseAbortError(new Error('fenced out')) === false,
    'C.7 Generic Error message with "fenced out" cannot satisfy lease abort validation'
  );
  check(
    isExpectedLeaseAbortError(new Error('has been aborted')) === false,
    'C.7 Generic Error message with "has been aborted" cannot satisfy lease abort validation'
  );

  const worker1Promise = RecoveryCoordinatorService.withRecoveryLeaseFence(
    { fencingToken: acquiredB1.fencingToken!, lockName: lockBarrierName, ownerId: ownerB1, leaseDurationMs: 10_000 },
    async (session) => {
      // Worker 1 writes in-flight uncommitted document
      await Payment.create(
        [
          {
            orderId: worker1OrderId,
            userId,
            amount: 750,
            currency: 'INR',
            status: 'CAPTURED',
            refundedAmount: 0,
            pendingRefundAmount: 0
          }
        ],
        { session }
      );
      signalBarrier1Reached();
      // Wait for controlled barrier release
      await worker1PausePromise;

      // Touch lock to verify fence before completing
      const touch = await WorkerLock.findOneAndUpdate(
        { lockName: lockBarrierName, ownerId: ownerB1, fencingToken: acquiredB1.fencingToken!, leaseExpiresAt: { $gt: new Date() } },
        { $set: { leaseExpiresAt: new Date(Date.now() + 10_000) } },
        { session }
      );
      if (!touch) {
        throw new AppError('Worker lease fenced out during in-flight transaction', 409, 'WORKER_LEASE_FENCED_OUT');
      }
    }
  ).catch((err: unknown) => {
    worker1ErrorThrown = true;
    worker1CaughtError = err;
  });

  // Deterministically await Worker 1 reaching the in-flight state inside its transaction
  await barrier1ReachedPromise;
  // Now, while Worker 1 is in-flight, Worker 2 takes over the lock
  await WorkerLock.updateOne({ lockName: lockBarrierName }, { $set: { leaseExpiresAt: new Date(0) } });
  const acquiredB2 = await RecoveryCoordinatorService.acquireWorkerLease(lockBarrierName, ownerB2, 10_000);
  check(acquiredB2.acquired === true, 'C.7 Worker 2 took over lock while Worker 1 transaction was in-flight');
  check(acquiredB2.fencingToken! > acquiredB1.fencingToken!, 'C.7 Worker 2 fencing token is strictly newer (T2 > T1)');

  // Resume Worker 1
  resumeWorker1();
  await worker1Promise;

  check(Boolean(worker1ErrorThrown), 'C.7 Worker 1 transaction was aborted');
  check(
    isExpectedLeaseAbortError(worker1CaughtError),
    'C.7 In-flight Worker 1 error strictly matches WORKER_LEASE_FENCED_OUT or MongoDB write conflict/abort'
  );
  const checkWorker1Doc = await Payment.findOne({ orderId: worker1OrderId });
  check(checkWorker1Doc === null, 'C.7 In-flight mutations of stale Worker 1 rolled back completely in database');
  await RecoveryCoordinatorService.releaseWorkerLease(lockBarrierName, ownerB2, acquiredB2.fencingToken!);

  // --- B.13: Controlled barrier proving policy-to-final-CAS race with real DB persistence
  const paymentRace = await Payment.create({
    orderId: new mongoose.Types.ObjectId(),
    userId,
    amount: 1000,
    currency: 'INR',
    status: 'CAPTURED',
    refundedAmount: 0,
    pendingRefundAmount: 500,
    razorpayPaymentId: `pay_race_${timestamp}`,
    refundReservations: [
      {
        reservationId: `res_race_${timestamp}`,
        refundId: new mongoose.Types.ObjectId(),
        attemptNumber: 1,
        amount: 500,
        status: 'PENDING',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]
  });
  const refundRaceId = paymentRace.refundReservations[0].refundId!;
  await Refund.create({
    _id: refundRaceId,
    orderId: paymentRace.orderId,
    paymentId: paymentRace._id,
    userId,
    initiatedBy: userId,
    initiatedByRole: 'ADMIN',
    amount: 500,
    currency: 'INR',
    status: 'PROCESSED',
    processedAt: new Date(),
    submissionState: 'CONFIRMED',
    razorpayRefundId: `rfnd_race_${timestamp}`,
    attemptNumber: 1
  });

  // Step 1: Thread A resolves policy based on PENDING reservation
  const transRaceA = await transitionPaymentReservation({
    paymentId: paymentRace._id,
    refundId: refundRaceId,
    reservationId: `res_race_${timestamp}`,
    amount: 500,
    attemptNumber: 1,
    targetState: 'CONSUMED'
  });
  const policyRaceA = await resolveSettlementPolicy({
    paymentId: paymentRace._id,
    refundId: refundRaceId,
    transitionOutcome: transRaceA.outcome,
    expectedReservationId: `res_race_${timestamp}`,
    expectedAttemptNumber: 1,
    expectedAmount: 500,
    expectedProviderRefundId: `rfnd_race_${timestamp}`,
    expectedCurrency: 'INR'
  });
  check(policyRaceA.canProceedToSettlement === true, 'B.13 Thread A policy authorizes settlement');

  // Controlled barrier: Intervening thread modifies reservation in DB before Thread A mutates
  await Payment.updateOne(
    { _id: paymentRace._id, 'refundReservations.reservationId': `res_race_${timestamp}` },
    { $set: { 'refundReservations.$.status': 'RELEASED' } }
  );

  // Thread A executes final CAS mutation: CAS must detect the race and reject
  const settleRaceRes = await applyProviderRefundSettlement({
    paymentId: paymentRace._id,
    refundId: refundRaceId,
    razorpayRefundId: `rfnd_race_${timestamp}`,
    amount: 500,
    currency: 'INR',
    settlementReason: policyRaceA.settlementReason,
    expectedReservationId: `res_race_${timestamp}`,
    expectedAttemptNumber: 1
  });
  check(settleRaceRes.success === false, 'B.13 Stale policy read rejected by final atomic CAS on modified reservation');
  check(settleRaceRes.outcome === 'SETTLEMENT_CONFLICT', 'B.13 Outcome is SETTLEMENT_CONFLICT');
  const pRaceAfter = await Payment.findById(paymentRace._id);
  check(pRaceAfter?.refundedAmount === 500, 'B.13 Racing settlement did NOT double-credit refundedAmount (remained 500)');
  check(pRaceAfter?.reconciliationRequired === true, 'B.13 Payment flagged reconciliationRequired on race');

  // --- D.9: FAILED ownership conflict: Previous FAILED alone NEVER transfers ownership
  // --- D.9: Older attempt rejected on previously FAILED ReturnRequest
  const orderD9 = trackOrder(await Order.create({
    orderNumber: `ORD-D9-${timestamp}`,
    userId,
    items: [],
    shippingAddress: { fullName: 'User D9', addressLine1: 'Line', city: 'City', state: 'State', postalCode: '111', country: 'IN', phone: '123' },
    paymentMethod: 'ONLINE',
    subtotal: 500,
    shipping: 0,
    tax: 0,
    total: 500,
    status: 'CONFIRMED',
    paymentStatus: 'PAID'
  }));
  const origRefundIdD9 = new mongoose.Types.ObjectId();
  const returnDocD9: any = trackReturn(await ReturnRequest.create({
    orderId: orderD9._id,
    userId,
    items: [{ productId: prodId, variantId: varId, quantity: 1, reason: 'WRONG_SIZE' }],
    status: 'ACCEPTED',
    refundId: origRefundIdD9,
    refundAttempt: 2,
    refundStatus: 'FAILED',
    inventoryRestored: false
  }));
  const competingRefundId = new mongoose.Types.ObjectId();
  let failedOwnershipConflictThrown = false;
  try {
    const callerSessionD9 = await mongoose.startSession();
    callerSessionD9.startTransaction();
    try {
      await syncReturnRequestWithRefund({
        returnId: returnDocD9._id.toString(),
        refundId: competingRefundId.toString(),
        orderId: orderD9._id.toString(),
        refundStatus: 'PROCESSED',
        attemptNumber: 1,
        session: callerSessionD9
      });
      await callerSessionD9.commitTransaction();
    } catch (err: unknown) {
      failedOwnershipConflictThrown = true;
      await callerSessionD9.abortTransaction();
    } finally {
      await callerSessionD9.endSession();
    }
  } catch {}
  check(failedOwnershipConflictThrown, 'D.9 Older attempt rejected on previously FAILED ReturnRequest');
  const checkD9 = await ReturnRequest.findById(returnDocD9._id);
  check(checkD9?.refundId?.toString() === origRefundIdD9.toString(), 'D.9 Original refundId strictly preserved on ReturnRequest');
  check(checkD9?.status === 'ACCEPTED', 'D.9 ReturnRequest status remains ACCEPTED');

  // --- D.9b: True in-transaction ownership revalidation
  const orderD9b = trackOrder(await Order.create({
    orderNumber: `ORD-D9B-${timestamp}`,
    userId,
    items: [],
    shippingAddress: { fullName: 'User D9B', addressLine1: 'Line', city: 'City', state: 'State', postalCode: '111', country: 'IN', phone: '123' },
    paymentMethod: 'ONLINE',
    subtotal: 500,
    shipping: 0,
    tax: 0,
    total: 500,
    status: 'CONFIRMED',
    paymentStatus: 'PAID'
  }));
  const returnDocD9b: any = trackReturn(await ReturnRequest.create({
    orderId: orderD9b._id,
    userId,
    items: [{ productId: prodId, variantId: varId, quantity: 1, reason: 'WRONG_SIZE' }],
    status: 'ACCEPTED',
    refundId: new mongoose.Types.ObjectId(),
    refundAttempt: 1,
    refundStatus: 'FAILED',
    inventoryRestored: false
  }));
  // Initial state is eligible (ACCEPTED, FAILED attempt 1 < caller attempt 2).
  // Simulate concurrent thread modifying the document inside the transaction window:
  let findByIdCallCount = 0;
  const origRetFindById = ReturnRequest.findById.bind(ReturnRequest);
  (ReturnRequest as unknown as { findById: typeof ReturnRequest.findById }).findById = ((...args: Parameters<typeof ReturnRequest.findById>) => {
    findByIdCallCount++;
    const query = origRetFindById(...args);
    if (findByIdCallCount === 2) {
      const origExec = query.exec.bind(query);
      query.exec = async () => {
        const doc = await origExec();
        if (doc) {
          doc.refundAttempt = 3;
          doc.refundStatus = 'PROCESSED';
        }
        return doc;
      };
    }
    return query;
  }) as unknown as typeof ReturnRequest.findById;

  let inTxRevalidationThrown = false;
  let inTxErrorMsg = '';
  try {
    const callerSessionD9b = await mongoose.startSession();
    callerSessionD9b.startTransaction();
    try {
      await syncReturnRequestWithRefund({
        returnId: returnDocD9b._id.toString(),
        refundId: new mongoose.Types.ObjectId().toString(),
        orderId: orderD9b._id.toString(),
        refundStatus: 'PROCESSED',
        attemptNumber: 2,
        session: callerSessionD9b
      });
      await callerSessionD9b.commitTransaction();
    } catch (err: unknown) {
      inTxRevalidationThrown = true;
      inTxErrorMsg = err instanceof Error ? err.message : String(err);
      await callerSessionD9b.abortTransaction();
    } finally {
      await callerSessionD9b.endSession();
    }
  } finally {
    (ReturnRequest as unknown as { findById: typeof ReturnRequest.findById }).findById = origRetFindById;
  }
  check(inTxRevalidationThrown, 'D.9 In-transaction ownership revalidation strictly rejects stale attempt after concurrent modification');
  check(inTxErrorMsg.includes('Ownership conflict'), 'D.9 Revalidation error message strictly identifies ownership conflict');

  // ==========================================
  // FINDING 1: STRICT PROVIDER IDENTITY VALIDATION REGRESSION SUITE
  // ==========================================
  console.log('\n[FINDING 1: Strict Provider Identity Validation Regression Suite]');

  const orderF1 = trackOrder(await Order.create({
    orderNumber: `ORD-F1-${timestamp}`,
    userId,
    items: [],
    shippingAddress: { fullName: 'User F1', addressLine1: 'Line', city: 'City', state: 'State', postalCode: '111', country: 'IN', phone: '123' },
    paymentMethod: 'ONLINE',
    subtotal: 500,
    shipping: 0,
    tax: 0,
    total: 500,
    status: 'CONFIRMED',
    paymentStatus: 'PAID'
  }));

  const f1RefundId = new mongoose.Types.ObjectId();
  const paymentF1 = trackPayment(await Payment.create({
    orderId: orderF1._id,
    userId,
    amount: 500,
    currency: 'INR',
    status: 'CAPTURED',
    refundedAmount: 0,
    pendingRefundAmount: 500,
    razorpayPaymentId: `pay_f1_${timestamp}`,
    refundReservations: [
      {
        reservationId: `res_f1_${timestamp}`,
        refundId: f1RefundId,
        attemptNumber: 1,
        amount: 500,
        status: 'PENDING',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]
  }));

  const refundF1 = trackRefund(await Refund.create({
    _id: f1RefundId,
    orderId: orderF1._id,
    paymentId: paymentF1._id,
    userId,
    initiatedBy: userId,
    initiatedByRole: 'ADMIN',
    amount: 500,
    currency: 'INR',
    status: 'PROCESSING',
    submissionState: 'CONFIRMED',
    razorpayPaymentId: `pay_f1_${timestamp}`,
    razorpayRefundId: `rfnd_f1_saved_${timestamp}`,
    attemptNumber: 1,
    accountingSettlementStatus: 'PENDING'
  }));

  // F1.1: Missing payment ID in refund.failed
  const f1MissingPayRes = await handleRefundFailedEntity({
    id: `rfnd_f1_saved_${timestamp}`,
    payment_id: '',
    amount: 50000,
    currency: 'INR',
    notes: { internal_refund_id: refundF1._id.toString() }
  });
  check(f1MissingPayRes.outcome === 'RECONCILIATION_REQUIRED', 'F1.1 handleRefundFailedEntity rejects missing payment ID');

  // F1.2: Missing amount in refund.failed
  const f1MissingAmtRes = await handleRefundFailedEntity({
    id: `rfnd_f1_saved_${timestamp}`,
    payment_id: paymentF1.razorpayPaymentId!,
    amount: undefined as unknown as number,
    currency: 'INR',
    notes: { internal_refund_id: refundF1._id.toString() }
  });
  check(f1MissingAmtRes.outcome === 'RECONCILIATION_REQUIRED', 'F1.2 handleRefundFailedEntity rejects missing amount');

  // F1.3: Missing currency in refund.failed
  const f1MissingCurRes = await handleRefundFailedEntity({
    id: `rfnd_f1_saved_${timestamp}`,
    payment_id: paymentF1.razorpayPaymentId!,
    amount: 50000,
    currency: '',
    notes: { internal_refund_id: refundF1._id.toString() }
  });
  check(f1MissingCurRes.outcome === 'RECONCILIATION_REQUIRED', 'F1.3 handleRefundFailedEntity rejects missing currency');

  // F1.4: Non-finite amount in refund.failed
  const f1NanAmtRes = await handleRefundFailedEntity({
    id: `rfnd_f1_saved_${timestamp}`,
    payment_id: paymentF1.razorpayPaymentId!,
    amount: NaN,
    currency: 'INR',
    notes: { internal_refund_id: refundF1._id.toString() }
  });
  check(f1NanAmtRes.outcome === 'RECONCILIATION_REQUIRED', 'F1.4 handleRefundFailedEntity rejects NaN amount');

  const f1InfAmtRes = await handleRefundFailedEntity({
    id: `rfnd_f1_saved_${timestamp}`,
    payment_id: paymentF1.razorpayPaymentId!,
    amount: Infinity,
    currency: 'INR',
    notes: { internal_refund_id: refundF1._id.toString() }
  });
  check(f1InfAmtRes.outcome === 'RECONCILIATION_REQUIRED', 'F1.4b handleRefundFailedEntity rejects Infinity amount');

  const f1FloatAmtRes = await handleRefundFailedEntity({
    id: `rfnd_f1_saved_${timestamp}`,
    payment_id: paymentF1.razorpayPaymentId!,
    amount: 50000.5,
    currency: 'INR',
    notes: { internal_refund_id: refundF1._id.toString() }
  });
  check(f1FloatAmtRes.outcome === 'RECONCILIATION_REQUIRED', 'F1.4c handleRefundFailedEntity rejects non-integer amount');

  // F1.5: One-paise mismatch in refund.failed
  const f1PlusOnePaiseRes = await handleRefundFailedEntity({
    id: `rfnd_f1_saved_${timestamp}`,
    payment_id: paymentF1.razorpayPaymentId!,
    amount: 50001,
    currency: 'INR',
    notes: { internal_refund_id: refundF1._id.toString() }
  });
  check(f1PlusOnePaiseRes.outcome === 'RECONCILIATION_REQUIRED', 'F1.5 handleRefundFailedEntity rejects +1 paise mismatch');

  const f1MinusOnePaiseRes = await handleRefundFailedEntity({
    id: `rfnd_f1_saved_${timestamp}`,
    payment_id: paymentF1.razorpayPaymentId!,
    amount: 49999,
    currency: 'INR',
    notes: { internal_refund_id: refundF1._id.toString() }
  });
  check(f1MinusOnePaiseRes.outcome === 'RECONCILIATION_REQUIRED', 'F1.5b handleRefundFailedEntity rejects -1 paise mismatch');

  // F1.6: Conflicting provider refund ID in refund.failed
  const f1ConfProvIdRes = await handleRefundFailedEntity({
    id: `rfnd_f1_conflicting_${timestamp}`,
    payment_id: paymentF1.razorpayPaymentId!,
    amount: 50000,
    currency: 'INR',
    notes: { internal_refund_id: refundF1._id.toString() }
  });
  check(f1ConfProvIdRes.outcome === 'RECONCILIATION_REQUIRED', 'F1.6 handleRefundFailedEntity rejects conflicting provider refund ID');

  // F1.7: Conflicting internal Payment/Refund provider IDs in refund.failed
  const refundF1ConfPay = trackRefund(await Refund.create({
    orderId: orderF1._id,
    paymentId: paymentF1._id,
    userId,
    initiatedBy: userId,
    initiatedByRole: 'ADMIN',
    amount: 500,
    currency: 'INR',
    status: 'PROCESSING',
    submissionState: 'CONFIRMED',
    razorpayPaymentId: `pay_contradictory_refund_${timestamp}`,
    razorpayRefundId: `rfnd_f1_confpay_${timestamp}`,
    attemptNumber: 2,
    accountingSettlementStatus: 'PENDING'
  }));

  const f1ConfInternalPayRes = await handleRefundFailedEntity({
    id: `rfnd_f1_confpay_${timestamp}`,
    payment_id: paymentF1.razorpayPaymentId!,
    amount: 50000,
    currency: 'INR',
    notes: { internal_refund_id: refundF1ConfPay._id.toString() }
  });
  check(f1ConfInternalPayRes.outcome === 'RECONCILIATION_REQUIRED', 'F1.7 handleRefundFailedEntity rejects conflicting internal Payment/Refund payment IDs');

  // F1.8: Strict validations in reconcileUnknownRefund
  const refundF1Rec = trackRefund(await Refund.create({
    orderId: orderF1._id,
    paymentId: paymentF1._id,
    userId,
    initiatedBy: userId,
    initiatedByRole: 'ADMIN',
    amount: 500,
    currency: 'INR',
    status: 'UNKNOWN',
    submissionState: 'CONFIRMED',
    razorpayPaymentId: paymentF1.razorpayPaymentId,
    razorpayRefundId: `rfnd_rec_f1_${timestamp}`,
    attemptNumber: 1,
    accountingSettlementStatus: 'PENDING'
  }));

  const origGetClient = razorpayProvider.getClient.bind(razorpayProvider);
  let mockRefundData: Record<string, unknown> | null = null;
  (razorpayProvider as unknown as { getClient: () => unknown }).getClient = () => ({
    orders: {
      create: async () => { throw new Error('Blocked'); },
      fetch: async () => { throw new Error('Blocked'); }
    },
    payments: {
      fetch: async () => { throw new Error('Blocked'); },
      refund: async () => { throw new Error('Blocked'); },
      refunds: async () => ({ items: [] })
    },
    refunds: {
      fetch: async () => mockRefundData
    }
  });

  // 1-paise mismatch on gateway
  mockRefundData = {
    id: `rfnd_rec_f1_${timestamp}`,
    payment_id: paymentF1.razorpayPaymentId,
    amount: 50001,
    currency: 'INR',
    status: 'processed'
  };
  const recOnePaiseRes = await reconcileUnknownRefund(refundF1Rec._id.toString());
  check(recOnePaiseRes.status === 'UNKNOWN', 'F1.8 reconcileUnknownRefund strictly rejects 1-paise mismatch');
  check(recOnePaiseRes.accountingSettlementStatus === 'RECONCILIATION_REQUIRED', 'F1.8b 1-paise mismatch sets RECONCILIATION_REQUIRED');

  // Missing currency on gateway
  mockRefundData = {
    id: `rfnd_rec_f1_${timestamp}`,
    payment_id: paymentF1.razorpayPaymentId,
    amount: 50000,
    currency: '',
    status: 'processed'
  };
  const recMissingCurRes = await reconcileUnknownRefund(refundF1Rec._id.toString());
  check(recMissingCurRes.status === 'UNKNOWN', 'F1.9 reconcileUnknownRefund strictly rejects missing currency');
  check(recMissingCurRes.accountingSettlementStatus === 'RECONCILIATION_REQUIRED', 'F1.9b Missing currency sets RECONCILIATION_REQUIRED');

  // Non-integer amount on gateway
  mockRefundData = {
    id: `rfnd_rec_f1_${timestamp}`,
    payment_id: paymentF1.razorpayPaymentId,
    amount: 50000.5,
    currency: 'INR',
    status: 'processed'
  };
  const recNonIntRes = await reconcileUnknownRefund(refundF1Rec._id.toString());
  check(recNonIntRes.status === 'UNKNOWN', 'F1.10 reconcileUnknownRefund strictly rejects non-integer amount');

  // Conflicting internal Payment/Refund provider ID in reconcileUnknownRefund
  const refundF1ConfRec = trackRefund(await Refund.create({
    orderId: orderF1._id,
    paymentId: paymentF1._id,
    userId,
    initiatedBy: userId,
    initiatedByRole: 'ADMIN',
    amount: 500,
    currency: 'INR',
    status: 'UNKNOWN',
    submissionState: 'CONFIRMED',
    razorpayPaymentId: `pay_conflicting_refund_${timestamp}`,
    razorpayRefundId: `rfnd_rec_conf_${timestamp}`,
    attemptNumber: 1,
    accountingSettlementStatus: 'PENDING'
  }));

  mockRefundData = {
    id: `rfnd_rec_conf_${timestamp}`,
    payment_id: paymentF1.razorpayPaymentId,
    amount: 50000,
    currency: 'INR',
    status: 'processed'
  };
  const recConfInternalPayRes = await reconcileUnknownRefund(refundF1ConfRec._id.toString());
  check(recConfInternalPayRes.status === 'UNKNOWN', 'F1.11 reconcileUnknownRefund strictly rejects conflicting internal Payment/Refund payment IDs');

  (razorpayProvider as unknown as { getClient: () => unknown }).getClient = origGetClient;
  // ==========================================
  // FINDING 2: WORKER TRANSACTION SESSION PROPAGATION & ROLLBACK
  // ==========================================
  console.log('\n[FINDING 2: Worker Transaction Session Propagation through Payment Capture]');

  const prodF2Res = await createTestProduct({
    name: `Product F2 ${timestamp}`,
    variants: [{ size: 'M', color: 'Blue', stock: 10 }]
  });
  const prodF2Id = new mongoose.Types.ObjectId(prodF2Res.productId);
  const f2VariantId = new mongoose.Types.ObjectId(prodF2Res.variantIds[0]);
  cleanupProducts.push(prodF2Id);

  const orderF2 = trackOrder(await Order.create({
    orderNumber: `ORD-F2-${timestamp}`,
    userId,
    items: [
      {
        productId: prodF2Id,
        variantId: f2VariantId,
        productName: `Product F2 ${timestamp}`,
        productImage: 'https://example.com/test.jpg',
        selectedSize: 'M',
        selectedColor: 'Blue',
        quantity: 2,
        unitPrice: 500,
        lineTotal: 1000
      }
    ],
    shippingAddress: { fullName: 'User F2', addressLine1: 'Line', city: 'City', state: 'State', postalCode: '111', country: 'IN', phone: '123' },
    paymentMethod: 'ONLINE',
    subtotal: 1000,
    shipping: 0,
    tax: 0,
    total: 1000,
    status: 'PENDING',
    paymentStatus: 'PENDING'
  }));

  const paymentF2 = trackPayment(await Payment.create({
    orderId: orderF2._id,
    userId,
    amount: 1000,
    currency: 'INR',
    status: 'PENDING',
    refundedAmount: 0,
    pendingRefundAmount: 0
  }));

  const attemptF2 = trackAttempt(await PaymentAttempt.create({
    paymentId: paymentF2._id,
    orderId: orderF2._id,
    amount: 1000,
    currency: 'INR',
    status: 'PENDING',
    razorpayOrderId: `rzp_ord_f2_${timestamp}`,
    razorpayPaymentId: `pay_f2_${timestamp}`
  }));

  const captureSession = await mongoose.startSession();
  captureSession.startTransaction();
  try {
    const captureHookRes = await processSupportedWebhookEvent(
      'payment.captured',
      {
        payload: {
          payment: {
            entity: {
              order_id: `rzp_ord_f2_${timestamp}`,
              id: `pay_f2_${timestamp}`
            }
          }
        }
      },
      { session: captureSession }
    );
    check(captureHookRes.outcome === 'PROCESSED', 'F2.1 In-session payment.captured returned outcome PROCESSED');

    const inTxOrder = await Order.findById(orderF2._id).session(captureSession);
    check(inTxOrder?.paymentStatus === 'PAID', 'F2.1b In-transaction Order is PAID');
    check(inTxOrder?.status === 'CONFIRMED', 'F2.1c In-transaction Order is CONFIRMED');
    const inTxProd = await Product.findById(prodF2Id).session(captureSession);
    const inTxStock = inTxProd?.variants.find((v: IProductVariant) => v._id?.toString() === f2VariantId.toString())?.stock;
    check(inTxStock === 8, 'F2.1d In-transaction stock decremented (10 -> 8)');

    await captureSession.abortTransaction();
  } finally {
    await captureSession.endSession();
  }

  const postAbortOrder = await Order.findById(orderF2._id);
  check(postAbortOrder?.paymentStatus === 'PENDING', 'F2.2 Order paymentStatus rolled back to PENDING');
  check(postAbortOrder?.status === 'PENDING', 'F2.2b Order status rolled back to PENDING');

  const postAbortAttempt = await PaymentAttempt.findById(attemptF2._id);
  check(postAbortAttempt?.status === 'PENDING', 'F2.3 PaymentAttempt status rolled back to PENDING');

  const postAbortProd = await Product.findById(prodF2Id);
  const postAbortStock = postAbortProd?.variants.find((v: IProductVariant) => v._id?.toString() === f2VariantId.toString())?.stock;
  check(postAbortStock === 10, 'F2.4 Product stock completely rolled back to 10 (did NOT decrement)');

  const postAbortSales = await InventoryTransaction.find({ orderId: orderF2._id, type: 'SALE' });
  check(postAbortSales.length === 0, 'F2.5 SALE inventory transaction rolled back completely');

  // ==========================================
  // FINDING 4: RETURNREQUEST COMPLETION GATE
  // ==========================================
  console.log('\n[FINDING 4: ReturnRequest Completion Gate]');

  const f4RefundId = new mongoose.Types.ObjectId();
  const paymentF4 = trackPayment(await Payment.create({
    orderId: new mongoose.Types.ObjectId(),
    userId,
    amount: 500,
    currency: 'INR',
    status: 'CAPTURED',
    refundedAmount: 0,
    pendingRefundAmount: 500,
    razorpayPaymentId: `pay_f4_${timestamp}`,
    refundReservations: [
      {
        reservationId: `res_f4_${timestamp}`,
        refundId: f4RefundId,
        attemptNumber: 1,
        amount: 500,
        status: 'PENDING',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]
  }));

  const retF4 = trackReturn(await ReturnRequest.create({
    orderId: paymentF4.orderId,
    userId,
    items: [{ productId: prodId, variantId: varId, quantity: 1, reason: 'WRONG_SIZE' }],
    status: 'ACCEPTED',
    refundAttempt: 1,
    refundStatus: 'PROCESSING',
    inventoryRestored: false
  }));

  const refundF4 = trackRefund(await Refund.create({
    _id: f4RefundId,
    orderId: paymentF4.orderId,
    paymentId: paymentF4._id,
    returnId: retF4._id,
    userId,
    initiatedBy: userId,
    initiatedByRole: 'ADMIN',
    amount: 500,
    currency: 'INR',
    status: 'PROCESSING',
    submissionState: 'CONFIRMED',
    razorpayPaymentId: paymentF4.razorpayPaymentId,
    razorpayRefundId: `rfnd_f4_${timestamp}`,
    attemptNumber: 1,
    accountingSettlementStatus: 'PENDING'
  }));

  await handleRefundProcessedEntity({
    id: `rfnd_f4_${timestamp}`,
    payment_id: paymentF4.razorpayPaymentId!,
    amount: 50000,
    currency: 'INR',
    notes: { internal_refund_id: refundF4._id.toString() }
  });

  const checkRefundF4 = await Refund.findById(refundF4._id);
  check(checkRefundF4?.accountingSettlementStatus === 'RECONCILIATION_REQUIRED', 'F4.1 Missing Order fails closed: accountingSettlementStatus is RECONCILIATION_REQUIRED (NEVER COMPLETED)');

  const f4bRefundId = new mongoose.Types.ObjectId();
  const paymentF4b = trackPayment(await Payment.create({
    orderId: new mongoose.Types.ObjectId(),
    userId,
    amount: 500,
    currency: 'INR',
    status: 'CAPTURED',
    refundedAmount: 0,
    pendingRefundAmount: 500,
    razorpayPaymentId: `pay_f4b_${timestamp}`,
    refundReservations: [
      {
        reservationId: `res_f4b_${timestamp}`,
        refundId: f4bRefundId,
        attemptNumber: 1,
        amount: 500,
        status: 'PENDING',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]
  }));

  const retF4b = trackReturn(await ReturnRequest.create({
    orderId: paymentF4b.orderId,
    userId,
    items: [{ productId: prodId, variantId: varId, quantity: 1, reason: 'WRONG_SIZE' }],
    status: 'ACCEPTED',
    refundAttempt: 1,
    refundStatus: 'PROCESSING',
    inventoryRestored: false
  }));

  const refundF4b = trackRefund(await Refund.create({
    _id: f4bRefundId,
    orderId: new mongoose.Types.ObjectId(),
    paymentId: paymentF4b._id,
    returnId: retF4b._id,
    userId,
    initiatedBy: userId,
    initiatedByRole: 'ADMIN',
    amount: 500,
    currency: 'INR',
    status: 'PROCESSING',
    submissionState: 'CONFIRMED',
    razorpayPaymentId: paymentF4b.razorpayPaymentId,
    razorpayRefundId: `rfnd_f4b_${timestamp}`,
    attemptNumber: 1,
    accountingSettlementStatus: 'PENDING'
  }));

  await handleRefundProcessedEntity({
    id: `rfnd_f4b_${timestamp}`,
    payment_id: paymentF4b.razorpayPaymentId!,
    amount: 50000,
    currency: 'INR',
    notes: { internal_refund_id: refundF4b._id.toString() }
  });

  const checkRefundF4b = await Refund.findById(refundF4b._id);
  check(checkRefundF4b?.accountingSettlementStatus === 'RECONCILIATION_REQUIRED', 'F4.2 Contradictory Order fails closed: accountingSettlementStatus is RECONCILIATION_REQUIRED (NEVER COMPLETED)');

  // ==========================================
  // FINDING 5: WORKER FENCING REQUIRED & ERROR CODE PRESERVATION
  // ==========================================
  console.log('\n[FINDING 5: Worker Fencing Required & Error Code Preservation]');

  let workerFenceRequiredThrown = false;
  try {
    await reconcileIncompleteRefundOperations({ executionMode: 'WORKER' });
  } catch (err: unknown) {
    if (err instanceof AppError && err.code === 'WORKER_FENCE_REQUIRED') {
      workerFenceRequiredThrown = true;
    }
  }
  check(workerFenceRequiredThrown, 'F5.1 Worker-driven recovery strictly requires fencing wrapper (WORKER_FENCE_REQUIRED)');

  let preserveFenceErrThrown = false;
  try {
    await reconcileUnknownRefund(refundF1._id.toString(), {
      withFence: async () => {
        throw new AppError('Worker lease fenced out', 409, 'WORKER_LEASE_FENCED_OUT');
      }
    });
  } catch (err: unknown) {
    if (err instanceof AppError && err.code === 'WORKER_LEASE_FENCED_OUT' && err.statusCode === 409) {
      preserveFenceErrThrown = true;
    }
  }
  check(preserveFenceErrThrown, 'F5.2 reconcileUnknownRefund preserves exact WORKER_LEASE_FENCED_OUT error code (not generic 502)');

  let preserveIncompleteFenceThrown = false;
  try {
    await reconcileIncompleteRefundOperations({
      staleThresholdMs: 0,
      withFence: async () => {
        throw new AppError('Worker lease fenced out during batch', 409, 'WORKER_LEASE_FENCED_OUT');
      }
    });
  } catch (err: unknown) {
    if (err instanceof AppError && err.code === 'WORKER_LEASE_FENCED_OUT') {
      preserveIncompleteFenceThrown = true;
    }
  }
  check(preserveIncompleteFenceThrown, 'F5.3 reconcileIncompleteRefundOperations preserves and rethrows WORKER_LEASE_FENCED_OUT');
  check(isRecognizedWorkerFenceOrAbortError(new AppError('fenced', 409, 'WORKER_LEASE_FENCED_OUT')), 'F5.4 isRecognizedWorkerFenceOrAbortError recognizes WORKER_LEASE_FENCED_OUT');
  check(isRecognizedWorkerFenceOrAbortError(new AppError('lease lost', 409, 'WEBHOOK_LEASE_LOST')), 'F5.4b isRecognizedWorkerFenceOrAbortError recognizes WEBHOOK_LEASE_LOST');

  // ==========================================
  // STEP 2: AUTOMATIC REFUND TRANSACTION BOUNDARY REGRESSION TESTS
  // ==========================================
  console.log('\n[STEP 2: Automatic Refund Transaction Boundary Regression Tests]');

  const orderS2 = trackOrder(await Order.create({
    orderNumber: `ORD-S2-${timestamp}`,
    userId,
    items: [],
    shippingAddress: { fullName: 'User S2', addressLine1: 'Line', city: 'City', state: 'State', postalCode: '111', country: 'IN', phone: '123' },
    paymentMethod: 'ONLINE',
    subtotal: 1000,
    shipping: 0,
    tax: 0,
    total: 1000,
    status: 'CONFIRMED',
    paymentStatus: 'PAID'
  }));

  const paymentS2 = trackPayment(await Payment.create({
    orderId: orderS2._id,
    userId,
    amount: 1000,
    currency: 'INR',
    status: 'CAPTURED',
    refundedAmount: 0,
    pendingRefundAmount: 0,
    razorpayPaymentId: `pay_s2_${timestamp}`
  }));

  trackAttempt(await PaymentAttempt.create({
    paymentId: paymentS2._id,
    orderId: orderS2._id,
    amount: 1000,
    currency: 'INR',
    status: 'CAPTURED',
    razorpayOrderId: `rzp_ord_s2_${timestamp}`,
    razorpayPaymentId: `pay_s2_${timestamp}`
  }));

  // S2.1: Outer transaction rollback leaves zero refund or reservation documents
  const outerSessionS2 = await mongoose.startSession();
  outerSessionS2.startTransaction();
  let createdRefundIdS2: mongoose.Types.ObjectId | undefined;
  try {
    const refundDocS2 = await createInternalRefund({
      orderId: orderS2._id.toString(),
      amount: 400,
      reason: 'Auto-refund test in transaction',
      actorId: userId.toString(),
      actorRole: 'SYSTEM',
      session: outerSessionS2
    });
    createdRefundIdS2 = refundDocS2._id as mongoose.Types.ObjectId;
    trackRefund(refundDocS2);

    // Verify in-transaction state
    const inTxRefund = await Refund.findById(createdRefundIdS2).session(outerSessionS2);
    check(inTxRefund?.status === 'PROCESSING', 'S2.1 In-transaction Refund document created with PROCESSING status');
    check(inTxRefund?.submissionState === 'INTENT_CREATED', 'S2.1b In-transaction Refund has submissionState: INTENT_CREATED');

    // Deliberately abort outer transaction
    await outerSessionS2.abortTransaction();
  } finally {
    await outerSessionS2.endSession();
  }

  // Verify full rollback in database
  const postAbortRefundS2 = await Refund.findById(createdRefundIdS2);
  check(postAbortRefundS2 === null, 'S2.1c Aborted outer transaction rolled back Refund document completely (not persisted)');
  const postAbortPaymentS2 = await Payment.findById(paymentS2._id);
  check(postAbortPaymentS2?.pendingRefundAmount === 0, 'S2.1d Aborted outer transaction rolled back pendingRefundAmount (remains 0)');
  check((postAbortPaymentS2?.refundReservations || []).length === 0, 'S2.1e Aborted outer transaction rolled back reservation entry');

  // S2.2: Successful transaction commits refund intent once and triggers post-commit gateway submission
  let s2GatewayCalled: boolean = false;
  let s2GatewayCallCount = 0;
  const origRzpCreateRefund = razorpayProvider.createRefund.bind(razorpayProvider);
  (razorpayProvider as unknown as { createRefund: typeof razorpayProvider.createRefund }).createRefund = async (...args: Parameters<typeof razorpayProvider.createRefund>) => {
    s2GatewayCalled = true;
    s2GatewayCallCount++;
    return {
      id: `rfnd_rzp_s2_${timestamp}`,
      entity: 'refund' as const,
      payment_id: `pay_s2_${timestamp}`,
      amount: 40000,
      currency: 'INR',
      status: 'processed'
    };
  };

  const commitSessionS2 = await mongoose.startSession();
  commitSessionS2.startTransaction();
  let committedRefundS2: IRefund | undefined;
  try {
    committedRefundS2 = trackRefund(await createInternalRefund({
      orderId: orderS2._id.toString(),
      amount: 400,
      reason: 'Auto-refund test commit in transaction',
      actorId: userId.toString(),
      actorRole: 'SYSTEM',
      session: commitSessionS2
    }));

    // Before commit: gateway must NOT have been called
    check(s2GatewayCalled === false, 'S2.2 External Razorpay refund API is NOT called inside active MongoDB transaction');
    await commitSessionS2.commitTransaction();
  } finally {
    await commitSessionS2.endSession();
  }

  // After commit: post-commit hook triggers gateway dispatch
  await new Promise(r => setImmediate(r));
  check(Boolean(s2GatewayCalled), 'S2.2b External Razorpay refund API triggered after transaction commit');
  check(s2GatewayCallCount === 1, 'S2.2c Gateway called exactly once (no duplicates)');

  const postCommitRefundS2 = await Refund.findById(committedRefundS2?._id);
  check(postCommitRefundS2 !== null, 'S2.2d Committed refund persists in database');

  (razorpayProvider as unknown as { createRefund: typeof razorpayProvider.createRefund }).createRefund = origRzpCreateRefund;

  // ==========================================
  // STEP 3: POST-COMMIT NOTIFICATION HANDLING REGRESSION TESTS
  // ==========================================
  console.log('\n[STEP 3: Post-Commit Notification Handling Regression Tests]');

  let notificationCallCount = 0;
  const mockNotificationFn = async () => {
    notificationCallCount++;
  };

  // S3.1: Aborted transaction dispatches zero notifications
  notificationCallCount = 0;
  const abortNotifSession = await mongoose.startSession();
  abortNotifSession.startTransaction();
  registerPostCommitHook(abortNotifSession, mockNotificationFn);
  await abortNotifSession.abortTransaction();
  await abortNotifSession.endSession();
  await new Promise(r => setImmediate(r));
  check(notificationCallCount === 0, 'S3.1 Aborted transaction dispatched zero notifications');

  // S3.2: Successful transaction dispatches exactly once
  notificationCallCount = 0;
  const commitNotifSession = await mongoose.startSession();
  commitNotifSession.startTransaction();
  registerPostCommitHook(commitNotifSession, mockNotificationFn);
  await commitNotifSession.commitTransaction();
  await commitNotifSession.endSession();
  await new Promise(r => setImmediate(r));
  check(notificationCallCount === 1, 'S3.2 Successful commit dispatched notification exactly once');

  // S3.3: Transaction retry dispatches only on final committed attempt (aborted attempt hooks don't leak)
  notificationCallCount = 0;
  const retryNotifSession = await mongoose.startSession();
  // Attempt 1: aborts
  retryNotifSession.startTransaction();
  registerPostCommitHook(retryNotifSession, mockNotificationFn);
  await retryNotifSession.abortTransaction();
  // Attempt 2: commits
  retryNotifSession.startTransaction();
  registerPostCommitHook(retryNotifSession, mockNotificationFn);
  await retryNotifSession.commitTransaction();
  await retryNotifSession.endSession();
  await new Promise(r => setImmediate(r));
  check(notificationCallCount === 1, 'S3.3 Transaction retry dispatches only on final committed attempt (no leaked hooks from attempt 1)');

  // S3.4: Notification dispatch failure after commit does not cause committed transaction to fail
  const failingNotifSession = await mongoose.startSession();
  failingNotifSession.startTransaction();
  registerPostCommitHook(failingNotifSession, async () => {
    throw new Error('Notification service unavailable');
  });
  let commitThrewError = false;
  try {
    await failingNotifSession.commitTransaction();
  } catch {
    commitThrewError = true;
  } finally {
    await failingNotifSession.endSession();
  }
  check(commitThrewError === false, 'S3.4 Notification failure after commit does NOT cause commitTransaction to throw or appear rolled back');

  // ==========================================
  // STEP 4: FAILED-REFUND RETURNREQUEST COMPLETION REGRESSION TESTS
  // ==========================================
  console.log('\n[STEP 4: Failed-Refund ReturnRequest Completion Regression Tests]');

  const orderS4 = trackOrder(await Order.create({
    orderNumber: `ORD-S4-${timestamp}`,
    userId,
    items: [],
    shippingAddress: { fullName: 'User S4', addressLine1: 'Line', city: 'City', state: 'State', postalCode: '111', country: 'IN', phone: '123' },
    paymentMethod: 'ONLINE',
    subtotal: 500,
    shipping: 0,
    tax: 0,
    total: 500,
    status: 'CONFIRMED',
    paymentStatus: 'PAID'
  }));

  const refundS4Id = new mongoose.Types.ObjectId();
  const paymentS4 = trackPayment(await Payment.create({
    orderId: orderS4._id,
    userId,
    amount: 500,
    currency: 'INR',
    status: 'CAPTURED',
    refundedAmount: 0,
    pendingRefundAmount: 500,
    razorpayPaymentId: `pay_s4_${timestamp}`,
    refundReservations: [
      {
        reservationId: refundS4Id.toString(),
        refundId: refundS4Id,
        attemptNumber: 1,
        amount: 500,
        status: 'PENDING',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]
  }));

  const retS4 = trackReturn(await ReturnRequest.create({
    orderId: orderS4._id,
    userId,
    items: [{ productId: prodId, variantId: varId, quantity: 1, reason: 'WRONG_SIZE' }],
    status: 'ACCEPTED',
    refundId: refundS4Id,
    refundAttempt: 1,
    refundStatus: 'PROCESSING',
    inventoryRestored: false
  }));

  const refundS4 = trackRefund(await Refund.create({
    _id: refundS4Id,
    orderId: orderS4._id,
    paymentId: paymentS4._id,
    returnId: retS4._id,
    userId,
    initiatedBy: userId,
    initiatedByRole: 'ADMIN',
    amount: 500,
    currency: 'INR',
    status: 'PROCESSING',
    submissionState: 'CONFIRMED',
    razorpayPaymentId: paymentS4.razorpayPaymentId,
    razorpayRefundId: `rfnd_s4_${timestamp}`,
    attemptNumber: 1,
    accountingSettlementStatus: 'PENDING'
  }));

  // S4.1: Failed refund with successfully synchronized ReturnRequest -> COMPLETED
  await handleRefundFailedEntity({
    id: `rfnd_s4_${timestamp}`,
    payment_id: paymentS4.razorpayPaymentId!,
    amount: 50000,
    currency: 'INR',
    notes: { internal_refund_id: refundS4._id.toString() }
  });

  const checkRefundS4 = await Refund.findById(refundS4._id);
  check(checkRefundS4?.status === 'FAILED', 'S4.1 Refund transitioned to FAILED');
  check(checkRefundS4?.accountingSettlementStatus === 'COMPLETED', 'S4.1b accountingSettlementStatus is COMPLETED when ReturnRequest synchronization succeeds');
  const checkRetS4 = await ReturnRequest.findById(retS4._id);
  check(checkRetS4?.refundStatus === 'FAILED', 'S4.1c ReturnRequest updated to refundStatus: FAILED for retry');

  // S4.2: Failed refund with missing ReturnRequest fails closed
  const orderS4b = trackOrder(await Order.create({
    orderNumber: `ORD-S4B-${timestamp}`,
    userId,
    items: [],
    shippingAddress: { fullName: 'User S4B', addressLine1: 'Line', city: 'City', state: 'State', postalCode: '111', country: 'IN', phone: '123' },
    paymentMethod: 'ONLINE',
    subtotal: 500,
    shipping: 0,
    tax: 0,
    total: 500,
    status: 'CONFIRMED',
    paymentStatus: 'PAID'
  }));

  const refundS4bId = new mongoose.Types.ObjectId();
  const paymentS4b = trackPayment(await Payment.create({
    orderId: orderS4b._id,
    userId,
    amount: 500,
    currency: 'INR',
    status: 'CAPTURED',
    refundedAmount: 0,
    pendingRefundAmount: 500,
    razorpayPaymentId: `pay_s4b_${timestamp}`,
    refundReservations: [
      {
        reservationId: refundS4bId.toString(),
        refundId: refundS4bId,
        attemptNumber: 1,
        amount: 500,
        status: 'PENDING',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]
  }));

  const refundS4b = trackRefund(await Refund.create({
    _id: refundS4bId,
    orderId: orderS4b._id,
    paymentId: paymentS4b._id,
    returnId: new mongoose.Types.ObjectId(), // Non-existent ReturnRequest!
    userId,
    initiatedBy: userId,
    initiatedByRole: 'ADMIN',
    amount: 500,
    currency: 'INR',
    status: 'PROCESSING',
    submissionState: 'CONFIRMED',
    razorpayPaymentId: paymentS4b.razorpayPaymentId,
    razorpayRefundId: `rfnd_s4b_${timestamp}`,
    attemptNumber: 1,
    accountingSettlementStatus: 'PENDING'
  }));

  await handleRefundFailedEntity({
    id: `rfnd_s4b_${timestamp}`,
    payment_id: paymentS4b.razorpayPaymentId!,
    amount: 50000,
    currency: 'INR',
    notes: { internal_refund_id: refundS4b._id.toString() }
  });

  const checkRefundS4b = await Refund.findById(refundS4b._id);
  check(checkRefundS4b?.accountingSettlementStatus === 'RECONCILIATION_REQUIRED', 'S4.2 Missing ReturnRequest fails closed: accountingSettlementStatus is RECONCILIATION_REQUIRED');

  // S4.3: Contradictory order relationship in failed refund fails closed
  const orderS4c = trackOrder(await Order.create({
    orderNumber: `ORD-S4C-${timestamp}`,
    userId,
    items: [],
    shippingAddress: { fullName: 'User S4C', addressLine1: 'Line', city: 'City', state: 'State', postalCode: '111', country: 'IN', phone: '123' },
    paymentMethod: 'ONLINE',
    subtotal: 500,
    shipping: 0,
    tax: 0,
    total: 500,
    status: 'CONFIRMED',
    paymentStatus: 'PAID'
  }));

  const refundS4cId = new mongoose.Types.ObjectId();
  const paymentS4c = trackPayment(await Payment.create({
    orderId: orderS4c._id,
    userId,
    amount: 500,
    currency: 'INR',
    status: 'CAPTURED',
    refundedAmount: 0,
    pendingRefundAmount: 500,
    razorpayPaymentId: `pay_s4c_${timestamp}`,
    refundReservations: [
      {
        reservationId: refundS4cId.toString(),
        refundId: refundS4cId,
        attemptNumber: 1,
        amount: 500,
        status: 'PENDING',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]
  }));

  const retS4c = trackReturn(await ReturnRequest.create({
    orderId: orderS4c._id,
    userId,
    items: [{ productId: prodId, variantId: varId, quantity: 1, reason: 'WRONG_SIZE' }],
    status: 'ACCEPTED',
    refundAttempt: 1,
    refundStatus: 'PROCESSING',
    inventoryRestored: false
  }));

  const refundS4c = trackRefund(await Refund.create({
    _id: refundS4cId,
    orderId: new mongoose.Types.ObjectId(), // Contradictory orderId!
    paymentId: paymentS4c._id,
    returnId: retS4c._id,
    userId,
    initiatedBy: userId,
    initiatedByRole: 'ADMIN',
    amount: 500,
    currency: 'INR',
    status: 'PROCESSING',
    submissionState: 'CONFIRMED',
    razorpayPaymentId: paymentS4c.razorpayPaymentId,
    razorpayRefundId: `rfnd_s4c_${timestamp}`,
    attemptNumber: 1,
    accountingSettlementStatus: 'PENDING'
  }));

  await handleRefundFailedEntity({
    id: `rfnd_s4c_${timestamp}`,
    payment_id: paymentS4c.razorpayPaymentId!,
    amount: 50000,
    currency: 'INR',
    notes: { internal_refund_id: refundS4c._id.toString() }
  });

  const checkRefundS4c = await Refund.findById(refundS4c._id);
  check(checkRefundS4c?.accountingSettlementStatus === 'RECONCILIATION_REQUIRED', 'S4.3 Contradictory Order relationship fails closed: accountingSettlementStatus is RECONCILIATION_REQUIRED');
  // S4.4: Failed refund where syncReturnRequestWithRefund returns success: false without throwing
  const orderS4d = trackOrder(await Order.create({
    orderNumber: `ORD-S4D-${timestamp}`,
    userId,
    items: [],
    shippingAddress: { fullName: 'User S4D', addressLine1: 'Line', city: 'City', state: 'State', postalCode: '111', country: 'IN', phone: '123' },
    paymentMethod: 'ONLINE',
    subtotal: 500,
    shipping: 0,
    tax: 0,
    total: 500,
    status: 'CONFIRMED',
    paymentStatus: 'PAID'
  }));

  const refundS4dId = new mongoose.Types.ObjectId();
  const paymentS4d = trackPayment(await Payment.create({
    orderId: orderS4d._id,
    userId,
    amount: 500,
    currency: 'INR',
    status: 'CAPTURED',
    refundedAmount: 0,
    pendingRefundAmount: 500,
    razorpayPaymentId: `pay_s4d_${timestamp}`,
    refundReservations: [
      {
        reservationId: refundS4dId.toString(),
        refundId: refundS4dId,
        attemptNumber: 1,
        amount: 500,
        status: 'PENDING',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]
  }));

  // ReturnRequest is already PROCESSED; syncReturnRequestWithRefund returns { success: false, reason: 'ReturnRequest already PROCESSED; ignoring downgrade' }
  const retS4d = trackReturn(await ReturnRequest.create({
    orderId: orderS4d._id,
    userId,
    items: [{ productId: prodId, variantId: varId, quantity: 1, reason: 'WRONG_SIZE' }],
    status: 'COMPLETED',
    refundAttempt: 1,
    refundStatus: 'PROCESSED',
    inventoryRestored: true
  }));

  const refundS4d = trackRefund(await Refund.create({
    _id: refundS4dId,
    orderId: orderS4d._id,
    paymentId: paymentS4d._id,
    returnId: retS4d._id,
    userId,
    initiatedBy: userId,
    initiatedByRole: 'ADMIN',
    amount: 500,
    currency: 'INR',
    status: 'PROCESSING',
    submissionState: 'CONFIRMED',
    razorpayPaymentId: paymentS4d.razorpayPaymentId,
    razorpayRefundId: `rfnd_s4d_${timestamp}`,
    attemptNumber: 1,
    accountingSettlementStatus: 'PENDING'
  }));

  await handleRefundFailedEntity({
    id: `rfnd_s4d_${timestamp}`,
    payment_id: paymentS4d.razorpayPaymentId!,
    amount: 50000,
    currency: 'INR',
    notes: { internal_refund_id: refundS4d._id.toString() }
  });

  const checkRefundS4d = await Refund.findById(refundS4d._id);
  check(checkRefundS4d?.accountingSettlementStatus === 'RECONCILIATION_REQUIRED', 'S4.4 syncReturnRequestWithRefund returning success: false leaves accountingSettlementStatus as RECONCILIATION_REQUIRED');
  const checkRetS4d = await ReturnRequest.findById(retS4d._id);
  check(checkRetS4d?.refundStatus === 'PROCESSED', 'S4.4b Already PROCESSED ReturnRequest strictly preserved without downgrade');

  // S4.5: Missing authoritative Order on failed refund with returnId fails closed
  const refundS4eId = new mongoose.Types.ObjectId();
  const nonExistentOrderId = new mongoose.Types.ObjectId();
  const paymentS4e = trackPayment(await Payment.create({
    orderId: nonExistentOrderId,
    userId,
    amount: 500,
    currency: 'INR',
    status: 'CAPTURED',
    refundedAmount: 0,
    pendingRefundAmount: 500,
    razorpayPaymentId: `pay_s4e_${timestamp}`,
    refundReservations: [
      {
        reservationId: refundS4eId.toString(),
        refundId: refundS4eId,
        attemptNumber: 1,
        amount: 500,
        status: 'PENDING',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]
  }));

  const retS4e = trackReturn(await ReturnRequest.create({
    orderId: nonExistentOrderId,
    userId,
    items: [{ productId: prodId, variantId: varId, quantity: 1, reason: 'WRONG_SIZE' }],
    status: 'ACCEPTED',
    refundAttempt: 1,
    refundStatus: 'PROCESSING',
    inventoryRestored: false
  }));

  const refundS4e = trackRefund(await Refund.create({
    _id: refundS4eId,
    orderId: nonExistentOrderId,
    paymentId: paymentS4e._id,
    returnId: retS4e._id,
    userId,
    initiatedBy: userId,
    initiatedByRole: 'ADMIN',
    amount: 500,
    currency: 'INR',
    status: 'PROCESSING',
    submissionState: 'CONFIRMED',
    razorpayPaymentId: paymentS4e.razorpayPaymentId,
    razorpayRefundId: `rfnd_s4e_${timestamp}`,
    attemptNumber: 1,
    accountingSettlementStatus: 'PENDING'
  }));

  await handleRefundFailedEntity({
    id: `rfnd_s4e_${timestamp}`,
    payment_id: paymentS4e.razorpayPaymentId!,
    amount: 50000,
    currency: 'INR',
    notes: { internal_refund_id: refundS4e._id.toString() }
  });

  const checkRefundS4e = await Refund.findById(refundS4e._id);
  check(checkRefundS4e?.accountingSettlementStatus === 'RECONCILIATION_REQUIRED', 'S4.5 Missing authoritative Order in DB fails closed: accountingSettlementStatus is RECONCILIATION_REQUIRED');
  // ==========================================
  // STEP 5: INVENTORY DUPLICATE-KEY RECOVERY REGRESSION TESTS
  // ==========================================
  console.log('\n[STEP 5: Inventory Duplicate-Key Recovery Regression Tests]');

  const prodS5Res = await createTestProduct({
    name: `Product S5 ${timestamp}`,
    variants: [{ size: 'L', color: 'Black', stock: 20 }]
  });
  trackProduct(prodS5Res.product);
  const s5VariantId = new mongoose.Types.ObjectId(prodS5Res.variantIds[0]);
  const s5ProdId = new mongoose.Types.ObjectId(prodS5Res.productId);
  const orderS5 = trackOrder(await Order.create({
    orderNumber: `ORD-S5-${timestamp}`,
    userId,
    items: [],
    shippingAddress: { fullName: 'User S5', addressLine1: 'Line', city: 'City', state: 'State', postalCode: '111', country: 'IN', phone: '123' },
    paymentMethod: 'ONLINE',
    subtotal: 500,
    shipping: 0,
    tax: 0,
    total: 500,
    status: 'CONFIRMED',
    paymentStatus: 'PAID'
  }));

  // Pre-seed an identical unique SALE transaction to force E11000 duplicate key
  trackTx(await InventoryTransaction.create({
    orderId: orderS5._id,
    productId: s5ProdId,
    variantId: s5VariantId,
    quantity: 2,
    type: 'SALE'
  }));

  // S5.1: Duplicate key conflict inside caller-owned transaction propagates error
  const s5TxSession = await mongoose.startSession();
  s5TxSession.startTransaction();
  let dupInsideTxThrown = false;
  try {
    await InventoryAllocationService.deductInventory(
      orderS5._id,
      [{ productId: s5ProdId, variantId: s5VariantId, totalQuantity: 2 }],
      { session: s5TxSession }
    );
    await s5TxSession.commitTransaction();
  } catch (err: unknown) {
    dupInsideTxThrown = true;
    await s5TxSession.abortTransaction();
  } finally {
    await s5TxSession.endSession();
  }
  check(dupInsideTxThrown, 'S5.1 Duplicate-key write inside caller-owned transaction propagates error immediately for clean rollback');

  // S5.2: Duplicate key conflict outside transaction recovers idempotently without double-deduction
  const standaloneDeductRes = await InventoryAllocationService.deductInventory(
    orderS5._id,
    [{ productId: s5ProdId, variantId: s5VariantId, totalQuantity: 2 }]
  );
  check(standaloneDeductRes.success === true, 'S5.2 Standalone duplicate-key handles conflict idempotently without crash');
  const postDeductProdS5 = await Product.findById(s5ProdId);
  const postDeductStockS5 = postDeductProdS5?.variants.find(v => v._id?.toString() === s5VariantId.toString())?.stock;
  check(postDeductStockS5 === 20, 'S5.2b Stock strictly preserved at 20 (duplicate run did NOT double-deduct stock)');

  // S5.3: restoreCancelledOrderInventory in caller-owned transaction propagates E11000
  const orderS5c = trackOrder(await Order.create({
    orderNumber: `ORD-S5C-${timestamp}`,
    userId,
    items: [],
    shippingAddress: { fullName: 'User S5C', addressLine1: 'Line', city: 'City', state: 'State', postalCode: '111', country: 'IN', phone: '123' },
    paymentMethod: 'ONLINE',
    subtotal: 500,
    shipping: 0,
    tax: 0,
    total: 500,
    status: 'CANCELLED',
    paymentStatus: 'PAID'
  }));
  trackTx(await InventoryTransaction.create({
    orderId: orderS5c._id,
    productId: s5ProdId,
    variantId: s5VariantId,
    quantity: 2,
    type: 'SALE'
  }));
  // Pre-seed unique REFUND transaction to force E11000
  trackTx(await InventoryTransaction.create({
    orderId: orderS5c._id,
    productId: s5ProdId,
    variantId: s5VariantId,
    quantity: 2,
    type: 'REFUND',
    status: 'COMPLETED'
  }));

  const s5cTxSession = await mongoose.startSession();
  s5cTxSession.startTransaction();
  let restoreCancelledDupThrown = false;
  const origTxCreateS5c = InventoryTransaction.create;
  (InventoryTransaction as unknown as { create: typeof InventoryTransaction.create }).create = ((...args: unknown[]) => {
    const err = new Error('E11000 duplicate key error collection: inventorytransactions index: uniq_refund_order_variant');
    (err as { code?: number }).code = 11000;
    throw err;
  }) as unknown as typeof InventoryTransaction.create;

  try {
    // Delete pre-seeded REFUND so pre-check passes and reaches create inside transaction
    await InventoryTransaction.deleteOne({ orderId: orderS5c._id, type: 'REFUND' });
    await InventoryAllocationService.restoreCancelledOrderInventory(orderS5c._id, { session: s5cTxSession });
    await s5cTxSession.commitTransaction();
  } catch (err: unknown) {
    restoreCancelledDupThrown = true;
    await s5cTxSession.abortTransaction();
  } finally {
    (InventoryTransaction as unknown as { create: typeof InventoryTransaction.create }).create = origTxCreateS5c;
    await s5cTxSession.endSession();
  }
  check(restoreCancelledDupThrown, 'S5.3 restoreCancelledOrderInventory in caller-owned transaction propagates E11000 immediately');

  // S5.4: restoreCancelledOrderInventory in standalone mode recovers idempotently from E11000
  trackTx(await InventoryTransaction.create({
    orderId: orderS5c._id,
    productId: s5ProdId,
    variantId: s5VariantId,
    quantity: 2,
    type: 'REFUND',
    status: 'COMPLETED'
  }));
  const standaloneCancelRestoreRes = await InventoryAllocationService.restoreCancelledOrderInventory(orderS5c._id);
  check(standaloneCancelRestoreRes.alreadyRestored === true, 'S5.4 Standalone restoreCancelledOrderInventory recognizes duplicate REFUND as alreadyRestored');
  check(standaloneCancelRestoreRes.restoredCount === 0, 'S5.4b Standalone restoreCancelledOrderInventory did NOT increment stock (restoredCount=0)');
  // S5.5: restoreReturnInventory in caller-owned transaction propagates E11000
  const orderS5r = trackOrder(await Order.create({
    orderNumber: `ORD-S5R-${timestamp}`,
    userId,
    items: [],
    shippingAddress: { fullName: 'User S5R', addressLine1: 'Line', city: 'City', state: 'State', postalCode: '111', country: 'IN', phone: '123' },
    paymentMethod: 'ONLINE',
    subtotal: 500,
    shipping: 0,
    tax: 0,
    total: 500,
    status: 'CONFIRMED',
    paymentStatus: 'PAID'
  }));
  const retS5r = trackReturn(await ReturnRequest.create({
    orderId: orderS5r._id,
    userId,
    items: [{ productId: s5ProdId, variantId: s5VariantId, quantity: 2, reason: 'WRONG_SIZE' }],
    status: 'ACCEPTED',
    refundAttempt: 1,
    refundStatus: 'PROCESSING',
    inventoryRestored: false
  }));
  // Pre-seed unique RETURN transaction to force E11000
  trackTx(await InventoryTransaction.create({
    returnId: retS5r._id,
    orderId: orderS5r._id,
    productId: s5ProdId,
    variantId: s5VariantId,
    quantity: 2,
    type: 'RETURN',
    status: 'COMPLETED'
  }));

  const s5rTxSession = await mongoose.startSession();
  s5rTxSession.startTransaction();
  let restoreReturnDupThrown = false;
  const origTxCreateS5r = InventoryTransaction.create;
  (InventoryTransaction as unknown as { create: typeof InventoryTransaction.create }).create = ((...args: unknown[]) => {
    const err = new Error('E11000 duplicate key error collection: inventorytransactions index: uniq_return_variant');
    (err as { code?: number }).code = 11000;
    throw err;
  }) as unknown as typeof InventoryTransaction.create;

  try {
    // Delete pre-seeded RETURN so pre-check passes and reaches create inside transaction
    await InventoryTransaction.deleteOne({ returnId: retS5r._id, type: 'RETURN' });
    await InventoryAllocationService.restoreReturnInventory(retS5r, orderS5r._id, { session: s5rTxSession });
    await s5rTxSession.commitTransaction();
  } catch (err: unknown) {
    restoreReturnDupThrown = true;
    await s5rTxSession.abortTransaction();
  } finally {
    (InventoryTransaction as unknown as { create: typeof InventoryTransaction.create }).create = origTxCreateS5r;
    await s5rTxSession.endSession();
  }
  check(restoreReturnDupThrown, 'S5.5 restoreReturnInventory in caller-owned transaction propagates E11000 immediately');

  // S5.6: restoreReturnInventory in standalone mode recovers idempotently
  trackTx(await InventoryTransaction.create({
    returnId: retS5r._id,
    orderId: orderS5r._id,
    productId: s5ProdId,
    variantId: s5VariantId,
    quantity: 2,
    type: 'RETURN',
    status: 'COMPLETED'
  }));
  const standaloneReturnRestoreRes = await InventoryAllocationService.restoreReturnInventory(retS5r, orderS5r._id);
  check(standaloneReturnRestoreRes.alreadyRestored === true, 'S5.6 Standalone restoreReturnInventory recognizes duplicate RETURN as alreadyRestored');
  check(standaloneReturnRestoreRes.restoredCount === 0, 'S5.6b Standalone restoreReturnInventory did NOT double-increment stock');
  // ==========================================
  // STEP 5b: DURABLE RECOVERY OF INTENT_CREATED REFUNDS ACROSS CRASH BOUNDARY
  // ==========================================
  console.log('\n[STEP 5b: Durable Recovery of INTENT_CREATED Refunds Across Crash Boundary]');

  const orderS5Crash = trackOrder(await Order.create({
    orderNumber: `ORD-S5-CRASH-${timestamp}`,
    userId,
    items: [],
    shippingAddress: { fullName: 'User S5 Crash', addressLine1: 'Line', city: 'City', state: 'State', postalCode: '111', country: 'IN', phone: '123' },
    paymentMethod: 'ONLINE',
    subtotal: 1000,
    shipping: 0,
    tax: 0,
    total: 1000,
    status: 'CONFIRMED',
    paymentStatus: 'PAID'
  }));

  const paymentS5Crash = trackPayment(await Payment.create({
    orderId: orderS5Crash._id,
    userId,
    amount: 1000,
    currency: 'INR',
    status: 'CAPTURED',
    refundedAmount: 0,
    pendingRefundAmount: 0,
    razorpayPaymentId: `pay_s5_crash_${timestamp}`
  }));

  trackAttempt(await PaymentAttempt.create({
    paymentId: paymentS5Crash._id,
    orderId: orderS5Crash._id,
    amount: 1000,
    currency: 'INR',
    status: 'CAPTURED',
    razorpayOrderId: `rzp_ord_s5_crash_${timestamp}`,
    razorpayPaymentId: `pay_s5_crash_${timestamp}`
  }));

  // Step 5b.1: Persist refund intent in transaction, then simulate process termination by suppressing post-commit hook
  const crashTxSession = await mongoose.startSession();
  crashTxSession.startTransaction();
  let intentCreatedRefund: IRefund;
  try {
    intentCreatedRefund = trackRefund(await createInternalRefund({
      orderId: orderS5Crash._id.toString(),
      amount: 200,
      reason: 'AUTO_REFUND_STOCK_UNAVAILABLE',
      actorId: userId.toString(),
      actorRole: 'SYSTEM',
      session: crashTxSession
    }));

    // Suppress in-memory post-commit hooks to simulate process termination right after commit
    const sPostCommit = crashTxSession as SessionWithPostCommit;
    sPostCommit._postCommitHooks = [];

    await crashTxSession.commitTransaction();
  } finally {
    await crashTxSession.endSession();
  }

  // Verify durable state in MongoDB after process crash
  const persistedIntentDoc = await Refund.findById(intentCreatedRefund._id);
  check(persistedIntentDoc?.status === 'PROCESSING', 'S5.7a Refund intent persisted in PROCESSING state in DB');
  check(persistedIntentDoc?.submissionState === 'INTENT_CREATED', 'S5.7b Refund intent persisted in INTENT_CREATED submissionState in DB');
  check(persistedIntentDoc?.autoSubmitOnRecovery === true, 'S5.7c Refund intent flagged autoSubmitOnRecovery in DB');

  // Step 5b.2: Invoke production recovery path
  let gatewaySubmissionCount = 0;
  const origCreateRefundGateway = razorpayProvider.createRefund.bind(razorpayProvider);
  (razorpayProvider as unknown as { createRefund: typeof razorpayProvider.createRefund }).createRefund = async () => {
    gatewaySubmissionCount++;
    return {
      id: `rfnd_crash_rec_${timestamp}`,
      entity: 'refund' as const,
      payment_id: `pay_s5_crash_${timestamp}`,
      amount: 20000,
      currency: 'INR',
      status: 'processed'
    };
  };

  const recResultCrash = await reconcileIncompleteRefundOperations({ staleThresholdMs: 0 });
  check(recResultCrash.recoveredCount >= 1, 'S5.7d Production recovery discovered and recovered unsubmitted refund intent');
  check(gatewaySubmissionCount === 1, 'S5.7e Persisted refund intent submitted to gateway exactly once');

  const postRecRefund = await Refund.findById(intentCreatedRefund._id);
  check(postRecRefund?.status === 'PROCESSED', 'S5.7f Recovered refund transitioned to PROCESSED');
  check(postRecRefund?.submissionState === 'CONFIRMED', 'S5.7g Recovered refund reached submissionState: CONFIRMED');
  check(postRecRefund?.razorpayRefundId === `rfnd_crash_rec_${timestamp}`, 'S5.7h Gateway refund ID recorded on recovered refund');

  // Step 5b.3: Duplicate recovery invocation cannot submit twice
  await reconcileIncompleteRefundOperations({ staleThresholdMs: 0 });
  check(gatewaySubmissionCount === 1, 'S5.7i Duplicate recovery invocation strictly did NOT submit to gateway again');

  (razorpayProvider as unknown as { createRefund: typeof razorpayProvider.createRefund }).createRefund = origCreateRefundGateway;
  } finally {
    // Purge all created fixtures reliably
    await Promise.allSettled([
      Payment.deleteMany({ _id: { $in: cleanupPayments } }),
      Refund.deleteMany({ _id: { $in: cleanupRefunds } }),
      Order.deleteMany({ _id: { $in: cleanupOrders } }),
      ReturnRequest.deleteMany({ _id: { $in: cleanupReturns } }),
      Product.deleteMany({ _id: { $in: cleanupProducts } }),
      InventoryTransaction.deleteMany({ _id: { $in: cleanupTransactions } }),
      WebhookEvent.deleteMany({ eventId: { $in: cleanupWebhookEvents } }),
      WorkerLock.deleteMany({ lockName: { $in: cleanupLocks } }),
      PaymentAttempt.deleteMany({ _id: { $in: cleanupPaymentAttempts } })
    ]);
  }
}

export async function runAllRemediationTests() {
  await connectSafeTestDb();
  enforceTestRazorpayMock(razorpayProvider);

  await runPhase1Tests();
  await runPhase2Tests();
  await runPhase3Tests();
  await runPhase4Tests();
  await runPhase5Tests();
  await runRemainingDefectTests();
  await runDefectsADTests();
  console.log('\n======================================================');
  console.log(`TOTAL PASSED: ${passed}`);
  console.log(`TOTAL FAILED: ${failed}`);
  console.log('======================================================');

  if (failed > 0) {
    console.error('Failures:', failures);
    process.exit(1);
  }
}

if (require.main === module) {
  runAllRemediationTests().then(() => {
    console.log('All tests passed cleanly.');
    process.exit(0);
  }).catch((err) => {
    console.error('Fatal test runner error:', err);
    process.exit(1);
  });
}
