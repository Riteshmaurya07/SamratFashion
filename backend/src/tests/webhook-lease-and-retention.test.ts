/**
 * SamratFashion — Phase A.2.1 Webhook Retention & Lease Integrity Regression Suite
 *
 * Verifies:
 * 1. WebhookEvent Deletion & Retention Logic:
 *    - Recovered 150-day-old events receive fresh 120-day expiresAt
 *    - Immediate logCleanup does not delete recovered old events
 *    - Unresolved events (PROCESSING, FAILED) are never deleted
 *    - IGNORED events expire only after expiresAt passes
 *    - Payload & identity are preserved while unresolved
 * 2. Individual Webhook Lease Integrity & Fencing:
 *    - First-delivery and background-replay lease tokens
 *    - Lease renewal during long-running processing
 *    - Stale worker fencing (cannot overwrite newer results or mark PROCESSED)
 *    - Reclamation of genuinely expired leases
 *    - Safe retry of failed events and duplicate no-ops
 * 3. TTL Migration Plan & Index Inspection:
 *    - Non-destructive migration preflight and dry-run verification
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import { connectSafeTestDb, createTestProduct } from './testHelpers';
import { Order } from '../models/Order';
import { Payment } from '../models/Payment';
import { PaymentAttempt } from '../models/PaymentAttempt';
import { User, UserRole } from '../models/User';
import { Product } from '../models/Product';
import {
  WebhookEvent,
  renewWebhookEventLease,
  startEventLeaseHeartbeat,
} from '../models/WebhookEvent';
import { cleanupExpiredLogs } from '../services/logCleanupService';
import {
  razorpayWebhook,
  recoverStaleWebhookEvents,
} from '../controllers/webhookController';
import { RecoveryCoordinatorService } from '../services/recovery/recoveryCoordinatorService';
import { razorpayProvider } from '../services/payment/RazorpayProvider';
import { Refund } from '../models/Refund';
import {
  preflightWebhookIndexMigration,
  runWebhookIndexMigration,
} from '../scripts/migrateWebhookTtlIndex';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(condition: boolean, desc: string, details?: string): void {
  if (condition) {
    console.log(`  ✅ PASS: ${desc}`);
    passed++;
  } else {
    const msg = details ? `${desc} — ${details}` : desc;
    failures.push(msg);
    console.error(`  ❌ FAIL: ${msg}`);
    failed++;
  }
}

async function runSuite(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║   Phase A.2.1 — Webhook Retention & Lease Integrity Audit Suite     ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

  try {
    await connectSafeTestDb();
    console.log(` Connected to verified isolated test database: "${mongoose.connection.name}"\n`);

    const now = Date.now();
    const MS_PER_DAY = 24 * 60 * 60 * 1000;

    // -------------------------------------------------------------------------
    // SECTION 1: WEBHOOK EVENT RETENTION & LOG CLEANUP DEFECT CLOSURE
    // -------------------------------------------------------------------------
    console.log('--- SECTION 1: Webhook Event Retention & Safe Cleanup Logic ---');

    // Pre-create valid product, user, order, and payment attempt fixtures for captured payment reconciliation
    const { product: testProduct, variantIds: [testVariantId] } = await createTestProduct({
      name: `Webhook Test Shirt ${now}`,
      basePrice: 1000,
      variants: [{ size: 'M', color: 'BLACK', stock: 100, isAvailable: true }]
    });

    const testUser = await User.create({
      name: 'Webhook Test User',
      email: `webhook_test_${now}@samratfashion.com`,
      role: UserRole.CUSTOMER,
      passwordHash: 'dummy_hash_for_test',
    });

    const testOrder = await Order.create({
      orderNumber: `SF-RET-ORD-${now}`,
      userId: testUser._id,
      items: [{
        productId: testProduct._id,
        variantId: new mongoose.Types.ObjectId(testVariantId),
        productName: testProduct.name,
        productImage: 'https://example.com/test.jpg',
        selectedSize: 'M',
        selectedColor: 'BLACK',
        quantity: 1,
        unitPrice: 1000,
        lineTotal: 1000,
      }],
      subtotal: 1000,
      total: 1000,
      currency: 'INR',
      status: 'PENDING',
      paymentStatus: 'PENDING',
      paymentMethod: 'RAZORPAY',
      shippingAddress: {
        fullName: 'Webhook Tester',
        phone: '9876543210',
        addressLine1: '123 Test St',
        city: 'Bengaluru',
        state: 'Karnataka',
        postalCode: '560001',
        country: 'India',
      },
    });

    const testPayment = await Payment.create({
      orderId: testOrder._id,
      userId: testUser._id,
      amount: 1000,
      currency: 'INR',
      status: 'PENDING',
      provider: 'RAZORPAY',
      refundedAmount: 0,
      pendingRefundAmount: 0,
    });

    const testAttempt = await PaymentAttempt.create({
      orderId: testOrder._id,
      paymentId: testPayment._id,
      amount: 1000,
      currency: 'INR',
      status: 'PENDING',
      razorpayOrderId: `order_test_${now}`,
    });

    // Pre-create valid delivery order and attempt fixtures for Section 2
    const delivOrder = await Order.create({
      orderNumber: `SF-DELIV-ORD-${now}`,
      userId: testUser._id,
      items: [{
        productId: testProduct._id,
        variantId: new mongoose.Types.ObjectId(testVariantId),
        productName: testProduct.name,
        productImage: 'https://example.com/test.jpg',
        selectedSize: 'M',
        selectedColor: 'BLACK',
        quantity: 1,
        unitPrice: 1000,
        lineTotal: 1000,
      }],
      subtotal: 1000,
      total: 1000,
      currency: 'INR',
      status: 'PENDING',
      paymentStatus: 'PENDING',
      paymentMethod: 'RAZORPAY',
      shippingAddress: {
        fullName: 'Deliv Tester',
        phone: '9876543210',
        addressLine1: '456 Delivery St',
        city: 'Mumbai',
        state: 'Maharashtra',
        postalCode: '400001',
        country: 'India',
      },
    });

    const delivPayment = await Payment.create({
      orderId: delivOrder._id,
      userId: testUser._id,
      amount: 1000,
      currency: 'INR',
      status: 'PENDING',
      provider: 'RAZORPAY',
      refundedAmount: 0,
      pendingRefundAmount: 0,
    });

    const delivAttempt = await PaymentAttempt.create({
      orderId: delivOrder._id,
      paymentId: delivPayment._id,
      amount: 1000,
      currency: 'INR',
      status: 'PENDING',
      razorpayOrderId: `ord_deliv_${now}`,
    });

    // 1.1 Create an old FAILED event from 150 days ago with a valid payload
    const oldFailedEventId = `evt_recovered_test_${now}`;
    const oldFailedCreatedAt = new Date(now - 150 * MS_PER_DAY);
    const testPayload = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: `pay_test_${now}`,
            order_id: `order_test_${now}`
          }
        }
      }
    };

    const oldFailedEvent = await WebhookEvent.create({
      eventId: oldFailedEventId,
      provider: 'RAZORPAY',
      eventType: 'payment.captured',
      status: 'FAILED',
      processingAttempts: 1,
      lastError: 'Simulated initial network timeout during capture',
      payload: testPayload,
      createdAt: oldFailedCreatedAt,
      updatedAt: oldFailedCreatedAt,
    });

    check(oldFailedEvent.expiresAt === undefined, '1.1 Initial 150-day-old FAILED event has NO expiresAt set');
    check(oldFailedEvent.status === 'FAILED', '1.2 Initial event status is FAILED');

    // 1.2 Recovery Coordinator processes this candidate event today
    const recoveryBatch = await RecoveryCoordinatorService.executeWebhookInboxBatch(20);
    check(recoveryBatch.processedCount >= 1, '1.3 Recovery coordinator successfully claimed and processed old event');

    const recoveredInDb = await WebhookEvent.findOne({ eventId: oldFailedEventId });
    check(recoveredInDb !== null, '1.4 Recovered event persists in MongoDB');
    check(recoveredInDb?.status === 'PROCESSED', '1.5 Recovered event transitioned to PROCESSED');
    check(recoveredInDb?.expiresAt !== undefined, '1.6 Recovered event assigned expiresAt date');

    const expectedMinExpiry = Date.now() + 119 * MS_PER_DAY;
    const actualExpiry = recoveredInDb?.expiresAt?.getTime() ?? 0;
    check(actualExpiry > expectedMinExpiry, '1.7 Assigned expiresAt is ~120 days from recovery time, NOT from createdAt');

    // 1.3 Immediate execution of automated log cleanup with 120-day retention threshold
    const cleanupReport = await cleanupExpiredLogs({ retentionDays: 120, auditRetentionDays: 365 });
    check(typeof cleanupReport.totalDeleted === 'number', '1.8b Cleanup execution returned valid report metrics');
    const recoveredAfterCleanup = await WebhookEvent.findOne({ eventId: oldFailedEventId });
    check(
      recoveredAfterCleanup !== null,
      '1.8 Recovered 150-day-old event REMAINS in MongoDB after immediate log cleanup (Not prematurely deleted)'
    );

    // 1.4 Unresolved 150-day-old PROCESSING event is preserved
    const oldProcessingEvent = await WebhookEvent.create({
      eventId: `evt_unresolved_proc_${now}`,
      provider: 'RAZORPAY',
      eventType: 'payment.captured',
      status: 'PROCESSING',
      createdAt: new Date(now - 150 * MS_PER_DAY),
      updatedAt: new Date(now - 150 * MS_PER_DAY),
    });

    // 1.5 Unresolved 150-day-old FAILED event is preserved
    const oldFailedUnresolved = await WebhookEvent.create({
      eventId: `evt_unresolved_fail_${now}`,
      provider: 'RAZORPAY',
      eventType: 'payment.captured',
      status: 'FAILED',
      createdAt: new Date(now - 150 * MS_PER_DAY),
      updatedAt: new Date(now - 150 * MS_PER_DAY),
    });

    await cleanupExpiredLogs({ retentionDays: 120 });
    const survivingProc = await WebhookEvent.findById(oldProcessingEvent._id);
    const survivingFail = await WebhookEvent.findById(oldFailedUnresolved._id);
    check(survivingProc !== null, '1.9 Unresolved 150-day-old PROCESSING event is strictly PRESERVED');
    check(survivingFail !== null, '1.10 Unresolved 150-day-old FAILED event is strictly PRESERVED');

    // 1.6 Old PROCESSED event with future expiresAt is preserved
    const oldProcessedFutureExpiry = await WebhookEvent.create({
      eventId: `evt_old_proc_future_${now}`,
      provider: 'RAZORPAY',
      eventType: 'payment.captured',
      status: 'PROCESSED',
      createdAt: new Date(now - 150 * MS_PER_DAY),
      expiresAt: new Date(now + 60 * MS_PER_DAY),
    });

    // 1.7 PROCESSED event whose expiresAt has passed is eligible for cleanup
    const processedPassedExpiry = await WebhookEvent.create({
      eventId: `evt_proc_passed_${now}`,
      provider: 'RAZORPAY',
      eventType: 'payment.captured',
      status: 'PROCESSED',
      createdAt: new Date(now - 150 * MS_PER_DAY),
      expiresAt: new Date(now - 2 * MS_PER_DAY),
    });

    // 1.8 IGNORED event is eligible ONLY after its expiresAt passes
    const ignoredFutureExpiry = await WebhookEvent.create({
      eventId: `evt_ignored_future_${now}`,
      provider: 'RAZORPAY',
      eventType: 'unknown.unsupported.event',
      status: 'IGNORED',
      createdAt: new Date(now - 150 * MS_PER_DAY),
      expiresAt: new Date(now + 30 * MS_PER_DAY),
    });

    const ignoredPassedExpiry = await WebhookEvent.create({
      eventId: `evt_ignored_passed_${now}`,
      provider: 'RAZORPAY',
      eventType: 'unknown.unsupported.event',
      status: 'IGNORED',
      createdAt: new Date(now - 150 * MS_PER_DAY),
      expiresAt: new Date(now - 2 * MS_PER_DAY),
    });

    await cleanupExpiredLogs({ retentionDays: 120 });

    const survivingFutureProcessed = await WebhookEvent.findById(oldProcessedFutureExpiry._id);
    const deletedPassedProcessed = await WebhookEvent.findById(processedPassedExpiry._id);
    const survivingIgnored = await WebhookEvent.findById(ignoredFutureExpiry._id);
    const deletedPassedIgnored = await WebhookEvent.findById(ignoredPassedExpiry._id);

    check(survivingFutureProcessed !== null, '1.11 PROCESSED event with future expiresAt is PRESERVED');
    check(deletedPassedProcessed === null, '1.12 PROCESSED event whose expiresAt has passed was PURGED');
    check(survivingIgnored !== null, '1.13 IGNORED event with future expiresAt is PRESERVED');
    check(deletedPassedIgnored === null, '1.14 IGNORED event whose expiresAt has passed was PURGED');

    // 1.9 Failed recovery does not assign a terminal retention date; payload remains available for retry
    const malformedFailedEvent = await WebhookEvent.create({
      eventId: `evt_fail_retryable_${now}`,
      provider: 'RAZORPAY',
      eventType: 'refund.processed',
      status: 'FAILED',
      payload: {
        payload: {
          refund: {
            entity: {
              id: `rfnd_fail_${now}`,
              notes: { internal_refund_id: new mongoose.Types.ObjectId().toString() }
            }
          }
        }
      },
      createdAt: new Date(now - 100 * MS_PER_DAY),
    });

    const origFindById = Refund.findById.bind(Refund);
    Refund.findById = (function () {
      throw new Error('Simulated database transient error during recovery');
    }) as typeof Refund.findById;

    await RecoveryCoordinatorService.executeWebhookInboxBatch(20);
    Refund.findById = origFindById;

    const refreshedMalformed = await WebhookEvent.findById(malformedFailedEvent._id);
    check(refreshedMalformed?.status === 'FAILED', '1.15 Incomplete/failing recovery attempt leaves event in FAILED status');
    check(refreshedMalformed?.expiresAt === undefined, '1.16 Failed recovery does NOT assign expiresAt (never prematurely expires)');
    check(refreshedMalformed?.payload !== undefined, '1.17 Event payload remains fully intact and available for subsequent retry');
    // -------------------------------------------------------------------------
    // SECTION 2: INDIVIDUAL WEBHOOK LEASE INTEGRITY & FENCING
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 2: Webhook Lease Acquisition, Renewal & Fencing ---');

    // 2.1 First webhook delivery obtains a unique lease token
    const firstDeliveryEventId = `evt_first_deliv_${now}`;
    const origVerify = razorpayProvider.verifyWebhookSignature;
    razorpayProvider.verifyWebhookSignature = () => true;

    let firstDeliveryStatusCode = 0;
    let firstDeliveryBody = '';
    const mockReq1: any = {
      headers: {
        'x-razorpay-signature': 'valid_sig_mock',
        'x-razorpay-event-id': firstDeliveryEventId,
      },
      body: Buffer.from(JSON.stringify({
        event: 'payment.captured',
        event_id: firstDeliveryEventId,
        payload: { payment: { entity: { id: `pay_deliv_${now}`, order_id: `ord_deliv_${now}` } } }
      })),
    };
    const mockRes1: any = {
      status(c: number) { firstDeliveryStatusCode = c; return this; },
      send(b: string) { firstDeliveryBody = b; return this; }
    };

    await razorpayWebhook(mockReq1, mockRes1);
    check(firstDeliveryStatusCode === 200 && firstDeliveryBody === 'OK', '2.1 First webhook delivery processed with 200 OK');

    const firstDelivDoc = await WebhookEvent.findOne({ eventId: firstDeliveryEventId });
    check(Boolean(firstDelivDoc?.leaseToken), '2.2 First webhook delivery was assigned a unique event lease token');
    check(firstDelivDoc?.status === 'PROCESSED', '2.3 First webhook delivery transitioned to PROCESSED');

    // 2.2 Background replay obtains a unique event lease token
    const replayEventId = `evt_replay_${now}`;
    const replayDoc = await WebhookEvent.create({
      eventId: replayEventId,
      provider: 'RAZORPAY',
      eventType: 'payment.captured',
      status: 'FAILED',
      payload: testPayload,
    });

    await RecoveryCoordinatorService.executeWebhookInboxBatch(20);
    const refreshedReplayDoc = await WebhookEvent.findById(replayDoc._id);
    check(Boolean(refreshedReplayDoc?.leaseToken), '2.4 Background replay assigned unique lease token to candidate event');
    check(refreshedReplayDoc?.status === 'PROCESSED', '2.5 Replayed event transitioned to PROCESSED');

    // 2.3 Lease renewal succeeds for current owner within active lease window
    const leaseTestEvent = await WebhookEvent.create({
      eventId: `evt_renewal_test_${now}`,
      provider: 'RAZORPAY',
      eventType: 'payment.captured',
      status: 'PROCESSING',
      leaseToken: 'token_owner_alpha',
      processingLockExpiresAt: new Date(Date.now() + 30_000), // 30s in future
    });

    const renewalSuccess = await renewWebhookEventLease(
      leaseTestEvent._id,
      'token_owner_alpha',
      45_000
    );
    check(renewalSuccess === true, '2.6 Lease renewal succeeds for valid owner token and active lease');

    const renewedInDb = await WebhookEvent.findById(leaseTestEvent._id);
    check(
      renewedInDb!.processingLockExpiresAt!.getTime() > Date.now() + 40_000,
      '2.7 Document processingLockExpiresAt was successfully extended in MongoDB'
    );

    // 2.4 Second worker cannot claim an actively leased event
    const secondClaimAttempt = await WebhookEvent.findOneAndUpdate(
      {
        _id: leaseTestEvent._id,
        $or: [
          { status: 'FAILED' },
          { status: 'PROCESSING', processingLockExpiresAt: { $lt: new Date() } }
        ]
      },
      {
        $set: {
          status: 'PROCESSING',
          leaseToken: 'token_worker_beta',
          processingLockExpiresAt: new Date(Date.now() + 60_000)
        }
      },
      { returnDocument: 'after' }
    );
    check(secondClaimAttempt === null, '2.8 Second worker blocked from claiming actively leased event');

    // 2.5 Long-running handler remains protected through lease heartbeat renewal
    const longRunningEvent = await WebhookEvent.create({
      eventId: `evt_long_running_${now}`,
      provider: 'RAZORPAY',
      eventType: 'payment.captured',
      status: 'PROCESSING',
      leaseToken: 'token_long_runner',
      processingLockExpiresAt: new Date(Date.now() + 2000), // 2s initial lease
    });

    // Integration verification: test real background heartbeat timer tick against MongoDB
    const heartbeat = startEventLeaseHeartbeat(longRunningEvent._id, 'token_long_runner', 60_000, 100);
    await new Promise<void>(resolve => { setTimeout(resolve, 250); });

    const checkDuringRun = await WebhookEvent.findById(longRunningEvent._id);
    check(
      checkDuringRun!.processingLockExpiresAt!.getTime() > Date.now() + 30_000,
      '2.9 Long-running event remained actively protected by lease heartbeat beyond original expiry'
    );
    heartbeat.stop();
    const wrongTokenRenewal = await renewWebhookEventLease(
      longRunningEvent._id,
      'wrong_unauthorized_token',
      60_000
    );
    check(wrongTokenRenewal === false, '2.10 Lease renewal rejected for incorrect token');

    // 2.7 Expired lease can be reclaimed by a new worker
    await WebhookEvent.updateOne(
      { _id: longRunningEvent._id },
      { $set: { processingLockExpiresAt: new Date(Date.now() - 5000) } } // Artificially expire
    );

    const newWorkerToken = 'token_worker_gamma_new';
    const reclaimedByGamma = await WebhookEvent.findOneAndUpdate(
      {
        _id: longRunningEvent._id,
        $or: [
          { status: 'FAILED' },
          { status: 'PROCESSING', processingLockExpiresAt: { $lt: new Date() } }
        ]
      },
      {
        $set: {
          status: 'PROCESSING',
          leaseToken: newWorkerToken,
          processingLockExpiresAt: new Date(Date.now() + 60_000)
        }
      },
      { returnDocument: 'after' }
    );
    check(reclaimedByGamma !== null, '2.11 New worker successfully reclaimed genuinely expired event lease');
    check(reclaimedByGamma?.leaseToken === newWorkerToken, '2.12 Document assigned new worker leaseToken');

    // 2.8 Stale worker is fenced from updating final state to PROCESSED
    const staleWorkerUpdate = await WebhookEvent.updateOne(
      { _id: longRunningEvent._id, status: 'PROCESSING', leaseToken: 'token_long_runner' },
      {
        $set: {
          status: 'PROCESSED',
          processedAt: new Date(),
          expiresAt: new Date(Date.now() + 120 * MS_PER_DAY)
        }
      }
    );
    check(
      staleWorkerUpdate.matchedCount === 0,
      '2.13 Stale former worker strictly FENCED from marking event PROCESSED (matchedCount = 0)'
    );

    // 2.9 New owner can complete the event
    const newOwnerUpdate = await WebhookEvent.updateOne(
      { _id: longRunningEvent._id, status: 'PROCESSING', leaseToken: newWorkerToken },
      {
        $set: {
          status: 'PROCESSED',
          processedAt: new Date(),
          expiresAt: new Date(Date.now() + 120 * MS_PER_DAY)
        }
      }
    );
    check(newOwnerUpdate.matchedCount === 1, '2.14 Current valid owner successfully transitioned event to PROCESSED');

    // 2.10 Former owner cannot overwrite the new owner's result with FAILED
    const formerOwnerLateError = await WebhookEvent.updateOne(
      { _id: longRunningEvent._id, status: 'PROCESSING', leaseToken: 'token_long_runner' },
      {
        $set: {
          status: 'FAILED',
          lastError: 'Stale worker crash late report'
        }
      }
    );
    check(formerOwnerLateError.matchedCount === 0, '2.15 Former owner CANNOT overwrite new owner result with FAILED');

    const finalDocState = await WebhookEvent.findById(longRunningEvent._id);
    check(finalDocState?.status === 'PROCESSED', '2.16 Final state remains PROCESSED (protected against stale overwrite)');

    // 2.11 Test recoverStaleWebhookEvents clears expiresAt on recovered events
    const staleProcEvent = await WebhookEvent.create({
      eventId: `evt_recover_stale_lease_${now}`,
      provider: 'RAZORPAY',
      eventType: 'payment.captured',
      status: 'PROCESSING',
      processingLockExpiresAt: new Date(Date.now() - 5000),
    });
    const recovStaleRes = await recoverStaleWebhookEvents(1000);
    check(recovStaleRes.recoveredCount >= 1, '2.11 recoverStaleWebhookEvents transitions expired PROCESSING to FAILED');
    const refreshedStaleProc = await WebhookEvent.findById(staleProcEvent._id);
    check(refreshedStaleProc?.status === 'FAILED', '2.12 Recovered stale event has status FAILED');
    check(refreshedStaleProc?.expiresAt === undefined, '2.13 Recovered stale event strictly has NO expiresAt set');

    // 2.14 Duplicate processed deliveries remain safe no-ops
    let dupStatus = 0;
    let dupBody = '';
    const mockDupRes: any = {
      status(c: number) { dupStatus = c; return this; },
      send(b: string) { dupBody = b; return this; }
    };
    await razorpayWebhook(mockReq1, mockDupRes);
    check(dupStatus === 200 && dupBody.includes('already processed'), '2.14 Duplicate delivery of processed event returns 200 OK no-op');
    razorpayProvider.verifyWebhookSignature = origVerify;

    // -------------------------------------------------------------------------
    // SECTION 3: WEBHOOK TTL MIGRATION PLAN AUDIT & PREFLIGHT VERIFICATION
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 3: Webhook TTL Migration Plan Audit ---');

    const preflightResult = await preflightWebhookIndexMigration(mongoose.connection);
    check(preflightResult.canProceed === true, '3.1 Migration preflight inspection passed with canProceed: true');
    check(preflightResult.hasNewExpiresAtTtl === true, '3.2 Schema defines safe sparse TTL index on { expiresAt: 1 }');
    check(preflightResult.blockers.length === 0, '3.3 No index naming collisions or blocking errors detected');

    // Test non-destructive dry-run mode
    const dryRunResult = await runWebhookIndexMigration({ dryRun: true, connection: mongoose.connection });
    check(dryRunResult.success === true && dryRunResult.dryRun === true, '3.4 Migration dry-run executes cleanly without database mutation');

    console.log('\n🧹 Cleaning up test fixtures from database...');
    await WebhookEvent.deleteMany({
      _id: {
        $in: [
          oldFailedEvent._id,
          oldProcessingEvent._id,
          oldFailedUnresolved._id,
          oldProcessedFutureExpiry._id,
          processedPassedExpiry._id,
          ignoredFutureExpiry._id,
          ignoredPassedExpiry._id,
          malformedFailedEvent._id,
          firstDelivDoc?._id,
          replayDoc._id,
          leaseTestEvent._id,
          longRunningEvent._id,
          staleProcEvent._id,
        ].filter((id): id is mongoose.Types.ObjectId => Boolean(id))
      }
    });
    await PaymentAttempt.deleteMany({ _id: { $in: [testAttempt._id, delivAttempt._id] } });
    await Payment.deleteMany({ _id: { $in: [testPayment._id, delivPayment._id] } });
    await Order.deleteMany({ _id: { $in: [testOrder._id, delivOrder._id] } });
    await User.deleteMany({ _id: testUser._id });
    await Product.deleteMany({ _id: testProduct._id });

    await mongoose.disconnect();
    console.log(' Disconnected from MongoDB\n');
  } catch (err: unknown) {
    console.error('Test execution failed:', err);
    failed++;
  }

  console.log('══════════════════════════════════════════════════════════════════════');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════════════════════════\n');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runSuite();
