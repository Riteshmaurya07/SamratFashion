/**
 * Refund Index Migration & Preflight Script
 *
 * Phase A.2.2.1 — Safe, non-destructive migration of Refund indexes:
 * 1. Replaces old `uniq_active_return_refund` partial index (which included PROCESSED)
 *    with a corrected partial index that constrains ONLY active in-flight attempts:
 *    { returnId: 1 } with status in ['PENDING', 'PROCESSING', 'UNKNOWN'].
 *    This allows late provider-confirmed successes on older attempts (e.g. Attempt A)
 *    to be recorded even while Attempt B is active (Blocker B2).
 * 2. Preflight scans for duplicate idempotency keys or attempt number collisions.
 * 3. Strict CLI safety: dry-run by default, requires explicit --execute, fails closed on invalid flags.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env') });

export interface RefundIndexPreflightResult {
  totalRefunds: number;
  duplicateIdempotencyKeys: number;
  duplicateReturnAttempts: number;
  existingIndexes: string[];
  hasOldActiveIndexWithProcessed: boolean;
  canProceed: boolean;
  blockers: string[];
}

export interface RefundIndexMigrationResult {
  success: boolean;
  dryRun: boolean;
  preflight: RefundIndexPreflightResult;
  droppedOldIndex: boolean;
  createdNewIndex: boolean;
  postMigrationIndexes: string[];
  message: string;
}

export async function preflightRefundIndexMigration(
  connection: mongoose.Connection
): Promise<RefundIndexPreflightResult> {
  const coll = connection.collection('refunds');
  const blockers: string[] = [];

  const collections = await connection.db!.listCollections({ name: 'refunds' }).toArray();
  if (collections.length === 0) {
    return {
      totalRefunds: 0,
      duplicateIdempotencyKeys: 0,
      duplicateReturnAttempts: 0,
      existingIndexes: [],
      hasOldActiveIndexWithProcessed: false,
      canProceed: true,
      blockers: []
    };
  }

  const existingRaw = await coll.indexes();
  const existingIndexes = existingRaw.map(i => i.name || '');

  const oldActiveIdx = existingRaw.find(i => i.name === 'uniq_active_return_refund');
  let hasOldActiveIndexWithProcessed = false;
  if (oldActiveIdx) {
    const filterExp = oldActiveIdx.partialFilterExpression as Record<string, any> | undefined;
    const statusIn = filterExp?.status?.$in;
    if (Array.isArray(statusIn) && statusIn.includes('PROCESSED')) {
      hasOldActiveIndexWithProcessed = true;
    }
  }

  const totalRefunds = await coll.countDocuments({});

  // Scan duplicate idempotency keys
  const idempDups = await coll.aggregate([
    { $match: { idempotencyKey: { $exists: true, $ne: null } } },
    { $group: { _id: '$idempotencyKey', count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } }
  ]).toArray();

  if (idempDups.length > 0) {
    blockers.push(`Found ${idempDups.length} duplicate idempotency key collisions`);
  }

  // Scan duplicate returnId + attemptNumber
  const returnAttemptDups = await coll.aggregate([
    { $match: { returnId: { $exists: true, $ne: null } } },
    { $group: { _id: { returnId: '$returnId', attemptNumber: '$attemptNumber' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } }
  ]).toArray();

  if (returnAttemptDups.length > 0) {
    blockers.push(`Found ${returnAttemptDups.length} duplicate returnId + attemptNumber collisions`);
  }

  return {
    totalRefunds,
    duplicateIdempotencyKeys: idempDups.length,
    duplicateReturnAttempts: returnAttemptDups.length,
    existingIndexes,
    hasOldActiveIndexWithProcessed,
    canProceed: blockers.length === 0,
    blockers
  };
}

export async function runRefundIndexMigration(options: {
  dryRun?: boolean;
  connection?: mongoose.Connection;
} = {}): Promise<RefundIndexMigrationResult> {
  const dryRun = options.dryRun !== false; // Dry-run by default!
  const conn = options.connection ?? mongoose.connection;
  const coll = conn.collection('refunds');

  const preflight = await preflightRefundIndexMigration(conn);

  if (!preflight.canProceed) {
    return {
      success: false,
      dryRun,
      preflight,
      droppedOldIndex: false,
      createdNewIndex: false,
      postMigrationIndexes: preflight.existingIndexes,
      message: `Preflight failed with blockers:\n - ${preflight.blockers.join('\n - ')}`
    };
  }

  if (dryRun) {
    return {
      success: true,
      dryRun: true,
      preflight,
      droppedOldIndex: false,
      createdNewIndex: false,
      postMigrationIndexes: preflight.existingIndexes,
      message: 'Dry run completed successfully. No changes were made.'
    };
  }

  let droppedOldIndex = false;
  if (preflight.hasOldActiveIndexWithProcessed) {
    console.log('[REFUND INDEX MIGRATION] Dropping old uniq_active_return_refund containing PROCESSED...');
    await coll.dropIndex('uniq_active_return_refund');
    droppedOldIndex = true;
  }

  console.log('[REFUND INDEX MIGRATION] Creating corrected uniq_active_return_refund (excluding PROCESSED)...');
  await coll.createIndex(
    { returnId: 1 },
    {
      unique: true,
      name: 'uniq_active_return_refund',
      partialFilterExpression: {
        returnId: { $exists: true },
        status: { $in: ['PENDING', 'PROCESSING', 'UNKNOWN'] }
      },
      background: true
    }
  );

  // Postflight verification
  const postIndexesRaw = await coll.indexes();
  const postMigrationIndexes = postIndexesRaw.map(i => i.name || '');

  const newIdx = postIndexesRaw.find(i => i.name === 'uniq_active_return_refund');
  const newStatusIn = (newIdx?.partialFilterExpression as any)?.status?.$in;
  const isPostflightValid = Array.isArray(newStatusIn) &&
    !newStatusIn.includes('PROCESSED') &&
    newStatusIn.includes('PENDING') &&
    newStatusIn.includes('PROCESSING') &&
    newStatusIn.includes('UNKNOWN');

  if (!isPostflightValid) {
    throw new Error('Postflight verification failed: uniq_active_return_refund does not have the expected partialFilterExpression');
  }

  return {
    success: true,
    dryRun: false,
    preflight,
    droppedOldIndex,
    createdNewIndex: true,
    postMigrationIndexes,
    message: 'Refund index migration completed successfully.'
  };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const hasExecute = args.includes('--execute');
  const hasDryRun = args.includes('--dry-run');
  const unknownFlags = args.filter(a => a !== '--execute' && a !== '--dry-run');

  if (unknownFlags.length > 0) {
    console.error(`ERROR: Unknown CLI flag(s): ${unknownFlags.join(', ')}. Failing closed.`);
    process.exit(1);
  }

  if (hasExecute && hasDryRun) {
    console.error('ERROR: Conflicting flags --execute and --dry-run cannot be used together. Failing closed.');
    process.exit(1);
  }

  const isExecute = hasExecute && !hasDryRun;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI environment variable is required to run migration.');
    process.exit(1);
  }

  mongoose.connect(uri)
    .then(async (conn) => {
      console.log(`[REFUND INDEX MIGRATION] Connected to DB: ${conn.connection.name}`);
      console.log(`[REFUND INDEX MIGRATION] Mode: ${isExecute ? 'EXECUTE' : 'DRY RUN'}`);
      const res = await runRefundIndexMigration({ dryRun: !isExecute, connection: conn.connection });
      console.log(res.message);
      await mongoose.disconnect();
      process.exit(res.success ? 0 : 1);
    })
    .catch((err) => {
      console.error('[REFUND INDEX MIGRATION] Fatal error:', err);
      process.exit(1);
    });
}
