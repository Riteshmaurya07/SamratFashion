import mongoose, { Document, Schema } from 'mongoose';

export interface IWebhookEvent extends Document {
  eventId: string;
  provider: string;
  eventType: string;
  status: 'PROCESSED' | 'FAILED' | 'IGNORED';
  processedAt: Date;
}

const webhookEventSchema = new Schema<IWebhookEvent>({
  eventId: { type: String, required: true },
  provider: { type: String, required: true, default: 'RAZORPAY' },
  eventType: { type: String, required: true },
  status: { type: String, enum: ['PROCESSED', 'FAILED', 'IGNORED'], required: true },
  processedAt: { type: Date, default: Date.now }
}, { timestamps: true });

webhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });

export const WebhookEvent = mongoose.model<IWebhookEvent>('WebhookEvent', webhookEventSchema);
