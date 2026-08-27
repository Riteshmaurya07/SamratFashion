import mongoose, { Document, Schema } from "mongoose";

export enum CampaignStatus {
  DRAFT = "DRAFT",
  SCHEDULED = "SCHEDULED",
  ACTIVE = "ACTIVE",
  PAUSED = "PAUSED",
  EXPIRED = "EXPIRED",
}

export interface ICampaign extends Document {
  name: string;
  slug: string;
  description?: string;
  discountTag?: string;
  status: CampaignStatus;
  startsAt?: Date;
  endsAt?: Date;
  bannerIds: mongoose.Types.ObjectId[];
  couponId?: mongoose.Types.ObjectId;
  productIds: mongoose.Types.ObjectId[];
  categoryIds: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const campaignSchema = new Schema<ICampaign>(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
    slug: { type: String, required: true, unique: true, index: true },
    description: { type: String, trim: true },
    discountTag: { type: String, trim: true },
    status: {
      type: String,
      enum: Object.values(CampaignStatus),
      default: CampaignStatus.DRAFT,
      index: true,
    },
    startsAt: { type: Date },
    endsAt: { type: Date },
    bannerIds: [{ type: Schema.Types.ObjectId, ref: "ContentBanner" }],
    couponId: { type: Schema.Types.ObjectId, ref: "Coupon" },
    productIds: [{ type: Schema.Types.ObjectId, ref: "Product" }],
    categoryIds: [{ type: Schema.Types.ObjectId, ref: "Category" }],
  },
  {
    timestamps: true,
  }
);

export const Campaign = mongoose.model<ICampaign>("Campaign", campaignSchema);
