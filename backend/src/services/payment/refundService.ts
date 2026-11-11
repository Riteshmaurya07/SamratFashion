import mongoose from 'mongoose';
import crypto from 'crypto';
import { Order } from '../../models/Order';
import { Payment, IPayment, IPaymentSettledRefund } from '../../models/Payment';
import { PaymentAttempt } from '../../models/PaymentAttempt';
import { Refund, IRefund } from '../../models/Refund';
import { ReturnRequest, IReturnRequest } from '../../models/ReturnRequest';
import { AuditLog } from '../../models/AuditLog';
import { AppError } from '../../utils/AppError';
import { razorpayProvider } from './RazorpayProvider';
import { InventoryAllocationService } from '../inventory/inventoryAllocationService';
export interface CreateRefundParams {
  orderId: string;
  returnId?: string;
  operationId?: string;
  customIdempotencyKey?: string;
  amount?: number | string; // if not provided, full remaining amount is refunded for order cancellations
  reason: string;
  actorId: string;
  actorRole: string;
  session?: mongoose.ClientSession;
}

export interface SessionWithPostCommit extends mongoose.ClientSession {
  _postCommitHooks?: Array<() => Promise<void> | void>;
  _postCommitInstalled?: boolean;
}

export function registerPostCommitHook(session: mongoose.ClientSession, hook: () => Promise<void> | void): void {
  if (!session || !session.inTransaction()) {
    Promise.resolve().then(hook).catch((err: unknown) => {
      console.error('[POST_COMMIT] Error in standalone post-commit execution:', err);
    });
    return;
  }

  const s = session as SessionWithPostCommit;
  if (!s._postCommitHooks) {
    s._postCommitHooks = [];
  }

  if (!s._postCommitInstalled) {
    s._postCommitInstalled = true;
    const origCommit = session.commitTransaction.bind(session);
    const origAbort = session.abortTransaction.bind(session);

    session.abortTransaction = async function (...args: Parameters<typeof origAbort>) {
      s._postCommitHooks = [];
      return origAbort(...args);
    };

    session.commitTransaction = async function (options?: { timeoutMS?: number }) {
      const res = await origCommit(options);
      const hooksToRun = s._postCommitHooks || [];
      s._postCommitHooks = [];
      for (const h of hooksToRun) {
        try {
          await h();
        } catch (hookErr: unknown) {
          console.error('[POST_COMMIT] Post-commit hook execution error:', hookErr);
        }
      }
      return res;
    };
  }

  s._postCommitHooks.push(hook);
}

export type GatewayRefundOutcomeCategory =
  | 'DEFINITIVE_REJECTION'
  | 'STILL_PROCESSING'
  | 'AMBIGUOUS'
  | 'GATEWAY_ERROR';

export interface ClassifiedGatewayError {
  category: GatewayRefundOutcomeCategory;
  isDefinitiveRejection: boolean;
  isAmbiguous: boolean;
  isStillProcessing: boolean;
  errorCode?: string;
  errorMessage: string;
  statusCode?: number;
}

export interface TransitionReservationParams {
  paymentId: mongoose.Types.ObjectId | string;
  refundId: mongoose.Types.ObjectId | string;
  reservationId?: string;
  amount: number;
  targetState: 'RELEASED' | 'CONSUMED';
  session?: mongoose.ClientSession | null;
  attemptNumber?: number;
  razorpayRefundId?: string;
}

export type TransitionOutcome =
  | 'APPLIED'
  | 'ALREADY_APPLIED'
  | 'RESERVATION_NOT_FOUND'
  | 'OWNERSHIP_AMBIGUOUS'
  | 'BALANCE_CONFLICT'
  | 'PAYMENT_MISSING'
  | 'DATABASE_ERROR';

export interface TransitionReservationResult {
  success: boolean;
  outcome: TransitionOutcome;
  previousState: 'PENDING' | 'RELEASED' | 'CONSUMED' | 'NOT_FOUND';
  newState: 'RELEASED' | 'CONSUMED' | 'UNCHANGED';
  pendingAdjusted: number;
  refundedAdjusted: number;
  overCommitmentDetected: boolean;
  overCommitmentAmount: number;
  paymentDoc?: IPayment;
  error?: string;
}

/**
 * Helper to verify an exact matching prior settlement entry in payment.settledRefunds (Defect B1).
 */
export interface ExactSettlementVerificationResult {
  match?: IPaymentSettledRefund;
  conflict?: string;
}

export function findExactSettlementRecord(
  settledRefunds: IPaymentSettledRefund[] | undefined,
  targetRefundId: mongoose.Types.ObjectId,
  expectedAmount: number,
  expectedCurrency: string,
  expectedProviderRefundId?: string
): ExactSettlementVerificationResult {
  if (!settledRefunds || settledRefunds.length === 0) return {};

  const matches: IPaymentSettledRefund[] = [];
  const normExpectedCurrency = (expectedCurrency || '').trim().toUpperCase();

  for (const s of settledRefunds) {
    const isSameRefund = Boolean(s.refundId && s.refundId.toString() === targetRefundId.toString());
    const isSameProviderId = Boolean(expectedProviderRefundId && s.razorpayRefundId && s.razorpayRefundId === expectedProviderRefundId);

    if (isSameRefund || isSameProviderId) {
      const hasProvId = Boolean(s.razorpayRefundId && s.razorpayRefundId.trim());
      const hasCurrency = Boolean(s.currency && s.currency.trim());

      // Historical entry with missing required provider ID or currency (B1 safety rule)
      if (!hasProvId || !hasCurrency) {
        return {
          conflict: `Historical settlement ledger entry for refund ${targetRefundId} has missing provider refund ID or currency; manual reconciliation required to prevent double credit`
        };
      }

      const normEntryCurrency = (s.currency || '').trim().toUpperCase();
      const refMatch = isSameRefund;
      const provMatch = expectedProviderRefundId ? s.razorpayRefundId === expectedProviderRefundId : true;
      const amtMatch = typeof s.amount === 'number' && Math.abs(s.amount - expectedAmount) < 0.01;
      const curMatch = normExpectedCurrency ? normEntryCurrency === normExpectedCurrency : true;

      if (refMatch && provMatch && amtMatch && curMatch) {
        matches.push(s);
        continue;
      }

      // Conflicting entry
      if (expectedProviderRefundId && s.razorpayRefundId && s.razorpayRefundId !== expectedProviderRefundId) {
        return {
          conflict: `Settlement ledger conflict: provider refund ID ${s.razorpayRefundId} does not match expected ${expectedProviderRefundId}`
        };
      }
      if (!amtMatch) {
        return {
          conflict: `Settlement ledger conflict: amount ₹${s.amount} does not match expected ₹${expectedAmount}`
        };
      }
      if (!curMatch) {
        return {
          conflict: `Settlement ledger conflict: currency ${s.currency} does not match expected ${expectedCurrency}`
        };
      }
      if (!refMatch) {
        return {
          conflict: `Settlement ledger conflict: provider refund ID ${s.razorpayRefundId} already bound to different refund ${s.refundId}`
        };
      }
    }
  }

  if (matches.length > 1) {
    return {
      conflict: `Duplicate matching settlement entries found in ledger for refund ${targetRefundId}`
    };
  }

  if (matches.length === 1) {
    return { match: matches[0] };
  }

  return {};
}
/**
 * Shared atomic state machine for Payment refund reservations.
 * Enforces exactly-once accounting across immediate responses, webhooks, and recovery:
 * - PENDING  -> RELEASED: Decrements pendingRefundAmount once.
 * - PENDING  -> CONSUMED: Decrements pendingRefundAmount once, increments refundedAmount once.
 * - RELEASED -> CONSUMED: Increments refundedAmount once; does NOT decrement pending again.
 *                         Detects over-commitment if another reservation took the released balance.
 * - CONSUMED -> CONSUMED: Safe idempotent no-op.
 * - CONSUMED -> RELEASED: Strictly forbidden.
 */
export async function transitionPaymentReservation({
  paymentId,
  refundId,
  reservationId,
  amount,
  targetState,
  session = null,
  attemptNumber,
  razorpayRefundId
}: TransitionReservationParams): Promise<TransitionReservationResult> {
  const pId = new mongoose.Types.ObjectId(paymentId);
  const rId = new mongoose.Types.ObjectId(refundId);
  const resId = reservationId || rId.toString();

  const payment = await Payment.findById(pId).session(session || null);
  if (!payment) {
    return {
      success: false,
      outcome: 'PAYMENT_MISSING',
      previousState: 'NOT_FOUND',
      newState: 'UNCHANGED',
      pendingAdjusted: 0,
      refundedAdjusted: 0,
      overCommitmentDetected: false,
      overCommitmentAmount: 0,
      error: 'Payment document not found'
    };
  }

  const expectedPaise = Math.round(amount * 100);

  // Exact reservation selection: match reservationId (if provided), refundId, attemptNumber (if provided), and amount on the SAME reservation object.
  // Never substitute an attempt number from another reservation.
  let existingRes = (payment.refundReservations || []).find((r) => {
    const resIdMatches = reservationId
      ? r.reservationId === reservationId
      : (r.reservationId === rId.toString() || !r.reservationId);
    const refundIdMatches = Boolean(r.refundId && r.refundId.toString() === rId.toString());
    const attemptMatches = attemptNumber !== undefined ? r.attemptNumber === attemptNumber : true;
    const amountMatches = typeof r.amount === 'number' && Math.round(r.amount * 100) === expectedPaise;

    return resIdMatches && refundIdMatches && attemptMatches && amountMatches;
  });

  if (!existingRes && !reservationId) {
    existingRes = (payment.refundReservations || []).find((r) => {
      const refundIdMatches = Boolean(r.refundId && r.refundId.toString() === rId.toString());
      const attemptMatches = attemptNumber !== undefined ? r.attemptNumber === attemptNumber : true;
      const amountMatches = typeof r.amount === 'number' && Math.round(r.amount * 100) === expectedPaise;

      return refundIdMatches && attemptMatches && amountMatches;
    });
  }

  const targetResId = existingRes?.reservationId || reservationId || resId;
  const targetRefundId = new mongoose.Types.ObjectId(existingRes?.refundId || rId);
  const targetAttemptNumber = existingRes ? existingRes.attemptNumber : (attemptNumber !== undefined ? attemptNumber : 1);
  const targetAmount = existingRes?.amount || amount;
  let previousState: 'PENDING' | 'RELEASED' | 'CONSUMED' | 'NOT_FOUND' = existingRes
    ? existingRes.status
    : 'NOT_FOUND';


  if (targetState === 'RELEASED') {
    if (previousState === 'CONSUMED') {
      return {
        success: false,
        outcome: 'BALANCE_CONFLICT',
        previousState: 'CONSUMED',
        newState: 'UNCHANGED',
        pendingAdjusted: 0,
        refundedAdjusted: 0,
        overCommitmentDetected: false,
        overCommitmentAmount: 0,
        error: 'CONSUMED reservation cannot be transitioned to RELEASED'
      };
    }
    if (previousState === 'RELEASED') {
      // Idempotent duplicate release: do NOT decrement pending again!
      return {
        success: true,
        outcome: 'ALREADY_APPLIED',
        previousState: 'RELEASED',
        newState: 'UNCHANGED',
        pendingAdjusted: 0,
        refundedAdjusted: 0,
        overCommitmentDetected: false,
        overCommitmentAmount: 0,
        paymentDoc: payment
      };
    }

    if (previousState === 'PENDING') {
      const updatedPayment = await Payment.findOneAndUpdate(
        {
          _id: pId,
          pendingRefundAmount: { $gte: amount },
          refundReservations: {
            $elemMatch: {
              reservationId: targetResId,
              refundId: targetRefundId,
              attemptNumber: targetAttemptNumber,
              amount: targetAmount,
              status: 'PENDING'
            }
          }
        },
        {
          $inc: { pendingRefundAmount: -amount },
          $set: {
            'refundReservations.$.status': 'RELEASED',
            'refundReservations.$.updatedAt': new Date()
          }
        },
        { session: session || undefined, returnDocument: 'after' }
      );

      if (updatedPayment) {
        return {
          success: true,
          outcome: 'APPLIED',
          previousState: 'PENDING',
          newState: 'RELEASED',
          pendingAdjusted: -amount,
          refundedAdjusted: 0,
          overCommitmentDetected: false,
          overCommitmentAmount: 0,
          paymentDoc: updatedPayment
        };
      }

      // findOneAndUpdate returned null: read latest state
      const freshP = await Payment.findById(pId).session(session || null);
      const freshRes = (freshP?.refundReservations || []).find(
        r => r.reservationId === targetResId &&
             r.refundId?.toString() === targetRefundId.toString() &&
             r.attemptNumber === targetAttemptNumber &&
             Math.abs(r.amount - targetAmount) < 0.01
      );
      if (freshRes?.status === 'RELEASED') {
        return {
          success: true,
          outcome: 'ALREADY_APPLIED',
          previousState: 'PENDING',
          newState: 'RELEASED',
          pendingAdjusted: 0,
          refundedAdjusted: 0,
          overCommitmentDetected: false,
          overCommitmentAmount: 0,
          paymentDoc: freshP || undefined
        };
      }

      if (freshP && freshP.pendingRefundAmount < amount) {
        await Payment.updateOne(
          { _id: pId },
          {
            $set: {
              reconciliationRequired: true,
              reconciliationReason: `Balance conflict: aggregate pending balance ₹${freshP.pendingRefundAmount} is less than release amount ₹${amount} for refund ${rId}`
            }
          },
          { session: session || undefined }
        );
        return {
          success: false,
          outcome: 'BALANCE_CONFLICT',
          previousState: 'PENDING',
          newState: 'UNCHANGED',
          pendingAdjusted: 0,
          refundedAdjusted: 0,
          overCommitmentDetected: false,
          overCommitmentAmount: 0,
          paymentDoc: freshP,
          error: 'Insufficient aggregate pending balance to apply release'
        };
      }

      return {
        success: false,
        outcome: 'DATABASE_ERROR',
        previousState: 'PENDING',
        newState: 'UNCHANGED',
        pendingAdjusted: 0,
        refundedAdjusted: 0,
        overCommitmentDetected: false,
        overCommitmentAmount: 0,
        paymentDoc: freshP || undefined,
        error: 'Database update failed to transition reservation'
      };
    }
    // Reservation was not found for RELEASED target state.
    // Distinguish exact reservation, related-but-conflicting reservation, and genuinely absent reservation.
    const relatedReservations = (payment.refundReservations || []).filter(r =>
      Boolean(r.refundId && r.refundId.toString() === rId.toString()) ||
      (reservationId ? r.reservationId === reservationId : false)
    );

    const activeRefundCount = await Refund.countDocuments({
      paymentId: pId,
      status: { $in: ['PENDING', 'PROCESSING', 'UNKNOWN'] }
    }).session(session || null);

    let outcome: TransitionOutcome;
    if (relatedReservations.length > 0) {
      outcome = 'BALANCE_CONFLICT';
    } else if (activeRefundCount > 1) {
      outcome = 'OWNERSHIP_AMBIGUOUS';
    } else {
      outcome = 'RESERVATION_NOT_FOUND';
    }

    const notFoundUpdated = await Payment.findOneAndUpdate(
      { _id: pId },
      {
        $set: {
          reconciliationRequired: true,
          reconciliationReason: relatedReservations.length > 0
            ? `Contradictory reservation exists for refund ${rId} (₹${amount}) with conflicting attempt or amount during release; preserved aggregate pending balance ₹${payment.pendingRefundAmount}`
            : `Missing reservation for refund ${rId} (₹${amount}) during release; preserved aggregate pending balance ₹${payment.pendingRefundAmount}`
        }
      },
      { session: session || undefined, returnDocument: 'after' }
    );

    return {
      success: false,
      outcome,
      previousState: 'NOT_FOUND',
      newState: 'UNCHANGED',
      pendingAdjusted: 0,
      refundedAdjusted: 0,
      overCommitmentDetected: false,
      overCommitmentAmount: 0,
      paymentDoc: notFoundUpdated || payment,
      error: `Reservation missing and ownership cannot be established for refund ${rId} (₹${amount})`
    };
  }

  // targetState === 'CONSUMED'
  if (previousState === 'CONSUMED') {
    // Idempotent duplicate: already consumed
    return {
      success: true,
      outcome: 'ALREADY_APPLIED',
      previousState: 'CONSUMED',
      newState: 'UNCHANGED',
      pendingAdjusted: 0,
      refundedAdjusted: 0,
      overCommitmentDetected: false,
      overCommitmentAmount: 0,
      paymentDoc: payment
    };
  }
  if (previousState === 'PENDING') {
    let expectedProvId = razorpayRefundId;
    if (!expectedProvId) {
      const rDoc = await Refund.findById(rId).session(session || null);
      expectedProvId = rDoc?.razorpayRefundId;
    }

    const settlementCheck = findExactSettlementRecord(payment.settledRefunds, targetRefundId, amount, payment.currency, expectedProvId);

    if (settlementCheck.conflict) {
      await Payment.updateOne(
        { _id: pId },
        {
          $set: {
            reconciliationRequired: true,
            reconciliationReason: settlementCheck.conflict
          }
        },
        { session: session || undefined }
      );
      payment.reconciliationRequired = true;
      return {
        success: false,
        outcome: 'BALANCE_CONFLICT',
        previousState: 'PENDING',
        newState: 'UNCHANGED',
        pendingAdjusted: 0,
        refundedAdjusted: 0,
        overCommitmentDetected: false,
        overCommitmentAmount: 0,
        paymentDoc: payment,
        error: settlementCheck.conflict
      };
    }

    const priorSettlement = settlementCheck.match;
    let creditApplied = !priorSettlement;
    let updatedPayment: IPayment | null = null;

    if (creditApplied) {
      updatedPayment = await Payment.findOneAndUpdate(
        {
          _id: pId,
          pendingRefundAmount: { $gte: amount },
          'settledRefunds.refundId': { $ne: targetRefundId },
          refundReservations: {
            $elemMatch: {
              reservationId: targetResId,
              refundId: targetRefundId,
              attemptNumber: targetAttemptNumber,
              amount: targetAmount,
              status: 'PENDING'
            }
          }
        },
        {
          $inc: {
            pendingRefundAmount: -amount,
            refundedAmount: amount
          },
          $set: {
            'refundReservations.$.status': 'CONSUMED',
            'refundReservations.$.updatedAt': new Date()
          }
        },
        { session: session || undefined, returnDocument: 'after' }
      );
    } else {
      updatedPayment = await Payment.findOneAndUpdate(
        {
          _id: pId,
          pendingRefundAmount: { $gte: amount },
          refundReservations: {
            $elemMatch: {
              reservationId: targetResId,
              refundId: targetRefundId,
              attemptNumber: targetAttemptNumber,
              amount: targetAmount,
              status: 'PENDING'
            }
          }
        },
        {
          $inc: {
            pendingRefundAmount: -amount
          },
          $set: {
            'refundReservations.$.status': 'CONSUMED',
            'refundReservations.$.updatedAt': new Date()
          }
        },
        { session: session || undefined, returnDocument: 'after' }
      );
    }

    if (!updatedPayment) {
      // Retry behavior: Re-read latest Payment, reservation, and settlement ledger
      const freshP = await Payment.findById(pId).session(session || null);
      if (!freshP) {
        return {
          success: false,
          outcome: 'PAYMENT_MISSING',
          previousState: 'PENDING',
          newState: 'UNCHANGED',
          pendingAdjusted: 0,
          refundedAdjusted: 0,
          overCommitmentDetected: false,
          overCommitmentAmount: 0,
          error: 'Payment document not found during retry'
        };
      }

      const freshRes = (freshP.refundReservations || []).find(
        r => r.reservationId === targetResId &&
             r.refundId?.toString() === targetRefundId.toString() &&
             r.attemptNumber === targetAttemptNumber &&
             Math.abs(r.amount - targetAmount) < 0.01
      );
      const freshPriorSettlement = findExactSettlementRecord(freshP.settledRefunds, targetRefundId, amount, freshP.currency, expectedProvId);
      if (freshRes?.status === 'CONSUMED') {
        return {
          success: true,
          outcome: 'ALREADY_APPLIED',
          previousState: 'PENDING',
          newState: 'CONSUMED',
          pendingAdjusted: 0,
          refundedAdjusted: 0,
          overCommitmentDetected: false,
          overCommitmentAmount: 0,
          paymentDoc: freshP
        };
      }

      if (freshRes?.status === 'RELEASED') {
        previousState = 'RELEASED';
      } else if (freshPriorSettlement.match) {
        // Exact matching settlement ledger proves prior credit! Perform only required hold transition
        if (freshP.pendingRefundAmount >= amount) {
          updatedPayment = await Payment.findOneAndUpdate(
            {
              _id: pId,
              pendingRefundAmount: { $gte: amount },
              refundReservations: {
                $elemMatch: {
                  reservationId: targetResId,
                  refundId: targetRefundId,
                  attemptNumber: targetAttemptNumber,
                  amount: targetAmount,
                  status: 'PENDING'
                }
              }
            },
            {
              $inc: { pendingRefundAmount: -amount },
              $set: {
                'refundReservations.$.status': 'CONSUMED',
                'refundReservations.$.updatedAt': new Date()
              }
            },
            { session: session || undefined, returnDocument: 'after' }
          );
          if (updatedPayment) {
            creditApplied = false;
          }
        }
      } else if (freshRes?.status === 'PENDING') {
        if (freshP.pendingRefundAmount < amount) {
          await Payment.updateOne(
            { _id: pId },
            {
              $set: {
                reconciliationRequired: true,
                reconciliationReason: `Balance conflict: aggregate pending balance ₹${freshP.pendingRefundAmount} is less than consumed amount ₹${amount} for refund ${rId}`
              }
            },
            { session: session || undefined }
          );
          return {
            success: false,
            outcome: 'BALANCE_CONFLICT',
            previousState: 'PENDING',
            newState: 'UNCHANGED',
            pendingAdjusted: 0,
            refundedAdjusted: 0,
            overCommitmentDetected: false,
            overCommitmentAmount: 0,
            paymentDoc: freshP,
            error: 'Insufficient aggregate pending balance to apply consumption'
          };
        } else {
          // Retry credit-bearing compare-and-set ONCE
          updatedPayment = await Payment.findOneAndUpdate(
            {
              _id: pId,
              pendingRefundAmount: { $gte: amount },
              'settledRefunds.refundId': { $ne: targetRefundId },
              refundReservations: {
                $elemMatch: {
                  reservationId: targetResId,
                  refundId: targetRefundId,
                  attemptNumber: targetAttemptNumber,
                  amount: targetAmount,
                  status: 'PENDING'
                }
              }
            },
            {
              $inc: {
                pendingRefundAmount: -amount,
                refundedAmount: amount
              },
              $set: {
                'refundReservations.$.status': 'CONSUMED',
                'refundReservations.$.updatedAt': new Date()
              }
            },
            { session: session || undefined, returnDocument: 'after' }
          );
          if (updatedPayment) {
            creditApplied = true;
          }
        }
      }

      if (!updatedPayment && previousState !== 'RELEASED') {
        return {
          success: false,
          outcome: 'DATABASE_ERROR',
          previousState: 'PENDING',
          newState: 'UNCHANGED',
          pendingAdjusted: 0,
          refundedAdjusted: 0,
          overCommitmentDetected: false,
          overCommitmentAmount: 0,
          paymentDoc: freshP,
          error: 'Database update failed to transition reservation'
        };
      }
    }
    if (updatedPayment) {
      let overCommitmentDetected = false;
      let overCommitmentAmount = 0;
      const totalCommitted = (updatedPayment.refundedAmount || 0) + (updatedPayment.pendingRefundAmount || 0);
      if (totalCommitted > updatedPayment.amount) {
        overCommitmentDetected = true;
        overCommitmentAmount = totalCommitted - updatedPayment.amount;
        await Payment.updateOne(
          { _id: pId },
          {
            $set: {
              reconciliationRequired: true,
              reconciliationReason: `Over-commitment: total committed ₹${totalCommitted.toFixed(2)} exceeds captured payment amount ₹${updatedPayment.amount.toFixed(2)}`
            }
          },
          { session: session || undefined }
        );
        updatedPayment.reconciliationRequired = true;
      }

      return {
        success: true,
        outcome: 'APPLIED',
        previousState: 'PENDING',
        newState: 'CONSUMED',
        pendingAdjusted: -amount,
        refundedAdjusted: creditApplied ? amount : 0,
        overCommitmentDetected,
        overCommitmentAmount,
        paymentDoc: updatedPayment
      };
    }
  }

  if (previousState === 'RELEASED') {
    let expectedProvId = razorpayRefundId;
    if (!expectedProvId) {
      const rDoc = await Refund.findById(rId).session(session || null);
      expectedProvId = rDoc?.razorpayRefundId;
    }

    const settlementCheck = findExactSettlementRecord(payment.settledRefunds, targetRefundId, amount, payment.currency, expectedProvId);

    if (settlementCheck.conflict) {
      await Payment.updateOne(
        { _id: pId },
        {
          $set: {
            reconciliationRequired: true,
            reconciliationReason: settlementCheck.conflict
          }
        },
        { session: session || undefined }
      );
      payment.reconciliationRequired = true;
      return {
        success: false,
        outcome: 'BALANCE_CONFLICT',
        previousState: 'RELEASED',
        newState: 'UNCHANGED',
        pendingAdjusted: 0,
        refundedAdjusted: 0,
        overCommitmentDetected: false,
        overCommitmentAmount: 0,
        paymentDoc: payment,
        error: settlementCheck.conflict
      };
    }

    const priorSettlement = settlementCheck.match;
    let creditApplied = !priorSettlement;
    let updatedPayment: IPayment | null = null;

    if (creditApplied) {
      updatedPayment = await Payment.findOneAndUpdate(
        {
          _id: pId,
          'settledRefunds.refundId': { $ne: targetRefundId },
          refundReservations: {
            $elemMatch: {
              reservationId: targetResId,
              refundId: targetRefundId,
              attemptNumber: targetAttemptNumber,
              amount: targetAmount,
              status: 'RELEASED'
            }
          }
        },
        {
          $inc: { refundedAmount: amount },
          $set: {
            'refundReservations.$.status': 'CONSUMED',
            'refundReservations.$.updatedAt': new Date()
          }
        },
        { session: session || undefined, returnDocument: 'after' }
      );
    } else {
      updatedPayment = await Payment.findOneAndUpdate(
        {
          _id: pId,
          refundReservations: {
            $elemMatch: {
              reservationId: targetResId,
              refundId: targetRefundId,
              attemptNumber: targetAttemptNumber,
              amount: targetAmount,
              status: 'RELEASED'
            }
          }
        },
        {
          $set: {
            'refundReservations.$.status': 'CONSUMED',
            'refundReservations.$.updatedAt': new Date()
          }
        },
        { session: session || undefined, returnDocument: 'after' }
      );
    }

    if (!updatedPayment) {
      const freshP = await Payment.findById(pId).session(session || null);
      if (!freshP) {
        return {
          success: false,
          outcome: 'PAYMENT_MISSING',
          previousState: 'RELEASED',
          newState: 'UNCHANGED',
          pendingAdjusted: 0,
          refundedAdjusted: 0,
          overCommitmentDetected: false,
          overCommitmentAmount: 0,
          error: 'Payment document not found during retry'
        };
      }

      const freshRes = (freshP.refundReservations || []).find(
        r => r.reservationId === targetResId &&
             r.refundId?.toString() === targetRefundId.toString() &&
             r.attemptNumber === targetAttemptNumber &&
             Math.abs(r.amount - targetAmount) < 0.01
      );
      const freshPriorSettlement = findExactSettlementRecord(freshP.settledRefunds, targetRefundId, amount, freshP.currency, expectedProvId);
      if (freshRes?.status === 'CONSUMED') {
        return {
          success: true,
          outcome: 'ALREADY_APPLIED',
          previousState: 'RELEASED',
          newState: 'CONSUMED',
          pendingAdjusted: 0,
          refundedAdjusted: 0,
          overCommitmentDetected: false,
          overCommitmentAmount: 0,
          paymentDoc: freshP
        };
      }
      if (freshPriorSettlement.match) {
        updatedPayment = await Payment.findOneAndUpdate(
          {
            _id: pId,
            refundReservations: {
              $elemMatch: {
                reservationId: targetResId,
                refundId: targetRefundId,
                attemptNumber: targetAttemptNumber,
                amount: targetAmount,
                status: 'RELEASED'
              }
            }
          },
          {
            $set: {
              'refundReservations.$.status': 'CONSUMED',
              'refundReservations.$.updatedAt': new Date()
            }
          },
          { session: session || undefined, returnDocument: 'after' }
        );
        if (updatedPayment) {
          creditApplied = false;
        }
      } else if (freshRes?.status === 'RELEASED') {
        updatedPayment = await Payment.findOneAndUpdate(
          {
            _id: pId,
            'settledRefunds.refundId': { $ne: targetRefundId },
            refundReservations: {
              $elemMatch: {
                reservationId: targetResId,
                refundId: targetRefundId,
                attemptNumber: targetAttemptNumber,
                amount: targetAmount,
                status: 'RELEASED'
              }
            }
          },
          {
            $inc: { refundedAmount: amount },
            $set: {
              'refundReservations.$.status': 'CONSUMED',
              'refundReservations.$.updatedAt': new Date()
            }
          },
          { session: session || undefined, returnDocument: 'after' }
        );
        if (updatedPayment) {
          creditApplied = true;
        }
      }

      if (!updatedPayment) {
        return {
          success: false,
          outcome: 'DATABASE_ERROR',
          previousState: 'RELEASED',
          newState: 'UNCHANGED',
          pendingAdjusted: 0,
          refundedAdjusted: 0,
          overCommitmentDetected: false,
          overCommitmentAmount: 0,
          paymentDoc: freshP,
          error: 'Database update failed to transition released reservation'
        };
      }
    }

    let overCommitmentDetected = false;
    let overCommitmentAmount = 0;
    if (updatedPayment) {
      const totalCommitted = (updatedPayment.refundedAmount || 0) + (updatedPayment.pendingRefundAmount || 0);
      if (totalCommitted > updatedPayment.amount) {
        overCommitmentDetected = true;
        overCommitmentAmount = totalCommitted - updatedPayment.amount;
        await Payment.updateOne(
          { _id: pId },
          {
            $set: {
              reconciliationRequired: true,
              reconciliationReason: `Over-commitment detected: late success of refund ${rId} after release created total committed ₹${totalCommitted.toFixed(2)} > captured ₹${updatedPayment.amount.toFixed(2)}`
            }
          },
          { session: session || undefined }
        );
        updatedPayment.reconciliationRequired = true;
      }
    }

    return {
      success: true,
      outcome: 'APPLIED',
      previousState: 'RELEASED',
      newState: 'CONSUMED',
      pendingAdjusted: 0,
      refundedAdjusted: creditApplied ? amount : 0,
      overCommitmentDetected,
      overCommitmentAmount,
      paymentDoc: updatedPayment
    };
  }
  // Reservation was not found for CONSUMED target state.
  // Distinguish exact reservation, related-but-conflicting reservation, and genuinely absent reservation.
  const relatedReservations = (payment.refundReservations || []).filter(r =>
    Boolean(r.refundId && r.refundId.toString() === rId.toString()) ||
    (reservationId ? r.reservationId === reservationId : false)
  );

  const activeRefundCount = await Refund.countDocuments({
    paymentId: pId,
    status: { $in: ['PENDING', 'PROCESSING', 'UNKNOWN'] }
  }).session(session || null);

  let outcome: TransitionOutcome;
  if (relatedReservations.length > 0) {
    outcome = 'BALANCE_CONFLICT';
  } else if (activeRefundCount > 1) {
    outcome = 'OWNERSHIP_AMBIGUOUS';
  } else {
    outcome = 'RESERVATION_NOT_FOUND';
  }

  const notFoundUpdated = await Payment.findOneAndUpdate(
    { _id: pId },
    {
      $set: {
        reconciliationRequired: true,
        reconciliationReason: relatedReservations.length > 0
          ? `Contradictory reservation exists for refund ${rId} (₹${amount}) with conflicting attempt or amount during consumption; preserved pending hold for reconciliation`
          : `Reservation not found for refund ${rId} (₹${amount}) during consumption; pending hold preserved for reconciliation`
      }
    },
    { session: session || undefined, returnDocument: 'after' }
  );

  return {
    success: false,
    outcome,
    previousState: 'NOT_FOUND',
    newState: 'UNCHANGED',
    pendingAdjusted: 0,
    refundedAdjusted: 0,
    overCommitmentDetected: false,
    overCommitmentAmount: 0,
    paymentDoc: notFoundUpdated || payment,
    error: `Reservation missing and ownership cannot be established for refund ${rId} (₹${amount})`
  };
}

/**
 * Synchronizes ReturnRequest state with a refund outcome in an atomic, attempt-isolated manner.
 * Ensures:
 * - ReturnRequest belongs to the exact Refund and Order.
 * - Old failed attempts cannot overwrite a successfully PROCESSED return request.
 * - Terminal state ('COMPLETED' + completedAt) is reliably set on PROCESSED refund.
 */
export async function syncReturnRequestWithRefund(params: {
  returnId: mongoose.Types.ObjectId | string;
  refundId: mongoose.Types.ObjectId | string;
  orderId: mongoose.Types.ObjectId | string;
  refundStatus: 'PROCESSED' | 'FAILED' | 'UNKNOWN' | 'PENDING';
  attemptNumber?: number;
  refundError?: string;
  session?: mongoose.ClientSession | null;
}): Promise<{ success: boolean; returnDoc?: IReturnRequest | null; reason?: string }> {
  const rId = new mongoose.Types.ObjectId(params.refundId);
  const retId = new mongoose.Types.ObjectId(params.returnId);
  const oId = new mongoose.Types.ObjectId(params.orderId);

  const retReq = await ReturnRequest.findById(retId).session(params.session || null);
  if (!retReq) {
    if (params.session) throw new AppError(`ReturnRequest ${retId} not found`, 404, 'RETURN_SYNC_FAILED');
    return { success: false, reason: `ReturnRequest ${retId} not found` };
  }

  if (retReq.orderId.toString() !== oId.toString()) {
    if (params.session) throw new AppError(`ReturnRequest ${retId} orderId mismatch (expected ${oId}, got ${retReq.orderId})`, 400, 'RETURN_SYNC_FAILED');
    return { success: false, reason: `ReturnRequest ${retId} orderId mismatch (expected ${oId}, got ${retReq.orderId})` };
  }

  // 2. Prevent older attempts from downgrading or overwriting a successfully PROCESSED return request
  if (retReq.refundStatus === 'PROCESSED' && params.refundStatus !== 'PROCESSED') {
    return { success: false, returnDoc: retReq, reason: 'ReturnRequest already PROCESSED; ignoring downgrade' };
  }

  // 3. Conditional atomic update based on target status
  if (params.refundStatus === 'PROCESSED') {
    // 1. Check for idempotent already-completed replay first (Defect D1)
    const isSameRefund = Boolean(retReq.refundId && retReq.refundId.toString() === rId.toString());
    const isSameAttempt = typeof params.attemptNumber === 'number'
      ? retReq.refundAttempt === params.attemptNumber
      : true;
    if (retReq.status === 'COMPLETED' && retReq.refundStatus === 'PROCESSED' && isSameRefund && isSameAttempt && retReq.inventoryRestored) {
      return { success: true, returnDoc: retReq, reason: 'ReturnRequest already COMPLETED' };
    }

    // 2. Eligibility verification: Must be ACCEPTED before starting completion or inventory restoration (Defect D1)
    if (retReq.status !== 'ACCEPTED') {
      if (params.session) throw new AppError(`Cannot complete ReturnRequest in ${retReq.status} state; must be ACCEPTED`, 400, 'RETURN_SYNC_FAILED');
      return {
        success: false,
        returnDoc: retReq,
        reason: `Cannot complete ReturnRequest in ${retReq.status} state; must be ACCEPTED`
      };
    }

    // 3. Verify attempt ownership eligibility
    if (retReq.refundId && retReq.refundId.toString() !== rId.toString()) {
      const isPrevFailed = retReq.refundStatus === 'FAILED';
      const isNewerAttempt = typeof params.attemptNumber === 'number' && typeof retReq.refundAttempt === 'number'
        ? params.attemptNumber > retReq.refundAttempt
        : false;
      if (!isPrevFailed || !isNewerAttempt) {
        if (params.session) throw new AppError('Ownership conflict: different refund ID cannot claim non-failed or older ReturnRequest', 400, 'RETURN_SYNC_FAILED');
        return {
          success: false,
          returnDoc: retReq,
          reason: 'Ownership conflict: different refund ID cannot claim non-failed or older ReturnRequest'
        };
      }
    } else if (typeof params.attemptNumber === 'number' && typeof retReq.refundAttempt === 'number' && params.attemptNumber < retReq.refundAttempt) {
      if (params.session) throw new AppError('Ownership conflict: older attempt cannot overwrite newer attempt', 400, 'RETURN_SYNC_FAILED');
      return {
        success: false,
        returnDoc: retReq,
        reason: 'Ownership conflict: older attempt cannot overwrite newer attempt'
      };
    }

    // 4. Complete ReturnRequest and inventory in ONE transaction (Defect D3)
    const session = params.session || await mongoose.startSession();
    const ownsSession = !params.session;
    if (ownsSession) {
      session.startTransaction();
    }

    try {
      const lockedRet = await ReturnRequest.findById(retId).session(session);
      if (!lockedRet || lockedRet.status !== 'ACCEPTED' || lockedRet.orderId.toString() !== oId.toString()) {
        if (ownsSession) await session.abortTransaction();
        if (!ownsSession) {
          throw new AppError('ReturnRequest state changed or not eligible in transaction', 400, 'RETURN_SYNC_FAILED');
        }
        return { success: false, returnDoc: lockedRet, reason: 'ReturnRequest state changed or not eligible in transaction' };
      }
      // Revalidate attempt ownership eligibility inside transaction (Requirement 9 & 10)
      if (lockedRet.refundId && lockedRet.refundId.toString() !== rId.toString()) {
        const isPrevFailed = lockedRet.refundStatus === 'FAILED';
        const isNewerAttempt = typeof params.attemptNumber === 'number' && typeof lockedRet.refundAttempt === 'number'
          ? params.attemptNumber > lockedRet.refundAttempt
          : false;
        if (!isPrevFailed || !isNewerAttempt) {
          if (ownsSession) await session.abortTransaction();
          if (!ownsSession) {
            throw new AppError('Ownership conflict: different refund ID cannot claim non-failed or older ReturnRequest in transaction', 400, 'RETURN_SYNC_FAILED');
          }
          return {
            success: false,
            returnDoc: lockedRet,
            reason: 'Ownership conflict: different refund ID cannot claim non-failed or older ReturnRequest in transaction'
          };
        }
      } else if (typeof params.attemptNumber === 'number' && typeof lockedRet.refundAttempt === 'number' && params.attemptNumber < lockedRet.refundAttempt) {
        if (ownsSession) await session.abortTransaction();
        if (!ownsSession) {
          throw new AppError('Ownership conflict: older attempt cannot overwrite newer attempt in transaction', 400, 'RETURN_SYNC_FAILED');
        }
        return {
          success: false,
          returnDoc: lockedRet,
          reason: 'Ownership conflict: older attempt cannot overwrite newer attempt in transaction'
        };
      }

      // Restore inventory using the SAME transaction session
      if (!lockedRet.inventoryRestored) {
        const invRes = await InventoryAllocationService.restoreReturnInventory(lockedRet, oId, { session });
        if (invRes.requiresReconciliation) {
          if (ownsSession) await session.abortTransaction();
          if (!ownsSession) {
            throw new AppError('Inventory reconciliation required', 400, 'RETURN_SYNC_FAILED');
          }
          return { success: false, returnDoc: lockedRet, reason: 'Inventory reconciliation required' };
        }
      }

      let transferCondition: Record<string, unknown>;
      if (typeof params.attemptNumber === 'number') {
        transferCondition = {
          $or: [
            { refundId: rId, refundAttempt: params.attemptNumber },
            { refundId: rId, refundAttempt: { $exists: false } },
            { refundId: rId, refundAttempt: null },
            { refundId: { $exists: false } },
            { refundId: null },
            { refundStatus: 'FAILED', refundAttempt: { $lt: params.attemptNumber } }
          ]
        };
      } else {
        transferCondition = {
          $or: [
            { refundId: rId },
            { refundId: { $exists: false } },
            { refundId: null }
          ]
        };
      }

      const updateFilter: Record<string, unknown> = {
        _id: retId,
        orderId: oId,
        status: 'ACCEPTED',
        ...transferCondition
      };
      const updateRes = await ReturnRequest.updateOne(
        updateFilter,
        {
          $set: {
            status: 'COMPLETED',
            completedAt: new Date(),
            refundId: rId,
            refundStatus: 'PROCESSED',
            ...(typeof params.attemptNumber === 'number' ? { refundAttempt: params.attemptNumber } : {}),
            inventoryRestored: true,
            inventoryRestoredAt: lockedRet.inventoryRestoredAt || new Date()
          },
          $unset: {
            refundClaimToken: 1,
            refundClaimExpiresAt: 1
          }
        },
        { session }
      );

      if (updateRes.matchedCount === 0) {
        if (ownsSession) await session.abortTransaction();
        if (!ownsSession) {
          throw new AppError('ReturnRequest completion update matched 0 documents due to status or ownership conflict', 400, 'RETURN_SYNC_FAILED');
        }
        return { success: false, reason: 'ReturnRequest completion update matched 0 documents due to status or ownership conflict' };
      }

      const persisted = await ReturnRequest.findById(retId).session(session);
      if (!persisted) {
        if (ownsSession) await session.abortTransaction();
        if (!ownsSession) {
          throw new AppError('ReturnRequest missing after update', 400, 'RETURN_SYNC_FAILED');
        }
        return { success: false, reason: 'ReturnRequest missing after update' };
      }

      const correctId = persisted._id.toString() === retId.toString();
      const correctOrder = persisted.orderId.toString() === oId.toString();
      const correctRefund = persisted.refundId?.toString() === rId.toString();
      const correctAttempt = typeof params.attemptNumber === 'number'
        ? persisted.refundAttempt === params.attemptNumber
        : true;
      const isProcessed = persisted.refundStatus === 'PROCESSED';
      const isCompleted = persisted.status === 'COMPLETED';
      const isRestored = persisted.inventoryRestored === true;

      if (!correctId || !correctOrder || !correctRefund || !correctAttempt || !isProcessed || !isCompleted || !isRestored) {
        if (ownsSession) await session.abortTransaction();
        if (!ownsSession) {
          throw new AppError('Terminal verification failed on ReturnRequest', 400, 'RETURN_SYNC_FAILED');
        }
        return {
          success: false,
          returnDoc: persisted,
          reason: `Terminal verification failed on ReturnRequest (idMatch: ${correctId}, orderMatch: ${correctOrder}, refundMatch: ${correctRefund}, attemptMatch: ${correctAttempt}, isProcessed: ${isProcessed}, isCompleted: ${isCompleted}, isRestored: ${isRestored})`
        };
      }

      if (ownsSession) {
        await session.commitTransaction();
      }
      return { success: true, returnDoc: persisted };
    } catch (txErr: unknown) {
      if (ownsSession && session.inTransaction()) {
        try {
          await session.abortTransaction();
        } catch {}
      }
      if (!ownsSession) {
        throw txErr;
      }
      const msg = txErr instanceof Error ? txErr.message : String(txErr);
      return { success: false, returnDoc: retReq, reason: `Transactional return completion failed: ${msg}` };
    } finally {
      if (ownsSession) {
        await session.endSession();
      }
    }

  } else if (params.refundStatus === 'FAILED') {
    if (retReq.refundStatus === 'PROCESSED') {
      return { success: false, returnDoc: retReq, reason: 'ReturnRequest already PROCESSED; ignoring downgrade' };
    }

    const isCurrentAttempt = retReq.refundId ? retReq.refundId.toString() === rId.toString() : true;
    const isOlderAttempt = Boolean(
      retReq.refundAttempt && params.attemptNumber && params.attemptNumber < retReq.refundAttempt
    );

    if (isOlderAttempt || (retReq.refundId && !isCurrentAttempt)) {
      if (params.session) throw new AppError('Ownership conflict: older or competing attempt cannot mark ReturnRequest FAILED', 400, 'RETURN_SYNC_FAILED');
      return { success: false, returnDoc: retReq, reason: 'Ownership conflict: older or competing attempt cannot mark ReturnRequest FAILED' };
    }

    const updateRes = await ReturnRequest.updateOne(
      {
        _id: retId,
        orderId: oId,
        refundStatus: { $ne: 'PROCESSED' },
        $or: [
          { refundId: rId },
          { refundId: { $exists: false } },
          { refundId: null }
        ]
      },
      {
        $set: {
          refundStatus: 'FAILED',
          refundError: params.refundError
        },
        $unset: {
          refundClaimToken: 1,
          refundClaimExpiresAt: 1
        }
      },
      { session: params.session || undefined }
    );

    if (updateRes.matchedCount === 0) {
      const persistedCheck = await ReturnRequest.findById(retId).session(params.session || null);
      if (persistedCheck?.refundStatus === 'PROCESSED') {
        return { success: false, returnDoc: persistedCheck, reason: 'ReturnRequest already PROCESSED' };
      }
      if (params.session) throw new AppError('ReturnRequest FAILED update matched 0 documents due to ownership conflict', 400, 'RETURN_SYNC_FAILED');
      return { success: false, reason: 'ReturnRequest FAILED update matched 0 documents due to ownership conflict' };
    }

    const persisted = await ReturnRequest.findById(retId).session(params.session || null);
    if (!persisted || persisted.refundStatus !== 'FAILED') {
      if (params.session) throw new AppError('Failed to verify persisted FAILED state on ReturnRequest', 400, 'RETURN_SYNC_FAILED');
      return { success: false, returnDoc: persisted, reason: 'Failed to verify persisted FAILED state on ReturnRequest' };
    }
    return { success: true, returnDoc: persisted };

  } else {
    // UNKNOWN or PENDING
    if (retReq.refundStatus === 'PROCESSED') {
      return { success: false, returnDoc: retReq, reason: 'ReturnRequest already PROCESSED; ignoring downgrade' };
    }

    const isCurrentAttempt = retReq.refundId ? retReq.refundId.toString() === rId.toString() : true;
    const isOlderAttempt = Boolean(
      retReq.refundAttempt && params.attemptNumber && params.attemptNumber < retReq.refundAttempt
    );

    if (isOlderAttempt || (retReq.refundId && !isCurrentAttempt)) {
      if (params.session) throw new AppError('Ownership conflict: older attempt cannot update ReturnRequest state', 400, 'RETURN_SYNC_FAILED');
      return { success: false, returnDoc: retReq, reason: 'Ownership conflict: older attempt cannot update ReturnRequest state' };
    }

    const updateRes = await ReturnRequest.updateOne(
      {
        _id: retId,
        orderId: oId,
        refundStatus: { $ne: 'PROCESSED' }
      },
      {
        $set: {
          refundStatus: params.refundStatus,
          ...(params.refundError ? { refundError: params.refundError } : {})
        }
      },
      { session: params.session || undefined }
    );

    if (updateRes.matchedCount === 0) {
      if (params.session) throw new AppError('ReturnRequest update matched 0 documents', 400, 'RETURN_SYNC_FAILED');
      return { success: false, reason: 'ReturnRequest update matched 0 documents' };
    }

    const persisted = await ReturnRequest.findById(retId).session(params.session || null);
    if (!persisted || persisted.refundStatus !== params.refundStatus) {
      if (params.session) throw new AppError(`Failed to verify persisted ${params.refundStatus} state on ReturnRequest`, 400, 'RETURN_SYNC_FAILED');
      return { success: false, returnDoc: persisted, reason: `Failed to verify persisted ${params.refundStatus} state on ReturnRequest` };
    }
    return { success: true, returnDoc: persisted };
  }
}
export interface SettlementPolicyResolution {
  canProceedToSettlement: boolean;
  isUnlinkedSettlement: boolean;
  settlementReason: string;
}

export interface ResolveSettlementPolicyParams {
  paymentId: mongoose.Types.ObjectId | string;
  refundId: mongoose.Types.ObjectId | string;
  transitionOutcome: TransitionOutcome;
  expectedReservationId?: string;
  expectedAttemptNumber?: number;
  expectedAmount?: number;
  expectedProviderRefundId?: string;
  expectedCurrency?: string;
  session?: mongoose.ClientSession | null;
}
/**
 * Shared settlement policy to decouple reservation hold outcomes from provider settlement accounting.
 * Enforces strict 5-dimension identity matching for DATABASE_ERROR recovery and prevents
 * ambiguous ownership from settling.
 */
export async function resolveSettlementPolicy(
  paramsOrPaymentId: ResolveSettlementPolicyParams | mongoose.Types.ObjectId | string,
  maybeRefundId?: mongoose.Types.ObjectId | string,
  maybeOutcome?: TransitionOutcome,
  maybeOptions?: { expectedReservationId?: string; expectedAttemptNumber?: number; expectedAmount?: number; expectedProviderRefundId?: string; expectedCurrency?: string; session?: mongoose.ClientSession | null }
): Promise<SettlementPolicyResolution> {
  let paymentId: mongoose.Types.ObjectId | string;
  let refundId: mongoose.Types.ObjectId | string;
  let transitionOutcome: TransitionOutcome;
  let expectedReservationId: string | undefined;
  let expectedAttemptNumber: number | undefined;
  let expectedAmount: number | undefined;
  let expectedProviderRefundId: string | undefined;
  let expectedCurrency: string | undefined;
  let session: mongoose.ClientSession | null | undefined;

  if (typeof paramsOrPaymentId === 'object' && paramsOrPaymentId !== null && 'transitionOutcome' in paramsOrPaymentId) {
    const p = paramsOrPaymentId as ResolveSettlementPolicyParams;
    paymentId = p.paymentId;
    refundId = p.refundId;
    transitionOutcome = p.transitionOutcome;
    expectedReservationId = p.expectedReservationId;
    expectedAttemptNumber = p.expectedAttemptNumber;
    expectedAmount = p.expectedAmount;
    expectedProviderRefundId = p.expectedProviderRefundId;
    expectedCurrency = p.expectedCurrency;
    session = p.session;
  } else {
    paymentId = paramsOrPaymentId as mongoose.Types.ObjectId | string;
    refundId = maybeRefundId!;
    transitionOutcome = maybeOutcome!;
    expectedReservationId = maybeOptions?.expectedReservationId;
    expectedAttemptNumber = maybeOptions?.expectedAttemptNumber;
    expectedAmount = maybeOptions?.expectedAmount;
    expectedProviderRefundId = maybeOptions?.expectedProviderRefundId;
    expectedCurrency = maybeOptions?.expectedCurrency;
    session = maybeOptions?.session;
  }

  switch (transitionOutcome) {
    case 'APPLIED':
    case 'ALREADY_APPLIED':
      return {
        canProceedToSettlement: true,
        isUnlinkedSettlement: false,
        settlementReason: 'RESERVATION_CONSUMED'
      };

    case 'RESERVATION_NOT_FOUND': {
      // Independently verified provider settlement with a genuinely missing legacy reservation (Defect B2).
      const pId = new mongoose.Types.ObjectId(paymentId);
      const rId = new mongoose.Types.ObjectId(refundId);
      const refDoc = await Refund.findById(rId).session(session || null);
      const checkPayment = await Payment.findById(pId).session(session || null);

      const hasProviderSuccess = Boolean(
        refDoc &&
        refDoc.status === 'PROCESSED' &&
        Boolean(refDoc.processedAt) &&
        refDoc.submissionState === 'CONFIRMED' &&
        refDoc.razorpayRefundId &&
        (!expectedProviderRefundId || refDoc.razorpayRefundId === expectedProviderRefundId) &&
        refDoc.paymentId.toString() === pId.toString() &&
        (typeof expectedAmount === 'number' ? Math.abs(refDoc.amount - expectedAmount) < 0.01 : true) &&
        (expectedCurrency ? refDoc.currency.toUpperCase() === expectedCurrency.toUpperCase() : true)
      );

      if (!hasProviderSuccess) {
        return {
          canProceedToSettlement: false,
          isUnlinkedSettlement: false,
          settlementReason: 'RESERVATION_NOT_FOUND_UNVERIFIED'
        };
      }

      // Check for related reservations on Payment (Defect B2)
      const relatedReservations = (checkPayment?.refundReservations || []).filter(r =>
        Boolean(r.refundId && r.refundId.toString() === rId.toString()) ||
        (expectedReservationId ? r.reservationId === expectedReservationId : false)
      );

      if (relatedReservations.length > 0) {
        // A related reservation exists but its identity or state is contradictory; cannot be classified as unlinked
        return {
          canProceedToSettlement: false,
          isUnlinkedSettlement: false,
          settlementReason: 'RESERVATION_NOT_FOUND_CONFLICT'
        };
      }

      return {
        canProceedToSettlement: true,
        isUnlinkedSettlement: true,
        settlementReason: 'RESERVATION_NOT_FOUND'
      };
    }

    case 'OWNERSHIP_AMBIGUOUS':
      // Ambiguous ownership or unverified provider correlation: MUST NOT SETTLE
      return {
        canProceedToSettlement: false,
        isUnlinkedSettlement: false,
        settlementReason: 'OWNERSHIP_AMBIGUOUS'
      };

    case 'BALANCE_CONFLICT': {
      // Defect B2 & B3: Fix BALANCE_CONFLICT classification with exact same-element ownership verification
      const pId = new mongoose.Types.ObjectId(paymentId);
      const rId = new mongoose.Types.ObjectId(refundId);
      const refDoc = await Refund.findById(rId).session(session || null);
      const checkPayment = await Payment.findById(pId).session(session || null);

      const hasProviderSuccess = Boolean(
        refDoc &&
        refDoc.status === 'PROCESSED' &&
        Boolean(refDoc.processedAt) &&
        refDoc.submissionState === 'CONFIRMED' &&
        refDoc.razorpayRefundId &&
        (!expectedProviderRefundId || refDoc.razorpayRefundId === expectedProviderRefundId) &&
        refDoc.paymentId.toString() === pId.toString() &&
        (typeof expectedAmount === 'number' ? Math.abs(refDoc.amount - expectedAmount) < 0.01 : true) &&
        (expectedCurrency ? refDoc.currency.toUpperCase() === expectedCurrency.toUpperCase() : true)
      );

      if (!hasProviderSuccess) {
        return {
          canProceedToSettlement: false,
          isUnlinkedSettlement: false,
          settlementReason: 'BALANCE_CONFLICT_UNVERIFIED'
        };
      }

      // Exact 4-tuple same-element verification: reservationId, refundId, attemptNumber, amount
      if (!expectedReservationId || typeof expectedAttemptNumber !== 'number' || typeof expectedAmount !== 'number') {
        return {
          canProceedToSettlement: false,
          isUnlinkedSettlement: false,
          settlementReason: 'BALANCE_CONFLICT_UNVERIFIED'
        };
      }

      const expectedPaise = Math.round(expectedAmount * 100);
      let exactMatchFound = false;
      let relatedConflictFound = false;

      for (const r of checkPayment?.refundReservations || []) {
        const sameResId = Boolean(r.reservationId && r.reservationId === expectedReservationId);
        const sameRefId = Boolean(r.refundId && r.refundId.toString() === rId.toString());

        if (sameResId || sameRefId) {
          const resIdMatches = r.reservationId === expectedReservationId;
          const refIdMatches = sameRefId;
          const attMatches = typeof r.attemptNumber === 'number' && r.attemptNumber === expectedAttemptNumber;
          const amtMatches = typeof r.amount === 'number' && Math.round(r.amount * 100) === expectedPaise;
          const isPending = r.status === 'PENDING';

          if (resIdMatches && refIdMatches && attMatches && amtMatches && isPending) {
            exactMatchFound = true;
          } else {
            relatedConflictFound = true;
          }
        }
      }

      if (relatedConflictFound && !exactMatchFound) {
        return {
          canProceedToSettlement: false,
          isUnlinkedSettlement: false,
          settlementReason: 'BALANCE_CONFLICT_RESERVATION_CONFLICT'
        };
      }

      if (exactMatchFound) {
        return {
          canProceedToSettlement: true,
          isUnlinkedSettlement: false,
          settlementReason: 'BALANCE_CONFLICT_LINKED'
        };
      }

      const anyRelatedReservation = (checkPayment?.refundReservations || []).some(r =>
        Boolean(r.refundId && r.refundId.toString() === rId.toString()) ||
        (expectedReservationId ? r.reservationId === expectedReservationId : false)
      );
      if (anyRelatedReservation) {
        return {
          canProceedToSettlement: false,
          isUnlinkedSettlement: false,
          settlementReason: 'BALANCE_CONFLICT_RESERVATION_CONFLICT'
        };
      }

      return {
        canProceedToSettlement: true,
        isUnlinkedSettlement: true,
        settlementReason: 'BALANCE_CONFLICT'
      };
    }

    case 'PAYMENT_MISSING':
      return {
        canProceedToSettlement: false,
        isUnlinkedSettlement: false,
        settlementReason: 'PAYMENT_MISSING'
      };

    case 'DATABASE_ERROR': {
      // Strict AND-based reservation identity verification
      // All identity fields are mandatory. Missing values must fail closed.
      if (
        !expectedReservationId ||
        typeof expectedAttemptNumber !== 'number' ||
        typeof expectedAmount !== 'number' ||
        !Number.isFinite(expectedAmount) ||
        expectedAmount <= 0
      ) {
        return {
          canProceedToSettlement: false,
          isUnlinkedSettlement: false,
          settlementReason: 'DATABASE_ERROR_UNVERIFIED'
        };
      }

      const pId = new mongoose.Types.ObjectId(paymentId);
      const rId = new mongoose.Types.ObjectId(refundId);
      const checkPayment = await Payment.findById(pId);
      const expectedPaise = Math.round(expectedAmount * 100);

      // The SAME persisted reservation object must match ALL required identity fields simultaneously:
      const checkRes = (checkPayment?.refundReservations || []).find((r) => {
        const reservationIdMatches = typeof r.reservationId === 'string' && r.reservationId === expectedReservationId;
        const refundIdMatches = Boolean(r.refundId && r.refundId.toString() === rId.toString());
        const attemptNumberMatches = typeof r.attemptNumber === 'number' && r.attemptNumber === expectedAttemptNumber;
        const amountMatches = typeof r.amount === 'number' && Math.round(r.amount * 100) === expectedPaise;
        const statusMatches = r.status === 'CONSUMED';

        return reservationIdMatches && refundIdMatches && attemptNumberMatches && amountMatches && statusMatches;
      });

      if (checkRes) {
        return {
          canProceedToSettlement: true,
          isUnlinkedSettlement: false,
          settlementReason: 'RESERVATION_CONSUMED'
        };
      }

      await Payment.updateOne(
        { _id: pId },
        {
          $set: {
            reconciliationRequired: true,
            reconciliationReason: `Database error recovery could not verify exact reservation identity for refund ${rId}`
          }
        }
      );
      return {
        canProceedToSettlement: false,
        isUnlinkedSettlement: false,
        settlementReason: 'DATABASE_ERROR_UNVERIFIED'
      };
    }

    default:
      return {
        canProceedToSettlement: false,
        isUnlinkedSettlement: false,
        settlementReason: transitionOutcome
      };
  }
}

export interface ApplySettlementParams {
  paymentId: mongoose.Types.ObjectId | string;
  refundId: mongoose.Types.ObjectId | string;
  razorpayRefundId?: string;
  amount: number;
  currency?: string;
  session?: mongoose.ClientSession | null;
  unlinked?: boolean;
  settlementReason?: string;
  expectedReservationId?: string;
  expectedAttemptNumber?: number;
}

export interface ApplySettlementResult {
  success: boolean;
  outcome: 'SETTLED' | 'ALREADY_SETTLED' | 'SETTLEMENT_CONFLICT' | 'PAYMENT_NOT_FOUND' | 'DATABASE_ERROR';
  refundedAdjusted: number;
  paymentDoc?: IPayment;
  error?: string;
}

/**
 * Applies a provider-confirmed refund settlement onto Payment accounting exactly once.
 * Decoupled from the reservation hold lifecycle.
 */
export async function applyProviderRefundSettlement({
  paymentId,
  refundId,
  razorpayRefundId,
  amount,
  currency,
  session = null,
  unlinked = false,
  settlementReason,
  expectedReservationId,
  expectedAttemptNumber
}: ApplySettlementParams): Promise<ApplySettlementResult> {
  const pId = new mongoose.Types.ObjectId(paymentId);
  const rId = new mongoose.Types.ObjectId(refundId);

  // 1. Load Payment document
  const payment = await Payment.findById(pId).session(session || null);
  if (!payment) {
    return {
      success: false,
      outcome: 'PAYMENT_NOT_FOUND',
      refundedAdjusted: 0,
      error: 'Payment document not found for settlement'
    };
  }

  // 2. Load Refund document
  const refund = await Refund.findById(rId).session(session || null);
  if (!refund) {
    await Payment.updateOne(
      { _id: pId },
      {
        $set: {
          reconciliationRequired: true,
          reconciliationReason: `Settlement conflict: Refund ${rId} document not found for Payment ${pId}`
        }
      },
      { session: session || undefined }
    );
    payment.reconciliationRequired = true;
    return {
      success: false,
      outcome: 'SETTLEMENT_CONFLICT',
      refundedAdjusted: 0,
      paymentDoc: payment,
      error: `Refund document ${rId} not found`
    };
  }

  // 3. Verify Refund.paymentId matches Payment._id
  if (refund.paymentId.toString() !== pId.toString()) {
    await Payment.updateOne(
      { _id: pId },
      {
        $set: {
          reconciliationRequired: true,
          reconciliationReason: `Settlement conflict: Refund ${rId} paymentId (${refund.paymentId}) does not match Payment ${pId}`
        }
      },
      { session: session || undefined }
    );
    payment.reconciliationRequired = true;
    return {
      success: false,
      outcome: 'SETTLEMENT_CONFLICT',
      refundedAdjusted: 0,
      paymentDoc: payment,
      error: `Refund paymentId mismatch: expected ${pId}, got ${refund.paymentId}`
    };
  }

  // 4. Verify Refund.amount matches requested settlement amount
  if (Math.abs(refund.amount - amount) >= 0.01) {
    await Payment.updateOne(
      { _id: pId },
      {
        $set: {
          reconciliationRequired: true,
          reconciliationReason: `Settlement conflict: Refund ${rId} amount (${refund.amount}) does not match settlement amount (${amount})`
        }
      },
      { session: session || undefined }
    );
    payment.reconciliationRequired = true;
    return {
      success: false,
      outcome: 'SETTLEMENT_CONFLICT',
      refundedAdjusted: 0,
      paymentDoc: payment,
      error: `Refund amount mismatch: refund has ${refund.amount}, settlement requested ${amount}`
    };
  }

  // 5. Verify currency strictly (Defect B5): Require provider currency, compare with Refund and Payment
  if (!currency || typeof currency !== 'string' || !currency.trim()) {
    const reasonMsg = `Settlement conflict: Missing required provider currency for refund ${rId}`;
    await Payment.updateOne(
      { _id: pId },
      { $set: { reconciliationRequired: true, reconciliationReason: reasonMsg } },
      { session: session || undefined }
    );
    payment.reconciliationRequired = true;
    return {
      success: false,
      outcome: 'SETTLEMENT_CONFLICT',
      refundedAdjusted: 0,
      paymentDoc: payment,
      error: reasonMsg
    };
  }

  if (!refund.currency || !payment.currency) {
    const reasonMsg = `Settlement conflict: Missing persisted Refund or Payment currency for refund ${rId}`;
    await Payment.updateOne(
      { _id: pId },
      { $set: { reconciliationRequired: true, reconciliationReason: reasonMsg } },
      { session: session || undefined }
    );
    payment.reconciliationRequired = true;
    return {
      success: false,
      outcome: 'SETTLEMENT_CONFLICT',
      refundedAdjusted: 0,
      paymentDoc: payment,
      error: reasonMsg
    };
  }

  const normProvCurrency = currency.trim().toUpperCase();
  const normRefCurrency = refund.currency.trim().toUpperCase();
  const normPayCurrency = payment.currency.trim().toUpperCase();

  if (normProvCurrency !== normRefCurrency || normRefCurrency !== normPayCurrency) {
    const reasonMsg = `Settlement conflict: Currency mismatch between provider (${normProvCurrency}), Refund (${normRefCurrency}), and Payment (${normPayCurrency})`;
    await Payment.updateOne(
      { _id: pId },
      { $set: { reconciliationRequired: true, reconciliationReason: reasonMsg } },
      { session: session || undefined }
    );
    payment.reconciliationRequired = true;
    return {
      success: false,
      outcome: 'SETTLEMENT_CONFLICT',
      refundedAdjusted: 0,
      paymentDoc: payment,
      error: reasonMsg
    };
  }

  const settlementCurrency = normProvCurrency;

  // 6. Require a valid provider refund ID for a confirmed settlement
  if (!razorpayRefundId || typeof razorpayRefundId !== 'string' || !razorpayRefundId.trim()) {
    await Payment.updateOne(
      { _id: pId },
      {
        $set: {
          reconciliationRequired: true,
          reconciliationReason: `Settlement conflict: Missing or invalid required provider refund ID for refund ${rId}`
        }
      },
      { session: session || undefined }
    );
    payment.reconciliationRequired = true;
    return {
      success: false,
      outcome: 'SETTLEMENT_CONFLICT',
      refundedAdjusted: 0,
      paymentDoc: payment,
      error: 'Missing required provider refund ID for confirmed settlement'
    };
  }

  // 6b. Verify that the Refund is independently verified as provider-confirmed (Defect A1)
  const isAuthoritativeSuccess = Boolean(
    refund.status === 'PROCESSED' &&
    Boolean(refund.processedAt) &&
    refund.submissionState === 'CONFIRMED' &&
    refund.razorpayRefundId &&
    razorpayRefundId &&
    refund.razorpayRefundId === razorpayRefundId
  );

  if (!isAuthoritativeSuccess) {
    const reasonMsg = `Settlement conflict: Refund ${rId} lacks verified provider success (status: ${refund.status}, processedAt: ${refund.processedAt}, submissionState: ${refund.submissionState})`;
    await Payment.updateOne(
      { _id: pId },
      {
        $set: {
          reconciliationRequired: true,
          reconciliationReason: reasonMsg
        }
      },
      { session: session || undefined }
    );
    payment.reconciliationRequired = true;
    return {
      success: false,
      outcome: 'SETTLEMENT_CONFLICT',
      refundedAdjusted: 0,
      paymentDoc: payment,
      error: reasonMsg
    };
  }

  // 6c. Inspect existing settlement ledger on payment BEFORE binding provider ID or inserting
  const existingSettledByRefundId = (payment.settledRefunds || []).find(
    s => s.refundId && s.refundId.toString() === rId.toString()
  );
  const existingSettledByProviderId = (payment.settledRefunds || []).find(
    s => Boolean(s.razorpayRefundId && razorpayRefundId && s.razorpayRefundId === razorpayRefundId)
  );

  if (existingSettledByRefundId || existingSettledByProviderId) {
    const targetEntry = existingSettledByRefundId || existingSettledByProviderId;
    const sameEntry = existingSettledByRefundId === existingSettledByProviderId ||
      Boolean(existingSettledByRefundId && existingSettledByProviderId && existingSettledByRefundId.refundId?.toString() === existingSettledByProviderId.refundId?.toString());

    const refundIdMatches = Boolean(targetEntry?.refundId && targetEntry.refundId.toString() === rId.toString());
    const providerIdMatches = Boolean(targetEntry?.razorpayRefundId && targetEntry.razorpayRefundId === razorpayRefundId);
    const amountMatches = typeof targetEntry?.amount === 'number' && Math.abs(targetEntry.amount - amount) < 0.01;
    const currencyMatches = Boolean(targetEntry?.currency && targetEntry.currency.toUpperCase() === settlementCurrency.toUpperCase());

    if (sameEntry && refundIdMatches && providerIdMatches && amountMatches && currencyMatches) {
      return {
        success: true,
        outcome: 'ALREADY_SETTLED',
        refundedAdjusted: 0,
        paymentDoc: payment
      };
    }

    const reasonMsg = existingSettledByProviderId && existingSettledByProviderId.refundId?.toString() !== rId.toString()
      ? `Settlement conflict: provider refund ID ${razorpayRefundId} already settled under different refund ${existingSettledByProviderId.refundId}`
      : `Settlement conflict: conflicting settlement identity for refund ${rId} (provider ID: ${razorpayRefundId}, amount: ${amount}, currency: ${settlementCurrency})`;

    await Payment.updateOne(
      { _id: pId },
      {
        $set: {
          reconciliationRequired: true,
          reconciliationReason: reasonMsg
        }
      },
      { session: session || undefined }
    );
    payment.reconciliationRequired = true;
    return {
      success: false,
      outcome: 'SETTLEMENT_CONFLICT',
      refundedAdjusted: 0,
      paymentDoc: payment,
      error: reasonMsg
    };
  }

  // 7. Provider refund ID binding rules:
  // - If Refund.razorpayRefundId already exists, incoming provider ID must match exactly.
  // - Never overwrite an existing provider refund ID.
  // - A provider refund ID already assigned to a different internal Refund must be treated as a settlement conflict.
  if (refund.razorpayRefundId && refund.razorpayRefundId !== razorpayRefundId) {
    await Payment.updateOne(
      { _id: pId },
      {
        $set: {
          reconciliationRequired: true,
          reconciliationReason: `Settlement conflict: Refund ${rId} already bound to provider ID ${refund.razorpayRefundId}, incoming provider ID is ${razorpayRefundId}`
        }
      },
      { session: session || undefined }
    );
    payment.reconciliationRequired = true;
    return {
      success: false,
      outcome: 'SETTLEMENT_CONFLICT',
      refundedAdjusted: 0,
      paymentDoc: payment,
      error: `Provider refund ID mismatch: expected ${refund.razorpayRefundId}, got ${razorpayRefundId}`
    };
  }

  const otherRefundWithProviderId = await Refund.findOne({
    _id: { $ne: rId },
    razorpayRefundId
  }).session(session || null);
  if (otherRefundWithProviderId) {
    const reasonMsg = `Settlement conflict: provider refund ID ${razorpayRefundId} already assigned to another refund ${otherRefundWithProviderId._id}`;
    await Payment.updateOne(
      { _id: pId },
      {
        $set: {
          reconciliationRequired: true,
          reconciliationReason: reasonMsg
        }
      },
      { session: session || undefined }
    );
    payment.reconciliationRequired = true;
    return {
      success: false,
      outcome: 'SETTLEMENT_CONFLICT',
      refundedAdjusted: 0,
      paymentDoc: payment,
      error: reasonMsg
    };
  }

  if (!refund.razorpayRefundId) {
    const boundRefund = await Refund.findOneAndUpdate(
      {
        _id: rId,
        $or: [
          { razorpayRefundId: { $exists: false } },
          { razorpayRefundId: null },
          { razorpayRefundId: razorpayRefundId }
        ]
      },
      { $set: { razorpayRefundId } },
      { session: session || undefined, returnDocument: 'after' }
    );
    if (!boundRefund || boundRefund.razorpayRefundId !== razorpayRefundId) {
      await Payment.updateOne(
        { _id: pId },
        {
          $set: {
            reconciliationRequired: true,
            reconciliationReason: `Settlement conflict: Refund ${rId} could not atomically bind provider ID ${razorpayRefundId}`
          }
        },
        { session: session || undefined }
      );
      payment.reconciliationRequired = true;
      return {
        success: false,
        outcome: 'SETTLEMENT_CONFLICT',
        refundedAdjusted: 0,
        paymentDoc: payment,
        error: `Could not bind provider refund ID ${razorpayRefundId} to refund ${rId}`
      };
    }
  }

  // 8. Atomically apply settlement entry (and increment refundedAmount if unlinked)
  const updateOps: any = {
    $push: {
      settledRefunds: {
        refundId: rId,
        razorpayRefundId,
        amount,
        currency: settlementCurrency,
        settledAt: new Date(),
        unlinked: Boolean(unlinked),
        settlementReason: settlementReason || (unlinked ? 'UNLINKED_PROVIDER_SETTLEMENT' : 'RESERVATION_CONSUMED')
      }
    }
  };

  const isMissingCredit = unlinked || settlementReason === 'BALANCE_CONFLICT_LINKED';
  if (isMissingCredit) {
    updateOps.$inc = { refundedAmount: amount };
    updateOps.$set = {
      reconciliationRequired: true,
      reconciliationReason: unlinked
        ? `Unlinked refund ${rId} (${settlementCurrency} ${amount}) settled without matching reservation (${settlementReason || 'UNLINKED'}); pending hold preserved for reconciliation`
        : `Linked refund ${rId} (${settlementCurrency} ${amount}) settled after BALANCE_CONFLICT; missing credit applied and pending hold preserved`
    };
  }

  // The atomic database guard must prevent simultaneous duplicate entries using either identifier.
  // Defect B4: Revalidate exact reservation ownership at mutation time
  const reservationMatch: Record<string, unknown> = {
    refundId: rId,
    amount: amount,
    ...(expectedReservationId ? { reservationId: expectedReservationId } : {}),
    ...(typeof expectedAttemptNumber === 'number' ? { attemptNumber: expectedAttemptNumber } : {})
  };

  const updateFilter: Record<string, unknown> = {
    _id: pId,
    $nor: [
      { 'settledRefunds.refundId': rId },
      { 'settledRefunds.razorpayRefundId': razorpayRefundId }
    ]
  };

  if (settlementReason === 'BALANCE_CONFLICT_LINKED') {
    reservationMatch.status = 'PENDING';
    updateFilter.refundReservations = { $elemMatch: reservationMatch };
  } else if (!unlinked) {
    reservationMatch.status = 'CONSUMED';
    updateFilter.refundReservations = { $elemMatch: reservationMatch };
  } else {
    // Genuinely unlinked settlement: no related reservation exists by refundId or reservationId
    updateFilter.refundReservations = {
      $not: {
        $elemMatch: {
          $or: [
            { refundId: rId },
            ...(expectedReservationId ? [{ reservationId: expectedReservationId }] : [])
          ]
        }
      }
    };
  }
  const updatedPayment = await Payment.findOneAndUpdate(
    updateFilter,
    updateOps,
    { session: session || undefined, returnDocument: 'after' }
  );

  if (updatedPayment) {
    const totalCommitted = (updatedPayment.refundedAmount || 0) + (updatedPayment.pendingRefundAmount || 0);
    if (totalCommitted > updatedPayment.amount) {
      await Payment.updateOne(
        { _id: pId },
        {
          $set: {
            reconciliationRequired: true,
            reconciliationReason: `Over-commitment: total committed ${settlementCurrency} ${totalCommitted.toFixed(2)} exceeds captured payment amount ${settlementCurrency} ${updatedPayment.amount.toFixed(2)}`
          }
        },
        { session: session || undefined }
      );
      updatedPayment.reconciliationRequired = true;
    }

    return {
      success: true,
      outcome: 'SETTLED',
      refundedAdjusted: isMissingCredit ? amount : 0,
      paymentDoc: updatedPayment
    };
  }

  // Re-read persisted state: return ALREADY_SETTLED only if the complete identity matches
  const freshRefund = await Refund.findById(rId).session(session || null);
  const freshP = await Payment.findById(pId).session(session || null);
  const exactSettlement = findExactSettlementRecord(
    freshP?.settledRefunds,
    rId,
    amount,
    settlementCurrency,
    razorpayRefundId
  );

  const isConfirmedRefund = Boolean(
    freshRefund &&
    freshRefund.status === 'PROCESSED' &&
    freshRefund.submissionState === 'CONFIRMED' &&
    freshRefund.razorpayRefundId === razorpayRefundId &&
    Math.abs(freshRefund.amount - amount) < 0.01 &&
    freshRefund.currency?.trim().toUpperCase() === settlementCurrency.toUpperCase()
  );

  if (exactSettlement.match && isConfirmedRefund) {
    return {
      success: true,
      outcome: 'ALREADY_SETTLED',
      refundedAdjusted: 0,
      paymentDoc: freshP || undefined
    };
  }
  if (unlinked && freshP) {
    const reservationNowExists = (freshP.refundReservations || []).find(
      r => r.refundId && r.refundId.toString() === rId.toString()
    );
    if (reservationNowExists) {
      // Reservation appeared concurrently! Use linked transition path:
      const transRes = await transitionPaymentReservation({
        paymentId: pId,
        refundId: rId,
        reservationId: reservationNowExists.reservationId,
        amount: reservationNowExists.amount,
        attemptNumber: reservationNowExists.attemptNumber,
        targetState: 'CONSUMED',
        razorpayRefundId,
        session
      });

      if (transRes.success) {
        // Linked transition succeeded; now insert settlement ledger without another credit:
        const linkedUpdate = await Payment.findOneAndUpdate(
          {
            _id: pId,
            $nor: [
              { 'settledRefunds.refundId': rId },
              { 'settledRefunds.razorpayRefundId': razorpayRefundId }
            ],
            refundReservations: {
              $elemMatch: {
                reservationId: reservationNowExists.reservationId,
                refundId: rId,
                attemptNumber: reservationNowExists.attemptNumber,
                amount: reservationNowExists.amount,
                status: 'CONSUMED'
              }
            }
          },
          {
            $push: {
              settledRefunds: {
                refundId: rId,
                razorpayRefundId,
                amount,
                currency: settlementCurrency,
                settledAt: new Date(),
                unlinked: false,
                settlementReason: 'RESERVATION_CONSUMED'
              }
            }
          },
          { session: session || undefined, returnDocument: 'after' }
        );
        if (linkedUpdate) {
          return {
            success: true,
            outcome: 'SETTLED',
            refundedAdjusted: transRes.refundedAdjusted,
            paymentDoc: linkedUpdate
          };
        }
      } else if (transRes.outcome === 'BALANCE_CONFLICT') {
        const linkedConflictUpdate = await Payment.findOneAndUpdate(
          {
            _id: pId,
            $nor: [
              { 'settledRefunds.refundId': rId },
              { 'settledRefunds.razorpayRefundId': razorpayRefundId }
            ],
            refundReservations: {
              $elemMatch: {
                reservationId: reservationNowExists.reservationId,
                refundId: rId,
                attemptNumber: reservationNowExists.attemptNumber,
                amount: reservationNowExists.amount,
                status: 'PENDING'
              }
            }
          },
          {
            $inc: { refundedAmount: amount },
            $set: {
              reconciliationRequired: true,
              reconciliationReason: `Linked refund ${rId} (${settlementCurrency} ${amount}) settled after concurrent reservation BALANCE_CONFLICT; missing credit applied and pending hold preserved`
            },
            $push: {
              settledRefunds: {
                refundId: rId,
                razorpayRefundId,
                amount,
                currency: settlementCurrency,
                settledAt: new Date(),
                unlinked: false,
                settlementReason: 'BALANCE_CONFLICT_LINKED'
              }
            }
          },
          { session: session || undefined, returnDocument: 'after' }
        );
        if (linkedConflictUpdate) {
          return {
            success: true,
            outcome: 'SETTLED',
            refundedAdjusted: amount,
            paymentDoc: linkedConflictUpdate
          };
        }
      }
    }
  }

  await Payment.updateOne(
    { _id: pId },
    {
      $set: {
        reconciliationRequired: true,
        reconciliationReason: `Settlement conflict: concurrent settlement update failed or conflicted for refund ${rId} (provider ID: ${razorpayRefundId})`
      }
    },
    { session: session || undefined }
  );
  return {
    success: false,
    outcome: 'SETTLEMENT_CONFLICT',
    refundedAdjusted: 0,
    paymentDoc: freshP || undefined,
    error: 'Conflicting settlement parameters recorded concurrently'
  };
}

/**
 * Classifies errors from Razorpay refund requests:
 * - Definitive rejection (HTTP 4xx, BAD_REQUEST_ERROR): Gateway rejected the refund; NO money moved.
 * - Ambiguous outcome (Network timeout, 5xx, socket errors): Outcome uncertain; gateway may have processed it.
 */
export function classifyRazorpayRefundError(err: unknown): ClassifiedGatewayError {
  const errObj = (err && typeof err === 'object') ? (err as Record<string, unknown>) : {};
  const nestedError = (errObj.error && typeof errObj.error === 'object') ? (errObj.error as Record<string, unknown>) : undefined;

  let statusCode: number | undefined;
  if (typeof errObj.statusCode === 'number') {
    statusCode = errObj.statusCode;
  } else if (typeof nestedError?.statusCode === 'number') {
    statusCode = nestedError.statusCode;
  }

  let code: string | undefined;
  if (typeof errObj.code === 'string') {
    code = errObj.code;
  } else if (typeof nestedError?.code === 'string') {
    code = nestedError.code;
  }

  const description = (typeof nestedError?.description === 'string' && nestedError.description) ||
                      (typeof errObj.message === 'string' && errObj.message) ||
                      'Unknown payment gateway error';
  const lowerDesc = description.toLowerCase();

  // 1. HTTP 409 Conflict: Earlier idempotent request still processing on gateway.
  // MUST NOT release reservation or allow concurrent new attempt!
  const is409Conflict = statusCode === 409 ||
                        code === 'GATEWAY_ERROR_CONFLICT' ||
                        lowerDesc.includes('already being processed') ||
                        lowerDesc.includes('in progress') ||
                        lowerDesc.includes('idempotency key conflict');

  if (is409Conflict) {
    return {
      category: 'STILL_PROCESSING',
      isDefinitiveRejection: false,
      isAmbiguous: true,
      isStillProcessing: true,
      errorCode: code || 'HTTP_409',
      errorMessage: `Gateway report: An earlier refund request with this key is still in progress: ${description}`,
      statusCode: 409
    };
  }

  // 2. Network Timeouts & Socket Errors (gateway may have completed the operation)
  const networkErrorCodes = [
    'ETIMEDOUT', 'ECONNRESET', 'ECONNABORTED', 'ENOTFOUND', 'EAI_AGAIN',
    'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET'
  ];
  if (code && networkErrorCodes.includes(code)) {
    return {
      category: 'AMBIGUOUS',
      isDefinitiveRejection: false,
      isAmbiguous: true,
      isStillProcessing: false,
      errorCode: code,
      errorMessage: `Network error during refund: ${description} (${code})`,
      statusCode
    };
  }

  // 3. 5xx Server Errors from Razorpay gateway
  if (statusCode && statusCode >= 500) {
    return {
      category: 'GATEWAY_ERROR',
      isDefinitiveRejection: false,
      isAmbiguous: true,
      isStillProcessing: false,
      errorCode: code || `HTTP_${statusCode}`,
      errorMessage: `Gateway returned HTTP ${statusCode}: ${description}`,
      statusCode
    };
  }

  // 4. 4xx Client Errors from Razorpay (excluding 409) - Confirmed definitive rejection
  if (statusCode && statusCode >= 400 && statusCode < 500 && statusCode !== 409) {
    return {
      category: 'DEFINITIVE_REJECTION',
      isDefinitiveRejection: true,
      isAmbiguous: false,
      isStillProcessing: false,
      errorCode: code || `HTTP_${statusCode}`,
      errorMessage: description,
      statusCode
    };
  }

  if (code === 'BAD_REQUEST_ERROR' || (typeof description === 'string' && (
    lowerDesc.includes('already been refunded') ||
    lowerDesc.includes('greater than') ||
    lowerDesc.includes('invalid')
  ))) {
    return {
      category: 'DEFINITIVE_REJECTION',
      isDefinitiveRejection: true,
      isAmbiguous: false,
      isStillProcessing: false,
      errorCode: code || 'BAD_REQUEST',
      errorMessage: description,
      statusCode: statusCode || 400
    };
  }

  // Default fallback: ambiguous to protect merchant funds from duplicate refunds
  return {
    category: 'AMBIGUOUS',
    isDefinitiveRejection: false,
    isAmbiguous: true,
    isStillProcessing: false,
    errorCode: code || 'UNKNOWN_ERROR',
    errorMessage: description,
    statusCode
  };
}

export function formatGatewayRefundIdempotencyKey(params: {
  orderId: string | mongoose.Types.ObjectId;
  returnId?: string;
  operationId?: string;
  customIdempotencyKey?: string;
}): string {
  if (params.customIdempotencyKey) {
    if (params.customIdempotencyKey.length <= 40 && /^[A-Za-z0-9_-]+$/.test(params.customIdempotencyKey)) {
      return params.customIdempotencyKey;
    }
    const h = crypto.createHash('sha256').update(params.customIdempotencyKey).digest('hex').slice(0, 30);
    return `rfnd_k_${h}`;
  }
  if (params.operationId) {
    const h = crypto.createHash('sha256').update(`${params.orderId}_${params.operationId}`).digest('hex').slice(0, 24);
    return `rfnd_op_${h}`;
  }
  if (params.returnId) {
    return `rfnd_ret_${params.returnId}`;
  }
  return `rfnd_ord_${params.orderId}`;
}

export function formatRefundIdempotencyKey(params: {
  orderId: string | mongoose.Types.ObjectId;
  returnId?: string;
  operationId?: string;
  attemptNumber?: number;
  customIdempotencyKey?: string;
}): string {
  if (params.customIdempotencyKey) {
    if (params.customIdempotencyKey.length <= 40 && /^[A-Za-z0-9_-]+$/.test(params.customIdempotencyKey)) {
      return params.customIdempotencyKey;
    }
    const h = crypto.createHash('sha256').update(params.customIdempotencyKey).digest('hex').slice(0, 30);
    return `rfnd_k_${h}`;
  }
  if (params.operationId) {
    const h = crypto.createHash('sha256').update(`${params.orderId}_${params.operationId}`).digest('hex').slice(0, 24);
    return `rfnd_op_${h}`;
  }
  if (params.returnId) {
    return params.attemptNumber && params.attemptNumber > 1
      ? `rfnd_ret_${params.returnId}_att${params.attemptNumber}`
      : `rfnd_ret_${params.returnId}`;
  }
  return params.attemptNumber && params.attemptNumber > 1
    ? `rfnd_ord_${params.orderId}_att${params.attemptNumber}`
    : `rfnd_ord_${params.orderId}`;
}

export const createInternalRefund = async ({
  orderId,
  returnId,
  operationId,
  customIdempotencyKey,
  amount,
  reason,
  actorId,
  actorRole,
  session: callerSession
}: CreateRefundParams): Promise<IRefund> => {
  const isCallerOwnedSession = Boolean(callerSession);
  const session = callerSession || (await mongoose.startSession());
  const {
    order,
    payment,
    attempt,
    initialAttemptNumber,
    refundAmount,
    reservationFilter,
    existingProcessedRefund,
    existingPendingRefund,
    existingFailedRefundToRetry,
  } = await (async () => {
    try {
      const order = await Order.findById(orderId);
      if (!order) throw new AppError('Order not found', 404);

      if (order.paymentStatus !== 'PAID') {
        throw new AppError('Refunds can only be processed for PAID orders', 400);
      }

      const payment = await Payment.findOne({ orderId: order._id });
      if (!payment) throw new AppError('Payment record not found', 404);

      if (payment.reconciliationRequired) {
        throw new AppError(
          'Payment has an active financial reconciliation requirement. New refund submissions are blocked.',
          409,
          'PAYMENT_RECONCILIATION_REQUIRED'
        );
      }

      if (payment.status !== 'CAPTURED') {
        throw new AppError('Refunds can only be processed for CAPTURED payments', 400);
      }

      const attempt = await PaymentAttempt.findOne({ paymentId: payment._id, status: 'CAPTURED' });
      if (!attempt || !attempt.razorpayPaymentId) {
        throw new AppError('Valid Razorpay Payment ID not found', 400);
      }

      let initialAttemptNumber = 1;
      if (returnId) {
        const returnObjectId = new mongoose.Types.ObjectId(returnId);
        const rDoc = await ReturnRequest.findById(returnObjectId);
        if (!rDoc) throw new AppError('Return request not found', 404);
        if (rDoc.refundStatus === 'PROCESSED') {
          throw new AppError('A refund for this return has already been processed', 400, 'REFUND_ALREADY_PROCESSED');
        }
        if (rDoc.refundStatus === 'UNKNOWN') {
          throw new AppError(
            'A previous refund attempt is in an UNKNOWN state and requires reconciliation before retrying.',
            409,
            'REFUND_RECONCILIATION_REQUIRED'
          );
        }
        if (rDoc.refundStatus === 'PROCESSING' || rDoc.refundStatus === 'PENDING') {
          throw new AppError('A refund attempt for this return is currently in progress.', 409, 'REFUND_IN_PROGRESS');
        }
        initialAttemptNumber = (rDoc.refundAttempt || 0) + 1;
      } else if (operationId) {
        const opHash = crypto.createHash('sha256').update(`${order._id}_${operationId}`).digest('hex').slice(0, 24);
        const existingOpRefund = await Refund.findOne({
          orderId: order._id,
          $or: [
            { gatewayIdempotencyKey: `rfnd_op_${opHash}` },
            { idempotencyKey: new RegExp(`^rfnd_op_${opHash}`) },
          ],
        }).sort({ attemptNumber: -1, createdAt: -1 });

        if (existingOpRefund) {
          if (existingOpRefund.status === 'PROCESSED') {
            return {
              order,
              payment,
              attempt,
              initialAttemptNumber: existingOpRefund.attemptNumber || 1,
              refundAmount: existingOpRefund.amount,
              reservationFilter: {},
              existingProcessedRefund: existingOpRefund,
            };
          }
          if (existingOpRefund.status === 'UNKNOWN') {
            const reconciled = await reconcileUnknownRefund(existingOpRefund._id.toString());
            if (reconciled.status === 'PROCESSED') {
              return {
                order,
                payment,
                attempt,
                initialAttemptNumber: reconciled.attemptNumber || 1,
                refundAmount: reconciled.amount,
                reservationFilter: {},
                existingProcessedRefund: reconciled,
              };
            }
            if (reconciled.status === 'UNKNOWN' || reconciled.status === 'PENDING') {
              throw new AppError(
                'A previous refund attempt is in an UNKNOWN state and requires reconciliation before retrying.',
                409,
                'REFUND_RECONCILIATION_REQUIRED'
              );
            }
          }
          if (existingOpRefund.status === 'PROCESSING' || existingOpRefund.status === 'PENDING') {
            if (existingOpRefund.submissionState === 'INTENT_CREATED' || (existingOpRefund.submissionClaimExpiresAt && existingOpRefund.submissionClaimExpiresAt < new Date())) {
              return {
                order,
                payment,
                attempt,
                initialAttemptNumber: existingOpRefund.attemptNumber || 1,
                refundAmount: existingOpRefund.amount,
                reservationFilter: {},
                existingPendingRefund: existingOpRefund,
              };
            }
            throw new AppError('A refund attempt for this operation is currently in progress.', 409, 'REFUND_IN_PROGRESS');
          }
          if (existingOpRefund.status === 'FAILED') {
            return {
              order,
              payment,
              attempt,
              initialAttemptNumber: (existingOpRefund.attemptNumber || 1) + 1,
              refundAmount: existingOpRefund.amount,
              reservationFilter: {},
              existingProcessedRefund: undefined as IRefund | undefined,
              existingPendingRefund: undefined as IRefund | undefined,
              existingFailedRefundToRetry: existingOpRefund,
            };
          }
          initialAttemptNumber = (existingOpRefund.attemptNumber || 1) + 1;
        } else {
          initialAttemptNumber = 1;
        }
      } else {
        const previousAttempts = await Refund.countDocuments({ orderId: order._id });
        initialAttemptNumber = previousAttempts + 1;
      }

      // Remaining refundable = amount - processed - in-flight (reserved) refunds.
      const remainder = payment.amount - (payment.refundedAmount || 0) - (payment.pendingRefundAmount || 0);

      let refundAmount: number;
      if (amount !== undefined && amount !== null) {
        if (typeof amount === 'string') {
          const trimmed = amount.trim();
          if (!trimmed || isNaN(Number(trimmed)) || trimmed.toLowerCase().includes('infinity') || trimmed.toLowerCase().includes('nan')) {
            throw new AppError('Refund amount must be a valid positive number', 400);
          }
        } else if (typeof amount !== 'number') {
          throw new AppError('Refund amount must be a valid positive number', 400);
        }
        const parsedAmount = Number(amount);
        if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
          throw new AppError('Refund amount must be greater than zero', 400);
        }
        const paise = Math.round(parsedAmount * 100);
        if (Math.abs(parsedAmount - paise / 100) > 1e-6) {
          throw new AppError('Refund amount exceeds supported currency precision (maximum 2 decimal places)', 400);
        }
        refundAmount = paise / 100;
      } else {
        if (returnId) {
          throw new AppError('Refund amount is required for return requests', 400);
        }
        refundAmount = remainder;
        if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
          throw new AppError('No refundable balance remaining on payment', 400);
        }
      }

      if (refundAmount > remainder) {
        throw new AppError(`Cannot refund more than the remaining refundable amount (₹${remainder.toFixed(2)})`, 400);
      }
      if (order.currency !== payment.currency) {
        throw new AppError('Currency mismatch', 400);
      }

      // Step 1: Atomically reserve the amount on the Payment document. $expr guards against
      // concurrent refunds overshooting the remaining balance (read-then-write TOCTOU).
      const reservationFilter: Record<string, unknown> = {
        _id: payment._id,
        status: 'CAPTURED',
        $expr: {
          $gte: [
            {
              $subtract: [
                { $subtract: ['$amount', { $ifNull: ['$refundedAmount', 0] }] },
                { $ifNull: ['$pendingRefundAmount', 0] },
              ],
            },
            refundAmount,
          ],
        },
      };

      return {
        order,
        payment,
        attempt,
        initialAttemptNumber,
        refundAmount,
        reservationFilter,
        existingProcessedRefund: undefined as IRefund | undefined,
        existingPendingRefund: undefined as IRefund | undefined,
        existingFailedRefundToRetry: undefined as IRefund | undefined,
      };
    } catch (preparationError: unknown) {
      if (!isCallerOwnedSession) {
        try {
          if (session.inTransaction()) {
            await session.abortTransaction();
          }
        } finally {
          await session.endSession();
        }
      }
      throw preparationError;
    }
  })();

  if (existingProcessedRefund) {
    if (!isCallerOwnedSession && session) {
      await session.endSession();
    }
    return existingProcessedRefund;
  }
  if (existingPendingRefund) {
    if (!isCallerOwnedSession && session) {
      await session.endSession();
    }
    return await submitRefundToGateway(existingPendingRefund._id.toString());
  }

  if (existingFailedRefundToRetry) {
    const nextAttempt = (existingFailedRefundToRetry.attemptNumber || 1) + 1;
    const retryReservationDoc = {
      reservationId: `${existingFailedRefundToRetry._id}_att${nextAttempt}`,
      refundId: existingFailedRefundToRetry._id,
      attemptNumber: nextAttempt,
      amount: existingFailedRefundToRetry.amount,
      status: 'PENDING' as const,
    };
    const retryReservationFilter = {
      _id: payment._id,
      status: 'CAPTURED',
      $expr: {
        $gte: [
          {
            $subtract: [
              { $subtract: ['$amount', { $ifNull: ['$refundedAmount', 0] }] },
              { $ifNull: ['$pendingRefundAmount', 0] },
            ],
          },
          existingFailedRefundToRetry.amount,
        ],
      },
    };
    const reserved = await Payment.findOneAndUpdate(
      retryReservationFilter as any,
      {
        $inc: { pendingRefundAmount: existingFailedRefundToRetry.amount },
        $push: { refundReservations: retryReservationDoc },
      },
      { returnDocument: 'after' }
    );
    if (!reserved) {
      const freshP = await Payment.findById(payment._id);
      const remaining = (payment.amount || 0) - (freshP?.refundedAmount || 0) - (freshP?.pendingRefundAmount || 0);
      throw new AppError(`Cannot refund more than remaining refundable amount on retry (₹${remaining.toFixed(2)})`, 400);
    }

    existingFailedRefundToRetry.status = 'PROCESSING';
    existingFailedRefundToRetry.submissionState = 'INTENT_CREATED';
    existingFailedRefundToRetry.attemptNumber = nextAttempt;
    existingFailedRefundToRetry.failureReason = undefined;
    existingFailedRefundToRetry.submissionClaimToken = undefined;
    existingFailedRefundToRetry.submissionClaimExpiresAt = undefined;
    await existingFailedRefundToRetry.save();

    if (!isCallerOwnedSession && session) {
      await session.endSession();
    }
    return await submitRefundToGateway(existingFailedRefundToRetry._id.toString());
  }

  let attemptNumber = initialAttemptNumber;
  let claimedReturn: IReturnRequest | null = null;

  let refund: IRefund;
  try {
    if (!isCallerOwnedSession) {
      session.startTransaction();
    }
    const refundClaimToken = `claim_${crypto.randomUUID()}`;
    const refundClaimExpiresAt = new Date(Date.now() + 60_000);

    if (returnId) {
      claimedReturn = await ReturnRequest.findOneAndUpdate(
        {
          _id: new mongoose.Types.ObjectId(returnId),
          refundStatus: { $nin: ['PENDING', 'PROCESSING', 'PROCESSED', 'UNKNOWN'] },
          $or: [
            { refundClaimExpiresAt: { $exists: false } },
            { refundClaimExpiresAt: null },
            { refundClaimExpiresAt: { $lt: new Date() } }
          ]
        },
        {
          $inc: { refundAttempt: 1 },
          $set: {
            refundStatus: 'PROCESSING',
            refundClaimToken,
            refundClaimExpiresAt,
            refundError: undefined
          }
        },
        { session, returnDocument: 'after' }
      );
      if (!claimedReturn) {
        throw new AppError('Refund attempt already in progress or completed', 409, 'REFUND_IN_PROGRESS');
      }
      attemptNumber = claimedReturn.refundAttempt || initialAttemptNumber;
    } else if (operationId) {
      const opHash = crypto.createHash('sha256').update(`${order._id}_${operationId}`).digest('hex').slice(0, 24);
      attemptNumber = (await Refund.countDocuments({
        orderId: order._id,
        $or: [
          { gatewayIdempotencyKey: `rfnd_op_${opHash}` },
          { idempotencyKey: new RegExp(`^rfnd_op_${opHash}`) },
        ],
      }).session(session)) + 1;
    } else {
      attemptNumber = (await Refund.countDocuments({ orderId: order._id }).session(session)) + 1;
    }

    const gatewayIdempotencyKey = formatGatewayRefundIdempotencyKey({
      orderId: order._id,
      returnId,
      operationId,
      customIdempotencyKey,
    });
    const idempotencyKey = formatRefundIdempotencyKey({
      orderId: order._id,
      returnId,
      operationId,
      attemptNumber,
      customIdempotencyKey,
    });

    const [createdRefund] = await Refund.create(
      [
        {
          orderId: order._id,
          paymentId: payment._id,
          userId: order.userId,
          returnId: returnId ? new mongoose.Types.ObjectId(returnId) : undefined,
          attemptNumber,
          idempotencyKey,
          gatewayIdempotencyKey,
          amount: refundAmount,
          currency: payment.currency,
          status: 'PROCESSING',
          submissionState: 'INTENT_CREATED',
          autoSubmitOnRecovery: true,
          reason: reason || 'Admin initiated refund',
          razorpayPaymentId: attempt.razorpayPaymentId,
          initiatedBy: new mongoose.Types.ObjectId(actorId),
          initiatedByRole: actorRole
        }
      ],
      { session }
    );
    refund = createdRefund;

    const reservationDoc = {
      reservationId: refund._id.toString(),
      refundId: refund._id,
      attemptNumber,
      amount: refundAmount,
      status: 'PENDING'
    };

    const reserved = await Payment.findOneAndUpdate(
      {
        ...reservationFilter,
        'refundReservations.reservationId': { $ne: refund._id.toString() }
      },
      {
        $inc: { pendingRefundAmount: refundAmount },
        $push: { refundReservations: reservationDoc }
      },
      { session, returnDocument: 'after' }
    );

    if (!reserved) {
      if (!isCallerOwnedSession) await session.abortTransaction();
      const fresh = await Payment.findById(payment._id);
      const remaining =
        (payment.amount || 0) - (fresh?.refundedAmount || 0) - (fresh?.pendingRefundAmount || 0);
      throw new AppError(
        `Cannot refund more than the remaining refundable amount (₹${remaining.toFixed(2)})`,
        400
      );
    }

    if (returnId) {
      await ReturnRequest.updateOne(
        { _id: returnId },
        {
          $set: {
            refundId: refund._id,
            refundStatus: 'PROCESSING',
            refundAttempt: attemptNumber,
            refundError: undefined
          }
        },
        { session }
      );
    }

    if (!isCallerOwnedSession) {
      await session.commitTransaction();
    }
  } catch (localTxErr: unknown) {
    if (!isCallerOwnedSession && session.inTransaction()) {
      await session.abortTransaction();
    }
    if (isCallerOwnedSession) {
      throw localTxErr;
    }
    const errMessage = localTxErr instanceof Error ? localTxErr.message : String(localTxErr);
    const isNotReplicaSet = errMessage.includes('replica set') ||
                            errMessage.includes('Transaction numbers are only allowed') ||
                            errMessage.includes('retryable writes') ||
                            (localTxErr && typeof localTxErr === 'object' && 'code' in localTxErr && (localTxErr as any).code === 20);

    if (isNotReplicaSet) {
      const refundClaimToken = `claim_${crypto.randomUUID()}`;
      const refundClaimExpiresAt = new Date(Date.now() + 60_000);

      if (returnId) {
        claimedReturn = await ReturnRequest.findOneAndUpdate(
          {
            _id: new mongoose.Types.ObjectId(returnId),
            refundStatus: { $nin: ['PENDING', 'PROCESSING', 'PROCESSED', 'UNKNOWN'] },
            $or: [
              { refundClaimExpiresAt: { $exists: false } },
              { refundClaimExpiresAt: null },
              { refundClaimExpiresAt: { $lt: new Date() } }
            ]
          },
          {
            $inc: { refundAttempt: 1 },
            $set: {
              refundStatus: 'PROCESSING',
              refundClaimToken,
              refundClaimExpiresAt,
              refundError: undefined
            }
          },
          { returnDocument: 'after' }
        );
        if (!claimedReturn) {
          throw new AppError('Refund attempt already in progress or completed', 409, 'REFUND_IN_PROGRESS');
        }
        attemptNumber = claimedReturn.refundAttempt || initialAttemptNumber;
      } else if (operationId) {
        const opHash = crypto.createHash('sha256').update(`${order._id}_${operationId}`).digest('hex').slice(0, 24);
        attemptNumber = (await Refund.countDocuments({
          orderId: order._id,
          $or: [
            { gatewayIdempotencyKey: `rfnd_op_${opHash}` },
            { idempotencyKey: new RegExp(`^rfnd_op_${opHash}`) },
          ],
        })) + 1;
      } else {
        attemptNumber = (await Refund.countDocuments({ orderId: order._id })) + 1;
      }

      const gatewayIdempotencyKey = formatGatewayRefundIdempotencyKey({
        orderId: order._id,
        returnId,
        operationId,
        customIdempotencyKey,
      });
      const idempotencyKey = formatRefundIdempotencyKey({
        orderId: order._id,
        returnId,
        operationId,
        attemptNumber,
        customIdempotencyKey,
      });

      // Step 2: Create Refund document first
      try {
        refund = await Refund.create({
          orderId: order._id,
          paymentId: payment._id,
          userId: order.userId,
          returnId: returnId ? new mongoose.Types.ObjectId(returnId) : undefined,
          attemptNumber,
          idempotencyKey,
          gatewayIdempotencyKey,
          amount: refundAmount,
          currency: payment.currency,
          status: 'PROCESSING',
          submissionState: 'INTENT_CREATED',
          autoSubmitOnRecovery: true,
          reason: reason || 'Admin initiated refund',
          razorpayPaymentId: attempt.razorpayPaymentId,
          initiatedBy: new mongoose.Types.ObjectId(actorId),
          initiatedByRole: actorRole
        });
      } catch (refundCreateErr) {
        if (returnId) {
          await ReturnRequest.updateOne({ _id: returnId }, { $set: { refundStatus: 'FAILED', refundError: 'Failed to record refund intent' }, $unset: { refundClaimToken: 1, refundClaimExpiresAt: 1 } });
        }
        throw refundCreateErr;
      }

      // Step 3: Reserve payment with per-attempt reservation identity
      const reservationDoc = {
        reservationId: refund._id.toString(),
        refundId: refund._id,
        attemptNumber,
        amount: refundAmount,
        status: 'PENDING'
      };

      const reserved = await Payment.findOneAndUpdate(
        {
          ...reservationFilter,
          'refundReservations.reservationId': { $ne: refund._id.toString() }
        },
        {
          $inc: { pendingRefundAmount: refundAmount },
          $push: { refundReservations: reservationDoc }
        },
        { returnDocument: 'after' }
      );

      if (!reserved) {
        await Refund.updateOne({ _id: refund._id }, { $set: { status: 'FAILED', failureReason: 'Insufficient payment balance' } });
        if (returnId) {
          await ReturnRequest.updateOne({ _id: returnId }, { $set: { refundStatus: 'FAILED', refundError: 'Balance insufficient' } });
        }
        const fresh = await Payment.findById(payment._id);
        const remaining =
          (payment.amount || 0) - (fresh?.refundedAmount || 0) - (fresh?.pendingRefundAmount || 0);
        throw new AppError(`Cannot refund more than the remaining refundable amount (₹${remaining.toFixed(2)})`, 400);
      }

      // Step 4: Link ReturnRequest
      if (returnId) {
        await ReturnRequest.updateOne(
          { _id: returnId },
          {
            $set: {
              refundId: refund._id,
              refundStatus: 'PROCESSING',
              refundAttempt: attemptNumber,
              refundError: undefined
            }
          }
        );
      }
    } else {
      if (returnId) {
        await ReturnRequest.updateOne({ _id: returnId }, { $set: { refundStatus: 'FAILED', refundError: errMessage } });
      }
      throw localTxErr;
    }
  } finally {
    if (!isCallerOwnedSession && session) {
      await session.endSession();
    }
  }

  if (isCallerOwnedSession && session.inTransaction()) {
    registerPostCommitHook(session, async () => {
      try {
        await submitRefundToGateway(refund._id.toString());
      } catch (dispatchErr: unknown) {
        console.warn(`[REFUND] Post-commit gateway dispatch error for refund ${refund._id}:`, dispatchErr);
      }
    });
    return refund;
  }

  return await submitRefundToGateway(refund._id.toString());
};

export async function submitRefundToGateway(refundId: string): Promise<IRefund> {
  const refund = await Refund.findById(refundId);
  if (!refund) throw new AppError('Refund record not found for gateway dispatch', 404);
  if (refund.status !== 'PROCESSING' || refund.submissionState !== 'INTENT_CREATED') {
    return refund;
  }

  const order = await Order.findById(refund.orderId);
  if (!order) throw new AppError('Order not found for gateway dispatch', 404);
  const payment = await Payment.findById(refund.paymentId);
  if (!payment) throw new AppError('Payment not found for gateway dispatch', 404);
  const attempt = await PaymentAttempt.findOne({ paymentId: payment._id, status: 'CAPTURED' });
  if (!attempt || !attempt.razorpayPaymentId) {
    throw new AppError('Valid Razorpay Payment ID not found', 400);
  }

  const attemptNumber = refund.attemptNumber || 1;
  const refundAmount = refund.amount;
  const amountInPaise = Math.round(refundAmount * 100);
  const returnId = refund.returnId;
  const idempotencyKey = refund.idempotencyKey;
  const actorId = refund.initiatedBy?.toString() || '';
  const actorRole = refund.initiatedByRole || 'SYSTEM';
  const reason = refund.reason;

  // Step 5: Atomically claim submission right with lease (H3)
  const submissionClaimToken = `sub_claim_${crypto.randomUUID()}`;
  const submissionClaimExpiresAt = new Date(Date.now() + 60_000);
  const claimedSub = await Refund.findOneAndUpdate(
    {
      _id: refund._id,
      status: 'PROCESSING',
      submissionState: 'INTENT_CREATED',
      $or: [
        { submissionClaimExpiresAt: { $exists: false } },
        { submissionClaimExpiresAt: null },
        { submissionClaimExpiresAt: { $lt: new Date() } }
      ]
    },
    {
      $set: {
        submissionState: 'SUBMISSION_PENDING',
        submissionClaimToken,
        submissionClaimExpiresAt
      }
    },
    { returnDocument: 'after' }
  );

  if (!claimedSub) {
    throw new AppError('Lost submission lease before gateway dispatch', 409, 'SUBMISSION_LEASE_LOST');
  }

  await Refund.updateOne(
    { _id: refund._id, submissionClaimToken },
    { $set: { submissionState: 'SUBMITTED', submittedAt: new Date() } }
  );

  try {
    const gatewayKey = refund.gatewayIdempotencyKey ||
      (refund.idempotencyKey ? refund.idempotencyKey.replace(/(_a\d+|_att\d+)$/, '') : undefined) ||
      idempotencyKey;

    const razorpayRefund = await razorpayProvider.createRefund(
      attempt.razorpayPaymentId,
      amountInPaise,
      {
        internal_refund_id: refund._id.toString(),
        order_id: order._id.toString(),
        ...(returnId ? { return_id: returnId.toString() } : {})
      },
      gatewayKey
    );

    // Step 6: Gateway accepted request
    await Refund.updateOne(
      { _id: refund._id, submissionClaimToken },
      {
        $set: {
          submissionState: 'RESPONSE_RECEIVED',
          responseReceivedAt: new Date(),
          razorpayRefundId: razorpayRefund.id,
          accountingSettlementStatus: 'PENDING'
        }
      }
    );
    refund.razorpayRefundId = razorpayRefund.id;

    if (razorpayRefund.status === 'processed') {
      refund.status = 'PROCESSED';
      refund.submissionState = 'CONFIRMED';
      refund.processedAt = new Date();
      refund.razorpayRefundId = razorpayRefund.id;
      await refund.save();

      // Route reservation settlement through shared transitionPaymentReservation
      const transitionRes = await transitionPaymentReservation({
        paymentId: payment._id,
        refundId: refund._id,
        amount: refundAmount,
        targetState: 'CONSUMED',
        attemptNumber
      });
      const policy = await resolveSettlementPolicy({
        paymentId: payment._id,
        refundId: refund._id,
        transitionOutcome: transitionRes.outcome,
        expectedReservationId: refund._id.toString(),
        expectedAttemptNumber: attemptNumber,
        expectedAmount: refundAmount
      });
      let settlementRes: ApplySettlementResult | undefined;
      if (policy.canProceedToSettlement) {
        settlementRes = await applyProviderRefundSettlement({
          paymentId: payment._id,
          refundId: refund._id,
          razorpayRefundId: razorpayRefund.id,
          amount: refundAmount,
          currency: refund.currency,
          unlinked: policy.isUnlinkedSettlement,
          settlementReason: policy.settlementReason
        });
      }

      let returnSyncSuccess = true;
      if (returnId) {
        const syncRes = await syncReturnRequestWithRefund({
          returnId,
          refundId: refund._id,
          orderId: order._id,
          refundStatus: 'PROCESSED',
          attemptNumber
        });
        returnSyncSuccess = syncRes.success;
      }

      const paymentDoc = settlementRes?.paymentDoc || transitionRes.paymentDoc || (await Payment.findById(payment._id));
      const isSettled = (transitionRes.outcome === 'APPLIED' || transitionRes.outcome === 'ALREADY_APPLIED') &&
        Boolean(settlementRes?.success) &&
        paymentDoc &&
        !paymentDoc.reconciliationRequired &&
        returnSyncSuccess;

      refund.status = 'PROCESSED';
      refund.submissionState = 'CONFIRMED';
      refund.accountingSettlementStatus = isSettled ? 'COMPLETED' : 'RECONCILIATION_REQUIRED';
      refund.processedAt = new Date();
      await refund.save();
    } else {
      // Gateway queued the refund; remains PENDING until webhook
      refund.status = 'PENDING';
      refund.accountingSettlementStatus = 'PENDING';
      await refund.save();

      if (returnId) {
        await ReturnRequest.updateOne(
          { _id: returnId },
          {
            $set: { refundStatus: 'PENDING' },
            $unset: { refundClaimToken: 1, refundClaimExpiresAt: 1 }
          }
        );
      }
    }

    // Audit Log
    await AuditLog.create({
      actorId: new mongoose.Types.ObjectId(actorId),
      actorRole: actorRole,
      action: 'ADMIN_REFUND_REQUESTED',
      entityType: 'ORDER',
      entityId: order._id,
      metadata: {
        refundId: refund._id,
        amount: refundAmount,
        razorpayRefundId: razorpayRefund.id,
        reason
      }
    });

    return refund;
  } catch (razorpayError: unknown) {
    const classified = classifyRazorpayRefundError(razorpayError);

    if (classified.isDefinitiveRejection) {
      // Step 7A: Definitive Rejection (4xx) - Release reservation via shared transition & mark FAILED
      refund.status = 'FAILED';
      refund.submissionState = 'CONFIRMED';
      refund.failureReason = classified.errorMessage;
      await refund.save();

      await transitionPaymentReservation({
        paymentId: payment._id,
        refundId: refund._id,
        amount: refundAmount,
        targetState: 'RELEASED',
        attemptNumber
      });

      if (returnId) {
        await syncReturnRequestWithRefund({
          returnId,
          refundId: refund._id,
          orderId: order._id,
          refundStatus: 'FAILED',
          attemptNumber,
          refundError: classified.errorMessage
        });
      }

      await AuditLog.create({
        actorId: new mongoose.Types.ObjectId(actorId),
        actorRole: actorRole,
        action: 'ADMIN_REFUND_FAILED',
        entityType: 'ORDER',
        entityId: order._id,
        metadata: {
          refundId: refund._id,
          amount: refundAmount,
          reason: refund.failureReason
        }
      });

      throw new AppError(classified.errorMessage, 400, 'REFUND_REJECTED');
    } else {
      // Step 7B: Ambiguous Outcome (Timeout/5xx) - Retain reservation & mark UNKNOWN
      refund.status = 'UNKNOWN';
      refund.failureReason = classified.errorMessage;
      await refund.save();

      if (returnId) {
        await syncReturnRequestWithRefund({
          returnId,
          refundId: refund._id,
          orderId: order._id,
          refundStatus: 'UNKNOWN',
          attemptNumber,
          refundError: classified.errorMessage
        });
      }

      await AuditLog.create({
        actorId: new mongoose.Types.ObjectId(actorId),
        actorRole: actorRole,
        action: 'ADMIN_REFUND_OUTCOME_UNKNOWN',
        entityType: 'ORDER',
        entityId: order._id,
        metadata: {
          refundId: refund._id,
          amount: refundAmount,
          reason: refund.failureReason
        }
      });

      throw new AppError(
        `Refund gateway status is uncertain due to timeout/network error: ${classified.errorMessage}. Reserved amount held for reconciliation.`,
        classified.statusCode === 409 ? 409 : 502,
        'REFUND_OUTCOME_UNKNOWN'
      );
    }
  }
};
export function isRecognizedWorkerFenceOrAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string | number; message?: string; name?: string; errorLabels?: Set<string> | string[] };
  if (
    e.code === 'WORKER_LEASE_FENCED_OUT' ||
    e.code === 'WEBHOOK_LEASE_LOST' ||
    e.code === 'WEBHOOK_LEASE_EXPIRED' ||
    e.code === 'WORKER_FENCE_REQUIRED'
  ) {
    return true;
  }
  const msg = typeof e.message === 'string' ? e.message.toLowerCase() : '';
  if (
    msg.includes('transienttransactionerror') ||
    msg.includes('transaction has been aborted') ||
    msg.includes('write conflict') ||
    msg.includes('fenced out') ||
    msg.includes('lease expired') ||
    msg.includes('lease lost')
  ) {
    return true;
  }
  const labels = e.errorLabels;
  if (labels) {
    if (labels instanceof Set && (labels.has('TransientTransactionError') || labels.has('UnknownTransactionCommitResult'))) {
      return true;
    }
    if (Array.isArray(labels) && (labels.includes('TransientTransactionError') || labels.includes('UnknownTransactionCommitResult'))) {
      return true;
    }
  }
  return false;
}

/**
 * Reconciles an in-doubt UNKNOWN refund by verifying gateway records
 */
export async function reconcileUnknownRefund(
  refundId: string,
  options: {
    forceAdministrativeFailure?: boolean;
    adminReason?: string;
    withFence?: <T>(fn: (session: mongoose.ClientSession) => Promise<T>) => Promise<T>;
    executionMode?: 'WORKER' | 'ADMINISTRATIVE';
    allowUnfencedAdmin?: boolean;
  } = {}
): Promise<IRefund> {
  const refund = await Refund.findById(refundId);
  if (!refund) throw new AppError('Refund record not found', 404);
  if (refund.status !== 'UNKNOWN' && refund.status !== 'PROCESSING' && refund.status !== 'PENDING') {
    return refund;
  }
  if (!refund.razorpayPaymentId && refund.paymentId) {
    const pDoc = await Payment.findById(refund.paymentId);
    if (pDoc?.razorpayPaymentId) {
      refund.razorpayPaymentId = pDoc.razorpayPaymentId;
    }
  }
  if (!refund.razorpayPaymentId) {
    throw new AppError('Cannot reconcile refund: missing payment identifier', 400);
  }

  const runWithFence = async <T>(fn: (session: mongoose.ClientSession) => Promise<T>): Promise<T> => {
    if (options.withFence) {
      return await options.withFence(fn);
    }
    if (options.executionMode === 'WORKER') {
      throw new AppError('Worker recovery requires an active distributed lease fencing wrapper', 409, 'WORKER_FENCE_REQUIRED');
    }
    /**
     * Non-worker administrative execution path:
     * Operates within a standalone MongoDB session transaction without distributed worker leader fencing.
     * Strictly reserved for administrative calls or non-worker maintenance.
     */
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const res = await fn(session);
      await session.commitTransaction();
      return res;
    } catch (err) {
      if (session.inTransaction()) {
        try {
          await session.abortTransaction();
        } catch {}
      }
      throw err;
    } finally {
      await session.endSession();
    }
  };

  try {
    if (refund.razorpayPaymentId.startsWith('pay_mock_')) {
      return await runWithFence(async (session) => {
        const freshRefund = await Refund.findById(refund._id).session(session);
        if (!freshRefund || (freshRefund.status !== 'UNKNOWN' && freshRefund.status !== 'PROCESSING' && freshRefund.status !== 'PENDING')) {
          return freshRefund || refund;
        }
        freshRefund.status = 'PROCESSED';
        freshRefund.submissionState = 'CONFIRMED';
        freshRefund.processedAt = freshRefund.processedAt || new Date();
        freshRefund.accountingSettlementStatus = 'PENDING';
        await freshRefund.save({ session });

        const transitionRes = await transitionPaymentReservation({
          paymentId: freshRefund.paymentId,
          refundId: freshRefund._id,
          reservationId: freshRefund._id.toString(),
          amount: freshRefund.amount,
          targetState: 'CONSUMED',
          attemptNumber: freshRefund.attemptNumber || 1,
          session
        });
        const paymentDoc = transitionRes.paymentDoc || (await Payment.findById(freshRefund.paymentId).session(session));
        let returnSyncSuccess = true;
        if (freshRefund.returnId) {
          const syncRes = await syncReturnRequestWithRefund({
            returnId: freshRefund.returnId,
            refundId: freshRefund._id,
            orderId: freshRefund.orderId || paymentDoc?.orderId,
            refundStatus: 'PROCESSED',
            attemptNumber: freshRefund.attemptNumber,
            session
          });
          returnSyncSuccess = syncRes.success;
        }
        const isSettled = transitionRes.success && paymentDoc && !paymentDoc.reconciliationRequired && returnSyncSuccess;
        freshRefund.accountingSettlementStatus = isSettled ? 'COMPLETED' : 'RECONCILIATION_REQUIRED';
        await freshRefund.save({ session });
        return freshRefund;
      });
    }

    const rzpClient = razorpayProvider.getClient() as unknown as {
      payments: {
        refunds: (paymentId: string) => Promise<{ items?: Array<{ id: string; status: string; amount?: number; currency?: string; payment_id?: string; notes?: Record<string, string>; error_description?: string }> }>;
      };
      refunds: {
        fetch: (refundId: string) => Promise<{ id: string; status: string; amount?: number; currency?: string; payment_id?: string; notes?: Record<string, string>; error_description?: string }>;
      };
    };

    let matched: { id: string; status: string; amount?: number; currency?: string; payment_id?: string; notes?: Record<string, string>; error_description?: string } | undefined;

    // 1. Direct fetch if razorpayRefundId is known
    if (refund.razorpayRefundId) {
      try {
        matched = await rzpClient.refunds.fetch(refund.razorpayRefundId);
      } catch {
        // Fall back to listing
      }
    }

    // 2. Query payment refunds list if direct fetch did not locate it
    if (!matched) {
      const refundsList = await rzpClient.payments.refunds(refund.razorpayPaymentId);
      const items = refundsList.items || [];
      if (refund.razorpayRefundId) {
        // If razorpayRefundId is already saved, NEVER replace it with a different candidate!
        matched = items.find(r => r.id === refund.razorpayRefundId);
        if (!matched) {
          const conflictingCandidate = items.find(r => r.notes?.internal_refund_id === refund._id.toString());
          if (conflictingCandidate && conflictingCandidate.id !== refund.razorpayRefundId) {
            await runWithFence(async (session) => {
              await Refund.updateOne(
                { _id: refund._id },
                { $set: { status: 'UNKNOWN', failureReason: `Conflicting provider refund ID in gateway listing: saved ${refund.razorpayRefundId} !== candidate ${conflictingCandidate.id}` } },
                { session }
              );
              await Payment.updateOne(
                { _id: refund.paymentId },
                { $set: { reconciliationRequired: true, reconciliationReason: `Provider refund ID conflict on refund ${refund._id}` } },
                { session }
              );
            });
            refund.status = 'UNKNOWN';
            refund.failureReason = `Conflicting provider refund ID in gateway listing: saved ${refund.razorpayRefundId} !== candidate ${conflictingCandidate.id}`;
            return refund;
          }
        }
      } else {
        matched = items.find(r => r.notes?.internal_refund_id === refund._id.toString());
      }
    }

    if (matched) {
      return await runWithFence(async (session) => {
        const freshRefund = await Refund.findById(refund._id).session(session);
        if (!freshRefund || (freshRefund.status !== 'UNKNOWN' && freshRefund.status !== 'PROCESSING' && freshRefund.status !== 'PENDING')) {
          return freshRefund || refund;
        }
        const freshPayment = await Payment.findById(freshRefund.paymentId).session(session);
        if (!freshPayment) {
          freshRefund.status = 'UNKNOWN';
          freshRefund.accountingSettlementStatus = 'RECONCILIATION_REQUIRED';
          freshRefund.failureReason = 'Payment record not found during reconciliation';
          await freshRefund.save({ session });
          return freshRefund;
        }

        // Strict provider identity validation using freshly loaded documents inside fence
        let identityConflictReason: string | undefined;

        const provRefundId = matched!.id;
        const provPaymentId = matched!.payment_id;
        const provAmount = matched!.amount;
        const provCurrency = matched!.currency;

        if (!provRefundId || typeof provRefundId !== 'string' || !provRefundId.trim()) {
          identityConflictReason = 'Missing or invalid provider refund ID';
        } else if (!provPaymentId || typeof provPaymentId !== 'string' || !provPaymentId.trim()) {
          identityConflictReason = 'Missing or invalid provider parent payment ID';
        } else if (typeof provAmount !== 'number' || !Number.isFinite(provAmount) || !Number.isInteger(provAmount) || provAmount <= 0) {
          identityConflictReason = `Missing, non-finite, non-integer, or non-positive provider refund amount: ${provAmount}`;
        } else if (!provCurrency || typeof provCurrency !== 'string' || !provCurrency.trim()) {
          identityConflictReason = 'Missing or invalid provider refund currency';
        } else if (!freshPayment.razorpayPaymentId || typeof freshPayment.razorpayPaymentId !== 'string' || !freshPayment.razorpayPaymentId.trim()) {
          identityConflictReason = 'Internal Payment record missing razorpayPaymentId';
        } else if (freshRefund.razorpayPaymentId && freshRefund.razorpayPaymentId.trim() && freshRefund.razorpayPaymentId !== freshPayment.razorpayPaymentId) {
          identityConflictReason = `Conflicting internal Payment and Refund provider IDs: refund ${freshRefund.razorpayPaymentId} !== payment ${freshPayment.razorpayPaymentId}`;
        } else if (provPaymentId !== freshPayment.razorpayPaymentId || (freshRefund.razorpayPaymentId && freshRefund.razorpayPaymentId.trim() && provPaymentId !== freshRefund.razorpayPaymentId)) {
          identityConflictReason = `Provider payment_id ${provPaymentId} does not match internal payment ${freshPayment.razorpayPaymentId}`;
        } else {
          const expectedPaise = Math.round(freshRefund.amount * 100);
          if (provAmount !== expectedPaise) {
            identityConflictReason = `Provider amount mismatch: provider ${provAmount} paise !== expected ${expectedPaise} paise`;
          } else {
            const normProvCur = provCurrency.trim().toUpperCase();
            const normRefCur = (freshRefund.currency || 'INR').trim().toUpperCase();
            const normPayCur = (freshPayment.currency || 'INR').trim().toUpperCase();
            if (normProvCur !== normRefCur) {
              identityConflictReason = `Provider currency ${normProvCur} does not match internal Refund currency ${normRefCur}`;
            } else if (normProvCur !== normPayCur) {
              identityConflictReason = `Provider currency ${normProvCur} does not match internal Payment currency ${normPayCur}`;
            } else if (matched!.notes?.internal_refund_id && matched!.notes.internal_refund_id !== freshRefund._id.toString()) {
              identityConflictReason = `Provider notes internal_refund_id ${matched!.notes.internal_refund_id} does not match internal Refund ${freshRefund._id}`;
            } else if (freshRefund.razorpayRefundId && freshRefund.razorpayRefundId.trim() && freshRefund.razorpayRefundId !== provRefundId) {
              identityConflictReason = `Provider refund ID conflict: saved ${freshRefund.razorpayRefundId} !== provider ${provRefundId}`;
            }
          }
        }

        if (identityConflictReason) {
          freshRefund.status = 'UNKNOWN';
          freshRefund.accountingSettlementStatus = 'RECONCILIATION_REQUIRED';
          freshRefund.failureReason = identityConflictReason;
          await freshRefund.save({ session });

          freshPayment.reconciliationRequired = true;
          freshPayment.reconciliationReason = identityConflictReason;
          await freshPayment.save({ session });

          return freshRefund;
        }

        if (matched!.status === 'processed') {
          freshRefund.status = 'PROCESSED';
          freshRefund.submissionState = 'CONFIRMED';
          freshRefund.razorpayRefundId = provRefundId;
          freshRefund.processedAt = freshRefund.processedAt || new Date();
          freshRefund.accountingSettlementStatus = 'PENDING';
          await freshRefund.save({ session });

          const transitionRes = await transitionPaymentReservation({
            paymentId: freshRefund.paymentId,
            refundId: freshRefund._id,
            reservationId: freshRefund._id.toString(),
            amount: freshRefund.amount,
            targetState: 'CONSUMED',
            attemptNumber: freshRefund.attemptNumber || 1,
            razorpayRefundId: provRefundId,
            session
          });

          const policy = await resolveSettlementPolicy({
            paymentId: freshRefund.paymentId,
            refundId: freshRefund._id,
            transitionOutcome: transitionRes.outcome,
            expectedReservationId: freshRefund._id.toString(),
            expectedAttemptNumber: freshRefund.attemptNumber || 1,
            expectedAmount: freshRefund.amount,
            expectedProviderRefundId: provRefundId,
            expectedCurrency: freshRefund.currency,
            session
          });

          let settlementRes: ApplySettlementResult | undefined;
          if (policy.canProceedToSettlement) {
            settlementRes = await applyProviderRefundSettlement({
              paymentId: freshRefund.paymentId,
              refundId: freshRefund._id,
              razorpayRefundId: provRefundId,
              amount: freshRefund.amount,
              currency: freshRefund.currency,
              unlinked: policy.isUnlinkedSettlement,
              settlementReason: policy.settlementReason,
              expectedReservationId: freshRefund._id.toString(),
              expectedAttemptNumber: freshRefund.attemptNumber || 1,
              session
            });
          }

          let returnSyncSuccess = !freshRefund.returnId;
          if (freshRefund.returnId) {
            const refundOrderId = freshRefund.orderId ? freshRefund.orderId.toString() : undefined;
            const paymentOrderId = freshPayment.orderId ? freshPayment.orderId.toString() : undefined;
            if (refundOrderId && paymentOrderId && refundOrderId !== paymentOrderId) {
              returnSyncSuccess = false;
            } else {
              const authoritativeOrderId = refundOrderId || paymentOrderId;
              if (!authoritativeOrderId) {
                returnSyncSuccess = false;
              } else {
                try {
                  const syncRes = await syncReturnRequestWithRefund({
                    returnId: freshRefund.returnId,
                    refundId: freshRefund._id,
                    orderId: authoritativeOrderId,
                    refundStatus: 'PROCESSED',
                    attemptNumber: freshRefund.attemptNumber,
                    session
                  });
                  returnSyncSuccess = Boolean(syncRes && syncRes.success);
                } catch {
                  returnSyncSuccess = false;
                }
              }
            }
          }

          const paymentDoc = settlementRes?.paymentDoc || transitionRes.paymentDoc || (await Payment.findById(freshRefund.paymentId).session(session));
          const isSettled = (transitionRes.outcome === 'APPLIED' || transitionRes.outcome === 'ALREADY_APPLIED') &&
            Boolean(settlementRes?.success || settlementRes?.outcome === 'ALREADY_SETTLED') &&
            paymentDoc &&
            !paymentDoc.reconciliationRequired &&
            returnSyncSuccess;

          freshRefund.accountingSettlementStatus = isSettled ? 'COMPLETED' : 'RECONCILIATION_REQUIRED';
          await freshRefund.save({ session });
          return freshRefund;

        } else if (matched!.status === 'failed') {
          freshRefund.status = 'FAILED';
          freshRefund.submissionState = 'RESPONSE_RECEIVED';
          freshRefund.razorpayRefundId = provRefundId;
          freshRefund.failureReason = matched!.error_description || 'Gateway reported definitive refund failure';
          freshRefund.accountingSettlementStatus = 'PENDING';
          await freshRefund.save({ session });

          const failTransitionRes = await transitionPaymentReservation({
            paymentId: freshRefund.paymentId,
            refundId: freshRefund._id,
            reservationId: freshRefund._id.toString(),
            amount: freshRefund.amount,
            targetState: 'RELEASED',
            attemptNumber: freshRefund.attemptNumber || 1,
            razorpayRefundId: provRefundId,
            session
          });

          let returnSyncSuccess = !freshRefund.returnId;
          if (freshRefund.returnId) {
            const refundOrderId = freshRefund.orderId ? freshRefund.orderId.toString() : undefined;
            const paymentOrderId = freshPayment.orderId ? freshPayment.orderId.toString() : undefined;
            if (refundOrderId && paymentOrderId && refundOrderId !== paymentOrderId) {
              returnSyncSuccess = false;
            } else {
              const authoritativeOrderId = refundOrderId || paymentOrderId;
              if (!authoritativeOrderId) {
                returnSyncSuccess = false;
              } else {
                try {
                  const syncRes = await syncReturnRequestWithRefund({
                    returnId: freshRefund.returnId,
                    refundId: freshRefund._id,
                    orderId: authoritativeOrderId,
                    refundStatus: 'FAILED',
                    attemptNumber: freshRefund.attemptNumber,
                    refundError: freshRefund.failureReason,
                    session
                  });
                  returnSyncSuccess = Boolean(syncRes && syncRes.success);
                } catch {
                  returnSyncSuccess = false;
                }
              }
            }
          }

          const failPaymentDoc = failTransitionRes.paymentDoc || (await Payment.findById(freshRefund.paymentId).session(session));
          const failIsSettled = failTransitionRes.success && failPaymentDoc && !failPaymentDoc.reconciliationRequired && returnSyncSuccess;
          freshRefund.accountingSettlementStatus = failIsSettled ? 'COMPLETED' : 'RECONCILIATION_REQUIRED';
          await freshRefund.save({ session });
          return freshRefund;

        } else {
          // status is 'pending' or queued on gateway
          freshRefund.status = 'PENDING';
          freshRefund.razorpayRefundId = provRefundId;
          freshRefund.accountingSettlementStatus = 'RECONCILIATION_REQUIRED';
          await freshRefund.save({ session });
          if (freshRefund.returnId) {
            await syncReturnRequestWithRefund({
              returnId: freshRefund.returnId,
              refundId: freshRefund._id,
              orderId: freshRefund.orderId || freshPayment.orderId,
              refundStatus: 'PENDING',
              attemptNumber: freshRefund.attemptNumber,
              session
            });
          }
          return freshRefund;
        }
      });
    } else if (options.forceAdministrativeFailure) {
      return await runWithFence(async (session) => {
        const freshRefund = await Refund.findById(refund._id).session(session);
        if (!freshRefund) throw new AppError('Refund record not found', 404);
        freshRefund.status = 'FAILED';
        freshRefund.submissionState = 'CONFIRMED';
        freshRefund.failureReason = options.adminReason || 'Administrative override: confirmed refund not created on gateway.';
        await freshRefund.save({ session });

        const failTransitionRes = await transitionPaymentReservation({
          paymentId: freshRefund.paymentId,
          refundId: freshRefund._id,
          reservationId: freshRefund._id.toString(),
          amount: freshRefund.amount,
          targetState: 'RELEASED',
          attemptNumber: freshRefund.attemptNumber || 1,
          session
        });
        if (freshRefund.returnId) {
          await syncReturnRequestWithRefund({
            returnId: freshRefund.returnId,
            refundId: freshRefund._id,
            orderId: freshRefund.orderId,
            refundStatus: 'FAILED',
            attemptNumber: freshRefund.attemptNumber,
            refundError: freshRefund.failureReason,
            session
          });
        }
        const failPaymentDoc = failTransitionRes.paymentDoc || (await Payment.findById(freshRefund.paymentId).session(session));
        const failIsSettled = failTransitionRes.success && failPaymentDoc && !failPaymentDoc.reconciliationRequired;
        freshRefund.accountingSettlementStatus = failIsSettled ? 'COMPLETED' : 'RECONCILIATION_REQUIRED';
        await freshRefund.save({ session });
        return freshRefund;
      });
    } else {
      return await runWithFence(async (session) => {
        const freshRefund = await Refund.findById(refund._id).session(session);
        if (!freshRefund) return refund;
        freshRefund.status = 'UNKNOWN';
        freshRefund.failureReason = 'Reconciliation inconclusive: provider refund record not present in initial list. Reserved balance held.';
        freshRefund.reconciliationAttemptCount = (freshRefund.reconciliationAttemptCount || 0) + 1;
        const backoffMs = Math.min(3600_000, 10_000 * Math.pow(2, freshRefund.reconciliationAttemptCount));
        freshRefund.nextReconcileAt = new Date(Date.now() + backoffMs);
        await freshRefund.save({ session });
        return freshRefund;
      });
    }
  } catch (err: unknown) {
    if (isRecognizedWorkerFenceOrAbortError(err)) {
      throw err;
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new AppError(`Reconciliation failed: ${msg}`, 502);
  }
}

/**
 * Recovers incomplete refund operations interrupted across process crashes.
 */
export async function reconcileIncompleteRefundOperations(options: {
  staleThresholdMs?: number;
  fenceContext?: any;
  withFence?: <T>(fn: (session: mongoose.ClientSession) => Promise<T>) => Promise<T>;
  leaseGuard?: () => Promise<boolean> | boolean;
  executionMode?: 'WORKER' | 'ADMINISTRATIVE';
  allowUnfencedAdmin?: boolean;
} = {}): Promise<{ recoveredCount: number }> {
  let recoveredCount = 0;
  const thresholdMs = options.staleThresholdMs !== undefined ? options.staleThresholdMs : 60_000;
  const staleThreshold = new Date(Date.now() - thresholdMs);
  // 1. Recover any ReturnRequests stuck in PROCESSING without linked refund
  // Must only treat as orphaned if claim lease has EXPIRED
  const orphanReturnRequests = await ReturnRequest.find({
    refundStatus: 'PROCESSING',
    refundId: null,
    $or: [
      { refundClaimExpiresAt: { $lt: new Date() } },
      { refundClaimExpiresAt: { $exists: false } }
    ]
  });

  const runWithFence = async <T>(fn: (session?: mongoose.ClientSession) => Promise<T>): Promise<T> => {
    if (options.withFence) {
      return await options.withFence(async (session) => fn(session));
    }
    if (options.executionMode === 'WORKER' || options.fenceContext) {
      throw new AppError('Worker recovery requires an active distributed lease fencing wrapper', 409, 'WORKER_FENCE_REQUIRED');
    }
    return await fn();
  };

  for (const ret of orphanReturnRequests) {
    if (options.leaseGuard && !(await options.leaseGuard())) break;
    await runWithFence(async (session) => {
      const freshRet = await ReturnRequest.findById(ret._id).session(session || null);
      if (!freshRet || freshRet.refundStatus !== 'PROCESSING' || freshRet.refundId) return;

      const matchingRefund = await Refund.findOne({
        returnId: freshRet._id,
        attemptNumber: freshRet.refundAttempt
      }).session(session || null);

      if (matchingRefund) {
        await ReturnRequest.updateOne(
          { _id: freshRet._id, refundStatus: 'PROCESSING', refundAttempt: freshRet.refundAttempt },
          { $set: { refundId: matchingRefund._id } },
          { session: session || undefined }
        );
        recoveredCount++;
      } else {
        await ReturnRequest.updateOne(
          {
            _id: freshRet._id,
            refundStatus: 'PROCESSING',
            refundAttempt: freshRet.refundAttempt,
            refundClaimToken: freshRet.refundClaimToken
          },
          {
            $set: {
              refundStatus: 'FAILED',
              refundError: 'Interrupted before refund intent creation; safely recovered.'
            },
            $unset: { refundClaimToken: 1, refundClaimExpiresAt: 1 }
          },
          { session: session || undefined }
        );
        const orphanPayment = await Payment.findOne({ orderId: freshRet.orderId }).session(session || null);
        if (orphanPayment && orphanPayment.pendingRefundAmount > 0) {
          await Payment.updateOne(
            { _id: orphanPayment._id },
            {
              $set: {
                reconciliationRequired: true,
                reconciliationReason: `Orphan ReturnRequest ${freshRet._id} on Order ${freshRet.orderId} has no matching Refund document; preserved aggregate pending balance ₹${orphanPayment.pendingRefundAmount} on Payment ${orphanPayment._id}`
              }
            },
            { session: session || undefined }
          );
        }
        recoveredCount++;
      }
    });
  }
  // 1b. Reconcile stale PROCESSING refunds (H3)
  const now = new Date();
  const staleRefunds = await Refund.find({
    status: 'PROCESSING',
    updatedAt: { $lt: staleThreshold },
    $or: [
      { submissionClaimExpiresAt: { $exists: false } },
      { submissionClaimExpiresAt: null },
      { submissionClaimExpiresAt: { $lt: now } }
    ]
  }).limit(20);

  for (const sRef of staleRefunds) {
    if (options.leaseGuard && !(await options.leaseGuard())) break;
    if (sRef.submissionState === 'INTENT_CREATED') {
      if (sRef.autoSubmitOnRecovery || sRef.reason === 'AUTO_REFUND_STOCK_UNAVAILABLE') {
        try {
          if (options.withFence) {
            const dispatchAuthorized = await options.withFence(async (session) => {
              const currentRefund = await Refund.findOne({
                _id: sRef._id,
                status: 'PROCESSING',
                submissionState: 'INTENT_CREATED',
                $or: [
                  { submissionClaimExpiresAt: { $exists: false } },
                  { submissionClaimExpiresAt: null },
                  { submissionClaimExpiresAt: { $lt: new Date() } }
                ]
              }).session(session);
              return Boolean(currentRefund);
            });
            if (!dispatchAuthorized) continue;
          } else if (options.executionMode === 'WORKER' || options.fenceContext) {
            throw new AppError(
              'Worker recovery requires an active distributed lease fencing wrapper',
              409,
              'WORKER_FENCE_REQUIRED'
            );
          }
          await submitRefundToGateway(sRef._id.toString());
          recoveredCount++;
        } catch (submitErr: unknown) {
          if (isRecognizedWorkerFenceOrAbortError(submitErr)) {
            throw submitErr;
          }
          console.warn(`[RECOVERY] Failed to submit recovered refund intent ${sRef._id}:`, submitErr);
        }
      } else {
        const runIntentRecovery = async (session?: mongoose.ClientSession) => {
          const claimRecoveryToken = `recov_${crypto.randomUUID()}`;
          const claimedStale = await Refund.findOneAndUpdate(
          {
            _id: sRef._id,
            status: 'PROCESSING',
            submissionState: 'INTENT_CREATED',
            $or: [
              { submissionClaimExpiresAt: { $exists: false } },
              { submissionClaimExpiresAt: null },
              { submissionClaimExpiresAt: { $lt: now } }
            ]
          },
          {
            $set: {
              status: 'FAILED',
              submissionState: 'RESPONSE_RECEIVED',
              accountingSettlementStatus: 'PENDING',
              failureReason: 'Interrupted before gateway submission; reservation released.',
              submissionClaimToken: claimRecoveryToken,
              submissionClaimExpiresAt: new Date(Date.now() + 60_000)
            }
          },
          { session: session || undefined, returnDocument: 'after' }
        );

        if (claimedStale) {
          const transitionRes = await transitionPaymentReservation({
            paymentId: sRef.paymentId,
            refundId: sRef._id,
            reservationId: sRef._id.toString(),
            amount: sRef.amount,
            targetState: 'RELEASED',
            attemptNumber: sRef.attemptNumber || 1,
            session
          });

          // Defect D5: Fix stale INTENT_CREATED recovery ReturnRequest verification
          let returnSyncSuccess = true;
          if (sRef.returnId) {
            const retUpdateRes = await ReturnRequest.updateOne(
              {
                _id: sRef.returnId,
                orderId: sRef.orderId,
                refundId: sRef._id,
                refundAttempt: sRef.attemptNumber,
                refundStatus: 'PROCESSING'
              },
              {
                $set: {
                  refundStatus: 'FAILED',
                  refundError: 'Interrupted before gateway submission; reservation released.'
                },
                $unset: { refundClaimToken: 1, refundClaimExpiresAt: 1 }
              },
              { session: session || undefined }
            );

            if (retUpdateRes.matchedCount === 0) {
              returnSyncSuccess = false;
            } else {
              const persistedRet = await ReturnRequest.findById(sRef.returnId).session(session || null);
              returnSyncSuccess = Boolean(
                persistedRet &&
                persistedRet.refundStatus === 'FAILED' &&
                persistedRet.refundId?.toString() === sRef._id.toString() &&
                persistedRet.orderId?.toString() === sRef.orderId?.toString() &&
                (sRef.attemptNumber ? persistedRet.refundAttempt === sRef.attemptNumber : true)
              );
            }
          }

          const paymentDoc = transitionRes.paymentDoc || (await Payment.findById(sRef.paymentId).session(session || null));
          const isSettled = transitionRes.success && paymentDoc && !paymentDoc.reconciliationRequired && returnSyncSuccess;

          await Refund.updateOne(
            { _id: sRef._id, submissionClaimToken: claimRecoveryToken },
            {
              $set: {
                accountingSettlementStatus: isSettled ? 'COMPLETED' : 'RECONCILIATION_REQUIRED'
              },
              $unset: { submissionClaimToken: 1, submissionClaimExpiresAt: 1 }
            },
            { session: session || undefined }
          );
          recoveredCount++;
        }
        };

        if (options.withFence) {
          await options.withFence(async (session) => runIntentRecovery(session));
        } else {
          await runIntentRecovery();
        }
      }
    } else {
      try {
        await reconcileUnknownRefund(sRef._id.toString(), {
          withFence: options.withFence,
          executionMode: options.executionMode
        });
        recoveredCount++;
      } catch (recErr: unknown) {
        if (isRecognizedWorkerFenceOrAbortError(recErr)) {
          throw recErr;
        }
        console.warn(`[RECOVERY] Failed to reconcile stale refund ${sRef._id}:`, recErr);
      }
    }
  }
  // 1c. Reconcile in-doubt UNKNOWN and PENDING refunds with bounded lookups & backoff (H4)
  const eligibleInDoubtRefunds = await Refund.find({
    status: { $in: ['UNKNOWN', 'PENDING'] },
    $or: [
      { nextReconcileAt: { $exists: false } },
      { nextReconcileAt: null },
      { nextReconcileAt: { $lte: now } }
    ]
  })
    .sort({ nextReconcileAt: 1, updatedAt: 1 })
    .limit(20);

  for (const ref of eligibleInDoubtRefunds) {
    if (options.leaseGuard && !(await options.leaseGuard())) break;
    const attempts = (ref.reconciliationAttemptCount || 0) + 1;
    const backoffMs = Math.min(3600_000, 10_000 * Math.pow(2, attempts));
    const nextReconcileAt = new Date(Date.now() + backoffMs);

    try {
      const recResult = await reconcileUnknownRefund(ref._id.toString(), {
        withFence: options.withFence,
        executionMode: options.executionMode
      });
      if (recResult.status === 'UNKNOWN' || recResult.status === 'PENDING') {
        const updateDoc = {
          $set: {
            lastReconciledAt: new Date(),
            nextReconcileAt,
            reconciliationAttemptCount: attempts,
            ...(attempts >= 10 ? { accountingSettlementStatus: 'RECONCILIATION_REQUIRED', failureReason: 'Exceeded maximum automatic reconciliation attempts (10); manual review required' } : {})
          }
        };
        if (options.withFence) {
          await options.withFence(async (session) => {
            await Refund.updateOne({ _id: ref._id }, updateDoc, { session });
          });
        } else {
          await Refund.updateOne({ _id: ref._id }, updateDoc);
        }
      }
      recoveredCount++;
    } catch (err: unknown) {
      if (isRecognizedWorkerFenceOrAbortError(err)) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      const errUpdateDoc = {
        $set: {
          lastReconciledAt: new Date(),
          nextReconcileAt,
          reconciliationAttemptCount: attempts,
          lastReconciliationError: msg
        }
      };
      if (options.withFence) {
        await options.withFence(async (session) => {
          await Refund.updateOne({ _id: ref._id }, errUpdateDoc, { session });
        });
      } else {
        await Refund.updateOne({ _id: ref._id }, errUpdateDoc);
      }
    }
  }

  // 1d. Recover terminal refunds with incomplete accounting settlement (B4)
  const unsettledFilter: Record<string, unknown> = {
    status: { $in: ['PROCESSED', 'FAILED'] },
    accountingSettlementStatus: { $in: ['PENDING', 'PROCESSING'] },
    $or: [
      { nextSettlementRetryAt: { $exists: false } },
      { nextSettlementRetryAt: null },
      { nextSettlementRetryAt: { $lte: now } }
    ]
  };
  const unsettledRefunds = await Refund.find(unsettledFilter)
    .sort({ nextSettlementRetryAt: 1, updatedAt: 1, createdAt: 1 })
    .limit(20);

  for (const uRef of unsettledRefunds) {
    if (options.leaseGuard && !(await options.leaseGuard())) break;
    const runUnsettledRecovery = async (session?: mongoose.ClientSession) => {
      const freshURef = await Refund.findById(uRef._id).session(session || null);
      if (!freshURef || freshURef.accountingSettlementStatus === 'COMPLETED') {
        return;
      }

      const payDoc = await Payment.findById(freshURef.paymentId).session(session || null);
      if (!payDoc) {
        await Refund.updateOne(
          { _id: freshURef._id },
          { $set: { accountingSettlementStatus: 'RECONCILIATION_REQUIRED', failureReason: 'Payment document not found during recovery' } },
          { session: session || undefined }
        );
        return;
      }
      const targetState = freshURef.status === 'PROCESSED' ? 'CONSUMED' : 'RELEASED';
      const matchingReservationInPay = (payDoc.refundReservations || []).find(
        r => r.refundId && r.refundId.toString() === freshURef._id.toString()
      );
      const expectedResId = matchingReservationInPay ? matchingReservationInPay.reservationId : freshURef._id.toString();

      const transitionRes = await transitionPaymentReservation({
        paymentId: freshURef.paymentId,
        refundId: freshURef._id,
        reservationId: matchingReservationInPay ? matchingReservationInPay.reservationId : undefined,
        amount: freshURef.amount,
        targetState,
        session,
        attemptNumber: freshURef.attemptNumber || 1,
        razorpayRefundId: freshURef.razorpayRefundId
      });

      let settlementRes: ApplySettlementResult | undefined;
      if (freshURef.status === 'PROCESSED') {
        const policy = await resolveSettlementPolicy({
          paymentId: freshURef.paymentId,
          refundId: freshURef._id,
          transitionOutcome: transitionRes.outcome,
          expectedReservationId: expectedResId,
          expectedAttemptNumber: freshURef.attemptNumber || 1,
          expectedAmount: freshURef.amount,
          expectedProviderRefundId: freshURef.razorpayRefundId,
          expectedCurrency: freshURef.currency,
          session
        });
        if (policy.canProceedToSettlement) {
          settlementRes = await applyProviderRefundSettlement({
            paymentId: freshURef.paymentId,
            refundId: freshURef._id,
            razorpayRefundId: freshURef.razorpayRefundId,
            amount: freshURef.amount,
            currency: freshURef.currency,
            session,
            unlinked: policy.isUnlinkedSettlement,
            settlementReason: policy.settlementReason,
            expectedReservationId: expectedResId,
            expectedAttemptNumber: freshURef.attemptNumber || 1
          });
        }
      }

      let returnSyncSuccess = true;
      if (freshURef.returnId) {
        const syncRes = await syncReturnRequestWithRefund({
          returnId: freshURef.returnId,
          refundId: freshURef._id,
          orderId: freshURef.orderId,
          refundStatus: freshURef.status === 'PROCESSED' ? 'PROCESSED' : 'FAILED',
          attemptNumber: freshURef.attemptNumber,
          session
        });

        if (syncRes.success) {
          returnSyncSuccess = true;
        } else {
          // Explicit persisted-state verification requiring exact same Refund ID, attempt, order and status: 'COMPLETED' (Defect D4)
          const persistedRet = await ReturnRequest.findById(freshURef.returnId).session(session || null);
          returnSyncSuccess = Boolean(
            persistedRet &&
            persistedRet.orderId.toString() === freshURef.orderId.toString() &&
            persistedRet.refundId?.toString() === freshURef._id.toString() &&
            (freshURef.attemptNumber ? persistedRet.refundAttempt === freshURef.attemptNumber : true) &&
            persistedRet.status === 'COMPLETED' &&
            persistedRet.refundStatus === 'PROCESSED' &&
            persistedRet.inventoryRestored === true
          );
        }
      }

      const paymentDoc = settlementRes?.paymentDoc || transitionRes.paymentDoc || (await Payment.findById(freshURef.paymentId).session(session || null));
      const isSettled = (transitionRes.outcome === 'APPLIED' || transitionRes.outcome === 'ALREADY_APPLIED') &&
        (!settlementRes || settlementRes.success) &&
        paymentDoc &&
        !paymentDoc.reconciliationRequired &&
        returnSyncSuccess;

      await Refund.updateOne(
        { _id: freshURef._id },
        { $set: { accountingSettlementStatus: isSettled ? 'COMPLETED' : 'RECONCILIATION_REQUIRED' } },
        { session: session || undefined }
      );
      recoveredCount++;
    };

    if (options.withFence) {
      await options.withFence(async (session) => runUnsettledRecovery(session));
    } else {
      await runUnsettledRecovery();
    }
  }

  // 2. Recover any payments with orphaned PENDING reservations
  const paymentsWithPendingReservations = await Payment.find({
    'refundReservations.status': 'PENDING'
  });

  for (const p of paymentsWithPendingReservations) {
    if (options.leaseGuard && !(await options.leaseGuard())) break;
    for (const res of p.refundReservations) {
      if (res.status !== 'PENDING') continue;

      const runPendingResRecovery = async (session?: mongoose.ClientSession) => {
        const matchingRefund = await Refund.findById(res.refundId).session(session || null);
        if (!matchingRefund) {
          await transitionPaymentReservation({
            paymentId: p._id,
            refundId: res.refundId,
            reservationId: res.reservationId,
            amount: res.amount,
            targetState: 'RELEASED',
            session
          });
          await Payment.updateOne(
            { _id: p._id },
            { $set: { reconciliationRequired: true, reconciliationReason: `Orphaned reservation ${res.reservationId} released: Refund document ${res.refundId} missing` } },
            { session: session || undefined }
          );
          recoveredCount++;
          return;
        }

        if (matchingRefund.paymentId.toString() !== p._id.toString()) {
          await Payment.updateOne(
            { _id: p._id },
            { $set: { reconciliationRequired: true, reconciliationReason: `Reservation ${res.reservationId} paymentId mismatch with refund ${matchingRefund._id}` } },
            { session: session || undefined }
          );
          return;
        }

        const freshPayment = await Payment.findById(p._id).session(session || null);
        const existingSettled = (freshPayment?.settledRefunds || []).find(
          s => s.refundId && s.refundId.toString() === matchingRefund._id.toString()
        );
        if (existingSettled && existingSettled.unlinked) {
          await Payment.updateOne(
            {
              _id: p._id,
              'refundReservations.reservationId': res.reservationId,
              'refundReservations.status': 'PENDING'
            },
            {
              $set: {
                'refundReservations.$.status': 'CONSUMED',
                'refundReservations.$.updatedAt': new Date()
              }
            },
            { session: session || undefined }
          );
          recoveredCount++;
          return;
        }

        if (matchingRefund.status === 'FAILED') {
          await transitionPaymentReservation({
            paymentId: p._id,
            refundId: res.refundId,
            reservationId: res.reservationId,
            amount: res.amount,
            targetState: 'RELEASED',
            session,
            attemptNumber: res.attemptNumber
          });
          recoveredCount++;
        } else if (matchingRefund.status === 'PROCESSED') {
          await transitionPaymentReservation({
            paymentId: p._id,
            refundId: res.refundId,
            reservationId: res.reservationId,
            amount: res.amount,
            targetState: 'CONSUMED',
            session,
            attemptNumber: res.attemptNumber
          });
          recoveredCount++;
        }
      };

      if (options.withFence) {
        await options.withFence(async (session) => runPendingResRecovery(session));
      } else {
        await runPendingResRecovery();
      }
    }
  }

  // 3. Read-only reconciliation check for pending balances and reservations (H2)
  const allPaymentsWithPending = await Payment.find({
    $or: [
      { pendingRefundAmount: { $gt: 0 } },
      { 'refundReservations.status': 'PENDING' }
    ]
  });

  for (const p of allPaymentsWithPending) {
    const activeRefunds = await Refund.find({
      paymentId: p._id,
      status: { $in: ['PENDING', 'PROCESSING', 'UNKNOWN'] }
    });

    const pendingReservations = (p.refundReservations || []).filter(r => r.status === 'PENDING');
    const activePendingSum = pendingReservations.reduce((sum, r) => sum + (r.amount || 0), 0);
    const pendingBalance = p.pendingRefundAmount || 0;

    // Find active refunds lacking reservations
    const unreservedActive = activeRefunds.filter(actRef =>
      !pendingReservations.some(
        r => r.reservationId === actRef._id.toString() || (r.refundId && r.refundId.toString() === actRef._id.toString())
      )
    );

    const reasons: string[] = [];

    if (unreservedActive.length > 0) {
      reasons.push(
        `Active refund(s) without matching reservations: ${unreservedActive.map(r => `${r._id} (₹${r.amount})`).join(', ')}`
      );
    }

    if (pendingBalance > activePendingSum + 0.01) {
      reasons.push(
        `Aggregate pending balance ₹${pendingBalance.toFixed(2)} exceeds sum of active reservations ₹${activePendingSum.toFixed(2)}`
      );
    } else if (activePendingSum > pendingBalance + 0.01) {
      reasons.push(
        `Sum of active reservations ₹${activePendingSum.toFixed(2)} exceeds aggregate pending balance ₹${pendingBalance.toFixed(2)}`
      );
    }

    if (reasons.length > 0 && !p.reconciliationRequired) {
      await Payment.updateOne(
        { _id: p._id },
        {
          $set: {
            reconciliationRequired: true,
            reconciliationReason: reasons.join('; ') + '. Preserved for manual reconciliation.'
          }
        }
      );
    }
  }
  return { recoveredCount };
}
