import mongoose, { Document, Schema } from "mongoose";

export interface ICustomPrintCatalogItem extends Document {
  name: string;
  slug: string;
  description?: string;
  productId: mongoose.Types.ObjectId;
  categoryId?: mongoose.Types.ObjectId;
  mockupImageUrl: string;
  backMockupImageUrl?: string;
  displayPrice?: number; // in Rupees, min 0
  minOrderQuantity?: number; // optional item-specific MOQ
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const customPrintCatalogItemSchema = new Schema<ICustomPrintCatalogItem>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, unique: true, lowercase: true },
    description: { type: String, trim: true },
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    categoryId: { type: Schema.Types.ObjectId, ref: "Category" },
    mockupImageUrl: { type: String, required: true, trim: true },
    backMockupImageUrl: { type: String, trim: true },
    displayPrice: { type: Number, min: 0 },
    minOrderQuantity: { type: Number, min: 1 },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);


customPrintCatalogItemSchema.index({ isActive: 1, sortOrder: 1 });
customPrintCatalogItemSchema.index({ categoryId: 1, isActive: 1 });

export const CustomPrintCatalogItem = mongoose.model<ICustomPrintCatalogItem>(
  "CustomPrintCatalogItem",
  customPrintCatalogItemSchema
);
