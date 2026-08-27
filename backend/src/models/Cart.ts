import mongoose, { Document, Schema } from "mongoose";

export interface ICartItem {
  productId: mongoose.Types.ObjectId;
  variantId: mongoose.Types.ObjectId;
  quantity: number;
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
  },
  { _id: false }
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
