import mongoose, { Document, Schema } from "mongoose";

export enum BulkRequestStatus {
  REQUESTED = "REQUESTED",
  UNDER_REVIEW = "UNDER_REVIEW",
  QUOTED = "QUOTED",
  ACCEPTED = "ACCEPTED",
  REJECTED = "REJECTED",
  CANCELLED = "CANCELLED",
}

export interface IVariantBreakdown {
  S?: number;
  M?: number;
  L?: number;
  XL?: number;
  XXL?: number;
}

export interface IBulkOrderRequest extends Document {
  quoteNumber: string;
  userId: mongoose.Types.ObjectId;
  organizationName: string;
  contactName: string;
  email: string;
  phone: string;
  productId: mongoose.Types.ObjectId;
  variantBreakdown: IVariantBreakdown;
  totalQuantity: number;
  colorAllocation?: string;
  customPrintingRequired: boolean;
  customDesignId?: mongoose.Types.ObjectId;
  printLocations: string[];
  printMethod?: string;
  deliveryLocation: string;
  requiredByDate?: Date;
  customerNote?: string;
  status: BulkRequestStatus;
  createdAt: Date;
  updatedAt: Date;
}

const variantBreakdownSchema = new Schema<IVariantBreakdown>(
  {
    S: { type: Number, default: 0 },
    M: { type: Number, default: 0 },
    L: { type: Number, default: 0 },
    XL: { type: Number, default: 0 },
    XXL: { type: Number, default: 0 },
  },
  { _id: false }
);

const bulkOrderRequestSchema = new Schema<IBulkOrderRequest>(
  {
    quoteNumber: { type: String, required: true, unique: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    organizationName: { type: String, required: true, trim: true, max: 120 },
    contactName: { type: String, required: true, trim: true, max: 120 },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, required: true, trim: true },
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    variantBreakdown: { type: variantBreakdownSchema, required: true },
    totalQuantity: { type: Number, required: true, min: 10 },
    colorAllocation: { type: String, trim: true },
    customPrintingRequired: { type: Boolean, default: false },
    customDesignId: { type: Schema.Types.ObjectId, ref: "CustomDesign" },
    printLocations: [{ type: String }],
    printMethod: { type: String, default: "DTF Transfer" },
    deliveryLocation: { type: String, required: true, trim: true },
    requiredByDate: { type: Date },
    customerNote: { type: String, trim: true, max: 1000 },
    status: {
      type: String,
      enum: Object.values(BulkRequestStatus),
      default: BulkRequestStatus.REQUESTED,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

export const BulkOrderRequest = mongoose.model<IBulkOrderRequest>("BulkOrderRequest", bulkOrderRequestSchema);
