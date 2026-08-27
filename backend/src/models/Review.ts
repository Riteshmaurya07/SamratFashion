import mongoose, { Document, Schema } from "mongoose";

export enum ReviewStatus {
  PENDING = "PENDING",
  APPROVED = "APPROVED",
  REJECTED = "REJECTED",
}

export interface IReview extends Document {
  userId: mongoose.Types.ObjectId;
  productId: mongoose.Types.ObjectId;
  orderId: mongoose.Types.ObjectId;
  orderItemId: string;
  rating: number; // 1 to 5
  title?: string;
  body: string;
  photos: string[];
  status: ReviewStatus;
  isVerifiedPurchase: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const reviewSchema = new Schema<IReview>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true, index: true },
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true, index: true },
    orderItemId: { type: String, required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    title: { type: String, trim: true, max: 120 },
    body: { type: String, required: true, trim: true, minlength: 10, maxlength: 1000 },
    photos: [{ type: String }],
    status: {
      type: String,
      enum: Object.values(ReviewStatus),
      default: ReviewStatus.PENDING,
      index: true,
    },
    isVerifiedPurchase: { type: Boolean, default: true },
  },
  {
    timestamps: true,
  }
);

// Enforce 1 review per purchased order item
reviewSchema.index({ userId: 1, orderId: 1, orderItemId: 1 }, { unique: true });

export const Review = mongoose.model<IReview>("Review", reviewSchema);
