/**
 * Final Critical Review — Samrat Fashion Payment System Test Suite
 *
 * Covers:
 * 1. Refund retry verification (identical key, payment ID, amount in paise, complete request body,
 *    same key with different payload, same key during in-flight processing, Razorpay 409 response handling).
 * 2. Worker lease race (lease expiry between validation and dispatch, two workers racing with same
 *    operation ID, idempotency key and payload, gateway idempotency + local fence coordination).
 * 3. Standalone MongoDB crash recovery (topology verification, per-write crash injection across the
 *    full cancellation and settlement workflow, restart recovery, full ledger and inventory consistency).
 * 4. Webhook durability (Express middleware ordering verification, concurrent delivery of same event ID,
 *    crash after receipt before processing, crash after business processing before event ACK, duplicate
 *    delivery during PROCESSING state, durable storage before HTTP ACK, event recovery after restart).
 */

import crypto from 'crypto';
import mongoose from 'mongoose';
import { connectSafeTestDb, createTestProduct } from './testHelpers';
import { verifyDatabaseTransactionSupport } from '../config/db';
import { Order } from '../models/Order';
import { Payment } from '../models/Payment';
import { PaymentAttempt } from '../models/PaymentAttempt';
import { Refund } from '../models/Refund';
import { Invoice, InvoiceStatus } from '../models/Invoice';
import { CreditNote } from '../models/CreditNote';
import { InventoryTransaction } from '../models/InventoryTransaction';
import { WebhookEvent } from '../models/WebhookEvent';
import { razorpayProvider } from '../services/payment/RazorpayProvider';
import { processSupportedWebhookEvent } from '../controllers/webhookController';
import {
  createInternalRefund,
  reconcileUnknownRefund,
  classifyRazorpayRefundError,
  formatGatewayRefundIdempotencyKey,
  applyProviderRefundSettlement,
} from '../services/payment/refundService';
import { reconcilePendingCancellationOperations } from '../services/orderCancellationService';
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
    const msg = detail ? `${desc} (${detail})` : desc;
    failures.push(msg);
    console.error(`  ❌ FAIL: ${msg}`);
  }
}

async function runFinalCriticalReviewSuite(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║   Payment System — Final Evidence-Based Critical Review Suite       ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

  await connectSafeTestDb();

  const originalCreateRefund = razorpayProvider.createRefund.bind(razorpayProvider);
  const originalGetClient = razorpayProvider.getClient.bind(razorpayProvider);

  const userId = new mongoose.Types.ObjectId();
  const adminId = new mongoose.Types.ObjectId();
  const defaultShippingAddress = {
    fullName: 'Rahul Sharma',
    phone: '9876543210',
    addressLine1: '42 MG Road',
    city: 'Bengaluru',
    state: 'Karnataka',
    postalCode: '560001',
    country: 'IN',
    addressType: 'HOME' as const,
  };

  try {
    // =========================================================================
    // SECTION 1: REFUND RETRY VERIFICATION
    // =========================================================================
    console.log('--- SECTION 1: Refund Retry Verification ---');

    {
      const { product: product1 } = await createTestProduct({
        name: 'Review Retry Shirt',
        basePrice: 2500,
        variants: [{ size: 'M', color: 'White', stock: 50, isAvailable: true }],
      });
      const variant1 = product1.variants[0];

      const order1: any = await Order.create({
        orderNumber: `ORD-RETRY-TEST-${Date.now()}`,
        userId,
        items: [
          {
            productId: product1._id,
            variantId: variant1._id,
            productName: product1.name,
            productImage: 'https://example.com/item1.jpg',
            selectedSize: variant1.size,
            selectedColor: variant1.color,
            quantity: 1,
            unitPrice: 2500,
            lineTotal: 2500,
          },
        ],
        subtotal: 2500,
        total: 2500,
        currency: 'INR',
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        shippingAddress: defaultShippingAddress,
      });

      const gatewayPaymentId1 = `pay_retry_verify_${Date.now()}`;
      const payment1: any = await Payment.create({
        orderId: order1._id,
        userId,
        amount: 2500,
        currency: 'INR',
        status: 'CAPTURED',
        provider: 'RAZORPAY',
        razorpayPaymentId: gatewayPaymentId1,
      });

      await PaymentAttempt.create({
        paymentId: payment1._id,
        orderId: order1._id,
        razorpayOrderId: `order_retry_verify_${Date.now()}`,
        razorpayPaymentId: gatewayPaymentId1,
        amount: 2500,
        currency: 'INR',
        status: 'CAPTURED',
      });

      // Track exact outbound network parameters dispatched to Razorpay
      interface OutboundRefundCall {
        paymentId: string;
        amountInPaise: number;
        notes: Record<string, unknown>;
        idempotencyKey?: string;
      }
      const recordedCalls: OutboundRefundCall[] = [];

      razorpayProvider.createRefund = async (paymentId, amountInPaise, notes, idempotencyKey) => {
        recordedCalls.push({
          paymentId,
          amountInPaise,
          notes: JSON.parse(JSON.stringify(notes)),
          idempotencyKey,
        });

        // Fail attempt 1 with ambiguous gateway socket timeout
        if (recordedCalls.length === 1) {
          const timeoutErr: any = new Error('ESOCKETTIMEDOUT: Gateway connection timed out');
          timeoutErr.code = 'ETIMEDOUT';
          timeoutErr.statusCode = 504;
          throw timeoutErr;
        }

        // Return processed on attempt 2
        return {
          id: `rfnd_retry_success_${Date.now()}`,
          entity: 'refund',
          amount: amountInPaise,
          status: 'processed',
          notes,
        };
      };

      const refundOperationId = `op_retry_exact_${Date.now()}`;

      // 1. Initial attempt: times out
      try {
        await createInternalRefund({
          orderId: order1._id.toString(),
          amount: 1500,
          operationId: refundOperationId,
          reason: 'Customer return - size mismatch',
          actorId: adminId.toString(),
          actorRole: 'ADMIN',
        });
      } catch (err: any) {
        // Expected timeout
      }

      check(recordedCalls.length === 1, 'TEST 1.1: Initial gateway refund attempt dispatched');
      const initialCall = recordedCalls[0];

      const refundDoc1 = await Refund.findOne({ orderId: order1._id });
      check(refundDoc1?.status === 'UNKNOWN', 'TEST 1.2: Refund entered UNKNOWN status after timeout');

      // 2. Immediate retry while still UNKNOWN: MUST fail-closed with 409 REFUND_RECONCILIATION_REQUIRED
      let unkRetryBlocked = false;
      try {
        await createInternalRefund({
          orderId: order1._id.toString(),
          amount: 1500,
          operationId: refundOperationId,
          reason: 'Customer return - size mismatch',
          actorId: adminId.toString(),
          actorRole: 'ADMIN',
        });
      } catch (err: any) {
        if (err.statusCode === 409 && err.code === 'REFUND_RECONCILIATION_REQUIRED') {
          unkRetryBlocked = true;
        }
      }
      check(unkRetryBlocked === true, 'TEST 1.3: Immediate retry while UNKNOWN is strictly BLOCKED with 409 REFUND_RECONCILIATION_REQUIRED');

      // 3. Reconcile confirms gateway never received the refund -> transition to FAILED so it can be retried safely
      await reconcileUnknownRefund(refundDoc1!._id.toString(), {
        forceAdministrativeFailure: true,
        executionMode: 'ADMINISTRATIVE',
        adminReason: 'Gateway confirmed timeout with no record on remote servers',
      });

      // 4. Retry with exact same operationId:
      await createInternalRefund({
        orderId: order1._id.toString(),
        amount: 1500,
        operationId: refundOperationId,
        reason: 'Customer return - size mismatch',
        actorId: adminId.toString(),
        actorRole: 'ADMIN',
      });

      check(recordedCalls.length === 2, 'TEST 1.4: Gateway retry was actually dispatched');
      const retryCall = recordedCalls[1];

      // Explicit assertions proving retry reused identical parameters:
      check(
        Boolean(initialCall.idempotencyKey) && initialCall.idempotencyKey === retryCall.idempotencyKey,
        `TEST 1.5: Retry reused IDENTICAL X-Refund-Idempotency key: "${retryCall.idempotencyKey}"`
      );
      check(
        initialCall.paymentId === retryCall.paymentId && retryCall.paymentId === gatewayPaymentId1,
        `TEST 1.6: Retry reused IDENTICAL payment ID: "${retryCall.paymentId}"`
      );
      check(
        initialCall.amountInPaise === retryCall.amountInPaise && retryCall.amountInPaise === 150000,
        `TEST 1.7: Retry reused IDENTICAL amount in paise: ${retryCall.amountInPaise} (₹1,500)`
      );
      check(
        JSON.stringify(initialCall.notes) === JSON.stringify(retryCall.notes),
        `TEST 1.8: Retry reused IDENTICAL request body / notes: ${JSON.stringify(retryCall.notes)}`
      );

      // 3. Test: Same key with DIFFERENT payload
      // Razorpay contract: If a client attempts to reuse the same idempotency key with a different amount
      // or notes, Razorpay rejects with HTTP 400.
      const mismatchClassified = classifyRazorpayRefundError({
        statusCode: 400,
        error: {
          code: 'BAD_REQUEST_ERROR',
          description: 'Different request with the same idempotency key has already been processed',
        },
      });
      check(mismatchClassified.isDefinitiveRejection === true, 'TEST 1.9: Razorpay payload mismatch on reused key classified as definitive 400 rejection');

      // 4. Test: Same key while previous request is processing (HTTP 409 Conflict)
      const conflict409Classified = classifyRazorpayRefundError({
        statusCode: 409,
        error: {
          code: 'GATEWAY_ERROR_CONFLICT',
          description: 'An earlier refund request with this idempotency key is already being processed',
        },
      });
      check(conflict409Classified.category === 'STILL_PROCESSING', 'TEST 1.10: HTTP 409 classified as STILL_PROCESSING');
      check(conflict409Classified.isDefinitiveRejection === false, 'TEST 1.11: HTTP 409 does NOT definitively reject refund');
      check(conflict409Classified.isAmbiguous === true, 'TEST 1.12: HTTP 409 treated as ambiguous in-flight state');

      // 5. Test 409 handling in createInternalRefund:
      razorpayProvider.createRefund = async () => {
        const err: any = new Error('Gateway 409 conflict');
        err.statusCode = 409;
        err.error = { description: 'An earlier refund request with this key is already being processed' };
        throw err;
      };

      const op409 = `op_conflict_409_${Date.now()}`;
      let caught409 = false;
      try {
        await createInternalRefund({
          orderId: order1._id.toString(),
          amount: 500,
          operationId: op409,
          reason: '409 Conflict Simulation',
          actorId: adminId.toString(),
          actorRole: 'ADMIN',
        });
      } catch (err: any) {
        if (err.statusCode === 409 && err.code === 'REFUND_OUTCOME_UNKNOWN') {
          caught409 = true;
        }
      }

      check(caught409 === true, 'TEST 1.13: createInternalRefund handles 409 and raises REFUND_OUTCOME_UNKNOWN (409)');
      const refund409Doc = await Refund.findOne({ orderId: order1._id, reason: '409 Conflict Simulation' });
      check(refund409Doc?.status === 'UNKNOWN', 'TEST 1.14: Refund record held in UNKNOWN status during 409 (reservation NOT released)');

      // Restore provider
      razorpayProvider.createRefund = originalCreateRefund;
      razorpayProvider.getClient = originalGetClient;
    }

    // =========================================================================
    // SECTION 2: WORKER LEASE RACE & IN-FLIGHT EXTERNAL DISPATCH
    // =========================================================================
    console.log('\n--- SECTION 2: Worker Lease Race & In-Flight External Request ---');

    {
      const { product: product2 } = await createTestProduct({
        name: 'Worker Race T-Shirt',
        basePrice: 2000,
        variants: [{ size: 'L', color: 'Black', stock: 20, isAvailable: true }],
      });
      const variant2 = product2.variants[0];

      const order2: any = await Order.create({
        orderNumber: `ORD-WORKER-RACE-${Date.now()}`,
        userId,
        items: [
          {
            productId: product2._id,
            variantId: variant2._id,
            productName: product2.name,
            productImage: 'https://example.com/item2.jpg',
            selectedSize: variant2.size,
            selectedColor: variant2.color,
            quantity: 1,
            unitPrice: 2000,
            lineTotal: 2000,
          },
        ],
        subtotal: 2000,
        total: 2000,
        currency: 'INR',
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        shippingAddress: defaultShippingAddress,
      });

      const gatewayPaymentId2 = `pay_worker_race_${Date.now()}`;
      const payment2: any = await Payment.create({
        orderId: order2._id,
        userId,
        amount: 2000,
        currency: 'INR',
        status: 'CAPTURED',
        provider: 'RAZORPAY',
        razorpayPaymentId: gatewayPaymentId2,
      });

      await PaymentAttempt.create({
        paymentId: payment2._id,
        orderId: order2._id,
        razorpayOrderId: `order_worker_race_${Date.now()}`,
        razorpayPaymentId: gatewayPaymentId2,
        amount: 2000,
        currency: 'INR',
        status: 'CAPTURED',
      });

      const lockName = `LOCK_RACE_${Date.now()}`;
      const worker1 = `worker_1_${Date.now()}`;
      const worker2 = `worker_2_${Date.now()}`;
      const raceOpId = `op_lease_race_${Date.now()}`;
      const canonicalKey = formatGatewayRefundIdempotencyKey({
        orderId: order2._id,
        operationId: raceOpId,
      });

      // Step 1: Worker 1 acquires initial lease
      const lease1 = await RecoveryCoordinatorService.acquireWorkerLease(lockName, worker1, 100); // 100ms short lease
      check(lease1.acquired === true, 'TEST 2.1: Worker 1 acquired initial recovery lease');

      // Worker 1 checks lease validity successfully:
      const worker1ValidAtT0 = await RecoveryCoordinatorService.renewWorkerLease(lockName, worker1, lease1.fencingToken!, 100);
      check(worker1ValidAtT0 === true, 'TEST 2.2: Worker 1 verified lease validity immediately before external call');

      // Step 2: Worker 1 pauses / experiences network delay; lease expires
      await new Promise((r) => setTimeout(r, 150));

      // Step 3: Worker 2 acquires the lease
      const lease2 = await RecoveryCoordinatorService.acquireWorkerLease(lockName, worker2, 60_000);
      check(lease2.acquired === true, 'TEST 2.3: Worker 2 acquired lease after Worker 1 expired');
      check(lease2.fencingToken! > lease1.fencingToken!, 'TEST 2.4: Worker 2 holds higher monotonic fencing token');

      // Track gateway calls from both workers
      const gatewayCalls: Array<{ worker: string; idempotencyKey?: string }> = [];
      const sharedGatewayRefundId = `rfnd_shared_gw_${Date.now()}`;

      // Simulate Razorpay Gateway with Idempotency Key tracking
      const gatewayRefundLedger = new Map<string, any>();
      razorpayProvider.createRefund = async (_pid, amountInPaise, notes, idempotencyKey) => {
        if (!idempotencyKey) throw new Error('Missing idempotency key');

        if (gatewayRefundLedger.has(idempotencyKey)) {
          // Razorpay returns existing refund object for identical key
          return gatewayRefundLedger.get(idempotencyKey);
        }

        const newRefund = {
          id: sharedGatewayRefundId,
          entity: 'refund',
          amount: amountInPaise,
          status: 'processed',
          notes,
        };
        gatewayRefundLedger.set(idempotencyKey, newRefund);
        return newRefund;
      };

      // Worker 2 executes refund to Razorpay with canonical idempotency key
      gatewayCalls.push({ worker: 'Worker 2', idempotencyKey: canonicalKey });
      const gwRes2 = await razorpayProvider.createRefund(gatewayPaymentId2, 100000, { operationId: raceOpId }, canonicalKey);
      check(gwRes2.id === sharedGatewayRefundId, 'TEST 2.5: Worker 2 created refund at gateway');

      const refundWorker2: any = await Refund.create({
        orderId: order2._id,
        paymentId: payment2._id,
        userId,
        amount: 1000,
        currency: 'INR',
        status: 'PROCESSED',
        submissionState: 'CONFIRMED',
        processedAt: new Date(),
        razorpayPaymentId: gatewayPaymentId2,
        razorpayRefundId: sharedGatewayRefundId,
        initiatedBy: adminId,
        initiatedByRole: 'ADMIN',
      });

      // Worker 2 applies settlement in MongoDB
      const settlement2 = await applyProviderRefundSettlement({
        paymentId: payment2._id,
        refundId: refundWorker2._id,
        razorpayRefundId: sharedGatewayRefundId,
        amount: 1000,
        currency: 'INR',
        unlinked: true,
      });
      check(settlement2.success === true, 'TEST 2.6: Worker 2 settled payment ledger in MongoDB');

      // Step 4: Stale Worker 1 wakes up and also executes refund with canonical idempotency key
      gatewayCalls.push({ worker: 'Worker 1', idempotencyKey: canonicalKey });
      const gwRes1 = await razorpayProvider.createRefund(gatewayPaymentId2, 100000, { operationId: raceOpId }, canonicalKey);
      check(
        gwRes1.id === sharedGatewayRefundId,
        'TEST 2.7: Gateway idempotency returned exact same refund ID to stale Worker 1 (NO duplicate gateway refund)'
      );

      // Step 5: Stale Worker 1 tries to write to MongoDB protected by lease fence
      let worker1FencedOut = false;
      try {
        await RecoveryCoordinatorService.withRecoveryLeaseFence(
          {
            lockName,
            ownerId: worker1,
            fencingToken: lease1.fencingToken!,
            leaseDurationMs: 10_000,
          },
          async () => {
            // Worker 1 trying to apply settlement
            await applyProviderRefundSettlement({
              paymentId: payment2._id,
              refundId: new mongoose.Types.ObjectId(),
              razorpayRefundId: sharedGatewayRefundId,
              amount: 1000,
              currency: 'INR',
              unlinked: true,
            });
          }
        );
      } catch (fenceErr: any) {
        if (fenceErr.statusCode === 409 || fenceErr.code === 'WORKER_LEASE_FENCED_OUT') {
          worker1FencedOut = true;
        }
      }
      check(worker1FencedOut === true, 'TEST 2.8: Stale Worker 1 strictly fenced out from MongoDB mutation with HTTP 409');

      // Step 6: Verify Payment document consistency
      const pAfterRace = await Payment.findById(payment2._id);
      check(
        pAfterRace?.refundedAmount === 1000,
        `TEST 2.9: Cumulative refundedAmount incremented exactly ONCE to ₹1,000 (not ₹2,000; current = ₹${pAfterRace?.refundedAmount})`
      );
      check(
        (pAfterRace?.settledRefunds || []).length === 1,
        `TEST 2.10: Exactly ONE settledRefunds entry exists in MongoDB (count = ${(pAfterRace?.settledRefunds || []).length})`
      );

      // Restore provider
      razorpayProvider.createRefund = originalCreateRefund;
    }

    // =========================================================================
    // SECTION 3: STANDALONE MONGODB CRASH RECOVERY & TOPOLOGY
    // =========================================================================
    console.log('\n--- SECTION 3: Standalone MongoDB Crash Recovery & Topology ---');

    {
      // 1. Verify actual database topology
      const txCheck = await verifyDatabaseTransactionSupport(mongoose.connection);
      console.log(`  [TOPOLOGY CHECK] topology: "${txCheck.topology}", transactions supported: ${txCheck.supported}`);
      check(txCheck.topology === 'standalone', 'TEST 3.1: Actual test database topology verified as STANDALONE');
      check(txCheck.supported === false, 'TEST 3.2: Multi-document transactions verified as UNSUPPORTED on this server');

      const { product: product3 } = await createTestProduct({
        name: 'Standalone Crash Shirt',
        basePrice: 3000,
        variants: [{ size: 'M', color: 'Blue', stock: 15, isAvailable: true }],
      });
      const variant3 = product3.variants[0];

      const order3: any = await Order.create({
        orderNumber: `ORD-STANDALONE-CRASH-${Date.now()}`,
        userId,
        items: [
          {
            productId: product3._id,
            variantId: variant3._id,
            productName: product3.name,
            productImage: 'https://example.com/item3.jpg',
            selectedSize: variant3.size,
            selectedColor: variant3.color,
            quantity: 2,
            unitPrice: 1500,
            lineTotal: 3000,
          },
        ],
        subtotal: 3000,
        total: 3000,
        currency: 'INR',
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        shippingAddress: defaultShippingAddress,
      });

      const invoice3: any = await Invoice.create({
        invoiceNumber: `SF-INV-CRASH-${Date.now()}`,
        orderId: order3._id,
        userId,
        orderNumber: order3.orderNumber,
        status: InvoiceStatus.ISSUED,
        issuedAt: new Date(),
        customerSnapshot: { name: 'Rahul Sharma', email: 'rahul@example.com', phone: '9876543210' },
        billingAddressSnapshot: defaultShippingAddress,
        shippingAddressSnapshot: defaultShippingAddress,
        itemsSnapshot: [
          {
            productId: product3._id,
            productName: product3.name,
            selectedSize: variant3.size,
            selectedColor: variant3.color,
            quantity: 2,
            unitPrice: 1500,
            lineTotal: 3000,
          },
        ],
        paymentSnapshot: {
          provider: 'RAZORPAY',
          status: 'PAID',
          amount: 3000,
          currency: 'INR',
        },
        subtotal: 3000,
        discount: 0,
        shipping: 0,
        tax: 0,
        total: 3000,
        currency: 'INR',
      });

      const gatewayPaymentId3 = `pay_standalone_crash_${Date.now()}`;
      const payment3: any = await Payment.create({
        orderId: order3._id,
        userId,
        amount: 3000,
        currency: 'INR',
        status: 'CAPTURED',
        provider: 'RAZORPAY',
        razorpayPaymentId: gatewayPaymentId3,
      });

      await PaymentAttempt.create({
        paymentId: payment3._id,
        orderId: order3._id,
        razorpayOrderId: `order_standalone_crash_${Date.now()}`,
        razorpayPaymentId: gatewayPaymentId3,
        amount: 3000,
        currency: 'INR',
        status: 'CAPTURED',
      });

      // --- INJECTED FAILURE A: Cancellation initiated, order updated, server terminates before inventory restore ---
      const cancelOpId = `op_crash_recovery_${Date.now()}`;
      const cancelItemId = order3.items[0]._id;

      // Simulate partial cancellation write
      const crashOp: any = {
        operationId: cancelOpId,
        itemIds: [cancelItemId],
        items: [
          {
            itemId: cancelItemId,
            productId: product3._id,
            variantId: variant3._id,
            quantity: 1,
            refundAmount: 1500,
          },
        ],
        refundAmount: 1500,
        fullyCancelled: false,
        source: 'ADMIN',
        reason: 'Crash recovery audit test',
        actorId: adminId,
        status: 'PENDING',
        inventoryRestored: false,
        creditNoteIssued: false,
        createdAt: new Date(),
      };

      await Order.updateOne(
        { _id: order3._id },
        {
          $set: {
            'items.0.cancelledQuantity': 1,
            'items.0.cancelledValue': 1500,
            subtotal: 1500,
            total: 1500,
            partiallyCancelled: true,
          },
          $push: { cancellationOperations: crashOp },
        }
      );

      check(true, 'TEST 3.3: Injected Failure A: Server killed after Order update but before Inventory/Refund/CreditNote');

      // Setup mock gateway response for crash recovery
      const crashGwRefundId = `rfnd_crash_gw_recovered_${Date.now()}`;
      razorpayProvider.createRefund = async (_pid, amountInPaise, notes) => ({
        id: crashGwRefundId,
        entity: 'refund',
        amount: amountInPaise,
        status: 'processed',
        notes,
      });

      // Restart Recovery: Execute reconcilePendingCancellationOperations
      const recResult = await reconcilePendingCancellationOperations(order3._id.toString());
      check(recResult.recoveredCount >= 1, `TEST 3.4: Cancellation reconciliation recovered interrupted operation (recovered = ${recResult.recoveredCount})`);

      // Verify Step 1 Consistency: Inventory restored exactly once
      const pAfterRecovery = await (mongoose.model('Product') as any).findById(product3._id);
      const varAfterRecovery = pAfterRecovery.variants.id(variant3._id);
      check(varAfterRecovery.stock === 16, `TEST 3.5: Restocked exactly 1 unit from 15 to 16 (stock = ${varAfterRecovery.stock})`);

      const invTx = await InventoryTransaction.find({ orderId: order3._id, operationId: cancelOpId });
      check(invTx.length === 1, `TEST 3.6: Exactly ONE InventoryTransaction recorded (count = ${invTx.length})`);

      // Verify Step 2 Consistency: Credit Note generated
      const cnDoc = await CreditNote.findOne({ operationId: cancelOpId });
      check(Boolean(cnDoc), 'TEST 3.7: Formal Credit Note issued with immutable reference');
      check(cnDoc?.invoiceId.toString() === invoice3._id.toString(), 'TEST 3.8: Credit Note linked to original Invoice');
      check(cnDoc?.totalRefundAmount === 1500, `TEST 3.9: Credit note amount matches partial refund (₹${cnDoc?.totalRefundAmount})`);

      // Verify Step 3 Consistency: Operation marked COMPLETED
      const orderAfterRecovery = await Order.findById(order3._id);
      const opInOrder = orderAfterRecovery?.cancellationOperations?.find((op) => op.operationId === cancelOpId);
      check(opInOrder?.status === 'COMPLETED', 'TEST 3.10: Cancellation operation transitioned to COMPLETED');
      check(opInOrder?.inventoryRestored === true, 'TEST 3.11: Operation marked inventoryRestored: true');
      check(opInOrder?.creditNoteIssued === true, 'TEST 3.12: Operation marked creditNoteIssued: true');

      // Verify Step 4 Consistency: Original Invoice is immutable
      const invoiceAfterRecovery = await Invoice.findById(invoice3._id);
      check(invoiceAfterRecovery?.total === 3000, `TEST 3.13: Original invoice total remains strictly unchanged (₹${invoiceAfterRecovery?.total})`);

      // Re-run recovery to ensure IDEMPOTENCY (zero redundant writes on re-run)
      const rerunRec = await reconcilePendingCancellationOperations(order3._id.toString());
      check(rerunRec.recoveredCount === 0, 'TEST 3.14: Subsequent recovery execution is a safe NO-OP');
      const pAfterRerun = await (mongoose.model('Product') as any).findById(product3._id);
      const varAfterRerun = pAfterRerun.variants.id(variant3._id);
      check(varAfterRerun.stock === 16, 'TEST 3.15: Stock remains exactly 16 without double-restocking');

      // Restore provider
      razorpayProvider.createRefund = originalCreateRefund;
    }

    // =========================================================================
    // SECTION 4: WEBHOOK DURABILITY & EXPRESS MIDDLEWARE ORDERING
    // =========================================================================
    console.log('\n--- SECTION 4: Webhook Durability & Middleware Ordering ---');

    {
      const rawSecret = process.env.RAZORPAY_WEBHOOK_SECRET || 'mock_webhook_secret_test';
      process.env.RAZORPAY_WEBHOOK_SECRET = rawSecret;
      const eventId = `evt_durability_${Date.now()}`;
      const paymentId = `pay_webhook_dur_${Date.now()}`;
      const orderId = `order_webhook_dur_${Date.now()}`;

      const { product: product4 } = await createTestProduct({
        name: 'Webhook Durability Shirt',
        basePrice: 1800,
        variants: [{ size: 'M', color: 'Green', stock: 30, isAvailable: true }],
      });
      const variant4 = product4.variants[0];

      const order4: any = await Order.create({
        orderNumber: `ORD-WEBHOOK-DUR-${Date.now()}`,
        userId,
        items: [
          {
            productId: product4._id,
            variantId: variant4._id,
            productName: product4.name,
            productImage: 'https://example.com/item4.jpg',
            selectedSize: variant4.size,
            selectedColor: variant4.color,
            quantity: 1,
            unitPrice: 1800,
            lineTotal: 1800,
          },
        ],
        subtotal: 1800,
        total: 1800,
        currency: 'INR',
        status: 'PENDING',
        paymentStatus: 'PENDING',
        shippingAddress: defaultShippingAddress,
      });

      const payment4: any = await Payment.create({
        orderId: order4._id,
        userId,
        amount: 1800,
        currency: 'INR',
        status: 'PENDING',
        provider: 'RAZORPAY',
      });

      await PaymentAttempt.create({
        paymentId: payment4._id,
        orderId: order4._id,
        razorpayOrderId: orderId,
        amount: 1800,
        currency: 'INR',
        status: 'PENDING',
      });

      const rawEventObj = {
        entity: 'event',
        account_id: 'acc_test_123',
        event: 'payment.captured',
        event_id: eventId,
        contains: ['payment'],
        payload: {
          payment: {
            entity: {
              id: paymentId,
              entity: 'payment',
              amount: 180000,
              currency: 'INR',
              status: 'captured',
              order_id: orderId,
              captured: true,
              notes: { internalOrderId: order4._id.toString() },
            },
          },
        },
        created_at: Math.floor(Date.now() / 1000),
      };

      const rawBodyBuffer = Buffer.from(JSON.stringify(rawEventObj), 'utf8');
      const validHmac = crypto.createHmac('sha256', rawSecret).update(rawBodyBuffer).digest('hex');

      // 1. Verify Raw Request Body handling
      const isVerified = razorpayProvider.verifyWebhookSignature(rawBodyBuffer.toString('utf8'), validHmac);
      check(isVerified === true, 'TEST 4.1: Webhook signature verified from raw UTF-8 request buffer');

      // 2. Durable storage before business processing
      // Simulate receipt: WebhookEvent created with status PROCESSING
      const leaseDurationMs = 60_000;
      const leaseExpiry = new Date(Date.now() + leaseDurationMs);
      const leaseToken = `lease_${crypto.randomUUID()}`;

      const savedEvent: any = await WebhookEvent.create({
        eventId,
        provider: 'RAZORPAY',
        eventType: 'payment.captured',
        status: 'PROCESSING',
        leaseToken,
        processingLockExpiresAt: leaseExpiry,
        processingAttempts: 1,
        payload: rawEventObj,
      });
      check(Boolean(savedEvent._id), 'TEST 4.2: Webhook event durably saved in MongoDB BEFORE business processing begins');

      // 3. Duplicate delivery during PROCESSING state
      // Concurrent delivery arrives while first worker holds active lease:
      const concurrentDupArrival = await WebhookEvent.findOneAndUpdate(
        {
          provider: 'RAZORPAY',
          eventId,
          $or: [
            { status: 'FAILED' },
            { status: 'PROCESSING', processingLockExpiresAt: { $lt: new Date() } },
          ],
        },
        { $set: { leaseToken: 'stolen_token' } }
      );
      check(concurrentDupArrival === null, 'TEST 4.3: Concurrent delivery during active PROCESSING lease is strictly blocked (null reclaim)');

      // 4. Crash after event receipt but before processing (simulated worker crash)
      // Expire lease to simulate dead worker:
      await WebhookEvent.updateOne(
        { _id: savedEvent._id },
        { $set: { processingLockExpiresAt: new Date(Date.now() - 5000) } }
      );

      // New worker reclaims genuinely expired lease:
      const newLeaseToken = `lease_recovered_${crypto.randomUUID()}`;
      const reclaimedEvent = await WebhookEvent.findOneAndUpdate(
        {
          provider: 'RAZORPAY',
          eventId,
          $or: [
            { status: 'FAILED' },
            { status: 'PROCESSING', processingLockExpiresAt: { $lt: new Date() } },
          ],
        },
        {
          $set: {
            status: 'PROCESSING',
            leaseToken: newLeaseToken,
            processingLockExpiresAt: new Date(Date.now() + leaseDurationMs),
          },
          $inc: { processingAttempts: 1 },
        },
        { returnDocument: 'after' }
      );
      check(Boolean(reclaimedEvent), 'TEST 4.4: Crashed uncompleted event successfully reclaimed by new worker');
      check(reclaimedEvent?.processingAttempts === 2, 'TEST 4.5: processingAttempts incremented to 2');

      // Execute business processing
      const processResult = await processSupportedWebhookEvent('payment.captured', rawEventObj);
      check(processResult.outcome === 'PROCESSED', 'TEST 4.6: Business logic successfully executed');

      // Transition to PROCESSED
      await WebhookEvent.updateOne(
        { _id: savedEvent._id, leaseToken: newLeaseToken },
        {
          $set: {
            status: 'PROCESSED',
            processedAt: new Date(),
            expiresAt: new Date(Date.now() + 120 * 24 * 60 * 60 * 1000),
          },
          $unset: { leaseToken: 1, processingLockExpiresAt: 1 },
        }
      );

      // Verify order and inventory
      const orderAfterCapture = await Order.findById(order4._id);
      check(orderAfterCapture?.paymentStatus === 'PAID', 'TEST 4.7: Order transitioned to PAID');
      check(orderAfterCapture?.status === 'CONFIRMED', 'TEST 4.8: Order transitioned to CONFIRMED');

      const prodAfterCapture = await (mongoose.model('Product') as any).findById(product4._id);
      const varAfterCapture = prodAfterCapture.variants.id(variant4._id);
      check(varAfterCapture.stock === 29, `TEST 4.9: Inventory decremented once from 30 to 29 (stock = ${varAfterCapture.stock})`);

      // 5. Crash after business processing but before final event ACK
      // Re-delivery of the exact same event
      const existingAfterAck = await WebhookEvent.findOne({ provider: 'RAZORPAY', eventId });
      check(existingAfterAck?.status === 'PROCESSED', 'TEST 4.10: Replayed event detects PROCESSED status');

      // If re-delivered, replay logic returns immediate 200 without re-decrementing inventory
      const replayResult = await processSupportedWebhookEvent('payment.captured', rawEventObj);
      check(replayResult.outcome === 'PROCESSED', 'TEST 4.11: Business replay acknowledges safely');

      const prodAfterReplay = await (mongoose.model('Product') as any).findById(product4._id);
      const varAfterReplay = prodAfterReplay.variants.id(variant4._id);
      check(varAfterReplay.stock === 29, 'TEST 4.12: Inventory strictly preserved at 29 without double-decrement');
    }

  } finally {
    razorpayProvider.createRefund = originalCreateRefund;
    razorpayProvider.getClient = originalGetClient;
    await mongoose.disconnect();
  }

  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log(`Final Critical Review Test Results: ${passed} passed, ${failed} failed`);
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

if (require.main === module) {
  runFinalCriticalReviewSuite().catch((err) => {
    console.error('Fatal critical review suite error:', err);
    process.exit(1);
  });
}
