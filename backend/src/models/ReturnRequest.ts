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
  refundStatus?: 'PENDING' | 'PROCESSING' | 'PROCESSED' | 'FAILED' | 'UNKNOWN';
  refundAttempt?: number;
  refundError?: string;
  refundClaimToken?: string;
  refundClaimExpiresAt?: Date;
  inventoryRestored?: boolean;
  inventoryRestoredAt?: Date;
  requiresInventoryReconciliation?: boolean;
  inventoryReconciliationReason?: string;
  requestedAt: Date;
  approvedAt?: Date;
  receivedAt?: Date;
  inspectedAt?: Date;
  completedAt?: Date;
  rejectedAt?: Date;
  cancelledAt?: Date;
  reviewedBy?: Types.ObjectId;
  returnAwbNumber?: string;
  returnCarrier?: string;
  reverseShipmentId?: Types.ObjectId;
  returnShippingMethod?: 'NIMBUSPOST_REVERSE' | 'CUSTOMER_SHIPS';
  pickupAddress?: {
    fullName: string;
    phone: string;
    alternatePhone?: string;
    addressLine1: string;
    addressLine2?: string;
    city: string;
    state: string;
    postalCode: string;
    country?: string;
  };
  packageDetails?: {
    weightGrams: number;
    lengthCm: number;
    widthCm: number;
    heightCm: number;
    isConfirmed?: boolean;
    confirmedAt?: Date;
    confirmedBy?: Types.ObjectId;
  };
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
  refundStatus: {
    type: String,
    enum: ['PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', 'UNKNOWN']
  },
  refundAttempt: { type: Number, default: 0 },
  refundError: { type: String },
  refundClaimToken: { type: String },
  refundClaimExpiresAt: { type: Date },
  inventoryRestored: { type: Boolean, default: false },
  inventoryRestoredAt: { type: Date },
  requiresInventoryReconciliation: { type: Boolean, default: false },
  inventoryReconciliationReason: { type: String },
  requestedAt: { type: Date, default: Date.now },
  approvedAt: { type: Date },
  receivedAt: { type: Date },
  inspectedAt: { type: Date },
  completedAt: { type: Date },
  rejectedAt: { type: Date },
  cancelledAt: { type: Date },
  reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  returnAwbNumber: { type: String },
  returnCarrier: { type: String },
  reverseShipmentId: { type: Schema.Types.ObjectId, ref: 'ReverseShipment' },
  returnShippingMethod: { type: String, enum: ['NIMBUSPOST_REVERSE', 'CUSTOMER_SHIPS'] },
  pickupAddress: {
    fullName: { type: String },
    phone: { type: String },
    alternatePhone: { type: String },
    addressLine1: { type: String },
    addressLine2: { type: String },
    city: { type: String },
    state: { type: String },
    postalCode: { type: String },
    country: { type: String, default: 'India' }
  },
  packageDetails: {
    weightGrams: { type: Number },
    lengthCm: { type: Number },
    widthCm: { type: Number },
    heightCm: { type: Number },
    isConfirmed: { type: Boolean, default: false },
    confirmedAt: { type: Date },
    confirmedBy: { type: Schema.Types.ObjectId, ref: 'User' }
  }
});

export const ReturnRequest = mongoose.model<IReturnRequest>('ReturnRequest', returnRequestSchema);
