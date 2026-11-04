import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IRefundReservation {
  reservationId: string; // matches refund._id.toString()
  refundId: Types.ObjectId;
  attemptNumber: number;
  amount: number;
  status: 'PENDING' | 'CONSUMED' | 'RELEASED';
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IPaymentSettledRefund {
  refundId: Types.ObjectId;
  razorpayRefundId?: string;
  amount: number;
  currency?: string;
  settledAt: Date;
  unlinked?: boolean;
  settlementReason?: string;
}

export interface IPayment extends Document {
  orderId: Types.ObjectId;
  userId: Types.ObjectId;
  amount: number;
  currency: string;
  status: 'PENDING' | 'AUTHORIZED' | 'CAPTURED' | 'FAILED' | 'REFUNDED';
  provider: string; // e.g. RAZORPAY
  refundedAmount: number;
  pendingRefundAmount: number;
  refundReservations: IRefundReservation[];
  settledRefunds?: IPaymentSettledRefund[];
  razorpayPaymentId?: string;
  reconciliationRequired?: boolean;
  reconciliationReason?: string;
  createdAt: Date;
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
  refundReservations: [
    {
      reservationId: { type: String, required: true },
      refundId: { type: Schema.Types.ObjectId, ref: 'Refund', required: true },
      attemptNumber: { type: Number, default: 1 },
      amount: { type: Number, required: true },
      status: {
        type: String,
        enum: ['PENDING', 'CONSUMED', 'RELEASED'],
        default: 'PENDING',
        required: true
      },
      createdAt: { type: Date, default: Date.now },
      updatedAt: { type: Date, default: Date.now }
    }
  ],
  settledRefunds: [
    {
      refundId: { type: Schema.Types.ObjectId, ref: 'Refund', required: true },
      razorpayRefundId: { type: String },
      amount: { type: Number, required: true },
      currency: { type: String },
      settledAt: { type: Date, default: Date.now },
      unlinked: { type: Boolean, default: false },
      settlementReason: { type: String }
    }
  ],
  razorpayPaymentId: { type: String },
  reconciliationRequired: { type: Boolean, default: false },
  reconciliationReason: { type: String },
}, { timestamps: true });

export const Payment = mongoose.model<IPayment>('Payment', paymentSchema);
