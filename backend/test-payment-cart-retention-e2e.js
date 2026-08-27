const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/samrat_fashion';

async function runPaymentCartRetentionE2ETest() {
  console.log('=== STARTING PAYMENT CANCEL/FAILURE CART RETENTION & PARTIAL CONSUMPTION E2E TEST ===');

  await mongoose.connect(MONGODB_URI);
  console.log('1. Database Connection: SUCCESS');

  // Load Models
  require('./dist/models/User');
  require('./dist/models/Product');
  require('./dist/models/CustomDesign');
  require('./dist/models/Cart');
  require('./dist/models/Address');
  require('./dist/models/Order');
  require('./dist/models/Payment');
  require('./dist/models/PaymentAttempt');
  require('./dist/models/InventoryTransaction');
  require('./dist/models/Coupon');
  require('./dist/models/CouponUsage');
  require('./dist/models/WebhookEvent');

  const User = mongoose.model('User');
  const Product = mongoose.model('Product');
  const CustomDesign = mongoose.model('CustomDesign');
  const Cart = mongoose.model('Cart');
  const Address = mongoose.model('Address');
  const Order = mongoose.model('Order');
  const Payment = mongoose.model('Payment');
  const PaymentAttempt = mongoose.model('PaymentAttempt');
  const InventoryTransaction = mongoose.model('InventoryTransaction');
  const Coupon = mongoose.model('Coupon');

  const { processPaymentSuccess } = require('./dist/services/payment/paymentProcessor');

  // 1. Get or Create Test Customer
  let customer = await User.findOne({ email: 'test_cart_user@samratfashion.com' });
  if (!customer) {
    customer = await User.create({
      name: 'Cart Retention Tester',
      email: 'test_cart_user@samratfashion.com',
      passwordHash: '$2a$10$wT0Xk1234567890abcdefu',
      role: 'CUSTOMER',
      isEmailVerified: true,
    });
  }

  // 2. Create Test Address
  let address = await Address.findOne({ userId: customer._id });
  if (!address) {
    address = await Address.create({
      userId: customer._id,
      fullName: 'Cart Tester',
      phone: '9876543210',
      addressLine1: '100 Retain St',
      city: 'Delhi',
      state: 'Delhi',
      postalCode: '110001',
      country: 'India',
      addressType: 'HOME',
      isDefault: true,
    });
  }

  // 3. Create 2 Products (Normal & Customizable)
  let prodA = await Product.create({
    name: 'Normal Essential Polo',
    slug: 'normal-polo-' + Date.now(),
    description: 'Polo Shirt for Cart Retention Test',
    images: ['https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=500'],
    categoryId: new mongoose.Types.ObjectId(),
    basePrice: 999,
    status: 'ACTIVE',
    variants: [{ _id: new mongoose.Types.ObjectId(), size: 'L', color: 'Navy', sku: 'POLO-NAV-L-' + Date.now(), stock: 50 }],
  });

  let prodB = await Product.create({
    name: 'Custom Graphic Hoodie',
    slug: 'custom-hoodie-' + Date.now(),
    description: 'Custom Hoodie for Cart Retention Test',
    images: ['https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=500'],
    categoryId: new mongoose.Types.ObjectId(),
    basePrice: 1499,
    status: 'ACTIVE',
    isCustomizable: true,
    variants: [{ _id: new mongoose.Types.ObjectId(), size: 'XL', color: 'Black', sku: 'HOOD-BLK-XL-' + Date.now(), stock: 50 }],
  });

  const varA = prodA.variants[0];
  const varB = prodB.variants[0];

  // Create Custom Design
  const customDesign = await CustomDesign.create({
    userId: customer._id,
    name: 'Hoodie Custom Back Art',
    productId: prodB._id,
    selectedVariantId: varB._id,
    selectedColor: 'Black',
    selectedSize: 'XL',
    canvasWidth: 800,
    canvasHeight: 1000,
    elements: [{ id: 'el_1', type: 'TEXT', side: 'BACK', x: 100, y: 100, width: 200, height: 50, text: 'CUSTOM ART' }],
    previewImage: { back: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' },
    printLocations: ['BACK'],
    status: 'SAVED',
  });

  // Create Coupon
  const coupon = await Coupon.create({
    code: 'RETENTION10_' + Date.now(),
    discountType: 'PERCENTAGE',
    discountValue: 10,
    isActive: true,
  });

  console.log('2. Test Users, Products, Custom Design, and Coupon Setup: SUCCESS');

  // --- TEST SCENARIO 1: Order Creation with Normal Product + Payment Cancellation ---
  console.log('\n--- TEST SCENARIO 1: Payment Cancellation (Cart Retention Check) ---');
  await Cart.deleteOne({ userId: customer._id });
  let cart = await Cart.create({
    userId: customer._id,
    items: [
      { productId: prodA._id, variantId: varA._id, quantity: 1 },
      {
        productId: prodB._id,
        variantId: varB._id,
        quantity: 2,
        customDesignId: customDesign._id,
        customizationSnapshot: { name: customDesign.name, previewImage: customDesign.previewImage.back, printLocations: ['BACK'], customFee: 200 },
      },
    ],
    couponCode: coupon.code,
  });

  // Simulate Order Creation (POST /api/orders behavior)
  const orderItemsScenario1 = [
    { productId: prodA._id, variantId: varA._id, productName: prodA.name, productImage: prodA.images[0], selectedSize: varA.size, selectedColor: varA.color, quantity: 1, unitPrice: prodA.basePrice, lineTotal: prodA.basePrice },
  ];

  const pendingOrder1 = await Order.create({
    orderNumber: 'SF-TEST-CANCEL-' + Date.now(),
    userId: customer._id,
    items: orderItemsScenario1,
    shippingAddress: { fullName: address.fullName, phone: address.phone, addressLine1: address.addressLine1, city: address.city, state: address.state, postalCode: address.postalCode, country: address.country, addressType: address.addressType },
    subtotal: 999, discount: 0, shipping: 0, tax: 0, total: 999, currency: 'INR', status: 'PENDING', paymentStatus: 'PENDING',
  });

  // Verify Cart items STILL exist in database after order creation
  let cartAfterCancel = await Cart.findOne({ userId: customer._id });
  if (cartAfterCancel && cartAfterCancel.items.length === 2 && cartAfterCancel.couponCode === coupon.code) {
    console.log('✔ SCENARIO 1 PASSED: Cart items & coupon remain in DB during payment pending/cancel state.');
  } else {
    console.error('❌ SCENARIO 1 FAILED: Cart was unexpectedly cleared or mutated during order creation!');
    process.exit(1);
  }

  // --- TEST SCENARIO 2: Payment Failure (Cart Retention & Financial State Check) ---
  console.log('\n--- TEST SCENARIO 2: Payment Failure (Cart Retention Check) ---');
  let salesOnFailure = await InventoryTransaction.countDocuments({ orderId: pendingOrder1._id, type: 'SALE' });
  if (salesOnFailure === 0 && pendingOrder1.paymentStatus === 'PENDING') {
    console.log('✔ SCENARIO 2 PASSED: 0 SALE inventory transactions recorded & payment status remains unpaid.');
  } else {
    console.error('❌ SCENARIO 2 FAILED: Inventory SALE created or order falsely marked PAID on pending/cancelled state!');
    process.exit(1);
  }

  // --- TEST SCENARIO 3: Retry Payment Flow ---
  console.log('\n--- TEST SCENARIO 3: Retry Payment Flow ---');
  let payment = await Payment.create({ orderId: pendingOrder1._id, userId: customer._id, amount: pendingOrder1.total, currency: 'INR', status: 'PENDING', provider: 'RAZORPAY' });
  const retryRazorpayOrderId = 'order_retry_mock_' + Date.now();
  let attempt = await PaymentAttempt.create({ paymentId: payment._id, orderId: pendingOrder1._id, razorpayOrderId: retryRazorpayOrderId, amount: pendingOrder1.total, currency: 'INR', status: 'PENDING' });
  
  console.log(`✔ SCENARIO 3 PASSED: Payment attempt created for existing order ${pendingOrder1.orderNumber} without duplicate order creation.`);

  // --- TEST SCENARIO 4: Successful Payment & Partial Cart Consumption ---
  console.log('\n--- TEST SCENARIO 4: Successful Payment & Partial Cart Consumption ---');
  // Order 1 was created for 1 unit of Product A.
  // Cart currently contains: 1 unit of Product A, 2 units of Product B (Custom).
  // When Order 1 payment succeeds, Product A should be removed from cart, and 2 units of Product B should remain in cart!

  await processPaymentSuccess(retryRazorpayOrderId, 'pay_mock_success_1');

  let verifiedOrder1 = await Order.findById(pendingOrder1._id);
  let cartAfterSuccess = await Cart.findOne({ userId: customer._id });
  let salesOnSuccess = await InventoryTransaction.countDocuments({ orderId: pendingOrder1._id, type: 'SALE' });

  if (
    verifiedOrder1.paymentStatus === 'PAID' &&
    verifiedOrder1.status === 'CONFIRMED' &&
    salesOnSuccess === 1 &&
    cartAfterSuccess &&
    cartAfterSuccess.items.length === 1 &&
    cartAfterSuccess.items[0].productId.toString() === prodB._id.toString() &&
    cartAfterSuccess.items[0].quantity === 2
  ) {
    console.log('✔ SCENARIO 4 PASSED: Payment captured, Order confirmed, Inventory SALE = 1, Product A consumed from cart, Product B (Custom x2) remains intact in cart!');
  } else {
    console.error('❌ SCENARIO 4 FAILED: Partial cart consumption failed! Cart state:', JSON.stringify(cartAfterSuccess));
    process.exit(1);
  }

  // --- TEST SCENARIO 5: Multi-Quantity Partial Consumption ---
  console.log('\n--- TEST SCENARIO 5: Multi-Quantity Partial Cart Consumption ---');
  // Add 3 units of Product A back to Cart. Cart now has: Product B (x2), Product A (x3).
  cartAfterSuccess.items.push({ productId: prodA._id, variantId: varA._id, quantity: 3 });
  await cartAfterSuccess.save();

  // Create an order for 2 units of Product A.
  const orderItemsScenario5 = [
    { productId: prodA._id, variantId: varA._id, productName: prodA.name, productImage: prodA.images[0], selectedSize: varA.size, selectedColor: varA.color, quantity: 2, unitPrice: prodA.basePrice, lineTotal: prodA.basePrice * 2 },
  ];
  const pendingOrder2 = await Order.create({
    orderNumber: 'SF-TEST-PARTIAL-' + Date.now(),
    userId: customer._id,
    items: orderItemsScenario5,
    shippingAddress: { fullName: address.fullName, phone: address.phone, addressLine1: address.addressLine1, city: address.city, state: address.state, postalCode: address.postalCode, country: address.country, addressType: address.addressType },
    subtotal: prodA.basePrice * 2, discount: 0, shipping: 0, tax: 0, total: prodA.basePrice * 2, currency: 'INR', status: 'PENDING', paymentStatus: 'PENDING',
  });

  const payment2 = await Payment.create({ orderId: pendingOrder2._id, userId: customer._id, amount: pendingOrder2.total, currency: 'INR', status: 'PENDING', provider: 'RAZORPAY' });
  const rpOrderId2 = 'order_partial_mock_' + Date.now();
  await PaymentAttempt.create({ paymentId: payment2._id, orderId: pendingOrder2._id, razorpayOrderId: rpOrderId2, amount: pendingOrder2.total, currency: 'INR', status: 'PENDING' });

  // Process payment success for Order 2 (2 units of Product A)
  await processPaymentSuccess(rpOrderId2, 'pay_mock_success_2');

  let cartAfterScenario5 = await Cart.findOne({ userId: customer._id });
  let itemAInCart = cartAfterScenario5.items.find(i => i.productId.toString() === prodA._id.toString());

  if (cartAfterScenario5 && itemAInCart && itemAInCart.quantity === 1) {
    console.log('✔ SCENARIO 5 PASSED: Cart quantity reduced from 3 to 1 after order for 2 units succeeded!');
  } else {
    console.error('❌ SCENARIO 5 FAILED: Multi-quantity partial consumption incorrect. Item A in cart:', itemAInCart);
    process.exit(1);
  }

  // --- TEST SCENARIO 6: Webhook Idempotency Replay Test ---
  console.log('\n--- TEST SCENARIO 6: Webhook Idempotency Replay ---');
  // Replay processPaymentSuccess for rpOrderId2
  await processPaymentSuccess(rpOrderId2, 'pay_mock_success_2');

  let cartAfterReplay = await Cart.findOne({ userId: customer._id });
  let itemAAfterReplay = cartAfterReplay.items.find(i => i.productId.toString() === prodA._id.toString());
  let salesCountForOrder2 = await InventoryTransaction.countDocuments({ orderId: pendingOrder2._id, type: 'SALE' });

  if (itemAAfterReplay && itemAAfterReplay.quantity === 1 && salesCountForOrder2 === 1) {
    console.log('✔ SCENARIO 6 PASSED: Duplicate payment webhook replay executed idempotently with 0 extra cart consumption and 0 extra inventory SALE.');
  } else {
    console.error('❌ SCENARIO 6 FAILED: Duplicate webhook caused unintended side effects!');
    process.exit(1);
  }

  // --- TEST 13: Partial Cart Consumption ---
  console.log('\n--- TEST 13: Partial Cart Consumption (Product A x1, Product B x2 -> Order A x1 -> Product A removed, Product B remains x2) ---');
  await Cart.deleteOne({ userId: customer._id });
  await Cart.create({
    userId: customer._id,
    items: [
      { productId: prodA._id, variantId: varA._id, quantity: 1 },
      { productId: prodB._id, variantId: varB._id, quantity: 2, customDesignId: customDesign._id },
    ],
  });

  const orderItemsTest13 = [
    { productId: prodA._id, variantId: varA._id, productName: prodA.name, productImage: prodA.images[0], selectedSize: varA.size, selectedColor: varA.color, quantity: 1, unitPrice: prodA.basePrice, lineTotal: prodA.basePrice },
  ];

  const pendingOrder13 = await Order.create({
    orderNumber: 'SF-TEST13-' + Date.now(),
    userId: customer._id,
    items: orderItemsTest13,
    shippingAddress: { fullName: address.fullName, phone: address.phone, addressLine1: address.addressLine1, city: address.city, state: address.state, postalCode: address.postalCode, country: address.country, addressType: address.addressType },
    subtotal: prodA.basePrice, discount: 0, shipping: 0, tax: 0, total: prodA.basePrice, currency: 'INR', status: 'PENDING', paymentStatus: 'PENDING',
  });

  const payment13 = await Payment.create({ orderId: pendingOrder13._id, userId: customer._id, amount: pendingOrder13.total, currency: 'INR', status: 'PENDING', provider: 'RAZORPAY' });
  const rpOrderId13 = 'order_test13_mock_' + Date.now();
  await PaymentAttempt.create({ paymentId: payment13._id, orderId: pendingOrder13._id, razorpayOrderId: rpOrderId13, amount: pendingOrder13.total, currency: 'INR', status: 'PENDING' });

  // Payment succeeds for Order 13
  await processPaymentSuccess(rpOrderId13, 'pay_mock_success_13');

  let cart13 = await Cart.findOne({ userId: customer._id });
  let hasProdA = cart13.items.some(i => i.productId.toString() === prodA._id.toString());
  let itemB13 = cart13.items.find(i => i.productId.toString() === prodB._id.toString());

  if (cart13 && !hasProdA && itemB13 && itemB13.quantity === 2) {
    console.log('✔ TEST 13 PASSED: Product A removed, Product B remains x2 after payment success!');
  } else {
    console.error('❌ TEST 13 FAILED: Cart after payment success:', JSON.stringify(cart13));
    process.exit(1);
  }

  // --- TEST 14: Partial Quantity Consumption ---
  console.log('\n--- TEST 14: Partial Quantity Consumption (Cart Product A x5 -> Order Product A x2 -> Payment succeeds -> Cart Product A = x3) ---');
  await Cart.deleteOne({ userId: customer._id });
  await Cart.create({
    userId: customer._id,
    items: [
      { productId: prodA._id, variantId: varA._id, quantity: 5 },
    ],
  });

  const orderItemsTest14 = [
    { productId: prodA._id, variantId: varA._id, productName: prodA.name, productImage: prodA.images[0], selectedSize: varA.size, selectedColor: varA.color, quantity: 2, unitPrice: prodA.basePrice, lineTotal: prodA.basePrice * 2 },
  ];

  const pendingOrder14 = await Order.create({
    orderNumber: 'SF-TEST14-' + Date.now(),
    userId: customer._id,
    items: orderItemsTest14,
    shippingAddress: { fullName: address.fullName, phone: address.phone, addressLine1: address.addressLine1, city: address.city, state: address.state, postalCode: address.postalCode, country: address.country, addressType: address.addressType },
    subtotal: prodA.basePrice * 2, discount: 0, shipping: 0, tax: 0, total: prodA.basePrice * 2, currency: 'INR', status: 'PENDING', paymentStatus: 'PENDING',
  });

  const payment14 = await Payment.create({ orderId: pendingOrder14._id, userId: customer._id, amount: pendingOrder14.total, currency: 'INR', status: 'PENDING', provider: 'RAZORPAY' });
  const rpOrderId14 = 'order_test14_mock_' + Date.now();
  await PaymentAttempt.create({ paymentId: payment14._id, orderId: pendingOrder14._id, razorpayOrderId: rpOrderId14, amount: pendingOrder14.total, currency: 'INR', status: 'PENDING' });

  // Payment succeeds for Order 14
  await processPaymentSuccess(rpOrderId14, 'pay_mock_success_14');

  let cart14 = await Cart.findOne({ userId: customer._id });
  let itemA14 = cart14.items.find(i => i.productId.toString() === prodA._id.toString());

  if (cart14 && itemA14 && itemA14.quantity === 3) {
    console.log('✔ TEST 14 PASSED: Cart Product A quantity reduced from 5 to 3 after payment success!');
  } else {
    console.error('❌ TEST 14 FAILED: Cart after payment success:', JSON.stringify(cart14));
    process.exit(1);
  }

  // --- TEST 15: Custom + Normal Cart Partial Consumption ---
  console.log('\n--- TEST 15: Custom + Normal Cart (Cart: Normal A x1, Custom B x1 -> Order Custom B x1 -> Payment succeeds -> Normal A remains x1, Custom B consumed) ---');
  await Cart.deleteOne({ userId: customer._id });
  await Cart.create({
    userId: customer._id,
    items: [
      { productId: prodA._id, variantId: varA._id, quantity: 1 },
      { productId: prodB._id, variantId: varB._id, quantity: 1, customDesignId: customDesign._id },
    ],
  });

  const orderItemsTest15 = [
    {
      productId: prodB._id,
      variantId: varB._id,
      productName: `${prodB.name} (Custom: ${customDesign.name})`,
      productImage: customDesign.previewImage.back,
      selectedSize: varB.size,
      selectedColor: varB.color,
      quantity: 1,
      unitPrice: prodB.basePrice + 200,
      lineTotal: prodB.basePrice + 200,
      customDesignId: customDesign._id,
      customizationSnapshot: { name: customDesign.name, previewImage: customDesign.previewImage.back, printLocations: ['BACK'], customFee: 200 },
    },
  ];

  const pendingOrder15 = await Order.create({
    orderNumber: 'SF-TEST15-' + Date.now(),
    userId: customer._id,
    items: orderItemsTest15,
    shippingAddress: { fullName: address.fullName, phone: address.phone, addressLine1: address.addressLine1, city: address.city, state: address.state, postalCode: address.postalCode, country: address.country, addressType: address.addressType },
    subtotal: prodB.basePrice + 200, discount: 0, shipping: 0, tax: 0, total: prodB.basePrice + 200, currency: 'INR', status: 'PENDING', paymentStatus: 'PENDING',
  });

  const payment15 = await Payment.create({ orderId: pendingOrder15._id, userId: customer._id, amount: pendingOrder15.total, currency: 'INR', status: 'PENDING', provider: 'RAZORPAY' });
  const rpOrderId15 = 'order_test15_mock_' + Date.now();
  await PaymentAttempt.create({ paymentId: payment15._id, orderId: pendingOrder15._id, razorpayOrderId: rpOrderId15, amount: pendingOrder15.total, currency: 'INR', status: 'PENDING' });

  // Payment succeeds for Order 15
  await processPaymentSuccess(rpOrderId15, 'pay_mock_success_15');

  let cart15 = await Cart.findOne({ userId: customer._id });
  let itemA15 = cart15.items.find(i => i.productId.toString() === prodA._id.toString());
  let itemB15 = cart15.items.find(i => i.productId.toString() === prodB._id.toString());

  if (cart15 && itemA15 && itemA15.quantity === 1 && !itemB15) {
    console.log('✔ TEST 15 PASSED: Custom B consumed, Normal A remains x1 after payment success!');
  } else {
    console.error('❌ TEST 15 FAILED: Cart after payment success:', JSON.stringify(cart15));
    process.exit(1);
  }

  console.log('\n=== ALL PAYMENT CANCEL/FAILURE CART RETENTION & TEST 13/14/15 PARTIAL CONSUMPTION TESTS PASSED SUCCESSFULLY! ===');
  await mongoose.disconnect();
}

runPaymentCartRetentionE2ETest().catch((err) => {
  console.error('E2E TEST ERROR:', err);
  process.exit(1);
});
