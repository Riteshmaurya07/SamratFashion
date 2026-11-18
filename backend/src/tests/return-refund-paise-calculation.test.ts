/**
 * Fix 9 Test: Return refund exact paise calculation and resilience against partial cancellations
 *
 * Verifies that:
 * 1. Return refunds calculate proportional discount refunds using invariant initialSubtotal & initialDiscount.
 * 2. Return refunds maintain integer paise precision (not rounding to whole rupees).
 * 3. A return after a partial cancellation refunds the correct, uncorrupted paise amount.
 */

process.env.NODE_ENV = 'test';
process.env.RAZORPAY_KEY_ID = 'rzp_test_mock';
process.env.RAZORPAY_KEY_SECRET = 'mock_secret_test';
process.env.RAZORPAY_WEBHOOK_SECRET = 'mock_webhook_secret_test';

import mongoose from 'mongoose';
import { connectSafeTestDb, createTestProduct } from './testHelpers';
import { cancelOrderItemsWithRefund } from '../services/orderCancellationService';
import { acceptReturn } from '../controllers/returnController';
import { Order } from '../models/Order';
import { Payment } from '../models/Payment';
import { PaymentAttempt } from '../models/PaymentAttempt';
import { ReturnRequest } from '../models/ReturnRequest';
import { Refund } from '../models/Refund';
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
    }
  };
  return res;
}

async function run() {
  console.log('=== Running Fix 9 Test: Return Refund Integer Paise Calculation ===');
  await connectSafeTestDb();

  const userId = new mongoose.Types.ObjectId();
  const adminId = new mongoose.Types.ObjectId();
  const now = Date.now();

  const { product, variantIds } = await createTestProduct({
    name: 'Paise Test Jacket',
    basePrice: 999,
    variants: [
      { size: 'L', color: 'SAGE', stock: 10, additionalPrice: 1000 }, // 1999
      { size: 'M', color: 'BEIGE', stock: 10, additionalPrice: 0 },   // 999
    ]
  });
  const variantId1 = variantIds[0];
  const variantId2 = variantIds[1];

  // Create order with 2 items and a ₹500 coupon discount
  // Item 1: ₹1999 (66.68% of subtotal) -> gets ~₹333.39 discount -> net ₹1665.61
  // Item 2: ₹999  (33.32% of subtotal) -> gets ~₹166.61 discount -> net ₹832.39
  const order = await Order.create({
    orderNumber: `ORD-PAISE-${now}`,
    userId,
    items: [
      {
        productId: product._id,
        variantId: variantId1,
        productName: 'Jacket Item 1',
        productImage: 'https://example.com/1.jpg',
        selectedSize: 'L',
        selectedColor: 'SAGE',
        quantity: 1,
        unitPrice: 1999,
        lineTotal: 1999,
      },
      {
        productId: product._id,
        variantId: variantId2,
        productName: 'Jacket Item 2',
        productImage: 'https://example.com/2.jpg',
        selectedSize: 'M',
        selectedColor: 'BEIGE',
        quantity: 1,
        unitPrice: 999,
        lineTotal: 999,
      }
    ],
    subtotal: 2998,
    discount: 500,
    shipping: 0,
    total: 2498,
    initialSubtotal: 2998,
    initialDiscount: 500,
    initialTotal: 2498,
    currency: 'INR',
    status: 'CONFIRMED',
    paymentStatus: 'PAID',
    shippingAddress: {
      fullName: 'Paise Test User',
      phone: '9876543210',
      addressLine1: 'Test Road',
      city: 'Delhi',
      state: 'Delhi',
      postalCode: '110001',
      country: 'India',
    }
  });

  const payment = await Payment.create({
    orderId: order._id,
    userId,
    amount: 2498,
    currency: 'INR',
    status: 'CAPTURED',
    provider: 'RAZORPAY',
    razorpayPaymentId: `pay_paise_${now}`,
    refundedAmount: 0,
    pendingRefundAmount: 0,
  });

  await PaymentAttempt.create({
    orderId: order._id,
    paymentId: payment._id,
    razorpayOrderId: `order_paise_${now}`,
    razorpayPaymentId: `pay_paise_${now}`,
    amount: 2498,
    currency: 'INR',
    status: 'CAPTURED',
  });

  const origCreateRefund = razorpayProvider.createRefund;

  try {
    razorpayProvider.createRefund = async (payId, amt) => ({
      id: `rfnd_paise_${Date.now()}`,
      entity: 'refund',
      amount: amt,
      status: 'processed'
    });

    // 1. Partially cancel Item 1
    const item1 = order.items[0];
    await cancelOrderItemsWithRefund({
      orderId: order._id.toString(),
      actorId: userId.toString(),
      actorRole: 'CUSTOMER',
      reason: 'Partial cancel Item 1',
      source: 'CUSTOMER',
      items: [{ itemId: (item1._id as mongoose.Types.ObjectId).toString(), quantity: 1 }]
    });

    const orderAfterCancel = await Order.findById(order._id);
    check(orderAfterCancel?.subtotal === 999, 'T9.1: Order subtotal was mutated by partial cancel', `subtotal=${orderAfterCancel?.subtotal}`);

    // Deliver the remaining uncancelled item
    orderAfterCancel!.status = 'DELIVERED';
    await orderAfterCancel!.save();

    // 2. Customer returns Item 2
    const returnRequest = await ReturnRequest.create({
      orderId: order._id,
      userId,
      items: [{
        productId: product._id,
        variantId: variantId2,
        quantity: 1,
        reason: 'WRONG_SIZE',
      }],
      status: 'INSPECTING',
    });

    // 3. Admin accepts return
    const reqAccept: any = {
      params: { id: returnRequest._id.toString() },
      user: { id: adminId.toString(), role: 'ADMIN' },
      body: { adminNote: 'Inspection passed' }
    };
    const resAccept = mockRes();
    await acceptReturn(reqAccept, resAccept, (err: any) => { if (err) throw err; });

    check(resAccept.statusCode === 200, 'T9.2: acceptReturn succeeds with HTTP 200');

    // Expected Item 2 refund calculation:
    // lineTotal = 999, lineTotalPaise = 99900
    // initialSubtotalPaise = 299800, initialDiscountPaise = 50000
    // lineDiscountPaise = Math.round(99900 * 50000 / 299800) = 16661 paise
    // netLinePayablePaise = 99900 - 16661 = 83239 paise = ₹832.39
    const returnRefund = await Refund.findOne({ returnId: returnRequest._id });
    check(Boolean(returnRefund), 'T9.3: Return refund was recorded');
    check(
      returnRefund?.amount === 832.39,
      'T9.4: Return refund preserves exact paise (₹832.39) and does NOT round to nearest rupee or use mutated subtotal',
      `actual amount=${returnRefund?.amount}, expected=832.39`
    );

  } finally {
    razorpayProvider.createRefund = origCreateRefund;
  }

  console.log(`\nFix 9 Test Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Fatal in test:', err);
  process.exit(1);
});
