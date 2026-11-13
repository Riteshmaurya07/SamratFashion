import mongoose, { Document, Schema } from "mongoose";

export enum CouponUsageStatus {
  RESERVED = "RESERVED",
  CONFIRMED = "CONFIRMED",
  RELEASED = "RELEASED",
}

export interface ICouponUsage extends Document {
  couponId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  orderId: mongoose.Types.ObjectId;
  discountAmount: number;
  status: CouponUsageStatus;
  usageSlot: number;
  expiresAt?: Date;
  confirmedAt?: Date;
  releasedAt?: Date;
  releaseReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const couponUsageSchema = new Schema<ICouponUsage>(
  {
    couponId: {
      type: Schema.Types.ObjectId,
      ref: "Coupon",
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    orderId: {
      type: Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      unique: true, // One coupon usage log per order
    },
    discountAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: Object.values(CouponUsageStatus),
      default: CouponUsageStatus.CONFIRMED,
      required: true,
      index: true,
    },
    usageSlot: {
      type: Number,
      required: true,
      min: 1,
      default: 1,
    },
    expiresAt: {
      type: Date,
      index: true,
    },
    confirmedAt: {
      type: Date,
    },
    releasedAt: {
      type: Date,
    },
    releaseReason: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true }
);

couponUsageSchema.index({ couponId: 1, userId: 1 });
couponUsageSchema.index({ status: 1, expiresAt: 1 });
couponUsageSchema.index(
  { couponId: 1, userId: 1, usageSlot: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: [CouponUsageStatus.RESERVED, CouponUsageStatus.CONFIRMED] } },
    name: "coupon_user_slot_active_unique",
  }
);

export const CouponUsage = mongoose.model<ICouponUsage>("CouponUsage", couponUsageSchema);
