import mongoose, { Document, Schema, Types } from 'mongoose';

export enum FulfillmentStatus {
  UNALLOCATED = 'UNALLOCATED',
  ALLOCATED = 'ALLOCATED',
  PICKING = 'PICKING',
  PICKED = 'PICKED',
  PACKING = 'PACKING',
  PACKED = 'PACKED',
  QC_PENDING = 'QC_PENDING',
  QC_PASSED = 'QC_PASSED',
  QC_FAILED = 'QC_FAILED',
  READY_TO_SHIP = 'READY_TO_SHIP',
  HANDED_OVER = 'HANDED_OVER',
  CANCELLED = 'CANCELLED'
}

export interface IFulfillmentItem {
  orderItemId?: string;
  productId: Types.ObjectId;
  variantId: Types.ObjectId;
  productName: string;
  sku?: string;
  selectedSize: string;
  selectedColor: string;
  quantityOrdered: number;
  quantityPicked: number;
  quantityPacked: number;
  warehouseLocation?: string;
  binLocation?: string;
  customDesignId?: Types.ObjectId;
}

export interface IFulfillmentQC {
  status: 'PENDING' | 'PASSED' | 'FAILED';
  notes?: string;
  passedAt?: Date;
  failedAt?: Date;
  qcBy?: Types.ObjectId;
  checks?: {
    itemMatch: boolean;
    quantityMatch: boolean;
    qualityMatch: boolean;
    customPrintMatch?: boolean;
  };
}

export interface IFulfillmentPackage {
  weightGrams: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  packedBy?: Types.ObjectId;
  packedAt?: Date;
}

export interface IFulfillment extends Document {
  orderId: Types.ObjectId;
  userId: Types.ObjectId;
  status: FulfillmentStatus;
  items: IFulfillmentItem[];
  packageDetails?: IFulfillmentPackage;
  qc?: IFulfillmentQC;
  pickedBy?: Types.ObjectId;
  pickedAt?: Date;
  packedBy?: Types.ObjectId;
  packedAt?: Date;
  qcBy?: Types.ObjectId;
  qcAt?: Date;
  readyToShipAt?: Date;
  handedOverAt?: Date;
  notes?: string;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const fulfillmentItemSchema = new Schema<IFulfillmentItem>({
  orderItemId: { type: String },
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  variantId: { type: Schema.Types.ObjectId, required: true },
  productName: { type: String, required: true },
  sku: { type: String },
  selectedSize: { type: String, required: true },
  selectedColor: { type: String, required: true },
  quantityOrdered: { type: Number, required: true, min: 1 },
  quantityPicked: { type: Number, default: 0, min: 0 },
  quantityPacked: { type: Number, default: 0, min: 0 },
  warehouseLocation: { type: String, default: 'Main Warehouse' },
  binLocation: { type: String, default: 'A1-BIN' },
  customDesignId: { type: Schema.Types.ObjectId, ref: 'CustomDesign' }
}, { _id: false });

const fulfillmentQCSchema = new Schema<IFulfillmentQC>({
  status: { type: String, enum: ['PENDING', 'PASSED', 'FAILED'], default: 'PENDING', required: true },
  notes: { type: String },
  passedAt: { type: Date },
  failedAt: { type: Date },
  qcBy: { type: Schema.Types.ObjectId, ref: 'User' },
  checks: {
    itemMatch: { type: Boolean, default: true },
    quantityMatch: { type: Boolean, default: true },
    qualityMatch: { type: Boolean, default: true },
    customPrintMatch: { type: Boolean, default: true }
  }
}, { _id: false });

const fulfillmentPackageSchema = new Schema<IFulfillmentPackage>({
  weightGrams: { type: Number, default: 500, min: 1 },
  lengthCm: { type: Number, default: 30, min: 1 },
  widthCm: { type: Number, default: 25, min: 1 },
  heightCm: { type: Number, default: 5, min: 1 },
  packedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  packedAt: { type: Date }
}, { _id: false });

const fulfillmentSchema = new Schema<IFulfillment>({
  orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, unique: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  status: {
    type: String,
    enum: Object.values(FulfillmentStatus),
    default: FulfillmentStatus.UNALLOCATED,
    required: true,
    index: true
  },
  items: { type: [fulfillmentItemSchema], required: true },
  packageDetails: { type: fulfillmentPackageSchema, default: () => ({}) },
  qc: { type: fulfillmentQCSchema, default: () => ({ status: 'PENDING' }) },
  pickedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  pickedAt: { type: Date },
  packedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  packedAt: { type: Date },
  qcBy: { type: Schema.Types.ObjectId, ref: 'User' },
  qcAt: { type: Date },
  readyToShipAt: { type: Date },
  handedOverAt: { type: Date },
  notes: { type: String },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

export const Fulfillment = mongoose.model<IFulfillment>('Fulfillment', fulfillmentSchema);
