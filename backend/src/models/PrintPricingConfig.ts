import mongoose, { Document, Schema } from "mongoose";

export type PricingScope = "GLOBAL" | "CATEGORY" | "PRODUCT";

export interface IVolumePricingTier {
  minQuantity: number;
  maxQuantity?: number;
  discountPercentage?: number;
  unitPrice?: number; // in Rupees
}

export interface IPrintPricingConfig extends Document {
  scope: PricingScope;
  productId?: mongoose.Types.ObjectId;
  categoryId?: mongoose.Types.ObjectId;
  minOrderQuantity: number;
  tiers: IVolumePricingTier[];
  printLocationFee: number; // in Rupees
  setupFee: number; // in Rupees
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const volumePricingTierSchema = new Schema<IVolumePricingTier>(
  {
    minQuantity: { type: Number, required: true, min: 1 },
    maxQuantity: { type: Number, min: 1 },
    discountPercentage: { type: Number, min: 0, max: 100 },
    unitPrice: { type: Number, min: 0 },
  },
  { _id: false }
);

const printPricingConfigSchema = new Schema<IPrintPricingConfig>(
  {
    scope: {
      type: String,
      enum: ["GLOBAL", "CATEGORY", "PRODUCT"],
      required: true,
      default: "GLOBAL",
    },
    productId: { type: Schema.Types.ObjectId, ref: "Product" },
    categoryId: { type: Schema.Types.ObjectId, ref: "Category" },
    minOrderQuantity: { type: Number, required: true, min: 1, default: 10 },
    tiers: { type: [volumePricingTierSchema], default: [] },
    printLocationFee: { type: Number, default: 200, min: 0 },
    setupFee: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

printPricingConfigSchema.index({ scope: 1, productId: 1 });
printPricingConfigSchema.index({ scope: 1, categoryId: 1 });
printPricingConfigSchema.index({ scope: 1, isActive: 1 });

export const PrintPricingConfig = mongoose.model<IPrintPricingConfig>(
  "PrintPricingConfig",
  printPricingConfigSchema
);
