import mongoose, { Document, Schema, Types } from 'mongoose';

export type DuplicateCaptureRefundStatus = 'PENDING' | 'PROCESSING' | 'PROCESSED' | 'FAILED' | 'UNKNOWN';

export interface IDuplicateCaptureRefund extends Document {
  orderId: Types.ObjectId;
  paymentId: Types.ObjectId;
  paymentAttemptId: Types.ObjectId;
  capturePaymentId: string;
  amount: number;
  currency: string;
  status: DuplicateCaptureRefundStatus;
  razorpayRefundId?: string;
  failureReason?: string;
  claimToken?: string;
  claimExpiresAt?: Date;
  processedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const duplicateCaptureRefundSchema = new Schema<IDuplicateCaptureRefund>({
  orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
  paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', required: true, index: true },
  paymentAttemptId: { type: Schema.Types.ObjectId, ref: 'PaymentAttempt', required: true, unique: true },
  capturePaymentId: { type: String, required: true },
  amount: { type: Number, required: true, min: 0.01 },
  currency: { type: String, required: true },
  status: {
    type: String,
    enum: ['PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', 'UNKNOWN'],
    default: 'PENDING',
    required: true,
  },
  razorpayRefundId: { type: String, unique: true, sparse: true },
  failureReason: { type: String },
  claimToken: { type: String, select: false },
  claimExpiresAt: { type: Date, select: false },
  processedAt: { type: Date },
}, { timestamps: true });

export const DuplicateCaptureRefund = mongoose.model<IDuplicateCaptureRefund>(
  'DuplicateCaptureRefund',
  duplicateCaptureRefundSchema
);
