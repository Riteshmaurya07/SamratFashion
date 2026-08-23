import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IPaymentAttempt extends Document {
  paymentId: Types.ObjectId;
  orderId: Types.ObjectId;
  razorpayOrderId: string;
  razorpayPaymentId?: string;
  amount: number;
  currency: string;
  status: 'PENDING' | 'AUTHORIZED' | 'CAPTURED' | 'FAILED';
  failureCode?: string;
  failureReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const paymentAttemptSchema = new Schema<IPaymentAttempt>({
  paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', required: true },
  orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
  razorpayOrderId: { type: String, required: true },
  razorpayPaymentId: { type: String },
  amount: { type: Number, required: true },
  currency: { type: String, required: true, default: 'INR' },
  status: { 
    type: String, 
    enum: ['PENDING', 'AUTHORIZED', 'CAPTURED', 'FAILED'], 
    default: 'PENDING' 
  },
  failureCode: { type: String },
  failureReason: { type: String }
}, { timestamps: true });

export const PaymentAttempt = mongoose.model<IPaymentAttempt>('PaymentAttempt', paymentAttemptSchema);
