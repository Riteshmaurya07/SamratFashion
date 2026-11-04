/**
 * SamratFashion — Dedicated Background Recovery Worker Process
 *
 * Runs scheduled background recovery tasks independently of HTTP web traffic:
 * - Distributed lease-guarded recovery coordination
 * - Pending inventory restorations
 * - Webhook inbox execution and crash recovery
 * - Refund operation and reservation reconciliation
 * - Graceful shutdown and lease release on SIGTERM / SIGINT
 */

import dotenv from 'dotenv';
import path from 'path';
dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { connectDB, disconnectDB } from './config/db';
import { validateMandatorySecrets, validateProductionEnv } from './config/env';
import { RecoveryCoordinatorService } from './services/recovery/recoveryCoordinatorService';

validateMandatorySecrets();
validateProductionEnv();

async function startWorkerProcess(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║   SamratFashion — Dedicated Recovery Worker Process Starting         ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

  await connectDB();

  const intervalMs = Number(process.env.RECOVERY_WORKER_INTERVAL_MS) || 30_000;
  RecoveryCoordinatorService.startRecoveryScheduler(intervalMs);

  process.on('SIGTERM', async () => {
    const ok = await handleWorkerShutdown('SIGTERM');
    if (process.env.NODE_ENV !== 'test') {
      process.exit(ok ? 0 : 1);
    }
  });
  process.on('SIGINT', async () => {
    const ok = await handleWorkerShutdown('SIGINT');
    if (process.env.NODE_ENV !== 'test') {
      process.exit(ok ? 0 : 1);
    }
  });
}

let isWorkerShuttingDown = false;

export const handleWorkerShutdown = async (signal: string): Promise<boolean> => {
  if (isWorkerShuttingDown) {
    console.log(`\n[WORKER] Shutdown already in progress. Ignoring duplicate ${signal}.`);
    return false;
  }
  isWorkerShuttingDown = true;
  console.log(`\n[WORKER] Received ${signal}. Initiating worker shutdown...`);

  // 1. Stop scheduler and cancel pending initial startup timers
  RecoveryCoordinatorService.stopRecoveryScheduler();

  // 2. Drain active recovery cycle and background tasks before disconnecting MongoDB
  const drainResult = await RecoveryCoordinatorService.drainAndShutdown({
    drainTimeoutMs: 15000,
    disconnectDbFn: disconnectDB
  });

  if (!drainResult.drained) {
    console.error(`[WORKER] Incomplete drain: ${drainResult.message}`);
    return false;
  }

  console.log('[WORKER] Graceful shutdown complete.');
  return true;
};

if (process.env.NODE_ENV !== 'test') {
  startWorkerProcess().catch((err) => {
    console.error('FATAL: Recovery worker failed to start:', err);
    process.exit(1);
  });
}

export { startWorkerProcess };
