import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IReverseTrackingEvent {
  status: string;
  location?: string;
  description: string;
  timestamp: Date;
  providerEventId?: string;
}

export interface IReverseShipmentAddress {
  fullName: string;
  phone: string;
  alternatePhone?: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface IReverseWarehouseDestination {
  warehouseId?: string;
  name?: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface IReversePackageDetails {
  weightGrams: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
}

export interface IReverseShipment extends Document {
  returnRequestId: Types.ObjectId;
  orderId: Types.ObjectId;
  userId: Types.ObjectId;
  provider: 'nimbuspost' | 'manual';
  providerOrderId?: string;
  awbNumber: string;
  carrier: string;
  courierId?: string;
  pickupAddress: IReverseShipmentAddress;
  warehouseAddress: IReverseWarehouseDestination;
  packageDetails: IReversePackageDetails;
  mode: 'NIMBUSPOST' | 'MANUAL';
  status:
    | 'REVERSE_REQUESTED'
    | 'PICKUP_SCHEDULED'
    | 'OUT_FOR_PICKUP'
    | 'PICKED_UP'
    | 'IN_TRANSIT'
    | 'REACHED_DESTINATION'
    | 'OUT_FOR_DELIVERY'
    | 'DELIVERED_TO_WAREHOUSE'
    | 'FAILED'
    | 'CANCELLED';
  trackingUrl?: string;
  labelUrl?: string;
  shippingChargesPaise?: number;
  shippingChargesRupees?: number;
  bookedAt: Date;
  deliveredToWarehouseAt?: Date;
  trackingHistory: IReverseTrackingEvent[];
  lastTrackingSyncAt?: Date;
  errorMessage?: string;
  idempotencyKey?: string;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const reverseTrackingEventSchema = new Schema<IReverseTrackingEvent>(
  {
    status: { type: String, required: true },
    location: { type: String },
    description: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    providerEventId: { type: String }
  },
  { _id: false }
);

const reverseShipmentSchema = new Schema<IReverseShipment>(
  {
    // Strict 1:1 binding to ReturnRequest
    returnRequestId: {
      type: Schema.Types.ObjectId,
      ref: 'ReturnRequest',
      required: true,
      unique: true,
      index: true
    },
    // Order index (NOT unique, allows multiple independent item returns per order)
    orderId: {
      type: Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      index: true
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    provider: {
      type: String,
      enum: ['nimbuspost', 'manual'],
      default: 'nimbuspost',
      required: true
    },
    providerOrderId: { type: String },
    awbNumber: {
      type: String,
      required: true,
      index: true
    },
    carrier: {
      type: String,
      required: true
    },
    courierId: { type: String },
    pickupAddress: {
      fullName: { type: String, required: true },
      phone: { type: String, required: true },
      alternatePhone: { type: String },
      addressLine1: { type: String, required: true },
      addressLine2: { type: String },
      city: { type: String, required: true },
      state: { type: String, required: true },
      postalCode: { type: String, required: true },
      country: { type: String, default: 'India' }
    },
    warehouseAddress: {
      warehouseId: { type: String },
      name: { type: String },
      address: { type: String, required: true },
      city: { type: String, required: true },
      state: { type: String, required: true },
      postalCode: { type: String, required: true },
      country: { type: String, default: 'India' }
    },
    packageDetails: {
      weightGrams: { type: Number, required: true, min: 1 },
      lengthCm: { type: Number, required: true, min: 0.1 },
      widthCm: { type: Number, required: true, min: 0.1 },
      heightCm: { type: Number, required: true, min: 0.1 }
    },
    mode: {
      type: String,
      enum: ['NIMBUSPOST', 'MANUAL'],
      default: 'NIMBUSPOST',
      required: true
    },
    status: {
      type: String,
      enum: [
        'REVERSE_REQUESTED',
        'PICKUP_SCHEDULED',
        'OUT_FOR_PICKUP',
        'PICKED_UP',
        'IN_TRANSIT',
        'REACHED_DESTINATION',
        'OUT_FOR_DELIVERY',
        'DELIVERED_TO_WAREHOUSE',
        'FAILED',
        'CANCELLED'
      ],
      default: 'REVERSE_REQUESTED',
      required: true,
      index: true
    },
    trackingUrl: { type: String },
    labelUrl: { type: String },
    shippingChargesPaise: { type: Number },
    shippingChargesRupees: { type: Number },
    bookedAt: { type: Date, default: Date.now, required: true },
    deliveredToWarehouseAt: { type: Date },
    trackingHistory: [reverseTrackingEventSchema],
    lastTrackingSyncAt: { type: Date },
    errorMessage: { type: String },
    idempotencyKey: {
      type: String,
      index: { unique: true, partialFilterExpression: { idempotencyKey: { $exists: true } } }
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  {
    timestamps: true
  }
);

export const ReverseShipment = mongoose.model<IReverseShipment>('ReverseShipment', reverseShipmentSchema);
