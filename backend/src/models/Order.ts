import mongoose, { Document, Schema } from 'mongoose';

export interface ISizeDistribution {
  size: string;
  quantity: number;
}

export interface ICustomConfiguration {
  color: string;
  variantId: mongoose.Types.ObjectId;
  designId?: mongoose.Types.ObjectId;
  purchasedDesignVersion?: number;
  approvedDesignVersion?: number | null;
  sizeDistribution: ISizeDistribution[];
}

export interface IPricingSnapshot {
  basePrice: number;
  variantPrice: number;
  fabricPrice: number;
  printCharges: number;
  customizationCharges: number;
  bulkDiscount: number;
  tax: number;
  shipping: number;
  subtotal: number;
  total: number;
  currency: string;
  calculatedAt: Date;
}

export interface IOrderItem {
  productId: mongoose.Types.ObjectId;
  variantId: mongoose.Types.ObjectId;
  productName: string;
  productImage: string;
  selectedSize: string; // V1/Normal product
  selectedColor: string; // V1/Normal product
  quantity: number;
  unitPrice: number;
  lineTotal: number;

  // V2 Custom fields
  isCustomized?: boolean;
  customConfigurations?: ICustomConfiguration[];
  pricingSnapshot?: IPricingSnapshot;

  // Legacy V1 Custom
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
  paymentMethod?: string;
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
  },
  // V2 Custom fields
  isCustomized: { type: Boolean, default: false },
  customConfigurations: [
    {
      color: { type: String, required: true },
      variantId: { type: Schema.Types.ObjectId, required: true },
      designId: { type: Schema.Types.ObjectId, ref: "CustomDesign" },
      purchasedDesignVersion: { type: Number },
      approvedDesignVersion: { type: Number, default: null },
      sizeDistribution: [
        {
          size: { type: String, required: true },
          quantity: { type: Number, required: true, min: 1 },
        },
      ],
    },
  ],
  pricingSnapshot: {
    basePrice: { type: Number },
    variantPrice: { type: Number },
    fabricPrice: { type: Number },
    printCharges: { type: Number },
    customizationCharges: { type: Number },
    bulkDiscount: { type: Number },
    tax: { type: Number },
    shipping: { type: Number },
    subtotal: { type: Number },
    total: { type: Number },
    currency: { type: String, default: "INR" },
    calculatedAt: { type: Date },
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
    paymentMethod: { type: String, trim: true },
    idempotencyKey: { type: String, index: { unique: true, partialFilterExpression: { idempotencyKey: { $exists: true } } } }
  },
  { timestamps: true }
);

export const Order = mongoose.model<IOrder>('Order', OrderSchema);
