import mongoose from 'mongoose';
import { AppError } from '../../utils/AppError';
import crypto from 'crypto';
import { WorkerLock } from '../../models/WorkerLock';
import { RecoveryStatus } from '../../models/RecoveryStatus';
import { WebhookEvent, startEventLeaseHeartbeat } from '../../models/WebhookEvent';
import { InventoryTransaction } from '../../models/InventoryTransaction';
import { ReturnRequest } from '../../models/ReturnRequest';
import { Refund } from '../../models/Refund';
import { Payment } from '../../models/Payment';
import { Order } from '../../models/Order';
import { InventoryAllocationService } from '../inventory/inventoryAllocationService';
import {
  recoverStaleWebhookEvents,
  processSupportedWebhookEvent,
} from '../../controllers/webhookController';
import { reconcileIncompleteRefundOperations } from '../payment/refundService';
import { reconcilePendingCancellationOperations } from '../orderCancellationService';
import { expireStalePendingOrders, reconcilePendingExpiryCleanups } from '../orderExpiryService';
import { isStrictProductionOrStaging } from '../../config/env';
import { isTransactionSupported } from '../coupon/couponReservationService';

export const RECOVERY_LOCK_NAME = 'RECOVERY_COORDINATOR_LEADER';
export const DEFAULT_LEASE_DURATION_MS = 60_000; // 60 seconds
export const DEFAULT_SCHEDULER_INTERVAL_MS = Number(process.env.RECOVERY_SCHEDULER_INTERVAL_MS) || 60_000;

export interface LeaseAcquisitionResult {
  acquired: boolean;
  ownerId: string;
  fencingToken?: number;
}

export interface RecoveryCycleReport {
  executed: boolean;
  skippedReason?: string;
  ownerId?: string;
  fencingToken?: number;
  durationMs: number;
  inventoryResolvedCount: number;
  webhookProcessedCount: number;
  webhookRecoveredCount: number;
  refundsRecoveredCount: number;
  cancellationsRecoveredCount?: number;
  expiredOrdersCount?: number;
  expiryCleanupsRecoveredCount?: number;
  errors: string[];
}
export interface FencedRecoveryContext {
  fencingToken: number;
  lockName?: string;
  ownerId?: string;
  leaseDurationMs?: number;
  existingSession?: mongoose.ClientSession | null;
}

export interface WorkerLeaseHeartbeatOptions {
  heartbeatIntervalMs?: number;
  isTransactionActive?: () => boolean;
  initialExpiresAtMs?: number;
  onLeaseLost?: (reason: string) => void;
}

export interface WorkerLeaseHeartbeat {
  stop: () => void;
  hasLostLease: () => boolean;
  markLeaseLost: (reason?: string) => void;
  renewNow: () => Promise<boolean>;
  extendLease: (newExpiresAtMs: number) => void;
}

export interface RecoverySystemMetrics {
  pendingInventoryCount: number;
  staleWebhookCount: number;
  failedWebhookCount: number;
  incompleteRefundsCount: number;
  unknownRefundsCount: number;
  pendingReservationsCount: number;
  pendingCancellationsCount?: number;
  lastExecution?: {
    startedAt: Date;
    completedAt?: Date;
    durationMs: number;
    status: string;
    errors: string[];
  };
}

export class RecoveryCoordinatorService {
  private static instanceOwnerId: string = `worker_${process.pid}_${crypto.randomUUID().slice(0, 8)}`;
  private static schedulerTimer: NodeJS.Timeout | null = null;
  private static initialSchedulerTimer: NodeJS.Timeout | null = null;
  private static isShuttingDown = false;
  private static isExecutingCycle = false;
  private static fencedTxDepth = 0;
  public static isFencedTransactionActive = false;
  private static activeCyclePromise: Promise<RecoveryCycleReport> | null = null;
  private static activeBackgroundTasks: Set<Promise<unknown>> = new Set();
  public static inFlightOperationHook?: () => Promise<void>;
  public static getOwnerId(): string {
    return this.instanceOwnerId;
  }

  public static getActiveCyclePromise(): Promise<RecoveryCycleReport> | null {
    return this.activeCyclePromise;
  }

  public static trackBackgroundTask<T>(task: Promise<T>): Promise<T> {
    this.activeBackgroundTasks.add(task);
    task.finally(() => {
      this.activeBackgroundTasks.delete(task);
    });
    return task;
  }

  public static async awaitActiveCycle(timeoutMs = 15000): Promise<boolean> {
    const promises: Promise<unknown>[] = [];
    if (this.activeCyclePromise) {
      promises.push(this.activeCyclePromise);
    }
    for (const p of this.activeBackgroundTasks) {
      promises.push(p);
    }
    if (promises.length === 0) return true;

    let timedOut = false;
    let timer: NodeJS.Timeout;
    const timeoutPromise = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        timedOut = true;
        resolve();
      }, timeoutMs);
    });
    await Promise.race([
      Promise.allSettled(promises),
      timeoutPromise
    ]);
    clearTimeout(timer!);
    return !timedOut;
  }

  public static resetShutdownStateForTesting(): void {
    this.isShuttingDown = false;
    this.isExecutingCycle = false;
    this.activeCyclePromise = null;
    this.inFlightOperationHook = undefined;
    if (this.initialSchedulerTimer) {
      clearTimeout(this.initialSchedulerTimer);
      this.initialSchedulerTimer = null;
    }
    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
    this.activeBackgroundTasks.clear();
  }

  public static async drainAndShutdown(options: {
    drainTimeoutMs?: number;
    disconnectDbFn?: () => Promise<void>;
  } = {}): Promise<{ drained: boolean; message: string }> {
    const drainTimeoutMs = options.drainTimeoutMs ?? 15000;
    this.stopRecoveryScheduler();

    const drained = await this.awaitActiveCycle(drainTimeoutMs);
    if (!drained) {
      console.error(`[RECOVERY_COORDINATOR] Active recovery cycle did not drain within ${drainTimeoutMs}ms.`);
      return {
        drained: false,
        message: `Active cycle did not drain within ${drainTimeoutMs}ms timeout; lease release withheld.`
      };
    }

    if (options.disconnectDbFn) {
      await options.disconnectDbFn();
    }

    return {
      drained: true,
      message: 'Active cycle drained cleanly.'
    };
  }
  /**
   * Atomically acquires a distributed lease lock across multiple backend instances.
   */
  public static async acquireWorkerLease(
    lockName = RECOVERY_LOCK_NAME,
    ownerId = this.instanceOwnerId,
    leaseDurationMs = DEFAULT_LEASE_DURATION_MS
  ): Promise<LeaseAcquisitionResult> {
    const now = new Date();
    const leaseExpiresAt = new Date(Date.now() + leaseDurationMs);

    try {
      // 1. Try to reclaim an expired lock or renew own existing lock
      const existingUpdated = await WorkerLock.findOneAndUpdate(
        {
          lockName,
          $or: [
            { leaseExpiresAt: { $lt: now } },
            { ownerId }
          ]
        },
        {
          $set: {
            ownerId,
            leaseExpiresAt,
            lastAcquiredAt: now
          },
          $inc: { fencingToken: 1 }
        },
        { returnDocument: 'after' }
      );

      if (existingUpdated) {
        return {
          acquired: true,
          ownerId,
          fencingToken: existingUpdated.fencingToken
        };
      }

      // 2. If no lock document exists yet, try creating it with upsert
      try {
        const created = await WorkerLock.create({
          lockName,
          ownerId,
          fencingToken: 1,
          leaseExpiresAt,
          lastAcquiredAt: now
        });
        return {
          acquired: true,
          ownerId,
          fencingToken: created.fencingToken
        };
      } catch (createErr: unknown) {
        const code = (createErr && typeof createErr === 'object' && 'code' in createErr)
          ? (createErr as { code: number }).code
          : undefined;
        if (code === 11000) {
          // Another instance created it concurrently
          return { acquired: false, ownerId };
        }
        throw createErr;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[RECOVERY_COORDINATOR] Lease acquisition failed for ${lockName}: ${msg}`);
      return { acquired: false, ownerId };
    }
  }

  /**
   * Renews an active lease during long-running batch operations.
   * Fencing token guard ensures an expired/stale worker cannot renew after losing ownership.
   */
  public static async renewWorkerLease(
    lockName = RECOVERY_LOCK_NAME,
    ownerId = this.instanceOwnerId,
    fencingToken: number,
    extensionMs = DEFAULT_LEASE_DURATION_MS,
    session?: mongoose.ClientSession
  ): Promise<boolean> {
    if (typeof fencingToken !== 'number' || !Number.isFinite(fencingToken) || fencingToken < 1) {
      return false;
    }
    const now = new Date();
    const newExpiresAt = new Date(Date.now() + extensionMs);

    const renewed = await WorkerLock.findOneAndUpdate(
      {
        lockName,
        ownerId,
        fencingToken,
        leaseExpiresAt: { $gt: now }
      },
      {
        $set: { leaseExpiresAt: newExpiresAt }
      },
      { session: session || undefined, returnDocument: 'after' }
    );

    return Boolean(renewed);
  }

  /**
   * Starts a safe periodic lease-renewal heartbeat for any worker holding a WorkerLock.
   * Suppresses out-of-band renewal while a MongoDB transaction is active to prevent
   * WriteConflict on WorkerLock, catches all renewal errors cleanly, and marks ownership
   * lost as soon as renewal fails or the local lease deadline expires.
   */
  public static startWorkerLeaseHeartbeat(
    lockName: string,
    ownerId: string,
    fencingToken: number,
    leaseDurationMs = DEFAULT_LEASE_DURATION_MS,
    options: WorkerLeaseHeartbeatOptions = {}
  ): WorkerLeaseHeartbeat {
    let lostLease = false;
    let stopped = false;
    let inFlightRenewal: Promise<boolean> | null = null;
    let currentLeaseExpiresAt = options.initialExpiresAtMs ?? (Date.now() + leaseDurationMs);
    const intervalMs = options.heartbeatIntervalMs ?? Math.max(50, Math.floor(leaseDurationMs / 3));

    let timer: NodeJS.Timeout | null = null;

    const markLeaseLost = (reason = 'Worker lease expired or ownership lost') => {
      if (lostLease) return;
      lostLease = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      options.onLeaseLost?.(reason);
    };

    const renewNow = async (): Promise<boolean> => {
      if (lostLease || stopped) return false;
      if (options.isTransactionActive?.()) {
        if (Date.now() >= currentLeaseExpiresAt) {
          markLeaseLost(`Worker lease expired for ${lockName} while transaction was active`);
        }
        return false;
      }
      if (Date.now() >= currentLeaseExpiresAt) {
        markLeaseLost(`Worker lease expired locally for ${lockName}`);
        return false;
      }
      if (inFlightRenewal) {
        return inFlightRenewal;
      }

      inFlightRenewal = (async () => {
        try {
          const renewStartedAt = Date.now();
          const renewed = await RecoveryCoordinatorService.renewWorkerLease(
            lockName,
            ownerId,
            fencingToken,
            leaseDurationMs
          );
          if (!renewed) {
            markLeaseLost(`Worker lease renewal rejected for ${lockName} (owner=${ownerId}, token=${fencingToken})`);
            return false;
          }
          currentLeaseExpiresAt = Math.max(currentLeaseExpiresAt, renewStartedAt + leaseDurationMs);
          return true;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          markLeaseLost(`Worker lease renewal error for ${lockName}: ${msg}`);
          return false;
        } finally {
          inFlightRenewal = null;
        }
      })();

      return inFlightRenewal;
    };

    timer = setInterval(() => {
      if (lostLease || stopped) {
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
        return;
      }
      if (Date.now() >= currentLeaseExpiresAt) {
        markLeaseLost(`Worker lease expired locally for ${lockName}`);
        return;
      }
      void renewNow();
    }, intervalMs);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }

    return {
      stop: () => {
        stopped = true;
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
      },
      hasLostLease: () => lostLease || Date.now() >= currentLeaseExpiresAt,
      markLeaseLost,
      renewNow,
      extendLease: (newExpiresAtMs: number) => {
        if (lostLease) return;
        if (Date.now() >= currentLeaseExpiresAt) {
          markLeaseLost(`Worker lease expired before extension for ${lockName}`);
          return;
        }
        currentLeaseExpiresAt = Math.max(currentLeaseExpiresAt, newExpiresAtMs);
      },
    };
  }

  /**
   * Safely releases a worker lease upon task completion or graceful shutdown.
   */
  public static async releaseWorkerLease(
    lockName = RECOVERY_LOCK_NAME,
    ownerId = this.instanceOwnerId,
    fencingToken?: number
  ): Promise<boolean> {
    if (typeof fencingToken !== 'number') {
      return false;
    }
    const filter: Record<string, unknown> = { lockName, ownerId, fencingToken };

    const released = await WorkerLock.findOneAndUpdate(
      filter,
      {
        $set: {
          leaseExpiresAt: new Date(0), // Instantly expire so next worker can acquire immediately
          lastReleasedAt: new Date()
        }
      },
      { returnDocument: 'after' }
    );

    return Boolean(released);
  }

  public static async withRecoveryLeaseFence<T>(
    context: FencedRecoveryContext,
    fn: (session: mongoose.ClientSession) => Promise<T>
  ): Promise<T> {
    const lockName = context.lockName || RECOVERY_LOCK_NAME;
    const ownerId = context.ownerId || RecoveryCoordinatorService.instanceOwnerId;
    const leaseDurationMs = context.leaseDurationMs || DEFAULT_LEASE_DURATION_MS;
    if (typeof context.fencingToken !== 'number' || !Number.isFinite(context.fencingToken) || context.fencingToken < 1) {
      throw new AppError(
        `Invalid fencing token for lock ${lockName}. Owner: ${ownerId}`,
        409,
        'WORKER_LEASE_FENCED_OUT'
      );
    }

    const isStrict = isStrictProductionOrStaging();
    const isOuterSession = Boolean(context.existingSession);

    if (isStrict) {
      if (isOuterSession) {
        if (!context.existingSession?.inTransaction()) {
          throw new AppError(
            `RECOVERY_TRANSACTION_REQUIRED: Active MongoDB transaction is required for fenced recovery in ${process.env.NODE_ENV}.`,
            503,
            'RECOVERY_TRANSACTION_REQUIRED'
          );
        }
      } else if (!isTransactionSupported(mongoose.connection)) {
        throw new AppError(
          `RECOVERY_TRANSACTION_REQUIRED: MongoDB Replica Set or sharded cluster transaction support is required for fenced recovery in ${process.env.NODE_ENV}.`,
          503,
          'RECOVERY_TRANSACTION_REQUIRED'
        );
      }
    }

    let session: mongoose.ClientSession;
    try {
      session = context.existingSession || await mongoose.startSession();
    } catch (sessionErr: unknown) {
      if (isStrict) {
        throw new AppError(
          `RECOVERY_TRANSACTION_STARTUP_FAILED: Could not establish MongoDB session in ${process.env.NODE_ENV}: ${
            sessionErr instanceof Error ? sessionErr.message : String(sessionErr)
          }`,
          503,
          'RECOVERY_TRANSACTION_STARTUP_FAILED'
        );
      }
      throw sessionErr;
    }

    let hasTransaction = isOuterSession ? Boolean(session.inTransaction()) : false;
    let enteredFencedDepth = false;

    try {
      if (!isOuterSession) {
        try {
          session.startTransaction();
          hasTransaction = Boolean(session.inTransaction());
          if (isStrict && !hasTransaction) {
            throw new Error('Session did not enter an active transaction state');
          }
        } catch (txStartErr: any) {
          if (isStrict) {
            throw new AppError(
              `RECOVERY_TRANSACTION_STARTUP_FAILED: Failed to start MongoDB transaction in ${process.env.NODE_ENV}: ${
                txStartErr?.message || String(txStartErr)
              }`,
              503,
              'RECOVERY_TRANSACTION_STARTUP_FAILED'
            );
          }
          const msg = txStartErr?.message || String(txStartErr);
          const isNotReplicaSet =
            msg.includes('replica set') ||
            msg.includes('Transaction numbers are only allowed') ||
            msg.includes('retryable writes') ||
            txStartErr?.code === 20;
          if (!isNotReplicaSet) {
            throw txStartErr;
          }
          hasTransaction = false;
        }
      }

      const activeSession = isOuterSession ? session : (hasTransaction ? session : undefined);
      if (isStrict && (!activeSession || !activeSession.inTransaction())) {
        throw new AppError(
          `RECOVERY_TRANSACTION_REQUIRED: Active MongoDB transaction is required for fenced recovery in ${process.env.NODE_ENV}.`,
          503,
          'RECOVERY_TRANSACTION_REQUIRED'
        );
      }

      RecoveryCoordinatorService.fencedTxDepth += 1;
      enteredFencedDepth = true;
      RecoveryCoordinatorService.isFencedTransactionActive = true;

      const now = new Date();
      const newExpiresAt = new Date(Date.now() + leaseDurationMs);

      const lockTouch = await WorkerLock.findOneAndUpdate(
        {
          lockName,
          ownerId,
          fencingToken: context.fencingToken,
          leaseExpiresAt: { $gt: now }
        },
        {
          $set: { leaseExpiresAt: newExpiresAt }
        },
        { session: activeSession, returnDocument: 'after' }
      );

      if (!lockTouch) {
        throw new AppError(
          `Worker lease fenced out or expired for lock ${lockName}. Owner: ${ownerId}, Token: ${context.fencingToken}`,
          409,
          'WORKER_LEASE_FENCED_OUT'
        );
      }

      const result = await fn(activeSession as mongoose.ClientSession);

      // Verify ownership and lease validity one final time before committing so
      // long-running fenced work cannot commit after lease expiry or takeover.
      const preCommitNow = new Date();
      const preCommitExpiresAt = new Date(Date.now() + leaseDurationMs);
      const preCommitLockTouch = await WorkerLock.findOneAndUpdate(
        {
          lockName,
          ownerId,
          fencingToken: context.fencingToken,
          leaseExpiresAt: { $gt: preCommitNow }
        },
        {
          $set: { leaseExpiresAt: preCommitExpiresAt }
        },
        { session: activeSession, returnDocument: 'after' }
      );

      if (!preCommitLockTouch) {
        throw new AppError(
          `Worker lease fenced out or expired before commit for lock ${lockName}. Owner: ${ownerId}, Token: ${context.fencingToken}`,
          409,
          'WORKER_LEASE_FENCED_OUT'
        );
      }

      if (!isOuterSession && hasTransaction && session.inTransaction()) {
        await session.commitTransaction();
      }
      return result;
    } catch (err: unknown) {
      if (!isOuterSession && hasTransaction && session.inTransaction()) {
        try {
          await session.abortTransaction();
        } catch (abortErr) {
          console.warn('[RECOVERY_COORDINATOR] Transaction abort error:', abortErr);
        }
      }
      const errMessage = err instanceof Error ? err.message : String(err);
      const isNotReplicaSet =
        errMessage.includes('replica set') ||
        errMessage.includes('Transaction numbers are only allowed') ||
        errMessage.includes('retryable writes') ||
        (err && typeof err === 'object' && 'code' in err && (err as any).code === 20);

      if (!isStrict && !isOuterSession && isNotReplicaSet && hasTransaction) {
        // Local development/test standalone MongoDB compatibility only (never in production/staging).
        const now = new Date();
        const newExpiresAt = new Date(Date.now() + leaseDurationMs);
        const fallbackLockTouch = await WorkerLock.findOneAndUpdate(
          {
            lockName,
            ownerId,
            fencingToken: context.fencingToken,
            leaseExpiresAt: { $gt: now }
          },
          {
            $set: { leaseExpiresAt: newExpiresAt }
          },
          { returnDocument: 'after' }
        );
        if (!fallbackLockTouch) {
          throw new AppError(
            `Worker lease fenced out or expired for lock ${lockName}. Owner: ${ownerId}, Token: ${context.fencingToken}`,
            409,
            'WORKER_LEASE_FENCED_OUT'
          );
        }
        return await fn(undefined as any);
      }
      throw err;
    } finally {
      if (enteredFencedDepth) {
        RecoveryCoordinatorService.fencedTxDepth = Math.max(0, RecoveryCoordinatorService.fencedTxDepth - 1);
        RecoveryCoordinatorService.isFencedTransactionActive = RecoveryCoordinatorService.fencedTxDepth > 0;
      }
      if (!isOuterSession) {
        try {
          await session.endSession();
        } catch {}
      }
    }
  }

  /**
   * Replays unacknowledged or failed webhook events from the durable WebhookEvent inbox.
   */
  public static async executeWebhookInboxBatch(
    batchLimit = 20,
    optionsOrToken?: { leaseDurationMs?: number; fenceContext?: FencedRecoveryContext; leaseGuard?: () => Promise<boolean> | boolean } | string
  ): Promise<{ processedCount: number; failedCount: number }> {
    const leaseDurationMs = (typeof optionsOrToken === 'object' && optionsOrToken !== null && 'leaseDurationMs' in optionsOrToken && typeof optionsOrToken.leaseDurationMs === 'number')
      ? optionsOrToken.leaseDurationMs
      : 60_000;
    const fenceContext = (typeof optionsOrToken === 'object' && optionsOrToken !== null && 'fenceContext' in optionsOrToken)
      ? optionsOrToken.fenceContext
      : undefined;
    const leaseGuard = (typeof optionsOrToken === 'object' && optionsOrToken !== null && 'leaseGuard' in optionsOrToken)
      ? optionsOrToken.leaseGuard
      : undefined;
    const now = new Date();
    // Find candidate events that need processing or recovery
    const candidateEvents = await WebhookEvent.find({
      provider: 'RAZORPAY',
      $or: [
        {
          status: 'FAILED',
          processingAttempts: { $lt: 10 },
          $or: [
            { nextRetryAt: { $exists: false } },
            { nextRetryAt: null },
            { nextRetryAt: { $lte: now } }
          ]
        },
        { status: 'PROCESSING', processingLockExpiresAt: { $lt: now } }
      ]
    })
      .sort({ updatedAt: 1, createdAt: 1 })
      .limit(batchLimit);

    let processedCount = 0;
    let failedCount = 0;

    for (const evt of candidateEvents) {
      if (leaseGuard) {
        const valid = await leaseGuard();
        if (!valid) {
          console.warn('[RECOVERY_COORDINATOR] Worker lost lease ownership during webhook inbox batch; aborting remaining inbox processing');
          break;
        }
      }
      const eventLeaseToken = typeof optionsOrToken === 'string'
        ? optionsOrToken
        : `lease_${crypto.randomUUID()}`;

      // Atomically claim event with unique leaseToken and fresh lease expiry
      const nowEvent = new Date();
      const currentLeaseExpiry = new Date(Date.now() + leaseDurationMs);
      const claimed = await WebhookEvent.findOneAndUpdate(
        {
          _id: evt._id,
          status: { $in: ['PROCESSING', 'FAILED'] },
          $or: [
            { status: 'FAILED' },
            { processingLockExpiresAt: { $lt: nowEvent } }
          ]
        },
        {
          $set: {
            status: 'PROCESSING',
            leaseToken: eventLeaseToken,
            processingLockExpiresAt: currentLeaseExpiry
          },
          $inc: { processingAttempts: 1 }
        },
        { returnDocument: 'after' }
      );

      if (!claimed) continue; // Claimed by another concurrent worker
      const heartbeat = startEventLeaseHeartbeat(claimed._id, eventLeaseToken, leaseDurationMs);
      let eventFailedCounted = false;
      const countFailureOnce = () => {
        if (!eventFailedCounted) {
          failedCount++;
          eventFailedCounted = true;
        }
      };

      const runEventProcessing = async (session?: mongoose.ClientSession) => {
        const payload = claimed.payload;
        if (!payload || typeof payload !== 'object') {
          throw new Error('Malformed webhook event: missing or non-object payload');
        }

        const result = await processSupportedWebhookEvent(
          claimed.eventType,
          payload as Record<string, unknown>,
          { session }
        );

        if (heartbeat.hasLostLease()) {
          console.warn(`[RECOVERY_COORDINATOR] Worker lost lease ownership for webhook ${claimed.eventId}; update fenced out.`);
          throw new AppError('Worker lost lease ownership for webhook; update fenced out', 409, 'WEBHOOK_LEASE_LOST');
        }

        if (result.outcome === 'PROCESSED') {
          const updateRes = await WebhookEvent.updateOne(
            {
              _id: claimed._id,
              status: 'PROCESSING',
              leaseToken: eventLeaseToken,
              processingLockExpiresAt: { $gt: new Date() }
            },
            {
              $set: {
                status: 'PROCESSED',
                processedAt: new Date(),
                expiresAt: new Date(Date.now() + 120 * 24 * 60 * 60 * 1000)
              },
              $unset: {
                lastError: 1,
                nextRetryAt: 1
              }
            },
            { session: session || undefined }
          );
          if (updateRes.matchedCount > 0) {
            processedCount++;
          } else {
            console.warn(`[RECOVERY_COORDINATOR] Worker lost lease ownership for webhook ${claimed.eventId}; update to PROCESSED fenced out.`);
            throw new AppError('Worker lost lease ownership for webhook; update to PROCESSED fenced out', 409, 'WEBHOOK_LEASE_LOST');
          }
        } else if (result.outcome === 'IGNORED') {
          const updateRes = await WebhookEvent.updateOne(
            {
              _id: claimed._id,
              status: 'PROCESSING',
              leaseToken: eventLeaseToken,
              processingLockExpiresAt: { $gt: new Date() }
            },
            {
              $set: {
                status: 'IGNORED',
                processedAt: new Date(),
                expiresAt: new Date(Date.now() + 120 * 24 * 60 * 60 * 1000)
              },
              $unset: {
                lastError: 1,
                nextRetryAt: 1
              }
            },
            { session: session || undefined }
          );
          if (updateRes.matchedCount > 0) {
            processedCount++;
          } else {
            console.warn(`[RECOVERY_COORDINATOR] Worker lost lease ownership for webhook ${claimed.eventId}; update to IGNORED fenced out.`);
            throw new AppError('Worker lost lease ownership for webhook; update to IGNORED fenced out', 409, 'WEBHOOK_LEASE_LOST');
          }
        } else {
          // RETRYABLE or RECONCILIATION_REQUIRED
          const attempts = (claimed.processingAttempts || 1);
          const backoffMs = Math.min(3600_000, 10_000 * Math.pow(2, attempts));
          const nextRetryAt = new Date(Date.now() + backoffMs);
          const updateRes = await WebhookEvent.updateOne(
            {
              _id: claimed._id,
              status: 'PROCESSING',
              leaseToken: eventLeaseToken,
              processingLockExpiresAt: { $gt: new Date() }
            },
            {
              $set: {
                status: 'FAILED',
                lastError: result.reason || 'Webhook processing requires reconciliation',
                nextRetryAt,
                processingLockExpiresAt: new Date(0)
              },
              $unset: { expiresAt: 1 }
            },
            { session: session || undefined }
          );
          if (updateRes.matchedCount > 0) {
            countFailureOnce();
          } else {
            console.warn(`[RECOVERY_COORDINATOR] Worker lost lease ownership for webhook ${claimed.eventId}; update to FAILED fenced out.`);
            throw new AppError('Worker lost lease ownership for webhook; update to FAILED fenced out', 409, 'WEBHOOK_LEASE_LOST');
          }
        }
      };

      try {
        if (fenceContext) {
          await RecoveryCoordinatorService.withRecoveryLeaseFence(fenceContext, async (session) => {
            const validEvent = await WebhookEvent.findOne({
              _id: claimed._id,
              status: 'PROCESSING',
              leaseToken: eventLeaseToken,
              processingLockExpiresAt: { $gt: new Date() }
            }).session(session);

            if (!validEvent) {
              throw new AppError('Webhook event lease expired or stolen inside transaction', 409, 'WEBHOOK_LEASE_EXPIRED');
            }

            await runEventProcessing(session);
          });
        } else {
          await runEventProcessing();
        }
      } catch (procErr: unknown) {
        countFailureOnce();
        const errMessage = procErr instanceof Error ? procErr.message : String(procErr);
        const errCode = (procErr && typeof procErr === 'object' && 'code' in procErr)
          ? (procErr as { code?: string }).code
          : undefined;
        console.error(`[RECOVERY_COORDINATOR] Webhook inbox processing error for ${claimed.eventId}: ${errMessage}`);

        const isLeaseLoss =
          errCode === 'WORKER_LEASE_FENCED_OUT' ||
          errCode === 'WEBHOOK_LEASE_LOST' ||
          errCode === 'WEBHOOK_LEASE_EXPIRED' ||
          heartbeat.hasLostLease();

        if (isLeaseLoss) {
          // Coordinator-fence or event-lease loss:
          // Strictly DO NOT update WebhookEvent to FAILED.
          // Preserve original lease-loss error identity and rethrow.
          throw procErr;
        }

        // Genuine processing failure:
        // Record FAILED only through an active, valid fence and an atomic event ownership check.
        try {
          if (fenceContext) {
            await RecoveryCoordinatorService.withRecoveryLeaseFence(fenceContext, async (failSession) => {
              const res = await WebhookEvent.updateOne(
                {
                  _id: claimed._id,
                  status: 'PROCESSING',
                  leaseToken: eventLeaseToken,
                  processingLockExpiresAt: { $gt: new Date() }
                },
                {
                  $set: {
                    status: 'FAILED',
                    lastError: errMessage,
                    processingLockExpiresAt: new Date(0)
                  },
                  $unset: { expiresAt: 1 }
                },
                { session: failSession }
              );
              if (res.matchedCount === 0) {
                console.warn(`[RECOVERY_COORDINATOR] Webhook event lease expired or stolen when recording failure for ${claimed.eventId}`);
              }
            });
          } else {
            await WebhookEvent.updateOne(
              {
                _id: claimed._id,
                status: 'PROCESSING',
                leaseToken: eventLeaseToken,
                processingLockExpiresAt: { $gt: new Date() }
              },
              {
                $set: {
                  status: 'FAILED',
                  lastError: errMessage,
                  processingLockExpiresAt: new Date(0)
                },
                $unset: { expiresAt: 1 }
              }
            );
          }
        } catch (failRecordErr: unknown) {
          const failErrCode = (failRecordErr && typeof failRecordErr === 'object' && 'code' in failRecordErr)
            ? (failRecordErr as { code?: string }).code
            : undefined;
          if (failErrCode === 'WORKER_LEASE_FENCED_OUT') {
            throw failRecordErr;
          }
          console.warn(`[RECOVERY_COORDINATOR] Failed to record failure state for ${claimed.eventId}:`, failRecordErr);
        }
      } finally {
        heartbeat.stop();
      }
    }

    return { processedCount, failedCount };
  }

  /**
   * Executes a single complete, coordinated recovery cycle across inventory, webhooks, and refunds.
   */
  public static executeCoordinatedRecoveryCycle(options: {
    lockName?: string;
    leaseDurationMs?: number;
    batchLimit?: number;
  } = {}): Promise<RecoveryCycleReport> {
    if (this.isShuttingDown) {
      return Promise.resolve({
        executed: false,
        skippedReason: 'SHUTTING_DOWN',
        durationMs: 0,
        inventoryResolvedCount: 0,
        webhookProcessedCount: 0,
        webhookRecoveredCount: 0,
        refundsRecoveredCount: 0,
        errors: []
      });
    }

    // Single-flight protection within the same process
    if (this.isExecutingCycle && this.activeCyclePromise) {
      return Promise.resolve({
        executed: false,
        skippedReason: 'CYCLE_ALREADY_IN_PROGRESS_LOCAL',
        durationMs: 0,
        inventoryResolvedCount: 0,
        webhookProcessedCount: 0,
        webhookRecoveredCount: 0,
        refundsRecoveredCount: 0,
        errors: []
      });
    }

    this.isExecutingCycle = true;
    const promise = this._runRecoveryCycle(options)
      .finally(() => {
        this.isExecutingCycle = false;
        this.activeCyclePromise = null;
      });

    this.activeCyclePromise = promise;
    return promise;
  }

  private static async _runRecoveryCycle(options: {
    lockName?: string;
    leaseDurationMs?: number;
    batchLimit?: number;
  }): Promise<RecoveryCycleReport> {
    const lockName = options.lockName || RECOVERY_LOCK_NAME;
    const leaseDurationMs = options.leaseDurationMs || DEFAULT_LEASE_DURATION_MS;
    const startTime = Date.now();
    const errors: string[] = [];

    // 1. Acquire distributed lease
    const lease = await this.acquireWorkerLease(lockName, this.instanceOwnerId, leaseDurationMs);
    if (!lease.acquired) {
      return {
        executed: false,
        skippedReason: 'LOCKED_BY_ANOTHER_INSTANCE',
        durationMs: Date.now() - startTime,
        inventoryResolvedCount: 0,
        webhookProcessedCount: 0,
        webhookRecoveredCount: 0,
        refundsRecoveredCount: 0,
        errors: []
      };
    }

    let inventoryResolved = 0;
    let webhooksProcessed = 0;
    let webhooksRecovered = 0;
    let refundsRecovered = 0;
    let hasLostLock = false;
    let heartbeat: WorkerLeaseHeartbeat | null = null;

    try {
      if (this.inFlightOperationHook) {
        await this.inFlightOperationHook();
      }

      // Update RecoveryStatus to RUNNING
      await RecoveryStatus.updateOne(
        { identifier: 'SINGLETON' },
        {
          $set: {
            lastRunStartedAt: new Date(),
            status: 'RUNNING',
            executionErrors: []
          }
        },
        { upsert: true }
      );

      if (typeof lease.fencingToken === 'number') {
        heartbeat = RecoveryCoordinatorService.startWorkerLeaseHeartbeat(
          lockName,
          RecoveryCoordinatorService.instanceOwnerId,
          lease.fencingToken,
          leaseDurationMs,
          {
            isTransactionActive: () => RecoveryCoordinatorService.isFencedTransactionActive,
            onLeaseLost: (reason) => {
              hasLostLock = true;
              console.warn(`[RECOVERY_COORDINATOR] ${reason}; aborting cycle`);
            },
          }
        );
      }

      const renewOrAbort = async (stageName: string): Promise<boolean> => {
        if (hasLostLock || heartbeat?.hasLostLease()) {
          hasLostLock = true;
          return false;
        }
        if (typeof lease.fencingToken === 'number') {
          let ok = false;
          try {
            const renewStartedAt = Date.now();
            ok = await this.renewWorkerLease(lockName, this.instanceOwnerId, lease.fencingToken, leaseDurationMs);
            if (ok) {
              heartbeat?.extendLease(renewStartedAt + leaseDurationMs);
            }
          } catch (renewErr: unknown) {
            const errMsg = renewErr instanceof Error ? renewErr.message : String(renewErr);
            hasLostLock = true;
            heartbeat?.markLeaseLost(`Lease renewal threw before ${stageName}: ${errMsg}`);
            const msg = `Distributed coordinator lease renewal error before ${stageName}: ${errMsg}; aborting subsequent cycle execution`;
            errors.push(msg);
            console.error(`[RECOVERY_COORDINATOR] ${msg}`);
            return false;
          }
          if (!ok) {
            hasLostLock = true;
            heartbeat?.markLeaseLost(`Lease lost before ${stageName}`);
            const msg = `Distributed coordinator lease lost before ${stageName}; aborting subsequent cycle execution`;
            errors.push(msg);
            console.error(`[RECOVERY_COORDINATOR] ${msg}`);
            return false;
          }
        }
        return true;
      };
      const checkLeaseGuard = async (): Promise<boolean> => {
        if (hasLostLock || heartbeat?.hasLostLease()) {
          hasLostLock = true;
          return false;
        }
        if (typeof lease.fencingToken === 'number') {
          try {
            const activeLock = await WorkerLock.findOne({
              lockName,
              ownerId: RecoveryCoordinatorService.instanceOwnerId,
              fencingToken: lease.fencingToken,
              leaseExpiresAt: { $gt: new Date() }
            });
            if (!activeLock) {
              hasLostLock = true;
              heartbeat?.markLeaseLost('Lease guard detected missing or expired ownership');
              return false;
            }
          } catch (guardErr: unknown) {
            hasLostLock = true;
            heartbeat?.markLeaseLost(`Lease guard error: ${guardErr instanceof Error ? guardErr.message : String(guardErr)}`);
            return false;
          }
        }
        return true;
      };

      // Task A: Reconcile pending inventory restorations
      const fenceContext: FencedRecoveryContext | undefined = typeof lease.fencingToken === 'number'
        ? {
            fencingToken: lease.fencingToken,
            lockName,
            ownerId: this.instanceOwnerId,
            leaseDurationMs
          }
        : undefined;

      // Task A: Reconcile pending inventory restorations
      if (!hasLostLock && (await renewOrAbort('Task A (inventory)'))) {
        try {
          const invRes = await InventoryAllocationService.reconcilePendingInventoryRestorations({
            withFence: fenceContext
              ? ((fn) => RecoveryCoordinatorService.withRecoveryLeaseFence(fenceContext, fn))
              : undefined,
            leaseGuard: checkLeaseGuard
          });
          inventoryResolved = invRes.resolvedCount;
        } catch (invErr: unknown) {
          const msg = `Inventory recovery error: ${invErr instanceof Error ? invErr.message : String(invErr)}`;
          errors.push(msg);
          console.error(`[RECOVERY_COORDINATOR] ${msg}`);
        }
      }

      // Task B: Webhook inbox stale sweep & batch replay
      if (!hasLostLock && (await renewOrAbort('Task B (webhooks)'))) {
        try {
          if (fenceContext) {
            await RecoveryCoordinatorService.withRecoveryLeaseFence(fenceContext, async (session) => {
              const staleRes = await recoverStaleWebhookEvents(60_000, { session });
              webhooksRecovered = staleRes.recoveredCount;
            });
          }

          const inboxRes = await this.executeWebhookInboxBatch(options.batchLimit || 20, {
            leaseDurationMs,
            fenceContext,
            leaseGuard: checkLeaseGuard
          });
          webhooksProcessed = inboxRes.processedCount;
        } catch (hookErr: unknown) {
          const msg = `Webhook recovery error: ${hookErr instanceof Error ? hookErr.message : String(hookErr)}`;
          errors.push(msg);
          console.error(`[RECOVERY_COORDINATOR] ${msg}`);
        }
      }

      // Task C: Reconcile incomplete refund operations & reservations
      if (!hasLostLock && (await renewOrAbort('Task C (refunds)'))) {
        try {
          const refRes = await reconcileIncompleteRefundOperations({
            fenceContext,
            withFence: fenceContext
              ? ((fn) => RecoveryCoordinatorService.withRecoveryLeaseFence(fenceContext, fn))
              : undefined,
            leaseGuard: checkLeaseGuard
          });
          refundsRecovered = refRes.recoveredCount;
        } catch (refErr: unknown) {
          const msg = `Refund recovery error: ${refErr instanceof Error ? refErr.message : String(refErr)}`;
          errors.push(msg);
          console.error(`[RECOVERY_COORDINATOR] ${msg}`);
        }
      }
      // Task D: Reconcile pending cancellation operations
      let cancellationsRecovered = 0;
      if (!hasLostLock && (await renewOrAbort('Task D (cancellations)'))) {
        try {
          const cancelRes = await reconcilePendingCancellationOperations(undefined, {
            leaseGuard: checkLeaseGuard,
            withFence: fenceContext
              ? ((fn) => RecoveryCoordinatorService.withRecoveryLeaseFence(fenceContext, fn))
              : undefined,
          });
          cancellationsRecovered = cancelRes.recoveredCount;
          if (cancelRes.errors && cancelRes.errors.length > 0) {
            for (const cancelError of cancelRes.errors) {
              errors.push(`Cancellation recovery error: ${cancelError}`);
            }
          }
        } catch (cancelErr: unknown) {
          const msg = `Cancellation recovery error: ${cancelErr instanceof Error ? cancelErr.message : String(cancelErr)}`;
          errors.push(msg);
          console.error(`[RECOVERY_COORDINATOR] ${msg}`);
        }
      }

      // Task E: Expire stale unpaid orders after authoritative gateway verification.
      // Runs inside the same distributed lease so repeated or concurrent cycles can
      // never expire the same order (or release inventory) twice.
      let expiredOrders = 0;
      if (!hasLostLock && (await renewOrAbort('Task E (order expiry)'))) {
        try {
          const expiryRes = await expireStalePendingOrders({
            batchLimit: options.batchLimit || 20,
            leaseGuard: checkLeaseGuard,
            withFence: fenceContext
              ? ((fn) => RecoveryCoordinatorService.withRecoveryLeaseFence(fenceContext, fn))
              : undefined,
          });
          expiredOrders = expiryRes.expired;
          if (expiryRes.errors.length > 0) {
            for (const expiryError of expiryRes.errors) {
              errors.push(`Order expiry error: ${expiryError}`);
            }
          }
        } catch (expiryErr: unknown) {
          const msg = `Order expiry error: ${expiryErr instanceof Error ? expiryErr.message : String(expiryErr)}`;
          errors.push(msg);
          console.error(`[RECOVERY_COORDINATOR] ${msg}`);
        }
      }

      // Task F: Reconcile incomplete order-expiry cleanups
      let expiryCleanupsRecovered = 0;
      if (!hasLostLock && (await renewOrAbort('Task F (expiry cleanups)'))) {
        try {
          const cleanupRes = await reconcilePendingExpiryCleanups({
            batchLimit: options.batchLimit || 20,
            leaseGuard: checkLeaseGuard,
            withFence: fenceContext
              ? ((fn) => RecoveryCoordinatorService.withRecoveryLeaseFence(fenceContext, fn))
              : undefined,
          });
          expiryCleanupsRecovered = cleanupRes.cleanedCount;
          if (cleanupRes.errors.length > 0) {
            for (const cleanupError of cleanupRes.errors) {
              errors.push(`Expiry cleanup error: ${cleanupError}`);
            }
          }
        } catch (cleanupErr: unknown) {
          const msg = `Expiry cleanup recovery error: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`;
          errors.push(msg);
          console.error(`[RECOVERY_COORDINATOR] ${msg}`);
        }
      }

      const durationMs = Date.now() - startTime;
      const finalStatus = hasLostLock
        ? 'ERROR'
        : errors.length === 0
        ? 'SUCCESS'
        : (inventoryResolved + webhooksProcessed + refundsRecovered + cancellationsRecovered + expiredOrders + expiryCleanupsRecovered > 0 ? 'PARTIAL' : 'ERROR');

      if (!hasLostLock) {
        await RecoveryStatus.updateOne(
          { identifier: 'SINGLETON' },
          {
            $set: {
              lastRunCompletedAt: new Date(),
              durationMs,
              status: finalStatus,
              inventoryResolvedCount: inventoryResolved,
              webhookProcessedCount: webhooksProcessed,
              webhookRecoveredCount: webhooksRecovered,
              refundsRecoveredCount: refundsRecovered,
              cancellationsRecoveredCount: cancellationsRecovered,
              expiredOrdersCount: expiredOrders,
              executionErrors: errors
            }
          }
        );
      }

      return {
        executed: !hasLostLock,
        ownerId: this.instanceOwnerId,
        fencingToken: lease.fencingToken,
        durationMs,
        inventoryResolvedCount: inventoryResolved,
        webhookProcessedCount: webhooksProcessed,
        webhookRecoveredCount: webhooksRecovered,
        refundsRecoveredCount: refundsRecovered,
        cancellationsRecoveredCount: cancellationsRecovered,
        expiredOrdersCount: expiredOrders,
        expiryCleanupsRecoveredCount: expiryCleanupsRecovered,
        errors
      };
    } finally {
      if (heartbeat) {
        heartbeat.stop();
        heartbeat = null;
      }
      this.isExecutingCycle = false;
      if (!hasLostLock && typeof lease.fencingToken === 'number') {
        await this.releaseWorkerLease(lockName, this.instanceOwnerId, lease.fencingToken);
      }
    }
  }

  /**
   * Starts periodic recovery scheduler if running in an active server/worker context.
   */
  public static startRecoveryScheduler(intervalMs = DEFAULT_SCHEDULER_INTERVAL_MS): void {
    if (this.schedulerTimer) return;
    if (process.env.NODE_ENV === 'test') return;

    const isServerlessHost = Boolean(
      process.env.VERCEL ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.NETLIFY ||
      process.env.CF_PAGES
    );
    if (isServerlessHost) {
      console.warn(
        '[RECOVERY_SCHEDULER] Serverless host detected. The in-process scheduler is frozen between requests and will not reliably recover stuck payments/refunds. Embedded scheduler not started; set DISABLE_EMBEDDED_RECOVERY=true and schedule GET /api/ops/recovery/run externally.'
      );
      return;
    }

    console.log(`[RECOVERY_SCHEDULER] Starting periodic recovery scheduler (interval: ${intervalMs}ms, workerId: ${this.instanceOwnerId})`);

    const run = async () => {
      try {
        const cyclePromise = this.executeCoordinatedRecoveryCycle();
        this.trackBackgroundTask(cyclePromise);
        const res = await cyclePromise;
        if (res.executed) {
          console.log(
            `[RECOVERY_SCHEDULER] Completed cycle in ${res.durationMs}ms: ` +
            `inventory=${res.inventoryResolvedCount}, webhooksProcessed=${res.webhookProcessedCount}, ` +
            `webhooksRecovered=${res.webhookRecoveredCount}, refunds=${res.refundsRecoveredCount}, ` +
            `cancellations=${res.cancellationsRecoveredCount || 0}`
          );
        }
      } catch (err: unknown) {
        console.error('[RECOVERY_SCHEDULER] Unhandled error during scheduled cycle:', err);
      }
    };

    // Initial run 5 seconds after startup
    this.initialSchedulerTimer = setTimeout(() => {
      this.initialSchedulerTimer = null;
      run();
    }, 5000);
    this.initialSchedulerTimer.unref();

    this.schedulerTimer = setInterval(run, intervalMs);
    this.schedulerTimer.unref();
  }

  public static stopRecoveryScheduler(): void {
    this.isShuttingDown = true;
    if (this.initialSchedulerTimer) {
      clearTimeout(this.initialSchedulerTimer);
      this.initialSchedulerTimer = null;
    }
    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
  }

  /**
   * Live operational metrics for admin monitoring.
   */
  public static async getRecoverySystemMetrics(): Promise<RecoverySystemMetrics> {
    const now = new Date();

    const [
      pendingInventoryCount,
      staleWebhookCount,
      failedWebhookCount,
      incompleteRefundsCount,
      unknownRefundsCount,
      pendingReservationsCount,
      pendingCancellationsCount,
      statusDoc,
    ] = await Promise.all([
      InventoryTransaction.countDocuments({ type: 'RETURN', status: 'PENDING' }),
      WebhookEvent.countDocuments({ status: 'PROCESSING', processingLockExpiresAt: { $lt: now } }),
      WebhookEvent.countDocuments({ status: 'FAILED' }),
      ReturnRequest.countDocuments({ refundStatus: 'PROCESSING', refundId: null }),
      Refund.countDocuments({ status: 'UNKNOWN' }),
      Payment.countDocuments({ 'refundReservations.status': 'PENDING' }),
      Order.countDocuments({ 'cancellationOperations.status': 'PENDING' }),
      RecoveryStatus.findOne({ identifier: 'SINGLETON' }),
    ]);

    return {
      pendingInventoryCount,
      staleWebhookCount,
      failedWebhookCount,
      incompleteRefundsCount,
      unknownRefundsCount,
      pendingReservationsCount,
      pendingCancellationsCount,
      lastExecution: statusDoc
        ? {
            startedAt: statusDoc.lastRunStartedAt,
            completedAt: statusDoc.lastRunCompletedAt,
            durationMs: statusDoc.durationMs,
            status: statusDoc.status,
            errors: statusDoc.executionErrors || [],
          }
        : undefined,
    };
  }
}
