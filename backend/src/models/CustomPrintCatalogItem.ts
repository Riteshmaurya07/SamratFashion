import mongoose, { Document, Schema } from "mongoose";

export interface ICustomPrintCatalogItem extends Document {
  name: string;
  slug: string;
  description?: string;
  productId: mongoose.Types.ObjectId;
  placementTemplateId: mongoose.Types.ObjectId;
  mockupImageUrl: string;
  displayPrice?: number; // in paise, optional
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
    placementTemplateId: { type: Schema.Types.ObjectId, ref: "PrintPlacementTemplate", required: true },
    mockupImageUrl: { type: String, required: true, trim: true },
    displayPrice: { type: Number, min: 0 },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

customPrintCatalogItemSchema.index({ isActive: 1, sortOrder: 1 });

export const CustomPrintCatalogItem = mongoose.model<ICustomPrintCatalogItem>(
  "CustomPrintCatalogItem",
  customPrintCatalogItemSchema
);
