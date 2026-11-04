/**
 * Inventory Transaction Index Migration Script
 *
 * Phase A - Safe, non-destructive migration of inventory transaction indexes:
 * 1. Replaces broad unique index { orderId: 1, variantId: 1, type: 1 }
 * 2. Introduces partial unique indexes:
 *    - uniq_sale_order_variant: { orderId: 1, variantId: 1 } for type: 'SALE'
 *    - uniq_return_variant: { returnId: 1, variantId: 1 } for type: 'RETURN' where returnId exists
 *    - uniq_refund_order_variant: { orderId: 1, variantId: 1 } for type: 'REFUND'
 * 3. Preserves all historical RETURN records without returnId (they remain intact in ledger)
 * 4. Verifies duplicate safety before modifying indexes.
 *
 * SAFETY RULES:
 * - Does NOT delete or modify any ledger documents.
 * - Creates new partial indexes BEFORE dropping the obsolete index.
 * - Supports dryRun mode for safe preflight inspection.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env') });

export interface MigrationPreflightResult {
  totalCount: number;
  saleCount: number;
  returnCount: number;
  historicalReturnsWithoutReturnId: number;
  refundCount: number;
  existingIndexes: string[];
  hasObsoleteIndex: boolean;
  duplicateSaleCollisions: number;
  duplicateReturnCollisions: number;
  duplicateRefundCollisions: number;
  invalidVariantCount: number;
  canProceed: boolean;
  blockers: string[];
}

export async function preflightInventoryIndexMigration(
  connection: mongoose.Connection
): Promise<MigrationPreflightResult> {
  const coll = connection.collection('inventorytransactions');

  // Check if collection exists
  const collections = await connection.db!.listCollections({ name: 'inventorytransactions' }).toArray();
  if (collections.length === 0) {
    return {
      totalCount: 0,
      saleCount: 0,
      returnCount: 0,
      historicalReturnsWithoutReturnId: 0,
      refundCount: 0,
      existingIndexes: [],
      hasObsoleteIndex: false,
      duplicateSaleCollisions: 0,
      duplicateReturnCollisions: 0,
      duplicateRefundCollisions: 0,
      invalidVariantCount: 0,
      canProceed: true,
      blockers: []
    };
  }

  const existingIndexesRaw = await coll.indexes();
  const existingIndexes = existingIndexesRaw.map(idx => idx.name || '');
  const hasObsoleteIndex = existingIndexes.includes('orderId_1_variantId_1_type_1');

  const [
    totalCount,
    saleCount,
    returnCount,
    historicalReturnsWithoutReturnId,
    refundCount
  ] = await Promise.all([
    coll.countDocuments({}),
    coll.countDocuments({ type: 'SALE' }),
    coll.countDocuments({ type: 'RETURN' }),
    coll.countDocuments({ type: 'RETURN', returnId: { $in: [null, undefined] } }),
    coll.countDocuments({ type: 'REFUND' })
  ]);

  // Check for duplicate collisions that would fail partial index creation
  const saleDuplicates = await coll.aggregate([
    { $match: { type: 'SALE' } },
    { $group: { _id: { orderId: '$orderId', variantId: '$variantId' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } }
  ]).toArray();

  const returnDuplicates = await coll.aggregate([
    { $match: { type: 'RETURN', returnId: { $exists: true, $type: 'objectId' } } },
    { $group: { _id: { returnId: '$returnId', variantId: '$variantId' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } }
  ]).toArray();

  const refundDuplicates = await coll.aggregate([
    { $match: { type: 'REFUND' } },
    { $group: { _id: { orderId: '$orderId', variantId: '$variantId' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } }
  ]).toArray();

  // Check for records with missing or invalid variantId
  const invalidVariantCount = await coll.countDocuments({
    $or: [
      { variantId: null },
      { variantId: { $exists: false } }
    ]
  });

  const blockers: string[] = [];
  if (invalidVariantCount > 0) {
    blockers.push(`Found ${invalidVariantCount} documents with missing or null variantId`);
  }
  if (saleDuplicates.length > 0) {
    blockers.push(`Found ${saleDuplicates.length} duplicate SALE groupings on (orderId, variantId)`);
  }
  if (returnDuplicates.length > 0) {
    blockers.push(`Found ${returnDuplicates.length} duplicate RETURN groupings on (returnId, variantId)`);
  }
  if (refundDuplicates.length > 0) {
    blockers.push(`Found ${refundDuplicates.length} duplicate REFUND groupings on (orderId, variantId)`);
  }

  return {
    totalCount,
    saleCount,
    returnCount,
    historicalReturnsWithoutReturnId,
    refundCount,
    existingIndexes,
    hasObsoleteIndex,
    duplicateSaleCollisions: saleDuplicates.length,
    duplicateReturnCollisions: returnDuplicates.length,
    duplicateRefundCollisions: refundDuplicates.length,
    invalidVariantCount,
    canProceed: blockers.length === 0,
    blockers
  };
}

export async function runInventoryIndexMigration(options: {
  connection?: mongoose.Connection;
  dryRun?: boolean;
} = {}): Promise<{ success: boolean; preflight: MigrationPreflightResult; message: string }> {
  const dryRun = options.dryRun !== false; // Defaults to dry-run true!
  const conn = options.connection || mongoose.connection;
  if (!conn || conn.readyState !== 1) {
    throw new Error('Database connection must be open before running migration.');
  }

  console.log(`[INDEX MIGRATION] Starting preflight check on DB: "${conn.name}" (dryRun=${dryRun})...`);
  const preflight = await preflightInventoryIndexMigration(conn);

  console.log(`[INDEX MIGRATION] Total transactions: ${preflight.totalCount}`);
  console.log(`[INDEX MIGRATION] SALE transactions: ${preflight.saleCount}`);
  console.log(`[INDEX MIGRATION] RETURN transactions: ${preflight.returnCount} (${preflight.historicalReturnsWithoutReturnId} historical without returnId)`);
  console.log(`[INDEX MIGRATION] REFUND transactions: ${preflight.refundCount}`);
  console.log(`[INDEX MIGRATION] Existing indexes: ${preflight.existingIndexes.join(', ')}`);
  console.log(`[INDEX MIGRATION] Obsolete index present: ${preflight.hasObsoleteIndex}`);

  if (!preflight.canProceed) {
    const errorMsg = `Preflight failed with blockers:\n - ${preflight.blockers.join('\n - ')}`;
    console.error(`[INDEX MIGRATION] ${errorMsg}`);
    return { success: false, preflight, message: errorMsg };
  }

  if (dryRun) {
    return {
      success: true,
      preflight,
      message: 'Dry run completed successfully. All preflight checks passed with zero collisions.'
    };
  }

  const coll = conn.collection('inventorytransactions');

  // Step 1: Create partial index for SALE transactions
  console.log('[INDEX MIGRATION] Step 1: Creating partial unique index uniq_sale_order_variant...');
  await coll.createIndex(
    { orderId: 1, variantId: 1 },
    {
      unique: true,
      name: 'uniq_sale_order_variant',
      partialFilterExpression: { type: 'SALE' },
      background: true
    }
  );

  // Step 2: Create partial index for RETURN transactions
  console.log('[INDEX MIGRATION] Step 2: Creating partial unique index uniq_return_variant...');
  const existingRaw = await coll.indexes();
  const oldReturnIdx = existingRaw.find(i => i.name === 'uniq_return_variant');
  if (oldReturnIdx) {
    const filterExp = oldReturnIdx.partialFilterExpression as Record<string, unknown> | undefined;
    const returnIdFilter = filterExp?.returnId as Record<string, unknown> | undefined;
    const isNewSpec = returnIdFilter?.$type === 'objectId';
    if (!isNewSpec) {
      console.log('[INDEX MIGRATION] Dropping existing uniq_return_variant with outdated partialFilterExpression...');
      await coll.dropIndex('uniq_return_variant');
    }
  }

  await coll.createIndex(
    { returnId: 1, variantId: 1 },
    {
      unique: true,
      name: 'uniq_return_variant',
      partialFilterExpression: { type: 'RETURN', returnId: { $exists: true, $type: 'objectId' } },
      background: true
    }
  );

  // Step 3: Create partial index for REFUND transactions
  console.log('[INDEX MIGRATION] Step 3: Creating partial unique index uniq_refund_order_variant...');
  await coll.createIndex(
    { orderId: 1, variantId: 1 },
    {
      unique: true,
      name: 'uniq_refund_order_variant',
      partialFilterExpression: { type: 'REFUND' },
      background: true
    }
  );

  // Step 4: Create standard lookup indexes for audit & performance
  console.log('[INDEX MIGRATION] Step 4: Creating query support indexes...');
  await coll.createIndex({ orderId: 1, type: 1 }, { background: true });
  await coll.createIndex({ returnId: 1, type: 1 }, { background: true });
  await coll.createIndex({ productId: 1, createdAt: -1 }, { background: true });

  // Step 5: Safely drop the obsolete index IF present
  if (preflight.hasObsoleteIndex) {
    console.log('[INDEX MIGRATION] Step 5: Dropping obsolete index orderId_1_variantId_1_type_1...');
    await coll.dropIndex('orderId_1_variantId_1_type_1');
  } else {
    console.log('[INDEX MIGRATION] Step 5: Obsolete index was not present; skip drop.');
  }

  // Step 6: Postflight verification
  const postIndexes = (await coll.indexes()).map(i => i.name || '');
  console.log(`[INDEX MIGRATION] Post-migration indexes: ${postIndexes.join(', ')}`);

  const hasNewSale = postIndexes.includes('uniq_sale_order_variant');
  const hasNewReturn = postIndexes.includes('uniq_return_variant');
  const hasNewRefund = postIndexes.includes('uniq_refund_order_variant');
  const oldDropped = !postIndexes.includes('orderId_1_variantId_1_type_1');

  if (!hasNewSale || !hasNewReturn || !hasNewRefund || !oldDropped) {
    throw new Error(
      `Postflight verification failed: newSale=${hasNewSale}, newReturn=${hasNewReturn}, newRefund=${hasNewRefund}, oldDropped=${oldDropped}`
    );
  }

  const postTotalCount = await coll.countDocuments({});
  if (postTotalCount !== preflight.totalCount) {
    throw new Error(
      `CRITICAL INVARIANT VIOLATION: Ledger count changed during index migration! Before: ${preflight.totalCount}, After: ${postTotalCount}`
    );
  }

  console.log(`[INDEX MIGRATION] Migration finished successfully. All ${postTotalCount} records preserved.`);
  return {
    success: true,
    preflight,
    message: `Migration successful. 3 partial indexes created, obsolete index dropped, ${postTotalCount} documents intact.`
  };
}

if (require.main === module) {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI environment variable is required to run migration.');
    process.exit(1);
  }
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

  mongoose.connect(uri).then(async (conn) => {
    try {
      console.log(`[INDEX MIGRATION] Connected to DB: ${conn.connection.name}`);
      console.log(`[INDEX MIGRATION] Mode: ${isExecute ? 'EXECUTE' : 'DRY RUN'}`);
      const result = await runInventoryIndexMigration({ dryRun: !isExecute, connection: conn.connection });
      console.log(result.message);
      await mongoose.disconnect();
      process.exit(result.success ? 0 : 1);
    } catch (err: unknown) {
      console.error('Migration failed with error:', err);
      await mongoose.disconnect();
      process.exit(1);
    }
  });
}
