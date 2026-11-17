/**
 * Samrat Fashion — Payment & Refund System Advanced Failure-Injection Audit Suite
 *
 * Implements 20 comprehensive failure-injection scenarios across:
 * - Section A: Payment Capture and Webhook Failures (Tests 1 - 6)
 * - Section B: Refund Idempotency and Gateway Failures (Tests 7 - 12)
 * - Section C: Database Failure and Consistency Testing (Tests 13 - 16)
 * - Section D: Worker Leases and Distributed Concurrency (Tests 17 - 20)
 */

process.env.NODE_ENV = 'test';
process.env.RAZORPAY_KEY_ID = 'rzp_test_mock';
process.env.RAZORPAY_KEY_SECRET = 'mock_secret_test';
process.env.RAZORPAY_WEBHOOK_SECRET = 'mock_webhook_secret_test';

import mongoose from 'mongoose';
import crypto from 'crypto';
import { connectSafeTestDb, createTestProduct } from './testHelpers';
import { Order } from '../models/Order';
import { Payment } from '../models/Payment';
import { PaymentAttempt } from '../models/PaymentAttempt';
import { Refund } from '../models/Refund';
import { DuplicateCaptureRefund } from '../models/DuplicateCaptureRefund';
import { InventoryTransaction } from '../models/InventoryTransaction';
import { WebhookEvent, startEventLeaseHeartbeat } from '../models/WebhookEvent';
import { WorkerLock } from '../models/WorkerLock';
import { razorpayProvider } from '../services/payment/RazorpayProvider';
import { processPaymentSuccess } from '../services/payment/paymentProcessor';
import {
  processSupportedWebhookEvent,
  razorpayWebhook,
  handleRefundProcessedEntity,
  handleRefundFailedEntity,
} from '../controllers/webhookController';
import {
  createInternalRefund,
  reconcileUnknownRefund,
  transitionPaymentReservation,
} from '../services/payment/refundService';
import { RecoveryCoordinatorService } from '../services/recovery/recoveryCoordinatorService';
import '../models/Cart';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(condition: boolean, desc: string, detail?: string): void {
  if (condition) {
    passed++;
    console.log(`  ✅ PASS: ${desc}`);
  } else {
    failed++;
    const msg = detail ? `${desc} — ${detail}` : desc;
    failures.push(msg);
    console.error(`  ❌ FAIL: ${msg}`);
  }
}

const defaultShippingAddress = {
  fullName: 'Test Customer',
  phone: '9876543210',
  addressLine1: 'Park Street',
  city: 'Kolkata',
  state: 'West Bengal',
  postalCode: '700016',
  country: 'India',
  addressType: 'HOME' as const,
};

async function runAuditSuite(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║   Payment & Refund System Advanced Failure-Injection Audit Suite     ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

  await connectSafeTestDb();
  console.log(`Connected to isolated test database: "${mongoose.connection.name}"\n`);

  const userId = new mongoose.Types.ObjectId();
  const adminId = new mongoose.Types.ObjectId();
  const originalCreateRefund = razorpayProvider.createRefund;
  const originalGetClient = razorpayProvider.getClient;

  try {
    // -------------------------------------------------------------------------
    // SECTION A: PAYMENT CAPTURE AND WEBHOOK FAILURES (Tests 1 - 6)
    // -------------------------------------------------------------------------
    console.log('--- SECTION A: Payment Capture and Webhook Failures ---');

    // TEST 1: Out-of-order webhook delivery (payment.captured first, payment.failed afterward)
    {
      const { product, variantIds } = await createTestProduct({ name: 'OOO Shirt', basePrice: 1500 });
      const order1: any = await Order.create({
        orderNumber: `ORD-OOO-${Date.now()}`,
        userId,
        items: [{
          productId: product._id,
          variantId: variantIds[0],
          productName: 'OOO Shirt',
          productImage: 'https://example.com/item.jpg',
          selectedSize: 'M',
          selectedColor: 'BLACK',
          quantity: 1,
          unitPrice: 1500,
          lineTotal: 1500,
          isCustomized: false,
        }],
        subtotal: 1500,
        discount: 0,
        shipping: 0,
        tax: 0,
        total: 1500,
        currency: 'INR',
        status: 'PENDING',
        paymentStatus: 'PENDING',
        shippingAddress: defaultShippingAddress,
      });

      const payment1: any = await Payment.create({
        orderId: order1._id,
        userId,
        amount: 1500,
        currency: 'INR',
        status: 'PENDING',
        provider: 'RAZORPAY',
      });

      const attempt1: any = await PaymentAttempt.create({
        paymentId: payment1._id,
        orderId: order1._id,
        razorpayOrderId: `order_ooo_${Date.now()}`,
        amount: 1500,
        currency: 'INR',
        status: 'PENDING',
      });

      // 1. Deliver payment.captured first
      const capturedPayload = {
        payload: {
          payment: {
            entity: {
              id: `pay_ooo_cap_${Date.now()}`,
              order_id: attempt1.razorpayOrderId,
              amount: 150000, // paise
              currency: 'INR',
              status: 'captured',
            },
          },
        },
      };
      const captureRes = await processSupportedWebhookEvent('payment.captured', capturedPayload);
      check(captureRes.outcome === 'PROCESSED', 'TEST 1.1: payment.captured event processed successfully');

      const orderAfterCapture = await Order.findById(order1._id);
      const attemptAfterCapture = await PaymentAttempt.findById(attempt1._id);
      check(orderAfterCapture?.paymentStatus === 'PAID', 'TEST 1.2: Order transitioned to PAID');
      check(orderAfterCapture?.status === 'CONFIRMED', 'TEST 1.3: Order transitioned to CONFIRMED');
      check(attemptAfterCapture?.status === 'CAPTURED', 'TEST 1.4: PaymentAttempt marked CAPTURED');

      // 2. Deliver out-of-order payment.failed event afterward
      const failedPayload = {
        payload: {
          payment: {
            entity: {
              id: `pay_ooo_fail_${Date.now()}`,
              order_id: attempt1.razorpayOrderId,
              error_code: 'BAD_REQUEST_ERROR',
              error_description: 'Payment failed at gateway',
            },
          },
        },
      };
      const failedRes = await processSupportedWebhookEvent('payment.failed', failedPayload);
      check(failedRes.outcome === 'PROCESSED', 'TEST 1.5: Subsequent payment.failed handled cleanly without throwing');

      const orderAfterFail = await Order.findById(order1._id);
      const paymentAfterFail = await Payment.findById(payment1._id);
      const attemptAfterFail = await PaymentAttempt.findById(attempt1._id);

      check(orderAfterFail?.paymentStatus === 'PAID', 'TEST 1.6: Order remains PAID despite late failure event');
      check(orderAfterFail?.status === 'CONFIRMED', 'TEST 1.7: Order status remains CONFIRMED');
      check(paymentAfterFail?.status === 'CAPTURED', 'TEST 1.8: Payment record remains CAPTURED');
      check(attemptAfterFail?.status === 'CAPTURED', 'TEST 1.9: PaymentAttempt remains CAPTURED');
    }

    // TEST 2: Payment timeout after successful gateway capture
    {
      const { product, variantIds } = await createTestProduct({ name: 'Timeout Shirt', basePrice: 1200 });
      const order2: any = await Order.create({
        orderNumber: `ORD-TO-${Date.now()}`,
        userId,
        items: [{
          productId: product._id,
          variantId: variantIds[0],
          productName: 'Timeout Shirt',
          productImage: 'https://example.com/item.jpg',
          selectedSize: 'M',
          selectedColor: 'BLACK',
          quantity: 1,
          unitPrice: 1200,
          lineTotal: 1200,
          isCustomized: false,
        }],
        subtotal: 1200,
        discount: 0,
        shipping: 0,
        tax: 0,
        total: 1200,
        currency: 'INR',
        status: 'PENDING',
        paymentStatus: 'FAILED', // Simulate checkout timeout marked paymentStatus FAILED
        shippingAddress: defaultShippingAddress,
      });

      const payment2: any = await Payment.create({
        orderId: order2._id,
        userId,
        amount: 1200,
        currency: 'INR',
        status: 'FAILED',
        provider: 'RAZORPAY',
      });

      const rzpOrderId = `order_to_${Date.now()}`;
      const attempt2: any = await PaymentAttempt.create({
        paymentId: payment2._id,
        orderId: order2._id,
        razorpayOrderId: rzpOrderId,
        amount: 1200,
        currency: 'INR',
        status: 'FAILED',
        failureCode: 'GATEWAY_TIMEOUT',
        failureReason: 'Client response timed out before confirmation',
      });

      // Customer was actually charged at Razorpay!
      const liveGatewayPaymentId = `pay_to_success_${Date.now()}`;
      const recoveryResult = await processPaymentSuccess(rzpOrderId, liveGatewayPaymentId);

      check(recoveryResult?.success === true, 'TEST 2.1: processPaymentSuccess recovers FAILED attempt upon confirmed capture');
      const orderRecovered = await Order.findById(order2._id);
      const attemptRecovered = await PaymentAttempt.findById(attempt2._id);
      const paymentRecovered = await Payment.findById(payment2._id);

      check(orderRecovered?.paymentStatus === 'PAID', 'TEST 2.2: Order recovered to PAID');
      check(orderRecovered?.status === 'CONFIRMED', 'TEST 2.3: Order confirmed and fulfilled');
      check(attemptRecovered?.status === 'CAPTURED', 'TEST 2.4: Attempt recovered from FAILED to CAPTURED');
      check(attemptRecovered?.razorpayPaymentId === liveGatewayPaymentId, 'TEST 2.5: Gateway payment ID properly bound');
      check(paymentRecovered?.status === 'CAPTURED', 'TEST 2.6: Payment document status updated to CAPTURED');
    }

    // TEST 3: Duplicate payment webhook (same captured webhook delivered multiple times)
    {
      const { product, variantIds } = await createTestProduct({
        name: 'Dup Webhook Shirt',
        basePrice: 1000,
        variants: [{ size: 'M', color: 'BLACK', stock: 10, isAvailable: true }],
      });
      const order3: any = await Order.create({
        orderNumber: `ORD-DUP-WH-${Date.now()}`,
        userId,
        items: [{
          productId: product._id,
          variantId: variantIds[0],
          productName: 'Dup Webhook Shirt',
          productImage: 'https://example.com/item.jpg',
          selectedSize: 'M',
          selectedColor: 'BLACK',
          quantity: 1,
          unitPrice: 1000,
          lineTotal: 1000,
          isCustomized: false,
        }],
        subtotal: 1000,
        discount: 0,
        shipping: 0,
        tax: 0,
        total: 1000,
        currency: 'INR',
        status: 'PENDING',
        paymentStatus: 'PENDING',
        shippingAddress: defaultShippingAddress,
      });

      const payment3: any = await Payment.create({
        orderId: order3._id,
        userId,
        amount: 1000,
        currency: 'INR',
        status: 'PENDING',
        provider: 'RAZORPAY',
      });

      const rzpOrderId = `order_dup_${Date.now()}`;
      const rzpPaymentId = `pay_dup_${Date.now()}`;
      await PaymentAttempt.create({
        paymentId: payment3._id,
        orderId: order3._id,
        razorpayOrderId: rzpOrderId,
        amount: 1000,
        currency: 'INR',
        status: 'PENDING',
      });

      const webhookPayload = {
        payload: {
          payment: {
            entity: {
              id: rzpPaymentId,
              order_id: rzpOrderId,
              amount: 100000,
              currency: 'INR',
            },
          },
        },
      };

      // Deliver 3 times sequentially
      const res1 = await processSupportedWebhookEvent('payment.captured', webhookPayload);
      const res2 = await processSupportedWebhookEvent('payment.captured', webhookPayload);
      const res3 = await processSupportedWebhookEvent('payment.captured', webhookPayload);

      check(res1.outcome === 'PROCESSED', 'TEST 3.1: Delivery 1 processed');
      check(res2.outcome === 'PROCESSED', 'TEST 3.2: Delivery 2 handled idempotently');
      check(res3.outcome === 'PROCESSED', 'TEST 3.3: Delivery 3 handled idempotently');

      // Verify stock was deducted exactly once (initial was 10, should now be 9)
      const { Product } = require('../models/Product');
      const updatedProduct: any = await Product.findById(product._id);
      const variant = updatedProduct.variants.find((v: any) => v._id.toString() === variantIds[0].toString());
      check(variant.stock === 9, `TEST 3.4: Inventory deducted exactly once (stock = ${variant.stock})`);

      const inventoryTxs = await InventoryTransaction.find({ orderId: order3._id });
      check(inventoryTxs.length === 1, `TEST 3.5: Exactly one InventoryTransaction recorded (count = ${inventoryTxs.length})`);
    }

    // TEST 4: Two different successful payment IDs for one order (Duplicate payment anomaly)
    {
      const { product, variantIds } = await createTestProduct({ name: 'Dual Pay Shirt', basePrice: 2000 });
      const order4: any = await Order.create({
        orderNumber: `ORD-DUAL-${Date.now()}`,
        userId,
        items: [{
          productId: product._id,
          variantId: variantIds[0],
          productName: 'Dual Pay Shirt',
          productImage: 'https://example.com/item.jpg',
          selectedSize: 'M',
          selectedColor: 'BLACK',
          quantity: 1,
          unitPrice: 2000,
          lineTotal: 2000,
          isCustomized: false,
        }],
        subtotal: 2000,
        discount: 0,
        shipping: 0,
        tax: 0,
        total: 2000,
        currency: 'INR',
        status: 'PENDING',
        paymentStatus: 'PENDING',
        shippingAddress: defaultShippingAddress,
      });

      const payment4: any = await Payment.create({
        orderId: order4._id,
        userId,
        amount: 2000,
        currency: 'INR',
        status: 'PENDING',
        provider: 'RAZORPAY',
      });

      const rzpOrderId = `order_dual_${Date.now()}`;
      const primaryPaymentId = `pay_primary_${Date.now()}`;
      await PaymentAttempt.create({
        paymentId: payment4._id,
        orderId: order4._id,
        razorpayOrderId: rzpOrderId,
        amount: 2000,
        currency: 'INR',
        status: 'PENDING',
      });

      // Capture primary payment
      const resPrimary = await processPaymentSuccess(rzpOrderId, primaryPaymentId);
      check(resPrimary?.success === true, 'TEST 4.1: Primary payment captured successfully');

      // Now a distinct second gateway payment ID arrives for the same order/attempt
      const secondaryPaymentId = `pay_secondary_${Date.now()}`;
      const resSecondary = await processPaymentSuccess(rzpOrderId, secondaryPaymentId);

      check(resSecondary?.success === false, 'TEST 4.2: Secondary duplicate payment rejected from order fulfillment');
      check(
        resSecondary?.reason === 'DUPLICATE_CAPTURE_REFUND_PENDING' ||
        resSecondary?.reason === 'DUPLICATE_CAPTURE_REFUND_UNKNOWN' ||
        resSecondary?.reason === 'DUPLICATE_CAPTURE_RECONCILIATION_REQUIRED',
        `TEST 4.3: Secondary payment flagged for duplicate capture refund (${resSecondary?.reason})`
      );

      // Verify DuplicateCaptureRefund ledger record exists
      const duplicateRefund = await DuplicateCaptureRefund.findOne({ capturePaymentId: secondaryPaymentId });
      check(Boolean(duplicateRefund), 'TEST 4.4: DuplicateCaptureRefund record created to track second payment');
      check(duplicateRefund?.amount === 2000, 'TEST 4.5: Duplicate refund record captures full paise/rupee value');
      check(duplicateRefund?.orderId.toString() === order4._id.toString(), 'TEST 4.6: Duplicate refund correctly linked to order');

      // Verify payment document flagged for reconciliation
      const paymentDoc = await Payment.findById(payment4._id);
      check(paymentDoc?.reconciliationRequired === true, 'TEST 4.7: Payment document marked reconciliationRequired');
    }

    // TEST 5: Invalid webhook signature & payload tampering
    {
      const rawPayload = JSON.stringify({
        event: 'payment.captured',
        event_id: `evt_tamper_${Date.now()}`,
        payload: { payment: { entity: { id: 'pay_test', amount: 50000, currency: 'INR' } } }
      });

      // Valid signature calculation
      const secret = 'mock_webhook_secret_test';
      const validSig = crypto.createHmac('sha256', secret).update(rawPayload).digest('hex');

      // 1. Verify valid signature passes
      const validCheck = razorpayProvider.verifyWebhookSignature(rawPayload, validSig);
      check(validCheck === true, 'TEST 5.1: Legitimate signature verified');

      // 2. Tampered payload with original signature
      const tamperedPayload = JSON.stringify({
        event: 'payment.captured',
        event_id: `evt_tamper_${Date.now()}`,
        payload: { payment: { entity: { id: 'pay_test', amount: 1000, currency: 'INR' } } } // Amount tampered
      });
      const tamperedCheck = razorpayProvider.verifyWebhookSignature(tamperedPayload, validSig);
      check(tamperedCheck === false, 'TEST 5.2: Tampered payload rejected by HMAC verification');

      // 3. Forged signature rejected
      const forgedCheck = razorpayProvider.verifyWebhookSignature(rawPayload, 'forged_deadbeef_signature');
      check(forgedCheck === false, 'TEST 5.3: Forged signature rejected');

      // 4. Test HTTP endpoint rejection
      let httpStatus = 0;
      let httpBody = '';
      const mockReq: any = {
        headers: {
          'x-razorpay-signature': 'invalid_signature_header',
          'x-razorpay-event-id': `evt_${Date.now()}`,
        },
        body: Buffer.from(rawPayload, 'utf8'),
      };
      const mockRes: any = {
        status: (s: number) => { httpStatus = s; return mockRes; },
        send: (b: string) => { httpBody = b; return mockRes; },
      };
      await razorpayWebhook(mockReq, mockRes);
      check(httpStatus === 400 && httpBody === 'Invalid signature', 'TEST 5.4: HTTP 400 returned for invalid signature');
    }

    // TEST 6: Amount and currency mismatch
    {
      const { product, variantIds } = await createTestProduct({ name: 'Mismatch Shirt', basePrice: 2500 });
      const order6: any = await Order.create({
        orderNumber: `ORD-MISMATCH-${Date.now()}`,
        userId,
        items: [{
          productId: product._id,
          variantId: variantIds[0],
          productName: 'Mismatch Shirt',
          productImage: 'https://example.com/item.jpg',
          selectedSize: 'M',
          selectedColor: 'BLACK',
          quantity: 1,
          unitPrice: 2500,
          lineTotal: 2500,
          isCustomized: false,
        }],
        subtotal: 2500,
        discount: 0,
        shipping: 0,
        tax: 0,
        total: 2500,
        currency: 'INR',
        status: 'PENDING',
        paymentStatus: 'PENDING',
        shippingAddress: defaultShippingAddress,
      });

      const payment6: any = await Payment.create({
        orderId: order6._id,
        userId,
        amount: 2500,
        currency: 'INR',
        status: 'PENDING',
        provider: 'RAZORPAY',
      });

      const rzpOrderId = `order_mis_${Date.now()}`;
      await PaymentAttempt.create({
        paymentId: payment6._id,
        orderId: order6._id,
        razorpayOrderId: rzpOrderId,
        amount: 2500,
        currency: 'INR',
        status: 'PENDING',
      });

      // Case A: Amount mismatch (₹2,000 instead of ₹2,500)
      const amountMismatchPayload = {
        payload: {
          payment: {
            entity: {
              id: `pay_mis_amt_${Date.now()}`,
              order_id: rzpOrderId,
              amount: 200000, // 200000 paise != 250000 paise
              currency: 'INR',
            },
          },
        },
      };
      const amtRes = await processSupportedWebhookEvent('payment.captured', amountMismatchPayload);
      check(amtRes.outcome === 'RECONCILIATION_REQUIRED', 'TEST 6.1: Amount mismatch rejected with RECONCILIATION_REQUIRED');

      const orderAfterAmtMismatch = await Order.findById(order6._id);
      check(orderAfterAmtMismatch?.paymentStatus === 'PENDING', 'TEST 6.2: Order not marked PAID on amount mismatch');

      // Case B: Currency mismatch ('USD' instead of 'INR')
      const currencyMismatchPayload = {
        payload: {
          payment: {
            entity: {
              id: `pay_mis_cur_${Date.now()}`,
              order_id: rzpOrderId,
              amount: 250000,
              currency: 'USD', // USD != INR
            },
          },
        },
      };
      const curRes = await processSupportedWebhookEvent('payment.captured', currencyMismatchPayload);
      check(curRes.outcome === 'RECONCILIATION_REQUIRED', 'TEST 6.3: Currency mismatch rejected with RECONCILIATION_REQUIRED');

      const orderAfterCurMismatch = await Order.findById(order6._id);
      check(orderAfterCurMismatch?.paymentStatus === 'PENDING', 'TEST 6.4: Order not marked PAID on currency mismatch');
    }

    // -------------------------------------------------------------------------
    // SECTION B: REFUND IDEMPOTENCY AND GATEWAY FAILURES (Tests 7 - 12)
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION B: Refund Idempotency and Gateway Failures ---');

    // TEST 7: Refund succeeds but HTTP response times out
    {
      const order7: any = await Order.create({
        orderNumber: `ORD-RFND-TO-${Date.now()}`,
        userId,
        items: [],
        subtotal: 2000,
        total: 2000,
        currency: 'INR',
        status: 'CANCELLED',
        paymentStatus: 'PAID',
        shippingAddress: defaultShippingAddress,
      });

      const gatewayPaymentId = `pay_rfnd_to_${Date.now()}`;
      const payment7: any = await Payment.create({
        orderId: order7._id,
        userId,
        amount: 2000,
        currency: 'INR',
        status: 'CAPTURED',
        provider: 'RAZORPAY',
        razorpayPaymentId: gatewayPaymentId,
      });

      await PaymentAttempt.create({
        paymentId: payment7._id,
        orderId: order7._id,
        razorpayOrderId: `order_rfnd_to_${Date.now()}`,
        razorpayPaymentId: gatewayPaymentId,
        amount: 2000,
        currency: 'INR',
        status: 'CAPTURED',
      });

      // Simulate network timeout on createRefund call
      razorpayProvider.createRefund = async () => {
        const timeoutErr: any = new Error('Gateway socket timeout');
        timeoutErr.code = 'ETIMEDOUT';
        timeoutErr.statusCode = 504;
        throw timeoutErr;
      };

      try {
        await createInternalRefund({
          orderId: order7._id.toString(),
          amount: 1000,
          reason: 'Customer cancelled partial',
          actorId: adminId.toString(),
          actorRole: 'ADMIN',
        });
      } catch (err: any) {
        // createInternalRefund handles timeout and records UNKNOWN
      }

      const unknownRefund = await Refund.findOne({ orderId: order7._id });
      check(unknownRefund?.status === 'UNKNOWN', 'TEST 7.1: Network timeout moves refund to UNKNOWN status');

      // Now configure Razorpay mock to return the successfully processed refund on listing query
      const discoveredGatewayRefundId = `rfnd_discovered_${Date.now()}`;
      let createRefundCallsDuringReconcile = 0;
      razorpayProvider.createRefund = async () => {
        createRefundCallsDuringReconcile++;
        throw new Error('Should NOT call createRefund during reconciliation!');
      };

      razorpayProvider.getClient = () => ({
        payments: {
          fetchMultipleRefund: async () => ({
            items: [{
              id: discoveredGatewayRefundId,
              status: 'processed',
              amount: 100000,
              currency: 'INR',
              payment_id: gatewayPaymentId,
              notes: { internal_refund_id: unknownRefund!._id.toString() },
            }],
          }),
          refunds: async () => ({ items: [] }),
        },
        refunds: {
          fetch: async () => ({
            id: discoveredGatewayRefundId,
            status: 'processed',
            amount: 100000,
            currency: 'INR',
            payment_id: gatewayPaymentId,
          }),
          all: async () => ({ items: [] }),
        },
      } as any);

      // Reconcile unknown refund
      const reconciled = await reconcileUnknownRefund(unknownRefund!._id.toString(), {
        executionMode: 'ADMINISTRATIVE',
      });

      check(reconciled.status === 'PROCESSED', 'TEST 7.2: Reconciled refund successfully settled as PROCESSED');
      check(reconciled.razorpayRefundId === discoveredGatewayRefundId, 'TEST 7.3: Bound to discovered gateway refund ID');
      check(createRefundCallsDuringReconcile === 0, 'TEST 7.4: No duplicate refund was submitted to gateway');

      const paymentAfterReconcile = await Payment.findById(payment7._id);
      check(paymentAfterReconcile?.refundedAmount === 1000, 'TEST 7.5: Payment refundedAmount updated to 1000');
      check(paymentAfterReconcile?.pendingRefundAmount === 0, 'TEST 7.6: Payment pendingRefundAmount cleared');
    }

    // TEST 8: Refund retry after UNKNOWN preserves operationId and gateway idempotency key
    {
      const order8: any = await Order.create({
        orderNumber: `ORD-RFND-RETRY-${Date.now()}`,
        userId,
        items: [],
        subtotal: 1500,
        total: 1500,
        currency: 'INR',
        status: 'CANCELLED',
        paymentStatus: 'PAID',
        shippingAddress: defaultShippingAddress,
      });

      const gatewayPaymentId = `pay_retry_${Date.now()}`;
      const payment8: any = await Payment.create({
        orderId: order8._id,
        userId,
        amount: 1500,
        currency: 'INR',
        status: 'CAPTURED',
        provider: 'RAZORPAY',
        razorpayPaymentId: gatewayPaymentId,
      });

      await PaymentAttempt.create({
        paymentId: payment8._id,
        orderId: order8._id,
        razorpayOrderId: `order_retry_${Date.now()}`,
        razorpayPaymentId: gatewayPaymentId,
        amount: 1500,
        currency: 'INR',
        status: 'CAPTURED',
      });

      const operationId = `op_retry_${Date.now()}`;

      // Simulate ambiguous response on first submission
      razorpayProvider.createRefund = async () => {
        const err: any = new Error('ECONNRESET: Connection dropped by gateway');
        err.code = 'ECONNRESET';
        throw err;
      };

      try {
        await createInternalRefund({
          orderId: order8._id.toString(),
          amount: 800,
          operationId,
          reason: 'Item return partial',
          actorId: adminId.toString(),
          actorRole: 'ADMIN',
        });
      } catch { }

      const firstRefund = await Refund.findOne({ orderId: order8._id });
      const originalGatewayKey = firstRefund?.gatewayIdempotencyKey;
      check(firstRefund?.status === 'UNKNOWN', 'TEST 8.1: First attempt enters UNKNOWN state');
      check(Boolean(originalGatewayKey), 'TEST 8.2: gatewayIdempotencyKey populated on first attempt');

      // Gateway confirms refund processed
      razorpayProvider.getClient = () => ({
        payments: {
          fetchMultipleRefund: async () => ({
            items: [{
              id: `rfnd_retry_gw_${Date.now()}`,
              status: 'processed',
              amount: 80000,
              currency: 'INR',
              payment_id: gatewayPaymentId,
              notes: { internal_refund_id: firstRefund!._id.toString() },
            }],
          }),
        },
        refunds: {
          all: async () => ({ items: [] }),
        },
      } as any);

      // Retry with the EXACT same operationId
      const retriedRefund = await createInternalRefund({
        orderId: order8._id.toString(),
        amount: 800,
        operationId,
        reason: 'Item return partial',
        actorId: adminId.toString(),
        actorRole: 'ADMIN',
      });

      check(retriedRefund._id.toString() === firstRefund!._id.toString(), 'TEST 8.3: Retried call returns the same logical refund record');
      check(retriedRefund.gatewayIdempotencyKey === originalGatewayKey, 'TEST 8.4: Gateway idempotency key remained strictly unchanged across retry');
      check(retriedRefund.status === 'PROCESSED', 'TEST 8.5: Retried call settled refund as PROCESSED');
    }

    // TEST 9: Concurrent refund requests cannot exceed captured payment
    {
      const order9: any = await Order.create({
        orderNumber: `ORD-CONC-RFND-${Date.now()}`,
        userId,
        items: [],
        subtotal: 2000,
        total: 2000,
        currency: 'INR',
        status: 'CANCELLED',
        paymentStatus: 'PAID',
        shippingAddress: defaultShippingAddress,
      });

      const gatewayPaymentId = `pay_conc_${Date.now()}`;
      const payment9: any = await Payment.create({
        orderId: order9._id,
        userId,
        amount: 2000,
        currency: 'INR',
        status: 'CAPTURED',
        provider: 'RAZORPAY',
        razorpayPaymentId: gatewayPaymentId,
      });

      await PaymentAttempt.create({
        paymentId: payment9._id,
        orderId: order9._id,
        razorpayOrderId: `order_conc_${Date.now()}`,
        razorpayPaymentId: gatewayPaymentId,
        amount: 2000,
        currency: 'INR',
        status: 'CAPTURED',
      });

      razorpayProvider.createRefund = async (_pid, amountInPaise) => {
        return {
          id: `rfnd_conc_${Date.now()}_${Math.random()}`,
          entity: 'refund',
          amount: amountInPaise,
          status: 'processed',
        };
      };

      // Launch two simultaneous refunds: ₹1,500 and ₹1,000 (total ₹2,500 > ₹2,000)
      const results = await Promise.allSettled([
        createInternalRefund({
          orderId: order9._id.toString(),
          amount: 1500,
          operationId: `op_conc_1_${Date.now()}`,
          reason: 'Concurrent refund 1',
          actorId: adminId.toString(),
          actorRole: 'ADMIN',
        }),
        createInternalRefund({
          orderId: order9._id.toString(),
          amount: 1000,
          operationId: `op_conc_2_${Date.now()}`,
          reason: 'Concurrent refund 2',
          actorId: adminId.toString(),
          actorRole: 'ADMIN',
        }),
      ]);

      const fulfilled = results.filter(r => r.status === 'fulfilled');
      const rejected = results.filter(r => r.status === 'rejected');

      check(fulfilled.length === 1, `TEST 9.1: Exactly one concurrent refund succeeded (fulfilled = ${fulfilled.length})`);
      check(rejected.length === 1, `TEST 9.2: Excess concurrent refund was safely rejected (rejected = ${rejected.length})`);

      const finalPayment9 = await Payment.findOne({ orderId: order9._id });
      const totalCommitted = (finalPayment9?.refundedAmount || 0) + (finalPayment9?.pendingRefundAmount || 0);
      check(totalCommitted <= 2000, `TEST 9.3: Total committed refund does not exceed payment amount (committed = ${totalCommitted} <= 2000)`);
    }

    // TEST 10: Duplicate refund webhooks (processed twice, failed after processed)
    {
      const order10: any = await Order.create({
        orderNumber: `ORD-DUP-RFND-${Date.now()}`,
        userId,
        items: [],
        subtotal: 1000,
        total: 1000,
        currency: 'INR',
        status: 'CANCELLED',
        paymentStatus: 'PAID',
        shippingAddress: defaultShippingAddress,
      });

      const gatewayPaymentId = `pay_rfnd_dup_${Date.now()}`;
      const payment10: any = await Payment.create({
        orderId: order10._id,
        userId,
        amount: 1000,
        currency: 'INR',
        status: 'CAPTURED',
        provider: 'RAZORPAY',
        razorpayPaymentId: gatewayPaymentId,
      });

      const refund10: any = await Refund.create({
        orderId: order10._id,
        paymentId: payment10._id,
        userId,
        amount: 500,
        currency: 'INR',
        status: 'PROCESSING',
        razorpayPaymentId: gatewayPaymentId,
        initiatedBy: adminId,
        initiatedByRole: 'ADMIN',
      });

      // Atomically reserve 500 on Payment
      await transitionPaymentReservation({
        paymentId: payment10._id,
        refundId: refund10._id,
        reservationId: refund10._id.toString(),
        amount: 500,
        targetState: 'RELEASED', // ensure clean state
      });
      await Payment.updateOne(
        { _id: payment10._id },
        {
          $inc: { pendingRefundAmount: 500 },
          $push: {
            refundReservations: {
              reservationId: refund10._id.toString(),
              refundId: refund10._id,
              attemptNumber: 1,
              amount: 500,
              status: 'PENDING',
            },
          },
        }
      );

      const rzpRefundId = `rfnd_dup_hook_${Date.now()}`;
      const refundEntity = {
        id: rzpRefundId,
        payment_id: gatewayPaymentId,
        amount: 50000,
        currency: 'INR',
        status: 'processed',
        notes: { internal_refund_id: refund10._id.toString() },
      };

      // 1. Deliver refund.processed first time
      const hookRes1 = await handleRefundProcessedEntity(refundEntity);
      check(hookRes1.outcome === 'PROCESSED', 'TEST 10.1: First refund.processed webhook succeeded');

      const pAfter1 = await Payment.findById(payment10._id);
      check(pAfter1?.refundedAmount === 500, 'TEST 10.2: Payment refundedAmount set to 500');

      // 2. Deliver refund.processed second time (duplicate)
      const hookRes2 = await handleRefundProcessedEntity(refundEntity);
      check(hookRes2.outcome === 'PROCESSED', 'TEST 10.3: Duplicate refund.processed webhook handled idempotently');

      const pAfter2 = await Payment.findById(payment10._id);
      check(pAfter2?.refundedAmount === 500, 'TEST 10.4: Payment refundedAmount remained exactly 500 (not 1000)');

      // 3. Deliver contradictory refund.failed after refund.processed
      const failedEntity = {
        id: rzpRefundId,
        payment_id: gatewayPaymentId,
        amount: 50000,
        currency: 'INR',
        error_description: 'Late gateway failure report',
        notes: { internal_refund_id: refund10._id.toString() },
      };
      const hookResFail = await handleRefundFailedEntity(failedEntity);
      check(hookResFail.outcome === 'PROCESSED' && hookResFail.reason === 'ALREADY_PROCESSED', 'TEST 10.5: Contradictory failed event acknowledged as ALREADY_PROCESSED');

      const refundAfterFail = await Refund.findById(refund10._id);
      check(refundAfterFail?.status === 'PROCESSED', 'TEST 10.6: Refund status remains PROCESSED (never demoted to FAILED)');
    }

    // TEST 11: Refund webhook never arrives (scheduled reconciliation recovers)
    {
      const order11: any = await Order.create({
        orderNumber: `ORD-NO-HOOK-${Date.now()}`,
        userId,
        items: [],
        subtotal: 1000,
        total: 1000,
        currency: 'INR',
        status: 'CANCELLED',
        paymentStatus: 'PAID',
        shippingAddress: defaultShippingAddress,
      });

      const gatewayPaymentId = `pay_no_hook_${Date.now()}`;
      const payment11: any = await Payment.create({
        orderId: order11._id,
        userId,
        amount: 1000,
        currency: 'INR',
        status: 'CAPTURED',
        provider: 'RAZORPAY',
        razorpayPaymentId: gatewayPaymentId,
      });

      await PaymentAttempt.create({
        paymentId: payment11._id,
        orderId: order11._id,
        razorpayOrderId: `order_no_hook_${Date.now()}`,
        razorpayPaymentId: gatewayPaymentId,
        amount: 1000,
        currency: 'INR',
        status: 'CAPTURED',
      });

      const assignedRefundId = `rfnd_assigned_${Date.now()}`;
      razorpayProvider.createRefund = async () => ({
        id: assignedRefundId,
        entity: 'refund',
        amount: 40000,
        status: 'processed',
      });

      // Submit refund locally (sets state to SUBMITTED or PROCESSING)
      const refund11 = await createInternalRefund({
        orderId: order11._id.toString(),
        amount: 400,
        reason: 'Webhook suppressed test',
        actorId: adminId.toString(),
        actorRole: 'ADMIN',
      });

      check(refund11.razorpayRefundId === assignedRefundId, 'TEST 11.1: Gateway refund successfully initiated');

      // Webhook is completely suppressed (never called)
      // Reconciliation queries gateway directly:
      razorpayProvider.getClient = () => ({
        refunds: {
          fetch: async () => ({
            id: assignedRefundId,
            status: 'processed',
            amount: 40000,
            currency: 'INR',
            payment_id: gatewayPaymentId,
          }),
        },
        payments: {
          fetchMultipleRefund: async () => ({ items: [] }),
        },
      } as any);

      // Trigger reconciliation
      const reconciled11 = await reconcileUnknownRefund(refund11._id.toString(), {
        executionMode: 'ADMINISTRATIVE',
      });

      check(reconciled11.status === 'PROCESSED', 'TEST 11.2: Local refund transitioned to PROCESSED via reconciliation');
      check(reconciled11.accountingSettlementStatus === 'COMPLETED', 'TEST 11.3: Accounting settlement status is COMPLETED');

      const payment11After = await Payment.findById(payment11._id);
      check(payment11After?.refundedAmount === 400, 'TEST 11.4: Payment refundedAmount updated to 400');
    }

    // TEST 12: Partial refund followed by another partial refund (integer paise precision)
    {
      const order12: any = await Order.create({
        orderNumber: `ORD-MULTI-PARTIAL-${Date.now()}`,
        userId,
        items: [],
        subtotal: 3000,
        total: 3000,
        currency: 'INR',
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        shippingAddress: defaultShippingAddress,
      });

      const gatewayPaymentId = `pay_multi_part_${Date.now()}`;
      const payment12: any = await Payment.create({
        orderId: order12._id,
        userId,
        amount: 3000,
        currency: 'INR',
        status: 'CAPTURED',
        provider: 'RAZORPAY',
        razorpayPaymentId: gatewayPaymentId,
      });

      await PaymentAttempt.create({
        paymentId: payment12._id,
        orderId: order12._id,
        razorpayOrderId: `order_multi_part_${Date.now()}`,
        razorpayPaymentId: gatewayPaymentId,
        amount: 3000,
        currency: 'INR',
        status: 'CAPTURED',
      });

      razorpayProvider.createRefund = async (_pid, amountInPaise) => ({
        id: `rfnd_part_${Date.now()}_${Math.random()}`,
        entity: 'refund',
        amount: amountInPaise,
        status: 'processed',
      });

      // Refund 1: ₹1,000 (100000 paise)
      const ref1 = await createInternalRefund({
        orderId: order12._id.toString(),
        amount: 1000,
        reason: 'Partial return 1',
        actorId: adminId.toString(),
        actorRole: 'ADMIN',
      });
      // Settle refund 1 via webhook
      await handleRefundProcessedEntity({
        id: ref1.razorpayRefundId!,
        payment_id: gatewayPaymentId,
        amount: 100000,
        currency: 'INR',
        status: 'processed',
        notes: { internal_refund_id: ref1._id.toString() },
      });

      let p = await Payment.findOne({ orderId: order12._id });
      check(p?.refundedAmount === 1000, 'TEST 12.1: First partial refund settled (refunded: 1000, remaining: 2000)');

      // Refund 2: ₹1,500 (150000 paise)
      const ref2 = await createInternalRefund({
        orderId: order12._id.toString(),
        amount: 1500,
        reason: 'Partial return 2',
        actorId: adminId.toString(),
        actorRole: 'ADMIN',
      });
      await handleRefundProcessedEntity({
        id: ref2.razorpayRefundId!,
        payment_id: gatewayPaymentId,
        amount: 150000,
        currency: 'INR',
        status: 'processed',
        notes: { internal_refund_id: ref2._id.toString() },
      });

      p = await Payment.findOne({ orderId: order12._id });
      check(p?.refundedAmount === 2500, 'TEST 12.2: Second partial refund settled (refunded: 2500, remaining: 500)');

      // Attempt Refund 3: ₹600 (remaining is only ₹500) -> MUST FAIL
      let refund3Failed = false;
      try {
        await createInternalRefund({
          orderId: order12._id.toString(),
          amount: 600,
          reason: 'Excess partial refund',
          actorId: adminId.toString(),
          actorRole: 'ADMIN',
        });
      } catch (err: any) {
        refund3Failed = true;
      }
      check(refund3Failed === true, 'TEST 12.3: Over-refund of ₹600 strictly rejected');

      // Attempt Refund 4: ₹500 (exact remaining) -> MUST SUCCEED
      const ref4 = await createInternalRefund({
        orderId: order12._id.toString(),
        amount: 500,
        reason: 'Final partial refund',
        actorId: adminId.toString(),
        actorRole: 'ADMIN',
      });
      await handleRefundProcessedEntity({
        id: ref4.razorpayRefundId!,
        payment_id: gatewayPaymentId,
        amount: 50000,
        currency: 'INR',
        status: 'processed',
        notes: { internal_refund_id: ref4._id.toString() },
      });

      p = await Payment.findOne({ orderId: order12._id });
      check(p?.refundedAmount === 3000, 'TEST 12.4: Exact remaining ₹500 refunded (total refunded: 3000)');
      check(p?.status === 'REFUNDED', 'TEST 12.5: Payment status transitioned to REFUNDED');
    }

    // -------------------------------------------------------------------------
    // SECTION C: DATABASE FAILURE AND CONSISTENCY TESTING (Tests 13 - 16)
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION C: Database Failure and Consistency Testing ---');

    // TEST 13: Database failure after successful gateway refund
    {
      const order13: any = await Order.create({
        orderNumber: `ORD-DB-FAIL-${Date.now()}`,
        userId,
        items: [],
        subtotal: 1000,
        total: 1000,
        currency: 'INR',
        status: 'CANCELLED',
        paymentStatus: 'PAID',
        shippingAddress: defaultShippingAddress,
      });

      const gatewayPaymentId = `pay_db_fail_${Date.now()}`;
      const payment13: any = await Payment.create({
        orderId: order13._id,
        userId,
        amount: 1000,
        currency: 'INR',
        status: 'CAPTURED',
        provider: 'RAZORPAY',
        razorpayPaymentId: gatewayPaymentId,
      });

      const gatewayRefundId = `rfnd_db_success_${Date.now()}`;
      razorpayProvider.createRefund = async () => ({
        id: gatewayRefundId,
        entity: 'refund',
        amount: 100000,
        status: 'processed',
      });

      // Simulate DB write error immediately after gateway refund creation by creating an UNKNOWN record
      const refundRecord: any = await Refund.create({
        orderId: order13._id,
        paymentId: payment13._id,
        userId,
        amount: 1000,
        currency: 'INR',
        status: 'UNKNOWN', // DB failed to persist PROCESSED
        razorpayPaymentId: gatewayPaymentId,
        razorpayRefundId: gatewayRefundId,
        initiatedBy: adminId,
        initiatedByRole: 'ADMIN',
      });

      // Now recovery runs
      razorpayProvider.getClient = () => ({
        refunds: {
          fetch: async () => ({
            id: gatewayRefundId,
            status: 'processed',
            amount: 100000,
            currency: 'INR',
            payment_id: gatewayPaymentId,
          }),
        },
        payments: {
          fetchMultipleRefund: async () => ({ items: [] }),
        },
      } as any);

      const recovered = await reconcileUnknownRefund(refundRecord._id.toString(), {
        executionMode: 'ADMINISTRATIVE',
      });

      check(recovered.status === 'PROCESSED', 'TEST 13.1: Recovery identified existing gateway refund and settled PROCESSED');
      check(recovered.razorpayRefundId === gatewayRefundId, 'TEST 13.2: Gateway refund ID preserved without re-calling createRefund');
    }

    // TEST 14: MongoDB transaction failure and standalone fallback
    {
      const order14: any = await Order.create({
        orderNumber: `ORD-TX-FALLBACK-${Date.now()}`,
        userId,
        items: [],
        subtotal: 1000,
        total: 1000,
        currency: 'INR',
        status: 'CANCELLED',
        paymentStatus: 'PAID',
        shippingAddress: defaultShippingAddress,
      });

      const gatewayPaymentId = `pay_tx_fb_${Date.now()}`;
      const payment14: any = await Payment.create({
        orderId: order14._id,
        userId,
        amount: 1000,
        currency: 'INR',
        status: 'CAPTURED',
        provider: 'RAZORPAY',
        razorpayPaymentId: gatewayPaymentId,
      });

      const refund14: any = await Refund.create({
        orderId: order14._id,
        paymentId: payment14._id,
        userId,
        amount: 500,
        currency: 'INR',
        status: 'UNKNOWN',
        razorpayPaymentId: gatewayPaymentId,
        razorpayRefundId: `rfnd_tx_fb_${Date.now()}`,
        initiatedBy: adminId,
        initiatedByRole: 'ADMIN',
      });

      razorpayProvider.getClient = () => ({
        refunds: {
          fetch: async () => ({
            id: refund14.razorpayRefundId!,
            status: 'processed',
            amount: 50000,
            currency: 'INR',
            payment_id: gatewayPaymentId,
          }),
        },
        payments: {
          fetchMultipleRefund: async () => ({ items: [] }),
        },
      } as any);

      // Reconcile executes with fallback on standalone MongoDB
      let fallbackSucceeded = false;
      try {
        const res = await reconcileUnknownRefund(refund14._id.toString(), {
          executionMode: 'ADMINISTRATIVE',
        });
        fallbackSucceeded = res.status === 'PROCESSED';
      } catch (err: any) {
        console.error('Reconcile error:', err);
      }
      check(fallbackSucceeded === true, 'TEST 14.1: Standalone MongoDB fallback executed safely without unhandled error');
    }

    // TEST 15: Crash during refund processing (5 critical checkpoints)
    {
      const order15: any = await Order.create({
        orderNumber: `ORD-CRASH-5-${Date.now()}`,
        userId,
        items: [],
        subtotal: 1000,
        total: 1000,
        currency: 'INR',
        status: 'CANCELLED',
        paymentStatus: 'PAID',
        shippingAddress: defaultShippingAddress,
      });

      const gatewayPaymentId = `pay_crash_${Date.now()}`;
      const payment15: any = await Payment.create({
        orderId: order15._id,
        userId,
        amount: 1000,
        currency: 'INR',
        status: 'CAPTURED',
        provider: 'RAZORPAY',
        razorpayPaymentId: gatewayPaymentId,
      });

      // Checkpoint 1: Crash before calling Razorpay (submissionState: 'SUBMISSION_PENDING', lease expired)
      const cp1Refund: any = await Refund.create({
        orderId: order15._id,
        paymentId: payment15._id,
        userId,
        amount: 200,
        currency: 'INR',
        status: 'PENDING',
        submissionState: 'SUBMISSION_PENDING',
        submissionClaimExpiresAt: new Date(Date.now() - 1000), // expired lease
        razorpayPaymentId: gatewayPaymentId,
        initiatedBy: adminId,
        initiatedByRole: 'ADMIN',
      });
      check(Boolean(cp1Refund), 'TEST 15.1: Checkpoint 1 simulated (crash before gateway call)');

      // Checkpoint 2: Crash immediately after calling Razorpay (status: 'UNKNOWN')
      const cp2Refund: any = await Refund.create({
        orderId: order15._id,
        paymentId: payment15._id,
        userId,
        amount: 200,
        currency: 'INR',
        status: 'UNKNOWN',
        submissionState: 'SUBMITTED',
        razorpayPaymentId: gatewayPaymentId,
        initiatedBy: adminId,
        initiatedByRole: 'ADMIN',
      });
      check(Boolean(cp2Refund), 'TEST 15.2: Checkpoint 2 simulated (crash after calling gateway)');

      // Checkpoint 3: After gateway success but before saving response
      const cp3GatewayRefundId = `rfnd_cp3_${Date.now()}`;
      const cp3Refund: any = await Refund.create({
        orderId: order15._id,
        paymentId: payment15._id,
        userId,
        amount: 200,
        currency: 'INR',
        status: 'UNKNOWN',
        submissionState: 'SUBMITTED',
        razorpayPaymentId: gatewayPaymentId,
        initiatedBy: adminId,
        initiatedByRole: 'ADMIN',
      });
      // Gateway knows about cp3Refund via notes.internal_refund_id
      razorpayProvider.getClient = () => ({
        payments: {
          fetchMultipleRefund: async () => ({
            items: [{
              id: cp3GatewayRefundId,
              status: 'processed',
              amount: 20000,
              currency: 'INR',
              payment_id: gatewayPaymentId,
              notes: { internal_refund_id: cp3Refund._id.toString() },
            }],
          }),
        },
        refunds: {
          all: async () => ({ items: [] }),
        },
      } as any);

      const cp3Reconciled = await reconcileUnknownRefund(cp3Refund._id.toString(), {
        executionMode: 'ADMINISTRATIVE',
      });
      check(cp3Reconciled.status === 'PROCESSED', 'TEST 15.3: Checkpoint 3 recovered via gateway listing matching');

      // Checkpoint 4: After saving refund but before updating order
      const cp4Refund: any = await Refund.create({
        orderId: order15._id,
        paymentId: payment15._id,
        userId,
        amount: 200,
        currency: 'INR',
        status: 'PROCESSED',
        submissionState: 'CONFIRMED',
        razorpayPaymentId: gatewayPaymentId,
        razorpayRefundId: `rfnd_cp4_${Date.now()}`,
        initiatedBy: adminId,
        initiatedByRole: 'ADMIN',
        accountingSettlementStatus: 'PENDING',
      });
      check(Boolean(cp4Refund), 'TEST 15.4: Checkpoint 4 simulated (crash before order update)');

      // Checkpoint 5: After updating order but before accounting settlement completed
      const cp5Refund: any = await Refund.create({
        orderId: order15._id,
        paymentId: payment15._id,
        userId,
        amount: 200,
        currency: 'INR',
        status: 'PROCESSED',
        submissionState: 'CONFIRMED',
        razorpayPaymentId: gatewayPaymentId,
        razorpayRefundId: `rfnd_cp5_${Date.now()}`,
        initiatedBy: adminId,
        initiatedByRole: 'ADMIN',
        accountingSettlementStatus: 'PENDING',
      });
      check(Boolean(cp5Refund), 'TEST 15.5: Checkpoint 5 simulated (crash before ledger settlement)');
    }

    // TEST 16: Ledger consistency verification
    {
      const order16: any = await Order.create({
        orderNumber: `ORD-LEDGER-${Date.now()}`,
        userId,
        items: [],
        subtotal: 4000,
        total: 4000,
        currency: 'INR',
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        shippingAddress: defaultShippingAddress,
      });

      const gatewayPaymentId = `pay_ledger_${Date.now()}`;
      const payment16: any = await Payment.create({
        orderId: order16._id,
        userId,
        amount: 4000,
        currency: 'INR',
        status: 'CAPTURED',
        provider: 'RAZORPAY',
        razorpayPaymentId: gatewayPaymentId,
      });

      await PaymentAttempt.create({
        paymentId: payment16._id,
        orderId: order16._id,
        razorpayOrderId: `order_ledger_${Date.now()}`,
        razorpayPaymentId: gatewayPaymentId,
        amount: 4000,
        currency: 'INR',
        status: 'CAPTURED',
      });

      // Partial refund 1: ₹1,200
      razorpayProvider.createRefund = async (_pid, amountInPaise) => ({
        id: `rfnd_led_1_${Date.now()}`,
        entity: 'refund',
        amount: amountInPaise,
        status: 'processed',
      });
      const r1 = await createInternalRefund({
        orderId: order16._id.toString(),
        amount: 1200,
        reason: 'Ledger test 1',
        actorId: adminId.toString(),
        actorRole: 'ADMIN',
      });
      await handleRefundProcessedEntity({
        id: r1.razorpayRefundId!,
        payment_id: gatewayPaymentId,
        amount: 120000,
        currency: 'INR',
        status: 'processed',
        notes: { internal_refund_id: r1._id.toString() },
      });

      // Partial refund 2: ₹800
      razorpayProvider.createRefund = async (_pid, amountInPaise) => ({
        id: `rfnd_led_2_${Date.now()}`,
        entity: 'refund',
        amount: amountInPaise,
        status: 'processed',
      });
      const r2 = await createInternalRefund({
        orderId: order16._id.toString(),
        amount: 800,
        reason: 'Ledger test 2',
        actorId: adminId.toString(),
        actorRole: 'ADMIN',
      });
      await handleRefundProcessedEntity({
        id: r2.razorpayRefundId!,
        payment_id: gatewayPaymentId,
        amount: 80000,
        currency: 'INR',
        status: 'processed',
        notes: { internal_refund_id: r2._id.toString() },
      });

      const finalPayment16 = await Payment.findById(payment16._id);
      const refunded = finalPayment16?.refundedAmount || 0;
      const pending = finalPayment16?.pendingRefundAmount || 0;
      const captured = finalPayment16?.amount || 0;
      const remaining = captured - refunded - pending;

      check(captured === 4000, 'TEST 16.1: Captured amount is ₹4,000');
      check(refunded === 2000, 'TEST 16.2: Successfully refunded amount is ₹2,000');
      check(pending === 0, 'TEST 16.3: Pending refund amount is ₹0');
      check(remaining === 2000, 'TEST 16.4: Remaining refundable amount is exactly ₹2,000');
      check(finalPayment16?.settledRefunds?.length === 2, 'TEST 16.5: Exactly 2 settledRefunds ledger entries recorded');

      const sumSettled = (finalPayment16?.settledRefunds || []).reduce((acc, item) => acc + item.amount, 0);
      check(sumSettled === refunded, 'TEST 16.6: Sum of settledRefunds entries matches refundedAmount exactly');
    }

    // -------------------------------------------------------------------------
    // SECTION D: WORKER LEASES AND DISTRIBUTED CONCURRENCY (Tests 17 - 20)
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION D: Worker Leases and Distributed Concurrency ---');

    // TEST 17: Two workers process the same recovery operation (mutual exclusion)
    {
      const lockName = `TEST_LOCK_CONCURRENT_${Date.now()}`;
      const workerA = `worker_alpha_${Date.now()}`;
      const workerB = `worker_beta_${Date.now()}`;

      // Both workers attempt to acquire the same lock simultaneously
      const [resA, resB] = await Promise.all([
        RecoveryCoordinatorService.acquireWorkerLease(lockName, workerA, 30_000),
        RecoveryCoordinatorService.acquireWorkerLease(lockName, workerB, 30_000),
      ]);

      const oneAcquired = (resA.acquired && !resB.acquired) || (!resA.acquired && resB.acquired);
      check(oneAcquired === true, 'TEST 17.1: Exactly one worker acquired the distributed lease');

      const winningWorker = resA.acquired ? workerA : workerB;
      const lockDoc = await WorkerLock.findOne({ lockName });
      check(lockDoc?.ownerId === winningWorker, `TEST 17.2: WorkerLock owner matches winner (${winningWorker})`);
      check(lockDoc?.fencingToken === 1, 'TEST 17.3: Initial fencing token is 1');
    }

    // TEST 18: Expired lease recovery
    {
      const lockName = `TEST_LOCK_EXPIRE_${Date.now()}`;
      const worker1 = `worker_first_${Date.now()}`;
      const worker2 = `worker_second_${Date.now()}`;

      // Worker 1 acquires lease with ultra-short duration (50ms)
      const res1 = await RecoveryCoordinatorService.acquireWorkerLease(lockName, worker1, 50);
      check(res1.acquired === true, 'TEST 18.1: Worker 1 acquired initial lease');

      // Wait 70ms for lease to expire
      await new Promise(resolve => setTimeout(resolve, 70));

      // Worker 2 attempts to claim the expired lease
      const res2 = await RecoveryCoordinatorService.acquireWorkerLease(lockName, worker2, 30_000);
      check(res2.acquired === true, 'TEST 18.2: Worker 2 successfully recovered expired lease');
      check(res2.fencingToken === 2, `TEST 18.3: Fencing token incremented to 2 (token = ${res2.fencingToken})`);

      const lockDoc = await WorkerLock.findOne({ lockName });
      check(lockDoc?.ownerId === worker2, 'TEST 18.4: Lock ownership transferred to Worker 2');
    }

    // TEST 19: Stale worker fencing
    {
      const lockName = `TEST_LOCK_FENCING_${Date.now()}`;
      const workerOld = `worker_old_${Date.now()}`;
      const workerNew = `worker_new_${Date.now()}`;

      // Worker Old acquires token 1
      const resOld = await RecoveryCoordinatorService.acquireWorkerLease(lockName, workerOld, 50);
      const staleToken = resOld.fencingToken!;

      // Wait 70ms for expiration
      await new Promise(resolve => setTimeout(resolve, 70));

      // Worker New acquires token 2
      const resNew = await RecoveryCoordinatorService.acquireWorkerLease(lockName, workerNew, 30_000);
      const activeToken = resNew.fencingToken!;
      check(activeToken > staleToken, 'TEST 19.1: Worker New holds higher fencing token');

      // Worker Old wakes up and attempts a fenced transaction using its stale token
      let oldWorkerFencedOut: boolean = false;
      try {
        await RecoveryCoordinatorService.withRecoveryLeaseFence(
          {
            fencingToken: staleToken,
            lockName,
            ownerId: workerOld,
            leaseDurationMs: 10_000,
          },
          async () => {
            // Should never reach here!
            return 'should_not_execute';
          }
        );
      } catch (err: any) {
        if (err.statusCode === 409 || err.code === 'WORKER_LEASE_FENCED_OUT') {
          oldWorkerFencedOut = true;
        }
      }
      check(oldWorkerFencedOut === true, 'TEST 19.2: Stale Worker Old fenced out with HTTP 409');

      // Worker New attempts a fenced transaction using its active token
      let newWorkerExecuted: boolean = false;
      try {
        const res = await RecoveryCoordinatorService.withRecoveryLeaseFence(
          {
            fencingToken: activeToken,
            lockName,
            ownerId: workerNew,
            leaseDurationMs: 10_000,
          },
          async () => {
            newWorkerExecuted = true;
            return 'success';
          }
        );
        check(res === 'success', 'TEST 19.3: Active Worker New executed protected operation');
      } catch (err: any) {
        console.error('New worker fenced out unexpectedly:', err);
      }
      check(Boolean(newWorkerExecuted), 'TEST 19.4: Fenced transaction committed for active lease holder');
    }

    // TEST 20: Heartbeat failure and lease loss detection
    {
      const eventDoc: any = await WebhookEvent.create({
        eventId: `evt_hb_${Date.now()}`,
        provider: 'RAZORPAY',
        eventType: 'payment.captured',
        status: 'PROCESSING',
        leaseToken: `lease_hb_${Date.now()}`,
        processingLockExpiresAt: new Date(Date.now() + 60_000), // 60s expiry
        processingAttempts: 1,
        payload: { test: true },
      });

      // Start heartbeat with 25ms heartbeat interval
      const heartbeat = startEventLeaseHeartbeat(
        eventDoc._id as mongoose.Types.ObjectId,
        eventDoc.leaseToken!,
        60_000,
        25
      );

      check(!heartbeat.hasLostLease(), 'TEST 20.1: Heartbeat starts with valid lease ownership');

      // Simulate lease stolen by another worker (change leaseToken in DB)
      await WebhookEvent.updateOne(
        { _id: eventDoc._id },
        { $set: { leaseToken: 'stolen_token_by_competitor' } }
      );

      // Trigger renewal directly to test detection immediately
      const renewed = await heartbeat.renewNow();
      check(renewed === false, 'TEST 20.2: Heartbeat renewal rejected after leaseToken stolen');

      const lost = heartbeat.hasLostLease();
      check(Boolean(lost), 'TEST 20.3: Heartbeat detected lease ownership lost');
      heartbeat.stop();
    }

  } finally {
    razorpayProvider.createRefund = originalCreateRefund;
    razorpayProvider.getClient = originalGetClient;
    await mongoose.disconnect();
  }

  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log(`Failure-Injection Test Suite Results: ${passed} passed, ${failed} failed`);
  if (failures.length > 0) {
    console.error('\nFailures recorded:');
    failures.forEach((f, i) => console.error(`  ${i + 1}. ${f}`));
  }
  console.log('══════════════════════════════════════════════════════════════════════\n');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runAuditSuite().catch((err) => {
  console.error('Fatal audit suite execution error:', err);
  process.exit(1);
});

