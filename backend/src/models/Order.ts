import mongoose, { Document, Schema } from 'mongoose';

export interface IOrderItem {
  productId: mongoose.Types.ObjectId;
  variantId: mongoose.Types.ObjectId;
  productName: string;
  productImage: string;
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

export interface IOrderAddress {
  fullName: string;
  phone: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  landmark?: string;
  addressType: 'HOME' | 'WORK' | 'OTHER';
}

export interface IOrder extends Document {
  orderNumber: string;
  userId: mongoose.Types.ObjectId;
  items: IOrderItem[];
  shippingAddress: IOrderAddress;
  subtotal: number;
  discount: number;
  shipping: number;
  tax: number;
  total: number;
  currency: string;
  status: 'PENDING' | 'CONFIRMED' | 'PROCESSING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';
  paymentStatus: 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';
  idempotencyKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

const OrderItemSchema = new Schema<IOrderItem>({
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  variantId: { type: Schema.Types.ObjectId, required: true },
  productName: { type: String, required: true },
  productImage: { type: String, required: true },
  selectedSize: { type: String, required: true },
  selectedColor: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1 },
  unitPrice: { type: Number, required: true, min: 0 },
  lineTotal: { type: Number, required: true, min: 0 },
  customDesignId: { type: Schema.Types.ObjectId, ref: 'CustomDesign' },
  customizationSnapshot: {
    name: { type: String },
    previewImage: { type: String },
    printLocations: [{ type: String }],
    customFee: { type: Number, default: 0 }
  }
}, { _id: false });

const OrderAddressSchema = new Schema<IOrderAddress>({
  fullName: { type: String, required: true },
  phone: { type: String, required: true },
  addressLine1: { type: String, required: true },
  addressLine2: { type: String },
  city: { type: String, required: true },
  state: { type: String, required: true },
  postalCode: { type: String, required: true },
  country: { type: String, required: true, default: 'India' },
  landmark: { type: String },
  addressType: { type: String, enum: ['HOME', 'WORK', 'OTHER'], default: 'HOME', required: true }
}, { _id: false });

const OrderSchema = new Schema<IOrder>(
  {
    orderNumber: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    items: { type: [OrderItemSchema], required: true },
    shippingAddress: { type: OrderAddressSchema, required: true },
    subtotal: { type: Number, required: true, min: 0 },
    discount: { type: Number, required: true, min: 0, default: 0 },
    shipping: { type: Number, required: true, min: 0, default: 0 },
    tax: { type: Number, required: true, min: 0, default: 0 },
    total: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, default: 'INR' },
    status: {
      type: String,
      enum: ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'],
      default: 'PENDING',
      required: true
    },
    paymentStatus: {
      type: String,
      enum: ['PENDING', 'PAID', 'FAILED', 'REFUNDED'],
      default: 'PENDING',
      required: true
    },
    idempotencyKey: { type: String, index: { unique: true, partialFilterExpression: { idempotencyKey: { $exists: true } } } }
  },
  { timestamps: true }
);

export const Order = mongoose.model<IOrder>('Order', OrderSchema);
