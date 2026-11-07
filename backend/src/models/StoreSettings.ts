import mongoose, { Document, Schema, Types } from 'mongoose';

/**
 * Singleton document holding storefront-wide configuration.
 * Values are stored in whole rupees, matching Order/Cart shipping amounts.
 */
export interface IStoreSettings extends Document {
  key: string;
  freeShippingThreshold: number;
  standardShippingFee: number;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const storeSettingsSchema = new Schema<IStoreSettings>(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      default: 'default',
      immutable: true,
    },
    freeShippingThreshold: {
      type: Number,
      required: true,
      min: 0,
      default: 999,
    },
    standardShippingFee: {
      type: Number,
      required: true,
      min: 0,
      default: 100,
    },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

export const StoreSettings = mongoose.model<IStoreSettings>('StoreSettings', storeSettingsSchema);
