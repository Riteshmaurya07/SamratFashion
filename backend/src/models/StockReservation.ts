import mongoose, { Document, Schema } from 'mongoose';

export enum StockReservationStatus {
  RESERVED = 'RESERVED',
  CONFIRMED = 'CONFIRMED',
  RELEASED = 'RELEASED',
}

export interface IStockReservation extends Document {
  orderId: mongoose.Types.ObjectId;
  productId: mongoose.Types.ObjectId;
  variantId: mongoose.Types.ObjectId;
  quantity: number;
  status: StockReservationStatus;
  expiresAt?: Date;
  releasedAt?: Date;
  releaseReason?: string;
  confirmedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const stockReservationSchema = new Schema<IStockReservation>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    variantId: { type: Schema.Types.ObjectId, required: true },
    quantity: { type: Number, required: true, min: 1 },
    status: {
      type: String,
      enum: Object.values(StockReservationStatus),
      default: StockReservationStatus.RESERVED,
      required: true,
      index: true,
    },
    expiresAt: { type: Date, index: true },
    releasedAt: { type: Date },
    releaseReason: { type: String },
    confirmedAt: { type: Date },
  },
  { timestamps: true }
);

// Idempotency: at most one reservation per order per variant
stockReservationSchema.index({ orderId: 1, variantId: 1 }, { unique: true });
stockReservationSchema.index({ status: 1, expiresAt: 1 });

export const StockReservation = mongoose.model<IStockReservation>(
  'StockReservation',
  stockReservationSchema
);
