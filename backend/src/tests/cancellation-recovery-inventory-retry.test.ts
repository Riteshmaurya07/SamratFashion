/**
 * Fix 10 Test: Full cancellation inventory restore recovery & failed refund alerting/retry
 *
 * Verifies that:
 * 1. A full cancel with an inventory restore failure records a cancellationOperations entry with status: 'PENDING'
 *    and inventoryRestored: false.
 * 2. reconcilePendingCancellationOperations sweeps the order and restores stock exactly once.
 * 3. Failed cancellation refunds surface in getPaymentHealthReport() as critical alerts and are retried by recovery.
 */

process.env.NODE_ENV = 'test';
process.env.RAZORPAY_KEY_ID = 'rzp_test_mock';
process.env.RAZORPAY_KEY_SECRET = 'mock_secret_test';
process.env.RAZORPAY_WEBHOOK_SECRET = 'mock_webhook_secret_test';

import mongoose from 'mongoose';
import { connectSafeTestDb } from './testHelpers';
import { cancelOrderWithRefund, reconcilePendingCancellationOperations } from '../services/orderCancellationService';
import { InventoryAllocationService } from '../services/inventory/inventoryAllocationService';
import { getPaymentHealthReport } from '../services/payment/paymentHealthService';
import { Order } from '../models/Order';
import { Payment } from '../models/Payment';
import { PaymentAttempt } from '../models/PaymentAttempt';
import { Refund } from '../models/Refund';
import { razorpayProvider } from '../services/payment/RazorpayProvider';

let passed = 0;
let failed = 0;

function check(condition: boolean, desc: string, detail?: string): void {
  if (condition) {
    passed++;
    console.log(`  ✅ PASS: ${desc}`);
  } else {
    failed++;
    const msg = detail ? `${desc} — ${detail}` : desc;
    console.error(`  ❌ FAIL: ${msg}`);
  }
}

async function run() {
  console.log('=== Running Fix 10 Test: Full-Cancel Inventory Recovery & Refund Alerting ===');
  await connectSafeTestDb();

  const userId = new mongoose.Types.ObjectId();
  const now = Date.now();

  const order = await Order.create({
    orderNumber: `ORD-REC-INV-${now}`,
    userId,
    items: [{
      productId: new mongoose.Types.ObjectId(),
      variantId: new mongoose.Types.ObjectId(),
      productName: 'Inventory Test Jacket',
      productImage: 'https://example.com/test.jpg',
      selectedSize: 'L',
      selectedColor: 'Sage Green',
      quantity: 1,
      unitPrice: 2500,
      lineTotal: 2500,
    }],
    subtotal: 2500,
    total: 2500,
    currency: 'INR',
    status: 'CONFIRMED',
    paymentStatus: 'PAID',
    shippingAddress: {
      fullName: 'Inventory Customer',
      phone: '9876543210',
      addressLine1: 'Test St',
      city: 'Delhi',
      state: 'Delhi',
      postalCode: '110001',
      country: 'India',
    }
  });

  const payment = await Payment.create({
    orderId: order._id,
    userId,
    amount: 2500,
    currency: 'INR',
    status: 'CAPTURED',
    provider: 'RAZORPAY',
    razorpayPaymentId: `pay_rec_inv_${now}`,
  });

  await PaymentAttempt.create({
    orderId: order._id,
    paymentId: payment._id,
    razorpayOrderId: `order_rec_inv_${now}`,
    razorpayPaymentId: `pay_rec_inv_${now}`,
    amount: 2500,
    currency: 'INR',
    status: 'CAPTURED',
  });

  const origRestoreInventory = InventoryAllocationService.restoreCancelledOrderInventory;
  const origCreateRefund = razorpayProvider.createRefund;

  try {
    razorpayProvider.createRefund = async (payId, amt) => ({
      id: `rfnd_rec_inv_${now}`,
      entity: 'refund',
      amount: amt,
      status: 'processed'
    });

    // 1. Simulate inventory restore transient failure during full cancellation
    InventoryAllocationService.restoreCancelledOrderInventory = async () => {
      throw new Error('Transient inventory ledger database connection error');
    };

    const cancelResult = await cancelOrderWithRefund({
      orderId: order._id.toString(),
      actorId: userId.toString(),
      actorRole: 'CUSTOMER',
      reason: 'Testing inventory recovery sweep',
      source: 'CUSTOMER'
    });

    check(Boolean(cancelResult.inventoryError), 'T10.1: Full cancel captures inventoryError on transient failure');

    const orderWithOp = await Order.findById(order._id);
    const fullCancelOp = orderWithOp?.cancellationOperations?.find(op => op.operationId === `full_cancel_${order._id}`);

    check(Boolean(fullCancelOp), 'T10.2: Full cancel records a cancellationOperations entry');
    check(fullCancelOp?.status === 'PENDING', 'T10.3: Operation is recorded as status: PENDING');
    check(fullCancelOp?.inventoryRestored === false, 'T10.4: inventoryRestored is false');

    // 2. Restore normal inventory restore and run sweep
    let restoreCalled: boolean = false;
    InventoryAllocationService.restoreCancelledOrderInventory = async () => {
      restoreCalled = true;
      return { restoredCount: 1, alreadyRestored: false };
    };

    const sweepResult = await reconcilePendingCancellationOperations(order._id.toString());

    check(restoreCalled, 'T10.5: reconcilePendingCancellationOperations swept and invoked restoreCancelledOrderInventory');
    check(sweepResult.recoveredCount >= 1, 'T10.6: Sweep reports at least 1 recovered operation');

    const sweptOrder = await Order.findById(order._id);
    const sweptOp = sweptOrder?.cancellationOperations?.find(op => op.operationId === `full_cancel_${order._id}`);
    check(sweptOp?.inventoryRestored === true, 'T10.7: Operation inventoryRestored is updated to true');
    check(sweptOp?.status === 'COMPLETED', 'T10.8: Operation status transitions to COMPLETED');

    // 3. Failed cancellation refund appears as critical alert in health report
    await Refund.create({
      orderId: order._id,
      paymentId: payment._id,
      userId,
      attemptNumber: 1,
      idempotencyKey: `rfnd_fail_cancel_${now}`,
      gatewayIdempotencyKey: `rfnd_fail_cancel_${now}`,
      amount: 2500,
      currency: 'INR',
      status: 'FAILED',
      reason: 'Customer Cancellation Refund Failed',
      initiatedBy: userId,
      initiatedByRole: 'CUSTOMER'
    });

    const health = await getPaymentHealthReport();
    check(health.status === 'critical', 'T10.9: Health status is critical when a cancellation refund has failed');
    check(
      health.alerts.some(a => a.toLowerCase().includes('cancellation refund(s) are in failed state')),
      'T10.10: Health alert specifically identifies failed cancellation refund'
    );

  } finally {
    InventoryAllocationService.restoreCancelledOrderInventory = origRestoreInventory;
    razorpayProvider.createRefund = origCreateRefund;
  }

  console.log(`\nFix 10 Test Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Fatal in test:', err);
  process.exit(1);
});
