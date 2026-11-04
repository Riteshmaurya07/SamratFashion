/**
 * Samrat Fashion — Phase A: Production-Safe Inventory & Refund Integrity Test Suite
 *
 * Verifies all 8 Inventory integrity invariants and 15 Refund recovery invariants.
 */

process.env.NODE_ENV = 'test';
process.env.RAZORPAY_KEY_ID = 'rzp_test_mock';
process.env.RAZORPAY_KEY_SECRET = 'mock_secret_test';
process.env.RAZORPAY_WEBHOOK_SECRET = 'mock_webhook_secret_test';

import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.join(__dirname, '../../.env') });
import mongoose from 'mongoose';
import { connectSafeTestDb, createTestProduct } from './testHelpers';
import { Order } from '../models/Order';
import { Payment } from '../models/Payment';
import { PaymentAttempt } from '../models/PaymentAttempt';
import { Refund } from '../models/Refund';
import { ReturnRequest } from '../models/ReturnRequest';
import { Product } from '../models/Product';
import { InventoryTransaction } from '../models/InventoryTransaction';
import { WebhookEvent } from '../models/WebhookEvent';
import { WorkerLock } from '../models/WorkerLock';
import { RecoveryStatus } from '../models/RecoveryStatus';
import { createInternalRefund, classifyRazorpayRefundError, reconcileUnknownRefund, reconcileIncompleteRefundOperations } from '../services/payment/refundService';
import { InventoryAllocationService } from '../services/inventory/inventoryAllocationService';
import { acceptReturn } from '../controllers/returnController';
import { razorpayWebhook, handleRefundProcessedEntity, handleRefundFailedEntity, recoverStaleWebhookEvents } from '../controllers/webhookController';
import { razorpayProvider } from '../services/payment/RazorpayProvider';
import { runInventoryIndexMigration } from '../scripts/migrateInventoryTransactionIndexes';
import { RecoveryCoordinatorService } from '../services/recovery/recoveryCoordinatorService';
import { cleanupExpiredLogs } from '../services/logCleanupService';
import { getRecoveryMetrics, triggerRecoveryCycle } from '../controllers/adminRecoveryController';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(condition: boolean, desc: string, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  ✅ PASS: ${desc}`);
  } else {
    failed++;
    const msg = `${desc}${detail ? ` — ${detail}` : ''}`;
    failures.push(msg);
    console.error(`  ❌ FAIL: ${msg}`);
  }
}

async function runSuite() {
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║  Phase A — Production-Safe Inventory & Refund Integrity Suite       ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

  await connectSafeTestDb();

  // Test Admin & User IDs
  const adminId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();

  try {
    // -------------------------------------------------------------------------
    // SECTION 1: INVENTORY TRANSACTION INDEX & MULTIPLE PARTIAL RETURNS
    // -------------------------------------------------------------------------
    console.log('--- Section 1: Inventory Transaction Index & Multiple Partial Returns ---');

    // Run migration script against test DB to ensure partial indexes exist
    const migrationResult = await runInventoryIndexMigration({ dryRun: false });
    check(migrationResult.success, '1.0 Migration script successfully created partial indexes on test DB');

    // Create a product with initial stock = 50
    const { product, variantIds } = await createTestProduct({
      name: 'Integrity Kurta',
      variants: [{ size: 'M', color: 'NAVY', stock: 50, additionalPrice: 0, isAvailable: true }]
    });
    const variantId = new mongoose.Types.ObjectId(variantIds[0]);

    // Create an order for 3 units
    const order = await Order.create({
      orderNumber: `ORD-INT-${Date.now()}-1`,
      userId,
      items: [
        {
          productId: product._id,
          variantId,
          productName: 'Integrity Kurta',
          productImage: 'https://example.com/kurta.jpg',
          selectedSize: 'M',
          selectedColor: 'NAVY',
          quantity: 3,
          unitPrice: 1000,
          lineTotal: 3000
        }
      ],
      subtotal: 3000,
      shipping: 0,
      total: 3000,
      currency: 'INR',
      status: 'DELIVERED',
      paymentStatus: 'PAID',
      paymentMethod: 'RAZORPAY',
      shippingAddress: {
        fullName: 'Test Customer',
        phone: '9876543210',
        addressLine1: 'Park Street',
        city: 'Kolkata',
        state: 'West Bengal',
        postalCode: '700016',
        country: 'India'
      }
    });

    // Create corresponding Payment & PaymentAttempt
    const payment = await Payment.create({
      orderId: order._id,
      userId,
      amount: 3000,
      currency: 'INR',
      status: 'CAPTURED',
      provider: 'RAZORPAY',
      refundedAmount: 0,
      pendingRefundAmount: 0,
      razorpayPaymentId: `pay_mock_${Date.now()}`
    });

    await PaymentAttempt.create({
      orderId: order._id,
      paymentId: payment._id,
      amount: 3000,
      currency: 'INR',
      status: 'CAPTURED',
      razorpayOrderId: `order_mock_${Date.now()}`,
      razorpayPaymentId: payment.razorpayPaymentId
    });

    // Create initial SALE ledger transaction
    await InventoryTransaction.create({
      orderId: order._id,
      productId: product._id,
      variantId,
      quantity: 3,
      type: 'SALE'
    });

    // Simulate inventory deduction at purchase: stock: 50 -> 47
    await Product.updateOne(
      { _id: product._id, 'variants._id': variantId },
      { $set: { 'variants.$.stock': 47 } }
    );

    // 1.1 First Partial Return: Return 1 unit
    const returnReq1 = await ReturnRequest.create({
      orderId: order._id,
      userId,
      items: [{ productId: product._id, variantId, quantity: 1, reason: 'WRONG_SIZE' }],
      status: 'INSPECTING'
    });

    // 1.2 Second Partial Return for SAME variant on SAME order: Return 1 unit
    const returnReq2 = await ReturnRequest.create({
      orderId: order._id,
      userId,
      items: [{ productId: product._id, variantId, quantity: 1, reason: 'DEFECTIVE' }],
      status: 'INSPECTING'
    });

    // Test 1 & 2: Restoring inventory for both separate return requests
    const res1 = await InventoryAllocationService.restoreReturnInventory(returnReq1, order._id);
    check(res1.restoredCount === 1, '1.1 Return 1 successfully restored 1 unit of stock');

    const res2 = await InventoryAllocationService.restoreReturnInventory(returnReq2, order._id);
    check(res2.restoredCount === 1, '1.2 Return 2 successfully restored same variant on same order (No unique index collision)');

    let updatedProd = await Product.findById(product._id);
    let currentStock = (updatedProd?.variants as any).id(variantId).stock;
    check(currentStock === 49, `1.3 Stock correctly incremented from 47 to 49 (+2 units total)`, `stock=${currentStock}`);

    // Test 3: Duplicate processing of Return 1 must be an idempotent no-op
    const dupRes = await InventoryAllocationService.restoreReturnInventory(returnReq1, order._id);
    check(dupRes.restoredCount === 0 && dupRes.alreadyRestored, '1.4 Duplicate restoration call on Return 1 is a safe idempotent no-op');

    updatedProd = await Product.findById(product._id);
    currentStock = (updatedProd?.variants as any).id(variantId).stock;
    check(currentStock === 49, '1.5 Stock was NOT double-restored on duplicate call (remains 49)');

    // Test 4: Multiple identical lines within ONE return request (e.g. 2 lines of variantId)
    const returnReqMultiLine = await ReturnRequest.create({
      orderId: order._id,
      userId,
      items: [
        { productId: product._id, variantId, quantity: 1, reason: 'WRONG_SIZE' },
        { productId: product._id, variantId, quantity: 2, reason: 'WRONG_SIZE' }
      ],
      status: 'INSPECTING'
    });

    const multiLineRes = await InventoryAllocationService.restoreReturnInventory(returnReqMultiLine, order._id);
    check(multiLineRes.restoredCount === 1, '1.6 Multi-line return with identical variants aggregated into 1 ledger row');

    const multiLineLedger = await InventoryTransaction.find({
      returnId: returnReqMultiLine._id,
      variantId,
      type: 'RETURN'
    });
    check(multiLineLedger.length === 1 && multiLineLedger[0].quantity === 3, '1.7 Aggregated ledger quantity is exactly 3 (1 + 2)');

    // Test 5: Existing SALE uniqueness protection remains strictly enforced
    let saleDuplicateThrown = false;
    try {
      await InventoryTransaction.create({
        orderId: order._id,
        productId: product._id,
        variantId,
        quantity: 1,
        type: 'SALE'
      });
    } catch (err: any) {
      if (err.code === 11000) {
        saleDuplicateThrown = true;
      }
    }
    check(saleDuplicateThrown, '1.8 SALE uniqueness per order and variant remains strictly protected (E11000 thrown on duplicate SALE)');

    // Test 6: Historical RETURN transactions without returnId do not conflict with new returns
    const historicalTx = await InventoryTransaction.create({
      orderId: order._id,
      productId: product._id,
      variantId,
      quantity: 1,
      type: 'RETURN'
      // returnId intentionally omitted
    });
    check(historicalTx._id !== undefined, '1.9 Historical RETURN record without returnId is safely stored in ledger');

    // Test 1.10: Historical return record without returnId halts automatic restoration and flags reconciliation
    const historicalReturnReq = await ReturnRequest.create({
      orderId: order._id,
      userId,
      items: [{ productId: product._id, variantId, quantity: 1, reason: 'WRONG_SIZE' }],
      status: 'INSPECTING'
    });
    const histRes = await InventoryAllocationService.restoreReturnInventory(historicalReturnReq, order._id);
    check(histRes.requiresReconciliation === true, '1.10 Historical RETURN record without returnId flags requiresReconciliation');
    const histReqInDb = await ReturnRequest.findById(historicalReturnReq._id);
    check(histReqInDb?.requiresInventoryReconciliation === true, '1.11 ReturnRequest marked requiresInventoryReconciliation: true in DB');

    // Test 1.12: Crash after stock modification but before ledger completion (recovery test)
    const { product: crashProduct, variantIds: crashVariantIds } = await createTestProduct({
      name: 'Crash Integrity Kurta',
      variants: [{ size: 'L', color: 'WHITE', stock: 50, additionalPrice: 0, isAvailable: true }]
    });
    const crashVariantId = new mongoose.Types.ObjectId(crashVariantIds[0]);
    const crashReturnId = new mongoose.Types.ObjectId();

    // Simulate crash after stock increment: transaction is PENDING, and variant already contains tx._id in recentTxIds
    const pendingCrashTx1 = await InventoryTransaction.create({
      returnId: crashReturnId,
      orderId: order._id,
      productId: crashProduct._id,
      variantId: crashVariantId,
      quantity: 2,
      type: 'RETURN',
      status: 'PENDING'
    });
    await Product.updateOne(
      { _id: crashProduct._id, 'variants._id': crashVariantId },
      {
        $inc: { 'variants.$.stock': 2 },
        $push: { 'variants.$.recentTxIds': pendingCrashTx1._id }
      }
    );

    await InventoryAllocationService.reconcilePendingTransaction(pendingCrashTx1, {
      productId: crashProduct._id,
      variantId: crashVariantId,
      quantity: 2
    });

    const refreshedCrashProd1 = await Product.findById(crashProduct._id);
    const variantStock1 = refreshedCrashProd1?.variants.find(v => v._id?.toString() === crashVariantId.toString())?.stock;
    check(variantStock1 === 52, '1.12 Stock was NOT double-incremented after crash-after-stock-modification (remains 52)');
    const resolvedTx1 = await InventoryTransaction.findById(pendingCrashTx1._id);
    check(resolvedTx1?.status === 'COMPLETED', '1.13 Pending transaction transitioned to COMPLETED');

    // Test 1.14: Crash after operation intent creation (transaction is PENDING, variant does NOT have tx._id)
    const crashReturnId2 = new mongoose.Types.ObjectId();
    const pendingCrashTx2 = await InventoryTransaction.create({
      returnId: crashReturnId2,
      orderId: order._id,
      productId: crashProduct._id,
      variantId: crashVariantId,
      quantity: 3,
      type: 'RETURN',
      status: 'PENDING'
    });
    // Stock is still 52 (intent was recorded, but process crashed before stock update)
    await InventoryAllocationService.reconcilePendingTransaction(pendingCrashTx2, {
      productId: crashProduct._id,
      variantId: crashVariantId,
      quantity: 3
    });

    const refreshedCrashProd2 = await Product.findById(crashProduct._id);
    const variantStock2 = refreshedCrashProd2?.variants.find(v => v._id?.toString() === crashVariantId.toString())?.stock;
    check(variantStock2 === 55, '1.14 Stock correctly incremented by 3 during recovery (52 -> 55)');
    const resolvedTx2 = await InventoryTransaction.findById(pendingCrashTx2._id);
    check(resolvedTx2?.status === 'COMPLETED', '1.15 Transaction transitioned to COMPLETED after recovery');

    // Test 1.16: Application restart recovery scans all pending transactions
    const crashReturnId3 = new mongoose.Types.ObjectId();
    await InventoryTransaction.create({
      returnId: crashReturnId3,
      orderId: order._id,
      productId: crashProduct._id,
      variantId: crashVariantId,
      quantity: 1,
      type: 'RETURN',
      status: 'PENDING'
    });
    const restartResult = await InventoryAllocationService.reconcilePendingInventoryRestorations();
    check(restartResult.resolvedCount >= 1, '1.16 Startup reconciliation resolves all pending inventory transactions');

    // Test 1.17: Marker Eviction Regression Test
    const { product: evictionProduct, variantIds: evictionVariantIds } = await createTestProduct({
      name: 'Eviction Proof Kurta',
      variants: [{ size: 'XL', color: 'BLACK', stock: 100, additionalPrice: 0, isAvailable: true }]
    });
    const evictionVariantId = new mongoose.Types.ObjectId(evictionVariantIds[0]);
    const evictionReturnId = new mongoose.Types.ObjectId();

    // Step A: Create PENDING transaction
    const pendingEvictionTx = await InventoryTransaction.create({
      returnId: evictionReturnId,
      orderId: order._id,
      productId: evictionProduct._id,
      variantId: evictionVariantId,
      quantity: 5,
      type: 'RETURN',
      status: 'PENDING'
    });

    // Step B: Increment stock from 100 to 105 and record in both pendingTxIds and recentTxIds
    await Product.updateOne(
      { _id: evictionProduct._id, 'variants._id': evictionVariantId },
      {
        $inc: { 'variants.$.stock': 5 },
        $addToSet: { 'variants.$.pendingTxIds': pendingEvictionTx._id },
        $push: { 'variants.$.recentTxIds': { $each: [pendingEvictionTx._id], $slice: -20 } }
      }
    );

    // Simulate 25 subsequent operations on this variant (which would evict from recentTxIds with $slice: -20)
    for (let i = 0; i < 25; i++) {
      const dummyId = new mongoose.Types.ObjectId();
      await Product.updateOne(
        { _id: evictionProduct._id, 'variants._id': evictionVariantId },
        {
          $push: { 'variants.$.recentTxIds': { $each: [dummyId], $slice: -20 } }
        }
      );
    }

    // Verify recentTxIds evicted pendingEvictionTx._id, BUT pendingTxIds RETAINED IT!
    const prodAfterOperations = await Product.findById(evictionProduct._id);
    const variantAfterOperations = prodAfterOperations?.variants.find(v => v._id?.toString() === evictionVariantId.toString());
    const inRecent = variantAfterOperations?.recentTxIds?.some(id => id.toString() === pendingEvictionTx._id.toString());
    const inPending = variantAfterOperations?.pendingTxIds?.some(id => id.toString() === pendingEvictionTx._id.toString());

    check(inRecent === false, '1.17 recentTxIds successfully evicted marker after 25 operations ($slice: -20 cap confirmed)');
    check(inPending === true, '1.18 pendingTxIds strictly RETAINED pending marker without eviction');

    // Run reconciliation on this pending transaction
    await InventoryAllocationService.reconcilePendingTransaction(pendingEvictionTx, {
      productId: evictionProduct._id,
      variantId: evictionVariantId,
      quantity: 5
    });

    const finalEvictionProd = await Product.findById(evictionProduct._id);
    const finalStock = finalEvictionProd?.variants.find(v => v._id?.toString() === evictionVariantId.toString())?.stock;
    check(finalStock === 105, '1.19 Stock remained 105 (NOT double-incremented to 110 despite recentTxIds eviction)');
    const finalPendingMarker = finalEvictionProd?.variants.find(v => v._id?.toString() === evictionVariantId.toString())?.pendingTxIds;
    check(finalPendingMarker?.length === 0, '1.20 pendingTxIds safely cleared after confirmed completion');

    // -------------------------------------------------------------------------
    // SECTION 2: REFUND DURABLE INTENT, STATE MACHINE & ERROR RECOVERY
    // -------------------------------------------------------------------------
    console.log('\n--- Section 2: Refund Intent, State Machine & Gateway Recovery ---');

    // Order 2 for Refund Testing
    const order2 = await Order.create({
      orderNumber: `ORD-REF-${Date.now()}-2`,
      userId,
      items: [
        {
          productId: product._id,
          variantId,
          productName: 'Integrity Kurta',
          productImage: 'https://example.com/kurta.jpg',
          selectedSize: 'M',
          selectedColor: 'NAVY',
          quantity: 2,
          unitPrice: 1500,
          lineTotal: 3000
        }
      ],
      subtotal: 3000,
      shipping: 0,
      total: 3000,
      currency: 'INR',
      status: 'DELIVERED',
      paymentStatus: 'PAID',
      paymentMethod: 'RAZORPAY',
      shippingAddress: {
        fullName: 'Test Customer',
        phone: '9876543210',
        addressLine1: 'Park Street',
        city: 'Kolkata',
        state: 'West Bengal',
        postalCode: '700016',
        country: 'India'
      }
    });

    const payment2 = await Payment.create({
      orderId: order2._id,
      userId,
      amount: 3000,
      currency: 'INR',
      status: 'CAPTURED',
      provider: 'RAZORPAY',
      refundedAmount: 0,
      pendingRefundAmount: 0,
      razorpayPaymentId: `pay_mock_${Date.now()}_2`
    });

    await PaymentAttempt.create({
      orderId: order2._id,
      paymentId: payment2._id,
      amount: 3000,
      currency: 'INR',
      status: 'CAPTURED',
      razorpayOrderId: `order_mock_${Date.now()}_2`,
      razorpayPaymentId: payment2.razorpayPaymentId
    });

    const returnReqForRefund = await ReturnRequest.create({
      orderId: order2._id,
      userId,
      items: [{ productId: product._id, variantId, quantity: 1, reason: 'DEFECTIVE' }],
      status: 'ACCEPTED',
      inventoryRestored: true
    });

    // 2.1 Error Classification Tests
    const timeoutErr = { code: 'ETIMEDOUT', message: 'Connection timed out after 5000ms' };
    const classifiedTimeout = classifyRazorpayRefundError(timeoutErr);
    check(classifiedTimeout.isAmbiguous && !classifiedTimeout.isDefinitiveRejection, '2.1 Network timeout ETIMEDOUT classified as ambiguous outcome');

    const gateway502 = { statusCode: 502, error: { description: 'Bad Gateway from upstream' } };
    const classified502 = classifyRazorpayRefundError(gateway502);
    check(classified502.isAmbiguous && !classified502.isDefinitiveRejection, '2.2 Gateway 502 Bad Gateway classified as ambiguous outcome');

    const badRequest400 = { statusCode: 400, error: { code: 'BAD_REQUEST_ERROR', description: 'The payment has already been fully refunded' } };
    const classified400 = classifyRazorpayRefundError(badRequest400);
    check(classified400.isDefinitiveRejection && !classified400.isAmbiguous, '2.3 400 BAD_REQUEST_ERROR classified as definitive rejection');

    // 2.2 Payment Reservation Failure Test (Attempting to refund more than available balance)
    let reservationFailed = false;
    try {
      await createInternalRefund({
        orderId: order2._id.toString(),
        returnId: returnReqForRefund._id.toString(),
        amount: 5000, // Total is 3000
        reason: 'Oversized refund',
        actorId: adminId.toString(),
        actorRole: 'ADMIN'
      });
    } catch (err: any) {
      if (err.message.includes('Cannot refund more than the remaining')) {
        reservationFailed = true;
      }
    }
    check(reservationFailed, '2.4 Oversized refund rejected at atomic reservation without creating stuck records');

    // Verify pendingRefundAmount remains 0
    let freshPayment2: any = await Payment.findById(payment2._id);
    check(freshPayment2.pendingRefundAmount === 0, '2.5 pendingRefundAmount remained 0 after rejected reservation');

    // 2.3 Ambiguous Gateway Outcome (Timeout simulation)
    const originalCreateRefund = razorpayProvider.createRefund;
    razorpayProvider.createRefund = async () => {
      throw { code: 'ETIMEDOUT', message: 'Gateway socket timed out' };
    };

    let unknownOutcomeThrown = false;
    try {
      await createInternalRefund({
        orderId: order2._id.toString(),
        returnId: returnReqForRefund._id.toString(),
        amount: 1500,
        reason: 'Return Request Test Timeout',
        actorId: adminId.toString(),
        actorRole: 'ADMIN'
      });
    } catch (err: any) {
      if (err.errorCode === 'REFUND_OUTCOME_UNKNOWN' || err.statusCode === 502) {
        unknownOutcomeThrown = true;
      }
    }
    check(unknownOutcomeThrown, '2.6 Gateway timeout throws REFUND_OUTCOME_UNKNOWN (502)');

    // Verify Refund record is in UNKNOWN status
    const unknownRefund = await Refund.findOne({ returnId: returnReqForRefund._id });
    check(unknownRefund?.status === 'UNKNOWN', '2.7 Refund document persisted in UNKNOWN status');

    // Verify reservation is HELD (NOT released) to prevent duplicate refunds
    freshPayment2 = await Payment.findById(payment2._id);
    check(freshPayment2.pendingRefundAmount === 1500, '2.8 Reservation of ₹1500 is HELD on payment during ambiguous UNKNOWN state');

    // Verify linked ReturnRequest reflects UNKNOWN state
    let freshReturnReq = await ReturnRequest.findById(returnReqForRefund._id);
    check(freshReturnReq?.refundStatus === 'UNKNOWN', '2.9 ReturnRequest reflects refundStatus: UNKNOWN');

    // Verify retry while UNKNOWN is BLOCKED
    let retryBlocked = false;
    try {
      await createInternalRefund({
        orderId: order2._id.toString(),
        returnId: returnReqForRefund._id.toString(),
        amount: 1500,
        reason: 'Retry while unknown',
        actorId: adminId.toString(),
        actorRole: 'ADMIN'
      });
    } catch (err: any) {
      if (err.errorCode === 'REFUND_RECONCILIATION_REQUIRED' || err.statusCode === 409) {
        retryBlocked = true;
      }
    }
    check(retryBlocked, '2.10 Automatic retry is BLOCKED while previous attempt is UNKNOWN');

    // 2.4 Reconciliation: Reconcile the UNKNOWN refund
    // In mock mode, reconcile marks PROCESSED and moves reservation
    const reconciled = await reconcileUnknownRefund(unknownRefund!._id.toString());
    check(reconciled.status === 'PROCESSED', '2.11 Reconciled refund successfully transitioned to PROCESSED');

    freshPayment2 = await Payment.findById(payment2._id);
    check(
      freshPayment2.pendingRefundAmount === 0 && freshPayment2.refundedAmount === 1500,
      '2.12 Reconciliation moved ₹1500 from pendingRefundAmount to refundedAmount'
    );

    freshReturnReq = await ReturnRequest.findById(returnReqForRefund._id);
    check(freshReturnReq?.refundStatus === 'PROCESSED', '2.13 ReturnRequest reflects refundStatus: PROCESSED');

    // 2.5 Re-attempting refund on an already PROCESSED return is BLOCKED
    let alreadyProcessedBlocked = false;
    try {
      await createInternalRefund({
        orderId: order2._id.toString(),
        returnId: returnReqForRefund._id.toString(),
        amount: 1500,
        reason: 'Attempt duplicate refund on processed return',
        actorId: adminId.toString(),
        actorRole: 'ADMIN'
      });
    } catch (err: any) {
      if (err.errorCode === 'REFUND_ALREADY_PROCESSED' || err.statusCode === 400) {
        alreadyProcessedBlocked = true;
      }
    }
    check(alreadyProcessedBlocked, '2.14 Duplicate refund on already PROCESSED return is strictly BLOCKED');
    // 2.15 HTTP 409 Conflict Handling from Razorpay
    const conflict409 = { statusCode: 409, error: { description: 'Refund request with this idempotency key is already in progress' } };
    const classified409 = classifyRazorpayRefundError(conflict409);
    check(classified409.category === 'STILL_PROCESSING' && classified409.isStillProcessing && !classified409.isDefinitiveRejection, '2.15 HTTP 409 classified as STILL_PROCESSING and not definitive rejection');

    razorpayProvider.createRefund = async () => {
      throw { statusCode: 409, error: { description: 'An existing refund request with this key is currently processing' } };
    };

    const returnReq409 = await ReturnRequest.create({
      orderId: order2._id,
      userId,
      items: [{ productId: product._id, variantId, quantity: 1, reason: 'DEFECTIVE' }],
      status: 'INSPECTING'
    });

    let conflict409Thrown = false;
    try {
      await createInternalRefund({
        orderId: order2._id.toString(),
        returnId: returnReq409._id.toString(),
        amount: 500,
        reason: 'Test 409 conflict',
        actorId: adminId.toString(),
        actorRole: 'ADMIN'
      });
    } catch (err: any) {
      if (err.statusCode === 409 || err.errorCode === 'REFUND_OUTCOME_UNKNOWN') conflict409Thrown = true;
    }
    check(conflict409Thrown, '2.16 Razorpay 409 conflict throws 409 REFUND_OUTCOME_UNKNOWN');

    freshPayment2 = await Payment.findById(payment2._id);
    check(freshPayment2.pendingRefundAmount >= 500, '2.17 Reservation is HELD on payment during 409 conflict (not released)');

    const conflictRefund = await Refund.findOne({ returnId: returnReq409._id });
    check(conflictRefund?.status === 'UNKNOWN', '2.18 Refund document marked UNKNOWN on 409 conflict');
    check(Boolean(conflictRefund?.idempotencyKey), '2.19 Persistent idempotency key generated and saved on Refund');

    // 2.20 Razorpay status: 'pending' (queued with provider, not yet processed)
    razorpayProvider.createRefund = async () => {
      return { id: `rfnd_queued_${Date.now()}`, entity: 'refund', amount: 50000, status: 'pending' };
    };

    const returnReqPendingGateway = await ReturnRequest.create({
      orderId: order2._id,
      userId,
      items: [{ productId: product._id, variantId, quantity: 1, reason: 'DEFECTIVE' }],
      status: 'INSPECTING'
    });

    const pendingGatewayRefund = await createInternalRefund({
      orderId: order2._id.toString(),
      returnId: returnReqPendingGateway._id.toString(),
      amount: 500,
      reason: 'Test queued refund',
      actorId: adminId.toString(),
      actorRole: 'ADMIN'
    });
    check(pendingGatewayRefund.status === 'PENDING', '2.20 Gateway response status: pending keeps Refund status as PENDING (not PROCESSED)');
    const reqPendingGatewayInDb = await ReturnRequest.findById(returnReqPendingGateway._id);
    check(reqPendingGatewayInDb?.refundStatus === 'PENDING', '2.21 ReturnRequest refundStatus is PENDING when gateway queues refund');
    // Restore original createRefund
    razorpayProvider.createRefund = originalCreateRefund;

    // -------------------------------------------------------------------------
    // SECTION 3: DEFINITIVE GATEWAY REJECTION & SAFE RETRY ATTEMPT
    // -------------------------------------------------------------------------
    console.log('\n--- Section 3: Definitive Gateway Rejection & Safe Retry ---');

    // Order 3 for Definitive Rejection & Retry Testing
    const order3 = await Order.create({
      orderNumber: `ORD-REF-${Date.now()}-3`,
      userId,
      items: [
        {
          productId: product._id,
          variantId,
          productName: 'Integrity Kurta',
          productImage: 'https://example.com/kurta.jpg',
          selectedSize: 'M',
          selectedColor: 'NAVY',
          quantity: 2,
          unitPrice: 1500,
          lineTotal: 3000
        }
      ],
      subtotal: 3000,
      shipping: 0,
      total: 3000,
      currency: 'INR',
      status: 'DELIVERED',
      paymentStatus: 'PAID',
      paymentMethod: 'RAZORPAY',
      shippingAddress: {
        fullName: 'Test Customer',
        phone: '9876543210',
        addressLine1: 'Park Street',
        city: 'Kolkata',
        state: 'West Bengal',
        postalCode: '700016',
        country: 'India'
      }
    });

    const payment3 = await Payment.create({
      orderId: order3._id,
      userId,
      amount: 3000,
      currency: 'INR',
      status: 'CAPTURED',
      provider: 'RAZORPAY',
      refundedAmount: 0,
      pendingRefundAmount: 0,
      razorpayPaymentId: `pay_mock_${Date.now()}_3`
    });

    await PaymentAttempt.create({
      orderId: order3._id,
      paymentId: payment3._id,
      amount: 3000,
      currency: 'INR',
      status: 'CAPTURED',
      razorpayOrderId: `order_mock_${Date.now()}_3`,
      razorpayPaymentId: payment3.razorpayPaymentId
    });

    const returnReq3 = await ReturnRequest.create({
      orderId: order3._id,
      userId,
      items: [{ productId: product._id, variantId, quantity: 1, reason: 'DAMAGED' }],
      status: 'INSPECTING'
    });

    // Simulate Definitive Rejection: 400 Bad Request
    razorpayProvider.createRefund = async () => {
      throw {
        statusCode: 400,
        error: {
          code: 'BAD_REQUEST_ERROR',
          description: 'Payment gateway rejected: Card expired or invalid refund'
        }
      };
    };

    let definitiveErrorThrown = false;
    try {
      await createInternalRefund({
        orderId: order3._id.toString(),
        returnId: returnReq3._id.toString(),
        amount: 1000,
        reason: 'Test Definitive Rejection',
        actorId: adminId.toString(),
        actorRole: 'ADMIN'
      });
    } catch (err: any) {
      if (err.errorCode === 'REFUND_REJECTED' || err.statusCode === 400) {
        definitiveErrorThrown = true;
      }
    }
    check(definitiveErrorThrown, '3.1 Definitive gateway rejection throws REFUND_REJECTED (400)');

    // Verify attempt 1 is marked FAILED and reservation released
    const failedRefund = await Refund.findOne({ returnId: returnReq3._id, attemptNumber: 1 });
    check(failedRefund?.status === 'FAILED', '3.2 Attempt 1 document marked FAILED with gateway reason');

    let freshPayment3: any = await Payment.findById(payment3._id);
    check(freshPayment3.pendingRefundAmount === 0, '3.3 Pending reservation released back to 0 on definitive failure');

    const freshReturnReq3 = await ReturnRequest.findById(returnReq3._id);
    check(freshReturnReq3?.refundStatus === 'FAILED', '3.4 ReturnRequest updated to refundStatus: FAILED');

    // Now restore gateway and retry: Safe Retry as Attempt 2
    razorpayProvider.createRefund = originalCreateRefund;

    const retryRefund = await createInternalRefund({
      orderId: order3._id.toString(),
      returnId: returnReq3._id.toString(),
      amount: 1000,
      reason: 'Retry after fixing gateway details',
      actorId: adminId.toString(),
      actorRole: 'ADMIN'
    });

    check(retryRefund.status === 'PROCESSED' && retryRefund.attemptNumber === 2, '3.5 Retry succeeds with attemptNumber: 2');

    // Verify attempt 1 history is preserved!
    const attempt1Preserved = await Refund.findOne({ returnId: returnReq3._id, attemptNumber: 1 });
    const attempt2Loaded = await Refund.findOne({ returnId: returnReq3._id, attemptNumber: 2 });
    check(
      attempt1Preserved?.status === 'FAILED' && attempt2Loaded?.status === 'PROCESSED',
      '3.6 Full audit history preserved: Attempt 1 is FAILED, Attempt 2 is PROCESSED'
    );

    // -------------------------------------------------------------------------
    // SECTION 4: WEBHOOK IDEMPOTENCY & RECOVERY
    // -------------------------------------------------------------------------
    console.log('\n--- Section 4: Webhook Recovery & Idempotency ---');

    // Simulate refund.processed webhook redelivery on attempt 2
    await handleRefundProcessedEntity({
      id: retryRefund.razorpayRefundId || 'rfnd_mock_test',
      payment_id: payment3.razorpayPaymentId,
      notes: { internal_refund_id: retryRefund._id.toString() }
    });

    freshPayment3 = await Payment.findById(payment3._id);
    check(freshPayment3.refundedAmount === 1000, '4.1 Webhook redelivery on already processed refund does not duplicate refunded amount (remains 1000)');

    // Simulate refund.failed webhook on an in-flight refund
    const pendingRefundForWebhook = await Refund.create({
      orderId: order3._id,
      paymentId: payment3._id,
      userId,
      amount: 500,
      currency: 'INR',
      status: 'PENDING',
      reason: 'Pending webhook test',
      initiatedBy: adminId,
      initiatedByRole: 'ADMIN'
    });

    // Reserve 500 with matching reservation entry
    await Payment.updateOne(
      { _id: payment3._id },
      {
        $inc: { pendingRefundAmount: 500 },
        $push: {
          refundReservations: {
            reservationId: pendingRefundForWebhook._id.toString(),
            refundId: pendingRefundForWebhook._id,
            attemptNumber: 1,
            amount: 500,
            status: 'PENDING'
          }
        }
      }
    );
    await handleRefundFailedEntity({
      id: 'rfnd_failed_hook_1',
      payment_id: payment3.razorpayPaymentId,
      amount: 50000,
      currency: 'INR',
      notes: { internal_refund_id: pendingRefundForWebhook._id.toString() },
      error_description: 'Issuer declined refund'
    });

    const failedByWebhook = await Refund.findById(pendingRefundForWebhook._id);
    check(failedByWebhook?.status === 'FAILED', '4.2 handleRefundFailedEntity transitioned refund to FAILED');

    freshPayment3 = await Payment.findById(payment3._id);
    check(freshPayment3.pendingRefundAmount === 0, '4.3 handleRefundFailedEntity safely released reserved amount');

    // Redeliver failed webhook to verify idempotency
    await handleRefundFailedEntity({
      id: 'rfnd_failed_hook_1',
      payment_id: payment3.razorpayPaymentId,
      amount: 50000,
      currency: 'INR',
      notes: { internal_refund_id: pendingRefundForWebhook._id.toString() }
    });
    freshPayment3 = await Payment.findById(payment3._id);
    check(freshPayment3.pendingRefundAmount === 0, '4.4 Duplicate refund.failed delivery is safe no-op (no negative pending balance)');

    // 4.5 Delayed refund.failed arriving after refund is already PROCESSED
    const processedRefundRecord = await Refund.findById(retryRefund._id);
    check(processedRefundRecord?.status === 'PROCESSED', '4.5 Precondition: refund is PROCESSED');

    const paymentBeforeLateFailed = await Payment.findById(payment3._id);
    const refundedBefore = paymentBeforeLateFailed?.refundedAmount;
    const pendingBefore = paymentBeforeLateFailed?.pendingRefundAmount;

    // Send late refund.failed event for the already PROCESSED refund
    await handleRefundFailedEntity({
      id: retryRefund.razorpayRefundId || 'rfnd_mock_test',
      payment_id: payment3.razorpayPaymentId,
      amount: 100000,
      currency: 'INR',
      notes: { internal_refund_id: retryRefund._id.toString() },
      error_description: 'Late delayed failure event'
    });

    const refundAfterLateFailed = await Refund.findById(retryRefund._id);
    check(refundAfterLateFailed?.status === 'PROCESSED', '4.6 Late refund.failed does NOT downgrade PROCESSED refund to FAILED');

    const paymentAfterLateFailed = await Payment.findById(payment3._id);
    check(paymentAfterLateFailed?.refundedAmount === refundedBefore, '4.7 Late refund.failed does not alter refundedAmount');
    check(paymentAfterLateFailed?.pendingRefundAmount === pendingBefore, '4.8 Late refund.failed does not alter pendingRefundAmount');
    // 4.9 Payment Accounting Invariants Check
    const allPayments = await Payment.find({});
    let allInvariantsHold = true;
    for (const p of allPayments) {
      const captured = p.amount;
      const refunded = p.refundedAmount || 0;
      const pending = p.pendingRefundAmount || 0;
      if (refunded > captured) allInvariantsHold = false;
      if (pending < 0) allInvariantsHold = false;
      if (refunded + pending > captured) allInvariantsHold = false;
    }
    check(allInvariantsHold, '4.9 Payment accounting invariants hold across all payments: refunded <= captured, pending >= 0, refunded + pending <= captured');

    // -------------------------------------------------------------------------
    // SECTION 5: RETURN CONTROLLER WORKFLOW INTEGRATION
    // -------------------------------------------------------------------------
    console.log('\n--- Section 5: Return Acceptance Workflow Integration ---');

    const order5 = await Order.create({
      orderNumber: `ORD-ACC-${Date.now()}-5`,
      userId,
      items: [
        {
          productId: product._id,
          variantId,
          productName: 'Integrity Kurta',
          productImage: 'https://example.com/kurta.jpg',
          selectedSize: 'M',
          selectedColor: 'NAVY',
          quantity: 1,
          unitPrice: 1000,
          lineTotal: 1000
        }
      ],
      subtotal: 1000,
      shipping: 0,
      total: 1000,
      currency: 'INR',
      status: 'DELIVERED',
      paymentStatus: 'PAID',
      paymentMethod: 'RAZORPAY',
      shippingAddress: {
        fullName: 'Test Customer',
        phone: '9876543210',
        addressLine1: 'Park Street',
        city: 'Kolkata',
        state: 'West Bengal',
        postalCode: '700016',
        country: 'India'
      }
    });

    const payment5 = await Payment.create({
      orderId: order5._id,
      userId,
      amount: 1000,
      currency: 'INR',
      status: 'CAPTURED',
      provider: 'RAZORPAY',
      refundedAmount: 0,
      pendingRefundAmount: 0,
      razorpayPaymentId: `pay_mock_${Date.now()}_5`
    });

    await PaymentAttempt.create({
      orderId: order5._id,
      paymentId: payment5._id,
      amount: 1000,
      currency: 'INR',
      status: 'CAPTURED',
      razorpayOrderId: `order_mock_${Date.now()}_5`,
      razorpayPaymentId: payment5.razorpayPaymentId
    });

    const returnReqToAccept = await ReturnRequest.create({
      orderId: order5._id,
      userId,
      items: [{ productId: product._id, variantId, quantity: 1, reason: 'WRONG_SIZE' }],
      status: 'INSPECTING'
    });

    // Accept Return via controller endpoint handler logic
    let mockResData: any = null;
    let mockStatusCode = 200;
    const mockReq: any = {
      params: { id: returnReqToAccept._id.toString() },
      user: { id: adminId.toString(), role: 'ADMIN' },
      body: { adminNote: 'Inspection passed: garment in pristine original packaging' }
    };
    const mockRes: any = {
      status(code: number) {
        mockStatusCode = code;
        return this;
      },
      json(payload: any) {
        mockResData = payload;
        return this;
      }
    };

    const mockNext = (err?: any) => {
      if (err) throw err;
    };

    await acceptReturn(mockReq, mockRes, mockNext);
    check(mockStatusCode === 200 && mockResData?.success, '5.1 acceptReturn executed successfully with 200 OK');

    const acceptedReturnInDb = await ReturnRequest.findById(returnReqToAccept._id);
    check(acceptedReturnInDb?.status === 'COMPLETED' || acceptedReturnInDb?.status === 'ACCEPTED', '5.2 ReturnRequest status transitioned to terminal COMPLETED or ACCEPTED');
    check(acceptedReturnInDb?.inventoryRestored === true, '5.3 ReturnRequest inventoryRestored is true');
    check(acceptedReturnInDb?.refundStatus === 'PROCESSED', '5.4 ReturnRequest refundStatus is PROCESSED');

    // Try accepting again -> must be rejected cleanly
    let duplicateAcceptBlocked = false;
    try {
      await acceptReturn(mockReq, mockRes, mockNext);
    } catch (err: any) {
      duplicateAcceptBlocked = true;
    }
    check(duplicateAcceptBlocked, '5.5 Re-accepting already accepted and refunded return is blocked with 400');

    // 5.6 Return acceptance physical status remains ACCEPTED when refund encounters downstream failure (never regresses to INSPECTING)
    const order6 = await Order.create({
      orderNumber: `ORD-ACC-${Date.now()}-6`,
      userId,
      items: [
        {
          productId: product._id,
          variantId,
          productName: 'Integrity Kurta',
          productImage: 'https://example.com/kurta.jpg',
          selectedSize: 'M',
          selectedColor: 'NAVY',
          quantity: 1,
          unitPrice: 1000,
          lineTotal: 1000
        }
      ],
      subtotal: 1000,
      shipping: 0,
      total: 1000,
      currency: 'INR',
      status: 'DELIVERED',
      paymentStatus: 'PAID',
      paymentMethod: 'RAZORPAY',
      shippingAddress: {
        fullName: 'Test Customer',
        phone: '9876543210',
        addressLine1: 'Park Street',
        city: 'Kolkata',
        state: 'West Bengal',
        postalCode: '700016',
        country: 'India'
      }
    });

    const payment6 = await Payment.create({
      orderId: order6._id,
      userId,
      amount: 1000,
      currency: 'INR',
      status: 'CAPTURED',
      provider: 'RAZORPAY',
      refundedAmount: 0,
      pendingRefundAmount: 0,
      razorpayPaymentId: `pay_mock_${Date.now()}_6`
    });

    await PaymentAttempt.create({
      orderId: order6._id,
      paymentId: payment6._id,
      amount: 1000,
      currency: 'INR',
      status: 'CAPTURED',
      razorpayOrderId: `order_mock_${Date.now()}_6`,
      razorpayPaymentId: payment6.razorpayPaymentId
    });

    const returnReqFailedRefund = await ReturnRequest.create({
      orderId: order6._id,
      userId,
      items: [{ productId: product._id, variantId, quantity: 1, reason: 'WRONG_SIZE' }],
      status: 'INSPECTING'
    });

    razorpayProvider.createRefund = async () => {
      throw { statusCode: 400, error: { code: 'BAD_REQUEST_ERROR', description: 'Simulated failure during accept' } };
    };

    let acceptRefundFailedThrown = false;
    const mockReqFailed: any = {
      params: { id: returnReqFailedRefund._id.toString() },
      user: { id: adminId.toString(), role: 'ADMIN' },
      body: { adminNote: 'Garment in pristine packaging; downstream payment error simulation' }
    };
    try {
      await acceptReturn(mockReqFailed, mockRes, mockNext);
    } catch (e: any) {
      acceptRefundFailedThrown = true;
    }
    check(acceptRefundFailedThrown, '5.6 Downstream refund failure throws error during acceptance');

    const returnReqAfterFailedAccept = await ReturnRequest.findById(returnReqFailedRefund._id);
    check(returnReqAfterFailedAccept?.status === 'ACCEPTED', '5.7 Physical return status remains ACCEPTED (NEVER regresses to INSPECTING)');
    check(returnReqAfterFailedAccept?.refundStatus === 'FAILED', '5.8 ReturnRequest refundStatus is FAILED');

    // Restore original createRefund
    razorpayProvider.createRefund = originalCreateRefund;

    // -------------------------------------------------------------------------
    // SECTION 6: ADDITIONAL WEBHOOK TRANSITIONS & INBOX LEASE RECOVERY
    // -------------------------------------------------------------------------
    console.log('\n--- Section 6: Additional Webhook Transitions & Inbox Lease Recovery ---');

    // 6.1 refund.processed arriving after a previously recorded FAILED event
    const failedRefundToProcess = await Refund.create({
      orderId: order3._id,
      paymentId: payment3._id,
      userId,
      amount: 400,
      currency: 'INR',
      status: 'FAILED',
      reason: 'Previously failed attempt',
      razorpayPaymentId: payment3.razorpayPaymentId,
      initiatedBy: adminId,
      initiatedByRole: 'ADMIN'
    });

    const paymentBeforeRevival = await Payment.findById(payment3._id);
    const refundedBeforeRevival = paymentBeforeRevival?.refundedAmount || 0;

    await handleRefundProcessedEntity({
      id: 'rfnd_late_success_1',
      payment_id: payment3.razorpayPaymentId,
      amount: 40000,
      currency: 'INR',
      notes: { internal_refund_id: failedRefundToProcess._id.toString() }
    });

    const revivedRefund = await Refund.findById(failedRefundToProcess._id);
    check(revivedRefund?.status === 'PROCESSED', '6.1 refund.processed successfully advanced previously FAILED refund to PROCESSED');
    const paymentAfterRevival = await Payment.findById(payment3._id);
    check(paymentAfterRevival?.refundedAmount === refundedBeforeRevival + 400, '6.2 payment refundedAmount correctly credited after late processed webhook');

    // 6.3 Delayed webhook from previous attempt does NOT overwrite ReturnRequest for a newer attempt
    const retMultiAttempt = await ReturnRequest.create({
      orderId: order3._id,
      userId,
      items: [{ productId: product._id, variantId, quantity: 1, reason: 'WRONG_SIZE' }],
      status: 'ACCEPTED',
      refundAttempt: 2,
      refundStatus: 'PROCESSING'
    });

    // Attempt 1 (older attempt)
    const oldAttempt1 = await Refund.create({
      orderId: order3._id,
      paymentId: payment3._id,
      userId,
      returnId: retMultiAttempt._id,
      attemptNumber: 1,
      amount: 300,
      currency: 'INR',
      status: 'FAILED',
      razorpayPaymentId: payment3.razorpayPaymentId,
      initiatedBy: adminId,
      initiatedByRole: 'ADMIN'
    });

    // Attempt 2 (current active attempt)
    const currentAttempt2 = await Refund.create({
      orderId: order3._id,
      paymentId: payment3._id,
      userId,
      returnId: retMultiAttempt._id,
      attemptNumber: 2,
      amount: 300,
      currency: 'INR',
      status: 'PROCESSING',
      razorpayPaymentId: payment3.razorpayPaymentId,
      initiatedBy: adminId,
      initiatedByRole: 'ADMIN'
    });
    retMultiAttempt.refundId = currentAttempt2._id as any;
    await retMultiAttempt.save();

    // Delayed failure event arrives for older Attempt 1
    await handleRefundFailedEntity({
      id: 'rfnd_delayed_att1',
      payment_id: payment3.razorpayPaymentId,
      amount: 30000,
      currency: 'INR',
      notes: { internal_refund_id: oldAttempt1._id.toString() },
      error_description: 'Old attempt 1 failure'
    });

    const refreshedRetMulti = await ReturnRequest.findById(retMultiAttempt._id);
    check(refreshedRetMulti?.refundStatus === 'PROCESSING', '6.3 Delayed webhook for older Attempt 1 did NOT overwrite active Attempt 2 status on ReturnRequest');
    check(refreshedRetMulti?.refundId?.toString() === currentAttempt2._id.toString(), '6.4 ReturnRequest still correctly points to Attempt 2');

    // 6.5 Webhook with mismatched payment ID is rejected
    const mismatchedRefund = await Refund.create({
      orderId: order3._id,
      paymentId: payment3._id,
      userId,
      amount: 200,
      currency: 'INR',
      status: 'PENDING',
      razorpayPaymentId: 'pay_expected_123',
      initiatedBy: adminId,
      initiatedByRole: 'ADMIN'
    });
    await Payment.updateOne({ _id: payment3._id }, { $inc: { pendingRefundAmount: 200 } });

    await handleRefundProcessedEntity({
      id: 'rfnd_mismatched_pay',
      payment_id: 'pay_spoofed_999',
      amount: 20000,
      currency: 'INR',
      notes: { internal_refund_id: mismatchedRefund._id.toString() }
    });

    const unmolestedRefund = await Refund.findById(mismatchedRefund._id);
    check(unmolestedRefund?.status === 'PENDING', '6.5 Webhook with mismatched payment ID rejected without altering refund status');

    // 6.6 Unknown internal refund reference handled safely without throwing
    let unknownRefError = false;
    try {
      await handleRefundProcessedEntity({
        id: 'rfnd_unknown_999',
        payment_id: payment3.razorpayPaymentId,
        amount: 10000,
        currency: 'INR',
        notes: { internal_refund_id: new mongoose.Types.ObjectId().toString() }
      });
    } catch {
      unknownRefError = true;
    }
    check(!unknownRefError, '6.6 Unknown internal refund reference handled safely without error');

    // 6.7 Webhook Inbox Crash Recovery: Stale lease reclamation
    const staleEventId = `evt_stale_${Date.now()}`;
    await WebhookEvent.create({
      eventId: staleEventId,
      provider: 'RAZORPAY',
      eventType: 'refund.processed',
      status: 'PROCESSING',
      processingLockExpiresAt: new Date(Date.now() - 5000),
      processingAttempts: 1
    });

    const staleRecovery = await recoverStaleWebhookEvents(1000);
    check(staleRecovery.recoveredCount >= 1, '6.7 recoverStaleWebhookEvents transitioned expired PROCESSING event to FAILED');
    const recoveredEvt = await WebhookEvent.findOne({ eventId: staleEventId });
    check(recoveredEvt?.status === 'FAILED', '6.8 Stale event document marked FAILED with lease expiry note');

    // 6.9 Direct endpoint invocation of razorpayWebhook with duplicate delivery
    const directRefund = await Refund.create({
      orderId: order3._id,
      paymentId: payment3._id,
      userId,
      amount: 100,
      currency: 'INR',
      status: 'PROCESSING',
      submissionState: 'CONFIRMED',
      initiatedBy: adminId,
      initiatedByRole: 'ADMIN'
    });
    await Payment.updateOne(
      { _id: payment3._id },
      {
        $inc: { pendingRefundAmount: 100 },
        $push: {
          refundReservations: {
            reservationId: directRefund._id.toString(),
            refundId: directRefund._id,
            attemptNumber: 1,
            amount: 100,
            status: 'PENDING',
            createdAt: new Date(),
            updatedAt: new Date()
          }
        }
      }
    );
    const directEventId = `evt_direct_${Date.now()}`;
    const directPayload = JSON.stringify({
      event: 'refund.processed',
      event_id: directEventId,
      payload: {
        refund: {
          entity: {
            id: 'rfnd_direct_1',
            payment_id: payment3.razorpayPaymentId,
            amount: 10000,
            currency: 'INR',
            notes: { internal_refund_id: directRefund._id.toString() }
          }
        }
      }
    });
    const origVerify = razorpayProvider.verifyWebhookSignature;
    razorpayProvider.verifyWebhookSignature = () => true;

    let resCode = 0;
    let resBody = '';
    const mockWebhookReq: any = {
      headers: { 'x-razorpay-signature': 'sig_test_123', 'x-razorpay-event-id': directEventId },
      body: Buffer.from(directPayload, 'utf8')
    };
    const mockWebhookRes: any = {
      status(c: number) { resCode = c; return this; },
      send(b: string) { resBody = b; return this; }
    };

    await razorpayWebhook(mockWebhookReq, mockWebhookRes);
    check(resCode === 200 && resBody === 'OK', '6.9 razorpayWebhook successfully processed first delivery with 200 OK');

    await razorpayWebhook(mockWebhookReq, mockWebhookRes);
    check(resCode === 200 && resBody.includes('already processed'), '6.10 Duplicate webhook delivery recognized and returned 200 OK without re-execution');

    razorpayProvider.verifyWebhookSignature = origVerify;

    // -------------------------------------------------------------------------
    // SECTION 7: INCOMPLETE REFUND OPERATION RECOVERY & RECONCILIATION
    // -------------------------------------------------------------------------
    console.log('\n--- Section 7: Incomplete Refund Operation Recovery & Reconciliation ---');

    const order7 = await Order.create({
      orderNumber: `ORD-REC-${Date.now()}-7`,
      userId,
      items: [{ productId: product._id, variantId, productName: 'Integrity Kurta', productImage: 'https://example.com/kurta.jpg', selectedSize: 'M', selectedColor: 'NAVY', quantity: 1, unitPrice: 1000, lineTotal: 1000 }],
      subtotal: 1000, total: 1000, currency: 'INR', status: 'DELIVERED', paymentStatus: 'PAID', paymentMethod: 'RAZORPAY',
      shippingAddress: { fullName: 'Customer', phone: '9876543210', addressLine1: 'Street', city: 'City', state: 'State', postalCode: '700016', country: 'India' }
    });
    const payment7 = await Payment.create({
      orderId: order7._id,
      userId,
      amount: 1000,
      currency: 'INR',
      status: 'CAPTURED',
      provider: 'RAZORPAY',
      refundedAmount: 0,
      pendingRefundAmount: 0,
      razorpayPaymentId: 'pay_unlisted_test_7'
    });

    // 7.1 Boundary 1: Crash after ReturnRequest claim before Payment reservation / Refund creation
    const orphanClaimReturn = await ReturnRequest.create({
      orderId: order7._id,
      userId,
      items: [{ productId: product._id, variantId, quantity: 1, reason: 'WRONG_SIZE' }],
      status: 'ACCEPTED',
      refundStatus: 'PROCESSING',
      refundAttempt: 1
    });
    await Payment.updateOne({ _id: payment7._id }, { $set: { pendingRefundAmount: 200 } });

    const incompleteRecovResult = await reconcileIncompleteRefundOperations();
    check(incompleteRecovResult.recoveredCount >= 1, '7.1 reconcileIncompleteRefundOperations recovered orphan ReturnRequest');
    const recoveredOrphanReturn = await ReturnRequest.findById(orphanClaimReturn._id);
    check(recoveredOrphanReturn?.refundStatus === 'FAILED', '7.2 Orphan ReturnRequest reset to refundStatus: FAILED for safe retry');
    const payment7Preserved = await Payment.findById(payment7._id);
    check(payment7Preserved?.pendingRefundAmount === 200, '7.3 Orphan ReturnRequest cannot zero pending hold (preserved ₹200)');
    check(payment7Preserved?.reconciliationRequired === true, '7.3b Payment marked reconciliationRequired: true');
    // 7.4 Boundary 2: Absent list result retains UNKNOWN status and does NOT release reservation
    const unlistedRefund = await Refund.create({
      orderId: order7._id,
      paymentId: payment7._id,
      userId,
      amount: 150,
      currency: 'INR',
      status: 'UNKNOWN',
      razorpayPaymentId: 'pay_unlisted_test_7',
      initiatedBy: adminId,
      initiatedByRole: 'ADMIN'
    });
    await Payment.updateOne({ _id: payment7._id }, { $set: { pendingRefundAmount: 150 } });

    const originalGetClient = razorpayProvider.getClient;
    (razorpayProvider as any).getClient = () => ({
      payments: {
        refunds: async () => ({ items: [] })
      },
      refunds: {
        fetch: async () => { throw new Error('Not found'); }
      }
    });

    const reconciledUnlisted = await reconcileUnknownRefund(unlistedRefund._id.toString());
    check(reconciledUnlisted.status === 'UNKNOWN', '7.4 Absent result in refund list retains status: UNKNOWN (does NOT assume failure)');
    const paymentAfterUnlisted = await Payment.findById(payment7._id);
    check(paymentAfterUnlisted?.pendingRefundAmount === 150, '7.5 Reservation remains strictly HELD when provider refund list is inconclusive');

    (razorpayProvider as any).getClient = originalGetClient;

    // -------------------------------------------------------------------------
    // SECTION 8: TRANSPORT-LEVEL RAZORPAY REQUEST CONSTRUCTION & AUTH TEST
    // -------------------------------------------------------------------------
    console.log('\n--- Section 8: Transport-Level Razorpay Request Construction Test ---');

    let capturedPostUrl = '';
    let capturedPostData: any = null;
    let capturedPostConfig: any = null;

    const rzpClientInstance = razorpayProvider.getClient() as any;
    const originalRqPost = rzpClientInstance.api.rq.post;

    rzpClientInstance.api.rq.post = async (url: string, data: any, config: any) => {
      capturedPostUrl = url;
      capturedPostData = data;
      capturedPostConfig = config;
      return {
        data: {
          id: `rfnd_wire_${Date.now()}`,
          entity: 'refund',
          amount: data.amount,
          status: 'processed'
        }
      };
    };

    const orderWire = await Order.create({
      orderNumber: `ORD-WIRE-${Date.now()}`,
      userId,
      items: [{ productId: product._id, variantId, productName: 'Wire Kurta', productImage: 'https://example.com/wire.jpg', selectedSize: 'M', selectedColor: 'NAVY', quantity: 1, unitPrice: 1200, lineTotal: 1200 }],
      subtotal: 1200,
      total: 1200,
      currency: 'INR',
      status: 'DELIVERED',
      paymentStatus: 'PAID',
      paymentMethod: 'RAZORPAY',
      shippingAddress: { fullName: 'Wire Customer', phone: '9876543210', addressLine1: 'Park Street', city: 'Kolkata', state: 'WB', postalCode: '700016', country: 'India' }
    });

    const paymentWire = await Payment.create({
      orderId: orderWire._id,
      userId,
      amount: 1200,
      currency: 'INR',
      status: 'CAPTURED',
      provider: 'RAZORPAY',
      refundedAmount: 0,
      pendingRefundAmount: 0,
      razorpayPaymentId: 'pay_wire_test_123'
    });

    await PaymentAttempt.create({
      orderId: orderWire._id,
      paymentId: paymentWire._id,
      amount: 1200,
      currency: 'INR',
      status: 'CAPTURED',
      razorpayOrderId: 'order_wire_test_123',
      razorpayPaymentId: paymentWire.razorpayPaymentId
    });

    const returnReqWire = await ReturnRequest.create({
      orderId: orderWire._id,
      userId,
      items: [{ productId: product._id, variantId, quantity: 1, reason: 'DEFECTIVE' }],
      status: 'INSPECTING'
    });

    const wireRefund = await createInternalRefund({
      orderId: orderWire._id.toString(),
      returnId: returnReqWire._id.toString(),
      amount: 1200,
      reason: 'Wire transport test',
      actorId: adminId.toString(),
      actorRole: 'ADMIN'
    });

    check(capturedPostUrl === '/v1/payments/pay_wire_test_123/refund', '8.1 Correct Razorpay endpoint targeted (/v1/payments/:id/refund)');
    check(capturedPostData.amount === 120000, '8.2 Correct amount in paise transmitted (1200 -> 120000)');
    check(capturedPostConfig?.headers?.['X-Refund-Idempotency'] === wireRefund.idempotencyKey, '8.3 X-Refund-Idempotency header transmitted with persisted idempotency key');
    check(rzpClientInstance.api.rq.defaults.auth?.username !== undefined, '8.4 Existing SDK basic authentication credentials preserved on transport');

    rzpClientInstance.api.rq.post = originalRqPost;

    // -------------------------------------------------------------------------
    // SECTION 9: DISTRIBUTED RECOVERY SCHEDULER & MULTI-INSTANCE LOCKING
    // -------------------------------------------------------------------------
    console.log('\n--- Section 9: Distributed Recovery Scheduler & Multi-Instance Locking ---');

    const workerInstance1 = 'worker_node_instance_alpha';
    const workerInstance2 = 'worker_node_instance_beta';
    const testLockName = `LOCK_TEST_${Date.now()}`;

    // 9.1 Instance 1 acquires distributed lease
    const lease1 = await RecoveryCoordinatorService.acquireWorkerLease(testLockName, workerInstance1, 5000);
    check(lease1.acquired === true, '9.1 Worker Instance 1 successfully acquired distributed lease');
    check(typeof lease1.fencingToken === 'number' && lease1.fencingToken > 0, '9.2 Distributed lease assigned valid fencing token');

    // 9.2 Instance 2 tries to acquire same lock while Instance 1's lease is active -> blocked!
    const lease2 = await RecoveryCoordinatorService.acquireWorkerLease(testLockName, workerInstance2, 5000);
    check(lease2.acquired === false, '9.3 Worker Instance 2 blocked from acquiring active lease held by Instance 1');

    // 9.3 Instance 1 renews its active lease
    const renewed1 = await RecoveryCoordinatorService.renewWorkerLease(testLockName, workerInstance1, lease1.fencingToken!, 5000);
    check(renewed1 === true, '9.4 Worker Instance 1 successfully renewed active lease with matching fencing token');

    // 9.4 Expire lease artificially to simulate worker crash
    await WorkerLock.updateOne(
      { lockName: testLockName },
      { $set: { leaseExpiresAt: new Date(Date.now() - 1000) } }
    );

    // 9.5 Instance 2 re-attempts acquisition after lease expiry -> takes over!
    const lease2AfterExpiry = await RecoveryCoordinatorService.acquireWorkerLease(testLockName, workerInstance2, 5000);
    check(lease2AfterExpiry.acquired === true, '9.5 Worker Instance 2 took over expired lease after Instance 1 crash');
    check(lease2AfterExpiry.fencingToken! > lease1.fencingToken!, '9.6 Fencing token incremented monotonically on lease takeover');

    // 9.7 Stale Worker Instance 1 cannot renew using its old fencing token
    const staleRenew = await RecoveryCoordinatorService.renewWorkerLease(testLockName, workerInstance1, lease1.fencingToken!, 5000);
    check(staleRenew === false, '9.7 Stale Worker Instance 1 rejected when attempting renewal with outdated fencing token');

    // 9.8 Instance 2 releases lease cleanly
    const released2 = await RecoveryCoordinatorService.releaseWorkerLease(testLockName, workerInstance2, lease2AfterExpiry.fencingToken);
    check(released2 === true, '9.8 Worker Instance 2 released distributed lease cleanly');

    // 9.9 End-to-end coordinated recovery cycle under leader lock
    const coordinatedCycleReport = await RecoveryCoordinatorService.executeCoordinatedRecoveryCycle({
      batchLimit: 10
    });
    check(coordinatedCycleReport.executed === true, '9.9 Coordinated recovery cycle executed successfully under leader lock');
    check(coordinatedCycleReport.errors.length === 0, '9.10 Coordinated recovery cycle completed with 0 errors');

    // 9.11 RecoveryStatus singleton verified
    const recoveryStatusDoc = await RecoveryStatus.findOne({ identifier: 'SINGLETON' });
    check(recoveryStatusDoc?.status === 'SUCCESS', '9.11 RecoveryStatus singleton updated to status: SUCCESS');

    // -------------------------------------------------------------------------
    // SECTION 10: WEBHOOK EVENT TTL SAFETY & PER-ATTEMPT RESERVATION RECOVERY
    // -------------------------------------------------------------------------
    console.log('\n--- Section 10: Webhook Event TTL Safety & Per-Attempt Reservation Recovery ---');

    // 10.1 Webhook TTL Safety: Unresolved events must NEVER expire
    const unresolvedFailedEvent = await WebhookEvent.create({
      eventId: `evt_ttl_failed_${Date.now()}`,
      provider: 'RAZORPAY',
      eventType: 'refund.failed',
      status: 'FAILED',
      createdAt: new Date(Date.now() - 150 * 24 * 60 * 60 * 1000) // 150 days old (older than 120-day cutoff!)
    });
    check(unresolvedFailedEvent.expiresAt === undefined, '10.1 Unresolved FAILED webhook event does not set expiresAt');

    const unresolvedProcessingEvent = await WebhookEvent.create({
      eventId: `evt_ttl_processing_${Date.now()}`,
      provider: 'RAZORPAY',
      eventType: 'refund.processed',
      status: 'PROCESSING',
      createdAt: new Date(Date.now() - 150 * 24 * 60 * 60 * 1000)
    });
    check(unresolvedProcessingEvent.expiresAt === undefined, '10.2 Unresolved PROCESSING webhook event does not set expiresAt');

    // Run log cleanup with 120-day threshold
    await cleanupExpiredLogs({ retentionDays: 120 });

    // Verify unresolved events SURVIVED cleanup despite being 150 days old!
    const survivingFailed = await WebhookEvent.findById(unresolvedFailedEvent._id);
    const survivingProcessing = await WebhookEvent.findById(unresolvedProcessingEvent._id);
    check(survivingFailed !== null, '10.3 Unresolved FAILED event survived 120-day cleanup threshold without deletion');
    check(survivingProcessing !== null, '10.4 Unresolved PROCESSING event survived 120-day cleanup threshold without deletion');

    // 10.5 Terminal PROCESSED events have expiresAt set in the future
    const terminalProcessedEvent = await WebhookEvent.create({
      eventId: `evt_ttl_processed_${Date.now()}`,
      provider: 'RAZORPAY',
      eventType: 'refund.processed',
      status: 'PROCESSED',
      expiresAt: new Date(Date.now() + 120 * 24 * 60 * 60 * 1000),
      processedAt: new Date()
    });
    check(terminalProcessedEvent.expiresAt !== undefined && terminalProcessedEvent.expiresAt.getTime() > Date.now(), '10.5 Terminal PROCESSED event sets expiresAt in the future');

    // 10.5b Recovered 150-day-old event receives fresh 120-day retention and survives cleanup
    const oldFailedRecoverEvent = await WebhookEvent.create({
      eventId: `evt_ttl_recovered_${Date.now()}`,
      provider: 'RAZORPAY',
      eventType: 'payment.captured',
      status: 'FAILED',
      payload: { payload: { payment: { entity: { id: `pay_rec_${Date.now()}`, order_id: `ord_rec_${Date.now()}` } } } },
      createdAt: new Date(Date.now() - 150 * 24 * 60 * 60 * 1000)
    });
    await RecoveryCoordinatorService.executeWebhookInboxBatch(20);
    const recoveredEvtDoc = await WebhookEvent.findById(oldFailedRecoverEvent._id);
    check(recoveredEvtDoc?.status === 'PROCESSED', '10.5b 150-day-old event transitioned to PROCESSED via recovery');
    check(
      recoveredEvtDoc?.expiresAt !== undefined && recoveredEvtDoc.expiresAt.getTime() > Date.now() + 119 * 24 * 60 * 60 * 1000,
      '10.5c Recovered event expiresAt is ~120 days from recovery time, not createdAt'
    );
    await cleanupExpiredLogs({ retentionDays: 120 });
    const survivingRecoveredEvt = await WebhookEvent.findById(oldFailedRecoverEvent._id);
    check(survivingRecoveredEvt !== null, '10.5d Recovered 150-day-old event strictly preserved after immediate cleanup');

    // 10.6 Per-Attempt Payment Reservation Tracking
    const orderPerAttempt = await Order.create({
      orderNumber: `ORD-PAT-${Date.now()}`,
      userId,
      items: [{ productId: product._id, variantId, productName: 'Integrity Kurta', productImage: 'https://example.com/kurta.jpg', selectedSize: 'M', selectedColor: 'NAVY', quantity: 2, unitPrice: 1000, lineTotal: 2000 }],
      subtotal: 2000, total: 2000, currency: 'INR', status: 'DELIVERED', paymentStatus: 'PAID', paymentMethod: 'RAZORPAY',
      shippingAddress: { fullName: 'Customer', phone: '9876543210', addressLine1: 'Park St', city: 'Kolkata', state: 'WB', postalCode: '700016', country: 'India' }
    });

    const paymentPerAttempt = await Payment.create({
      orderId: orderPerAttempt._id,
      userId,
      amount: 2000,
      currency: 'INR',
      status: 'CAPTURED',
      provider: 'RAZORPAY',
      refundedAmount: 0,
      pendingRefundAmount: 0,
      razorpayPaymentId: `pay_pat_${Date.now()}`
    });

    await PaymentAttempt.create({
      orderId: orderPerAttempt._id,
      paymentId: paymentPerAttempt._id,
      amount: 2000,
      currency: 'INR',
      status: 'CAPTURED',
      razorpayOrderId: `order_pat_${Date.now()}`,
      razorpayPaymentId: paymentPerAttempt.razorpayPaymentId
    });

    const returnReqPerAttempt = await ReturnRequest.create({
      orderId: orderPerAttempt._id,
      userId,
      items: [{ productId: product._id, variantId, quantity: 1, reason: 'DEFECTIVE' }],
      status: 'INSPECTING'
    });

    // Simulate Attempt 1: Fails at gateway
    razorpayProvider.createRefund = async () => {
      throw { statusCode: 400, error: { code: 'BAD_REQUEST_ERROR', description: 'Attempt 1 rejected' } };
    };

    try {
      await createInternalRefund({
        orderId: orderPerAttempt._id.toString(),
        returnId: returnReqPerAttempt._id.toString(),
        amount: 1000,
        reason: 'Attempt 1 test',
        actorId: adminId.toString(),
        actorRole: 'ADMIN'
      });
    } catch {
      // Expected failure
    }

    const paymentAfterAtt1 = await Payment.findById(paymentPerAttempt._id);
    const resAtt1 = paymentAfterAtt1?.refundReservations.find(r => r.attemptNumber === 1);
    check(resAtt1?.status === 'RELEASED', '10.6 Attempt 1 reservation recorded and transitioned to RELEASED upon definitive failure');
    check(paymentAfterAtt1?.pendingRefundAmount === 0, '10.7 pendingRefundAmount released to 0 after Attempt 1 failure');

    // Simulate Attempt 2: Succeeds at gateway
    razorpayProvider.createRefund = async () => ({
      id: `rfnd_pat_att2_${Date.now()}`,
      entity: 'refund',
      amount: 100000,
      status: 'processed'
    });

    const refundAtt2 = await createInternalRefund({
      orderId: orderPerAttempt._id.toString(),
      returnId: returnReqPerAttempt._id.toString(),
      amount: 1000,
      reason: 'Attempt 2 test',
      actorId: adminId.toString(),
      actorRole: 'ADMIN'
    });

    const paymentAfterAtt2 = await Payment.findById(paymentPerAttempt._id);
    const resAtt2 = paymentAfterAtt2?.refundReservations.find(r => r.attemptNumber === 2);
    check(refundAtt2.status === 'PROCESSED', '10.8 Attempt 2 returned status: PROCESSED');
    check(resAtt2?.status === 'CONSUMED', '10.9 Attempt 2 reservation recorded and transitioned to CONSUMED upon success');
    check(paymentAfterAtt2?.refundedAmount === 1000, '10.10 Payment refundedAmount incremented exactly to 1000');
    check(paymentAfterAtt2?.refundReservations.length === 2, '10.11 Payment contains distinct per-attempt reservation records for both attempts');

    // 10.11 Operational Monitoring Visibility
    const metrics = await RecoveryCoordinatorService.getRecoverySystemMetrics();
    check(typeof metrics.pendingInventoryCount === 'number', '10.11 System metrics reports pendingInventoryCount');
    check(typeof metrics.staleWebhookCount === 'number', '10.12 System metrics reports staleWebhookCount');
    check(typeof metrics.failedWebhookCount === 'number', '10.13 System metrics reports failedWebhookCount');
    check(typeof metrics.incompleteRefundsCount === 'number', '10.14 System metrics reports incompleteRefundsCount');
    check(metrics.lastExecution !== undefined && metrics.lastExecution.status === 'SUCCESS', '10.15 System metrics exposes last recovery execution status');

    // 10.16 Admin Controller Monitoring API
    let adminStatusJson: any = null;
    let adminStatusStatusCode = 0;
    const mockAdminRes: any = {
      status(c: number) { adminStatusStatusCode = c; return this; },
      json(p: any) { adminStatusJson = p; return this; }
    };
    await getRecoveryMetrics({} as any, mockAdminRes, (() => {}) as any);
    check(adminStatusStatusCode === 200 && adminStatusJson?.success === true, '10.16 Admin recovery metrics endpoint returned 200 OK with success: true');
    check(adminStatusJson.data?.lastExecution !== undefined, '10.17 Admin metrics endpoint payload contains execution details');

    // 10.18 Admin Controller Trigger Recovery API
    let adminTriggerJson: any = null;
    let adminTriggerStatusCode = 0;
    const mockTriggerRes: any = {
      status(c: number) { adminTriggerStatusCode = c; return this; },
      json(p: any) { adminTriggerJson = p; return this; }
    };
    await triggerRecoveryCycle({} as any, mockTriggerRes, (() => {}) as any);
    check(adminTriggerStatusCode === 200 && adminTriggerJson?.success === true, '10.18 Admin recovery trigger endpoint returned 200 OK with success: true');

    // Restore original createRefund
    razorpayProvider.createRefund = originalCreateRefund;

  } finally {
    // -------------------------------------------------------------------------
    // CLEANUP TEST FIXTURES
    // -------------------------------------------------------------------------
    console.log('\n🧹 Cleaning up test fixtures from database...');
    await Order.deleteMany({ orderNumber: { $regex: /^ORD-(INT|REF|ACC|WIRE|PAT|REC)-/ } });
    await Payment.deleteMany({ userId });
    await PaymentAttempt.deleteMany({ userId });
    await Refund.deleteMany({ userId });
    await ReturnRequest.deleteMany({ userId });
    await InventoryTransaction.deleteMany({ type: { $in: ['SALE', 'RESTOCK', 'REFUND', 'RETURN'] } });
    await Product.deleteMany({ name: { $in: ['Integrity Kurta', 'Crash Integrity Kurta', 'Eviction Proof Kurta', 'Wire Kurta'] } });
    await WebhookEvent.deleteMany({ eventId: { $regex: /^evt_/ } });
    await WorkerLock.deleteMany({});
    await RecoveryStatus.deleteMany({});
    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB\n');
  }

  console.log('══════════════════════════════════════════════════════════════════════');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════════════════════════\n');

  if (failed > 0) {
    console.error('Failed checks:', failures);
    process.exit(1);
  }
}

runSuite().catch(err => {
  console.error('Unhandled test suite error:', err);
  process.exit(1);
});
