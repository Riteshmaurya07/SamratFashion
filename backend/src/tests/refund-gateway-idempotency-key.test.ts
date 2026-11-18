/**
 * Fix 5 Test: Razorpay Refund Gateway Idempotency Key Uniqueness
 *
 * Verifies that:
 * 1. Two distinct plain-path refunds of the same order produce different gateway idempotency keys.
 * 2. Gateway idempotency keys include the attempt number suffix (rfnd_ord_<orderId>_att<attemptNumber>).
 * 3. Operation-scoped (rfnd_op_<hash>), return-scoped (rfnd_ret_<returnId>), and custom keys are preserved.
 */

import mongoose from 'mongoose';
import { formatGatewayRefundIdempotencyKey, formatRefundIdempotencyKey } from '../services/payment/refundService';

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
  console.log('=== Running Fix 5 Test: Refund Gateway Idempotency Key Uniqueness ===');

  const orderId = new mongoose.Types.ObjectId();

  // 1. Two plain-path refunds on the same order with different attempt numbers
  const key1 = formatGatewayRefundIdempotencyKey({ orderId, attemptNumber: 1 });
  const key2 = formatGatewayRefundIdempotencyKey({ orderId, attemptNumber: 2 });

  check(Boolean(key1 && key2), 'T5.1: Formatted gateway idempotency keys exist');
  check(key1 !== key2, 'T5.2: Two distinct plain-path refunds on the same order produce DIFFERENT gateway idempotency keys', `key1=${key1}, key2=${key2}`);
  check(key1 === `rfnd_ord_${orderId}_att1`, 'T5.3: First plain-path refund has att1 suffix', `key1=${key1}`);
  check(key2 === `rfnd_ord_${orderId}_att2`, 'T5.4: Second plain-path refund has att2 suffix', `key2=${key2}`);

  // Default fallback when attemptNumber is omitted
  const keyDefault = formatGatewayRefundIdempotencyKey({ orderId });
  check(keyDefault === `rfnd_ord_${orderId}_att1`, 'T5.5: Plain-path refund without explicit attemptNumber defaults to att1', `key=${keyDefault}`);

  // 2. Operation-scoped keys remain unchanged (rfnd_op_<hash>)
  const opKey1 = formatGatewayRefundIdempotencyKey({ orderId, operationId: 'item_cancel_1' });
  const opKey2 = formatGatewayRefundIdempotencyKey({ orderId, operationId: 'item_cancel_2' });
  check(opKey1.startsWith('rfnd_op_'), 'T5.6: Operation-scoped key retains rfnd_op_ prefix', `opKey1=${opKey1}`);
  check(opKey1 !== opKey2, 'T5.7: Different operation IDs produce distinct op-scoped keys');

  // 3. Return-scoped keys remain unchanged (rfnd_ret_<returnId>)
  const retId = 'ret_req_98765';
  const retKey = formatGatewayRefundIdempotencyKey({ orderId, returnId: retId });
  check(retKey === `rfnd_ret_${retId}`, 'T5.8: Return-scoped key retains rfnd_ret_<returnId> format', `retKey=${retKey}`);

  // 4. Custom idempotency keys remain supported
  const custom = 'custom_ref_idemp_key_42';
  const customKey = formatGatewayRefundIdempotencyKey({ orderId, customIdempotencyKey: custom });
  check(customKey === custom, 'T5.9: Custom idempotency key is preserved exactly', `customKey=${customKey}`);

  // 5. DB-side formatRefundIdempotencyKey consistency check
  const dbKey1 = formatRefundIdempotencyKey({ orderId, attemptNumber: 1 });
  const dbKey2 = formatRefundIdempotencyKey({ orderId, attemptNumber: 2 });
  check(dbKey1 !== dbKey2, 'T5.10: DB-side formatRefundIdempotencyKey also distinguishes attempts');
  check(dbKey1.endsWith('_att1'), 'T5.11: DB key ends with _att1');
  check(dbKey2.endsWith('_att2'), 'T5.12: DB key ends with _att2');

  console.log(`\nFix 5 Test Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
