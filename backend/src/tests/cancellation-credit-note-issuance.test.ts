/**
 * Fix 6 Test: Credit note issuance gated strictly on PROCESSED refund settlement
 *
 * Verifies that:
 * 1. When a cancellation refund fails or is not processed, NO issued credit note is generated.
 * 2. When a cancellation refund settles successfully as PROCESSED, the credit note is issued.
 * 3. Idempotent deduplication prevents creating duplicate credit notes on retries.
 */

process.env.NODE_ENV = 'test';
process.env.RAZORPAY_KEY_ID = 'rzp_test_mock';
process.env.RAZORPAY_KEY_SECRET = 'mock_secret_test';
process.env.RAZORPAY_WEBHOOK_SECRET = 'mock_webhook_secret_test';

import mongoose from 'mongoose';
import { connectSafeTestDb } from './testHelpers';
import { cancelOrderWithRefund, cancelOrderItemsWithRefund } from '../services/orderCancellationService';
import { Order } from '../models/Order';
import { Payment } from '../models/Payment';
import { PaymentAttempt } from '../models/PaymentAttempt';
import { Invoice, InvoiceStatus } from '../models/Invoice';
import { CreditNote } from '../models/CreditNote';
import { razorpayProvider } from '../services/payment/RazorpayProvider';

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

async function createPaidOrderWithInvoice(suffix: string) {
  const userId = new mongoose.Types.ObjectId();
  const productId = new mongoose.Types.ObjectId();
  const variantId = new mongoose.Types.ObjectId();

  const order = await Order.create({
    orderNumber: `ORD-CN-${suffix}`,
    userId,
    items: [{
      productId,
      variantId,
      productName: 'Classic Nehru Jacket',
      productImage: 'https://example.com/jacket.jpg',
      selectedSize: 'XL',
      selectedColor: 'Sage Green',
      quantity: 2,
      unitPrice: 2000,
      lineTotal: 4000
    }],
    subtotal: 4000,
    total: 4000,
    currency: 'INR',
    status: 'CONFIRMED',
    paymentStatus: 'PAID',
    shippingAddress: {
      fullName: 'CN Customer',
      phone: '9876543210',
      addressLine1: 'Road 1',
      city: 'Delhi',
      state: 'Delhi',
      postalCode: '110001',
      country: 'India',
    }
  });

  const payment = await Payment.create({
    orderId: order._id,
    userId,
    amount: 4000,
    currency: 'INR',
    status: 'CAPTURED',
    provider: 'RAZORPAY',
    razorpayPaymentId: `pay_cn_${suffix}`,
    refundedAmount: 0,
    pendingRefundAmount: 0,
  });

  await PaymentAttempt.create({
    orderId: order._id,
    paymentId: payment._id,
    razorpayOrderId: `order_cn_${suffix}`,
    razorpayPaymentId: `pay_cn_${suffix}`,
    amount: 4000,
    currency: 'INR',
    status: 'CAPTURED',
  });

  const invoice = await Invoice.create({
    invoiceNumber: `INV-CN-${suffix}`,
    orderId: order._id,
    userId,
    orderNumber: order.orderNumber,
    status: InvoiceStatus.ISSUED,
    issuedAt: new Date(),
    customerSnapshot: { name: 'CN Customer', email: 'cn@example.com' },
    billingAddressSnapshot: { fullName: 'CN Customer', phone: '9876543210', addressLine1: 'Road 1', city: 'Delhi', state: 'Delhi', postalCode: '110001', country: 'India' },
    shippingAddressSnapshot: { fullName: 'CN Customer', phone: '9876543210', addressLine1: 'Road 1', city: 'Delhi', state: 'Delhi', postalCode: '110001', country: 'India' },
    itemsSnapshot: [{
      productId,
      productName: 'Classic Nehru Jacket',
      variantId,
      sku: 'SKU-NEHRU-XL',
      selectedColor: 'Sage Green',
      selectedSize: 'XL',
      quantity: 2,
      unitPrice: 2000,
      lineTotal: 4000
    }],
    subtotal: 4000,
    discount: 0,
    shipping: 0,
    tax: 0,
    total: 4000,
    currency: 'INR',
    paymentSnapshot: { provider: 'RAZORPAY', status: 'PAID', amount: 4000, currency: 'INR' },
  });

  return { order, payment, invoice, userId, productId, variantId };
}

async function run() {
  console.log('=== Running Fix 6 Test: Credit Note Issuance Guarded by Settlement ===');
  await connectSafeTestDb();

  const origCreateRefund = razorpayProvider.createRefund;

  try {
    // 1. Full cancel with FAILED refund -> NO credit note issued
    const suffix1 = `fail_${Date.now()}`;
    const fixture1 = await createPaidOrderWithInvoice(suffix1);

    razorpayProvider.createRefund = async () => {
      const err: any = new Error('Gateway rejected refund: insufficient balance');
      err.statusCode = 400;
      throw err;
    };

    const cancelResultFail = await cancelOrderWithRefund({
      orderId: fixture1.order._id.toString(),
      actorId: fixture1.userId.toString(),
      actorRole: 'CUSTOMER',
      reason: 'Failed refund cancel test',
      source: 'CUSTOMER'
    });

    check(Boolean(cancelResultFail.refundError), 'T6.1: Full cancel records refundError when gateway fails');

    const cnFail = await CreditNote.findOne({ orderId: fixture1.order._id, status: 'ISSUED' });
    check(!cnFail, 'T6.2: NO issued credit note is created when refund fails');

    // 2. Full cancel with PROCESSED refund -> Credit note IS issued
    const suffix2 = `settled_${Date.now()}`;
    const fixture2 = await createPaidOrderWithInvoice(suffix2);

    razorpayProvider.createRefund = async (payId, amt) => ({
      id: `rfnd_settled_${Date.now()}`,
      entity: 'refund',
      amount: amt,
      status: 'processed'
    });

    const cancelResultSuccess = await cancelOrderWithRefund({
      orderId: fixture2.order._id.toString(),
      actorId: fixture2.userId.toString(),
      actorRole: 'CUSTOMER',
      reason: 'Settled refund cancel test',
      source: 'CUSTOMER'
    });

    check(cancelResultSuccess.refund?.status === 'PROCESSED', 'T6.3: Refund is PROCESSED');

    const cnSuccess = await CreditNote.findOne({ orderId: fixture2.order._id, status: 'ISSUED' });
    check(Boolean(cnSuccess), 'T6.4: Credit note is issued when refund settles as PROCESSED');
    check(cnSuccess?.totalRefundAmount === 4000, 'T6.5: Credit note reflects correct settled refund total');

    // 3. Dedup check: subsequent retry does not produce duplicate credit note
    const cnCountBefore = await CreditNote.countDocuments({ orderId: fixture2.order._id });
    await cancelOrderWithRefund({
      orderId: fixture2.order._id.toString(),
      actorId: fixture2.userId.toString(),
      actorRole: 'CUSTOMER',
      reason: 'Replay cancel call',
      source: 'CUSTOMER'
    }).catch(() => {});

    const cnCountAfter = await CreditNote.countDocuments({ orderId: fixture2.order._id });
    check(cnCountAfter === cnCountBefore, 'T6.6: Subsequent execution does not create duplicate credit note', `before=${cnCountBefore}, after=${cnCountAfter}`);

    // 4. Partial cancel with FAILED refund -> NO credit note issued
    const suffix3 = `partfail_${Date.now()}`;
    const fixture3 = await createPaidOrderWithInvoice(suffix3);

    razorpayProvider.createRefund = async () => {
      const err: any = new Error('Gateway network timeout');
      err.statusCode = 502;
      throw err;
    };

    const orderItem = fixture3.order.items[0];
    await cancelOrderItemsWithRefund({
      orderId: fixture3.order._id.toString(),
      actorId: fixture3.userId.toString(),
      actorRole: 'CUSTOMER',
      reason: 'Partial cancel failed refund test',
      source: 'CUSTOMER',
      items: [{ itemId: (orderItem._id as mongoose.Types.ObjectId).toString(), quantity: 1 }]
    });

    const cnPartFail = await CreditNote.findOne({ orderId: fixture3.order._id, status: 'ISSUED' });
    check(!cnPartFail, 'T6.7: Partial cancel does not issue credit note when refund fails');

  } finally {
    razorpayProvider.createRefund = origCreateRefund;
  }

  console.log(`\nFix 6 Test Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Fatal in test:', err);
  process.exit(1);
});
