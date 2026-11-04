import mongoose, { Document, Schema } from 'mongoose';

export interface IRecoveryStatus extends Document {
  identifier: string; // 'SINGLETON'
  lastRunStartedAt: Date;
  lastRunCompletedAt?: Date;
  durationMs: number;
  status: 'IDLE' | 'RUNNING' | 'SUCCESS' | 'PARTIAL' | 'ERROR';
  inventoryResolvedCount: number;
  webhookProcessedCount: number;
  webhookRecoveredCount: number;
  refundsRecoveredCount: number;
  activeLocksCount: number;
  executionErrors: string[];
  createdAt: Date;
  updatedAt: Date;
}

const recoveryStatusSchema = new Schema<IRecoveryStatus>(
  {
    identifier: { type: String, required: true, unique: true, default: 'SINGLETON' },
    lastRunStartedAt: { type: Date, default: Date.now },
    lastRunCompletedAt: { type: Date },
    durationMs: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['IDLE', 'RUNNING', 'SUCCESS', 'PARTIAL', 'ERROR'],
      default: 'IDLE',
      required: true,
    },
    inventoryResolvedCount: { type: Number, default: 0 },
    webhookProcessedCount: { type: Number, default: 0 },
    webhookRecoveredCount: { type: Number, default: 0 },
    refundsRecoveredCount: { type: Number, default: 0 },
    activeLocksCount: { type: Number, default: 0 },
    executionErrors: [{ type: String }],
  },
  { timestamps: true }
);

export const RecoveryStatus = mongoose.model<IRecoveryStatus>('RecoveryStatus', recoveryStatusSchema);
