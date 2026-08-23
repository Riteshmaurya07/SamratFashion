import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IReturnItem {
  productId: Types.ObjectId;
  variantId: Types.ObjectId;
  quantity: number;
  reason: 'WRONG_SIZE' | 'WRONG_PRODUCT' | 'DAMAGED' | 'DEFECTIVE' | 'NOT_AS_DESCRIBED' | 'OTHER';
}

export interface IReturnRequest extends Document {
  orderId: Types.ObjectId;
  userId: Types.ObjectId;
  items: IReturnItem[];
  status: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'RECEIVED' | 'INSPECTING' | 'ACCEPTED' | 'REJECTED_AFTER_INSPECTION' | 'COMPLETED' | 'CANCELLED';
  customerNote?: string;
  adminNote?: string;
  refundId?: Types.ObjectId; // points to internal Refund record
  requestedAt: Date;
  approvedAt?: Date;
  receivedAt?: Date;
  inspectedAt?: Date;
  completedAt?: Date;
  rejectedAt?: Date;
  cancelledAt?: Date;
  reviewedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const returnItemSchema = new Schema<IReturnItem>({
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  variantId: { type: Schema.Types.ObjectId, required: true },
  quantity: { type: Number, required: true, min: 1 },
  reason: { 
    type: String, 
    enum: ['WRONG_SIZE', 'WRONG_PRODUCT', 'DAMAGED', 'DEFECTIVE', 'NOT_AS_DESCRIBED', 'OTHER'], 
    required: true 
  }
}, { _id: false });

const returnRequestSchema = new Schema<IReturnRequest>({
  orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  items: { type: [returnItemSchema], required: true },
  status: {
    type: String,
    enum: ['REQUESTED', 'APPROVED', 'REJECTED', 'RECEIVED', 'INSPECTING', 'ACCEPTED', 'REJECTED_AFTER_INSPECTION', 'COMPLETED', 'CANCELLED'],
    default: 'REQUESTED',
    required: true
  },
  customerNote: { type: String },
  adminNote: { type: String },
  refundId: { type: Schema.Types.ObjectId, ref: 'Refund' },
  requestedAt: { type: Date, default: Date.now },
  approvedAt: { type: Date },
  receivedAt: { type: Date },
  inspectedAt: { type: Date },
  completedAt: { type: Date },
  rejectedAt: { type: Date },
  cancelledAt: { type: Date },
  reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

export const ReturnRequest = mongoose.model<IReturnRequest>('ReturnRequest', returnRequestSchema);
