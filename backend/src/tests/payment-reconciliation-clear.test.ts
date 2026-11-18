/**
 * Fix 4 Test: Automatic & Admin clearing of Payment.reconciliationRequired flag
 *
 * Verifies that:
 * 1. Admin clear endpoint refuses with 409 when a duplicate refund is still pending.
 * 2. Automatic clear (clearPaymentReconciliationIfSettled) clears the flag when DuplicateCaptureRefund settles as PROCESSED.
 * 3. Later cancellation/refund succeeds without being blocked by 409 PAYMENT_RECONCILIATION_REQUIRED.
 * 4. Admin clear endpoint succeeds and clears the flag when no conflicts exist.
 */

process.env.NODE_ENV = 'test';
process.env.RAZORPAY_KEY_ID = 'rzp_test_mock';
process.env.RAZORPAY_KEY_SECRET = 'mock_secret_test';
process.env.RAZORPAY_WEBHOOK_SECRET = 'mock_webhook_secret_test';

import mongoose from 'mongoose';
import { connectSafeTestDb } from './testHelpers';
import { clearPaymentReconciliation } from '../controllers/adminOperationsController';
import { clearPaymentReconciliationIfSettled } from '../services/payment/paymentProcessor';
import { createInternalRefund } from '../services/payment/refundService';
import { Order } from '../models/Order';
import { Payment } from '../models/Payment';
import { PaymentAttempt } from '../models/PaymentAttempt';
import { DuplicateCaptureRefund } from '../models/DuplicateCaptureRefund';
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

function mockRes() {
  const res: any = {
    statusCode: 200,
    body: null,
    data: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.data = payload;
      this.body = payload;
      return this;
    }
  };
  return res;
}

async function run() {
  console.log('=== Running Fix 4 Test: Payment Reconciliation Clear Path ===');
  await connectSafeTestDb();

  const userId = new mongoose.Types.ObjectId();
  const adminId = new mongoose.Types.ObjectId();
  const now = Date.now();

  const rzpOrderId = `order_recon_${now}`;
  const rzpPrimaryCapture = `pay_prim_${now}`;
  const rzpDuplicateCapture = `pay_dup_${now}`;

  const order = await Order.create({
    orderNumber: `ORD-RECON-${now}`,
    userId,
    items: [{
      productId: new mongoose.Types.ObjectId(),
      variantId: new mongoose.Types.ObjectId(),
      productName: 'Sand Beige Nehru Jacket',
      productImage: 'https://example.com/beige.jpg',
      selectedSize: 'M',
      selectedColor: 'Sand Beige',
      quantity: 1,
      unitPrice: 2999,
      lineTotal: 2999
    }],
    subtotal: 2999,
    total: 2999,
    currency: 'INR',
    status: 'CONFIRMED',
    paymentStatus: 'PAID',
    shippingAddress: {
      fullName: 'Recon Test User',
      phone: '9876543210',
      addressLine1: 'Lane 1',
      city: 'Delhi',
      state: 'Delhi',
      postalCode: '110001',
      country: 'India',
    }
  });

  const payment = await Payment.create({
    orderId: order._id,
    userId,
    amount: 2999,
    currency: 'INR',
    status: 'CAPTURED',
    provider: 'RAZORPAY',
    razorpayPaymentId: rzpPrimaryCapture,
    reconciliationRequired: true,
    reconciliationReason: 'Duplicate capture detected: pending duplicate refund verification',
  });

  await PaymentAttempt.create({
    orderId: order._id,
    paymentId: payment._id,
    razorpayOrderId: rzpOrderId,
    razorpayPaymentId: rzpPrimaryCapture,
    amount: 2999,
    currency: 'INR',
    status: 'CAPTURED',
  });

  const duplicateAttempt = await PaymentAttempt.create({
    orderId: order._id,
    paymentId: payment._id,
    razorpayOrderId: rzpOrderId,
    razorpayPaymentId: rzpDuplicateCapture,
    amount: 2999,
    currency: 'INR',
    status: 'PROCESSING',
    failureCode: 'DUPLICATE_CAPTURE_REFUND_PENDING',
  });

  const duplicateRefund = await DuplicateCaptureRefund.create({
    orderId: order._id,
    paymentId: payment._id,
    paymentAttemptId: duplicateAttempt._id,
    capturePaymentId: rzpDuplicateCapture,
    amount: 2999,
    currency: 'INR',
    status: 'PENDING',
  });

  // 1. Admin clear endpoint refuses when duplicate refund is PENDING
  let adminClearErr: any = null;
  const reqAdmin: any = {
    params: { id: payment._id.toString() },
    user: { id: adminId.toString(), role: 'ADMIN' },
    body: { note: 'Trying to clear prematurely' }
  };
  const resAdmin = mockRes();
  await clearPaymentReconciliation(reqAdmin, resAdmin, (err: any) => { adminClearErr = err; });

  check(Boolean(adminClearErr), 'T4.1: Admin clear endpoint refuses while duplicate refund is pending');
  check(
    adminClearErr?.statusCode === 409 && adminClearErr?.code === 'DUPLICATE_REFUND_UNSETTLED',
    'T4.2: Admin clear endpoint returns HTTP 409 DUPLICATE_REFUND_UNSETTLED'
  );

  // 2. Duplicate refund settles as PROCESSED -> auto-clear clears the flag
  duplicateRefund.status = 'PROCESSED';
  duplicateRefund.razorpayRefundId = `rfnd_dup_${now}`;
  await duplicateRefund.save();

  duplicateAttempt.status = 'FAILED';
  duplicateAttempt.failureCode = 'DUPLICATE_CAPTURE_REFUNDED';
  await duplicateAttempt.save();

  const cleared = await clearPaymentReconciliationIfSettled(payment._id);
  check(cleared === true, 'T4.3: clearPaymentReconciliationIfSettled reports success');

  const reloadedPayment = await Payment.findById(payment._id);
  check(reloadedPayment?.reconciliationRequired === false, 'T4.4: Payment.reconciliationRequired is now false');

  // 3. Legitimate cancellation/refund now succeeds without 409
  const origCreateRefund = razorpayProvider.createRefund;
  razorpayProvider.createRefund = async (payId, amt) => ({
    id: `rfnd_legit_${Date.now()}`,
    entity: 'refund',
    amount: amt,
    status: 'processed'
  });

  try {
    const refundDoc = await createInternalRefund({
      orderId: order._id.toString(),
      amount: 2999,
      reason: 'Customer Cancellation After Duplicate Refund',
      actorId: userId.toString(),
      actorRole: 'CUSTOMER',
    });

    check(Boolean(refundDoc), 'T4.5: Refund created successfully after reconciliation flag cleared');
    check(refundDoc.status === 'PROCESSED', 'T4.6: Refund status is PROCESSED (no 409 block)');

    // 4. Admin clear endpoint test: flag an unconflicted payment and clear via endpoint
    reloadedPayment!.reconciliationRequired = true;
    reloadedPayment!.reconciliationReason = 'Transient flag';
    await reloadedPayment!.save();

    let adminClearSuccessErr: any = null;
    const resAdminSuccess = mockRes();
    await clearPaymentReconciliation(reqAdmin, resAdminSuccess, (err: any) => { adminClearSuccessErr = err; });

    check(!adminClearSuccessErr, 'T4.7: Admin clear endpoint succeeds when no conflicts remain');
    check(resAdminSuccess.statusCode === 200, 'T4.8: Admin clear endpoint returns HTTP 200');

    const finalPayment = await Payment.findById(payment._id);
    check(finalPayment?.reconciliationRequired === false, 'T4.9: Payment flag successfully cleared by admin endpoint');

  } finally {
    razorpayProvider.createRefund = origCreateRefund;
  }

  console.log(`\nFix 4 Test Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Fatal in test:', err);
  process.exit(1);
});
