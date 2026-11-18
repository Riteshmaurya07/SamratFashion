/**
 * Fix 11 Test: Mock mode dual guard
 *
 * Verifies that:
 * 1. Mock payments are strictly forbidden in production and staging environments.
 * 2. Mock payments are strictly forbidden if a live production Razorpay key (rzp_live_...) is configured,
 *    even in development mode with ALLOW_PAYMENT_MOCK='true'.
 * 3. Mock payments are only permitted when non-production, test/dummy key configured, and ALLOW_PAYMENT_MOCK='true'.
 */

import { isMockPaymentPermitted } from '../services/payment/RazorpayProvider';

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

function run() {
  console.log('=== Running Fix 11 Test: Mock Mode Dual Guard Verification ===');

  const origNodeEnv = process.env.NODE_ENV;
  const origKeyId = process.env.RAZORPAY_KEY_ID;
  const origMock = process.env.ALLOW_PAYMENT_MOCK;

  try {
    // 1. In production, mock mode is ALWAYS refused
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_PAYMENT_MOCK = 'true';
    process.env.RAZORPAY_KEY_ID = 'dummy_key';
    check(isMockPaymentPermitted() === false, 'T11.1: NODE_ENV=production strictly forbids mock mode');

    // 2. In staging, mock mode is ALWAYS refused
    process.env.NODE_ENV = 'staging';
    process.env.ALLOW_PAYMENT_MOCK = 'true';
    process.env.RAZORPAY_KEY_ID = 'dummy_key';
    check(isMockPaymentPermitted() === false, 'T11.2: NODE_ENV=staging strictly forbids mock mode');

    // 3. In development, if a live Razorpay key is present (rzp_live_...), mock mode is REFUSED
    process.env.NODE_ENV = 'development';
    process.env.ALLOW_PAYMENT_MOCK = 'true';
    process.env.RAZORPAY_KEY_ID = 'rzp_live_ABC1234567890';
    check(isMockPaymentPermitted() === false, 'T11.3: rzp_live_ production key in development forbids mock mode (dual guard)');

    // 4. In development, if ALLOW_PAYMENT_MOCK is false, mock mode is REFUSED
    process.env.NODE_ENV = 'development';
    process.env.ALLOW_PAYMENT_MOCK = 'false';
    process.env.RAZORPAY_KEY_ID = 'rzp_test_mock';
    check(isMockPaymentPermitted() === false, 'T11.4: ALLOW_PAYMENT_MOCK=false forbids mock mode');

    // 5. In development, with dummy/test key AND ALLOW_PAYMENT_MOCK=true, mock mode is permitted
    process.env.NODE_ENV = 'development';
    process.env.ALLOW_PAYMENT_MOCK = 'true';
    process.env.RAZORPAY_KEY_ID = 'rzp_test_mock';
    check(isMockPaymentPermitted() === true, 'T11.5: Non-prod + test key + ALLOW_PAYMENT_MOCK=true allows mock mode');

    process.env.RAZORPAY_KEY_ID = 'dummy_key';
    check(isMockPaymentPermitted() === true, 'T11.6: Non-prod + dummy key + ALLOW_PAYMENT_MOCK=true allows mock mode');

  } finally {
    process.env.NODE_ENV = origNodeEnv;
    process.env.RAZORPAY_KEY_ID = origKeyId;
    process.env.ALLOW_PAYMENT_MOCK = origMock;
  }

  console.log(`\nFix 11 Test Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
