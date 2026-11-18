import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Invoice, InvoiceStatus } from '../models/Invoice';
import { InventoryTransaction } from '../models/InventoryTransaction';
import { AuditLog } from '../models/AuditLog';
import { NotificationLog } from '../models/NotificationLog';
import { Order } from '../models/Order';
import { Payment } from '../models/Payment';
import { PaymentAttempt } from '../models/PaymentAttempt';
import { WebhookEvent } from '../models/WebhookEvent';
import {
  getAdminInvoices,
  exportAdminInvoicesCsv,
  getAdminInventoryLedger,
  getAdminAuditLogs,
  getAdminNotifications,
  getAdminPaymentAttempts,
  getAdminPaymentReconciliationQueue,
  getAdminWebhooks
} from '../controllers/adminOperationsController';

dotenv.config({ path: '.env' });

import { connectSafeTestDb } from './testHelpers';

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

  await connectSafeTestDb();
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

    // 7. Read-only reconciliation queue
    const makeQueueOrder = (orderNumber: string, paymentStatus: 'PENDING' | 'PAID' = 'PENDING') => Order.create({
      orderNumber,
      userId: testAdminId,
      items: [],
      shippingAddress: {
        fullName: 'Queue Test',
        phone: '9999999999',
        addressLine1: 'Test address',
        city: 'Delhi',
        state: 'Delhi',
        postalCode: '110001',
        country: 'India',
        addressType: 'HOME'
      },
      subtotal: 1230,
      discount: 0,
      shipping: 0,
      tax: 0,
      total: 1230,
      currency: 'INR',
      status: 'PENDING',
      paymentStatus
    });

    const queueCapturedOrder = await makeQueueOrder(`QUEUE-CAPTURED-${Date.now()}`);
    const queueFlaggedOrder = await makeQueueOrder(`QUEUE-FLAGGED-${Date.now()}`);
    const queuePendingOrder = await makeQueueOrder(`QUEUE-PENDING-${Date.now()}`);
    const queueCapturedPayment = await Payment.create({
      orderId: queueCapturedOrder._id,
      userId: testAdminId,
      amount: 1230,
      currency: 'INR',
      status: 'CAPTURED',
      provider: 'RAZORPAY',
      razorpayPaymentId: `pay_queue_${Date.now()}`
    });
    const queueFlaggedPayment = await Payment.create({
      orderId: queueFlaggedOrder._id,
      userId: testAdminId,
      amount: 1230,
      currency: 'INR',
      status: 'FAILED',
      provider: 'RAZORPAY',
      reconciliationRequired: true,
      reconciliationReason: 'Provider settlement requires review'
    });
    const queuePendingPayment = await Payment.create({
      orderId: queuePendingOrder._id,
      userId: testAdminId,
      amount: 1230,
      currency: 'INR',
      status: 'PENDING',
      provider: 'RAZORPAY'
    });
    const staleAttemptTime = new Date(Date.now() - 30 * 60 * 1000);
    const queueAttempt = await PaymentAttempt.create({
      paymentId: queueCapturedPayment._id,
      orderId: queueCapturedOrder._id,
      razorpayOrderId: `order_queue_${Date.now()}`,
      razorpayPaymentId: queueCapturedPayment.razorpayPaymentId,
      amount: 1230,
      currency: 'INR',
      status: 'PROCESSING'
    });
    await PaymentAttempt.collection.updateOne(
      { _id: queueAttempt._id },
      { $set: { createdAt: staleAttemptTime, updatedAt: staleAttemptTime } }
    );
    const queueCapturedAttemptWithoutPayment = await PaymentAttempt.create({
      paymentId: new mongoose.Types.ObjectId(),
      orderId: queueCapturedOrder._id,
      razorpayOrderId: `order_queue_orphan_${Date.now()}`,
      razorpayPaymentId: `pay_queue_orphan_${Date.now()}`,
      amount: 1230,
      currency: 'INR',
      status: 'CAPTURED'
    });
    const queueCapturedAttemptWithMismatch = await PaymentAttempt.create({
      paymentId: queuePendingPayment._id,
      orderId: queueCapturedOrder._id,
      razorpayOrderId: `order_queue_mismatch_${Date.now()}`,
      razorpayPaymentId: `pay_queue_mismatch_${Date.now()}`,
      amount: 1230,
      currency: 'INR',
      status: 'CAPTURED'
    });
    const queueCapturedAttemptWithStatusMismatch = await PaymentAttempt.create({
      paymentId: queuePendingPayment._id,
      orderId: queuePendingOrder._id,
      razorpayOrderId: `order_queue_status_${Date.now()}`,
      razorpayPaymentId: `pay_queue_status_${Date.now()}`,
      amount: 1230,
      currency: 'INR',
      status: 'CAPTURED'
    });
    const queueWebhookEventId = `evt_queue_${Date.now()}`;
    await WebhookEvent.create({
      eventId: queueWebhookEventId,
      provider: 'RAZORPAY',
      eventType: 'payment.captured',
      status: 'FAILED',
      processingAttempts: 2,
      payload: {
        payload: {
          payment: {
            entity: {
              id: queueCapturedPayment.razorpayPaymentId,
              order_id: queueAttempt.razorpayOrderId,
              contact: 'must-not-be-returned',
              notes: { key: 'secret-field' }
            }
          }
        }
      }
    });
    const logisticsWebhookEventId = `evt_logistics_${Date.now()}`;
    const nonPaymentWebhookEventId = `evt_non_payment_${Date.now()}`;
    await WebhookEvent.create({
      eventId: logisticsWebhookEventId,
      provider: 'DELHIVERY',
      eventType: 'shipment.delivered',
      status: 'FAILED',
      processingAttempts: 2
    });
    await WebhookEvent.create({
      eventId: nonPaymentWebhookEventId,
      provider: 'RAZORPAY',
      eventType: 'account.updated',
      status: 'FAILED',
      processingAttempts: 1
    });

    const resQueue = mockRes();
    await getAdminPaymentReconciliationQueue(mockReq({ page: '1', limit: '999' }), resQueue, mockNext);
    const queueItems = resQueue.data?.data?.items || [];
    check(resQueue.data?.success === true, 'Payment Reconciliation Queue returns success');
    check(resQueue.data?.data?.pagination?.limit === 100, 'Payment Reconciliation Queue bounds page size to 100');
    check(queueItems.some((item: any) => item.paymentId === queueCapturedPayment._id.toString() && item.source === 'PAYMENT'), 'Queue includes captured payments whose order is not PAID');
    check(queueItems.some((item: any) => item.paymentId === queueFlaggedPayment._id.toString() && item.issueReason === 'Provider settlement requires review'), 'Queue includes reconciliationRequired payments');
    check(queueItems.some((item: any) => item.attemptId === queueAttempt._id.toString() && item.razorpayOrderId === queueAttempt.razorpayOrderId), 'Queue includes stale PROCESSING attempts with exact gateway IDs');
    check(queueItems.some((item: any) => item.attemptId === queueCapturedAttemptWithoutPayment._id.toString() && item.issueReason === 'Captured payment attempt has no linked Payment record'), 'Queue includes CAPTURED attempts without a Payment record');
    check(queueItems.some((item: any) => item.attemptId === queueCapturedAttemptWithMismatch._id.toString() && item.issueReason === 'Captured payment attempt links to a Payment for a different order'), 'Queue includes CAPTURED attempts with inconsistent Payment linkage');
    check(queueItems.some((item: any) => item.attemptId === queueCapturedAttemptWithStatusMismatch._id.toString() && item.issueReason === 'Captured payment attempt conflicts with Payment status PENDING'), 'Queue includes CAPTURED attempts with inconsistent Payment status');
    const queueWebhook = queueItems.find((item: any) => item.webhookEventId === queueWebhookEventId);
    check(queueWebhook?.issueReason === 'Webhook processing failed after 2 attempts', 'Queue identifies failed repeated webhook events');
    check(queueWebhook?.razorpayPaymentId === queueCapturedPayment.razorpayPaymentId, 'Queue extracts only the exact Razorpay payment ID from webhook payload');
    check(!queueItems.some((item: any) => item.webhookEventId === logisticsWebhookEventId), 'Queue excludes failed logistics webhook events');
    check(!queueItems.some((item: any) => item.webhookEventId === nonPaymentWebhookEventId), 'Queue excludes non-payment Razorpay webhook events');
    check(!queueItems.some((item: any) => item.paymentId === queuePendingPayment._id.toString()), 'Queue excludes ordinary PENDING checkouts');
    check(queueItems.every((item: any) => !('payload' in item) && !('userId' in item) && !('contact' in item)), 'Queue response excludes webhook payload and customer fields');

    const resQueueSummary = mockRes();
    await getAdminPaymentReconciliationQueue(mockReq({ page: '1', limit: '1' }), resQueueSummary, mockNext);
    const queueSummary = resQueueSummary.data?.data?.summary;
    check(queueSummary?.unresolvedTotal > resQueueSummary.data?.data?.items?.length, 'Queue summary total is not limited to the current page');
    check(queueSummary?.capturedAwaitingActionCount >= 1, 'Queue summary counts captured payments awaiting action');
    check(queueSummary?.capturedAwaitingActionAmountByCurrency?.some((entry: any) => entry.currency === 'INR' && entry.amount >= 1230), 'Queue summary aggregates captured amount by currency');
    check(queueSummary?.paymentOrderMismatches >= 1, 'Queue summary counts payment/order mismatches');
    check(queueSummary?.reconciliationRequiredPayments >= 1, 'Queue summary counts flagged payments');
    check(queueSummary?.capturedAttemptMismatches >= 3, 'Queue summary counts captured attempt mismatches');
    check(queueSummary?.failedRazorpayWebhooks >= 1, 'Queue summary counts failed payment webhooks only');
    check(queueSummary?.staleProcessingAttempts >= 1, 'Queue summary counts stale PROCESSING attempts');

    const resQueueTooFar = mockRes();
    await getAdminPaymentReconciliationQueue(mockReq({ page: '10001' }), resQueueTooFar, mockNext);
    check(resQueueTooFar.statusCode === 400, 'Payment Reconciliation Queue rejects unbounded page offsets');

    // Cleanup test records
    await Invoice.deleteOne({ _id: invoiceDoc._id });
    await InventoryTransaction.deleteMany({ orderId: testOrderId });
    await AuditLog.deleteMany({ actorId: testAdminId });
    await NotificationLog.deleteMany({ entityId: testOrderId });
    await PaymentAttempt.deleteMany({ orderId: testOrderId });
    await WebhookEvent.deleteMany({ eventType: 'payment.captured' });
    await WebhookEvent.deleteMany({ eventId: { $in: [queueWebhookEventId, logisticsWebhookEventId, nonPaymentWebhookEventId] } });
    await PaymentAttempt.deleteMany({
      _id: {
        $in: [
          queueAttempt._id,
          queueCapturedAttemptWithoutPayment._id,
          queueCapturedAttemptWithMismatch._id,
          queueCapturedAttemptWithStatusMismatch._id
        ]
      }
    });
    await Payment.deleteMany({ _id: { $in: [queueCapturedPayment._id, queueFlaggedPayment._id, queuePendingPayment._id] } });
    await Order.deleteMany({ _id: { $in: [queueCapturedOrder._id, queueFlaggedOrder._id, queuePendingOrder._id] } });

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
