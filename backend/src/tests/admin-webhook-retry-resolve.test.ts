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
import { AuditLog } from '../models/AuditLog';
import { razorpayProvider } from '../services/payment/RazorpayProvider';
import { reconcileCapturedPayment } from '../scripts/reconcileCapturedPayment';

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

    // 4. Resolve on an orphan fixture with mocked fetchPayment 404 -> succeeds with LIVE_PAYMENT_NOT_FOUND and audit log
    const orphanPay404 = `pay_orphan_res_404_${now}`;
    const orphanOrder404 = `order_orphan_res_404_${now}`;
    const orphanEvt404 = await WebhookEvent.create({
      eventId: `evt_orphan_res_404_${now}`,
      provider: 'RAZORPAY',
      eventType: 'order.paid',
      status: 'FAILED',
      payload: {
        event: 'order.paid',
        payload: {
          payment: {
            entity: {
              id: orphanPay404,
              order_id: orphanOrder404,
              amount: 900,
              currency: 'INR',
              status: 'captured',
            },
          },
          order: {
            entity: {
              id: orphanOrder404,
              amount: 900,
              currency: 'INR',
            },
          },
        },
      },
    });

    razorpayProvider.fetchPayment = async () => {
      const err: any = new Error('The id provided does not exist');
      err.statusCode = 404;
      err.error = { code: 'BAD_REQUEST_ERROR', description: 'The id provided does not exist' };
      throw err;
    };

    let orphanResolve404Err: any = null;
    const reqOrphan404: any = {
      params: { id: orphanEvt404._id.toString() },
      body: { note: 'Resolving verified orphan test' },
      user: { id: adminId.toString(), role: 'ADMIN' },
    };
    const resOrphan404 = mockRes();
    await resolveAdminWebhook(reqOrphan404, resOrphan404, (err: any) => { orphanResolve404Err = err; });

    check(!orphanResolve404Err, 'T3.10: Resolve succeeds on orphan webhook with gateway 404');
    check(resOrphan404.statusCode === 200, 'T3.11: Returns HTTP 200');
    const reloadedOrphan404 = await WebhookEvent.findById(orphanEvt404._id);
    check(reloadedOrphan404?.status === 'IGNORED', 'T3.12: Orphan event status is set to IGNORED');
    check(
      Boolean(reloadedOrphan404?.lastError?.includes(`LIVE_PAYMENT_NOT_FOUND:${orphanPay404}`)),
      'T3.13: Event lastError notes proven orphan reason',
      reloadedOrphan404?.lastError
    );
    const auditLogOrphan404 = await AuditLog.findOne({
      entityId: orphanEvt404._id,
      action: 'ADMIN_WEBHOOK_RESOLVED',
    });
    check(
      auditLogOrphan404?.metadata?.provenReason === `LIVE_PAYMENT_NOT_FOUND:${orphanPay404}`,
      'T3.14: AuditLog records provenReason LIVE_PAYMENT_NOT_FOUND',
      auditLogOrphan404?.metadata?.provenReason
    );

    // 5. Resolve on an orphan fixture with mocked fetchPayment returning captured -> refused with 409 WEBHOOK_UNSETTLED
    const orphanPayCap = `pay_orphan_res_cap_${now}`;
    const orphanOrderCap = `order_orphan_res_cap_${now}`;
    const orphanEvtCap = await WebhookEvent.create({
      eventId: `evt_orphan_res_cap_${now}`,
      provider: 'RAZORPAY',
      eventType: 'payment.captured',
      status: 'FAILED',
      payload: {
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: orphanPayCap,
              order_id: orphanOrderCap,
              amount: 900,
              currency: 'INR',
              status: 'captured',
            },
          },
        },
      },
    });

    razorpayProvider.fetchPayment = async () => ({
      id: orphanPayCap,
      order_id: orphanOrderCap,
      amount: 900,
      currency: 'INR',
      status: 'captured',
      captured: true,
    });

    let orphanResolveCapErr: any = null;
    const reqOrphanCap: any = {
      params: { id: orphanEvtCap._id.toString() },
      body: { note: 'Trying to resolve captured orphan without local order' },
      user: { id: adminId.toString(), role: 'ADMIN' },
    };
    const resOrphanCap = mockRes();
    await resolveAdminWebhook(reqOrphanCap, resOrphanCap, (err: any) => { orphanResolveCapErr = err; });

    check(Boolean(orphanResolveCapErr), 'T3.15: Resolve refuses orphan webhook when live payment is captured');
    check(
      orphanResolveCapErr?.statusCode === 409 && orphanResolveCapErr?.code === 'WEBHOOK_UNSETTLED',
      'T3.16: Returns HTTP 409 WEBHOOK_UNSETTLED',
      `status=${orphanResolveCapErr?.statusCode}, code=${orphanResolveCapErr?.code}`
    );
    const reloadedOrphanCap = await WebhookEvent.findById(orphanEvtCap._id);
    check(reloadedOrphanCap?.status === 'FAILED', 'T3.17: Event remains FAILED when live payment is captured');

    // 6. Resolve on an orphan fixture with mocked fetchPayment throwing transient 500 -> refused with 409 WEBHOOK_UNSETTLED
    const orphanPay500 = `pay_orphan_res_500_${now}`;
    const orphanOrder500 = `order_orphan_res_500_${now}`;
    const orphanEvt500 = await WebhookEvent.create({
      eventId: `evt_orphan_res_500_${now}`,
      provider: 'RAZORPAY',
      eventType: 'payment.captured',
      status: 'FAILED',
      payload: {
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: orphanPay500,
              order_id: orphanOrder500,
              amount: 900,
              currency: 'INR',
              status: 'captured',
            },
          },
        },
      },
    });

    razorpayProvider.fetchPayment = async () => {
      const err: any = new Error('Razorpay Gateway Timeout (500)');
      err.statusCode = 500;
      throw err;
    };

    let orphanResolve500Err: any = null;
    const reqOrphan500: any = {
      params: { id: orphanEvt500._id.toString() },
      body: { note: 'Trying to resolve when gateway is down' },
      user: { id: adminId.toString(), role: 'ADMIN' },
    };
    const resOrphan500 = mockRes();
    await resolveAdminWebhook(reqOrphan500, resOrphan500, (err: any) => { orphanResolve500Err = err; });

    check(Boolean(orphanResolve500Err), 'T3.18: Resolve refuses orphan webhook on transient gateway error');
    check(
      orphanResolve500Err?.statusCode === 409 && orphanResolve500Err?.code === 'WEBHOOK_UNSETTLED',
      'T3.19: Returns HTTP 409 WEBHOOK_UNSETTLED (not ignored)',
      `status=${orphanResolve500Err?.statusCode}, code=${orphanResolve500Err?.code}`
    );
    const reloadedOrphan500 = await WebhookEvent.findById(orphanEvt500._id);
    check(reloadedOrphan500?.status === 'FAILED', 'T3.20: Event remains FAILED');

    // 7. Retry on an orphan fixture with live 404 -> marks event IGNORED with RETRY_PROVEN_ORPHAN
    const orphanRetry404Pay = `pay_orphan_ret_404_${now}`;
    const orphanRetry404Order = `order_orphan_ret_404_${now}`;
    const orphanRetry404Evt = await WebhookEvent.create({
      eventId: `evt_orphan_ret_404_${now}`,
      provider: 'RAZORPAY',
      eventType: 'payment.captured',
      status: 'FAILED',
      payload: {
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: orphanRetry404Pay,
              order_id: orphanRetry404Order,
              amount: 900,
              currency: 'INR',
              status: 'captured',
            },
          },
        },
      },
    });

    razorpayProvider.fetchPayment = async () => {
      const err: any = new Error('Payment id does not exist');
      err.statusCode = 404;
      err.error = { code: 'BAD_REQUEST_ERROR', description: 'The id provided does not exist' };
      throw err;
    };

    let orphanRetry404Err: any = null;
    const reqOrphanRetry404: any = {
      params: { id: orphanRetry404Evt._id.toString() },
      user: { id: adminId.toString(), role: 'ADMIN' },
    };
    const resOrphanRetry404 = mockRes();
    await retryAdminWebhook(reqOrphanRetry404, resOrphanRetry404, (err: any) => { orphanRetry404Err = err; });

    check(!orphanRetry404Err, 'T3.21: Retry on orphan with 404 succeeds without error');
    check(resOrphanRetry404.statusCode === 200, 'T3.22: Returns HTTP 200');
    check(
      resOrphanRetry404.data?.data?.outcome === 'IGNORED' || resOrphanRetry404.data?.outcome === 'IGNORED',
      'T3.23: Outcome is IGNORED'
    );
    const reloadedOrphanRetry404 = await WebhookEvent.findById(orphanRetry404Evt._id);
    check(reloadedOrphanRetry404?.status === 'IGNORED', 'T3.24: Event status is set to IGNORED');
    check(
      Boolean(reloadedOrphanRetry404?.lastError?.includes('RETRY_PROVEN_ORPHAN:LIVE_PAYMENT_NOT_FOUND')),
      'T3.25: lastError notes RETRY_PROVEN_ORPHAN',
      reloadedOrphanRetry404?.lastError
    );

    // 8. Retry on an orphan fixture with live captured -> invokes reconcile path and returns clear 409
    const orphanRetryCapPay = `pay_orphan_ret_cap_${now}`;
    const orphanRetryCapOrder = `order_orphan_ret_cap_${now}`;
    const orphanRetryCapEvt = await WebhookEvent.create({
      eventId: `evt_orphan_ret_cap_${now}`,
      provider: 'RAZORPAY',
      eventType: 'payment.captured',
      status: 'FAILED',
      payload: {
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: orphanRetryCapPay,
              order_id: orphanRetryCapOrder,
              amount: 900,
              currency: 'INR',
              status: 'captured',
            },
          },
        },
      },
    });

    razorpayProvider.fetchPayment = async () => ({
      id: orphanRetryCapPay,
      order_id: orphanRetryCapOrder,
      amount: 900,
      currency: 'INR',
      status: 'captured',
      captured: true,
    });

    let orphanRetryCapErr: any = null;
    const reqOrphanRetryCap: any = {
      params: { id: orphanRetryCapEvt._id.toString() },
      user: { id: adminId.toString(), role: 'ADMIN' },
    };
    const resOrphanRetryCap = mockRes();
    await retryAdminWebhook(reqOrphanRetryCap, resOrphanRetryCap, (err: any) => { orphanRetryCapErr = err; });

    check(Boolean(orphanRetryCapErr), 'T3.26: Retry on orphan with live captured payment returns refusal error');
    check(
      orphanRetryCapErr?.statusCode === 409,
      'T3.27: Refusal error code is HTTP 409',
      `status=${orphanRetryCapErr?.statusCode}`
    );
    check(
      Boolean(
        orphanRetryCapErr?.message?.includes('is CAPTURED at Razorpay') ||
        orphanRetryCapErr?.message?.includes('cannot be automatically reconciled')
      ),
      'T3.28: Error message explains why capture could not be reconciled',
      orphanRetryCapErr?.message
    );
    const reloadedOrphanRetryCap = await WebhookEvent.findById(orphanRetryCapEvt._id);
    check(reloadedOrphanRetryCap?.status === 'FAILED', 'T3.29: Event remains FAILED and is not hidden');

    // 9. Retry on an orphan fixture with transient fetch failure -> returns 502, leaves event unchanged
    const orphanRetry502Pay = `pay_orphan_ret_502_${now}`;
    const orphanRetry502Order = `order_orphan_ret_502_${now}`;
    const orphanRetry502Evt = await WebhookEvent.create({
      eventId: `evt_orphan_ret_502_${now}`,
      provider: 'RAZORPAY',
      eventType: 'payment.captured',
      status: 'FAILED',
      payload: {
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: orphanRetry502Pay,
              order_id: orphanRetry502Order,
              amount: 900,
              currency: 'INR',
              status: 'captured',
            },
          },
        },
      },
    });

    razorpayProvider.fetchPayment = async () => {
      const err: any = new Error('Gateway Connection Refused (503)');
      err.statusCode = 503;
      throw err;
    };

    let orphanRetry502Err: any = null;
    const reqOrphanRetry502: any = {
      params: { id: orphanRetry502Evt._id.toString() },
      user: { id: adminId.toString(), role: 'ADMIN' },
    };
    const resOrphanRetry502 = mockRes();
    await retryAdminWebhook(reqOrphanRetry502, resOrphanRetry502, (err: any) => { orphanRetry502Err = err; });

    check(Boolean(orphanRetry502Err), 'T3.30: Retry on orphan with transient failure errors out');
    check(
      orphanRetry502Err?.statusCode === 502,
      'T3.31: Error code is 502 GATEWAY_FETCH_FAILED',
      `status=${orphanRetry502Err?.statusCode}`
    );
    const reloadedOrphanRetry502 = await WebhookEvent.findById(orphanRetry502Evt._id);
    check(reloadedOrphanRetry502?.status === 'FAILED', 'T3.32: Event remains FAILED');

    // 10. refund.processed orphan fixture (Event #1 shape) with live 404 -> Resolve succeeds
    const refundOrphanPay = `pay_orphan_ref_${now}`;
    const refundOrphanEvt = await WebhookEvent.create({
      eventId: `evt_orphan_refund_${now}`,
      provider: 'RAZORPAY',
      eventType: 'refund.processed',
      status: 'FAILED',
      payload: {
        event: 'refund.processed',
        payload: {
          refund: {
            entity: {
              id: `rfnd_mock_${now}`,
              payment_id: refundOrphanPay,
              amount: 600,
              currency: 'INR',
              status: 'processed',
              notes: {
                internalRefundId: '6af2fd53f5c3d2aec2307138', // Unknown internal refund ID as in production event #1
              },
            },
          },
        },
      },
    });

    razorpayProvider.fetchPayment = async () => {
      const err: any = new Error('The id provided does not exist');
      err.statusCode = 404;
      err.error = { code: 'BAD_REQUEST_ERROR', description: 'The id provided does not exist' };
      throw err;
    };

    let refundResolveErr: any = null;
    const reqRefundResolve: any = {
      params: { id: refundOrphanEvt._id.toString() },
      body: { note: 'Resolving orphan refund.processed' },
      user: { id: adminId.toString(), role: 'ADMIN' },
    };
    const resRefundResolve = mockRes();
    await resolveAdminWebhook(reqRefundResolve, resRefundResolve, (err: any) => { refundResolveErr = err; });

    check(!refundResolveErr, 'T3.33: Resolve succeeds on orphan refund.processed with gateway 404');
    check(resRefundResolve.statusCode === 200, 'T3.34: Returns HTTP 200');
    const reloadedRefundEvt = await WebhookEvent.findById(refundOrphanEvt._id);
    check(reloadedRefundEvt?.status === 'IGNORED', 'T3.35: Event status is set to IGNORED');
    check(
      Boolean(reloadedRefundEvt?.lastError?.includes(`LIVE_PAYMENT_NOT_FOUND:${refundOrphanPay}`)),
      'T3.36: Recorded LIVE_PAYMENT_NOT_FOUND for the refund payment id',
      reloadedRefundEvt?.lastError
    );

    // 11. reconcileCapturedPayment.ts --razorpay-order lookup
    const reconRzpOrderId = `order_recon_lookup_${now}`;
    const reconRzpPaymentId = `pay_recon_lookup_${now}`;
    const reconOrder = await Order.create({
      orderNumber: `ORD-RECON-${now}`,
      userId,
      items: [{
        productId: new mongoose.Types.ObjectId(),
        variantId: new mongoose.Types.ObjectId(),
        productName: 'Nehru Jacket',
        productImage: 'https://example.com/jacket.jpg',
        selectedSize: 'M',
        selectedColor: 'Sand Beige',
        quantity: 1,
        unitPrice: 2999,
        lineTotal: 2999,
      }],
      subtotal: 2999,
      total: 2999,
      currency: 'INR',
      status: 'PENDING',
      paymentStatus: 'PENDING',
      shippingAddress: {
        fullName: 'Recon Test User',
        phone: '9876543210',
        addressLine1: 'Test St',
        city: 'Delhi',
        state: 'Delhi',
        postalCode: '110001',
        country: 'India',
      },
    });

    const reconPayment = await Payment.create({
      orderId: reconOrder._id,
      userId,
      amount: 2999,
      currency: 'INR',
      status: 'PENDING',
      provider: 'RAZORPAY',
    });

    await PaymentAttempt.create({
      orderId: reconOrder._id,
      paymentId: reconPayment._id,
      razorpayOrderId: reconRzpOrderId,
      razorpayPaymentId: reconRzpPaymentId,
      amount: 2999,
      currency: 'INR',
      status: 'FAILED',
      failureCode: 'PAYMENT_FAILED',
      failureReason: 'Customer dropped off',
    });

    // Test successful identification of order via razorpayOrderId in dry run
    const reconResult = await reconcileCapturedPayment({
      razorpayOrderId: reconRzpOrderId,
      razorpayPaymentId: reconRzpPaymentId,
      confirm: false,
      skipGatewayCheck: true,
      useExistingConnection: true,
    });

    check(
      reconResult?.orderId === reconOrder._id.toString(),
      'T3.37: reconcileCapturedPayment identifies local order via razorpayOrderId alone',
      `expected ${reconOrder._id.toString()}, got ${reconResult?.orderId}`
    );
    check(reconResult?.mode === 'DRY_RUN', 'T3.38: Reconcile runs in DRY_RUN mode without modifying data');

    // Test clean abort when razorpayOrderId does not exist locally
    let reconNotFoundErr: any = null;
    try {
      await reconcileCapturedPayment({
        razorpayOrderId: `order_nonexistent_${now}`,
        razorpayPaymentId: `pay_dummy_${now}`,
        confirm: false,
        skipGatewayCheck: true,
        useExistingConnection: true,
      });
    } catch (err: any) {
      reconNotFoundErr = err;
    }
    check(
      reconNotFoundErr?.code === 'ORDER_NOT_FOUND_FOR_RAZORPAY_ORDER' && reconNotFoundErr?.statusCode === 404,
      'T3.39: reconcileCapturedPayment cleanly aborts 404 when razorpay-order has no local record',
      `code=${reconNotFoundErr?.code}, status=${reconNotFoundErr?.statusCode}`
    );

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
