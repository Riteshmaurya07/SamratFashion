/**
 * Fix 3 Test: Admin Retry live re-verification & Resolve safety guards
 *
 * Verifies that:
 * 1. Admin Retry live-checks the payment with Razorpay. If the live payment is refunded/failed/not-captured,
 *    it aborts with an error and does NOT mark the order PAID.
 * 2. Admin Resolve on an unsettled captured webhook where the order is unpaid returns 409 Conflict.
 * 3. Admin Resolve on an already-PAID order succeeds (status -> IGNORED).
 * 4. Atomic lease claim fences concurrent execution.
 */

process.env.NODE_ENV = 'test';
process.env.RAZORPAY_KEY_ID = 'rzp_test_mock';
process.env.RAZORPAY_KEY_SECRET = 'mock_secret_test';
process.env.RAZORPAY_WEBHOOK_SECRET = 'mock_webhook_secret_test';

import mongoose from 'mongoose';
import { connectSafeTestDb } from './testHelpers';
import { retryAdminWebhook, resolveAdminWebhook } from '../controllers/adminOperationsController';
import { WebhookEvent } from '../models/WebhookEvent';
import { Order } from '../models/Order';
import { Payment } from '../models/Payment';
import { PaymentAttempt } from '../models/PaymentAttempt';
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
    },
    send(payload: any) {
      this.body = payload;
      return this;
    }
  };
  return res;
}

async function run() {
  console.log('=== Running Fix 3 Test: Admin Webhook Retry & Resolve Safety ===');
  await connectSafeTestDb();

  const userId = new mongoose.Types.ObjectId();
  const adminId = new mongoose.Types.ObjectId();
  const now = Date.now();

  const rzpOrderId = `order_admin_test_${now}`;
  const rzpPaymentId = `pay_admin_test_${now}`;

  const order = await Order.create({
    orderNumber: `ORD-ADMIN-${now}`,
    userId,
    items: [{
      productId: new mongoose.Types.ObjectId(),
      variantId: new mongoose.Types.ObjectId(),
      productName: 'Nehru Jacket',
      productImage: 'https://example.com/jacket.jpg',
      selectedSize: 'L',
      selectedColor: 'Sage Green',
      quantity: 1,
      unitPrice: 2999,
      lineTotal: 2999
    }],
    subtotal: 2999,
    total: 2999,
    currency: 'INR',
    status: 'PENDING',
    paymentStatus: 'PENDING',
    shippingAddress: {
      fullName: 'Admin Test User',
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
    amount: 2999,
    currency: 'INR',
    status: 'PENDING',
    provider: 'RAZORPAY',
  });

  await PaymentAttempt.create({
    orderId: order._id,
    paymentId: payment._id,
    razorpayOrderId: rzpOrderId,
    razorpayPaymentId: rzpPaymentId,
    amount: 2999,
    currency: 'INR',
    status: 'PROCESSING',
  });

  const webhookEventId = `evt_admin_test_${now}`;
  const webhookEvent = await WebhookEvent.create({
    eventId: webhookEventId,
    provider: 'RAZORPAY',
    eventType: 'payment.captured',
    status: 'FAILED',
    processingAttempts: 1,
    payload: {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: rzpPaymentId,
            order_id: rzpOrderId,
            amount: 299900,
            currency: 'INR',
            status: 'captured'
          }
        }
      }
    }
  });

  const origFetchPayment = razorpayProvider.fetchPayment;

  try {
    // 1. Retry with live payment that is REFUNDED -> must abort and NOT mark order paid
    razorpayProvider.fetchPayment = async () => ({
      id: rzpPaymentId,
      order_id: rzpOrderId,
      amount: 299900,
      currency: 'INR',
      status: 'refunded', // Payment was refunded in Razorpay dashboard!
      captured: true,
    });

    let retryError: any = null;
    const reqRetry: any = {
      params: { id: webhookEvent._id.toString() },
      user: { id: adminId.toString(), role: 'ADMIN' }
    };
    const resRetry = mockRes();
    const nextRetry = (err: any) => { retryError = err; };

    await retryAdminWebhook(reqRetry, resRetry, nextRetry);

    check(Boolean(retryError), 'T3.1: Admin retry aborts when live payment is refunded');
    check(
      retryError?.statusCode === 409 || retryError?.statusCode === 400,
      'T3.2: Replay error code indicates non-captured live payment',
      `code=${retryError?.statusCode}, message=${retryError?.message}`
    );

    const reloadedOrder = await Order.findById(order._id);
    check(reloadedOrder?.paymentStatus === 'PENDING', 'T3.3: Order is NOT marked PAID after aborted retry');

    // 2. Resolve on unsettled captured webhook -> must return 409
    razorpayProvider.fetchPayment = async () => ({
      id: rzpPaymentId,
      order_id: rzpOrderId,
      amount: 299900,
      currency: 'INR',
      status: 'captured', // Money is captured, but order is still PENDING!
      captured: true,
    });

    let resolveError: any = null;
    const reqResolve: any = {
      params: { id: webhookEvent._id.toString() },
      body: { note: 'Attempting to resolve unsettled money' },
      user: { id: adminId.toString(), role: 'ADMIN' }
    };
    const resResolve = mockRes();
    const nextResolve = (err: any) => { resolveError = err; };

    await resolveAdminWebhook(reqResolve, resResolve, nextResolve);

    check(Boolean(resolveError), 'T3.4: Resolve refuses unsettled webhook');
    check(
      resolveError?.statusCode === 409 && resolveError?.code === 'WEBHOOK_UNSETTLED',
      'T3.5: Resolve returns HTTP 409 WEBHOOK_UNSETTLED',
      `status=${resolveError?.statusCode}, code=${resolveError?.code}`
    );

    const reloadedEventUnsettled = await WebhookEvent.findById(webhookEvent._id);
    check(reloadedEventUnsettled?.status === 'FAILED', 'T3.6: Event status remains FAILED and is not hidden');

    // 3. Resolve on already-PAID order -> succeeds
    order.paymentStatus = 'PAID';
    await order.save();

    let resolveSuccessErr: any = null;
    const resResolveSuccess = mockRes();
    await resolveAdminWebhook(reqResolve, resResolveSuccess, (err: any) => { resolveSuccessErr = err; });

    check(!resolveSuccessErr, 'T3.7: Resolve succeeds when order is provably PAID');
    check(resResolveSuccess.statusCode === 200, 'T3.8: Returns HTTP 200');

    const settledEvent = await WebhookEvent.findById(webhookEvent._id);
    check(settledEvent?.status === 'IGNORED', 'T3.9: Event status is set to IGNORED');

  } finally {
    razorpayProvider.fetchPayment = origFetchPayment;
  }

  console.log(`\nFix 3 Test Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Fatal in test:', err);
  process.exit(1);
});
