import mongoose, { Document, Schema } from "mongoose";

export enum DiscountType {
  PERCENTAGE = "PERCENTAGE",
  FIXED = "FIXED",
}

export enum CouponStatus {
  ACTIVE = "ACTIVE",
  INACTIVE = "INACTIVE",
}

export interface ICoupon extends Document {
  code: string;
  description?: string;
  discountType: DiscountType;
  discountValue: number;
  minOrderValue: number;
  maxDiscountAmount?: number;
  startsAt?: Date;
  expiresAt?: Date;
  usageLimit?: number;
  perUserUsageLimit?: number;
  usedCount: number;
  status: CouponStatus;
  applicableProductIds: mongoose.Types.ObjectId[];
  applicableCategoryIds: mongoose.Types.ObjectId[];
  applicableThemeIds: mongoose.Types.ObjectId[];
  createdBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const couponSchema = new Schema<ICoupon>(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    description: { type: String, trim: true },
    discountType: {
      type: String,
      enum: Object.values(DiscountType),
      required: true,
    },
    discountValue: {
      type: Number,
      required: true,
      min: 0.01,
    },
    minOrderValue: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    maxDiscountAmount: {
      type: Number,
      min: 0,
    },
    startsAt: { type: Date },
    expiresAt: { type: Date },
    usageLimit: { type: Number, min: 1 },
    perUserUsageLimit: { type: Number, min: 1, default: 1 },
    usedCount: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: Object.values(CouponStatus),
      default: CouponStatus.ACTIVE,
      required: true,
      index: true,
    },
    applicableProductIds: [{ type: Schema.Types.ObjectId, ref: "Product" }],
    applicableCategoryIds: [{ type: Schema.Types.ObjectId, ref: "Category" }],
    applicableThemeIds: [{ type: Schema.Types.ObjectId, ref: "Theme" }],
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

couponSchema.index({ startsAt: 1, expiresAt: 1 });

export const Coupon = mongoose.model<ICoupon>("Coupon", couponSchema);
