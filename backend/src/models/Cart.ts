import mongoose, { Document, Schema } from "mongoose";

export interface ISizeDistribution {
  size: string;
  quantity: number;
}

export interface ICustomConfiguration {
  color: string;
  variantId: mongoose.Types.ObjectId;
  designId?: mongoose.Types.ObjectId;
  purchasedDesignVersion?: number;
  approvedDesignVersion?: number | null;
  sizeDistribution: ISizeDistribution[];
}

export interface IPricingSnapshot {
  basePrice: number;
  variantPrice: number;
  fabricPrice: number;
  printCharges: number;
  customizationCharges: number;
  bulkDiscount: number;
  tax: number;
  shipping: number;
  subtotal: number;
  total: number;
  currency: string;
  calculatedAt: Date;
}

export interface ICartItem {
  _id?: mongoose.Types.ObjectId;
  productId: mongoose.Types.ObjectId;
  variantId: mongoose.Types.ObjectId;
  quantity: number; // For normal items
  
  // Customization additions (backward compatible)
  isCustomized?: boolean;
  customConfigurations?: ICustomConfiguration[];
  pricingSnapshot?: IPricingSnapshot;
  
  // Legacy fields
  customDesignId?: mongoose.Types.ObjectId;
  customizationSnapshot?: {
    name?: string;
    previewImage?: string;
    printLocations?: string[];
    customFee?: number;
  };
}

export interface ICart extends Document {
  userId: mongoose.Types.ObjectId;
  items: ICartItem[];
  couponCode?: string;
  createdAt: Date;
  updatedAt: Date;
}

const cartItemSchema = new Schema<ICartItem>(
  {
    productId: {
      type: Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    variantId: {
      type: Schema.Types.ObjectId,
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
      default: 1,
    },
    customDesignId: {
      type: Schema.Types.ObjectId,
      ref: "CustomDesign",
    },
    customizationSnapshot: {
      name: { type: String },
      previewImage: { type: String },
      printLocations: [{ type: String }],
      customFee: { type: Number, default: 0 },
    },
    // V2 Custom fields
    isCustomized: { type: Boolean, default: false },
    customConfigurations: [
      {
        color: { type: String, required: true },
        variantId: { type: Schema.Types.ObjectId, required: true },
        designId: { type: Schema.Types.ObjectId, ref: "CustomDesign" },
        purchasedDesignVersion: { type: Number },
        approvedDesignVersion: { type: Number, default: null },
        sizeDistribution: [
          {
            size: { type: String, required: true },
            quantity: { type: Number, required: true, min: 1 },
          },
        ],
      },
    ],
    pricingSnapshot: {
      basePrice: { type: Number },
      variantPrice: { type: Number },
      fabricPrice: { type: Number },
      printCharges: { type: Number },
      customizationCharges: { type: Number },
      bulkDiscount: { type: Number },
      tax: { type: Number },
      shipping: { type: Number },
      subtotal: { type: Number },
      total: { type: Number },
      currency: { type: String, default: "INR" },
      calculatedAt: { type: Date },
    },
  }
);

const cartSchema = new Schema<ICart>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    items: [cartItemSchema],
    couponCode: {
      type: String,
      uppercase: true,
      trim: true,
    },
  },
  { timestamps: true }
);

export const Cart = mongoose.model<ICart>("Cart", cartSchema);
