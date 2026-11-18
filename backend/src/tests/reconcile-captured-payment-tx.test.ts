/**
 * Phase 2 Failure-Injection & Regression Suite:
 * Manual Reconciliation (`reconcileCapturedPayment.ts`) Must Fail Closed
 *
 * Proves:
 *  1. Dry-run mode is strictly read-only (no DB writes, no WorkerLock).
 *  2. Confirm mode fails closed on non-transactional topology (no silent fallback).
 *  3. Confirm mode fails closed on session creation failure (zero writes, lock released).
 *  4. Confirm mode fails closed on transaction startup failure (zero writes, session ended, lock released).
 *  5. Mid-operation failure aborts transaction cleanly (all reset writes rolled back, session ended).
 *  6. Unsuccessful processor return aborts transaction cleanly (all reset writes rolled back).
 *  7. Successful commit on a real MongoDB replica set reconciles order/payment/attempt/stock atomically.
 *  8. Repeated reconciliation is idempotent (no-op, no double stock deduction).
 *  9. Safe retry after an earlier aborted failure succeeds cleanly.
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

async function run() {
  console.log('=== Phase 2: Manual Reconciliation Fail-Closed Transaction Suite ===');
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
    console.error(
      'BLOCKED: This suite requires a MongoDB Replica Set (TEST_MONGODB_URI with replicaSet=...) ' +
        'to exercise real transaction commits and rollbacks.'
    );
    await mongoose.disconnect().catch(() => {});
    process.exit(2);
  }

  const userId = new mongoose.Types.ObjectId();
  const createdOrderIds: mongoose.Types.ObjectId[] = [];
  const createdProductIds: mongoose.Types.ObjectId[] = [];
  const lockNames: string[] = [];

  const origGetClient = razorpayProvider.getClient;

  try {
    const { product, productId, variantIds } = await createTestProduct({
      name: 'Reconcile Tx Tee',
      basePrice: 800,
      variants: [{ size: 'M', color: 'BLACK', stock: 10 }],
    });
    createdProductIds.push(product._id);
    const variantId = variantIds[0];

    const createFailedAttemptFixture = async (label: string) => {
      const order = await Order.create({
        orderNumber: `REC-TX-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        userId,
        items: [
          {
            productId: new mongoose.Types.ObjectId(productId),
            variantId: new mongoose.Types.ObjectId(variantId),
            productName: 'Reconcile Tx Tee',
            productImage: 'https://example.com/tee.jpg',
            selectedSize: 'M',
            selectedColor: 'BLACK',
            quantity: 1,
            unitPrice: 800,
            lineTotal: 800,
            isCustomized: false,
          },
        ],
        shippingAddress: {
          fullName: 'Reconcile Tester',
          phone: '9876543210',
          addressLine1: '12 Park St',
          city: 'Kolkata',
          state: 'WB',
          postalCode: '700016',
          country: 'India',
        },
        subtotal: 800,
        discount: 0,
        shipping: 0,
        tax: 0,
        total: 800,
        currency: 'INR',
        status: 'PENDING',
        paymentStatus: 'FAILED',
      });
      createdOrderIds.push(order._id as mongoose.Types.ObjectId);
      lockNames.push(`RECONCILIATION_ORDER_${order._id.toString()}`);

      const payment = await Payment.create({
        orderId: order._id,
        userId,
        amount: 800,
        currency: 'INR',
        status: 'FAILED',
        provider: 'RAZORPAY',
      });

      const rzpOrderId = `order_rectx_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const rzpPaymentId = `pay_rectx_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const attempt = await PaymentAttempt.create({
        paymentId: payment._id,
        orderId: order._id,
        razorpayOrderId: rzpOrderId,
        amount: 800,
        currency: 'INR',
        status: 'FAILED',
        failureCode: 'GATEWAY_TEMP_ERROR',
        failureReason: 'Earlier UPI attempt failed',
      });

      return { order, payment, attempt, rzpOrderId, rzpPaymentId };
    };

    const stubGatewayFor = (orderId: mongoose.Types.ObjectId, rzpOrderId: string, rzpPaymentId: string) => {
      razorpayProvider.getClient = (() => ({
        payments: {
          fetch: async (id: string) => ({
            id,
            entity: 'payment',
            order_id: rzpOrderId,
            amount: 80000,
            currency: 'INR',
            status: 'captured',
            captured: true,
          }),
        },
        orders: {
          fetch: async (id: string) => ({
            id,
            entity: 'order',
            amount: 80000,
            currency: 'INR',
            notes: { internalOrderId: orderId.toString() },
          }),
        },
      })) as any;
    };

    // 1. Dry-run mode MUST remain strictly read-only
    const fDry = await createFailedAttemptFixture('DRY');
    stubGatewayFor(fDry.order._id as mongoose.Types.ObjectId, fDry.rzpOrderId, fDry.rzpPaymentId);
    const dryRes = await reconcileCapturedPayment({
      orderRef: fDry.order.orderNumber,
      razorpayPaymentId: fDry.rzpPaymentId,
      confirm: false,
      useExistingConnection: true,
    });
    const dryOrder = await Order.findById(fDry.order._id);
    const dryAttempt = await PaymentAttempt.findById(fDry.attempt._id);
    const dryPayment = await Payment.findById(fDry.payment._id);
    const dryLock = await WorkerLock.findOne({ lockName: `RECONCILIATION_ORDER_${fDry.order._id}` });
    check(
      dryRes.mode === 'DRY_RUN' &&
        dryRes.committed === false &&
        dryOrder?.paymentStatus === 'FAILED' &&
        dryAttempt?.status === 'FAILED' &&
        dryPayment?.status === 'FAILED' &&
        dryLock === null,
      'P2.1 Dry-run mode performs zero DB writes and acquires no WorkerLock'
    );

    // 2. Non-transactional topology MUST fail closed in --confirm mode
    let nonTxErr: any = null;
    try {
      await reconcileCapturedPayment({
        orderRef: fDry.order.orderNumber,
        razorpayPaymentId: fDry.rzpPaymentId,
        confirm: true,
        useExistingConnection: true,
        hooks: {
          isTransactionSupportedFn: () => false,
        },
      });
    } catch (err) {
      nonTxErr = err;
    }
    const orderAfterNonTx = await Order.findById(fDry.order._id);
    const attemptAfterNonTx = await PaymentAttempt.findById(fDry.attempt._id);
    check(
      nonTxErr?.code === 'RECONCILIATION_TRANSACTION_REQUIRED' &&
        orderAfterNonTx?.paymentStatus === 'FAILED' &&
        attemptAfterNonTx?.status === 'FAILED',
      'P2.2 Confirm mode fails closed on non-transactional topology without fallback writes'
    );

    // 3. Session creation failure MUST fail closed without performing writes
    let sessionCreateErr: any = null;
    try {
      await reconcileCapturedPayment({
        orderRef: fDry.order.orderNumber,
        razorpayPaymentId: fDry.rzpPaymentId,
        confirm: true,
        useExistingConnection: true,
        hooks: {
          startSession: async () => {
            throw new Error('Injected session creation failure');
          },
        },
      });
    } catch (err) {
      sessionCreateErr = err;
    }
    const orderAfterSessErr = await Order.findById(fDry.order._id);
    const attemptAfterSessErr = await PaymentAttempt.findById(fDry.attempt._id);
    const lockAfterSessErr = await WorkerLock.findOne({ lockName: `RECONCILIATION_ORDER_${fDry.order._id}` });
    check(
      sessionCreateErr?.code === 'TRANSACTION_SESSION_FAILED' &&
        orderAfterSessErr?.paymentStatus === 'FAILED' &&
        attemptAfterSessErr?.status === 'FAILED' &&
        Boolean(lockAfterSessErr && lockAfterSessErr.leaseExpiresAt.getTime() === 0),
      'P2.3 Session creation failure fails closed (zero writes) and releases lock cleanly'
    );

    // 4. Transaction startup failure MUST fail closed, end session, and perform zero writes
    let txStartupErr: any = null;
    const sessionTracker = { ended: false };
    try {
      await reconcileCapturedPayment({
        orderRef: fDry.order.orderNumber,
        razorpayPaymentId: fDry.rzpPaymentId,
        confirm: true,
        useExistingConnection: true,
        hooks: {
          startSession: async () =>
            ({
              startTransaction: () => {
                throw new Error('Injected startTransaction failure');
              },
              inTransaction: () => false,
              abortTransaction: async () => {},
              endSession: async () => {
                sessionTracker.ended = true;
              },
            }) as any,
        },
      });
    } catch (err) {
      txStartupErr = err;
    }
    const orderAfterTxStartErr = await Order.findById(fDry.order._id);
    const attemptAfterTxStartErr = await PaymentAttempt.findById(fDry.attempt._id);
    check(
      txStartupErr?.code === 'TRANSACTION_STARTUP_FAILED' &&
        sessionTracker.ended === true &&
        orderAfterTxStartErr?.paymentStatus === 'FAILED' &&
        attemptAfterTxStartErr?.status === 'FAILED',
      'P2.4 Transaction startup failure fails closed (zero writes) and ends session reliably'
    );

    // 5. Mid-operation failure MUST abort transaction and roll back ALL reset writes
    let midOpErr: any = null;
    try {
      await reconcileCapturedPayment({
        orderRef: fDry.order.orderNumber,
        razorpayPaymentId: fDry.rzpPaymentId,
        confirm: true,
        useExistingConnection: true,
        hooks: {
          processPaymentSuccessFn: async () => {
            throw new Error('Injected mid-operation crash after record resets');
          },
        },
      });
    } catch (err) {
      midOpErr = err;
    }
    const orderAfterMidOp = await Order.findById(fDry.order._id);
    const attemptAfterMidOp = await PaymentAttempt.findById(fDry.attempt._id);
    const paymentAfterMidOp = await Payment.findById(fDry.payment._id);
    check(
      Boolean(midOpErr) &&
        orderAfterMidOp?.paymentStatus === 'FAILED' &&
        attemptAfterMidOp?.status === 'FAILED' &&
        attemptAfterMidOp?.failureCode === 'GATEWAY_TEMP_ERROR' &&
        paymentAfterMidOp?.status === 'FAILED',
      'P2.5 Mid-operation failure aborts transaction and rolls back Order/PaymentAttempt/Payment resets'
    );

    // 6. Processor returning { success: false } MUST abort transaction and roll back resets
    const nonSuccessRes = await reconcileCapturedPayment({
      orderRef: fDry.order.orderNumber,
      razorpayPaymentId: fDry.rzpPaymentId,
      confirm: true,
      useExistingConnection: true,
      hooks: {
        processPaymentSuccessFn: async () => ({
          order: fDry.order,
          attempt: fDry.attempt,
          success: false,
          reason: 'PAYMENT_RECONCILIATION_REQUIRED',
        }),
      },
    });
    const orderAfterUnsuccessful = await Order.findById(fDry.order._id);
    const attemptAfterUnsuccessful = await PaymentAttempt.findById(fDry.attempt._id);
    check(
      nonSuccessRes.committed === false &&
        orderAfterUnsuccessful?.paymentStatus === 'FAILED' &&
        attemptAfterUnsuccessful?.status === 'FAILED',
      'P2.6 Processor failure outcome aborts transaction and rolls back reset writes'
    );

    // 7. Safe retry after earlier aborted failures commits cleanly and atomically
    const commitRes = await reconcileCapturedPayment({
      orderRef: fDry.order.orderNumber,
      razorpayPaymentId: fDry.rzpPaymentId,
      confirm: true,
      useExistingConnection: true,
    });
    const finalOrder = await Order.findById(fDry.order._id);
    const finalAttempt = await PaymentAttempt.findById(fDry.attempt._id);
    const finalPayment = await Payment.findById(fDry.payment._id);
    const prodAfterCommit = await Product.findById(product._id);
    const stockAfterCommit = prodAfterCommit?.variants.find((v: any) => v._id.toString() === variantId)?.stock;
    check(
      commitRes.committed === true &&
        finalOrder?.status === 'CONFIRMED' &&
        finalOrder?.paymentStatus === 'PAID' &&
        finalAttempt?.status === 'CAPTURED' &&
        finalAttempt?.razorpayPaymentId === fDry.rzpPaymentId &&
        finalPayment?.status === 'CAPTURED' &&
        finalPayment?.razorpayPaymentId === fDry.rzpPaymentId &&
        stockAfterCommit === 9,
      `P2.7 Retry after aborted failures commits atomically (order=${finalOrder?.status}/${finalOrder?.paymentStatus}, stock=${stockAfterCommit})`
    );

    // 8. Repeated reconciliation is an idempotent no-op (no double stock deduction)
    const repeatRes = await reconcileCapturedPayment({
      orderRef: fDry.order.orderNumber,
      razorpayPaymentId: fDry.rzpPaymentId,
      confirm: true,
      useExistingConnection: true,
    });
    const prodAfterRepeat = await Product.findById(product._id);
    const stockAfterRepeat = prodAfterRepeat?.variants.find((v: any) => v._id.toString() === variantId)?.stock;
    check(
      repeatRes.idempotentNoOp === true &&
        repeatRes.committed === false &&
        stockAfterRepeat === 9,
      `P2.8 Repeated reconciliation is idempotent no-op (stock=${stockAfterRepeat})`
    );

    // 9. P2.9 — Already-PAID order with a DIFFERENT captured payment ID B on the same Razorpay order
    const distinctCaptureIdB = `pay_rectx_dup_B_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    // Dry-run with distinct payment B: must reject (NOT idempotentNoOp) and remain read-only
    let dupDryErr: any = null;
    try {
      await reconcileCapturedPayment({
        orderRef: fDry.order.orderNumber,
        razorpayPaymentId: distinctCaptureIdB,
        confirm: false,
        useExistingConnection: true,
      });
    } catch (err) {
      dupDryErr = err;
    }
    const payAfterDupDry = await Payment.findById(fDry.payment._id);
    const attAfterDupDry = await PaymentAttempt.findById(fDry.attempt._id);
    check(
      dupDryErr?.code === 'DUPLICATE_CAPTURE_DETECTED' &&
        payAfterDupDry?.razorpayPaymentId === fDry.rzpPaymentId &&
        payAfterDupDry?.reconciliationRequired !== true &&
        attAfterDupDry?.razorpayPaymentId === fDry.rzpPaymentId,
      'P2.9a Dry-run with distinct captured payment ID B rejects with DUPLICATE_CAPTURE_DETECTED without mutating DB'
    );

    // Confirm with distinct payment B: must reject (NOT idempotentNoOp), preserve ID A, and flag Payment for reconciliation
    let dupConfirmErr: any = null;
    try {
      await reconcileCapturedPayment({
        orderRef: fDry.order.orderNumber,
        razorpayPaymentId: distinctCaptureIdB,
        confirm: true,
        useExistingConnection: true,
      });
    } catch (err) {
      dupConfirmErr = err;
    }
    const payAfterDupConfirm = await Payment.findById(fDry.payment._id);
    const attAfterDupConfirm = await PaymentAttempt.findById(fDry.attempt._id);
    const prodAfterDupConfirm = await Product.findById(product._id);
    const stockAfterDupConfirm = prodAfterDupConfirm?.variants.find((v: any) => v._id.toString() === variantId)?.stock;
    check(
      dupConfirmErr?.code === 'DUPLICATE_CAPTURE_DETECTED' &&
        payAfterDupConfirm?.status === 'CAPTURED' &&
        payAfterDupConfirm?.razorpayPaymentId === fDry.rzpPaymentId &&
        attAfterDupConfirm?.status === 'CAPTURED' &&
        attAfterDupConfirm?.razorpayPaymentId === fDry.rzpPaymentId &&
        payAfterDupConfirm?.reconciliationRequired === true &&
        Boolean(payAfterDupConfirm?.reconciliationReason?.includes(distinctCaptureIdB)) &&
        stockAfterDupConfirm === 9,
      'P2.9b Confirm with distinct captured payment ID B rejects with DUPLICATE_CAPTURE_DETECTED, preserves original ID A, flags Payment.reconciliationRequired, and leaves stock unchanged'
    );

    // Confirm repeating exact original payment ID A STILL returns idempotentNoOp
    const repeatOrigRes = await reconcileCapturedPayment({
      orderRef: fDry.order.orderNumber,
      razorpayPaymentId: fDry.rzpPaymentId,
      confirm: true,
      useExistingConnection: true,
    });
    check(
      repeatOrigRes.idempotentNoOp === true && repeatOrigRes.committed === false,
      'P2.9c Repeating exact original payment ID A still returns idempotentNoOp'
    );
  } finally {
    razorpayProvider.getClient = origGetClient;
    if (lockNames.length > 0) {
      await WorkerLock.deleteMany({ lockName: { $in: lockNames } });
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
  console.error('Unhandled error in reconcile-captured-payment-tx test:', err);
  process.exit(1);
});
