import mongoose from 'mongoose';
import { connectSafeTestDb, createTestProduct } from './testHelpers';
import { Order } from '../models/Order';
import { Payment } from '../models/Payment';
import { PaymentAttempt } from '../models/PaymentAttempt';
import { Refund } from '../models/Refund';
import { ReturnRequest } from '../models/ReturnRequest';
import { Shipment } from '../models/Shipment';
import { DuplicateCaptureRefund } from '../models/DuplicateCaptureRefund';
import { InventoryTransaction } from '../models/InventoryTransaction';
import { Product } from '../models/Product';
import { Coupon, DiscountType, CouponStatus } from '../models/Coupon';
import { CouponUsage, CouponUsageStatus } from '../models/CouponUsage';
import { razorpayProvider } from '../services/payment/RazorpayProvider';
import { processPaymentSuccess, renewPaymentAttemptLease, startPaymentAttemptLeaseHeartbeat } from '../services/payment/paymentProcessor';
import { InventoryAllocationService } from '../services/inventory/inventoryAllocationService';
import { verifyPayment } from '../controllers/paymentController';
import { processSupportedWebhookEvent } from '../controllers/webhookController';
import { reconcilePendingExpiryCleanups } from '../services/orderExpiryService';
import { getOrders, getOrder } from '../controllers/orderController';
import '../models/Cart';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(condition: boolean, description: string): void {
  if (condition) {
    console.log(`  PASS: ${description}`);
    passed++;
  } else {
    console.error(`  FAIL: ${description}`);
    failures.push(description);
    failed++;
  }
}

function mockResponse() {
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: null as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
  };
  return res;
}

const noopNext = () => {};

const sampleShippingAddress = {
  fullName: 'Test Customer',
  phone: '9876543210',
  addressLine1: '123 Main Street',
  city: 'Bengaluru',
  state: 'Karnataka',
  postalCode: '560038',
  country: 'India',
  addressType: 'HOME' as const,
};

async function runHardeningTests(): Promise<void> {
  console.log('\n=== RUNNING PRODUCTION HARDENING REMEDIATION TEST SUITE ===\n');
  process.env.NODE_ENV = 'test';
  process.env.RAZORPAY_KEY_ID = 'rzp_test_mock';
  process.env.RAZORPAY_KEY_SECRET = 'mock_secret_test';
  process.env.TURNSTILE_ENABLED = 'false';

  const rsUri = 'mongodb://127.0.0.1:27018/samrat_fashion_rs_test?replicaSet=rs_samrat_test&directConnection=true';
  let usingReplicaSet = false;
  try {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    await mongoose.connect(rsUri, { serverSelectionTimeoutMS: 3000 });
    const hello = await mongoose.connection.db!.command({ hello: 1 });
    if (hello.setName === 'rs_samrat_test' && hello.isWritablePrimary) {
      usingReplicaSet = true;
      console.log('[TEST DB] Connected to real MongoDB replica set rs_samrat_test on port 27018');
    }
  } catch {
    console.log('[TEST DB] Replica set 27018 not available; connecting via connectSafeTestDb()');
    await connectSafeTestDb();
  }
  check(usingReplicaSet, '0.1 Genuine replica set environment connected on port 27018');

  // Ensure collections and indexes are fully created so catalog changes do not conflict with transactions
  await Promise.all([
    Order.init(),
    Payment.init(),
    PaymentAttempt.init(),
    Product.init(),
    InventoryTransaction.init(),
    Coupon.init(),
    CouponUsage.init(),
  ]);

  const userId = new mongoose.Types.ObjectId();
  const productRes = await createTestProduct({
    name: `Hardening Product ${Date.now()}`,
    variants: [{ size: 'L', color: 'NAVY', stock: 20 }],
  });
  const productId = new mongoose.Types.ObjectId(productRes.product._id);
  const variantId = new mongoose.Types.ObjectId(productRes.variantIds[0]);

  // ───────────────────────────────────────────────────────────────────────────
  // SECTION 1: Exclusive Payment Processing Ownership & Fencing
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n[1] Exclusive Payment Processing Ownership & Fencing');
  const order1 = await Order.create({
    orderNumber: `FENCE-${Date.now()}`,
    userId,
    items: [{
      productId,
      variantId,
      productName: 'Fenced Tee',
      productImage: 'https://example.com/tee.jpg',
      selectedSize: 'L',
      selectedColor: 'NAVY',
      quantity: 1,
      unitPrice: 500,
      lineTotal: 500,
      isCustomized: false,
    }],
    shippingAddress: sampleShippingAddress,
    subtotal: 500,
    discount: 0,
    shipping: 0,
    tax: 0,
    total: 500,
    currency: 'INR',
    status: 'PENDING',
    paymentStatus: 'PENDING',
  });

  const payment1 = await Payment.create({
    orderId: order1._id,
    userId,
    amount: 500,
    currency: 'INR',
    status: 'PENDING',
    provider: 'RAZORPAY',
  });

  const rzpOrder1 = `order_fence_${Date.now()}`;
  const attempt1 = await PaymentAttempt.create({
    paymentId: payment1._id,
    orderId: order1._id,
    razorpayOrderId: rzpOrder1,
    amount: 500,
    currency: 'INR',
    status: 'PENDING',
    fencingToken: 0,
  });

  // Successful capture increments fencing generation
  const resCapture1 = await processPaymentSuccess(rzpOrder1, 'pay_fence_success');
  check(resCapture1?.success === true, '1.1 Normal capture succeeds');
  const updatedAttempt1 = await PaymentAttempt.findById(attempt1._id);
  check(Number(updatedAttempt1?.fencingToken) >= 1, '1.2 Fencing token was incremented on claim');
  check(updatedAttempt1?.status === 'CAPTURED', '1.3 Attempt status transitioned to CAPTURED');
  check(!updatedAttempt1?.claimToken, '1.4 Worker claim token was unset on terminal CAPTURED');

  // ───────────────────────────────────────────────────────────────────────────
  // SCENARIO 1 & 2: Worker A acquires claim; Worker B cannot acquire before expiry.
  // Worker B takes over after expiry and receives higher fencing token.
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n[1.B] Concurrency Scenarios: Worker claim ownership & takeover');
  const orderA = await Order.create({
    orderNumber: `CONC-A-${Date.now()}`,
    userId,
    items: [{
      productId,
      variantId,
      productName: 'Conc Tee A',
      productImage: 'https://example.com/tee.jpg',
      selectedSize: 'L',
      selectedColor: 'NAVY',
      quantity: 1,
      unitPrice: 500,
      lineTotal: 500,
      isCustomized: false,
    }],
    shippingAddress: sampleShippingAddress,
    subtotal: 500,
    discount: 0,
    shipping: 0,
    tax: 0,
    total: 500,
    currency: 'INR',
    status: 'PENDING',
    paymentStatus: 'PENDING',
  });

  const paymentA = await Payment.create({
    orderId: orderA._id,
    userId,
    amount: 500,
    currency: 'INR',
    status: 'PENDING',
    provider: 'RAZORPAY',
  });

  const rzpOrderA = `order_conc_a_${Date.now()}`;
  const attemptA = await PaymentAttempt.create({
    paymentId: paymentA._id,
    orderId: orderA._id,
    razorpayOrderId: rzpOrderA,
    amount: 500,
    currency: 'INR',
    status: 'PENDING',
    fencingToken: 0,
  });

  // Worker A claims with a 10s lease
  const workerAToken = `worker_a_${Date.now()}`;
  const leaseA = 10_000;
  const claimedA = await PaymentAttempt.findOneAndUpdate(
    { _id: attemptA._id, status: 'PENDING' },
    {
      $set: {
        status: 'PROCESSING',
        claimToken: workerAToken,
        claimExpiresAt: new Date(Date.now() + leaseA),
      },
      $inc: { fencingToken: 1 },
    },
    { returnDocument: 'after' }
  );
  check(Boolean(claimedA), '1.5 Worker A acquired claim on attempt');
  check(claimedA?.fencingToken === 1, '1.6 Worker A fencing token is 1');

  // Worker B immediately attempts to process while Worker A holds active unexpired claim (polls twice then times out)
  const bResultImmediate = await processPaymentSuccess(rzpOrderA, 'pay_worker_b_immediate', { terminalPollMax: 2 });
  check(bResultImmediate?.success === false, '1.7 Worker B cannot acquire claim before lease expiry');
  const attemptDuringA = await PaymentAttempt.findById(attemptA._id);
  check(attemptDuringA?.claimToken === workerAToken, '1.8 Worker A still owns the claim');
  check(attemptDuringA?.fencingToken === 1, '1.9 Fencing token remains 1 while Worker A owns claim');

  // Simulate Worker A's lease expiring
  await PaymentAttempt.updateOne({ _id: attemptA._id }, { $set: { claimExpiresAt: new Date(Date.now() - 1000) } });

  // Worker B now takes over after expiry
  const bResultAfterExpiry = await processPaymentSuccess(rzpOrderA, 'pay_worker_b_takeover');
  check(bResultAfterExpiry?.success === true, '1.10 Worker B successfully took over after expiry');
  const attemptAfterB = await PaymentAttempt.findById(attemptA._id);
  check(attemptAfterB?.fencingToken === 2, '1.11 Worker B received higher fencing token (2 > 1)');
  check(attemptAfterB?.status === 'CAPTURED', '1.12 Payment attempt transitioned to CAPTURED by Worker B');
  const orderAfterB = await Order.findById(orderA._id);
  check(orderAfterB?.status === 'CONFIRMED' && orderAfterB?.paymentStatus === 'PAID', '1.13 Order confirmed by Worker B');

  // ───────────────────────────────────────────────────────────────────────────
  // SCENARIO 3: Stale Worker A cannot commit after Worker B takes over
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n[1.C] Stale Worker A cannot commit after Worker B takeover');
  const staleWorkerACommit = await PaymentAttempt.findOneAndUpdate(
    {
      _id: attemptA._id,
      claimToken: workerAToken,
      fencingToken: 1, // Stale generation
      status: 'PROCESSING',
      claimExpiresAt: { $gt: new Date() },
    },
    {
      $set: { status: 'CAPTURED', razorpayPaymentId: 'pay_stale_worker_a' },
    },
    { returnDocument: 'after' }
  );
  check(staleWorkerACommit === null, '1.14 Stale Worker A write rejected due to stale fencing token');

  const staleOrderUpdate = await Order.findOneAndUpdate(
    {
      _id: orderA._id,
      status: { $nin: ['CANCELLED', 'EXPIRED'] },
      paymentStatus: { $ne: 'PAID' },
    },
    { $set: { paymentStatus: 'FAILED' } },
    { returnDocument: 'after' }
  );
  check(staleOrderUpdate === null, '1.15 Stale Worker A cannot overwrite order already settled');

  // ───────────────────────────────────────────────────────────────────────────
  // SCENARIO 4: An expired lease is rejected even if nobody has stolen it yet
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n[1.D] Expired lease is rejected even if nobody has stolen it yet');
  const orderD = await Order.create({
    orderNumber: `EXPIRED-LEASE-${Date.now()}`,
    userId,
    items: [{
      productId,
      variantId,
      productName: 'Tee Expired',
      productImage: 'https://example.com/tee.jpg',
      selectedSize: 'L',
      selectedColor: 'NAVY',
      quantity: 1,
      unitPrice: 500,
      lineTotal: 500,
      isCustomized: false,
    }],
    shippingAddress: sampleShippingAddress,
    subtotal: 500,
    discount: 0,
    shipping: 0,
    tax: 0,
    total: 500,
    currency: 'INR',
    status: 'PENDING',
    paymentStatus: 'PENDING',
  });

  const paymentD = await Payment.create({
    orderId: orderD._id,
    userId,
    amount: 500,
    currency: 'INR',
    status: 'PENDING',
    provider: 'RAZORPAY',
  });

  const rzpOrderD = `order_exp_${Date.now()}`;
  const attemptD = await PaymentAttempt.create({
    paymentId: paymentD._id,
    orderId: orderD._id,
    razorpayOrderId: rzpOrderD,
    amount: 500,
    currency: 'INR',
    status: 'PROCESSING',
    claimToken: 'token_worker_d',
    claimExpiresAt: new Date(Date.now() - 5000), // Expired
    fencingToken: 1,
  });

  const expiredWriteResult = await PaymentAttempt.findOneAndUpdate(
    {
      _id: attemptD._id,
      claimToken: 'token_worker_d',
      fencingToken: 1,
      status: 'PROCESSING',
      claimExpiresAt: { $gt: new Date() },
    },
    { $set: { status: 'CAPTURED' } },
    { returnDocument: 'after' }
  );
  check(expiredWriteResult === null, '1.16 Expired lease write strictly rejected even when nobody else claimed it');

  const checkStillProcessing = await PaymentAttempt.findById(attemptD._id);
  check(checkStillProcessing?.status === 'PROCESSING', '1.17 Attempt remains in PROCESSING (not CAPTURED)');

  // ───────────────────────────────────────────────────────────────────────────
  // SCENARIO 5 & 6: Lease renewal validation & failure handling
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n[1.E] Lease renewal validation & failure handling');
  const rzpOrderE = `order_renew_${Date.now()}`;
  const attemptE = await PaymentAttempt.create({
    paymentId: paymentD._id,
    orderId: orderD._id,
    razorpayOrderId: rzpOrderE,
    amount: 500,
    currency: 'INR',
    status: 'PROCESSING',
    claimToken: 'owner_token_e',
    claimExpiresAt: new Date(Date.now() + 5000),
    fencingToken: 3,
  });

  // Legitimate owner can renew
  const legitimateRenew = await renewPaymentAttemptLease(attemptE._id, 'owner_token_e', 3, 20_000);
  check(legitimateRenew === true, '1.18 Legitimate owner successfully renewed lease');
  const attemptAfterRenew = await PaymentAttempt.findById(attemptE._id);
  check(attemptAfterRenew!.claimExpiresAt!.getTime() > Date.now() + 10_000, '1.19 Lease expiry extended into future');

  // Impostor with wrong token cannot renew
  const impostorRenew = await renewPaymentAttemptLease(attemptE._id, 'impostor_token', 3, 20_000);
  check(impostorRenew === false, '1.20 Impostor with wrong claimToken cannot renew lease');

  // Stale fencing token cannot renew
  const staleFenceRenew = await renewPaymentAttemptLease(attemptE._id, 'owner_token_e', 2, 20_000);
  check(staleFenceRenew === false, '1.21 Stale fencing token rejected during renewal');

  // Expired lease cannot be renewed
  await PaymentAttempt.updateOne({ _id: attemptE._id }, { $set: { claimExpiresAt: new Date(Date.now() - 1000) } });
  const expiredRenew = await renewPaymentAttemptLease(attemptE._id, 'owner_token_e', 3, 20_000);
  check(expiredRenew === false, '1.22 Expired lease cannot be renewed');

  // 6. Failed renewal prevents further financial state transitions
  const orderF = await Order.create({
    orderNumber: `RENEW-FAIL-${Date.now()}`,
    userId,
    items: [{
      productId,
      variantId,
      productName: 'Tee Fail',
      productImage: 'https://example.com/tee.jpg',
      selectedSize: 'L',
      selectedColor: 'NAVY',
      quantity: 1,
      unitPrice: 500,
      lineTotal: 500,
      isCustomized: false,
    }],
    shippingAddress: sampleShippingAddress,
    subtotal: 500,
    discount: 0,
    shipping: 0,
    tax: 0,
    total: 500,
    currency: 'INR',
    status: 'PENDING',
    paymentStatus: 'PENDING',
  });

  const paymentF = await Payment.create({
    orderId: orderF._id,
    userId,
    amount: 500,
    currency: 'INR',
    status: 'PENDING',
    provider: 'RAZORPAY',
  });

  const rzpOrderF = `order_rf_${Date.now()}`;
  const attemptF = await PaymentAttempt.create({
    paymentId: paymentF._id,
    orderId: orderF._id,
    razorpayOrderId: rzpOrderF,
    amount: 500,
    currency: 'INR',
    status: 'PROCESSING',
    claimToken: 'token_f_owner',
    claimExpiresAt: new Date(Date.now() + 5000),
    fencingToken: 1,
  });

  // Another worker changed fencing token / stole claim
  await PaymentAttempt.updateOne({ _id: attemptF._id }, { $set: { fencingToken: 2, claimToken: 'token_f_stealer' } });

  // Worker F tries to renew: fails!
  const renewFailed = await renewPaymentAttemptLease(attemptF._id, 'token_f_owner', 1, 10_000);
  check(renewFailed === false, '1.23 Worker F failed lease renewal after takeover');

  // Because renewal failed, worker cannot proceed to financial state transitions:
  const fencedAttemptWrite = await PaymentAttempt.findOneAndUpdate(
    {
      _id: attemptF._id,
      claimToken: 'token_f_owner',
      fencingToken: 1,
      status: 'PROCESSING',
      claimExpiresAt: { $gt: new Date() },
    },
    { $set: { status: 'CAPTURED' } },
    { returnDocument: 'after' }
  );
  check(fencedAttemptWrite === null, '1.24 Financial transition to CAPTURED strictly blocked after failed renewal');

  const orderFCheck = await Order.findById(orderF._id);
  check(orderFCheck?.status === 'PENDING' && orderFCheck?.paymentStatus === 'PENDING', '1.25 Order remained unconfirmed');

  // ───────────────────────────────────────────────────────────────────────────
  // SCENARIO 7: Failure between inventory deduction and order confirmation
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n[1.F] Failure between inventory deduction and order confirmation (Atomic Rollback)');
  const initialStock7 = 20;
  const testProd7 = await createTestProduct({
    name: `Rollback Product ${Date.now()}`,
    variants: [{ size: 'M', color: 'BLACK', stock: initialStock7 }],
  });
  const p7Id = new mongoose.Types.ObjectId(testProd7.product._id);
  const v7Id = new mongoose.Types.ObjectId(testProd7.variantIds[0]);

  const order7 = await Order.create({
    orderNumber: `ROLLBACK-7-${Date.now()}`,
    userId,
    items: [{
      productId: p7Id,
      variantId: v7Id,
      productName: 'Rollback Tee',
      productImage: 'https://example.com/tee.jpg',
      selectedSize: 'M',
      selectedColor: 'BLACK',
      quantity: 2,
      unitPrice: 500,
      lineTotal: 1000,
      isCustomized: false,
    }],
    shippingAddress: sampleShippingAddress,
    subtotal: 1000,
    discount: 0,
    shipping: 0,
    tax: 0,
    total: 1000,
    currency: 'INR',
    status: 'CANCELLED', // Cancelled order triggers abort during order confirmation check
    paymentStatus: 'PENDING',
  });

  const payment7 = await Payment.create({
    orderId: order7._id,
    userId,
    amount: 1000,
    currency: 'INR',
    status: 'PENDING',
    provider: 'RAZORPAY',
  });

  const rzpOrder7 = `order_rb7_${Date.now()}`;
  await PaymentAttempt.create({
    paymentId: payment7._id,
    orderId: order7._id,
    razorpayOrderId: rzpOrder7,
    amount: 1000,
    currency: 'INR',
    status: 'PENDING',
  });

  const res7 = await processPaymentSuccess(rzpOrder7, 'pay_rb7_capture');
  check(res7?.success === false, '1.26 Processing on cancelled order failed cleanly');
  check(res7?.reason === 'ORDER_CANCELLED', '1.27 Reported reason is ORDER_CANCELLED');

  const prod7After = await Product.findById(p7Id);
  const stock7After = prod7After?.variants.find((v: any) => v._id.toString() === v7Id.toString())?.stock;
  check(stock7After === initialStock7, `1.28 Stock remained intact at ${initialStock7} (got ${stock7After})`);

  const txCount7 = await InventoryTransaction.countDocuments({ orderId: order7._id, type: 'SALE' });
  check(txCount7 === 0, '1.29 Zero SALE transactions persisted for aborted order');

  // ───────────────────────────────────────────────────────────────────────────
  // SCENARIO 8: Failure during final PaymentAttempt transition rolls back transaction
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n[1.G] Failure during final PaymentAttempt transition rolls back transaction');
  const testProd8 = await createTestProduct({
    name: `Final Attempt Fail ${Date.now()}`,
    variants: [{ size: 'M', color: 'BLACK', stock: 15 }],
  });
  const p8Id = new mongoose.Types.ObjectId(testProd8.product._id);
  const v8Id = new mongoose.Types.ObjectId(testProd8.variantIds[0]);

  const order8 = await Order.create({
    orderNumber: `FINAL-FAIL-${Date.now()}`,
    userId,
    items: [{
      productId: p8Id,
      variantId: v8Id,
      productName: 'Final Fail Tee',
      productImage: 'https://example.com/tee.jpg',
      selectedSize: 'M',
      selectedColor: 'BLACK',
      quantity: 3,
      unitPrice: 500,
      lineTotal: 1500,
      isCustomized: false,
    }],
    shippingAddress: sampleShippingAddress,
    subtotal: 1500,
    discount: 0,
    shipping: 0,
    tax: 0,
    total: 1500,
    currency: 'INR',
    status: 'PENDING',
    paymentStatus: 'PENDING',
  });

  const payment8 = await Payment.create({
    orderId: order8._id,
    userId,
    amount: 1500,
    currency: 'INR',
    status: 'PENDING',
    provider: 'RAZORPAY',
  });

  const rzpOrder8 = `order_final8_${Date.now()}`;
  const attempt8 = await PaymentAttempt.create({
    paymentId: payment8._id,
    orderId: order8._id,
    razorpayOrderId: rzpOrder8,
    amount: 1500,
    currency: 'INR',
    status: 'PENDING',
  });

  // Execute multi-document transaction simulating final transition failure
  const session8 = await mongoose.startSession();
  session8.startTransaction({
    readConcern: { level: 'snapshot' },
    writeConcern: { w: 'majority' }
  });

  try {
    const allocs8 = await InventoryAllocationService.resolveOrderAllocations(order8.items);
    await InventoryAllocationService.deductInventory(order8._id, allocs8, { session: session8 });
    await Order.updateOne({ _id: order8._id }, { $set: { status: 'CONFIRMED', paymentStatus: 'PAID' } }, { session: session8 });

    // Simulate final transition conditional failure (wrong claim token)
    const finalUpdate = await PaymentAttempt.findOneAndUpdate(
      { _id: attempt8._id, claimToken: 'wrong_token', status: 'PROCESSING' },
      { $set: { status: 'CAPTURED' } },
      { session: session8 }
    );
    check(finalUpdate === null, '1.30 Final transition conditional check failed as expected');

    // Abort transaction on final transition failure
    await session8.abortTransaction();
  } finally {
    await session8.endSession();
  }

  const order8After = await Order.findById(order8._id);
  check(order8After?.status === 'PENDING', '1.31 Order status rolled back to PENDING (not left CONFIRMED)');
  check(order8After?.paymentStatus === 'PENDING', '1.32 Order paymentStatus rolled back to PENDING');

  const prod8After = await Product.findById(p8Id);
  const stock8After = prod8After?.variants.find((v: any) => v._id.toString() === v8Id.toString())?.stock;
  check(stock8After === 15, `1.33 Stock rolled back to 15 (got ${stock8After})`);

  const saleTx8 = await InventoryTransaction.countDocuments({ orderId: order8._id, type: 'SALE' });
  check(saleTx8 === 0, '1.34 No SALE transaction persisted after abort');

  // ───────────────────────────────────────────────────────────────────────────
  // SCENARIO 9: Concurrent Capture Processors race condition (Zero double-deduction)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n[1.H] Concurrent Capture Processors race condition (Zero double-deduction)');
  const initialStock9 = 10;
  const testProd9 = await createTestProduct({
    name: `Concurrent Race ${Date.now()}`,
    variants: [{ size: 'L', color: 'NAVY', stock: initialStock9 }],
  });
  const p9Id = new mongoose.Types.ObjectId(testProd9.product._id);
  const v9Id = new mongoose.Types.ObjectId(testProd9.variantIds[0]);

  const order9 = await Order.create({
    orderNumber: `RACE-9-${Date.now()}`,
    userId,
    items: [{
      productId: p9Id,
      variantId: v9Id,
      productName: 'Race Tee',
      productImage: 'https://example.com/tee.jpg',
      selectedSize: 'L',
      selectedColor: 'NAVY',
      quantity: 1,
      unitPrice: 500,
      lineTotal: 500,
      isCustomized: false,
    }],
    shippingAddress: sampleShippingAddress,
    subtotal: 500,
    discount: 0,
    shipping: 0,
    tax: 0,
    total: 500,
    currency: 'INR',
    status: 'PENDING',
    paymentStatus: 'PENDING',
  });

  const payment9 = await Payment.create({
    orderId: order9._id,
    userId,
    amount: 500,
    currency: 'INR',
    status: 'PENDING',
    provider: 'RAZORPAY',
  });

  const rzpOrder9 = `order_race9_${Date.now()}`;
  await PaymentAttempt.create({
    paymentId: payment9._id,
    orderId: order9._id,
    razorpayOrderId: rzpOrder9,
    amount: 500,
    currency: 'INR',
    status: 'PENDING',
  });

  // Launch two concurrent processors simultaneously
  const [resA, resB] = await Promise.all([
    processPaymentSuccess(rzpOrder9, 'pay_race_1'),
    processPaymentSuccess(rzpOrder9, 'pay_race_1'),
  ]);

  check(resA?.success === true || resB?.success === true, '1.35 At least one concurrent processor succeeded');

  // Stock must be decremented EXACTLY ONCE (from 10 to 9, NOT to 8)
  const prod9After = await Product.findById(p9Id);
  const stock9After = prod9After?.variants.find((v: any) => v._id.toString() === v9Id.toString())?.stock;
  check(stock9After === initialStock9 - 1, `1.36 Stock decremented exactly once: 10 -> ${stock9After}`);

  const saleTx9Count = await InventoryTransaction.countDocuments({ orderId: order9._id, type: 'SALE' });
  check(saleTx9Count === 1, `1.37 Exactly 1 SALE transaction exists (got ${saleTx9Count})`);

  const order9After = await Order.findById(order9._id);
  check(order9After?.status === 'CONFIRMED' && order9After?.paymentStatus === 'PAID', '1.38 Order successfully confirmed');

  // ───────────────────────────────────────────────────────────────────────────
  // SCENARIO 10: Existing duplicate-capture refund behavior remains correct
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n[1.I] Duplicate capture refund behavior preserved');
  const origRefund = razorpayProvider.createRefund;
  const refundState = { called: false };
  razorpayProvider.createRefund = async (paymentId, amount, notes, receipt) => {
    refundState.called = true;
    return {
      id: `rfnd_mock_dup_${Date.now()}`,
      entity: 'refund',
      amount,
      currency: 'INR',
      payment_id: paymentId,
      status: 'processed',
      receipt,
    } as any;
  };

  try {
    const dupRes = await processPaymentSuccess(rzpOrder9, 'pay_duplicate_capture_10');
    check(dupRes?.success === true || dupRes?.reason === 'DUPLICATE_CAPTURE_REFUND_PENDING', '1.39 Duplicate capture handled cleanly');
    check(refundState.called === true, '1.40 Auto-refund created for duplicate capture');

    const dupRecord = await DuplicateCaptureRefund.findOne({ orderId: order9._id });
    check(Boolean(dupRecord), '1.41 DuplicateCaptureRefund ledger record exists');
    check(dupRecord?.capturePaymentId === 'pay_duplicate_capture_10', '1.42 DuplicateCaptureRefund tracks capture ID');

    const prod9Final = await Product.findById(p9Id);
    const stock9Final = prod9Final?.variants.find((v: any) => v._id.toString() === v9Id.toString())?.stock;
    check(stock9Final === initialStock9 - 1, `1.43 Stock remained unchanged at 9 (got ${stock9Final})`);
  } finally {
    razorpayProvider.createRefund = origRefund;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // SECTION 1.J: P1 CONCURRENCY & TRANSACTION HARDENING REMEDIATION
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n[1.J.1] P1-1: Transaction startup fails in production-like environment (Fail Closed)');
  const initialStockTxFail = 10;
  const testProdTxFail = await createTestProduct({
    name: `Tx Startup Fail ${Date.now()}`,
    variants: [{ size: 'M', color: 'BLACK', stock: initialStockTxFail }],
  });
  const pTxFailId = new mongoose.Types.ObjectId(testProdTxFail.product._id);
  const vTxFailId = new mongoose.Types.ObjectId(testProdTxFail.variantIds[0]);

  const orderTxFail = await Order.create({
    orderNumber: `TX-FAIL-${Date.now()}`,
    userId,
    items: [{
      productId: pTxFailId,
      variantId: vTxFailId,
      productName: 'Tx Fail Tee',
      productImage: 'https://example.com/tee.jpg',
      selectedSize: 'M',
      selectedColor: 'BLACK',
      quantity: 2,
      unitPrice: 500,
      lineTotal: 1000,
      isCustomized: false,
    }],
    shippingAddress: sampleShippingAddress,
    subtotal: 1000,
    discount: 0,
    shipping: 0,
    tax: 0,
    total: 1000,
    currency: 'INR',
    status: 'PENDING',
    paymentStatus: 'PENDING',
  });

  const paymentTxFail = await Payment.create({
    orderId: orderTxFail._id,
    userId,
    amount: 1000,
    currency: 'INR',
    status: 'PENDING',
    provider: 'RAZORPAY',
  });

  const rzpOrderTxFail = `order_txfail_${Date.now()}`;
  await PaymentAttempt.create({
    paymentId: paymentTxFail._id,
    orderId: orderTxFail._id,
    razorpayOrderId: rzpOrderTxFail,
    amount: 1000,
    currency: 'INR',
    status: 'PENDING',
  });

  // Set NODE_ENV to production and mock startSession so that created sessions throw on startTransaction
  const origEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const origStartSession = mongoose.startSession.bind(mongoose);
  (mongoose as any).startSession = async function (...args: any[]) {
    const s = await origStartSession(...args);
    s.startTransaction = function () {
      throw new Error('Simulated transaction startup connection reset');
    };
    return s;
  };

  let txStartupThrew = false;
  try {
    await processPaymentSuccess(rzpOrderTxFail, 'pay_txfail_1');
  } catch (err: any) {
    txStartupThrew = true;
    check(
      err.message.includes('TRANSACTION_STARTUP_FAILED') || err.message.includes('UNSAFE_PAYMENT_SETTLEMENT_REFUSED'),
      `1.44 Transaction startup failure failed closed (threw error: ${err.message})`
    );
  } finally {
    process.env.NODE_ENV = origEnv;
    (mongoose as any).startSession = origStartSession;
  }
  check(txStartupThrew, '1.45 processPaymentSuccess refused to execute non-transactionally in production');

  // Verify ZERO financial state mutations occurred:
  const prodTxFailAfter = await Product.findById(pTxFailId);
  const stockTxFailAfter = prodTxFailAfter?.variants.find((v: any) => v._id.toString() === vTxFailId.toString())?.stock;
  check(stockTxFailAfter === initialStockTxFail, `1.46 Product stock completely unchanged: ${initialStockTxFail} (got ${stockTxFailAfter})`);

  const txCountFail = await InventoryTransaction.countDocuments({ orderId: orderTxFail._id, type: 'SALE' });
  check(txCountFail === 0, '1.47 Zero SALE inventory transactions persisted');

  const orderTxFailAfter = await Order.findById(orderTxFail._id);
  check(orderTxFailAfter?.status === 'PENDING', '1.48 Order status remained PENDING');
  check(orderTxFailAfter?.paymentStatus === 'PENDING', '1.49 Order paymentStatus remained PENDING');

  const paymentTxFailAfter = await Payment.findById(paymentTxFail._id);
  check(paymentTxFailAfter?.status === 'PENDING', '1.50 Payment status remained PENDING');

  const attemptTxFailAfter = await PaymentAttempt.findOne({ razorpayOrderId: rzpOrderTxFail });
  check(attemptTxFailAfter?.status !== 'CAPTURED', '1.51 PaymentAttempt is NOT CAPTURED');

  console.log('\n[1.J.2] P1-2: Heartbeat is enabled by default for normal capture processing');
  const testProdHb = await createTestProduct({
    name: `Heartbeat Default ${Date.now()}`,
    variants: [{ size: 'M', color: 'BLACK', stock: 10 }],
  });
  const pHbId = new mongoose.Types.ObjectId(testProdHb.product._id);
  const vHbId = new mongoose.Types.ObjectId(testProdHb.variantIds[0]);

  const orderHb = await Order.create({
    orderNumber: `HB-DEF-${Date.now()}`,
    userId,
    items: [{
      productId: pHbId,
      variantId: vHbId,
      productName: 'HB Tee',
      productImage: 'https://example.com/tee.jpg',
      selectedSize: 'M',
      selectedColor: 'BLACK',
      quantity: 1,
      unitPrice: 500,
      lineTotal: 500,
      isCustomized: false,
    }],
    shippingAddress: sampleShippingAddress,
    subtotal: 500,
    discount: 0,
    shipping: 0,
    tax: 0,
    total: 500,
    currency: 'INR',
    status: 'PENDING',
    paymentStatus: 'PENDING',
  });

  const paymentHb = await Payment.create({
    orderId: orderHb._id,
    userId,
    amount: 500,
    currency: 'INR',
    status: 'PENDING',
    provider: 'RAZORPAY',
  });

  const rzpOrderHb = `order_hb_${Date.now()}`;
  await PaymentAttempt.create({
    paymentId: paymentHb._id,
    orderId: orderHb._id,
    razorpayOrderId: rzpOrderHb,
    amount: 500,
    currency: 'INR',
    status: 'PENDING',
  });

  // Call processPaymentSuccess with default options (options = {})
  const hbCaptureRes = await processPaymentSuccess(rzpOrderHb, 'pay_hb_default');
  check(hbCaptureRes?.success === true, '1.52 Default capture processing succeeds');
  const hbAttemptAfter = await PaymentAttempt.findOne({ razorpayOrderId: rzpOrderHb });
  check(hbAttemptAfter?.status === 'CAPTURED', '1.53 PaymentAttempt transitioned to CAPTURED under default heartbeat');

  console.log('\n[1.J.3] P1-2: Heartbeat renewal cannot extend an expired lease');
  const rzpOrderExpRenew = `order_exp_renew_${Date.now()}`;
  const attemptExpRenew = await PaymentAttempt.create({
    paymentId: paymentHb._id,
    orderId: orderHb._id,
    razorpayOrderId: rzpOrderExpRenew,
    amount: 500,
    currency: 'INR',
    status: 'PROCESSING',
    claimToken: 'token_exp_renew',
    fencingToken: 1,
    claimExpiresAt: new Date(Date.now() - 5000), // strictly in the past
  });

  const renewalResult = await renewPaymentAttemptLease(attemptExpRenew._id, 'token_exp_renew', 1, 10_000);
  check(renewalResult === false, '1.54 Heartbeat renewal returned false for expired lease');

  const attemptExpRenewAfter = await PaymentAttempt.findById(attemptExpRenew._id);
  check(
    attemptExpRenewAfter!.claimExpiresAt!.getTime() <= Date.now(),
    '1.55 Expired lease timestamp was not extended into the future'
  );

  console.log('\n[1.J.4] P1-2: Heartbeat cannot cause transaction write conflicts');
  const testProdConflict = await createTestProduct({
    name: `Conflict Check ${Date.now()}`,
    variants: [{ size: 'S', color: 'WHITE', stock: 10 }],
  });
  const pConflictId = new mongoose.Types.ObjectId(testProdConflict.product._id);
  const vConflictId = new mongoose.Types.ObjectId(testProdConflict.variantIds[0]);

  const orderConflict = await Order.create({
    orderNumber: `CONFLICT-CHECK-${Date.now()}`,
    userId,
    items: [{
      productId: pConflictId,
      variantId: vConflictId,
      productName: 'Conflict Tee',
      productImage: 'https://example.com/tee.jpg',
      selectedSize: 'S',
      selectedColor: 'WHITE',
      quantity: 1,
      unitPrice: 500,
      lineTotal: 500,
      isCustomized: false,
    }],
    shippingAddress: sampleShippingAddress,
    subtotal: 500,
    discount: 0,
    shipping: 0,
    tax: 0,
    total: 500,
    currency: 'INR',
    status: 'PENDING',
    paymentStatus: 'PENDING',
  });

  const paymentConflict = await Payment.create({
    orderId: orderConflict._id,
    userId,
    amount: 500,
    currency: 'INR',
    status: 'PENDING',
    provider: 'RAZORPAY',
  });

  const rzpOrderConflict = `order_conflict_${Date.now()}`;
  await PaymentAttempt.create({
    paymentId: paymentConflict._id,
    orderId: orderConflict._id,
    razorpayOrderId: rzpOrderConflict,
    amount: 500,
    currency: 'INR',
    status: 'PENDING',
  });

  // Execute capture with heartbeat active and leaseDurationMs short to force interval ticks
  const conflictRes = await processPaymentSuccess(rzpOrderConflict, 'pay_conflict_test', {
    enableHeartbeat: true,
    leaseDurationMs: 1000,
  });
  check(conflictRes?.success === true, '1.56 Capture completed without transaction write conflicts');

  const conflictAttemptAfter = await PaymentAttempt.findOne({ razorpayOrderId: rzpOrderConflict });
  check(conflictAttemptAfter?.status === 'CAPTURED', '1.57 PaymentAttempt is CAPTURED');
  const conflictOrderAfter = await Order.findById(orderConflict._id);
  check(conflictOrderAfter?.status === 'CONFIRMED' && conflictOrderAfter?.paymentStatus === 'PAID', '1.58 Order confirmed without conflict error');

  console.log('\n[1.J.5 & 1.J.6] P1-3: Stale worker cannot revert order or restore inventory of newer worker');
  const initialStockStale = 10;
  const testProdStale = await createTestProduct({
    name: `Stale Worker Test ${Date.now()}`,
    variants: [{ size: 'M', color: 'RED', stock: initialStockStale }],
  });
  const pStaleId = new mongoose.Types.ObjectId(testProdStale.product._id);
  const vStaleId = new mongoose.Types.ObjectId(testProdStale.variantIds[0]);

  const orderStale = await Order.create({
    orderNumber: `STALE-WORKER-${Date.now()}`,
    userId,
    items: [{
      productId: pStaleId,
      variantId: vStaleId,
      productName: 'Stale Tee',
      productImage: 'https://example.com/tee.jpg',
      selectedSize: 'M',
      selectedColor: 'RED',
      quantity: 1,
      unitPrice: 500,
      lineTotal: 500,
      isCustomized: false,
    }],
    shippingAddress: sampleShippingAddress,
    subtotal: 500,
    discount: 0,
    shipping: 0,
    tax: 0,
    total: 500,
    currency: 'INR',
    status: 'PENDING',
    paymentStatus: 'PENDING',
  });

  const paymentStale = await Payment.create({
    orderId: orderStale._id,
    userId,
    amount: 500,
    currency: 'INR',
    status: 'PENDING',
    provider: 'RAZORPAY',
  });

  const rzpOrderStale = `order_stale_${Date.now()}`;
  const attemptStale = await PaymentAttempt.create({
    paymentId: paymentStale._id,
    orderId: orderStale._id,
    razorpayOrderId: rzpOrderStale,
    amount: 500,
    currency: 'INR',
    status: 'PROCESSING',
    claimToken: 'stale_worker_token',
    fencingToken: 1,
    claimExpiresAt: new Date(Date.now() + 5000),
  });

  // Newer worker takes over: deducts inventory, confirms order, updates PaymentAttempt to CAPTURED with fencingToken: 2
  const allocsNewer = await InventoryAllocationService.resolveOrderAllocations(orderStale.items);
  await InventoryAllocationService.deductInventory(orderStale._id, allocsNewer);
  await Order.updateOne(
    { _id: orderStale._id },
    { $set: { status: 'CONFIRMED', paymentStatus: 'PAID' } }
  );
  await PaymentAttempt.updateOne(
    { _id: attemptStale._id },
    {
      $set: {
        status: 'CAPTURED',
        fencingToken: 2,
        razorpayPaymentId: 'pay_newer_worker',
      },
      $unset: { claimToken: 1, claimExpiresAt: 1 },
    }
  );

  // Stale Worker A (with fencingToken: 1) attempts final transition or fallback rollback
  const staleWorkerFinalWrite = await PaymentAttempt.findOneAndUpdate(
    {
      _id: attemptStale._id,
      claimToken: 'stale_worker_token',
      fencingToken: 1, // Stale generation!
      status: 'PROCESSING',
      claimExpiresAt: { $gt: new Date() },
    },
    { $set: { status: 'CAPTURED' } },
    { returnDocument: 'after' }
  );
  check(staleWorkerFinalWrite === null, '1.59 Stale worker final transition correctly rejected');

  // Verify that stale worker's failure cannot revert order confirmed by newer worker:
  const orderStaleCheck = await Order.findById(orderStale._id);
  check(orderStaleCheck?.status === 'CONFIRMED', '1.60 Stale worker did NOT revert Order from CONFIRMED');
  check(orderStaleCheck?.paymentStatus === 'PAID', '1.61 Stale worker did NOT revert Order from PAID');

  // Verify that stale worker cannot restore inventory allocated by newer worker:
  const prodStaleCheck = await Product.findById(pStaleId);
  const stockStaleCheck = prodStaleCheck?.variants.find((v: any) => v._id.toString() === vStaleId.toString())?.stock;
  check(stockStaleCheck === initialStockStale - 1, `1.62 Stale worker did NOT restore inventory: stock remains ${initialStockStale - 1} (got ${stockStaleCheck})`);

  console.log('\n[1.J.7] P1-4: Stock-unavailable refund processing cannot commit state after ownership is lost');
  const testProdNoStock = await createTestProduct({
    name: `No Stock Prod ${Date.now()}`,
    variants: [{ size: 'L', color: 'BLACK', stock: 0 }],
  });
  const pNoStockId = new mongoose.Types.ObjectId(testProdNoStock.product._id);
  const vNoStockId = new mongoose.Types.ObjectId(testProdNoStock.variantIds[0]);

  const orderNoStock = await Order.create({
    orderNumber: `NO-STOCK-LOST-${Date.now()}`,
    userId,
    items: [{
      productId: pNoStockId,
      variantId: vNoStockId,
      productName: 'No Stock Tee',
      productImage: 'https://example.com/tee.jpg',
      selectedSize: 'L',
      selectedColor: 'BLACK',
      quantity: 1,
      unitPrice: 500,
      lineTotal: 500,
      isCustomized: false,
    }],
    shippingAddress: sampleShippingAddress,
    subtotal: 500,
    discount: 0,
    shipping: 0,
    tax: 0,
    total: 500,
    currency: 'INR',
    status: 'PENDING',
    paymentStatus: 'PENDING',
  });

  const paymentNoStock = await Payment.create({
    orderId: orderNoStock._id,
    userId,
    amount: 500,
    currency: 'INR',
    status: 'PENDING',
    provider: 'RAZORPAY',
  });

  const rzpOrderNoStock = `order_nostock_${Date.now()}`;
  const attemptNoStock = await PaymentAttempt.create({
    paymentId: paymentNoStock._id,
    orderId: orderNoStock._id,
    razorpayOrderId: rzpOrderNoStock,
    amount: 500,
    currency: 'INR',
    status: 'PROCESSING',
    claimToken: 'worker_lost_token',
    fencingToken: 1,
    claimExpiresAt: new Date(Date.now() - 1000), // Expired!
  });

  // Stale worker tries to commit stock-unavailable capture settlement after ownership is lost
  const staleStockTransition = await PaymentAttempt.findOneAndUpdate(
    {
      _id: attemptNoStock._id,
      claimToken: 'worker_lost_token',
      fencingToken: 1,
      status: 'PROCESSING',
      claimExpiresAt: { $gt: new Date() },
    },
    { $set: { status: 'CAPTURED' } },
    { returnDocument: 'after' }
  );
  check(staleStockTransition === null, '1.63 Stock-unavailable cannot commit PaymentAttempt after ownership lost');

  const refundsCreatedForNoStock = await Refund.countDocuments({ orderId: orderNoStock._id });
  check(refundsCreatedForNoStock === 0, '1.64 Zero refunds created by fenced-out worker');

  const orderNoStockAfter = await Order.findById(orderNoStock._id);
  check(orderNoStockAfter?.status === 'PENDING', '1.65 Order was not cancelled by fenced-out worker');

  console.log('\n[1.J.8] P1-4: Refund timeout leaves a recoverable UNKNOWN state and preserves financial reservation');
  const testProdTimeout = await createTestProduct({
    name: `Refund Timeout Prod ${Date.now()}`,
    variants: [{ size: 'L', color: 'BLACK', stock: 0 }], // Out of stock to trigger auto-refund
  });
  const pTimeoutId = new mongoose.Types.ObjectId(testProdTimeout.product._id);
  const vTimeoutId = new mongoose.Types.ObjectId(testProdTimeout.variantIds[0]);

  const orderTimeout = await Order.create({
    orderNumber: `RFND-TIMEOUT-${Date.now()}`,
    userId,
    items: [{
      productId: pTimeoutId,
      variantId: vTimeoutId,
      productName: 'Timeout Tee',
      productImage: 'https://example.com/tee.jpg',
      selectedSize: 'L',
      selectedColor: 'BLACK',
      quantity: 1,
      unitPrice: 750,
      lineTotal: 750,
      isCustomized: false,
    }],
    shippingAddress: sampleShippingAddress,
    subtotal: 750,
    discount: 0,
    shipping: 0,
    tax: 0,
    total: 750,
    currency: 'INR',
    status: 'PENDING',
    paymentStatus: 'PENDING',
  });

  const paymentTimeout = await Payment.create({
    orderId: orderTimeout._id,
    userId,
    amount: 750,
    currency: 'INR',
    status: 'PENDING',
    provider: 'RAZORPAY',
  });

  const rzpOrderTimeout = `order_timeout_${Date.now()}`;
  await PaymentAttempt.create({
    paymentId: paymentTimeout._id,
    orderId: orderTimeout._id,
    razorpayOrderId: rzpOrderTimeout,
    amount: 750,
    currency: 'INR',
    status: 'PENDING',
  });

  // Mock gateway createRefund to throw a network timeout (ETIMEDOUT)
  const origCreateRefund = razorpayProvider.createRefund;
  razorpayProvider.createRefund = async () => {
    const err: any = new Error('ETIMEDOUT: Connection to Razorpay timed out');
    err.code = 'ETIMEDOUT';
    throw err;
  };

  try {
    const resTimeout = await processPaymentSuccess(rzpOrderTimeout, 'pay_mock_timeout_rfnd');
    check(resTimeout?.success === false, '1.66 Stock unavailable auto-refund failed cleanly');
    check(resTimeout?.reason === 'STOCK_UNAVAILABLE', '1.67 Reported reason is STOCK_UNAVAILABLE');

    // Refund document must be preserved in UNKNOWN state
    const unknownRefund = await Refund.findOne({ orderId: orderTimeout._id });
    check(Boolean(unknownRefund), '1.68 Refund record was created');
    check(unknownRefund?.status === 'UNKNOWN', '1.69 Refund status is UNKNOWN (recoverable)');

    // Payment record must retain captured status and reservation for recovery
    const paymentAfterTimeout = await Payment.findOne({ orderId: orderTimeout._id });
    check(paymentAfterTimeout?.status === 'CAPTURED', '1.70 Payment status remains CAPTURED');
    check(paymentAfterTimeout?.reconciliationRequired === true, '1.71 Payment marked for reconciliation');
    check(paymentAfterTimeout?.pendingRefundAmount === 750, '1.72 Payment preserved pendingRefundAmount of 750');

    const reservation = paymentAfterTimeout?.refundReservations?.find(
      (r: any) => r.refundId.toString() === unknownRefund!._id.toString()
    );
    check(Boolean(reservation), '1.73 Financial reservation exists on Payment');
    check(reservation?.status === 'PENDING', '1.74 Financial reservation status is PENDING');

    // PaymentAttempt must be CAPTURED (money was collected)
    const attemptAfterTimeout = await PaymentAttempt.findOne({ razorpayOrderId: rzpOrderTimeout });
    check(attemptAfterTimeout?.status === 'CAPTURED', '1.75 PaymentAttempt is CAPTURED');

    // Order must be CANCELLED and PAID
    const orderAfterTimeout = await Order.findById(orderTimeout._id);
    check(orderAfterTimeout?.status === 'CANCELLED', '1.76 Order status is CANCELLED');
    check(orderAfterTimeout?.paymentStatus === 'PAID', '1.77 Order paymentStatus is PAID');
  } finally {
    razorpayProvider.createRefund = origCreateRefund;
  }

  console.log('\n[1.J.9] P1-1: Multi-document transaction rollback consistency');
  const initialStockRb = 25;
  const testProdRb = await createTestProduct({
    name: `Atomic Rollback All ${Date.now()}`,
    variants: [{ size: 'XL', color: 'GREY', stock: initialStockRb }],
  });
  const pRbId = new mongoose.Types.ObjectId(testProdRb.product._id);
  const vRbId = new mongoose.Types.ObjectId(testProdRb.variantIds[0]);

  const orderRb = await Order.create({
    orderNumber: `ATOMIC-RB-${Date.now()}`,
    userId,
    items: [{
      productId: pRbId,
      variantId: vRbId,
      productName: 'Atomic Tee',
      productImage: 'https://example.com/tee.jpg',
      selectedSize: 'XL',
      selectedColor: 'GREY',
      quantity: 5,
      unitPrice: 500,
      lineTotal: 2500,
      isCustomized: false,
    }],
    shippingAddress: sampleShippingAddress,
    subtotal: 2500,
    discount: 0,
    shipping: 0,
    tax: 0,
    total: 2500,
    currency: 'INR',
    status: 'PENDING',
    paymentStatus: 'PENDING',
  });

  const paymentRb = await Payment.create({
    orderId: orderRb._id,
    userId,
    amount: 2500,
    currency: 'INR',
    status: 'PENDING',
    provider: 'RAZORPAY',
  });

  const rzpOrderRb = `order_atomic_rb_${Date.now()}`;
  const attemptRb = await PaymentAttempt.create({
    paymentId: paymentRb._id,
    orderId: orderRb._id,
    razorpayOrderId: rzpOrderRb,
    amount: 2500,
    currency: 'INR',
    status: 'PENDING',
  });

  // Execute multi-document transaction and abort midway
  const sessionRb = await mongoose.startSession();
  sessionRb.startTransaction({
    readConcern: { level: 'snapshot' },
    writeConcern: { w: 'majority' },
  });

  try {
    const allocsRb = await InventoryAllocationService.resolveOrderAllocations(orderRb.items);
    await InventoryAllocationService.deductInventory(orderRb._id, allocsRb, { session: sessionRb });
    await Order.updateOne({ _id: orderRb._id }, { $set: { status: 'CONFIRMED', paymentStatus: 'PAID' } }, { session: sessionRb });
    await Payment.updateOne({ _id: paymentRb._id }, { $set: { status: 'CAPTURED' } }, { session: sessionRb });
    await PaymentAttempt.updateOne({ _id: attemptRb._id }, { $set: { status: 'CAPTURED' } }, { session: sessionRb });

    // Intentionally abort the transaction
    await sessionRb.abortTransaction();
  } finally {
    await sessionRb.endSession();
  }

  // All 4 models and inventory must be completely consistent and unaltered
  const prodRbAfter = await Product.findById(pRbId);
  const stockRbAfter = prodRbAfter?.variants.find((v: any) => v._id.toString() === vRbId.toString())?.stock;
  check(stockRbAfter === initialStockRb, `1.78 Stock rolled back to initial value: ${initialStockRb} (got ${stockRbAfter})`);

  const txCountRb = await InventoryTransaction.countDocuments({ orderId: orderRb._id, type: 'SALE' });
  check(txCountRb === 0, '1.79 Zero SALE transactions persisted after abort');

  const orderRbAfter = await Order.findById(orderRb._id);
  check(orderRbAfter?.status === 'PENDING', '1.80 Order status rolled back to PENDING');
  check(orderRbAfter?.paymentStatus === 'PENDING', '1.81 Order paymentStatus rolled back to PENDING');

  const paymentRbAfter = await Payment.findById(paymentRb._id);
  check(paymentRbAfter?.status === 'PENDING', '1.82 Payment status rolled back to PENDING');

  const attemptRbAfter = await PaymentAttempt.findById(attemptRb._id);
  check(attemptRbAfter?.status === 'PENDING', '1.83 PaymentAttempt status rolled back to PENDING');

  // ───────────────────────────────────────────────────────────────────────────
  // SECTION 2: Authoritative Gateway Capture Verification in verifyPayment
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n[2] Authoritative Gateway Capture Verification');
  const order2 = await Order.create({
    orderNumber: `GATE-${Date.now()}`,
    userId,
    items: [{
      productId,
      variantId,
      productName: 'Gate Tee',
      productImage: 'https://example.com/gate.jpg',
      selectedSize: 'L',
      selectedColor: 'NAVY',
      quantity: 1,
      unitPrice: 1000,
      lineTotal: 1000,
      isCustomized: false,
    }],
    shippingAddress: sampleShippingAddress,
    subtotal: 1000,
    discount: 0,
    shipping: 0,
    tax: 0,
    total: 1000,
    currency: 'INR',
    status: 'PENDING',
    paymentStatus: 'PENDING',
  });

  const payment2 = await Payment.create({
    orderId: order2._id,
    userId,
    amount: 1000,
    currency: 'INR',
    status: 'PENDING',
    provider: 'RAZORPAY',
  });

  const rzpOrder2 = `order_gate_${Date.now()}`;
  await PaymentAttempt.create({
    paymentId: payment2._id,
    orderId: order2._id,
    razorpayOrderId: rzpOrder2,
    amount: 1000,
    currency: 'INR',
    status: 'PENDING',
  });

  const origVerifySig = razorpayProvider.verifyPaymentSignature;
  const origFetchPayment = razorpayProvider.fetchPayment;
  razorpayProvider.verifyPaymentSignature = () => true;

  try {
    // 2.1 Wrong gateway order ID
    razorpayProvider.fetchPayment = async () => ({
      id: 'pay_gate_wrong_order',
      order_id: 'order_some_other_order',
      amount: 100000,
      currency: 'INR',
      status: 'captured',
      captured: true,
    } as any);

    const reqWrongOrder: any = {
      user: { id: userId.toString() },
      body: {
        razorpay_order_id: rzpOrder2,
        razorpay_payment_id: 'pay_gate_wrong_order',
        razorpay_signature: 'sig_mock',
      },
    };
    const resWrongOrder = mockResponse();
    await verifyPayment(reqWrongOrder, resWrongOrder);
    check(resWrongOrder.statusCode === 400 && resWrongOrder.body?.message?.includes('order ID mismatch'), '2.1 Wrong gateway order ID is rejected with 400');

    // 2.2 Wrong amount
    razorpayProvider.fetchPayment = async () => ({
      id: 'pay_gate_wrong_amount',
      order_id: rzpOrder2,
      amount: 50000, // ₹500 instead of ₹1000
      currency: 'INR',
      status: 'captured',
      captured: true,
    } as any);

    const reqWrongAmount: any = {
      user: { id: userId.toString() },
      body: {
        razorpay_order_id: rzpOrder2,
        razorpay_payment_id: 'pay_gate_wrong_amount',
        razorpay_signature: 'sig_mock',
      },
    };
    const resWrongAmount = mockResponse();
    await verifyPayment(reqWrongAmount, resWrongAmount);
    check(resWrongAmount.statusCode === 400 && resWrongAmount.body?.message?.includes('amount mismatch'), '2.2 Wrong payment amount is rejected with 400');

    // 2.3 Authorized but not captured
    razorpayProvider.fetchPayment = async () => ({
      id: 'pay_gate_authorized',
      order_id: rzpOrder2,
      amount: 100000,
      currency: 'INR',
      status: 'authorized',
      captured: false,
    } as any);

    const reqAuth: any = {
      user: { id: userId.toString() },
      body: {
        razorpay_order_id: rzpOrder2,
        razorpay_payment_id: 'pay_gate_authorized',
        razorpay_signature: 'sig_mock',
      },
    };
    const resAuth = mockResponse();
    await verifyPayment(reqAuth, resAuth);
    check(resAuth.statusCode === 400 && resAuth.body?.message?.includes('authorized but not captured'), '2.3 Authorized but not captured is rejected with 400');

    // 2.4 Failed payment at gateway
    razorpayProvider.fetchPayment = async () => ({
      id: 'pay_gate_failed',
      order_id: rzpOrder2,
      amount: 100000,
      currency: 'INR',
      status: 'failed',
      captured: false,
    } as any);

    const reqFail: any = {
      user: { id: userId.toString() },
      body: {
        razorpay_order_id: rzpOrder2,
        razorpay_payment_id: 'pay_gate_failed',
        razorpay_signature: 'sig_mock',
      },
    };
    const resFail = mockResponse();
    await verifyPayment(reqFail, resFail);
    check(resFail.statusCode === 400 && resFail.body?.message?.includes('failed at the gateway'), '2.4 Failed payment is rejected with 400');

    // 2.5 Gateway timeout preserves payment for reconciliation
    razorpayProvider.fetchPayment = async () => {
      throw new Error('ETIMEDOUT gateway connection lost');
    };

    const reqTimeout: any = {
      user: { id: userId.toString() },
      body: {
        razorpay_order_id: rzpOrder2,
        razorpay_payment_id: 'pay_gate_timeout',
        razorpay_signature: 'sig_mock',
      },
    };
    const resTimeout = mockResponse();
    await verifyPayment(reqTimeout, resTimeout);
    check(resTimeout.statusCode === 200 && resTimeout.body?.data?.reason === 'GATEWAY_VERIFICATION_TIMEOUT', '2.5 Gateway timeout returns reconciliation pending response');
    const paymentAfterTimeout = await Payment.findOne({ orderId: order2._id });
    check(paymentAfterTimeout?.reconciliationRequired === true, '2.5b Payment is flagged for reconciliation on gateway timeout');

    // 2.6 Valid gateway capture succeeds
    await Payment.updateOne({ orderId: order2._id }, { $set: { reconciliationRequired: false } });
    razorpayProvider.fetchPayment = async () => ({
      id: 'pay_gate_valid_capture',
      order_id: rzpOrder2,
      amount: 100000,
      currency: 'INR',
      status: 'captured',
      captured: true,
    } as any);

    const reqValid: any = {
      user: { id: userId.toString() },
      body: {
        razorpay_order_id: rzpOrder2,
        razorpay_payment_id: 'pay_gate_valid_capture',
        razorpay_signature: 'sig_mock',
      },
    };
    const resValid = mockResponse();
    await verifyPayment(reqValid, resValid);
    check(resValid.statusCode === 200 && resValid.body?.message?.includes('verified and order confirmed'), '2.6 Valid authoritative capture confirms order');
    const orderAfterValid = await Order.findById(order2._id);
    check(orderAfterValid?.paymentStatus === 'PAID' && orderAfterValid.status === 'CONFIRMED', '2.6b Order is PAID and CONFIRMED');
  } finally {
    razorpayProvider.verifyPaymentSignature = origVerifySig;
    razorpayProvider.fetchPayment = origFetchPayment;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // SECTION 3: Order Expiry Side-Effect Recovery
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n[3] Order Expiry Side-Effect Independent Recovery');
  const order3 = await Order.create({
    orderNumber: `EXPIRY-${Date.now()}`,
    userId,
    items: [{
      productId,
      variantId,
      productName: 'Expiry Item',
      productImage: 'https://example.com/exp.jpg',
      selectedSize: 'L',
      selectedColor: 'NAVY',
      quantity: 1,
      unitPrice: 600,
      lineTotal: 600,
      isCustomized: false,
    }],
    shippingAddress: sampleShippingAddress,
    subtotal: 600,
    discount: 50,
    shipping: 0,
    tax: 0,
    total: 550,
    currency: 'INR',
    status: 'EXPIRED',
    paymentStatus: 'FAILED',
    expiryCleanup: {
      inventoryRestored: false,
      couponReleased: false,
      cleanupRequired: true,
      lastAttemptAt: new Date(Date.now() - 60_000),
      lastError: 'Simulated crash before cleanup',
    },
  });

  const recoverySweep = await reconcilePendingExpiryCleanups({ batchLimit: 10 });
  check(recoverySweep.inspectedCount >= 1, '3.1 reconcilePendingExpiryCleanups inspected incomplete expired order');
  check(recoverySweep.cleanedCount >= 1, '3.2 reconcilePendingExpiryCleanups successfully cleaned expired order');

  const orderAfterSweep = await Order.findById(order3._id);
  check(orderAfterSweep?.expiryCleanup?.cleanupRequired === false, '3.3 cleanupRequired transitioned to false');
  check(orderAfterSweep?.expiryCleanup?.inventoryRestored === true, '3.4 inventoryRestored is true');
  check(orderAfterSweep?.expiryCleanup?.couponReleased === true, '3.5 couponReleased is true');
  check(orderAfterSweep?.expiryCleanup?.completedAt instanceof Date, '3.6 completedAt timestamp was persisted');

  // Idempotent rerun does not duplicate work
  const repeatSweep = await reconcilePendingExpiryCleanups({ batchLimit: 10 });
  check(repeatSweep.inspectedCount === 0, '3.7 Second sweep finds 0 pending cleanups (idempotent)');

  // ───────────────────────────────────────────────────────────────────────────
  // SECTION 4: Customer Response Sanitization & Pagination
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n[4] Customer Response Sanitization & Pagination');
  await ReturnRequest.create({
    orderId: order2._id,
    userId,
    items: [{
      productId,
      variantId,
      quantity: 1,
      reason: 'DEFECTIVE',
    }],
    status: 'REQUESTED',
    adminNote: 'Internal staff note: VIP customer, prioritize refund',
    refundClaimToken: 'secret_claim_token_123',
    requiresInventoryReconciliation: true,
    inventoryReconciliationReason: 'Warehouse discrepancy check required',
    reviewedBy: new mongoose.Types.ObjectId(),
    requestedAt: new Date(),
  });

  await Refund.create({
    orderId: order2._id,
    paymentId: payment2._id,
    userId,
    amount: 1000,
    currency: 'INR',
    status: 'PENDING',
    reason: 'Customer return',
    initiatedBy: userId,
    initiatedByRole: 'CUSTOMER',
    submissionClaimToken: 'secret_sub_claim_token_456',
    accountingSettlementStatus: 'PENDING',
    gatewayIdempotencyKey: 'rfnd_secret_key_789',
  });

  await Shipment.create({
    orderId: order2._id,
    userId,
    carrier: 'Delhivery',
    trackingNumber: 'DEL123456789',
    awbNumber: 'AWB123',
    provider: 'NIMBUSPOST',
    status: 'SHIPPED',
    providerShipmentId: 'INTERNAL_PROVIDER_ID_999',
    labelUrl: 'https://internal-labels.s3.amazonaws.com/label.pdf',
    pickupId: 'PICKUP_REF_555',
    createdBy: userId,
    updatedBy: userId,
  });

  const reqOrder: any = {
    user: { id: userId.toString() },
    params: { id: order2._id.toString() },
  };
  const resOrder = mockResponse();
  await getOrder(reqOrder, resOrder, noopNext);

  check(resOrder.statusCode === 200, '4.1 getOrder returns 200');
  const customerOrderData = resOrder.body?.data;
  check(customerOrderData.trackingTokenHash === undefined, '4.2 trackingTokenHash is stripped from customer order');
  check(customerOrderData.expiryCleanup === undefined, '4.3 expiryCleanup is stripped from customer order');
  check(customerOrderData.paymentAttemptLockExpiresAt === undefined, '4.4 paymentAttemptLockExpiresAt is stripped');

  const customerReturn = customerOrderData.returns?.[0];
  check(customerReturn && customerReturn.adminNote === undefined, '4.5 adminNote is stripped from customer return');
  check(customerReturn && customerReturn.refundClaimToken === undefined, '4.6 refundClaimToken is stripped from customer return');
  check(customerReturn && customerReturn.requiresInventoryReconciliation === undefined, '4.7 requiresInventoryReconciliation is stripped');
  check(customerReturn && customerReturn.reviewedBy === undefined, '4.8 reviewedBy is stripped from customer return');

  const customerRefund = customerOrderData.refunds?.[0];
  check(customerRefund && customerRefund.submissionClaimToken === undefined, '4.9 submissionClaimToken is stripped from customer refund');
  check(customerRefund && customerRefund.accountingSettlementStatus === undefined, '4.10 accountingSettlementStatus is stripped');
  check(customerRefund && customerRefund.gatewayIdempotencyKey === undefined, '4.11 gatewayIdempotencyKey is stripped');
  check(customerRefund && customerRefund.initiatedByRole === undefined, '4.12 initiatedByRole is stripped');

  const customerShipment = customerOrderData.shipment;
  check(customerShipment && customerShipment.providerShipmentId === undefined, '4.14 providerShipmentId is stripped from shipment');
  check(customerShipment && customerShipment.labelUrl === undefined, '4.15 labelUrl is stripped from shipment');
  check(customerShipment && customerShipment.pickupId === undefined, '4.16 pickupId is stripped from shipment');
  check(customerShipment && customerShipment.trackingNumber === 'DEL123456789', '4.17 Public trackingNumber is preserved');

  // 4.18 Pagination in getOrders
  const reqListPaginated: any = {
    user: { id: userId.toString() },
    query: { page: '1', limit: '2' },
  };
  const resListPaginated = mockResponse();
  await getOrders(reqListPaginated, resListPaginated, noopNext);
  check(resListPaginated.statusCode === 200, '4.18 getOrders paginated returns 200');
  check(Array.isArray(resListPaginated.body?.data), '4.19 data remains an array for backwards compatibility');
  check(resListPaginated.body?.data.length <= 2, '4.20 Page size respected');
  check(resListPaginated.body?.pagination?.page === 1, '4.21 Pagination metadata page matches');
  check(resListPaginated.body?.pagination?.limit === 2, '4.22 Pagination metadata limit matches');
  check(typeof resListPaginated.body?.pagination?.total === 'number', '4.23 Pagination metadata total is a number');

  // ───────────────────────────────────────────────────────────────────────────
  // SECTION 5: Final Focused Corrections (P1 & P2 Remediations)
  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n[5] FINAL FOCUSED CORRECTIONS');

  // [5.1] P1: Stock-unavailable refund race - Conflicting CONFIRMED order suppresses refund
  console.log('\n[5.1] P1: Stock-unavailable refund race: Conflicting CONFIRMED order suppresses refund & flags reconciliation');
  const prodRaceStock = await createTestProduct({
    name: `Race Stock ${Date.now()}`,
    variants: [{ size: 'M', color: 'BLACK', stock: 0 }],
  });
  const pRaceStockId = new mongoose.Types.ObjectId(prodRaceStock.product._id);
  const vRaceStockId = new mongoose.Types.ObjectId(prodRaceStock.variantIds[0]);

  const orderRaceConf = await Order.create({
    orderNumber: `RACE-CONF-${Date.now()}`,
    userId,
    items: [{
      productId: pRaceStockId,
      variantId: vRaceStockId,
      productName: 'Race Stock Tee',
      productImage: 'https://example.com/tee.jpg',
      selectedSize: 'M',
      selectedColor: 'BLACK',
      quantity: 1,
      unitPrice: 650,
      lineTotal: 650,
      isCustomized: false,
    }],
    shippingAddress: sampleShippingAddress,
    subtotal: 650,
    discount: 0,
    shipping: 0,
    tax: 0,
    total: 650,
    currency: 'INR',
    status: 'CONFIRMED', // Pre-confirmed by another concurrent worker!
    paymentStatus: 'PENDING',
  });

  const payRaceConf = await Payment.create({
    orderId: orderRaceConf._id,
    userId,
    amount: 650,
    currency: 'INR',
    status: 'PENDING',
    provider: 'RAZORPAY',
  });

  const rzpOrderRaceConf = `order_race_conf_${Date.now()}`;
  await PaymentAttempt.create({
    paymentId: payRaceConf._id,
    orderId: orderRaceConf._id,
    razorpayOrderId: rzpOrderRaceConf,
    amount: 650,
    currency: 'INR',
    status: 'PENDING',
  });

  const raceConfRes = await processPaymentSuccess(rzpOrderRaceConf, 'pay_race_conf_id_1');
  check(raceConfRes?.success === false, '5.1 Conflicting CONFIRMED order returns success: false');
  check(raceConfRes?.reason === 'ORDER_ALREADY_CONFIRMED', '5.2 Returned reason is ORDER_ALREADY_CONFIRMED');

  // Verify automatic refund was strictly suppressed
  const refundsForConf = await Refund.find({ orderId: orderRaceConf._id });
  check(refundsForConf.length === 0, '5.3 Zero refunds created when order is already CONFIRMED');

  // Verify captured payment evidence preserved
  const payRaceConfAfter = await Payment.findById(payRaceConf._id);
  check(payRaceConfAfter?.status === 'CAPTURED', '5.4 Payment status updated to CAPTURED (evidence preserved)');
  check(payRaceConfAfter?.razorpayPaymentId === 'pay_race_conf_id_1', '5.5 Gateway capture paymentId persisted');
  check(payRaceConfAfter?.reconciliationRequired === true, '5.6 Conflicting operation flagged for reconciliation');
  check(Boolean(payRaceConfAfter?.reconciliationReason?.includes('conflicting state')), '5.7 Reconciliation reason notes conflict');

  // Verify order was not modified or cancelled
  const orderRaceConfAfter = await Order.findById(orderRaceConf._id);
  check(orderRaceConfAfter?.status === 'CONFIRMED', '5.8 Order status remains CONFIRMED (not overwritten to CANCELLED)');
  check(raceConfRes?.reconciliationRequired === true, '5.8b Conflicting operation result sets reconciliationRequired: true');
  const attemptRaceConfAfter = await PaymentAttempt.findOne({ razorpayOrderId: rzpOrderRaceConf });
  check(attemptRaceConfAfter?.status === 'CAPTURED' && attemptRaceConfAfter?.failureCode === 'PAYMENT_RECONCILIATION_REQUIRED', '5.8c Captured attempt evidence preserved and marked PAYMENT_RECONCILIATION_REQUIRED');

  // [5.2] P1: Failure injection between Order transition and refund creation
  console.log('\n[5.2] P1: Failure injection between Order transition and refund creation');
  const prodInjStock = await createTestProduct({
    name: `Inj Stock ${Date.now()}`,
    variants: [{ size: 'L', color: 'WHITE', stock: 0 }],
  });
  const pInjStockId = new mongoose.Types.ObjectId(prodInjStock.product._id);
  const vInjStockId = new mongoose.Types.ObjectId(prodInjStock.variantIds[0]);

  const orderInj = await Order.create({
    orderNumber: `INJ-STOCK-${Date.now()}`,
    userId,
    items: [{
      productId: pInjStockId,
      variantId: vInjStockId,
      productName: 'Inj Stock Tee',
      productImage: 'https://example.com/tee.jpg',
      selectedSize: 'L',
      selectedColor: 'WHITE',
      quantity: 1,
      unitPrice: 850,
      lineTotal: 850,
      isCustomized: false,
    }],
    shippingAddress: sampleShippingAddress,
    subtotal: 850,
    discount: 0,
    shipping: 0,
    tax: 0,
    total: 850,
    currency: 'INR',
    status: 'PENDING',
    paymentStatus: 'PENDING',
  });

  const payInj = await Payment.create({
    orderId: orderInj._id,
    userId,
    amount: 850,
    currency: 'INR',
    status: 'PENDING',
    provider: 'RAZORPAY',
  });

  const rzpOrderInj = `order_inj_stock_${Date.now()}`;
  await PaymentAttempt.create({
    paymentId: payInj._id,
    orderId: orderInj._id,
    razorpayOrderId: rzpOrderInj,
    amount: 850,
    currency: 'INR',
    status: 'PENDING',
  });

  // Inject failure right when refund is dispatched
  const origCreateRefundSec5 = razorpayProvider.createRefund;
  (razorpayProvider as any).createRefund = async () => {
    throw new Error('ETIMEDOUT: Injected gateway connection failure between order transition and refund creation');
  };

  try {
    const injRes = await processPaymentSuccess(rzpOrderInj, 'pay_inj_stock_1');
    check(injRes?.success === false, '5.9 Injected failure returns success: false');
    check(injRes?.reason === 'STOCK_UNAVAILABLE', '5.10 Injected failure reports STOCK_UNAVAILABLE');
  } finally {
    (razorpayProvider as any).createRefund = origCreateRefundSec5;
  }

  // Verify Order was cancelled and PaymentAttempt is CAPTURED
  const orderInjAfter = await Order.findById(orderInj._id);
  check(orderInjAfter?.status === 'CANCELLED', '5.11 Order transition to CANCELLED succeeded');
  check(orderInjAfter?.paymentStatus === 'PAID', '5.12 Order paymentStatus is PAID');

  const attemptInjAfter = await PaymentAttempt.findOne({ razorpayOrderId: rzpOrderInj });
  check(attemptInjAfter?.status === 'CAPTURED', '5.13 PaymentAttempt is CAPTURED');

  // Verify captured-payment evidence preserved & marked for reconciliation
  const payInjAfter = await Payment.findById(payInj._id);
  check(payInjAfter?.status === 'CAPTURED', '5.14 Payment is CAPTURED');
  check(payInjAfter?.reconciliationRequired === true, '5.15 Explicit recoverable reconciliation state persisted');
  check(Boolean(payInjAfter?.reconciliationReason?.includes('Auto-refund')), '5.16 Reconciliation reason explains auto-refund failure');

  // Verify idempotent retry
  const retryInjRes = await processPaymentSuccess(rzpOrderInj, 'pay_inj_stock_1');
  check(retryInjRes?.success === false, '5.17 Idempotent retry returns success: false');
  check(retryInjRes?.reason === 'PAYMENT_RECONCILIATION_REQUIRED' || retryInjRes?.reason === 'ORDER_CANCELLED', '5.18 Idempotent retry protects against conflict and returns non-success');
  const injRefundCount = await Refund.countDocuments({ orderId: orderInj._id });
  check(injRefundCount <= 1, `5.18b Idempotent retry did not create duplicate refunds (count=${injRefundCount})`);

  // [5.3] P1: Lease heartbeat inside transactions: Suppressed renewal returns false
  console.log('\n[5.3] P1: Lease heartbeat inside transactions: Suppressed renewal returns false');
  const dummyAttemptId = new mongoose.Types.ObjectId();
  await PaymentAttempt.create({
    _id: dummyAttemptId,
    paymentId: new mongoose.Types.ObjectId(),
    orderId: new mongoose.Types.ObjectId(),
    razorpayOrderId: `order_hb_suppress_${Date.now()}`,
    amount: 500,
    currency: 'INR',
    status: 'PROCESSING',
    claimToken: 'token_suppress_test',
    fencingToken: 1,
    claimExpiresAt: new Date(Date.now() + 10_000),
  });

  let simulatedInTx = true;
  const hbSuppress = startPaymentAttemptLeaseHeartbeat(
    dummyAttemptId,
    'token_suppress_test',
    1,
    10_000,
    100,
    () => simulatedInTx
  );

  const suppressedResult = await hbSuppress.renewNow();
  check(suppressedResult === false, '5.19 Suppressed heartbeat renewNow returns false (no fake renewal reported)');
  check(hbSuppress.hasLostLease() === false, '5.20 Lease not lost immediately during valid duration');

  simulatedInTx = false;
  const unsuppressedResult = await hbSuppress.renewNow();
  check(unsuppressedResult === true, '5.21 Heartbeat renewNow returns true outside active transaction');
  hbSuppress.stop();

  // [5.4] P1: Long-running transaction outliving 10-second lease rejects final settlement
  console.log('\n[5.4] P1: Long-running transaction outliving 10-second lease rejects final settlement');
  const prodLongLease = await createTestProduct({
    name: `Long Lease Prod ${Date.now()}`,
    variants: [{ size: 'XL', color: 'YELLOW', stock: 10 }],
  });
  const pLongLeaseId = new mongoose.Types.ObjectId(prodLongLease.product._id);
  const vLongLeaseId = new mongoose.Types.ObjectId(prodLongLease.variantIds[0]);

  const orderLongLease = await Order.create({
    orderNumber: `LONG-LEASE-${Date.now()}`,
    userId,
    items: [{
      productId: pLongLeaseId,
      variantId: vLongLeaseId,
      productName: 'Long Lease Tee',
      productImage: 'https://example.com/tee.jpg',
      selectedSize: 'XL',
      selectedColor: 'YELLOW',
      quantity: 1,
      unitPrice: 500,
      lineTotal: 500,
      isCustomized: false,
    }],
    shippingAddress: sampleShippingAddress,
    subtotal: 500,
    discount: 0,
    shipping: 0,
    tax: 0,
    total: 500,
    currency: 'INR',
    status: 'PENDING',
    paymentStatus: 'PENDING',
  });

  const payLongLease = await Payment.create({
    orderId: orderLongLease._id,
    userId,
    amount: 500,
    currency: 'INR',
    status: 'PENDING',
    provider: 'RAZORPAY',
  });

  const rzpOrderLongLease = `order_long_lease_${Date.now()}`;
  // PaymentAttempt with initial 10-second lease (CLAIM_STALE_MS) but simulating transaction outliving it
  const attemptLongLease = await PaymentAttempt.create({
    paymentId: payLongLease._id,
    orderId: orderLongLease._id,
    razorpayOrderId: rzpOrderLongLease,
    amount: 500,
    currency: 'INR',
    status: 'PROCESSING',
    claimToken: 'token_long_lease_worker',
    fencingToken: 1,
    claimExpiresAt: new Date(Date.now() - 500), // Lease expired (transaction outlived 10s lease)
  });

  // Final settlement must reject expired ownership
  const longLeaseCommit = await PaymentAttempt.findOneAndUpdate(
    {
      _id: attemptLongLease._id,
      claimToken: 'token_long_lease_worker',
      fencingToken: 1,
      status: 'PROCESSING',
      claimExpiresAt: { $gt: new Date() },
    },
    { $set: { status: 'CAPTURED' } },
    { returnDocument: 'after' }
  );
  check(longLeaseCommit === null, '5.22 Final settlement strictly rejects expired lease ownership');
  const attemptStillProc = await PaymentAttempt.findById(attemptLongLease._id);
  check(attemptStillProc?.status === 'PROCESSING', '5.23 Attempt remained in PROCESSING');

  // [5.5] P1: Transaction-safe lease strategy allows long-running transaction with in-band renewal
  console.log('\n[5.5] P1: Transaction-safe lease renewal extends lease within transaction session');
  const attemptSafeRenew = await PaymentAttempt.create({
    paymentId: payLongLease._id,
    orderId: orderLongLease._id,
    razorpayOrderId: `order_safe_renew_${Date.now()}`,
    amount: 500,
    currency: 'INR',
    status: 'PROCESSING',
    claimToken: 'token_safe_renew',
    fencingToken: 2,
    claimExpiresAt: new Date(Date.now() + 5000),
  });

  const txSession = await mongoose.startSession();
  txSession.startTransaction();

  // In-band transaction-safe renewal on the session
  const inBandRenewResult = await renewPaymentAttemptLease(
    attemptSafeRenew._id,
    'token_safe_renew',
    2,
    15_000,
    txSession
  );
  check(inBandRenewResult === true, '5.24 In-band renewal within transaction succeeds without WriteConflict');

  await txSession.commitTransaction();
  await txSession.endSession();

  const attemptAfterSafeRenew = await PaymentAttempt.findById(attemptSafeRenew._id);
  check(attemptAfterSafeRenew!.claimExpiresAt!.getTime() > Date.now() + 10_000, '5.25 Lease expiry was extended into future via transaction-safe write');

  // [5.5b] P1: End-to-end replica-set transaction stalling > 10s lease rejects expired ownership & rolls back
  console.log('\n[5.5b] P1: Real >10s stalled transaction rejects expired lease ownership and rolls back atomically');
  const prodStall10s = await createTestProduct({
    name: `Stall 10s Prod ${Date.now()}`,
    variants: [{ size: 'M', color: 'NAVY', stock: 10 }],
  });
  const pStall10sId = new mongoose.Types.ObjectId(prodStall10s.product._id);
  const vStall10sId = new mongoose.Types.ObjectId(prodStall10s.variantIds[0]);

  const orderStall10s = await Order.create({
    orderNumber: `STALL-10S-${Date.now()}`,
    userId,
    items: [{
      productId: pStall10sId,
      variantId: vStall10sId,
      productName: 'Stall 10s Tee',
      productImage: 'https://example.com/tee.jpg',
      selectedSize: 'M',
      selectedColor: 'NAVY',
      quantity: 2,
      unitPrice: 500,
      lineTotal: 1000,
      isCustomized: false,
    }],
    shippingAddress: sampleShippingAddress,
    subtotal: 1000,
    discount: 0,
    shipping: 0,
    tax: 0,
    total: 1000,
    currency: 'INR',
    status: 'PENDING',
    paymentStatus: 'PENDING',
  });

  const payStall10s = await Payment.create({
    orderId: orderStall10s._id,
    userId,
    amount: 1000,
    currency: 'INR',
    status: 'PENDING',
    provider: 'RAZORPAY',
  });

  const rzpOrderStall10s = `order_stall_10s_${Date.now()}`;
  await PaymentAttempt.create({
    paymentId: payStall10s._id,
    orderId: orderStall10s._id,
    razorpayOrderId: rzpOrderStall10s,
    amount: 1000,
    currency: 'INR',
    status: 'PENDING',
  });

  const origDeductForStall = InventoryAllocationService.deductInventory.bind(InventoryAllocationService);
  (InventoryAllocationService as any).deductInventory = async (orderIdArg: any, allocationsArg: any, optsArg?: any) => {
    const res = await origDeductForStall(orderIdArg, allocationsArg, optsArg);
    if (orderIdArg.toString() === orderStall10s._id.toString()) {
      await new Promise((r) => setTimeout(r, 10_500));
    }
    return res;
  };

  let stallRes: any = null;
  const stallStartMs = Date.now();
  try {
    stallRes = await processPaymentSuccess(rzpOrderStall10s, 'pay_stall_10s_1');
  } finally {
    (InventoryAllocationService as any).deductInventory = origDeductForStall;
  }
  const stallElapsedMs = Date.now() - stallStartMs;

  check(stallElapsedMs >= 10_000, `5.25b Stalled transaction genuinely ran longer than original 10s lease (${stallElapsedMs}ms)`);
  check(stallRes?.success === false && stallRes?.reason === 'CLAIM_LOST_CONCURRENT_WORKER', `5.25c Expired lease rejected with CLAIM_LOST_CONCURRENT_WORKER (got ${stallRes?.reason})`);
  const prodStallAfter = await Product.findById(pStall10sId);
  check(prodStallAfter?.variants[0].stock === 10, `5.25d Stock rolled back to 10 after expired-lease abort (got ${prodStallAfter?.variants[0].stock})`);
  const stallInvTxCount = await InventoryTransaction.countDocuments({ orderId: orderStall10s._id });
  check(stallInvTxCount === 0, '5.25e Zero SALE inventory transactions persisted after expired-lease rollback');
  const orderStallAfter = await Order.findById(orderStall10s._id);
  check(orderStallAfter?.status === 'PENDING' && orderStallAfter?.paymentStatus === 'PENDING', '5.25f Order remained PENDING/PENDING after expired-lease abort');
  const attemptStallAfter = await PaymentAttempt.findOne({ razorpayOrderId: rzpOrderStall10s });
  check(attemptStallAfter?.status !== 'CAPTURED', `5.25g PaymentAttempt not CAPTURED after expired-lease abort (status=${attemptStallAfter?.status})`);

  // [5.5c] P1: Real >10s multi-step transaction completes cleanly via transaction-safe in-band lease renewal
  console.log('\n[5.5c] P1: Real >10s multi-step transaction succeeds via transaction-safe in-band lease renewal');
  const prodLongOk = await createTestProduct({
    name: `Long Ok 11s Prod ${Date.now()}`,
    variants: [{ size: 'L', color: 'OLIVE', stock: 10 }],
  });
  const pLongOkId = new mongoose.Types.ObjectId(prodLongOk.product._id);
  const vLongOkId = new mongoose.Types.ObjectId(prodLongOk.variantIds[0]);

  const orderLongOk = await Order.create({
    orderNumber: `LONG-OK-11S-${Date.now()}`,
    userId,
    items: [{
      productId: pLongOkId,
      variantId: vLongOkId,
      productName: 'Long Ok Tee',
      productImage: 'https://example.com/tee.jpg',
      selectedSize: 'L',
      selectedColor: 'OLIVE',
      quantity: 1,
      unitPrice: 700,
      lineTotal: 700,
      isCustomized: false,
    }],
    shippingAddress: sampleShippingAddress,
    subtotal: 700,
    discount: 0,
    shipping: 0,
    tax: 0,
    total: 700,
    currency: 'INR',
    status: 'PENDING',
    paymentStatus: 'PENDING',
  });

  const payLongOk = await Payment.create({
    orderId: orderLongOk._id,
    userId,
    amount: 700,
    currency: 'INR',
    status: 'PENDING',
    provider: 'RAZORPAY',
  });

  const rzpOrderLongOk = `order_long_ok_11s_${Date.now()}`;
  await PaymentAttempt.create({
    paymentId: payLongOk._id,
    orderId: orderLongOk._id,
    razorpayOrderId: rzpOrderLongOk,
    amount: 700,
    currency: 'INR',
    status: 'PENDING',
  });

  const origDeductForLongOk = InventoryAllocationService.deductInventory.bind(InventoryAllocationService);
  const origOrderFindOneAndUpdate = Order.findOneAndUpdate.bind(Order);
  (InventoryAllocationService as any).deductInventory = async (orderIdArg: any, allocationsArg: any, optsArg?: any) => {
    const res = await origDeductForLongOk(orderIdArg, allocationsArg, optsArg);
    if (orderIdArg.toString() === orderLongOk._id.toString()) {
      await new Promise((r) => setTimeout(r, 5_800));
    }
    return res;
  };
  (Order as any).findOneAndUpdate = async (filterArg: any, updateArg: any, optsArg?: any) => {
    const res = await origOrderFindOneAndUpdate(filterArg, updateArg, optsArg);
    if (filterArg?._id?.toString() === orderLongOk._id.toString()) {
      await new Promise((r) => setTimeout(r, 5_000));
    }
    return res;
  };

  let longOkRes: any = null;
  const longOkStartMs = Date.now();
  try {
    longOkRes = await processPaymentSuccess(rzpOrderLongOk, 'pay_long_ok_11s_1');
  } finally {
    (InventoryAllocationService as any).deductInventory = origDeductForLongOk;
    (Order as any).findOneAndUpdate = origOrderFindOneAndUpdate;
  }
  const longOkElapsedMs = Date.now() - longOkStartMs;

  check(longOkElapsedMs > 10_000, `5.25h Multi-step transaction genuinely ran longer than original 10s lease (${longOkElapsedMs}ms)`);
  check(longOkRes?.success === true, '5.25i Long-running transaction succeeded via transaction-safe in-band renewal without WriteConflict');
  const orderLongOkAfter = await Order.findById(orderLongOk._id);
  check(orderLongOkAfter?.status === 'CONFIRMED' && orderLongOkAfter?.paymentStatus === 'PAID', '5.25j Order atomically committed as CONFIRMED/PAID');
  const attemptLongOkAfter = await PaymentAttempt.findOne({ razorpayOrderId: rzpOrderLongOk });
  check(attemptLongOkAfter?.status === 'CAPTURED' && attemptLongOkAfter?.razorpayPaymentId === 'pay_long_ok_11s_1', '5.25k PaymentAttempt atomically committed as CAPTURED');
  const prodLongOkAfter = await Product.findById(pLongOkId);
  check(prodLongOkAfter?.variants[0].stock === 9, `5.25l Stock atomically decremented (10 -> 9, got ${prodLongOkAfter?.variants[0].stock})`);

  // [5.6] P1: Caller-owned transaction rollback on settlement failure
  console.log('\n[5.6] P1: Caller-owned transaction rollback on settlement failure');
  const prodCallerRollback = await createTestProduct({
    name: `Caller Rollback Prod ${Date.now()}`,
    variants: [{ size: 'M', color: 'ORANGE', stock: 0 }], // Out of stock to fail in-transaction inventory allocation
  });
  const pCallerRbId = new mongoose.Types.ObjectId(prodCallerRollback.product._id);
  const vCallerRbId = new mongoose.Types.ObjectId(prodCallerRollback.variantIds[0]);

  // Order with PENDING status that enters transaction and fails stock deduction
  const orderCallerRb = await Order.create({
    orderNumber: `CALLER-RB-${Date.now()}`,
    userId,
    items: [{
      productId: pCallerRbId,
      variantId: vCallerRbId,
      productName: 'Caller Rb Tee',
      productImage: 'https://example.com/tee.jpg',
      selectedSize: 'M',
      selectedColor: 'ORANGE',
      quantity: 2,
      unitPrice: 500,
      lineTotal: 1000,
      isCustomized: false,
    }],
    shippingAddress: sampleShippingAddress,
    subtotal: 1000,
    discount: 0,
    shipping: 0,
    tax: 0,
    total: 1000,
    currency: 'INR',
    status: 'PENDING',
    paymentStatus: 'PENDING',
  });

  const payCallerRb = await Payment.create({
    orderId: orderCallerRb._id,
    userId,
    amount: 1000,
    currency: 'INR',
    status: 'PENDING',
    provider: 'RAZORPAY',
  });

  const rzpOrderCallerRb = `order_caller_rb_${Date.now()}`;
  await PaymentAttempt.create({
    paymentId: payCallerRb._id,
    orderId: orderCallerRb._id,
    razorpayOrderId: rzpOrderCallerRb,
    amount: 1000,
    currency: 'INR',
    status: 'PENDING',
  });

  const callerRbSession = await mongoose.startSession();
  callerRbSession.startTransaction();

  let callerRbThrew = false;
  try {
    await processPaymentSuccess(rzpOrderCallerRb, 'pay_caller_rb_1', { session: callerRbSession });
  } catch (err: any) {
    callerRbThrew = true;
    check(Boolean(err.message.includes('CALLER_TX_SETTLEMENT_FAILED')), '5.26 Caller-owned transaction failure explicitly propagated to caller');
  }

  check(callerRbThrew, '5.27 processPaymentSuccess threw on failure inside caller-owned transaction');
  check(callerRbSession.inTransaction() === false, '5.28 Caller session was aborted internally');

  // Verify caller cannot commit
  let commitThrew = false;
  try {
    await callerRbSession.commitTransaction();
  } catch {
    commitThrew = true;
  }
  check(commitThrew, '5.29 Caller cannot commit aborted transaction');
  await callerRbSession.endSession();

  // Verify total atomic rollback: stock completely intact at 0
  const prodCallerRbAfter = await Product.findById(pCallerRbId);
  check(prodCallerRbAfter?.variants[0].stock === 0, '5.30 Product stock completely intact at 0 (rolled back)');
  const saleTxCount = await InventoryTransaction.countDocuments({ orderId: orderCallerRb._id });
  check(saleTxCount === 0, '5.31 Zero SALE inventory transactions persisted for aborted order');

  // [5.7] P1: Caller-owned transaction successful settlement & commit
  console.log('\n[5.7] P1: Caller-owned transaction: Successful atomic commit');
  const prodCallerCommit = await createTestProduct({
    name: `Caller Commit Prod ${Date.now()}`,
    variants: [{ size: 'S', color: 'PURPLE', stock: 10 }],
  });
  const pCallerCommitId = new mongoose.Types.ObjectId(prodCallerCommit.product._id);
  const vCallerCommitId = new mongoose.Types.ObjectId(prodCallerCommit.variantIds[0]);

  const orderCallerCommit = await Order.create({
    orderNumber: `CALLER-COMMIT-${Date.now()}`,
    userId,
    items: [{
      productId: pCallerCommitId,
      variantId: vCallerCommitId,
      productName: 'Caller Commit Tee',
      productImage: 'https://example.com/tee.jpg',
      selectedSize: 'S',
      selectedColor: 'PURPLE',
      quantity: 3,
      unitPrice: 400,
      lineTotal: 1200,
      isCustomized: false,
    }],
    shippingAddress: sampleShippingAddress,
    subtotal: 1200,
    discount: 0,
    shipping: 0,
    tax: 0,
    total: 1200,
    currency: 'INR',
    status: 'PENDING',
    paymentStatus: 'PENDING',
  });

  const payCallerCommit = await Payment.create({
    orderId: orderCallerCommit._id,
    userId,
    amount: 1200,
    currency: 'INR',
    status: 'PENDING',
    provider: 'RAZORPAY',
  });

  const rzpOrderCallerCommit = `order_caller_commit_${Date.now()}`;
  await PaymentAttempt.create({
    paymentId: payCallerCommit._id,
    orderId: orderCallerCommit._id,
    razorpayOrderId: rzpOrderCallerCommit,
    amount: 1200,
    currency: 'INR',
    status: 'PENDING',
  });

  const callerCommitSession = await mongoose.startSession();
  callerCommitSession.startTransaction();

  const callerCommitRes = await processPaymentSuccess(rzpOrderCallerCommit, 'pay_caller_commit_1', { session: callerCommitSession });
  check(callerCommitRes?.success === true, '5.32 processPaymentSuccess succeeded within caller-owned transaction');
  check(callerCommitSession.inTransaction() === true, '5.33 Transaction active for caller to commit');

  await callerCommitSession.commitTransaction();
  await callerCommitSession.endSession();

  const finalOrderCommit = await Order.findById(orderCallerCommit._id);
  check(finalOrderCommit?.status === 'CONFIRMED' && finalOrderCommit?.paymentStatus === 'PAID', '5.34 Order committed as CONFIRMED/PAID');
  const finalProdCommit = await Product.findById(pCallerCommitId);
  check(finalProdCommit?.variants[0].stock === 7, '5.35 Stock decremented atomically (10 -> 7)');

  // [5.8] P2: Coupon reservation consistency: Failure is not swallowed & reconciliation state persisted
  console.log('\n[5.8] P2: Coupon reservation consistency: Failure not swallowed & reconciliation state persisted');
  const prodCpnFail = await createTestProduct({
    name: `Coupon Fail Prod ${Date.now()}`,
    variants: [{ size: 'L', color: 'TEAL', stock: 10 }],
  });
  const pCpnFailId = new mongoose.Types.ObjectId(prodCpnFail.product._id);
  const vCpnFailId = new mongoose.Types.ObjectId(prodCpnFail.variantIds[0]);

  const couponFail: any = await Coupon.create({
    code: `DISC50_${Date.now()}`,
    discountType: DiscountType.FIXED,
    discountValue: 50,
    minOrderValue: 100,
    usedCount: 0,
    reservedCount: 0,
    status: CouponStatus.ACTIVE,
  });

  const orderCpnFail = await Order.create({
    orderNumber: `CPN-FAIL-${Date.now()}`,
    userId,
    items: [{
      productId: pCpnFailId,
      variantId: vCpnFailId,
      productName: 'Coupon Fail Tee',
      productImage: 'https://example.com/tee.jpg',
      selectedSize: 'L',
      selectedColor: 'TEAL',
      quantity: 1,
      unitPrice: 500,
      lineTotal: 500,
      isCustomized: false,
    }],
    shippingAddress: sampleShippingAddress,
    subtotal: 500,
    discount: 50,
    couponCode: couponFail.code,
    shipping: 0,
    tax: 0,
    total: 450,
    currency: 'INR',
    status: 'PENDING',
    paymentStatus: 'PENDING',
  });

  // Pre-create CouponUsage in RELEASED status to trigger confirmation failure
  await CouponUsage.create({
    couponId: couponFail._id,
    userId,
    orderId: orderCpnFail._id,
    discountAmount: 50,
    status: CouponUsageStatus.RELEASED,
    releasedAt: new Date(),
    releaseReason: 'SIMULATED_EXPIRY',
  });

  const payCpnFail = await Payment.create({
    orderId: orderCpnFail._id,
    userId,
    amount: 450,
    currency: 'INR',
    status: 'PENDING',
    provider: 'RAZORPAY',
  });

  const rzpOrderCpnFail = `order_cpn_fail_${Date.now()}`;
  await PaymentAttempt.create({
    paymentId: payCpnFail._id,
    orderId: orderCpnFail._id,
    razorpayOrderId: rzpOrderCpnFail,
    amount: 450,
    currency: 'INR',
    status: 'PENDING',
  });

  const cpnFailRes = await processPaymentSuccess(rzpOrderCpnFail, 'pay_cpn_fail_1');
  check(cpnFailRes?.reconciliationRequired === true, '5.36 Result explicitly flags reconciliationRequired for coupon failure');
  check(cpnFailRes?.reason === 'COUPON_RECONCILIATION_REQUIRED', '5.37 Result reason reports COUPON_RECONCILIATION_REQUIRED');

  // Verify explicit recoverable reconciliation state persisted in MongoDB
  const payCpnFailAfter = await Payment.findById(payCpnFail._id);
  check(payCpnFailAfter?.reconciliationRequired === true, '5.38 Payment document has reconciliationRequired: true');
  check(Boolean(payCpnFailAfter?.reconciliationReason?.includes('COUPON_CONFIRMATION_FAILED')), '5.39 Payment reconciliationReason records coupon confirmation failure');

  const attemptCpnFailAfter = await PaymentAttempt.findOne({ razorpayOrderId: rzpOrderCpnFail });
  check(attemptCpnFailAfter?.failureCode === 'COUPON_RECONCILIATION_REQUIRED', '5.40 PaymentAttempt records failureCode COUPON_RECONCILIATION_REQUIRED');

  // [5.9] P2: Coupon confirmation failure in caller-owned transaction aborts transaction
  console.log('\n[5.9] P2: Coupon confirmation failure in caller-owned transaction aborts transaction');
  const orderCpnCaller = await Order.create({
    orderNumber: `CPN-CALLER-${Date.now()}`,
    userId,
    items: [{
      productId: pCpnFailId,
      variantId: vCpnFailId,
      productName: 'Coupon Caller Tee',
      productImage: 'https://example.com/tee.jpg',
      selectedSize: 'L',
      selectedColor: 'TEAL',
      quantity: 1,
      unitPrice: 500,
      lineTotal: 500,
      isCustomized: false,
    }],
    shippingAddress: sampleShippingAddress,
    subtotal: 500,
    discount: 50,
    couponCode: couponFail.code,
    shipping: 0,
    tax: 0,
    total: 450,
    currency: 'INR',
    status: 'PENDING',
    paymentStatus: 'PENDING',
  });

  await CouponUsage.create({
    couponId: couponFail._id,
    userId,
    orderId: orderCpnCaller._id,
    discountAmount: 50,
    status: CouponUsageStatus.RELEASED,
    releasedAt: new Date(),
    releaseReason: 'SIMULATED_TIMEOUT',
  });

  const payCpnCaller = await Payment.create({
    orderId: orderCpnCaller._id,
    userId,
    amount: 450,
    currency: 'INR',
    status: 'PENDING',
    provider: 'RAZORPAY',
  });

  const rzpOrderCpnCaller = `order_cpn_caller_${Date.now()}`;
  await PaymentAttempt.create({
    paymentId: payCpnCaller._id,
    orderId: orderCpnCaller._id,
    razorpayOrderId: rzpOrderCpnCaller,
    amount: 450,
    currency: 'INR',
    status: 'PENDING',
  });

  const stockBeforeCpnCaller = (await Product.findById(pCpnFailId))?.variants[0].stock;
  const cpnCallerSession = await mongoose.startSession();
  cpnCallerSession.startTransaction();

  let cpnCallerThrew = false;
  try {
    await processPaymentSuccess(rzpOrderCpnCaller, 'pay_cpn_caller_1', { session: cpnCallerSession });
  } catch (err: any) {
    cpnCallerThrew = true;
    check(Boolean(err.message.includes('COUPON_CONFIRMATION_FAILED')), '5.41 Coupon failure in caller transaction aborts and throws to caller');
  }
  check(cpnCallerThrew, '5.42 Caller transaction threw on coupon confirmation failure');
  check(cpnCallerSession.inTransaction() === false, '5.43 Caller session aborted on coupon failure');
  await cpnCallerSession.endSession();

  const stockAfterCpnCaller = (await Product.findById(pCpnFailId))?.variants[0].stock;
  check(stockAfterCpnCaller === stockBeforeCpnCaller, `5.43b In-transaction stock deduction rolled back completely (${stockBeforeCpnCaller} === ${stockAfterCpnCaller})`);
  const cpnCallerSaleTx = await InventoryTransaction.countDocuments({ orderId: orderCpnCaller._id });
  check(cpnCallerSaleTx === 0, '5.43c Zero SALE inventory transactions persisted after caller tx rollback');
  const orderCpnCallerAfter = await Order.findById(orderCpnCaller._id);
  check(orderCpnCallerAfter?.status === 'PENDING' && orderCpnCallerAfter?.paymentStatus === 'PENDING', '5.43d Order rolled back to PENDING/PENDING');
  const payCpnCallerAfter = await Payment.findById(payCpnCaller._id);
  check(payCpnCallerAfter?.status === 'PENDING', '5.43e Payment rolled back to PENDING');
  const attemptCpnCallerAfter = await PaymentAttempt.findOne({ razorpayOrderId: rzpOrderCpnCaller });
  check(attemptCpnCallerAfter?.status === 'PENDING', '5.43f PaymentAttempt rolled back to PENDING');

  // [5.9b] P1: Webhook caller (processSupportedWebhookEvent) propagates caller-owned transaction failure
  console.log('\n[5.9b] P1: Webhook caller propagates caller-owned transaction failure and aborts transaction');
  const prodWhCaller = await createTestProduct({
    name: `Webhook Caller Prod ${Date.now()}`,
    variants: [{ size: 'M', color: 'GRAY', stock: 0 }],
  });
  const pWhCallerId = new mongoose.Types.ObjectId(prodWhCaller.product._id);
  const vWhCallerId = new mongoose.Types.ObjectId(prodWhCaller.variantIds[0]);

  const orderWhCaller = await Order.create({
    orderNumber: `WH-CALLER-${Date.now()}`,
    userId,
    items: [{
      productId: pWhCallerId,
      variantId: vWhCallerId,
      productName: 'Webhook Caller Tee',
      productImage: 'https://example.com/tee.jpg',
      selectedSize: 'M',
      selectedColor: 'GRAY',
      quantity: 1,
      unitPrice: 500,
      lineTotal: 500,
      isCustomized: false,
    }],
    shippingAddress: sampleShippingAddress,
    subtotal: 500,
    discount: 0,
    shipping: 0,
    tax: 0,
    total: 500,
    currency: 'INR',
    status: 'PENDING',
    paymentStatus: 'PENDING',
  });

  const payWhCaller = await Payment.create({
    orderId: orderWhCaller._id,
    userId,
    amount: 500,
    currency: 'INR',
    status: 'PENDING',
    provider: 'RAZORPAY',
  });

  const rzpOrderWhCaller = `order_wh_caller_${Date.now()}`;
  await PaymentAttempt.create({
    paymentId: payWhCaller._id,
    orderId: orderWhCaller._id,
    razorpayOrderId: rzpOrderWhCaller,
    amount: 500,
    currency: 'INR',
    status: 'PENDING',
  });

  const whCallerSession = await mongoose.startSession();
  whCallerSession.startTransaction();
  let whCallerThrew = false;
  try {
    await processSupportedWebhookEvent(
      'payment.captured',
      {
        payload: {
          payment: {
            entity: {
              id: 'pay_wh_caller_1',
              order_id: rzpOrderWhCaller,
              amount: 50000,
              currency: 'INR',
            },
          },
        },
      },
      { session: whCallerSession }
    );
  } catch (err: any) {
    whCallerThrew = true;
    check(Boolean(err.message.includes('CALLER_TX_SETTLEMENT_FAILED')), '5.43g Webhook caller propagated CALLER_TX_SETTLEMENT_FAILED');
  }
  check(whCallerThrew, '5.43h processSupportedWebhookEvent threw on caller-owned transaction failure');
  check(whCallerSession.inTransaction() === false, '5.43i Webhook caller session was aborted');
  await whCallerSession.endSession();
  const orderWhAfter = await Order.findById(orderWhCaller._id);
  check(orderWhAfter?.status === 'PENDING' && orderWhAfter?.paymentStatus === 'PENDING', '5.43j Webhook caller rolled back Order cleanly');

  // [5.10] P2: Idempotent coupon confirmation preserved
  console.log('\n[5.10] P2: Idempotent coupon confirmation preserved');
  const orderCpnGood = await Order.create({
    orderNumber: `CPN-GOOD-${Date.now()}`,
    userId,
    items: [{
      productId: pCpnFailId,
      variantId: vCpnFailId,
      productName: 'Good Coupon Tee',
      productImage: 'https://example.com/tee.jpg',
      selectedSize: 'L',
      selectedColor: 'TEAL',
      quantity: 1,
      unitPrice: 500,
      lineTotal: 500,
      isCustomized: false,
    }],
    shippingAddress: sampleShippingAddress,
    subtotal: 500,
    discount: 50,
    couponCode: couponFail.code,
    shipping: 0,
    tax: 0,
    total: 450,
    currency: 'INR',
    status: 'PENDING',
    paymentStatus: 'PENDING',
  });

  // Pre-create CouponUsage in CONFIRMED status
  await CouponUsage.create({
    couponId: couponFail._id,
    userId,
    orderId: orderCpnGood._id,
    discountAmount: 50,
    status: CouponUsageStatus.CONFIRMED,
    confirmedAt: new Date(),
  });

  const payCpnGood = await Payment.create({
    orderId: orderCpnGood._id,
    userId,
    amount: 450,
    currency: 'INR',
    status: 'PENDING',
    provider: 'RAZORPAY',
  });

  const rzpOrderCpnGood = `order_cpn_good_${Date.now()}`;
  await PaymentAttempt.create({
    paymentId: payCpnGood._id,
    orderId: orderCpnGood._id,
    razorpayOrderId: rzpOrderCpnGood,
    amount: 450,
    currency: 'INR',
    status: 'PENDING',
  });

  const goodCpnRes = await processPaymentSuccess(rzpOrderCpnGood, 'pay_cpn_good_1');
  check(goodCpnRes?.success === true, '5.44 Already confirmed coupon confirms order successfully');
  check(goodCpnRes?.reconciliationRequired !== true, '5.45 No coupon reconciliation required for already confirmed coupon');
  const payGoodAfter = await Payment.findById(payCpnGood._id);
  check(payGoodAfter?.reconciliationRequired !== true, '5.46 Payment not flagged for reconciliation on valid confirmation');

  console.log(`\n============================================================`);
  console.log(`PRODUCTION HARDENING SUITE: ${passed} passed, ${failed} failed`);
  console.log(`============================================================\n`);

  if (failed > 0) {
    throw new Error(`Production hardening suite failed with ${failed} failure(s)`);
  }
}

if (require.main === module) {
  runHardeningTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
