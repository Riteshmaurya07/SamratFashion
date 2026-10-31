import mongoose, { Document, Schema } from 'mongoose';

export interface IAddress extends Document {
  userId: mongoose.Types.ObjectId;
  fullName: string;
  phone: string;
  alternatePhone?: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  landmark?: string;
  addressType: 'HOME' | 'WORK' | 'OTHER';
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const AddressSchema = new Schema<IAddress>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    fullName: { type: String, required: true, trim: true },
    phone: {
      type: String,
      required: true,
      trim: true,
      validate: {
        validator: (v: string) => /^[6-9]\d{9}$/.test(v.replace(/\D/g, '')),
        message: 'Primary phone must be a valid 10-digit Indian mobile number',
      },
    },
    alternatePhone: {
      type: String,
      trim: true,
      validate: {
        validator: function (v: string | undefined | null) {
          if (!v || !v.trim()) return true;
          return /^[6-9]\d{9}$/.test(v.replace(/\D/g, ''));
        },
        message: 'Alternate phone must be a valid 10-digit Indian mobile number',
      },
    },
    addressLine1: { type: String, required: true, trim: true },
    addressLine2: { type: String, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    postalCode: { type: String, required: true, trim: true },
    country: { type: String, required: true, trim: true, default: 'India' },
    landmark: { type: String, trim: true },
    addressType: {
      type: String,
      enum: ['HOME', 'WORK', 'OTHER'],
      default: 'HOME',
      required: true,
    },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Prevent multiple defaults at the database level if possible, 
// though we handle it in controller logic.
// We can't do a simple unique index on (userId, isDefault) because a user can have multiple non-default addresses.

export const Address = mongoose.model<IAddress>('Address', AddressSchema);
