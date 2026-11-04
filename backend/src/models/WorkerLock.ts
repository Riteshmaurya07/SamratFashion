import mongoose, { Document, Schema } from 'mongoose';

export interface IWorkerLock extends Document {
  lockName: string;
  ownerId: string;
  fencingToken: number;
  leaseExpiresAt: Date;
  lastAcquiredAt: Date;
  lastReleasedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const workerLockSchema = new Schema<IWorkerLock>(
  {
    lockName: { type: String, required: true, unique: true },
    ownerId: { type: String, required: true },
    fencingToken: { type: Number, default: 0, required: true },
    leaseExpiresAt: { type: Date, required: true },
    lastAcquiredAt: { type: Date, default: Date.now },
    lastReleasedAt: { type: Date },
  },
  { timestamps: true }
);

workerLockSchema.index({ lockName: 1, leaseExpiresAt: 1 });

export const WorkerLock = mongoose.model<IWorkerLock>('WorkerLock', workerLockSchema);
