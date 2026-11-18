/**
 * Phase 4 Regression Suite: Worker Lock Reliability, Lease Renewal & Fencing
 *
 * Verifies:
 *  1. Lease expiry prevents stale renewal and fences out stale writes in withRecoveryLeaseFence.
 *  2. Heartbeat renews leases across work longer than leaseDurationMs and handles renewal errors safely (no unhandled rejection, marks lease lost).
 *  3. Ownership loss before transaction start aborts reconciliation cleanly without writing.
 *  4. Ownership loss / lease expiry before commit inside reconcileCapturedPayment aborts transaction, rolls back writes, and does NOT release the newer owner's lock.
 *  5. Stale fencing tokens are rejected by renewWorkerLease, releaseWorkerLease, and withRecoveryLeaseFence (including pre-commit expiry during long fn).
 *  6. Competing reconciliation workers race safely: only one commits, stock deducted once, loser fails closed.
 */

process.env.NODE_ENV = 'test';
process.env.RAZORPAY_KEY_ID = 'rzp_test_mock';
process.env.RAZORPAY_KEY_SECRET = 'mock_secret_test';
process.env.ALLOW_PAYMENT_MOCK = 'true';

import mongoose from 'mongoose';
import { connectSafeTestDb, createTestProduct } from './testHelpers';
import { Order } from '../models/Order';
import { Payment } from '../models/Payment';
import { PaymentAttempt } from '../models/PaymentAttempt';
import { Product } from '../models/Product';
import { InventoryTransaction } from '../models/InventoryTransaction';
import { WorkerLock } from '../models/WorkerLock';
import { razorpayProvider } from '../services/payment/RazorpayProvider';
import { isTransactionSupported } from '../services/coupon/couponReservationService';
import { RecoveryCoordinatorService } from '../services/recovery/recoveryCoordinatorService';
import { reconcileCapturedPayment } from '../scripts/reconcileCapturedPayment';
import '../models/Cart';
import '../models/User';
import '../models/Refund';
import '../models/WebhookEvent';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(condition: boolean, desc: string, detail?: string): void {
  if (condition) {
    console.log(`  PASS: ${desc}`);
    passed++;
  } else {
    const msg = detail ? `${desc} — ${detail}` : desc;
    console.error(`  FAIL: ${msg}`);
    failures.push(msg);
    failed++;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function run() {
  console.log('=== Phase 4: Worker Lock Reliability & Fencing Suite ===');
  await connectSafeTestDb();
  await Promise.all([
    Order.init(),
    Payment.init(),
    PaymentAttempt.init(),
    Product.init(),
    InventoryTransaction.init(),
    WorkerLock.init(),
  ]);

  const txSupported = isTransactionSupported(mongoose.connection);
  if (!txSupported) {
    console.error('BLOCKED: Phase 4 transactional fencing tests require a MongoDB Replica Set.');
    await mongoose.disconnect().catch(() => {});
    process.exit(2);
  }

  const userId = new mongoose.Types.ObjectId();
  const createdOrderIds: mongoose.Types.ObjectId[] = [];
  const createdProductIds: mongoose.Types.ObjectId[] = [];
  const createdLockNames: string[] = [];

  const origGetClient = razorpayProvider.getClient;
  const origRenew = RecoveryCoordinatorService.renewWorkerLease;

  try {
    // ── Test 1: Lease expiry & stale fencing token rejection ──────────────────
    const lock1 = `TEST_LOCK_FENCE_${Date.now()}`;
    createdLockNames.push(lock1);

    const leaseA = await RecoveryCoordinatorService.acquireWorkerLease(lock1, 'worker-A', 150);
    check(leaseA.acquired && leaseA.fencingToken === 1, 'P4.1 Worker A acquires lock with fencingToken=1');

    // Competing worker cannot steal active lease
    const leaseBlocked = await RecoveryCoordinatorService.acquireWorkerLease(lock1, 'worker-B', 500);
    check(!leaseBlocked.acquired, 'P4.2 Worker B cannot acquire lock while Worker A lease is active');

    // Wait for lease to expire
    await sleep(220);

    // Expired lease cannot be renewed by Worker A
    const renewedAfterExpiry = await RecoveryCoordinatorService.renewWorkerLease(
      lock1,
      'worker-A',
      leaseA.fencingToken!,
      500
    );
    check(!renewedAfterExpiry, 'P4.3 Expired lease cannot be renewed by stale owner');

    // Worker B steals expired lock and gets incremented fencingToken = 2
    const leaseB = await RecoveryCoordinatorService.acquireWorkerLease(lock1, 'worker-B', 2000);
    check(
      leaseB.acquired && leaseB.fencingToken === 2,
      `P4.4 Worker B reclaims expired lock with incremented fencingToken (${leaseB.fencingToken})`
    );

    // Worker A with stale fencingToken=1 cannot release Worker B's lock
    const staleRelease = await RecoveryCoordinatorService.releaseWorkerLease(lock1, 'worker-A', 1);
    const lockAfterStaleRelease = await WorkerLock.findOne({ lockName: lock1 });
    check(
      !staleRelease &&
        lockAfterStaleRelease?.ownerId === 'worker-B' &&
        lockAfterStaleRelease?.fencingToken === 2 &&
        lockAfterStaleRelease.leaseExpiresAt.getTime() > Date.now(),
      'P4.5 Stale worker cannot release newer owner lock'
    );

    // Worker A with stale fencingToken=1 is fenced out of withRecoveryLeaseFence
    let staleFenceErr: any = null;
    let staleFnExecuted = false;
    try {
      await RecoveryCoordinatorService.withRecoveryLeaseFence(
        { lockName: lock1, ownerId: 'worker-A', fencingToken: 1, leaseDurationMs: 1000 },
        async () => {
          staleFnExecuted = true;
        }
      );
    } catch (err) {
      staleFenceErr = err;
    }
    check(
      staleFenceErr?.code === 'WORKER_LEASE_FENCED_OUT' && !staleFnExecuted,
      'P4.6 withRecoveryLeaseFence rejects stale fencing token before executing critical writes'
    );

    // ── Test 2: Heartbeat keeps lease alive across long work & handles renewal errors ──
    const lockHb = `TEST_LOCK_HB_${Date.now()}`;
    createdLockNames.push(lockHb);
    const leaseHb = await RecoveryCoordinatorService.acquireWorkerLease(lockHb, 'worker-hb', 240);
    const hb = RecoveryCoordinatorService.startWorkerLeaseHeartbeat(
      lockHb,
      'worker-hb',
      leaseHb.fencingToken!,
      240,
      { heartbeatIntervalMs: 70 }
    );
    await sleep(360); // Exceeds initial 240ms lease; heartbeat must keep it alive
    const hbLockDoc = await WorkerLock.findOne({ lockName: lockHb });
    check(
      !hb.hasLostLease() && Boolean(hbLockDoc && hbLockDoc.leaseExpiresAt.getTime() > Date.now()),
      'P4.7 Heartbeat renews WorkerLock continuously across work exceeding initial lease duration'
    );

    // Inject renewal failure (throws DB error) -> must mark lease lost without unhandled rejection
    let lostCallbackFired = false;
    hb.stop();
    const hbErr = RecoveryCoordinatorService.startWorkerLeaseHeartbeat(
      lockHb,
      'worker-hb',
      leaseHb.fencingToken!,
      300,
      {
        heartbeatIntervalMs: 60,
        onLeaseLost: () => {
          lostCallbackFired = true;
        },
      }
    );
    RecoveryCoordinatorService.renewWorkerLease = async () => {
      throw new Error('Injected transient DB failure during lease renewal');
    };
    try {
      const ok = await hbErr.renewNow();
      check(
        ok === false && hbErr.hasLostLease() && lostCallbackFired,
        'P4.8 Renewal error marks lease lost cleanly and invokes onLeaseLost without throwing unhandled rejection'
      );
    } finally {
      hbErr.stop();
      RecoveryCoordinatorService.renewWorkerLease = origRenew;
    }

    // ── Test 3: withRecoveryLeaseFence aborts transaction if lease expires during fn ──
    const lockPreCommit = `TEST_LOCK_PRECOMMIT_${Date.now()}`;
    createdLockNames.push(lockPreCommit);
    const leasePre = await RecoveryCoordinatorService.acquireWorkerLease(lockPreCommit, 'worker-pre', 150);

    const { product, productId, variantIds } = await createTestProduct({
      name: 'Fence Test Tee',
      basePrice: 500,
      variants: [{ size: 'M', color: 'BLACK', stock: 10 }],
    });
    createdProductIds.push(product._id);
    const variantId = variantIds[0];

    const tempOrder = await Order.create({
      orderNumber: `FENCE-ROLLBACK-${Date.now()}`,
      userId,
      items: [
        {
          productId: new mongoose.Types.ObjectId(productId),
          variantId: new mongoose.Types.ObjectId(variantId),
          productName: 'Fence Test Tee',
          productImage: 'https://example.com/t.jpg',
          selectedSize: 'M',
          selectedColor: 'BLACK',
          quantity: 1,
          unitPrice: 500,
          lineTotal: 500,
          isCustomized: false,
        },
      ],
      shippingAddress: {
        fullName: 'Fence User',
        phone: '9876543210',
        addressLine1: 'Road 1',
        city: 'Pune',
        state: 'MH',
        postalCode: '411001',
        country: 'India',
      },
      subtotal: 500,
      discount: 0,
      shipping: 0,
      tax: 0,
      total: 500,
      currency: 'INR',
      status: 'PENDING',
      paymentStatus: 'PENDING',
    });
    createdOrderIds.push(tempOrder._id as mongoose.Types.ObjectId);

    let preCommitFenceErr: any = null;
    try {
      await RecoveryCoordinatorService.withRecoveryLeaseFence(
        {
          lockName: lockPreCommit,
          ownerId: 'worker-pre',
          fencingToken: leasePre.fencingToken!,
          leaseDurationMs: 120,
        },
        async (session) => {
          await Order.updateOne({ _id: tempOrder._id }, { $set: { paymentStatus: 'PAID' } }, { session });
          await sleep(180); // Lease expires before commit!
        }
      );
    } catch (err) {
      preCommitFenceErr = err;
    }
    const tempOrderAfter = await Order.findById(tempOrder._id);
    check(
      preCommitFenceErr?.code === 'WORKER_LEASE_FENCED_OUT' && tempOrderAfter?.paymentStatus === 'PENDING',
      'P4.9 withRecoveryLeaseFence aborts transaction and rolls back writes when lease expires during fn'
    );

    // ── Test 4: reconcileCapturedPayment ownership loss before tx & before commit ──
    const createReconcileFixture = async (label: string) => {
      const order = await Order.create({
        orderNumber: `REC-LOCK-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        userId,
        items: [
          {
            productId: new mongoose.Types.ObjectId(productId),
            variantId: new mongoose.Types.ObjectId(variantId),
            productName: 'Fence Test Tee',
            productImage: 'https://example.com/t.jpg',
            selectedSize: 'M',
            selectedColor: 'BLACK',
            quantity: 1,
            unitPrice: 500,
            lineTotal: 500,
            isCustomized: false,
          },
        ],
        shippingAddress: {
          fullName: 'Lock Tester',
          phone: '9876543210',
          addressLine1: 'Road 2',
          city: 'Pune',
          state: 'MH',
          postalCode: '411001',
          country: 'India',
        },
        subtotal: 500,
        discount: 0,
        shipping: 0,
        tax: 0,
        total: 500,
        currency: 'INR',
        status: 'PENDING',
        paymentStatus: 'FAILED',
      });
      createdOrderIds.push(order._id as mongoose.Types.ObjectId);
      createdLockNames.push(`RECONCILIATION_ORDER_${order._id.toString()}`);

      const payment = await Payment.create({
        orderId: order._id,
        userId,
        amount: 500,
        currency: 'INR',
        status: 'FAILED',
        provider: 'RAZORPAY',
      });

      const rzpOrderId = `order_lock_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const rzpPaymentId = `pay_lock_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const attempt = await PaymentAttempt.create({
        paymentId: payment._id,
        orderId: order._id,
        razorpayOrderId: rzpOrderId,
        amount: 500,
        currency: 'INR',
        status: 'FAILED',
        failureCode: 'GATEWAY_ERROR',
      });

      return { order, payment, attempt, rzpOrderId, rzpPaymentId };
    };

    const stubGateway = (orderId: mongoose.Types.ObjectId, rzpOrderId: string) => {
      razorpayProvider.getClient = (() => ({
        payments: {
          fetch: async (id: string) => ({
            id,
            entity: 'payment',
            order_id: rzpOrderId,
            amount: 50000,
            currency: 'INR',
            status: 'captured',
            captured: true,
          }),
        },
        orders: {
          fetch: async (id: string) => ({
            id,
            entity: 'order',
            amount: 50000,
            currency: 'INR',
            notes: { internalOrderId: orderId.toString() },
          }),
        },
      })) as any;
    };

    // 4A: Ownership lost before transaction start (another worker steals lock)
    const fStolen = await createReconcileFixture('STOLEN_PRE_TX');
    stubGateway(fStolen.order._id as mongoose.Types.ObjectId, fStolen.rzpOrderId);
    const lockNameStolen = `RECONCILIATION_ORDER_${fStolen.order._id.toString()}`;
    let stolenPreTxErr: any = null;
    try {
      await reconcileCapturedPayment({
        orderRef: fStolen.order.orderNumber,
        razorpayPaymentId: fStolen.rzpPaymentId,
        confirm: true,
        useExistingConnection: true,
        ownerId: 'reconcile-stale-worker',
        leaseDurationMs: 400,
        heartbeatIntervalMs: 1000, // don't auto-renew before simulated hijack
        hooks: {
          beforeTransactionStart: async () => {
            // Simulate lease expiry + takeover by newer worker
            await WorkerLock.updateOne(
              { lockName: lockNameStolen },
              { $set: { ownerId: 'reconcile-newer-worker', leaseExpiresAt: new Date(Date.now() + 60_000) }, $inc: { fencingToken: 1 } }
            );
          },
        },
      });
    } catch (err) {
      stolenPreTxErr = err;
    }
    const orderAfterPreTxLoss = await Order.findById(fStolen.order._id);
    const lockAfterPreTxLoss = await WorkerLock.findOne({ lockName: lockNameStolen });
    check(
      stolenPreTxErr?.code === 'WORKER_LEASE_FENCED_OUT' &&
        orderAfterPreTxLoss?.paymentStatus === 'FAILED' &&
        lockAfterPreTxLoss?.ownerId === 'reconcile-newer-worker' &&
        lockAfterPreTxLoss?.leaseExpiresAt.getTime() > Date.now(),
      'P4.10 Reconcile worker losing ownership aborts before writes and preserves newer owner lock'
    );

    // 4B: Lease expires right before commit inside reconcileCapturedPayment -> transaction aborts!
    const fBeforeCommit = await createReconcileFixture('EXPIRE_PRE_COMMIT');
    stubGateway(fBeforeCommit.order._id as mongoose.Types.ObjectId, fBeforeCommit.rzpOrderId);
    let preCommitRecErr: any = null;
    try {
      await reconcileCapturedPayment({
        orderRef: fBeforeCommit.order.orderNumber,
        razorpayPaymentId: fBeforeCommit.rzpPaymentId,
        confirm: true,
        useExistingConnection: true,
        ownerId: 'reconcile-slow-worker',
        leaseDurationMs: 150,
        hooks: {
          beforeCommit: async () => {
            await sleep(220); // Exceed lease duration before commit!
          },
        },
      });
    } catch (err) {
      preCommitRecErr = err;
    }
    const orderAfterSlowCommit = await Order.findById(fBeforeCommit.order._id);
    const prodAfterSlowCommit = await Product.findById(product._id);
    const stockAfterSlowCommit = prodAfterSlowCommit?.variants.find((v: any) => v._id.toString() === variantId)?.stock;
    check(
      preCommitRecErr?.code === 'WORKER_LEASE_FENCED_OUT' &&
        orderAfterSlowCommit?.paymentStatus === 'FAILED' &&
        orderAfterSlowCommit?.status === 'PENDING' &&
        stockAfterSlowCommit === 10,
      `P4.11 Slow reconcile worker whose lease expires before commit aborts tx and rolls back stock (stock=${stockAfterSlowCommit})`
    );

    // 4C: Competing workers racing to reconcile the same order
    const fRace = await createReconcileFixture('COMPETE');
    stubGateway(fRace.order._id as mongoose.Types.ObjectId, fRace.rzpOrderId);
    const [r1, r2] = await Promise.allSettled([
      reconcileCapturedPayment({
        orderRef: fRace.order.orderNumber,
        razorpayPaymentId: fRace.rzpPaymentId,
        confirm: true,
        useExistingConnection: true,
        ownerId: 'reconcile-competitor-1',
        hooks: {
          afterRecordReset: async () => {
            await sleep(120);
          },
        },
      }),
      (async () => {
        await sleep(30);
        return reconcileCapturedPayment({
          orderRef: fRace.order.orderNumber,
          razorpayPaymentId: fRace.rzpPaymentId,
          confirm: true,
          useExistingConnection: true,
          ownerId: 'reconcile-competitor-2',
        });
      })(),
    ]);
    const committedCount = [r1, r2].filter((r) => r.status === 'fulfilled' && r.value.committed === true).length;
    const lockRejectedCount = [r1, r2].filter(
      (r) => r.status === 'rejected' && (r.reason as any)?.code === 'LOCK_ACQUISITION_FAILED'
    ).length;
    const orderAfterRace = await Order.findById(fRace.order._id);
    const prodAfterRace = await Product.findById(product._id);
    const stockAfterRace = prodAfterRace?.variants.find((v: any) => v._id.toString() === variantId)?.stock;
    check(
      committedCount === 1 &&
        lockRejectedCount === 1 &&
        orderAfterRace?.status === 'CONFIRMED' &&
        orderAfterRace?.paymentStatus === 'PAID' &&
        stockAfterRace === 9,
      `P4.12 Competing workers: exactly 1 commits (${committedCount}), 1 rejected on lock (${lockRejectedCount}), stock deducted once (${stockAfterRace})`
    );

    // ── Test 5: Strict production/staging fail-closed for withRecoveryLeaseFence transactions ──
    const lockStrict = `TEST_LOCK_STRICT_TX_${Date.now()}`;
    createdLockNames.push(lockStrict);
    const leaseStrict = await RecoveryCoordinatorService.acquireWorkerLease(lockStrict, 'worker-strict', 5000);
    const origNodeEnv = process.env.NODE_ENV;
    const origStartSession = mongoose.startSession;

    try {
      for (const strictEnv of ['production', 'staging'] as const) {
        process.env.NODE_ENV = strictEnv;

        // 5A: Transaction startup failure in strict env MUST fail closed without invoking callback and end session
        const tracker = { callbackInvoked: false, sessionEnded: false };
        (mongoose as any).startSession = async () => ({
          startTransaction: () => {
            const err: any = new Error('Transaction numbers are only allowed on a replica set member or mongos');
            err.code = 20;
            throw err;
          },
          inTransaction: () => false,
          abortTransaction: async () => {},
          commitTransaction: async () => {},
          endSession: async () => {
            tracker.sessionEnded = true;
          },
        });

        let strictTxStartErr: any = null;
        try {
          await RecoveryCoordinatorService.withRecoveryLeaseFence(
            {
              lockName: lockStrict,
              ownerId: 'worker-strict',
              fencingToken: leaseStrict.fencingToken!,
              leaseDurationMs: 5000,
            },
            async () => {
              tracker.callbackInvoked = true;
            }
          );
        } catch (err) {
          strictTxStartErr = err;
        }
        check(
          strictTxStartErr?.code === 'RECOVERY_TRANSACTION_STARTUP_FAILED' &&
            tracker.callbackInvoked === false &&
            tracker.sessionEnded === true &&
            RecoveryCoordinatorService.isFencedTransactionActive === false,
          `P4.13 (${strictEnv}) withRecoveryLeaseFence fails closed on transaction startup failure without invoking callback`
        );

        // 5B: Non-transactional existingSession in strict env MUST fail closed without invoking callback
        (mongoose as any).startSession = origStartSession;
        const outerTracker = { callbackInvoked: false };
        let outerStrictErr: any = null;
        try {
          await RecoveryCoordinatorService.withRecoveryLeaseFence(
            {
              lockName: lockStrict,
              ownerId: 'worker-strict',
              fencingToken: leaseStrict.fencingToken!,
              leaseDurationMs: 5000,
              existingSession: {
                inTransaction: () => false,
              } as any,
            },
            async () => {
              outerTracker.callbackInvoked = true;
            }
          );
        } catch (err) {
          outerStrictErr = err;
        }
        check(
          outerStrictErr?.code === 'RECOVERY_TRANSACTION_REQUIRED' &&
            outerTracker.callbackInvoked === false,
          `P4.14 (${strictEnv}) withRecoveryLeaseFence rejects non-transactional existingSession without invoking callback`
        );
      }

      // 5C: Non-strict local development preserves standalone fallback compatibility
      process.env.NODE_ENV = 'development';
      const devTracker = { callbackInvoked: false, sessionEnded: false };
      (mongoose as any).startSession = async () => ({
        startTransaction: () => {
          const err: any = new Error('Transaction numbers are only allowed on a replica set member or mongos');
          err.code = 20;
          throw err;
        },
        inTransaction: () => false,
        abortTransaction: async () => {},
        commitTransaction: async () => {},
        endSession: async () => {
          devTracker.sessionEnded = true;
        },
      });
      await RecoveryCoordinatorService.withRecoveryLeaseFence(
        {
          lockName: lockStrict,
          ownerId: 'worker-strict',
          fencingToken: leaseStrict.fencingToken!,
          leaseDurationMs: 5000,
        },
        async () => {
          devTracker.callbackInvoked = true;
        }
      );
      check(
        devTracker.callbackInvoked === true && devTracker.sessionEnded === true,
        'P4.15 Local development preserves standalone fallback compatibility when replica set is unavailable'
      );
    } finally {
      process.env.NODE_ENV = origNodeEnv;
      (mongoose as any).startSession = origStartSession;
    }
  } finally {
    razorpayProvider.getClient = origGetClient;
    RecoveryCoordinatorService.renewWorkerLease = origRenew;
    if (createdLockNames.length > 0) {
      await WorkerLock.deleteMany({ lockName: { $in: createdLockNames } });
    }
    if (createdOrderIds.length > 0) {
      await InventoryTransaction.deleteMany({ orderId: { $in: createdOrderIds } });
      await PaymentAttempt.deleteMany({ orderId: { $in: createdOrderIds } });
      await Payment.deleteMany({ orderId: { $in: createdOrderIds } });
      await Order.deleteMany({ _id: { $in: createdOrderIds } });
    }
    if (createdProductIds.length > 0) {
      await Product.deleteMany({ _id: { $in: createdProductIds } });
    }
    await mongoose.disconnect().catch(() => {});
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error('Failures:\n - ' + failures.join('\n - '));
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Unhandled error in worker-lock-fencing test:', err);
  process.exit(1);
});
