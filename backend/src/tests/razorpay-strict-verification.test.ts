/**
 * Phase 1 Regression Suite: Strict Server-Side Razorpay Verification
 *
 * Verifies that verifyPayment strictly validates all authoritative Razorpay
 * gateway fields (id, entity, order_id, amount in paise, currency, status,
 * captured consistency), rejects missing/malformed/mismatched/non-captured
 * responses, ignores frontend-supplied verification fields, preserves
 * reconciliation-required pending state on gateway unavailability, accepts
 * genuine captured payments, and handles duplicate verification safely.
 */

process.env.NODE_ENV = 'test';
process.env.RAZORPAY_KEY_ID = 'rzp_test_mock';
process.env.RAZORPAY_KEY_SECRET = 'strict_verify_secret_1234567890';
process.env.ALLOW_PAYMENT_MOCK = 'false';

import crypto from 'crypto';
import mongoose from 'mongoose';
import { Request, Response } from 'express';
import { connectSafeTestDb, createTestProduct } from './testHelpers';
import { verifyPayment } from '../controllers/paymentController';
import { razorpayProvider } from '../services/payment/RazorpayProvider';
import { Order } from '../models/Order';
import { Payment } from '../models/Payment';
import { PaymentAttempt } from '../models/PaymentAttempt';
import { Product } from '../models/Product';
import { InventoryTransaction } from '../models/InventoryTransaction';
import '../models/Cart';
import '../models/User';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(condition: boolean, desc: string, detail?: string): void {
  if (condition) {
    console.log(`  PASS: ${desc}`);
    passed++;
  } else {
    const msg = detail ? `${desc} — ${detail}` : desc;
    console.error(`  FAIL: ${msg}`);
    failures.push(msg);
    failed++;
  }
}

interface MockRes {
  statusCode: number;
  body: any;
  status(code: number): MockRes;
  json(payload: any): MockRes;
}

function createMockRes(): MockRes {
  const res: MockRes = {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

function sign(orderId: string, paymentId: string): string {
  return crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET!)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
}

async function run() {
  console.log('=== Phase 1: Strict Razorpay Verification Regression Suite ===');
  await connectSafeTestDb();

  const userId = new mongoose.Types.ObjectId();
  const createdOrderIds: mongoose.Types.ObjectId[] = [];
  const createdProductIds: mongoose.Types.ObjectId[] = [];

  const origFetchPayment = razorpayProvider.fetchPayment;

  try {
    const { product, productId, variantIds } = await createTestProduct({
      name: 'Strict Verify Tee',
      basePrice: 1250,
      variants: [{ size: 'M', color: 'BLACK', stock: 10, additionalPrice: 0 }],
    });
    createdProductIds.push(product._id);
    const variantId = variantIds[0];

    const createFixture = async (label: string) => {
      const order = await Order.create({
        orderNumber: `STRICT-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        userId,
        items: [
          {
            productId: new mongoose.Types.ObjectId(productId),
            variantId: new mongoose.Types.ObjectId(variantId),
            productName: 'Strict Verify Tee',
            productImage: 'https://example.com/tee.jpg',
            selectedSize: 'M',
            selectedColor: 'BLACK',
            quantity: 1,
            unitPrice: 1250,
            lineTotal: 1250,
            isCustomized: false,
          },
        ],
        shippingAddress: {
          fullName: 'Strict Tester',
          phone: '9876543210',
          addressLine1: 'MG Road',
          city: 'Bengaluru',
          state: 'Karnataka',
          postalCode: '560001',
          country: 'India',
        },
        subtotal: 1250,
        discount: 0,
        shipping: 0,
        tax: 0,
        total: 1250,
        currency: 'INR',
        status: 'PENDING',
        paymentStatus: 'PENDING',
      });
      createdOrderIds.push(order._id as mongoose.Types.ObjectId);

      const payment = await Payment.create({
        orderId: order._id,
        userId,
        amount: 1250,
        currency: 'INR',
        status: 'PENDING',
        provider: 'RAZORPAY',
      });

      const rzpOrderId = `order_strict_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const attempt = await PaymentAttempt.create({
        paymentId: payment._id,
        orderId: order._id,
        razorpayOrderId: rzpOrderId,
        amount: 1250,
        currency: 'INR',
        status: 'PENDING',
      });

      return { order, payment, attempt, rzpOrderId };
    };

    const callVerify = async (
      rzpOrderId: string,
      rzpPaymentId: string,
      extraBody: Record<string, unknown> = {}
    ) => {
      const req = {
        user: { id: userId.toString(), role: 'CUSTOMER' },
        body: {
          razorpay_order_id: rzpOrderId,
          razorpay_payment_id: rzpPaymentId,
          razorpay_signature: sign(rzpOrderId, rzpPaymentId),
          ...extraBody,
        },
      } as unknown as Request;
      const res = createMockRes();
      await verifyPayment(req, res as unknown as Response);
      return res;
    };

    const f1 = await createFixture('MISSING');

    // 1. Missing / malformed request body fields
    const malformedReq = {
      user: { id: userId.toString(), role: 'CUSTOMER' },
      body: {
        razorpay_order_id: { $ne: null },
        razorpay_payment_id: 'pay_obj',
        razorpay_signature: 'sig',
      },
    } as unknown as Request;
    const malformedRes = createMockRes();
    await verifyPayment(malformedReq, malformedRes as unknown as Response);
    check(malformedRes.statusCode === 400, 'P1.1 Non-string request body fields rejected with 400');

    // 2. Missing gateway order_id MUST be rejected (previously conditionally bypassed)
    const payMissingOrder = 'pay_strict_missing_order';
    razorpayProvider.fetchPayment = async () => ({
      id: payMissingOrder,
      entity: 'payment',
      amount: 125000,
      currency: 'INR',
      status: 'captured',
      captured: true,
    } as any);
    const resMissingOrder = await callVerify(f1.rzpOrderId, payMissingOrder);
    check(
      resMissingOrder.statusCode === 400,
      'P1.2 Missing gateway order_id is strictly rejected',
      `got ${resMissingOrder.statusCode}: ${JSON.stringify(resMissingOrder.body)}`
    );

    // 3. Missing gateway amount MUST be rejected (previously conditionally bypassed)
    const payMissingAmt = 'pay_strict_missing_amt';
    razorpayProvider.fetchPayment = async () => ({
      id: payMissingAmt,
      entity: 'payment',
      order_id: f1.rzpOrderId,
      currency: 'INR',
      status: 'captured',
      captured: true,
    } as any);
    const resMissingAmt = await callVerify(f1.rzpOrderId, payMissingAmt);
    check(
      resMissingAmt.statusCode === 400,
      'P1.3 Missing gateway amount is strictly rejected',
      `got ${resMissingAmt.statusCode}: ${JSON.stringify(resMissingAmt.body)}`
    );

    // 4. Malformed gateway amount (string, float, zero, negative) MUST be rejected
    for (const [label, badAmount] of [
      ['string', '125000'],
      ['float', 125000.5],
      ['zero', 0],
      ['negative', -125000],
      ['NaN', Number.NaN],
    ] as Array<[string, unknown]>) {
      const pid = `pay_strict_bad_amt_${label}`;
      razorpayProvider.fetchPayment = async () => ({
        id: pid,
        entity: 'payment',
        order_id: f1.rzpOrderId,
        amount: badAmount,
        currency: 'INR',
        status: 'captured',
        captured: true,
      } as any);
      const resBadAmt = await callVerify(f1.rzpOrderId, pid);
      check(
        resBadAmt.statusCode === 400,
        `P1.4 Malformed gateway amount (${label}) rejected with 400`,
        `got ${resBadAmt.statusCode}`
      );
    }

    // 5. Missing / whitespace / wrong gateway currency MUST be rejected
    for (const [label, badCurrency] of [
      ['missing', undefined],
      ['empty', '   '],
      ['non-string', 356],
      ['wrong-USD', 'USD'],
    ] as Array<[string, unknown]>) {
      const pid = `pay_strict_bad_cur_${label}`;
      razorpayProvider.fetchPayment = async () => ({
        id: pid,
        entity: 'payment',
        order_id: f1.rzpOrderId,
        amount: 125000,
        currency: badCurrency,
        status: 'captured',
        captured: true,
      } as any);
      const resBadCur = await callVerify(f1.rzpOrderId, pid);
      check(
        resBadCur.statusCode === 400,
        `P1.5 Missing/malformed/wrong gateway currency (${label}) rejected with 400`,
        `got ${resBadCur.statusCode}`
      );
    }

    // 6. Wrong payment ID / wrong order ID / wrong amount / wrong entity rejected
    razorpayProvider.fetchPayment = async () => ({
      id: 'pay_different_id',
      entity: 'payment',
      order_id: f1.rzpOrderId,
      amount: 125000,
      currency: 'INR',
      status: 'captured',
      captured: true,
    } as any);
    const resWrongId = await callVerify(f1.rzpOrderId, 'pay_strict_wrong_id');
    check(resWrongId.statusCode === 400, 'P1.6 Mismatched gateway payment ID rejected');

    razorpayProvider.fetchPayment = async () => ({
      id: 'pay_strict_wrong_order',
      entity: 'payment',
      order_id: 'order_attacker_other',
      amount: 125000,
      currency: 'INR',
      status: 'captured',
      captured: true,
    } as any);
    const resWrongOrder = await callVerify(f1.rzpOrderId, 'pay_strict_wrong_order');
    check(resWrongOrder.statusCode === 400, 'P1.7 Mismatched gateway order_id rejected');

    razorpayProvider.fetchPayment = async () => ({
      id: 'pay_strict_wrong_amt',
      entity: 'payment',
      order_id: f1.rzpOrderId,
      amount: 100,
      currency: 'INR',
      status: 'captured',
      captured: true,
    } as any);
    const resWrongAmt = await callVerify(f1.rzpOrderId, 'pay_strict_wrong_amt', {
      // Frontend spoofed values must be completely ignored
      amount: 125000,
      currency: 'INR',
      status: 'captured',
      captured: true,
    });
    check(resWrongAmt.statusCode === 400, 'P1.8 Mismatched gateway amount rejected even when frontend sends spoofed amount');

    razorpayProvider.fetchPayment = async () => ({
      id: 'pay_strict_wrong_entity',
      entity: 'order',
      order_id: f1.rzpOrderId,
      amount: 125000,
      currency: 'INR',
      status: 'captured',
      captured: true,
    } as any);
    const resWrongEntity = await callVerify(f1.rzpOrderId, 'pay_strict_wrong_entity');
    check(resWrongEntity.statusCode === 400, 'P1.9 Malformed gateway entity rejected');

    // 7. Non-captured & contradictory capture states rejected
    // CRITICAL: Razorpay returns status='refunded' with captured=true for refunded payments!
    for (const [label, status, captured] of [
      ['authorized-false', 'authorized', false],
      ['authorized-true-contradictory', 'authorized', true],
      ['refunded-with-captured-true', 'refunded', true],
      ['created-false', 'created', false],
      ['failed-false', 'failed', false],
      ['missing-status-captured-true', undefined, true],
      ['captured-with-captured-false', 'captured', false],
      ['captured-with-captured-string', 'captured', 'true'],
    ] as Array<[string, unknown, unknown]>) {
      const pid = `pay_strict_state_${label}`;
      razorpayProvider.fetchPayment = async () => ({
        id: pid,
        entity: 'payment',
        order_id: f1.rzpOrderId,
        amount: 125000,
        currency: 'INR',
        status,
        captured,
      } as any);
      const resState = await callVerify(f1.rzpOrderId, pid, {
        status: 'captured',
        captured: true,
      });
      check(
        resState.statusCode === 400,
        `P1.10 Non-authoritative capture state (${label}) rejected with 400`,
        `got ${resState.statusCode}: ${JSON.stringify(resState.body)}`
      );
    }

    // Confirm order is STILL PENDING after all failed verification attempts
    const orderStillPending = await Order.findById(f1.order._id);
    check(
      orderStillPending?.status === 'PENDING' && orderStillPending?.paymentStatus === 'PENDING',
      'P1.11 Order remains PENDING/PENDING after all rejected verifications'
    );

    // 8. Gateway API failure preserves pending + reconciliationRequired state
    razorpayProvider.fetchPayment = async () => {
      throw new Error('503 Razorpay upstream unavailable');
    };
    const resApiFail = await callVerify(f1.rzpOrderId, 'pay_strict_api_down');
    const orderAfterDown = await Order.findById(f1.order._id);
    const paymentAfterDown = await Payment.findById(f1.payment._id);
    check(
      resApiFail.statusCode === 200 &&
        resApiFail.body?.data?.reconciliationRequired === true &&
        resApiFail.body?.data?.reason === 'GATEWAY_VERIFICATION_TIMEOUT',
      'P1.12 Gateway API failure returns pending/reconciliationRequired response'
    );
    check(
      orderAfterDown?.status === 'PENDING' &&
        orderAfterDown?.paymentStatus === 'PENDING' &&
        paymentAfterDown?.reconciliationRequired === true,
      'P1.13 Gateway API failure preserves PENDING order and flags Payment.reconciliationRequired'
    );

    // 9. Valid authoritative captured payment succeeds
    const validPayId = `pay_strict_ok_${Date.now()}`;
    let fetchCalls = 0;
    razorpayProvider.fetchPayment = async (id: string) => {
      fetchCalls++;
      return {
        id,
        entity: 'payment',
        order_id: f1.rzpOrderId,
        amount: 125000,
        currency: 'INR',
        status: 'captured',
        captured: true,
      };
    };
    const resOk = await callVerify(f1.rzpOrderId, validPayId);
    const orderAfterOk = await Order.findById(f1.order._id);
    const productAfterOk = await Product.findById(product._id);
    const stockAfterOk = productAfterOk?.variants.find((v: any) => v._id.toString() === variantId)?.stock;
    check(resOk.statusCode === 200 && resOk.body?.success === true, 'P1.14 Valid captured payment accepted');
    check(
      orderAfterOk?.status === 'CONFIRMED' && orderAfterOk?.paymentStatus === 'PAID',
      'P1.15 Order transitioned to CONFIRMED / PAID'
    );
    check(stockAfterOk === 9 && fetchCalls === 1, `P1.16 Stock deducted once (10 -> ${stockAfterOk}) and gateway fetched once (${fetchCalls})`);

    // 10. Duplicate verification with same payment ID is idempotent (no second gateway fetch, no double deduction)
    const resDup = await callVerify(f1.rzpOrderId, validPayId);
    const productAfterDup = await Product.findById(product._id);
    const stockAfterDup = productAfterDup?.variants.find((v: any) => v._id.toString() === variantId)?.stock;
    check(
      resDup.statusCode === 200 && resDup.body?.success === true && stockAfterDup === 9 && fetchCalls === 1,
      `P1.17 Duplicate verification is idempotent (stock=${stockAfterDup}, fetchCalls=${fetchCalls})`
    );

    // 11. Duplicate verification with a DIFFERENT unverified payment ID MUST still hit gateway and reject invalid capture
    const fakeSecondPayId = `pay_strict_fake_second_${Date.now()}`;
    razorpayProvider.fetchPayment = async (id: string) => {
      fetchCalls++;
      return {
        id,
        entity: 'payment',
        order_id: f1.rzpOrderId,
        amount: 125000,
        currency: 'INR',
        status: 'authorized',
        captured: false,
      };
    };
    const resFakeSecond = await callVerify(f1.rzpOrderId, fakeSecondPayId);
    check(
      resFakeSecond.statusCode === 400 && fetchCalls === 2,
      `P1.18 Different payment ID on already-paid order still enforces strict gateway verification (status=${resFakeSecond.statusCode}, fetchCalls=${fetchCalls})`
    );
  } finally {
    razorpayProvider.fetchPayment = origFetchPayment;
    if (createdOrderIds.length > 0) {
      await InventoryTransaction.deleteMany({ orderId: { $in: createdOrderIds } });
      await PaymentAttempt.deleteMany({ orderId: { $in: createdOrderIds } });
      await Payment.deleteMany({ orderId: { $in: createdOrderIds } });
      await Order.deleteMany({ _id: { $in: createdOrderIds } });
    }
    if (createdProductIds.length > 0) {
      await Product.deleteMany({ _id: { $in: createdProductIds } });
    }
    await mongoose.disconnect().catch(() => {});
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error('Failures:\n - ' + failures.join('\n - '));
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Unhandled error in razorpay-strict-verification test:', err);
  process.exit(1);
});

