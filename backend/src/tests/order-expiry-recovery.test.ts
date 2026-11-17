/**
 * Regression suite: coordinated order-expiry recovery.
 *
 * Proves that the maintenance task wired into the existing recovery coordinator:
 * - refuses to expire an order when Razorpay reports a captured payment,
 * - refuses to expire when the gateway cannot be verified (fail closed),
 * - refuses to expire while an authorized/in-flight payment exists,
 * - expires genuinely unpaid stale orders exactly once,
 * - restores inventory exactly once when a SALE ledger residue proves stock was
 *   already deducted, even under concurrent reaper invocations,
 * - exposes task errors in the coordinator report and never records an
 *   incomplete cycle as SUCCESS.
 */

process.env.NODE_ENV = 'test';
process.env.RAZORPAY_KEY_ID = 'rzp_test_mock';
process.env.RAZORPAY_KEY_SECRET = 'mock_secret_test';
process.env.RAZORPAY_WEBHOOK_SECRET = 'mock_webhook_secret_test';
process.env.ALLOW_PAYMENT_MOCK = 'true';
process.env.OPS_SECRET = 'test_ops_secret_at_least_16_chars';

import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();
import { connectSafeTestDb, createTestProduct } from './testHelpers';
import { Order } from '../models/Order';
import { Payment } from '../models/Payment';
import { PaymentAttempt } from '../models/PaymentAttempt';
import { Refund } from '../models/Refund';
import { Product } from '../models/Product';
import { InventoryTransaction } from '../models/InventoryTransaction';
import { RecoveryStatus } from '../models/RecoveryStatus';
import { WorkerLock } from '../models/WorkerLock';
import {
  expireStalePendingOrders,
  ORDER_EXPIRY_MS,
  GatewayPaymentVerification,
} from '../services/orderExpiryService';
import {
  RECOVERY_LOCK_NAME,
  RecoveryCoordinatorService,
} from '../services/recovery/recoveryCoordinatorService';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(condition: boolean, desc: string, detail?: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS: ${desc}`);
  } else {
    failed++;
    const message = detail ? `${desc} — ${detail}` : desc;
    failures.push(message);
    console.error(`  FAIL: ${message}`);
  }
}

const shippingAddress = {
  fullName: 'Expiry Recovery Customer',
  phone: '9876543210',
  addressLine1: 'Park St',
  city: 'Kolkata',
  state: 'WB',
  postalCode: '700016',
  country: 'India',
};

const userId = new mongoose.Types.ObjectId();
const createdOrderIds: mongoose.Types.ObjectId[] = [];
let product: any;

function verifierFor(
  state: GatewayPaymentVerification['state'],
  reason = `synthetic ${state}`
) {
  return async (params: {
    orderId: string;
    razorpayOrderIds: string[];
  }): Promise<GatewayPaymentVerification> => ({
    state,
    razorpayOrderIds: params.razorpayOrderIds,
    reason,
  });
}

async function createStaleOrder(params: {
  label: string;
  productId?: mongoose.Types.ObjectId;
  variantId?: mongoose.Types.ObjectId;
  ageMs?: number;
}): Promise<any> {
  const order = await Order.create({
    orderNumber: `ORD-EXPIRY-REC-${params.label}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`,
    userId,
    items: params.productId && params.variantId
      ? [
          {
            productId: params.productId,
            variantId: params.variantId,
            productName: 'Recovery Expiry Tee',
            productImage: 'http://localhost/img.jpg',
            selectedSize: 'M',
            selectedColor: 'BLACK',
            quantity: 1,
            unitPrice: 500,
            lineTotal: 500,
            isCustomized: false,
          },
        ]
      : [],
    shippingAddress,
    paymentMethod: 'RAZORPAY',
    paymentStatus: 'PENDING',
    status: 'PENDING',
    subtotal: 500,
    discount: 0,
    tax: 0,
    shipping: 0,
    total: 500,
  });
  createdOrderIds.push(order._id);

  const staleness = params.ageMs ?? ORDER_EXPIRY_MS + 5 * 60 * 1000;
  await Order.collection.updateOne(
    { _id: order._id },
    { $set: { updatedAt: new Date(Date.now() - staleness) } }
  );
  return order;
}

async function createAttempt(params: {
  orderId: mongoose.Types.ObjectId;
  status: 'PENDING' | 'AUTHORIZED' | 'PROCESSING' | 'CAPTURED' | 'FAILED';
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
}): Promise<any> {
  return PaymentAttempt.create({
    paymentId: new mongoose.Types.ObjectId(),
    orderId: params.orderId,
    razorpayOrderId:
      params.razorpayOrderId ??
      `order_rec_${params.orderId.toString()}_${Math.random().toString(36).slice(2, 8)}`,
    razorpayPaymentId: params.razorpayPaymentId,
    amount: 500,
    currency: 'INR',
    status: params.status,
  });
}

async function run(): Promise<void> {
  await connectSafeTestDb();

  try {
    await RecoveryStatus.deleteOne({ identifier: 'SINGLETON' });
    await WorkerLock.deleteOne({ lockName: RECOVERY_LOCK_NAME });

    const productRes = await createTestProduct({
      name: 'Order Expiry Recovery Tee',
      variants: [{ size: 'M', color: 'BLACK', stock: 8 }],
    });
    product = productRes.product;
    const productId = product._id as mongoose.Types.ObjectId;
    const variantId = new mongoose.Types.ObjectId(productRes.variantIds[0]);

    // ---------------------------------------------------------------------
    // S1: captured at the gateway -> never expire, flag reconciliation
    // ---------------------------------------------------------------------
    const capturedOrder = await createStaleOrder({ label: 'CAPTURED', productId, variantId });
    await Payment.create({
      orderId: capturedOrder._id,
      userId,
      amount: 500,
      currency: 'INR',
      status: 'PENDING',
      provider: 'RAZORPAY',
    });
    await createAttempt({ orderId: capturedOrder._id, status: 'PENDING' });

    const capturedRes = await expireStalePendingOrders({
      verifyGatewayPaymentState: verifierFor('CAPTURED', 'gateway amount_paid=500'),
    });
    const capturedOrderAfter: any = await Order.findById(capturedOrder._id);
    const capturedPaymentAfter: any = await Payment.findOne({ orderId: capturedOrder._id });
    check(
      capturedRes.expired === 0 && capturedRes.skippedCaptured >= 1,
      'OE1: Captured gateway payment prevents expiry',
      `expired=${capturedRes.expired}, skippedCaptured=${capturedRes.skippedCaptured}`
    );
    check(
      capturedOrderAfter.status === 'PENDING' && capturedOrderAfter.paymentStatus === 'PENDING',
      'OE2: Captured-payment order remains PENDING',
      `status=${capturedOrderAfter.status}/${capturedOrderAfter.paymentStatus}`
    );
    check(
      capturedPaymentAfter.reconciliationRequired === true,
      'OE3: Captured-but-unpaid order flags the payment for reconciliation'
    );

    // ---------------------------------------------------------------------
    // S2: gateway verification failure -> fail closed
    // ---------------------------------------------------------------------
    const unknownOrder = await createStaleOrder({ label: 'UNKNOWN', productId, variantId });
    await createAttempt({ orderId: unknownOrder._id, status: 'PENDING', razorpayOrderId: 'order_rec_unknown' });
    const unknownRes = await expireStalePendingOrders({
      verifyGatewayPaymentState: verifierFor('UNKNOWN', 'synthetic Razorpay timeout'),
    });
    const unknownOrderAfter: any = await Order.findById(unknownOrder._id);
    const unknownAttempt: any = await PaymentAttempt.findOne({ orderId: unknownOrder._id });
    check(
      unknownRes.expired === 0 && unknownRes.skippedUnverified >= 1,
      'OE4: Unverifiable gateway state fails closed',
      `expired=${unknownRes.expired}, skippedUnverified=${unknownRes.skippedUnverified}`
    );
    check(
      unknownOrderAfter.status === 'PENDING' && unknownAttempt.status === 'PENDING',
      'OE5: Unverified order and attempt are untouched',
      `order=${unknownOrderAfter.status}, attempt=${unknownAttempt.status}`
    );
    check(
      unknownRes.errors.some((error) => error.includes('could not be verified')),
      'OE6: Unverified expiry is exposed in the result errors',
      `errors=${unknownRes.errors.length}`
    );

    // ---------------------------------------------------------------------
    // S3: in-flight payment -> never expire
    // ---------------------------------------------------------------------
    const inFlightOrder = await createStaleOrder({ label: 'INFLIGHT', productId, variantId });
    await createAttempt({ orderId: inFlightOrder._id, status: 'PENDING', razorpayOrderId: 'order_rec_inflight' });
    const inFlightRes = await expireStalePendingOrders({
      verifyGatewayPaymentState: verifierFor('IN_FLIGHT', 'payment authorized'),
    });
    const inFlightOrderAfter: any = await Order.findById(inFlightOrder._id);
    check(
      inFlightRes.expired === 0 && inFlightRes.skippedInFlight >= 1,
      'OE7: In-flight gateway payment prevents expiry',
      `expired=${inFlightRes.expired}, skippedInFlight=${inFlightRes.skippedInFlight}`
    );
    check(
      inFlightOrderAfter.status === 'PENDING',
      'OE8: In-flight order remains PENDING',
      `status=${inFlightOrderAfter.status}`
    );

    // ---------------------------------------------------------------------
    // S4: genuinely unpaid stale order expires exactly once
    // ---------------------------------------------------------------------
    const unpaidOrder = await createStaleOrder({ label: 'UNPAID', productId, variantId });
    await createAttempt({ orderId: unpaidOrder._id, status: 'PENDING', razorpayOrderId: 'order_rec_unpaid' });
    const unpaidRes = await expireStalePendingOrders({
      verifyGatewayPaymentState: verifierFor('UNPAID'),
    });
    const unpaidOrderAfter: any = await Order.findById(unpaidOrder._id);
    const unpaidAttempt: any = await PaymentAttempt.findOne({ orderId: unpaidOrder._id });
    check(
      unpaidRes.expired >= 1 && unpaidOrderAfter.status === 'EXPIRED',
      'OE9: Verified-unpaid stale order expires once',
      `expired=${unpaidRes.expired}`
    );
    check(
      unpaidOrderAfter.status === 'EXPIRED' &&
        unpaidOrderAfter.paymentStatus === 'FAILED' &&
        unpaidAttempt.status === 'FAILED' &&
        unpaidAttempt.failureCode === 'PAYMENT_EXPIRED',
      'OE10: Expired order and attempt are closed consistently',
      `order=${unpaidOrderAfter.status}/${unpaidOrderAfter.paymentStatus}, attempt=${unpaidAttempt.status}/${unpaidAttempt.failureCode}`
    );
    const secondUnpaidRes = await expireStalePendingOrders({
      verifyGatewayPaymentState: verifierFor('UNPAID'),
    });
    check(
      secondUnpaidRes.expired === 0,
      'OE11: Repeated sweep is idempotent (no second expiry)',
      `expired=${secondUnpaidRes.expired}`
    );

    // ---------------------------------------------------------------------
    // S5: SALE residue -> inventory restored exactly once
    // ---------------------------------------------------------------------
    const inventoryOrder = await createStaleOrder({ label: 'INVENTORY', productId, variantId });
    await createAttempt({
      orderId: inventoryOrder._id,
      status: 'FAILED',
      razorpayOrderId: 'order_rec_inventory',
    });
    await InventoryTransaction.create({
      orderId: inventoryOrder._id,
      productId,
      variantId,
      quantity: 2,
      type: 'SALE',
    });

    const inventoryRes = await expireStalePendingOrders({
      verifyGatewayPaymentState: verifierFor('UNPAID'),
    });
    const productAfterFirstRestore: any = await Product.findById(productId);
    const refundLedgerCount = await InventoryTransaction.countDocuments({
      orderId: inventoryOrder._id,
      type: 'REFUND',
    });
    check(
      inventoryRes.expired === 1 && inventoryRes.inventoryRestoredCount === 1,
      'OE12: Expiry restores inventory once for a SALE ledger residue',
      `expired=${inventoryRes.expired}, restored=${inventoryRes.inventoryRestoredCount}`
    );
    check(
      productAfterFirstRestore.variants.id(variantId).stock === 10 && refundLedgerCount === 1,
      'OE13: Stock is restored exactly once (8 -> 10)',
      `stock=${productAfterFirstRestore.variants.id(variantId).stock}, refundRows=${refundLedgerCount}`
    );

    const inventoryRerun = await expireStalePendingOrders({
      verifyGatewayPaymentState: verifierFor('UNPAID'),
    });
    const productAfterSecondRestore: any = await Product.findById(productId);
    const refundLedgerCountAfterRerun = await InventoryTransaction.countDocuments({
      orderId: inventoryOrder._id,
      type: 'REFUND',
    });
    check(
      inventoryRerun.expired === 0 &&
        productAfterSecondRestore.variants.id(variantId).stock === 10 &&
        refundLedgerCountAfterRerun === 1,
      'OE14: Repeated sweep does not double-restore inventory',
      `expired=${inventoryRerun.expired}, stock=${productAfterSecondRestore.variants.id(variantId).stock}, refundRows=${refundLedgerCountAfterRerun}`
    );

    // ---------------------------------------------------------------------
    // S6: concurrent sweeps cannot duplicate expiry or inventory restoration
    // ---------------------------------------------------------------------
    const concurrentProductRes = await createTestProduct({
      name: 'Concurrent Expiry Tee',
      variants: [{ size: 'M', color: 'BLACK', stock: 8 }],
    });
    const concurrentProduct = concurrentProductRes.product;
    const concurrentProductId = concurrentProduct._id as mongoose.Types.ObjectId;
    const concurrentVariantId = new mongoose.Types.ObjectId(concurrentProductRes.variantIds[0]);
    const concurrentOrder = await createStaleOrder({
      label: 'CONCURRENT',
      productId: concurrentProductId,
      variantId: concurrentVariantId,
    });
    await createAttempt({
      orderId: concurrentOrder._id,
      status: 'PENDING',
      razorpayOrderId: 'order_rec_concurrent',
    });
    await InventoryTransaction.create({
      orderId: concurrentOrder._id,
      productId: concurrentProductId,
      variantId: concurrentVariantId,
      quantity: 2,
      type: 'SALE',
    });

    const [concurrentA, concurrentB] = await Promise.all([
      expireStalePendingOrders({ verifyGatewayPaymentState: verifierFor('UNPAID') }),
      expireStalePendingOrders({ verifyGatewayPaymentState: verifierFor('UNPAID') }),
    ]);
    const concurrentProductAfter: any = await Product.findById(concurrentProductId);
    const concurrentRefundRows = await InventoryTransaction.countDocuments({
      orderId: concurrentOrder._id,
      type: 'REFUND',
    });
    check(
      concurrentA.expired + concurrentB.expired >= 1,
      'OE15: Concurrent sweeps expire the order exactly once',
      `A=${concurrentA.expired}, B=${concurrentB.expired}`
    );
    check(
      concurrentProductAfter.variants.id(concurrentVariantId).stock === 10 &&
        concurrentRefundRows === 1,
      'OE16: Concurrent sweeps restore inventory exactly once',
      `stock=${concurrentProductAfter.variants.id(concurrentVariantId).stock}, refundRows=${concurrentRefundRows}`
    );

    await Product.deleteOne({ _id: concurrentProductId });

    // ---------------------------------------------------------------------
    // S7: coordinator runs order expiry as part of the cycle
    // ---------------------------------------------------------------------
    // Remove the non-expirable fixtures so the coordinator's real (non-injected)
    // verifier does not need gateway calls for this scenario.
    await Order.deleteMany({
      _id: { $in: [capturedOrder._id, unknownOrder._id, inFlightOrder._id] },
    });

    const coordinatorOrder = await createStaleOrder({ label: 'COORDINATOR' });
    const cycleReport = await RecoveryCoordinatorService.executeCoordinatedRecoveryCycle({
      batchLimit: 50,
    });
    const coordinatorOrderAfter: any = await Order.findById(coordinatorOrder._id);
    const recoveryStatus: any = await RecoveryStatus.findOne({ identifier: 'SINGLETON' }).lean();
    check(
      cycleReport.executed === true,
      'OE17: Coordinated cycle executed',
      `skippedReason=${cycleReport.skippedReason ?? 'none'}`
    );
    check(
      (cycleReport.expiredOrdersCount ?? 0) >= 1 && coordinatorOrderAfter.status === 'EXPIRED',
      'OE18: Coordinator executes stale-order expiry',
      `expiredOrders=${cycleReport.expiredOrdersCount}, status=${coordinatorOrderAfter.status}`
    );
    check(
      Boolean(recoveryStatus?.lastRunCompletedAt) &&
        (cycleReport.errors.length === 0
          ? recoveryStatus.status === 'SUCCESS'
          : recoveryStatus.status !== 'SUCCESS'),
      'OE19: Cycle status is only SUCCESS when no task errors were recorded',
      `status=${recoveryStatus?.status}, errors=${cycleReport.errors.length}`
    );

    // ---------------------------------------------------------------------
    // S8: a failing expiry task is recorded and never reported as SUCCESS
    // ---------------------------------------------------------------------
    const expiryModule = require('../services/orderExpiryService');
    const originalExpire = expiryModule.expireStalePendingOrders;
    expiryModule.expireStalePendingOrders = async () => {
      throw new Error('synthetic order expiry failure');
    };
    let failedCycleReport;
    try {
      failedCycleReport = await RecoveryCoordinatorService.executeCoordinatedRecoveryCycle({
        batchLimit: 10,
      });
    } finally {
      expiryModule.expireStalePendingOrders = originalExpire;
    }
    const failedStatus: any = await RecoveryStatus.findOne({ identifier: 'SINGLETON' }).lean();
    check(
      failedCycleReport.errors.some((error: string) =>
        error.includes('synthetic order expiry failure')
      ),
      'OE20: Task failure is exposed in the returned cycle report'
    );
    check(
      failedStatus?.status !== undefined &&
        failedStatus.status !== 'SUCCESS' &&
        failedStatus.status !== 'RUNNING',
      'OE21: Incomplete cycle is never recorded as SUCCESS',
      `status=${failedStatus?.status}`
    );
  } catch (err: unknown) {
    failed++;
    failures.push(`Suite error: ${err instanceof Error ? err.stack || err.message : String(err)}`);
    console.error('Suite error:', err);
  } finally {
    if (createdOrderIds.length > 0) {
      await Refund.deleteMany({ orderId: { $in: createdOrderIds } }).catch(() => undefined);
      await Payment.deleteMany({ orderId: { $in: createdOrderIds } }).catch(() => undefined);
      await PaymentAttempt.deleteMany({ orderId: { $in: createdOrderIds } }).catch(() => undefined);
      await InventoryTransaction.deleteMany({ orderId: { $in: createdOrderIds } }).catch(() => undefined);
      await Order.deleteMany({ _id: { $in: createdOrderIds } }).catch(() => undefined);
    }
    if (product?._id) {
      await Product.deleteOne({ _id: product._id }).catch(() => undefined);
    }
    await WorkerLock.deleteOne({ lockName: RECOVERY_LOCK_NAME }).catch(() => undefined);
    await RecoveryStatus.deleteOne({ identifier: 'SINGLETON' }).catch(() => undefined);
    await mongoose.disconnect().catch(() => undefined);
  }

  console.log('------------------------------------------------------------');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error('Failures:');
    failures.forEach((failure) => console.error(` - ${failure}`));
    process.exitCode = 1;
  }
  console.log('------------------------------------------------------------');
}

run();
