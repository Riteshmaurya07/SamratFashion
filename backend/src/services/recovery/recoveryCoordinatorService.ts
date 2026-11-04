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
import { InventoryAllocationService } from '../inventory/inventoryAllocationService';
import {
  recoverStaleWebhookEvents,
  processSupportedWebhookEvent,
} from '../../controllers/webhookController';
import { reconcileIncompleteRefundOperations } from '../payment/refundService';

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
  errors: string[];
}
export interface FencedRecoveryContext {
  fencingToken: number;
  lockName?: string;
  ownerId?: string;
  leaseDurationMs?: number;
  existingSession?: mongoose.ClientSession | null;
}

export interface RecoverySystemMetrics {
  pendingInventoryCount: number;
  staleWebhookCount: number;
  failedWebhookCount: number;
  incompleteRefundsCount: number;
  unknownRefundsCount: number;
  pendingReservationsCount: number;
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
    extensionMs = DEFAULT_LEASE_DURATION_MS
  ): Promise<boolean> {
    const now = new Date();
    const newExpiresAt = new Date(Date.now() + extensionMs);

    const renewed = await WorkerLock.findOneAndUpdate(
      {
        lockName,
        ownerId,
        fencingToken,
        leaseExpiresAt: { $gte: now }
      },
      {
        $set: { leaseExpiresAt: newExpiresAt }
      },
      { returnDocument: 'after' }
    );

    return Boolean(renewed);
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
    const isOuterSession = Boolean(context.existingSession);
    const session = context.existingSession || await mongoose.startSession();

    if (!isOuterSession) {
      session.startTransaction();
    }

    RecoveryCoordinatorService.isFencedTransactionActive = true;

    try {
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
        { session, returnDocument: 'after' }
      );

      if (!lockTouch) {
        throw new AppError(
          `Worker lease fenced out or expired for lock ${lockName}. Owner: ${ownerId}, Token: ${context.fencingToken}`,
          409,
          'WORKER_LEASE_FENCED_OUT'
        );
      }

      const result = await fn(session);

      if (!isOuterSession) {
        await session.commitTransaction();
      }
      return result;
    } catch (err: unknown) {
      if (!isOuterSession && session.inTransaction()) {
        try {
          await session.abortTransaction();
        } catch (abortErr) {
          console.warn('[RECOVERY_COORDINATOR] Transaction abort error:', abortErr);
        }
      }
      throw err;
    } finally {
      RecoveryCoordinatorService.isFencedTransactionActive = false;
      if (!isOuterSession) {
        await session.endSession();
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
                expiresAt: new Date(Date.now() + 120 * 24 * 60 * 60 * 1000),
                lastError: undefined
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
    let heartbeatTimer: NodeJS.Timeout | null = null;

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
        const heartbeatIntervalMs = Math.max(5000, Math.floor(leaseDurationMs / 3));
        heartbeatTimer = setInterval(async () => {
          if (RecoveryCoordinatorService.isFencedTransactionActive) {
            return;
          }
          const renewed = await RecoveryCoordinatorService.renewWorkerLease(
            lockName,
            RecoveryCoordinatorService.instanceOwnerId,
            lease.fencingToken!,
            leaseDurationMs
          );
          if (!renewed) {
            hasLostLock = true;
            console.warn(`[RECOVERY_COORDINATOR] Worker lost lease ownership during continuous heartbeat; aborting cycle`);
            if (heartbeatTimer) clearInterval(heartbeatTimer);
          }
        }, heartbeatIntervalMs);
        heartbeatTimer.unref();
      }

      const renewOrAbort = async (stageName: string): Promise<boolean> => {
        if (hasLostLock) return false;
        if (typeof lease.fencingToken === 'number') {
          const ok = await this.renewWorkerLease(lockName, this.instanceOwnerId, lease.fencingToken, leaseDurationMs);
          if (!ok) {
            hasLostLock = true;
            const msg = `Distributed coordinator lease lost before ${stageName}; aborting subsequent cycle execution`;
            errors.push(msg);
            console.error(`[RECOVERY_COORDINATOR] ${msg}`);
            return false;
          }
        }
        return true;
      };
      const checkLeaseGuard = async (): Promise<boolean> => {
        if (hasLostLock) return false;
        if (typeof lease.fencingToken === 'number') {
          const activeLock = await WorkerLock.findOne({
            lockName,
            ownerId: RecoveryCoordinatorService.instanceOwnerId,
            fencingToken: lease.fencingToken,
            leaseExpiresAt: { $gt: new Date() }
          });
          if (!activeLock) {
            hasLostLock = true;
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
      const durationMs = Date.now() - startTime;
      const finalStatus = hasLostLock
        ? 'ERROR'
        : errors.length === 0
        ? 'SUCCESS'
        : (inventoryResolved + webhooksProcessed + refundsRecovered > 0 ? 'PARTIAL' : 'ERROR');

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
        errors
      };
    } finally {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
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
            `webhooksRecovered=${res.webhookRecoveredCount}, refunds=${res.refundsRecoveredCount}`
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
      statusDoc,
    ] = await Promise.all([
      InventoryTransaction.countDocuments({ type: 'RETURN', status: 'PENDING' }),
      WebhookEvent.countDocuments({ status: 'PROCESSING', processingLockExpiresAt: { $lt: now } }),
      WebhookEvent.countDocuments({ status: 'FAILED' }),
      ReturnRequest.countDocuments({ refundStatus: 'PROCESSING', refundId: null }),
      Refund.countDocuments({ status: 'UNKNOWN' }),
      Payment.countDocuments({ 'refundReservations.status': 'PENDING' }),
      RecoveryStatus.findOne({ identifier: 'SINGLETON' }),
    ]);

    return {
      pendingInventoryCount,
      staleWebhookCount,
      failedWebhookCount,
      incompleteRefundsCount,
      unknownRefundsCount,
      pendingReservationsCount,
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
