import mongoose, { Document, Schema } from "mongoose";

export enum ThemeStatus {
  ACTIVE = "ACTIVE",
  INACTIVE = "INACTIVE",
}

export interface ITheme extends Document {
  name: string;
  slug: string;
  description?: string;
  heroImage?: string;
  thumbnail?: string;
  status: ThemeStatus;
  displayOrder: number;
  isFeatured: boolean;
  seo: {
    title?: string;
    description?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const themeSchema = new Schema<ITheme>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    description: { type: String, trim: true },
    heroImage: { type: String },
    thumbnail: { type: String },
    status: { type: String, enum: Object.values(ThemeStatus), default: ThemeStatus.ACTIVE },
    displayOrder: { type: Number, default: 0 },
    isFeatured: { type: Boolean, default: false },
    seo: {
      title: { type: String, trim: true },
      description: { type: String, trim: true },
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
themeSchema.index({ status: 1 });
themeSchema.index({ isFeatured: 1 });
themeSchema.index({ displayOrder: 1 });

export const Theme = mongoose.model<ITheme>("Theme", themeSchema);
