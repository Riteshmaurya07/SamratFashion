/**
 * Regression suite: payment operations health report.
 *
 * The report is the monitoring surface for stuck payments, stuck refunds,
 * failed webhooks, and a stale recovery loop. This suite proves that each
 * category is detected and that the overall status escalates to `critical`
 * when a refund requires reconciliation.
 */

process.env.NODE_ENV = 'test';
process.env.RAZORPAY_KEY_ID = 'rzp_test_mock';
process.env.RAZORPAY_KEY_SECRET = 'mock_secret_test';
process.env.RAZORPAY_WEBHOOK_SECRET = 'mock_webhook_secret_test';
process.env.ALLOW_PAYMENT_MOCK = 'true';
process.env.OPS_SECRET = 'test_ops_secret_at_least_16_chars';

import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();
import { connectSafeTestDb } from './testHelpers';
import { Order } from '../models/Order';
import { Payment } from '../models/Payment';
import { PaymentAttempt } from '../models/PaymentAttempt';
import { Refund } from '../models/Refund';
import { WebhookEvent } from '../models/WebhookEvent';
import { getPaymentHealthReport } from '../services/payment/paymentHealthService';
import { requireOpsSecret } from '../middleware/opsAuth';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(condition: boolean, desc: string, detail?: string): void {
  if (condition) {
    passed++;
    console.log(`  PASS: ${desc}`);
  } else {
    failed++;
    const message = detail ? `${desc} — ${detail}` : desc;
    failures.push(message);
    console.error(`  FAIL: ${message}`);
  }
}

function invokeOpsAuth(headers: { secret?: string; authorization?: string }): {
  statusCode: number;
  nextCalled: boolean;
  body: any;
} {
  let statusCode = 200;
  let body: any;
  let nextCalled = false;

  const req = {
    query: {},
    header(name: string): string | undefined {
      const key = name.toLowerCase();
      if (key === 'x-ops-secret') return headers.secret;
      if (key === 'authorization') return headers.authorization;
      return undefined;
    },
  } as any;

  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(payload: any) {
      body = payload;
      return this;
    },
  } as any;

  requireOpsSecret(req, res, () => {
    nextCalled = true;
  });

  return { statusCode, nextCalled, body };
}

const defaultShippingAddress = {
  fullName: 'Health Check Customer',
  phone: '9876543210',
  addressLine1: 'Park St',
  city: 'Kolkata',
  state: 'WB',
  postalCode: '700016',
  country: 'India',
};

async function run(): Promise<void> {
  await connectSafeTestDb();

  const now = Date.now();
  const userId = new mongoose.Types.ObjectId();
  const adminId = new mongoose.Types.ObjectId();

  let order: any;
  let payment: any;
  let failedWebhook: any;

  try {
    const before = await getPaymentHealthReport();

    order = await Order.create({
      orderNumber: `ORD-HEALTH-${now}`,
      userId,
      items: [],
      subtotal: 1000,
      total: 1000,
      currency: 'INR',
      status: 'PENDING',
      paymentStatus: 'PENDING',
      shippingAddress: defaultShippingAddress,
    });

    payment = await Payment.create({
      orderId: order._id,
      userId,
      amount: 1000,
      currency: 'INR',
      status: 'PENDING',
      provider: 'RAZORPAY',
      refundedAmount: 0,
      pendingRefundAmount: 0,
      refundReservations: [],
    });

    await PaymentAttempt.create({
      paymentId: payment._id,
      orderId: order._id,
      razorpayOrderId: `order_health_${now}`,
      amount: 1000,
      currency: 'INR',
      status: 'PENDING',
    });

    await Refund.create({
      orderId: order._id,
      paymentId: payment._id,
      userId,
      attemptNumber: 1,
      idempotencyKey: `rfnd_health_stuck_${now}`,
      amount: 300,
      currency: 'INR',
      status: 'PROCESSING',
      submissionState: 'SUBMITTED',
      accountingSettlementStatus: 'PENDING',
      initiatedBy: adminId,
      initiatedByRole: 'ADMIN',
    });

    await Refund.create({
      orderId: order._id,
      paymentId: payment._id,
      userId,
      attemptNumber: 2,
      idempotencyKey: `rfnd_health_recon_${now}`,
      amount: 200,
      currency: 'INR',
      status: 'PROCESSED',
      submissionState: 'CONFIRMED',
      accountingSettlementStatus: 'RECONCILIATION_REQUIRED',
      razorpayRefundId: `rfnd_recon_${now}`,
      initiatedBy: adminId,
      initiatedByRole: 'ADMIN',
    });

    failedWebhook = await WebhookEvent.create({
      eventId: `evt_health_${now}`,
      provider: 'RAZORPAY',
      eventType: 'refund.processed',
      status: 'FAILED',
      processingAttempts: 1,
      lastError: 'synthetic health-check failure',
      payload: { event: 'refund.processed' },
    });

    // Reference time is in the future so freshly created fixtures are already
    // older than the threshold; no clock mocking required.
    const after = await getPaymentHealthReport({
      now: new Date(Date.now() + 10 * 60_000),
      stuckAfterMs: 60_000,
      orderStuckAfterMs: 60_000,
      recoveryStaleAfterMs: 60_000,
    });

    check(
      after.payments.stuckAttempts >= before.payments.stuckAttempts + 1,
      'H1: In-flight payment attempt older than threshold is detected',
      `before=${before.payments.stuckAttempts}, after=${after.payments.stuckAttempts}`
    );
    check(
      after.payments.stuckOrders >= before.payments.stuckOrders + 1,
      'H2: Unpaid order older than threshold is detected',
      `before=${before.payments.stuckOrders}, after=${after.payments.stuckOrders}`
    );
    check(
      after.refunds.stuck >= before.refunds.stuck + 1,
      'H3: PENDING/PROCESSING refund older than threshold is detected',
      `before=${before.refunds.stuck}, after=${after.refunds.stuck}`
    );
    check(
      after.refunds.processing >= before.refunds.processing + 1,
      'H3b: PROCESSING refunds are counted even before they are stale',
      `before=${before.refunds.processing}, after=${after.refunds.processing}`
    );
    check(
      after.refunds.reconciliationRequired >= before.refunds.reconciliationRequired + 1,
      'H4: accountingSettlementStatus=RECONCILIATION_REQUIRED is detected',
      `before=${before.refunds.reconciliationRequired}, after=${after.refunds.reconciliationRequired}`
    );
    check(
      after.refunds.processedButUnsettled >= before.refunds.processedButUnsettled + 1,
      'H5: PROCESSED refund without completed accounting is detected',
      `before=${before.refunds.processedButUnsettled}, after=${after.refunds.processedButUnsettled}`
    );
    check(
      after.webhooks.failed >= before.webhooks.failed + 1,
      'H6: FAILED webhook event is detected',
      `before=${before.webhooks.failed}, after=${after.webhooks.failed}`
    );
    check(
      after.status === 'critical',
      'H7: Reconciliation-required refund escalates the report to critical',
      `status=${after.status}`
    );
    check(
      after.alerts.some((alert) => alert.includes('RECONCILIATION_REQUIRED')),
      'H8: Critical alert names the reconciliation condition'
    );
    check(
      after.windows.stuckAfterMinutes === 1,
      'H9: Configurable stuck window is reflected in the report',
      `window=${after.windows.stuckAfterMinutes}`
    );
    const expectedSchedulerMode =
      process.env.DISABLE_EMBEDDED_RECOVERY === 'true' ? 'external' : 'embedded';
    check(
      after.recovery.schedulerMode === expectedSchedulerMode,
      'H10: Recovery scheduler mode matches the deployment configuration',
      `mode=${after.recovery.schedulerMode}, expected=${expectedSchedulerMode}`
    );
    check(
      after.configuration.webhookSecretConfigured === true,
      'H11: Webhook secret presence is reported'
    );
    check(
      after.configuration.opsSecretConfigured === true,
      'H12: Ops secret presence is reported'
    );

    const validOpsCall = invokeOpsAuth({ secret: process.env.OPS_SECRET });
    check(
      validOpsCall.nextCalled && validOpsCall.statusCode === 200,
      'H13: Correct x-ops-secret is accepted',
      `status=${validOpsCall.statusCode}`
    );
    const invalidOpsCall = invokeOpsAuth({ secret: 'definitely-wrong-secret' });
    check(
      !invalidOpsCall.nextCalled && invalidOpsCall.statusCode === 401,
      'H14: Wrong x-ops-secret is rejected',
      `status=${invalidOpsCall.statusCode}`
    );
    const bearerOpsCall = invokeOpsAuth({
      authorization: `Bearer ${process.env.OPS_SECRET}`,
    });
    check(
      bearerOpsCall.nextCalled,
      'H15: Bearer token form is accepted for Vercel Cron'
    );
    const missingOpsCall = invokeOpsAuth({});
    check(
      !missingOpsCall.nextCalled && missingOpsCall.statusCode === 401,
      'H16: Missing secret is rejected',
      `status=${missingOpsCall.statusCode}`
    );

    const savedOpsSecret = process.env.OPS_SECRET;
    delete process.env.OPS_SECRET;
    const unconfiguredOpsCall = invokeOpsAuth({ secret: savedOpsSecret });
    if (savedOpsSecret !== undefined) process.env.OPS_SECRET = savedOpsSecret;
    check(
      !unconfiguredOpsCall.nextCalled &&
        unconfiguredOpsCall.statusCode === 503 &&
        unconfiguredOpsCall.body?.code === 'OPS_SECRET_NOT_CONFIGURED',
      'H17: Unconfigured OPS_SECRET fails closed with 503',
      `status=${unconfiguredOpsCall.statusCode}`
    );

    // Query-string credentials must never be accepted.
    const queryOnlyReq = {
      query: { 'x-ops-secret': process.env.OPS_SECRET },
      header(): string | undefined {
        return undefined;
      },
    } as any;
    let queryNextCalled = false;
    let queryStatus = 200;
    requireOpsSecret(queryOnlyReq, {
      status(code: number) {
        queryStatus = code;
        return this;
      },
      json() {
        return this;
      },
    } as any, () => {
      queryNextCalled = true;
    });
    check(
      !queryNextCalled && queryStatus === 401,
      'H18: Secret supplied only as a query parameter is rejected',
      `status=${queryStatus}`
    );

    const serializedReport = JSON.stringify(after);
    const knownSecrets = [
      process.env.OPS_SECRET,
      process.env.RAZORPAY_KEY_SECRET,
      process.env.RAZORPAY_WEBHOOK_SECRET,
    ].filter((value): value is string => Boolean(value));
    check(
      knownSecrets.every((secret) => !serializedReport.includes(secret)),
      'H19: Health report never contains configured secrets'
    );
    check(
      !serializedReport.includes(defaultShippingAddress.phone) &&
        !serializedReport.includes(defaultShippingAddress.fullName),
      'H20: Health report never contains customer personal information'
    );

    const orderAfterHealthChecks: any = await Order.findById(order._id);
    const paymentAfterHealthChecks: any = await Payment.findById(payment._id);
    const refundAfterHealthChecks: any = await Refund.findById(
      (await Refund.findOne({ orderId: order._id, status: 'PROCESSING' }))?._id
    );
    check(
      orderAfterHealthChecks?.status === 'PENDING' &&
        paymentAfterHealthChecks?.status === 'PENDING' &&
        refundAfterHealthChecks?.status === 'PROCESSING',
      'H21: Health checks are read-only and never mutate payment/refund/order state'
    );
  } catch (err: unknown) {
    failed++;
    failures.push(`Suite error: ${err instanceof Error ? err.stack || err.message : String(err)}`);
    console.error('Suite error:', err);
  } finally {
    if (failedWebhook?._id) {
      await WebhookEvent.deleteOne({ _id: failedWebhook._id }).catch(() => undefined);
    }
    if (order?._id) {
      await Refund.deleteMany({ orderId: order._id }).catch(() => undefined);
      await PaymentAttempt.deleteMany({ orderId: order._id }).catch(() => undefined);
      await Payment.deleteOne({ _id: payment?._id }).catch(() => undefined);
      await Order.deleteOne({ _id: order._id }).catch(() => undefined);
    }
    await mongoose.disconnect().catch(() => undefined);
  }

  console.log('------------------------------------------------------------');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error('Failures:');
    failures.forEach((failure) => console.error(` - ${failure}`));
    process.exitCode = 1;
  }
  console.log('------------------------------------------------------------');
}

run();
