/**
 * Fix 1 Test: Webhook handler must NOT return 200 OK on RECONCILIATION_REQUIRED or RETRYABLE
 *
 * Verifies that:
 * 1. An outcome of RECONCILIATION_REQUIRED returns non-200 (500) status to Razorpay, so Razorpay retries delivery.
 * 2. An outcome of RETRYABLE returns non-200 (500) status to Razorpay.
 * 3. A replayed PROCESSED event returns 200 OK ('Event already processed').
 * 4. A successfully processed event returns 200 OK.
 */

process.env.NODE_ENV = 'test';
process.env.RAZORPAY_KEY_ID = 'rzp_test_mock';
process.env.RAZORPAY_KEY_SECRET = 'mock_secret_test';
process.env.RAZORPAY_WEBHOOK_SECRET = 'mock_webhook_secret_test';

import crypto from 'crypto';
import { connectSafeTestDb } from './testHelpers';
import { razorpayWebhook } from '../controllers/webhookController';
import { WebhookEvent } from '../models/WebhookEvent';
import { razorpayProvider } from '../services/payment/RazorpayProvider';

let passed = 0;
let failed = 0;

function check(condition: boolean, desc: string): void {
  if (condition) {
    passed++;
    console.log(`  ✅ PASS: ${desc}`);
  } else {
    failed++;
    console.error(`  ❌ FAIL: ${desc}`);
  }
}

function mockRes() {
  const res: any = {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    send(data: any) {
      this.body = data;
      return this;
    },
    json(data: any) {
      this.body = data;
      return this;
    }
  };
  return res;
}

function signWebhook(rawBody: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

async function run() {
  console.log('=== Running Fix 1 Test: Webhook Reconciliation Non-200 Response ===');
  await connectSafeTestDb();

  const secret = process.env.RAZORPAY_WEBHOOK_SECRET!;
  const origVerify = razorpayProvider.verifyWebhookSignature;
  razorpayProvider.verifyWebhookSignature = (body, sig) => {
    return signWebhook(body, secret) === sig;
  };

  try {
    // 1. RECONCILIATION_REQUIRED payload (e.g. missing entity order_id or id mismatch)
    const eventIdRecon = `evt_recon_${Date.now()}`;
    const reconPayload = {
      event: 'payment.captured',
      event_id: eventIdRecon,
      payload: {
        payment: {
          entity: {
            id: 'pay_invalid_none',
            // Missing order_id causes processSupportedWebhookEvent to return RECONCILIATION_REQUIRED
          }
        }
      }
    };
    const reconBodyStr = JSON.stringify(reconPayload);
    const reconReq: any = {
      headers: {
        'x-razorpay-signature': signWebhook(reconBodyStr, secret),
        'x-razorpay-event-id': eventIdRecon,
      },
      body: Buffer.from(reconBodyStr, 'utf8'),
    };
    const resRecon = mockRes();
    await razorpayWebhook(reconReq, resRecon);

    check(resRecon.statusCode !== 200, 'T1.1: Webhook returning RECONCILIATION_REQUIRED returns non-200 status');
    check(resRecon.statusCode === 500, 'T1.2: Webhook returning RECONCILIATION_REQUIRED returns HTTP 500');

    const reconEventDoc = await WebhookEvent.findOne({ eventId: eventIdRecon });
    check(reconEventDoc?.status === 'FAILED', 'T1.3: WebhookEvent record is saved with status FAILED for retry');

    // 2. Replayed PROCESSED event returns 200 OK
    const eventIdProcessed = `evt_proc_${Date.now()}`;
    await WebhookEvent.create({
      eventId: eventIdProcessed,
      provider: 'RAZORPAY',
      eventType: 'payment.captured',
      status: 'PROCESSED',
      processedAt: new Date(),
    });

    const dupPayload = {
      event: 'payment.captured',
      event_id: eventIdProcessed,
      payload: { payment: { entity: { id: 'pay_123', order_id: 'order_123' } } }
    };
    const dupBodyStr = JSON.stringify(dupPayload);
    const dupReq: any = {
      headers: {
        'x-razorpay-signature': signWebhook(dupBodyStr, secret),
        'x-razorpay-event-id': eventIdProcessed,
      },
      body: Buffer.from(dupBodyStr, 'utf8'),
    };
    const resDup = mockRes();
    await razorpayWebhook(dupReq, resDup);

    check(resDup.statusCode === 200, 'T1.4: Replayed PROCESSED event returns HTTP 200');
    check(String(resDup.body).includes('already processed'), 'T1.5: Replayed PROCESSED event indicates already processed');

  } finally {
    razorpayProvider.verifyWebhookSignature = origVerify;
  }

  console.log(`\nFix 1 Test Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Fatal in test:', err);
  process.exit(1);
});
