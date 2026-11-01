import mongoose, { Document, Schema } from "mongoose";

export enum CategoryStatus {
  ACTIVE = "ACTIVE",
  INACTIVE = "INACTIVE",
}

export interface ICategory extends Document {
  name: string;
  slug: string;
  description?: string;
  image?: string;
  parentCategory?: mongoose.Types.ObjectId;
  displayOrder: number;
  status: CategoryStatus;
  isFreeShippingEnabled: boolean;
  freeShippingMinAmount: number;
  seo: {
    title?: string;
    description?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const categorySchema = new Schema<ICategory>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    description: { type: String, trim: true },
    image: { type: String },
    parentCategory: { type: Schema.Types.ObjectId, ref: "Category", default: null },
    displayOrder: { type: Number, default: 0 },
    status: { type: String, enum: Object.values(CategoryStatus), default: CategoryStatus.ACTIVE },
    isFreeShippingEnabled: { type: Boolean, default: false },
    freeShippingMinAmount: { type: Number, default: 0, min: [0, "Minimum order amount cannot be negative"] },
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
categorySchema.index({ status: 1 });
categorySchema.index({ parentCategory: 1 });
categorySchema.index({ displayOrder: 1 });

export const Category = mongoose.model<ICategory>("Category", categorySchema);
