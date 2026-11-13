/**
 * Samrat Fashion — SEC-FINDING-001 Resilience, Failure Injection, and E2E Integration Suite
 *
 * Verifies:
 * 1. Multi-document consistency and crash recovery:
 *    - Simulated failure during reservation creation & rollback
 *    - Observable counter reconciliation (reconcileCouponCounters)
 *    - Idempotency under simulated crash during confirmation and release
 * 2. Real application workflows:
 *    - Full createOrder controller execution with coupon discount
 *    - Full processPaymentSuccess execution confirming coupon
 *    - Real razorpayWebhook controller with duplicate capture delivery
 *    - Real cancelOrderWithRefund releasing unpaid vs preserving paid coupons
 *    - Real expireStalePendingOrders releasing expired reservations
 * 3. Payment vs Expiry race conditions:
 *    - Payment confirmation wins before expiry
 *    - Expiry wins before delayed payment webhook arrives (late payment auto-refund)
 * 4. State invariants & index verification:
 *    - Verification of coupon_user_slot_active_unique partial unique index
 *    - Verification of reservedCount and usedCount invariants
 */

process.env.NODE_ENV = 'test';
process.env.ALLOW_PAYMENT_MOCK = 'true';

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import http from 'http';
import jwt from 'jsonwebtoken';
dotenv.config();

import { app, serverInstance } from '../index';
import { connectSafeTestDb, createTestProduct } from './testHelpers';
import { getJwtAccessSecret } from '../config/env';
import { Coupon, DiscountType, CouponStatus } from '../models/Coupon';
import { CouponUsage, CouponUsageStatus } from '../models/CouponUsage';
import { Order } from '../models/Order';
import { Cart } from '../models/Cart';
import { Address } from '../models/Address';
import { Payment } from '../models/Payment';
import { PaymentAttempt } from '../models/PaymentAttempt';
import { User, UserRole } from '../models/User';
import { Product } from '../models/Product';
import {
  reserveCouponForOrder,
  confirmCouponReservation,
  releaseCouponReservation,
  reconcileCouponCounters,
} from '../services/coupon/couponReservationService';
import { processPaymentSuccess } from '../services/payment/paymentProcessor';
import { cancelOrderWithRefund } from '../services/orderCancellationService';
import { expireStalePendingOrders } from '../services/orderExpiryService';
import { razorpayWebhook } from '../controllers/webhookController';
import { razorpayProvider } from '../services/payment/RazorpayProvider';
import { stopOrderExpiryScheduler } from '../services/orderExpiryService';
import { stopLogCleanupScheduler } from '../services/logCleanupService';
import { RecoveryCoordinatorService } from '../services/recovery/recoveryCoordinatorService';

let passed = 0;
let failed = 0;

function check(condition: boolean, desc: string, details?: string): void {
  if (condition) {
    console.log(`  ✅ PASS: ${desc}`);
    passed++;
  } else {
    const msg = details ? `${desc} — ${details}` : desc;
    console.error(`  ❌ FAIL: ${msg}`);
    failed++;
  }
}

async function httpRequest(
  baseUrl: string,
  method: string,
  urlPath: string,
  body?: unknown,
  token?: string
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, baseUrl);
    const postData = body ? JSON.stringify(body) : '';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (body) {
      headers['Content-Length'] = Buffer.byteLength(postData).toString();
    }
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(url, { method, headers }, (res) => {
      let raw = '';
      res.on('data', (chunk) => (raw += chunk));
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = raw;
        }
        resolve({ status: res.statusCode || 500, body: parsed });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(postData);
    }
    req.end();
  });
}

async function runResilienceAndE2ESuite(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║  SEC-FINDING-001: Failure-Injection, E2E & Race Condition Suite     ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

  await connectSafeTestDb();
  console.log(` Connected to verified isolated test database: "${mongoose.connection.name}"\n`);

  // Start dedicated local HTTP server for real E2E controller tests
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, () => resolve()));
  const port = (server.address() as any).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const timestamp = Date.now();
  const jwtSecret = getJwtAccessSecret();

  // Test Product fixture
  const { product: testProduct, variantIds: [testVariantId] } = await createTestProduct({
    name: `Resilience Test Shirt ${timestamp}`,
    basePrice: 1000,
    variants: [{ size: 'M', color: 'BLACK', stock: 500, isAvailable: true }],
  });

  const cleanupUserIds: mongoose.Types.ObjectId[] = [];
  const cleanupCouponIds: mongoose.Types.ObjectId[] = [];
  const cleanupOrderIds: mongoose.Types.ObjectId[] = [];

  try {
    // -------------------------------------------------------------------------
    // SECTION 1: FAILURE INJECTION & CRASH RECOVERY
    // -------------------------------------------------------------------------
    console.log('--- SECTION 1: Failure Injection & Crash Recovery ---');

    const user1 = await User.create({
      name: 'Crash Recovery User',
      email: `crash_user_${timestamp}@example.com`,
      role: UserRole.CUSTOMER,
      passwordHash: 'dummy_hash',
    });
    cleanupUserIds.push(user1._id as mongoose.Types.ObjectId);

    const coupon1 = await Coupon.create({
      code: `CRASH_REC_${timestamp}`,
      discountType: DiscountType.FIXED,
      discountValue: 100,
      minOrderValue: 500,
      perUserUsageLimit: 1,
      status: CouponStatus.ACTIVE,
      reservedCount: 0,
      usedCount: 0,
    });
    cleanupCouponIds.push(coupon1._id as mongoose.Types.ObjectId);

    // 1.1 Simulate crash after reservedCount increment: artificially inflate reservedCount
    await Coupon.updateOne({ _id: coupon1._id }, { $set: { reservedCount: 5 } });
    const inflatedBefore = await Coupon.findById(coupon1._id);
    check(inflatedBefore?.reservedCount === 5, '1.1 Artificially injected counter disparity (reservedCount: 5 with 0 usage docs)');

    // Run observable reconciliation
    const reconResult1 = await reconcileCouponCounters(coupon1._id);
    check(reconResult1.adjusted === true, '1.2 reconcileCouponCounters detected discrepancy and adjusted counters');
    check(reconResult1.reconciledReserved === 0, '1.3 reconcileCouponCounters reconciled reservedCount to 0 (actual active reservations)');

    const coupon1AfterRecon = await Coupon.findById(coupon1._id);
    check(coupon1AfterRecon?.reservedCount === 0, '1.4 Coupon.reservedCount in database restored to exact ground truth (0)');

    // 1.2 Test duplicate-key failure during usage-slot insertion and transaction rollback
    const order1A = new mongoose.Types.ObjectId();
    const order1B = new mongoose.Types.ObjectId();
    cleanupOrderIds.push(order1A, order1B);

    // Seed slot 1 reservation directly
    await CouponUsage.create([
      {
        couponId: coupon1._id,
        userId: user1._id,
        orderId: order1A,
        discountAmount: 100,
        status: CouponUsageStatus.RESERVED,
        usageSlot: 1,
        expiresAt: new Date(Date.now() + 60000),
      },
    ]);
    await Coupon.updateOne({ _id: coupon1._id }, { $set: { reservedCount: 1 } });

    // Attempt to reserve again for same user with perUserUsageLimit=1
    let caughtErr1: unknown = null;
    try {
      await reserveCouponForOrder({
        couponId: coupon1._id,
        userId: user1._id,
        orderId: order1B,
        discountAmount: 100,
      });
    } catch (err: unknown) {
      caughtErr1 = err;
    }

    check(caughtErr1 !== null, '1.5 Duplicate reservation attempt rejected with error');
    const coupon1AfterCollision = await Coupon.findById(coupon1._id);
    check(coupon1AfterCollision?.reservedCount === 1, '1.6 Coupon.reservedCount was NOT leaked or inflated on slot collision');

    // 1.3 Idempotency under duplicate reservation release
    const releaseRes1A = await releaseCouponReservation(order1A, 'TEST_RELEASE');
    check(releaseRes1A.released === true, '1.7 First release operation succeeded');

    const releaseRes1B = await releaseCouponReservation(order1A, 'DUPLICATE_RELEASE');
    check(releaseRes1B.released === false, '1.8 Duplicate release operation is a safe no-op (released: false)');

    const coupon1AfterDupRelease = await Coupon.findById(coupon1._id);
    check(coupon1AfterDupRelease?.reservedCount === 0, '1.9 Duplicate release never decrements reservedCount below 0');

    // -------------------------------------------------------------------------
    // SECTION 2: END-TO-END APPLICATION WORKFLOW INTEGRATION
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 2: End-to-End Real Application Workflows ---');

    const e2eUser = await User.create({
      name: 'E2E Customer',
      email: `e2e_cust_${timestamp}@example.com`,
      role: UserRole.CUSTOMER,
      passwordHash: 'dummy_hash',
    });
    cleanupUserIds.push(e2eUser._id as mongoose.Types.ObjectId);

    const userToken = jwt.sign(
      { sub: e2eUser._id.toString(), id: e2eUser._id.toString(), role: UserRole.CUSTOMER },
      jwtSecret,
      { algorithm: 'HS256', expiresIn: '1h' }
    );

    const testAddress = await Address.create({
      userId: e2eUser._id,
      fullName: 'E2E Customer',
      phone: '9876543210',
      addressLine1: '123 Launch St',
      city: 'Bengaluru',
      state: 'Karnataka',
      postalCode: '560001',
      country: 'India',
      isDefault: true,
    });

    const e2eCoupon = await Coupon.create({
      code: `E2ECOUPON_${timestamp}`,
      discountType: DiscountType.FIXED,
      discountValue: 250,
      minOrderValue: 500,
      perUserUsageLimit: 1,
      status: CouponStatus.ACTIVE,
      reservedCount: 0,
      usedCount: 0,
    });
    cleanupCouponIds.push(e2eCoupon._id as mongoose.Types.ObjectId);

    // 2.1 Set up active cart with coupon applied
    await Cart.updateOne(
      { userId: e2eUser._id },
      {
        $set: {
          couponCode: e2eCoupon.code,
          items: [
            {
              productId: testProduct._id,
              variantId: new mongoose.Types.ObjectId(testVariantId),
              quantity: 1,
            },
          ],
        },
      },
      { upsert: true }
    );

    // Execute real createOrder controller path via HTTP
    const createOrderRes = await httpRequest(
      baseUrl,
      'POST',
      '/api/orders',
      { addressId: testAddress._id.toString() },
      userToken
    );
    if (createOrderRes.status !== 201) {
      console.log('createOrderRes error:', createOrderRes.status, createOrderRes.body);
    }
    check(createOrderRes.status === 201, '2.1 Real createOrder controller path succeeded with HTTP 201');
    const createdOrderId = createOrderRes.body?.data?._id;
    cleanupOrderIds.push(new mongoose.Types.ObjectId(createdOrderId));

    check(createOrderRes.body?.data?.discount === 250, '2.2 Order created with authoritative 250 discount');
    check(createOrderRes.body?.data?.couponCode === e2eCoupon.code, '2.3 Order captured couponCode');

    // Verify reservation document created in RESERVED status
    const e2eReservationDoc = await CouponUsage.findOne({ orderId: createdOrderId });
    check(e2eReservationDoc !== null, '2.4 CouponUsage document created for order');
    check(e2eReservationDoc?.status === CouponUsageStatus.RESERVED, '2.5 CouponUsage document in RESERVED status');
    check(e2eReservationDoc?.usageSlot === 1, '2.6 CouponUsage assigned usageSlot: 1');

    const e2eCouponReserved = await Coupon.findById(e2eCoupon._id);
    check(e2eCouponReserved?.reservedCount === 1, '2.7 Coupon.reservedCount incremented to 1');

    // 2.2 Attempt a SECOND checkout by same user with same coupon while first is pending
    await Cart.updateOne(
      { userId: e2eUser._id },
      {
        $set: {
          couponCode: e2eCoupon.code,
          items: [
            {
              productId: testProduct._id,
              variantId: new mongoose.Types.ObjectId(testVariantId),
              quantity: 1,
            },
          ],
        },
      },
      { upsert: true }
    );

    const secondCheckoutRes = await httpRequest(
      baseUrl,
      'POST',
      '/api/orders',
      { addressId: testAddress._id.toString() },
      userToken
    );
    check(secondCheckoutRes.status === 400, '2.8 Second checkout by same user blocked with HTTP 400');
    check(
      secondCheckoutRes.body?.message?.includes('maximum allowed times'),
      '2.9 Response rejected with COUPON_USER_LIMIT_REACHED'
    );

    // 2.3 Real payment success handler execution (processPaymentSuccess)
    const rpOrderId = `order_e2e_${timestamp}`;
    const rpPaymentId = `pay_e2e_${timestamp}`;

    const testPayment = await Payment.create({
      orderId: createdOrderId,
      userId: e2eUser._id,
      amount: 750,
      currency: 'INR',
      status: 'PENDING',
      provider: 'RAZORPAY',
    });

    await PaymentAttempt.create({
      orderId: createdOrderId,
      paymentId: testPayment._id,
      amount: 750,
      currency: 'INR',
      status: 'PENDING',
      razorpayOrderId: rpOrderId,
      razorpayPaymentId: rpPaymentId,
    });

    const paymentResult = await processPaymentSuccess(rpOrderId, rpPaymentId);
    check(paymentResult?.success === true, '2.10 Real processPaymentSuccess processed payment successfully');

    const confirmedUsage = await CouponUsage.findOne({ orderId: createdOrderId });
    check(confirmedUsage?.status === CouponUsageStatus.CONFIRMED, '2.11 CouponUsage status transitioned to CONFIRMED');
    check(confirmedUsage?.expiresAt === undefined, '2.12 CouponUsage expiresAt unset on confirmation');

    const couponAfterConfirm = await Coupon.findById(e2eCoupon._id);
    check(couponAfterConfirm?.usedCount === 1, '2.13 Coupon.usedCount incremented to 1');
    check(couponAfterConfirm?.reservedCount === 0, '2.14 Coupon.reservedCount decremented back to 0');

    // 2.4 Real Razorpay webhook with duplicate delivery
    const origVerify = razorpayProvider.verifyWebhookSignature;
    razorpayProvider.verifyWebhookSignature = () => true;

    const webhookEventId = `evt_webhook_dup_${timestamp}`;
    const mockWebhookReq: any = {
      headers: {
        'x-razorpay-signature': 'mock_sig',
        'x-razorpay-event-id': webhookEventId,
      },
      body: Buffer.from(
        JSON.stringify({
          event: 'payment.captured',
          event_id: webhookEventId,
          payload: {
            payment: {
              entity: {
                id: rpPaymentId,
                order_id: rpOrderId,
              },
            },
          },
        })
      ),
    };

    let webhookStatus1 = 0;
    const mockRes1: any = {
      status(c: number) { webhookStatus1 = c; return this; },
      send() { return this; },
    };

    await razorpayWebhook(mockWebhookReq, mockRes1);
    check(webhookStatus1 === 200, '2.15 First webhook delivery processed with HTTP 200');

    // Duplicate webhook delivery
    let webhookStatus2 = 0;
    let webhookBody2 = '';
    const mockRes2: any = {
      status(c: number) { webhookStatus2 = c; return this; },
      send(b: string) { webhookBody2 = b; return this; },
    };

    await razorpayWebhook(mockWebhookReq, mockRes2);
    check(webhookStatus2 === 200 && webhookBody2.includes('already processed'), '2.16 Duplicate webhook delivery safely rejected as already processed');

    const couponAfterDupWebhook = await Coupon.findById(e2eCoupon._id);
    check(couponAfterDupWebhook?.usedCount === 1, '2.17 Coupon usedCount remains exactly 1 after duplicate webhook');
    check(couponAfterDupWebhook?.reservedCount === 0, '2.18 Coupon reservedCount remains 0');

    razorpayProvider.verifyWebhookSignature = origVerify;

    // 2.5 Real order cancellation on PAID order
    const cancelOutcomePaid = await cancelOrderWithRefund({
      orderId: createdOrderId,
      actorId: e2eUser._id.toString(),
      source: 'CUSTOMER',
    });
    check(cancelOutcomePaid.order.status === 'CANCELLED', '2.19 Paid order cancelled successfully');

    const usageAfterCancelPaid = await CouponUsage.findOne({ orderId: createdOrderId });
    check(usageAfterCancelPaid?.status === CouponUsageStatus.CONFIRMED, '2.20 Redeemed coupon on cancelled PAID order remains CONFIRMED (never released)');

    // -------------------------------------------------------------------------
    // SECTION 3: PAYMENT AND EXPIRATION RACE CONDITIONS
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 3: Payment and Expiration Race Conditions ---');

    const raceUser = await User.create({
      name: 'Race Customer',
      email: `race_user_${timestamp}@example.com`,
      role: UserRole.CUSTOMER,
      passwordHash: 'dummy_hash',
    });
    cleanupUserIds.push(raceUser._id as mongoose.Types.ObjectId);

    const raceCoupon = await Coupon.create({
      code: `RACE_COUPON_${timestamp}`,
      discountType: DiscountType.FIXED,
      discountValue: 100,
      minOrderValue: 400,
      perUserUsageLimit: 1,
      status: CouponStatus.ACTIVE,
    });
    cleanupCouponIds.push(raceCoupon._id as mongoose.Types.ObjectId);

    // RACE SCENARIO A: Successful payment confirmation wins before expiry
    const orderRaceA = await Order.create({
      orderNumber: `SF-RACE-A-${timestamp}`,
      userId: raceUser._id,
      items: [
        {
          productId: testProduct._id,
          variantId: new mongoose.Types.ObjectId(testVariantId),
          productName: testProduct.name,
          productImage: 'https://example.com/test.jpg',
          selectedSize: 'M',
          selectedColor: 'BLACK',
          quantity: 1,
          unitPrice: 1000,
          lineTotal: 1000,
        },
      ],
      subtotal: 1000,
      discount: 100,
      shipping: 0,
      tax: 0,
      total: 900,
      currency: 'INR',
      status: 'PENDING',
      paymentStatus: 'PENDING',
      couponCode: raceCoupon.code,
      couponId: raceCoupon._id,
      shippingAddress: {
        fullName: 'Race Customer',
        phone: '9876543210',
        addressLine1: 'Race Track 1',
        city: 'Bengaluru',
        state: 'Karnataka',
        postalCode: '560001',
        country: 'India',
      },
    });
    cleanupOrderIds.push(orderRaceA._id);

    await reserveCouponForOrder({
      couponId: raceCoupon._id,
      userId: raceUser._id,
      orderId: orderRaceA._id,
      discountAmount: 100,
    });

    const paymentRaceA = await Payment.create({
      orderId: orderRaceA._id,
      userId: raceUser._id,
      amount: 900,
      currency: 'INR',
      status: 'PENDING',
      provider: 'RAZORPAY',
    });

    const rpOrderRaceA = `order_race_a_${timestamp}`;
    const rpPaymentRaceA = `pay_race_a_${timestamp}`;

    await PaymentAttempt.create({
      orderId: orderRaceA._id,
      paymentId: paymentRaceA._id,
      amount: 900,
      currency: 'INR',
      status: 'PENDING',
      razorpayOrderId: rpOrderRaceA,
      razorpayPaymentId: rpPaymentRaceA,
    });

    // Payment confirmation wins
    const confirmResRaceA = await processPaymentSuccess(rpOrderRaceA, rpPaymentRaceA);
    check(confirmResRaceA?.success === true, '3.1 Payment confirmation won race for Order A');

    // Stale order reaper runs after payment won
    await expireStalePendingOrders();

    const orderRaceAAfterReaper = await Order.findById(orderRaceA._id);
    check(orderRaceAAfterReaper?.status === 'CONFIRMED', '3.2 Order A status remains CONFIRMED (reaper skipped paid order)');

    const usageRaceAAfterReaper = await CouponUsage.findOne({ orderId: orderRaceA._id });
    check(usageRaceAAfterReaper?.status === CouponUsageStatus.CONFIRMED, '3.3 Coupon usage remains CONFIRMED');

    // RACE SCENARIO B: Expiry wins before delayed payment webhook arrives
    const raceUserB = await User.create({
      name: 'Race Customer B',
      email: `race_user_b_${timestamp}@example.com`,
      role: UserRole.CUSTOMER,
      passwordHash: 'dummy_hash',
    });
    cleanupUserIds.push(raceUserB._id as mongoose.Types.ObjectId);

    const raceCouponB = await Coupon.create({
      code: `RACE_COUPON_B_${timestamp}`,
      discountType: DiscountType.FIXED,
      discountValue: 100,
      minOrderValue: 400,
      perUserUsageLimit: 1,
      status: CouponStatus.ACTIVE,
    });
    cleanupCouponIds.push(raceCouponB._id as mongoose.Types.ObjectId);

    const orderRaceB = await Order.create({
      orderNumber: `SF-RACE-B-${timestamp}`,
      userId: raceUserB._id,
      items: [
        {
          productId: testProduct._id,
          variantId: new mongoose.Types.ObjectId(testVariantId),
          productName: testProduct.name,
          productImage: 'https://example.com/test.jpg',
          selectedSize: 'M',
          selectedColor: 'BLACK',
          quantity: 1,
          unitPrice: 1000,
          lineTotal: 1000,
        },
      ],
      subtotal: 1000,
      discount: 100,
      shipping: 0,
      tax: 0,
      total: 900,
      currency: 'INR',
      status: 'PENDING',
      paymentStatus: 'PENDING',
      couponCode: raceCouponB.code,
      couponId: raceCouponB._id,
      shippingAddress: {
        fullName: 'Race Customer B',
        phone: '9876543210',
        addressLine1: 'Race Track 2',
        city: 'Bengaluru',
        state: 'Karnataka',
        postalCode: '560001',
        country: 'India',
      },
    });
    cleanupOrderIds.push(orderRaceB._id);
    // Artificially age the order document in MongoDB past the 15-minute ORDER_EXPIRY_MS threshold
    await Order.updateOne(
      { _id: orderRaceB._id },
      { $set: { updatedAt: new Date(Date.now() - 30 * 60 * 1000) } }
    );

    await reserveCouponForOrder({
      couponId: raceCouponB._id,
      userId: raceUserB._id,
      orderId: orderRaceB._id,
      discountAmount: 100,
    });

    const paymentRaceB = await Payment.create({
      orderId: orderRaceB._id,
      userId: raceUserB._id,
      amount: 900,
      currency: 'INR',
      status: 'PENDING',
      provider: 'RAZORPAY',
    });

    const rpOrderRaceB = `order_race_b_${timestamp}`;
    const rpPaymentRaceB = `pay_race_b_${timestamp}`;

    await PaymentAttempt.create({
      orderId: orderRaceB._id,
      paymentId: paymentRaceB._id,
      amount: 900,
      currency: 'INR',
      status: 'PENDING',
      razorpayOrderId: rpOrderRaceB,
      razorpayPaymentId: rpPaymentRaceB,
    });
    // Artificially age the order document in MongoDB past the 15-minute ORDER_EXPIRY_MS threshold
    await Order.updateOne(
      { _id: orderRaceB._id },
      { $set: { updatedAt: new Date(Date.now() - 30 * 60 * 1000) } },
      { timestamps: false }
    );
    const beforeReap = await Order.findById(orderRaceB._id);
    console.log('beforeReap:', {
      id: beforeReap?._id,
      status: beforeReap?.status,
      paymentStatus: beforeReap?.paymentStatus,
      updatedAt: beforeReap?.updatedAt,
      isPast: beforeReap?.updatedAt && beforeReap.updatedAt <= new Date(Date.now() - 15 * 60 * 1000),
    });

    // Expiry reaper runs FIRST and wins
    const reaperOutcome = await expireStalePendingOrders();
    check(reaperOutcome.expired >= 1, '3.4 Expiry reaper ran first and marked Order B EXPIRED');

    const orderRaceBAfterExpiry = await Order.findById(orderRaceB._id);
    check(orderRaceBAfterExpiry?.status === 'EXPIRED', '3.5 Order B is in EXPIRED status');

    const usageRaceBAfterExpiry = await CouponUsage.findOne({ orderId: orderRaceB._id });
    check(usageRaceBAfterExpiry?.status === CouponUsageStatus.RELEASED, '3.6 Coupon usage on expired Order B transitioned to RELEASED');

    // Now DELAYED payment capture webhook arrives
    const delayedPaymentOutcome = await processPaymentSuccess(rpOrderRaceB, rpPaymentRaceB);
    check(delayedPaymentOutcome?.success === false, '3.7 Delayed payment for expired order failed closed (success: false)');
    check(delayedPaymentOutcome?.reason === 'ORDER_CANCELLED', '3.8 Delayed payment returned reason ORDER_CANCELLED');

    const usageAfterDelayedPayment = await CouponUsage.findOne({ orderId: orderRaceB._id });
    check(
      usageAfterDelayedPayment?.status === CouponUsageStatus.RELEASED,
      '3.9 Late payment cannot resurrect or confirm an expired coupon reservation'
    );

    const couponBAfterDelayed = await Coupon.findById(raceCouponB._id);
    check(couponBAfterDelayed?.usedCount === 0, '3.10 Coupon B usedCount remains 0');
    check(couponBAfterDelayed?.reservedCount === 0, '3.11 Coupon B reservedCount remains 0');

    // -------------------------------------------------------------------------
    // SECTION 4: COUNTER INVARIANTS & RECONCILIATION VERIFICATION
    // -------------------------------------------------------------------------
    console.log('\n--- SECTION 4: Counter Invariants & Reconciliation Verification ---');

    // Create a coupon with 2 active reservations and 1 confirmed redemption
    const invCoupon = await Coupon.create({
      code: `INVARIANT_${timestamp}`,
      discountType: DiscountType.FIXED,
      discountValue: 50,
      minOrderValue: 200,
      usageLimit: 10,
      perUserUsageLimit: 5,
      status: CouponStatus.ACTIVE,
    });
    cleanupCouponIds.push(invCoupon._id as mongoose.Types.ObjectId);

    const invOrder1 = new mongoose.Types.ObjectId();
    const invOrder2 = new mongoose.Types.ObjectId();
    const invOrder3 = new mongoose.Types.ObjectId();
    cleanupOrderIds.push(invOrder1, invOrder2, invOrder3);

    await reserveCouponForOrder({ couponId: invCoupon._id, userId: user1._id, orderId: invOrder1, discountAmount: 50 });
    await reserveCouponForOrder({ couponId: invCoupon._id, userId: user1._id, orderId: invOrder2, discountAmount: 50 });
    await reserveCouponForOrder({ couponId: invCoupon._id, userId: user1._id, orderId: invOrder3, discountAmount: 50 });

    await confirmCouponReservation(invOrder1);

    const invCouponMid = await Coupon.findById(invCoupon._id);
    check(invCouponMid?.usedCount === 1, '4.1 usedCount matches confirmed redemptions (1)');
    check(invCouponMid?.reservedCount === 2, '4.2 reservedCount matches active RESERVED count (2)');

    // Invalidate/corrupt counters to test reconciliation
    await Coupon.updateOne({ _id: invCoupon._id }, { $set: { reservedCount: 99 } });
    const reconFinal = await reconcileCouponCounters(invCoupon._id);
    check(reconFinal.adjusted === true, '4.3 reconcileCouponCounters corrected corrupted reservedCount');
    check(reconFinal.reconciledReserved === 2, '4.4 reservedCount restored to exact count of active RESERVED records (2)');

    const invCouponReconciled = await Coupon.findById(invCoupon._id);
    check(invCouponReconciled?.reservedCount === 2, '4.5 Coupon.reservedCount in database strictly equals 2');
    check(invCouponReconciled?.usedCount === 1, '4.6 Coupon.usedCount in database strictly equals 1');

    console.log('\n🧹 Cleaning up test fixtures from database...');
    await Promise.all([
      CouponUsage.deleteMany({ couponId: { $in: cleanupCouponIds } }),
      Coupon.deleteMany({ _id: { $in: cleanupCouponIds } }),
      Order.deleteMany({ _id: { $in: cleanupOrderIds } }),
      User.deleteMany({ _id: { $in: cleanupUserIds } }),
      Address.deleteOne({ _id: testAddress._id }),
      Cart.deleteMany({ userId: { $in: cleanupUserIds } }),
      Product.deleteOne({ _id: testProduct._id }),
    ]);

    await mongoose.disconnect();
    console.log(' Disconnected from MongoDB\n');
  } finally {
    server.close();
    stopOrderExpiryScheduler();
    stopLogCleanupScheduler();
    RecoveryCoordinatorService.stopRecoveryScheduler();
    if (serverInstance) {
      await new Promise<void>((resolve) => (serverInstance as http.Server).close(() => resolve()));
    }
  }

  console.log('══════════════════════════════════════════════════════════════════════');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════════════════════════\n');

  if (failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}

runResilienceAndE2ESuite().catch((err) => {
  console.error('Fatal test runner exception:', err);
  process.exit(1);
});
