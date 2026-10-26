import mongoose, { Document, Schema } from "mongoose";

export enum BannerPosition {
  HERO = "HERO",
  PROMOTIONAL_TILE = "PROMOTIONAL_TILE",
  ANNOUNCEMENT_BAR = "ANNOUNCEMENT_BAR",
  FEATURED_BANNER = "FEATURED_BANNER",
}

export enum BannerStatus {
  DRAFT = "DRAFT",
  SCHEDULED = "SCHEDULED",
  ACTIVE = "ACTIVE",
  PAUSED = "PAUSED",
  EXPIRED = "EXPIRED",
}
export enum BannerTextColor {
  LIGHT = "LIGHT",
  DARK = "DARK",
}

export enum BannerTextAlignment {
  LEFT = "LEFT",
  CENTER = "CENTER",
  RIGHT = "RIGHT",
}

export enum BannerOverlayStrength {
  NONE = "NONE",
  LIGHT = "LIGHT",
  MEDIUM = "MEDIUM",
  HEAVY = "HEAVY",
}

export enum BannerAudience {
  ALL = "ALL",
  RETAIL = "RETAIL",
  B2B_CUSTOM = "B2B_CUSTOM",
}


export interface IContentBanner extends Document {
  title: string;
  subtitle?: string;
  image: string;
  mobileImage?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  position: BannerPosition;
  displayOrder: number;
  status: BannerStatus;
  textColor: BannerTextColor;
  textAlignment: BannerTextAlignment;
  overlayStrength: BannerOverlayStrength;
  targetAudience: BannerAudience;
  impressions: number;
  clicks: number;
  startsAt?: Date;
  endsAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const contentBannerSchema = new Schema<IContentBanner>(
  {
    title: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
    subtitle: { type: String, trim: true, maxlength: 200 },
    image: { type: String, required: true },
    mobileImage: { type: String },
    ctaLabel: { type: String, trim: true, maxlength: 50 },
    ctaUrl: { type: String, trim: true, default: "/shop" },
    position: {
      type: String,
      enum: Object.values(BannerPosition),
      default: BannerPosition.HERO,
      index: true,
    },
    displayOrder: { type: Number, default: 0 },
    status: {
      type: String,
      enum: Object.values(BannerStatus),
      default: BannerStatus.DRAFT,
      index: true,
    },
    startsAt: { type: Date },
    endsAt: { type: Date },
    textColor: {
      type: String,
      enum: Object.values(BannerTextColor),
      default: BannerTextColor.LIGHT,
    },
    textAlignment: {
      type: String,
      enum: Object.values(BannerTextAlignment),
      default: BannerTextAlignment.LEFT,
    },
    overlayStrength: {
      type: String,
      enum: Object.values(BannerOverlayStrength),
      default: BannerOverlayStrength.MEDIUM,
    },
    targetAudience: {
      type: String,
      enum: Object.values(BannerAudience),
      default: BannerAudience.ALL,
      index: true,
    },
    impressions: { type: Number, default: 0 },
    clicks: { type: Number, default: 0 },
  },
  {
    timestamps: true,
  }
);

export const ContentBanner = mongoose.model<IContentBanner>("ContentBanner", contentBannerSchema);
