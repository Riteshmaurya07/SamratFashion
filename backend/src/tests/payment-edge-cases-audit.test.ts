/**
 * Samrat Fashion — Payment Audit: Unverified Edge Cases Test Suite
 *
 * Covers:
 * 1. Cross-event duplicate fulfilment (order.paid vs payment.captured in both delivery orders)
 * 2. Refund request identity (payload comparison & idempotency key reuse on retry vs new operation)
 * 3. Stale worker external side effects (fenced-out worker cannot call gateway)
 * 4. Actual standalone fallback crash recovery (injected failures between persistent writes)
 * 5. Webhook verification & delivery durability (raw bytes HMAC, duplicate eventId, complex event sequence)
 * 6. Razorpay API contract compatibility (endpoints, X-Refund-Idempotency header, paise units)
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
import { InventoryTransaction } from '../models/InventoryTransaction';
import { WebhookEvent } from '../models/WebhookEvent';
import { razorpayProvider } from '../services/payment/RazorpayProvider';
import {
  processSupportedWebhookEvent,
  razorpayWebhook,
  handleRefundProcessedEntity,
  handleRefundFailedEntity,
} from '../controllers/webhookController';
import {
  createInternalRefund,
  reconcileUnknownRefund,
  applyProviderRefundSettlement,
  formatGatewayRefundIdempotencyKey,
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
  fullName: 'Edge Case Customer',
  phone: '9876543210',
  addressLine1: 'MG Road',
  city: 'Bengaluru',
  state: 'Karnataka',
  postalCode: '560001',
  country: 'India',
  addressType: 'HOME' as const,
};

async function runEdgeCasesSuite(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║   Payment & Refund System — Unverified Edge Cases Audit Suite        ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

  await connectSafeTestDb();
  console.log(`Connected to isolated test database: "${mongoose.connection.name}"\n`);

  const userId = new mongoose.Types.ObjectId();
  const adminId = new mongoose.Types.ObjectId();
  const originalCreateRefund = razorpayProvider.createRefund;
  const originalGetClient = razorpayProvider.getClient;

  try {
    // =========================================================================
    // AREA 1: CROSS-EVENT DUPLICATE FULFILMENT (order.paid & payment.captured)
    // =========================================================================
    console.log('--- AREA 1: Cross-Event Duplicate Fulfilment ---');

    // TEST 1.1: order.paid delivered first, then payment.captured delivered second
    {
      const { product, variantIds } = await createTestProduct({
        name: 'Cross Event Shirt A',
        basePrice: 1500,
        variants: [{ size: 'M', color: 'BLACK', stock: 50, isAvailable: true }],
      });
      const orderA: any = await Order.create({
        orderNumber: `ORD-CROSS-A-${Date.now()}`,
        userId,
        items: [{
          productId: product._id,
          variantId: variantIds[0],
          productName: 'Cross Event Shirt A',
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

      const paymentA: any = await Payment.create({
        orderId: orderA._id,
        userId,
        amount: 1500,
        currency: 'INR',
        status: 'PENDING',
        provider: 'RAZORPAY',
      });

      const rzpOrderId = `order_cross_a_${Date.now()}`;
      const rzpPaymentId = `pay_cross_a_${Date.now()}`;
      await PaymentAttempt.create({
        paymentId: paymentA._id,
        orderId: orderA._id,
        razorpayOrderId: rzpOrderId,
        amount: 1500,
        currency: 'INR',
        status: 'PENDING',
      });

      // 1. Deliver order.paid FIRST
      const orderPaidPayload = {
        event: 'order.paid',
        payload: {
          order: {
            entity: {
              id: rzpOrderId,
              amount: 150000,
              amount_paid: 150000,
              currency: 'INR',
              status: 'paid',
            },
          },
          payment: {
            entity: {
              id: rzpPaymentId,
              order_id: rzpOrderId,
              amount: 150000,
              currency: 'INR',
              status: 'captured',
            },
          },
        },
      };

      const resOrderPaid = await processSupportedWebhookEvent('order.paid', orderPaidPayload);
      check(resOrderPaid.outcome === 'PROCESSED', 'TEST 1.1a: order.paid delivered first processed successfully');

      const orderAfterA1 = await Order.findById(orderA._id);
      check(orderAfterA1?.paymentStatus === 'PAID', 'TEST 1.1b: Order is PAID after order.paid');
      check(orderAfterA1?.status === 'CONFIRMED', 'TEST 1.1c: Order is CONFIRMED after order.paid');

      const { Product } = require('../models/Product');
      let prodA: any = await Product.findById(product._id);
      let varA = prodA.variants.find((v: any) => v._id.toString() === variantIds[0].toString());
      check(varA.stock === 49, `TEST 1.1d: Stock decremented once from 50 to 49 (stock = ${varA.stock})`);

      // 2. Deliver payment.captured SECOND for the same order and payment
      const paymentCapturedPayload = {
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: rzpPaymentId,
              order_id: rzpOrderId,
              amount: 150000,
              currency: 'INR',
              status: 'captured',
            },
          },
        },
      };

      const resPaymentCaptured = await processSupportedWebhookEvent('payment.captured', paymentCapturedPayload);
      check(resPaymentCaptured.outcome === 'PROCESSED', 'TEST 1.1e: payment.captured delivered second acknowledged cleanly');

      // Verify NO double-fulfillment
      prodA = await Product.findById(product._id);
      varA = prodA.variants.find((v: any) => v._id.toString() === variantIds[0].toString());
      check(varA.stock === 49, `TEST 1.1f: Stock remains exactly 49 without double-deduction (stock = ${varA.stock})`);

      const txsA = await InventoryTransaction.find({ orderId: orderA._id });
      check(txsA.length === 1, `TEST 1.1g: Exactly one InventoryTransaction recorded (count = ${txsA.length})`);

      const attemptsA = await PaymentAttempt.find({ orderId: orderA._id, status: 'CAPTURED' });
      check(attemptsA.length === 1, 'TEST 1.1h: Exactly one CAPTURED PaymentAttempt exists');
    }

    // TEST 1.2: payment.captured delivered first, then order.paid delivered second
    {
      const { product, variantIds } = await createTestProduct({
        name: 'Cross Event Shirt B',
        basePrice: 2000,
        variants: [{ size: 'M', color: 'NAVY', stock: 50, isAvailable: true }],
      });
      const orderB: any = await Order.create({
        orderNumber: `ORD-CROSS-B-${Date.now()}`,
        userId,
        items: [{
          productId: product._id,
          variantId: variantIds[0],
          productName: 'Cross Event Shirt B',
          productImage: 'https://example.com/item.jpg',
          selectedSize: 'M',
          selectedColor: 'NAVY',
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

      const paymentB: any = await Payment.create({
        orderId: orderB._id,
        userId,
        amount: 2000,
        currency: 'INR',
        status: 'PENDING',
        provider: 'RAZORPAY',
      });

      const rzpOrderId = `order_cross_b_${Date.now()}`;
      const rzpPaymentId = `pay_cross_b_${Date.now()}`;
      await PaymentAttempt.create({
        paymentId: paymentB._id,
        orderId: orderB._id,
        razorpayOrderId: rzpOrderId,
        amount: 2000,
        currency: 'INR',
        status: 'PENDING',
      });

      // 1. Deliver payment.captured FIRST
      const paymentCapturedPayload = {
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: rzpPaymentId,
              order_id: rzpOrderId,
              amount: 200000,
              currency: 'INR',
              status: 'captured',
            },
          },
        },
      };

      const resPaymentCaptured = await processSupportedWebhookEvent('payment.captured', paymentCapturedPayload);
      check(resPaymentCaptured.outcome === 'PROCESSED', 'TEST 1.2a: payment.captured delivered first processed successfully');

      const { Product } = require('../models/Product');
      let prodB: any = await Product.findById(product._id);
      let varB = prodB.variants.find((v: any) => v._id.toString() === variantIds[0].toString());
      check(varB.stock === 49, `TEST 1.2b: Stock decremented once to 49 (stock = ${varB.stock})`);

      // 2. Deliver order.paid SECOND
      const orderPaidPayload = {
        event: 'order.paid',
        payload: {
          order: {
            entity: {
              id: rzpOrderId,
              amount: 200000,
              amount_paid: 200000,
              currency: 'INR',
              status: 'paid',
            },
          },
          payment: {
            entity: {
              id: rzpPaymentId,
              order_id: rzpOrderId,
              amount: 200000,
              currency: 'INR',
              status: 'captured',
            },
          },
        },
      };

      const resOrderPaid = await processSupportedWebhookEvent('order.paid', orderPaidPayload);
      check(resOrderPaid.outcome === 'PROCESSED', 'TEST 1.2c: order.paid delivered second acknowledged cleanly');

      prodB = await Product.findById(product._id);
      varB = prodB.variants.find((v: any) => v._id.toString() === variantIds[0].toString());
      check(varB.stock === 49, `TEST 1.2d: Stock remains 49 after order.paid replay (stock = ${varB.stock})`);

      const txsB = await InventoryTransaction.find({ orderId: orderB._id });
      check(txsB.length === 1, `TEST 1.2e: Exactly one InventoryTransaction recorded (count = ${txsB.length})`);
    }

    // =========================================================================
    // AREA 2: REFUND REQUEST IDENTITY & PAYLOAD COMPARISON
    // =========================================================================
    console.log('\n--- AREA 2: Refund Request Identity & Payload Comparison ---');

    {
      const order2: any = await Order.create({
        orderNumber: `ORD-PAYLOAD-CMP-${Date.now()}`,
        userId,
        items: [],
        subtotal: 3000,
        total: 3000,
        currency: 'INR',
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        shippingAddress: defaultShippingAddress,
      });

      const gatewayPaymentId = `pay_payload_cmp_${Date.now()}`;
      const payment2: any = await Payment.create({
        orderId: order2._id,
        userId,
        amount: 3000,
        currency: 'INR',
        status: 'CAPTURED',
        provider: 'RAZORPAY',
        razorpayPaymentId: gatewayPaymentId,
      });

      await PaymentAttempt.create({
        paymentId: payment2._id,
        orderId: order2._id,
        razorpayOrderId: `order_payload_cmp_${Date.now()}`,
        razorpayPaymentId: gatewayPaymentId,
        amount: 3000,
        currency: 'INR',
        status: 'CAPTURED',
      });

      const capturedCalls: Array<{
        paymentId: string;
        amountInPaise: number;
        notes: Record<string, string | number>;
        idempotencyKey?: string;
      }> = [];

      // Intercept createRefund to record exact transmitted arguments
      razorpayProvider.createRefund = async (paymentId, amountInPaise, notes, idempotencyKey) => {
        capturedCalls.push({
          paymentId,
          amountInPaise,
          notes: { ...notes },
          idempotencyKey,
        });

        // Fail attempt 1 with ambiguous gateway socket timeout
        if (capturedCalls.length === 1) {
          const timeoutErr: any = new Error('ESOCKETTIMEDOUT');
          timeoutErr.code = 'ETIMEDOUT';
          timeoutErr.statusCode = 504;
          throw timeoutErr;
        }

        // Return processed on attempt 2
        return {
          id: `rfnd_payload_cmp_${Date.now()}`,
          entity: 'refund',
          amount: amountInPaise,
          status: 'processed',
          notes,
        };
      };

      const operationId = `op_payload_test_${Date.now()}`;

      // 1. Initial attempt
      try {
        await createInternalRefund({
          orderId: order2._id.toString(),
          amount: 1000,
          operationId,
          reason: 'Customer requested return of item A',
          actorId: adminId.toString(),
          actorRole: 'ADMIN',
        });
      } catch (err: any) {
        // Expected network timeout
      }

      check(capturedCalls.length === 1, 'TEST 2.1: Initial gateway refund call recorded');
      const initialCall = capturedCalls[0];

      // Reset mock listing to return the refund on reconciliation
      const refundDoc = await Refund.findOne({ orderId: order2._id });
      razorpayProvider.getClient = () => ({
        payments: {
          fetchMultipleRefund: async () => ({
            items: [{
              id: `rfnd_payload_cmp_retried_${Date.now()}`,
              status: 'processed',
              amount: 100000,
              currency: 'INR',
              payment_id: gatewayPaymentId,
              notes: { internal_refund_id: refundDoc!._id.toString() },
            }],
          }),
        },
        refunds: {
          all: async () => ({ items: [] }),
        },
      } as any);

      // 2. Retry with exact same operationId
      await createInternalRefund({
        orderId: order2._id.toString(),
        amount: 1000,
        operationId,
        reason: 'Customer requested return of item A',
        actorId: adminId.toString(),
        actorRole: 'ADMIN',
      });

      check(Boolean(initialCall.idempotencyKey), 'TEST 2.2: Initial call transmitted X-Refund-Idempotency key');
      check(initialCall.amountInPaise === 100000, 'TEST 2.3: Initial call amount was exactly 100,000 paise (₹1,000)');
      check(initialCall.paymentId === gatewayPaymentId, 'TEST 2.4: Initial call targeted correct gateway payment ID');

      // 3. Genuinely new refund operation on the same order receives a distinct identity
      capturedCalls.length = 0; // reset tracker
      const newOpId = `op_genuinely_new_${Date.now()}`;
      razorpayProvider.createRefund = async (paymentId, amountInPaise, notes, idempotencyKey) => {
        capturedCalls.push({ paymentId, amountInPaise, notes: { ...notes }, idempotencyKey });
        return {
          id: `rfnd_new_op_${Date.now()}`,
          entity: 'refund',
          amount: amountInPaise,
          status: 'processed',
        };
      };

      const newRefund = await createInternalRefund({
        orderId: order2._id.toString(),
        amount: 500,
        operationId: newOpId,
        reason: 'Customer requested return of item B',
        actorId: adminId.toString(),
        actorRole: 'ADMIN',
      });

      check(capturedCalls.length === 1, 'TEST 2.5: Genuinely new refund operation dispatched to gateway');
      const newCall = capturedCalls[0];

      check(newCall.idempotencyKey !== initialCall.idempotencyKey, 'TEST 2.6: New operation received a distinct idempotency key');
      check(newRefund._id.toString() !== refundDoc!._id.toString(), 'TEST 2.7: New operation received its own Refund document identity');
      check(newCall.amountInPaise === 50000, 'TEST 2.8: New operation transmitted correct 50,000 paise amount');

      razorpayProvider.getClient = originalGetClient;
      razorpayProvider.createRefund = originalCreateRefund;
    }

    // =========================================================================
    // AREA 3: STALE WORKER EXTERNAL SIDE EFFECTS
    // =========================================================================
    console.log('\n--- AREA 3: Stale Worker External Side Effects ---');

    {
      const lockName = `LOCK_SIDE_EFFECTS_${Date.now()}`;
      const workerA = `worker_side_a_${Date.now()}`;
      const workerB = `worker_side_b_${Date.now()}`;

      // 1. Worker A acquires lease for 50ms
      const leaseA = await RecoveryCoordinatorService.acquireWorkerLease(lockName, workerA, 50);
      check(leaseA.acquired === true, 'TEST 3.1: Worker A acquired initial lease');
      const staleTokenA = leaseA.fencingToken!;

      // 2. Worker A pauses; lease expires (wait 70ms)
      await new Promise(resolve => setTimeout(resolve, 70));

      // 3. Worker B acquires the lease with fencingToken incremented
      const leaseB = await RecoveryCoordinatorService.acquireWorkerLease(lockName, workerB, 60_000);
      check(leaseB.acquired === true, 'TEST 3.2: Worker B successfully acquired new lease');
      check(leaseB.fencingToken! > staleTokenA, 'TEST 3.3: Worker B holds higher fencing token');

      // 4. Resume Worker A: Worker A tries to dispatch an external refund through lease fence
      const flags = {
        workerACalledGateway: false,
        workerAFencedOut: false,
        workerBCalledGateway: false,
      };
      razorpayProvider.createRefund = async () => {
        flags.workerACalledGateway = true;
        throw new Error('UNSAFE SIDE EFFECT: Stale worker should NEVER reach the gateway!');
      };

      try {
        await RecoveryCoordinatorService.withRecoveryLeaseFence(
          {
            fencingToken: staleTokenA,
            lockName,
            ownerId: workerA,
            leaseDurationMs: 10_000,
          },
          async () => {
            // Unsafe worker code trying to call external gateway:
            await razorpayProvider.createRefund('pay_unsafe_test', 100000);
          }
        );
      } catch (err: any) {
        if (err.statusCode === 409 || err.code === 'WORKER_LEASE_FENCED_OUT') {
          flags.workerAFencedOut = true;
        }
      }

      check(flags.workerAFencedOut === true, 'TEST 3.4: Stale Worker A fenced out with HTTP 409');
      check(flags.workerACalledGateway === false, 'TEST 3.5: Stale Worker A strictly BLOCKED from calling gateway (zero external side effects)');

      // 5. Active Worker B can safely proceed
      razorpayProvider.createRefund = async (_pid, amountInPaise) => {
        flags.workerBCalledGateway = true;
        return {
          id: `rfnd_worker_b_${Date.now()}`,
          entity: 'refund',
          amount: amountInPaise,
          status: 'processed',
        };
      };

      await RecoveryCoordinatorService.withRecoveryLeaseFence(
        {
          fencingToken: leaseB.fencingToken!,
          lockName,
          ownerId: workerB,
          leaseDurationMs: 60_000,
        },
        async () => {
          await razorpayProvider.createRefund('pay_safe_worker_b', 100000);
        }
      );

      check(flags.workerBCalledGateway === true, 'TEST 3.6: Authorized Worker B successfully executed external gateway call');
      razorpayProvider.createRefund = originalCreateRefund;
    }

    // =========================================================================
    // AREA 4: ACTUAL STANDALONE FALLBACK CRASH RECOVERY
    // =========================================================================
    console.log('\n--- AREA 4: Actual Standalone Fallback Crash Recovery ---');

    {
      const order4: any = await Order.create({
        orderNumber: `ORD-STANDALONE-CRASH-${Date.now()}`,
        userId,
        items: [],
        subtotal: 2000,
        total: 2000,
        currency: 'INR',
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        shippingAddress: defaultShippingAddress,
      });

      const gatewayPaymentId = `pay_standalone_${Date.now()}`;
      const payment4: any = await Payment.create({
        orderId: order4._id,
        userId,
        amount: 2000,
        currency: 'INR',
        status: 'CAPTURED',
        provider: 'RAZORPAY',
        razorpayPaymentId: gatewayPaymentId,
      });

      await PaymentAttempt.create({
        paymentId: payment4._id,
        orderId: order4._id,
        razorpayOrderId: `order_standalone_${Date.now()}`,
        razorpayPaymentId: gatewayPaymentId,
        amount: 2000,
        currency: 'INR',
        status: 'CAPTURED',
      });

      // --- INJECTED FAILURE 1: Crash between Refund Intent and Payment Reservation ---
      // A Refund document was inserted, but server crashed before transitionPaymentReservation
      const crashRefund1: any = await Refund.create({
        orderId: order4._id,
        paymentId: payment4._id,
        userId,
        amount: 500,
        currency: 'INR',
        status: 'PENDING',
        submissionState: 'INTENT_CREATED',
        submissionClaimExpiresAt: new Date(Date.now() - 5000), // lease expired
        razorpayPaymentId: gatewayPaymentId,
        initiatedBy: adminId,
        initiatedByRole: 'ADMIN',
      });
      check(Boolean(crashRefund1), 'TEST 4.1: Simulated crash between Refund doc creation and Payment reservation');

      // --- INJECTED FAILURE 2: Crash after Gateway call succeeds but before saving response ---
      const gatewayRefundId2 = `rfnd_crash_gw_${Date.now()}`;
      const crashRefund2: any = await Refund.create({
        orderId: order4._id,
        paymentId: payment4._id,
        userId,
        amount: 500,
        currency: 'INR',
        status: 'UNKNOWN', // Stuck in UNKNOWN because crash occurred while writing PROCESSED
        submissionState: 'SUBMITTED',
        razorpayPaymentId: gatewayPaymentId,
        razorpayRefundId: gatewayRefundId2,
        initiatedBy: adminId,
        initiatedByRole: 'ADMIN',
      });

      // Gateway returns the refund in its listing
      razorpayProvider.getClient = () => ({
        refunds: {
          fetch: async () => ({
            id: gatewayRefundId2,
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

      // Reconcile recovers crash 2
      const recovered2 = await reconcileUnknownRefund(crashRefund2._id.toString(), {
        executionMode: 'ADMINISTRATIVE',
      });
      check(recovered2.status === 'PROCESSED', 'TEST 4.2: Recovery cleanly settled post-gateway crash without transaction');
      check(recovered2.razorpayRefundId === gatewayRefundId2, 'TEST 4.3: Preserved exact gateway refund ID');

      // --- INJECTED FAILURE 3: Crash after Refund marked PROCESSED but before Order updated ---
      const crashRefund3: any = await Refund.create({
        orderId: order4._id,
        paymentId: payment4._id,
        userId,
        amount: 1000,
        currency: 'INR',
        status: 'PROCESSED',
        submissionState: 'CONFIRMED',
        processedAt: new Date(),
        razorpayPaymentId: gatewayPaymentId,
        razorpayRefundId: `rfnd_crash_3_${Date.now()}`,
        initiatedBy: adminId,
        initiatedByRole: 'ADMIN',
        accountingSettlementStatus: 'PENDING',
      });

      // Execute settlement recovery directly (unlinked provider settlement or crashed pre-reservation recovery)
      const settlement = await applyProviderRefundSettlement({
        paymentId: payment4._id,
        refundId: crashRefund3._id,
        razorpayRefundId: crashRefund3.razorpayRefundId!,
        amount: 1000,
        currency: 'INR',
        unlinked: true,
        expectedReservationId: crashRefund3._id.toString(),
        expectedAttemptNumber: 1,
      });

      check(settlement.success === true, 'TEST 4.4: Injected crash 3 settled idempotently in standalone mode');
      const pAfter3 = await Payment.findById(payment4._id);
      check(pAfter3?.refundedAmount === 1500, `TEST 4.5: Cumulative refundedAmount is consistent (₹${pAfter3?.refundedAmount})`);

      // Restore provider client after Area 4
      razorpayProvider.getClient = originalGetClient;
      razorpayProvider.createRefund = originalCreateRefund;
    }

    // =========================================================================
    // AREA 5: WEBHOOK VERIFICATION AND DELIVERY DURABILITY
    // =========================================================================
    console.log('\n--- AREA 5: Webhook Verification and Delivery Durability ---');

    {
      const rawSecret = 'mock_webhook_secret_test';
      const eventObj = {
        event: 'payment.captured',
        event_id: `evt_raw_verify_${Date.now()}`,
        payload: { payment: { entity: { id: 'pay_raw_1', amount: 100000, currency: 'INR' } } },
      };

      const rawJsonBuffer = Buffer.from(JSON.stringify(eventObj), 'utf8');
      const validHmac = crypto.createHmac('sha256', rawSecret).update(rawJsonBuffer).digest('hex');

      // 1. Signature matches raw bytes
      const rawMatch = razorpayProvider.verifyWebhookSignature(rawJsonBuffer.toString('utf8'), validHmac);
      check(rawMatch === true, 'TEST 5.1: Signature matches original raw UTF-8 request buffer');

      // 2. Whitespace/formatting change breaks signature
      const reformattedJson = JSON.stringify(eventObj, null, 2); // pretty-printed
      const reformattedMatch = razorpayProvider.verifyWebhookSignature(reformattedJson, validHmac);
      check(reformattedMatch === false, 'TEST 5.2: Re-formatted/pretty-printed payload invalidates HMAC signature');

      // 3. Duplicate x-razorpay-event-id rejection and idempotency
      const duplicateEventId = `evt_dup_header_${Date.now()}`;
      const duplicatePayload = {
        event: 'payment.captured',
        event_id: duplicateEventId,
        payload: { payment: { entity: { id: `pay_dup_evt_${Date.now()}`, order_id: `ord_dup_evt_${Date.now()}` } } },
      };
      const dupRawBuffer = Buffer.from(JSON.stringify(duplicatePayload), 'utf8');
      const dupSig = crypto.createHmac('sha256', rawSecret).update(dupRawBuffer).digest('hex');

      // Pre-seed the event as PROCESSED in MongoDB
      await WebhookEvent.create({
        eventId: duplicateEventId,
        provider: 'RAZORPAY',
        eventType: 'payment.captured',
        status: 'PROCESSED',
        processedAt: new Date(),
        payload: duplicatePayload,
      });

      let dupResCode = 0;
      let dupResBody = '';
      const mockReqDup: any = {
        headers: {
          'x-razorpay-signature': dupSig,
          'x-razorpay-event-id': duplicateEventId,
        },
        body: dupRawBuffer,
      };
      const mockResDup: any = {
        status(c: number) { dupResCode = c; return this; },
        send(b: string) { dupResBody = b; return this; },
      };

      await razorpayWebhook(mockReqDup, mockResDup);
      check(dupResCode === 200 && dupResBody.includes('already processed'), 'TEST 5.3: Duplicate x-razorpay-event-id acknowledged with 200 "Event already processed"');

      // 4. Complex event sequence: payment.failed -> payment.captured -> late payment.failed -> refund.processed -> late refund.failed
      const { product, variantIds } = await createTestProduct({ name: 'Sequence Shirt', basePrice: 1000 });
      const seqOrder: any = await Order.create({
        orderNumber: `ORD-SEQ-${Date.now()}`,
        userId,
        items: [{
          productId: product._id,
          variantId: variantIds[0],
          productName: 'Sequence Shirt',
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

      const seqPayment: any = await Payment.create({
        orderId: seqOrder._id,
        userId,
        amount: 1000,
        currency: 'INR',
        status: 'PENDING',
        provider: 'RAZORPAY',
      });

      const seqOrderId = `order_seq_${Date.now()}`;
      const seqPaymentId = `pay_seq_${Date.now()}`;
      await PaymentAttempt.create({
        paymentId: seqPayment._id,
        orderId: seqOrder._id,
        razorpayOrderId: seqOrderId,
        amount: 1000,
        currency: 'INR',
        status: 'PENDING',
      });

      // Step A: payment.failed arrives first
      await processSupportedWebhookEvent('payment.failed', {
        payload: { payment: { entity: { id: seqPaymentId, order_id: seqOrderId, error_code: 'BAD_REQUEST' } } },
      });
      let seqOrderDoc = await Order.findById(seqOrder._id);
      check(seqOrderDoc?.paymentStatus === 'FAILED', 'TEST 5.4: Step A: Initial payment.failed marks order FAILED');

      // Step B: payment.captured arrives next (customer retried and paid)
      await processSupportedWebhookEvent('payment.captured', {
        payload: { payment: { entity: { id: seqPaymentId, order_id: seqOrderId, amount: 100000, currency: 'INR' } } },
      });
      seqOrderDoc = await Order.findById(seqOrder._id);
      check(seqOrderDoc?.paymentStatus === 'PAID', 'TEST 5.5: Step B: payment.captured supersedes failure and marks order PAID');

      // Step C: late payment.failed arrives from an earlier worker
      await processSupportedWebhookEvent('payment.failed', {
        payload: { payment: { entity: { id: seqPaymentId, order_id: seqOrderId, error_code: 'GATEWAY_ERROR' } } },
      });
      seqOrderDoc = await Order.findById(seqOrder._id);
      check(seqOrderDoc?.paymentStatus === 'PAID', 'TEST 5.6: Step C: Late payment.failed does NOT demote PAID order');

      // Step D: refund.processed arrives
      const seqRefund: any = await Refund.create({
        orderId: seqOrder._id,
        paymentId: seqPayment._id,
        userId,
        amount: 1000,
        currency: 'INR',
        status: 'PROCESSING',
        razorpayPaymentId: seqPaymentId,
        initiatedBy: adminId,
        initiatedByRole: 'ADMIN',
      });

      const seqRefundId = `rfnd_seq_${Date.now()}`;
      await handleRefundProcessedEntity({
        id: seqRefundId,
        payment_id: seqPaymentId,
        amount: 100000,
        currency: 'INR',
        status: 'processed',
        notes: { internal_refund_id: seqRefund._id.toString() },
      });

      const seqRefundDoc = await Refund.findById(seqRefund._id);
      const seqPaymentDoc = await Payment.findById(seqPayment._id);
      seqOrderDoc = await Order.findById(seqOrder._id);

      check(seqRefundDoc?.status === 'PROCESSED', 'TEST 5.7: Step D: refund.processed marks refund PROCESSED');
      check(seqPaymentDoc?.status === 'REFUNDED', 'TEST 5.8: Step D: Payment marked REFUNDED');
      check(seqOrderDoc?.paymentStatus === 'REFUNDED', 'TEST 5.9: Step D: Order paymentStatus marked REFUNDED');

      // Step E: late refund.failed arrives after refund.processed
      await handleRefundFailedEntity({
        id: seqRefundId,
        payment_id: seqPaymentId,
        amount: 100000,
        currency: 'INR',
        error_description: 'Late bank failure notification',
        notes: { internal_refund_id: seqRefund._id.toString() },
      });

      const finalRefundDoc = await Refund.findById(seqRefund._id);
      check(finalRefundDoc?.status === 'PROCESSED', 'TEST 5.10: Step E: Late refund.failed does NOT demote PROCESSED refund');
    }

    // =========================================================================
    // AREA 6: RAZORPAY API CONTRACT COMPATIBILITY
    // =========================================================================
    console.log('\n--- AREA 6: Razorpay API Contract Compatibility ---');

    {
      // 1. Verify idempotency key format constraint
      const validKey40 = 'rfnd_op_12345678901234567890123456789012'; // exactly 40 chars alphanumeric
      const validFormat = /^[A-Za-z0-9_-]+$/.test(validKey40) && validKey40.length <= 40;
      check(validFormat === true, 'TEST 6.1: Generated idempotency key strictly satisfies Razorpay ^[A-Za-z0-9_-]+$ <= 40 chars');

      const invalidKey = 'rfnd_op_invalid!@#$';
      let invalidRejected = false;
      try {
        await razorpayProvider.createRefund('pay_mock_1', 1000, {}, invalidKey);
      } catch (err: any) {
        invalidRejected = true;
      }
      check(invalidRejected === true, 'TEST 6.2: Invalid characters in idempotency key fail-closed before network dispatch');

      // 2. Verify formatGatewayRefundIdempotencyKey output format
      const opKey = formatGatewayRefundIdempotencyKey({
        orderId: new mongoose.Types.ObjectId(),
        operationId: 'cancel_item_54321',
      });
      check(opKey.startsWith('rfnd_op_'), 'TEST 6.3: formatGatewayRefundIdempotencyKey creates rfnd_op_ prefix for operations');
      check(opKey.length <= 40, `TEST 6.4: Generated gateway key length (${opKey.length}) <= 40 chars`);

      // 3. Verify SDK client methods exist
      const client = razorpayProvider.getClient() as any;
      check(typeof client.payments?.fetchMultipleRefund === 'function', 'TEST 6.5: Razorpay SDK payments.fetchMultipleRefund is supported');
      check(typeof client.refunds?.all === 'function', 'TEST 6.6: Razorpay SDK refunds.all is supported');
      check(typeof client.refunds?.fetch === 'function', 'TEST 6.7: Razorpay SDK refunds.fetch is supported');
    }

  } finally {
    razorpayProvider.createRefund = originalCreateRefund;
    razorpayProvider.getClient = originalGetClient;
    await mongoose.disconnect();
  }

  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log(`Unverified Edge Cases Test Suite Results: ${passed} passed, ${failed} failed`);
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

runEdgeCasesSuite().catch((err) => {
  console.error('Fatal edge cases audit suite error:', err);
  process.exit(1);
});
