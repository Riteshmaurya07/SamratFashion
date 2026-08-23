import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IRefund extends Document {
  orderId: Types.ObjectId;
  paymentId: Types.ObjectId;
  userId: Types.ObjectId;
  amount: number;
  currency: string;
  status: 'PENDING' | 'PROCESSED' | 'FAILED' | 'CANCELLED';
  reason?: string;
  razorpayPaymentId?: string;
  razorpayRefundId?: string;
  initiatedBy: Types.ObjectId;
  initiatedByRole: string;
  createdAt: Date;
  updatedAt: Date;
}

const refundSchema = new Schema<IRefund>({
  orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
  paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true },
  currency: { type: String, required: true, default: 'INR' },
  status: { 
    type: String, 
    enum: ['PENDING', 'PROCESSED', 'FAILED', 'CANCELLED'], 
    default: 'PENDING' 
  },
  reason: { type: String },
  razorpayPaymentId: { type: String },
  razorpayRefundId: { type: String, unique: true, sparse: true, index: true },
  initiatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  initiatedByRole: { type: String, required: true }
}, { timestamps: true });

export const Refund = mongoose.model<IRefund>('Refund', refundSchema);
