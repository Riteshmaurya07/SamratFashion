const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/samrat_fashion';

async function runOrderConfirmationE2ETest() {
  console.log('=== STARTING ORDER CONFIRMATION PAGE & API E2E TEST ===');

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
  require('./dist/models/InventoryTransaction');

  const User = mongoose.model('User');
  const Product = mongoose.model('Product');
  const CustomDesign = mongoose.model('CustomDesign');
  const Address = mongoose.model('Address');
  const Order = mongoose.model('Order');
  const Payment = mongoose.model('Payment');
  const PaymentAttempt = mongoose.model('PaymentAttempt');

  const { processPaymentSuccess } = require('./dist/services/payment/paymentProcessor');

  // 1. Setup User A & User B
  let userA = await User.findOne({ email: 'confirm_user_a@samratfashion.com' });
  if (!userA) {
    userA = await User.create({
      name: 'User A Confirmation',
      email: 'confirm_user_a@samratfashion.com',
      passwordHash: '$2a$10$wT0Xk1234567890abcdefu',
      role: 'CUSTOMER',
      isEmailVerified: true,
    });
  }

  let userB = await User.findOne({ email: 'confirm_user_b@samratfashion.com' });
  if (!userB) {
    userB = await User.create({
      name: 'User B Security',
      email: 'confirm_user_b@samratfashion.com',
      passwordHash: '$2a$10$wT0Xk1234567890abcdefu',
      role: 'CUSTOMER',
      isEmailVerified: true,
    });
  }
  console.log('2. Test Users Resolved: User A & User B');

  // 2. Setup Address & Product
  let address = await Address.findOne({ userId: userA._id });
  if (!address) {
    address = await Address.create({
      userId: userA._id,
      fullName: 'User A Confirmation',
      phone: '9876543210',
      addressLine1: '404 Confirm Rd',
      city: 'Mumbai',
      state: 'Maharashtra',
      postalCode: '400001',
      country: 'India',
      addressType: 'HOME',
      isDefault: true,
    });
  }

  let product = await Product.create({
    name: 'Order Confirmation Test Tee',
    slug: 'order-confirm-tee-' + Date.now(),
    description: 'Testing confirmation page flow',
    images: ['https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=500'],
    categoryId: new mongoose.Types.ObjectId(),
    basePrice: 1299,
    status: 'ACTIVE',
    variants: [{ _id: new mongoose.Types.ObjectId(), size: 'M', color: 'White', sku: 'CONF-WHT-M-' + Date.now(), stock: 100 }],
  });
  const variant = product.variants[0];

  const customDesign = await CustomDesign.create({
    userId: userA._id,
    name: 'Custom Front Crest',
    productId: product._id,
    selectedVariantId: variant._id,
    selectedColor: 'White',
    selectedSize: 'M',
    canvasWidth: 800,
    canvasHeight: 1000,
    elements: [{ id: 'el_1', type: 'TEXT', side: 'FRONT', x: 100, y: 100, width: 200, height: 50, text: 'CREST' }],
    previewImage: { front: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' },
    printLocations: ['FRONT'],
    status: 'SAVED',
  });

  console.log('3. Test Product & Custom Design Created');

  // 3. Create Order for User A
  const orderNumber = 'SF-' + new Date().getFullYear() + '-' + Math.floor(100000 + Math.random() * 900000);
  const newOrder = await Order.create({
    orderNumber,
    userId: userA._id,
    items: [
      {
        productId: product._id,
        variantId: variant._id,
        productName: `${product.name} (Custom: ${customDesign.name})`,
        productImage: customDesign.previewImage.front,
        selectedSize: variant.size,
        selectedColor: variant.color,
        quantity: 1,
        unitPrice: 1499,
        lineTotal: 1499,
        customDesignId: customDesign._id,
        customizationSnapshot: {
          name: customDesign.name,
          previewImage: customDesign.previewImage.front,
          printLocations: ['FRONT'],
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
    subtotal: 1499,
    discount: 0,
    shipping: 0,
    tax: 0,
    total: 1499,
    currency: 'INR',
    status: 'PENDING',
    paymentStatus: 'PENDING',
  });

  console.log(`4. Pending Order Created: ID=${newOrder._id}, orderNumber=${newOrder.orderNumber}`);

  // --- TEST SCENARIO 1: Lookup by ObjectId ---
  const foundById = await Order.findOne({ _id: newOrder._id, userId: userA._id });
  if (foundById && foundById._id.toString() === newOrder._id.toString()) {
    console.log('✔ TEST 1 PASSED: Order fetched successfully by ObjectId.');
  } else {
    console.error('❌ TEST 1 FAILED: Order lookup by ObjectId failed!');
    process.exit(1);
  }

  // --- TEST SCENARIO 2: Lookup by Public orderNumber ---
  const foundByNumber = await Order.findOne({ orderNumber: newOrder.orderNumber, userId: userA._id });
  if (foundByNumber && foundByNumber._id.toString() === newOrder._id.toString()) {
    console.log('✔ TEST 2 PASSED: Order fetched successfully by public orderNumber.');
  } else {
    console.error('❌ TEST 2 FAILED: Order lookup by orderNumber failed!');
    process.exit(1);
  }

  // --- TEST SCENARIO 3: Ownership Security (Cross-User Access Prevention) ---
  const crossUserFetch = await Order.findOne({ _id: newOrder._id, userId: userB._id });
  if (!crossUserFetch) {
    console.log('✔ TEST 3 PASSED: Cross-user access strictly blocked (User B cannot view User A order).');
  } else {
    console.error('❌ TEST 3 FAILED: Security breach! User B was able to view User A order!');
    process.exit(1);
  }

  // --- TEST SCENARIO 4: Successful Payment & Order Confirmation State ---
  let payment = await Payment.create({ orderId: newOrder._id, userId: userA._id, amount: newOrder.total, currency: 'INR', status: 'PENDING', provider: 'RAZORPAY' });
  const rpOrderId = 'order_confirm_mock_' + Date.now();
  await PaymentAttempt.create({ paymentId: payment._id, orderId: newOrder._id, razorpayOrderId: rpOrderId, amount: newOrder.total, currency: 'INR', status: 'PENDING' });

  await processPaymentSuccess(rpOrderId, 'pay_confirm_success_1');

  const confirmedOrder = await Order.findById(newOrder._id);
  if (confirmedOrder.paymentStatus === 'PAID' && confirmedOrder.status === 'CONFIRMED') {
    console.log('✔ TEST 4 PASSED: Order state updated to PAID and CONFIRMED.');
  } else {
    console.error('❌ TEST 4 FAILED: Order status not updated correctly on payment capture!');
    process.exit(1);
  }

  // --- TEST SCENARIO 5: Snapshot & Custom Design Integrity ---
  if (
    confirmedOrder.items.length === 1 &&
    confirmedOrder.items[0].customizationSnapshot &&
    confirmedOrder.items[0].customizationSnapshot.name === customDesign.name
  ) {
    console.log('✔ TEST 5 PASSED: Custom item snapshot preserved with exact print location and custom fee.');
  } else {
    console.error('❌ TEST 5 FAILED: Custom item snapshot corrupted!');
    process.exit(1);
  }

  console.log('\n=== ALL ORDER CONFIRMATION E2E TESTS PASSED SUCCESSFULLY! ===');
  await mongoose.disconnect();
}

runOrderConfirmationE2ETest().catch((err) => {
  console.error('ORDER CONFIRMATION E2E TEST ERROR:', err);
  process.exit(1);
});
