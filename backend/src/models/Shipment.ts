import mongoose, { Document, Schema, Types } from 'mongoose';

export interface ITrackingEvent {
  status: string;
  location?: string;
  description: string;
  timestamp: Date;
  providerEventId?: string;
}

export interface IShipment extends Document {
  orderId: Types.ObjectId;
  userId: Types.ObjectId;
  carrier: string;
  trackingNumber: string;
  awbNumber: string;
  providerShipmentId?: string;
  provider: string;
  trackingUrl?: string;
  labelUrl?: string;
  pickupId?: string;
  pickupRequestedAt?: Date;
  status: 'PENDING' | 'LABEL_CREATED' | 'PICKUP_REQUESTED' | 'PICKED_UP' | 'SHIPPED' | 'IN_TRANSIT' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'NDR' | 'RTO' | 'CANCELLED';
  shippedAt?: Date;
  deliveredAt?: Date;
  trackingHistory: ITrackingEvent[];
  packageDetails?: {
    weightGrams: number;
    lengthCm: number;
    widthCm: number;
    heightCm: number;
  };
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const trackingEventSchema = new Schema<ITrackingEvent>({
  status: { type: String, required: true },
  location: { type: String },
  description: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  providerEventId: { type: String }
}, { _id: false });

const shipmentSchema = new Schema<IShipment>({
  orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, unique: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  carrier: { type: String, required: true },
  trackingNumber: { type: String, required: true, index: true },
  awbNumber: { type: String, required: true, index: true },
  providerShipmentId: { type: String },
  provider: { type: String, default: 'mock', required: true },
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
  labelUrl: { type: String },
  pickupId: { type: String },
  pickupRequestedAt: { type: Date },
  status: { 
    type: String, 
    enum: ['PENDING', 'LABEL_CREATED', 'PICKUP_REQUESTED', 'PICKED_UP', 'SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'NDR', 'RTO', 'CANCELLED'], 
    default: 'PENDING',
    required: true 
  },
  shippedAt: { type: Date },
  deliveredAt: { type: Date },
  trackingHistory: { type: [trackingEventSchema], default: [] },
  packageDetails: {
    weightGrams: { type: Number, default: 500 },
    lengthCm: { type: Number, default: 30 },
    widthCm: { type: Number, default: 25 },
    heightCm: { type: Number, default: 5 }
  },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });

export const Shipment = mongoose.model<IShipment>('Shipment', shipmentSchema);
