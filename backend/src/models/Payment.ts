import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IPayment extends Document {
  orderId: Types.ObjectId;
  userId: Types.ObjectId;
  amount: number;
  currency: string;
  status: 'PENDING' | 'AUTHORIZED' | 'CAPTURED' | 'FAILED' | 'REFUNDED';
  provider: string; // e.g. RAZORPAY
  refundedAmount: number;
  pendingRefundAmount: number;
  razorpayPaymentId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const paymentSchema = new Schema<IPayment>({
  orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, unique: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true },
  currency: { type: String, required: true, default: 'INR' },
  status: { 
    type: String, 
    enum: ['PENDING', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED'], 
    default: 'PENDING' 
  },
  provider: { type: String, required: true, default: 'RAZORPAY' },
  refundedAmount: { type: Number, default: 0 },
  // Amount reserved by in-flight refunds (sent to the gateway, not yet processed).
  // Tracked atomically on the Payment doc so concurrent refunds cannot overshoot.
  pendingRefundAmount: { type: Number, default: 0 },
  razorpayPaymentId: { type: String },
}, { timestamps: true });

export const Payment = mongoose.model<IPayment>('Payment', paymentSchema);
