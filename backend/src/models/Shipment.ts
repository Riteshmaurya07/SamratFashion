import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IShipment extends Document {
  orderId: Types.ObjectId;
  userId: Types.ObjectId;
  carrier: string;
  trackingNumber: string;
  trackingUrl?: string;
  status: 'PENDING' | 'LABEL_CREATED' | 'SHIPPED' | 'IN_TRANSIT' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'CANCELLED';
  shippedAt?: Date;
  deliveredAt?: Date;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const shipmentSchema = new Schema<IShipment>({
  orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, unique: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  carrier: { type: String, required: true },
  trackingNumber: { type: String, required: true },
  trackingUrl: { 
    type: String, 
    validate: {
      validator: function(v: string) {
        if (!v) return true; // optional
        return /^https:\/\//i.test(v); // HTTPS only, reject javascript:, data:
      },
      message: 'Tracking URL must be a valid HTTPS URL'
    }
  },
  status: { 
    type: String, 
    enum: ['PENDING', 'LABEL_CREATED', 'SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'], 
    default: 'PENDING',
    required: true 
  },
  shippedAt: { type: Date },
  deliveredAt: { type: Date },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

export const Shipment = mongoose.model<IShipment>('Shipment', shipmentSchema);
