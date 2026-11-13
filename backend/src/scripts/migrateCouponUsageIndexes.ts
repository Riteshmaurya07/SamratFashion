/**
 * Coupon Usage Index & Legacy Data Migration Script
 *
 * Provides safe, non-destructive, and idempotent migration:
 * 1. Preflight scans legacy CouponUsage documents missing status or usageSlot.
 * 2. Resolves historical duplicate redemptions by assigning sequential usageSlot values.
 * 3. Backfills Coupon.reservedCount to 0 where uninitialized.
 * 4. Explicitly creates the partial unique index on (couponId, userId, usageSlot)
 *    independent of Mongoose autoIndex settings.
 * 5. Reconciles all active coupon reservation counters.
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../../../.env') });

export interface CouponPreflightResult {
  totalUsages: number;
  usagesMissingStatus: number;
  usagesMissingSlot: number;
  duplicateRedemptionGroups: number;
  couponsMissingReservedCount: number;
  hasSlotUniqueIndex: boolean;
  canProceed: boolean;
  blockers: string[];
}

export interface CouponMigrationResult {
  success: boolean;
  dryRun: boolean;
  preflight: CouponPreflightResult;
  backfilledUsages: number;
  resolvedDuplicateSlots: number;
  backfilledCoupons: number;
  createdSlotIndex: boolean;
  reconciledCoupons: number;
  message: string;
}

export async function preflightCouponUsageMigration(
  connection: mongoose.Connection
): Promise<CouponPreflightResult> {
  const blockers: string[] = [];
  const db = connection.db;
  if (!db) {
    return {
      totalUsages: 0,
      usagesMissingStatus: 0,
      usagesMissingSlot: 0,
      duplicateRedemptionGroups: 0,
      couponsMissingReservedCount: 0,
      hasSlotUniqueIndex: false,
      canProceed: false,
      blockers: ['Database is not connected'],
    };
  }

  const collections = await db.listCollections({ name: 'couponusages' }).toArray();
  if (collections.length === 0) {
    return {
      totalUsages: 0,
      usagesMissingStatus: 0,
      usagesMissingSlot: 0,
      duplicateRedemptionGroups: 0,
      couponsMissingReservedCount: 0,
      hasSlotUniqueIndex: false,
      canProceed: true,
      blockers: [],
    };
  }

  const coll = connection.collection('couponusages');
  const totalUsages = await coll.countDocuments();
  const usagesMissingStatus = await coll.countDocuments({ status: { $exists: false } });
  const usagesMissingSlot = await coll.countDocuments({ usageSlot: { $exists: false } });

  // Detect duplicate historical redemptions
  const duplicateGroups = await coll.aggregate([
    { $match: { $or: [{ status: 'CONFIRMED' }, { status: { $exists: false } }] } },
    { $group: { _id: { couponId: '$couponId', userId: '$userId' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ]).toArray();

  const couponColl = connection.collection('coupons');
  const couponsMissingReservedCount = await couponColl.countDocuments({ reservedCount: { $exists: false } });

  const existingIndexes = await coll.indexes();
  const hasSlotUniqueIndex = existingIndexes.some((i) => i.name === 'coupon_user_slot_active_unique');

  return {
    totalUsages,
    usagesMissingStatus,
    usagesMissingSlot,
    duplicateRedemptionGroups: duplicateGroups.length,
    couponsMissingReservedCount,
    hasSlotUniqueIndex,
    canProceed: blockers.length === 0,
    blockers,
  };
}

export async function runCouponUsageMigration(options: {
  dryRun?: boolean;
  connection?: mongoose.Connection;
} = {}): Promise<CouponMigrationResult> {
  const dryRun = options.dryRun ?? true;
  const connection = options.connection || mongoose.connection;
  const db = connection.db;

  if (!db) {
    throw new Error('Database connection is required for migration');
  }

  const preflight = await preflightCouponUsageMigration(connection);
  if (!preflight.canProceed) {
    return {
      success: false,
      dryRun,
      preflight,
      backfilledUsages: 0,
      resolvedDuplicateSlots: 0,
      backfilledCoupons: 0,
      createdSlotIndex: false,
      reconciledCoupons: 0,
      message: `Preflight blockers detected: ${preflight.blockers.join(', ')}`,
    };
  }

  if (dryRun) {
    return {
      success: true,
      dryRun: true,
      preflight,
      backfilledUsages: preflight.usagesMissingStatus + preflight.usagesMissingSlot,
      resolvedDuplicateSlots: preflight.duplicateRedemptionGroups,
      backfilledCoupons: preflight.couponsMissingReservedCount,
      createdSlotIndex: !preflight.hasSlotUniqueIndex,
      reconciledCoupons: 0,
      message: 'Dry-run inspection completed. No database mutations were performed.',
    };
  }

  const coll = connection.collection('couponusages');
  const couponColl = connection.collection('coupons');

  // 1. Backfill legacy records missing status
  const statusRes = await coll.updateMany(
    { status: { $exists: false } },
    { $set: { status: 'CONFIRMED' } }
  );

  // 2. Resolve duplicate historical redemptions by assigning sequential slots
  const duplicates = await coll.aggregate([
    { $match: { $or: [{ status: 'CONFIRMED' }, { status: 'RESERVED' }] } },
    { $group: { _id: { couponId: '$couponId', userId: '$userId' }, docs: { $push: { _id: '$_id', createdAt: '$createdAt' } }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ]).toArray();

  let resolvedDuplicateSlots = 0;
  for (const group of duplicates) {
    const sortedDocs = group.docs.sort(
      (a: { createdAt?: Date }, b: { createdAt?: Date }) =>
        new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()
    );

    for (let slotIdx = 0; slotIdx < sortedDocs.length; slotIdx++) {
      await coll.updateOne(
        { _id: sortedDocs[slotIdx]._id },
        { $set: { usageSlot: slotIdx + 1 } }
      );
    }
    resolvedDuplicateSlots += sortedDocs.length;
  }

  // 3. Backfill any remaining usages missing usageSlot
  const slotRes = await coll.updateMany(
    { usageSlot: { $exists: false } },
    { $set: { usageSlot: 1 } }
  );

  // 4. Backfill coupons missing reservedCount
  const couponRes = await couponColl.updateMany(
    { reservedCount: { $exists: false } },
    { $set: { reservedCount: 0 } }
  );

  // 5. Explicitly create the partial unique index on the native collection
  let createdSlotIndex = false;
  if (!preflight.hasSlotUniqueIndex) {
    await coll.createIndex(
      { couponId: 1, userId: 1, usageSlot: 1 },
      {
        unique: true,
        partialFilterExpression: { status: { $in: ['RESERVED', 'CONFIRMED'] } },
        name: 'coupon_user_slot_active_unique',
      }
    );
    await coll.createIndex(
      { status: 1, expiresAt: 1 },
      { name: 'status_1_expiresAt_1' }
    );
    createdSlotIndex = true;
  }

  // 6. Reconcile reservedCount for all coupons
  const allCoupons = await couponColl.find({}).project({ _id: 1 }).toArray();
  let reconciledCoupons = 0;
  const now = new Date();

  for (const c of allCoupons) {
    const activeCount = await coll.countDocuments({
      couponId: c._id,
      status: 'RESERVED',
      expiresAt: { $gt: now },
    });
    await couponColl.updateOne({ _id: c._id }, { $set: { reservedCount: activeCount } });
    reconciledCoupons++;
  }

  return {
    success: true,
    dryRun: false,
    preflight,
    backfilledUsages: (statusRes.modifiedCount || 0) + (slotRes.modifiedCount || 0),
    resolvedDuplicateSlots,
    backfilledCoupons: couponRes.modifiedCount || 0,
    createdSlotIndex,
    reconciledCoupons,
    message: 'Coupon usage migration completed successfully.',
  };
}

// CLI Execution entry point
if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const execute = args.includes('--execute');
    const dryRun = !execute;

    const uri = process.env.MONGODB_URI || process.env.Mongodb_URI;
    if (!uri) {
      console.error('❌ MONGODB_URI environment variable is required.');
      process.exit(1);
    }

    const maskedUri = uri.replace(/\/\/[^:]+:[^@]+@/, '//***:***@');
    console.log('\n======================================================');
    console.log('🔄 Coupon Usage Index & Historical Data Migration');
    console.log('======================================================');
    console.log(`Target Database: ${maskedUri}`);
    console.log(`Mode:            ${dryRun ? 'DRY-RUN (Safe, no changes)' : 'EXECUTE (Applying changes)'}\n`);

    try {
      await mongoose.connect(uri);
      const result = await runCouponUsageMigration({ dryRun, connection: mongoose.connection });

      console.log('--- Preflight Findings ---');
      console.log(`Total Coupon Usages:              ${result.preflight.totalUsages}`);
      console.log(`Missing Status:                   ${result.preflight.usagesMissingStatus}`);
      console.log(`Missing Slot:                     ${result.preflight.usagesMissingSlot}`);
      console.log(`Duplicate Historical Groups:      ${result.preflight.duplicateRedemptionGroups}`);
      console.log(`Coupons Missing reservedCount:    ${result.preflight.couponsMissingReservedCount}`);
      console.log(`Slot Partial Unique Index Exists: ${result.preflight.hasSlotUniqueIndex ? 'YES' : 'NO'}`);
      console.log('\n--- Migration Outcome ---');
      console.log(`Status:                           ${result.success ? '✅ SUCCESS' : '❌ FAILED'}`);
      console.log(`Message:                          ${result.message}`);
      if (!dryRun) {
        console.log(`Backfilled Usages:                ${result.backfilledUsages}`);
        console.log(`Resolved Duplicate Slots:         ${result.resolvedDuplicateSlots}`);
        console.log(`Backfilled Coupons:               ${result.backfilledCoupons}`);
        console.log(`Created Partial Unique Index:     ${result.createdSlotIndex ? 'YES' : 'ALREADY PRESENT'}`);
        console.log(`Reconciled Coupons:               ${result.reconciledCoupons}`);
      }
      console.log('======================================================\n');
      process.exit(result.success ? 0 : 1);
    } catch (err: unknown) {
      console.error('Fatal migration error:', err);
      process.exit(1);
    } finally {
      await mongoose.disconnect();
    }
  })();
}
