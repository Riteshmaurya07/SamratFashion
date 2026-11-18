/**
 * Phase 5 Concurrency & Invariant Suite: Payment Settlement vs. Order Expiry
 *
 * Deterministically verifies all 7 safety invariants:
 *  1. An order cannot become PAID without verified captured-payment evidence.
 *  2. An expired or cancelled order cannot silently become a successful order.
 *  3. A genuine late payment capture must not be discarded or left untracked.
 *  4. Late captures must follow the existing safe refund or reconciliation workflow.
 *  5. Expiry must not incorrectly fail an attempt actively being processed.
 *  6. Concurrent workers must not create inconsistent payment/order states.
 *  7. Recovery retries must not create duplicate settlements or refunds.
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
import { WebhookEvent } from '../models/WebhookEvent';
import {
  expireStalePendingOrders,
  reconcilePendingExpiryCleanups,
  ORDER_EXPIRY_MS,
  GatewayPaymentVerification,
} from '../services/orderExpiryService';
import { processPaymentSuccess } from '../services/payment/paymentProcessor';
import { isTransactionSupported } from '../services/coupon/couponReservationService';
import { RecoveryCoordinatorService } from '../services/recovery/recoveryCoordinatorService';
import '../models/Cart';
import '../models/User';
import { Refund } from '../models/Refund';
import { DuplicateCaptureRefund } from '../models/DuplicateCaptureRefund';

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

function verifierFor(
  state: GatewayPaymentVerification['state'],
  reason = `synthetic ${state}`,
  onlyOrderId?: string
) {
  return async (params: {
    orderId: string;
    razorpayOrderIds: string[];
  }): Promise<GatewayPaymentVerification> => {
    if (onlyOrderId && params.orderId !== onlyOrderId) {
      return {
        state: 'IN_FLIGHT',
        razorpayOrderIds: params.razorpayOrderIds,
        reason: 'unrelated test order ignored',
      };
    }
    return {
      state,
      razorpayOrderIds: params.razorpayOrderIds,
      reason,
    };
  };
}

async function run() {
  console.log('=== Phase 5: Payment & Order Expiry Concurrency Suite ===');
  await connectSafeTestDb();
  await Promise.all([
    Order.init(),
    Payment.init(),
    PaymentAttempt.init(),
    Product.init(),
    InventoryTransaction.init(),
    WorkerLock.init(),
    WebhookEvent.init(),
  ]);

  const txSupported = isTransactionSupported(mongoose.connection);
  console.log(`  (MongoDB transaction support active: ${txSupported})`);

  const userId = new mongoose.Types.ObjectId();
  const createdOrderIds: mongoose.Types.ObjectId[] = [];
  const createdProductIds: mongoose.Types.ObjectId[] = [];
  const createdLockNames: string[] = [];
  const createdWebhookEventIds: string[] = [];

  try {
    const createProductAndStaleOrder = async (label: string, initialStock = 10) => {
      const { product, productId, variantIds } = await createTestProduct({
        name: `Expiry Conc Tee ${label}`,
        basePrice: 600,
        variants: [{ size: 'M', color: 'BLACK', stock: initialStock }],
      });
      createdProductIds.push(product._id);
      const variantId = variantIds[0];

      const order = await Order.create({
        orderNumber: `EXP-CONC-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        userId,
        items: [
          {
            productId: new mongoose.Types.ObjectId(productId),
            variantId: new mongoose.Types.ObjectId(variantId),
            productName: `Expiry Conc Tee ${label}`,
            productImage: 'https://example.com/tee.jpg',
            selectedSize: 'M',
            selectedColor: 'BLACK',
            quantity: 2,
            unitPrice: 600,
            lineTotal: 1200,
            isCustomized: false,
          },
        ],
        shippingAddress: {
          fullName: 'Concurrency Tester',
          phone: '9876543210',
          addressLine1: '10 Race Ave',
          city: 'Bengaluru',
          state: 'Karnataka',
          postalCode: '560001',
          country: 'India',
        },
        subtotal: 1200,
        discount: 0,
        shipping: 0,
        tax: 0,
        total: 1200,
        currency: 'INR',
        status: 'PENDING',
        paymentStatus: 'PENDING',
      });
      createdOrderIds.push(order._id as mongoose.Types.ObjectId);

      const staleDate = new Date(Date.now() - ORDER_EXPIRY_MS - 120_000);
      await Order.collection.updateOne(
        { _id: order._id },
        { $set: { createdAt: staleDate, updatedAt: staleDate } }
      );

      const payment = await Payment.create({
        orderId: order._id,
        userId,
        amount: 1200,
        currency: 'INR',
        status: 'PENDING',
        provider: 'RAZORPAY',
      });

      const rzpOrderId = `order_expc_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const rzpPaymentId = `pay_expc_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const attempt = await PaymentAttempt.create({
        paymentId: payment._id,
        orderId: order._id,
        razorpayOrderId: rzpOrderId,
        amount: 1200,
        currency: 'INR',
        status: 'PENDING',
      });

      const getStock = async () => {
        const p = await Product.findById(product._id);
        return p?.variants.find((v: any) => v._id.toString() === variantId)?.stock;
      };

      return { product, variantId, order, payment, attempt, rzpOrderId, rzpPaymentId, getStock };
    };

    // ── 1. Capture immediately BEFORE expiry ──────────────────────────────────
    const fBefore = await createProductAndStaleOrder('BEFORE', 10);
    const expBefore = await expireStalePendingOrders({
      verifyGatewayPaymentState: verifierFor('CAPTURED', 'captured right before expiry', fBefore.order._id.toString()),
    });
    const orderBefore = await Order.findById(fBefore.order._id);
    const payBefore = await Payment.findById(fBefore.payment._id);
    check(
      expBefore.expired === 0 &&
        expBefore.skippedCaptured >= 1 &&
        orderBefore?.status === 'PENDING' &&
        payBefore?.reconciliationRequired === true,
      'P5.1 Capture immediately before expiry refuses expiry and flags Payment for reconciliation'
    );
    const settleBefore = await processPaymentSuccess(fBefore.rzpOrderId, fBefore.rzpPaymentId);
    const orderBeforeSettled = await Order.findById(fBefore.order._id);
    check(
      settleBefore?.success === true &&
        orderBeforeSettled?.status === 'CONFIRMED' &&
        orderBeforeSettled?.paymentStatus === 'PAID' &&
        (await fBefore.getStock()) === 8,
      'P5.1b Subsequent capture settlement confirms order cleanly and deducts stock once'
    );

    // ── 2. Capture DURING expiry (Race A: payment claims & settles while expiry is about to write) ──
    const fDuringA = await createProductAndStaleOrder('DURING_A', 10);
    let paymentPromiseA: Promise<any> | null = null;
    const expDuringA = await expireStalePendingOrders({
      verifyGatewayPaymentState: verifierFor('UNPAID', 'gateway still reported unpaid at check time', fDuringA.order._id.toString()),
      onBeforeAtomicExpiry: async (oid) => {
        if (oid === fDuringA.order._id.toString()) {
          // Payment capture arrives and settles BEFORE atomic expiry transition runs!
          paymentPromiseA = processPaymentSuccess(fDuringA.rzpOrderId, fDuringA.rzpPaymentId);
          await paymentPromiseA;
        }
      },
    });
    const orderDuringA = await Order.findById(fDuringA.order._id);
    const attDuringA = await PaymentAttempt.findById(fDuringA.attempt._id);
    check(
      expDuringA.expired === 0 &&
        orderDuringA?.status === 'CONFIRMED' &&
        orderDuringA?.paymentStatus === 'PAID' &&
        attDuringA?.status === 'CAPTURED' &&
        (await fDuringA.getStock()) === 8,
      `P5.2 Capture during expiry (settled before atomic expiry) wins cleanly without corruption (order=${orderDuringA?.status}, att=${attDuringA?.status}, expired=${expDuringA.expired})`
    );

    // ── 3. Capture DURING expiry (Race B: order expires while payment is mid-settlement before Order confirm) ──
    // THIS WAS THE REPRODUCED P0 RACE CONDITION!
    const fDuringB = await createProductAndStaleOrder('DURING_B', 10);
    const resDuringB = await processPaymentSuccess(fDuringB.rzpOrderId, fDuringB.rzpPaymentId, {
      beforeOrderConfirm: async () => {
        // Simulate concurrent order expiry/cancellation winning the Order transition right before Order confirm!
        await Order.updateOne(
          { _id: fDuringB.order._id },
          { $set: { status: 'EXPIRED', paymentStatus: 'FAILED' } }
        );
      },
    });
    const orderDuringB = await Order.findById(fDuringB.order._id);
    const attDuringB = await PaymentAttempt.findById(fDuringB.attempt._id);
    const payDuringB = await Payment.findById(fDuringB.payment._id);
    const stockDuringB = await fDuringB.getStock();
    check(
      resDuringB?.success === false &&
        resDuringB?.reason === 'ORDER_CANCELLED' &&
        orderDuringB?.status === 'EXPIRED' &&
        orderDuringB?.paymentStatus === 'FAILED',
      `P5.3 Order expired mid-settlement NEVER becomes PAID/CONFIRMED (order=${orderDuringB?.status}/${orderDuringB?.paymentStatus}, reason=${resDuringB?.reason})`
    );
    check(
      attDuringB?.status === 'CAPTURED' &&
        attDuringB?.razorpayPaymentId === fDuringB.rzpPaymentId &&
        payDuringB?.status === 'CAPTURED' &&
        payDuringB?.razorpayPaymentId === fDuringB.rzpPaymentId &&
        payDuringB?.reconciliationRequired === true &&
        stockDuringB === 10,
      `P5.3b Late capture during expiry is tracked for refund reconciliation & inventory rolled back (att=${attDuringB?.status}, pay=${payDuringB?.status}, recon=${payDuringB?.reconciliationRequired}, stock=${stockDuringB})`
    );

    // Retry of the same late capture on EXPIRED order must remain idempotent (no duplicate settlement/refund)
    const retryDuringB = await processPaymentSuccess(fDuringB.rzpOrderId, fDuringB.rzpPaymentId);
    check(
      retryDuringB?.success === false &&
        retryDuringB?.reason === 'ORDER_CANCELLED' &&
        (await fDuringB.getStock()) === 10,
      'P5.3c Retry after late capture on expired order is idempotent (stock untouched)'
    );

    // ── 4. Capture AFTER expiry ───────────────────────────────────────────────
    const fAfter = await createProductAndStaleOrder('AFTER', 10);
    const expAfter = await expireStalePendingOrders({
      verifyGatewayPaymentState: verifierFor('UNPAID', 'unpaid after', fAfter.order._id.toString()),
    });
    check(expAfter.expired === 1, 'P5.4 Stale unpaid order expires cleanly');

    const lateCaptureAfter = await processPaymentSuccess(fAfter.rzpOrderId, fAfter.rzpPaymentId);
    const orderAfter = await Order.findById(fAfter.order._id);
    const attAfter = await PaymentAttempt.findById(fAfter.attempt._id);
    const payAfter = await Payment.findById(fAfter.payment._id);
    check(
      lateCaptureAfter?.success === false &&
        lateCaptureAfter?.reason === 'ORDER_CANCELLED' &&
        orderAfter?.status === 'EXPIRED' &&
        orderAfter?.paymentStatus === 'FAILED' &&
        attAfter?.status === 'CAPTURED' &&
        attAfter?.razorpayPaymentId === fAfter.rzpPaymentId &&
        payAfter?.status === 'CAPTURED' &&
        payAfter?.razorpayPaymentId === fAfter.rzpPaymentId &&
        payAfter?.reconciliationRequired === true &&
        (await fAfter.getStock()) === 10,
      'P5.4b Late capture after expiry keeps order EXPIRED, leaves stock untouched, and tracks capture for refund reconciliation'
    );

    // ── 5. Expiry MUST NOT fail an attempt actively being processed ───────────
    const fActive = await createProductAndStaleOrder('ACTIVE_PROC', 10);
    // Simulate attempt actively claimed in PROCESSING right after candidate query / before atomic expiry
    const expActive = await expireStalePendingOrders({
      verifyGatewayPaymentState: verifierFor('UNPAID', 'unpaid active', fActive.order._id.toString()),
      onBeforeAtomicExpiry: async (oid) => {
        if (oid === fActive.order._id.toString()) {
          await PaymentAttempt.updateOne(
            { _id: fActive.attempt._id },
            {
              $set: {
                status: 'PROCESSING',
                claimToken: 'active_worker_claim',
                claimExpiresAt: new Date(Date.now() + 60_000),
              },
            }
          );
        }
      },
    });
    const orderActive = await Order.findById(fActive.order._id);
    const attActive = await PaymentAttempt.findById(fActive.attempt._id);
    check(
      expActive.expired === 0 &&
        expActive.skippedInFlight >= 1 &&
        orderActive?.status === 'PENDING' &&
        attActive?.status === 'PROCESSING',
      `P5.5 Expiry refuses to expire or fail an attempt actively in PROCESSING (order=${orderActive?.status}, att=${attActive?.status})`
    );
    // Cleanly release the synthetic PROCESSING attempt so it doesn't interfere with later sweeps
    await Order.updateOne({ _id: fActive.order._id }, { $set: { status: 'CANCELLED' } });

    // ── 6. Gateway UNKNOWN & IN_FLIGHT states fail closed ─────────────────────
    const fUnknown = await createProductAndStaleOrder('UNKNOWN', 10);
    const expUnknown = await expireStalePendingOrders({
      verifyGatewayPaymentState: async () => {
        throw new Error('Synthetic Razorpay ETIMEDOUT');
      },
    });
    const orderUnknown = await Order.findById(fUnknown.order._id);
    const attUnknown = await PaymentAttempt.findById(fUnknown.attempt._id);
    check(
      expUnknown.expired === 0 &&
        expUnknown.skippedUnverified >= 1 &&
        expUnknown.errors.length >= 1 &&
        orderUnknown?.status === 'PENDING' &&
        attUnknown?.status === 'PENDING',
      'P5.6 Gateway UNKNOWN / thrown error fails closed without expiring order or failing attempt'
    );
    const expInFlight = await expireStalePendingOrders({
      verifyGatewayPaymentState: verifierFor('IN_FLIGHT', 'authorized payment pending capture'),
    });
    const orderInFlight = await Order.findById(fUnknown.order._id);
    check(
      expInFlight.expired === 0 &&
        expInFlight.skippedInFlight >= 1 &&
        orderInFlight?.status === 'PENDING',
      'P5.6b Gateway IN_FLIGHT state refuses expiry and leaves order PENDING'
    );
    await Order.updateOne({ _id: fUnknown.order._id }, { $set: { status: 'CANCELLED' } });

    // ── 7. Stale worker fenced out after slow gateway verification ────────────
    const fFenced = await createProductAndStaleOrder('FENCED', 10);
    const lockName = `TEST_EXPIRY_FENCE_${Date.now()}`;
    createdLockNames.push(lockName);
    const lease = await RecoveryCoordinatorService.acquireWorkerLease(lockName, 'expiry-worker-1', 150);
    let leaseStillHeld = true;
    const expFenced = await expireStalePendingOrders({
      verifyGatewayPaymentState: async (params) => {
        // Simulate losing leadership while waiting on slow gateway call
        await WorkerLock.updateOne(
          { lockName },
          { $set: { ownerId: 'expiry-worker-2', leaseExpiresAt: new Date(Date.now() + 60_000) }, $inc: { fencingToken: 1 } }
        );
        leaseStillHeld = false;
        return { state: 'UNPAID', razorpayOrderIds: params.razorpayOrderIds };
      },
      leaseGuard: () => leaseStillHeld,
      withFence: (fn) =>
        RecoveryCoordinatorService.withRecoveryLeaseFence(
          { lockName, ownerId: 'expiry-worker-1', fencingToken: lease.fencingToken!, leaseDurationMs: 150 },
          fn
        ),
    });
    const orderFenced = await Order.findById(fFenced.order._id);
    check(
      expFenced.expired === 0 &&
        expFenced.errors.length >= 1 &&
        orderFenced?.status === 'PENDING',
      'P5.7 Stale worker losing lease during slow gateway check aborts without expiring order'
    );
    await Order.updateOne({ _id: fFenced.order._id }, { $set: { status: 'CANCELLED' } });

    // ── 8. Simultaneous competing workers (expiry x 4 + payment x 2) ──────────
    const fSimul = await createProductAndStaleOrder('SIMUL', 10);
    const simulVerifier = verifierFor('UNPAID', 'unpaid simul', fSimul.order._id.toString());
    await Promise.allSettled([
      expireStalePendingOrders({ verifyGatewayPaymentState: simulVerifier }),
      expireStalePendingOrders({ verifyGatewayPaymentState: simulVerifier }),
      processPaymentSuccess(fSimul.rzpOrderId, fSimul.rzpPaymentId),
      processPaymentSuccess(fSimul.rzpOrderId, fSimul.rzpPaymentId),
      expireStalePendingOrders({ verifyGatewayPaymentState: simulVerifier }),
      expireStalePendingOrders({ verifyGatewayPaymentState: simulVerifier }),
    ]);
    const orderSimul = await Order.findById(fSimul.order._id);
    const attSimul = await PaymentAttempt.findById(fSimul.attempt._id);
    const paySimul = await Payment.findById(fSimul.payment._id);
    const stockSimul = await fSimul.getStock();
    const isConsistentConfirmed =
      orderSimul?.status === 'CONFIRMED' &&
      orderSimul?.paymentStatus === 'PAID' &&
      attSimul?.status === 'CAPTURED' &&
      paySimul?.status === 'CAPTURED' &&
      stockSimul === 8;
    const isConsistentExpiredWithTrackedCapture =
      orderSimul?.status === 'EXPIRED' &&
      orderSimul?.paymentStatus === 'FAILED' &&
      attSimul?.status === 'CAPTURED' &&
      paySimul?.status === 'CAPTURED' &&
      paySimul?.reconciliationRequired === true &&
      stockSimul === 10;
    check(
      isConsistentConfirmed || isConsistentExpiredWithTrackedCapture,
      `P5.8 Simultaneous competing expiry + payment workers always converge to a strictly consistent state ` +
        `(order=${orderSimul?.status}/${orderSimul?.paymentStatus}, att=${attSimul?.status}, pay=${paySimul?.status}, recon=${paySimul?.reconciliationRequired}, stock=${stockSimul})`
    );

    // ── 9. Worker interruption & idempotent retry after partial expiry cleanup ──
    const fPartial = await createProductAndStaleOrder('PARTIAL_CLEANUP', 10);
    // Simulate a SALE ledger residue (stock reduced 10 -> 8) + order expired with incomplete cleanup
    await Product.updateOne(
      { _id: fPartial.product._id, 'variants._id': new mongoose.Types.ObjectId(fPartial.variantId) },
      { $inc: { 'variants.$.stock': -2 } }
    );
    await InventoryTransaction.create({
      orderId: fPartial.order._id,
      productId: fPartial.product._id,
      variantId: new mongoose.Types.ObjectId(fPartial.variantId),
      type: 'SALE',
      quantity: 2,
      status: 'COMPLETED',
    });
    await Order.updateOne(
      { _id: fPartial.order._id },
      {
        $set: {
          status: 'EXPIRED',
          paymentStatus: 'FAILED',
          expiryCleanup: {
            inventoryRestored: false,
            couponReleased: false,
            cleanupRequired: true,
            lastAttemptAt: new Date(Date.now() - 60_000),
          },
        },
      }
    );
    const rec1 = await reconcilePendingExpiryCleanups({ batchLimit: 20 });
    const rec2 = await reconcilePendingExpiryCleanups({ batchLimit: 20 });
    const orderPartial = await Order.findById(fPartial.order._id);
    const stockPartial = await fPartial.getStock();
    check(
      rec1.cleanedCount >= 1 &&
        rec2.cleanedCount === 0 &&
        orderPartial?.expiryCleanup?.cleanupRequired === false &&
        orderPartial?.expiryCleanup?.inventoryRestored === true &&
        orderPartial?.expiryCleanup?.couponReleased === true &&
        stockPartial === 10,
      `P5.9 Interrupted expiry cleanup recovers cleanly and retries are idempotent (stock=${stockPartial}, rec1=${rec1.cleanedCount}, rec2=${rec2.cleanedCount})`
    );

    // ── 10. Atomic late-capture recording: failure injection + clean rollback + successful retry ──
    const fLateAtom = await createProductAndStaleOrder('LATE_ATOM', 10);
    let lateFailErr: any = null;
    try {
      await processPaymentSuccess(fLateAtom.rzpOrderId, fLateAtom.rzpPaymentId, {
        beforeOrderConfirm: async () => {
          await Order.updateOne(
            { _id: fLateAtom.order._id },
            { $set: { status: 'EXPIRED', paymentStatus: 'FAILED' } }
          );
        },
        beforeLateCapturePaymentRecord: async () => {
          throw new Error('Injected DB failure between PaymentAttempt and Payment late-capture writes');
        },
      });
    } catch (err) {
      lateFailErr = err;
    }

    const orderAfterLateFail = await Order.findById(fLateAtom.order._id);
    const attAfterLateFail = await PaymentAttempt.findById(fLateAtom.attempt._id);
    const payAfterLateFail = await Payment.findById(fLateAtom.payment._id);
    const stockAfterLateFail = await fLateAtom.getStock();
    if (txSupported) {
      check(
        Boolean(lateFailErr) &&
          orderAfterLateFail?.status === 'EXPIRED' &&
          orderAfterLateFail?.paymentStatus === 'FAILED' &&
          attAfterLateFail?.status !== 'CAPTURED' &&
          payAfterLateFail?.status === 'PENDING' &&
          !payAfterLateFail?.razorpayPaymentId &&
          stockAfterLateFail === 10,
        `P5.10 Failure during late-capture recording aborts atomically without contradictory PaymentAttempt/Payment state ` +
          `(att=${attAfterLateFail?.status}, pay=${payAfterLateFail?.status}, stock=${stockAfterLateFail})`
      );
    } else {
      check(
        Boolean(lateFailErr) && orderAfterLateFail?.status === 'EXPIRED' && stockAfterLateFail === 10,
        'P5.10 Failure during late-capture recording reports failure and keeps order EXPIRED / stock intact (standalone mode)'
      );
    }

    // Retry after failed late-capture recording MUST atomically record BOTH PaymentAttempt and Payment for reconciliation
    const lateRetryRes = await processPaymentSuccess(fLateAtom.rzpOrderId, fLateAtom.rzpPaymentId);
    const orderAfterLateRetry = await Order.findById(fLateAtom.order._id);
    const attAfterLateRetry = await PaymentAttempt.findById(fLateAtom.attempt._id);
    const payAfterLateRetry = await Payment.findById(fLateAtom.payment._id);
    const stockAfterLateRetry = await fLateAtom.getStock();
    check(
      lateRetryRes?.success === false &&
        lateRetryRes?.reason === 'ORDER_CANCELLED' &&
        orderAfterLateRetry?.status === 'EXPIRED' &&
        orderAfterLateRetry?.paymentStatus === 'FAILED' &&
        attAfterLateRetry?.status === 'CAPTURED' &&
        attAfterLateRetry?.razorpayPaymentId === fLateAtom.rzpPaymentId &&
        payAfterLateRetry?.status === 'CAPTURED' &&
        payAfterLateRetry?.razorpayPaymentId === fLateAtom.rzpPaymentId &&
        payAfterLateRetry?.reconciliationRequired === true &&
        stockAfterLateRetry === 10,
      `P5.10b Retry after failed late-capture recording atomically records PaymentAttempt & Payment as CAPTURED with reconciliationRequired=true (stock=${stockAfterLateRetry})`
    );

    // Repeated execution after successful late-capture recording MUST be idempotent and never overwrite with a distinct ID
    const lateRetryAgain = await processPaymentSuccess(fLateAtom.rzpOrderId, fLateAtom.rzpPaymentId);
    const distinctLateId = `pay_distinct_late_${Date.now()}`;
    await processPaymentSuccess(fLateAtom.rzpOrderId, distinctLateId);
    const payAfterDistinctLate = await Payment.findById(fLateAtom.payment._id);
    check(
      lateRetryAgain?.success === false &&
        lateRetryAgain?.reason === 'ORDER_CANCELLED' &&
        payAfterDistinctLate?.razorpayPaymentId === fLateAtom.rzpPaymentId &&
        (await fLateAtom.getStock()) === 10,
      'P5.10c Repeated late-capture recording is idempotent and preserves original captured payment ID'
    );

    // ── 11. Integration test: Late captured payment inside caller-owned MongoDB transaction + webhook inbox replay ──
    if (!txSupported) {
      check(false, 'P5.11 Caller-owned transaction late-capture test requires a MongoDB replica set');
    } else {
      const fCallerTx = await createProductAndStaleOrder('CALLER_TX_LATE', 10);
      const webhookEventId = `evt_caller_tx_late_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      createdWebhookEventIds.push(webhookEventId);

      // Persist durable webhook event in FAILED state (simulating an inbox event that failed when caller tx aborted)
      await WebhookEvent.create({
        eventId: webhookEventId,
        provider: 'RAZORPAY',
        eventType: 'payment.captured',
        status: 'FAILED',
        processingAttempts: 1,
        processingLockExpiresAt: new Date(0),
        payload: {
          event: 'payment.captured',
          event_id: webhookEventId,
          payload: {
            payment: {
              entity: {
                id: fCallerTx.rzpPaymentId,
                order_id: fCallerTx.rzpOrderId,
                amount: 120000,
                currency: 'INR',
                status: 'captured',
                captured: true,
              },
            },
          },
        },
      });

      // Step 1 & 2: Start active caller-owned transaction; Order becomes EXPIRED concurrently mid-settlement
      const callerSession = await mongoose.startSession();
      let callerTxErr: any = null;
      let commitAfterAbortBlocked = false;
      let sessionStillInTx = true;
      try {
        callerSession.startTransaction({
          readConcern: { level: 'snapshot' },
          writeConcern: { w: 'majority' },
        });

        try {
          await processPaymentSuccess(fCallerTx.rzpOrderId, fCallerTx.rzpPaymentId, {
            session: callerSession,
            beforeOrderConfirm: async () => {
              // Concurrent expiry updates Order outside the caller-owned transaction
              await Order.updateOne(
                { _id: fCallerTx.order._id },
                { $set: { status: 'EXPIRED', paymentStatus: 'FAILED' } }
              );
            },
          });
        } catch (err) {
          callerTxErr = err;
        }

        sessionStillInTx = callerSession.inTransaction();
        try {
          await callerSession.commitTransaction();
        } catch {
          commitAfterAbortBlocked = true;
        }
      } finally {
        if (callerSession.inTransaction()) {
          await callerSession.abortTransaction().catch(() => {});
        }
        await callerSession.endSession().catch(() => {});
      }

      // Step 3 & 4: Verify invalid PAID/CONFIRMED state was NOT committed, caller tx was aborted safely, stock rolled back
      const orderAfterCallerAbort = await Order.findById(fCallerTx.order._id);
      const attAfterCallerAbort = await PaymentAttempt.findById(fCallerTx.attempt._id);
      const payAfterCallerAbort = await Payment.findById(fCallerTx.payment._id);
      const stockAfterCallerAbort = await fCallerTx.getStock();
      const saleTxCountAfterAbort = await InventoryTransaction.countDocuments({
        orderId: fCallerTx.order._id,
        type: 'SALE',
      });

      check(
        Boolean(callerTxErr) && !sessionStillInTx && commitAfterAbortBlocked,
        `P5.11a Caller-owned tx aborted safely on concurrent EXPIRED order (err=${callerTxErr?.message || callerTxErr}, inTx=${sessionStillInTx}, commitBlocked=${commitAfterAbortBlocked})`
      );
      check(
        orderAfterCallerAbort?.status === 'EXPIRED' &&
          orderAfterCallerAbort?.paymentStatus === 'FAILED' &&
          attAfterCallerAbort?.status === 'PENDING' &&
          payAfterCallerAbort?.status === 'PENDING' &&
          !payAfterCallerAbort?.razorpayPaymentId &&
          stockAfterCallerAbort === 10 &&
          saleTxCountAfterAbort === 0,
        `P5.11b Aborted caller-owned tx left zero invalid PAID/inventory/claim commits ` +
          `(order=${orderAfterCallerAbort?.status}/${orderAfterCallerAbort?.paymentStatus}, att=${attAfterCallerAbort?.status}, pay=${payAfterCallerAbort?.status}, stock=${stockAfterCallerAbort}, saleRows=${saleTxCountAfterAbort})`
      );

      // Step 5, 6, 7, 8: Replay durable webhook event through RecoveryCoordinatorService.executeWebhookInboxBatch
      // inside a real fenced WorkerLock transaction!
      const replayLockName = `TEST_WEBHOOK_REPLAY_LOCK_${Date.now()}`;
      createdLockNames.push(replayLockName);
      const replayLease = await RecoveryCoordinatorService.acquireWorkerLease(
        replayLockName,
        'webhook-replay-worker',
        30_000
      );
      const replayFenceContext = {
        lockName: replayLockName,
        ownerId: 'webhook-replay-worker',
        fencingToken: replayLease.fencingToken!,
        leaseDurationMs: 30_000,
      };

      try {
        await RecoveryCoordinatorService.executeWebhookInboxBatch(20, {
          leaseDurationMs: 30_000,
          fenceContext: replayFenceContext,
        });

        // Second immediate replay must respect backoff (no tight-loop infinite retry)
        const secondReplay = await RecoveryCoordinatorService.executeWebhookInboxBatch(20, {
          leaseDurationMs: 30_000,
          fenceContext: replayFenceContext,
        });

        // Even if a direct retry occurs later, state must stay idempotent and never deduct inventory
        const directRetryAfterReplay = await processPaymentSuccess(
          fCallerTx.rzpOrderId,
          fCallerTx.rzpPaymentId
        );

        const finalOrder = await Order.findById(fCallerTx.order._id);
        const finalAttempt = await PaymentAttempt.findById(fCallerTx.attempt._id);
        const finalPayment = await Payment.findById(fCallerTx.payment._id);
        const finalStock = await fCallerTx.getStock();
        const finalSaleTxCount = await InventoryTransaction.countDocuments({
          orderId: fCallerTx.order._id,
          type: 'SALE',
        });
        const finalWebhookEvent = await WebhookEvent.findOne({
          provider: 'RAZORPAY',
          eventId: webhookEventId,
        });

        console.log(
          `  [P5.11 FINAL DB STATE] order=${finalOrder?.status}/${finalOrder?.paymentStatus} ` +
            `attempt=${finalAttempt?.status}(${finalAttempt?.razorpayPaymentId}) ` +
            `payment=${finalPayment?.status}(${finalPayment?.razorpayPaymentId}, reconciliationRequired=${finalPayment?.reconciliationRequired}) ` +
            `stock=${finalStock} saleTxCount=${finalSaleTxCount} ` +
            `webhook=${finalWebhookEvent?.status}(attempts=${finalWebhookEvent?.processingAttempts}, lastError=${finalWebhookEvent?.lastError}, hasNextRetryAt=${Boolean(finalWebhookEvent?.nextRetryAt)})`
        );

        check(
          finalOrder?.status === 'EXPIRED' &&
            finalOrder?.paymentStatus === 'FAILED' &&
            finalAttempt?.status === 'CAPTURED' &&
            finalAttempt?.razorpayPaymentId === fCallerTx.rzpPaymentId &&
            finalPayment?.status === 'CAPTURED' &&
            finalPayment?.razorpayPaymentId === fCallerTx.rzpPaymentId &&
            finalPayment?.reconciliationRequired === true &&
            Boolean(finalPayment?.reconciliationReason?.includes(fCallerTx.rzpPaymentId)),
          'P5.11c Webhook inbox replay atomically records PaymentAttempt & Payment as CAPTURED with reconciliationRequired=true while keeping Order EXPIRED'
        );
        check(
          finalStock === 10 &&
            finalSaleTxCount === 0 &&
            directRetryAfterReplay?.success === false &&
            directRetryAfterReplay?.reason === 'ORDER_CANCELLED',
          `P5.11d Inventory never deducted and subsequent retry remains idempotent (stock=${finalStock}, saleTxCount=${finalSaleTxCount})`
        );
        check(
          finalWebhookEvent?.status === 'FAILED' &&
            finalWebhookEvent?.lastError === 'ORDER_CANCELLED' &&
            finalWebhookEvent?.processingAttempts === 2 &&
            Boolean(finalWebhookEvent?.nextRetryAt && finalWebhookEvent.nextRetryAt.getTime() > Date.now()) &&
            secondReplay.processedCount === 0 &&
            secondReplay.failedCount === 0,
          'P5.11e Webhook recovery records capture on first replay, applies backoff, and does not tight-loop retry without recording capture'
        );
      } finally {
        await RecoveryCoordinatorService.releaseWorkerLease(
          replayLockName,
          'webhook-replay-worker',
          replayLease.fencingToken!
        ).catch(() => {});
      }
    }

    // ── 12. Integration regression test: Webhook inbox convergence after late payment capture on expired order ──
    if (!txSupported) {
      check(false, 'P5.12 Webhook inbox convergence test requires a MongoDB replica set');
    } else {
      const fConv = await createProductAndStaleOrder('CALLER_TX_CONV', 10);
      const convWebhookEventId = `evt_caller_tx_conv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      createdWebhookEventIds.push(convWebhookEventId);

      // Persist durable payment.captured webhook event in FAILED state (simulating prior failed delivery)
      await WebhookEvent.create({
        eventId: convWebhookEventId,
        provider: 'RAZORPAY',
        eventType: 'payment.captured',
        status: 'FAILED',
        processingAttempts: 1,
        processingLockExpiresAt: new Date(0),
        payload: {
          event: 'payment.captured',
          event_id: convWebhookEventId,
          payload: {
            payment: {
              entity: {
                id: fConv.rzpPaymentId,
                order_id: fConv.rzpOrderId,
                amount: 120000,
                currency: 'INR',
                status: 'captured',
                captured: true,
              },
            },
          },
        },
      });

      // Step 1: Active caller-owned snapshot transaction hits real WriteConflict on concurrent EXPIRED transition
      const convCallerSession = await mongoose.startSession();
      let convCallerTxErr: any = null;
      let convCommitAfterAbortBlocked = false;
      let convSessionStillInTx = true;
      try {
        convCallerSession.startTransaction({
          readConcern: { level: 'snapshot' },
          writeConcern: { w: 'majority' },
        });

        try {
          await processPaymentSuccess(fConv.rzpOrderId, fConv.rzpPaymentId, {
            session: convCallerSession,
            beforeOrderConfirm: async () => {
              await Order.updateOne(
                { _id: fConv.order._id },
                { $set: { status: 'EXPIRED', paymentStatus: 'FAILED' } }
              );
            },
          });
        } catch (err) {
          convCallerTxErr = err;
        }

        convSessionStillInTx = convCallerSession.inTransaction();
        try {
          await convCallerSession.commitTransaction();
        } catch {
          convCommitAfterAbortBlocked = true;
        }
      } finally {
        if (convCallerSession.inTransaction()) {
          await convCallerSession.abortTransaction().catch(() => {});
        }
        await convCallerSession.endSession().catch(() => {});
      }

      const convOrderAfterAbort = await Order.findById(fConv.order._id);
      const convAttAfterAbort = await PaymentAttempt.findById(fConv.attempt._id);
      const convPayAfterAbort = await Payment.findById(fConv.payment._id);
      const convStockAfterAbort = await fConv.getStock();
      const convSaleAfterAbort = await InventoryTransaction.countDocuments({
        orderId: fConv.order._id,
        type: 'SALE',
      });

      check(
        Boolean(convCallerTxErr) &&
          !convSessionStillInTx &&
          convCommitAfterAbortBlocked &&
          convOrderAfterAbort?.status === 'EXPIRED' &&
          convOrderAfterAbort?.paymentStatus === 'FAILED' &&
          convAttAfterAbort?.status === 'PENDING' &&
          !convAttAfterAbort?.razorpayPaymentId &&
          convPayAfterAbort?.status === 'PENDING' &&
          !convPayAfterAbort?.razorpayPaymentId &&
          convStockAfterAbort === 10 &&
          convSaleAfterAbort === 0,
        `P5.12a Caller-owned tx aborted cleanly on WriteConflict with zero invalid commits ` +
          `(err=${convCallerTxErr?.message || convCallerTxErr}, order=${convOrderAfterAbort?.status}/${convOrderAfterAbort?.paymentStatus}, ` +
          `att=${convAttAfterAbort?.status}, pay=${convPayAfterAbort?.status}, stock=${convStockAfterAbort}, saleRows=${convSaleAfterAbort})`
      );

      // Step 2: Acquire real fenced WorkerLock and execute FIRST webhook inbox replay
      const convLockName = `TEST_WEBHOOK_CONV_LOCK_${Date.now()}`;
      createdLockNames.push(convLockName);
      const convLease = await RecoveryCoordinatorService.acquireWorkerLease(
        convLockName,
        'webhook-conv-worker',
        30_000
      );
      const convFenceContext = {
        lockName: convLockName,
        ownerId: 'webhook-conv-worker',
        fencingToken: convLease.fencingToken!,
        leaseDurationMs: 30_000,
      };

      try {
        const firstReplay = await RecoveryCoordinatorService.executeWebhookInboxBatch(20, {
          leaseDurationMs: 30_000,
          fenceContext: convFenceContext,
        });

        // Immediately inspect and record DB state BEFORE any direct processPaymentSuccess retry or second sweep
        const [
          orderAfterFirstReplay,
          attemptAfterFirstReplay,
          paymentAfterFirstReplay,
          stockAfterFirstReplay,
          saleTxAfterFirstReplay,
          webhookAfterFirstReplay,
        ] = await Promise.all([
          Order.findById(fConv.order._id),
          PaymentAttempt.findById(fConv.attempt._id),
          Payment.findById(fConv.payment._id),
          fConv.getStock(),
          InventoryTransaction.countDocuments({ orderId: fConv.order._id, type: 'SALE' }),
          WebhookEvent.findOne({ provider: 'RAZORPAY', eventId: convWebhookEventId }),
        ]);

        console.log(
          `  [P5.12 AFTER FIRST INBOX REPLAY] batch=(processed=${firstReplay.processedCount}, failed=${firstReplay.failedCount}) ` +
            `order=${orderAfterFirstReplay?.status}/${orderAfterFirstReplay?.paymentStatus} ` +
            `attempt=${attemptAfterFirstReplay?.status}(${attemptAfterFirstReplay?.razorpayPaymentId}) ` +
            `payment=${paymentAfterFirstReplay?.status}(${paymentAfterFirstReplay?.razorpayPaymentId}, reconciliationRequired=${paymentAfterFirstReplay?.reconciliationRequired}, reason=${paymentAfterFirstReplay?.reconciliationReason}) ` +
            `stock=${stockAfterFirstReplay} saleTxCount=${saleTxAfterFirstReplay} ` +
            `webhook=${webhookAfterFirstReplay?.status}(attempts=${webhookAfterFirstReplay?.processingAttempts}, lastError=${webhookAfterFirstReplay?.lastError}, nextRetryAt=${webhookAfterFirstReplay?.nextRetryAt?.toISOString() || 'none'})`
        );

        const captureRecordedByFirstReplay =
          attemptAfterFirstReplay?.status === 'CAPTURED' &&
          attemptAfterFirstReplay?.razorpayPaymentId === fConv.rzpPaymentId &&
          paymentAfterFirstReplay?.status === 'CAPTURED' &&
          paymentAfterFirstReplay?.razorpayPaymentId === fConv.rzpPaymentId &&
          paymentAfterFirstReplay?.reconciliationRequired === true &&
          Boolean(paymentAfterFirstReplay?.reconciliationReason?.includes(fConv.rzpPaymentId));

        check(
          firstReplay.processedCount === 0 &&
            firstReplay.failedCount === 1 &&
            orderAfterFirstReplay?.status === 'EXPIRED' &&
            orderAfterFirstReplay?.paymentStatus === 'FAILED' &&
            captureRecordedByFirstReplay &&
            stockAfterFirstReplay === 10 &&
            saleTxAfterFirstReplay === 0 &&
            webhookAfterFirstReplay?.status === 'FAILED' &&
            webhookAfterFirstReplay?.lastError === 'ORDER_CANCELLED' &&
            webhookAfterFirstReplay?.processingAttempts === 2 &&
            Boolean(webhookAfterFirstReplay?.nextRetryAt && webhookAfterFirstReplay.nextRetryAt.getTime() > Date.now()),
          `P5.12b First inbox replay itself durably records late capture on PaymentAttempt & Payment before any direct retry ` +
            `(order=${orderAfterFirstReplay?.status}/${orderAfterFirstReplay?.paymentStatus}, att=${attemptAfterFirstReplay?.status}, ` +
            `pay=${paymentAfterFirstReplay?.status}/recon=${paymentAfterFirstReplay?.reconciliationRequired}, stock=${stockAfterFirstReplay}, ` +
            `webhook=${webhookAfterFirstReplay?.status}/attempts=${webhookAfterFirstReplay?.processingAttempts})`
        );

        // Step 3: Make only nextRetryAt eligible in the past (do NOT alter status or bypass inbox worker)
        await WebhookEvent.updateOne(
          { provider: 'RAZORPAY', eventId: convWebhookEventId },
          { $set: { nextRetryAt: new Date(Date.now() - 1_000) } }
        );

        // Run the real fenced webhook inbox batch again to verify convergence to terminal PROCESSED state
        const convergenceReplay = await RecoveryCoordinatorService.executeWebhookInboxBatch(20, {
          leaseDurationMs: 30_000,
          fenceContext: convFenceContext,
        });

        const [
          convOrder,
          convAttempt,
          convPayment,
          convStock,
          convSaleTxCount,
          convWebhook,
          convRefundCount,
          convDupRefundCount,
        ] = await Promise.all([
          Order.findById(fConv.order._id),
          PaymentAttempt.findById(fConv.attempt._id),
          Payment.findById(fConv.payment._id),
          fConv.getStock(),
          InventoryTransaction.countDocuments({ orderId: fConv.order._id, type: 'SALE' }),
          WebhookEvent.findOne({ provider: 'RAZORPAY', eventId: convWebhookEventId }),
          Refund.countDocuments({ orderId: fConv.order._id }),
          DuplicateCaptureRefund.countDocuments({ orderId: fConv.order._id }),
        ]);

        console.log(
          `  [P5.12 AFTER WEBHOOK CONVERGENCE] batch=(processed=${convergenceReplay.processedCount}, failed=${convergenceReplay.failedCount}) ` +
            `order=${convOrder?.status}/${convOrder?.paymentStatus} ` +
            `attempt=${convAttempt?.status}(${convAttempt?.razorpayPaymentId}) ` +
            `payment=${convPayment?.status}(${convPayment?.razorpayPaymentId}, reconciliationRequired=${convPayment?.reconciliationRequired}, reason=${convPayment?.reconciliationReason}) ` +
            `stock=${convStock} saleTxCount=${convSaleTxCount} refunds=${convRefundCount} dupRefunds=${convDupRefundCount} ` +
            `webhook=${convWebhook?.status}(attempts=${convWebhook?.processingAttempts}, lastError=${convWebhook?.lastError ?? 'none'}, nextRetryAt=${convWebhook?.nextRetryAt?.toISOString() || 'none'}, processedAt=${convWebhook?.processedAt?.toISOString() || 'none'})`
        );

        check(
          convOrder?.status === 'EXPIRED' &&
            convOrder?.paymentStatus === 'FAILED' &&
            convAttempt?.status === 'CAPTURED' &&
            convAttempt?.razorpayPaymentId === fConv.rzpPaymentId &&
            convPayment?.status === 'CAPTURED' &&
            convPayment?.razorpayPaymentId === fConv.rzpPaymentId &&
            convPayment?.reconciliationRequired === true &&
            Boolean(convPayment?.reconciliationReason?.includes(fConv.rzpPaymentId)) &&
            convStock === 10 &&
            convSaleTxCount === 0 &&
            convRefundCount === 0 &&
            convDupRefundCount === 0,
          `P5.12c Converged persistence keeps Order EXPIRED/FAILED, retains CAPTURED PaymentAttempt & Payment with reconciliationRequired=true, stock=10, zero SALE/refund rows`
        );

        check(
          convergenceReplay.processedCount === 1 &&
            convergenceReplay.failedCount === 0 &&
            convWebhook?.status === 'PROCESSED' &&
            Boolean(convWebhook?.processedAt) &&
            Boolean(convWebhook?.expiresAt) &&
            convWebhook?.nextRetryAt === undefined &&
            convWebhook?.lastError === undefined &&
            convWebhook?.processingAttempts === 3,
          `P5.12d Webhook inbox recognizes already-recorded closed-order capture and converges event to terminal PROCESSED state with cleared lastError & nextRetryAt ` +
            `(batch=${convergenceReplay.processedCount}/${convergenceReplay.failedCount}, status=${convWebhook?.status}, attempts=${convWebhook?.processingAttempts}, lastError=${convWebhook?.lastError}, nextRetryAt=${convWebhook?.nextRetryAt})`
        );

        // Step 4: Verify repeat-replay idempotency after reaching terminal PROCESSED state
        const repeatReplay = await RecoveryCoordinatorService.executeWebhookInboxBatch(20, {
          leaseDurationMs: 30_000,
          fenceContext: convFenceContext,
        });

        const [
          repeatOrder,
          repeatAttempt,
          repeatPayment,
          repeatStock,
          repeatSaleTxCount,
          repeatWebhook,
          repeatRefundCount,
          repeatDupRefundCount,
        ] = await Promise.all([
          Order.findById(fConv.order._id),
          PaymentAttempt.findById(fConv.attempt._id),
          Payment.findById(fConv.payment._id),
          fConv.getStock(),
          InventoryTransaction.countDocuments({ orderId: fConv.order._id, type: 'SALE' }),
          WebhookEvent.findOne({ provider: 'RAZORPAY', eventId: convWebhookEventId }),
          Refund.countDocuments({ orderId: fConv.order._id }),
          DuplicateCaptureRefund.countDocuments({ orderId: fConv.order._id }),
        ]);

        check(
          repeatReplay.processedCount === 0 &&
            repeatReplay.failedCount === 0 &&
            repeatWebhook?.status === 'PROCESSED' &&
            repeatWebhook?.processingAttempts === 3 &&
            repeatWebhook?.nextRetryAt === undefined &&
            repeatWebhook?.lastError === undefined &&
            repeatOrder?.status === 'EXPIRED' &&
            repeatOrder?.paymentStatus === 'FAILED' &&
            repeatAttempt?.status === 'CAPTURED' &&
            repeatAttempt?.razorpayPaymentId === fConv.rzpPaymentId &&
            repeatPayment?.status === 'CAPTURED' &&
            repeatPayment?.razorpayPaymentId === fConv.rzpPaymentId &&
            repeatPayment?.reconciliationRequired === true &&
            repeatStock === 10 &&
            repeatSaleTxCount === 0 &&
            repeatRefundCount === 0 &&
            repeatDupRefundCount === 0,
          `P5.12e Repeat inbox sweep after PROCESSED is strictly idempotent (batch=${repeatReplay.processedCount}/${repeatReplay.failedCount}, ` +
            `attempts=${repeatWebhook?.processingAttempts}, stock=${repeatStock}, saleRows=${repeatSaleTxCount}, refunds=${repeatRefundCount}/${repeatDupRefundCount})`
        );
      } finally {
        await RecoveryCoordinatorService.releaseWorkerLease(
          convLockName,
          'webhook-conv-worker',
          convLease.fencingToken!
        ).catch(() => {});
      }
    }
  } finally {
    if (createdWebhookEventIds.length > 0) {
      await WebhookEvent.deleteMany({ eventId: { $in: createdWebhookEventIds } });
    }
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
  console.error('Unhandled error in payment-order-expiry-concurrency test:', err);
  process.exit(1);
});
