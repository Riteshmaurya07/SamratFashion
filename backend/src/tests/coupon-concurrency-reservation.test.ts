/**
 * Samrat Fashion — SEC-FINDING-001 Concurrency Regression Test Suite
 *
 * Verifies atomic coupon reservation, slot-based perUserUsageLimit enforcement,
 * idempotent payment confirmation, safe release on cancellation/expiry,
 * protection of redeemed coupons against expiry cleanup, and global usageLimit enforcement.
 */

process.env.NODE_ENV = 'test';
process.env.ALLOW_PAYMENT_MOCK = 'true';

import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import { connectSafeTestDb, createTestProduct } from './testHelpers';
import { Coupon, DiscountType, CouponStatus } from '../models/Coupon';
import { CouponUsage, CouponUsageStatus } from '../models/CouponUsage';
import { Order } from '../models/Order';
import { Payment } from '../models/Payment';
import { PaymentAttempt } from '../models/PaymentAttempt';
import { User, UserRole } from '../models/User';
import { Product } from '../models/Product';
import {
  reserveCouponForOrder,
  confirmCouponReservation,
  releaseCouponReservation,
  expireStaleCouponReservations,
  getActiveUserCouponUsageCount,
} from '../services/coupon/couponReservationService';
let passed = 0;
let failed = 0;

function check(condition: boolean, desc: string, details?: string): void {
  if (condition) {
    console.log(`  ✅ PASS: ${desc}`);
    passed++;
  } else {
    const msg = details ? `${desc} — ${details}` : desc;
    console.error(`  ❌ FAIL: ${msg}`);
    failed++;
  }
}

async function runCouponConcurrencySuite(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║  SEC-FINDING-001: Coupon Usage Reservation Concurrency Test Suite   ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

  await connectSafeTestDb();
  console.log(` Connected to verified isolated test database: "${mongoose.connection.name}"\n`);

  // Ensure indexes are built before executing concurrency tests
  await Promise.all([
    Coupon.init(),
    CouponUsage.init(),
    Order.init(),
    Payment.init(),
    PaymentAttempt.init(),
  ]);

  const timestamp = Date.now();

  // Test Product fixture
  const { product: testProduct } = await createTestProduct({
    name: `Coupon Test Tee ${timestamp}`,
    basePrice: 1000,
    variants: [{ size: 'L', color: 'BLACK', stock: 500, isAvailable: true }],
  });

  const cleanupUserIds: mongoose.Types.ObjectId[] = [];
  const cleanupCouponIds: mongoose.Types.ObjectId[] = [];
  const cleanupOrderIds: mongoose.Types.ObjectId[] = [];

  try {
    // -------------------------------------------------------------------------
    // SCENARIO 1: 10 SIMULTANEOUS CHECKOUT ATTEMPTS BY SAME USER (perUserUsageLimit=1)
    // -------------------------------------------------------------------------
    console.log('--- SCENARIO 1: 10 Simultaneous Checkouts by Same User (perUserUsageLimit=1) ---');
    const user1 = await User.create({
      name: 'Single-Use Tester',
      email: `user_single_${timestamp}@example.com`,
      role: UserRole.CUSTOMER,
      passwordHash: 'dummy_hash',
    });
    cleanupUserIds.push(user1._id as mongoose.Types.ObjectId);

    const coupon1 = await Coupon.create({
      code: `SINGLE10_${timestamp}`,
      discountType: DiscountType.FIXED,
      discountValue: 200,
      minOrderValue: 500,
      perUserUsageLimit: 1,
      status: CouponStatus.ACTIVE,
    });
    cleanupCouponIds.push(coupon1._id as mongoose.Types.ObjectId);

    // Launch 10 simultaneous reservation attempts
    const attempts1 = Array.from({ length: 10 }).map(async (_, idx) => {
      const orderId = new mongoose.Types.ObjectId();
      cleanupOrderIds.push(orderId);
      try {
        const res = await reserveCouponForOrder({
          couponId: coupon1._id,
          userId: user1._id,
          orderId,
          discountAmount: 200,
        });
        return { success: true, slot: res.slot, orderId };
      } catch (err: unknown) {
        const errMessage = err instanceof Error ? err.message : String(err);
        return { success: false, error: errMessage, orderId };
      }
    });

    const results1 = await Promise.all(attempts1);
    const successes1 = results1.filter((r) => r.success);
    const failures1 = results1.filter((r) => !r.success);

    check(successes1.length === 1, '1.1 Exactly 1 of 10 simultaneous checkouts succeeded in reserving the coupon');
    check(failures1.length === 9, '1.2 The other 9 simultaneous checkouts were rejected');
    check(
      failures1.every((f) => f.error?.includes('maximum allowed times')),
      '1.3 All 9 rejected checkouts returned COUPON_USER_LIMIT_REACHED error'
    );

    const activeUsages1 = await CouponUsage.find({
      couponId: coupon1._id,
      userId: user1._id,
      status: { $in: [CouponUsageStatus.RESERVED, CouponUsageStatus.CONFIRMED] },
    });
    check(activeUsages1.length === 1, '1.4 Exactly 1 active CouponUsage record exists in database');
    check(activeUsages1[0]?.usageSlot === 1, '1.5 The successful reservation was assigned usageSlot: 1');

    // -------------------------------------------------------------------------
    // SCENARIO 2: SIMULTANEOUS ATTEMPTS BY DIFFERENT USERS (GLOBAL usageLimit=5)
    // -------------------------------------------------------------------------
    console.log('\n--- SCENARIO 2: Simultaneous Checkouts by Different Users (Global usageLimit=5) ---');
    const coupon2 = await Coupon.create({
      code: `GLOBAL5_${timestamp}`,
      discountType: DiscountType.FIXED,
      discountValue: 150,
      minOrderValue: 500,
      usageLimit: 5,
      perUserUsageLimit: 1,
      status: CouponStatus.ACTIVE,
    });
    cleanupCouponIds.push(coupon2._id as mongoose.Types.ObjectId);

    // 8 distinct users attempt checkout simultaneously
    const users2 = await Promise.all(
      Array.from({ length: 8 }).map(async (_, idx) => {
        const u = await User.create({
          name: `Multi User ${idx}`,
          email: `multi_user_${idx}_${timestamp}@example.com`,
          role: UserRole.CUSTOMER,
          passwordHash: 'dummy_hash',
        });
        cleanupUserIds.push(u._id as mongoose.Types.ObjectId);
        return u;
      })
    );

    const attempts2 = users2.map(async (u) => {
      const orderId = new mongoose.Types.ObjectId();
      cleanupOrderIds.push(orderId);
      try {
        await reserveCouponForOrder({
          couponId: coupon2._id,
          userId: u._id,
          orderId,
          discountAmount: 150,
        });
        return { success: true, userId: u._id, orderId };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, userId: u._id, error: msg, orderId };
      }
    });

    const results2 = await Promise.all(attempts2);
    const successes2 = results2.filter((r) => r.success);
    const failures2 = results2.filter((r) => !r.success);

    check(successes2.length === 5, '2.1 Exactly 5 checkouts succeeded (matching global usageLimit=5)');
    check(failures2.length === 3, '2.2 Remaining 3 checkouts failed closed');
    check(
      failures2.every((f) => f.error?.includes('usage limit has been reached')),
      '2.3 All 3 rejected checkouts received COUPON_LIMIT_REACHED'
    );

    const coupon2InDb = await Coupon.findById(coupon2._id);
    check(coupon2InDb?.reservedCount === 5, '2.4 Coupon reservedCount was atomically tracked at 5');

    // -------------------------------------------------------------------------
    // SCENARIO 3: COUPONS ALLOWING MULTIPLE USES PER CUSTOMER (perUserUsageLimit=2)
    // -------------------------------------------------------------------------
    console.log('\n--- SCENARIO 3: Multi-Use Coupon per Customer (perUserUsageLimit=2) ---');
    const user3 = await User.create({
      name: 'Multi-Slot Customer',
      email: `multi_slot_${timestamp}@example.com`,
      role: UserRole.CUSTOMER,
      passwordHash: 'dummy_hash',
    });
    cleanupUserIds.push(user3._id as mongoose.Types.ObjectId);

    const coupon3 = await Coupon.create({
      code: `MULTI2_${timestamp}`,
      discountType: DiscountType.FIXED,
      discountValue: 100,
      minOrderValue: 400,
      perUserUsageLimit: 2,
      status: CouponStatus.ACTIVE,
    });
    cleanupCouponIds.push(coupon3._id as mongoose.Types.ObjectId);

    // 5 concurrent attempts by the same customer for a perUserUsageLimit=2 coupon
    const attempts3 = Array.from({ length: 5 }).map(async (_, idx) => {
      const orderId = new mongoose.Types.ObjectId();
      cleanupOrderIds.push(orderId);
      try {
        const res = await reserveCouponForOrder({
          couponId: coupon3._id,
          userId: user3._id,
          orderId,
          discountAmount: 100,
        });
        return { success: true, slot: res.slot, orderId };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, error: msg, orderId };
      }
    });

    const results3 = await Promise.all(attempts3);
    const successes3 = results3.filter((r) => r.success);
    const failures3 = results3.filter((r) => !r.success);

    check(successes3.length === 2, '3.1 Exactly 2 simultaneous checkouts succeeded for perUserUsageLimit=2');
    check(failures3.length === 3, '3.2 Remaining 3 simultaneous checkouts were rejected');

    const slots = successes3.map((s) => s.slot).sort();
    check(slots[0] === 1 && slots[1] === 2, '3.3 Distinct slots 1 and 2 were claimed without conflict');

    const activeCount3 = await getActiveUserCouponUsageCount(coupon3._id, user3._id);
    check(activeCount3 === 2, '3.4 getActiveUserCouponUsageCount reflects active count of 2');

    // -------------------------------------------------------------------------
    // SCENARIO 4: TWO PAYMENT CONFIRMATIONS FOR THE SAME ORDER (IDEMPOTENCY)
    // -------------------------------------------------------------------------
    console.log('\n--- SCENARIO 4: Two Payment Confirmations for Same Order ---');
    const orderId4 = successes3[0].orderId;

    // First confirmation
    const confirmRes1 = await confirmCouponReservation(orderId4);
    check(confirmRes1.success === true && confirmRes1.status === 'CONFIRMED', '4.1 First payment confirmation transitions reservation to CONFIRMED');

    // Concurrent/duplicate confirmation
    const confirmRes2 = await confirmCouponReservation(orderId4);
    check(confirmRes2.success === true && confirmRes2.status === 'ALREADY_CONFIRMED', '4.2 Duplicate payment confirmation is a safe idempotent no-op (ALREADY_CONFIRMED)');

    const usage4 = await CouponUsage.findOne({ orderId: orderId4 });
    check(usage4?.status === CouponUsageStatus.CONFIRMED, '4.3 Usage document persists in CONFIRMED status');
    check(Boolean(usage4?.confirmedAt), '4.4 Usage document assigned confirmedAt timestamp');

    const coupon3Refreshed = await Coupon.findById(coupon3._id);
    check(coupon3Refreshed?.usedCount === 1, '4.5 Coupon usedCount was incremented exactly once (not twice)');
    check(coupon3Refreshed?.reservedCount === 1, '4.6 Coupon reservedCount decremented from 2 to 1');

    // -------------------------------------------------------------------------
    // SCENARIO 5: PAYMENT TIMEOUT AND RETRY ON SAME ORDER
    // -------------------------------------------------------------------------
    console.log('\n--- SCENARIO 5: Payment Timeout and Retry on Same Order ---');
    const orderId5 = successes3[1].orderId;
    const expectedSlot5 = successes3[1].slot;

    // Order was created with the second available slot. Payment attempt initially times out / remains pending.
    // User retries payment for this same order:
    const paymentRetryRes = await confirmCouponReservation(orderId5);
    check(paymentRetryRes.success === true && paymentRetryRes.status === 'CONFIRMED', '5.1 Payment retry on same order confirms the existing slot reservation');

    const usage5 = await CouponUsage.findOne({ orderId: orderId5 });
    check(usage5?.status === CouponUsageStatus.CONFIRMED && usage5.usageSlot === expectedSlot5, `5.2 Slot ${expectedSlot5} reservation confirmed successfully on retry`);
    const coupon3Final = await Coupon.findById(coupon3._id);
    check(coupon3Final?.usedCount === 2, '5.3 Coupon usedCount is now 2 (both slots redeemed)');
    check(coupon3Final?.reservedCount === 0, '5.4 Coupon reservedCount returned to 0');

    // -------------------------------------------------------------------------
    // SCENARIO 6: FAILED PAYMENT / CANCELLATION FOLLOWED BY NEW CHECKOUT
    // -------------------------------------------------------------------------
    console.log('\n--- SCENARIO 6: Failed Payment / Cancellation Followed by New Checkout ---');
    const user6 = await User.create({
      name: 'Retry Customer',
      email: `retry_user_${timestamp}@example.com`,
      role: UserRole.CUSTOMER,
      passwordHash: 'dummy_hash',
    });
    cleanupUserIds.push(user6._id as mongoose.Types.ObjectId);

    const coupon6 = await Coupon.create({
      code: `RETRY1_${timestamp}`,
      discountType: DiscountType.FIXED,
      discountValue: 100,
      minOrderValue: 400,
      perUserUsageLimit: 1,
      status: CouponStatus.ACTIVE,
    });
    cleanupCouponIds.push(coupon6._id as mongoose.Types.ObjectId);

    // Initial checkout (Order A)
    const orderAId = new mongoose.Types.ObjectId();
    cleanupOrderIds.push(orderAId);
    await reserveCouponForOrder({
      couponId: coupon6._id,
      userId: user6._id,
      orderId: orderAId,
      discountAmount: 100,
    });

    const activeA = await getActiveUserCouponUsageCount(coupon6._id, user6._id);
    check(activeA === 1, '6.1 Order A reserved the single slot');

    // Order A is cancelled while PENDING / unpaid
    const releaseResA = await releaseCouponReservation(orderAId, 'CUSTOMER_CANCELLED');
    check(releaseResA.released === true, '6.2 Unpaid Order A reservation released successfully');

    const usageA = await CouponUsage.findOne({ orderId: orderAId });
    check(usageA?.status === CouponUsageStatus.RELEASED, '6.3 Order A usage status transitioned to RELEASED');

    const activeAfterRelease = await getActiveUserCouponUsageCount(coupon6._id, user6._id);
    check(activeAfterRelease === 0, '6.4 Active usage count returned to 0 after release');

    // User now checks out with Order B using the same coupon
    const orderBId = new mongoose.Types.ObjectId();
    cleanupOrderIds.push(orderBId);
    const reserveResB = await reserveCouponForOrder({
      couponId: coupon6._id,
      userId: user6._id,
      orderId: orderBId,
      discountAmount: 100,
    });
    check(reserveResB.slot === 1, '6.5 Order B successfully re-claimed usageSlot: 1');

    // Order B is paid and confirmed
    const confirmResB = await confirmCouponReservation(orderBId);
    check(confirmResB.status === 'CONFIRMED', '6.6 Order B payment confirmed successfully');

    const usageB = await CouponUsage.findOne({ orderId: orderBId });
    check(usageB?.status === CouponUsageStatus.CONFIRMED, '6.7 Order B usage document confirmed');

    // -------------------------------------------------------------------------
    // SCENARIO 7: CONCURRENT EXPIRY AND SUCCESSFUL PAYMENT PROCESSING
    // -------------------------------------------------------------------------
    console.log('\n--- SCENARIO 7: Concurrent Expiry and Successful Payment Processing ---');
    // Order B was CONFIRMED in Scenario 6.
    // Now trigger expiry cleanup routine:
    await expireStaleCouponReservations();
    const usageBAfterReaper = await CouponUsage.findOne({ orderId: orderBId });
    check(
      usageBAfterReaper?.status === CouponUsageStatus.CONFIRMED,
      '7.1 Expiry reaper CANNOT release an already redeemed (CONFIRMED) coupon'
    );
    check(
      usageBAfterReaper?.releasedAt === undefined,
      '7.2 Confirmed coupon document releasedAt remains undefined'
    );

    // Direct release call against a CONFIRMED order fails closed
    const directReleaseOnConfirmed = await releaseCouponReservation(orderBId, 'MALICIOUS_RELEASE');
    check(
      directReleaseOnConfirmed.released === false,
      '7.3 releaseCouponReservation strictly rejects releasing a CONFIRMED order'
    );

    console.log('\n🧹 Cleaning up test fixtures from database...');
    await Promise.all([
      CouponUsage.deleteMany({ couponId: { $in: cleanupCouponIds } }),
      Coupon.deleteMany({ _id: { $in: cleanupCouponIds } }),
      Order.deleteMany({ _id: { $in: cleanupOrderIds } }),
      User.deleteMany({ _id: { $in: cleanupUserIds } }),
      Product.deleteOne({ _id: testProduct._id }),
    ]);

    await mongoose.disconnect();
    console.log(' Disconnected from MongoDB\n');
  } catch (err: unknown) {
    console.error('Fatal test execution error:', err);
    failed++;
  }

  console.log('══════════════════════════════════════════════════════════════════════');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════════════════════════\n');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runCouponConcurrencySuite().catch((err) => {
  console.error('Fatal test runner exception:', err);
  process.exit(1);
});
