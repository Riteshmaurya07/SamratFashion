/**
 * SamratFashion — Phase A.2.2.3 Blockers & Hardening Verification Suite
 *
 * Verifies exact resolution of:
 * - BLOCKER B1: Conclusive refund reservation ownership (no arbitrary assignment, handles partial arrays, rejects competing refunds)
 * - BLOCKER B2: Refund unique-index compatibility with late provider success
 * - BLOCKER B3: Strict webhook payload contract validation (amount, currency, IDs) for both refund.processed and refund.failed
 * - BLOCKER B4: Durable accounting settlement verification (never completed without verified settlement or when reconciliation required)
 * - WORKER SHUTDOWN: Active cycle tracking, reliable drain, and lease preservation during shutdown
 * - TEST HARNESS: Fail-closed transport guard, credential sanitization, isolated test DB
 */

process.env.NODE_ENV = 'test';
process.env.RAZORPAY_KEY_ID = 'rzp_test_mock';
process.env.RAZORPAY_KEY_SECRET = 'mock_secret_test';
process.env.RAZORPAY_WEBHOOK_SECRET = 'mock_webhook_secret_test';

import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import { connectSafeTestDb, enforceTestRazorpayMock } from './testHelpers';
import { Order } from '../models/Order';
import { Payment } from '../models/Payment';
import { Refund } from '../models/Refund';
import { ReturnRequest } from '../models/ReturnRequest';
import { WebhookEvent } from '../models/WebhookEvent';
import { WorkerLock } from '../models/WorkerLock';
import {
  transitionPaymentReservation,
  applyProviderRefundSettlement,
  reconcileIncompleteRefundOperations
} from '../services/payment/refundService';
import {
  handleRefundProcessedEntity,
  handleRefundFailedEntity,
  processSupportedWebhookEvent,
  razorpayWebhook
} from '../controllers/webhookController';
import { razorpayProvider } from '../services/payment/RazorpayProvider';
import { runRefundIndexMigration } from '../scripts/migrateRefundIndexes';
import { RecoveryCoordinatorService } from '../services/recovery/recoveryCoordinatorService';

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

async function createTestOrder(userId: mongoose.Types.ObjectId, suffix: string, total = 2000): Promise<any> {
  return await Order.create({
    orderNumber: `ORD-${suffix}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    userId,
    items: [],
    subtotal: total,
    total,
    currency: 'INR',
    status: 'DELIVERED',
    paymentStatus: 'PAID',
    paymentMethod: 'RAZORPAY',
    shippingAddress: { fullName: 'Customer', phone: '9876543210', addressLine1: 'Park St', city: 'Kolkata', state: 'WB', postalCode: '700016', country: 'India' }
  });
}

async function runBlockersSuite() {
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║   Phase A.2.2.3 — Financial Accounting, Webhook & Worker Hardening   ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

  await connectSafeTestDb();
  enforceTestRazorpayMock(razorpayProvider);
  await Order.deleteMany({ orderNumber: { $regex: /^ORD-(B|PART|AMB|FLAGGED)/ } });
  await Payment.deleteMany({ razorpayPaymentId: { $regex: /^pay_(b|part|amb|flag|leg)/ } });
  await Refund.deleteMany({
    $or: [
      { razorpayRefundId: { $regex: /^rfnd_(b|part|amb|flag|leg|missing|unres)/ } },
      { idempotencyKey: { $regex: /^idemp_(b|part|amb|flag|leg|crash|missing)/ } }
    ]
  });
  const userId = new mongoose.Types.ObjectId();
  const adminId = new mongoose.Types.ObjectId();
  const createdOrders: mongoose.Types.ObjectId[] = [];
  const createdPayments: mongoose.Types.ObjectId[] = [];
  const createdRefunds: mongoose.Types.ObjectId[] = [];
  const createdReturns: mongoose.Types.ObjectId[] = [];

  // ---------------------------------------------------------------------------
  // SECTION 1: BLOCKER B1 — CONCLUSIVE REFUND RESERVATION OWNERSHIP
  // ---------------------------------------------------------------------------
  console.log('--- SECTION 1: BLOCKER B1 — Conclusive Reservation Ownership ---');

  const orderB1 = await createTestOrder(userId, 'B1');
  createdOrders.push(orderB1._id);

  const paymentB1 = await Payment.create({
    orderId: orderB1._id,
    userId,
    amount: 2000,
    currency: 'INR',
    status: 'CAPTURED',
    razorpayPaymentId: `pay_b1_${Date.now()}`,
    pendingRefundAmount: 700,
    refundedAmount: 0,
    refundReservations: [
      {
        reservationId: 'res_b1_B',
        refundId: new mongoose.Types.ObjectId(),
        attemptNumber: 1,
        amount: 700,
        status: 'PENDING',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]
  });
  createdPayments.push(paymentB1._id);

  const refundA = await Refund.create({
    orderId: orderB1._id,
    paymentId: paymentB1._id,
    userId,
    amount: 500,
    currency: 'INR',
    status: 'FAILED',
    submissionState: 'CONFIRMED',
    attemptNumber: 1,
    idempotencyKey: `idemp_b1_A_${Date.now()}`,
    initiatedBy: adminId,
    initiatedByRole: 'ADMIN'
  });
  createdRefunds.push(refundA._id);

  // B1.1: Recover Refund A with RELEASED target state when Refund B owns the hold
  const relResA = await transitionPaymentReservation({
    paymentId: paymentB1._id,
    refundId: refundA._id,
    reservationId: refundA._id.toString(),
    amount: 500,
    targetState: 'RELEASED'
  });

  const freshPaymentAfterA = await Payment.findById(paymentB1._id);
  check(relResA.success === false, 'B1.1 transitionPaymentReservation returned success: false on missing reservation');
  check(relResA.outcome === 'OWNERSHIP_AMBIGUOUS' || relResA.outcome === 'RESERVATION_NOT_FOUND', 'B1.1 outcome is non-successful when reservation missing and hold belongs to another refund');
  check(relResA.pendingAdjusted === 0, 'B1.1 pendingAdjusted is 0 (did NOT decrement pending hold)');
  check(freshPaymentAfterA?.pendingRefundAmount === 700, 'B1.1 pendingRefundAmount strictly preserved at ₹700 (did NOT consume Refund B hold)');
  const resB = freshPaymentAfterA?.refundReservations.find(r => r.reservationId === 'res_b1_B');
  check(resB?.status === 'PENDING' && resB?.amount === 700, 'B1.1 Refund B reservation strictly remains PENDING with ₹700');
  check(freshPaymentAfterA?.reconciliationRequired === true, 'B1.1 Payment flagged with reconciliationRequired: true');
  // B1.2: Provider confirms success for unlinked Refund without matching reservation
  const refundUnlinked = await Refund.create({
    orderId: orderB1._id,
    paymentId: paymentB1._id,
    userId,
    amount: 500,
    currency: 'INR',
    status: 'PROCESSED',
    processedAt: new Date(),
    submissionState: 'CONFIRMED',
    razorpayRefundId: 'rfnd_b1_unlink_123',
    attemptNumber: 2,
    idempotencyKey: `idemp_b1_unlink_${Date.now()}`,
    initiatedBy: adminId,
    initiatedByRole: 'ADMIN'
  });
  createdRefunds.push(refundUnlinked._id);

  // 1. Transition helper strictly returns success: false for unlinked refund (never creates synthetic reservation)
  const conResA = await transitionPaymentReservation({
    paymentId: paymentB1._id,
    refundId: refundUnlinked._id,
    amount: 500,
    targetState: 'CONSUMED'
  });
  check(conResA.success === false, 'B1.2 Reservation transition returns success: false for unlinked refund');
  check(conResA.pendingAdjusted === 0, 'B1.2 pendingAdjusted is 0 (Refund B hold preserved)');

  // 2. Provider settlement is applied via applyProviderRefundSettlement helper with verified provider ID
  const settleRes = await applyProviderRefundSettlement({
    paymentId: paymentB1._id,
    refundId: refundUnlinked._id,
    razorpayRefundId: 'rfnd_b1_unlink_123',
    amount: 500,
    currency: 'INR',
    unlinked: true
  });
  check(settleRes.success === true, 'B1.2 Provider settlement recorded for unlinked refund');
  check(settleRes.refundedAdjusted === 500, 'B1.2 refundedAdjusted credited exactly ₹500');

  const freshPaymentAfterSuccessA = await Payment.findById(paymentB1._id);
  check(freshPaymentAfterSuccessA?.refundedAmount === 500, 'B1.2 Payment refundedAmount is exactly ₹500');
  check(freshPaymentAfterSuccessA?.pendingRefundAmount === 700, 'B1.2 Payment pendingRefundAmount strictly remains ₹700');
  check(freshPaymentAfterSuccessA?.refundReservations.find(r => r.reservationId === 'res_b1_B')?.status === 'PENDING', 'B1.2 Refund B reservation still remains PENDING');
  check(!freshPaymentAfterSuccessA?.refundReservations.some(r => r.refundId?.toString() === refundUnlinked._id.toString()), 'B1.2 Strictly NO fake reservation created in refundReservations');
  check((freshPaymentAfterSuccessA?.settledRefunds || []).some(s => s.refundId.toString() === refundUnlinked._id.toString()), 'B1.2 Unlinked refund recorded in settledRefunds without fake reservation in refundReservations');

  // 3. Provider settlement validation checks
  // 3a. Duplicate identical provider event does not increment again
  const dupSettleRes = await applyProviderRefundSettlement({
    paymentId: paymentB1._id,
    refundId: refundUnlinked._id,
    razorpayRefundId: 'rfnd_b1_unlink_123',
    amount: 500,
    currency: 'INR',
    unlinked: true
  });
  check(dupSettleRes.success === true && dupSettleRes.outcome === 'ALREADY_SETTLED', 'B1.2 Duplicate identical provider settlement is idempotent');
  check(dupSettleRes.refundedAdjusted === 0, 'B1.2 Duplicate provider event does not increment refundedAmount again');

  // 3b. Missing provider refund ID is rejected
  const missingProvRes = await applyProviderRefundSettlement({
    paymentId: paymentB1._id,
    refundId: refundUnlinked._id,
    razorpayRefundId: '',
    amount: 500,
    currency: 'INR',
    unlinked: true
  });
  check(missingProvRes.success === false && missingProvRes.outcome === 'SETTLEMENT_CONFLICT', 'B1.2 Missing provider refund ID is rejected with conflict');

  // 3c. Conflicting provider refund ID causes conflict
  const conflictProvRes = await applyProviderRefundSettlement({
    paymentId: paymentB1._id,
    refundId: refundUnlinked._id,
    razorpayRefundId: 'rfnd_DIFFERENT_id',
    amount: 500,
    currency: 'INR',
    unlinked: true
  });
  check(conflictProvRes.success === false && conflictProvRes.outcome === 'SETTLEMENT_CONFLICT', 'B1.2 Conflicting provider refund ID causes SETTLEMENT_CONFLICT');

  // 3d. Conflicting amount causes conflict
  const conflictAmtRes = await applyProviderRefundSettlement({
    paymentId: paymentB1._id,
    refundId: refundUnlinked._id,
    razorpayRefundId: 'rfnd_b1_unlink_123',
    amount: 999,
    currency: 'INR',
    unlinked: true
  });
  check(conflictAmtRes.success === false && conflictAmtRes.outcome === 'SETTLEMENT_CONFLICT', 'B1.2 Conflicting amount causes SETTLEMENT_CONFLICT');

  // 3e. Conflicting currency causes conflict
  const conflictCurrRes = await applyProviderRefundSettlement({
    paymentId: paymentB1._id,
    refundId: refundUnlinked._id,
    razorpayRefundId: 'rfnd_b1_unlink_123',
    amount: 500,
    currency: 'USD',
    unlinked: true
  });
  check(conflictCurrRes.success === false && conflictCurrRes.outcome === 'SETTLEMENT_CONFLICT', 'B1.2 Conflicting currency causes SETTLEMENT_CONFLICT');

  // B1.3: One Refund whose amount equals aggregate pending balance does NOT establish reservation ownership
  const orderLeg = await createTestOrder(userId, 'LEG', 1000);
  createdOrders.push(orderLeg._id);

  const legacyPayment = await Payment.create({
    orderId: orderLeg._id,
    userId,
    amount: 1000,
    currency: 'INR',
    status: 'CAPTURED',
    razorpayPaymentId: `pay_leg_${Date.now()}`,
    pendingRefundAmount: 400,
    refundedAmount: 0,
    refundReservations: []
  });
  createdPayments.push(legacyPayment._id);

  const legacyRefund = await Refund.create({
    orderId: orderLeg._id,
    paymentId: legacyPayment._id,
    userId,
    amount: 400,
    currency: 'INR',
    status: 'PROCESSED',
    submissionState: 'CONFIRMED',
    razorpayRefundId: `rfnd_leg_${Date.now()}`,
    attemptNumber: 1,
    idempotencyKey: `idemp_leg_${Date.now()}`,
    initiatedBy: adminId,
    initiatedByRole: 'ADMIN'
  });
  createdRefunds.push(legacyRefund._id);

  const legRes = await transitionPaymentReservation({
    paymentId: legacyPayment._id,
    refundId: legacyRefund._id,
    amount: 400,
    targetState: 'CONSUMED'
  });

  const freshLegPay = await Payment.findById(legacyPayment._id);
  check(legRes.success === false, 'B1.3 One Refund whose amount equals aggregate pending balance does NOT establish ownership');
  check(legRes.outcome === 'RESERVATION_NOT_FOUND', 'B1.3 Missing CONSUMED reservation returns RESERVATION_NOT_FOUND');
  check(freshLegPay?.pendingRefundAmount === 400, 'B1.3 Existing legacy aggregate pending hold is preserved (₹400)');
  check(freshLegPay?.refundedAmount === 0, 'B1.3 transitionPaymentReservation does NOT increment refundedAmount on missing reservation');
  check((freshLegPay?.refundReservations || []).length === 0, 'B1.3 Does NOT create synthetic reservation');
  check(freshLegPay?.reconciliationRequired === true, 'B1.3 Payment marked reconciliationRequired: true');

  // B1.4: Concurrent reservation creation with identical reservationId
  const dupResId = `res_barrier_${Date.now()}`;
  let concurrentInsertSuccess = 0;
  let concurrentInsertFailed = 0;

  const barrierPromises = [1, 2].map(async () => {
    try {
      const res = await Payment.findOneAndUpdate(
        {
          _id: legacyPayment._id,
          'refundReservations.reservationId': { $ne: dupResId }
        },
        {
          $push: {
            refundReservations: {
              reservationId: dupResId,
              refundId: new mongoose.Types.ObjectId(),
              attemptNumber: 1,
              amount: 50,
              status: 'PENDING',
              createdAt: new Date(),
              updatedAt: new Date()
            }
          }
        },
        { returnDocument: 'after' }
      );
      if (res) concurrentInsertSuccess++;
      else concurrentInsertFailed++;
    } catch {
      concurrentInsertFailed++;
    }
  });

  await Promise.all(barrierPromises);
  const verifyDupPay = await Payment.findById(legacyPayment._id);
  const matchedDupEntries = (verifyDupPay?.refundReservations || []).filter(r => r.reservationId === dupResId);
  check(matchedDupEntries.length === 1, 'B1.4 Concurrent race strictly created exactly 1 reservation document (no duplicates)');
  check(concurrentInsertSuccess === 1 && concurrentInsertFailed === 1, 'B1.4 Second concurrent attempt cleanly rejected by $ne filter');

  // B1.5: Two unmatched legacy refund documents (ambiguous legacy ownership)
  const orderAmbLeg = await createTestOrder(userId, 'AMB_LEG', 1000);
  createdOrders.push(orderAmbLeg._id);

  const paymentAmbLeg = await Payment.create({
    orderId: orderAmbLeg._id,
    userId,
    amount: 1000,
    currency: 'INR',
    status: 'CAPTURED',
    razorpayPaymentId: `pay_amb_leg_${Date.now()}`,
    pendingRefundAmount: 300,
    refundedAmount: 0,
    refundReservations: []
  });
  createdPayments.push(paymentAmbLeg._id);

  const ambRef1 = await Refund.create({
    orderId: orderAmbLeg._id,
    paymentId: paymentAmbLeg._id,
    userId,
    amount: 300,
    currency: 'INR',
    status: 'PROCESSING',
    attemptNumber: 1,
    idempotencyKey: `idemp_amb_leg1_${Date.now()}`,
    initiatedBy: adminId,
    initiatedByRole: 'ADMIN'
  });
  createdRefunds.push(ambRef1._id);

  const ambRef2 = await Refund.create({
    orderId: orderAmbLeg._id,
    paymentId: paymentAmbLeg._id,
    userId,
    amount: 300,
    currency: 'INR',
    status: 'PROCESSING',
    attemptNumber: 2,
    idempotencyKey: `idemp_amb_leg2_${Date.now()}`,
    initiatedBy: adminId,
    initiatedByRole: 'ADMIN'
  });
  createdRefunds.push(ambRef2._id);

  // Transition ambRef1 -> ambiguous ownership because ambRef2 also exists without reservation!
  const ambTransRes = await transitionPaymentReservation({
    paymentId: paymentAmbLeg._id,
    refundId: ambRef1._id,
    amount: 300,
    targetState: 'RELEASED'
  });
  const freshAmbPay = await Payment.findById(paymentAmbLeg._id);
  check(ambTransRes.pendingAdjusted === 0, 'B1.5 Ambiguous legacy ownership does NOT decrement pending hold');
  check(freshAmbPay?.pendingRefundAmount === 300, 'B1.5 pendingRefundAmount strictly preserved at ₹300 when ownership ambiguous');
  check(freshAmbPay?.reconciliationRequired === true, 'B1.5 Payment flagged reconciliationRequired when multiple legacy refunds compete');

  // B1.6: Partially populated reservation array with an older active refund
  const orderPart = await createTestOrder(userId, 'PART', 1000);
  createdOrders.push(orderPart._id);

  const paymentPart = await Payment.create({
    orderId: orderPart._id,
    userId,
    amount: 1000,
    currency: 'INR',
    status: 'CAPTURED',
    razorpayPaymentId: `pay_part_${Date.now()}`,
    pendingRefundAmount: 400,
    refundedAmount: 0,
    refundReservations: [
      {
        reservationId: 'res_part_existing',
        refundId: new mongoose.Types.ObjectId(),
        attemptNumber: 1,
        amount: 200,
        status: 'RELEASED', // partially populated array with older settled refund
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]
  });
  createdPayments.push(paymentPart._id);

  const refundPartOld = await Refund.create({
    orderId: orderPart._id,
    paymentId: paymentPart._id,
    userId,
    amount: 200,
    currency: 'INR',
    status: 'PROCESSING',
    attemptNumber: 1,
    idempotencyKey: `idemp_part_old_${Date.now()}`,
    initiatedBy: adminId,
    initiatedByRole: 'ADMIN'
  });
  createdRefunds.push(refundPartOld._id);

  const refundPartNew = await Refund.create({
    orderId: orderPart._id,
    paymentId: paymentPart._id,
    userId,
    amount: 200,
    currency: 'INR',
    status: 'PROCESSED',
    processedAt: new Date(),
    submissionState: 'CONFIRMED',
    razorpayRefundId: `rfnd_part_new_${Date.now()}`,
    attemptNumber: 2,
    idempotencyKey: `idemp_part_new_${Date.now()}`,
    initiatedBy: adminId,
    initiatedByRole: 'ADMIN'
  });
  createdRefunds.push(refundPartNew._id);

  // Both refundPartOld and refundPartNew lack reservations in partially populated array -> ambiguous!
  const partTransRes = await transitionPaymentReservation({
    paymentId: paymentPart._id,
    refundId: refundPartNew._id,
    amount: 200,
    targetState: 'CONSUMED'
  });
  check(partTransRes.success === false, 'B1.6 Reservation transition returns success: false for missing hold');
  check(partTransRes.pendingAdjusted === 0, 'B1.6 Partially populated array with competing active refunds preserves pending hold');

  // Settle unlinked provider success via applyProviderRefundSettlement with verified provider ID
  const partSettleRes = await applyProviderRefundSettlement({
    paymentId: paymentPart._id,
    refundId: refundPartNew._id,
    razorpayRefundId: refundPartNew.razorpayRefundId,
    amount: 200,
    currency: 'INR',
    unlinked: true
  });
  check(partSettleRes.success === true, 'B1.6 Unlinked provider settlement succeeded');

  const freshPartPay = await Payment.findById(paymentPart._id);
  check(freshPartPay?.pendingRefundAmount === 400, 'B1.6 pendingRefundAmount strictly preserved at ₹400');
  check(freshPartPay?.refundedAmount === 200, 'B1.6 Unlinked provider success credited exactly once (+₹200)');
  check(freshPartPay?.reconciliationRequired === true, 'B1.6 Payment marked reconciliationRequired');
  check(!freshPartPay?.refundReservations.some(r => r.refundId?.toString() === refundPartNew._id.toString()), 'B1.6 Strictly NO fake reservation in refundReservations');
  // ---------------------------------------------------------------------------
  // SECTION 2: BLOCKER B2 — REFUND UNIQUE INDEX COMPATIBILITY
  // ---------------------------------------------------------------------------
  console.log('\n--- SECTION 2: BLOCKER B2 — Refund Unique Index Compatibility ---');

  // Run migration to ensure test DB has the corrected index (excluding PROCESSED)
  await runRefundIndexMigration({ dryRun: false, connection: mongoose.connection });
  const orderB2 = await createTestOrder(userId, 'B2');
  createdOrders.push(orderB2._id);

  const paymentB2 = await Payment.create({
    orderId: orderB2._id,
    userId,
    amount: 2000,
    currency: 'INR',
    status: 'CAPTURED',
    razorpayPaymentId: `pay_b2_${Date.now()}`,
    pendingRefundAmount: 600,
    refundedAmount: 0
  });
  createdPayments.push(paymentB2._id);

  const returnReqB2 = await ReturnRequest.create({
    orderId: orderB2._id,
    userId,
    items: [
      {
        productId: new mongoose.Types.ObjectId(),
        variantId: new mongoose.Types.ObjectId(),
        quantity: 1,
        reason: 'WRONG_SIZE'
      }
    ],
    customerNote: 'Size issue',
    status: 'ACCEPTED',
    refundStatus: 'PROCESSING',
    requestedAt: new Date()
  });
  createdReturns.push(returnReqB2._id);

  // Attempt 1: FAILED
  const refAttempt1 = await Refund.create({
    orderId: orderB2._id,
    paymentId: paymentB2._id,
    returnId: returnReqB2._id,
    userId,
    amount: 300,
    currency: 'INR',
    status: 'FAILED',
    submissionState: 'CONFIRMED',
    attemptNumber: 1,
    idempotencyKey: `idemp_att1_${Date.now()}`,
    initiatedBy: adminId,
    initiatedByRole: 'ADMIN'
  });
  createdRefunds.push(refAttempt1._id);

  // Attempt 2: PROCESSING (active)
  const refAttempt2 = await Refund.create({
    orderId: orderB2._id,
    paymentId: paymentB2._id,
    returnId: returnReqB2._id,
    userId,
    amount: 300,
    currency: 'INR',
    status: 'PROCESSING',
    submissionState: 'SUBMITTED',
    attemptNumber: 2,
    idempotencyKey: `idemp_att2_${Date.now()}`,
    initiatedBy: adminId,
    initiatedByRole: 'ADMIN'
  });
  createdRefunds.push(refAttempt2._id);

  check(Boolean(refAttempt1._id) && Boolean(refAttempt2._id), 'B2.1 Two real Refund documents created sharing same returnId');

  // Razorpay later confirms Attempt 1 actually succeeded
  let lateSuccessError: unknown = null;
  try {
    refAttempt1.status = 'PROCESSED';
    refAttempt1.processedAt = new Date();
    await refAttempt1.save();
  } catch (err) {
    lateSuccessError = err;
  }

  const freshRef1 = await Refund.findById(refAttempt1._id);
  const freshRef2 = await Refund.findById(refAttempt2._id);
  check(lateSuccessError === null, 'B2.1 Late success transition on Attempt 1 succeeded without E11000 collision');
  check(freshRef1?.status === 'PROCESSED', 'B2.1 Attempt 1 accurately recorded as PROCESSED');
  check(freshRef2?.status === 'PROCESSING', 'B2.1 Attempt 2 simultaneously preserved as PROCESSING');

  // Attempt duplicate attemptNumber for same returnId
  let dupAttemptError: any = null;
  try {
    await Refund.create({
      orderId: orderB2._id,
      paymentId: paymentB2._id,
      returnId: returnReqB2._id,
      userId,
      amount: 300,
      currency: 'INR',
      status: 'FAILED',
      submissionState: 'CONFIRMED',
      attemptNumber: 2, // duplicate attemptNumber!
      idempotencyKey: `idemp_dup_att_${Date.now()}`,
      initiatedBy: adminId,
      initiatedByRole: 'ADMIN'
    });
  } catch (err: any) {
    dupAttemptError = err;
  }
  check(dupAttemptError && dupAttemptError.code === 11000, 'B2.2 Duplicate returnId + attemptNumber strictly blocked by unique index (E11000)');

  // Attempt duplicate active in-flight attempt for same returnId
  let dupActiveError: any = null;
  try {
    await Refund.create({
      orderId: orderB2._id,
      paymentId: paymentB2._id,
      returnId: returnReqB2._id,
      userId,
      amount: 300,
      currency: 'INR',
      status: 'PROCESSING', // already has refAttempt2 in PROCESSING!
      submissionState: 'SUBMITTED',
      attemptNumber: 3,
      idempotencyKey: `idemp_dup_act_${Date.now()}`,
      initiatedBy: adminId,
      initiatedByRole: 'ADMIN'
    });
  } catch (err: any) {
    dupActiveError = err;
  }
  check(dupActiveError && dupActiveError.code === 11000, 'B2.3 Second active in-flight attempt on same returnId strictly blocked by uniq_active_return_refund (E11000)');

  // ---------------------------------------------------------------------------
  // SECTION 3: BLOCKER B3 — STRICT WEBHOOK PAYLOAD CONTRACT VALIDATION
  // ---------------------------------------------------------------------------
  console.log('\n--- SECTION 3: BLOCKER B3 — Strict Webhook Payload Validation ---');

  const orderB3 = await createTestOrder(userId, 'B3');
  createdOrders.push(orderB3._id);

  const paymentB3 = await Payment.create({
    orderId: orderB3._id,
    userId,
    amount: 1500,
    currency: 'INR',
    status: 'CAPTURED',
    razorpayPaymentId: `pay_b3_${Date.now()}`,
    pendingRefundAmount: 500,
    refundedAmount: 0
  });
  createdPayments.push(paymentB3._id);

  const validRefundB3 = await Refund.create({
    orderId: orderB3._id,
    paymentId: paymentB3._id,
    userId,
    amount: 500,
    currency: 'INR',
    status: 'PROCESSING',
    submissionState: 'CONFIRMED',
    attemptNumber: 1,
    idempotencyKey: `idemp_b3_${Date.now()}`,
    initiatedBy: adminId,
    initiatedByRole: 'ADMIN'
  });
  createdRefunds.push(validRefundB3._id);

  // B3.1: Missing amount in refund.processed
  const noAmtProc = await handleRefundProcessedEntity({
    id: `rfnd_no_amt_${Date.now()}`,
    payment_id: paymentB3.razorpayPaymentId,
    currency: 'INR',
    notes: { internal_refund_id: validRefundB3._id.toString() }
  });
  check(noAmtProc.outcome === 'RECONCILIATION_REQUIRED', 'B3.1 refund.processed with missing amount rejected (RECONCILIATION_REQUIRED)');

  // B3.2: Missing currency in refund.processed
  const noCurProc = await handleRefundProcessedEntity({
    id: `rfnd_no_cur_${Date.now()}`,
    payment_id: paymentB3.razorpayPaymentId,
    amount: 50000,
    notes: { internal_refund_id: validRefundB3._id.toString() }
  });
  check(noCurProc.outcome === 'RECONCILIATION_REQUIRED', 'B3.2 refund.processed with missing currency rejected (RECONCILIATION_REQUIRED)');

  // B3.3: Missing amount in refund.failed
  const noAmtFail = await handleRefundFailedEntity({
    id: `rfnd_no_amt_f_${Date.now()}`,
    payment_id: paymentB3.razorpayPaymentId,
    currency: 'INR',
    notes: { internal_refund_id: validRefundB3._id.toString() }
  });
  check(noAmtFail.outcome === 'RECONCILIATION_REQUIRED', 'B3.3 refund.failed with missing amount rejected (RECONCILIATION_REQUIRED)');

  // B3.4: Missing currency in refund.failed
  const noCurFail = await handleRefundFailedEntity({
    id: `rfnd_no_cur_f_${Date.now()}`,
    payment_id: paymentB3.razorpayPaymentId,
    amount: 50000,
    notes: { internal_refund_id: validRefundB3._id.toString() }
  });
  check(noCurFail.outcome === 'RECONCILIATION_REQUIRED', 'B3.4 refund.failed with missing currency rejected (RECONCILIATION_REQUIRED)');

  // B3.5: Missing provider refund ID
  const noIdProc = await handleRefundProcessedEntity({
    payment_id: paymentB3.razorpayPaymentId,
    amount: 50000,
    currency: 'INR',
    notes: { internal_refund_id: validRefundB3._id.toString() }
  } as any);
  check(noIdProc.outcome === 'RECONCILIATION_REQUIRED', 'B3.5 Missing provider refund ID rejected');

  // B3.6: Missing parent payment ID
  const noPayIdProc = await handleRefundProcessedEntity({
    id: `rfnd_no_pid_${Date.now()}`,
    amount: 50000,
    currency: 'INR',
    notes: { internal_refund_id: validRefundB3._id.toString() }
  } as any);
  check(noPayIdProc.outcome === 'RECONCILIATION_REQUIRED', 'B3.6 Missing parent payment ID rejected');

  // B3.7: Unknown internal Refund ID in notes
  const unknownNotesRes = await handleRefundProcessedEntity({
    id: `rfnd_unk_${Date.now()}`,
    payment_id: paymentB3.razorpayPaymentId,
    amount: 50000,
    currency: 'INR',
    notes: { internal_refund_id: new mongoose.Types.ObjectId().toString() }
  });
  check(unknownNotesRes.outcome === 'RECONCILIATION_REQUIRED', 'B3.7 Unknown internal refund ID returned RECONCILIATION_REQUIRED');

  // B3.8: Mismatched Payment ID
  const mismatchedPayRes = await handleRefundProcessedEntity({
    id: `rfnd_mismatch_${Date.now()}`,
    payment_id: 'pay_spoofed_12345',
    amount: 50000,
    currency: 'INR',
    notes: { internal_refund_id: validRefundB3._id.toString() }
  });
  check(mismatchedPayRes.outcome === 'RECONCILIATION_REQUIRED', 'B3.8 Mismatched Payment ID returned RECONCILIATION_REQUIRED');

  // B3.9: Ambiguous multiple Refund candidates
  const orderAmb = await createTestOrder(userId, 'AMB');
  createdOrders.push(orderAmb._id);

  const ambigPay = await Payment.create({
    orderId: orderAmb._id,
    userId,
    amount: 1000,
    currency: 'INR',
    status: 'CAPTURED',
    razorpayPaymentId: `pay_amb_${Date.now()}`
  });
  createdPayments.push(ambigPay._id);

  const aRef1 = await Refund.create({
    orderId: orderAmb._id,
    paymentId: ambigPay._id,
    userId,
    amount: 150,
    currency: 'INR',
    status: 'PROCESSING',
    attemptNumber: 1,
    idempotencyKey: `idemp_amb1_${Date.now()}`,
    initiatedBy: adminId,
    initiatedByRole: 'ADMIN'
  });
  createdRefunds.push(aRef1._id);

  const aRef2 = await Refund.create({
    orderId: orderAmb._id,
    paymentId: ambigPay._id,
    userId,
    amount: 150,
    currency: 'INR',
    status: 'PROCESSING',
    attemptNumber: 2,
    idempotencyKey: `idemp_amb2_${Date.now()}`,
    initiatedBy: adminId,
    initiatedByRole: 'ADMIN'
  });
  createdRefunds.push(aRef2._id);

  let ambigThrew = false;
  try {
    await handleRefundProcessedEntity({
      id: `rfnd_amb_${Date.now()}`,
      payment_id: ambigPay.razorpayPaymentId,
      amount: 15000,
      currency: 'INR'
    });
  } catch (err: any) {
    ambigThrew = err && err.statusCode === 409;
  }
  check(ambigThrew, 'B3.9 Ambiguous candidates rejected with 409 error (never marked PROCESSED)');

  // B3.10: Incorrect provider amount
  const badAmtRes = await handleRefundProcessedEntity({
    id: `rfnd_amt_${Date.now()}`,
    payment_id: paymentB3.razorpayPaymentId,
    amount: 99999, // 99999 paise != 50000 paise
    currency: 'INR',
    notes: { internal_refund_id: validRefundB3._id.toString() }
  });
  check(badAmtRes.outcome === 'RECONCILIATION_REQUIRED', 'B3.10 Amount mismatch returned RECONCILIATION_REQUIRED');

  // B3.11: Incorrect currency
  const badCurRes = await handleRefundProcessedEntity({
    id: `rfnd_cur_${Date.now()}`,
    payment_id: paymentB3.razorpayPaymentId,
    amount: 50000,
    currency: 'USD',
    notes: { internal_refund_id: validRefundB3._id.toString() }
  });
  check(badCurRes.outcome === 'RECONCILIATION_REQUIRED', 'B3.11 Currency mismatch returned RECONCILIATION_REQUIRED');

  // B3.12: Unresolved supported event in WebhookEvent retains recoverable state without expiry
  const webhookEventId = `evt_unresolved_${Date.now()}`;
  const unresPayload = JSON.stringify({
    event: 'refund.processed',
    event_id: webhookEventId,
    payload: {
      refund: {
        entity: {
          id: `rfnd_unres_${Date.now()}`,
          payment_id: paymentB3.razorpayPaymentId,
          amount: 50000,
          currency: 'INR',
          notes: { internal_refund_id: new mongoose.Types.ObjectId().toString() } // Unknown
        }
      }
    }
  });

  const origVerify = razorpayProvider.verifyWebhookSignature;
  razorpayProvider.verifyWebhookSignature = () => true;

  const mockReq: any = {
    headers: { 'x-razorpay-signature': 'sig_test', 'x-razorpay-event-id': webhookEventId },
    body: Buffer.from(unresPayload, 'utf8')
  };
  const mockRes: any = {
    status() { return this; },
    send() { return this; }
  };

  await razorpayWebhook(mockReq, mockRes);
  razorpayProvider.verifyWebhookSignature = origVerify;

  const savedEvt = await WebhookEvent.findOne({ eventId: webhookEventId });
  check(savedEvt?.status === 'FAILED', 'B3.12 Unresolved supported event marked FAILED for recovery');
  check(savedEvt?.expiresAt === undefined, 'B3.12 Unresolved event has NO expiresAt set (never auto-purged)');
  check(Boolean(savedEvt?.payload), 'B3.12 Unresolved event preserves full payload for replay');

  const unsupp = await processSupportedWebhookEvent('invoice.paid', {});
  check(unsupp.outcome === 'IGNORED', 'B3.13 Genuinely unsupported event returns IGNORED');
  // SECTION 4: BLOCKER B4 — VERIFIED SETTLEMENT & CRASH RECOVERY
  // ---------------------------------------------------------------------------
  console.log('\n--- SECTION 4: BLOCKER B4 — Verified Settlement & Crash Recovery ---');

  const orderB4 = await createTestOrder(userId, 'B4', 1000);
  createdOrders.push(orderB4._id);

  const paymentB4 = await Payment.create({
    orderId: orderB4._id,
    userId,
    amount: 1000,
    currency: 'INR',
    status: 'CAPTURED',
    razorpayPaymentId: `pay_b4_${Date.now()}`,
    pendingRefundAmount: 400,
    refundedAmount: 0,
    refundReservations: [
      {
        reservationId: 'res_b4_crash1',
        refundId: new mongoose.Types.ObjectId(),
        attemptNumber: 1,
        amount: 400,
        status: 'PENDING',
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]
  });
  createdPayments.push(paymentB4._id);

  // B4.1: Crash AFTER provider-confirmed Refund persistence, BEFORE Payment settlement
  const refundCrash1 = await Refund.create({
    orderId: orderB4._id,
    paymentId: paymentB4._id,
    userId,
    amount: 400,
    currency: 'INR',
    status: 'PROCESSED',
    processedAt: new Date(),
    submissionState: 'CONFIRMED',
    razorpayRefundId: `rfnd_b4_crash1_${Date.now()}`,
    attemptNumber: 1,
    idempotencyKey: `idemp_crash1_${Date.now()}`,
    initiatedBy: adminId,
    initiatedByRole: 'ADMIN'
  });
  createdRefunds.push(refundCrash1._id);

  // Link reservation to refundCrash1
  await Payment.updateOne(
    { _id: paymentB4._id, 'refundReservations.reservationId': 'res_b4_crash1' },
    { $set: { 'refundReservations.$.refundId': refundCrash1._id } }
  );

  const recResult = await reconcileIncompleteRefundOperations();
  check(recResult.recoveredCount >= 1, 'B4.1 Recovery detected and processed unsettled operation');

  const recoveredRef1 = await Refund.findById(refundCrash1._id);
  const recoveredPay1 = await Payment.findById(paymentB4._id);
  check(recoveredRef1?.accountingSettlementStatus === 'COMPLETED', 'B4.1 Refund accountingSettlementStatus transitioned to COMPLETED');
  check(recoveredPay1?.refundedAmount === 400, 'B4.1 Payment refundedAmount incremented to ₹400');
  check(recoveredPay1?.pendingRefundAmount === 0, 'B4.1 Payment pendingRefundAmount decremented to 0');
  check(recoveredPay1?.refundReservations[0].status === 'CONSUMED', 'B4.1 Payment reservation transitioned to CONSUMED');

  // B4.2: Missing Payment document during recovery -> never mark COMPLETED
  const refundMissingPayment = await Refund.create({
    orderId: orderB4._id,
    paymentId: new mongoose.Types.ObjectId(), // Non-existent payment!
    userId,
    amount: 150,
    currency: 'INR',
    status: 'PROCESSED',
    submissionState: 'CONFIRMED',
    accountingSettlementStatus: 'PENDING',
    attemptNumber: 1,
    idempotencyKey: `idemp_missing_pay_${Date.now()}`,
    initiatedBy: adminId,
    initiatedByRole: 'ADMIN'
  });
  createdRefunds.push(refundMissingPayment._id);

  await reconcileIncompleteRefundOperations();
  const refAfterMissingPay = await Refund.findById(refundMissingPayment._id);
  check(refAfterMissingPay?.accountingSettlementStatus === 'RECONCILIATION_REQUIRED', 'B4.2 Missing Payment document leaves settlement in RECONCILIATION_REQUIRED (NEVER COMPLETED)');

  // B4.3: Payment with reconciliationRequired=true -> never mark COMPLETED
  const orderFlagged = await createTestOrder(userId, 'FLAGGED', 1000);
  createdOrders.push(orderFlagged._id);

  const paymentFlagged = await Payment.create({
    orderId: orderFlagged._id,
    userId,
    amount: 1000,
    currency: 'INR',
    status: 'CAPTURED',
    razorpayPaymentId: `pay_flag_${Date.now()}`,
    pendingRefundAmount: 200,
    refundedAmount: 0,
    reconciliationRequired: true, // flagged for reconciliation!
    reconciliationReason: 'Prior over-commitment conflict'
  });
  createdPayments.push(paymentFlagged._id);

  const refundOnFlaggedPay = await Refund.create({
    orderId: orderFlagged._id,
    paymentId: paymentFlagged._id,
    userId,
    amount: 200,
    currency: 'INR',
    status: 'PROCESSED',
    submissionState: 'CONFIRMED',
    accountingSettlementStatus: 'PENDING',
    attemptNumber: 1,
    idempotencyKey: `idemp_flag_${Date.now()}`,
    initiatedBy: adminId,
    initiatedByRole: 'ADMIN'
  });
  createdRefunds.push(refundOnFlaggedPay._id);

  await reconcileIncompleteRefundOperations();
  const refAfterFlaggedPay = await Refund.findById(refundOnFlaggedPay._id);
  check(refAfterFlaggedPay?.accountingSettlementStatus === 'RECONCILIATION_REQUIRED', 'B4.3 Flagged Payment leaves refund settlement in RECONCILIATION_REQUIRED (NEVER COMPLETED)');

  // ---------------------------------------------------------------------------
  // SECTION 5: RECOVERY WORKER SHUTDOWN & LIFECYCLE DRAIN
  // ---------------------------------------------------------------------------
  console.log('\n--- SECTION 5: Recovery Worker Shutdown & Lifecycle Drain ---');

  RecoveryCoordinatorService.resetShutdownStateForTesting();

  // 5.1 awaitActiveCycle on idle worker returns true immediately
  const idleDrain = await RecoveryCoordinatorService.awaitActiveCycle(100);
  check(idleDrain === true, '5.1 awaitActiveCycle on idle worker returns true immediately');

  // 5.2 Real in-flight cycle tracking and graceful shutdown drain
  let hookEntered = false;
  let releaseHookBarrier: (() => void) | null = null;
  const hookBarrierPromise = new Promise<void>((resolve) => {
    releaseHookBarrier = resolve;
  });

  RecoveryCoordinatorService.inFlightOperationHook = async () => {
    hookEntered = true;
    await hookBarrierPromise;
  };

  // Start real executeCoordinatedRecoveryCycle
  const cyclePromise = RecoveryCoordinatorService.executeCoordinatedRecoveryCycle();
  while (!hookEntered) {
    await new Promise(r => setTimeout(r, 10));
  }

  // Verify second cycle is rejected with local in-progress guard
  const secondCycle = await RecoveryCoordinatorService.executeCoordinatedRecoveryCycle();
  check(secondCycle.skippedReason === 'CYCLE_ALREADY_IN_PROGRESS_LOCAL', '5.2 Second recovery cycle strictly blocked while cycle in progress');

  // Verify short drain timeout reports unsuccessful drain without releasing active lease
  const timedOutDrain = await RecoveryCoordinatorService.drainAndShutdown({ drainTimeoutMs: 20 });
  check(timedOutDrain.drained === false, '5.3 Drain timeout reports unsuccessful drain when work remains in flight');

  // Verify lease is STILL held while cycle is running
  const activeLock = await WorkerLock.findOne({ lockName: 'RECOVERY_COORDINATOR_LEADER' });
  check(activeLock?.ownerId === RecoveryCoordinatorService.getOwnerId(), '5.4 Distributed lease strictly preserved during active work');

  // Release barrier and await completion
  releaseHookBarrier!();
  const cycleResult = await cyclePromise;
  check(cycleResult.executed === true, '5.5 In-flight cycle finished execution cleanly after barrier release');

  // Clean drain after cycle settles
  RecoveryCoordinatorService.resetShutdownStateForTesting();
  const cleanDrain = await RecoveryCoordinatorService.drainAndShutdown({ drainTimeoutMs: 5000 });
  check(cleanDrain.drained === true, '5.6 Clean drain succeeds after in-flight cycle settles');
  // ---------------------------------------------------------------------------
  // SECTION 6: TEST ENVIRONMENT ISOLATION & FAIL CLOSED
  // ---------------------------------------------------------------------------
  console.log('\n--- SECTION 6: Test Environment Fail Closed ---');

  check(process.env.NODE_ENV === 'test', '6.1 NODE_ENV is strictly test');
  check(process.env.RAZORPAY_KEY_ID === 'rzp_test_mock', '6.2 RAZORPAY_KEY_ID is dummy test credential');
  const currentKey: string = String(process.env.RAZORPAY_KEY_ID || '');
  check(!currentKey.startsWith('rzp_live'), '6.3 Live Razorpay credentials are NOT present in process.env');
  let transportBlocked = false;
  try {
    const rawClient = razorpayProvider.getClient();
    await (rawClient as any).payments.refund('pay_fake_test', { amount: 100 });
  } catch (err: any) {
    transportBlocked = err.message.includes('[TEST HARNESS FAIL CLOSED]');
  }
  check(transportBlocked === true, '6.4 Real Razorpay HTTP transport is strictly blocked and fails closed in tests');

  // ---------------------------------------------------------------------------
  // CLEANUP & SUMMARY
  // ---------------------------------------------------------------------------
  console.log('\n🧹 Cleaning up test fixtures from database...');
  await Order.deleteMany({ _id: { $in: createdOrders } });
  await Payment.deleteMany({ _id: { $in: createdPayments } });
  await Refund.deleteMany({ _id: { $in: createdRefunds } });
  await ReturnRequest.deleteMany({ _id: { $in: createdReturns } });
  await WebhookEvent.deleteMany({ eventId: webhookEventId });
  await WorkerLock.deleteMany({ lockName: 'RECOVERY_COORDINATOR_LEADER' });
  await mongoose.disconnect();
  console.log('✅ Disconnected from MongoDB');

  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════════════════════════\n');

  if (failed > 0) {
    console.error('Failed checks:', failures);
    process.exit(1);
  }
}

runBlockersSuite().catch((err) => {
  console.error('Suite error:', err);
  process.exit(1);
});
