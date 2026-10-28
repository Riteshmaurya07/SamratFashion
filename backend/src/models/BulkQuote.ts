import mongoose, { Document, Schema } from "mongoose";

export enum BulkQuoteStatus {
  DRAFT = "DRAFT",
  SENT = "SENT",
  ACCEPTED = "ACCEPTED",
  REJECTED = "REJECTED",
  EXPIRED = "EXPIRED",
  CANCELLED = "CANCELLED",
}

export interface IBulkQuote extends Document {
  quoteNumber: string;
  bulkRequestId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  productPrice: number; // in paise
  printingFee: number;
  setupFee: number;
  discount: number;
  subtotal: number;
  tax: number; // 18% GST in paise
  shipping: number;
  total: number;
  validUntil: Date;
  status: BulkQuoteStatus;
  notes?: string;
  convertedOrderId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const bulkQuoteSchema = new Schema<IBulkQuote>(
  {
    quoteNumber: { type: String, required: true, unique: true, index: true },
    bulkRequestId: { type: Schema.Types.ObjectId, ref: "BulkOrderRequest", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    productPrice: { type: Number, required: true, min: 0 },
    printingFee: { type: Number, default: 0, min: 0 },
    setupFee: { type: Number, default: 0, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    subtotal: { type: Number, required: true, min: 0 },
    tax: { type: Number, required: true, min: 0 },
    shipping: { type: Number, default: 0, min: 0 },
    total: { type: Number, required: true, min: 0 },
    validUntil: { type: Date, required: true },
    status: {
      type: String,
      enum: Object.values(BulkQuoteStatus),
      default: BulkQuoteStatus.DRAFT,
      index: true,
    },
    notes: { type: String, trim: true },
    convertedOrderId: { type: Schema.Types.ObjectId, ref: "Order", unique: true, sparse: true },
  },
  {
    timestamps: true,
  }
);

export const BulkQuote = mongoose.model<IBulkQuote>("BulkQuote", bulkQuoteSchema);
