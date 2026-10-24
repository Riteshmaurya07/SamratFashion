import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Invoice, InvoiceStatus } from '../models/Invoice';
import { InventoryTransaction } from '../models/InventoryTransaction';
import { AuditLog } from '../models/AuditLog';
import { NotificationLog } from '../models/NotificationLog';
import { PaymentAttempt } from '../models/PaymentAttempt';
import { WebhookEvent } from '../models/WebhookEvent';
import {
  getAdminInvoices,
  exportAdminInvoicesCsv,
  getAdminInventoryLedger,
  getAdminAuditLogs,
  getAdminNotifications,
  getAdminPaymentAttempts,
  getAdminWebhooks
} from '../controllers/adminOperationsController';

dotenv.config({ path: '.env' });

function mockReq(query: Record<string, unknown> = {}): any {
  return { query, user: { role: 'ADMIN' } };
}

function mockRes(): any {
  const res: any = {
    statusCode: 200,
    headers: {},
    data: null,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: any) {
      this.data = data;
      return this;
    },
    send(body: any) {
      this.body = body;
      return this;
    },
    setHeader(key: string, val: string) {
      this.headers[key] = val;
      return this;
    }
  };
  return res;
}

const mockNext = (err?: any) => {
  if (err) throw err;
};

async function runTests() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  Admin Operations Endpoints Regression Test      ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  let testUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/samrat_fashion';
  if (testUri.includes('?')) {
    testUri = testUri.replace('/?', '/samrat_fashion_test_isolated?');
  } else {
    testUri = testUri.replace(/\/$/, '') + '/samrat_fashion_test_isolated';
  }

  await mongoose.connect(testUri);
  console.log('✅ Connected to MongoDB isolated DB\n');

  let passed = 0;
  let failed = 0;

  const check = (condition: boolean, msg: string) => {
    if (condition) {
      console.log(`  ✅ PASS: ${msg}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${msg}`);
      failed++;
    }
  };

  try {
    const testAdminId = new mongoose.Types.ObjectId();
    const testOrderId = new mongoose.Types.ObjectId();
    const testProductId = new mongoose.Types.ObjectId();
    const testVariantId = new mongoose.Types.ObjectId();

    // 1. Invoices
    const invoiceDoc = await Invoice.create({
      invoiceNumber: `TEST-INV-${Date.now()}`,
      orderId: testOrderId,
      userId: testAdminId,
      orderNumber: 'TEST-ORD-01',
      status: InvoiceStatus.ISSUED,
      issuedAt: new Date(),
      customerSnapshot: { name: 'Test Customer', email: 'test@example.com' },
      billingAddressSnapshot: { fullName: 'Test', phone: '9999999999', addressLine1: 'Line 1', city: 'Delhi', state: 'Delhi', postalCode: '110001', country: 'India' },
      shippingAddressSnapshot: { fullName: 'Test', phone: '9999999999', addressLine1: 'Line 1', city: 'Delhi', state: 'Delhi', postalCode: '110001', country: 'India' },
      itemsSnapshot: [{
        productId: testProductId,
        productName: '=DANGEROUS_FORMULA()',
        variantId: testVariantId,
        sku: 'TEST-SKU',
        selectedColor: 'Black',
        selectedSize: 'M',
        quantity: 2,
        unitPrice: 500,
        lineTotal: 1000
      }],
      subtotal: 1000,
      discount: 0,
      shipping: 50,
      tax: 180,
      total: 1230,
      currency: 'INR',
      paymentSnapshot: { provider: 'RAZORPAY', status: 'PAID', amount: 1230, currency: 'INR' }
    });

    const resInv = mockRes();
    await getAdminInvoices(mockReq({ page: '1', limit: '10' }), resInv, mockNext);
    check(resInv.data?.success === true, 'Invoices returns success');
    check(Array.isArray(resInv.data?.data?.items), 'Invoices returns items array');
    check(resInv.data?.data?.pagination?.page === 1, 'Invoices pagination page is 1');

    // CSV Export
    const resCsv = mockRes();
    await exportAdminInvoicesCsv(mockReq({}), resCsv, mockNext);
    check(resCsv.headers['Content-Type']?.includes('text/csv'), 'CSV Export Content-Type is text/csv');
    check(typeof resCsv.body === 'string' && resCsv.body.includes('Invoice Number'), 'CSV body has headers');
    check(typeof resCsv.body === 'string' && !resCsv.body.includes('"=DANGEROUS'), 'CSV sanitizes formula injection');

    // 2. Inventory Ledger
    await InventoryTransaction.create({
      orderId: testOrderId,
      productId: testProductId,
      variantId: testVariantId,
      quantity: 5,
      type: 'RESTOCK',
      reason: 'Automated Test Inbound'
    });

    const resLedger = mockRes();
    await getAdminInventoryLedger(mockReq({ type: 'RESTOCK' }), resLedger, mockNext);
    check(resLedger.data?.success === true, 'Inventory Ledger returns success');
    check(resLedger.data?.data?.items?.some((i: any) => i.type === 'RESTOCK'), 'Inventory Ledger filters by type');

    // 3. Audit Logs
    await AuditLog.create({
      actorId: testAdminId,
      actorRole: 'ADMIN',
      action: 'TEST_PRICE_MUTATION',
      entityType: 'Product',
      entityId: testProductId,
      metadata: { newPrice: 1299 }
    });

    const resAudit = mockRes();
    await getAdminAuditLogs(mockReq({ action: 'TEST_PRICE_MUTATION' }), resAudit, mockNext);
    check(resAudit.data?.success === true, 'Audit Logs returns success');
    check(resAudit.data?.data?.items?.some((a: any) => a.action === 'TEST_PRICE_MUTATION'), 'Audit Logs filters by action');

    // 4. Notification Logs
    await NotificationLog.create({
      eventType: 'ORDER_CONFIRMED',
      entityType: 'Order',
      entityId: testOrderId,
      recipientEmail: 'confidential_user@gmail.com',
      channel: 'EMAIL',
      status: 'SENT',
      provider: 'brevo',
      idempotencyKey: `notif_${Date.now()}`
    });

    const resNotif = mockRes();
    await getAdminNotifications(mockReq({ status: 'SENT' }), resNotif, mockNext);
    check(resNotif.data?.success === true, 'Notification Logs returns success');
    const maskedEmail = resNotif.data?.data?.items?.find((n: any) => n.eventType === 'ORDER_CONFIRMED')?.recipientEmail;
    check(maskedEmail?.includes('***'), 'Notification Logs masks recipient email');

    // 5. Payment Attempts
    await PaymentAttempt.create({
      paymentId: new mongoose.Types.ObjectId(),
      orderId: testOrderId,
      razorpayOrderId: `rzp_test_${Date.now()}`,
      amount: 1230,
      currency: 'INR',
      status: 'FAILED',
      failureCode: 'BAD_REQUEST_ERROR',
      failureReason: 'Payment abandoned by customer'
    });

    const resPay = mockRes();
    await getAdminPaymentAttempts(mockReq({ status: 'FAILED' }), resPay, mockNext);
    check(resPay.data?.success === true, 'Payment Attempts returns success');
    check(resPay.data?.data?.items?.some((p: any) => p.status === 'FAILED'), 'Payment Attempts filters by status');

    // 6. Webhook Events
    await WebhookEvent.create({
      eventId: `evt_${Date.now()}`,
      provider: 'RAZORPAY',
      eventType: 'payment.captured',
      status: 'PROCESSED'
    });

    const resWhk = mockRes();
    await getAdminWebhooks(mockReq({ provider: 'RAZORPAY' }), resWhk, mockNext);
    check(resWhk.data?.success === true, 'Webhook Events returns success');
    check(resWhk.data?.data?.items?.some((w: any) => w.provider === 'RAZORPAY'), 'Webhook Events filters by provider');

    // Cleanup test records
    await Invoice.deleteOne({ _id: invoiceDoc._id });
    await InventoryTransaction.deleteMany({ orderId: testOrderId });
    await AuditLog.deleteMany({ actorId: testAdminId });
    await NotificationLog.deleteMany({ entityId: testOrderId });
    await PaymentAttempt.deleteMany({ orderId: testOrderId });
    await WebhookEvent.deleteMany({ eventType: 'payment.captured' });

  } catch (err) {
    console.error('Test error:', err);
    failed++;
  } finally {
    await mongoose.disconnect();
  }

  console.log('\n══════════════════════════════════════════════════');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════\n');

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
