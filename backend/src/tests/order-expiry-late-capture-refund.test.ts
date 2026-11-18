/**
 * Fix 8 Test: Expired Order Late-Capture Auto-Refund
 *
 * Verifies that:
 * 1. An expired order receiving a late gateway capture records the capture in Payment and PaymentAttempt.
 * 2. An automatic full refund is initiated immediately (via createInternalRefund).
 * 3. The order remains closed (status: 'EXPIRED').
 */

process.env.NODE_ENV = 'test';
process.env.RAZORPAY_KEY_ID = 'rzp_test_mock';
process.env.RAZORPAY_KEY_SECRET = 'mock_secret_test';
process.env.RAZORPAY_WEBHOOK_SECRET = 'mock_webhook_secret_test';

import mongoose from 'mongoose';
import { connectSafeTestDb } from './testHelpers';
import { processPaymentSuccess } from '../services/payment/paymentProcessor';
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
  console.log('=== Running Fix 8 Test: Expired Order Late-Capture Auto-Refund ===');
  await connectSafeTestDb();

  const userId = new mongoose.Types.ObjectId();
  const now = Date.now();
  const rzpOrderId = `order_late_${now}`;
  const lateCaptureId = `pay_late_${now}`;

  // 1. Create an expired order
  const expiredOrder = await Order.create({
    orderNumber: `ORD-EXP-${now}`,
    userId,
    items: [{
      productId: new mongoose.Types.ObjectId(),
      variantId: new mongoose.Types.ObjectId(),
      productName: 'Sage Green Nehru Jacket',
      productImage: 'https://example.com/sage.jpg',
      selectedSize: 'M',
      selectedColor: 'Sage Green',
      quantity: 1,
      unitPrice: 2999,
      lineTotal: 2999,
    }],
    subtotal: 2999,
    total: 2999,
    currency: 'INR',
    status: 'EXPIRED',
    paymentStatus: 'PENDING',
    shippingAddress: {
      fullName: 'Late Capture Customer',
      phone: '9876543210',
      addressLine1: 'Park Street',
      city: 'Delhi',
      state: 'Delhi',
      postalCode: '110001',
      country: 'India',
    }
  });

  const payment = await Payment.create({
    orderId: expiredOrder._id,
    userId,
    amount: 2999,
    currency: 'INR',
    status: 'PENDING',
    provider: 'RAZORPAY',
  });

  const attempt = await PaymentAttempt.create({
    orderId: expiredOrder._id,
    paymentId: payment._id,
    razorpayOrderId: rzpOrderId,
    amount: 2999,
    currency: 'INR',
    status: 'PROCESSING',
  });

  const origFetchPayment = razorpayProvider.fetchPayment;
  const origCreateRefund = razorpayProvider.createRefund;

  try {
    razorpayProvider.fetchPayment = async () => ({
      id: lateCaptureId,
      order_id: rzpOrderId,
      amount: 299900,
      currency: 'INR',
      status: 'captured',
      captured: true,
    });

    razorpayProvider.createRefund = async (payId, amt) => ({
      id: `rfnd_auto_late_${now}`,
      entity: 'refund',
      amount: amt,
      status: 'processed',
    });

    // 2. Process late capture
    const result = await processPaymentSuccess(rzpOrderId, lateCaptureId);

    check(Boolean(result && result.success === false), 'T8.1: Late capture process returns success: false for closed order');
    check(result?.reason === 'ORDER_CANCELLED', 'T8.2: Reason indicates ORDER_CANCELLED/closed order');

    // 3. Verify capture recorded in Payment & PaymentAttempt
    const reloadedAttempt = await PaymentAttempt.findById(attempt._id);
    check(reloadedAttempt?.status === 'CAPTURED', 'T8.3: PaymentAttempt status updated to CAPTURED');
    check(reloadedAttempt?.razorpayPaymentId === lateCaptureId, 'T8.4: Attempt stores captured payment ID');

    const reloadedPayment = await Payment.findById(payment._id);
    check(
      reloadedPayment?.status === 'CAPTURED' || reloadedPayment?.status === 'REFUNDED',
      'T8.5: Payment record updated to CAPTURED (or REFUNDED after auto-refund settlement)',
      `status=${reloadedPayment?.status}`
    );
    check(reloadedPayment?.razorpayPaymentId === lateCaptureId, 'T8.6: Payment stores captured payment ID');

    // 4. Verify automatic refund was created
    const refundDoc = await Refund.findOne({ orderId: expiredOrder._id });
    check(Boolean(refundDoc), 'T8.7: Automatic refund record was created for late capture');
    check(
      Boolean(
        (refundDoc?.idempotencyKey && refundDoc.idempotencyKey.includes(`late_capture_${attempt._id}`)) ||
        (refundDoc?.gatewayIdempotencyKey && refundDoc.gatewayIdempotencyKey.includes(`late_capture_${attempt._id}`)) ||
        refundDoc?.amount === 2999
      ),
      'T8.8: Refund matches late capture operation and amount',
      `amount=${refundDoc?.amount}, key=${refundDoc?.idempotencyKey}`
    );

    // 5. Verify order remains EXPIRED
    const reloadedOrder = await Order.findById(expiredOrder._id);
    check(reloadedOrder?.status === 'EXPIRED', 'T8.9: Order remains closed with status EXPIRED');

  } finally {
    razorpayProvider.fetchPayment = origFetchPayment;
    razorpayProvider.createRefund = origCreateRefund;
  }

  console.log(`\nFix 8 Test Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Fatal in test:', err);
  process.exit(1);
});
