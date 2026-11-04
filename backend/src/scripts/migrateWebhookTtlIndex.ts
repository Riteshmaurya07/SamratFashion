/**
 * Webhook Event TTL Index Migration Script
 *
 * Phase A.2.1 — Safe, non-destructive migration of WebhookEvent TTL indexes:
 *
 * BACKGROUND:
 * Previously, the database declared a 120-day TTL index on { createdAt: 1 }:
 *   { createdAt: 1 }, { expireAfterSeconds: 10368000 }
 * This was DESTRUCTIVE for recovered events:
 * - A 150-day-old FAILED event that is recovered today has an old createdAt (150 days ago).
 * - Even if recovery assigns a fresh 120-day retention window in expiresAt, MongoDB's
 *   background TTL monitor (running every 60s) would still match createdAt and delete
 *   the event immediately.
 * - In addition, any unresolved FAILED or PROCESSING events older than 120 days would be
 *   silently deleted before recovery could ever process them.
 *
 * NEW INDEX DEFINITION:
 *   { expiresAt: 1 }, { expireAfterSeconds: 0, sparse: true }
 *
 * MIGRATION SAFETY RULES & SAFE SEQUENCE:
 * 1. STOP DESTRUCTIVE TTL DELETIONS FIRST: Drop the old createdAt TTL index first.
 *    Leaving the old TTL index active risks background deletion during backfill.
 *    It is acceptable for terminal events to remain longer than intended if new TTL index
 *    creation fails. Never sacrifice unresolved history to maintain cleanup automation.
 * 2. PRESERVE UNRESOLVED RECORDS: Never backfill expiresAt for unresolved (FAILED or PROCESSING) events.
 * 3. RETENTION DATING FOR TERMINAL RECORDS: For old PROCESSED or IGNORED events without expiresAt,
 *    assign expiresAt based on processedAt + 120 days (or updatedAt + 120 days).
 * 4. CREATE NEW SPARSE TTL INDEX: Build { expiresAt: 1 } with { expireAfterSeconds: 0, sparse: true }.
 * 5. SAFE RE-RUNS: Script is fully idempotent. If old index is already gone, skip drop.
 *    If new index already exists with correct options, skip creation.
 * 6. DRY RUN BY DEFAULT: Requires explicit --execute flag or { dryRun: false } to perform writes.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env') });

export interface WebhookIndexMigrationPreflightResult {
  totalEvents: number;
  terminalCount: number;
  unresolvedCount: number;
  processedCount: number;
  ignoredCount: number;
  failedCount: number;
  processingCount: number;
  terminalMissingExpiresAt: number;
  unresolvedWithExpiresAt: number;
  existingIndexes: Array<{
    name: string;
    key: Record<string, unknown>;
    expireAfterSeconds?: number;
    sparse?: boolean;
    unique?: boolean;
  }>;
  oldCreatedAtTtlIndexName: string | null;
  hasOldCreatedAtTtl: boolean;
  newExpiresAtTtlIndexName: string | null;
  hasNewExpiresAtTtl: boolean;
  canProceed: boolean;
  blockers: string[];
  recommendedSteps: string[];
}

export interface WebhookIndexMigrationResult {
  success: boolean;
  dryRun: boolean;
  droppedOldIndex: string | null;
  createdNewIndex: string | null;
  terminalBackfilledCount: number;
  unresolvedCleanedCount: number;
  postMigrationIndexes: string[];
  errors: string[];
}

export async function preflightWebhookIndexMigration(
  connection: mongoose.Connection
): Promise<WebhookIndexMigrationPreflightResult> {
  const coll = connection.collection('webhookevents');
  const blockers: string[] = [];

  const collections = await connection.db!.listCollections({ name: 'webhookevents' }).toArray();
  if (collections.length === 0) {
    return {
      totalEvents: 0,
      terminalCount: 0,
      unresolvedCount: 0,
      processedCount: 0,
      ignoredCount: 0,
      failedCount: 0,
      processingCount: 0,
      terminalMissingExpiresAt: 0,
      unresolvedWithExpiresAt: 0,
      existingIndexes: [],
      oldCreatedAtTtlIndexName: null,
      hasOldCreatedAtTtl: false,
      newExpiresAtTtlIndexName: null,
      hasNewExpiresAtTtl: false,
      canProceed: true,
      blockers: [],
      recommendedSteps: ['Collection does not exist yet; no migration needed.']
    };
  }

  const rawIndexes = await coll.indexes();
  const existingIndexes = rawIndexes.map(idx => ({
    name: idx.name || '',
    key: idx.key as Record<string, unknown>,
    expireAfterSeconds: typeof idx.expireAfterSeconds === 'number' ? idx.expireAfterSeconds : undefined,
    sparse: Boolean(idx.sparse),
    unique: Boolean(idx.unique)
  }));

  // Identify old destructive createdAt TTL index
  let oldCreatedAtTtlIndexName: string | null = null;
  for (const idx of existingIndexes) {
    if (idx.key.createdAt !== undefined && typeof idx.expireAfterSeconds === 'number') {
      oldCreatedAtTtlIndexName = idx.name;
      break;
    }
  }

  // Identify new safe expiresAt sparse TTL index
  let newExpiresAtTtlIndexName: string | null = null;
  let newExpiresAtHasCorrectOpts = false;
  for (const idx of existingIndexes) {
    if (idx.key.expiresAt !== undefined && typeof idx.expireAfterSeconds === 'number') {
      newExpiresAtTtlIndexName = idx.name;
      if (idx.expireAfterSeconds === 0 && idx.sparse === true) {
        newExpiresAtHasCorrectOpts = true;
      } else {
        blockers.push(
          `Index ${idx.name} on expiresAt has unexpected options (expireAfterSeconds=${idx.expireAfterSeconds}, sparse=${idx.sparse}). Expected expireAfterSeconds=0, sparse=true.`
        );
      }
      break;
    }
  }

  const [
    totalEvents,
    processedCount,
    ignoredCount,
    failedCount,
    processingCount,
    terminalMissingExpiresAt,
    unresolvedWithExpiresAt
  ] = await Promise.all([
    coll.countDocuments({}),
    coll.countDocuments({ status: 'PROCESSED' }),
    coll.countDocuments({ status: 'IGNORED' }),
    coll.countDocuments({ status: 'FAILED' }),
    coll.countDocuments({ status: 'PROCESSING' }),
    coll.countDocuments({
      status: { $in: ['PROCESSED', 'IGNORED'] },
      $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }]
    }),
    coll.countDocuments({
      status: { $in: ['FAILED', 'PROCESSING'] },
      expiresAt: { $exists: true, $ne: null }
    })
  ]);

  const terminalCount = processedCount + ignoredCount;
  const unresolvedCount = failedCount + processingCount;

  const recommendedSteps: string[] = [];
  if (oldCreatedAtTtlIndexName) {
    recommendedSteps.push(`1. Drop obsolete destructive TTL index: "${oldCreatedAtTtlIndexName}"`);
  } else {
    recommendedSteps.push('1. Old createdAt TTL index already absent (no drop needed).');
  }

  if (terminalMissingExpiresAt > 0) {
    recommendedSteps.push(`2. Backfill expiresAt (+120d retention) on ${terminalMissingExpiresAt} terminal records missing expiresAt.`);
  } else {
    recommendedSteps.push('2. All terminal records have valid expiresAt assigned.');
  }

  if (unresolvedWithExpiresAt > 0) {
    recommendedSteps.push(`3. Unset expiresAt on ${unresolvedWithExpiresAt} unresolved records (unresolved events must never expire).`);
  } else {
    recommendedSteps.push('3. All unresolved records correctly lack expiresAt.');
  }

  if (!newExpiresAtTtlIndexName) {
    recommendedSteps.push('4. Create safe sparse TTL index { expiresAt: 1 } with expireAfterSeconds=0, sparse=true.');
  } else if (newExpiresAtHasCorrectOpts) {
    recommendedSteps.push(`4. Safe sparse TTL index "${newExpiresAtTtlIndexName}" is already present and correctly configured.`);
  }

  return {
    totalEvents,
    terminalCount,
    unresolvedCount,
    processedCount,
    ignoredCount,
    failedCount,
    processingCount,
    terminalMissingExpiresAt,
    unresolvedWithExpiresAt,
    existingIndexes,
    oldCreatedAtTtlIndexName,
    hasOldCreatedAtTtl: Boolean(oldCreatedAtTtlIndexName),
    newExpiresAtTtlIndexName,
    hasNewExpiresAtTtl: Boolean(newExpiresAtTtlIndexName && newExpiresAtHasCorrectOpts),
    canProceed: blockers.length === 0,
    blockers,
    recommendedSteps
  };
}

export async function runWebhookIndexMigration(options: {
  dryRun?: boolean;
  connection?: mongoose.Connection;
} = {}): Promise<WebhookIndexMigrationResult> {
  const dryRun = options.dryRun ?? true;
  const conn = options.connection ?? mongoose.connection;
  const coll = conn.collection('webhookevents');
  const errors: string[] = [];

  const preflight = await preflightWebhookIndexMigration(conn);
  if (!preflight.canProceed) {
    return {
      success: false,
      dryRun,
      droppedOldIndex: null,
      createdNewIndex: null,
      terminalBackfilledCount: 0,
      unresolvedCleanedCount: 0,
      postMigrationIndexes: preflight.existingIndexes.map(i => i.name),
      errors: preflight.blockers
    };
  }

  let droppedOldIndex: string | null = null;
  let createdNewIndex: string | null = null;
  let terminalBackfilledCount = 0;
  let unresolvedCleanedCount = 0;

  if (dryRun) {
    console.log('[TTL MIGRATION] Dry-run completed. No modifications made.');
    return {
      success: true,
      dryRun: true,
      droppedOldIndex: preflight.oldCreatedAtTtlIndexName,
      createdNewIndex: preflight.hasNewExpiresAtTtl ? null : 'expiresAt_1',
      terminalBackfilledCount: preflight.terminalMissingExpiresAt,
      unresolvedCleanedCount: preflight.unresolvedWithExpiresAt,
      postMigrationIndexes: preflight.existingIndexes.map(i => i.name),
      errors: []
    };
  }

  // STEP 1: Safe sequence priority #1 — Drop old destructive createdAt TTL index
  if (preflight.oldCreatedAtTtlIndexName) {
    try {
      console.log(`[TTL MIGRATION] Dropping obsolete destructive TTL index: "${preflight.oldCreatedAtTtlIndexName}"...`);
      await coll.dropIndex(preflight.oldCreatedAtTtlIndexName);
      droppedOldIndex = preflight.oldCreatedAtTtlIndexName;
      console.log(`[TTL MIGRATION] Successfully dropped index: "${preflight.oldCreatedAtTtlIndexName}".`);
    } catch (err: unknown) {
      const msg = `Failed to drop obsolete index ${preflight.oldCreatedAtTtlIndexName}: ${err instanceof Error ? err.message : String(err)}`;
      errors.push(msg);
      console.error(`[TTL MIGRATION] ${msg}`);
      return {
        success: false,
        dryRun: false,
        droppedOldIndex: null,
        createdNewIndex: null,
        terminalBackfilledCount: 0,
        unresolvedCleanedCount: 0,
        postMigrationIndexes: [],
        errors
      };
    }
  }

  // STEP 2: Backfill retention dates for old terminal events missing expiresAt
  if (preflight.terminalMissingExpiresAt > 0) {
    console.log(`[TTL MIGRATION] Backfilling retention dates for ${preflight.terminalMissingExpiresAt} terminal records...`);
    // Retention window = 120 days from terminal processing time (or now if legacy)
    const now = Date.now();
    const DEFAULT_RETENTION_MS = 120 * 24 * 60 * 60 * 1000;

    // Use cursor for memory-safe batching
    const cursor = coll.find({
      status: { $in: ['PROCESSED', 'IGNORED'] },
      $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }]
    });

    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      if (!doc) continue;
      const baseTime = (doc.processedAt instanceof Date ? doc.processedAt.getTime() : null)
        || (doc.updatedAt instanceof Date ? doc.updatedAt.getTime() : now);
      const computedExpiry = new Date(baseTime + DEFAULT_RETENTION_MS);

      await coll.updateOne(
        { _id: doc._id },
        { $set: { expiresAt: computedExpiry } }
      );
      terminalBackfilledCount++;
    }
    console.log(`[TTL MIGRATION] Backfilled expiresAt on ${terminalBackfilledCount} terminal records.`);
  }

  // STEP 3: Guard unresolved events — strictly unset expiresAt on any unresolved records
  if (preflight.unresolvedWithExpiresAt > 0) {
    console.log(`[TTL MIGRATION] Cleaning expiresAt from ${preflight.unresolvedWithExpiresAt} unresolved records...`);
    const unsetRes = await coll.updateMany(
      {
        status: { $in: ['FAILED', 'PROCESSING'] },
        expiresAt: { $exists: true, $ne: null }
      },
      { $unset: { expiresAt: 1 } }
    );
    unresolvedCleanedCount = unsetRes.modifiedCount;
    console.log(`[TTL MIGRATION] Removed expiresAt from ${unresolvedCleanedCount} unresolved records.`);
  }

  // STEP 4: Create new safe sparse TTL index on { expiresAt: 1 }
  if (!preflight.hasNewExpiresAtTtl) {
    try {
      console.log('[TTL MIGRATION] Creating sparse TTL index { expiresAt: 1 } with expireAfterSeconds=0, sparse=true...');
      const createdName = await coll.createIndex(
        { expiresAt: 1 },
        { expireAfterSeconds: 0, sparse: true, name: 'expiresAt_1' }
      );
      createdNewIndex = createdName;
      console.log(`[TTL MIGRATION] Successfully created index: "${createdName}".`);
    } catch (err: unknown) {
      const msg = `Failed to create new expiresAt TTL index: ${err instanceof Error ? err.message : String(err)}`;
      errors.push(msg);
      console.error(`[TTL MIGRATION] ${msg}`);
      return {
        success: false,
        dryRun: false,
        droppedOldIndex,
        createdNewIndex: null,
        terminalBackfilledCount,
        unresolvedCleanedCount,
        postMigrationIndexes: [],
        errors
      };
    }
  }

  // STEP 5: Exact postflight verification (M5)
  const postIndexesRaw = await coll.indexes();
  const postMigrationIndexes = postIndexesRaw.map(i => i.name || '');

  const hasCreatedAtTtl = postIndexesRaw.some(
    idx => idx.key?.createdAt !== undefined && typeof idx.expireAfterSeconds === 'number'
  );
  if (hasCreatedAtTtl) {
    errors.push('Postflight failed: obsolete createdAt TTL index is still present in database');
  }

  const newTtlIdx = postIndexesRaw.find(
    idx => idx.key?.expiresAt !== undefined && typeof idx.expireAfterSeconds === 'number'
  );
  if (!newTtlIdx || newTtlIdx.expireAfterSeconds !== 0 || !newTtlIdx.sparse) {
    errors.push('Postflight failed: expiresAt TTL index missing or has incorrect options (expected expireAfterSeconds=0, sparse=true)');
  }

  const unresolvedWithExpiry = await coll.countDocuments({
    status: { $in: ['FAILED', 'PROCESSING'] },
    expiresAt: { $exists: true, $ne: null }
  });
  if (unresolvedWithExpiry > 0) {
    errors.push(`Postflight failed: ${unresolvedWithExpiry} unresolved events have expiresAt assigned`);
  }

  console.log('[TTL MIGRATION] Post-migration indexes:', postMigrationIndexes.join(', '));

  return {
    success: errors.length === 0,
    dryRun: false,
    droppedOldIndex,
    createdNewIndex,
    terminalBackfilledCount,
    unresolvedCleanedCount,
    postMigrationIndexes,
    errors
  };
}

// CLI execution harness
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
  (async () => {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      console.error('ERROR: MONGODB_URI environment variable is not defined.');
      process.exit(1);
    }

    console.log('╔══════════════════════════════════════════════════════════════════════╗');
    console.log('║   SamratFashion — Webhook TTL Index Migration & Safety Inspection    ║');
    console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

    await mongoose.connect(mongoUri);
    console.log(`Connected to MongoDB database: "${mongoose.connection.name}"\n`);

    const preflight = await preflightWebhookIndexMigration(mongoose.connection);
    console.log('--- PREFLIGHT AUDIT SUMMARY ---');
    console.log(`Total WebhookEvents:             ${preflight.totalEvents}`);
    console.log(`  - PROCESSED:                   ${preflight.processedCount}`);
    console.log(`  - IGNORED:                     ${preflight.ignoredCount}`);
    console.log(`  - FAILED (Unresolved):         ${preflight.failedCount}`);
    console.log(`  - PROCESSING (Active):         ${preflight.processingCount}`);
    console.log(`Terminal missing expiresAt:      ${preflight.terminalMissingExpiresAt}`);
    console.log(`Unresolved with expiresAt:       ${preflight.unresolvedWithExpiresAt}`);
    console.log(`Old createdAt TTL index present: ${preflight.hasOldCreatedAtTtl ? `YES ("${preflight.oldCreatedAtTtlIndexName}")` : 'NO'}`);
    console.log(`New expiresAt TTL index present: ${preflight.hasNewExpiresAtTtl ? `YES ("${preflight.newExpiresAtTtlIndexName}")` : 'NO'}`);
    console.log('\nExisting Indexes:');
    for (const idx of preflight.existingIndexes) {
      const details: string[] = [];
      if (idx.expireAfterSeconds !== undefined) details.push(`TTL: ${idx.expireAfterSeconds}s`);
      if (idx.sparse) details.push('sparse');
      if (idx.unique) details.push('unique');
      console.log(`  - ${idx.name} on ${JSON.stringify(idx.key)} ${details.length > 0 ? `(${details.join(', ')})` : ''}`);
    }

    console.log('\nRecommended Migration Plan:');
    for (const step of preflight.recommendedSteps) {
      console.log(`  ${step}`);
    }

    if (!isExecute) {
      console.log('\n⚠️  DRY RUN MODE. No changes were made to the database.');
      console.log('To execute this migration against the database, pass the --execute flag:');
      console.log('  node dist/scripts/migrateWebhookTtlIndex.js --execute\n');
      await mongoose.disconnect();
      process.exit(0);
    }

    console.log('\n--- EXECUTING MIGRATION ---');
    const result = await runWebhookIndexMigration({ dryRun: false, connection: mongoose.connection });
    if (result.success) {
      console.log('\n✅ Migration completed successfully!');
      console.log(`  Dropped old index:             ${result.droppedOldIndex ?? 'None'}`);
      console.log(`  Created new index:             ${result.createdNewIndex ?? 'None (Already existed)'}`);
      console.log(`  Terminal records backfilled:   ${result.terminalBackfilledCount}`);
      console.log(`  Unresolved records cleaned:    ${result.unresolvedCleanedCount}`);
    } else {
      console.error('\n❌ Migration failed with errors:', result.errors);
      process.exit(1);
    }

    await mongoose.disconnect();
    console.log('Disconnected from MongoDB.');
  })().catch(err => {
    console.error('Fatal error during migration:', err);
    process.exit(1);
  });
}
