import mongoose, { Document, Schema } from 'mongoose';
import { incrementCounter } from './Counter';

export interface ICreditNoteItemSnapshot {
  productId: mongoose.Types.ObjectId;
  productName: string;
  productImage?: string;
  selectedSize: string;
  selectedColor: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  refundAmount: number;
}

export interface ICreditNote extends Document {
  creditNoteNumber: string; // Format: SF-CN-YYYY-XXXXXX
  invoiceId: mongoose.Types.ObjectId;
  invoiceNumber: string;
  orderId: mongoose.Types.ObjectId;
  orderNumber: string;
  userId: mongoose.Types.ObjectId;
  operationId: string;
  refundId?: mongoose.Types.ObjectId;
  status: 'ISSUED' | 'VOID';
  issuedAt: Date;
  items: ICreditNoteItemSnapshot[];
  subtotalRefunded: number;
  discountAdjusted: number;
  taxRefunded: number;
  totalRefundAmount: number;
  currency: string;
  reason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const CreditNoteItemSnapshotSchema = new Schema<ICreditNoteItemSnapshot>(
  {
    productId: { type: Schema.Types.ObjectId, required: true },
    productName: { type: String, required: true },
    productImage: { type: String },
    selectedSize: { type: String, required: true },
    selectedColor: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    lineTotal: { type: Number, required: true, min: 0 },
    refundAmount: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const CreditNoteSchema = new Schema<ICreditNote>(
  {
    creditNoteNumber: { type: String, required: true, unique: true },
    invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice', required: true, index: true },
    invoiceNumber: { type: String, required: true, index: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    orderNumber: { type: String, required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    operationId: { type: String, required: true },
    refundId: { type: Schema.Types.ObjectId, ref: 'Refund' },
    status: { type: String, enum: ['ISSUED', 'VOID'], default: 'ISSUED' },
    issuedAt: { type: Date, default: Date.now },
    items: [CreditNoteItemSnapshotSchema],
    subtotalRefunded: { type: Number, required: true, min: 0 },
    discountAdjusted: { type: Number, default: 0, min: 0 },
    taxRefunded: { type: Number, default: 0, min: 0 },
    totalRefundAmount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },
    reason: { type: String, trim: true },
  },
  { timestamps: true }
);

CreditNoteSchema.index({ operationId: 1 }, { unique: true });

export const CreditNote = mongoose.model<ICreditNote>('CreditNote', CreditNoteSchema);

export async function generateCreditNoteNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const existingForYear = await CreditNote.countDocuments({
    creditNoteNumber: new RegExp(`^SF-CN-${year}-`),
  });
  const seq = await incrementCounter(`CREDIT_NOTE_${year}`, existingForYear);
  return `SF-CN-${year}-${String(seq).padStart(6, '0')}`;
}
