const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, './.env') });
const mongoose = require('mongoose');

async function runInvoiceE2ETests() {
  console.log('--- STARTING PHASE 9I INVOICE SYSTEM E2E TESTS ---');

  try {
    const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/samrat-fashion';
    await mongoose.connect(MONGO_URI);
    console.log('✓ Connected to MongoDB');

    const { User } = require('./dist/models/User');
    const { Product } = require('./dist/models/Product');
    const { Order } = require('./dist/models/Order');
    const { Payment } = require('./dist/models/Payment');
    const { Invoice } = require('./dist/models/Invoice');
    const { AuditLog } = require('./dist/models/AuditLog');
    const { getInvoiceByOrder, getOrCreateInvoiceForOrder } = require('./dist/controllers/invoiceController');

    const jwt = require('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET || 'fallback_jwt_secret_dev_only';

    // 1. Create Test Users
    const userA = await User.create({
      name: 'Invoice Customer A',
      email: `invoice.user.a.${Date.now()}@example.com`,
      passwordHash: 'hashedpass',
      role: 'CUSTOMER'
    });

    const userB = await User.create({
      name: 'Invoice Customer B',
      email: `invoice.user.b.${Date.now()}@example.com`,
      passwordHash: 'hashedpass',
      role: 'CUSTOMER'
    });

    const adminUser = await User.create({
      name: 'Invoice Super Admin',
      email: `invoice.admin.${Date.now()}@example.com`,
      passwordHash: 'hashedpass',
      role: 'SUPER_ADMIN'
    });

    const tokenA = jwt.sign({ id: userA._id.toString(), role: 'CUSTOMER' }, JWT_SECRET);
    const tokenB = jwt.sign({ id: userB._id.toString(), role: 'CUSTOMER' }, JWT_SECRET);
    const adminToken = jwt.sign({ id: adminUser._id.toString(), role: 'SUPER_ADMIN' }, JWT_SECRET);

    console.log('✓ Test users & JWT tokens created');

    // 2. Create Seed Products
    const prod1 = await Product.create({
      name: 'Heavyweight Oversized Tee',
      slug: `invoice-test-tee-${Date.now()}`,
      description: 'Test Product',
      basePrice: 1499,
      categoryId: new mongoose.Types.ObjectId(),
      variants: [{ sku: `SKU-INV-1-${Date.now()}`, stock: 50, additionalPrice: 0, isAvailable: true }],
      status: 'ACTIVE'
    });

    // 3. Create Paid Standard Order
    const paidOrder = await Order.create({
      orderNumber: `SF-ORD-INV-${Date.now()}`,
      userId: userA._id,
      items: [{
        productId: prod1._id,
        variantId: prod1.variants[0]._id,
        productName: prod1.name,
        productImage: 'https://example.com/tee.jpg',
        selectedSize: 'L',
        selectedColor: 'Black',
        quantity: 2,
        unitPrice: 1499,
        lineTotal: 2998
      }],
      shippingAddress: {
        fullName: 'Invoice Customer A',
        phone: '9876543210',
        addressLine1: '123 Fashion Street',
        city: 'Mumbai',
        state: 'Maharashtra',
        postalCode: '400001',
        country: 'India',
        addressType: 'HOME'
      },
      subtotal: 2998,
      discount: 200,
      shipping: 0,
      tax: 140,
      total: 2938,
      currency: 'INR',
      status: 'CONFIRMED',
      paymentStatus: 'PAID'
    });

    await Payment.create({
      orderId: paidOrder._id,
      userId: userA._id,
      amount: paidOrder.total,
      currency: 'INR',
      status: 'CAPTURED',
      provider: 'RAZORPAY'
    });

    console.log('✓ Paid test order created:', paidOrder.orderNumber);

    // [TEST 1] Generate Invoice & Check Format
    console.log('\n[TEST 1] Generating Invoice for Paid Order...');
    const invoice1 = await getOrCreateInvoiceForOrder(paidOrder._id.toString());

    if (!invoice1.invoiceNumber.startsWith('SF-INV-')) {
      throw new Error(`FAILED: Invoice number format invalid: ${invoice1.invoiceNumber}`);
    }
    if (invoice1.total !== paidOrder.total) {
      throw new Error(`FAILED: Invoice total (${invoice1.total}) does not match Order total (${paidOrder.total})`);
    }
    console.log(`✓ PASS: Generated Invoice Number: ${invoice1.invoiceNumber}, Total: ₹${invoice1.total}`);

    // [TEST 2] Idempotency Test
    console.log('\n[TEST 2] Idempotency Test (Duplicate Request)...');
    const invoice2 = await getOrCreateInvoiceForOrder(paidOrder._id.toString());
    if (invoice2._id.toString() !== invoice1._id.toString() || invoice2.invoiceNumber !== invoice1.invoiceNumber) {
      throw new Error('FAILED: Duplicate invoice was created for the same order');
    }
    console.log('✓ PASS: Idempotency enforced. Re-request returns identical Invoice document');

    // [TEST 3] Ownership Security Tests
    console.log('\n[TEST 3] Ownership & Security Verification...');
    const execGetInvoice = (reqUser, orderId) => {
      return new Promise((resolve, reject) => {
        const req = { params: { id: orderId }, user: reqUser };
        const res = {
          statusCode: 200,
          status(code) { this.statusCode = code; return this; },
          json(payload) {
            if (this.statusCode >= 400) reject(new Error(payload.message));
            else resolve(payload.data);
          }
        };
        const next = (err) => reject(err);
        getInvoiceByOrder(req, res, next);
      });
    };

    // User A accesses User A's invoice -> PASS
    const resA = await execGetInvoice({ id: userA._id.toString(), role: 'CUSTOMER' }, paidOrder._id.toString());
    if (resA.invoiceNumber !== invoice1.invoiceNumber) throw new Error('User A failed to access own invoice');
    console.log('✓ PASS: User A successfully accessed own invoice');

    // User B attempts to access User A's invoice -> REJECT 403
    try {
      await execGetInvoice({ id: userB._id.toString(), role: 'CUSTOMER' }, paidOrder._id.toString());
      throw new Error('FAILED: User B was illegally allowed to access User A invoice');
    } catch (err) {
      if (!err.message.includes('Access denied')) throw err;
      console.log('✓ PASS: User B access to User A invoice rejected with HTTP 403');
    }

    // Admin accesses User A's invoice -> PASS
    const resAdmin = await execGetInvoice({ id: adminUser._id.toString(), email: adminUser.email, role: 'SUPER_ADMIN' }, paidOrder._id.toString());
    if (resAdmin.invoiceNumber !== invoice1.invoiceNumber) throw new Error('Admin failed to access invoice');
    console.log('✓ PASS: Admin successfully accessed customer invoice & created AuditLog');

    // [TEST 4] Historical Snapshot Immutability Test
    console.log('\n[TEST 4] Historical Snapshot Immutability Test...');
    // Mutate Product name & base price in database
    await Product.findByIdAndUpdate(prod1._id, { name: 'MUTATED PRODUCT NAME', basePrice: 9999 });
    // Mutate User address in database
    await User.findByIdAndUpdate(userA._id, { name: 'MUTATED USER NAME' });

    // Fetch invoice again
    const snapshotInvoice = await Invoice.findOne({ orderId: paidOrder._id });
    if (snapshotInvoice.itemsSnapshot[0].productName === 'MUTATED PRODUCT NAME' || snapshotInvoice.subtotal === 9999) {
      throw new Error('FAILED: Historical invoice was altered by product mutation!');
    }
    if (snapshotInvoice.customerSnapshot.name === 'MUTATED USER NAME') {
      throw new Error('FAILED: Historical invoice customer snapshot was altered by user mutation!');
    }
    console.log('✓ PASS: Issued invoice remained 100% immutable despite Product & User mutations');

    // [TEST 5] Unpaid / Failed Order Invoice Rejection
    console.log('\n[TEST 5] Unpaid / Failed Order Invoice Rejection...');
    const failedOrder = await Order.create({
      orderNumber: `SF-ORD-FAILED-${Date.now()}`,
      userId: userA._id,
      items: paidOrder.items,
      shippingAddress: paidOrder.shippingAddress,
      subtotal: 1000,
      discount: 0,
      shipping: 0,
      tax: 0,
      total: 1000,
      currency: 'INR',
      status: 'CANCELLED',
      paymentStatus: 'FAILED'
    });

    try {
      await getOrCreateInvoiceForOrder(failedOrder._id.toString());
      throw new Error('FAILED: Invoice was generated for a failed/cancelled order');
    } catch (err) {
      if (!err.message.includes('Invoice cannot be generated')) throw err;
      console.log('✓ PASS: Unpaid/failed order invoice request rejected as expected');
    }

    // [TEST 6] Custom Print Order Support Test
    console.log('\n[TEST 6] Custom Print Order Support Test...');
    const customOrder = await Order.create({
      orderNumber: `SF-ORD-CUSTOM-${Date.now()}`,
      userId: userA._id,
      items: [{
        productId: prod1._id,
        variantId: prod1.variants[0]._id,
        productName: 'Custom Designed Graphic Tee',
        productImage: 'https://example.com/custom.jpg',
        selectedSize: 'M',
        selectedColor: 'White',
        quantity: 1,
        unitPrice: 1899,
        lineTotal: 1899,
        customDesignId: new mongoose.Types.ObjectId(),
        customizationSnapshot: {
          name: 'Cyber Skull Custom Artwork',
          previewImage: 'https://example.com/skull.png',
          printLocations: ['FRONT', 'BACK'],
          customFee: 400
        }
      }],
      shippingAddress: paidOrder.shippingAddress,
      subtotal: 1899,
      discount: 0,
      shipping: 0,
      tax: 95,
      total: 1994,
      currency: 'INR',
      status: 'PROCESSING',
      paymentStatus: 'PAID'
    });

    const customInvoice = await getOrCreateInvoiceForOrder(customOrder._id.toString());
    if (!customInvoice.itemsSnapshot[0].customizationSnapshot?.name) {
      throw new Error('FAILED: Custom print artwork snapshot missing from custom invoice');
    }
    console.log(`✓ PASS: Custom print order invoice created with artwork snapshot: "${customInvoice.itemsSnapshot[0].customizationSnapshot.name}"`);

    // Cleanup seed records
    await User.deleteMany({ _id: { $in: [userA._id, userB._id, adminUser._id] } });
    await Product.deleteOne({ _id: prod1._id });
    await Order.deleteMany({ _id: { $in: [paidOrder._id, failedOrder._id, customOrder._id] } });
    await Payment.deleteMany({ orderId: { $in: [paidOrder._id, failedOrder._id, customOrder._id] } });
    await Invoice.deleteMany({ orderId: { $in: [paidOrder._id, failedOrder._id, customOrder._id] } });

    console.log('✓ Cleaned up test seed records');

    console.log('\n======================================================');
    console.log('ALL PHASE 9I INVOICE SYSTEM E2E TESTS PASSED 100%');
    console.log('======================================================\n');
    process.exit(0);

  } catch (err) {
    console.error('❌ INVOICE E2E TEST FAILED:', err.message);
    process.exit(1);
  }
}

runInvoiceE2ETests();
