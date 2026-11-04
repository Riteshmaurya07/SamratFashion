import { Request, Response } from 'express';
import mongoose from 'mongoose';
import crypto from 'crypto';
import { WebhookEvent, startEventLeaseHeartbeat, LeaseHeartbeat } from '../models/WebhookEvent';
import { PaymentAttempt } from '../models/PaymentAttempt';
import { Payment } from '../models/Payment';
import { Order } from '../models/Order';
import { Refund, IRefund } from '../models/Refund';
import { razorpayProvider } from '../services/payment/RazorpayProvider';
import { processPaymentSuccess } from '../services/payment/paymentProcessor';
import { InventoryAllocationService } from '../services/inventory/inventoryAllocationService';
import { transitionPaymentReservation, applyProviderRefundSettlement, resolveSettlementPolicy, syncReturnRequestWithRefund } from '../services/payment/refundService';
import { AppError } from '../utils/AppError';
export interface RefundEntity {
  id: string;
  payment_id?: string;
  amount?: number;
  currency?: string;
  status?: string;
  notes?: Record<string, string>;
  error_description?: string;
}

export type WebhookProcessingOutcome =
  | 'PROCESSED'
  | 'IGNORED'
  | 'RETRYABLE'
  | 'RECONCILIATION_REQUIRED';

export interface WebhookProcessingResult {
  outcome: WebhookProcessingOutcome;
  reason?: string;
}
export const razorpayWebhook = async (req: Request, res: Response): Promise<void> => {
  const signatureHeader = req.headers['x-razorpay-signature'];
  const signature = typeof signatureHeader === 'string' ? signatureHeader : undefined;
  if (!signature) {
    res.status(400).send('Missing signature');
    return;
  }

  // req.body should be a Buffer because of express.raw
  const rawBody = req.body.toString('utf8');
  const isValid = razorpayProvider.verifyWebhookSignature(rawBody, signature);

  if (!isValid) {
    res.status(400).send('Invalid signature');
    return;
  }
  interface WebhookPayload {
    [key: string]: unknown;
    event?: string;
    event_id?: string;
    payload?: {
      payment?: {
        entity?: {
          id: string;
          order_id: string;
          error_code?: string;
          error_description?: string;
        };
      };
      refund?: {
        entity?: RefundEntity;
      };
    };
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    res.status(400).send('Invalid JSON payload');
    return;
  }
  const eventIdHeader = req.headers['x-razorpay-event-id'];
  const eventId = (typeof eventIdHeader === 'string' ? eventIdHeader : undefined) || payload?.event_id;
  const eventType = payload?.event;

  // M1: Supported events MUST have a stable provider event ID. If absent, reject without processing!
  if (!eventId) {
    res.status(400).send('Missing stable provider event ID');
    return;
  }
  // Idempotency & Inbox Recovery: Lease-based claim ensures crash recovery and prevents concurrency
  const leaseDurationMs = Number(process.env.WEBHOOK_LEASE_DURATION_MS) || 60_000;
  const now = new Date();
  const leaseExpiry = new Date(Date.now() + leaseDurationMs);
  const leaseToken = `lease_${crypto.randomUUID()}`;
  let claimedDocId: mongoose.Types.ObjectId | null = null;
  let heartbeat: LeaseHeartbeat | null = null;

  if (eventId) {
    try {
      const created = await WebhookEvent.create({
        eventId,
        provider: 'RAZORPAY',
        eventType,
        status: 'PROCESSING',
        leaseToken,
        processingLockExpiresAt: leaseExpiry,
        processingAttempts: 1,
        payload
      });
      claimedDocId = created._id as mongoose.Types.ObjectId;
    } catch (evtErr: unknown) {
      let isDup = false;
      if (evtErr && typeof evtErr === 'object' && 'code' in evtErr) {
        const codeVal = (evtErr as { code: unknown }).code;
        if (codeVal === 11000) isDup = true;
      }
      if (!isDup) {
        res.status(500).send('Internal Server Error');
        return;
      }

      // Duplicate arrival: Check existing event status
      const existing = await WebhookEvent.findOne({ provider: 'RAZORPAY', eventId });
      if (existing?.status === 'PROCESSED') {
        res.status(200).send('Event already processed');
        return;
      }

      // Reclaim lease if previous worker crashed (lease expired) or failed
      const reclaimed = await WebhookEvent.findOneAndUpdate(
        {
          provider: 'RAZORPAY',
          eventId,
          $or: [
            { status: 'FAILED' },
            { status: 'PROCESSING', processingLockExpiresAt: { $lt: now } }
          ]
        },
        {
          $set: {
            status: 'PROCESSING',
            leaseToken,
            processingLockExpiresAt: leaseExpiry
          },
          $inc: { processingAttempts: 1 }
        },
        { returnDocument: 'after' }
      );

      if (!reclaimed) {
        // An active worker is currently executing within a valid lease window
        res.status(200).send('Event currently being processed');
        return;
      }
      claimedDocId = reclaimed._id as mongoose.Types.ObjectId;
    }
  }

  if (claimedDocId) {
    heartbeat = startEventLeaseHeartbeat(claimedDocId, leaseToken, leaseDurationMs);
  }

  try {
    const result = await processSupportedWebhookEvent(eventType || '', payload);
    if (claimedDocId) {
      if (heartbeat?.hasLostLease()) {
        console.warn(`[WEBHOOK] Worker lost lease ownership for event ${eventId}; aborting terminal update.`);
        res.status(500).send('Lease ownership lost during processing');
        return;
      }

      if (result.outcome === 'PROCESSED') {
        const updateRes = await WebhookEvent.updateOne(
          {
            _id: claimedDocId,
            status: 'PROCESSING',
            leaseToken,
            processingLockExpiresAt: { $gt: new Date() }
          },
          {
            $set: {
              status: 'PROCESSED',
              processedAt: new Date(),
              expiresAt: new Date(Date.now() + 120 * 24 * 60 * 60 * 1000),
              lastError: undefined
            }
          }
        );
        if (updateRes.matchedCount === 0) {
          console.warn(`[WEBHOOK] Stale worker lost lease ownership for event ${eventId}; update to PROCESSED fenced out.`);
        }
      } else if (result.outcome === 'IGNORED') {
        await WebhookEvent.updateOne(
          {
            _id: claimedDocId,
            status: 'PROCESSING',
            leaseToken,
            processingLockExpiresAt: { $gt: new Date() }
          },
          {
            $set: {
              status: 'IGNORED',
              processedAt: new Date(),
              expiresAt: new Date(Date.now() + 120 * 24 * 60 * 60 * 1000),
              lastError: undefined
            }
          }
        );
      } else {
        await WebhookEvent.updateOne(
          { _id: claimedDocId, status: 'PROCESSING', leaseToken },
          {
            $set: {
              status: 'FAILED',
              lastError: result.reason || 'Webhook processing requires reconciliation'
            },
            $unset: { expiresAt: 1 }
          }
        );
      }
    }
    res.status(200).send('OK');
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Webhook error:', msg);
    if (claimedDocId) {
      await WebhookEvent.updateOne(
        { _id: claimedDocId, status: 'PROCESSING', leaseToken },
        {
          $set: {
            status: 'FAILED',
            lastError: msg
          },
          $unset: { expiresAt: 1 }
        }
      );
    }
    res.status(500).send('Internal Server Error');
  } finally {
    if (heartbeat) {
      heartbeat.stop();
    }
  }
};

/**
 * DB-side handling of a Razorpay `refund.processed` event. Exported separately
 * from the HTTP endpoint so the transition logic can be unit-tested directly
 * with a stubbed entity (no signature/HTTP harness needed).
 */
/**
 * Shared webhook event processor used by both normal HTTP delivery and recovery inbox replay.
 */
export async function processSupportedWebhookEvent(
  eventType: string,
  payload: Record<string, unknown>,
  options: { session?: mongoose.ClientSession } = {}
): Promise<WebhookProcessingResult> {
  const pObj = payload.payload as Record<string, unknown> | undefined;

  if (eventType === 'payment.captured' || eventType === 'order.paid') {
    const paymentEntity = (pObj?.payment as Record<string, unknown> | undefined)?.entity as { order_id?: string; id?: string } | undefined;
    if (!paymentEntity?.order_id || !paymentEntity?.id) {
      throw new AppError('Malformed payment.captured/order.paid entity: missing order_id or id', 400);
    }
    await processPaymentSuccess(paymentEntity.order_id, paymentEntity.id);
    return { outcome: 'PROCESSED' };
  }

  if (eventType === 'payment.failed') {
    const paymentEntity = (pObj?.payment as Record<string, unknown> | undefined)?.entity as { order_id?: string; id?: string; error_code?: string; error_description?: string } | undefined;
    if (!paymentEntity?.order_id) {
      throw new AppError('Malformed payment.failed entity: missing order_id', 400);
    }
    const razorpayOrderId = paymentEntity.order_id;
    const razorpayPaymentId = paymentEntity.id;

    let attempt: any = null;
    if (razorpayPaymentId) {
      attempt = await PaymentAttempt.findOne({ razorpayPaymentId });
    }
    if (!attempt) {
      attempt = await PaymentAttempt.findOne({ razorpayOrderId });
    }

    if (attempt) {
      attempt.status = 'FAILED';
      attempt.failureCode = paymentEntity.error_code;
      attempt.failureReason = paymentEntity.error_description;
      await attempt.save();

      const payment = await Payment.findById(attempt.paymentId);
      if (payment && payment.status === 'PENDING') {
        payment.status = 'FAILED';
        await payment.save();
      }

      const order = await Order.findById(attempt.orderId);
      if (order && order.paymentStatus === 'PENDING') {
        order.paymentStatus = 'FAILED';
        await order.save();
      }
      return { outcome: 'PROCESSED' };
    }
    return { outcome: 'RECONCILIATION_REQUIRED', reason: `No PaymentAttempt found for order ${razorpayOrderId}` };
  }

  if (eventType === 'refund.processed') {
    const refundEntity = (pObj?.refund as Record<string, unknown> | undefined)?.entity as RefundEntity | undefined;
    if (!refundEntity || !refundEntity.id) {
      return { outcome: 'RECONCILIATION_REQUIRED', reason: 'Malformed refund.processed payload: missing refund entity or id' };
    }
    return await handleRefundProcessedEntity(refundEntity, options);
  }

  if (eventType === 'refund.failed') {
    const refundEntity = (pObj?.refund as Record<string, unknown> | undefined)?.entity as RefundEntity | undefined;
    if (!refundEntity || !refundEntity.id) {
      return { outcome: 'RECONCILIATION_REQUIRED', reason: 'Malformed refund.failed payload: missing refund entity or id' };
    }
    return await handleRefundFailedEntity(refundEntity, options);
  }

  return { outcome: 'IGNORED' };
}

async function handleRefundProcessedEntity(
  refundEntity: RefundEntity,
  options: { session?: mongoose.ClientSession } = {}
): Promise<WebhookProcessingResult> {
  const session = options.session;
  const razorpayRefundId = refundEntity.id;
  const razorpayPaymentId = refundEntity.payment_id;
  const notes = refundEntity.notes || {};
  const internalRefundId = notes.internal_refund_id;

  // Strict provider contract validation (B3)
  if (!razorpayRefundId || typeof razorpayRefundId !== 'string') {
    return { outcome: 'RECONCILIATION_REQUIRED', reason: 'Missing required provider refund ID' };
  }
  if (!razorpayPaymentId || typeof razorpayPaymentId !== 'string') {
    return { outcome: 'RECONCILIATION_REQUIRED', reason: 'Missing required parent payment ID' };
  }
  if (typeof refundEntity.amount !== 'number' || !Number.isFinite(refundEntity.amount) || refundEntity.amount <= 0) {
    return { outcome: 'RECONCILIATION_REQUIRED', reason: 'Missing or invalid required refund amount' };
  }
  if (!refundEntity.currency || typeof refundEntity.currency !== 'string') {
    return { outcome: 'RECONCILIATION_REQUIRED', reason: 'Missing required refund currency' };
  }
  if (refundEntity.status && typeof refundEntity.status === 'string' && refundEntity.status.toLowerCase() !== 'processed') {
    return { outcome: 'RECONCILIATION_REQUIRED', reason: `Provider entity status contradicts processed: ${refundEntity.status}` };
  }
  let existingRefund: IRefund | null = null;
  if (internalRefundId) {
    if (mongoose.Types.ObjectId.isValid(internalRefundId)) {
      existingRefund = await Refund.findById(internalRefundId);
    }
    if (!existingRefund) {
      console.warn(`[WEBHOOK] Unknown internal refund reference in notes: ${internalRefundId}`);
      return { outcome: 'RECONCILIATION_REQUIRED', reason: `Unknown internal refund ID in notes: ${internalRefundId}` };
    }
  }
  if (!existingRefund && razorpayRefundId) {
    existingRefund = await Refund.findOne({ razorpayRefundId });
  }
  if (!existingRefund && !internalRefundId && razorpayPaymentId) {
    const payment = await Payment.findOne({ razorpayPaymentId });
    if (payment) {
      const candidates = await Refund.find({ paymentId: payment._id, status: { $in: ['PENDING', 'PROCESSING', 'UNKNOWN'] } });
      if (candidates.length === 1) {
        existingRefund = candidates[0];
      } else if (candidates.length > 1) {
        if (typeof refundEntity.amount === 'number' && Number.isFinite(refundEntity.amount)) {
          const expectedPaise = Math.round(refundEntity.amount);
          const amountMatched = candidates.filter(c => Math.round(c.amount * 100) === expectedPaise);
          if (amountMatched.length === 1) {
            existingRefund = amountMatched[0];
          } else {
            console.error(`[WEBHOOK SECURITY] Ambiguous refund correlation: multiple active refunds found for payment ${razorpayPaymentId}`);
            throw new AppError('Ambiguous refund correlation: multiple refunds for payment', 409);
          }
        } else {
          console.error(`[WEBHOOK SECURITY] Ambiguous refund correlation: multiple active refunds found for payment ${razorpayPaymentId}`);
          throw new AppError('Ambiguous refund correlation: multiple refunds for payment', 409);
        }
      }
    }
  }

  if (!existingRefund) {
    return { outcome: 'RECONCILIATION_REQUIRED', reason: 'Missing Refund document: could not correlate refund to any internal record' };
  }
  // Amount and currency validation against internal record (B3)
  const expectedPaise = Math.round(existingRefund.amount * 100);
  if (Math.round(refundEntity.amount) !== expectedPaise) {
    console.error(`[WEBHOOK SECURITY] Refund amount mismatch: expected ${expectedPaise} paise, got ${refundEntity.amount} paise`);
    return { outcome: 'RECONCILIATION_REQUIRED', reason: `Amount mismatch: expected ${expectedPaise} paise, got ${refundEntity.amount}` };
  }

  if (refundEntity.currency.toUpperCase() !== (existingRefund.currency || 'INR').toUpperCase()) {
    console.error(`[WEBHOOK SECURITY] Refund currency mismatch: expected ${existingRefund.currency}, got ${refundEntity.currency}`);
    return { outcome: 'RECONCILIATION_REQUIRED', reason: 'Refund currency mismatch' };
  }

  let expectedPaymentId = existingRefund.razorpayPaymentId;
  if (!expectedPaymentId && existingRefund.paymentId) {
    const pDoc = await Payment.findById(existingRefund.paymentId);
    expectedPaymentId = pDoc?.razorpayPaymentId;
  }
  if (razorpayPaymentId && expectedPaymentId && expectedPaymentId !== razorpayPaymentId) {
    console.error(`[WEBHOOK SECURITY] Mismatched paymentId: expected ${expectedPaymentId}, got ${razorpayPaymentId}`);
    return { outcome: 'RECONCILIATION_REQUIRED', reason: 'Payment ID mismatch' };
  }

  if (existingRefund.status === 'PROCESSED') {
    if (existingRefund.razorpayRefundId && existingRefund.razorpayRefundId !== razorpayRefundId) {
      console.error(`[WEBHOOK SECURITY] Provider refund ID mismatch on PROCESSED refund: expected ${existingRefund.razorpayRefundId}, got ${razorpayRefundId}`);
      return { outcome: 'RECONCILIATION_REQUIRED', reason: `Provider refund ID conflict on processed refund: ${existingRefund.razorpayRefundId} !== ${razorpayRefundId}` };
    }

    // A1. Complete early-return conditions verification against Refund, Payment, and ledger
    const pDoc = await Payment.findById(existingRefund.paymentId).session(session || null);
    if (!pDoc) {
      return { outcome: 'RECONCILIATION_REQUIRED', reason: 'Associated Payment not found for processed refund' };
    }
    if (pDoc._id.toString() !== existingRefund.paymentId.toString()) {
      return { outcome: 'RECONCILIATION_REQUIRED', reason: 'Payment relationship mismatch' };
    }
    if (pDoc.razorpayPaymentId && razorpayPaymentId && pDoc.razorpayPaymentId !== razorpayPaymentId) {
      return { outcome: 'RECONCILIATION_REQUIRED', reason: 'Payment razorpayPaymentId mismatch with incoming event' };
    }

    // Find actual matching persisted settlement entry
    const matchingLedgerEntries = (pDoc.settledRefunds || []).filter(s => {
      const isSameRefund = Boolean(s.refundId && s.refundId.toString() === existingRefund._id.toString());
      const isSameProviderId = Boolean(s.razorpayRefundId && s.razorpayRefundId === razorpayRefundId);
      const isSameAmount = typeof s.amount === 'number' && Math.abs(s.amount - existingRefund.amount) < 0.01;
      const isSameCurrency = Boolean(s.currency && existingRefund.currency && s.currency.toUpperCase() === existingRefund.currency.toUpperCase());
      return isSameRefund && isSameProviderId && isSameAmount && isSameCurrency;
    });

    const conflictingLedgerEntries = (pDoc.settledRefunds || []).filter(s => {
      const sameRefDiffProv = Boolean(s.refundId && s.refundId.toString() === existingRefund._id.toString() && s.razorpayRefundId && s.razorpayRefundId !== razorpayRefundId);
      const diffRefSameProv = Boolean(s.refundId && s.refundId.toString() !== existingRefund._id.toString() && s.razorpayRefundId && s.razorpayRefundId === razorpayRefundId);
      return sameRefDiffProv || diffRefSameProv;
    });

    if (conflictingLedgerEntries.length > 0) {
      return { outcome: 'RECONCILIATION_REQUIRED', reason: 'Conflicting provider refund ID recorded in payment settlement ledger' };
    }

    const hasValidProcessedAt = Boolean(existingRefund.processedAt);
    const hasConfirmedSubmission = existingRefund.submissionState === 'CONFIRMED';
    const isAccountingComplete = existingRefund.accountingSettlementStatus === 'COMPLETED';

    if (
      matchingLedgerEntries.length === 1 &&
      hasValidProcessedAt &&
      hasConfirmedSubmission &&
      isAccountingComplete &&
      existingRefund.razorpayRefundId === razorpayRefundId
    ) {
      return { outcome: 'PROCESSED', reason: 'ALREADY_SETTLED' };
    }
    // Accounting settlement is pending, incomplete, or ledger missing. Fall through to complete settlement!
  } else if (existingRefund.status === 'CANCELLED') {
    return { outcome: 'RECONCILIATION_REQUIRED', reason: `Terminal conflict: refund is CANCELLED in database, requires manual reconciliation` };
  } else {
    const claimedRefund = await Refund.findOneAndUpdate(
      {
        _id: existingRefund._id,
        status: { $in: ['PENDING', 'PROCESSING', 'UNKNOWN', 'FAILED'] },
        $or: [
          { razorpayRefundId: { $exists: false } },
          { razorpayRefundId: null },
          { razorpayRefundId: razorpayRefundId }
        ]
      },
      {
        $set: {
          status: 'PROCESSED',
          submissionState: 'CONFIRMED',
          razorpayRefundId,
          processedAt: existingRefund.processedAt || new Date(),
          accountingSettlementStatus: 'PENDING'
        }
      },
      { session: session || undefined, returnDocument: 'after' }
    );

    if (!claimedRefund) {
      const currentRef = await Refund.findById(existingRefund._id).session(session || null);
      if (currentRef?.razorpayRefundId && currentRef.razorpayRefundId !== razorpayRefundId) {
        return { outcome: 'RECONCILIATION_REQUIRED', reason: `Conflicting provider refund ID: already bound to ${currentRef.razorpayRefundId}, received ${razorpayRefundId}` };
      }
      if (currentRef?.status !== 'PROCESSED') {
        return { outcome: 'RECONCILIATION_REQUIRED', reason: 'Concurrent state change prevented marking PROCESSED' };
      }
    }
  }
    const transitionRes = await transitionPaymentReservation({
      paymentId: existingRefund.paymentId,
      refundId: existingRefund._id,
      reservationId: existingRefund._id.toString(),
      amount: existingRefund.amount,
      targetState: 'CONSUMED',
      session,
      attemptNumber: existingRefund.attemptNumber || 1
    });
    const policy = await resolveSettlementPolicy({
      paymentId: existingRefund.paymentId,
      refundId: existingRefund._id,
      transitionOutcome: transitionRes.outcome,
      expectedReservationId: existingRefund._id.toString(),
      expectedAttemptNumber: existingRefund.attemptNumber || 1,
      expectedAmount: existingRefund.amount,
      expectedProviderRefundId: razorpayRefundId,
      expectedCurrency: existingRefund.currency
    });
    if (!policy.canProceedToSettlement) {
      await Refund.updateOne(
        { _id: existingRefund._id },
        { $set: { accountingSettlementStatus: 'RECONCILIATION_REQUIRED' } },
        { session: session || undefined }
      );
      return { outcome: 'RECONCILIATION_REQUIRED', reason: `Reservation transition returned ${transitionRes.outcome}` };
    }

    const settlementRes = await applyProviderRefundSettlement({
      paymentId: existingRefund.paymentId,
      refundId: existingRefund._id,
      razorpayRefundId,
      amount: existingRefund.amount,
      currency: existingRefund.currency,
      session,
      unlinked: policy.isUnlinkedSettlement,
      settlementReason: policy.settlementReason
    });
    const payment = settlementRes.paymentDoc || transitionRes.paymentDoc || (await Payment.findById(existingRefund.paymentId).session(session || null));
    let returnSyncSuccess = true;
    if (payment) {
      const nowFullyRefunded = payment.refundedAmount >= payment.amount;
      if (nowFullyRefunded) {
        await Payment.updateOne({ _id: payment._id }, { status: 'REFUNDED' }, { session: session || undefined });
      }
      const order = await Order.findById(payment.orderId).session(session || null);
      if (order) {
        if (nowFullyRefunded) {
          order.paymentStatus = 'REFUNDED';
        }
        await order.save({ session: session || undefined });

        // Inventory Restoration Logic for CANCELLED orders
        if (order.status === 'CANCELLED') {
          await InventoryAllocationService.restoreCancelledOrderInventory(order._id, {
            refundId: existingRefund._id,
            reason: 'Webhook refund.processed cancellation stock restoration'
          });
        }
        // Return Request completion
        if (existingRefund.returnId) {
          const syncRes = await syncReturnRequestWithRefund({
            returnId: existingRefund.returnId,
            refundId: existingRefund._id,
            orderId: order._id,
            refundStatus: 'PROCESSED',
            attemptNumber: existingRefund.attemptNumber,
            session
          });
          returnSyncSuccess = syncRes.success;
        }
      }
    }

    const paymentDoc = settlementRes.paymentDoc || transitionRes.paymentDoc || (await Payment.findById(existingRefund.paymentId));
    const isSettled = (transitionRes.outcome === 'APPLIED' || transitionRes.outcome === 'ALREADY_APPLIED') &&
      settlementRes.success &&
      paymentDoc &&
      !paymentDoc.reconciliationRequired &&
      returnSyncSuccess;

    await Refund.updateOne(
      { _id: existingRefund._id },
      { $set: { accountingSettlementStatus: isSettled ? 'COMPLETED' : 'RECONCILIATION_REQUIRED' } }
    );
    return { outcome: 'PROCESSED' };
  }

async function handleRefundFailedEntity(
  refundEntity: RefundEntity,
  options: { session?: mongoose.ClientSession } = {}
): Promise<WebhookProcessingResult> {
  const session = options.session;
  const razorpayRefundId = refundEntity.id;
  const razorpayPaymentId = refundEntity.payment_id;
  const internalRefundId = refundEntity.notes?.internal_refund_id;

  // Strict provider contract validation (B3)
  if (!razorpayRefundId || typeof razorpayRefundId !== 'string') {
    return { outcome: 'RECONCILIATION_REQUIRED', reason: 'Missing required provider refund ID' };
  }
  if (!razorpayPaymentId || typeof razorpayPaymentId !== 'string') {
    return { outcome: 'RECONCILIATION_REQUIRED', reason: 'Missing required parent payment ID' };
  }
  if (typeof refundEntity.amount !== 'number' || !Number.isFinite(refundEntity.amount) || refundEntity.amount <= 0) {
    return { outcome: 'RECONCILIATION_REQUIRED', reason: 'Missing or invalid required refund amount' };
  }
  if (!refundEntity.currency || typeof refundEntity.currency !== 'string') {
    return { outcome: 'RECONCILIATION_REQUIRED', reason: 'Missing required refund currency' };
  }

  let existingRefund: IRefund | null = null;
  if (internalRefundId) {
    if (mongoose.Types.ObjectId.isValid(internalRefundId)) {
      existingRefund = await Refund.findById(internalRefundId);
    }
    if (!existingRefund) {
      console.warn(`[WEBHOOK] Unknown internal refund reference in notes: ${internalRefundId}`);
      return { outcome: 'RECONCILIATION_REQUIRED', reason: `Unknown internal refund ID in notes: ${internalRefundId}` };
    }
  }
  if (!existingRefund && razorpayRefundId) {
    existingRefund = await Refund.findOne({ razorpayRefundId });
  }
  if (!existingRefund && !internalRefundId && razorpayPaymentId) {
    const payment = await Payment.findOne({ razorpayPaymentId });
    if (payment) {
      const candidates = await Refund.find({ paymentId: payment._id, status: { $in: ['PENDING', 'PROCESSING', 'UNKNOWN'] } });
      if (candidates.length === 1) {
        existingRefund = candidates[0];
      } else if (candidates.length > 1) {
        if (typeof refundEntity.amount === 'number' && Number.isFinite(refundEntity.amount)) {
          const expectedPaise = Math.round(refundEntity.amount);
          const amountMatched = candidates.filter(c => Math.round(c.amount * 100) === expectedPaise);
          if (amountMatched.length === 1) {
            existingRefund = amountMatched[0];
          } else {
            console.error(`[WEBHOOK SECURITY] Ambiguous refund correlation: multiple active refunds found for payment ${razorpayPaymentId}`);
            throw new AppError('Ambiguous refund correlation: multiple refunds for payment', 409);
          }
        } else {
          console.error(`[WEBHOOK SECURITY] Ambiguous refund correlation: multiple active refunds found for payment ${razorpayPaymentId}`);
          throw new AppError('Ambiguous refund correlation: multiple refunds for payment', 409);
        }
      }
    }
  }

  if (!existingRefund) {
    return { outcome: 'RECONCILIATION_REQUIRED', reason: 'Missing Refund document: could not correlate refund to any internal record' };
  }
  let expectedPaymentId = existingRefund.razorpayPaymentId;
  if (!expectedPaymentId && existingRefund.paymentId) {
    const pDoc = await Payment.findById(existingRefund.paymentId);
    expectedPaymentId = pDoc?.razorpayPaymentId;
  }
  if (razorpayPaymentId && expectedPaymentId && expectedPaymentId !== razorpayPaymentId) {
    console.error(`[WEBHOOK SECURITY] Mismatched paymentId in refund.failed: expected ${expectedPaymentId}, got ${razorpayPaymentId}`);
    return { outcome: 'RECONCILIATION_REQUIRED', reason: 'Payment ID mismatch' };
  }

  // Amount and currency validation against internal record (B3)
  const expectedPaise = Math.round(existingRefund.amount * 100);
  if (Math.round(refundEntity.amount) !== expectedPaise) {
    console.error(`[WEBHOOK SECURITY] Refund amount mismatch in refund.failed: expected ${expectedPaise} paise, got ${refundEntity.amount} paise`);
    return { outcome: 'RECONCILIATION_REQUIRED', reason: `Amount mismatch: expected ${expectedPaise} paise, got ${refundEntity.amount}` };
  }

  if (refundEntity.currency.toUpperCase() !== (existingRefund.currency || 'INR').toUpperCase()) {
    console.error(`[WEBHOOK SECURITY] Refund currency mismatch in refund.failed: expected ${existingRefund.currency}, got ${refundEntity.currency}`);
    return { outcome: 'RECONCILIATION_REQUIRED', reason: 'Refund currency mismatch' };
  }
  if (existingRefund.status === 'PROCESSED') {
    if (existingRefund.razorpayRefundId && existingRefund.razorpayRefundId !== razorpayRefundId) {
      return { outcome: 'RECONCILIATION_REQUIRED', reason: `Provider refund ID conflict: ${existingRefund.razorpayRefundId} !== ${razorpayRefundId}` };
    }
    return { outcome: 'PROCESSED', reason: 'ALREADY_PROCESSED' };
  }

  if (existingRefund.status === 'FAILED') {
    if (existingRefund.razorpayRefundId && existingRefund.razorpayRefundId !== razorpayRefundId) {
      return { outcome: 'RECONCILIATION_REQUIRED', reason: `Provider refund ID conflict: ${existingRefund.razorpayRefundId} !== ${razorpayRefundId}` };
    }
    return { outcome: 'PROCESSED', reason: 'ALREADY_FAILED' };
  }
  const claimedFailed = await Refund.findOneAndUpdate(
    {
      _id: existingRefund._id,
      status: { $in: ['PENDING', 'PROCESSING', 'UNKNOWN'] },
      $or: [
        { razorpayRefundId: { $exists: false } },
        { razorpayRefundId: null },
        { razorpayRefundId: razorpayRefundId }
      ]
    },
    {
      $set: {
        status: 'FAILED',
        submissionState: 'RESPONSE_RECEIVED',
        razorpayRefundId,
        failureReason: refundEntity.error_description || 'Razorpay refund.failed event received',
        accountingSettlementStatus: 'PENDING'
      }
    },
    { session: session || undefined, returnDocument: 'after' }
  );

  if (!claimedFailed) {
    const currentRef = await Refund.findById(existingRefund._id).session(session || null);
    if (currentRef?.razorpayRefundId && currentRef.razorpayRefundId !== razorpayRefundId) {
      return { outcome: 'RECONCILIATION_REQUIRED', reason: `Conflicting provider refund ID on failure: ${currentRef.razorpayRefundId} !== ${razorpayRefundId}` };
    }
    return { outcome: 'PROCESSED', reason: 'ALREADY_TERMINAL' };
  }
  const transitionRes = await transitionPaymentReservation({
    paymentId: existingRefund.paymentId,
    refundId: existingRefund._id,
    amount: existingRefund.amount,
    targetState: 'RELEASED',
    session
  });

  if (existingRefund.returnId) {
    await syncReturnRequestWithRefund({
      returnId: existingRefund.returnId,
      refundId: existingRefund._id,
      orderId: existingRefund.orderId,
      refundStatus: 'FAILED',
      attemptNumber: existingRefund.attemptNumber,
      refundError: refundEntity.error_description || 'Razorpay refund.failed event received',
      session
    });
  }
  const paymentDoc = transitionRes.paymentDoc || (await Payment.findById(existingRefund.paymentId).session(session || null));
  const isSettled = transitionRes.success && paymentDoc && !paymentDoc.reconciliationRequired;
  await Refund.updateOne(
    { _id: existingRefund._id },
    { $set: { accountingSettlementStatus: isSettled ? 'COMPLETED' : 'RECONCILIATION_REQUIRED' } },
    { session: session || undefined }
  );
  return { outcome: 'PROCESSED' };
}

/**
 * Recovers any webhook events left in PROCESSING state after a server crash.
 */
export async function recoverStaleWebhookEvents(
  maxAgeMs = 60_000,
  options: { session?: mongoose.ClientSession } = {}
): Promise<{ recoveredCount: number }> {
  const threshold = new Date(Date.now() - maxAgeMs);
  const res = await WebhookEvent.updateMany(
    {
      status: 'PROCESSING',
      $or: [
        { processingLockExpiresAt: { $lt: new Date() } },
        { updatedAt: { $lt: threshold } }
      ]
    },
    {
      $set: {
        status: 'FAILED',
        lastError: 'Processing lease expired after process crash or timeout'
      },
      $unset: { expiresAt: 1 }
    },
    { session: options.session || undefined }
  );
  return { recoveredCount: res.modifiedCount };
}

export { handleRefundProcessedEntity, handleRefundFailedEntity };