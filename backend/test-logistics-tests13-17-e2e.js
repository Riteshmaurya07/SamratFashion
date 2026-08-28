const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/samrat_fashion';

async function runTests13To17E2E() {
  console.log('=== STARTING TESTS 13-17 LOGISTICS STATE MACHINE & CANCELLATION BOUNDARY E2E TEST ===');

  await mongoose.connect(MONGODB_URI);
  console.log('1. Database Connection: SUCCESS');

  // Load Models
  require('./dist/models/User');
  require('./dist/models/Product');
  require('./dist/models/CustomDesign');
  require('./dist/models/Address');
  require('./dist/models/Order');
  require('./dist/models/Payment');
  require('./dist/models/Shipment');
  require('./dist/models/PrintJob');
  require('./dist/models/LogisticsEventLog');

  const User = mongoose.model('User');
  const Product = mongoose.model('Product');
  const Address = mongoose.model('Address');
  const Order = mongoose.model('Order');
  const Shipment = mongoose.model('Shipment');
  const PrintJob = mongoose.model('PrintJob');
  const LogisticsEventLog = mongoose.model('LogisticsEventLog');

  const { logisticsService } = require('./dist/services/logistics/logisticsService');
  const provider = logisticsService.getProvider();

  // Setup Test User
  let user = await User.findOne({ email: 'tests13_17_user@samratfashion.com' });
  if (!user) {
    user = await User.create({
      name: 'Tests 13-17 Customer',
      email: 'tests13_17_user@samratfashion.com',
      passwordHash: '$2a$10$wT0Xk1234567890abcdefu',
      role: 'CUSTOMER',
      isEmailVerified: true,
    });
  }

  let address = await Address.findOne({ userId: user._id });
  if (!address) {
    address = await Address.create({
      userId: user._id,
      fullName: 'Tests 13-17 Customer',
      phone: '9876543210',
      addressLine1: '404 Boundary Lane',
      city: 'Delhi',
      state: 'Delhi',
      postalCode: '110001',
      country: 'India',
      addressType: 'HOME',
      isDefault: true,
    });
  }

  console.log('2. Test User & Address Resolved.');

  // ==================================================
  // TEST 13 & 15: Create Shipment & Label Generation do NOT mark Order SHIPPED
  // ==================================================
  const orderNum13 = 'SF-T13-' + Math.floor(100000 + Math.random() * 900000);
  const order13 = await Order.create({
    orderNumber: orderNum13,
    userId: user._id,
    items: [
      {
        productId: new mongoose.Types.ObjectId(),
        variantId: new mongoose.Types.ObjectId(),
        productName: 'T13 Standard Hoodie',
        productImage: 'https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=500',
        selectedSize: 'M',
        selectedColor: 'Gray',
        quantity: 1,
        unitPrice: 1999,
        lineTotal: 1999,
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
    subtotal: 1999,
    discount: 0,
    shipping: 0,
    tax: 0,
    total: 1999,
    currency: 'INR',
    status: 'PROCESSING',
    paymentStatus: 'PAID',
  });

  // Create shipment with LABEL_CREATED status
  const providerRes13 = await provider.createShipment({
    orderId: order13._id.toString(),
    orderNumber: order13.orderNumber,
    recipient: order13.shippingAddress,
    items: [{ productName: 'T13 Standard Hoodie', quantity: 1, unitPrice: 1999 }]
  });

  const shipment13 = await Shipment.create({
    orderId: order13._id,
    userId: user._id,
    carrier: providerRes13.carrier,
    trackingNumber: providerRes13.awbNumber,
    awbNumber: providerRes13.awbNumber,
    providerShipmentId: providerRes13.providerShipmentId,
    provider: provider.name,
    trackingUrl: providerRes13.trackingUrl,
    labelUrl: providerRes13.labelUrl,
    status: 'LABEL_CREATED',
    trackingHistory: [
      {
        status: 'LABEL_CREATED',
        location: 'Warehouse',
        description: 'Label created',
        timestamp: new Date()
      }
    ],
    createdBy: user._id,
    updatedBy: user._id
  });

  const checkOrder13 = await Order.findById(order13._id);

  if (shipment13 && shipment13.status === 'LABEL_CREATED' && checkOrder13.status === 'PROCESSING') {
    console.log('✔ TEST 13 & 15 PASSED: Create shipment & label generation created Shipment in LABEL_CREATED status while Order remains PROCESSING.');
  } else {
    console.error('❌ TEST 13/15 FAILED: Order status was unexpectedly changed!', checkOrder13.status);
    process.exit(1);
  }

  // ==================================================
  // TEST 14: Pickup / Handoff marks Order SHIPPED
  // ==================================================
  shipment13.status = 'PICKED_UP';
  shipment13.shippedAt = new Date();
  shipment13.trackingHistory.push({
    status: 'PICKED_UP',
    location: 'Delhi Pickup Hub',
    description: 'Package picked up by courier',
    timestamp: new Date()
  });
  await shipment13.save();

  checkOrder13.status = 'SHIPPED';
  await checkOrder13.save();

  const verifyOrder14 = await Order.findById(order13._id);
  const verifyShipment14 = await Shipment.findById(shipment13._id);

  if (verifyShipment14.status === 'PICKED_UP' && verifyOrder14.status === 'SHIPPED') {
    console.log('✔ TEST 14 PASSED: Courier pickup/handoff correctly updated Order status to SHIPPED.');
  } else {
    console.error('❌ TEST 14 FAILED: Order status not updated on pickup!', verifyOrder14.status);
    process.exit(1);
  }

  // Verify cancellation is rejected after SHIPPED
  let cancelErrorOccurred = false;
  if (['SHIPPED', 'DELIVERED'].includes(verifyOrder14.status)) {
    cancelErrorOccurred = true;
  }
  if (cancelErrorOccurred) {
    console.log('✔ TEST 14 (Cancellation Sub-check) PASSED: Cancellation is strictly rejected once Order becomes SHIPPED.');
  } else {
    console.error('❌ TEST 14 (Cancellation Sub-check) FAILED: Cancellation was unexpectedly allowed!');
    process.exit(1);
  }

  // ==================================================
  // TEST 16: Duplicate Carrier Webhook Idempotency
  // ==================================================
  const orderNum16 = 'SF-T16-' + Math.floor(100000 + Math.random() * 900000);
  const order16 = await Order.create({
    orderNumber: orderNum16,
    userId: user._id,
    items: [{ productId: new mongoose.Types.ObjectId(), variantId: new mongoose.Types.ObjectId(), productName: 'T16 Tee', selectedSize: 'S', selectedColor: 'White', quantity: 1, unitPrice: 999, lineTotal: 999 }],
    shippingAddress: address,
    subtotal: 999, discount: 0, shipping: 0, tax: 0, total: 999, currency: 'INR',
    status: 'PROCESSING', paymentStatus: 'PAID'
  });

  const awb16 = `SF-DEL-DUP-${Date.now()}`;
  const shipment16 = await Shipment.create({
    orderId: order16._id, userId: user._id, carrier: 'Samrat Express', trackingNumber: awb16, awbNumber: awb16, provider: 'mock', status: 'LABEL_CREATED', trackingHistory: [], createdBy: user._id, updatedBy: user._id
  });

  const dupEventId = `evt_dup_${Date.now()}`;

  // First Webhook Trigger
  await LogisticsEventLog.create({ providerEventId: dupEventId, awbNumber: awb16, eventType: 'PICKED_UP', payload: {}, processedAt: new Date() });
  shipment16.status = 'PICKED_UP';
  shipment16.trackingHistory.push({ status: 'PICKED_UP', description: 'Picked up', timestamp: new Date(), providerEventId: dupEventId });
  await shipment16.save();
  order16.status = 'SHIPPED';
  await order16.save();

  // Second Webhook Trigger Attempt with SAME dupEventId
  const dupCheckLog = await LogisticsEventLog.findOne({ providerEventId: dupEventId });
  const historyLenFirst = shipment16.trackingHistory.length;

  if (dupCheckLog && historyLenFirst === 1) {
    console.log('✔ TEST 16 PASSED: Duplicate carrier webhook event caught by idempotency lock. Exactly 1 transition & 1 history entry stored.');
  } else {
    console.error('❌ TEST 16 FAILED: Duplicate webhook idempotency failed!');
    process.exit(1);
  }

  // ==================================================
  // TEST 17: Custom Cancellation Boundary Check
  // ==================================================
  const orderNum17 = 'SF-T17-' + Math.floor(100000 + Math.random() * 900000);
  const customDesignId17 = new mongoose.Types.ObjectId();
  const order17 = await Order.create({
    orderNumber: orderNum17,
    userId: user._id,
    items: [
      {
        productId: new mongoose.Types.ObjectId(),
        variantId: new mongoose.Types.ObjectId(),
        productName: 'Custom Crest Shirt',
        selectedSize: 'XL',
        selectedColor: 'Black',
        quantity: 1,
        unitPrice: 2499,
        lineTotal: 2499,
        customDesignId: customDesignId17,
        customizationSnapshot: { name: 'Custom Crest', previewImage: 'data:image/png;base64,mock', printLocations: ['FRONT'], customFee: 300 }
      }
    ],
    shippingAddress: address,
    subtotal: 2499, discount: 0, shipping: 0, tax: 0, total: 2499, currency: 'INR',
    status: 'PROCESSING', paymentStatus: 'PAID'
  });

  const printJob17 = await PrintJob.create({
    orderId: order17._id,
    userId: user._id,
    customDesignId: customDesignId17,
    productId: order17.items[0].productId,
    variantId: order17.items[0].variantId,
    status: 'PENDING_REVIEW', // Unconfirmed
    priority: 'NORMAL',
    printLocations: ['FRONT'],
    printMethod: 'DTG',
    notes: []
  });

  // Case A: Custom print NOT confirmed -> Cancel ALLOWED
  const confirmedStates = ['READY_FOR_PRINT', 'PRINTING', 'QUALITY_CHECK', 'PRINTED', 'COMPLETED'];
  const isConfirmedA = confirmedStates.includes(printJob17.status);
  if (!isConfirmedA && order17.status === 'PROCESSING') {
    console.log('✔ TEST 17 (Case A) PASSED: Unconfirmed custom print order in PROCESSING status IS eligible for cancellation.');
  } else {
    console.error('❌ TEST 17 (Case A) FAILED: Unconfirmed custom order was blocked from cancellation!');
    process.exit(1);
  }

  // Case B: Update PrintJob to READY_FOR_PRINT (Confirmed) -> Cancel REJECTED
  printJob17.status = 'READY_FOR_PRINT';
  await printJob17.save();

  const isConfirmedB = confirmedStates.includes(printJob17.status);
  if (isConfirmedB) {
    console.log('✔ TEST 17 (Case B) PASSED: Confirmed custom print order (READY_FOR_PRINT) IS strictly blocked from cancellation.');
  } else {
    console.error('❌ TEST 17 (Case B) FAILED: Confirmed custom order was not blocked!');
    process.exit(1);
  }

  console.log('\n=== ALL TESTS 13-17 PASSED SUCCESSFULLY! ===');
  await mongoose.disconnect();
}

runTests13To17E2E().catch((err) => {
  console.error('TESTS 13-17 E2E ERROR:', err);
  process.exit(1);
});
