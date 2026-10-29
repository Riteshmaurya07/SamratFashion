import mongoose, { Document, Schema } from 'mongoose';

export interface ILogisticsEventLog extends Document {
  providerEventId: string;
  awbNumber: string;
  eventType: string;
  payload: Record<string, any>;
  processedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const logisticsEventLogSchema = new Schema<ILogisticsEventLog>({
  providerEventId: { type: String, required: true, unique: true, index: true },
  awbNumber: { type: String, required: true, index: true },
  eventType: { type: String, required: true },
  payload: { type: Schema.Types.Mixed, default: {} },
  processedAt: { type: Date, default: Date.now }
}, { timestamps: true });

logisticsEventLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 120 * 24 * 60 * 60 });

export const LogisticsEventLog = mongoose.model<ILogisticsEventLog>('LogisticsEventLog', logisticsEventLogSchema);
