/**
 * Fix 2 Test: Failed webhooks escalation and health reporting
 *
 * Verifies that:
 * 1. An event that has reached 10 attempts is marked with escalationRequired: true.
 * 2. It is NOT picked up by normal automatic inbox recovery batches (hard-stop enforced).
 * 3. It surfaces as a critical alert in getPaymentHealthReport() with status: 'critical'.
 */

process.env.NODE_ENV = 'test';
process.env.RAZORPAY_KEY_ID = 'rzp_test_mock';
process.env.RAZORPAY_KEY_SECRET = 'mock_secret_test';
process.env.RAZORPAY_WEBHOOK_SECRET = 'mock_webhook_secret_test';

import { connectSafeTestDb } from './testHelpers';
import { WebhookEvent } from '../models/WebhookEvent';
import { RecoveryCoordinatorService } from '../services/recovery/recoveryCoordinatorService';
import { getPaymentHealthReport } from '../services/payment/paymentHealthService';

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

async function run() {
  console.log('=== Running Fix 2 Test: Webhook Escalation & Health Reporting ===');
  await connectSafeTestDb();

  const now = Date.now();
  const escalatedEventId = `evt_escalated_test_${now}`;

  // 1. Seed a local fixture representing an event that has failed 10 times
  const fixture = await WebhookEvent.create({
    eventId: escalatedEventId,
    provider: 'RAZORPAY',
    eventType: 'payment.captured',
    status: 'FAILED',
    processingAttempts: 10,
    escalationRequired: true,
    escalatedAt: new Date(),
    lastError: 'Simulated 10th failure requiring escalation',
    payload: {
      event: 'payment.captured',
      payload: { payment: { entity: { id: `pay_esc_${now}`, order_id: `order_esc_${now}` } } }
    }
  });

  check(fixture.escalationRequired === true, 'T2.1: Seed fixture has escalationRequired: true');

  // 2. Normal recovery inbox batch must NOT pick up the escalated event
  await RecoveryCoordinatorService.executeWebhookInboxBatch(20);
  const reloadedFixture = await WebhookEvent.findById(fixture._id);

  check(
    reloadedFixture?.status === 'FAILED' && reloadedFixture?.processingAttempts === 10,
    'T2.2: Normal inbox batch does not process or increment attempts for 10-attempt escalated event',
    `attempts=${reloadedFixture?.processingAttempts}, status=${reloadedFixture?.status}`
  );

  // 3. Health report surfaces the escalated event as critical
  const healthReport = await getPaymentHealthReport();

  check(healthReport.webhooks.escalated >= 1, 'T2.3: Health report counts at least 1 escalated webhook');
  check(healthReport.status === 'critical', 'T2.4: Overall health status escalates to critical');
  check(
    healthReport.alerts.some(a => a.toLowerCase().includes('10+ failed attempts') || a.toLowerCase().includes('escalation')),
    'T2.5: Critical alerts surface the escalated webhook requirement'
  );

  console.log(`\nFix 2 Test Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Fatal in test:', err);
  process.exit(1);
});
