import mongoose, { Document, Schema } from "mongoose";

export interface ICouponUsage extends Document {
  couponId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  orderId: mongoose.Types.ObjectId;
  discountAmount: number;
  createdAt: Date;
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
  },
  { timestamps: true }
);

couponUsageSchema.index({ couponId: 1, userId: 1 });

export const CouponUsage = mongoose.model<ICouponUsage>("CouponUsage", couponUsageSchema);
