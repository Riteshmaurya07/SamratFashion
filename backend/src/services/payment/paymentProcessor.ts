import mongoose from 'mongoose';
import { Order } from '../../models/Order';
import { Payment } from '../../models/Payment';
import { PaymentAttempt } from '../../models/PaymentAttempt';
import { Refund } from '../../models/Refund';
import { DuplicateCaptureRefund } from '../../models/DuplicateCaptureRefund';
import { createInternalRefund, registerPostCommitHook } from './refundService';
import { razorpayProvider } from './RazorpayProvider';
import { InventoryAllocationService } from '../inventory/inventoryAllocationService';
import { confirmCouponReservation, releaseCouponReservation } from '../coupon/couponReservationService';
import '../../models/User';
import '../../models/Coupon';
import '../../models/CouponUsage';
import '../../models/Cart';
const CLAIM_STALE_MS = 10_000;
const TERMINAL_POLL_MS = 250;
const TERMINAL_POLL_MAX = 24;

// A capture may supersede an earlier failure on the same Razorpay order, but it
// must never re-claim an attempt whose money was already returned by the
// duplicate-capture refund flow.
const DUPLICATE_CAPTURE_FAILURE_CODES = new Set([
  'DUPLICATE_CAPTURE_REFUNDED',
  'DUPLICATE_CAPTURE_REFUND_PENDING',
  'DUPLICATE_CAPTURE_REFUND_UNKNOWN',
  'DUPLICATE_CAPTURE_RECONCILIATION_REQUIRED',
  'PAYMENT_RECONCILIATION_REQUIRED',
]);

/**
 * Issues the tax invoice once an order is paid. Runs after the payment
 * transaction commits so the invoice snapshot is built from persisted state.
 * Failures are logged and never fail the payment itself; the lazy invoice
 * endpoint and the admin register backfill will retry later.
 */
const scheduleInvoiceIssuance = (
  orderId: mongoose.Types.ObjectId,
  session?: mongoose.ClientSession
): void => {
  const task = async () => {
    try {
      // Dynamic require keeps the payment processor free of a startup cycle.
      const { getOrCreateInvoiceForOrder } = require('../../controllers/invoiceController');
      await getOrCreateInvoiceForOrder(orderId.toString());
    } catch (err) {
      console.error(`[PAYMENT PROCESSOR] Failed to issue invoice for order ${orderId}:`, err);
    }
  };

  if (session && session.inTransaction()) {
    registerPostCommitHook(session, task);
  } else {
    Promise.resolve().then(task).catch(() => {});
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const DUPLICATE_REFUND_CLAIM_MS = 60_000;

async function flagPaymentForDuplicateCapture(
  paymentId: mongoose.Types.ObjectId,
  reason: string,
  session?: mongoose.ClientSession
): Promise<void> {
  const withReason = await Payment.updateOne(
    { _id: paymentId, reconciliationRequired: { $ne: true } },
    { $set: { reconciliationRequired: true, reconciliationReason: reason } },
    { session }
  );
  if (withReason.matchedCount === 1) return;

  const alreadyFlagged = await Payment.updateOne(
    { _id: paymentId, reconciliationRequired: true },
    { $set: { reconciliationRequired: true } },
    { session }
  );
  if (alreadyFlagged.matchedCount !== 1) {
    throw new Error(`Payment ${paymentId} disappeared while flagging duplicate capture reconciliation`);
  }
  await Payment.updateOne(
    {
      _id: paymentId,
      reconciliationRequired: true,
      $or: [
        { reconciliationReason: { $exists: false } },
        { reconciliationReason: null },
        { reconciliationReason: '' },
      ],
    },
    { $set: { reconciliationReason: reason } },
    { session }
  );
}

interface PendingResult {
  order: any;
  attempt: any;
  success: boolean;
  reason?: string;
}

const buildTerminalResult = async (orderId: mongoose.Types.ObjectId, attempt: any): Promise<PendingResult | null> => {
  const order = await Order.findById(orderId);
  if (!order) return null;

  if (order.paymentStatus === 'PAID' && order.status !== 'CANCELLED') {
    scheduleInvoiceIssuance(order._id);
    return { order, attempt, success: true };
  }
  if (order.status === 'CANCELLED' || order.status === 'EXPIRED') {
    return { order, attempt, success: false, reason: 'ORDER_CANCELLED' };
  }
  return { order, attempt, success: false, reason: 'PROCESSING_IN_PROGRESS' };
};

async function refundDuplicateCapture(
  paymentAttemptId: mongoose.Types.ObjectId,
  orderId: mongoose.Types.ObjectId,
  capturePaymentId: string
): Promise<{ success: boolean; reason?: string }> {
  const attempt = await PaymentAttempt.findById(paymentAttemptId);
  if (!attempt) throw new Error(`Payment attempt ${paymentAttemptId} disappeared before duplicate capture refund`);
  const payment = await Payment.findById(attempt.paymentId);
  if (!payment) throw new Error(`Payment ${attempt.paymentId} is missing for duplicate capture refund`);
  const primaryCaptureId = attempt.razorpayPaymentId;
  const updateAttemptForDuplicate = async (fields: Record<string, unknown>) => {
    const filter: Record<string, any> = { _id: attempt._id };
    if (primaryCaptureId) {
      filter.razorpayPaymentId = primaryCaptureId;
    } else {
      filter.$or = [
        { razorpayPaymentId: { $exists: false } },
        { razorpayPaymentId: null },
      ];
    }
    return PaymentAttempt.updateOne(
      filter,
      {
        $set: {
          ...fields,
          ...(!primaryCaptureId ? { razorpayPaymentId: capturePaymentId } : {}),
        },
      }
    );
  };

  const refundRecord = await DuplicateCaptureRefund.findOneAndUpdate(
    { paymentAttemptId: attempt._id },
    {
      $setOnInsert: {
        orderId,
        paymentId: payment._id,
        paymentAttemptId: attempt._id,
        capturePaymentId,
        amount: attempt.amount,
        currency: attempt.currency,
        status: 'PENDING',
      },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );
  if (
    refundRecord.capturePaymentId !== capturePaymentId ||
    refundRecord.amount !== attempt.amount ||
    refundRecord.paymentId.toString() !== payment._id.toString()
  ) {
    await flagPaymentForDuplicateCapture(
      payment._id,
      `Duplicate capture ledger conflicts with payment attempt ${attempt._id}; manual review required`
    );
    throw new Error(`Duplicate capture ledger identity conflict for payment attempt ${attempt._id}`);
  }

  await flagPaymentForDuplicateCapture(
    payment._id,
    `Duplicate payment capture ${capturePaymentId} for attempt ${attempt._id} is tracked separately; verify refund settlement`
  );

  if (refundRecord.status === 'PROCESSED') {
    await updateAttemptForDuplicate({
      status: 'FAILED',
      failureCode: 'DUPLICATE_CAPTURE_REFUNDED',
      failureReason: `Duplicate capture refunded as ${refundRecord.razorpayRefundId}`,
    });
    return { success: true };
  }
  if (refundRecord.status === 'FAILED') {
    return { success: false, reason: 'DUPLICATE_CAPTURE_REFUND_FAILED' };
  }

  const claimToken = new mongoose.Types.ObjectId().toString();
  const claimedRefund = await DuplicateCaptureRefund.findOneAndUpdate(
    {
      _id: refundRecord._id,
      $or: [
        { status: { $in: ['PENDING', 'UNKNOWN'] } },
          {
            status: 'PROCESSING',
            $or: [
              { claimExpiresAt: { $lte: new Date() } },
              { claimExpiresAt: { $exists: false } },
            ],
          },
      ],
    },
    {
      $set: {
        status: 'PROCESSING',
        claimToken,
        claimExpiresAt: new Date(Date.now() + DUPLICATE_REFUND_CLAIM_MS),
      },
    },
    { returnDocument: 'after' }
  );
  if (!claimedRefund) {
    return { success: false, reason: 'DUPLICATE_CAPTURE_REFUND_IN_PROGRESS' };
  }

  try {
    const refund = await razorpayProvider.createRefund(
      capturePaymentId,
      Math.round(attempt.amount * 100),
      {
        reason: 'duplicate_payment_capture',
        order_id: orderId.toString(),
        duplicate_capture_refund_id: refundRecord._id.toString(),
      },
      `duplicate_${attempt._id.toString()}`
    );
    const processed = refund.status === 'processed';
    const settledRefund = await DuplicateCaptureRefund.findOneAndUpdate(
      { _id: refundRecord._id, status: 'PROCESSING', claimToken },
      {
        $set: {
          status: processed ? 'PROCESSED' : 'PENDING',
          razorpayRefundId: refund.id,
          ...(processed
            ? { processedAt: new Date() }
            : { failureReason: `Razorpay refund is ${refund.status}` }),
        },
        $unset: {
          claimToken: 1,
          claimExpiresAt: 1,
          ...(processed ? { failureReason: 1 } : { processedAt: 1 }),
        },
      },
      { returnDocument: 'after' }
    );
    if (!settledRefund) {
      const currentRefund = await DuplicateCaptureRefund.findById(refundRecord._id);
      if (currentRefund?.status !== 'PROCESSED' || currentRefund.razorpayRefundId !== refund.id) {
        return { success: false, reason: 'DUPLICATE_CAPTURE_REFUND_IN_PROGRESS' };
      }
    }
    await updateAttemptForDuplicate({
      status: processed ? 'FAILED' : 'PROCESSING',
      failureCode: processed
        ? 'DUPLICATE_CAPTURE_REFUNDED'
        : 'DUPLICATE_CAPTURE_REFUND_PENDING',
      failureReason: processed
        ? `Duplicate capture refunded as ${refund.id}`
        : `Duplicate capture refund is ${refund.status}`,
    });
    return {
      success: processed,
      reason: processed ? undefined : 'DUPLICATE_CAPTURE_REFUND_PENDING',
    };
  } catch (error) {
    const failureReason = error instanceof Error ? error.message : String(error);
    const unknownRefund = await DuplicateCaptureRefund.findOneAndUpdate(
      { _id: refundRecord._id, status: 'PROCESSING', claimToken },
      {
        $set: { status: 'UNKNOWN', failureReason },
        $unset: { claimToken: 1, claimExpiresAt: 1 },
      },
      { returnDocument: 'after' }
    );
    if (!unknownRefund) {
      const currentRefund = await DuplicateCaptureRefund.findById(refundRecord._id);
      if (currentRefund?.status === 'PROCESSED') return { success: true };
      return { success: false, reason: 'DUPLICATE_CAPTURE_REFUND_IN_PROGRESS' };
    }
    await updateAttemptForDuplicate({
      status: 'PROCESSING',
      failureCode: 'DUPLICATE_CAPTURE_REFUND_UNKNOWN',
      failureReason,
    });
    console.error(`[PAYMENT PROCESSOR] Duplicate capture refund outcome is unknown for attempt ${attempt._id}:`, error);
    return { success: false, reason: 'DUPLICATE_CAPTURE_REFUND_UNKNOWN' };
  }
}

/**
 * Invariant: a captured gateway payment always has a Payment record that carries
 * the capture id. Missing records are created (same _id as the attempt's
 * paymentId so everything stays linked) instead of silently losing the money.
 * `reconciliationReason` marks captures that could not be applied to the order
 * so finance can find and refund them.
 */
async function recordCapturedPayment(
  attempt: { paymentId?: mongoose.Types.ObjectId | null },
  order: {
    _id: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    total: number;
    currency?: string;
  },
  razorpayPaymentId: string,
  options: { session?: mongoose.ClientSession; reconciliationReason?: string } = {}
): Promise<void> {
  if (!razorpayPaymentId) return;
  const session = options.session || undefined;
  const paymentId = attempt.paymentId || new mongoose.Types.ObjectId();
  const existing = await Payment.findById(paymentId).session(options.session || null);

  if (!existing) {
    try {
      await Payment.create(
        [
          {
            _id: paymentId,
            orderId: order._id,
            userId: order.userId,
            amount: order.total,
            currency: order.currency || 'INR',
            status: 'CAPTURED',
            provider: 'RAZORPAY',
            razorpayPaymentId,
            ...(options.reconciliationReason
              ? { reconciliationRequired: true, reconciliationReason: options.reconciliationReason }
              : {}),
          },
        ],
        { session }
      );
      console.warn(
        `[PAYMENT PROCESSOR] Created missing Payment record ${paymentId} for captured payment ${razorpayPaymentId}`
      );
      return;
    } catch (createErr: unknown) {
      // Concurrent processor created it first: fall through to the update path.
      const code = (createErr as { code?: unknown })?.code;
      if (code !== 11000) throw createErr;
    }
  }

  const update: Record<string, unknown> = {
    status: 'CAPTURED',
    razorpayPaymentId,
  };
  if (options.reconciliationReason) {
    update.reconciliationRequired = true;
    update.reconciliationReason = options.reconciliationReason;
  }
  await Payment.updateOne({ _id: paymentId }, { $set: update }, { session });
}

export interface ProcessPaymentSuccessResult {
  order: any;
  attempt: any;
  success: boolean;
  reason?: string;
  refund?: any;
}

export const processPaymentSuccess = async (
  razorpayOrderId: string,
  razorpayPaymentId?: string,
  options: { session?: mongoose.ClientSession } = {}
): Promise<ProcessPaymentSuccessResult | null> => {
  const session = options.session;
  const attempt = await PaymentAttempt.findOne({ razorpayOrderId }).session(session || null);
  if (!attempt) {
    console.warn(`[PAYMENT PROCESSOR] PaymentAttempt not found for razorpayOrderId: ${razorpayOrderId}`);
    return null;
  }

  const order = await Order.findById(attempt.orderId).session(session || null);
  if (!order) {
    console.warn(`[PAYMENT PROCESSOR] Order not found for id: ${attempt.orderId}`);
    return null;
  }

  const toPaise = (amount: unknown): number | null => {
    if (typeof amount !== 'number' || !Number.isFinite(amount)) return null;
    const paise = Math.round(amount * 100);
    return Number.isSafeInteger(paise) && Math.abs(amount * 100 - paise) < 1e-6 ? paise : null;
  };
  const orderAmountPaise = toPaise(order.total);
  const attemptAmountPaise = toPaise(attempt.amount);
  const orderCurrency = typeof order.currency === 'string' ? order.currency.trim().toUpperCase() : '';
  const attemptCurrency = typeof attempt.currency === 'string' ? attempt.currency.trim().toUpperCase() : '';
  const existingPayment = await Payment.findById(attempt.paymentId).session(session || null);
  const paymentForOrder = existingPayment
    ? null
    : await Payment.findOne({ orderId: order._id }).session(session || null);
  if (
    attempt.orderId.toString() !== order._id.toString() ||
    orderAmountPaise === null ||
    attemptAmountPaise === null ||
    orderAmountPaise <= 0 ||
    attemptAmountPaise !== orderAmountPaise ||
    !/^[A-Z]{3}$/.test(orderCurrency) ||
    attemptCurrency !== orderCurrency ||
    paymentForOrder ||
    (existingPayment && (
      existingPayment._id.toString() !== attempt.paymentId.toString() ||
      !existingPayment.orderId ||
      existingPayment.orderId.toString() !== order._id.toString() ||
      !existingPayment.userId ||
      existingPayment.userId.toString() !== order.userId.toString() ||
      existingPayment.provider !== 'RAZORPAY' ||
      toPaise(existingPayment.amount) !== orderAmountPaise ||
      typeof existingPayment.currency !== 'string' ||
      existingPayment.currency.trim().toUpperCase() !== orderCurrency
    ))
  ) {
    return { order, attempt, success: false, reason: 'PAYMENT_RECONCILIATION_REQUIRED' };
  }

  const previouslyRecordedPaymentId = attempt.razorpayPaymentId;
  const hasCaptureRefundConflict = async (): Promise<boolean> => {
    const paymentRefundConflict = Boolean(
      existingPayment &&
      (
        existingPayment.status === 'REFUNDED' ||
        (existingPayment.refundedAmount || 0) > 0 ||
        (existingPayment.pendingRefundAmount || 0) > 0 ||
        Boolean(existingPayment.settledRefunds?.length) ||
        Boolean(existingPayment.refundReservations?.some((reservation: any) =>
          reservation.status === 'PENDING' || reservation.status === 'CONSUMED'
        ))
      )
    );
    if (paymentRefundConflict) return true;
    return Boolean(await Refund.exists({
      $or: [
        { orderId: order._id },
        { paymentId: attempt.paymentId },
      ],
      status: { $in: ['PENDING', 'PROCESSING', 'UNKNOWN', 'PROCESSED'] },
    }).session(session || null));
  };
  if (razorpayPaymentId && await hasCaptureRefundConflict()) {
    const reason =
      `Capture ${razorpayPaymentId} for order ${order.orderNumber} conflicts with an existing refund; ` +
      'preserving payment state for reconciliation';
    const attemptFilter: Record<string, any> = { _id: attempt._id };
    const attemptUpdate: Record<string, any> = {
      failureCode: 'PAYMENT_RECONCILIATION_REQUIRED',
      failureReason: reason,
    };
    if (previouslyRecordedPaymentId) {
      attemptFilter.razorpayPaymentId = previouslyRecordedPaymentId;
    } else {
      attemptFilter.$or = [
        { razorpayPaymentId: { $exists: false } },
        { razorpayPaymentId: null },
      ];
      attemptUpdate.razorpayPaymentId = razorpayPaymentId;
    }
    if (attempt.status !== 'CAPTURED') attemptUpdate.status = 'PROCESSING';
    const reconciledAttempt = await PaymentAttempt.findOneAndUpdate(
      attemptFilter,
      { $set: attemptUpdate },
      { session: session || undefined, returnDocument: 'after' }
    );
    if (existingPayment) {
      await flagPaymentForDuplicateCapture(existingPayment._id, reason, session);
    }
    return {
      order,
      attempt: reconciledAttempt || await PaymentAttempt.findById(attempt._id).session(session || null) || attempt,
      success: false,
      reason: 'PAYMENT_RECONCILIATION_REQUIRED',
    };
  }
  if (attempt.failureCode === 'PAYMENT_RECONCILIATION_REQUIRED') {
    return {
      order,
      attempt,
      success: false,
      reason: 'PAYMENT_RECONCILIATION_REQUIRED',
    };
  }

  const repairAppliedCapture = async (
    capturedAttempt: any,
    capturedOrder: any,
    captureId: string
  ) => {
    capturedAttempt.status = 'CAPTURED';
    capturedAttempt.razorpayPaymentId = captureId;
    capturedAttempt.failureCode = undefined;
    capturedAttempt.failureReason = undefined;
    await capturedAttempt.save({ session: session || undefined });
    await recordCapturedPayment(capturedAttempt, capturedOrder, captureId, { session });
    scheduleInvoiceIssuance(capturedOrder._id, session);
    return { order: capturedOrder, attempt: capturedAttempt, success: true };
  };
  const canRecoverProcessingCapture = async (
    candidateAttempt: any,
    candidateOrder: any,
    candidatePayment: any,
    captureId: string
  ): Promise<boolean> => {
    if (
      candidateAttempt.status !== 'PROCESSING' ||
      candidateAttempt.razorpayPaymentId ||
      !captureId ||
      DUPLICATE_CAPTURE_FAILURE_CODES.has(candidateAttempt.failureCode || '') ||
      (candidatePayment?.razorpayPaymentId && candidatePayment.razorpayPaymentId !== captureId)
    ) {
      return false;
    }
    const anotherCapturedAttempt = await PaymentAttempt.exists({
      orderId: candidateOrder._id,
      _id: { $ne: candidateAttempt._id },
      status: 'CAPTURED',
    }).session(session || null);
    return !anotherCapturedAttempt;
  };
  const queueDuplicateCaptureRefund = async (
    duplicateAttempt: any,
    duplicateOrder: any,
    captureId: string
  ) => {
    if (session?.inTransaction()) {
      duplicateAttempt.status = 'PROCESSING';
      if (!duplicateAttempt.razorpayPaymentId) duplicateAttempt.razorpayPaymentId = captureId;
      duplicateAttempt.failureCode = 'DUPLICATE_CAPTURE_REFUND_PENDING';
      duplicateAttempt.failureReason = 'Duplicate capture refund queued until payment transaction commits';
      await duplicateAttempt.save({ session });
      registerPostCommitHook(session, async () => {
        await refundDuplicateCapture(duplicateAttempt._id, duplicateOrder._id, captureId);
      });
      return {
        order: duplicateOrder,
        attempt: duplicateAttempt,
        success: false,
        reason: 'DUPLICATE_CAPTURE_REFUND_PENDING',
      };
    }
    const refundResult = await refundDuplicateCapture(duplicateAttempt._id, duplicateOrder._id, captureId);
    const updatedAttempt = await PaymentAttempt.findById(duplicateAttempt._id);
    return { order: duplicateOrder, attempt: updatedAttempt || duplicateAttempt, ...refundResult };
  };
  const handleConcurrentPaidCapture = async (paidAttempt: any, paidOrder: any) => {
    if (!razorpayPaymentId) return { order: paidOrder, attempt: paidAttempt, success: true };
    if (!paidAttempt) {
      return { order: paidOrder, attempt: attempt, success: false, reason: 'PROCESSING_IN_PROGRESS' };
    }

    const storedPaymentId = paidAttempt.razorpayPaymentId;
    if (paidAttempt.failureCode === 'DUPLICATE_CAPTURE_REFUNDED') {
      return storedPaymentId === razorpayPaymentId
        ? { order: paidOrder, attempt: paidAttempt, success: true }
        : { order: paidOrder, attempt: paidAttempt, success: false, reason: 'DUPLICATE_CAPTURE_RECONCILIATION_REQUIRED' };
    }
    if (paidAttempt.failureCode === 'DUPLICATE_CAPTURE_RECONCILIATION_REQUIRED') {
      return { order: paidOrder, attempt: paidAttempt, success: false, reason: 'DUPLICATE_CAPTURE_RECONCILIATION_REQUIRED' };
    }

    const payment = await Payment.findById(paidAttempt.paymentId).session(session || null);
    if (
      paidAttempt.failureCode === 'DUPLICATE_CAPTURE_REFUND_PENDING' ||
      paidAttempt.failureCode === 'DUPLICATE_CAPTURE_REFUND_UNKNOWN'
    ) {
      return storedPaymentId === razorpayPaymentId
        ? queueDuplicateCaptureRefund(paidAttempt, paidOrder, razorpayPaymentId)
        : { order: paidOrder, attempt: paidAttempt, success: false, reason: 'DUPLICATE_CAPTURE_RECONCILIATION_REQUIRED' };
    }

    const conflictingCapturedPayment =
      payment?.status === 'CAPTURED' &&
      Boolean(payment.razorpayPaymentId) &&
      payment.razorpayPaymentId !== razorpayPaymentId;
    const sameAttemptCapture = storedPaymentId === razorpayPaymentId;
    const samePaymentCapture = payment?.razorpayPaymentId === razorpayPaymentId;
    const recoverablePartialCommit = await canRecoverProcessingCapture(
      paidAttempt,
      paidOrder,
      payment,
      razorpayPaymentId
    );
    if (
      !conflictingCapturedPayment &&
      (sameAttemptCapture || samePaymentCapture || recoverablePartialCommit)
    ) {
      return repairAppliedCapture(paidAttempt, paidOrder, razorpayPaymentId);
    }
    if (!payment) {
      return { order: paidOrder, attempt: paidAttempt, success: false, reason: 'DUPLICATE_CAPTURE_RECONCILIATION_REQUIRED' };
    }
    return queueDuplicateCaptureRefund(paidAttempt, paidOrder, razorpayPaymentId);
  };

  if (order.status === 'CANCELLED' || order.status === 'EXPIRED') {
    // A verified capture on a closed order must remain closed and be visible
    // for refund reconciliation, even when its payment status was already PAID.
    if (razorpayPaymentId) {
      const payment = existingPayment;
      if (previouslyRecordedPaymentId && previouslyRecordedPaymentId !== razorpayPaymentId) {
        const conflictReason =
          `Distinct capture ${razorpayPaymentId} for closed order ${order.orderNumber}; ` +
          `preserving attempt's primary capture ${previouslyRecordedPaymentId} for reconciliation`;
        const paymentHasOtherCapturedId = Boolean(
          payment?.status === 'CAPTURED' &&
          payment.razorpayPaymentId &&
          payment.razorpayPaymentId !== previouslyRecordedPaymentId
        );
        if (paymentHasOtherCapturedId) {
          await flagPaymentForDuplicateCapture(payment!._id, conflictReason, session);
          attempt.status = 'PROCESSING';
          attempt.failureCode = 'DUPLICATE_CAPTURE_RECONCILIATION_REQUIRED';
          attempt.failureReason = conflictReason;
          await attempt.save({ session: session || undefined });
          return { order, attempt, success: false, reason: 'PAYMENT_RECONCILIATION_REQUIRED' };
        }

        await recordCapturedPayment(attempt, order, previouslyRecordedPaymentId, {
          session,
          reconciliationReason:
            `Primary capture ${previouslyRecordedPaymentId} belongs to closed order ${order.orderNumber}; refund required`,
        });
        const primaryPayment = await Payment.findById(attempt.paymentId).session(session || null);
        const refundLinkIsSafe = Boolean(
          primaryPayment &&
          primaryPayment.orderId.toString() === order._id.toString() &&
          primaryPayment.provider === 'RAZORPAY' &&
          primaryPayment.status === 'CAPTURED' &&
          primaryPayment.razorpayPaymentId === previouslyRecordedPaymentId &&
          primaryPayment.amount === attempt.amount &&
          attempt.amount === order.total &&
          primaryPayment.currency === attempt.currency &&
          attempt.currency === (order.currency || 'INR')
        );
        const existingDuplicateRefund = await DuplicateCaptureRefund.findOne({
          paymentAttemptId: attempt._id,
        }).session(session || null);
        const ledgerMatchesCapture =
          !existingDuplicateRefund ||
          (existingDuplicateRefund.capturePaymentId === razorpayPaymentId &&
            existingDuplicateRefund.amount === attempt.amount &&
            existingDuplicateRefund.paymentId.toString() === primaryPayment?._id.toString());

        if (refundLinkIsSafe && ledgerMatchesCapture) {
          if (session?.inTransaction()) {
            attempt.status = 'PROCESSING';
            attempt.failureCode = 'DUPLICATE_CAPTURE_REFUND_PENDING';
            attempt.failureReason = 'Duplicate capture refund queued until payment transaction commits';
            await attempt.save({ session });
            registerPostCommitHook(session, async () => {
              await refundDuplicateCapture(attempt._id, order._id, razorpayPaymentId);
            });
          } else {
            await refundDuplicateCapture(attempt._id, order._id, razorpayPaymentId);
          }
          return { order, attempt, success: false, reason: 'ORDER_CANCELLED' };
        }

        if (primaryPayment) await flagPaymentForDuplicateCapture(primaryPayment._id, conflictReason, session);
        attempt.status = 'PROCESSING';
        attempt.failureCode = 'DUPLICATE_CAPTURE_RECONCILIATION_REQUIRED';
        attempt.failureReason = conflictReason;
        await attempt.save({ session: session || undefined });
        return { order, attempt, success: false, reason: 'PAYMENT_RECONCILIATION_REQUIRED' };
      }

      if (payment?.razorpayPaymentId && payment.razorpayPaymentId !== razorpayPaymentId) {
        const conflictReason =
          `Distinct capture ${razorpayPaymentId} for closed order ${order.orderNumber}; ` +
          `preserving recorded capture ${payment.razorpayPaymentId} for reconciliation`;
        const paymentBelongsToOrder = payment.orderId.toString() === order._id.toString();
        const refundLinkIsSafe =
          paymentBelongsToOrder &&
          payment.provider === 'RAZORPAY' &&
          payment.status === 'CAPTURED' &&
          payment.amount === attempt.amount &&
          attempt.amount === order.total &&
          payment.currency === attempt.currency &&
          attempt.currency === (order.currency || 'INR');
        const existingDuplicateRefund = await DuplicateCaptureRefund.findOne({
          paymentAttemptId: attempt._id,
        }).session(session || null);
        const ledgerMatchesCapture =
          !existingDuplicateRefund ||
          (existingDuplicateRefund.capturePaymentId === razorpayPaymentId &&
            existingDuplicateRefund.amount === attempt.amount &&
            existingDuplicateRefund.paymentId.toString() === payment._id.toString());

        if (refundLinkIsSafe && ledgerMatchesCapture) {
          if (session?.inTransaction()) {
            attempt.status = 'PROCESSING';
            attempt.razorpayPaymentId = razorpayPaymentId;
            attempt.failureCode = 'DUPLICATE_CAPTURE_REFUND_PENDING';
            attempt.failureReason = 'Duplicate capture refund queued until payment transaction commits';
            await attempt.save({ session });
            registerPostCommitHook(session, async () => {
              await refundDuplicateCapture(attempt._id, order._id, razorpayPaymentId);
            });
          } else {
            await refundDuplicateCapture(attempt._id, order._id, razorpayPaymentId);
          }
          return { order, attempt, success: false, reason: 'ORDER_CANCELLED' };
        }

        if (paymentBelongsToOrder) {
          await flagPaymentForDuplicateCapture(payment._id, conflictReason);
        }
        attempt.status = 'PROCESSING';
        attempt.razorpayPaymentId = razorpayPaymentId;
        attempt.failureCode = 'DUPLICATE_CAPTURE_RECONCILIATION_REQUIRED';
        attempt.failureReason = conflictReason;
        await attempt.save({ session: session || undefined });
        return { order, attempt, success: false, reason: 'ORDER_CANCELLED' };
      }

      attempt.status = 'CAPTURED';
      attempt.razorpayPaymentId = razorpayPaymentId;
      attempt.failureCode = undefined;
      attempt.failureReason = undefined;
      await attempt.save({ session: session || undefined });
      await recordCapturedPayment(attempt, order, razorpayPaymentId, {
        session,
        reconciliationReason: `Captured payment ${razorpayPaymentId} for ${order.status.toLowerCase()} order ${order.orderNumber}; refund required`,
      });
    }
    return { order, attempt, success: false, reason: 'ORDER_CANCELLED' };
  }

  // Idempotent execution of the same capture must not deduct inventory twice.
  if (order.paymentStatus === 'PAID') {
    const captureId = razorpayPaymentId || previouslyRecordedPaymentId;
    if (attempt.failureCode === 'DUPLICATE_CAPTURE_REFUNDED') {
      if (captureId && previouslyRecordedPaymentId !== captureId) {
        return { order, attempt, success: false, reason: 'DUPLICATE_CAPTURE_RECONCILIATION_REQUIRED' };
      }
      attempt.status = 'FAILED';
      await attempt.save({ session: session || undefined });
      scheduleInvoiceIssuance(order._id, session);
      return { order, attempt, success: true };
    }
    if (attempt.failureCode === 'DUPLICATE_CAPTURE_RECONCILIATION_REQUIRED') {
      return { order, attempt, success: false, reason: 'DUPLICATE_CAPTURE_RECONCILIATION_REQUIRED' };
    }
    if (
      attempt.failureCode === 'DUPLICATE_CAPTURE_REFUND_PENDING' ||
      attempt.failureCode === 'DUPLICATE_CAPTURE_REFUND_UNKNOWN'
    ) {
      if (!captureId || (previouslyRecordedPaymentId && previouslyRecordedPaymentId !== captureId)) {
        return { order, attempt, success: false, reason: 'DUPLICATE_CAPTURE_RECONCILIATION_REQUIRED' };
      }
      return queueDuplicateCaptureRefund(attempt, order, captureId);
    }

    const payment = existingPayment;
    const sameAttemptCapture =
      Boolean(razorpayPaymentId) && previouslyRecordedPaymentId === razorpayPaymentId;
    const samePaymentCapture = Boolean(captureId && payment?.razorpayPaymentId === captureId);
    const conflictingCapturedPayment =
      Boolean(
        captureId &&
        payment?.status === 'CAPTURED' &&
        payment.razorpayPaymentId &&
        payment.razorpayPaymentId !== captureId
      );
    const recoverablePartialCommit = captureId
      ? await canRecoverProcessingCapture(attempt, order, payment, captureId)
      : false;
    if (
      !conflictingCapturedPayment &&
      (sameAttemptCapture || samePaymentCapture || recoverablePartialCommit)
    ) {
      return repairAppliedCapture(attempt, order, captureId!);
    }

    if (!captureId) {
      return { order, attempt, success: false, reason: 'DUPLICATE_CAPTURE_PAYMENT_ID_MISSING' };
    }

    return queueDuplicateCaptureRefund(attempt, order, captureId);
  }

  if (razorpayPaymentId && previouslyRecordedPaymentId && previouslyRecordedPaymentId !== razorpayPaymentId) {
    return { order, attempt, success: false, reason: 'PAYMENT_RECONCILIATION_REQUIRED' };
  }
  if (
    razorpayPaymentId &&
    existingPayment?.razorpayPaymentId &&
    existingPayment.razorpayPaymentId !== razorpayPaymentId &&
    previouslyRecordedPaymentId !== razorpayPaymentId
  ) {
    return { order, attempt, success: false, reason: 'PAYMENT_RECONCILIATION_REQUIRED' };
  }

  // Atomic claim: exactly one concurrent caller (verifyPayment vs. Razorpay webhook)
  // may perform the inventory deduction. Losers wait for the terminal order outcome.
  // A verified capture supersedes an earlier failure on the same order, so FAILED
  // attempts are claimable when a real payment id proves the money was taken.
  const claimableStatuses: Array<'PENDING' | 'FAILED'> =
    razorpayPaymentId && !DUPLICATE_CAPTURE_FAILURE_CODES.has(attempt.failureCode || '')
      ? ['PENDING', 'FAILED']
      : ['PENDING'];

  const claimFilter: Record<string, any> = {
    _id: attempt._id,
    status: { $in: claimableStatuses },
  };
  const claimUpdate: Record<string, any> = { status: 'PROCESSING' };
  if (razorpayPaymentId) {
    claimFilter.$or = [
      { razorpayPaymentId: { $exists: false } },
      { razorpayPaymentId: null },
      { razorpayPaymentId: razorpayPaymentId },
    ];
    claimUpdate.razorpayPaymentId = razorpayPaymentId;
  }
  const claim = await PaymentAttempt.findOneAndUpdate(
    claimFilter,
    { $set: claimUpdate },
    { session: session || undefined, returnDocument: 'after' }
  );
  let ownsAttemptClaim = Boolean(claim);
  if (claim) {
    attempt.status = 'PROCESSING';
    attempt.razorpayPaymentId = claim.razorpayPaymentId;
  }

  if (!claim) {
    if (session && session.inTransaction()) {
      const liveAtt = await PaymentAttempt.findById(attempt._id).session(session);
      const liveOrder = liveAtt ? await Order.findById(liveAtt.orderId).session(session) : null;
      if (liveOrder) {
        if (liveOrder.paymentStatus === 'PAID' && liveOrder.status !== 'CANCELLED') {
          return handleConcurrentPaidCapture(liveAtt, liveOrder);
        }
        if (liveOrder.status === 'CANCELLED' || liveOrder.status === 'EXPIRED') {
          return { order: liveOrder, attempt: liveAtt, success: false, reason: 'ORDER_CANCELLED' };
        }
      }
      return { order: liveOrder || order, attempt: liveAtt || attempt, success: false, reason: 'PROCESSING_IN_PROGRESS' };
    }
    const deadline = Date.now() + TERMINAL_POLL_MS * TERMINAL_POLL_MAX;
    while (Date.now() < deadline) {
      await sleep(TERMINAL_POLL_MS);
      const liveAtt = await PaymentAttempt.findById(attempt._id);
      const liveOrder = liveAtt ? await Order.findById(liveAtt.orderId) : null;
      if (liveOrder) {
        if (liveOrder.paymentStatus === 'PAID' && liveOrder.status !== 'CANCELLED') {
          return handleConcurrentPaidCapture(liveAtt, liveOrder);
        }
        if (liveOrder.status === 'CANCELLED' || liveOrder.status === 'EXPIRED') {
          return { order: liveOrder, attempt: liveAtt, success: false, reason: 'ORDER_CANCELLED' };
        }
      }
      // Stale claim (previous processor crashed) → steal the lock and reprocess idempotently.
      if (liveAtt && liveAtt.status === 'PROCESSING' && Date.now() - new Date(liveAtt.updatedAt).getTime() > CLAIM_STALE_MS) {
        const stealFilter: Record<string, any> = {
          _id: attempt._id,
          status: 'PROCESSING',
          updatedAt: { $lte: new Date(Date.now() - CLAIM_STALE_MS) },
        };
        const stealUpdate: Record<string, any> = { status: 'PROCESSING' };
        if (razorpayPaymentId) {
          stealFilter.$or = [
            { razorpayPaymentId: { $exists: false } },
            { razorpayPaymentId: null },
            { razorpayPaymentId: razorpayPaymentId },
          ];
          stealUpdate.razorpayPaymentId = razorpayPaymentId;
        }
        const stolen = await PaymentAttempt.findOneAndUpdate(
          stealFilter,
          { $set: stealUpdate },
          { returnDocument: 'after' }
        );
        if (stolen) {
          attempt.status = 'PROCESSING';
          attempt.razorpayPaymentId = stolen.razorpayPaymentId;
          ownsAttemptClaim = true;
          break;
        }
      }
    }
    if (!ownsAttemptClaim) {
      const liveAttempt = await PaymentAttempt.findById(attempt._id);
      const liveOrder = liveAttempt ? await Order.findById(liveAttempt.orderId) : null;
      if (liveOrder?.paymentStatus === 'PAID' && liveOrder.status !== 'CANCELLED' && liveOrder.status !== 'EXPIRED') {
        return handleConcurrentPaidCapture(liveAttempt, liveOrder);
      }
      if (liveOrder && (liveOrder.status === 'CANCELLED' || liveOrder.status === 'EXPIRED')) {
        return { order: liveOrder, attempt: liveAttempt || attempt, success: false, reason: 'ORDER_CANCELLED' };
      }
      return await buildTerminalResult(attempt.orderId, attempt);
    }
  }

  // The capture superseded any earlier failure recorded on this attempt.
  attempt.failureCode = undefined;
  attempt.failureReason = undefined;

  let stockAllocationFailed = false;

  try {
    const allocations = await InventoryAllocationService.resolveOrderAllocations(order.items);
    const deduction = await InventoryAllocationService.deductInventory(order._id, allocations, { session });
    if (!deduction.success) {
      stockAllocationFailed = true;
    }
  } catch (err) {
    console.error(`[PAYMENT PROCESSOR] Inventory allocation error for order ${order._id}:`, err);
    stockAllocationFailed = true;
  }

  if (stockAllocationFailed) {
    // 1b. Partial decrements already rolled back by InventoryAllocationService.deductInventory
    const capturedPaymentId = razorpayPaymentId || attempt.razorpayPaymentId;

    // Only auto-refund when a capture is real (or explicitly mocked); with a dummy
    // key there is no captured money to return and the gateway call would throw.
    const keyId = process.env.RAZORPAY_KEY_ID;
    const isDummyKey = !keyId || keyId === 'dummy_key' || keyId.includes('dummy');
    const canAutoRefund =
      capturedPaymentId !== undefined &&
      (capturedPaymentId.startsWith('pay_mock_') ||
        capturedPaymentId.startsWith('order_mock_') ||
        !isDummyKey);

    if (canAutoRefund) {
      try {
        // Money was already captured at the gateway → record it, then auto-refund in full.
        await recordCapturedPayment(attempt, order, capturedPaymentId, { session });

        attempt.status = 'CAPTURED';
        attempt.razorpayPaymentId = capturedPaymentId;
        await attempt.save({ session: session || undefined });

        order.paymentStatus = 'PAID';
        order.status = 'CANCELLED';
        await order.save({ session: session || undefined });
        await createInternalRefund({
          orderId: order._id.toString(),
          amount: order.total,
          reason: 'AUTO_REFUND_STOCK_UNAVAILABLE',
          actorId: order.userId.toString(),
          actorRole: 'SYSTEM',
          session: session || undefined
        });

        console.warn(`[PAYMENT PROCESSOR] Auto-refund initiated for cancelled order ${order._id} (stock unavailable)`);
      } catch (refundErr) {
        console.error(`[PAYMENT PROCESSOR] Auto-refund FAILED for order ${order._id}:`, refundErr);
        order.paymentStatus = 'FAILED';
        order.status = 'CANCELLED';
        await order.save({ session: session || undefined });
        attempt.status = 'FAILED';
        await attempt.save({ session: session || undefined });
        // The money is captured but no refund could be created: never leave it unrecorded.
        await recordCapturedPayment(attempt, order, capturedPaymentId, {
          session,
          reconciliationReason: `Auto-refund failed for captured payment ${capturedPaymentId}; manual refund required`,
        });
      }
    } else {
      order.paymentStatus = 'FAILED';
      order.status = 'CANCELLED';
      await order.save({ session: session || undefined });

      attempt.status = 'FAILED';
      await attempt.save({ session: session || undefined });
    }

    if (order.discount > 0) {
      await releaseCouponReservation(order._id, 'STOCK_UNAVAILABLE', session || undefined).catch((releaseErr: unknown) => {
        console.error(JSON.stringify({
          level: 'ERROR',
          event: 'COUPON_RELEASE_FAILURE',
          orderId: order._id.toString(),
          reason: 'STOCK_UNAVAILABLE',
          message: releaseErr instanceof Error ? releaseErr.message : String(releaseErr),
        }));
      });
    }

    return { order, attempt, success: false, reason: 'STOCK_UNAVAILABLE' };
  }

  // 2. Update Order Status
  order.paymentStatus = 'PAID';
  order.status = 'CONFIRMED';
  await order.save({ session: session || undefined });

  // Issue the tax invoice as soon as payment is confirmed.
  scheduleInvoiceIssuance(order._id, session);

  // Asynchronously dispatch Order Confirmation & Payment Success Notifications ONLY post-commit
  const dispatchNotifications = async () => {
    try {
      const User = mongoose.model('User');
      const user = await User.findById(order.userId);
      if (user && user.email) {
        const { notificationService } = require('../notifications/notificationService');

        notificationService.notify({
          eventType: 'ORDER_CONFIRMED',
          entityType: 'ORDER',
          entityId: order._id,
          recipientEmail: user.email,
          idempotencyKey: `ORDER_CONFIRMED:${order._id}`,
          data: {
            customerName: user.name || 'Customer',
            orderNumber: order.orderNumber,
            items: order.items,
            total: order.total,
            shippingAddress: order.shippingAddress
          }
        });

        notificationService.notify({
          eventType: 'PAYMENT_SUCCESS',
          entityType: 'PAYMENT',
          entityId: attempt.paymentId || order._id,
          recipientEmail: user.email,
          idempotencyKey: `PAYMENT_SUCCESS:${order._id}`,
          data: {
            customerName: user.name || 'Customer',
            orderNumber: order.orderNumber,
            amount: order.total,
            paymentId: razorpayPaymentId || attempt.razorpayOrderId
          }
        });
      }
    } catch (notifErr) {
      console.error('[PAYMENT PROCESSOR] Notification dispatch exception:', notifErr);
    }
  };

  if (session && session.inTransaction()) {
    registerPostCommitHook(session, dispatchNotifications);
  } else {
    Promise.resolve().then(dispatchNotifications).catch(() => {});
  }
  // 3. Confirm Coupon Usage idempotently (from the reserved CouponUsage record)
  if (order.discount > 0) {
    try {
      await confirmCouponReservation(order._id, session || undefined);
    } catch (err) {
      console.error('[PAYMENT PROCESSOR] Error confirming coupon reservation:', err);
    }
  }

  // 4. Partial Cart Consumption: remove/decrement only items corresponding to this successfully paid Order
  try {
    const CartModel = mongoose.model('Cart');
    const cart = await CartModel.findOne({ userId: order.userId }).session(session || null);
    if (cart && cart.items && cart.items.length > 0) {
      for (const orderItem of order.items) {
        const cartItemIdx = cart.items.findIndex((ci: { productId: mongoose.Types.ObjectId; variantId: mongoose.Types.ObjectId; customDesignId?: mongoose.Types.ObjectId }) => {
          const matchProduct = ci.productId.toString() === orderItem.productId.toString();
          const matchVariant = ci.variantId.toString() === orderItem.variantId.toString();
          const orderCustomId = orderItem.customDesignId ? orderItem.customDesignId.toString() : null;
          const cartCustomId = ci.customDesignId ? ci.customDesignId.toString() : null;
          const matchCustom = orderCustomId === cartCustomId;
          return matchProduct && matchVariant && matchCustom;
        });

        if (cartItemIdx !== -1) {
          if (cart.items[cartItemIdx].quantity > orderItem.quantity) {
            cart.items[cartItemIdx].quantity -= orderItem.quantity;
          } else {
            cart.items.splice(cartItemIdx, 1);
          }
        }
      }

      if (order.discount > 0) {
        cart.couponCode = undefined;
      }

      await cart.save({ session: session || undefined });
    }
  } catch (cartErr) {
    console.error('[PAYMENT PROCESSOR] Error in partial cart consumption:', cartErr);
  }

  // 5. Update Payment Attempt & Payment Records
  attempt.status = 'CAPTURED';
  if (razorpayPaymentId) {
    attempt.razorpayPaymentId = razorpayPaymentId;
  }
  await attempt.save({ session: session || undefined });

  // Guarantee a Payment record exists for every applied capture.
  await recordCapturedPayment(
    attempt,
    order,
    razorpayPaymentId || attempt.razorpayPaymentId || '',
    { session }
  );
  return { order, attempt, success: true };
};