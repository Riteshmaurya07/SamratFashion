import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IRefund extends Document {
  orderId: Types.ObjectId;
  paymentId: Types.ObjectId;
  userId: Types.ObjectId;
  returnId?: Types.ObjectId;
  attemptNumber?: number;
  idempotencyKey?: string;
  amount: number;
  currency: string;
  status: 'PENDING' | 'PROCESSING' | 'PROCESSED' | 'FAILED' | 'UNKNOWN' | 'CANCELLED';
  reason?: string;
  failureReason?: string;
  razorpayPaymentId?: string;
  razorpayRefundId?: string;
  initiatedBy: Types.ObjectId;
  initiatedByRole: string;
  submissionState?: 'INTENT_CREATED' | 'SUBMISSION_PENDING' | 'SUBMITTED' | 'RESPONSE_RECEIVED' | 'CONFIRMED';
  submittedAt?: Date;
  responseReceivedAt?: Date;
  processedAt?: Date;
  accountingSettlementStatus?: 'PENDING' | 'COMPLETED' | 'RECONCILIATION_REQUIRED';
  submissionClaimToken?: string;
  submissionClaimExpiresAt?: Date;
  nextReconcileAt?: Date;
  lastReconciledAt?: Date;
  reconciliationAttemptCount?: number;
  lastReconciliationError?: string;
  nextSettlementRetryAt?: Date;
  updatedAt: Date;
}

const refundSchema = new Schema<IRefund>({
  orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
  paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  returnId: { type: Schema.Types.ObjectId, ref: 'ReturnRequest', index: true },
  attemptNumber: { type: Number, default: 1 },
  idempotencyKey: { type: String, unique: true, sparse: true, index: true },
  amount: { type: Number, required: true },
  currency: { type: String, required: true, default: 'INR' },
  status: {
    type: String,
    enum: ['PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', 'UNKNOWN', 'CANCELLED'],
    default: 'PENDING'
  },
  reason: { type: String },
  failureReason: { type: String },
  razorpayPaymentId: { type: String },
  razorpayRefundId: { type: String, unique: true, sparse: true, index: true },
  initiatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  initiatedByRole: { type: String, required: true },
  submissionState: {
    type: String,
    enum: ['INTENT_CREATED', 'SUBMISSION_PENDING', 'SUBMITTED', 'RESPONSE_RECEIVED', 'CONFIRMED'],
    default: 'INTENT_CREATED'
  },
  submittedAt: { type: Date },
  responseReceivedAt: { type: Date },
  processedAt: { type: Date },
  accountingSettlementStatus: {
    type: String,
    enum: ['PENDING', 'COMPLETED', 'RECONCILIATION_REQUIRED'],
    default: 'PENDING'
  },
  submissionClaimToken: { type: String },
  submissionClaimExpiresAt: { type: Date },
  nextReconcileAt: { type: Date },
  lastReconciledAt: { type: Date },
  reconciliationAttemptCount: { type: Number, default: 0 },
  lastReconciliationError: { type: String },
  nextSettlementRetryAt: { type: Date }
}, { timestamps: true });

// Prevent concurrent active in-flight refund attempts for the same return.
// NOTE: Terminal PROCESSED is excluded so that late provider-confirmed successes on older attempts
// (e.g. Attempt A) can be recorded even while Attempt B is active.
refundSchema.index(
  { returnId: 1 },
  {
    unique: true,
    name: 'uniq_active_return_refund',
    partialFilterExpression: {
      returnId: { $exists: true },
      status: { $in: ['PENDING', 'PROCESSING', 'UNKNOWN'] }
    }
  }
);

// Efficient lookup index for scheduled recovery of pending/unknown refunds
refundSchema.index({ status: 1, nextReconcileAt: 1 });

// Prevent duplicate attempt numbers for the same return
refundSchema.index(
  { returnId: 1, attemptNumber: 1 },
  {
    unique: true,
    name: 'uniq_return_attempt',
    partialFilterExpression: { returnId: { $exists: true } }
  }
);


export const Refund = mongoose.model<IRefund>('Refund', refundSchema);
