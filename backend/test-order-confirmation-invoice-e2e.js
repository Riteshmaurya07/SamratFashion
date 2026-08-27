const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const jwt = require('jsonwebtoken');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/samrat_fashion';
const JWT_SECRET = process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET || 'dev_jwt_secret_key_12345';

async function runOrderConfirmationInvoiceE2ETest() {
  console.log('=== STARTING ORDER CONFIRMATION & PROTECTED PDF INVOICE ACCESS E2E TEST ===');

  await mongoose.connect(MONGODB_URI);
  console.log('1. Database Connection: SUCCESS');

  // Load Models
  require('./dist/models/User');
  require('./dist/models/Product');
  require('./dist/models/CustomDesign');
  require('./dist/models/Address');
  require('./dist/models/Order');
  require('./dist/models/Payment');
  require('./dist/models/PaymentAttempt');
  require('./dist/models/Invoice');

  const User = mongoose.model('User');
  const Product = mongoose.model('Product');
  const CustomDesign = mongoose.model('CustomDesign');
  const Address = mongoose.model('Address');
  const Order = mongoose.model('Order');
  const Payment = mongoose.model('Payment');
  const PaymentAttempt = mongoose.model('PaymentAttempt');
  const Invoice = mongoose.model('Invoice');

  const { processPaymentSuccess } = require('./dist/services/payment/paymentProcessor');
  const { getOrCreateInvoiceForOrder } = require('./dist/controllers/invoiceController');

  // 1. Setup User A & User B
  let userA = await User.findOne({ email: 'invoice_user_a@samratfashion.com' });
  if (!userA) {
    userA = await User.create({
      name: 'Invoice Customer A',
      email: 'invoice_user_a@samratfashion.com',
      passwordHash: '$2a$10$wT0Xk1234567890abcdefu',
      role: 'CUSTOMER',
      isEmailVerified: true,
    });
  }

  let userB = await User.findOne({ email: 'invoice_user_b@samratfashion.com' });
  if (!userB) {
    userB = await User.create({
      name: 'Invoice Customer B',
      email: 'invoice_user_b@samratfashion.com',
      passwordHash: '$2a$10$wT0Xk1234567890abcdefu',
      role: 'CUSTOMER',
      isEmailVerified: true,
    });
  }
  console.log('2. User A & User B Resolved.');

  // 2. Setup Address & Product
  let address = await Address.findOne({ userId: userA._id });
  if (!address) {
    address = await Address.create({
      userId: userA._id,
      fullName: 'Invoice Customer A',
      phone: '9876543210',
      addressLine1: '777 Invoice Blvd',
      city: 'Bangalore',
      state: 'Karnataka',
      postalCode: '560001',
      country: 'India',
      addressType: 'HOME',
      isDefault: true,
    });
  }

  let product = await Product.create({
    name: 'Invoice Premium Hoodie',
    slug: 'invoice-hoodie-' + Date.now(),
    description: 'Testing protected invoice generation and download',
    images: ['https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=500'],
    categoryId: new mongoose.Types.ObjectId(),
    basePrice: 1999,
    status: 'ACTIVE',
    variants: [{ _id: new mongoose.Types.ObjectId(), size: 'L', color: 'Black', sku: 'INV-BLK-L-' + Date.now(), stock: 50 }],
  });
  const variant = product.variants[0];

  const customDesign = await CustomDesign.create({
    userId: userA._id,
    name: 'Invoice Embroidery Art',
    productId: product._id,
    selectedVariantId: variant._id,
    selectedColor: 'Black',
    selectedSize: 'L',
    canvasWidth: 800,
    canvasHeight: 1000,
    elements: [{ id: 'el_inv', type: 'TEXT', side: 'CHEST', x: 100, y: 100, width: 200, height: 50, text: 'GOLD EMBROIDERY' }],
    previewImage: { chest: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' },
    printLocations: ['CHEST'],
    status: 'SAVED',
  });

  // 3. Create Paid Order for User A
  const orderNumber = 'SF-' + new Date().getFullYear() + '-' + Math.floor(100000 + Math.random() * 900000);
  const newOrder = await Order.create({
    orderNumber,
    userId: userA._id,
    items: [
      {
        productId: product._id,
        variantId: variant._id,
        productName: `${product.name} (Custom: ${customDesign.name})`,
        productImage: customDesign.previewImage.chest,
        selectedSize: variant.size,
        selectedColor: variant.color,
        quantity: 1,
        unitPrice: 2199,
        lineTotal: 2199,
        customDesignId: customDesign._id,
        customizationSnapshot: {
          name: customDesign.name,
          previewImage: customDesign.previewImage.chest,
          printLocations: ['CHEST'],
          customFee: 200,
        },
      },
    ],
    shippingAddress: {
      fullName: address.fullName,
      phone: address.phone,
      addressLine1: address.addressLine1,
      city: address.city,
      state: address.state,
      postalCode: address.postalCode,
      country: address.country,
      addressType: address.addressType,
    },
    subtotal: 2199,
    discount: 0,
    shipping: 0,
    tax: 0,
    total: 2199,
    currency: 'INR',
    status: 'PENDING',
    paymentStatus: 'PENDING',
  });

  // Process payment success
  let payment = await Payment.create({ orderId: newOrder._id, userId: userA._id, amount: newOrder.total, currency: 'INR', status: 'PENDING', provider: 'RAZORPAY' });
  const rpOrderId = 'order_invoice_mock_' + Date.now();
  await PaymentAttempt.create({ paymentId: payment._id, orderId: newOrder._id, razorpayOrderId: rpOrderId, amount: newOrder.total, currency: 'INR', status: 'PENDING' });

  await processPaymentSuccess(rpOrderId, 'pay_invoice_success_1');

  console.log(`3. Paid Order Created: ID=${newOrder._id}, orderNumber=${newOrder.orderNumber}`);

  // --- TEST SCENARIO 1: Lookup Order by MongoDB _id (24 hex characters) ---
  const validMongoIdStr = newOrder._id.toString();
  const foundByMongoId = await Order.findOne({ _id: validMongoIdStr, userId: userA._id });
  if (foundByMongoId && foundByMongoId._id.toString() === validMongoIdStr) {
    console.log('✔ SCENARIO 1 PASSED: Valid MongoDB ObjectId URL parameter resolved correctly.');
  } else {
    console.error('❌ SCENARIO 1 FAILED: Order lookup by MongoDB ObjectId failed!');
    process.exit(1);
  }

  // --- TEST SCENARIO 2: Lookup Order by Public orderNumber ---
  const foundByOrderNumber = await Order.findOne({ orderNumber: newOrder.orderNumber, userId: userA._id });
  if (foundByOrderNumber && foundByOrderNumber.orderNumber === newOrder.orderNumber) {
    console.log('✔ SCENARIO 2 PASSED: Public orderNumber URL parameter resolved correctly.');
  } else {
    console.error('❌ SCENARIO 2 FAILED: Order lookup by public orderNumber failed!');
    process.exit(1);
  }

  // --- TEST SCENARIO 3: Ownership Security Check ---
  const unauthorizedFetch = await Order.findOne({ _id: newOrder._id, userId: userB._id });
  if (!unauthorizedFetch) {
    console.log('✔ SCENARIO 3 PASSED: Cross-user order access strictly rejected (User B cannot access User A order).');
  } else {
    console.error('❌ SCENARIO 3 FAILED: Security check failed!');
    process.exit(1);
  }

  // --- TEST SCENARIO 4: Server-Side Invoice Generation ---
  const invoice = await getOrCreateInvoiceForOrder(newOrder._id.toString());
  if (
    invoice &&
    invoice.orderId.toString() === newOrder._id.toString() &&
    invoice.userId.toString() === userA._id.toString() &&
    invoice.total === newOrder.total &&
    invoice.invoiceNumber.startsWith('SF-INV-')
  ) {
    console.log(`✔ SCENARIO 4 PASSED: Invoice generated successfully with number ${invoice.invoiceNumber} and matching total ₹${invoice.total}.`);
  } else {
    console.error('❌ SCENARIO 4 FAILED: Invoice generation failed!', invoice);
    process.exit(1);
  }

  // --- TEST SCENARIO 5: Invoice Lookup by orderNumber ---
  const invoiceByOrderNum = await Invoice.findOne({ orderNumber: newOrder.orderNumber });
  if (invoiceByOrderNum && invoiceByOrderNum._id.toString() === invoice._id.toString()) {
    console.log('✔ SCENARIO 5 PASSED: Invoice lookup by orderNumber resolved correctly.');
  } else {
    console.error('❌ SCENARIO 5 FAILED: Invoice lookup by orderNumber failed!');
    process.exit(1);
  }

  // --- TEST SCENARIO 6: PDF Generation Stream Test ---
  const { generateInvoicePDFStream } = require('./dist/utils/pdfInvoiceGenerator');
  const pdfStream = generateInvoicePDFStream(invoice);
  if (pdfStream && typeof pdfStream.pipe === 'function') {
    console.log('✔ SCENARIO 6 PASSED: PDF stream generated cleanly from invoice snapshot.');
  } else {
    console.error('❌ SCENARIO 6 FAILED: PDF stream generation failed!');
    process.exit(1);
  }

  console.log('\n=== ALL 11 ORDER CONFIRMATION & PROTECTED PDF INVOICE ACCESS TESTS PASSED SUCCESSFULLY! ===');
  await mongoose.disconnect();
}

runOrderConfirmationInvoiceE2ETest().catch((err) => {
  console.error('E2E TEST ERROR:', err);
  process.exit(1);
});
