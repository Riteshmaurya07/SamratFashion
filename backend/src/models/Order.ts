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

export type ApprovalStatus = 'pending_design' | 'mockup_sent' | 'approved' | 'revision_requested' | 'in_production';

export interface IDesignFile {
  url: string;
  fileType: string;
  filename?: string;
  uploadedAt: Date;
}

export interface IMockupImage {
  url: string;
  uploadedAt: Date;
  uploadedBy?: mongoose.Types.ObjectId;
}

export interface IApprovalHistory {
  status: ApprovalStatus;
  note?: string;
  actor: 'customer' | 'staff' | 'system';
  timestamp: Date;
}

export type OrderCancellationSource = 'CUSTOMER' | 'ADMIN' | 'SYSTEM';

export interface IOrderItem {
  _id?: mongoose.Types.ObjectId;
  productId: mongoose.Types.ObjectId;
  variantId: mongoose.Types.ObjectId;
  productName: string;
  productImage: string;
  /** Variant SKU at the time of purchase — the warehouse/accounts product code. */
  sku?: string;
  selectedSize: string; // V1/Normal product
  selectedColor: string; // V1/Normal product
  quantity: number;
  unitPrice: number;
  lineTotal: number;

  // Item-level cancellation snapshot. `quantity` and `lineTotal` remain the
  // immutable values that were ordered; these fields track how much of the
  // line has been cancelled over one or more partial-cancellation operations.
  cancelledQuantity?: number;
  cancelledAt?: Date;
  cancellationReason?: string;
  cancellationSource?: OrderCancellationSource;
  cancelledValue?: number;

  // V2 Custom fields
  isCustomized?: boolean;
  customConfigurations?: ICustomConfiguration[];
  pricingSnapshot?: IPricingSnapshot;

  // Manual Mockup-Approval fields
  designFiles?: IDesignFile[];
  customizationNotes?: string;
  mockupImages?: IMockupImage[];
  approvalStatus?: ApprovalStatus;
  approvalHistory?: IApprovalHistory[];

  // Legacy V1 Custom
  customDesignId?: mongoose.Types.ObjectId;
  customizationSnapshot?: {
    name?: string;
    previewImage?: string;
    printLocations?: string[];
    customFee?: number;
  };
}

export interface ICancelledItemOperation {
  itemId: mongoose.Types.ObjectId;
  productId?: mongoose.Types.ObjectId;
  variantId?: mongoose.Types.ObjectId;
  quantity: number;
  refundAmount: number;
}

export interface ICancellationOperation {
  operationId: string;
  itemIds: mongoose.Types.ObjectId[];
  items: ICancelledItemOperation[];
  refundAmount: number;
  fullyCancelled: boolean;
  source: OrderCancellationSource;
  reason?: string;
  actorId?: mongoose.Types.ObjectId;
  refundId?: mongoose.Types.ObjectId;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  inventoryRestored: boolean;
  creditNoteIssued: boolean;
  createdAt: Date;
  updatedAt?: Date;
}

export interface IOrderAddress {
  fullName: string;
  phone: string;
  alternatePhone?: string;
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
  initialSubtotal?: number;
  initialDiscount?: number;
  initialShipping?: number;
  initialTotal?: number;
  freeShippingThresholdSnapshot?: number;
  shippingFeeSnapshot?: number;
  qualifiedForFreeShipping?: boolean;
  freeShippingReason?: 'THRESHOLD' | 'ALL_ITEMS_FREE' | 'NONE';
  currency: string;
  status: 'PENDING' | 'CONFIRMED' | 'PROCESSING' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED' | 'EXPIRED';
  paymentStatus: 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';
  paymentMethod?: string;
  idempotencyKey?: string;
  paymentAttemptLockExpiresAt?: Date;
  returnRequestLockToken?: string;
  returnRequestLockExpiresAt?: Date;
  couponCode?: string;
  couponId?: mongoose.Types.ObjectId;
  deliveredAt?: Date;
  cancelledAt?: Date;
  cancellationReason?: string;
  cancellationSource?: OrderCancellationSource;
  partiallyCancelled?: boolean;
  cancellationVersion?: number;
  cancellationOperations?: ICancellationOperation[];
  trackingTokenHash?: string;
  trackingTokenCreatedAt?: Date;
  trackingTokenExpiresAt?: Date;
  trackingTokenRevokedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const OrderItemSchema = new Schema<IOrderItem>({
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  variantId: { type: Schema.Types.ObjectId, required: true },
  productName: { type: String, required: true },
  productImage: { type: String, required: true },
  sku: { type: String, trim: true, uppercase: true },
  selectedSize: { type: String, required: true },
  selectedColor: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1 },
  unitPrice: { type: Number, required: true, min: 0 },
  lineTotal: { type: Number, required: true, min: 0 },
  cancelledQuantity: { type: Number, default: 0, min: 0 },
  cancelledAt: { type: Date },
  cancellationReason: { type: String, trim: true },
  cancellationSource: { type: String, enum: ['CUSTOMER', 'ADMIN', 'SYSTEM'] },
  cancelledValue: { type: Number, default: 0, min: 0 },
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
  },
  // Manual Mockup-Approval fields
  designFiles: [{
    url: { type: String, required: true },
    fileType: { type: String, required: true },
    filename: { type: String },
    uploadedAt: { type: Date, default: Date.now }
  }],
  customizationNotes: { type: String, trim: true },
  mockupImages: [{
    url: { type: String, required: true },
    uploadedAt: { type: Date, default: Date.now },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' }
  }],
  approvalStatus: {
    type: String,
    enum: ['pending_design', 'mockup_sent', 'approved', 'revision_requested', 'in_production'],
    default: 'pending_design'
  },
  approvalHistory: [{
    status: { type: String, required: true },
    note: { type: String },
    actor: { type: String, enum: ['customer', 'staff', 'system'], default: 'customer' },
    timestamp: { type: Date, default: Date.now }
  }]
}, { _id: true });

const OrderAddressSchema = new Schema<IOrderAddress>({
  fullName: { type: String, required: true },
  phone: { type: String, required: true },
  alternatePhone: { type: String, trim: true },
  addressLine1: { type: String, required: true },
  addressLine2: { type: String },
  city: { type: String, required: true },
  state: { type: String, required: true },
  postalCode: { type: String, required: true },
  country: { type: String, required: true, default: 'India' },
  landmark: { type: String },
  addressType: { type: String, enum: ['HOME', 'WORK', 'OTHER'], default: 'HOME', required: true }
}, { _id: false });

const CancellationOperationSchema = new Schema<ICancellationOperation>({
  operationId: { type: String, required: true },
  itemIds: [{ type: Schema.Types.ObjectId, required: true }],
  items: [{
    itemId: { type: Schema.Types.ObjectId, required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product' },
    variantId: { type: Schema.Types.ObjectId },
    quantity: { type: Number, required: true, min: 1 },
    refundAmount: { type: Number, required: true, min: 0 }
  }],
  refundAmount: { type: Number, required: true, min: 0, default: 0 },
  fullyCancelled: { type: Boolean, required: true, default: false },
  source: { type: String, enum: ['CUSTOMER', 'ADMIN', 'SYSTEM'], required: true },
  reason: { type: String, trim: true },
  actorId: { type: Schema.Types.ObjectId, ref: 'User' },
  refundId: { type: Schema.Types.ObjectId, ref: 'Refund' },
  status: { type: String, enum: ['PENDING', 'COMPLETED', 'FAILED'], default: 'PENDING' },
  inventoryRestored: { type: Boolean, default: false },
  creditNoteIssued: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date }
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
    initialSubtotal: { type: Number, min: 0 },
    initialDiscount: { type: Number, min: 0 },
    initialShipping: { type: Number, min: 0 },
    initialTotal: { type: Number, min: 0 },
    freeShippingThresholdSnapshot: { type: Number, min: 0 },
    shippingFeeSnapshot: { type: Number, min: 0 },
    qualifiedForFreeShipping: { type: Boolean },
    freeShippingReason: { type: String, enum: ['THRESHOLD', 'ALL_ITEMS_FREE', 'NONE'] },
    currency: { type: String, required: true, default: 'INR' },
    status: {
      type: String,
      enum: ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'EXPIRED'],
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
    paymentAttemptLockExpiresAt: { type: Date, select: false },
    returnRequestLockToken: { type: String, select: false },
    returnRequestLockExpiresAt: { type: Date, select: false },
    idempotencyKey: { type: String, index: { unique: true, partialFilterExpression: { idempotencyKey: { $exists: true } } } },
    // Coupon snapshot: captured at order creation so checkout-time coupon usage is
    // not derived from a live cart that may change after the order is placed.
    couponCode: { type: String, trim: true },
    couponId: { type: Schema.Types.ObjectId, ref: 'Coupon' },
    // Snapshot of when the order was marked delivered (return-window anchor that is
    // unaffected by later status/update churn).
    deliveredAt: { type: Date },
    // Cancellation snapshot: keeps the admin panel and customer timeline accurate even
    // when the automatic refund is still pending or needs manual intervention.
    cancelledAt: { type: Date },
    cancellationReason: { type: String, trim: true },
    cancellationSource: { type: String, enum: ['CUSTOMER', 'ADMIN', 'SYSTEM'] },
    // Partial item-level cancellation snapshot. The order stays in its current
    // lifecycle status until every item is cancelled; `partiallyCancelled` lets
    // the storefront and admin panel show that some lines were removed.
    partiallyCancelled: { type: Boolean, default: false },
    // Monotonic optimistic-concurrency counter for item cancellation claims.
    cancellationVersion: { type: Number, default: 0 },
    cancellationOperations: { type: [CancellationOperationSchema], default: [] },
    // Secure shareable tracking token hash & lifecycle
    trackingTokenHash: { type: String, sparse: true, index: true },
    trackingTokenCreatedAt: { type: Date },
    trackingTokenExpiresAt: { type: Date },
    trackingTokenRevokedAt: { type: Date }
  },
  { timestamps: true }
);

// Fast idempotent replay lookup for partial item cancellations.
OrderSchema.index({ 'cancellationOperations.operationId': 1 }, { name: 'cancellation_operation_id' });
OrderSchema.index({ 'cancellationOperations.status': 1 }, { name: 'cancellation_operation_status' });
OrderSchema.index({ createdAt: -1 });
OrderSchema.index({ status: 1, createdAt: -1 });
OrderSchema.index({ paymentStatus: 1, createdAt: -1 });

export const Order = mongoose.model<IOrder>('Order', OrderSchema);
