import mongoose, { Document, Schema } from 'mongoose';

export enum InvoiceStatus {
  ISSUED = 'ISSUED',
  VOID = 'VOID',
  REFUNDED = 'REFUNDED',
}

export interface IInvoiceCustomerSnapshot {
  name: string;
  email: string;
  phone?: string;
}

export interface IInvoiceAddressSnapshot {
  fullName: string;
  phone: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  landmark?: string;
}

export interface IInvoiceItemSnapshot {
  productId: mongoose.Types.ObjectId;
  productName: string;
  productImage?: string;
  selectedSize: string;
  selectedColor: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  customDesignId?: mongoose.Types.ObjectId;
  customizationSnapshot?: {
    name?: string;
    previewImage?: string;
    printLocations?: string[];
    customFee?: number;
  };
}

export interface IInvoicePaymentSnapshot {
  provider: string; // e.g. "RAZORPAY", "COD"
  status: string; // "PAID", "PENDING", "REFUNDED"
  amount: number;
  currency: string;
}

export interface IInvoice extends Document {
  invoiceNumber: string; // Format: SF-INV-YYYY-XXXXXX
  orderId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  orderNumber: string;
  status: InvoiceStatus;
  issuedAt: Date;
  customerSnapshot: IInvoiceCustomerSnapshot;
  billingAddressSnapshot: IInvoiceAddressSnapshot;
  shippingAddressSnapshot: IInvoiceAddressSnapshot;
  itemsSnapshot: IInvoiceItemSnapshot[];
  subtotal: number;
  discount: number;
  shipping: number;
  tax: number;
  total: number;
  currency: string;
  paymentSnapshot: IInvoicePaymentSnapshot;
  createdAt: Date;
  updatedAt: Date;
}

const InvoiceCustomerSnapshotSchema = new Schema<IInvoiceCustomerSnapshot>({
  name: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String },
}, { _id: false });

const InvoiceAddressSnapshotSchema = new Schema<IInvoiceAddressSnapshot>({
  fullName: { type: String, required: true },
  phone: { type: String, required: true },
  addressLine1: { type: String, required: true },
  addressLine2: { type: String },
  city: { type: String, required: true },
  state: { type: String, required: true },
  postalCode: { type: String, required: true },
  country: { type: String, required: true, default: 'India' },
  landmark: { type: String },
}, { _id: false });

const InvoiceItemSnapshotSchema = new Schema<IInvoiceItemSnapshot>({
  productId: { type: Schema.Types.ObjectId, required: true },
  productName: { type: String, required: true },
  productImage: { type: String },
  selectedSize: { type: String, required: true },
  selectedColor: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1 },
  unitPrice: { type: Number, required: true, min: 0 },
  lineTotal: { type: Number, required: true, min: 0 },
  customDesignId: { type: Schema.Types.ObjectId },
  customizationSnapshot: {
    name: { type: String },
    previewImage: { type: String },
    printLocations: [{ type: String }],
    customFee: { type: Number, default: 0 }
  }
}, { _id: false });

const InvoicePaymentSnapshotSchema = new Schema<IInvoicePaymentSnapshot>({
  provider: { type: String, required: true, default: 'RAZORPAY' },
  status: { type: String, required: true },
  amount: { type: Number, required: true },
  currency: { type: String, required: true, default: 'INR' },
}, { _id: false });

const InvoiceSchema = new Schema<IInvoice>(
  {
    invoiceNumber: { type: String, required: true, unique: true, index: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, unique: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    orderNumber: { type: String, required: true },
    status: {
      type: String,
      enum: Object.values(InvoiceStatus),
      default: InvoiceStatus.ISSUED,
      required: true
    },
    issuedAt: { type: Date, required: true, default: Date.now },
    customerSnapshot: { type: InvoiceCustomerSnapshotSchema, required: true },
    billingAddressSnapshot: { type: InvoiceAddressSnapshotSchema, required: true },
    shippingAddressSnapshot: { type: InvoiceAddressSnapshotSchema, required: true },
    itemsSnapshot: { type: [InvoiceItemSnapshotSchema], required: true },
    subtotal: { type: Number, required: true, min: 0 },
    discount: { type: Number, required: true, min: 0, default: 0 },
    shipping: { type: Number, required: true, min: 0, default: 0 },
    tax: { type: Number, required: true, min: 0, default: 0 },
    total: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, default: 'INR' },
    paymentSnapshot: { type: InvoicePaymentSnapshotSchema, required: true }
  },
  { timestamps: true }
);

export const Invoice = mongoose.model<IInvoice>('Invoice', InvoiceSchema);
