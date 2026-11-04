import mongoose, { Document, Schema } from 'mongoose';

export interface IWebhookEvent extends Document {
  eventId: string;
  provider: string;
  eventType: string;
  status: 'PROCESSED' | 'FAILED' | 'IGNORED' | 'PROCESSING';
  processingLockExpiresAt?: Date;
  processingAttempts?: number;
  leaseToken?: string;
  lastError?: string;
  payload?: Record<string, unknown>;
  expiresAt?: Date;
  processedAt?: Date;
  nextRetryAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const webhookEventSchema = new Schema<IWebhookEvent>({
  eventId: { type: String, required: true },
  provider: { type: String, required: true, default: 'RAZORPAY' },
  eventType: { type: String, required: true },
  status: { type: String, enum: ['PROCESSED', 'FAILED', 'IGNORED', 'PROCESSING'], required: true },
  processingLockExpiresAt: { type: Date },
  processingAttempts: { type: Number, default: 0 },
  leaseToken: { type: String },
  lastError: { type: String },
  payload: { type: Schema.Types.Mixed },
  expiresAt: { type: Date },
  processedAt: { type: Date },
  nextRetryAt: { type: Date }
}, { timestamps: true });
webhookEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });
webhookEventSchema.index({ provider: 1, status: 1, processingLockExpiresAt: 1 });
webhookEventSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, sparse: true });
export const WebhookEvent = mongoose.model<IWebhookEvent>('WebhookEvent', webhookEventSchema);

/**
 * Interface representing an active background lease heartbeat for an individual WebhookEvent.
 */
export interface LeaseHeartbeat {
  stop: () => void;
  hasLostLease: () => boolean;
  renewNow: () => Promise<boolean>;
}

/**
 * Atomically renews an active individual WebhookEvent lease.
 * Enforces strict fencing:
 * 1. Document status must be 'PROCESSING'.
 * 2. Document leaseToken must match the current worker's leaseToken.
 * 3. The current lease must still be active (processingLockExpiresAt > now).
 *
 * If another worker reclaimed the event or the lease already expired, renewal returns false.
 */
export async function renewWebhookEventLease(
  eventIdOrMongoId: string | mongoose.Types.ObjectId,
  leaseToken: string,
  extensionMs = 60_000
): Promise<boolean> {
  if (!leaseToken) return false;
  const now = new Date();
  const newExpiry = new Date(Date.now() + extensionMs);

  const query: Record<string, unknown> = {
    status: 'PROCESSING',
    leaseToken,
    processingLockExpiresAt: { $gt: now }
  };

  if (mongoose.Types.ObjectId.isValid(eventIdOrMongoId)) {
    query._id = eventIdOrMongoId;
  } else {
    query.eventId = eventIdOrMongoId;
  }

  try {
    const updated = await WebhookEvent.findOneAndUpdate(
      query,
      {
        $set: {
          processingLockExpiresAt: newExpiry
        }
      },
      { returnDocument: 'after' }
    );

    return Boolean(updated);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[WEBHOOK_LEASE] Conservative error handling during lease renewal for ${eventIdOrMongoId}: ${msg}`);
    return false;
  }
}

/**
 * Starts a background heartbeat timer that periodically renews the individual event lease
 * before it can expire during long-running processing.
 */
export function startEventLeaseHeartbeat(
  eventIdOrMongoId: string | mongoose.Types.ObjectId,
  leaseToken: string,
  leaseDurationMs = 60_000,
  heartbeatIntervalMs?: number
): LeaseHeartbeat {
  let lostLease = false;
  const interval = heartbeatIntervalMs || Math.max(100, Math.floor(leaseDurationMs / 3));

  const renewNow = async (): Promise<boolean> => {
    if (lostLease) return false;
    try {
      const renewed = await renewWebhookEventLease(eventIdOrMongoId, leaseToken, leaseDurationMs);
      if (!renewed) {
        lostLease = true;
      }
      return renewed;
    } catch {
      lostLease = true;
      return false;
    }
  };

  const timer = setInterval(async () => {
    if (lostLease) {
      clearInterval(timer);
      return;
    }
    await renewNow();
  }, interval);

  if (timer.unref) {
    timer.unref();
  }

  return {
    stop: () => {
      clearInterval(timer);
    },
    hasLostLease: () => lostLease,
    renewNow
  };
}
