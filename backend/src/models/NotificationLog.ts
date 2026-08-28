import mongoose, { Document, Schema, Types } from 'mongoose';

export type NotificationChannel = 'EMAIL' | 'SMS' | 'WHATSAPP';
export type NotificationStatus = 'PENDING' | 'SENT' | 'FAILED' | 'NOT_CONFIGURED';

export interface INotificationLog extends Document {
  eventType: string;
  entityType: string;
  entityId: Types.ObjectId;
  recipientEmail: string;
  recipientPhone?: string;
  channel: NotificationChannel;
  status: NotificationStatus;
  provider: string;
  providerMessageId?: string;
  attemptCount: number;
  idempotencyKey: string;
  sentAt?: Date;
  lastError?: string;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const notificationLogSchema = new Schema<INotificationLog>(
  {
    eventType: { type: String, required: true, index: true },
    entityType: { type: String, required: true, index: true },
    entityId: { type: Schema.Types.ObjectId, required: true, index: true },
    recipientEmail: { type: String, required: true },
    recipientPhone: { type: String },
    channel: { type: String, enum: ['EMAIL', 'SMS', 'WHATSAPP'], default: 'EMAIL', required: true },
    status: { type: String, enum: ['PENDING', 'SENT', 'FAILED', 'NOT_CONFIGURED'], default: 'PENDING', required: true, index: true },
    provider: { type: String, required: true, default: 'console' },
    providerMessageId: { type: String },
    attemptCount: { type: Number, default: 1, min: 1 },
    idempotencyKey: { type: String, required: true, unique: true, index: true },
    sentAt: { type: Date },
    lastError: { type: String },
    metadata: { type: Schema.Types.Mixed }
  },
  { timestamps: true }
);

export const NotificationLog = mongoose.model<INotificationLog>('NotificationLog', notificationLogSchema);
