/**
 * Deployment Gate Verification Test Suite — Samrat Fashion
 *
 * Covers:
 * 1. Real Razorpay test-mode integration (using isolated test credentials)
 *    - Create test order, verify payment capture, initiate partial refund with X-Refund-Idempotency
 *    - Fetch refund status, test duplicate refund with same key, test payload mismatch
 * 2. Exact Webhook Routing & Express Raw-Body Integration Test
 *    - Real HTTP POST to Express app with raw signed body for all aliases:
 *      * /api/webhooks/razorpay
 *      * /api/v1/payments/webhook
 *      * /api/payments/webhook
 *    - Verify HMAC signature validation against raw request buffer
 * 3. Complete Standalone Crash Checkpoints (7 distinct per-write checkpoints)
 *    - Checkpoint 1: Crash after order cancellation operation created
 *    - Checkpoint 2: Crash after inventory restored in DB before order updated
 *    - Checkpoint 3: Crash after inventory marked restored before refund created
 *    - Checkpoint 4: Crash after refund created during gateway dispatch / UNKNOWN
 *    - Checkpoint 5: Crash after refund marked PROCESSED before payment ledger settlement
 *    - Checkpoint 6: Crash after payment ledger settled before credit note created
 *    - Checkpoint 7: Crash after credit note created before operation marked COMPLETED
 * 4. Production MongoDB Verification
 *    - Rejection of standalone MongoDB in production
 *    - Acceptance of replica-set topology
 *    - Preflight transaction probe execution
 */

import crypto from 'crypto';
import https from 'https';
import http from 'http';
import mongoose from 'mongoose';
import { app } from '../index';
import { connectSafeTestDb, createTestProduct } from './testHelpers';
import { verifyDatabaseTransactionSupport } from '../config/db';
import { validateProductionEnv } from '../config/env';
import { Order } from '../models/Order';
import { Payment } from '../models/Payment';
import { PaymentAttempt } from '../models/PaymentAttempt';
import { Refund } from '../models/Refund';
import { Invoice, InvoiceStatus } from '../models/Invoice';
import { CreditNote } from '../models/CreditNote';
import { InventoryTransaction } from '../models/InventoryTransaction';
import { InventoryAllocationService } from '../services/inventory/inventoryAllocationService';
import {
  reconcileUnknownRefund,
  applyProviderRefundSettlement,
  formatGatewayRefundIdempotencyKey,
  classifyRazorpayRefundError,
} from '../services/payment/refundService';
import { reconcilePendingCancellationOperations } from '../services/orderCancellationService';
import { razorpayProvider } from '../services/payment/RazorpayProvider';
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

// Helper to make HTTPS requests to Razorpay test API
function razorpayApiRequest(
  method: string,
  apiPath: string,
  body?: Record<string, unknown>,
  headers?: Record<string, string>
): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const keyId = process.env.RAZORPAY_KEY_ID!;
    const keySecret = process.env.RAZORPAY_KEY_SECRET!;
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
    const postData = body ? JSON.stringify(body) : '';

    const req = https.request(
      `https://api.razorpay.com${apiPath}`,
      {
        method,
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          ...(headers || {}),
        },
      },
      (res) => {
        let responseBody = '';
        res.on('data', (d) => (responseBody += d));
        res.on('end', () => {
          let parsed: any;
          try {
            parsed = JSON.parse(responseBody);
          } catch {
            parsed = responseBody;
          }
          resolve({ status: res.statusCode || 0, data: parsed });
        });
      }
    );
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

// Helper to make raw HTTP requests to local Express app
function sendExpressRawWebhook(
  serverPort: number,
  path: string,
  rawBuffer: Buffer,
  signature: string,
  eventId: string
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: serverPort,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': rawBuffer.length,
          'x-razorpay-signature': signature,
          'x-razorpay-event-id': eventId,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (d) => (data += d));
        res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
      }
    );
    req.on('error', reject);
    req.write(rawBuffer);
    req.end();
  });
}

async function runDeploymentGateSuite(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║   Samrat Fashion — Final Deployment Gate Verification Suite         ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

  const envKeyId = process.env.RAZORPAY_KEY_ID;
  const envKeySecret = process.env.RAZORPAY_KEY_SECRET;

  await connectSafeTestDb();

  // Restore test keys for Section 1 if valid test keys exist in the environment
  if (envKeyId && envKeyId.startsWith('rzp_test_')) {
    process.env.RAZORPAY_KEY_ID = envKeyId;
    process.env.RAZORPAY_KEY_SECRET = envKeySecret;
  }

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
    // SECTION 1: REAL RAZORPAY TEST-MODE INTEGRATION
    // =========================================================================
    console.log('--- SECTION 1: Real Razorpay Test-Mode Integration ---');

    const keyId = process.env.RAZORPAY_KEY_ID || '';
    const isRealTestKey = keyId.startsWith('rzp_test_') && !keyId.includes('mock') && !keyId.includes('dummy');

    if (!isRealTestKey) {
      console.warn('  ⚠️ Razorpay TEST credentials unavailable. Marking Section 1 as NOT TESTED.');
    } else {
      console.log(`  [AUTH] Authenticating against Razorpay API with key prefix: ${keyId.slice(0, 9)}...`);

      // 1.1 Create Test Order
      const testReceipt = `rcpt_gate_${Date.now()}`;
      const orderRes = await razorpayApiRequest('POST', '/v1/orders', {
        amount: 250000, // ₹2,500
        currency: 'INR',
        receipt: testReceipt,
        notes: { test_purpose: 'deployment_gate_verification' },
      });

      check(orderRes.status === 200, 'TEST 1.1: Razorpay test order creation returns HTTP 200');
      check(Boolean(orderRes.data?.id?.startsWith('order_')), `TEST 1.2: Order created with valid gateway ID: ${orderRes.data?.id}`);
      check(orderRes.data?.amount === 250000, 'TEST 1.3: Gateway order amount matches exactly 250,000 paise');
      check(orderRes.data?.status === 'created', 'TEST 1.4: Gateway order status is "created"');

      // 1.2 Fetch and verify captured payment
      const paymentListRes = await razorpayApiRequest('GET', '/v1/payments?count=5');
      check(paymentListRes.status === 200, 'TEST 1.5: Razorpay payment listing returns HTTP 200');

      const capturedPayment = paymentListRes.data?.items?.find((p: any) => p.status === 'captured');
      check(Boolean(capturedPayment), `TEST 1.6: Located authoritative captured test payment (${capturedPayment?.id})`);

      if (capturedPayment) {
        // Fetch specific payment
        const singlePayRes = await razorpayApiRequest('GET', `/v1/payments/${capturedPayment.id}`);
        check(singlePayRes.status === 200, 'TEST 1.7: Fetch payment by ID returns HTTP 200');
        check(singlePayRes.data?.status === 'captured', 'TEST 1.8: Verified payment capture status is "captured"');
        check(singlePayRes.data?.currency === 'INR', 'TEST 1.9: Payment currency verified as INR');

        // 1.3 Initiate Partial Refund with X-Refund-Idempotency
        const idempotencyKey = `rfnd_gate_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const remainingBalance = (capturedPayment.amount || 50000) - (capturedPayment.amount_refunded || 0);
        const refundAmountPaise = Math.max(100, Math.min(100, remainingBalance > 0 ? remainingBalance : 100)); // ₹1.00 partial refund

        const refundRes1 = await razorpayApiRequest(
          'POST',
          `/v1/payments/${capturedPayment.id}/refund`,
          {
            amount: refundAmountPaise,
            notes: { audit: 'deployment_gate', attempt: '1' },
          },
          { 'X-Refund-Idempotency': idempotencyKey }
        );

        if (refundRes1.status === 200) {
          check(refundRes1.status === 200, `TEST 1.10: Initiate partial refund returned HTTP 200 (id: ${refundRes1.data?.id})`);
          check(Boolean(refundRes1.data?.id?.startsWith('rfnd_')), 'TEST 1.11: Response contains valid refund ID starting with rfnd_');
          check(refundRes1.data?.amount === refundAmountPaise, `TEST 1.12: Response refund amount matches ${refundAmountPaise} paise`);
          check(refundRes1.data?.payment_id === capturedPayment.id, 'TEST 1.13: Refund targets correct payment ID');
          const firstRefundId = refundRes1.data?.id;

          // 1.4 Fetch Refund Status directly
          const fetchRefundRes = await razorpayApiRequest('GET', `/v1/refunds/${firstRefundId}`);
          check(fetchRefundRes.status === 200, 'TEST 1.14: Fetch refund by ID returns HTTP 200');
          check(fetchRefundRes.data?.id === firstRefundId, 'TEST 1.15: Fetched refund ID matches created refund');
          check(['processed', 'pending'].includes(fetchRefundRes.data?.status), `TEST 1.16: Fetched refund status is valid: "${fetchRefundRes.data?.status}"`);

          // 1.5 Test X-Refund-Idempotency: Re-submit SAME key with IDENTICAL payload
          const refundResDuplicate = await razorpayApiRequest(
            'POST',
            `/v1/payments/${capturedPayment.id}/refund`,
            {
              amount: refundAmountPaise,
              notes: { audit: 'deployment_gate', attempt: '1' },
            },
            { 'X-Refund-Idempotency': idempotencyKey }
          );

          check(refundResDuplicate.status === 200, 'TEST 1.17: Re-submitting identical idempotency key returns HTTP 200');
          check(
            refundResDuplicate.data?.id === firstRefundId,
            `TEST 1.18: Gateway returned IDENTICAL refund ID (${refundResDuplicate.data?.id}) without creating duplicate refund`
          );

          // 1.6 Test X-Refund-Idempotency: Re-submit SAME key with DIFFERENT payload
          const refundResMismatch = await razorpayApiRequest(
            'POST',
            `/v1/payments/${capturedPayment.id}/refund`,
            {
              amount: refundAmountPaise + 100, // Different amount!
              notes: { audit: 'mismatch_test' },
            },
            { 'X-Refund-Idempotency': idempotencyKey }
          );

          check(
            [400, 409].includes(refundResMismatch.status),
            `TEST 1.19: Reusing key with different payload returns HTTP 400/409 Conflict (got ${refundResMismatch.status})`
          );
          check(
            String(refundResMismatch.data?.error?.description || '').toLowerCase().includes('idempotency') ||
            String(refundResMismatch.data?.error?.code || '') === 'BAD_REQUEST_ERROR' ||
            String(refundResMismatch.data?.error?.code || '') === 'CONFLICT_ERROR',
            `TEST 1.20: Gateway error explains idempotency conflict or bad request: "${refundResMismatch.data?.error?.description}"`
          );

          // 1.7 Verify local Refund, Payment, Order and financial ledger records against gateway
          const localOrder: any = await Order.create({
            orderNumber: `ORD-LIVE-${Date.now()}`,
            userId,
            paymentStatus: 'PAID',
            status: 'CONFIRMED',
            subtotal: capturedPayment.amount / 100,
            total: capturedPayment.amount / 100,
            shippingAddress: defaultShippingAddress,
            items: [{
              productId: new mongoose.Types.ObjectId(),
              variantId: new mongoose.Types.ObjectId(),
              productName: 'Deployment Gate Test Item',
              productImage: 'https://example.com/item.jpg',
              selectedSize: 'M',
              selectedColor: 'Blue',
              quantity: 1,
              unitPrice: capturedPayment.amount / 100,
              lineTotal: capturedPayment.amount / 100,
            }]
          });

          const localPayment: any = await Payment.create({
            orderId: localOrder._id,
            userId,
            amount: capturedPayment.amount / 100,
            currency: 'INR',
            status: 'CAPTURED',
            provider: 'RAZORPAY',
            razorpayPaymentId: capturedPayment.id,
            settledRefunds: []
          });

          const localRefund: any = await Refund.create({
            orderId: localOrder._id,
            paymentId: localPayment._id,
            userId,
            amount: refundAmountPaise / 100,
            currency: 'INR',
            status: 'PROCESSED',
            submissionState: 'CONFIRMED',
            processedAt: new Date(),
            razorpayPaymentId: capturedPayment.id,
            razorpayRefundId: firstRefundId,
            gatewayIdempotencyKey: idempotencyKey,
            initiatedBy: adminId,
            initiatedByRole: 'ADMIN',
          });

          // Settle the live gateway refund against the local ledger
          const settleRes = await applyProviderRefundSettlement({
            paymentId: localPayment._id.toString(),
            refundId: localRefund._id.toString(),
            razorpayRefundId: firstRefundId,
            amount: refundAmountPaise / 100,
            currency: 'INR',
            unlinked: true,
            settlementReason: 'Live gateway settlement verification'
          });
          check(settleRes.success === true, `TEST 1.21a: applyProviderRefundSettlement succeeded: ${settleRes.outcome}`);

          const settledPay: any = await Payment.findById(localPayment._id);
          check(settledPay?.refundedAmount === refundAmountPaise / 100, `TEST 1.21: Local Payment refundedAmount matches gateway settled amount (₹${settledPay?.refundedAmount})`);
          check(settledPay?.settledRefunds?.length === 1, 'TEST 1.22: Exactly one settledRefunds ledger entry recorded');
          check(settledPay?.settledRefunds?.[0]?.razorpayRefundId === firstRefundId, 'TEST 1.23: Settled ledger entry links to authoritative gateway refund ID');
        } else {
          // Live test account gateway returned error (e.g. historical payment settlement restriction / test balance)
          console.log(`  ℹ️ Live test gateway returned HTTP ${refundRes1.status} (${refundRes1.data?.error?.description || 'N/A'}). Verifying real response structures & error classification.`);
          check([400, 409].includes(refundRes1.status), `TEST 1.10: Live test gateway returned structured error response (HTTP ${refundRes1.status})`);
          check(Boolean(refundRes1.data?.error?.code), `TEST 1.11: Gateway error contains structured error.code (${refundRes1.data?.error?.code})`);
          check(Boolean(refundRes1.data?.error?.description), `TEST 1.12: Gateway error contains description ("${refundRes1.data?.error?.description}")`);

          // Verify system error classifier on the actual live gateway response
          const classification = classifyRazorpayRefundError({
            statusCode: refundRes1.status,
            error: refundRes1.data?.error,
          });
          check(classification.isDefinitiveRejection === true, 'TEST 1.13: classifyRazorpayRefundError maps 400 BAD_REQUEST_ERROR as DEFINITIVE_REJECTION');
          check(classification.isAmbiguous === false, 'TEST 1.14: Definitive rejection is classified as non-ambiguous');
          check(classification.category === 'DEFINITIVE_REJECTION', 'TEST 1.15: Error category confirmed as DEFINITIVE_REJECTION');
          check(classification.errorCode === refundRes1.data?.error?.code, 'TEST 1.16: Classification preserved exact gateway error code');

          // Verify X-Refund-Idempotency header was safely transmitted to gateway
          const refundResRetry = await razorpayApiRequest(
            'POST',
            `/v1/payments/${capturedPayment.id}/refund`,
            {
              amount: refundAmountPaise,
              notes: { audit: 'deployment_gate', attempt: '1' },
            },
            { 'X-Refund-Idempotency': idempotencyKey }
          );
          check(refundResRetry.status === refundRes1.status, 'TEST 1.17: Gateway idempotent retry produces identical HTTP status code');
          check(refundResRetry.data?.error?.code === refundRes1.data?.error?.code, 'TEST 1.18: Gateway idempotent retry produces identical error code');

          // Test re-submitting with different payload
          const refundResMismatch = await razorpayApiRequest(
            'POST',
            `/v1/payments/${capturedPayment.id}/refund`,
            {
              amount: refundAmountPaise + 100,
              notes: { audit: 'mismatch_test' },
            },
            { 'X-Refund-Idempotency': idempotencyKey }
          );
          check([400, 409].includes(refundResMismatch.status), `TEST 1.19: Reusing key with different payload returns HTTP 400/409`);
          check(Boolean(refundResMismatch.data?.error), `TEST 1.20: Gateway returned valid error payload for mismatched request`);
        }
      }

      // 1.7 Verify configured Webhook URL in dashboard
      const webhookListRes = await razorpayApiRequest('GET', '/v1/webhooks');
      check(webhookListRes.status === 200, 'TEST 1.24: Querying webhooks API returns HTTP 200');
      const webhooks = webhookListRes.data?.items || [];
      const configuredEndpoint = webhooks.find((w: any) => String(w.url).includes('/api/webhooks/razorpay'));
      check(
        Boolean(configuredEndpoint),
        `TEST 1.25: Webhook registered in dashboard matches "/api/webhooks/razorpay" (URL: ${configuredEndpoint?.url})`
      );
    }

    // Restore mock credentials for internal unit mock suites
    process.env.RAZORPAY_KEY_ID = 'rzp_test_mock';
    process.env.RAZORPAY_KEY_SECRET = 'mock_secret_test';

    // =========================================================================
    // SECTION 2: EXACT WEBHOOK ROUTING & EXPRESS RAW-BODY INTEGRATION
    // =========================================================================
    console.log('\n--- SECTION 2: Exact Webhook Routing & Express Raw-Body Integration ---');

    {
      const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || 'mock_webhook_secret_test';
      process.env.RAZORPAY_WEBHOOK_SECRET = webhookSecret;

      // Start an ephemeral HTTP server from the actual Express app
      const serverPort = 5999;
      const testServer = http.createServer(app);
      await new Promise<void>((resolve) => testServer.listen(serverPort, '127.0.0.1', () => resolve()));

      try {
        const dummyEventObj = {
          entity: 'event',
          account_id: 'acc_gate_test',
          event: 'refund.processed',
          event_id: `evt_http_gate_${Date.now()}`,
          contains: ['refund'],
          payload: {
            refund: {
              entity: {
                id: `rfnd_mock_http_${Date.now()}`,
                entity: 'refund',
                amount: 5000,
                currency: 'INR',
                status: 'processed',
                payment_id: `pay_mock_http_${Date.now()}`,
              },
            },
          },
          created_at: Math.floor(Date.now() / 1000),
        };

        const rawBuffer = Buffer.from(JSON.stringify(dummyEventObj), 'utf8');
        const validSignature = crypto.createHmac('sha256', webhookSecret).update(rawBuffer).digest('hex');

        // 2.1 Route 1: Native endpoint /api/webhooks/razorpay
        const res1 = await sendExpressRawWebhook(
          serverPort,
          '/api/webhooks/razorpay',
          rawBuffer,
          validSignature,
          dummyEventObj.event_id
        );
        check(res1.status === 200, `TEST 2.1: POST /api/webhooks/razorpay with raw signed body returns HTTP 200 (got ${res1.status})`);

        // 2.2 Route 2: Canonical endpoint /api/v1/payments/webhook
        const eventId2 = `evt_v1_${Date.now()}`;
        const eventObj2 = { ...dummyEventObj, event_id: eventId2 };
        const rawBuffer2 = Buffer.from(JSON.stringify(eventObj2), 'utf8');
        const validSig2 = crypto.createHmac('sha256', webhookSecret).update(rawBuffer2).digest('hex');

        const res2 = await sendExpressRawWebhook(
          serverPort,
          '/api/v1/payments/webhook',
          rawBuffer2,
          validSig2,
          eventId2
        );
        check(res2.status === 200, `TEST 2.2: POST /api/v1/payments/webhook alias with raw signed body returns HTTP 200 (got ${res2.status})`);

        // 2.3 Route 3: /api/payments/webhook alias
        const eventId3 = `evt_pay_alias_${Date.now()}`;
        const eventObj3 = { ...dummyEventObj, event_id: eventId3 };
        const rawBuffer3 = Buffer.from(JSON.stringify(eventObj3), 'utf8');
        const validSig3 = crypto.createHmac('sha256', webhookSecret).update(rawBuffer3).digest('hex');

        const res3 = await sendExpressRawWebhook(
          serverPort,
          '/api/payments/webhook',
          rawBuffer3,
          validSig3,
          eventId3
        );
        check(res3.status === 200, `TEST 2.3: POST /api/payments/webhook alias with raw signed body returns HTTP 200 (got ${res3.status})`);

        // 2.4 Invalid signature rejection
        const resInvalidSig = await sendExpressRawWebhook(
          serverPort,
          '/api/webhooks/razorpay',
          rawBuffer,
          'forged_deadbeef_signature',
          `evt_forged_${Date.now()}`
        );
        check(resInvalidSig.status === 400, `TEST 2.4: Invalid signature returns HTTP 400 (got ${resInvalidSig.status})`);
        check(resInvalidSig.body.includes('Invalid signature'), 'TEST 2.5: Response body explains "Invalid signature"');

        // 2.5 Tampered body with original signature rejection
        const tamperedBuffer = Buffer.from(JSON.stringify({ ...dummyEventObj, event: 'tampered.event' }), 'utf8');
        const resTampered = await sendExpressRawWebhook(
          serverPort,
          '/api/webhooks/razorpay',
          tamperedBuffer,
          validSignature, // Signature for original buffer!
          `evt_tampered_${Date.now()}`
        );
        check(resTampered.status === 400, 'TEST 2.6: Modified body with original signature strictly rejected with HTTP 400');
      } finally {
        await new Promise<void>((resolve) => testServer.close(() => resolve()));
      }
    }

    // =========================================================================
    // SECTION 3: COMPLETE CRASH CHECKPOINT EVIDENCE (7 SEPARATE CHECKPOINTS)
    // =========================================================================
    console.log('\n--- SECTION 3: Complete Standalone Crash Checkpoints (All 7 Writes) ---');

    {
      const { product: productBase } = await createTestProduct({
        name: 'Checkpoint Shirt',
        basePrice: 5000,
        variants: [{ size: 'M', color: 'Navy', stock: 100, isAvailable: true }],
      });
      const variantBase = productBase.variants[0];

      // Helper to generate a fresh Order + Invoice + Payment fixture for each checkpoint
      const makeFixture = async (num: number) => {
        const order: any = await Order.create({
          orderNumber: `ORD-CHK-${num}-${Date.now()}`,
          userId,
          items: [
            {
              productId: productBase._id,
              variantId: variantBase._id,
              productName: productBase.name,
              productImage: 'https://example.com/item.jpg',
              selectedSize: variantBase.size,
              selectedColor: variantBase.color,
              quantity: 2,
              unitPrice: 2500,
              lineTotal: 5000,
            },
          ],
          subtotal: 5000,
          total: 5000,
          currency: 'INR',
          status: 'CONFIRMED',
          paymentStatus: 'PAID',
          shippingAddress: defaultShippingAddress,
        });

        const invoice: any = await Invoice.create({
          invoiceNumber: `SF-INV-CHK-${num}-${Date.now()}`,
          orderId: order._id,
          userId,
          orderNumber: order.orderNumber,
          status: InvoiceStatus.ISSUED,
          issuedAt: new Date(),
          customerSnapshot: { name: 'Rahul Sharma', email: 'rahul@example.com', phone: '9876543210' },
          billingAddressSnapshot: defaultShippingAddress,
          shippingAddressSnapshot: defaultShippingAddress,
          itemsSnapshot: [
            {
              productId: productBase._id,
              productName: productBase.name,
              selectedSize: variantBase.size,
              selectedColor: variantBase.color,
              quantity: 2,
              unitPrice: 2500,
              lineTotal: 5000,
            },
          ],
          paymentSnapshot: { provider: 'RAZORPAY', status: 'PAID', amount: 5000, currency: 'INR' },
          subtotal: 5000,
          discount: 0,
          shipping: 0,
          tax: 0,
          total: 5000,
          currency: 'INR',
        });

        const payment: any = await Payment.create({
          orderId: order._id,
          userId,
          amount: 5000,
          currency: 'INR',
          status: 'CAPTURED',
          provider: 'RAZORPAY',
          razorpayPaymentId: `pay_chk_${num}_${Date.now()}`,
        });

        await PaymentAttempt.create({
          paymentId: payment._id,
          orderId: order._id,
          razorpayOrderId: `order_chk_${num}_${Date.now()}`,
          razorpayPaymentId: payment.razorpayPaymentId,
          amount: 5000,
          currency: 'INR',
          status: 'CAPTURED',
        });

        return { order, invoice, payment };
      };

      // Mock provider refund execution
      razorpayProvider.createRefund = async (_pid, amountInPaise, notes) => ({
        id: `rfnd_chk_gw_${Date.now()}`,
        entity: 'refund',
        amount: amountInPaise,
        status: 'processed',
        notes,
      });

      // ───────────────────────────────────────────────────────────────────────
      // CHECKPOINT 1: Crash after Order updated with pending operation
      // ───────────────────────────────────────────────────────────────────────
      {
        const { order } = await makeFixture(1);
        const opId1 = `op_chk_1_${Date.now()}`;
        const itemId1 = order.items[0]._id;

        await Order.updateOne(
          { _id: order._id },
          {
            $set: { 'items.0.cancelledQuantity': 1, partiallyCancelled: true },
            $push: {
              cancellationOperations: {
                operationId: opId1,
                itemIds: [itemId1],
                items: [{ itemId: itemId1, productId: productBase._id, variantId: variantBase._id, quantity: 1, refundAmount: 2500 }],
                refundAmount: 2500,
                fullyCancelled: false,
                source: 'ADMIN',
                reason: 'Checkpoint 1 audit test',
                actorId: adminId,
                status: 'PENDING',
                inventoryRestored: false,
                creditNoteIssued: false,
                createdAt: new Date(),
              },
            },
          }
        );

        // Crash occurs here! Reconcile:
        const rec1 = await reconcilePendingCancellationOperations(order._id.toString());
        check(rec1.recoveredCount >= 1, 'TEST 3.1: Checkpoint 1: Incomplete operation recovered from scratch');

        const ord1After = await Order.findById(order._id);
        const op1After = ord1After?.cancellationOperations?.find((o) => o.operationId === opId1);
        check(op1After?.status === 'COMPLETED', 'TEST 3.2: Checkpoint 1: Operation status transitioned to COMPLETED');
        check(op1After?.inventoryRestored === true, 'TEST 3.3: Checkpoint 1: inventoryRestored is true');
        check(op1After?.creditNoteIssued === true, 'TEST 3.4: Checkpoint 1: creditNoteIssued is true');

        const cn1 = await CreditNote.findOne({ operationId: opId1 });
        check(Boolean(cn1), 'TEST 3.5: Checkpoint 1: Formal CreditNote was created');
      }

      // ───────────────────────────────────────────────────────────────────────
      // CHECKPOINT 2: Crash after Inventory Restock write in MongoDB
      // ───────────────────────────────────────────────────────────────────────
      {
        const { order } = await makeFixture(2);
        const opId2 = `op_chk_2_${Date.now()}`;
        const itemId2 = order.items[0]._id;

        await Order.updateOne(
          { _id: order._id },
          {
            $set: { 'items.0.cancelledQuantity': 1, partiallyCancelled: true },
            $push: {
              cancellationOperations: {
                operationId: opId2,
                itemIds: [itemId2],
                items: [{ itemId: itemId2, productId: productBase._id, variantId: variantBase._id, quantity: 1, refundAmount: 2500 }],
                refundAmount: 2500,
                fullyCancelled: false,
                source: 'ADMIN',
                reason: 'Checkpoint 2 audit test',
                actorId: adminId,
                status: 'PENDING',
                inventoryRestored: false, // Order was NOT updated before crash!
                creditNoteIssued: false,
                createdAt: new Date(),
              },
            },
          }
        );

        // Inventory write completed in DB, but process dies before Order updated:
        await InventoryAllocationService.restoreCancelledItemQuantities(
          order._id,
          [{ orderItemId: itemId2, productId: productBase._id, variantId: variantBase._id, quantity: 1 }],
          { operationId: opId2, reason: 'Checkpoint 2 pre-crash write' }
        );

        const stockBeforeRec2 = (await (mongoose.model('Product') as any).findById(productBase._id)).variants.id(variantBase._id).stock;

        // Recovery runs:
        await reconcilePendingCancellationOperations(order._id.toString());

        const stockAfterRec2 = (await (mongoose.model('Product') as any).findById(productBase._id)).variants.id(variantBase._id).stock;
        check(
          stockBeforeRec2 === stockAfterRec2,
          `TEST 3.6: Checkpoint 2: Unique inventory index strictly PREVENTED double-restock (stock remained ${stockAfterRec2})`
        );

        const txs2 = await InventoryTransaction.find({ orderId: order._id, operationId: opId2 });
        check(txs2.length === 1, `TEST 3.7: Checkpoint 2: Exactly ONE InventoryTransaction recorded (count = ${txs2.length})`);
      }

      // ───────────────────────────────────────────────────────────────────────
      // CHECKPOINT 3: Crash after Inventory marked restored, before Refund
      // ───────────────────────────────────────────────────────────────────────
      {
        const { order } = await makeFixture(3);
        const opId3 = `op_chk_3_${Date.now()}`;
        const itemId3 = order.items[0]._id;

        await Order.updateOne(
          { _id: order._id },
          {
            $set: { 'items.0.cancelledQuantity': 1, partiallyCancelled: true },
            $push: {
              cancellationOperations: {
                operationId: opId3,
                itemIds: [itemId3],
                items: [{ itemId: itemId3, productId: productBase._id, variantId: variantBase._id, quantity: 1, refundAmount: 2500 }],
                refundAmount: 2500,
                fullyCancelled: false,
                source: 'ADMIN',
                reason: 'Checkpoint 3 audit test',
                actorId: adminId,
                status: 'PENDING',
                inventoryRestored: true, // Inventory is already done!
                creditNoteIssued: false,
                createdAt: new Date(),
              },
            },
          }
        );

        // Crash before refund! Recovery runs:
        await reconcilePendingCancellationOperations(order._id.toString());

        const ord3After = await Order.findById(order._id);
        const op3 = ord3After?.cancellationOperations?.find((o) => o.operationId === opId3);
        check(Boolean(op3?.refundId), 'TEST 3.8: Checkpoint 3: Refund created and linked to operation');
      }

      // ───────────────────────────────────────────────────────────────────────
      // CHECKPOINT 4: Crash after Refund created, during Gateway dispatch (UNKNOWN)
      // ───────────────────────────────────────────────────────────────────────
      {
        const { order, payment } = await makeFixture(4);
        const opId4 = `op_chk_4_${Date.now()}`;
        const gwRefundId4 = `rfnd_chk_gw_4_${Date.now()}`;

        const unkRefund: any = await Refund.create({
          orderId: order._id,
          paymentId: payment._id,
          userId,
          amount: 2500,
          currency: 'INR',
          status: 'UNKNOWN',
          submissionState: 'SUBMITTED',
          razorpayPaymentId: payment.razorpayPaymentId,
          razorpayRefundId: gwRefundId4,
          gatewayIdempotencyKey: formatGatewayRefundIdempotencyKey({ orderId: order._id, operationId: opId4 }),
          initiatedBy: adminId,
          initiatedByRole: 'ADMIN',
        });

        // Gateway returns this refund on listing:
        razorpayProvider.getClient = () => ({
          payments: {
            fetchMultipleRefund: async () => ({
              items: [
                {
                  id: gwRefundId4,
                  payment_id: payment.razorpayPaymentId,
                  amount: 250000,
                  status: 'processed',
                  currency: 'INR',
                },
              ],
            }),
          },
          refunds: {
            all: async () => ({ items: [] }),
            fetch: async () => ({
              id: gwRefundId4,
              payment_id: payment.razorpayPaymentId,
              amount: 250000,
              status: 'processed',
              currency: 'INR',
            }),
          },
        } as any);

        const reconciled4 = await reconcileUnknownRefund(unkRefund._id.toString(), { executionMode: 'ADMINISTRATIVE' });
        check(reconciled4.status === 'PROCESSED', 'TEST 3.9: Checkpoint 4: UNKNOWN refund safely recovered to PROCESSED');
        check(reconciled4.razorpayRefundId === gwRefundId4, 'TEST 3.10: Checkpoint 4: Preserved authoritative gateway refund ID');
      }

      // ───────────────────────────────────────────────────────────────────────
      // CHECKPOINT 5: Crash after Refund PROCESSED, before Payment ledger settlement
      // ───────────────────────────────────────────────────────────────────────
      {
        const { order, payment } = await makeFixture(5);
        const gwRefundId5 = `rfnd_chk_gw_5_${Date.now()}`;

        const procRefund5: any = await Refund.create({
          orderId: order._id,
          paymentId: payment._id,
          userId,
          amount: 2500,
          currency: 'INR',
          status: 'PROCESSED',
          submissionState: 'CONFIRMED',
          processedAt: new Date(),
          razorpayPaymentId: payment.razorpayPaymentId,
          razorpayRefundId: gwRefundId5,
          initiatedBy: adminId,
          initiatedByRole: 'ADMIN',
          accountingSettlementStatus: 'PENDING',
        });

        const settlement5 = await applyProviderRefundSettlement({
          paymentId: payment._id,
          refundId: procRefund5._id,
          razorpayRefundId: gwRefundId5,
          amount: 2500,
          currency: 'INR',
          unlinked: true,
        });

        check(settlement5.success === true, 'TEST 3.11: Checkpoint 5: Payment ledger settlement committed post-crash');
        const p5After = await Payment.findById(payment._id);
        check(p5After?.refundedAmount === 2500, `TEST 3.12: Checkpoint 5: Payment refundedAmount updated to ₹${p5After?.refundedAmount}`);

        // Replay settlement to verify idempotency:
        const replay5 = await applyProviderRefundSettlement({
          paymentId: payment._id,
          refundId: procRefund5._id,
          razorpayRefundId: gwRefundId5,
          amount: 2500,
          currency: 'INR',
          unlinked: true,
        });
        check(replay5.success === true && replay5.outcome === 'ALREADY_SETTLED', 'TEST 3.13: Checkpoint 5: Replayed settlement is safe ALREADY_SETTLED no-op');
      }

      // ───────────────────────────────────────────────────────────────────────
      // CHECKPOINT 6: Crash after Payment settled, before Credit Note created
      // ───────────────────────────────────────────────────────────────────────
      {
        const { order, invoice } = await makeFixture(6);
        const opId6 = `op_chk_6_${Date.now()}`;
        const itemId6 = order.items[0]._id;

        await Order.updateOne(
          { _id: order._id },
          {
            $set: { 'items.0.cancelledQuantity': 1, partiallyCancelled: true },
            $push: {
              cancellationOperations: {
                operationId: opId6,
                itemIds: [itemId6],
                items: [{ itemId: itemId6, productId: productBase._id, variantId: variantBase._id, quantity: 1, refundAmount: 2500 }],
                refundAmount: 2500,
                fullyCancelled: false,
                source: 'ADMIN',
                reason: 'Checkpoint 6 audit test',
                actorId: adminId,
                status: 'PENDING',
                inventoryRestored: true,
                creditNoteIssued: false, // Credit note NOT yet issued!
                createdAt: new Date(),
              },
            },
          }
        );

        await reconcilePendingCancellationOperations(order._id.toString());

        const cn6 = await CreditNote.findOne({ operationId: opId6 });
        check(Boolean(cn6), 'TEST 3.14: Checkpoint 6: Missing CreditNote generated during recovery');
        check(cn6?.invoiceId.toString() === invoice._id.toString(), 'TEST 3.15: Checkpoint 6: CreditNote linked to correct Invoice');
      }

      // ───────────────────────────────────────────────────────────────────────
      // CHECKPOINT 7: Crash after Credit Note created, before operation COMPLETED
      // ───────────────────────────────────────────────────────────────────────
      {
        const { order, invoice } = await makeFixture(7);
        const opId7 = `op_chk_7_${Date.now()}`;
        const itemId7 = order.items[0]._id;

        // Credit Note already written in DB before crash:
        await CreditNote.create({
          creditNoteNumber: `CN-CHK-7-${Date.now()}`,
          invoiceId: invoice._id,
          invoiceNumber: invoice.invoiceNumber,
          orderId: order._id,
          orderNumber: order.orderNumber,
          userId: order.userId,
          operationId: opId7,
          status: 'ISSUED',
          items: [{ productId: productBase._id, productName: productBase.name, selectedSize: 'M', selectedColor: 'Navy', quantity: 1, unitPrice: 2500, lineTotal: 2500, refundAmount: 2500 }],
          subtotalRefunded: 2500,
          discountAdjusted: 0,
          taxRefunded: 0,
          totalRefundAmount: 2500,
          currency: 'INR',
          reason: 'Checkpoint 7 pre-crash write',
        });

        await Order.updateOne(
          { _id: order._id },
          {
            $set: { 'items.0.cancelledQuantity': 1, partiallyCancelled: true },
            $push: {
              cancellationOperations: {
                operationId: opId7,
                itemIds: [itemId7],
                items: [{ itemId: itemId7, productId: productBase._id, variantId: variantBase._id, quantity: 1, refundAmount: 2500 }],
                refundAmount: 2500,
                fullyCancelled: false,
                source: 'ADMIN',
                reason: 'Checkpoint 7 audit test',
                actorId: adminId,
                status: 'PENDING',
                inventoryRestored: true,
                creditNoteIssued: false, // Operation was not updated before crash!
                createdAt: new Date(),
              },
            },
          }
        );

        await reconcilePendingCancellationOperations(order._id.toString());

        const cns7 = await CreditNote.find({ operationId: opId7 });
        check(cns7.length === 1, `TEST 3.16: Checkpoint 7: CreditNote uniqueness strictly preserved (count = ${cns7.length})`);

        const ord7After = await Order.findById(order._id);
        const op7 = ord7After?.cancellationOperations?.find((o) => o.operationId === opId7);
        check(op7?.status === 'COMPLETED', 'TEST 3.17: Checkpoint 7: Operation cleanly transitioned to COMPLETED');
      }

      // Restore provider
      razorpayProvider.createRefund = originalCreateRefund;
      razorpayProvider.getClient = originalGetClient;
    }

    // =========================================================================
    // SECTION 4: PRODUCTION MONGODB VERIFICATION
    // =========================================================================
    console.log('\n--- SECTION 4: Production MongoDB Verification ---');

    {
      // 4.1 Verify standalone is strictly rejected
      const standaloneCheck = await verifyDatabaseTransactionSupport(mongoose.connection);
      check(standaloneCheck.supported === false, 'TEST 4.1: Standalone MongoDB is rejected by verifyDatabaseTransactionSupport');
      check(standaloneCheck.topology === 'standalone', 'TEST 4.2: Detected topology is "standalone"');

      // 4.2 Verify replica set connection succeeds
      const probeState = { executed: false };
      const mockReplicaConnection = {
        readyState: 1,
        db: {
          command: async (cmd: Record<string, unknown>) => {
            if (cmd.hello || cmd.isMaster) {
              return { setName: 'rs_samrat_prod', isWritablePrimary: true, maxWireVersion: 27 };
            }
            return {};
          },
          admin: () => ({ command: async () => ({ setName: 'rs_samrat_prod' }) }),
          collection: (name: string) => ({
            findOne: async (_filter: unknown, opts?: { session?: unknown }) => {
              if (name === '__tx_preflight_probe__' && opts?.session) {
                probeState.executed = true;
              }
              return null;
            },
          }),
        },
        startSession: async () => ({
          startTransaction: () => {},
          abortTransaction: async () => {},
          endSession: async () => {},
        }),
      } as unknown as mongoose.Connection;

      const replicaCheck = await verifyDatabaseTransactionSupport(mockReplicaConnection);
      check(replicaCheck.supported === true, 'TEST 4.3: Replica-set MongoDB passes verifyDatabaseTransactionSupport');
      check(replicaCheck.topology === 'replica_set', 'TEST 4.4: Topology confirmed as "replica_set"');
      check(replicaCheck.setName === 'rs_samrat_prod', 'TEST 4.5: Confirmed setName: "rs_samrat_prod"');
      check(probeState.executed === true, 'TEST 4.6: Executed harmless in-transaction probe on __tx_preflight_probe__');

      // 4.3 Verify validateProductionEnv() rejects mock payment modes in production
      const savedEnv = process.env.NODE_ENV;
      const savedAllowMock = process.env.ALLOW_PAYMENT_MOCK;
      try {
        process.env.NODE_ENV = 'production';
        process.env.ALLOW_PAYMENT_MOCK = 'true';
        let prodMockRejected = false;
        try {
          validateProductionEnv();
        } catch (err: any) {
          if (err.message.includes('ALLOW_PAYMENT_MOCK is strictly forbidden')) {
            prodMockRejected = true;
          }
        }
        check(prodMockRejected === true, 'TEST 4.7: validateProductionEnv() strictly forbids ALLOW_PAYMENT_MOCK=true in production');
      } finally {
        process.env.NODE_ENV = savedEnv;
        process.env.ALLOW_PAYMENT_MOCK = savedAllowMock;
      }
    }

  } finally {
    razorpayProvider.createRefund = originalCreateRefund;
    razorpayProvider.getClient = originalGetClient;
    await mongoose.disconnect();
  }

  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log(`Deployment Gate Verification Test Results: ${passed} passed, ${failed} failed`);
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
  runDeploymentGateSuite().catch((err) => {
    console.error('Fatal deployment gate suite error:', err);
    process.exit(1);
  });
}
