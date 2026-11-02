import mongoose, { Document, Schema } from 'mongoose';

export interface ICourierOption {
  courierId: string;
  courierCode: string;
  courierName: string;
  courierDisplayName?: string;
  courierType?: string;
  tatDays?: number;
  zone?: string;
  zoneLabel?: string;
  chargeableWeightGrams: number;
  forwardRatePaise: number;
  codChargesPaise: number;
  surchargesPaise: number;
  totalRatePaise: number;
  totalRateRupees: number;
  autoPickup?: boolean;
}

export interface IExcludedCourierOption {
  courierId?: string;
  courierCode?: string;
  courierName: string;
  courierDisplayName?: string;
  reason: string;
  detail?: string;
}

export interface ICourierQuote extends Document {
  orderId: mongoose.Types.ObjectId;
  orderNumber: string;
  provider: string; // 'nimbuspost'
  originPostalCode: string;
  destinationPostalCode: string;
  paymentMode: 'prepaid' | 'cod';
  orderValuePaise: number;
  packageDetails: {
    weightGrams: number;
    lengthCm: number;
    widthCm: number;
    heightCm: number;
  };
  packageFingerprint: string;
  availableCouriers: ICourierOption[];
  excludedCouriers: IExcludedCourierOption[];
  expiresAt: Date;
  createdBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  isExpired(): boolean;
}

const CourierOptionSchema = new Schema<ICourierOption>(
  {
    courierId: { type: String, required: true },
    courierCode: { type: String, required: true },
    courierName: { type: String, required: true },
    courierDisplayName: { type: String },
    courierType: { type: String, default: 'surface' },
    tatDays: { type: Number },
    zone: { type: String },
    zoneLabel: { type: String },
    chargeableWeightGrams: { type: Number, required: true },
    forwardRatePaise: { type: Number, required: true },
    codChargesPaise: { type: Number, default: 0 },
    surchargesPaise: { type: Number, default: 0 },
    totalRatePaise: { type: Number, required: true },
    totalRateRupees: { type: Number, required: true },
    autoPickup: { type: Boolean, default: false }
  },
  { _id: false }
);

const ExcludedCourierOptionSchema = new Schema<IExcludedCourierOption>(
  {
    courierId: { type: String },
    courierCode: { type: String },
    courierName: { type: String, required: true },
    courierDisplayName: { type: String },
    reason: { type: String, required: true },
    detail: { type: String }
  },
  { _id: false }
);

const CourierQuoteSchema = new Schema<ICourierQuote>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    orderNumber: { type: String, required: true, index: true },
    provider: { type: String, required: true, default: 'nimbuspost', index: true },
    originPostalCode: { type: String, required: true },
    destinationPostalCode: { type: String, required: true },
    paymentMode: { type: String, enum: ['prepaid', 'cod'], required: true },
    orderValuePaise: { type: Number, required: true },
    packageDetails: {
      weightGrams: { type: Number, required: true },
      lengthCm: { type: Number, required: true },
      widthCm: { type: Number, required: true },
      heightCm: { type: Number, required: true }
    },
    packageFingerprint: { type: String, required: true },
    availableCouriers: [CourierOptionSchema],
    excludedCouriers: [ExcludedCourierOptionSchema],
    expiresAt: { type: Date, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' }
  },
  {
    timestamps: true
  }
);

// Method to explicitly validate quote expiration in application logic
CourierQuoteSchema.methods.isExpired = function (): boolean {
  return new Date() > this.expiresAt;
};

// Background TTL index for cleanup after 24 hours (cleanup only; logic enforces 15-minute validity)
CourierQuoteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 86400 });

export const CourierQuote = mongoose.model<ICourierQuote>('CourierQuote', CourierQuoteSchema);
